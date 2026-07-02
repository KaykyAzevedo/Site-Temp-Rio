document.addEventListener('DOMContentLoaded', () => {
    const initCounters = () => {
        const counters = document.querySelectorAll('.stat-counter');
        const counterOptions = {
            root: null,
            rootMargin: '0px',
            threshold: 0.1
        };

        const animateCounter = (counter) => {
            const target = +counter.getAttribute('data-target');
            const duration = 3000; // 3 seconds
            let startTimestamp = null;

            // Função de easing (ease-out-quart) para desacelerar suavemente no final
            const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);

            const updateCounter = (timestamp) => {
                if (!startTimestamp) startTimestamp = timestamp;
                const progress = Math.min((timestamp - startTimestamp) / duration, 1);
                const current = target * easeOutQuart(progress);

                counter.innerText = Math.ceil(current);

                if (progress < 1) {
                    requestAnimationFrame(updateCounter);
                } else {
                    counter.innerText = target;
                }
            };
            requestAnimationFrame(updateCounter);
        };

        const counterObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    if (!entry.target.classList.contains('counted')) {
                        animateCounter(entry.target);
                        entry.target.classList.add('counted');
                    }
                } else {
                    entry.target.classList.remove('counted');
                    entry.target.innerText = '0';
                }
            });
        }, counterOptions);

        counters.forEach(counter => counterObserver.observe(counter));
    };

    window.initCounters = initCounters;
});
