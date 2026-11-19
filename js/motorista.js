/* =====================================================================
 * TELA DO MOTORISTA (motorista.html) — só leitura.
 * Login do Supabase (e-mail/senha). O motorista NÃO é da equipe do painel: as políticas da 047 só deixam ele ler
 * a rota publicada (rota_saida) do veículo dele, de hoje e amanhã (data de São Paulo), e o nome/cor do próprio veículo.
 * Nada aqui grava. Texto vindo do banco sempre vai por textContent/esc().
 * "Abrir no mapa": Google Maps/Waze pela coordenada (ou, sem pino, pelo endereço) — só quando o motorista toca.
 * ===================================================================== */
(function () {
    'use strict';
    var cfg = (typeof siteConfig !== 'undefined' && siteConfig.supabase) || {};
    var TZ = 'America/Sao_Paulo';
    var DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
    var NUM = new Intl.NumberFormat('pt-BR'), NUM1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
    // geracao: sobe a cada saída/troca de sessão; toda resposta assíncrona confere a geração antes de mexer em estado ou tela
    // (Sentinela V-UI ALTO: resposta atrasada não pode reexibir a rota depois do logout nem de outra conta).
    var sb = null, st = { rotas: [], veiculo: null, dia: null, carregando: false, ultimaCarga: null, geracao: 0, usuario: null };
    function $(q) { return document.querySelector(q); }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function hojeSP() {
        var p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
        return p.slice(0, 10);
    }
    function diaTxt(d) {
        var dt = new Date(d + 'T12:00:00Z');
        return DIAS[dt.getUTCDay()] + ', ' + d.slice(8, 10) + '/' + d.slice(5, 7);
    }
    function horaCurta(iso) { var d = iso ? new Date(iso) : null; return d && !isNaN(d.getTime()) ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ }) : ''; }
    function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
    function txtCaixas(o) {
        var p = [];
        if (num(o.c24)) p.push('<strong>' + NUM.format(num(o.c24)) + '</strong> cx24');
        if (num(o.c48)) p.push('<strong>' + NUM.format(num(o.c48)) + '</strong> cx48');
        if (num(o.avulsos)) p.push('<strong>' + NUM.format(num(o.avulsos)) + '</strong> potes avulsos');
        return p.join(' + ') || 'caixas a conferir';
    }

    // ---------- estados ----------
    function mostrar(qual) {
        $('#mot-estado').hidden = qual !== 'estado';
        $('#mot-login').hidden = qual !== 'login';
        $('#mot-rota').hidden = qual !== 'rota';
        $('#mot-sair').hidden = qual === 'login' || !sb;
    }
    function estado(titulo, texto, acoes) {
        var el = $('#mot-estado');
        el.innerHTML = '<p class="mot-estado-tit">' + esc(titulo) + '</p>' + (texto ? '<p class="mot-sub">' + esc(texto) + '</p>' : '') + (acoes || '');
        mostrar('estado');
        var b = el.querySelector('[data-mot-tentar]'); if (b) b.addEventListener('click', carregar);
        var s = el.querySelector('[data-mot-sair]'); if (s) s.addEventListener('click', sair);
    }
    function rede() { $('#mot-rede').hidden = navigator.onLine !== false; }
    // Esquece TUDO da sessão anterior: estado, leituras em andamento (geração) e o HTML da rota (nada fica oculto no DOM).
    function limpar() {
        st.geracao++; st.rotas = []; st.veiculo = null; st.dia = null; st.carregando = false; st.ultimaCarga = null;
        $('#mot-rota').innerHTML = ''; $('#mot-estado').innerHTML = '';
    }

    // ---------- login ----------
    function telaLogin(msg) {
        mostrar('login');
        $('#mot-login-msg').textContent = msg || '';
        $('#mot-email').focus();
    }
    function entrar(ev) {
        ev.preventDefault();
        var email = String($('#mot-email').value || '').trim(), senha = $('#mot-senha').value || '';
        var msg = $('#mot-login-msg');
        if (!email || !senha) { msg.textContent = 'Preencha e-mail e senha.'; (email ? $('#mot-senha') : $('#mot-email')).focus(); return; }
        if (navigator.onLine === false) { msg.textContent = 'Sem internet. Conecte e tente de novo.'; return; }
        var b = $('#mot-entrar'); b.disabled = true; b.textContent = 'Entrando…'; msg.textContent = '';
        sb.auth.signInWithPassword({ email: email, password: senha }).then(function (r) {
            b.disabled = false; b.textContent = 'Entrar';
            if (r.error) { msg.textContent = /invalid/i.test(String(r.error.message || '')) ? 'E-mail ou senha não conferem.' : 'Não foi possível entrar: ' + String(r.error.message || r.error); $('#mot-senha').focus(); return; }
            $('#mot-senha').value = '';
            var uid = r.data && r.data.session && r.data.session.user ? r.data.session.user.id : null;
            if (uid !== st.usuario) limpar();
            st.usuario = uid;
            carregar();
        }, function (e) { b.disabled = false; b.textContent = 'Entrar'; msg.textContent = 'Não foi possível entrar: ' + String((e && e.message) || e); });
    }
    function sair() {
        if (!sb) return;
        limpar();                                   // some com a rota da tela na hora, antes da resposta
        estado('Saindo…', '');
        var g = st.geracao;
        function falhou(m) {
            if (g !== st.geracao) return;
            // a sessão pode continuar valendo: os dados já foram escondidos; não finge que saiu
            estado('Não foi possível sair', 'Os dados da rota foram escondidos. Confira a internet e toque em Sair de novo. (' + m + ')',
                '<div class="mot-acoes"><button type="button" class="mot-botao" data-mot-sair>Sair</button><button type="button" class="mot-botao-leve" data-mot-tentar>Mostrar a rota de novo</button></div>');
        }
        sb.auth.signOut().then(function (r) {
            if (r && r.error) { falhou(String(r.error.message || r.error)); return; }
            st.usuario = null; limpar(); telaLogin('');
        }, function (e) { falhou(String((e && e.message) || e)); });
    }

    // ---------- leitura ----------
    function carregar() {
        if (!sb || st.carregando) return;
        var g = st.geracao;
        st.carregando = true;
        if (!st.rotas.length) estado('Carregando sua rota…', '');
        sb.rpc('rota_047_veiculo_motorista').then(function (r) {
            if (g !== st.geracao) return null;          // saiu/trocou de conta no meio: descarta
            if (r.error) throw r.error;
            if (!r.data) {
                st.carregando = false;
                estado('Seu login ainda não está ligado a um veículo', 'Peça ao escritório para vincular seu usuário a um veículo na Frota do painel. Depois toque em Tentar de novo.',
                    '<div class="mot-acoes"><button type="button" class="mot-botao" data-mot-tentar>Tentar de novo</button><button type="button" class="mot-botao-leve" data-mot-sair>Sair</button></div>');
                return null;
            }
            var vid = r.data;
            return Promise.all([
                sb.from('rota_saida').select('data,veiculo_id,versao,paradas,resumo,publicado_em').eq('veiculo_id', vid).order('data', { ascending: true }),
                sb.from('rota_veiculos').select('id,nome,cor').eq('id', vid)
            ]).then(function (rs) {
                if (g !== st.geracao) return;            // resposta de uma sessão que já acabou: não desenha
                if (rs[0].error) throw rs[0].error;
                var v = rs[1] && !rs[1].error && rs[1].data && rs[1].data[0];
                st.veiculo = { id: vid, nome: v ? v.nome : vid, cor: v && /^#[0-9a-f]{6}$/i.test(v.cor || '') ? v.cor : null };
                var hoje = hojeSP();
                st.rotas = (rs[0].data || []).filter(function (x) { return x && x.veiculo_id === vid && String(x.data) >= hoje; });
                st.ultimaCarga = new Date();
                if (!st.dia || !st.rotas.some(function (x) { return x.data === st.dia; })) st.dia = st.rotas.length ? st.rotas[0].data : null;
                st.carregando = false;
                desenhar();
            });
        }).catch(function (e) {
            if (g !== st.geracao) return;
            st.carregando = false;
            var cod = String((e && e.code) || ''), m = String((e && e.message) || e || '');
            if (/PGRST202|42883/.test(cod)) { estado('A tela do motorista ainda não está ligada', 'O escritório precisa terminar a instalação (migração 047).', '<div class="mot-acoes"><button type="button" class="mot-botao-leve" data-mot-sair>Sair</button></div>'); return; }
            if (/JWT|401|PGRST301/i.test(cod + ' ' + m)) { st.usuario = null; limpar(); telaLogin('Sua sessão expirou. Entre de novo.'); return; }
            if (st.rotas.length) { desenhar(); rede(); return; }   // mantém a última rota na tela
            estado(navigator.onLine === false ? 'Sem internet' : 'Não foi possível carregar a rota',
                navigator.onLine === false ? 'Conecte o celular à internet e toque em Tentar de novo.' : 'Tente de novo em instantes. Se continuar, avise o escritório. (' + m + ')',
                '<div class="mot-acoes"><button type="button" class="mot-botao" data-mot-tentar>Tentar de novo</button></div>');
        });
    }

    // ---------- desenho ----------
    function linksMapa(p) {
        var temPos = p.lat != null && p.lng != null && isFinite(Number(p.lat)) && isFinite(Number(p.lng));
        var end = [p.endereco, p.bairro, p.cidade].filter(Boolean).join(', ');
        if (!temPos && !end) return '';
        var g = temPos ? 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(Number(p.lat) + ',' + Number(p.lng))
                       : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(end);
        var w = temPos ? 'https://waze.com/ul?ll=' + encodeURIComponent(Number(p.lat) + ',' + Number(p.lng)) + '&navigate=yes'
                       : 'https://waze.com/ul?q=' + encodeURIComponent(end) + '&navigate=yes';
        var rot = esc(p.nome || 'parada ' + p.ordem);
        return '<div class="mot-acoes">' +
            '<a class="mot-botao" href="' + esc(g) + '" target="_blank" rel="noopener noreferrer" aria-label="Abrir no Google Maps: ' + rot + '">Abrir no mapa</a>' +
            '<a class="mot-botao-leve" href="' + esc(w) + '" target="_blank" rel="noopener noreferrer" aria-label="Abrir no Waze: ' + rot + '">Waze</a></div>' +
            (temPos ? '' : '<p class="mot-ped">Sem pino no mapa: a busca usa o endereço.</p>');
    }
    function htmlParada(p) {
        var avisos = [];
        if (p.prioridade) avisos.push('<li class="is-atencao">Entregar primeiro</li>');
        if (p.janela) avisos.push('<li class="is-atencao">Recebe ' + esc(p.janela) + '</li>');
        var end = [p.endereco, [p.bairro, p.cidade].filter(Boolean).join(' · ')].filter(Boolean);
        // CD do CEASA: os pedidos vêm em cada item (por cliente). Formato antigo: pedidos só na raiz (linha "Pedidos" abaixo).
        var itensComPedidos = Array.isArray(p.itens) && p.itens.some(function (it) { return Array.isArray(it.pedidos) && it.pedidos.length; });
        var itens = Array.isArray(p.itens) && p.itens.length
            ? '<ul class="mot-itens" aria-label="Carga por cliente">' + p.itens.map(function (it) {
                var peds = Array.isArray(it.pedidos) && it.pedidos.length ? '<small class="mot-ped">' + it.pedidos.map(function (n) { return '#' + esc(n); }).join(', ') + '</small>' : '';
                return '<li><span class="mot-item-cli"><span>' + esc(it.nome || 'Cliente') + '</span>' + peds + '</span><span>' +
                    [num(it.c24) ? NUM.format(num(it.c24)) + ' cx24' : '', num(it.c48) ? NUM.format(num(it.c48)) + ' cx48' : '', num(it.avulsos) ? NUM.format(num(it.avulsos)) + ' potes' : ''].filter(Boolean).join(' + ') + '</span></li>';
              }).join('') + '</ul>'
            : '';
        return '<li class="mot-parada' + (p.cd ? ' is-cd' : '') + '">' +
            '<span class="mot-num" aria-hidden="true">' + esc(p.ordem) + '</span>' +
            '<p class="mot-hora">' + (p.eta ? 'Chegada prevista ~' + esc(p.eta) : '&nbsp;') + '</p>' +
            '<h2 class="mot-nome"><span class="sr-only">Parada ' + esc(p.ordem) + ': </span>' + esc(p.nome || 'Cliente') + '</h2>' +
            (end.length ? '<p class="mot-end">' + end.map(esc).join('<br>') + '</p>' : '') +
            '<p class="mot-cx">' + txtCaixas(p) + '</p>' +
            (avisos.length ? '<ul class="mot-avisos">' + avisos.join('') + '</ul>' : '') +
            (p.obs ? '<p class="mot-obs">' + esc(p.obs) + '</p>' : '') +
            itens +
            (!itensComPedidos && Array.isArray(p.pedidos) && p.pedidos.length ? '<p class="mot-ped">Pedido' + (p.pedidos.length > 1 ? 's' : '') + ' ' + p.pedidos.map(function (n) { return '#' + esc(n); }).join(', ') + '</p>' : '') +
            linksMapa(p) + '</li>';
    }
    function desenhar() {
        var alvo = $('#mot-rota'), v = st.veiculo || { nome: '' };
        var hoje = hojeSP();
        var veicHtml = '<p class="mot-veic"' + (v.cor ? ' style="--veic-cor:' + esc(v.cor) + '"' : '') + '><i aria-hidden="true"></i>' + esc(v.nome) + '</p>';
        if (!st.rotas.length) {
            alvo.innerHTML = '<div class="mot-cab">' + veicHtml + '<h1 class="mot-tit" id="mot-rota-tit">Nenhuma rota publicada para hoje</h1>' +
                '<p class="mot-sub">Quando o escritório enviar a rota, ela aparece aqui. Toque em Atualizar para conferir.</p></div>' +
                '<div class="mot-acoes"><button type="button" class="mot-botao" id="mot-atualizar">Atualizar</button></div>';
            mostrar('rota'); ligar(); return;
        }
        var r = st.rotas.filter(function (x) { return x.data === st.dia; })[0] || st.rotas[0];
        var paradas = (Array.isArray(r.paradas) ? r.paradas.slice() : []).sort(function (a, b) { return num(a.ordem) - num(b.ordem); });
        var res = r.resumo && typeof r.resumo === 'object' ? r.resumo : {};
        var tot = paradas.reduce(function (t, p) { t.c24 += num(p.c24); t.c48 += num(p.c48); t.avulsos += num(p.avulsos); return t; }, { c24: 0, c48: 0, avulsos: 0 });
        var abas = st.rotas.length > 1
            ? '<div class="mot-dias" role="group" aria-label="Dia da rota">' + st.rotas.map(function (x) {
                var rot = x.data === hoje ? 'Hoje' : 'Amanhã';
                return '<button type="button" data-mot-dia="' + esc(x.data) + '" aria-pressed="' + (x.data === r.data) + '">' + esc(rot) + ' · ' + esc(x.data.slice(8, 10) + '/' + x.data.slice(5, 7)) + '</button>';
              }).join('') + '</div>'
            : '';
        var resumo = '<div class="mot-resumo">' +
            '<div><strong>' + NUM.format(paradas.length) + '</strong><span>parada' + (paradas.length === 1 ? '' : 's') + '</span></div>' +
            '<div><strong>' + NUM.format(tot.c24) + '</strong><span>cx24</span></div>' +
            (tot.c48 ? '<div><strong>' + NUM.format(tot.c48) + '</strong><span>cx48</span></div>' : '') +
            (tot.avulsos ? '<div><strong>' + NUM.format(tot.avulsos) + '</strong><span>potes avulsos</span></div>' : '') +
            (num(res.km) ? '<div><strong>~' + NUM1.format(num(res.km)) + '</strong><span>km</span></div>' : '') +
            (res.horaSaida ? '<div><strong>' + esc(res.horaSaida) + '</strong><span>saída</span></div>' : '') + '</div>';
        alvo.innerHTML = '<div class="mot-cab">' + veicHtml +
            '<h1 class="mot-tit" id="mot-rota-tit">' + esc(r.data === hoje ? 'Rota de hoje' : 'Rota de amanhã') + '</h1>' +
            '<p class="mot-sub">' + esc(diaTxt(r.data)) + '</p>' +
            '<p class="mot-pub">Versão ' + esc(r.versao) + ', enviada às ' + esc(horaCurta(r.publicado_em)) + '. Se o escritório mudar a rota, toque em Atualizar.</p></div>' +
            abas + resumo +
            '<ol class="mot-paradas">' + paradas.map(htmlParada).join('') + '</ol>' +
            '<div class="mot-rodape"><button type="button" class="mot-botao-leve" id="mot-atualizar">Atualizar</button>' +
            '<span>' + (st.ultimaCarga ? 'Carregado às ' + esc(st.ultimaCarga.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ })) : '') + '</span></div>';
        mostrar('rota'); ligar();
    }
    function ligar() {
        var a = $('#mot-atualizar'); if (a) a.addEventListener('click', function () { a.disabled = true; a.textContent = 'Atualizando…'; carregar(); });
        document.querySelectorAll('[data-mot-dia]').forEach(function (b) {
            b.addEventListener('click', function () { st.dia = b.getAttribute('data-mot-dia'); desenhar(); var n = document.querySelector('[data-mot-dia="' + st.dia + '"]'); if (n) n.focus(); });
        });
    }

    // ---------- início ----------
    function iniciar() {
        rede();
        window.addEventListener('online', function () { rede(); carregar(); });
        window.addEventListener('offline', rede);
        $('#mot-login').addEventListener('submit', entrar);
        $('#mot-sair').addEventListener('click', sair);
        if (!cfg.url || !cfg.anonKey || typeof window.supabase === 'undefined') {
            estado('Não foi possível abrir a tela', navigator.onLine === false ? 'Sem internet: conecte e recarregue a página.' : 'A biblioteca de login não carregou. Recarregue a página.');
            return;
        }
        sb = window.supabase.createClient(cfg.url, cfg.anonKey);
        // Sessão encerrada (em outra aba, expirou) ou trocada por outra conta: esquece a rota anterior.
        sb.auth.onAuthStateChange(function (ev, sessao) {
            var uid = sessao && sessao.user ? sessao.user.id : null;
            if (ev === 'SIGNED_OUT' || !uid) { if (st.usuario || st.rotas.length) { st.usuario = null; limpar(); telaLogin(''); } return; }
            if (st.usuario && uid !== st.usuario) { limpar(); st.usuario = uid; carregar(); }
        });
        sb.auth.getSession().then(function (r) {
            if (r && r.data && r.data.session) { st.usuario = r.data.session.user ? r.data.session.user.id : null; carregar(); } else telaLogin('');
        }, function () { telaLogin(''); });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
