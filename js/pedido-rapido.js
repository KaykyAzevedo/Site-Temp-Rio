/* Catálogo — modo "Pedido rápido" para o vendedor no celular.
 *
 * Lista compacta, sem foto: um sabor por linha com o contador de CAIXAS de 24
 * (− n +) direto na linha. 1 toque no "+" = +1 caixa; tocar no número abre o
 * teclado para digitar a quantidade de caixas. Barra fixa embaixo com potes /
 * mínimo, quanto falta em caixas, valor e o botão de revisar.
 *
 * Usa as MESMAS regras do carrinho (js/cart.js): R$ 4/pote, múltiplos de 24
 * com composição gulosa em caixas de 48/24, mínimo, limites de sanidade e o
 * esgotado do ERP (SolidconPublico). Nenhuma chamada de rede aqui: funciona
 * com o que a página já carregou. O catálogo com fotos continua igual; o modo
 * escolhido fica lembrado neste aparelho. */
(function () {
    'use strict';

    if (!window.Cart || typeof produtos === 'undefined') return;

    var CHAVE_MODO = 'temprio.catalogo.modo';
    var PASSO = Cart.PASSO;
    var MAX_CAIXAS = Math.floor(24000 / PASSO);
    var TOP_VENDIDOS = 20;

    var raiz, lista, chips, vazio, barra, barraResumo, barraValor, barraProgresso, blocoRepetir, botaoRepetir;
    var filtro = 'todos';
    var termo = '';
    var confirmarTrocaAte = 0;
    var pendenteRedesenho = false;

    function esc(t) {
        return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function normalizar(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
    function toast(msg) { if (window.CartUI && CartUI.toast) CartUI.toast(msg); }
    function esgotado(id) { return !!(window.SolidconPublico && SolidconPublico.esgotado(id)); }
    function posicao(id) { return window.SolidconPublico ? SolidconPublico.posicao(id) : null; }
    function caixasDe(id) { return Math.round(Cart.potes(id) / PASSO); }

    function lerModo() {
        var q = /[?&]modo=(rapido|catalogo)\b/.exec(window.location.search);
        if (q) return q[1];
        try { return window.localStorage.getItem(CHAVE_MODO) === 'rapido' ? 'rapido' : 'catalogo'; }
        catch (e) { return 'catalogo'; }
    }
    function gravarModo(m) { try { window.localStorage.setItem(CHAVE_MODO, m); } catch (e) { /* lembra só nesta visita */ } }

    function ordenados() {
        return window.SolidconPublico ? SolidconPublico.ordenar(produtos) : produtos.slice();
    }

    function visiveis() {
        var t = normalizar(termo.trim());
        return ordenados().filter(function (p) {
            if (t && normalizar(p.nome).indexOf(t) === -1) return false;
            if (filtro === 'pedido') return Cart.potes(p.id) > 0;
            if (filtro === 'vendidos') { var pos = posicao(p.id); return !!pos && pos <= TOP_VENDIDOS; }
            return true;
        });
    }

    /* ---------- linhas ---------- */
    function linhaHTML(p) {
        var esg = esgotado(p.id);
        var cx = caixasDe(p.id);
        var nome = esc(p.nome);
        var sub = esg
            ? '<a href="' + esc(SolidconPublico.esperaURL(p.id)) + '" class="pr-sub pr-sub-esgotado" data-lista-espera>Esgotado · avisar quando chegar</a>'
            : '<span class="pr-sub">caixa com ' + PASSO + '</span>';
        return '' +
            '<li class="pr-linha' + (esg ? ' is-esgotado' : '') + (cx > 0 ? ' is-no-pedido' : '') + '" data-id="' + esc(p.id) + '">' +
                '<div class="pr-info">' +
                    '<span class="pr-nome" id="pr-nome-' + esc(p.id) + '">' + nome + '</span>' + sub +
                '</div>' +
                '<div class="pr-controle" role="group" aria-labelledby="pr-nome-' + esc(p.id) + '">' +
                    '<button type="button" class="pr-botao" data-pr="menos"' + (cx === 0 ? ' disabled' : '') +
                        ' aria-label="Tirar uma caixa de ' + nome + '"><i class="fa-solid fa-minus" aria-hidden="true"></i></button>' +
                    '<input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" class="pr-numero" data-pr="numero"' +
                        ' value="' + cx + '"' + (esg && cx === 0 ? ' disabled' : '') +
                        ' aria-label="Caixas de ' + PASSO + ' de ' + nome + '">' +
                    '<button type="button" class="pr-botao" data-pr="mais"' + (esg ? ' disabled' : '') +
                        ' aria-label="Mais uma caixa de ' + nome + '"><i class="fa-solid fa-plus" aria-hidden="true"></i></button>' +
                '</div>' +
            '</li>';
    }

    function editando() {
        var a = document.activeElement;
        return !!(a && lista && lista.contains(a) && a.getAttribute('data-pr') === 'numero');
    }

    function desenharLista() {
        if (!lista) return;
        // Não redesenha com alguém digitando: perderia o foco e o número digitado.
        if (editando()) { pendenteRedesenho = true; return; }
        pendenteRedesenho = false;
        var itens = visiveis();
        lista.innerHTML = itens.map(linhaHTML).join('');
        vazio.hidden = itens.length > 0;
        vazio.textContent = filtro === 'pedido' && !termo ? 'Nenhum sabor no pedido ainda.' : 'Nenhum sabor encontrado.';
        desenharChips();
    }

    // Depois de mexer no carrinho: só atualiza números e estados, sem refazer a lista.
    function atualizarLinhas() {
        if (!lista) return;
        if (filtro === 'pedido') {
            // Sabor zerado sai do filtro "No pedido" — mas não enquanto se digita.
            var ids = visiveis().map(function (p) { return p.id; }).join('|');
            var atuais = Array.prototype.map.call(lista.querySelectorAll('.pr-linha'), function (li) { return li.getAttribute('data-id'); }).join('|');
            if (ids !== atuais) { desenharLista(); return; }
        }
        Array.prototype.forEach.call(lista.querySelectorAll('.pr-linha'), function (li) {
            var id = li.getAttribute('data-id');
            var cx = caixasDe(id);
            var esg = esgotado(id);
            var campo = li.querySelector('[data-pr="numero"]');
            if (campo && document.activeElement !== campo) campo.value = String(cx);
            if (campo) campo.disabled = esg && cx === 0;
            li.querySelector('[data-pr="menos"]').disabled = cx === 0;
            li.querySelector('[data-pr="mais"]').disabled = esg;
            li.classList.toggle('is-no-pedido', cx > 0);
        });
        desenharChips();
    }

    function desenharChips() {
        if (!chips) return;
        var noPedido = Cart.itens().length;
        var temRanking = produtos.some(function (p) { return !!posicao(p.id); });
        Array.prototype.forEach.call(chips.querySelectorAll('[data-filtro]'), function (b) {
            var f = b.getAttribute('data-filtro');
            b.setAttribute('aria-pressed', f === filtro ? 'true' : 'false');
            if (f === 'pedido') b.textContent = 'No pedido (' + noPedido + ')';
            if (f === 'vendidos') b.hidden = !temRanking;
        });
        if (filtro === 'vendidos' && !temRanking) { filtro = 'todos'; desenharLista(); }
    }

    /* ---------- quantidade ---------- */
    function definirCaixas(id, caixas) {
        var p = produtos.filter(function (x) { return x.id === id; })[0];
        if (!p) return;
        var atual = caixasDe(id);
        caixas = Math.max(0, Math.min(MAX_CAIXAS, Math.trunc(caixas)));
        if (caixas === atual) { atualizarLinhas(); return; }
        if (esgotado(id) && caixas > atual) {
            toast(p.nome + ' está esgotado. Use a lista de espera.');
            atualizarLinhas(); return;
        }
        var ok;
        if (caixas === 0) ok = Cart.remover(id);
        else if (atual === 0) ok = Cart.adicionar(id, p.nome, caixas * PASSO);
        else ok = Cart.definirPotes(id, caixas * PASSO);
        if (!ok && atual === 0 && caixas > 0) toast('O pedido já tem o máximo de sabores diferentes.');
        atualizarLinhas();
    }

    function aoClicar(e) {
        var b = e.target.closest('button[data-pr]');
        if (!b || b.disabled) return;
        var id = b.closest('.pr-linha').getAttribute('data-id');
        var cx = caixasDe(id);
        definirCaixas(id, b.getAttribute('data-pr') === 'mais' ? cx + 1 : cx - 1);
    }

    function confirmarNumero(campo) {
        var id = campo.closest('.pr-linha').getAttribute('data-id');
        // So inteiro nao negativo, inteiro (espacos nas pontas ok). "1.5", "-1", "2x" etc.
        // NAO viram numero por remocao de caracteres: mantem a quantidade anterior.
        var bruto = campo.value.trim();
        if (/^\d{1,4}$/.test(bruto)) definirCaixas(id, Number(bruto));
        else if (bruto !== '') toast('Digite só o número de caixas (ex.: 10).');
        campo.value = String(caixasDe(id));
    }

    /* ---------- barra fixa ---------- */
    function desenharBarra() {
        if (!barra) return;
        var t = Cart.totais();
        var faltamCaixas = Math.ceil(t.faltamPotes / PASSO);
        barraResumo.textContent = t.atingiuMinimo
            ? t.potes + ' potes · mínimo atingido'
            : t.potes + ' de ' + t.minimoPotes + ' potes · faltam ' + faltamCaixas + (faltamCaixas === 1 ? ' caixa' : ' caixas') + ' para o mínimo';
        barraValor.textContent = Cart.formatarBRL(t.valorCentavos);
        barraProgresso.style.width = Math.round(t.progresso * 100) + '%';
        barraProgresso.classList.toggle('is-completo', t.atingiuMinimo);
        barraProgresso.parentNode.setAttribute('aria-valuemax', String(t.minimoPotes));
        barraProgresso.parentNode.setAttribute('aria-valuenow', String(Math.min(t.potes, t.minimoPotes)));
    }

    /* ---------- repetir último pedido ---------- */
    function dataCurta(ms) {
        try { return new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); }
        catch (e) { return ''; }
    }

    function desenharRepetir() {
        if (!blocoRepetir) return;
        var u = window.PedidoMemoria ? PedidoMemoria.ultimoPedido() : null;
        blocoRepetir.hidden = !u;
        if (!u) return;
        var caixas = u.itens.reduce(function (s, i) { return s + i.potes; }, 0) / PASSO;
        var aguardando = Date.now() < confirmarTrocaAte;
        botaoRepetir.textContent = aguardando
            ? 'Toque de novo para trocar o pedido atual'
            : 'Repetir último pedido · ' + u.itens.length + (u.itens.length === 1 ? ' sabor' : ' sabores') +
              ' · ' + caixas + ' cx' + (u.em ? ' · ' + dataCurta(u.em) : '');
    }

    function repetir() {
        var u = window.PedidoMemoria ? PedidoMemoria.ultimoPedido() : null;
        if (!u) return;
        // Com algo no carrinho, pede um 2º toque: trocar o pedido atual não pode ser acidente.
        if (!Cart.vazio() && Date.now() >= confirmarTrocaAte) {
            confirmarTrocaAte = Date.now() + 6000;
            desenharRepetir();
            setTimeout(function () { confirmarTrocaAte = 0; desenharRepetir(); }, 6100);
            return;
        }
        confirmarTrocaAte = 0;
        var r = PedidoMemoria.carregarNoCarrinho(u.itens);
        var msg = r.carregados + (r.carregados === 1 ? ' sabor carregado.' : ' sabores carregados.');
        if (r.pulados.length) msg += ' Ficaram de fora (esgotado ou fora do catálogo): ' + r.pulados.join(', ') + '.';
        toast(msg);
        filtro = 'pedido';
        desenharLista();
        desenharRepetir();
    }

    /* ---------- modo ---------- */
    function aplicarModo(m) {
        var rapido = m === 'rapido';
        document.body.classList.toggle('modo-rapido', rapido);
        raiz.hidden = !rapido;
        barra.hidden = !rapido;
        Array.prototype.forEach.call(document.querySelectorAll('[data-modo]'), function (b) {
            b.setAttribute('aria-pressed', b.getAttribute('data-modo') === m ? 'true' : 'false');
        });
        if (rapido) { desenharLista(); desenharBarra(); desenharRepetir(); }
    }

    function iniciar() {
        raiz = document.getElementById('pedido-rapido');
        barra = document.getElementById('pr-barra');
        if (!raiz || !barra) return;
        lista = document.getElementById('pr-lista');
        chips = document.getElementById('pr-chips');
        vazio = document.getElementById('pr-vazio');
        barraResumo = document.getElementById('pr-barra-resumo');
        barraValor = document.getElementById('pr-barra-valor');
        barraProgresso = document.getElementById('pr-barra-progresso');
        blocoRepetir = document.getElementById('pr-repetir');
        botaoRepetir = document.getElementById('pr-repetir-botao');

        Array.prototype.forEach.call(document.querySelectorAll('[data-modo]'), function (b) {
            b.addEventListener('click', function () {
                var m = b.getAttribute('data-modo');
                gravarModo(m);
                aplicarModo(m);
            });
        });
        chips.addEventListener('click', function (e) {
            var b = e.target.closest('[data-filtro]');
            if (!b) return;
            filtro = b.getAttribute('data-filtro');
            desenharLista();
        });
        lista.addEventListener('click', aoClicar);
        lista.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && e.target.getAttribute('data-pr') === 'numero') { e.preventDefault(); e.target.blur(); }
        });
        // Commit ao sair do campo (Enter também sai). Selecionar tudo ao entrar facilita digitar por cima.
        lista.addEventListener('focusin', function (e) { if (e.target.getAttribute('data-pr') === 'numero') e.target.select(); });
        lista.addEventListener('focusout', function (e) {
            if (e.target.getAttribute('data-pr') !== 'numero') return;
            confirmarNumero(e.target);
            if (pendenteRedesenho) setTimeout(desenharLista, 0);
        });
        botaoRepetir.addEventListener('click', repetir);

        var busca = document.getElementById('searchInput');
        if (busca) busca.addEventListener('input', function () { termo = busca.value; if (!raiz.hidden) desenharLista(); });

        document.addEventListener('cart:change', function () {
            if (raiz.hidden) return;
            atualizarLinhas(); desenharBarra(); desenharRepetir();
        });
        // Esgotado/ranking chegam do ERP depois: redesenha (a ordem e os bloqueios mudam).
        document.addEventListener('solidcon:publico', function () { if (!raiz.hidden) desenharLista(); });

        aplicarModo(lerModo());
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
    else iniciar();
})();
