/* Music screensaver (owner request 2026-11-05): while a song plays and nobody touches the remote, the pad or the mouse for
 * a few minutes (Music app > Settings: 1 to 20 min, or Off), My PC shows a visualizer over everything: the song top left,
 * the time top right. Any key, a click or a touch brings My PC back (that key does nothing else).
 * Styles: Bars (a spectrum with its reflection), Waves (glowing lines that leave a trail), Cover (the song's cover drifting
 * slowly, beating with the bass), Ring (modern: the cover in a circle of bars that turns, with a bass glow).
 *
 * The movement is the song's real sound (owner request 2026-11-05: "not faked"), 40 bands from 50 Hz to 6 kHz:
 *  - the web player (<audio>: Google Drive, PC folders, the web app): listened to live, captureStream() -> AnalyserNode.
 *    Only its own copies (blob: / this site, which is what the Music app gives it): the sound is never re-routed, and the
 *    AudioContext is closed when the screensaver closes.
 *  - Samsung's player (AVPlay, songs on a USB drive) gives no sound data: the song file is read and decoded once
 *    (OfflineAudioContext, 12 kHz), cut into 30 spectra a second (FFT 1024, Blackman, like the analyser) in small slices that
 *    start where the song is now, and shown at the player's own position: the same moment of the same sound.
 *  - neither possible (too big, a format the browser cannot decode): the bars stay flat. Nothing is made up.
 * Cheap: a small canvas scaled up, 30 frames a second (20 on a slow TV), nothing at all while it is not shown; the top bar
 * moves a few pixels every 30 s so nothing burns into the screen. Never on the game page (Music.init runs on the desktop page only). */
