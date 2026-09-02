/* Carrinho de pedidos — estado, matemática e persistência.
 *
 * MODELO: o cliente escolhe QUANTOS POTES quer de cada sabor, em múltiplos de
 * 24. O site monta as caixas sozinho, sempre preferindo as maiores: 72 potes
 * viram 1 caixa de 48 + 1 de 24. Como a caixa grande é o dobro da pequena,
 * sobra no máximo UMA caixa pequena por sabor.
 *
 * A montagem é puramente logística: o pote custa o mesmo em qualquer caixa,
 * então o preço de 72 potes é o mesmo independente de como sejam embalados.
 *
 * Este arquivo NÃO toca no DOM. A interface vive em js/cart-ui.js e
 * js/pedido.js, que apenas escutam o evento 'cart:change'.
 *
 * Carregado no <head>, depois de js/config.js e data/produtos.js.
 */
(function () {
    'use strict';

    /* ===================================================================
     * ScrollLock — trava de rolagem compartilhada entre overlays
     *
     * O modal de produto escrevia direto em document.body.style.overflow, e
     * o destravava dentro de um setTimeout de 300ms. Com dois overlays isso
     * abre uma janela real em que um destrava a página com o outro ainda
     * aberto. Aqui a trava é por chave: só libera quando ninguém mais segura.
     * =================================================================== */
    var travas = new Set();
    var paddingOriginal = null;

    window.ScrollLock = {
        acquire: function (chave) {
            if (travas.has(chave)) return;
            if (travas.size === 0) {
                // Compensa a largura da barra de rolagem para a página não
                // "pular" ao abrir o overlay.
                var larguraBarra = window.innerWidth - document.documentElement.clientWidth;
                paddingOriginal = document.body.style.paddingRight;
                if (larguraBarra > 0) {
                    document.body.style.paddingRight = larguraBarra + 'px';
                }
                document.body.style.overflow = 'hidden';
            }
            travas.add(chave);
        },
        release: function (chave) {
            if (!travas.delete(chave)) return;
            if (travas.size === 0) {
                document.body.style.overflow = '';
                document.body.style.paddingRight = paddingOriginal || '';
                paddingOriginal = null;
            }
        },
        ativo: function () { return travas.size > 0; }
    };

    /* ===================================================================
     * Configuração comercial
     * =================================================================== */
    var CHAVE = 'temprio.cart.v2';
    var CHAVE_ANTIGA = 'temprio.cart.v1';
    var VERSAO = 2;
    var MAX_POTES_POR_SABOR = 24000; // 1000 caixas pequenas: teto sanitário
    var MAX_LINHAS = 73;             // um sabor por linha

    // siteConfig e produtos são declarados com `const` no escopo global; `const`
    // NÃO vira propriedade de window, então tem que ser lido pelo identificador nu.
    var cfg = (typeof siteConfig !== 'undefined' && siteConfig.pedido) ? siteConfig.pedido : {
        precoPorPoteCentavos: 400,
        caixas: [{ potes: 24, precoCentavos: 9600 }, { potes: 48, precoCentavos: 19200 }],
        minimoPotes: 480
    };

    // Da maior para a menor: a montagem é gulosa, preferindo caixas grandes.
    var CAIXAS = cfg.caixas.slice().sort(function (a, b) { return b.potes - a.potes; });
    var PASSO = CAIXAS[CAIXAS.length - 1].potes; // menor caixa = incremento mínimo

    // Guarda de consistência: pega a edição futura em que alguém muda o preço
    // da caixa e esquece do preço por pote (ou vice-versa).
    CAIXAS.forEach(function (c) {
        var esperado = c.potes * cfg.precoPorPoteCentavos;
        if (c.precoCentavos !== esperado) {
            console.warn(
                '[carrinho] Preço inconsistente para a caixa de ' + c.potes + ' potes: ' +
                'configurado R$ ' + (c.precoCentavos / 100).toFixed(2) + ', mas ' +
                c.potes + ' x R$ ' + (cfg.precoPorPoteCentavos / 100).toFixed(2) +
                ' = R$ ' + (esperado / 100).toFixed(2) + '. Confira siteConfig.pedido.'
            );
        }
    });

    /* Monta as caixas de uma quantidade de potes, preferindo as maiores.
     * Guloso funciona porque cada caixa é múltiplo da menor. */
    function montarCaixas(potes) {
        // Normaliza antes de montar: um valor fora do passo perderia potes em
        // silencio na divisao (1000 viraria 984 em caixas, com preco de 1000).
        var restante = ajustarAoPasso(potes);
        var caixas = [];
        CAIXAS.forEach(function (c) {
            var n = Math.floor(restante / c.potes);
            if (n > 0) {
                caixas.push({ potes: c.potes, caixas: n });
                restante -= n * c.potes;
            }
        });
        return caixas; // restante é sempre 0 quando potes é múltiplo do PASSO
    }

    function totalDeCaixas(potes) {
        return montarCaixas(potes).reduce(function (a, c) { return a + c.caixas; }, 0);
    }

    // "1 caixa de 48 + 1 de 24"
    function descreverCaixas(potes) {
        var partes = montarCaixas(potes).map(function (c) {
            return c.caixas + (c.caixas === 1 ? ' caixa de ' : ' caixas de ') + c.potes;
        });
        return partes.length ? partes.join(' + ') : 'nenhuma caixa';
    }

    // Arredonda para o múltiplo de PASSO mais próximo, nunca abaixo de um passo.
    function ajustarAoPasso(potes) {
        var n = Math.round(Number(potes) / PASSO) * PASSO;
        if (!isFinite(n) || n < PASSO) n = PASSO;
        return Math.min(n, MAX_POTES_POR_SABOR);
    }

    /* ===================================================================
     * Persistência
     * =================================================================== */
    var temStorage = true;
    var emMemoria = null;

    function lerStorage(chave) {
        if (!temStorage) return emMemoria;
        try { return window.localStorage.getItem(chave); }
        catch (e) { temStorage = false; return null; }
    }

    function gravarStorage(texto) {
        if (!temStorage) { emMemoria = texto; return; }
        try { window.localStorage.setItem(CHAVE, texto); }
        catch (e) { temStorage = false; emMemoria = texto; }
    }

    function apagarChave(chave) {
        if (!temStorage) { emMemoria = null; return; }
        try { window.localStorage.removeItem(chave); } catch (e) { /* nada a fazer */ }
    }

    /* Saneamento: nunca confiar no que veio do storage. Qualquer falha
     * estrutural limpa a chave, senão um valor envenenado explode a cada
     * carregamento de página. */
    function sanear(bruto) {
        if (!bruto) return [];

        var dados;
        try { dados = JSON.parse(bruto); }
        catch (e) { apagarChave(CHAVE); return []; }

        if (!dados || typeof dados !== 'object' || dados.v !== VERSAO || !Array.isArray(dados.items)) {
            apagarChave(CHAVE);
            return [];
        }

        var porId = Object.create(null);
        var ordem = [];

        dados.items.forEach(function (bruta) {
            if (!bruta || typeof bruta !== 'object') return;
            if (typeof bruta.id !== 'string' || !bruta.id) return;

            var potes = Math.trunc(Number(bruta.potes));
            if (!isFinite(potes) || potes < PASSO) return;
            if (potes % PASSO !== 0) potes = ajustarAoPasso(potes);
            potes = Math.min(potes, MAX_POTES_POR_SABOR);

            if (porId[bruta.id]) {
                // Deduplica somando — defesa contra escrita concorrente entre abas.
                porId[bruta.id].potes = Math.min(porId[bruta.id].potes + potes, MAX_POTES_POR_SABOR);
                return;
            }
            porId[bruta.id] = {
                id: bruta.id,
                nome: typeof bruta.nome === 'string' && bruta.nome ? bruta.nome : bruta.id,
                potes: potes
            };
            ordem.push(bruta.id);
        });

        return ordem.slice(0, MAX_LINHAS).map(function (k) { return porId[k]; });
    }

    /* Carrinho antigo (v1: sabor + tamanho + quantidade de caixas) vira o novo
     * somando os potes por sabor. Ninguém perde o pedido na virada do modelo. */
    function migrarDaV1() {
        var bruto = lerStorage(CHAVE_ANTIGA);
        if (!bruto) return [];

        var dados;
        try { dados = JSON.parse(bruto); } catch (e) { apagarChave(CHAVE_ANTIGA); return []; }
        if (!dados || dados.v !== 1 || !Array.isArray(dados.items)) { apagarChave(CHAVE_ANTIGA); return []; }

        var porId = Object.create(null);
        var ordem = [];
        dados.items.forEach(function (it) {
            if (!it || typeof it.id !== 'string') return;
            var potes = Math.trunc(Number(it.qty)) * Math.trunc(Number(it.box));
            if (!isFinite(potes) || potes < PASSO) return;
            if (!porId[it.id]) {
                porId[it.id] = { id: it.id, nome: it.nome || it.id, potes: 0 };
                ordem.push(it.id);
            }
            porId[it.id].potes = Math.min(porId[it.id].potes + potes, MAX_POTES_POR_SABOR);
        });

        apagarChave(CHAVE_ANTIGA);
        return ordem.map(function (k) { return porId[k]; });
    }

    var itens = sanear(lerStorage(CHAVE));
    if (!itens.length) {
        var migrados = migrarDaV1();
        if (migrados.length) {
            itens = migrados;
            gravarStorage(JSON.stringify({ v: VERSAO, updatedAt: Date.now(), items: itens }));
        }
    }

    function gravar() {
        gravarStorage(JSON.stringify({ v: VERSAO, updatedAt: Date.now(), items: itens }));
        avisar();
    }

    function avisar() {
        document.dispatchEvent(new CustomEvent('cart:change', {
            detail: { items: comStale(), totals: totais() }
        }));
    }

    function catalogo() {
        return (typeof produtos !== 'undefined' && Array.isArray(produtos)) ? produtos : null;
    }

    function existeNoCatalogo(id) {
        var lista = catalogo();
        if (!lista) return true; // sem catálogo carregado, não há como julgar
        return lista.some(function (p) { return p.id === id; });
    }

    function comStale() {
        return itens.map(function (it) {
            var lista = catalogo();
            var produto = lista
                ? lista.filter(function (p) { return p.id === it.id; })[0]
                : null;
            return {
                id: it.id,
                // O nome vem do catálogo quando o produto existe (assim, corrigir
                // um nome atualiza carrinhos antigos); o snapshot é só o resgate.
                nome: produto ? produto.nome : it.nome,
                imagem: produto ? produto.imagem : null,
                potes: it.potes,
                caixas: montarCaixas(it.potes),
                totalCaixas: totalDeCaixas(it.potes),
                descricaoCaixas: descreverCaixas(it.potes),
                subtotalCentavos: it.potes * cfg.precoPorPoteCentavos,
                stale: !existeNoCatalogo(it.id)
            };
        });
    }

    function indiceDe(id) {
        for (var i = 0; i < itens.length; i++) {
            if (itens[i].id === id) return i;
        }
        return -1;
    }

    /* ===================================================================
     * Matemática
     * =================================================================== */
    function totais() {
        var caixas = 0, potes = 0;

        itens.forEach(function (it) {
            potes += it.potes;
            caixas += totalDeCaixas(it.potes);
        });

        var minimo = cfg.minimoPotes;
        var faltam = Math.max(0, minimo - potes);

        return {
            linhas: itens.length,
            caixas: caixas,
            potes: potes,
            valorCentavos: potes * cfg.precoPorPoteCentavos,
            minimoPotes: minimo,
            faltamPotes: faltam,
            atingiuMinimo: potes >= minimo,
            progresso: minimo > 0 ? Math.min(potes / minimo, 1) : 1,
            // Como fica o total em caixas físicas quando o mínimo for atingido.
            caixasDoMinimo: descreverCaixas(minimo)
        };
    }

    var formatador = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

    /* ===================================================================
     * API pública
     * =================================================================== */
    window.Cart = {
        PASSO: PASSO,
        TAMANHOS: CAIXAS.map(function (c) { return c.potes; }),
        config: cfg,

        // O carrinho está sendo salvo? Falso em aba anônima ou com storage
        // bloqueado — a interface avisa o cliente para não perder o pedido.
        get persistente() { return temStorage; },

        itens: function () { return comStale(); },

        potes: function (id) {
            var i = indiceDe(id);
            return i === -1 ? 0 : itens[i].potes;
        },

        vazio: function () { return itens.length === 0; },

        totais: totais,

        montarCaixas: montarCaixas,
        descreverCaixas: descreverCaixas,
        ajustarAoPasso: ajustarAoPasso,

        precoDePotes: function (potes) {
            return (Number(potes) || 0) * cfg.precoPorPoteCentavos;
        },

        adicionar: function (id, nome, potes) {
            potes = ajustarAoPasso(potes);
            var i = indiceDe(id);
            if (i === -1) {
                if (itens.length >= MAX_LINHAS) return false;
                itens.push({ id: id, nome: nome || id, potes: potes });
            } else {
                itens[i].potes = Math.min(itens[i].potes + potes, MAX_POTES_POR_SABOR);
            }
            gravar();
            return true;
        },

        definirPotes: function (id, potes) {
            var i = indiceDe(id);
            if (i === -1) return false;

            // Zero ou negativo remove (e o botao de diminuir chega a zero assim).
            // Qualquer valor positivo abaixo de uma caixa e engano de digitacao:
            // sobe para a caixa minima em vez de apagar a linha.
            var bruto = Number(potes);
            if (!isFinite(bruto) || bruto <= 0) {
                itens.splice(i, 1);
            } else {
                itens[i].potes = ajustarAoPasso(bruto);
            }
            gravar();
            return true;
        },

        remover: function (id) {
            var i = indiceDe(id);
            if (i === -1) return false;
            itens.splice(i, 1);
            gravar();
            return true;
        },

        limpar: function () {
            itens = [];
            apagarChave(CHAVE);
            avisar();
        },

        formatarBRL: function (centavos) {
            return formatador.format((centavos || 0) / 100);
        }
    };

    /* Duas abas abertas: catálogo numa, pedido na outra. Sem isso, itens
     * adicionados de um lado somem do outro. */
    window.addEventListener('storage', function (e) {
        if (e.key !== CHAVE) return;
        itens = sanear(e.newValue);
        avisar();
    });
})();
