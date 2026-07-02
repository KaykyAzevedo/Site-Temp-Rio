tailwind.config = {
    theme: {
        extend: {
            colors: {
                primary: {
                    400: '#F5A474',
                    500: '#F28C52',
                    600: '#D96E30',
                },
                surface: '#1A1A1A',
                base: '#0D0D0D',
                accent: '#FFF3E8',
                textSecondary: '#BFBFBF',
                borderSubtle: 'rgba(255,255,255,0.08)'
            },
            fontFamily: {
                sans: ['Lato', 'sans-serif'],
                display: ['Barlow Condensed', 'sans-serif'],
            }
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    // Smooth Scrolling setup for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            let targetId = this.getAttribute('href');
            // Fix specific anchor link #diferenciais to #sobre
            if (targetId === '#diferenciais') targetId = '#sobre';
            
            const target = document.querySelector(targetId);
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });

    // Fade In Intersection Observer
    window.initAnimations = () => {
        const fadeElements = document.querySelectorAll('.fade-in:not(.visible)');
        const observerOptions = {
            root: null,
            rootMargin: '0px 0px 150px 0px',
            threshold: 0.05
        };
        const observer = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                    observer.unobserve(entry.target);
                }
            });
        }, observerOptions);
        fadeElements.forEach(el => observer.observe(el));
    };

    // Run once on load for static elements
    window.initAnimations();

    // Video Configuration
    const heroVideo = document.querySelector('#hero-video');
    if (heroVideo) {
        heroVideo.addEventListener('loadedmetadata', () => {
            if (heroVideo.duration > 8) {
                heroVideo.playbackRate = heroVideo.duration / 8;
            }
        });
        heroVideo.loop = true;
        heroVideo.playbackRate = 0.75;
    }
});
