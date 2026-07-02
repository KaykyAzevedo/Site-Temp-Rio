document.addEventListener('DOMContentLoaded', () => {
    const initFaq = () => {
        const faqBtns = document.querySelectorAll('.faq-btn');
        faqBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const content = btn.nextElementSibling;
                const icon = btn.querySelector('i');
                
                // Fecha os outros
                faqBtns.forEach(otherBtn => {
                    if (otherBtn !== btn) {
                        otherBtn.nextElementSibling.classList.add('hidden');
                        otherBtn.querySelector('i').classList.remove('rotate-180');
                    }
                });

                // Alterna o atual
                content.classList.toggle('hidden');
                icon.classList.toggle('rotate-180');
            });
        });
    };
    
    // We need to init after dynamic injection
    window.initFaq = initFaq;
});
