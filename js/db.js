/* Registro de pedidos e visitas no Supabase — lado público do site.
 *
 * Usa fetch direto na API REST em vez da biblioteca oficial: as páginas
 * públicas só precisam INSERIR, e um insert não justifica carregar 120 KB de
 * biblioteca em todo o site. O painel (admin.html) carrega a biblioteca, porque
 * lá tem login de verdade.
 *
 * Nada aqui LÊ dados. Mesmo que alguém tente, as políticas de RLS do banco
 * recusam leitura com a chave pública — ver admin/supabase.sql.
 *
 * Carregado no <head>, depois de js/config.js.
 */
(function () {
    'use strict';

    function cfg() {
        var s = (typeof siteConfig !== 'undefined' && siteConfig.supabase) || null;
        return (s && s.url && s.anonKey) ? s : null;
    }

    function inserir(tabela, linha) {
        var c = cfg();
        if (!c) return Promise.reject(new Error('supabase nao configurado'));

        return fetch(c.url.replace(/\/+$/, '') + '/rest/v1/' + tabela, {
            method: 'POST',
            headers: {
                'apikey': c.anonKey,
                'Authorization': 'Bearer ' + c.anonKey,
                'Content-Type': 'application/json',
                // Não devolve a linha criada: o site não tem permissão de ler,
                // e pedir retorno faria a requisição falhar por RLS.
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify(linha)
        }).then(function (resposta) {
            // fetch não rejeita em erro de HTTP: sem esta checagem, um 401 por
            // política mal configurada passaria como sucesso.
            if (!resposta.ok) {
                return resposta.text().then(function (corpo) {
                    throw new Error('HTTP ' + resposta.status + ' ' + corpo.slice(0, 200));
                });
            }
            return true;
        });
    }

    /* ===================================================================
     * Visitas
     *
     * Mínimo possível: página, quando, e um id de sessão aleatório que vive
     * só enquanto a aba estiver aberta. Sem IP, sem cookie, sem nada que
     * identifique a pessoa — logo, sem aviso de cookies.
     * =================================================================== */
    function idDeSessao() {
        try {
            var id = sessionStorage.getItem('temprio.sessao');
            if (!id) {
                id = (Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
                sessionStorage.setItem('temprio.sessao', id);
            }
            return id;
        } catch (e) {
            return null; // aba anônima: conta a visita sem sessão
        }
    }

    function registrarVisita() {
        if (!cfg()) return;

        var pagina = location.pathname.split('/').pop() || 'index.html';
        inserir('visitas', { pagina: pagina, sessao: idDeSessao() })
            .catch(function () { /* medir visita nunca pode atrapalhar o site */ });
    }

    /* ===================================================================
     * Pedidos
     * =================================================================== */
    var CHAVE_FILA = 'temprio.pedidos.fila.v1';

    function lerFila() {
        try { return JSON.parse(localStorage.getItem(CHAVE_FILA)) || []; }
        catch (e) { return []; }
    }

    function gravarFila(fila) {
        try { localStorage.setItem(CHAVE_FILA, JSON.stringify(fila)); }
        catch (e) { /* sem storage: perde-se a rede de segurança, não o pedido */ }
    }

    /* O pedido é registrado, mas o que vale para o cliente é a mensagem do
     * WhatsApp. Por isso uma falha aqui NUNCA pode travar o envio: o pedido
     * fica na fila e sobe na próxima visita. */
    function registrarPedido(pedido) {
        if (!cfg()) return Promise.resolve(false);

        return inserir('pedidos', pedido)
            .then(function () { return true; })
            .catch(function () {
                gravarFila(lerFila().concat([pedido]));
                return false;
            });
    }

    function reenviarPedidosPendentes() {
        var fila = lerFila();
        if (!fila.length || !cfg()) return;

        var restantes = [];
        Promise.all(fila.map(function (p) {
            return inserir('pedidos', p).catch(function () { restantes.push(p); });
        })).then(function () { gravarFila(restantes); });
    }

    window.TempRioDB = {
        configurado: function () { return !!cfg(); },
        registrarPedido: registrarPedido,
        registrarVisita: registrarVisita,
        reenviarPedidosPendentes: reenviarPedidosPendentes
    };

    // A visita é contada assim que a página carrega.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            registrarVisita();
            reenviarPedidosPendentes();
        });
    } else {
        registrarVisita();
        reenviarPedidosPendentes();
    }
})();
