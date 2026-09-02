document.addEventListener('DOMContentLoaded', () => {

    // ---------- Config ----------
    const updateLinks = () => {
        document.querySelectorAll('a[href^="https://wa.me/"]').forEach(a => {
            a.href = siteConfig.links.whatsappApi;
        });
        document.querySelectorAll('a[href^="https://instagram.com/"]').forEach(a => {
            a.href = siteConfig.redesSociais.instagram;
        });
        document.querySelectorAll('.config-telefone').forEach(el => {
            el.innerHTML = `<i class="fa-brands fa-whatsapp mt-1"></i> ${siteConfig.empresa.telefone}`;
        });
        document.querySelectorAll('.config-email').forEach(el => {
            el.innerHTML = `<i class="fa-regular fa-envelope mt-1"></i> ${siteConfig.empresa.email}`;
        });
    };

    // ---------- Card de produto (compartilhado entre home e catálogo) ----------
    const CLASSES_CARD = 'surface-card rounded-2xl overflow-hidden hover-lift group border border-borderSubtle flex flex-col fade-in shadow-lg hover:shadow-primary-500/10';

    const OVERLAY_LUPA = `
                        <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-20 bg-black/60">
                            <button class="bg-primary-500 hover:bg-primary-600 text-white rounded-full w-14 h-14 flex items-center justify-center shadow-lg transform translate-y-4 group-hover:translate-y-0 transition-all duration-300 transform-gpu">
                                <i class="fa-solid fa-magnifying-glass-plus text-xl"></i>
                            </button>
                        </div>`;

    const imagemProduto = (prod, { lazy = false, overlay = '' } = {}) => `
                    <div class="w-full aspect-[4/3] relative overflow-hidden bg-[#111111]">
                        <img src="${prod.imagem}" alt="${prod.nome}"${lazy ? ' loading="lazy"' : ''} class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 ease-out transform-gpu">
                        <div class="absolute inset-0 bg-gradient-to-t from-[#1A1A1A] via-[#1A1A1A]/20 to-transparent opacity-90"></div>${overlay}
                    </div>`;

    // ---------- Destaques (home) ----------
    const loadDestaques = () => {
        const container = document.getElementById('destaques-container');
        if (!container) return;

        container.innerHTML = produtos.filter(p => p.destaque).slice(0, 4).map((prod, index) => `
                <div class="${CLASSES_CARD}" data-id="${prod.id}" style="transition-delay: ${50 * index}ms;">${imagemProduto(prod)}
                    <div class="p-6 pt-2 text-center bg-[#1A1A1A] relative z-10 flex flex-col justify-center items-center flex-1">
                        <h4 class="text-xl font-bold text-white uppercase tracking-wider">${prod.nome}</h4>
                        <div class="w-8 h-1 bg-primary-500 mx-auto rounded-full mt-3 opacity-0 group-hover:opacity-100 group-hover:w-16 transition-all duration-500"></div>
                    </div>
                </div>
        `).join('');
    };

    // ---------- Catálogo completo (catalogo.html) ----------
    const loadCatalog = () => {
        const container = document.getElementById('catalogGrid');
        if (!container) return;

        const renderCatalog = (items) => {
            container.innerHTML = items.map(prod => `
                <div class="${CLASSES_CARD}" data-id="${prod.id}">${imagemProduto(prod, { lazy: true, overlay: OVERLAY_LUPA })}
                    <div class="p-6 pt-4 bg-[#1A1A1A] relative z-10 flex flex-col flex-1 border-t border-white/5">
                        <h4 class="text-lg font-bold text-white uppercase tracking-wide mb-1 leading-tight">${prod.nome}</h4>
                        <p class="text-primary-500 text-xs font-bold tracking-widest uppercase mb-3">100% Natural</p>
                        <button type="button" class="cart-add-btn mt-auto w-full py-2.5 rounded-xl border border-primary-500/40 text-primary-400 text-xs font-bold uppercase tracking-widest hover:bg-primary-500 hover:text-white transition-all" data-id="${prod.id}">
                            Adicionar
                        </button>
                    </div>
                </div>
            `).join('');

            // Os cards foram recriados: religa modal, carrinho e animações de entrada.
            if (window.setupModal) window.setupModal();
            if (window.setupCartControls) window.setupCartControls();
            if (window.initAnimations) window.initAnimations();
        };

        renderCatalog(produtos);

        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            const normalize = (str) => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
            searchInput.addEventListener('input', (e) => {
                const termo = normalize(e.target.value);
                renderCatalog(produtos.filter(p => normalize(p.nome).includes(termo)));
            });
        }
    };

    // ---------- Parceiros ----------
    const loadParceiros = () => {
        const grupo1 = document.getElementById('parceiros-group-1');
        const grupo2 = document.getElementById('parceiros-group-2');
        if (!grupo1 || !grupo2) return;

        const html = parceiros.map(p => `
            <img src="${p.imagem}" alt="${p.nome}" class="h-16 md:h-20 lg:h-24 w-auto max-w-none shrink-0 object-contain rounded">
        `).join('');

        grupo1.innerHTML = html;
        grupo2.innerHTML = html;
    };

    // ---------- Depoimentos ----------
    const loadDepoimentos = () => {
        const container = document.getElementById('testimonial-slider');
        if (!container) return;

        container.innerHTML = depoimentos.map(d => `
            <div class="w-[85vw] md:w-[calc(50%_-_12px)] snap-start shrink-0 surface-card p-10 rounded-xl shadow-xl flex flex-col h-auto">
                <div class="flex text-orange-500 text-sm gap-1 mb-6">
                    ${'<i class="fa-solid fa-star"></i>'.repeat(d.avaliacao)}
                </div>
                <p class="text-gray-400 font-light text-lg leading-relaxed mb-10 flex-1">
                    ${d.texto}
                </p>
                <div class="flex items-center gap-4 mt-auto">
                    <img src="${d.imagem}" alt="${d.nome}" class="w-12 h-12 rounded-full object-cover">
                    <div>
                        <h4 class="font-bold text-white text-sm">${d.nome}</h4>
                        <p class="text-xs text-gray-500">${d.cargo}</p>
                    </div>
                </div>
            </div>
        `).join('');
    };

    // ---------- FAQ ----------
    const loadFaq = () => {
        const container = document.getElementById('faq-container');
        if (!container) return;

        container.innerHTML = faq.map(f => `
            <div class="surface-card rounded-xl overflow-hidden border border-borderSubtle">
                <button class="w-full px-6 py-5 text-left flex justify-between items-center focus:outline-none faq-btn group">
                    <span class="font-semibold text-lg text-white group-hover:text-primary-400 transition-colors">${f.pergunta}</span>
                    <div class="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-primary-500/10 transition-colors">
                        <i class="fa-solid fa-chevron-down text-orange-500 transform transition-transform duration-500 ease-[cubic-bezier(0.87,0,0.13,1)]"></i>
                    </div>
                </button>
                <div class="faq-content overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.87,0,0.13,1)] max-h-0 opacity-0">
                    <div class="px-6 pb-5 text-gray-400 font-light">
                        ${f.resposta}
                    </div>
                </div>
            </div>
        `).join('');
    };

    updateLinks();
    loadDestaques();
    loadCatalog();
    loadParceiros();
    loadDepoimentos();
    loadFaq();

    // Inicializadores que dependem do HTML já injetado acima.
    if (window.initAnimations) window.initAnimations();
    if (window.setupCartControls) window.setupCartControls();
    if (window.initFaq) window.initFaq();
    if (window.initSliders) window.initSliders();
    if (window.initCounters) window.initCounters();
});
