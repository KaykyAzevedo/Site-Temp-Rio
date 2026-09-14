/* Carrinho — interface compartilhada: botão flutuante, gaveta e toast.
 *
 * O cliente escolhe POTES, em múltiplos de 24. As caixas são montadas pelo
 * js/cart.js e aqui só são exibidas ("1 caixa de 48 + 1 de 24").
 *
 * Só lê o estado por window.Cart e escuta o evento 'cart:change'. Nunca
 * calcula total nem mexe no localStorage por conta própria.
 *
 * Carregado no fim do <body>, antes de js/content-loader.js.
 */
(function () {
    'use strict';

    if (typeof window.Cart === 'undefined') {
        console.warn('[carrinho] js/cart.js precisa ser carregado antes de cart-ui.js.');
        return;
    }

    // Nomes podem vir do localStorage, que o usuário consegue editar. Escapar
    // é barato e evita que uma aspa quebre a marcação.
    function esc(texto) {
        return String(texto == null ? '' : texto)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    var PASSO = Cart.PASSO;

    var fab = null;
    var backdrop = null;
    var gaveta = null;
    var toastEl = null;
    var toastTimer = null;
    var focoAnterior = null;

    var BTN_CIRCULO = 'text-textSecondary hover:text-white transition-colors w-8 h-8 ' +
        'flex-shrink-0 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10';

    /* ===================================================================
     * Marcação da gaveta
     * =================================================================== */
    function montar() {
        var html =
            '<button type="button" class="cart-float" id="cart-fab" aria-label="Abrir seu pedido">' +
                '<i class="fa-solid fa-basket-shopping"></i>' +
                '<span class="cart-float-badge" id="cart-fab-badge">0</span>' +
            '</button>' +

            '<div class="cart-backdrop" id="cart-backdrop"></div>' +

            '<aside class="cart-drawer" id="cart-drawer" role="dialog" aria-modal="true" aria-label="Seu pedido" aria-hidden="true">' +
                '<header class="flex items-center justify-between gap-3 p-5 border-b border-borderSubtle shrink-0">' +
                    '<div>' +
                        '<p class="text-lg font-bold text-white uppercase tracking-wider">Seu pedido</p>' +
                        '<p class="text-xs text-textSecondary font-light" id="cart-subtitulo"></p>' +
                    '</div>' +
                    '<button type="button" id="cart-fechar" aria-label="Fechar"' +
                        ' class="' + BTN_CIRCULO + '"><i class="fa-solid fa-xmark text-xl"></i></button>' +
                '</header>' +

                '<div class="cart-drawer-corpo p-5 space-y-3" id="cart-lista"></div>' +

                '<footer class="shrink-0 border-t border-borderSubtle p-5 space-y-4 bg-[#111111]" id="cart-rodape"></footer>' +
            '</aside>';

        var wrap = document.createElement('div');
        wrap.innerHTML = html;
        while (wrap.firstChild) document.body.appendChild(wrap.firstChild);

        fab = document.getElementById('cart-fab');
        backdrop = document.getElementById('cart-backdrop');
        gaveta = document.getElementById('cart-drawer');

        fab.addEventListener('click', abrir);
        backdrop.addEventListener('click', fechar);
        document.getElementById('cart-fechar').addEventListener('click', fechar);

        ligarLista(document.getElementById('cart-lista'));
    }

    function montarToast() {
        if (document.getElementById('cart-toast')) return;
        toastEl = document.createElement('div');
        toastEl.className = 'cart-toast';
        toastEl.id = 'cart-toast';
        toastEl.setAttribute('role', 'status');
        toastEl.setAttribute('aria-live', 'polite');
        document.body.appendChild(toastEl);
    }

    // Liga a delegação em qualquer container que renderize linhas de carrinho —
    // a gaveta e a página de pedido usam o mesmo template.
    function ligarLista(el) {
        if (!el) return;
        el.addEventListener('click', aoClicarNaLista);
        el.addEventListener('change', aoMudarPotes);
    }

    /* ===================================================================
     * Abrir / fechar
     * =================================================================== */
    function aberta() {
        return gaveta && gaveta.classList.contains('is-aberto');
    }

    function abrir() {
        if (!gaveta || aberta()) return;

        // Nunca dois overlays visíveis ao mesmo tempo.
        if (typeof window.closeProductModal === 'function') window.closeProductModal();

        focoAnterior = document.activeElement;
        gaveta.classList.add('is-aberto');
        backdrop.classList.add('is-aberto');
        gaveta.setAttribute('aria-hidden', 'false');
        fab.classList.remove('is-visivel');
        window.ScrollLock.acquire('cart-drawer');
        document.getElementById('cart-fechar').focus();
    }

    function fechar() {
        if (!gaveta || !aberta()) return;

        gaveta.classList.remove('is-aberto');
        backdrop.classList.remove('is-aberto');
        gaveta.setAttribute('aria-hidden', 'true');
        window.ScrollLock.release('cart-drawer');
        atualizarFab();

        if (focoAnterior && document.contains(focoAnterior)) focoAnterior.focus();
        focoAnterior = null;
    }

    // Um único listener de Escape para as duas camadas: fecha a de cima.
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        if (aberta()) { fechar(); return; }
        if (typeof window.closeProductModal === 'function') {
            var modal = document.getElementById('product-modal');
            if (modal && !modal.classList.contains('hidden')) window.closeProductModal();
        }
    });

    /* ===================================================================
     * Toast
     * =================================================================== */
    function toast(mensagem) {
        if (!toastEl) return;
        toastEl.textContent = mensagem;
        toastEl.classList.add('is-visivel');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () {
            toastEl.classList.remove('is-visivel');
        }, 2600);
    }

    /* ===================================================================
     * Ações da lista (delegadas)
     * =================================================================== */
    function aoClicarNaLista(e) {
        var botao = e.target.closest('button[data-acao]');
        if (!botao) return;

        var id = botao.getAttribute('data-id');
        var acao = botao.getAttribute('data-acao');

        if (acao === 'mais') {
            Cart.definirPotes(id, Cart.potes(id) + PASSO);
        } else if (acao === 'menos') {
            Cart.definirPotes(id, Cart.potes(id) - PASSO);
        } else if (acao === 'remover') {
            Cart.remover(id);
        }
    }

    function aoMudarPotes(e) {
        var campo = e.target.closest('input[data-acao="potes"]');
        if (!campo) return;
        Cart.definirPotes(campo.getAttribute('data-id'), campo.value);
    }

    /* ===================================================================
     * Linha do carrinho
     * =================================================================== */
    function linhaHTML(item) {
        return '' +
        '<div class="cart-line p-3 flex gap-3' + (item.stale ? ' is-stale' : '') + '">' +
            (item.imagem
                ? '<img src="' + esc(item.imagem) + '" alt="" class="w-14 h-14 rounded-lg object-cover bg-[#111111] shrink-0">'
                : '<div class="w-14 h-14 rounded-lg bg-[#111111] shrink-0 flex items-center justify-center text-textSecondary"><i class="fa-solid fa-jar"></i></div>') +

            '<div class="flex-1 min-w-0">' +
                // <p>, nunca <h4>: ver o comentário em css/cart.css
                '<p class="font-bold text-white text-sm uppercase tracking-wide truncate">' + esc(item.nome) + '</p>' +

                (item.stale
                    ? '<p class="text-[0.65rem] text-primary-400 font-bold mt-0.5">Saiu do catálogo — confirme com o vendedor</p>'
                    : '') +

                '<p class="text-[0.7rem] text-textSecondary mt-0.5">' +
                    '<i class="fa-solid fa-box-open mr-1 opacity-70"></i>' + item.descricaoCaixas +
                '</p>' +

                '<div class="flex items-center justify-between gap-2 mt-2.5">' +
                    '<div class="flex items-center gap-1.5">' +
                        '<button type="button" data-acao="menos" data-id="' + esc(item.id) + '"' +
                            ' aria-label="Menos ' + PASSO + ' potes" class="' + BTN_CIRCULO + '">' +
                            '<i class="fa-solid fa-minus text-xs"></i></button>' +
                        '<div class="relative">' +
                            '<input type="number" inputmode="numeric" min="' + PASSO + '" step="' + PASSO + '" value="' + item.potes + '"' +
                                ' data-acao="potes" data-id="' + esc(item.id) + '"' +
                                ' aria-label="Quantidade de potes"' +
                                ' class="w-20 text-center bg-[#111111] border border-borderSubtle rounded-lg text-white text-sm py-1 pr-9 outline-none focus:border-primary-500">' +
                            '<span class="absolute right-2 top-1/2 -translate-y-1/2 text-[0.6rem] text-textSecondary pointer-events-none">potes</span>' +
                        '</div>' +
                        '<button type="button" data-acao="mais" data-id="' + esc(item.id) + '"' +
                            ' aria-label="Mais ' + PASSO + ' potes" class="' + BTN_CIRCULO + '">' +
                            '<i class="fa-solid fa-plus text-xs"></i></button>' +
                    '</div>' +
                    '<p class="text-primary-500 font-bold text-sm">' + Cart.formatarBRL(item.subtotalCentavos) + '</p>' +
                '</div>' +
            '</div>' +

            '<button type="button" data-acao="remover" data-id="' + esc(item.id) + '"' +
                ' aria-label="Remover ' + esc(item.nome) + '"' +
                ' class="text-textSecondary hover:text-white self-start w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors shrink-0">' +
                '<i class="fa-solid fa-trash-can text-xs"></i>' +
            '</button>' +
        '</div>';
    }

    function vazioHTML() {
        return '' +
        '<div class="text-center py-16 px-4">' +
            '<div class="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-5 text-textSecondary text-2xl">' +
                '<i class="fa-solid fa-basket-shopping"></i>' +
            '</div>' +
            '<p class="text-white font-bold uppercase tracking-wider mb-2">Seu pedido está vazio</p>' +
            '<p class="text-sm text-textSecondary font-light mb-6">Escolha os sabores no catálogo e monte suas caixas.</p>' +
            '<a href="catalogo.html" class="btn-primary inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm">' +
                'Ver catálogo <i class="fa-solid fa-arrow-right text-xs"></i>' +
            '</a>' +
        '</div>';
    }

    function rodapeHTML(t) {
        if (t.linhas === 0) return '';

        var pct = Math.round(t.progresso * 100);
        var minimoBRL = Cart.formatarBRL(Cart.precoDePotes(t.minimoPotes));

        var aviso = t.atingiuMinimo
            ? '<div class="flex items-center gap-2 text-xs font-bold text-green-400">' +
                  '<i class="fa-solid fa-circle-check"></i> Pedido mínimo atingido' +
              '</div>'
            : '<div class="cart-aviso p-3 text-xs font-medium leading-relaxed">' +
                  '<strong class="font-bold">Faltam ' + t.faltamPotes + ' potes</strong>.<br>' +
                  '<span class="opacity-80">Você pode enviar assim mesmo; o vendedor confirma.</span>' +
              '</div>';

        return '' +
        '<div class="space-y-2">' +
            '<div class="cart-progresso"><div class="cart-progresso-barra' + (t.atingiuMinimo ? ' is-completo' : '') + '" style="width:' + pct + '%"></div></div>' +
            '<p class="text-[0.6rem] text-textSecondary uppercase tracking-widest">Pedido mínimo: ' + t.minimoPotes + ' potes (' + minimoBRL + ')</p>' +
        '</div>' +

        aviso +

        '<div class="flex items-end justify-between">' +
            '<div>' +
                '<p class="text-[0.6rem] text-textSecondary uppercase tracking-widest">Total</p>' +
                '<p class="text-2xl font-bold text-white leading-tight" style="font-family:\'Barlow Condensed\',sans-serif;">' +
                    Cart.formatarBRL(t.valorCentavos) +
                '</p>' +
            '</div>' +
            '<p class="text-xs text-textSecondary text-right">' + t.potes + ' potes<br>' + t.caixas + (t.caixas === 1 ? ' caixa' : ' caixas') + '</p>' +
        '</div>' +

        (Cart.persistente ? '' :
            '<p class="text-[0.65rem] text-primary-400">Seu navegador não está salvando o carrinho — finalize o pedido nesta aba.</p>') +

        '<a href="pedido.html" class="btn-primary w-full py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2">' +
            'Finalizar pedido <i class="fa-solid fa-arrow-right text-xs"></i>' +
        '</a>' +
        '<button type="button" id="cart-continuar" class="w-full text-xs text-textSecondary hover:text-white transition-colors py-1">' +
            'Continuar escolhendo' +
        '</button>';
    }

    function atualizarFab() {
        if (!fab) return;
        var t = Cart.totais();
        document.getElementById('cart-fab-badge').textContent = t.caixas;
        fab.classList.toggle('is-visivel', t.linhas > 0 && !aberta());
    }

    function render() {
        if (!gaveta) return;

        var itens = Cart.itens();
        var t = Cart.totais();

        document.getElementById('cart-lista').innerHTML =
            itens.length ? itens.map(linhaHTML).join('') : vazioHTML();

        document.getElementById('cart-rodape').innerHTML = rodapeHTML(t);

        document.getElementById('cart-subtitulo').textContent =
            t.linhas === 0 ? 'Nenhum item'
                           : t.potes + ' potes · ' + t.caixas + (t.caixas === 1 ? ' caixa' : ' caixas');

        var continuar = document.getElementById('cart-continuar');
        if (continuar) continuar.addEventListener('click', fechar);

        atualizarFab();
    }

    /* ===================================================================
     * Seletor de potes dentro do modal de produto
     *
     * O seletor completo vive num lugar só: o modal. O card do catálogo tem
     * apenas um botão "Adicionar" que abre o modal já com o seletor à mostra.
     * O card inteiro já é gatilho do modal, então controles dentro dele
     * exigiriam stopPropagation em cada um, e o grid vai a 4 colunas com 73
     * cards.
     * =================================================================== */
    var pickerId = null;
    var pickerNome = '';
    var pickerPotes = PASSO;

    function produtoPorId(id) {
        if (typeof produtos === 'undefined' || !Array.isArray(produtos)) return null;
        return produtos.filter(function (p) { return p.id === id; })[0] || null;
    }

    function pickerHTML() {
        var jaTem = Cart.potes(pickerId);

        return '' +
        '<div class="bg-white/5 border border-white/10 rounded-xl p-5 space-y-4">' +
            '<p class="text-primary-500 text-sm font-bold uppercase tracking-widest flex items-center gap-2">' +
                '<i class="fa-solid fa-box"></i> Adicionar ao pedido' +
            '</p>' +
            '<p class="text-xs text-textSecondary font-light">' +
                Cart.formatarBRL(Cart.config.precoPorPoteCentavos) + ' por pote &middot; de ' + PASSO + ' em ' + PASSO + ' potes' +
            '</p>' +

            '<div class="flex items-center justify-center gap-3">' +
                '<button type="button" data-picker="menos" aria-label="Menos ' + PASSO + ' potes" class="' + BTN_CIRCULO + '">' +
                    '<i class="fa-solid fa-minus text-xs"></i></button>' +
                '<div class="relative">' +
                    '<input type="number" inputmode="numeric" min="' + PASSO + '" step="' + PASSO + '" value="' + pickerPotes + '" data-picker="potes"' +
                        ' aria-label="Quantidade de potes"' +
                        ' class="w-28 text-center bg-[#111111] border border-borderSubtle rounded-lg text-white text-lg font-bold py-2 pr-12 outline-none focus:border-primary-500">' +
                    '<span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-textSecondary pointer-events-none">potes</span>' +
                '</div>' +
                '<button type="button" data-picker="mais" aria-label="Mais ' + PASSO + ' potes" class="' + BTN_CIRCULO + '">' +
                    '<i class="fa-solid fa-plus text-xs"></i></button>' +
            '</div>' +

            '<p class="text-center text-xs text-textSecondary" data-picker="caixas">' +
                '<i class="fa-solid fa-box-open mr-1 opacity-70"></i>' + Cart.descreverCaixas(pickerPotes) +
            '</p>' +

            '<button type="button" data-picker="adicionar" class="btn-primary w-full py-3 rounded-xl font-bold text-sm">' +
                'Adicionar &mdash; <span data-picker="valor">' + Cart.formatarBRL(Cart.precoDePotes(pickerPotes)) + '</span>' +
            '</button>' +

            (jaTem
                ? '<p class="text-[0.7rem] text-primary-400 text-center">Já no pedido: ' + jaTem + ' potes &middot; adicionar soma a essa quantidade</p>'
                : '') +
        '</div>';
    }

    function renderPicker() {
        var slot = document.getElementById('modal-picker-slot');
        if (!slot || !pickerId) return;
        slot.innerHTML = pickerHTML();
    }

    function potesDoPicker() {
        var campo = document.querySelector('[data-picker="potes"]');
        return Cart.ajustarAoPasso(campo && campo.value);
    }

    function atualizarPicker() {
        var potes = potesDoPicker();
        var valor = document.querySelector('[data-picker="valor"]');
        var caixas = document.querySelector('[data-picker="caixas"]');
        if (valor) valor.textContent = Cart.formatarBRL(Cart.precoDePotes(potes));
        if (caixas) caixas.innerHTML = '<i class="fa-solid fa-box-open mr-1 opacity-70"></i>' + Cart.descreverCaixas(potes);
    }

    // O modal é singleton e o anterior/próximo reentra na mesma função, então o
    // seletor sempre reseta para o produto que acabou de abrir.
    window.onProductModalOpen = function (id, nomeCru) {
        if (!id) {
            // Card sem data-id: tenta casar pelo nome, como content-loader.js faz.
            var alvo = String(nomeCru || '').toUpperCase();
            var achado = (typeof produtos !== 'undefined' ? produtos : []).filter(function (p) {
                return p.nome.toUpperCase() === alvo;
            })[0];
            id = achado ? achado.id : null;
        }
        var prod = produtoPorId(id);
        if (!prod) {
            var slot = document.getElementById('modal-picker-slot');
            if (slot) slot.innerHTML = '';
            pickerId = null;
            return;
        }
        pickerId = prod.id;
        pickerNome = prod.nome;
        pickerPotes = PASSO;
        renderPicker();
    };

    document.addEventListener('click', function (e) {
        var alvo = e.target.closest('[data-picker]');
        if (!alvo || !pickerId) return;

        var acao = alvo.getAttribute('data-picker');
        var campo = document.querySelector('[data-picker="potes"]');

        if (acao === 'mais') {
            campo.value = potesDoPicker() + PASSO;
            atualizarPicker();
        } else if (acao === 'menos') {
            campo.value = Math.max(PASSO, potesDoPicker() - PASSO);
            atualizarPicker();
        } else if (acao === 'adicionar') {
            var potes = potesDoPicker();
            Cart.adicionar(pickerId, pickerNome, potes);
            toast(potes + ' potes de ' + pickerNome + ' no pedido (' + Cart.descreverCaixas(potes) + ')');
            renderPicker();
        }
    });

    // Digitar solto é permitido; o valor só é arredondado ao múltiplo do passo
    // quando o campo perde o foco, para não brigar com quem está digitando.
    document.addEventListener('input', function (e) {
        if (e.target.matches && e.target.matches('[data-picker="potes"]')) atualizarPicker();
    });
    document.addEventListener('blur', function (e) {
        if (e.target.matches && e.target.matches('[data-picker="potes"]')) {
            e.target.value = potesDoPicker();
            atualizarPicker();
        }
    }, true);

    /* Botões nos cards. Precisa ser rechamado a cada re-render da busca, que
     * refaz o innerHTML inteiro do grid e destrói todos os listeners. */
    window.setupCartControls = function () {
        // Home: adiciona direto a menor quantidade, sem modal. O ajuste fino
        // acontece na gaveta, que a home também tem.
        document.querySelectorAll('.cart-quick-add').forEach(function (botao) {
            if (botao.dataset.ligado) return;
            botao.dataset.ligado = '1';
            botao.addEventListener('click', function (e) {
                e.stopPropagation();
                var nome = botao.getAttribute('data-nome');
                Cart.adicionar(botao.getAttribute('data-id'), nome, PASSO);
                toast(PASSO + ' potes de ' + nome + ' no pedido');
            });
        });

        // Catálogo: abre o modal já no seletor.
        document.querySelectorAll('.cart-add-btn').forEach(function (botao) {
            if (botao.dataset.ligado) return;
            botao.dataset.ligado = '1';
            botao.addEventListener('click', function (e) {
                // Sem isto o clique subiria até a raiz do card, que também abre
                // o modal — abriria duas vezes.
                e.stopPropagation();
                // .surface-card, não [data-id]: o próprio botão carrega data-id,
                // e closest() começa no próprio elemento.
                var card = botao.closest('.surface-card');
                if (card && typeof window.openProductModal === 'function') {
                    window.openProductModal(card);
                }
            });
        });
    };

    /* ===================================================================
     * API pública e boot
     * =================================================================== */
    window.CartUI = {
        abrir: abrir,
        fechar: fechar,
        aberta: aberta,
        toast: toast,
        render: render,
        // Reusados por js/pedido.js, que renderiza a mesma linha sem a gaveta.
        linhaHTML: linhaHTML,
        ligarLista: ligarLista
    };

    // A página de pedido reusa o Cart e o toast, mas não quer o botão flutuante
    // nem a gaveta: <body data-cart-ui="off">.
    function iniciar() {
        montarToast(); // o toast serve as duas páginas
        if (document.body.dataset.cartUi === 'off') return;
        montar();
        render();
        document.addEventListener('cart:change', render);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();
