/* ============================================================
   HERO — rotacao dos temperos em destaque.
   A cada troca: a foto do painel, a cor da secao (--accent), o
   adjetivo da headline e o nome do produto mudam juntos.
   Ranking e nome vem do mesmo criterio de data/produtos.js.
   ============================================================ */
(function () {
    'use strict';

    var PRODUCTS = [
        { img: 'chimichurri',        nome: 'Chimichurri',  rank: 2,  peso: '50g', palavra: 'intenso',      accent: '#D95B2A', soft: '#F7A768', thumbPos: '47% 71%' },
        { img: 'lemon-pepper',       nome: 'Lemon Pepper', rank: 1,  peso: '70g', palavra: 'cítrico',      accent: '#D9A81C', soft: '#F5DC6A', thumbPos: '51% 74%' },
        { img: 'paprica-doce',       nome: 'Páprica Doce', rank: 5,  peso: '60g', palavra: 'adocicado',    accent: '#C4402A', soft: '#F08765', thumbPos: '45% 46%' },
        { img: 'ervas-finas',        nome: 'Ervas Finas',  rank: 16, peso: '15g', palavra: 'aromático',    accent: '#7C9A4E', soft: '#BBD489', thumbPos: '45% 55%' },
        { img: 'pega-marido',        nome: 'Pega Marido',  rank: 11, peso: '50g', palavra: 'irresistível', accent: '#DE8A18', soft: '#F8C46A', thumbPos: '52% 75%' },
        { img: 'colorau-colorifico', nome: 'Colorau',      rank: 9,  peso: '70g', palavra: 'vibrante',     accent: '#D24E1C', soft: '#F59A62', thumbPos: '49% 79%' }
    ];

    var BASE = './assets/images/hero/';
    var THUMB_BASE = './assets/images/hero/thumbs/';   /* versoes de 220px, ~6KB cada */
    var DWELL = 5200;

    var section = document.getElementById('hero-section');
    if (!section) return;

    var stage = section.querySelector('.hero-stage');
    var hlword = section.querySelector('#hero-word');
    var fname = section.querySelector('#hero-fname');
    var fmeta = section.querySelector('#hero-fmeta');
    var thumbsWrap = section.querySelector('#hero-thumbs');
    var panel = section.querySelector('.hero-panel');
    if (!stage || !hlword || !fname || !fmeta || !thumbsWrap || !panel) return;

    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ---------- camadas das fotos ----------
       So a primeira carrega junto com a pagina; as outras entram depois do
       load, para a hero nao custar 600KB no primeiro acesso. */
    var shots = PRODUCTS.map(function (p, i) {
        var d = document.createElement('div');
        d.className = 'hero-shot' + (i === 0 ? ' active' : '');
        if (i === 0) d.style.backgroundImage = "url('" + BASE + p.img + ".jpg')";
        stage.appendChild(d);
        return d;
    });

    function carregarRestantes() {
        shots.forEach(function (s, i) {
            if (i > 0 && !s.style.backgroundImage) {
                s.style.backgroundImage = "url('" + BASE + PRODUCTS[i].img + ".jpg')";
            }
        });
    }
    if (document.readyState === 'complete') setTimeout(carregarRestantes, 200);
    else window.addEventListener('load', function () { setTimeout(carregarRestantes, 200); });

    /* ---------- miniaturas ---------- */
    var thumbs = PRODUCTS.map(function (p, i) {
        var b = document.createElement('button');
        b.className = 'hero-thumb' + (i === 0 ? ' active' : '');
        b.type = 'button';
        b.style.setProperty('--dwell', DWELL + 'ms');
        b.title = p.nome;
        b.setAttribute('aria-label', p.nome + ', ' + p.rank + 'º mais vendido');
        b.innerHTML = '<span class="pic" style="background-image:url(\'' + THUMB_BASE + p.img + '.jpg\');background-position:' + p.thumbPos + '"></span>' +
                      '<span class="prog"></span>';
        b.addEventListener('click', function () { go(i, true); });
        thumbsWrap.appendChild(b);
        return b;
    });

    /* ---------- troca de produto ---------- */
    var idx = 0, timer = null;

    function go(n, fromUser) {
        if (n === idx && !fromUser) return;
        idx = n;
        var p = PRODUCTS[n];

        section.style.setProperty('--accent', p.accent);
        section.style.setProperty('--accent-soft', p.soft);

        shots.forEach(function (s, i) {
            if (i === n && !s.style.backgroundImage) {
                s.style.backgroundImage = "url('" + BASE + PRODUCTS[i].img + ".jpg')";
            }
            s.classList.toggle('active', i === n);
            if (i === n && !reduced) {
                s.style.animation = 'none'; void s.offsetWidth; s.style.animation = '';
            }
        });

        thumbs.forEach(function (t, i) {
            var on = i === n;
            t.classList.toggle('active', on);
            if (on && !reduced) {
                var bar = t.querySelector('.prog');
                bar.style.display = 'none'; void bar.offsetWidth; bar.style.display = '';
            }
        });

        swapWord(p.palavra);
        swapName(p);
        burst();
        schedule();
    }

    function swapWord(word) {
        if (reduced) { hlword.textContent = word; return; }
        hlword.style.animation = 'heroWordOut .3s cubic-bezier(.5,0,.75,0) forwards';
        setTimeout(function () {
            hlword.textContent = word;
            hlword.style.animation = 'none'; void hlword.offsetWidth;
            hlword.style.animation = 'heroWordIn .55s cubic-bezier(.16,.85,.24,1) forwards';
        }, 300);
    }

    function swapName(p) {
        var meta = p.rank + 'º mais vendido · pote ' + p.peso;
        if (reduced) { fname.textContent = p.nome; fmeta.textContent = meta; return; }
        fname.style.animation = 'heroNameOut .28s cubic-bezier(.5,0,.75,0) forwards';
        setTimeout(function () {
            fname.textContent = p.nome;
            fmeta.textContent = meta;
            fname.style.animation = 'none'; void fname.offsetWidth;
            fname.style.animation = 'heroNameIn .55s cubic-bezier(.16,.85,.24,1) forwards';
        }, 280);
    }

    function schedule() {
        clearTimeout(timer);
        timer = setTimeout(function () { go((idx + 1) % PRODUCTS.length); }, DWELL);
    }

    document.addEventListener('visibilitychange', function () {
        if (document.hidden) clearTimeout(timer); else schedule();
    });
    thumbsWrap.addEventListener('mouseenter', function () { clearTimeout(timer); });
    thumbsWrap.addEventListener('mouseleave', schedule);

    /* ---------- po de tempero no ar ---------- */
    var cv = section.querySelector('#hero-dust');
    var ctx = cv ? cv.getContext('2d') : null;
    var W = 0, H = 0, rgb = [247, 167, 104], parts = [];

    function hexToRgb(hex) {
        var h = hex.replace('#', '');
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }

    function resize() {
        if (!ctx) return;
        var r = panel.getBoundingClientRect();
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        W = r.width; H = r.height;
        cv.width = W * dpr; cv.height = H * dpr;
        cv.style.width = W + 'px'; cv.style.height = H + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function spawn(burstMode) {
        var cx = W * 0.5, cy = H * 0.55;
        return {
            x: burstMode ? cx + (Math.random() - 0.5) * W * 0.5 : Math.random() * W,
            y: burstMode ? cy + (Math.random() - 0.5) * H * 0.3 : H * (0.5 + Math.random() * 0.55),
            r: Math.random() * 1.6 + 0.35,
            vx: (Math.random() - 0.5) * (burstMode ? 1.4 : 0.2),
            vy: -(Math.random() * (burstMode ? 1.0 : 0.28) + 0.05),
            life: 1, dec: burstMode ? 0.011 : 0.003, ph: Math.random() * 6.283
        };
    }

    function burst() {
        if (reduced || !ctx) return;
        for (var i = 0; i < 40; i++) parts.push(spawn(true));
    }

    var t = 0;
    function frame() {
        t += 0.016;
        ctx.clearRect(0, 0, W, H);
        while (parts.length < 70) parts.push(spawn(false));
        for (var i = parts.length - 1; i >= 0; i--) {
            var p = parts[i];
            p.x += p.vx + Math.sin(t * 0.7 + p.ph) * 0.15;
            p.y += p.vy; p.life -= p.dec;
            if (p.life <= 0 || p.y < -10) { parts.splice(i, 1); continue; }
            ctx.beginPath();
            ctx.fillStyle = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + (p.life * 0.6).toFixed(3) + ')';
            ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
        }
        var target = hexToRgb(PRODUCTS[idx].soft);
        for (var k = 0; k < 3; k++) rgb[k] += (target[k] - rgb[k]) * 0.04;
        requestAnimationFrame(frame);
    }

    /* ---------- parallax no painel ---------- */
    var mx = 0, my = 0, sx = 0, sy = 0, on = false;
    function parallax() {
        sx += (mx - sx) * 0.07; sy += (my - sy) * 0.07;
        stage.style.transform = 'translate(' + (-sx * 14).toFixed(2) + 'px,' + (-sy * 10).toFixed(2) + 'px)';
        requestAnimationFrame(parallax);
    }
    if (!reduced && window.matchMedia('(pointer:fine)').matches) {
        panel.addEventListener('pointermove', function (e) {
            var r = panel.getBoundingClientRect();
            mx = (e.clientX - r.left) / r.width - 0.5;
            my = (e.clientY - r.top) / r.height - 0.5;
            if (!on) { on = true; parallax(); }
        });
        panel.addEventListener('pointerleave', function () { mx = 0; my = 0; });
    }

    /* ---------- contadores ---------- */
    function count(el, to, suffix, dur) {
        if (!el) return;
        if (reduced) { el.textContent = to + suffix; return; }
        var t0 = performance.now();
        (function step(now) {
            var k = Math.min((now - t0) / dur, 1), e = 1 - Math.pow(1 - k, 3);
            el.textContent = Math.round(to * e) + (k === 1 ? suffix : '');
            if (k < 1) requestAnimationFrame(step);
        })(t0);
    }

    /* ---------- boot ---------- */
    resize();
    window.addEventListener('resize', resize);

    var c1 = section.querySelector('#hero-c1');
    var c2 = section.querySelector('#hero-c2');

    if (!reduced) {
        if (ctx) requestAnimationFrame(frame);
        setTimeout(function () {
            count(c1, 70, '+', 1500);
            count(c2, 500, '+', 1700);
        }, 1000);
        schedule();
    } else {
        if (c1) c1.textContent = '70+';
        if (c2) c2.textContent = '500+';
    }
})();