var MusicSaver = (function () {
    'use strict';

    var BANDS = 40, LO_HZ = 50, HI_HZ = 6000, FPS_T = 30, RATE = 12000, N = 1024, MAXB = 40 * 1024 * 1024;
    var W = 480, H = 270;
    var timer = 0, shown = false, root = null, cv = null, g = null, raf = 0, last = 0, moveT = 0, clockT = 0, eatUntil = 0;
    var shownAt = 0, px = -1, py = -1, style = 'bars', acc = '#4cc2ff', tint = '', trackKey = '', inited = false;
    var coverEl = null, glowEl = null, spin = 0, cols = [];
    // what is heard now: dB per band, then 0..1 shown (fast up, slower down), the peaks, the bass
    var db = new Float32Array(BANDS), lv = new Float32Array(BANDS), peaks = new Float32Array(BANDS), tilt = new Float32Array(BANDS), bass = 0, ceil = -40;
    var edges = [];
    (function () {
        for (var i = 0; i <= BANDS; i++) edges.push(LO_HZ * Math.pow(HI_HZ / LO_HZ, i / BANDS));
        // music is louder in the low notes: +3.5 dB an octave above 200 Hz so the right side moves too
        for (var b = 0; b < BANDS; b++) tilt[b] = 3.5 * Math.max(0, Math.log(Math.sqrt(edges[b] * edges[b + 1]) / 200) / Math.LN2);
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

    /* ---------------- the sound: bands of the spectrum ---------------- */
    // which FFT bins make each band (a band narrower than a bin is read between two bins)
    function bandMap(binHz, nBins) {
        var m = { a: new Int16Array(BANDS), b: new Int16Array(BANDS), f: new Float32Array(BANDS) };
        for (var i = 0; i < BANDS; i++) {
            var lo = edges[i] / binHz, hi = edges[i + 1] / binHz, a = Math.ceil(lo), b = Math.floor(hi);
            if (b - a >= 1) { m.a[i] = a; m.b[i] = Math.min(b, nBins - 1); m.f[i] = -1; }
            else { var c = Math.sqrt(lo * hi); m.a[i] = Math.min(Math.floor(c), nBins - 2); m.b[i] = m.a[i] + 1; m.f[i] = c - m.a[i]; }
        }
        return m;
    }
    function cl(x) { return x > -200 ? x : -200; }                        // -Infinity (silence) and NaN
    function toBands(spec, m, out) {
        for (var i = 0; i < BANDS; i++) {
            var v;
            if (m.f[i] >= 0) v = cl(spec[m.a[i]]) * (1 - m.f[i]) + cl(spec[m.b[i]]) * m.f[i];
            else { v = -200; for (var k = m.a[i]; k <= m.b[i]; k++) if (spec[k] > v) v = spec[k]; }
            out[i] = cl(v);
        }
    }

    // live: the web player's own sound
    var ac = null, an = null, anSrc = null, anZero = null, anStream = null, anFor = '', liveBuf = null, liveMap = null, quiet = 0, deadFor = '', liveNext = 0;
    function htmlEl() { var h = Music._engines && Music._engines.HTML; return h && h._el ? h._el() : null; }
    function liveOk(a) {
        if (!a || !a.src || !(a.captureStream || a.mozCaptureStream) || a.src === deadFor) return false;
        if (/^blob:/.test(a.src)) return true;
        try { return new URL(a.src, location.href).origin === location.origin; } catch (x) { return false; }   // another site: it would be silent
    }
    function liveClose(all) {
        try { if (anSrc) anSrc.disconnect(); if (an) an.disconnect(); if (anZero) anZero.disconnect(); } catch (x) {}
        try { if (anStream) anStream.getTracks().forEach(function (tr) { tr.stop(); }); } catch (x2) {}
        an = anSrc = anZero = anStream = null; anFor = '';
        if (all && ac) { try { ac.close(); } catch (x3) {} ac = null; }
    }
    function liveOpen(a) {
        liveClose(false);
        try {
            var AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return false;
            var st = (a.captureStream || a.mozCaptureStream).call(a);
            if (!st.getAudioTracks().length) { st.getTracks().forEach(function (tr) { tr.stop(); }); return false; }   // not started yet
            if (!ac) ac = new AC();
            anStream = st;
            anSrc = ac.createMediaStreamSource(st);
            an = ac.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0;
            anSrc.connect(an);
            anZero = ac.createGain(); anZero.gain.value = 0; an.connect(anZero); anZero.connect(ac.destination);   // keeps it running, silent
            liveBuf = new Float32Array(an.frequencyBinCount);
            liveMap = bandMap(ac.sampleRate / an.fftSize, an.frequencyBinCount);
            anFor = a.src; quiet = 0;
            if (ac.state === 'suspended' && ac.resume) ac.resume().catch(function () {});
            return true;
        } catch (x) { liveClose(false); return false; }
    }

    // from the file: decoded once, 30 spectra a second, shown at the player's position
    var tab = null;
    function tabStop() { if (tab) { clearTimeout(tab.job); tab.off = true; } }
    function bytes(track, cb) {
        var a = htmlEl();
        function fromSrc() {
            if (track.size > MAXB) return cb('big');
            MusicSrc.read(track, 0, track.size || MAXB, function (x, d) {
                if (x || !d || !d.length) return cb(x || 'empty');
                if (!(d instanceof Uint8Array)) d = new Uint8Array(d);
                cb(null, d.byteOffset === 0 && d.byteLength === d.buffer.byteLength ? d.buffer : d.slice().buffer);
            });
        }
        // the web player's own copy, when it has a whole one
        if (Music.engineName() === 'html' && a && /^blob:/.test(a.src) && typeof fetch === 'function') {
            return fetch(a.src).then(function (r) { return r.arrayBuffer(); }).then(function (b) { cb(null, b); }, fromSrc);
        }
        fromSrc();
    }
    function decode(buf, cb) {
        var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext, done = false;
        if (!OAC) return cb('noaudio');
        function ok(b) { if (!done) { done = true; cb(null, b); } }
        function bad(e) { if (!done) { done = true; cb(e || 'decode'); } }
        try { var c = new OAC(1, 1, RATE), p = c.decodeAudioData(buf, ok, bad); if (p && p.then) p.then(ok, bad); } catch (x) { bad(x); }
    }
    // FFT (in place, radix 2): tables made once
    var rev = null, cosT = null, sinT = null, win = null;
    function fftInit() {
        if (rev) return;
        rev = new Uint16Array(N); cosT = new Float32Array(N / 2); sinT = new Float32Array(N / 2); win = new Float32Array(N);
        for (var i = 0, bits = Math.log(N) / Math.LN2; i < N; i++) {
            var r = 0; for (var b = 0; b < bits; b++) r = (r << 1) | ((i >> b) & 1);
            rev[i] = r;
            win[i] = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / N) + 0.08 * Math.cos(4 * Math.PI * i / N);   // Blackman, like the analyser
        }
        for (var k = 0; k < N / 2; k++) { cosT[k] = Math.cos(2 * Math.PI * k / N); sinT[k] = -Math.sin(2 * Math.PI * k / N); }
    }
    function fft(re, im) {
        var i, j, t1, t2;
        for (i = 0; i < N; i++) { j = rev[i]; if (j > i) { t1 = re[i]; re[i] = re[j]; re[j] = t1; t2 = im[i]; im[i] = im[j]; im[j] = t2; } }
        for (var size = 2; size <= N; size <<= 1) {
            var half = size >> 1, step = N / size;
            for (i = 0; i < N; i += size) {
                for (j = 0; j < half; j++) {
                    var k = j * step, a = i + j, b = a + half, c = cosT[k], s = sinT[k];
                    var xr = re[b] * c - im[b] * s, xi = re[b] * s + im[b] * c;
                    re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
                }
            }
        }
    }
    function analyse(my, buf) {
        fftInit();
        var c0 = buf.getChannelData(0), c1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null, len = buf.length, hop = buf.sampleRate / FPS_T;
        var frames = Math.max(1, Math.floor(len / hop));
        my.frames = frames; my.data = new Uint8Array(frames * BANDS); my.ready = new Uint8Array(frames); my.left = frames;
        var map = bandMap(buf.sampleRate / N, N / 2), re = new Float32Array(N), im = new Float32Array(N), spec = new Float32Array(N / 2), out = new Float32Array(BANDS);
        var cur = 0;
        function one(fi) {
            var off = Math.round(fi * hop) - N, k;                              // the last N samples up to that moment, like the analyser
            for (k = 0; k < N; k++) { var j = off + k, v = 0; if (j >= 0 && j < len) v = c1 ? (c0[j] + c1[j]) * 0.5 : c0[j]; re[k] = v * win[k]; im[k] = 0; }
            fft(re, im);
            for (k = 0; k < N / 2; k++) { var m = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / N; spec[k] = m > 1e-10 ? 20 * Math.log(m) / Math.LN10 : -200; }
            toBands(spec, map, out);
            for (k = 0; k < BANDS; k++) { var q = Math.round((out[k] + 120) * 2); my.data[fi * BANDS + k] = q < 0 ? 0 : q > 255 ? 255 : q; }   // half dB steps
            my.ready[fi] = 1; my.left--;
        }
        (function slice() {
            if (my.off) return;
            var end = Date.now() + 8, p = Math.floor(Music.time() * FPS_T), n = 0;
            if (p >= 0 && p < frames && !my.ready[p]) cur = p;                  // the song's moment first (also after a seek)
            while (my.left > 0) {
                while (my.ready[cur]) cur = (cur + 1) % frames;
                one(cur);
                if (++n % 8 === 0 && Date.now() > end) break;
            }
            if (my.left > 0) my.job = setTimeout(slice, 4);
            else { c0 = c1 = buf = null; }                                      // the decoded sound is let go: only the table stays
        })();
    }
    function tableFor(track, key) {
        if (tab && tab.key === key && !tab.off) return tab;
        if (tab && tab.key === key && tab.left === 0) { tab.off = false; return tab; }   // done before: kept
        tabStop();
        var my = tab = { key: key, frames: 0, data: null, ready: null, left: -1, fail: false, off: false, job: 0 };
        bytes(track, function (x, b) {
            if (my.off) return;
            if (x) { my.fail = true; return; }
            decode(b, function (x2, buf) {
                if (my.off) return;
                if (x2 || !buf || !buf.length) { my.fail = true; return; }
                analyse(my, buf);
            });
        });
        return my;
    }

    // fills db (dB per band) with what is heard now; returns where it came from: live / file / wait / none
    var srcNow = '';
    function listen() {
        var s = Music.state(), eng = Music.engineName(), a = eng === 'html' ? htmlEl() : null, i;
        if (a && liveOk(a)) {
            if (a.src !== anFor && (Date.now() < liveNext || !liveOpen(a))) { liveNext = Math.max(liveNext, Date.now() + 400); for (i = 0; i < BANDS; i++) db[i] = -200; return 'wait'; }
            an.getFloatFrequencyData(liveBuf);
            toBands(liveBuf, liveMap, db);
            // a copy the browser will not let us hear (taint): silent while the song plays for 4 s -> read the file instead
            var top = -200; for (i = 0; i < BANDS; i++) if (db[i] > top) top = db[i];
            if (top < -110 && s.playing && !a.paused && a.currentTime > 1) { if (++quiet > FPS_T * 4) { deadFor = a.src; liveClose(false); } } else quiet = 0;
            return 'live';
        }
        if (anFor) liveClose(false);
        if (!s.track || !eng) { for (i = 0; i < BANDS; i++) db[i] = -200; return 'none'; }
        var tb = tableFor(s.track, trackKey);
        if (tb.fail) { for (i = 0; i < BANDS; i++) db[i] = -200; return 'none'; }
        var fi = Math.floor(Music.time() * FPS_T);
        if (!tb.ready || fi < 0 || fi >= tb.frames || !tb.ready[fi] || !s.playing || s.loading) { for (i = 0; i < BANDS; i++) db[i] = -200; return tb.ready ? 'file' : 'wait'; }
        for (i = 0; i < BANDS; i++) db[i] = tb.data[fi * BANDS + i] / 2 - 120;
        return 'file';
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
        ceil = -40; bass = 0; spin = 0; quiet = 0; deadFor = ''; srcNow = ''; liveNext = 0;
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
        liveClose(true);                                                       // the AudioContext is freed
        if (tab && tab.left !== 0) { tabStop(); tab = null; }                 // a table not finished is dropped; a whole one is kept
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
        srcNow = listen();
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
        // for the tests: what is heard now (0..1 per band) and where it comes from (live / file / wait / none)
        _levels: function () { return Array.prototype.slice.call(lv); }, _src: function () { return srcNow; }
    };
})();
