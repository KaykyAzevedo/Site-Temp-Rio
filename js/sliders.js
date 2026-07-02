document.addEventListener('DOMContentLoaded', () => {
    window.initSliders = () => {
        const slider = document.getElementById('testimonial-slider');
        const btnPrev = document.getElementById('prev-testimonial');
        const btnNext = document.getElementById('next-testimonial');

        if (slider && btnPrev && btnNext) {
            btnPrev.addEventListener('click', () => {
                slider.scrollBy({ left: -slider.offsetWidth / 2, behavior: 'smooth' });
            });
            btnNext.addEventListener('click', () => {
                slider.scrollBy({ left: slider.offsetWidth / 2, behavior: 'smooth' });
            });
        }
    };
});
