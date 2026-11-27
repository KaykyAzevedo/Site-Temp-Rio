/* 063: Recebido sem foto, provisoriamente pelo escritorio. Banco valida permissao e audita. */
(function (raiz) {
    'use strict';
    var R = raiz.TempRioRotaCore || (typeof module !== 'undefined' ? require('../supabase/functions/_shared/rota-core.js') : null), dialogo, dialogoTipo = '';
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function data(s) { return new Date(s).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }); }
    // Capacidade de escrita é distinta de leitura063 instalada: C revoga as mutações legadas.
    function acoesHabilitadas() {
        var partes = raiz.TempRio068Partes;
        return !partes || (partes.Acoes063 !== false && partes.C !== true);
    }
    // 068 C: "Problema na entrega" so existe com Problema ou C ligada e a leitura dos problemas carregada (o.problemas).
    function problemaHabilitado(o) {
        var partes = raiz.TempRio068Partes;
        return !!o && !!o.problemas && (!partes || partes.Problema === true || partes.C === true);
    }
    function problemaHtml(p, o) {
        if (!problemaHabilitado(o)) return '';
        var pr = o.problemas[p.cd_pedido], cd = esc(p.cd_pedido);
        if (pr) {
            var quem = (pr.por_nome || 'equipe') + (pr.em ? ' · ' + data(pr.em) : '');
            return '<div class="adm-entrega-problema" role="group" aria-label="Problema na entrega do pedido #' + cd + '"><strong><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Problema na entrega</strong>' +
                '<p class="adm-entrega-problema-obs">' + esc(pr.obs) + '</p><span class="rota-sub">' + esc(quem) + '</span>' +
                (o.papel === 'admin' ? '<button type="button" class="adm-botao-fantasma no-print" aria-label="Desfazer problema do pedido #' + cd + '" data-entrega068-cd="' + cd + '" data-entrega068-acao="desfazer">Desfazer</button>' : '') + '</div>';
        }
        if (o.podeMarcar && ['enviado', 'recebido'].indexOf(R.etapaEntrega(p, o)) >= 0)
            return '<button type="button" class="adm-botao-fantasma no-print" aria-label="Registrar problema na entrega do pedido #' + cd + '" data-entrega068-cd="' + cd + '" data-entrega068-acao="marcar">Problema na entrega</button>';
        return '';
    }
    var MOTIVOS = { observacao_invalida: 'Observação inválida: use 1 a 300 caracteres, sem < > nem caracteres de controle.', pedido_sem_saida: 'Este pedido ainda não saiu em rota.', parametro_invalido: 'Pedido inválido.', requisicao_invalida: 'Requisição inválida; tente de novo.' };
    function chamarProblema(sb, fn, args) {
        return sb.rpc(fn, args).then(function (r) {
            if (r.error) throw new Error(r.error.message || r.error.code);
            if (!r.data || (r.data.status !== 'ok' && r.data.status !== 'erro')) throw new Error('Resposta inválida; atualize para conferir.');
            if (r.data.status === 'erro') throw new Error(MOTIVOS[r.data.motivo] || 'Não foi possível concluir (' + r.data.motivo + ').');
            return r.data;
        });
    }
    function problemaObs(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
    function marcarProblema(sb, cd, obs, req) { return chamarProblema(sb, 'rota_068_problema_marcar', { p_cd_pedido: cd, p_obs: obs, p_requisicao: req }); }
    function desfazerProblema(sb, cd, req) { return chamarProblema(sb, 'rota_068_problema_desfazer', { p_cd_pedido: cd, p_requisicao: req }); }
    // Leitura por blocos de 200; tabela ausente = recurso desligado, outro erro = aviso sem derrubar a tela.
    function lerProblemas(sb, pedidos) {
        var ids = Array.from(new Set((pedidos || []).map(function (p) { return p.cd_pedido; }))), mapa = {}, cadeia = Promise.resolve({ instalada: true, erro: null });
        for (var i = 0; i < ids.length; i += 200) (function (bloco) {
            cadeia = cadeia.then(function (st) {
                if (!st.instalada) return st;
                return sb.from('pedido_entrega_problema').select('cd_pedido,obs,por_nome,em').in('cd_pedido', bloco).is('desfeito_em', null).then(function (r) {
                    if (r.error) {
                        if (['42P01', 'PGRST205', 'PGRST200'].indexOf(String(r.error.code)) >= 0) return { instalada: false, erro: null };
                        return { instalada: true, erro: r.error.message || String(r.error.code) };
                    }
                    (r.data || []).forEach(function (x) { if (x && bloco.indexOf(x.cd_pedido) >= 0) mapa[x.cd_pedido] = x; });
                    return st;
                });
            });
        })(ids.slice(i, i + 200));
        return cadeia.then(function (st) { return { instalada: st.instalada, erro: st.erro, porPedido: st.instalada ? mapa : {} }; });
    }
    function abrirProblema(cd, acao, getOpts, opener) {
        var o = getOpts();
        if (!problemaHabilitado(o) || (acao === 'desfazer' ? o.papel !== 'admin' : !o.podeMarcar)) return;
        fechar();
        var dlg = document.createElement('dialog');dialogo = dlg;dialogoTipo = '068';
        dlg.style.cssText = 'width:calc(100% - 2rem);max-width:36rem;border:0;border-radius:1rem;padding:1.25rem;max-height:90vh;overflow:auto';
        dlg.setAttribute('aria-labelledby', 'entrega068-titulo');
        var marcar = acao === 'marcar';
        dlg.innerHTML = '<form><h2 id="entrega068-titulo" class="text-lg font-bold">' + (marcar ? 'Problema na entrega do pedido #' + esc(cd) : 'Desfazer problema do pedido #' + esc(cd) + '?') + '</h2>' +
            (marcar ? '<label class="block my-3">O que aconteceu? (obrigatório)<textarea class="adm-input block w-full" name="obs" maxlength="300" rows="3" required></textarea></label><p class="rota-sub"><span data-entrega068-cont>0</span>/300</p>' :
                '<p class="my-3">O pedido volta a ser tratado como enviado, sem o aviso de problema.</p>') +
            '<p role="alert" class="adm-entrega-erro" data-entrega068-erro></p><div class="flex gap-3 my-3"><button type="submit" class="adm-botao">' + (marcar ? 'Registrar problema' : 'Desfazer problema') +
            '</button><button type="button" class="adm-botao-fantasma" data-entrega068-cancelar>Cancelar</button></div></form>';
        var req = raiz.crypto.randomUUID(), ocupado = false, ta = dlg.querySelector('[name=obs]');
        dlg.querySelector('[data-entrega068-cancelar]').onclick = fechar;
        dlg.addEventListener('close', function () { if (opener && opener.isConnected) opener.focus(); });
        if (ta) ta.oninput = function () { dlg.querySelector('[data-entrega068-cont]').textContent = String(ta.value.length); };
        dlg.querySelector('form').onsubmit = function (ev) {
            ev.preventDefault();if (ocupado) return;
            var atual = getOpts(), erroEl = dlg.querySelector('[data-entrega068-erro]'), obs = ta ? problemaObs(ta.value) : '';
            if (atual.sessao !== o.sessao || atual.sb !== o.sb || (acao === 'desfazer' ? atual.papel !== 'admin' : !atual.podeMarcar)) { fechar();return; }
            if (marcar && (!obs || obs.length > 300 || /[<>\u0000-\u001f\u007f]/.test(obs))) { erroEl.textContent = MOTIVOS.observacao_invalida;return; }
            erroEl.textContent = '';ocupado = true;dlg.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
            var botao = dlg.querySelector('[type=submit]'), rot = botao.textContent;botao.textContent = 'Salvando…';
            (marcar ? marcarProblema(o.sb, cd, obs, req) : desfazerProblema(o.sb, cd, req)).then(function () {
                if (!dlg.isConnected || getOpts().sb !== o.sb) return;
                fechar();raiz.dispatchEvent(new raiz.CustomEvent('temprio-entrega063'));
            }).catch(function (err) { if (dlg.isConnected) erroEl.textContent = err.message || String(err); })
                .then(function () { ocupado = false;if (dlg.isConnected) { botao.textContent = rot;dlg.querySelectorAll('button').forEach(function (b) { b.disabled = false; }); } });
        };
        document.body.appendChild(dlg);dlg.showModal();if (ta) ta.focus();
    }
    function html(p, o) {
        o = o || {};
        var c = R.confirmacaoEntrega(o.confirmacoes, p.cd_pedido), rotulo = R.recebidoRotulo(p, o), acao = '';
        if (acoesHabilitadas() && o.instalada && c && o.papel === 'admin') acao = 'desfazer';
        else if (acoesHabilitadas() && o.instalada && o.podeMarcar && ['enviado', 'pronto_despacho'].indexOf(R.etapaEntrega(p, o)) >= 0) acao = 'confirmar';
        return problemaHtml(p, o) + (rotulo ? '<span class="rota-sub">' + esc(rotulo) + '</span>' : '') + (acao ?
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
    function fechar() { if (dialogo) { dialogo.close(); dialogo.remove(); dialogo = null; dialogoTipo = ''; } }
    function abrir(cd, acao, getOpts, opener) {
        if (!acoesHabilitadas()) return;
        var o = getOpts(), c = R.confirmacaoEntrega(o.confirmacoes, cd);
        if (!o.instalada || (acao === 'desfazer' ? o.papel !== 'admin' || !c : !o.podeMarcar)) return;
        fechar();
        var dlg = document.createElement('dialog');dialogo = dlg;dialogoTipo = '063';
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
        el.querySelectorAll('[data-entrega068-cd]').forEach(function (b) {
            b.onclick = function (e) { e.stopPropagation();abrirProblema(Number(b.getAttribute('data-entrega068-cd')), b.getAttribute('data-entrega068-acao'), getOpts, b); };
            b.onkeydown = function (e) { e.stopPropagation(); };
        });
        if (!acoesHabilitadas()) {
            if (dialogoTipo !== '068') fechar();
            el.querySelectorAll('[data-entrega063-cd]').forEach(function(b) { b.remove(); });
            return;
        }
        el.querySelectorAll('[data-entrega063-cd]').forEach(function (b) {
            b.onclick = function (e) { e.stopPropagation();abrir(Number(b.getAttribute('data-entrega063-cd')), b.getAttribute('data-entrega063-acao'), getOpts, b); };
            b.onkeydown = function (e) { e.stopPropagation(); };
        });
    }
    var api = { html: html, problemaHtml: problemaHtml, ligar: ligar, fechar: fechar, executar: executar, lerProblemas: lerProblemas, marcarProblema: marcarProblema, desfazerProblema: desfazerProblema };
    raiz.TempRioEntregaAdmin = api;if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
