// Chamado pelo content-loader depois que o HTML do FAQ é injetado.
window.initFaq = () => {
    const faqBtns = document.querySelectorAll('.faq-btn');

    const fechar = (btn) => {
        btn.nextElementSibling.classList.remove('max-h-[500px]', 'opacity-100');
        btn.nextElementSibling.classList.add('max-h-0', 'opacity-0');
        btn.querySelector('i').classList.remove('rotate-180');
    };

    const abrir = (btn) => {
        btn.nextElementSibling.classList.remove('max-h-0', 'opacity-0');
        btn.nextElementSibling.classList.add('max-h-[500px]', 'opacity-100');
        btn.querySelector('i').classList.add('rotate-180');
    };

    faqBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const estavaFechado = btn.nextElementSibling.classList.contains('max-h-0');
            faqBtns.forEach(fechar);
            if (estavaFechado) abrir(btn);
        });
    });
};
