/* Music audio visualizer (owner requests 2026-11-05 and 2026-11-06; it was called the screensaver): while a song plays and
 * nobody touches the remote, the pad or the mouse for a few minutes (Music app > Settings: 1 to 20 min, or Off; Now playing's
 * Audio visualizer button and Settings > Try open it any time), My PC shows it over everything: the song top left, the time top
 * right. CH + / CH − (PageUp / PageDown, LB / RB) change the style in place and keep it; any other key, a click or a touch brings
 * My PC back (that key does nothing else).
 * Styles (CH order): Bars (a spectrum with its reflection), Waveform (the song's real waveform as two glowing lines), Waves (four
 * lines, low to high notes), Particles (small glowing dots thrown out by the music, at most 140), Pulsating rings (circles that
 * breathe with the bass, ripples on the beats), Ring (the round cover in a circle of bars that turns), Cover (the song's cover
 * drifting slowly, beating with the bass).
 * The sound comes from MusicViz (js/core/music-viz.js): the song's REAL sound at its current moment, never made up; flat when
 * there is nothing to hear. This file only draws it.
 * 60 frames a second (owner rule 2026-11-06), so every frame is cheap: a small canvas scaled up by the GPU, no shadowBlur, no
 * gradient or string made per frame (the glows are pre-drawn sprites or a wide faint line under a thin one), nothing allocated
 * per frame; the movement is scaled by the real time between frames. Nothing at all runs while it is not shown; the top bar
 * moves a few pixels every 30 s so nothing burns into the screen. Never on the game page (Music.init runs on the desktop page only). */
