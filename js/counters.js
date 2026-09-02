// Chamado pelo content-loader; anima os números da seção "sobre" quando entram na tela.
window.initCounters = () => {
    const DURACAO_MS = 3000;
    const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);

    const animar = (counter) => {
        const alvo = +counter.getAttribute('data-target');
        let inicio = null;

        const passo = (agora) => {
            if (!inicio) inicio = agora;
            const progresso = Math.min((agora - inicio) / DURACAO_MS, 1);

            if (progresso < 1) {
                counter.innerText = Math.ceil(alvo * easeOutQuart(progresso));
                requestAnimationFrame(passo);
            } else {
                counter.innerText = alvo;
            }
        };
        requestAnimationFrame(passo);
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                if (!entry.target.classList.contains('counted')) {
                    animar(entry.target);
                    entry.target.classList.add('counted');
                }
            } else {
                // Zera ao sair da tela para a animação repetir na próxima passagem.
                entry.target.classList.remove('counted');
                entry.target.innerText = '0';
            }
        });
    }, { root: null, rootMargin: '0px', threshold: 0.1 });

    document.querySelectorAll('.stat-counter').forEach(counter => observer.observe(counter));
};
