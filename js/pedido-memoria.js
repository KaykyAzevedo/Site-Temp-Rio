/* Memória do aparelho para o vendedor: último pedido enviado e clientes atendidos.
 *
 * Tudo fica SÓ no localStorage deste navegador. Nada daqui é enviado ao
 * banco nem a terceiros: o envio do pedido continua sendo o de sempre
 * (WhatsApp + registro em js/db.js). Serve para quem monta vários pedidos no
 * mesmo celular não redigitar cliente nem sabores.
 *
 * Sem DOM. Depende de js/cart.js (Cart) e data/produtos.js (produtos);
 * respeita o esgotado do ERP (SolidconPublico) ao recarregar um pedido.
 * Toda leitura/gravação é protegida: aba anônima ou storage bloqueado só
 * desliga o recurso, nunca quebra a página. */
(function () {
    'use strict';

    var CHAVE_ULTIMO = 'temprio.ultimo-pedido.v1';
    var CHAVE_CLIENTES = 'temprio.clientes.v1';
    var MAX_CLIENTES = 50;
    var MAX_TEXTO = 300;
    var CAMPOS = ['razaoSocial', 'cnpj', 'inscricaoEstadual', 'nome', 'telefone', 'email',
                  'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf',
                  'observacoes'];

    function ler(chave) {
        try {
            var bruto = window.localStorage.getItem(chave);
            return bruto ? JSON.parse(bruto) : null;
        } catch (e) { return null; }
    }

    function gravar(chave, valor) {
        try { window.localStorage.setItem(chave, JSON.stringify(valor)); return true; }
        catch (e) { return false; }
    }

    function apagar(chave) {
        try { window.localStorage.removeItem(chave); } catch (e) { /* nada a fazer */ }
    }

    function soDigitos(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }

    function texto(v) {
        return typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]/g, ' ').slice(0, MAX_TEXTO) : '';
    }

    function catalogo() {
        return (typeof produtos !== 'undefined' && Array.isArray(produtos)) ? produtos : [];
    }

    function produtoDe(id) {
        var lista = catalogo();
        for (var i = 0; i < lista.length; i++) if (lista[i].id === id) return lista[i];
        return null;
    }

    function esgotado(id) {
        return !!(window.SolidconPublico && SolidconPublico.esgotado(id));
    }

    // Itens guardados: só id (texto curto) e potes em múltiplo da menor caixa.
    function sanearItens(lista) {
        if (!Array.isArray(lista)) return [];
        var passo = (window.Cart && Cart.PASSO) || 24;
        var vistos = Object.create(null);
        var saida = [];
        lista.forEach(function (it) {
            if (!it || typeof it.id !== 'string' || !it.id || it.id.length > 100 || vistos[it.id]) return;
            var potes = Math.trunc(Number(it.potes));
            if (!isFinite(potes) || potes < passo || potes > 24000 || potes % passo !== 0) return;
            vistos[it.id] = true;
            saida.push({ id: it.id, nome: texto(it.nome), potes: potes });
        });
        return saida.slice(0, 73);
    }

    function sanearDados(d) {
        var saida = {};
        CAMPOS.forEach(function (n) { saida[n] = texto(d && d[n]); });
        saida.ieIsento = !!(d && d.ieIsento);
        return saida;
    }

    function lerClientes() {
        var bruto = ler(CHAVE_CLIENTES);
        var mapa = Object.create(null);
        if (!bruto || typeof bruto !== 'object' || !bruto.clientes || typeof bruto.clientes !== 'object') return mapa;
        Object.keys(bruto.clientes).forEach(function (cnpj) {
            var c = bruto.clientes[cnpj];
            if (!/^\d{14}$/.test(cnpj) || !c || typeof c !== 'object') return;
            mapa[cnpj] = {
                dados: sanearDados(c.dados),
                salvoEm: Number(c.salvoEm) || 0,
                ultimoPedido: c.ultimoPedido ? {
                    em: Number(c.ultimoPedido.em) || 0,
                    itens: sanearItens(c.ultimoPedido.itens)
                } : null
            };
        });
        return mapa;
    }

    function gravarClientes(mapa) {
        // Mantém só os mais recentes: o aparelho não vira cadastro paralelo.
        var cnpjs = Object.keys(mapa).sort(function (a, b) { return mapa[b].salvoEm - mapa[a].salvoEm; });
        var limitado = {};
        cnpjs.slice(0, MAX_CLIENTES).forEach(function (k) { limitado[k] = mapa[k]; });
        return gravar(CHAVE_CLIENTES, { v: 1, clientes: limitado });
    }

    window.PedidoMemoria = {
        CAMPOS: CAMPOS,

        /* Chamado depois que o pedido foi montado para envio. `dados` = campos
         * do formulário (+ ieIsento); `itens` = Cart.itens(). `salvarCliente`
         * falso = o vendedor desmarcou a opção: guarda só o último pedido. */
        guardarEnvio: function (dados, itens, salvarCliente) {
            var agora = Date.now();
            var lista = sanearItens((itens || []).map(function (i) { return { id: i.id, nome: i.nome, potes: i.potes }; }));
            if (lista.length) gravar(CHAVE_ULTIMO, { v: 1, em: agora, itens: lista });
            var cnpj = soDigitos(dados && dados.cnpj);
            if (!salvarCliente || cnpj.length !== 14) return;
            var mapa = lerClientes();
            mapa[cnpj] = { dados: sanearDados(dados), salvoEm: agora, ultimoPedido: lista.length ? { em: agora, itens: lista } : null };
            gravarClientes(mapa);
        },

        ultimoPedido: function () {
            var u = ler(CHAVE_ULTIMO);
            if (!u || typeof u !== 'object') return null;
            var itens = sanearItens(u.itens);
            return itens.length ? { em: Number(u.em) || 0, itens: itens } : null;
        },

        // Lista para escolher: mais recente primeiro.
        clientes: function () {
            var mapa = lerClientes();
            return Object.keys(mapa).map(function (cnpj) {
                return { cnpj: cnpj, dados: mapa[cnpj].dados, salvoEm: mapa[cnpj].salvoEm, ultimoPedido: mapa[cnpj].ultimoPedido };
            }).sort(function (a, b) { return b.salvoEm - a.salvoEm; });
        },

        cliente: function (cnpj) {
            var mapa = lerClientes();
            var c = mapa[soDigitos(cnpj)];
            return c ? { cnpj: soDigitos(cnpj), dados: c.dados, salvoEm: c.salvoEm, ultimoPedido: c.ultimoPedido } : null;
        },

        apagarCliente: function (cnpj) {
            var mapa = lerClientes();
            delete mapa[soDigitos(cnpj)];
            if (Object.keys(mapa).length) gravarClientes(mapa); else apagar(CHAVE_CLIENTES);
        },

        // Apaga clientes E último pedido (tudo o que este recurso guarda).
        apagarTudo: function () {
            apagar(CHAVE_CLIENTES);
            apagar(CHAVE_ULTIMO);
        },

        /* Troca o carrinho pelos itens dados. Esgotados e sabores que saíram do
         * catálogo ficam de fora e voltam em `pulados` (para avisar a pessoa). */
        carregarNoCarrinho: function (itens) {
            var lista = sanearItens(itens);
            var pulados = [];
            var carregados = 0;
            if (!window.Cart) return { carregados: 0, pulados: lista.map(function (i) { return i.nome || i.id; }) };
            Cart.limpar();
            lista.forEach(function (it) {
                var p = produtoDe(it.id);
                if (!p || esgotado(it.id)) { pulados.push(p ? p.nome : (it.nome || it.id)); return; }
                if (Cart.adicionar(p.id, p.nome, it.potes)) carregados++;
                else pulados.push(p.nome);
            });
            return { carregados: carregados, pulados: pulados };
        }
    };
})();