var MusicSaver = (function () {
    'use strict';

    var STYLES = ['bars', 'scope', 'waves', 'particles', 'pulse', 'ring', 'cover'];
    var NAMES = { bars: 'muSaverBars', scope: 'muSaverScope', waves: 'muSaverWaves', particles: 'muSaverParticles', pulse: 'muSaverPulse', ring: 'muSaverRing', cover: 'muSaverCover' };
    // canvas size per style (the low tier draws 2/3 of it)
    var SIZE = { bars: [480, 270], waves: [480, 270], scope: [640, 360], particles: [640, 360], pulse: [640, 360], ring: [640, 360] };
    var BANDS = MusicViz.BANDS;
    var W = 480, H = 270;
    var timer = 0, shown = false, root = null, cv = null, g = null, raf = 0, last = 0, moveT = 0, clockT = 0, eatUntil = 0, nameT = 0;
    var shownAt = 0, px = -1, py = -1, style = 'bars', acc = '#4cc2ff', tint = '', trackKey = '', inited = false, isTest = false, lastSwitch = 0;
    var coverEl = null, glowEl = null, spin = 0, cols = [], srcNow = '';
    // what is heard now: dB per band, then 0..1 shown (fast up, slower down), the peaks, the bass
    var db = new Float32Array(BANDS), lv = new Float32Array(BANDS), peaks = new Float32Array(BANDS), tilt = new Float32Array(BANDS), bass = 0, ceil = -40;
    var bassSlow = 0, bassPrev = 0, hitAt = 0, hit = false, energy = 0;
    // drawing caches (made when the style, the size or the colours change; never per frame)
    var gc = null, gg = null, barGrad = null, sprites = [], ringStr = [], c3 = ['', '', ''];
    // the frame clock, for the tests: frames drawn, the time they took, the worst gap, the gaps over 20 ms
    var stat = { n: 0, ms: 0, worst: 0, slow: 0, from: 0 };
    (function () {
        // music is louder in the low notes: +3.5 dB an octave above 200 Hz so the right side moves too
        var r = MusicViz.HI_HZ / MusicViz.LO_HZ;
        for (var b = 0; b < BANDS; b++) { var fc = MusicViz.LO_HZ * Math.pow(r, (b + 0.5) / BANDS); tilt[b] = 3.5 * Math.max(0, Math.log(fc / 200) / Math.LN2); }
    })();

    function t(k) { return I18n.t(k); }
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
    function lowTier() { return typeof Perf !== 'undefined' && Perf.profile().tier === 'low'; }

    function blocked() {
        return document.hidden || (typeof App !== 'undefined' && App.dialogOpen && App.dialogOpen()) || (typeof Keyboard !== 'undefined' && Keyboard.isOpen()) ||
               (typeof GameHost !== 'undefined' && GameHost.active());
    }
    // (re)starts the wait; only while a song plays and the visualizer is on
    function arm() {
        clearTimeout(timer); timer = 0;
        var p = Music.prefs(), s = Music.state();
        if (shown) { if (!s.playing && !isTest) hide(); else info(); return; }
        if (p.saver === 'off' || !s.playing) return;
        timer = setTimeout(function () { timer = 0; if (blocked()) return arm(); show(false); }, Math.max(1, +p.saverMin || 2) * 60000);
    }
    // a click or a pointer that really moves; not the click that opened it (Now playing's button) and not a
    // mouse / Magic Remote pointer resting (it sends small moves on its own)
    function activity(e) {
        if (shown && Date.now() - shownAt < 1200) return;
        if (e && e.type === 'pointermove') {
            if (px < 0) { px = e.clientX; py = e.clientY; return; }          // where it rests: not a move
            if (Math.abs(e.clientX - px) + Math.abs(e.clientY - py) <= 24) return;
            px = e.clientX; py = e.clientY;
        }
        if (shown) { hide(); eatUntil = Date.now() + 500; } else if (timer) arm();
    }
    // from the router (main.js): true = the key was used by the visualizer (CH + / CH − change the style, others close it)
    function input(pressed, action) {
        if (shown) {
            if (action === 'pageUp' || action === 'pageDown') {
                if (pressed && Date.now() - lastSwitch > 180) { lastSwitch = Date.now(); next(action === 'pageUp' ? 1 : -1); }
                return true;
            }
            // (one OK press gives several actions, confirm then jump: the rest of the press that opened it does not close it)
            if (pressed && Date.now() - shownAt > 250) { hide(); eatUntil = Date.now() + 600; }
            return true;
        }
        if (!pressed && Date.now() < eatUntil) return true;
        if (timer) arm();
        return false;
    }

    // dB -> what is shown: follows the song's loudness (a quiet song moves as much as a loud one); silence = flat.
    // k = frames of 1/30 s since the last one (the same speed at 30 or 60 frames a second)
    var kA = 0, kR = 0;
    function shape(k) {
        var i, top = -200, v, up = 1 - Math.pow(0.25, k), down = 1 - Math.pow(0.8, k), fall = 0.012 * k;
        for (i = 0; i < BANDS; i++) { v = db[i] + tilt[i]; if (v > top) top = v; }
        ceil = top > ceil ? top : Math.max(-62, ceil - 0.12 * k);
        var lo = ceil - 46, b = 0, e = 0;
        for (i = 0; i < BANDS; i++) {
            v = db[i] < -105 ? 0 : (db[i] + tilt[i] - lo) / 46;
            v = v < 0 ? 0 : v > 1 ? 1 : v * v * (1.6 - 0.6 * v);              // a little contrast
            lv[i] += (v - lv[i]) * (v > lv[i] ? up : down);
            peaks[i] = Math.max(lv[i], peaks[i] - fall);
            if (i < 6) b += lv[i];
            e += lv[i];
        }
        bassPrev = bass;
        bass = b / 6; energy = e / BANDS;
        bassSlow += (bass - bassSlow) * (1 - Math.pow(0.92, k));
        // a beat: the bass jumps above its average (at most ~5 a second)
        var now = performance.now();
        hit = bass > 0.25 && bass - bassPrev > 0.05 * Math.min(2, k) && bass > bassSlow * 1.12 && now - hitAt > 190;
        if (hit) hitAt = now;
    }

    /* ---------------- show / hide ---------------- */
    function palette() {
        try { acc = (getComputedStyle(document.documentElement).getPropertyValue('--acc') || '').trim() || '#4cc2ff'; } catch (e) { acc = '#4cc2ff'; }
    }
    function rgb(c) {
        var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c || '');
        if (m) { var h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1]; return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
        m = /rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i.exec(c || '');
        return m ? [+m[1], +m[2], +m[3]] : null;
    }
    function mix(a, b, f) { return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * f) + ',' + Math.round(a[1] + (b[1] - a[1]) * f) + ',' + Math.round(a[2] + (b[2] - a[2]) * f) + ')'; }
    // a soft round glow, drawn once: the particles and the centres are copies of it (drawImage: no gradient per frame)
    function sprite(c) {
        var s = el('canvas'), x = s.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
        s.width = s.height = 64;
        gr.addColorStop(0, 'rgba(255,255,255,1)');
        gr.addColorStop(0.18, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',0.9)');
        gr.addColorStop(0.45, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',0.28)');
        gr.addColorStop(1, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',0)');
        x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
        return s;
    }
    // every colour the drawing needs, from the theme's accent and the cover's colour
    function colours() {
        var a = rgb(acc) || [76, 194, 255], b = rgb(tint) || [160, 92, 255], v = [122, 92, 255], i;
        cols = [];
        for (i = 0; i < BANDS; i++) cols.push(mix(a, b, i / (BANDS - 1)));
        c3 = [mix(b, b, 0), mix(a, a, 0), mix(a, [255, 255, 255], 0.55)];
        ringStr = [];
        for (i = 0; i < 7; i++) ringStr.push(mix(b, a, i / 6));
        barGrad = null;
        if (g) {
            barGrad = g.createLinearGradient(0, H * 0.15, 0, H * 0.7);
            barGrad.addColorStop(0, acc); barGrad.addColorStop(1, tint || mix(v, v, 0));
        }
        if (style === 'particles' || style === 'pulse' || style === 'ring') sprites = [sprite(b), sprite(a), sprite(rgb(c3[2])), sprite(rgb(tint) || a)];
    }
    function pick() {
        var p = Music.prefs(), s = p.saver !== 'off' ? p.saver : p.vizStyle;
        return STYLES.indexOf(s) >= 0 ? s : 'bars';
    }
    function show(test) {
        if (shown) return;
        shown = true; shownAt = Date.now(); px = py = -1; isTest = !!test;
        palette();
        style = pick();
        for (var i = 0; i < BANDS; i++) { lv[i] = peaks[i] = 0; db[i] = -200; }
        ceil = -40; bass = bassSlow = bassPrev = energy = 0; spin = 0; srcNow = '';
        MusicViz.start();
        build();
        moveT = setInterval(shift, 30000);
        clockT = setInterval(clock, 15000);
        raf = requestAnimationFrame(frame);
        if (typeof A11y !== 'undefined') A11y.announce(t('muSaver') + ', ' + t(NAMES[style]));
    }
    // the view of the current style (also when CH + / CH − change it)
    function build() {
        root = el('div', 'mxs mxs-s-' + style);
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-label', t('muSaver'));
        coverEl = glowEl = cv = g = gc = gg = null;
        if (style === 'cover') {
            root.appendChild(el('div', 'mxs-cover-bg'));
            var drift = el('div', 'mxs-drift');
            glowEl = el('i', 'mxs-glow'); drift.appendChild(glowEl);
            coverEl = el('div', 'mxs-cover'); drift.appendChild(coverEl);
            root.appendChild(drift);
        } else {
            var sz = SIZE[style], f = lowTier() ? 2 / 3 : 1;
            W = Math.round(sz[0] * f); H = Math.round(sz[1] * f);
            cv = el('canvas', 'mxs-cv');
            cv.width = W; cv.height = H;
            // the glows: a canvas 4 times smaller under this one, stretched by the GPU: soft and cheap (no blur, no wide lines,
            // never copied into the picture: that copy cost more than all the rest)
            var two = style === 'scope' || style === 'pulse';
            if (two) { gc = el('canvas', 'mxs-cv mxs-glowcv'); gc.width = Math.ceil(W / 4); gc.height = Math.ceil(H / 4); gg = gc.getContext('2d', { alpha: false }); root.appendChild(gc); }
            g = cv.getContext('2d', { alpha: style === 'ring' || two });
            if (style === 'ring') {
                var stage = el('div', 'mxs-stage');
                stage.appendChild(cv);
                coverEl = el('div', 'mxs-cover'); stage.appendChild(coverEl);
                root.appendChild(stage);
            } else root.appendChild(cv);
        }
        // the song top left (with its cover, small, where the cover is not the show), the time top right
        var top = el('div', 'mxs-top'), song = el('div', 'mxs-song'), txt = el('div', 'mxs-txt');
        if (style !== 'cover' && style !== 'ring') song.appendChild(el('div', 'mxs-thumb'));
        txt.appendChild(el('div', 'mxs-title'));
        txt.appendChild(el('div', 'mxs-artist'));
        song.appendChild(txt);
        top.appendChild(song);
        top.appendChild(el('div', 'mxs-clock'));
        root.appendChild(top);
        root.appendChild(el('div', 'mxs-name'));
        root.addEventListener('pointerdown', function (e) { e.preventDefault(); e.stopPropagation(); activity(e); }, true);
        if (srcNow) root.setAttribute('data-src', srcNow);
        document.body.appendChild(root);
        trackKey = '';
        pool = 0; ripN = 0; waveOk = false;
        for (var i = 0; i < SC.length; i++) SC[i] = SL[i] = 0;
        colours();
        info();
        last = 0; stat.n = stat.ms = stat.worst = stat.slow = 0; stat.from = 0;
    }
    function unbuild() {
        if (cv) { cv.width = cv.height = 0; }
        cv = g = null; if (gc) gc.width = gc.height = 0; gc = gg = null; coverEl = glowEl = null; sprites = []; barGrad = null;
        if (root && root.parentNode) root.parentNode.removeChild(root);
        root = null;
    }
    // CH + / CH −: the next / previous style, kept for next time
    function next(d) {
        var i = STYLES.indexOf(style);
        style = STYLES[(i + d + STYLES.length) % STYLES.length];
        unbuild();
        build();
        var p = Music.prefs();
        Music.setPref('vizStyle', style);
        if (p.saver !== 'off') Music.setPref('saver', style);
        var n = root.querySelector('.mxs-name');
        n.textContent = t(NAMES[style]);
        n.classList.add('on');
        clearTimeout(nameT);
        nameT = setTimeout(function () { if (n) n.classList.remove('on'); }, 1600);
        if (typeof A11y !== 'undefined') A11y.announce(t(NAMES[style]));
    }
    function hide() {
        if (!shown) return;
        shown = false;
        cancelAnimationFrame(raf); raf = 0;
        clearInterval(moveT); clearInterval(clockT); clearTimeout(nameT); moveT = clockT = nameT = 0;
        MusicViz.stop();                                                       // nothing runs while it is hidden
        unbuild();
        arm();
    }
    function clock() {
        if (!root) return;
        var d = new Date();
        root.querySelector('.mxs-clock').textContent = typeof Desktop !== 'undefined' && Desktop.timeText ? Desktop.timeText(d) : d.toTimeString().slice(0, 5);
    }
    // a few pixels every 30 s: nothing stays on the same pixels
    function shift() {
        if (!root) return;
        root.querySelector('.mxs-top').style.transform = 'translate(' + (Math.random() * 2.4 - 1.2).toFixed(2) + 'vh, ' + (Math.random() * 1.6 - 0.8).toFixed(2) + 'vh)';
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
        colours();
        root.style.setProperty('--mx-glow', acc);
        var th = root.querySelector('.mxs-thumb');
        if (th) th.innerHTML = '';
        if (coverEl) coverEl.innerHTML = '';
        if (!s.track) return;
        MusicSrc.art(s.track, function (v) {
            if (!root || trackKey !== k || !v) return;
            tint = v.color || '';
            if (tint) { root.style.setProperty('--mx-tint', tint); root.style.setProperty('--mx-glow', tint); colours(); }
            [coverEl, root.querySelector('.mxs-thumb')].forEach(function (box) {
                if (!box) return;
                box.innerHTML = ''; var im = new Image(); im.alt = ''; im.src = v.url; box.appendChild(im);
            });
        });
    }

    /* ---------------- drawing ---------------- */
    function frame(now) {
        raf = requestAnimationFrame(frame);
        if (last && now - last < 12) return;                                  // 60 a second, also on a 120 Hz screen
        var gap = last ? now - last : 1000 / 60, k = Math.min(gap, 100) / (1000 / 30), dt = Math.min(gap, 100) / 1000;
        if (last) { stat.n++; if (gap > stat.worst) stat.worst = gap; if (gap > 20) stat.slow++; }
        last = now;
        var t0 = performance.now(), was = srcNow;
        srcNow = MusicViz.read(db);
        if (srcNow !== was && root) root.setAttribute('data-src', srcNow);
        shape(k);
        if (style === 'bars') bars();
        else if (style === 'scope') scope(k);
        else if (style === 'waves') waves(now / 1000, k);
        else if (style === 'particles') particles(dt);
        else if (style === 'pulse') pulse(dt);
        else if (style === 'ring') ring(k);
        // the cover beats with the bass (transform and opacity only: no repaint)
        if (coverEl) coverEl.style.transform = 'scale(' + (1 + bass * 0.07).toFixed(3) + ')';
        if (glowEl) glowEl.style.opacity = (0.08 + bass * 0.6).toFixed(3);
        stat.ms += performance.now() - t0;
    }
    function bars() {
        var i, w = W / BANDS, mid = H * 0.7, top = H * 0.55, bw = w - 3 * W / 480;
        g.fillStyle = '#05060c';
        g.fillRect(0, 0, W, H);
        g.fillStyle = barGrad;
        for (i = 0; i < BANDS; i++) { var h = Math.max(1, lv[i] * top); g.fillRect(i * w + 1, mid - h, bw, h); }
        g.globalAlpha = 0.22;
        for (i = 0; i < BANDS; i++) g.fillRect(i * w + 1, mid + 3, bw, Math.max(1, lv[i] * top) * 0.45);
        g.globalAlpha = 0.9;
        g.fillStyle = '#fff';
        for (i = 0; i < BANDS; i++) g.fillRect(i * w + 1, mid - peaks[i] * top - 4, bw, 2);
        g.globalAlpha = 1;
    }
    // Waveform: the song's real waveform (MusicViz.wave), a bright line with a soft glow, and a second calmer line that follows it
    var SN = MusicViz.WAVE, SW = new Float32Array(SN), SC = new Float32Array(SN), SL = new Float32Array(SN), sGain = 1, waveOk = false;
    function scope(k) {
        var i, mid = H * 0.56, ok = MusicViz.wave(SW), pk = 0, f = 1 - Math.pow(0.55, k), fl = 1 - Math.pow(0.88, k);
        if (!ok || srcNow === 'wait' || srcNow === 'none') for (i = 0; i < SN; i++) SW[i] = 0;
        for (i = 0; i < SN; i++) { var a = SW[i] < 0 ? -SW[i] : SW[i]; if (a > pk) pk = a; }
        // the height follows the song's loudness slowly (a quiet song still shows its shape); silence = a still line
        var want = pk > 0.004 ? 0.4 / pk : sGain;
        sGain += (Math.min(40, want) - sGain) * (want < sGain ? 0.3 : 0.04) * Math.min(2, k);
        for (i = 0; i < SN; i++) { var v = SW[i] * sGain; v = v > 0.5 ? 0.5 : v < -0.5 ? -0.5 : v; SC[i] += (v - SC[i]) * f; SL[i] += (SC[i] - SL[i]) * fl; }
        // the glow: both lines on the small canvas under this one (the GPU stretches it: soft and free)
        gg.setTransform(1, 0, 0, 1, 0, 0);
        gg.fillStyle = '#05060c';
        gg.fillRect(0, 0, gc.width, gc.height);
        gg.setTransform(0.25, 0, 0, 0.25, 0, 0);
        gg.lineJoin = 'round';
        path(gg, SL, mid + H * 0.012, H * 0.9); gg.strokeStyle = c3[0]; gg.globalAlpha = 0.5; gg.lineWidth = H * 0.02; gg.stroke();
        path(gg, SC, mid, H); gg.strokeStyle = c3[1]; gg.globalAlpha = 0.6 + bass * 0.4; gg.lineWidth = H * 0.036; gg.stroke();
        gg.globalAlpha = 1; gg.lineWidth = H * 0.012; gg.stroke();
        gg.globalAlpha = 1;
        g.globalAlpha = 1;
        g.clearRect(0, 0, W, H);
        g.lineJoin = 'round';
        g.globalCompositeOperation = 'lighter';
        // the calm line: the tint, a little lower; the waveform: the accent under a thin bright line
        path(g, SL, mid + H * 0.012, H * 0.9);
        g.strokeStyle = c3[0]; g.globalAlpha = 0.6; g.lineWidth = H * 0.004; g.stroke();
        path(g, SC, mid, H);
        g.strokeStyle = c3[2]; g.globalAlpha = 0.95; g.lineWidth = H * 0.006; g.stroke();
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
    }
    // the line through the points (128 over the width: smooth enough with straight steps, cheaper than curves), quiet at both ends
    var ENV = new Float32Array(MusicViz.WAVE);
    for (var e0 = 0; e0 < ENV.length; e0++) ENV[e0] = Math.sin(Math.PI * e0 / (ENV.length - 1));
    function path(g, a, mid, amp) {
        var n = a.length, dx = W * 0.84 / (n - 1), x0 = W * 0.08;
        g.beginPath();
        g.moveTo(x0, mid);
        for (var i = 1; i < n; i++) g.lineTo(x0 + i * dx, mid - a[i] * amp * ENV[i]);
    }
    // four lines: low, low-middle, high-middle and high notes; each one's height is that part of the sound now
    function waves(time, k) {
        g.globalCompositeOperation = 'source-over';
        g.fillStyle = '#04050c';
        g.globalAlpha = 1 - Math.pow(0.76, k);                                // the same trail at any frame rate
        g.fillRect(0, 0, W, H);
        g.globalCompositeOperation = 'lighter';
        g.lineWidth = 2;
        g.globalAlpha = 0.8;
        var per = BANDS / 4;
        for (var q = 0; q < 4; q++) {
            var e = 0, j;
            for (j = 0; j < per; j++) e += lv[q * per + j];
            e /= per;
            g.strokeStyle = q === 0 ? acc : q === 1 ? (tint || '#ff5fa2') : q === 2 ? '#7a5cff' : '#36d6c3';
            g.beginPath();
            for (var x = 0; x <= W; x += 6) {
                // the line's shape: the band under it along the line, so the curve is the spectrum of its part
                var fx = x / W * (per - 1), j0 = Math.floor(fx), j1 = Math.min(per - 1, j0 + 1), env = Math.sin(Math.PI * x / W);
                var amp = (6 + e * 70 + (lv[q * per + j0] * (1 + j0 - fx) + lv[q * per + j1] * (fx - j0)) * 30) * env;
                var y = H / 2 + Math.sin(x * (0.018 + q * 0.006) + time * (1.4 + q * 0.6)) * amp;
                if (x) g.lineTo(x, y); else g.moveTo(x, y);
            }
            g.stroke();
        }
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
    }
    // Particles: thrown out from the middle by the notes (speed and size = that note's level), a burst on each beat; at most PMAX
    var PMAX = 140, pool = 0, spawnAcc = 0, swirl = 0;
    var pX = new Float32Array(PMAX), pY = new Float32Array(PMAX), pVX = new Float32Array(PMAX), pVY = new Float32Array(PMAX),
        pL = new Float32Array(PMAX), pM = new Float32Array(PMAX), pS = new Float32Array(PMAX), pC = new Uint8Array(PMAX), pB = new Uint8Array(PMAX);
    function spawn(boost) {
        var max = lowTier() ? 80 : PMAX;
        if (pool >= max) return;
        var b = 0, tries = 0;
        do { b = (Math.random() * BANDS) | 0; } while (lv[b] < 0.12 && ++tries < 4);
        var s = W / 640, l = lv[b], a = Math.random() * 6.2832, sp = (40 + l * 230 + boost) * s, r = (24 + bass * 30) * s, i = pool++;
        pX[i] = W / 2 + Math.cos(a) * r; pY[i] = H / 2 + Math.sin(a) * r;
        pVX[i] = Math.cos(a) * sp; pVY[i] = Math.sin(a) * sp;
        pM[i] = pL[i] = 1.1 + Math.random() * 1.6;
        pS[i] = (5 + l * 13 + Math.random() * 3) * s;
        pB[i] = b; pC[i] = b < 10 ? 0 : b < 26 ? 1 : 2;
    }
    function particles(dt) {
        var i, s = W / 640;
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = 1;
        g.fillStyle = '#05060c';
        g.fillRect(0, 0, W, H);
        // new ones while there is sound, a burst and a push on the beat
        if (energy > 0.03) spawnAcc += dt * (6 + 260 * energy * energy);
        while (spawnAcc >= 1) { spawnAcc -= 1; spawn(0); }
        if (hit) for (i = 0; i < 14; i++) spawn(160 * bass);
        swirl = 0.35 + bass * 0.9;
        var cs = Math.cos(swirl * dt), sn = Math.sin(swirl * dt), damp = Math.pow(0.55, dt), kick = hit ? 1 + bass * 0.9 : 1;
        g.globalCompositeOperation = 'lighter';
        // the middle: a soft glow that beats with the bass
        var cr = (60 + bass * 90) * s;
        g.globalAlpha = 0.18 + bass * 0.5;
        g.drawImage(sprites[0], W / 2 - cr, H / 2 - cr, cr * 2, cr * 2);
        for (i = 0; i < pool; i++) {
            pL[i] -= dt;
            var x = pX[i], y = pY[i];
            if (pL[i] <= 0 || x < -20 || y < -20 || x > W + 20 || y > H + 20) {
                // the last one takes its place (no hole, no allocation)
                pool--; if (i === pool) break;
                pX[i] = pX[pool]; pY[i] = pY[pool]; pVX[i] = pVX[pool]; pVY[i] = pVY[pool]; pL[i] = pL[pool]; pM[i] = pM[pool]; pS[i] = pS[pool]; pC[i] = pC[pool]; pB[i] = pB[pool];
                i--; continue;
            }
            var vx = pVX[i] * cs - pVY[i] * sn, vy = pVX[i] * sn + pVY[i] * cs;
            vx *= damp * kick; vy *= damp * kick;
            pVX[i] = vx; pVY[i] = vy;
            x += vx * dt; y += vy * dt; pX[i] = x; pY[i] = y;
            var f = pL[i] / pM[i], r = pS[i] * (0.6 + lv[pB[i]] * 0.8);
            g.globalAlpha = (f > 0.7 ? (1 - f) / 0.3 : f / 0.7) * (0.55 + lv[pB[i]] * 0.45);
            g.drawImage(sprites[pC[i]], x - r, y - r, r * 2, r * 2);
        }
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
    }
    // Pulsating rings: 7 circles, the inner ones the low notes; they breathe with their notes and the bass; ripples on the beats
    var RIP = 6, ripA = new Float32Array(RIP), ripS = new Float32Array(RIP), ripN = 0, ringLv = new Float32Array(7), ringR = new Float32Array(7);
    function pulse(dt) {
        var i, j, cx = W / 2, cy = H * 0.54, min = H, per = BANDS / 7;
        for (i = 0; i < 7; i++) {
            var e = 0; for (j = Math.floor(i * per); j < Math.floor((i + 1) * per); j++) e += lv[j];
            ringLv[i] = e / (Math.floor((i + 1) * per) - Math.floor(i * per));
            ringR[i] = min * (0.08 + i * 0.058) * (1 + ringLv[i] * 0.22) + bass * min * 0.05 * (1 - i / 10);
        }
        // the glow of the rings: wide circles on the small canvas under this one (the GPU stretches it: soft and free)
        gg.setTransform(1, 0, 0, 1, 0, 0);
        gg.globalAlpha = 1;
        gg.fillStyle = '#05060c';
        gg.fillRect(0, 0, gc.width, gc.height);
        gg.setTransform(0.25, 0, 0, 0.25, 0, 0);
        for (i = 0; i < 7; i++) {
            gg.strokeStyle = ringStr[i]; gg.globalAlpha = 0.25 + ringLv[i] * 0.6; gg.lineWidth = min * (0.025 + ringLv[i] * 0.035);
            gg.beginPath(); gg.arc(cx, cy, ringR[i], 0, 6.2832); gg.stroke();
        }
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = 1;
        g.clearRect(0, 0, W, H);
        g.globalCompositeOperation = 'lighter';
        var cr = min * (0.16 + bass * 0.2);
        g.globalAlpha = 0.25 + bass * 0.55;
        g.drawImage(sprites[0], cx - cr, cy - cr, cr * 2, cr * 2);
        // the beats: a ripple from the middle to the edge
        if (hit) { ripA[ripN % RIP] = 0; ripS[ripN % RIP] = 0.6 + bass; ripN++; }
        g.strokeStyle = c3[2];
        for (i = 0; i < RIP && i < ripN; i++) {
            if (ripA[i] > 1) continue;
            ripA[i] += dt / 1.5;
            var a = ripA[i], rr = min * (0.1 + a * 0.75);
            g.globalAlpha = (1 - a) * (1 - a) * 0.35 * ripS[i];
            g.lineWidth = min * 0.006;
            g.beginPath(); g.arc(cx, cy, rr, 0, 6.2832); g.stroke();
        }
        for (i = 0; i < 7; i++) {
            var l = ringLv[i];
            g.strokeStyle = ringStr[i];
            g.beginPath(); g.arc(cx, cy, ringR[i], 0, 6.2832);
            g.globalAlpha = 0.4 + l * 0.6; g.lineWidth = min * (0.004 + l * 0.005); g.stroke();
        }
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
    }
    // Ring: bars around the cover, the low notes at the top, mirrored left and right; it turns faster with the bass
    function ring(k) {
        var cx = W / 2, cy = H / 2, r0 = H * 0.215, len = H * 0.25, n = BANDS * 2, step = 2 * Math.PI / n;
        g.clearRect(0, 0, W, H);
        spin += (0.002 + bass * 0.012) * k;
        // the bass glow: the pre-drawn glow, sized by the bass
        var gr = (r0 + len * (0.6 + bass)) * 1.25;
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = 0.16 + bass * 0.4;
        g.drawImage(sprites[3], cx - gr, cy - gr, gr * 2, gr * 2);
        g.globalAlpha = 1;
        g.lineCap = 'butt';
        g.lineWidth = (2 * Math.PI * r0 / n) * 0.55;
        g.globalCompositeOperation = 'lighter';
        // one path per band: its bar on the right and its mirror on the left
        var r1 = r0 + 3;
        for (var b = 0; b < BANDS; b++) {
            var r2 = r1 + 2 + lv[b] * len, a1 = spin + (b + 0.5) * step - Math.PI / 2, a2 = spin + (n - 1 - b + 0.5) * step - Math.PI / 2;
            var c1 = Math.cos(a1), s1 = Math.sin(a1), c2 = Math.cos(a2), s2 = Math.sin(a2);
            g.strokeStyle = cols[b];
            g.beginPath();
            g.moveTo(cx + c1 * r1, cy + s1 * r1); g.lineTo(cx + c1 * r2, cy + s1 * r2);
            g.moveTo(cx + c2 * r1, cy + s2 * r1); g.lineTo(cx + c2 * r2, cy + s2 * r2);
            g.stroke();
        }
        // the peaks, dots that fall back slowly (one colour, one pass)
        g.fillStyle = '#fff';
        g.globalAlpha = 0.55;
        for (var i = 0; i < n; i++) {
            var bb = i < BANDS ? i : n - 1 - i, a = spin + (i + 0.5) * step - Math.PI / 2, rp = r1 + 6 + peaks[bb] * len;
            g.fillRect(cx + Math.cos(a) * rp - 1, cy + Math.sin(a) * rp - 1, 2, 2);
        }
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
        // a thin circle that breathes with the bass
        g.strokeStyle = '#fff';
        g.globalAlpha = 0.05 + bass * 0.3;
        g.lineWidth = 1.5;
        g.beginPath(); g.arc(cx, cy, r0 + len * 0.55 + bass * len * 0.4, 0, 2 * Math.PI); g.stroke();
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

    return {
        init: init, input: input, show: show, hide: hide, isOn: function () { return shown; }, _armed: function () { return !!timer; },
        STYLES: STYLES, style: function () { return shown ? style : pick(); },
        // for the tests: what is shown now (0..1 per band), where the sound comes from (live / file / wait / none), the frame clock
        _levels: function () { return Array.prototype.slice.call(lv); }, _src: function () { return srcNow; },
        _stats: function () { return { frames: stat.n, worst: Math.round(stat.worst * 10) / 10, slow: stat.slow, drawMs: stat.n ? Math.round(stat.ms / stat.n * 100) / 100 : 0, particles: pool }; },
        _statsReset: function () { stat.n = stat.ms = stat.worst = stat.slow = 0; }
    };
})();
