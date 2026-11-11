/* Projecao publica minima. Nunca consulta tabelas do ERP nem persiste o resultado. */
(function () {
    'use strict';
    var linhas = Object.create(null);
    var validoAte = 0;
    var pendente = null;
    var TTL = 60000;

    function avisar() { document.dispatchEvent(new CustomEvent('solidcon:publico')); }
    function linha(id) { return Date.now() < validoAte ? linhas[id] : null; }
    function carregar() {
        if (pendente) return pendente;
        var cfg = typeof siteConfig !== 'undefined' && siteConfig.supabase;
        if (!cfg || !cfg.url || !cfg.anonKey) return Promise.resolve();
        var controller = new AbortController();
        var timeout = setTimeout(function () { controller.abort(); }, 4000);
        pendente = fetch(cfg.url.replace(/\/+$/, '') + '/rest/v1/rpc/solidcon_catalogo_publico', {
            method: 'POST', cache: 'no-store', signal: controller.signal,
            headers: { apikey: cfg.anonKey, Authorization: 'Bearer ' + cfg.anonKey,
                'Content-Type': 'application/json' }, body: '{}'
        }).then(function (r) {
            if (!r.ok) throw new Error('projecao indisponivel');
            return r.json();
        }).then(function (dados) {
            if (!Array.isArray(dados)) throw new Error('projecao invalida');
            var novas = Object.create(null);
            dados.forEach(function (d) {
                if (typeof d.produto_id !== 'string' || typeof d.disponivel !== 'boolean') return;
                novas[d.produto_id] = { disponivel: d.disponivel,
                    posicao: Number.isSafeInteger(d.posicao) && d.posicao > 0 ? d.posicao : null };
            });
            linhas = novas;
            validoAte = Date.now() + TTL;
        }).catch(function () {
            linhas = Object.create(null);
            validoAte = 0; // Falha, 024 ausente ou payload invalido: normal.
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
