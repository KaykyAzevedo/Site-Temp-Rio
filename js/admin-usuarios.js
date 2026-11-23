/* =====================================================================
 * USUÁRIOS (aba "Usuários", dentro de "Mais") — só admin.
 * Cria e gerencia logins sem abrir o Supabase: tudo passa pela Edge Function usuarios-admin (que confere o JWT e
 * eh_admin() e usa a chave de serviço só no servidor). Aqui não há chave nenhuma nem acesso direto ao Auth.
 * Senha: gerada no servidor e mostrada UMA vez (copiar / mensagem pronta para o WhatsApp); some ao fechar.
 * Histórico: usuarios_log (048, leitura só admin). Sem confirm()/alert(): confirmação no diálogo do próprio painel.
 * Sessão: cada operação guarda a "geração" (sb + usuário) em que nasceu; resposta que chega depois de sair/trocar de
 * conta é DESCARTADA antes de mexer em estado, DOM ou abrir senha.
 * ===================================================================== */
(function (raiz) {
    'use strict';
    var FUNCAO = 'usuarios-admin';
    var TIPO_ROT = { admin: 'Administrador', vendedor: 'Equipe (vendedor)', motorista: 'Motorista', sem_acesso: 'Sem acesso' };
    var FILTROS = [['todos', 'Todos'], ['admin', 'Administradores'], ['vendedor', 'Equipe'], ['motorista', 'Motoristas'], ['inativos', 'Desativados / sem acesso']];
    var st = { alvo: null, sb: null, papel: null, confirmar: null, eu: null, ativo: false, seq: 0,
               carregando: false, carregado: false, erro: null, usuarios: [], veiculos: [], motoristas047: true,
               filtro: 'todos', msg: null, ocupado: null, log: null, logAberto: false,
               dlg: null, resultado: null, foco: null, geracao: 0, senhaPendente: null, salvando: false };
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function quando(iso) {
        var d = iso ? new Date(iso) : null;
        return d && !isNaN(d.getTime()) ? d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : '—';
    }
    function nomeVeic(id) { var v = st.veiculos.filter(function (x) { return x.id === id; })[0]; return v ? v.nome : (id || ''); }

    // Chamada à função. Devolve { ok, dados } ou { ok:false, mensagem } (a mensagem vem da função, sem detalhe interno).
    function chamar(corpo, sb) {
        sb = sb || st.sb;
        if (!sb) return Promise.resolve({ ok: false, mensagem: 'Sessão encerrada.' });
        return sb.functions.invoke(FUNCAO, { body: corpo }).then(function (r) {
            if (!r.error) return { ok: true, dados: r.data || {} };
            var ctx = r.error && r.error.context;
            if (ctx && typeof ctx.json === 'function') {
                return ctx.json().then(function (j) { return { ok: false, mensagem: (j && j.mensagem) || 'Não foi possível concluir.', codigo: j && j.erro, campo: j && j.campo }; },
                    function () { return { ok: false, mensagem: 'Não foi possível falar com o servidor (função usuarios-admin publicada?).' }; });
            }
            return { ok: false, mensagem: /Failed to send|fetch/i.test(String(r.error.message || '')) ? 'Não foi possível falar com o servidor (função usuarios-admin publicada?).' : 'Não foi possível concluir.' };
        }, function () { return { ok: false, mensagem: 'Não foi possível falar com o servidor.' }; });
    }
    // A operação ainda pertence à sessão atual? (logout/troca de conta incrementa a geração)
    function vigente(g) { return g === st.geracao && !!st.sb; }
    function carregar() {
        if (!st.sb || st.carregando) return;
        var seq = ++st.seq, g = st.geracao, sb = st.sb;
        st.carregando = true; st.erro = null; desenhar();
        Promise.all([chamar({ acao: 'listar' }, sb),
                     sb.from('usuarios_log').select('criado_em,ator_email,acao,alvo_email,detalhe').order('criado_em', { ascending: false }).limit(20)])
            .then(function (rs) {
                if (seq !== st.seq || !st.ativo || !vigente(g)) return;
                st.carregando = false;
                var r = rs[0];
                if (!r.ok) { st.erro = r.mensagem; st.carregado = false; desenhar(); return; }
                st.usuarios = r.dados.usuarios || []; st.veiculos = r.dados.veiculos || []; st.motoristas047 = r.dados.motoristas !== false;
                var l = rs[1];
                st.log = l && !l.error ? (l.data || []) : null;   // 048 ausente: sem histórico (a função continua)
                st.carregado = true; desenhar();
            });
    }

    // ---------- desenho ----------
    function seloTipo(u) {
        var cls = u.tipo === 'admin' ? 'usu-tipo-admin' : u.tipo === 'motorista' ? 'usu-tipo-motorista' : u.tipo === 'vendedor' ? 'usu-tipo-vendedor' : 'usu-tipo-nenhum';
        return '<span class="usu-tipo ' + cls + '">' + esc(TIPO_ROT[u.tipo] || u.tipo) + '</span>';
    }
    function situacao(u) {
        if (u.sem_login) return '<span class="usu-sit usu-sit-atencao"><i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>Sem login</span>';
        if (u.banido) return '<span class="usu-sit usu-sit-ruim"><i class="fa-solid fa-ban" aria-hidden="true"></i>Desativado</span>';
        if (!u.ativo) return '<span class="usu-sit usu-sit-atencao"><i class="fa-solid fa-circle-minus" aria-hidden="true"></i>Sem acesso</span>';
        return '<span class="usu-sit usu-sit-ok"><i class="fa-solid fa-check" aria-hidden="true"></i>Ativo</span>';
    }
    function filtrados() {
        return st.usuarios.filter(function (u) {
            if (st.filtro === 'todos') return true;
            if (st.filtro === 'inativos') return !u.ativo;
            return u.ativo && u.tipo === st.filtro;
        });
    }
    function contagem(f) { var s = st.filtro; st.filtro = f; var n = filtrados().length; st.filtro = s; return n; }
    function acoes(u) {
        if (u.sem_login && u.variante) return '<span class="usu-sub">Linha em admins com maiúsculas/minúsculas diferentes do login: não dá acesso a ninguém. Corrija no banco.</span>';
        if (u.sem_login) return '<button type="button" class="adm-botao-fantasma" data-usu-novo-email="' + esc(u.email) + '"><i class="fa-solid fa-key" aria-hidden="true"></i> Criar login</button>';
        var eu = u.id === st.eu, ocup = !!st.ocupado, nome = u.nome || u.email, b = [];
        if (!u.banido) {
            b.push('<button type="button" class="adm-botao-fantasma" data-usu-senha="' + esc(u.id) + '"' + (ocup ? ' disabled' : '') + ' aria-label="' + esc('Redefinir senha de ' + nome) + '"><i class="fa-solid fa-key" aria-hidden="true"></i> Redefinir senha</button>');
            b.push('<button type="button" class="adm-botao-fantasma" data-usu-alterar="' + esc(u.id) + '"' + (ocup ? ' disabled' : '') + ' aria-label="' + esc('Alterar ' + nome) + '"><i class="fa-solid fa-pen" aria-hidden="true"></i> Alterar</button>');
            b.push('<button type="button" class="adm-botao-fantasma usu-btn-perigo" data-usu-desativar="' + esc(u.id) + '"' + (ocup || eu ? ' disabled' : '') +
                (eu ? ' title="Você não pode desativar o seu próprio acesso"' : '') + ' aria-label="' + esc('Desativar ' + nome) + '"><i class="fa-solid fa-ban" aria-hidden="true"></i> Desativar</button>');
        } else {
            b.push('<button type="button" class="adm-botao-fantasma" data-usu-reativar="' + esc(u.id) + '"' + (ocup ? ' disabled' : '') + ' aria-label="' + esc('Reativar ' + nome) + '"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Reativar</button>');
        }
        if (u.tipo === 'sem_acesso' && !u.banido) b.splice(1, 1, '<button type="button" class="adm-botao-fantasma" data-usu-alterar="' + esc(u.id) + '"' + (ocup ? ' disabled' : '') + ' aria-label="' + esc('Dar acesso a ' + nome) + '"><i class="fa-solid fa-user-check" aria-hidden="true"></i> Dar acesso</button>');
        return '<div class="usu-acoes">' + b.join('') + '</div>';
    }
    function htmlTabela() {
        var lista = filtrados();
        if (!lista.length) return '<p class="adm-vazio-linha"><span class="adm-vazio-titulo">' + (st.usuarios.length ? 'Ninguém neste filtro.' : 'Nenhum usuário ainda — use "Novo usuário".') + '</span></p>';
        return '<div class="overflow-x-auto"><table class="adm-tabela usu-tabela"><thead><tr><th>Usuário</th><th>Acesso</th><th>Situação</th><th>Último acesso</th><th><span class="sr-only">Ações</span></th></tr></thead><tbody>' +
            lista.map(function (u) {
                var extra = u.tipo === 'motorista' && u.veiculo_id ? 'Veículo: ' + esc(nomeVeic(u.veiculo_id)) : u.tipo === 'vendedor' && u.marca_rota ? 'Pode marcar rota' : '';
                if (u.banido && u.ultimo_tipo) extra = 'Era: ' + esc(TIPO_ROT[u.ultimo_tipo] || u.ultimo_tipo);
                return '<tr data-usu-id="' + esc(u.id || '') + '"><td><strong>' + esc(u.nome || '(sem nome)') + '</strong>' + (u.id === st.eu ? ' <span class="usu-voce">você</span>' : '') +
                    '<div class="usu-sub">' + esc(u.email) + '</div></td>' +
                    '<td data-rotulo="Acesso">' + seloTipo(u) + (extra ? '<div class="usu-sub">' + extra + '</div>' : '') + '</td>' +
                    '<td data-rotulo="Situação">' + situacao(u) + '</td>' +
                    '<td data-rotulo="Último acesso">' + esc(quando(u.ultimo_acesso)) + '<div class="usu-sub">criado ' + esc(quando(u.criado)) + '</div></td>' +
                    '<td>' + acoes(u) + '</td></tr>';
            }).join('') + '</tbody></table></div>';
    }
    function htmlLog() {
        if (!st.log) return '';
        var AC = { criar: 'criou', redefinir_senha: 'redefiniu a senha de', alterar: 'alterou', desativar: 'desativou', reativar: 'reativou' };
        return '<details class="adm-card p-4 mt-4 usu-log" id="usu-log"' + (st.logAberto ? ' open' : '') + '><summary class="usu-log-tit">Histórico (últimas 20 ações)</summary>' +
            (st.log.length ? '<ul class="usu-log-lista">' + st.log.map(function (l) {
                return '<li><span class="usu-sub">' + esc(quando(l.criado_em)) + '</span> ' + esc(l.ator_email || '—') + ' ' + esc(AC[l.acao] || l.acao) + ' <strong>' + esc(l.alvo_email || '—') + '</strong>' +
                    (l.detalhe ? ' <span class="usu-sub">(' + esc(l.detalhe) + ')</span>' : '') + '</li>';
            }).join('') + '</ul>' : '<p class="usu-sub mt-2">Nenhuma ação registrada ainda.</p>') + '</details>';
    }
    function htmlDialogos() {
        return '<dialog class="usu-dialogo" id="usu-dlg" aria-labelledby="usu-dlg-tit"><form class="usu-form" id="usu-form" novalidate></form></dialog>' +
               '<dialog class="usu-dialogo" id="usu-dlg-senha" aria-labelledby="usu-senha-tit"><div class="usu-form" id="usu-senha-corpo"></div></dialog>';
    }
    function desenhar() {
        var alvo = st.alvo;
        if (!alvo || !st.ativo) return;
        if (alvo.querySelector('dialog[open]')) { st.redesenhar = true; return; }   // não fecha diálogo aberto
        var cab = '<div class="usu-topo"><div><h2 class="usu-titulo"><i class="fa-solid fa-user-gear" aria-hidden="true"></i> Usuários</h2>' +
            '<p class="usu-sub">Logins do painel (administradores e equipe) e da tela do motorista. A senha é gerada aqui e aparece uma vez para você repassar.</p></div>';
        if (st.papel !== 'admin') { alvo.innerHTML = cab + '</div><p class="adm-vazio-linha"><span class="adm-vazio-titulo">Só o administrador gerencia usuários.</span></p>'; return; }
        var botoes = '<div class="usu-botoes"><button type="button" class="adm-botao" id="usu-novo"' + (st.carregado ? '' : ' disabled') + '><i class="fa-solid fa-user-plus" aria-hidden="true"></i> Novo usuário</button>' +
            '<button type="button" class="adm-botao-fantasma" id="usu-atualizar"' + (st.carregando ? ' disabled aria-busy="true"' : '') + '><i class="fa-solid fa-rotate" aria-hidden="true"></i> Atualizar</button></div></div>';
        var corpo;
        if (st.carregando && !st.carregado) corpo = '<p class="adm-vazio-linha" role="status"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><span class="adm-vazio-texto">Carregando usuários…</span></p>';
        else if (st.erro && !st.carregado) corpo = '<div class="adm-card p-6 usu-erro" role="alert"><p class="mb-3">' + esc(st.erro) + '</p><button type="button" class="adm-botao-fantasma" id="usu-tentar">Tentar de novo</button></div>';
        else {
            corpo = '<div class="usu-filtros" role="group" aria-label="Filtrar por tipo">' + FILTROS.map(function (f) {
                    return '<button type="button" class="adm-chip' + (st.filtro === f[0] ? ' is-ativo' : '') + '" data-usu-filtro="' + f[0] + '" aria-pressed="' + (st.filtro === f[0]) + '">' + esc(f[1]) + ' (' + contagem(f[0]) + ')</button>';
                }).join('') + '</div>' +
                (st.msg ? '<p class="usu-msg' + (st.msg.erro ? ' usu-msg-erro' : '') + '" role="status">' + esc(st.msg.texto) + '</p>' : '') +
                (st.erro ? '<p class="usu-msg usu-msg-erro" role="alert">' + esc(st.erro) + '</p>' : '') +
                (!st.motoristas047 ? '<p class="usu-sub mb-2">Motoristas indisponíveis: falta a migração 047 (frota).</p>' : '') +
                '<section class="adm-card p-4">' + htmlTabela() + '</section>' + htmlLog();
        }
        alvo.innerHTML = cab + botoes + corpo + htmlDialogos();
        ligar(alvo);
    }

    // ---------- diálogo Novo / Alterar ----------
    function htmlForm(u, emailInicial) {
        var novo = !u, reativar = !!(u && u.banido), tipo = u ? (u.tipo === 'sem_acesso' ? (u.ultimo_tipo || 'vendedor') : u.tipo) : 'vendedor';
        var vAtivos = st.veiculos.filter(function (v) { return v.ativo; });
        // veículo antigo fora da frota ativa (ou nenhum): o admin escolhe de novo — nada é pré-selecionado às cegas
        var temVeic = u && vAtivos.some(function (v) { return v.id === u.veiculo_id; });
        var opV = (u && !temVeic ? '<option value="">Escolher…</option>' : '') +
            vAtivos.map(function (v) { return '<option value="' + esc(v.id) + '"' + (u && u.veiculo_id === v.id ? ' selected' : '') + '>' + esc(v.nome) + '</option>'; }).join('');
        var tipos = [['admin', 'Administrador (acesso total)'], ['vendedor', 'Equipe (vendedor)'], ['motorista', 'Motorista (só a rota do veículo)']];
        if (!st.motoristas047) tipos = tipos.slice(0, 2);
        return '<h3 class="usu-dlg-tit" id="usu-dlg-tit">' + (novo ? 'Novo usuário' : (reativar ? 'Reativar ' : 'Alterar ') + esc(u.nome || u.email)) + '</h3>' +
            (reativar ? '<p class="usu-sub">Confirme o tipo de acesso' + (tipo === 'motorista' ? ' e o veículo' : '') + ' que ele volta a ter. O login é liberado e o acesso volta junto.</p>' : '') +
            (novo ? '<label class="usu-campo"><span>E-mail</span><input type="email" id="usu-email" name="email" class="adm-input" autocomplete="off" spellcheck="false" inputmode="email" maxlength="254" required value="' + esc(emailInicial || '') + '"></label>'
                  : '<p class="usu-sub">' + esc(u.email) + '</p>') +
            '<label class="usu-campo"><span>Nome</span><input type="text" id="usu-nome" name="nome" class="adm-input" autocomplete="off" maxlength="60" required value="' + esc(u ? u.nome || '' : '') + '"></label>' +
            '<fieldset class="usu-tipos"><legend>Tipo de acesso</legend>' + tipos.map(function (t) {
                return '<label class="usu-radio"><input type="radio" name="usu-tipo" value="' + t[0] + '"' + (tipo === t[0] ? ' checked' : '') + (u && u.id === st.eu && t[0] !== 'admin' ? ' disabled' : '') + '> ' + esc(t[1]) + '</label>';
            }).join('') + (u && u.id === st.eu ? '<small class="usu-sub">Você não pode tirar o seu próprio acesso de administrador.</small>' : '') + '</fieldset>' +
            '<label class="usu-campo" id="usu-campo-veic"' + (tipo === 'motorista' ? '' : ' hidden') + '><span>Veículo</span>' +
                (vAtivos.length ? '<select id="usu-veic" class="adm-input">' + opV + '</select>' : '<span class="usu-msg-erro">Nenhum veículo ativo na frota (Rotas → Frota).</span>') + '</label>' +
            '<label class="usu-check" id="usu-campo-marca"' + (tipo === 'vendedor' ? '' : ' hidden') + '><input type="checkbox" id="usu-marca"' + (u && u.marca_rota ? ' checked' : '') + '> Pode marcar a rota (CEASA/S10/Strada) e editar regras de entrega</label>' +
            '<p class="usu-msg usu-msg-erro" id="usu-dlg-msg" role="alert"></p>' +
            '<div class="usu-dlg-acoes"><button type="button" class="adm-botao-fantasma" id="usu-cancelar">Cancelar</button>' +
            '<button type="submit" class="adm-botao" id="usu-salvar">' + (novo ? 'Criar e gerar senha' : reativar ? 'Reativar' : 'Salvar') + '</button></div>';
    }
    function abrirForm(u, emailInicial, origem) {
        var dlg = document.getElementById('usu-dlg'); if (!dlg) return;
        var f = dlg.querySelector('#usu-form');
        f.innerHTML = htmlForm(u, emailInicial);
        f._alvo = u ? u.id : null; f._origem = origem || null;
        dlg.showModal();
        (dlg.querySelector('#usu-email') || dlg.querySelector('#usu-nome')).focus();
    }
    function abrirSenha(u, senha, novo) {
        var dlg = st.alvo && st.alvo.querySelector('#usu-dlg-senha');
        if (!dlg || !st.ativo || st.alvo.querySelector('dialog[open]')) { st.senhaPendente = { u: u, senha: senha, novo: novo }; return; }
        st.senhaPendente = null;
        var motorista = u && u.tipo === 'motorista';
        var link = new URL(motorista ? 'motorista.html' : 'admin.html', location.href).href;
        var msgWa = (motorista ? 'Seu acesso à rota do motorista da Temp Rio:' : 'Seu acesso ao painel da Temp Rio:') + '\n' + link + '\nE-mail: ' + (u ? u.email : '') + '\nSenha: ' + senha +
            '\nGuarde a senha; se esquecer, peça uma nova ao escritório.';
        dlg.querySelector('#usu-senha-corpo').innerHTML =
            '<h3 class="usu-dlg-tit" id="usu-senha-tit">' + (novo ? 'Usuário criado' : 'Senha nova gerada') + '</h3>' +
            '<p class="usu-sub">' + esc((u && (u.nome || u.email)) || '') + ' · ' + esc(u ? u.email : '') + '</p>' +
            '<p class="usu-aviso"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> A senha aparece só agora. Copie e repasse; ao fechar ela some da tela.</p>' +
            '<div class="usu-senha"><code id="usu-senha-txt" translate="no">' + esc(senha) + '</code>' +
                '<button type="button" class="adm-botao-fantasma" id="usu-copiar-senha"><i class="fa-regular fa-copy" aria-hidden="true"></i> Copiar senha</button></div>' +
            '<label class="usu-campo"><span>Mensagem pronta para o WhatsApp</span><textarea id="usu-msg-wa" class="adm-input" rows="5" readonly>' + esc(msgWa) + '</textarea></label>' +
            '<p class="usu-msg" id="usu-copiado" role="status" aria-live="polite"></p>' +
            '<div class="usu-dlg-acoes"><button type="button" class="adm-botao-fantasma" id="usu-copiar-msg"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i> Copiar mensagem</button>' +
            '<button type="button" class="adm-botao" id="usu-senha-fechar">Pronto</button></div>';
        dlg.showModal();
        dlg.querySelector('#usu-copiar-senha').focus();
    }
    function copiar(texto, el, ok) {
        function aviso(t) { var p = document.getElementById('usu-copiado'); if (p) p.textContent = t; }
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(texto).then(function () { aviso(ok); }, function () { if (el && el.select) el.select(); aviso('Selecione e copie (Ctrl+C).'); });
        else { if (el && el.select) el.select(); aviso('Selecione e copie (Ctrl+C).'); }
    }

    // ---------- ações ----------
    function acao(corpo, rot, focoDepois) {
        var g = st.geracao, sb = st.sb;
        st.ocupado = corpo.acao; st.msg = { texto: rot + '…' }; desenhar();
        return chamar(corpo, sb).then(function (r) {
            if (!vigente(g)) return null;   // saiu/trocou de conta: descarta (nem estado, nem DOM, nem senha)
            st.ocupado = null;
            if (!r.ok) { st.msg = { texto: r.mensagem, erro: true }; st.foco = focoDepois; desenhar(); return r; }
            var u = r.dados.usuario;
            if (u) {
                var i = st.usuarios.findIndex(function (x) { return x.id === u.id || (!x.id && x.email === u.email); });
                if (i >= 0) st.usuarios[i] = u; else st.usuarios.push(u);
            }
            st.msg = { texto: rot + ': feito.' + (r.dados.aviso ? ' ' + r.dados.aviso : '') }; st.foco = focoDepois;
            desenhar(); recarregarLog();
            if (r.dados.senha) abrirSenha(u, r.dados.senha, corpo.acao === 'criar');
            return r;
        });
    }
    function recarregarLog() {
        if (!st.sb) return;
        var g = st.geracao;
        st.sb.from('usuarios_log').select('criado_em,ator_email,acao,alvo_email,detalhe').order('criado_em', { ascending: false }).limit(20).then(function (l) {
            if (!st.ativo || !vigente(g)) return;
            st.log = l && !l.error ? (l.data || []) : null;
            if (!(st.alvo && st.alvo.querySelector('dialog[open]'))) { var d = st.alvo && st.alvo.querySelector('#usu-log'); if (d) { var fresco = document.createElement('div'); fresco.innerHTML = htmlLog(); if (fresco.firstChild) d.replaceWith(fresco.firstChild); ligarLog(); } }
        });
    }
    function ligarLog() { var d = st.alvo && st.alvo.querySelector('#usu-log'); if (d) d.addEventListener('toggle', function () { st.logAberto = d.open; }); }
    function porId(id) { return st.usuarios.filter(function (u) { return u.id === id; })[0] || null; }
    function ligar(alvo) {
        var n = alvo.querySelector('#usu-novo'); if (n) n.addEventListener('click', function () { abrirForm(null, '', '#usu-novo'); });
        var a = alvo.querySelector('#usu-atualizar'); if (a) a.addEventListener('click', function () { st.msg = null; carregar(); });
        var t = alvo.querySelector('#usu-tentar'); if (t) t.addEventListener('click', carregar);
        ligarLog();
        alvo.querySelectorAll('[data-usu-filtro]').forEach(function (b) { b.addEventListener('click', function () { st.filtro = b.getAttribute('data-usu-filtro'); st.foco = '[data-usu-filtro="' + st.filtro + '"]'; desenhar(); }); });
        alvo.querySelectorAll('[data-usu-novo-email]').forEach(function (b) { b.addEventListener('click', function () { abrirForm(null, b.getAttribute('data-usu-novo-email'), '#usu-novo'); }); });
        alvo.querySelectorAll('[data-usu-alterar]').forEach(function (b) { b.addEventListener('click', function () { var u = porId(b.getAttribute('data-usu-alterar')); if (u) abrirForm(u, '', '[data-usu-alterar="' + u.id + '"]'); }); });
        alvo.querySelectorAll('[data-usu-senha]').forEach(function (b) {
            b.addEventListener('click', function () {
                var u = porId(b.getAttribute('data-usu-senha')); if (!u) return;
                st.confirmar('Gerar uma senha nova para ' + (u.nome || u.email) + '? A senha atual deixa de funcionar na hora.', 'Gerar senha nova', true, b).then(function (ok) {
                    if (ok) acao({ acao: 'redefinir_senha', id: u.id }, 'Redefinindo a senha', '[data-usu-senha="' + u.id + '"]');
                });
            });
        });
        alvo.querySelectorAll('[data-usu-desativar]').forEach(function (b) {
            b.addEventListener('click', function () {
                var u = porId(b.getAttribute('data-usu-desativar')); if (!u) return;
                st.confirmar('Desativar ' + (u.nome || u.email) + '? O login é bloqueado e o acesso (' + (TIPO_ROT[u.tipo] || u.tipo) + ') é retirado. O histórico fica; dá para reativar depois.', 'Desativar', true, b).then(function (ok) {
                    if (ok) acao({ acao: 'desativar', id: u.id }, 'Desativando', '[data-usu-reativar="' + u.id + '"]');
                });
            });
        });
        alvo.querySelectorAll('[data-usu-reativar]').forEach(function (b) {
            b.addEventListener('click', function () {
                var u = porId(b.getAttribute('data-usu-reativar')); if (!u) return;
                // sempre pelo formulário: tipo e (motorista) veículo ATIVO confirmados — o veículo antigo pode ter saído da frota
                abrirForm(Object.assign({}, u, { tipo: 'sem_acesso' }), '', '[data-usu-reativar="' + u.id + '"]');
            });
        });
        // diálogos
        var dlg = alvo.querySelector('#usu-dlg'), form = alvo.querySelector('#usu-form');
        if (form) {
            form.addEventListener('change', function (ev) {
                if (ev.target && ev.target.name === 'usu-tipo') {
                    form.querySelector('#usu-campo-veic').hidden = ev.target.value !== 'motorista';
                    form.querySelector('#usu-campo-marca').hidden = ev.target.value !== 'vendedor';
                }
            });
            form.addEventListener('click', function (ev) { if (ev.target && ev.target.closest && ev.target.closest('#usu-cancelar') && !st.salvando) dlg.close(); });
            // enquanto salva, não fecha (Esc): a resposta (e a senha) não se perde com o formulário
            dlg.addEventListener('cancel', function (ev) { if (st.salvando) ev.preventDefault(); });
            form.addEventListener('submit', function (ev) {
                ev.preventDefault();
                var msg = form.querySelector('#usu-dlg-msg'), id = form._alvo, origem = form._origem;
                form.querySelectorAll('[aria-invalid]').forEach(function (e) { e.removeAttribute('aria-invalid'); });
                function erro(t, sel) { msg.textContent = t; var e = sel && form.querySelector(sel); if (e) { e.setAttribute('aria-invalid', 'true'); e.focus(); } }
                var tipoEl = form.querySelector('input[name="usu-tipo"]:checked');
                var corpo = { acao: id ? 'alterar' : 'criar', nome: String(form.querySelector('#usu-nome').value || '').replace(/\s+/g, ' ').trim(), tipo: tipoEl ? tipoEl.value : '' };
                if (!id) {
                    corpo.email = String(form.querySelector('#usu-email').value || '').trim().toLowerCase();
                    if (!/^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(corpo.email)) return erro('Informe um e-mail válido.', '#usu-email');
                } else corpo.id = id;
                // Alterar/Reativar: nome que o admin não mexeu não viaja (um nome antigo fora da regra não trava a ação)
                var nomeOrig = id && porId(id) ? String(porId(id).nome || '').replace(/\s+/g, ' ').trim() : null;
                if (id && corpo.nome === nomeOrig) delete corpo.nome;
                else if (!corpo.nome || corpo.nome.length > 60 || /[<>]/.test(corpo.nome)) return erro('Nome: 1 a 60 caracteres, sem < >.', '#usu-nome');
                if (!corpo.tipo) return erro('Escolha o tipo de acesso.', 'input[name="usu-tipo"]');
                if (corpo.tipo === 'motorista') {
                    var v = form.querySelector('#usu-veic');
                    if (!v || !v.value) return erro('Escolha o veículo do motorista.', '#usu-veic');
                    corpo.veiculo_id = v.value;
                }
                if (corpo.tipo === 'vendedor') corpo.marca_rota = !!form.querySelector('#usu-marca').checked;
                var alvoU = id ? porId(id) : null, rotBt = bt0();
                if (alvoU && alvoU.banido) corpo.acao = 'reativar';
                function bt0() { var b = form.querySelector('#usu-salvar'); return b ? b.textContent : ''; }
                var g = st.geracao, sb = st.sb;
                var bt = form.querySelector('#usu-salvar'), btC = form.querySelector('#usu-cancelar');
                bt.disabled = true; if (btC) btC.disabled = true; st.salvando = true;
                bt.textContent = corpo.acao === 'criar' ? 'Criando…' : corpo.acao === 'reativar' ? 'Reativando…' : 'Salvando…'; msg.textContent = '';
                chamar(corpo, sb).then(function (r) {
                    if (!vigente(g)) return;   // saiu/trocou de conta no meio: descarta
                    st.salvando = false; bt.disabled = false; if (btC) btC.disabled = false; bt.textContent = rotBt;
                    if (!r.ok) { erro(r.mensagem, r.campo === 'email' ? '#usu-email' : r.campo === 'nome' ? '#usu-nome' : r.campo === 'veiculo_id' ? '#usu-veic' : null); return; }
                    var u = r.dados.usuario;
                    if (u) { var i = st.usuarios.findIndex(function (x) { return x.id === u.id || (!x.id && x.email === u.email); }); if (i >= 0) st.usuarios[i] = u; else st.usuarios.push(u); }
                    st.msg = { texto: (corpo.acao === 'criar' ? 'Usuário ' + (u ? u.email : '') + ' criado.' : corpo.acao === 'reativar' ? 'Usuário reativado.' : 'Usuário salvo.') + (r.dados.aviso ? ' ' + r.dados.aviso : '') };
                    st.foco = u ? (corpo.acao === 'criar' ? '[data-usu-senha="' + u.id + '"]' : corpo.acao === 'reativar' ? '[data-usu-desativar="' + u.id + '"]' : '[data-usu-alterar="' + u.id + '"]') : origem;
                    // fecha o formulário; o "close" redesenha a lista e, se houver senha, abre o diálogo da senha
                    st.redesenhar = true;
                    if (r.dados.senha) st.senhaPendente = { u: u, senha: r.dados.senha, novo: corpo.acao === 'criar' };
                    dlg.close();
                    recarregarLog();
                });
            });
            dlg.addEventListener('close', function () {
                if (!st.foco && form._origem) st.foco = form._origem;   // cancelou: volta para o botão que abriu
                form.innerHTML = '';
                if (st.redesenhar) { st.redesenhar = false; desenhar(); }
                if (st.senhaPendente) { var sp = st.senhaPendente; st.senhaPendente = null; abrirSenha(sp.u, sp.senha, sp.novo); return; }
                focar();
            });
        }
        var dSenha = alvo.querySelector('#usu-dlg-senha');
        if (dSenha) {
            dSenha.addEventListener('click', function (ev) {
                var b = ev.target && ev.target.closest ? ev.target.closest('button') : null; if (!b) return;
                if (b.id === 'usu-copiar-senha') copiar(dSenha.querySelector('#usu-senha-txt').textContent, null, 'Senha copiada.');
                if (b.id === 'usu-copiar-msg') copiar(dSenha.querySelector('#usu-msg-wa').value, dSenha.querySelector('#usu-msg-wa'), 'Mensagem copiada: cole no WhatsApp.');
                if (b.id === 'usu-senha-fechar') dSenha.close();
            });
            // ao fechar, a senha some do DOM (não fica guardada em lugar nenhum)
            dSenha.addEventListener('close', function () { dSenha.querySelector('#usu-senha-corpo').innerHTML = ''; if (st.redesenhar) { st.redesenhar = false; desenhar(); } focar(); });
        }
        // senha que chegou com a aba fora da tela (mesma sessão): mostra agora
        if (st.senhaPendente && !alvo.querySelector('dialog[open]')) { var sp = st.senhaPendente; abrirSenha(sp.u, sp.senha, sp.novo); return; }
        if (!alvo.querySelector('dialog[open]')) focar();
    }
    // Foco depois de uma ação: só quando nenhum diálogo está aberto (atrás de um modal o foco não pega) — senão fica guardado.
    function focar() {
        if (!st.foco || !st.alvo || st.senhaPendente || st.alvo.querySelector('dialog[open]')) return;
        var el = st.alvo.querySelector(st.foco);
        if (!el || el.disabled) { el = st.alvo.querySelector('.usu-titulo'); if (el) el.setAttribute('tabindex', '-1'); }
        if (el) { el.focus(); if (document.activeElement === el) st.foco = null; }
    }

    // Zera tudo o que é da sessão (lista, log, mensagens, senha pendente) e invalida respostas em voo.
    function novaSessao() {
        st.geracao++; st.seq++;
        st.carregando = false; st.carregado = false; st.usuarios = []; st.veiculos = []; st.log = null; st.msg = null; st.erro = null;
        st.ocupado = null; st.senhaPendente = null; st.salvando = false; st.redesenhar = false; st.foco = null; st.filtro = 'todos';
    }

    raiz.TempRioUsuarios = {
        desenhar: function (alvo, ctx) {
            var sb = ctx && ctx.sb, eu = ctx && ctx.usuarioId;
            if (sb !== st.sb || eu !== st.eu) novaSessao();   // outra conta/cliente: nada da anterior sobrevive
            st.alvo = alvo; st.sb = sb; st.papel = ctx && ctx.papel; st.confirmar = ctx && ctx.confirmar; st.eu = eu; st.ativo = true;
            if (st.papel === 'admin' && !st.carregado && !st.carregando) carregar(); else desenhar();
        },
        recarregar: function () { if (st.ativo && st.papel === 'admin') carregar(); },
        encerrar: function () { st.ativo = false; st.seq++; st.carregando = false; },
        // Logout: esquece a lista e qualquer senha (os diálogos são recriados no próximo desenho).
        sair: function () {
            novaSessao();
            if (st.alvo) { st.alvo.querySelectorAll('dialog[open]').forEach(function (d) { try { d.close(); } catch (e) { /* já fechado */ } }); st.alvo.innerHTML = ''; }
            st.alvo = null; st.sb = null; st.papel = null; st.eu = null; st.ativo = false;
        },
        // Para a Frota (Rotas): lista de usuários (só admin), sem desenhar nada e sem tocar no estado desta aba.
        // Promise -> lista, ou null se indisponível. Quem chama descarta a resposta se a sessão mudou.
        listarParaFrota: function (sb) {
            return chamar({ acao: 'listar' }, sb).then(function (r) { return r.ok ? (r.dados.usuarios || []) : null; });
        }
    };
})(typeof window !== 'undefined' ? window : this);
