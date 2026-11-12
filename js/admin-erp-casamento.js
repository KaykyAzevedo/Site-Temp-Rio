/* Casamento pedido do site <-> venda registrada no ERP SOLIDCON (Kanban, fase 1).
 *
 * Funções puras, sem DOM e sem rede: o painel (js/admin.js) busca os pedidos e as
 * vendas (solidcon_vendas_clientes, migração 026) e chama TempRioErpCasamento.casar().
 * Só SUGERE: quem confirma é a equipe, pelo fluxo de status já existente.
 * A migração 034 (fase 2, não aplicada) faz a MESMA conta no banco — mudar a regra
 * aqui exige mudar lá também (admin/migracoes/034_pedidos_erp_vinculo.sql).
 *
 * Regra:
 *   1. venda.tipo = 'cnpj' e venda.documento = dígitos de pedido.cnpj;
 *   2. venda.dt >= pedido.criado_em - 30 min e venda.dia <= dia_SP(pedido.criado_em) + 7;
 *   3. |venda.valor - alvo| <= max(5% do alvo, R$ 10,00); alvo = produtos OU produtos+frete
 *      (vale a menor diferença; empate fica com 'produtos');
 *   4. uma venda casa com no máximo um pedido;
 *   5. pedidos em ordem (criado_em, id); 'casado' = exatamente 1 venda livre na tolerância e
 *      essa venda não está na tolerância de nenhum OUTRO pedido ainda não casado.
 *   Dúvida vira 'conferir' (várias vendas, venda disputada, valor fora da tolerância,
 *   ou soma de 2–3 cupons que bate). Pedido sem venda não ganha resultado (fica como hoje).
 * Só pedidos 'aguardando' e 'confirmado'; os outros nunca são tocados.
 */
