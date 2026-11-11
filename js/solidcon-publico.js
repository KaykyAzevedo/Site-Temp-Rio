/* Projecao publica minima. Nunca consulta tabelas do ERP nem persiste o resultado. */
(function () {
    'use strict';
    var linhas = Object.create(null);
    var fichas = Object.create(null);
    var validoAte = 0;
    var pendente = null;
    var TTL = 60000;

    function avisar() { document.dispatchEvent(new CustomEvent('solidcon:publico')); }
    function linha(id) { return Date.now() < validoAte ? linhas[id] : null; }
    function ficha(id) {
        if (!id || Date.now() >= validoAte) return null;
        var f = fichas[id];
        if (!f) return null;
        if (!f.ean_pote && !f.ean_cx24 && !f.ean_cx48 && !f.ncm && !f.gramatura) return null;
        return f;
    }
    function carregar() {
        if (pendente) return pendente;
        var cfg = typeof siteConfig !== 'undefined' && siteConfig.supabase;
        if (!cfg || !cfg.url || !cfg.anonKey) return Promise.resolve();
        var controller = new AbortController();
        var timeout = setTimeout(function () { controller.abort(); }, 4000);
        var base = cfg.url.replace(/\/+$/, '') + '/rest/v1/rpc/';
        var cabecalhos = {
            apikey: cfg.anonKey, Authorization: 'Bearer ' + cfg.anonKey,
            'Content-Type': 'application/json'
        };

        var pCatalogo = fetch(base + 'solidcon_catalogo_publico', {
            method: 'POST', cache: 'no-store', signal: controller.signal,
            headers: cabecalhos, body: '{}'
        }).then(function (r) {
            if (!r.ok) return null;
            return r.json();
        }).catch(function () { return null; });

        var pFicha = fetch(base + 'solidcon_ficha_publica', {
            method: 'POST', cache: 'no-store', signal: controller.signal,
            headers: cabecalhos, body: '{}'
        }).then(function (r) {
            if (!r.ok) return null;
            return r.json();
        }).catch(function () { return null; });

        pendente = Promise.all([pCatalogo, pFicha]).then(function (res) {
            var dadosCatalogo = res[0];
            var dadosFicha = res[1];

            if (Array.isArray(dadosCatalogo)) {
                var novas = Object.create(null);
                dadosCatalogo.forEach(function (d) {
                    if (typeof d.produto_id !== 'string' || typeof d.disponivel !== 'boolean') return;
                    novas[d.produto_id] = { disponivel: d.disponivel,
                        posicao: Number.isSafeInteger(d.posicao) && d.posicao > 0 ? d.posicao : null };
                });
                linhas = novas;
            } else {
                linhas = Object.create(null);
            }

            if (Array.isArray(dadosFicha)) {
                var novasFichas = Object.create(null);
                dadosFicha.forEach(function (d) {
                    if (!d || typeof d.produto_id !== 'string') return;
                    novasFichas[d.produto_id] = {
                        ean_pote: typeof d.ean_pote === 'string' && d.ean_pote ? d.ean_pote : null,
                        ean_cx24: typeof d.ean_cx24 === 'string' && d.ean_cx24 ? d.ean_cx24 : null,
                        ean_cx48: typeof d.ean_cx48 === 'string' && d.ean_cx48 ? d.ean_cx48 : null,
                        ncm: typeof d.ncm === 'string' && d.ncm ? d.ncm : null,
                        gramatura: typeof d.gramatura === 'string' && d.gramatura ? d.gramatura : null
                    };
                });
                fichas = novasFichas;
            } else {
                fichas = Object.create(null);
            }

            validoAte = Date.now() + TTL;
        }).catch(function () {
            linhas = Object.create(null);
            fichas = Object.create(null);
            validoAte = 0; // Falha ou timeout: normal.
        }).finally(function () {
            clearTimeout(timeout);
            pendente = null;
            avisar();
        });
        return pendente;
    }
    window.SolidconPublico = {
        carregar: carregar,
        esgotado: function (id) { var d = linha(id); return !!d && d.disponivel === false; },
        posicao: function (id) { var d = linha(id); return d ? d.posicao : null; },
        ficha: ficha,
        esperaURL: function (id) { return './pedido.html?espera_produto=' + encodeURIComponent(id) + '#form-pedido'; },
        ordenar: function (lista) {
            return lista.slice().sort(function (a, b) {
                return (SolidconPublico.posicao(a.id) || Infinity) - (SolidconPublico.posicao(b.id) || Infinity);
            });
        }
    };
    function iniciar() {
        carregar();
        setInterval(function () {
            if (Date.now() >= validoAte) avisar(); // Nao conserva um esgotado envelhecido.
            if (!document.hidden) carregar();
        }, TTL);
    }
    document.addEventListener('visibilitychange', function () { if (!document.hidden) carregar(); });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
    else iniciar();
})();
