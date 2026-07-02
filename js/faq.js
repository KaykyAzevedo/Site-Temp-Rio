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
                        const otherContent = otherBtn.nextElementSibling;
                        const otherIcon = otherBtn.querySelector('i');
                        
                        otherContent.classList.remove('max-h-[500px]', 'opacity-100');
                        otherContent.classList.add('max-h-0', 'opacity-0');
                        otherIcon.classList.remove('rotate-180');
                    }
                });

                // Alterna o atual
                if (content.classList.contains('max-h-0')) {
                    content.classList.remove('max-h-0', 'opacity-0');
                    content.classList.add('max-h-[500px]', 'opacity-100');
                    icon.classList.add('rotate-180');
                } else {
                    content.classList.remove('max-h-[500px]', 'opacity-100');
                    content.classList.add('max-h-0', 'opacity-0');
                    icon.classList.remove('rotate-180');
                }
            });
        });
    };
    
    // We need to init after dynamic injection
    window.initFaq = initFaq;
});
