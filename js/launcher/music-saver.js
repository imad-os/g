/* Music screensaver (owner request 2026-11-05): while a song plays and nobody touches the remote, the pad or the mouse for
 * a few minutes (Music app > Settings: 1 to 20 min, or Off; Now playing's Screensaver button and Settings > Try open it any
 * time), My PC shows a visualizer over everything: the song top left, the time top right. Any key, a click or a touch brings
 * My PC back (that key does nothing else).
 * Styles: Bars (a spectrum with its reflection), Waves (four glowing lines, low to high notes), Cover (the song's cover drifting
 * slowly, beating with the bass), Ring (the round cover in a circle of bars that turns, with a bass glow).
 * The sound comes from MusicViz (js/core/music-viz.js): the song's REAL sound at its current moment, never made up; flat when
 * there is nothing to hear. This file only draws it.
 * Cheap: a small canvas scaled up, 30 frames a second (20 on a slow TV), nothing at all while it is not shown; the top bar
 * moves a few pixels every 30 s so nothing burns into the screen. Never on the game page (Music.init runs on the desktop page only). */
var MusicSaver = (function () {
    'use strict';

    var BANDS = MusicViz.BANDS;
    var W = 480, H = 270;
    var timer = 0, shown = false, root = null, cv = null, g = null, raf = 0, last = 0, moveT = 0, clockT = 0, eatUntil = 0;
    var shownAt = 0, px = -1, py = -1, style = 'bars', acc = '#4cc2ff', tint = '', trackKey = '', inited = false;
    var coverEl = null, glowEl = null, spin = 0, cols = [], srcNow = '';
    // what is heard now: dB per band, then 0..1 shown (fast up, slower down), the peaks, the bass
    var db = new Float32Array(BANDS), lv = new Float32Array(BANDS), peaks = new Float32Array(BANDS), tilt = new Float32Array(BANDS), bass = 0, ceil = -40;
    (function () {
        // music is louder in the low notes: +3.5 dB an octave above 200 Hz so the right side moves too
        var r = MusicViz.HI_HZ / MusicViz.LO_HZ;
        for (var b = 0; b < BANDS; b++) { var fc = MusicViz.LO_HZ * Math.pow(r, (b + 0.5) / BANDS); tilt[b] = 3.5 * Math.max(0, Math.log(fc / 200) / Math.LN2); }
    })();

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
    // a click or a pointer that really moves; not the click that opened it (Now playing's Screensaver button) and not a
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
    // from the router (main.js): true = the key was used to leave the screensaver
    function input(pressed) {
        // (one OK press gives several actions, confirm then jump: the rest of the press that opened it does not close it)
        if (shown) { if (pressed && Date.now() - shownAt > 250) { hide(); eatUntil = Date.now() + 600; } return true; }
        if (!pressed && Date.now() < eatUntil) return true;
        if (timer) arm();
        return false;
    }

    // dB -> what the bars show: follows the song's loudness (a quiet song moves as much as a loud one); silence = flat
    function shape() {
        var i, top = -200, v;
        for (i = 0; i < BANDS; i++) { v = db[i] + tilt[i]; if (v > top) top = v; }
        ceil = top > ceil ? top : Math.max(-62, ceil - 0.12);
        var lo = ceil - 46, b = 0;
        for (i = 0; i < BANDS; i++) {
            v = db[i] < -105 ? 0 : (db[i] + tilt[i] - lo) / 46;
            v = v < 0 ? 0 : v > 1 ? 1 : v * v * (1.6 - 0.6 * v);              // a little contrast
            lv[i] += (v - lv[i]) * (v > lv[i] ? 0.75 : 0.2);
            peaks[i] = Math.max(lv[i], peaks[i] - 0.012);
            if (i < 6) b += lv[i];
        }
        bass = b / 6;
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
    // the ring's colours, around the circle: the theme's accent to the cover's colour and back
    function ringCols() {
        var a = rgb(acc) || [76, 194, 255], b = rgb(tint) || [160, 92, 255];
        cols = [];
        for (var i = 0; i < BANDS; i++) { var f = i / (BANDS - 1); cols.push('rgb(' + Math.round(a[0] + (b[0] - a[0]) * f) + ',' + Math.round(a[1] + (b[1] - a[1]) * f) + ',' + Math.round(a[2] + (b[2] - a[2]) * f) + ')'); }
    }
    function show(test) {
        if (shown) return;
        var p = Music.prefs();
        style = p.saver === 'off' || !/^(bars|waves|cover|ring)$/.test(p.saver) ? 'bars' : p.saver;
        shown = true; shownAt = Date.now(); px = py = -1;
        palette();
        root = el('div', 'mxs mxs-s-' + style);
        root._test = !!test;
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-label', t('muSaver'));
        coverEl = glowEl = null;
        if (style === 'cover') {
            root.appendChild(el('div', 'mxs-cover-bg'));
            var drift = el('div', 'mxs-drift');
            glowEl = el('i', 'mxs-glow'); drift.appendChild(glowEl);
            coverEl = el('div', 'mxs-cover'); drift.appendChild(coverEl);
            root.appendChild(drift);
        } else {
            W = style === 'ring' ? 640 : 480; H = style === 'ring' ? 360 : 270;
            cv = el('canvas', 'mxs-cv');
            cv.width = W; cv.height = H;
            g = cv.getContext('2d');
            if (style === 'ring') {
                var stage = el('div', 'mxs-stage');
                stage.appendChild(cv);
                coverEl = el('div', 'mxs-cover'); stage.appendChild(coverEl);
                root.appendChild(stage);
            } else root.appendChild(cv);
        }
        // the song top left (with its cover, small, where the cover is not the show), the time top right
        var top = el('div', 'mxs-top'), song = el('div', 'mxs-song'), txt = el('div', 'mxs-txt');
        if (style === 'bars' || style === 'waves') song.appendChild(el('div', 'mxs-thumb'));
        txt.appendChild(el('div', 'mxs-title'));
        txt.appendChild(el('div', 'mxs-artist'));
        song.appendChild(txt);
        top.appendChild(song);
        top.appendChild(el('div', 'mxs-clock'));
        root.appendChild(top);
        root.addEventListener('pointerdown', function (e) { e.preventDefault(); e.stopPropagation(); activity(e); }, true);
        document.body.appendChild(root);
        for (var i = 0; i < BANDS; i++) { lv[i] = peaks[i] = 0; db[i] = -200; }
        ceil = -40; bass = 0; spin = 0; srcNow = '';
        MusicViz.start();
        trackKey = '';
        ringCols();
        info();
        moveT = setInterval(shift, 30000);
        clockT = setInterval(clock, 15000);
        last = 0;
        raf = requestAnimationFrame(frame);
        if (typeof A11y !== 'undefined') A11y.announce(t('muSaver'));
    }
    function hide() {
        if (!shown) return;
        shown = false;
        cancelAnimationFrame(raf); raf = 0;
        clearInterval(moveT); clearInterval(clockT); moveT = clockT = 0;
        MusicViz.stop();                                                       // nothing runs while it is hidden
        if (cv) { cv.width = cv.height = 0; }
        cv = g = null; coverEl = glowEl = null;
        if (root && root.parentNode) root.parentNode.removeChild(root);
        root = null;
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
        ringCols();
        root.style.setProperty('--mx-glow', acc);
        var th = root.querySelector('.mxs-thumb');
        if (th) th.innerHTML = '';
        if (coverEl) coverEl.innerHTML = '';
        if (!s.track) return;
        MusicSrc.art(s.track, function (v) {
            if (!root || trackKey !== k || !v) return;
            tint = v.color || '';
            if (tint) { root.style.setProperty('--mx-tint', tint); root.style.setProperty('--mx-glow', tint); ringCols(); }
            [coverEl, root.querySelector('.mxs-thumb')].forEach(function (box) {
                if (!box) return;
                box.innerHTML = ''; var im = new Image(); im.alt = ''; im.src = v.url; box.appendChild(im);
            });
        });
    }

    /* ---------------- drawing ---------------- */
    function frame(now) {
        raf = requestAnimationFrame(frame);
        var fps = typeof Perf !== 'undefined' && Perf.profile().tier === 'low' ? 20 : 30;
        if (now - last < 1000 / fps - 2) return;
        last = now;
        var was = srcNow;
        srcNow = MusicViz.read(db);
        if (srcNow !== was && root) root.setAttribute('data-src', srcNow);
        shape();
        var time = now / 1000;
        if (style === 'waves') waves(time);
        else if (style === 'ring') ring();
        else if (style === 'bars') bars();
        // the cover beats with the bass (transform and opacity only: no repaint)
        if (coverEl) coverEl.style.transform = 'scale(' + (1 + bass * 0.07).toFixed(3) + ')';
        if (glowEl) glowEl.style.opacity = (0.08 + bass * 0.6).toFixed(3);
    }
    function bars() {
        var i, w = W / BANDS, mid = H * 0.7;
        g.fillStyle = '#05060c';
        g.fillRect(0, 0, W, H);
        var gr = g.createLinearGradient(0, mid - H * 0.55, 0, mid);
        gr.addColorStop(0, acc); gr.addColorStop(1, tint || '#7a5cff');
        for (i = 0; i < BANDS; i++) {
            var h = Math.max(1, lv[i] * H * 0.55), x = i * w + 1;
            g.fillStyle = gr;
            g.fillRect(x, mid - h, w - 3, h);
            g.globalAlpha = 0.22;
            g.fillRect(x, mid + 3, w - 3, h * 0.45);
            g.globalAlpha = 0.9;
            g.fillStyle = '#fff';
            g.fillRect(x, mid - peaks[i] * H * 0.55 - 4, w - 3, 2);
            g.globalAlpha = 1;
        }
    }
    // four lines: low, low-middle, high-middle and high notes; each one's height is that part of the sound now
    function waves(time) {
        g.globalCompositeOperation = 'source-over';
        g.fillStyle = 'rgba(4, 5, 12, 0.24)';
        g.fillRect(0, 0, W, H);
        g.globalCompositeOperation = 'lighter';
        var c4 = [acc, tint || '#ff5fa2', '#7a5cff', '#36d6c3'], per = BANDS / 4;
        for (var k = 0; k < 4; k++) {
            var e = 0, j;
            for (j = 0; j < per; j++) e += lv[k * per + j];
            e /= per;
            g.strokeStyle = c4[k];
            g.lineWidth = 2;
            g.globalAlpha = 0.8;
            g.beginPath();
            for (var x = 0; x <= W; x += 6) {
                // the line's shape: the band under it along the line, so the curve is the spectrum of its part
                var fx = x / W * (per - 1), j0 = Math.floor(fx), j1 = Math.min(per - 1, j0 + 1), env = Math.sin(Math.PI * x / W);
                var amp = (6 + e * 70 + (lv[k * per + j0] * (1 + j0 - fx) + lv[k * per + j1] * (fx - j0)) * 30) * env;
                var y = H / 2 + Math.sin(x * (0.018 + k * 0.006) + time * (1.4 + k * 0.6)) * amp;
                if (x) g.lineTo(x, y); else g.moveTo(x, y);
            }
            g.stroke();
        }
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
    }
    // Ring: bars around the cover, the low notes at the top, mirrored left and right; it turns faster with the bass
    function ring() {
        var cx = W / 2, cy = H / 2, r0 = H * 0.215, len = H * 0.25, n = BANDS * 2;
        g.clearRect(0, 0, W, H);
        spin += 0.002 + bass * 0.012;
        // the bass glow
        var gl = g.createRadialGradient(cx, cy, r0 * 0.8, cx, cy, r0 + len * (0.6 + bass));
        gl.addColorStop(0, 'rgba(255,255,255,0)');
        gl.addColorStop(0.35, (tint || acc));
        gl.addColorStop(1, 'rgba(0,0,0,0)');
        g.globalAlpha = 0.18 + bass * 0.45;
        g.fillStyle = gl;
        g.fillRect(0, 0, W, H);
        g.globalAlpha = 1;
        g.lineCap = 'round';
        g.lineWidth = (2 * Math.PI * r0 / n) * 0.55;
        g.globalCompositeOperation = 'lighter';
        for (var i = 0; i < n; i++) {
            var b = i < BANDS ? i : n - 1 - i, a = spin + (i + 0.5) / n * 2 * Math.PI - Math.PI / 2;
            var ca = Math.cos(a), sa = Math.sin(a), r1 = r0 + 3, r2 = r1 + 2 + lv[b] * len;
            g.strokeStyle = cols[b];
            g.beginPath(); g.moveTo(cx + ca * r1, cy + sa * r1); g.lineTo(cx + ca * r2, cy + sa * r2); g.stroke();
            // the peak, a dot that falls back slowly
            var rp = r1 + 6 + peaks[b] * len;
            g.fillStyle = cols[b];
            g.globalAlpha = 0.7;
            g.fillRect(cx + ca * rp - 1, cy + sa * rp - 1, 2, 2);
            g.globalAlpha = 1;
        }
        g.globalCompositeOperation = 'source-over';
        // a thin circle that breathes with the bass
        g.strokeStyle = 'rgba(255,255,255,' + (0.05 + bass * 0.3).toFixed(2) + ')';
        g.lineWidth = 1.5;
        g.beginPath(); g.arc(cx, cy, r0 + len * 0.55 + bass * len * 0.4, 0, 2 * Math.PI); g.stroke();
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
        // for the tests: what is shown now (0..1 per band) and where the sound comes from (live / file / wait / none)
        _levels: function () { return Array.prototype.slice.call(lv); }, _src: function () { return srcNow; }
    };
})();
