/* Music screensaver (owner request 2026-11-05): while a song plays and nobody touches the remote, the pad or the mouse for
 * a few minutes (Music app > Settings: 1 to 20 min, or Off), My PC shows a visualizer over everything, with the song and
 * the time. Any key, a click or a touch brings My PC back (that key does nothing else).
 * Styles: Bars (a spectrum with its reflection), Waves (glowing lines that leave a trail), Cover (the song's cover drifting
 * slowly; CSS only, no drawing loop). The TV's own player gives no sound data, so the visualizer follows a made-up beat.
 * Cheap: a 480x270 canvas scaled up, 30 frames a second (20 on a slow TV), nothing at all while it is not shown; the song
 * card moves every 30 s so nothing burns into the screen. Never on the game page (Music.init runs on the desktop page only). */
var MusicSaver = (function () {
    'use strict';

    var W = 480, H = 270, BARS = 40;
    var timer = 0, shown = false, root = null, cv = null, g = null, raf = 0, last = 0, t0 = 0, moveT = 0, clockT = 0, eatUntil = 0;
    var levels = [], peaks = [], style = 'bars', acc = '#4cc2ff', tint = '', trackKey = '', inited = false;

    function t(k) { return I18n.t(k); }
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

    function blocked() {
        return document.hidden || (typeof App !== 'undefined' && App.dialogOpen && App.dialogOpen()) || (typeof Keyboard !== 'undefined' && Keyboard.isOpen()) ||
               (typeof GameHost !== 'undefined' && GameHost.active());
    }
    // (re)starts the wait; only while a song plays and the saver is on
    function arm() {
        clearTimeout(timer); timer = 0;
        var p = Music.prefs(), s = Music.state();
        if (shown) { if (!s.playing && !root._test) hide(); else info(); return; }
        if (p.saver === 'off' || !s.playing) return;
        timer = setTimeout(function () { timer = 0; if (blocked()) return arm(); show(false); }, Math.max(1, +p.saverMin || 2) * 60000);
    }
    function activity() { if (shown) { hide(); eatUntil = Date.now() + 500; } else if (timer) arm(); }
    // from the router (main.js): true = the key was used to leave the screensaver
    function input(pressed) {
        if (shown) { if (pressed) { hide(); eatUntil = Date.now() + 600; } return true; }
        if (!pressed && Date.now() < eatUntil) return true;
        if (timer) arm();
        return false;
    }

    function palette() {
        try { acc = (getComputedStyle(document.documentElement).getPropertyValue('--acc') || '').trim() || '#4cc2ff'; } catch (e) { acc = '#4cc2ff'; }
    }
    function show(test) {
        if (shown) return;
        var p = Music.prefs();
        style = p.saver === 'off' ? 'bars' : p.saver;
        shown = true;
        palette();
        root = el('div', 'mxs mxs-s-' + style);
        root._test = !!test;
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-label', t('muSaver'));
        if (style === 'cover') {
            root.appendChild(el('div', 'mxs-cover-bg'));
            var art = el('div', 'mxs-cover'); root.appendChild(art);
        } else {
            cv = el('canvas', 'mxs-cv');
            cv.width = W; cv.height = H;
            g = cv.getContext('2d');
            root.appendChild(cv);
        }
        var card = el('div', 'mxs-card');
        card.appendChild(el('div', 'mxs-clock'));
        card.appendChild(el('div', 'mxs-title'));
        card.appendChild(el('div', 'mxs-artist'));
        root.appendChild(card);
        root.addEventListener('pointerdown', function (e) { e.preventDefault(); e.stopPropagation(); activity(); }, true);
        document.body.appendChild(root);
        levels = []; peaks = [];
        for (var i = 0; i < BARS; i++) { levels.push(0); peaks.push(0); }
        trackKey = '';
        info();
        place();
        moveT = setInterval(place, 30000);
        clockT = setInterval(clock, 15000);
        t0 = Date.now(); last = 0;
        if (g) raf = requestAnimationFrame(frame);
        if (typeof A11y !== 'undefined') A11y.announce(t('muSaver'));
    }
    function hide() {
        if (!shown) return;
        shown = false;
        cancelAnimationFrame(raf); raf = 0;
        clearInterval(moveT); clearInterval(clockT); moveT = clockT = 0;
        if (cv) { cv.width = cv.height = 0; }
        cv = g = null;
        if (root && root.parentNode) root.parentNode.removeChild(root);
        root = null;
        arm();
    }
    function clock() {
        if (!root) return;
        var d = new Date();
        root.querySelector('.mxs-clock').textContent = typeof Desktop !== 'undefined' && Desktop.timeText ? Desktop.timeText(d) : d.toTimeString().slice(0, 5);
    }
    function place() {
        if (!root) return;
        var c = root.querySelector('.mxs-card');
        c.style.left = (6 + Math.random() * 50) + '%';
        c.style.top = (style === 'cover' ? 62 + Math.random() * 20 : 8 + Math.random() * 18) + '%';
    }
    function info() {
        if (!root) return;
        var s = Music.state();
        clock();
        root.querySelector('.mxs-title').textContent = s.has ? s.title : t('muNothing');
        root.querySelector('.mxs-artist').textContent = s.artist || (s.album || '');
        var k = s.track ? s.track.s + ':' + s.track.p : '';
        if (k === trackKey) return;
        trackKey = k; tint = '';
        if (!s.track) return;
        MusicSrc.art(s.track, function (v) {
            if (!root || trackKey !== k || !v) return;
            tint = v.color || '';
            if (tint) root.style.setProperty('--mx-tint', tint);
            var a = root.querySelector('.mxs-cover');
            if (a) { a.innerHTML = ''; var im = new Image(); im.alt = ''; im.src = v.url; a.appendChild(im); }
        });
    }

    /* ---------------- drawing (made-up beat: the TV's player gives no sound data) ---------------- */
    function beat(time, bpm) { var p = 60 / bpm, x = (time % p) / p; return Math.exp(-x * 6); }
    function frame(now) {
        raf = requestAnimationFrame(frame);
        var fps = typeof Perf !== 'undefined' && Perf.profile().tier === 'low' ? 20 : 30;
        if (now - last < 1000 / fps - 2) return;
        last = now;
        var time = (Date.now() - t0) / 1000, playing = Music.state().playing || (root && root._test), b = playing ? beat(time, 118) : 0;
        if (style === 'waves') waves(time, b, playing); else bars(time, b, playing);
    }
    function bars(time, b, playing) {
        var i, w = W / BARS, mid = H * 0.68;
        g.globalCompositeOperation = 'source-over';
        g.fillStyle = '#05060c';
        g.fillRect(0, 0, W, H);
        var gr = g.createLinearGradient(0, mid - H * 0.6, 0, mid);
        gr.addColorStop(0, acc); gr.addColorStop(1, tint || '#7a5cff');
        for (i = 0; i < BARS; i++) {
            var f = i / BARS;
            var target = playing ? (0.18 + 0.35 * (0.5 + 0.5 * Math.sin(time * (1.3 + f * 3.1) + i * 0.7)) * (0.5 + 0.5 * Math.sin(time * 0.37 + i * 0.21)) +
                         b * (1 - f) * 0.55 + 0.12 * Math.sin(time * 7.3 + i * 1.9) * (0.3 + f)) : 0.02;
            target = Math.max(0.02, Math.min(1, target));
            levels[i] += (target - levels[i]) * (target > levels[i] ? 0.6 : 0.12);
            peaks[i] = Math.max(levels[i], peaks[i] - 0.008);
            var h = levels[i] * H * 0.6, x = i * w + 1;
            g.fillStyle = gr;
            g.fillRect(x, mid - h, w - 3, h);
            g.globalAlpha = 0.22;
            g.fillRect(x, mid + 3, w - 3, h * 0.45);
            g.globalAlpha = 0.9;
            g.fillStyle = '#fff';
            g.fillRect(x, mid - peaks[i] * H * 0.6 - 4, w - 3, 2);
            g.globalAlpha = 1;
        }
    }
    function waves(time, b, playing) {
        g.globalCompositeOperation = 'source-over';
        g.fillStyle = 'rgba(4, 5, 12, 0.2)';
        g.fillRect(0, 0, W, H);
        g.globalCompositeOperation = 'lighter';
        var cols = [acc, tint || '#ff5fa2', '#7a5cff', '#36d6c3'];
        for (var k = 0; k < 4; k++) {
            g.strokeStyle = cols[k];
            g.lineWidth = 2;
            g.globalAlpha = 0.75;
            g.beginPath();
            var amp = (playing ? 30 + 45 * b * (k === 0 ? 1 : 0.5) + 20 * Math.sin(time * 0.6 + k) : 4);
            for (var x = 0; x <= W; x += 6) {
                var y = H / 2 + Math.sin(x * (0.012 + k * 0.004) + time * (1.1 + k * 0.45)) * amp * Math.sin(Math.PI * x / W) +
                        Math.sin(x * 0.05 + time * 3 + k) * amp * 0.15;
                if (x) g.lineTo(x, y); else g.moveTo(x, y);
            }
            g.stroke();
        }
        g.globalAlpha = 1;
    }

    function init() {
        if (inited) return;
        inited = true;
        Music.onChange(function (what) { if (what !== 'loaded' && what !== 'dur') arm(); });
        ['pointermove', 'pointerdown', 'wheel', 'touchstart'].forEach(function (ev) {
            document.addEventListener(ev, activity, { passive: true, capture: true });
        });
        document.addEventListener('visibilitychange', function () { if (document.hidden) hide(); });
        arm();
    }

    return { init: init, input: input, show: show, hide: hide, isOn: function () { return shown; }, _armed: function () { return !!timer; } };
})();
