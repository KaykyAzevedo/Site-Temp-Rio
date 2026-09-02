/* Carrinho — interface compartilhada: botão flutuante, gaveta e toast.
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

    var fab = null;
    var backdrop = null;
    var gaveta = null;
    var toastEl = null;
    var toastTimer = null;
    var focoAnterior = null;

    /* ===================================================================
     * Marcação
     * =================================================================== */
    function montar() {
        var html =
            '<button type="button" class="cart-float" id="cart-fab" aria-label="Abrir seu pedido">' +
                '<i class="fa-solid fa-basket-shopping"></i>' +
                '<span class="cart-float-badge" id="cart-fab-badge">0</span>' +
            '</button>' +

            '<div class="cart-backdrop" id="cart-backdrop"></div>' +

            '<aside class="cart-drawer" id="cart-drawer" role="dialog" aria-modal="true" aria-label="Seu pedido" aria-hidden="true">' +
                // Cabeçalho
                '<header class="flex items-center justify-between gap-3 p-5 border-b border-borderSubtle shrink-0">' +
                    '<div>' +
                        '<p class="text-lg font-bold text-white uppercase tracking-wider">Seu pedido</p>' +
                        '<p class="text-xs text-textSecondary font-light" id="cart-subtitulo"></p>' +
                    '</div>' +
                    '<button type="button" id="cart-fechar" aria-label="Fechar"' +
                        ' class="text-textSecondary hover:text-white transition-colors w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10">' +
                        '<i class="fa-solid fa-xmark text-xl"></i>' +
                    '</button>' +
                '</header>' +

                // Lista
                '<div class="cart-drawer-corpo p-5 space-y-3" id="cart-lista"></div>' +

                // Rodapé
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

        // Delegação: a lista é reconstruída a cada mudança, então não dá para
        // ligar listener item a item.
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

    // Liga a delegação de eventos em qualquer container que renderize linhas de
    // carrinho — a gaveta e a página de pedido usam o mesmo template.
    function ligarLista(el) {
        if (!el) return;
        el.addEventListener('click', aoClicarNaLista);
        el.addEventListener('change', aoMudarQuantidade);
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
        fab.classList.remove('is-visivel'); // não cobrir o CTA da gaveta no celular
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
        var box = parseInt(botao.getAttribute('data-box'), 10);
        var acao = botao.getAttribute('data-acao');

        if (acao === 'mais') {
            Cart.definirQuantidade(id, box, Cart.quantidade(id, box) + 1);
        } else if (acao === 'menos') {
            Cart.definirQuantidade(id, box, Cart.quantidade(id, box) - 1);
        } else if (acao === 'remover') {
            Cart.remover(id, box);
        } else if (acao === 'tamanho') {
            var para = parseInt(botao.getAttribute('data-para'), 10);
            if (para !== box) Cart.trocarTamanho(id, box, para);
        }
    }

    function aoMudarQuantidade(e) {
        var campo = e.target.closest('input[data-acao="qtd"]');
        if (!campo) return;
        Cart.definirQuantidade(
            campo.getAttribute('data-id'),
            parseInt(campo.getAttribute('data-box'), 10),
            campo.value
        );
    }

    /* ===================================================================
     * Renderização
     * =================================================================== */
    var BTN_CIRCULO = 'text-textSecondary hover:text-white transition-colors w-8 h-8 ' +
        'flex-shrink-0 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10';

    function linhaHTML(item) {
        var outro = Cart.TAMANHOS.filter(function (t) { return t !== item.box; })[0];

        var pilulas = Cart.TAMANHOS.map(function (t) {
            var ativo = t === item.box;
            return '<button type="button" data-acao="tamanho" data-id="' + esc(item.id) + '"' +
                ' data-box="' + item.box + '" data-para="' + t + '"' +
                ' class="px-2.5 py-1 rounded-full text-[0.65rem] font-bold tracking-widest uppercase border transition-colors ' +
                (ativo
                    ? 'bg-primary-500 text-white border-primary-500'
                    : 'bg-white/5 text-textSecondary border-white/10 hover:border-primary-500/50') +
                '">' + t + '</button>';
        }).join('');

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

                '<div class="flex items-center gap-1.5 mt-1.5">' +
                    '<span class="text-[0.6rem] text-textSecondary uppercase tracking-widest mr-0.5">Caixa</span>' +
                    pilulas +
                '</div>' +

                '<div class="flex items-center justify-between gap-2 mt-2.5">' +
                    '<div class="flex items-center gap-1.5">' +
                        '<button type="button" data-acao="menos" data-id="' + esc(item.id) + '" data-box="' + item.box + '"' +
                            ' aria-label="Menos uma caixa" class="' + BTN_CIRCULO + '"><i class="fa-solid fa-minus text-xs"></i></button>' +
                        '<input type="number" inputmode="numeric" min="1" max="999" value="' + item.qty + '"' +
                            ' data-acao="qtd" data-id="' + esc(item.id) + '" data-box="' + item.box + '"' +
                            ' aria-label="Quantidade de caixas"' +
                            ' class="w-12 text-center bg-[#111111] border border-borderSubtle rounded-lg text-white text-sm py-1 outline-none focus:border-primary-500">' +
                        '<button type="button" data-acao="mais" data-id="' + esc(item.id) + '" data-box="' + item.box + '"' +
                            ' aria-label="Mais uma caixa" class="' + BTN_CIRCULO + '"><i class="fa-solid fa-plus text-xs"></i></button>' +
                    '</div>' +
                    '<div class="text-right">' +
                        '<p class="text-primary-500 font-bold text-sm leading-tight">' + Cart.formatarBRL(item.subtotalCentavos) + '</p>' +
                        '<p class="text-[0.6rem] text-textSecondary">' + item.potes + ' potes</p>' +
                    '</div>' +
                '</div>' +
            '</div>' +

            '<button type="button" data-acao="remover" data-id="' + esc(item.id) + '" data-box="' + item.box + '"' +
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
        var minimoBRL = Cart.formatarBRL(t.minimoPotes * Cart.config.precoPorPoteCentavos);

        var aviso = t.atingiuMinimo
            ? '<div class="flex items-center gap-2 text-xs font-bold text-green-400">' +
                  '<i class="fa-solid fa-circle-check"></i> Pedido mínimo atingido' +
              '</div>'
            : '<div class="cart-aviso p-3 text-xs font-medium leading-relaxed">' +
                  '<strong class="font-bold">Faltam ' + t.faltamPotes + ' potes</strong> — ' +
                  t.faltamCaixas[24] + ' caixas de 24 ou ' + t.faltamCaixas[48] + ' de 48.<br>' +
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
            '<p class="text-xs text-textSecondary text-right">' + t.caixas + ' caixas<br>' + t.potes + ' potes</p>' +
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
        // Some com carrinho vazio (nada de botão morto) e enquanto a gaveta
        // está aberta (senão cobre o CTA no celular).
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
            t.linhas === 0 ? 'Nenhum item' :
            t.caixas + (t.caixas === 1 ? ' caixa' : ' caixas') + ' · ' + t.potes + ' potes';

        var continuar = document.getElementById('cart-continuar');
        if (continuar) continuar.addEventListener('click', fechar);

        atualizarFab();
    }

    /* ===================================================================
     * Seletor de caixa dentro do modal de produto
     *
     * O seletor completo vive num lugar só: o modal. O card do catálogo tem
     * apenas um botão "Adicionar" que abre o modal já com o seletor à mostra.
     * Motivo: o card inteiro já é o gatilho do modal (product-modal.js liga o
     * clique na raiz do card), então cada controle dentro dele precisaria de
     * stopPropagation e um clique errado abriria o modal por cima do que a
     * pessoa estava mexendo. E o grid vai a 4 colunas com 73 cards.
     * =================================================================== */
    var pickerId = null;
    var pickerNome = '';
    var pickerBox = null;

    function produtoPorId(id) {
        if (typeof produtos === 'undefined' || !Array.isArray(produtos)) return null;
        return produtos.filter(function (p) { return p.id === id; })[0] || null;
    }

    function pickerHTML() {
        var jaTem = Cart.quantidade(pickerId, pickerBox);
        var qtd = jaTem || 1;
        var precoCaixa = Cart.precoCaixa(pickerBox);

        var pilulas = Cart.TAMANHOS.map(function (t) {
            var ativo = t === pickerBox;
            return '<button type="button" data-picker="tamanho" data-valor="' + t + '"' +
                ' class="flex-1 px-3 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest border transition-colors ' +
                (ativo
                    ? 'bg-primary-500 text-white border-primary-500'
                    : 'bg-white/5 text-textSecondary border-white/10 hover:border-primary-500/50') +
                '">' + t + ' potes<br><span class="text-[0.65rem] font-normal opacity-80">' +
                Cart.formatarBRL(Cart.precoCaixa(t)) + '</span></button>';
        }).join('');

        return '' +
        '<div class="bg-white/5 border border-white/10 rounded-xl p-5 space-y-4">' +
            '<p class="text-primary-500 text-sm font-bold uppercase tracking-widest flex items-center gap-2">' +
                '<i class="fa-solid fa-box"></i> Adicionar ao pedido' +
            '</p>' +
            '<p class="text-xs text-textSecondary font-light">' +
                Cart.formatarBRL(Cart.config.precoPorPoteCentavos) + ' por pote &middot; caixa fechada de um único sabor' +
            '</p>' +

            '<div class="flex gap-2">' + pilulas + '</div>' +

            '<div class="flex items-center justify-between gap-3">' +
                '<div class="flex items-center gap-2">' +
                    '<button type="button" data-picker="menos" aria-label="Menos uma caixa" class="' + BTN_CIRCULO + '">' +
                        '<i class="fa-solid fa-minus text-xs"></i></button>' +
                    '<input type="number" inputmode="numeric" min="1" max="999" value="' + qtd + '" data-picker="qtd"' +
                        ' aria-label="Quantidade de caixas"' +
                        ' class="w-16 text-center bg-[#111111] border border-borderSubtle rounded-lg text-white py-2 outline-none focus:border-primary-500">' +
                    '<button type="button" data-picker="mais" aria-label="Mais uma caixa" class="' + BTN_CIRCULO + '">' +
                        '<i class="fa-solid fa-plus text-xs"></i></button>' +
                '</div>' +
                '<span class="text-xs text-textSecondary">' + pickerBox + ' potes por caixa</span>' +
            '</div>' +

            '<button type="button" data-picker="adicionar" class="btn-primary w-full py-3 rounded-xl font-bold text-sm">' +
                'Adicionar &mdash; <span data-picker="valor">' + Cart.formatarBRL(qtd * precoCaixa) + '</span>' +
            '</button>' +

            (jaTem
                ? '<p class="text-[0.7rem] text-primary-400 text-center">Já no pedido: ' + jaTem +
                  (jaTem === 1 ? ' caixa' : ' caixas') + ' de ' + pickerBox + ' &middot; adicionar soma a essa quantidade</p>'
                : '') +
        '</div>';
    }

    function renderPicker() {
        var slot = document.getElementById('modal-picker-slot');
        if (!slot || !pickerId) return;
        slot.innerHTML = pickerHTML();
    }

    function qtdDoPicker() {
        var campo = document.querySelector('[data-picker="qtd"]');
        var n = Math.trunc(Number(campo && campo.value));
        if (!isFinite(n) || n < 1) n = 1;
        return Math.min(n, 999);
    }

    function atualizarValorDoPicker() {
        var alvo = document.querySelector('[data-picker="valor"]');
        if (alvo) alvo.textContent = Cart.formatarBRL(qtdDoPicker() * Cart.precoCaixa(pickerBox));
    }

    // O modal é um singleton e o anterior/próximo reentra na mesma função, então
    // o seletor sempre reseta para o produto que acabou de abrir.
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
        pickerBox = Cart.TAMANHOS[0];
        renderPicker();
    };

    document.addEventListener('click', function (e) {
        var alvo = e.target.closest('[data-picker]');
        if (!alvo || !pickerId) return;

        var acao = alvo.getAttribute('data-picker');
        var campo = document.querySelector('[data-picker="qtd"]');

        if (acao === 'tamanho') {
            pickerBox = parseInt(alvo.getAttribute('data-valor'), 10);
            renderPicker();
        } else if (acao === 'mais') {
            campo.value = qtdDoPicker() + 1;
            atualizarValorDoPicker();
        } else if (acao === 'menos') {
            campo.value = Math.max(1, qtdDoPicker() - 1);
            atualizarValorDoPicker();
        } else if (acao === 'adicionar') {
            var qtd = qtdDoPicker();
            Cart.adicionar(pickerId, pickerNome, pickerBox, qtd);
            toast(qtd + (qtd === 1 ? ' caixa' : ' caixas') + ' de ' + pickerBox + ' de ' + pickerNome + ' no pedido');
            renderPicker(); // atualiza o "Já no pedido"
        }
    });

    document.addEventListener('input', function (e) {
        if (e.target.matches && e.target.matches('[data-picker="qtd"]')) atualizarValorDoPicker();
    });

    /* Botão "Adicionar" nos cards do catálogo: abre o modal já no seletor.
     * Precisa ser rechamado a cada re-render da busca, que refaz o innerHTML
     * inteiro do grid e destrói todos os listeners. */
    window.setupCartControls = function () {
        // Home: adiciona direto a caixa padrao, sem modal. O ajuste fino de
        // tamanho e quantidade fica na gaveta, que a home tambem tem.
        document.querySelectorAll('.cart-quick-add').forEach(function (botao) {
            if (botao.dataset.ligado) return;
            botao.dataset.ligado = '1';
            botao.addEventListener('click', function (e) {
                e.stopPropagation();
                var id = botao.getAttribute('data-id');
                var nome = botao.getAttribute('data-nome');
                var box = Cart.TAMANHOS[0];
                Cart.adicionar(id, nome, box, 1);
                toast('1 caixa de ' + box + ' de ' + nome + ' no pedido');
            });
        });

        document.querySelectorAll('.cart-add-btn').forEach(function (botao) {
            if (botao.dataset.ligado) return;
            botao.dataset.ligado = '1';
            botao.addEventListener('click', function (e) {
                // Sem isto o clique subiria até a raiz do card, que também abre
                // o modal — abriria duas vezes.
                e.stopPropagation();
                // .surface-card, nao [data-id]: o proprio botao carrega data-id,
                // e closest() comeca no proprio elemento.
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

    // A página de pedido reusa o Cart e o toast, mas não quer o botão
    // flutuante nem a gaveta: <body data-cart-ui="off">.
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
