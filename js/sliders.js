// Chamado pelo content-loader depois que os depoimentos são injetados.
window.initSliders = () => {
    const slider = document.getElementById('testimonial-slider');
    const btnPrev = document.getElementById('prev-testimonial');
    const btnNext = document.getElementById('next-testimonial');

    if (!slider || !btnPrev || !btnNext) return;

    btnPrev.addEventListener('click', () => {
        slider.scrollBy({ left: -slider.offsetWidth / 2, behavior: 'smooth' });
    });
    btnNext.addEventListener('click', () => {
        slider.scrollBy({ left: slider.offsetWidth / 2, behavior: 'smooth' });
    });
};