(function (raiz) {
    'use strict';

    var REGRA = {
        minutosAntes: 30,
        diasDepois: 7,
        tolPct: 0.05,
        tolMinCentavos: 1000,
        diasPedido: 120,       // pedidos mais antigos que isso não entram (igual à 034)
        maxCuponsSoma: 3
    };
    var STATUS_ABERTOS = { aguardando: true, confirmado: true };

    var fmtDiaSP = (typeof Intl !== 'undefined' && Intl.DateTimeFormat)
        ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
        : null;

    // 'AAAA-MM-DD' do instante no fuso de São Paulo (mesmo 'dia' da 026).
    function diaSP(iso) {
        var t = Date.parse(iso);
        if (!isFinite(t)) return null;
        if (fmtDiaSP) return fmtDiaSP.format(new Date(t));
        return new Date(t - 3 * 3600000).toISOString().slice(0, 10); // sem Intl: UTC-3 fixo
    }

    function somaDias(dia, n) {
        var p = String(dia).split('-');
        return new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + n)).toISOString().slice(0, 10);
    }

    function docCnpj(v) {
        var d = String(v == null ? '' : v).replace(/\D/g, '');
        return d.length === 14 ? d : null;
    }

    function chaveVenda(v) { return v.dia + '|' + v.cd_pdv + '|' + v.nr_cupom; }

    function tolerancia(alvo) { return Math.max(Math.round(alvo * REGRA.tolPct), REGRA.tolMinCentavos); }

    function aberto(p, agora) {
        if (!p || !STATUS_ABERTOS[p.status] || !docCnpj(p.cnpj)) return false;
        var t = Date.parse(p.criado_em);
        return isFinite(t) && t >= agora - REGRA.diasPedido * 86400000;
    }

    // Venda dentro da janela de tempo do pedido (regras 1 e 2), sem olhar valor.
    function naJanela(p, v) {
        if (v.tipo !== 'cnpj' || v.documento !== docCnpj(p.cnpj)) return false;
        var tp = Date.parse(p.criado_em), tv = Date.parse(v.dt);
        if (!isFinite(tp) || !isFinite(tv) || tv < tp - REGRA.minutosAntes * 60000) return false;
        return String(v.dia) <= somaDias(diaSP(p.criado_em), REGRA.diasDepois);
    }

    // Melhor alvo dentro da tolerância (regra 3) ou null.
    function melhorAlvo(p, valor) {
        var prod = Number(p.valor_centavos) || 0;
        var alvos = [['produtos', prod], ['produtos_frete', prod + (Number(p.frete_centavos) || 0)]];
        var melhor = null;
        alvos.forEach(function (a) {
            var dif = Math.abs(valor - a[1]);
            if (dif <= tolerancia(a[1]) && (!melhor || dif < melhor.diferenca)) melhor = { alvo: a[0], diferenca: dif };
        });
        return melhor;
    }

    function resumoVenda(v) {
        return { dia: v.dia, dt: v.dt, cd_pdv: v.cd_pdv, nr_cupom: v.nr_cupom, valor_centavos: Number(v.valor_centavos) || 0 };
    }

    // O que buscar no banco: CNPJs dos pedidos abertos e o menor dia possível de venda.
    // null = nenhum pedido aberto (não precisa consultar).
    function consulta(pedidos, agora) {
        agora = agora == null ? Date.now() : agora;
        var docs = {}, desde = null;
        (pedidos || []).forEach(function (p) {
            if (!aberto(p, agora)) return;
            docs[docCnpj(p.cnpj)] = true;
            var d = diaSP(new Date(Date.parse(p.criado_em) - REGRA.minutosAntes * 60000).toISOString());
            if (d && (!desde || d < desde)) desde = d;
        });
        var lista = Object.keys(docs).sort();
        return lista.length ? { documentos: lista, desde: desde } : null;
    }

    // Combinações de 2..maxCuponsSoma vendas cuja soma bate com algum alvo (só para 'conferir').
    function somaQueBate(p, vendas) {
        var n = vendas.length, achou = null;
        if (n < 2 || n > 12) return null; // limite de custo; cliente com muitas vendas na janela já é 'conferir'
        function tenta(ini, escolhidas, soma) {
            if (achou) return;
            if (escolhidas.length >= 2) {
                var m = melhorAlvo(p, soma);
                if (m) { achou = { vendas: escolhidas.slice(), alvo: m.alvo, diferenca: m.diferenca, soma: soma }; return; }
            }
            if (escolhidas.length === REGRA.maxCuponsSoma) return;
            for (var i = ini; i < n; i++) {
                escolhidas.push(vendas[i]);
                tenta(i + 1, escolhidas, soma + (Number(vendas[i].valor_centavos) || 0));
                escolhidas.pop();
            }
        }
        tenta(0, [], 0);
        return achou;
    }

    /* pedidos: [{id, status, cnpj, criado_em, valor_centavos, frete_centavos}]
     * vendas:  [{dia, dt, documento, tipo, valor_centavos, cd_pdv, nr_cupom}]
     * opcoes:  {agora: ms, vinculos: [{pedido_id, dia, cd_pdv, nr_cupom}] (da 034, se existir)}
     * Retorna {porPedido: {id: resultado}, resumo: {casados, paraConfirmar, conferir}}
     * resultado = {estado:'casado', venda, alvo, diferenca}
     *           | {estado:'conferir', motivo:'varias_vendas'|'venda_disputada'|'valor_diferente'|'varios_cupons', candidatos:[venda...]} */
    function casar(pedidos, vendas, opcoes) {
        opcoes = opcoes || {};
        var agora = opcoes.agora == null ? Date.now() : opcoes.agora;
        var usadas = {}, pedidoVinculado = {};
        (opcoes.vinculos || []).forEach(function (v) { usadas[chaveVenda(v)] = true; pedidoVinculado[v.pedido_id] = true; });

        var abertos = (pedidos || []).filter(function (p) { return aberto(p, agora) && !pedidoVinculado[p.id]; })
            .sort(function (a, b) {
                var d = Date.parse(a.criado_em) - Date.parse(b.criado_em);
                return d || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
            });
        var vs = (vendas || []).filter(function (v) { return v && v.tipo === 'cnpj' && !usadas[chaveVenda(v)]; });

        // Pares dentro da regra 1–3, por pedido; e quem disputa cada venda.
        var pares = {}, porVenda = {}, janela = {};
        abertos.forEach(function (p) {
            pares[p.id] = []; janela[p.id] = [];
            vs.forEach(function (v) {
                if (!naJanela(p, v)) return;
                janela[p.id].push(v);
                var m = melhorAlvo(p, Number(v.valor_centavos) || 0);
                if (!m) return;
                pares[p.id].push({ venda: v, alvo: m.alvo, diferenca: m.diferenca });
                (porVenda[chaveVenda(v)] = porVenda[chaveVenda(v)] || []).push(p.id);
            });
        });

        var res = {}, casadoPedido = {};
        abertos.forEach(function (p) {
            var livres = pares[p.id].filter(function (x) { return !usadas[chaveVenda(x.venda)]; });
            if (livres.length > 1) {
                res[p.id] = { estado: 'conferir', motivo: 'varias_vendas', candidatos: livres.map(function (x) { return resumoVenda(x.venda); }) };
                return;
            }
            if (livres.length !== 1) return;
            var x = livres[0], k = chaveVenda(x.venda);
            var disputada = (porVenda[k] || []).some(function (id) { return id !== p.id && !casadoPedido[id]; });
            if (disputada) {
                res[p.id] = { estado: 'conferir', motivo: 'venda_disputada', candidatos: [resumoVenda(x.venda)] };
                return;
            }
            usadas[k] = true; casadoPedido[p.id] = true;
            res[p.id] = { estado: 'casado', venda: resumoVenda(x.venda), alvo: x.alvo, diferenca: x.diferenca };
        });

        // Sem par na tolerância: soma de cupons ou venda com valor diferente na janela => conferir.
        abertos.forEach(function (p) {
            if (res[p.id] || pares[p.id].length) return;
            var livres = janela[p.id].filter(function (v) { return !usadas[chaveVenda(v)]; });
            if (!livres.length) return;
            var s = somaQueBate(p, livres);
            res[p.id] = s
                ? { estado: 'conferir', motivo: 'varios_cupons', candidatos: s.vendas.map(resumoVenda), soma_centavos: s.soma }
                : { estado: 'conferir', motivo: 'valor_diferente', candidatos: livres.map(resumoVenda) };
        });

        var resumo = { casados: 0, paraConfirmar: 0, conferir: 0 };
        abertos.forEach(function (p) {
            var r = res[p.id];
            if (!r) return;
            if (r.estado === 'casado') { resumo.casados++; if (p.status === 'aguardando') resumo.paraConfirmar++; }
            else resumo.conferir++;
        });
        return { porPedido: res, resumo: resumo };
    }

    var api = { REGRA: REGRA, diaSP: diaSP, somaDias: somaDias, docCnpj: docCnpj, chaveVenda: chaveVenda,
                tolerancia: tolerancia, consulta: consulta, casar: casar };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else raiz.TempRioErpCasamento = api;
})(typeof window !== 'undefined' ? window : this);
