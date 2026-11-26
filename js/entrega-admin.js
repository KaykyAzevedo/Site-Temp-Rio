/* 063: Recebido sem foto, provisoriamente pelo escritorio. Banco valida permissao e audita. */
(function (raiz) {
    'use strict';
    var R = raiz.TempRioRotaCore || (typeof module !== 'undefined' ? require('../supabase/functions/_shared/rota-core.js') : null), dialogo;
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function data(s) { return new Date(s).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }); }
    // Capacidade de escrita é distinta de leitura063 instalada: C revoga as mutações legadas.
    function acoesHabilitadas() {
        var partes = raiz.TempRio068Partes;
        return !partes || (partes.Acoes063 !== false && partes.C !== true);
    }
    function html(p, o) {
        o = o || {};
        var c = R.confirmacaoEntrega(o.confirmacoes, p.cd_pedido), rotulo = R.recebidoRotulo(p, o), acao = '';
        if (acoesHabilitadas() && o.instalada && c && o.papel === 'admin') acao = 'desfazer';
        else if (acoesHabilitadas() && o.instalada && o.podeMarcar && ['enviado', 'pronto_despacho'].indexOf(R.etapaEntrega(p, o)) >= 0) acao = 'confirmar';
        return (rotulo ? '<span class="rota-sub">' + esc(rotulo) + '</span>' : '') + (acao ?
            '<button type="button" class="adm-botao-fantasma no-print" aria-label="' + esc((acao === 'confirmar' ? 'Marcar pedido #' : 'Desfazer marcação do pedido #') + p.cd_pedido + (acao === 'confirmar' ? ' como recebido' : '')) + '" data-entrega063-cd="' + esc(p.cd_pedido) + '" data-entrega063-acao="' + acao + '">' +
            (acao === 'confirmar' ? 'Recebido' : 'Desfazer marcação') + '</button>' : '');
    }
    function executar(sb, acao, cd, id, motivo, requisicao) {
        if (!acoesHabilitadas()) return Promise.reject(new Error('Recebimento manual indisponível neste painel.'));
        return sb.rpc(acao === 'desfazer' ? 'rota_063_desfazer_entrega' : 'rota_063_confirmar_entrega', acao === 'desfazer' ?
            { p_id: id } : { p_cd: cd, p_motivo: motivo || null, p_requisicao: requisicao }).then(function (r) {
            if (r.error) throw new Error(r.error.message || r.error.code);
            if (!r.data || !Number.isSafeInteger(r.data.id) || typeof r.data.ativa !== 'boolean') throw new Error('Resposta de recebimento inválida; atualize para conferir.');
            return r.data;
        });
    }
    function fechar() { if (dialogo) { dialogo.close(); dialogo.remove(); dialogo = null; } }
    function abrir(cd, acao, getOpts, opener) {
        if (!acoesHabilitadas()) return;
        var o = getOpts(), c = R.confirmacaoEntrega(o.confirmacoes, cd);
        if (!o.instalada || (acao === 'desfazer' ? o.papel !== 'admin' || !c : !o.podeMarcar)) return;
        fechar();
        var dlg = document.createElement('dialog');dialogo = dlg;
        dlg.style.cssText = 'width:calc(100% - 2rem);max-width:36rem;border:0;border-radius:1rem;padding:1.25rem;max-height:90vh;overflow:auto';
        dlg.setAttribute('aria-labelledby', 'entrega063-titulo');
        dlg.innerHTML = '<form><h2 id="entrega063-titulo" class="text-lg font-bold">' +
            (acao === 'desfazer' ? 'Desfazer marcação do pedido #' + esc(cd) + '?' : 'Marcar pedido #' + esc(cd) + ' como recebido?') + '</h2>' +
            (acao === 'confirmar' ? '<label class="block my-3">Motivo (opcional)<textarea class="adm-input block w-full" name="motivo" maxlength="300" rows="2"></textarea></label>' : '<p class="my-3">Se houver canhoto ativo, o pedido continuará recebido pela foto.</p>') +
            '<p role="alert" data-entrega063-erro></p><div class="flex gap-3 my-3"><button type="submit" class="adm-botao">' + (acao === 'confirmar' ? 'Recebido' : 'Desfazer marcação') +
            '</button><button type="button" class="adm-botao-fantasma" data-entrega063-cancelar>Cancelar</button></div></form>' +
            (o.papel === 'admin' ? '<details><summary>Auditoria deste pedido</summary><div data-entrega063-auditoria>Carregando…</div></details>' : '');
        var req = raiz.crypto.randomUUID(), ocupado = false;
        dlg.querySelector('[data-entrega063-cancelar]').onclick = fechar;
        dlg.addEventListener('close', function () { if (opener && opener.isConnected) opener.focus(); });
        dlg.querySelector('form').onsubmit = function (ev) {
            ev.preventDefault();if (ocupado) return;
            if (!acoesHabilitadas()) { fechar();return; }
            var atual = getOpts();
            if (atual.sessao !== o.sessao || atual.sb !== o.sb || (acao === 'desfazer' ? atual.papel !== 'admin' : !atual.podeMarcar)) { fechar();return; }
            ocupado = true;dlg.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
            var input = dlg.querySelector('[name=motivo]');
            executar(o.sb, acao, cd, c && c.id, input && input.value, req).then(function (r) {
                if (!dlg.isConnected || getOpts().sb !== o.sb) return;
                if (acao === 'confirmar' && !r.ativa) throw new Error('Esta marcação já foi desfeita; atualize o painel.');
                fechar();raiz.dispatchEvent(new raiz.CustomEvent('temprio-entrega063'));
            }).catch(function (err) { if (dlg.isConnected) dlg.querySelector('[data-entrega063-erro]').textContent = err.message || String(err); })
                .then(function () { ocupado = false;if (dlg.isConnected) dlg.querySelectorAll('button').forEach(function (b) { b.disabled = false; }); });
        };
        document.body.appendChild(dlg);dlg.showModal();
        if (o.papel === 'admin') o.sb.from('pedido_entrega_confirmacao').select('id,confirmado_em,confirmado_nome,motivo,desfeito_em,desfeito_nome')
            .eq('cd_pedido', cd).order('id', { ascending: false }).limit(20).then(function (r) {
                if (!dlg.isConnected) return;
                dlg.querySelector('[data-entrega063-auditoria]').innerHTML = r.error ? '<p>Não foi possível ler a auditoria.</p>' :
                    '<p>Últimos 20 registros</p>' + (r.data || []).map(function (x) { return '<p>' + esc(data(x.confirmado_em)) + ' · ' + esc(x.confirmado_nome || 'equipe') +
                        (x.motivo ? ' · ' + esc(x.motivo) : '') + (x.desfeito_em ? '<br>Desfeito em ' + esc(data(x.desfeito_em)) + ' por ' + esc(x.desfeito_nome || 'admin') : '') + '</p>'; }).join('');
            }, function () { if (dlg.isConnected) dlg.querySelector('[data-entrega063-auditoria]').textContent = 'Não foi possível ler a auditoria.'; });
    }
    function ligar(el, getOpts) {
        if (!acoesHabilitadas()) {
            fechar();
            el.querySelectorAll('[data-entrega063-cd]').forEach(function(b) { b.remove(); });
            return;
        }
        el.querySelectorAll('[data-entrega063-cd]').forEach(function (b) {
            b.onclick = function (e) { e.stopPropagation();abrir(Number(b.getAttribute('data-entrega063-cd')), b.getAttribute('data-entrega063-acao'), getOpts, b); };
            b.onkeydown = function (e) { e.stopPropagation(); };
        });
    }
    var api = { html: html, ligar: ligar, fechar: fechar, executar: executar };
    raiz.TempRioEntregaAdmin = api;if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
