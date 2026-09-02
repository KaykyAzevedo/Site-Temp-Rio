/* Carrinho de pedidos — estado, matemática e persistência.
 *
 * Este arquivo NÃO toca no DOM. Toda a interface vive em js/cart-ui.js e
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
    var CHAVE = 'temprio.cart.v1';
    var VERSAO = 1;
    var MAX_CAIXAS = 999;
    var MAX_LINHAS = 146; // 73 sabores x 2 tamanhos

    // siteConfig e produtos sao declarados com `const` no escopo global; `const`
    // NAO vira propriedade de window, entao tem que ser lido pelo identificador nu.
    var cfg = (typeof siteConfig !== 'undefined' && siteConfig.pedido) ? siteConfig.pedido : {
        precoPorPoteCentavos: 400,
        caixas: [{ potes: 24, precoCentavos: 9600 }, { potes: 48, precoCentavos: 19200 }],
        minimoPotes: 480
    };

    var TAMANHOS = cfg.caixas.map(function (c) { return c.potes; });

    function caixaDe(potes) {
        for (var i = 0; i < cfg.caixas.length; i++) {
            if (cfg.caixas[i].potes === potes) return cfg.caixas[i];
        }
        return null;
    }

    // Guarda de consistência: pega a edição futura em que alguém muda o preço
    // da caixa e esquece do preço por pote (ou vice-versa).
    cfg.caixas.forEach(function (c) {
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

    /* ===================================================================
     * Persistência
     * =================================================================== */
    var temStorage = true;
    var emMemoria = null; // usado quando o localStorage não está disponível

    function lerStorage() {
        if (!temStorage) return emMemoria;
        try {
            return window.localStorage.getItem(CHAVE);
        } catch (e) {
            temStorage = false;
            return null;
        }
    }

    function gravarStorage(texto) {
        if (!temStorage) { emMemoria = texto; return; }
        try {
            window.localStorage.setItem(CHAVE, texto);
        } catch (e) {
            // Cota estourada ou storage bloqueado no meio da sessão.
            temStorage = false;
            emMemoria = texto;
        }
    }

    function apagarStorage() {
        emMemoria = null;
        if (!temStorage) return;
        try { window.localStorage.removeItem(CHAVE); } catch (e) { /* nada a fazer */ }
    }

    /* Saneamento: nunca confiar no que veio do storage. O usuário pode ter
     * editado à mão, outra aba pode ter gravado no meio, ou o dado pode ser
     * de uma versão antiga. Qualquer falha -> carrinho vazio e chave removida
     * (senão um valor envenenado explode a cada carregamento de página). */
    function sanear(bruto) {
        if (!bruto) return [];

        var dados;
        try {
            dados = JSON.parse(bruto);
        } catch (e) {
            apagarStorage();
            return [];
        }

        if (!dados || typeof dados !== 'object' || dados.v !== VERSAO || !Array.isArray(dados.items)) {
            apagarStorage();
            return [];
        }

        var porChave = Object.create(null);
        var ordem = [];

        dados.items.forEach(function (bruta) {
            if (!bruta || typeof bruta !== 'object') return;
            if (typeof bruta.id !== 'string' || !bruta.id) return;
            if (TAMANHOS.indexOf(bruta.box) === -1) return;

            var qty = Math.trunc(Number(bruta.qty));
            if (!isFinite(qty) || qty < 1) return;
            if (qty > MAX_CAIXAS) qty = MAX_CAIXAS;

            var chave = bruta.id + '|' + bruta.box;
            if (porChave[chave]) {
                // Deduplica somando — defesa contra escrita concorrente entre abas.
                porChave[chave].qty = Math.min(porChave[chave].qty + qty, MAX_CAIXAS);
                return;
            }
            porChave[chave] = {
                id: bruta.id,
                nome: typeof bruta.nome === 'string' && bruta.nome ? bruta.nome : bruta.id,
                box: bruta.box,
                qty: qty
            };
            ordem.push(chave);
        });

        return ordem.slice(0, MAX_LINHAS).map(function (k) { return porChave[k]; });
    }

    var itens = sanear(lerStorage());

    function gravar() {
        gravarStorage(JSON.stringify({
            v: VERSAO,
            updatedAt: Date.now(),
            items: itens
        }));
        avisar();
    }

    function avisar() {
        document.dispatchEvent(new CustomEvent('cart:change', {
            detail: { items: comStale(), totals: totais() }
        }));
    }

    /* Produto que saiu do catálogo depois de ter entrado no carrinho.
     * Marcamos em memória (nunca persistimos) para a interface avisar, mas
     * jamais apagamos a linha por conta própria: quem decide é o cliente. */
    function catalogo() {
        return (typeof produtos !== 'undefined' && Array.isArray(produtos)) ? produtos : null;
    }

    function existeNoCatalogo(id) {
        var lista = catalogo();
        if (!lista) return true; // sem catalogo carregado, nao ha como julgar
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
                box: it.box,
                qty: it.qty,
                subtotalCentavos: it.qty * caixaDe(it.box).precoCentavos,
                potes: it.qty * it.box,
                stale: !existeNoCatalogo(it.id)
            };
        });
    }

    function indiceDe(id, box) {
        for (var i = 0; i < itens.length; i++) {
            if (itens[i].id === id && itens[i].box === box) return i;
        }
        return -1;
    }

    /* ===================================================================
     * Matemática
     * =================================================================== */
    function totais() {
        var caixas = 0, potes = 0, valorCentavos = 0;

        itens.forEach(function (it) {
            caixas += it.qty;
            potes += it.qty * it.box;
            valorCentavos += it.qty * caixaDe(it.box).precoCentavos;
        });

        var minimo = cfg.minimoPotes;
        var faltam = Math.max(0, minimo - potes);

        return {
            linhas: itens.length,
            caixas: caixas,
            potes: potes,
            valorCentavos: valorCentavos,
            minimoPotes: minimo,
            faltamPotes: faltam,
            // Quantas caixas ainda faltariam, por tamanho. Arredonda para cima:
            // o cliente não compra meia caixa.
            faltamCaixas: TAMANHOS.reduce(function (acc, t) {
                acc[t] = Math.ceil(faltam / t);
                return acc;
            }, {}),
            atingiuMinimo: potes >= minimo,
            progresso: minimo > 0 ? Math.min(potes / minimo, 1) : 1
        };
    }

    var formatador = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

    /* ===================================================================
     * API pública
     * =================================================================== */
    window.Cart = {
        TAMANHOS: TAMANHOS.slice(),
        config: cfg,

        // O carrinho está sendo salvo? Falso em aba anônima ou com storage
        // bloqueado — a interface avisa o cliente para não perder o pedido.
        get persistente() { return temStorage; },

        itens: function () { return comStale(); },

        quantidade: function (id, box) {
            var i = indiceDe(id, box);
            return i === -1 ? 0 : itens[i].qty;
        },

        vazio: function () { return itens.length === 0; },

        totais: totais,

        precoCaixa: function (box) {
            var c = caixaDe(box);
            return c ? c.precoCentavos : 0;
        },

        adicionar: function (id, nome, box, qty) {
            if (TAMANHOS.indexOf(box) === -1) return false;
            qty = Math.trunc(Number(qty));
            if (!isFinite(qty) || qty < 1) return false;

            var i = indiceDe(id, box);
            if (i === -1) {
                if (itens.length >= MAX_LINHAS) return false;
                itens.push({ id: id, nome: nome || id, box: box, qty: Math.min(qty, MAX_CAIXAS) });
            } else {
                itens[i].qty = Math.min(itens[i].qty + qty, MAX_CAIXAS);
            }
            gravar();
            return true;
        },

        definirQuantidade: function (id, box, qty) {
            var i = indiceDe(id, box);
            if (i === -1) return false;

            qty = Math.trunc(Number(qty));
            if (!isFinite(qty) || qty < 1) {
                itens.splice(i, 1);
            } else {
                itens[i].qty = Math.min(qty, MAX_CAIXAS);
            }
            gravar();
            return true;
        },

        // Troca o tamanho de uma linha já no carrinho. Se a linha de destino
        // já existir, funde as duas somando as caixas.
        trocarTamanho: function (id, de, para) {
            if (de === para) return false;
            if (TAMANHOS.indexOf(para) === -1) return false;

            var origem = indiceDe(id, de);
            if (origem === -1) return false;

            var destino = indiceDe(id, para);
            if (destino === -1) {
                itens[origem].box = para;
            } else {
                itens[destino].qty = Math.min(itens[destino].qty + itens[origem].qty, MAX_CAIXAS);
                itens.splice(origem, 1);
            }
            gravar();
            return true;
        },

        remover: function (id, box) {
            var i = indiceDe(id, box);
            if (i === -1) return false;
            itens.splice(i, 1);
            gravar();
            return true;
        },

        limpar: function () {
            itens = [];
            apagarStorage();
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
