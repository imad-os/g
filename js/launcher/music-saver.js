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

    // live: the web player's own sound. ONE captured copy of the player (captureStream) for as long as the screensaver shows;
    // when the player changes song or copy (next song, a bigger download copy) the browser ends the old sound track and adds a
    // new one: the analyser moves to it at once (listening to the ended one gave flat bars after a song change).
    var ac = null, an = null, anSrc = null, anZero = null, anStream = null, anEl = null, anTrack = null, rewire = false, liveBuf = null, liveMap = null;
    var quiet = 0, deadFor = '', liveNext = 0, mesNode = null, keepAc = false;
    function htmlEl() { var h = Music._engines && Music._engines.HTML; return h && h._el ? h._el() : null; }
    function liveOk(a) {
        if (!a || !a.src || a.src === deadFor) return false;
        if (/^blob:/.test(a.src)) return true;
        try { return new URL(a.src, location.href).origin === location.origin; } catch (x) { return false; }   // another site: it would be silent
    }
    function liveClose(all) {
        try { if (anSrc) anSrc.disconnect(); } catch (x) {}
        anSrc = null; anTrack = null;
        if (!all) return;
        try { if (mesNode && an) mesNode.disconnect(an); } catch (x0) {}
        try { if (an) an.disconnect(); if (anZero) anZero.disconnect(); } catch (x1) {}
        try { if (anStream) anStream.getTracks().forEach(function (tr) { tr.stop(); }); } catch (x2) {}
        an = anZero = anStream = anEl = null;
        if (ac && !keepAc) { try { ac.close(); } catch (x3) {} ac = null; }
    }
    function analyser() {
        if (an) return;
        an = ac.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0;
        anZero = ac.createGain(); anZero.gain.value = 0; an.connect(anZero); anZero.connect(ac.destination);   // keeps it running, silent
        liveBuf = new Float32Array(an.frequencyBinCount);
        liveMap = bandMap(ac.sampleRate / an.fftSize, an.frequencyBinCount);
    }
    function liveTrack() {
        var l = anStream.getAudioTracks();
        for (var i = l.length - 1; i >= 0; i--) if (l[i].readyState === 'live') return l[i];
        return null;
    }
    // true when the analyser hears the player now
    function liveOpen(a) {
        try {
            var AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return false;
            if (!ac) ac = new AC();
            if (ac.state === 'suspended' && ac.resume) ac.resume().catch(function () {});
            var cap = a.captureStream || a.mozCaptureStream;
            if (cap) {
                if (anEl !== a || !anStream) {
                    if (anStream) anStream.getTracks().forEach(function (tr) { tr.stop(); });
                    anStream = cap.call(a); anEl = a;
                    anStream.addEventListener('addtrack', function () { rewire = true; });
                    anStream.addEventListener('removetrack', function () { rewire = true; });
                }
                var tr = liveTrack();
                if (!tr) return false;                                           // the song has not started yet
                if (tr === anTrack && anSrc) return true;
                try { if (anSrc) anSrc.disconnect(); } catch (x0) {}
                analyser();
                anSrc = ac.createMediaStreamSource(new MediaStream([tr]));
                anSrc.connect(an);
                anTrack = tr; quiet = 0;
                return true;
            }
            // no captureStream (some TVs): the player's sound goes through Web Audio for good (once per page; the context then stays
            // open, or the music would stop). Only with a context that really runs, else the music would go silent.
            if (!mesNode && ac.state !== 'running') return false;
            analyser();
            if (!mesNode) { mesNode = ac.createMediaElementSource(a); mesNode.connect(ac.destination); keepAc = true; }
            if (!anSrc) { mesNode.connect(an); anSrc = { disconnect: function () { try { mesNode.disconnect(an); } catch (x) {} } }; anTrack = 'mes'; }
            return true;
        } catch (x) { return false; }
    }

    /* from the file (Samsung's player): never the whole song at once. Only the next seconds are read and analysed, just ahead
     * of where the song is (a WAV is read as it is, an MP3 piece is decoded on its own: ~200 KB and a few ms every 6 s), so the
     * song's start is never slowed down. Other formats (FLAC, M4A, Ogg) are read in 1 MB pieces with pauses, decoded once and
     * analysed from where the song is. */
    var SEG = 6, AHEAD = 10, RATE_W = 12000;
    var tab = null, tickT = 0;
    function tabStop() { clearTimeout(tickT); tickT = 0; if (tab) { tab.off = true; clearTimeout(tab.job); } }
    function u8(d) { return d instanceof Uint8Array ? d : new Uint8Array(d); }
    function rd(track, at, len, cb) { MusicSrc.read(track, at, len, function (x, d) { cb(x || (!d ? 'empty' : null), d ? u8(d) : null); }); }
    function decode(buf, cb) {
        var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext, done = false;
        if (!OAC) return cb('noaudio');
        function ok(b) { if (!done) { done = true; cb(null, b); } }
        function bad(e) { if (!done) { done = true; cb(e || 'decode'); } }
        try { var c = new OAC(1, 1, RATE_W), p = c.decodeAudioData(buf, ok, bad); if (p && p.then) p.then(ok, bad); } catch (x) { bad(x); }
    }
    function mono(buf) {
        var c0 = buf.getChannelData(0);
        if (buf.numberOfChannels < 2) return c0;
        var c1 = buf.getChannelData(1), out = new Float32Array(c0.length);
        for (var i = 0; i < c0.length; i++) out[i] = (c0[i] + c1[i]) * 0.5;
        return out;
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
    // MP3: where the sound starts, its frame header, and the Xing table of contents (VBR) if there is one
    var BR1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], BR2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    function mp3Head(b, o) {
        if (o + 4 > b.length || b[o] !== 255 || (b[o + 1] & 0xe0) !== 0xe0) return null;
        var ver = (b[o + 1] >> 3) & 3, lay = (b[o + 1] >> 1) & 3, bi = b[o + 2] >> 4, si = (b[o + 2] >> 2) & 3, pad = (b[o + 2] >> 1) & 1;
        if (ver === 1 || lay !== 1 || bi === 0 || bi === 15 || si === 3) return null;   // MPEG audio layer III only
        var sr = [44100, 48000, 32000][si] / (ver === 3 ? 1 : ver === 2 ? 2 : 4), br = (ver === 3 ? BR1 : BR2)[bi] * 1000;
        var spf = ver === 3 ? 1152 : 576;
        return { ver: ver, sr: sr, br: br, spf: spf, len: Math.floor(spf / 8 * br / sr) + pad, mono: (b[o + 3] >> 6) === 3 };
    }
    function mp3Sync(b, from, sr) {
        for (var o = from; o + 4 < b.length; o++) {
            var h = mp3Head(b, o);
            if (h && h.sr === sr) { var h2 = mp3Head(b, o + h.len); if (h2 && h2.sr === sr) return o; }
        }
        return -1;
    }
    function probe(my, cb) {
        rd(my.track, 0, 65536, function (x, b) {
            if (x || b.length < 16) return cb(x || 'short');
            var size = my.track.size || 0, i;
            // WAV: the samples are read as they are
            if (b[0] === 82 && b[1] === 73 && b[2] === 70 && b[3] === 70 && b[8] === 87 && b[9] === 65) {
                var o = 12, fmt = null;
                while (o + 8 <= b.length) {
                    var id = String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]), sz = (b[o + 4] | (b[o + 5] << 8) | (b[o + 6] << 16) | (b[o + 7] << 24)) >>> 0;
                    if (id === 'fmt ') fmt = { tag: b[o + 8] | (b[o + 9] << 8), ch: b[o + 10] | (b[o + 11] << 8), sr: (b[o + 12] | (b[o + 13] << 8) | (b[o + 14] << 16) | (b[o + 15] << 24)) >>> 0, align: b[o + 20] | (b[o + 21] << 8), bits: b[o + 22] | (b[o + 23] << 8) };
                    if (id === 'data' && fmt && fmt.sr && fmt.align && (fmt.tag === 1 || fmt.tag === 3 || fmt.tag === 65534)) {
                        my.kind = 'wav'; my.wav = fmt; my.off0 = o + 8; my.dur = (size ? Math.min(sz, size - o - 8) : sz) / fmt.align / fmt.sr;
                        my.dec = Math.max(1, Math.floor(fmt.sr / RATE_W));
                        return cb(null);
                    }
                    o += 8 + sz + (sz & 1);
                }
                my.kind = 'whole'; return cb(null);
            }
            // MP3 (after its ID3 tag, which can be big with a cover)
            var start = 0;
            if (b[0] === 73 && b[1] === 68 && b[2] === 51) start = 10 + ((b[6] & 127) << 21 | (b[7] & 127) << 14 | (b[8] & 127) << 7 | (b[9] & 127)) + (b[5] & 16 ? 10 : 0);
            function mp3(head, base) {
                var s0 = -1;
                for (i = 0; i + 4 < head.length && i < 8192; i++) { var hh = mp3Head(head, i); if (hh && mp3Head(head, i + hh.len)) { s0 = i; break; } }
                if (s0 < 0) { my.kind = 'whole'; return cb(null); }
                var h = mp3Head(head, s0), xo = s0 + 4 + (h.ver === 3 ? (h.mono ? 17 : 32) : (h.mono ? 9 : 17)), tag = String.fromCharCode(head[xo], head[xo + 1], head[xo + 2], head[xo + 3]);
                my.kind = 'mp3'; my.mp3 = h; my.off0 = base + s0; my.bytes = (size || 0) - my.off0; my.toc = null;
                if (tag === 'Xing' || tag === 'Info') {
                    var fl = head[xo + 7], p = xo + 8, frames = 0, nb = 0;
                    if (fl & 1) { frames = (head[p] << 24 | head[p + 1] << 16 | head[p + 2] << 8 | head[p + 3]) >>> 0; p += 4; }
                    if (fl & 2) { nb = (head[p] << 24 | head[p + 1] << 16 | head[p + 2] << 8 | head[p + 3]) >>> 0; p += 4; }
                    if (fl & 4 && tag === 'Xing') { my.toc = Array.prototype.slice.call(head, p, p + 100); }
                    if (nb) my.bytes = nb;
                    if (frames) my.dur = frames * h.spf / h.sr;
                }
                if (!my.bytes || my.bytes < 0) { my.kind = 'whole'; return cb(null); }
                if (!my.dur) my.dur = my.bytes * 8 / h.br;
                cb(null);
            }
            var tag4 = String.fromCharCode(b[0], b[1], b[2], b[3]), tag8 = String.fromCharCode(b[4], b[5], b[6], b[7]);
            if (tag4 === 'fLaC' || tag4 === 'OggS' || tag8 === 'ftyp') { my.kind = 'whole'; return cb(null); }
            if (start + 8192 > b.length) return rd(my.track, start, 16384, function (x2, h2) { if (x2) return cb(x2); mp3(h2, start); });
            mp3(b.subarray(start), start);
        });
    }
    // MP3 time <-> byte (Xing table for VBR, else straight)
    function mp3Byte(my, t) {
        var f = Math.max(0, Math.min(1, t / my.dur));
        if (!my.toc) return my.off0 + Math.floor(f * my.bytes);
        var pc = f * 100, i = Math.min(99, Math.floor(pc)), a = my.toc[i], b = i < 99 ? my.toc[i + 1] : 256;
        return my.off0 + Math.floor((a + (b - a) * (pc - i)) / 256 * my.bytes);
    }
    function mp3Time(my, byte) {
        var lo = 0, hi = my.dur;
        for (var k = 0; k < 24; k++) { var m = (lo + hi) / 2; if (mp3Byte(my, m) < byte) lo = m; else hi = m; }
        return lo;
    }
    // the spectra of frames [f0, f1) from samples (rate) whose first one is at time t0; in slices of 6 ms
    function frames(my, pcm, rate, t0, f0, f1, done) {
        fftInit();
        if (!my.maps[rate]) my.maps[rate] = bandMap(rate / N, N / 2);
        var map = my.maps[rate], re = my.re, im = my.im, spec = my.spec, out = my.out, f = f0;
        (function slice() {
            if (my.off) return;
            var end = Date.now() + 6;
            for (; f < f1; f++) {
                if (f >= my.frames) grow(my, f + 1);
                var e = Math.round((f / FPS_T - t0) * rate), k;          // the N samples up to that moment, like the analyser
                if (e > pcm.length) break;
                for (k = 0; k < N; k++) { var j = e - N + k; re[k] = j >= 0 ? pcm[j] * win[k] : 0; im[k] = 0; }
                fft(re, im);
                for (k = 0; k < N / 2; k++) { var m = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / N; spec[k] = m > 1e-10 ? 20 * Math.log(m) / Math.LN10 : -200; }
                toBands(spec, map, out);
                for (k = 0; k < BANDS; k++) { var q = Math.round((out[k] + 120) * 2); my.data[f * BANDS + k] = q < 0 ? 0 : q > 255 ? 255 : q; }
                my.ready[f] = 1;
                if ((f & 3) === 3 && Date.now() > end) { f++; my.job = setTimeout(slice, 4); return; }
            }
            done();
        })();
    }
    function grow(my, n) {
        var m = Math.max(n, my.frames * 2), d = new Uint8Array(m * BANDS), r = new Uint8Array(m);
        d.set(my.data); r.set(my.ready); my.data = d; my.ready = r; my.frames = m;
    }
    // the next piece to analyse: from frame f
    function piece(my, f, cb) {
        var t0 = f / FPS_T, pre = N / RATE_W + 0.05;
        if (my.kind === 'wav') {
            var w = my.wav, from = Math.max(0, Math.floor((t0 - pre) * w.sr)), n = Math.ceil((SEG + pre) * w.sr);
            return rd(my.track, my.off0 + from * w.align, n * w.align, function (x, b) {
                if (x) return cb(x);
                var cnt = Math.floor(b.length / w.align), dec = my.dec, out = new Float32Array(Math.floor(cnt / dec)), bps = w.bits >> 3;
                var dv = new DataView(b.buffer, b.byteOffset, b.byteLength), flt = w.tag === 3;
                for (var i = 0; i < out.length; i++) {
                    var s = 0;
                    for (var d = 0; d < dec; d++) {
                        var o = (i * dec + d) * w.align, v = 0;
                        for (var c = 0; c < Math.min(2, w.ch); c++, o += bps) {
                            v += bps === 2 ? dv.getInt16(o, true) / 32768 : bps === 1 ? (b[o] - 128) / 128 : bps === 3 ? ((b[o] | b[o + 1] << 8 | b[o + 2] << 16) << 8 >> 8) / 8388608 : flt ? dv.getFloat32(o, true) : dv.getInt32(o, true) / 2147483648;
                        }
                        s += v / Math.min(2, w.ch);
                    }
                    out[i] = s / dec;
                }
                cb(null, out, w.sr / dec, from / w.sr);
            });
        }
        // MP3: a piece from a frame start, decoded on its own
        var b0 = Math.max(my.off0, mp3Byte(my, t0 - pre) - 2048), b1 = mp3Byte(my, t0 + SEG) + 4096;
        rd(my.track, b0, b1 - b0, function (x, b) {
            if (x) return cb(x);
            var s = mp3Sync(b, 0, my.mp3.sr);
            if (s < 0) return cb('sync');
            var cut = b.slice(s);
            decode(cut.buffer, function (x2, buf) {
                if (x2 || !buf || !buf.length) return cb(x2 || 'decode');
                cb(null, mono(buf), buf.sampleRate, mp3Time(my, b0 + s));
            });
        });
    }
    // the whole song (formats a piece of cannot be decoded alone): read in 1 MB pieces with pauses, decoded once
    function whole(my) {
        var size = my.track.size || 0, parts = [], at = 0, total = 0;
        if (size > MAXB) { my.fail = true; return; }
        (function next() {
            if (my.off) return;
            rd(my.track, at, 1024 * 1024, function (x, b) {
                if (my.off) return;
                if (x) { my.fail = true; return; }
                parts.push(b); at += b.length; total += b.length;
                if (b.length === 1024 * 1024 && total < MAXB && (!size || at < size)) { my.job = setTimeout(next, 30); return; }
                var all = new Uint8Array(total), o = 0;
                parts.forEach(function (p) { all.set(p, o); o += p.length; });
                parts = null;
                decode(all.buffer, function (x2, buf) {
                    if (my.off) return;
                    if (x2 || !buf || !buf.length) { my.fail = true; return; }
                    my.pcm = mono(buf); my.rate = buf.sampleRate; my.dur = buf.duration;
                    my.loaded = true;
                });
            });
        })();
    }
    function tableFor(track, key) {
        if (tab && tab.key === key) {
            if (!tab.off) return tab;
            if (tab.kind && tab.kind !== 'whole') { tab.off = false; tab.busy = false; return tab; }   // the same song again: its table is kept
        }
        tabStop();
        tab = { key: key, track: track, kind: '', frames: 0, data: new Uint8Array(0), ready: new Uint8Array(0), busy: true, fail: false, off: false, job: 0, maps: {},
                re: new Float32Array(N), im: new Float32Array(N), spec: new Float32Array(N / 2), out: new Float32Array(BANDS) };
        var my = tab;
        grow(my, 60 * FPS_T);
        probe(my, function (x) {
            if (my.off) return;
            my.busy = false;
            if (x) { my.fail = true; return; }
            if (my.dur) grow(my, Math.ceil(my.dur * FPS_T) + 2);
            if (my.kind === 'whole') whole(my);
            tick();
        });
        return my;
    }
    // every 200 ms while it shows: the frames from now to AHEAD s later that are not ready yet are made, one piece at a time
    function tick() {
        clearTimeout(tickT); tickT = 0;
        var my = tab;
        if (!my || my.off || !shown) return;
        tickT = setTimeout(tick, 200);
        if (my.busy || my.fail || !my.kind) return;
        var p = Math.max(0, Math.floor(Music.time() * FPS_T)), end = p + AHEAD * FPS_T, f = p;
        if (my.dur) end = Math.min(end, Math.ceil(my.dur * FPS_T));
        while (f < end && f < my.frames && my.ready[f]) f++;
        if (f >= end) return;
        if (my.kind === 'whole') {
            if (!my.loaded) return;
            my.busy = true;
            return frames(my, my.pcm, my.rate, 0, f, Math.min(end, f + SEG * FPS_T), function () { my.busy = false; });
        }
        my.busy = true;
        piece(my, f, function (x, pcm, rate, t0) {
            if (my.off) return;
            if (x) { my.busy = false; my.errs = (my.errs || 0) + 1; if (my.errs > 3) my.fail = true; return; }
            frames(my, pcm, rate, t0, f, f + SEG * FPS_T, function () { my.busy = false; my.errs = 0; });
        });
    }

    // fills db (dB per band) with what is heard now; returns where it came from: live / file / wait / none
    var srcNow = '';
    function flat() { for (var i = 0; i < BANDS; i++) db[i] = -200; }
    function listen() {
        var s = Music.state(), eng = Music.engineName(), a = eng === 'html' ? htmlEl() : null, i;
        if (eng === 'html') {
            if (!a || !liveOk(a)) { flat(); return 'none'; }
            // (re)connect when there is no sound track yet, a track changed, or the one heard ended
            if (!anSrc || rewire || (anTrack && anTrack !== 'mes' && anTrack.readyState !== 'live')) {
                rewire = false;
                if (Date.now() < liveNext || !liveOpen(a)) { liveNext = Math.max(liveNext, Date.now() + 100); flat(); return 'wait'; }
            }
            an.getFloatFrequencyData(liveBuf);
            toBands(liveBuf, liveMap, db);
            return 'live';
        }
        if (anSrc) liveClose(false);
        if (!s.track || eng !== 'av') { flat(); return 'none'; }
        var tb = tableFor(s.track, trackKey);
        if (!tickT && !tb.busy) tick();
        if (tb.fail) { flat(); return 'none'; }
        var fi = Math.floor(Music.time() * FPS_T);
        if (fi < 0 || fi >= tb.frames || !tb.ready[fi]) { flat(); return 'wait'; }
        if (!s.playing || s.loading) { flat(); return 'file'; }
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
        ceil = -40; bass = 0; spin = 0; quiet = 0; deadFor = ''; srcNow = ''; liveNext = 0; rewire = false;
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
        tabStop();                                                             // nothing runs while it is hidden
        if (tab && tab.kind === 'whole') tab = null;                           // a decoded song is let go (an MP3 / WAV table is small: kept)
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
        _levels: function () { return Array.prototype.slice.call(lv); }, _src: function () { return srcNow; }, _ctx: function () { return ac ? ac.state : ''; }
    };
})();
