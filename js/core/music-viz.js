/* MusicViz: what the song sounds like right now, for the music screensaver (js/launcher/music-saver.js). Owner rule 2026-11-05:
 * the movement is the song's REAL sound, never made up; and it must never make the music stutter on a low TV.
 *
 * read(db) fills db (Float32Array, 40 bands from 50 Hz to 6 kHz, in dB) for the song's current moment and says where it came from:
 *   'live'  a browser (PC, phone): a copy of the web player's sound (captureStream -> AnalyserNode). Not on a Samsung TV: its chip
 *           decodes the sound itself and that copy is silent (imad's TV, build 120). A copy that stays silent 1.5 s while the song
 *           plays is dropped for the file, below.
 *   'file'  the TV (and any browser without a live copy): small pieces of the song FILE, read just ahead of where the song is
 *           (6 s at a time, 10 s ahead; ~100-300 KB each), decoded on their own and cut into 30 spectra a second (FFT 1024,
 *           Blackman, like the analyser), shown at the player's own position. Never the whole song at once:
 *             MP3   a piece from a frame start (Xing table of contents for VBR timing)
 *             WAV   the samples as they are (no decoding)
 *             FLAC  the stream header + a piece from a frame start (the frame tells its exact sample)
 *             M4A   the AAC frames of those seconds (from the index) wrapped as ADTS (exact timing from the index)
 *             other (Ogg...) a USB file is read in 1 MB pieces with pauses and decoded once; a Drive one waits for the
 *                   player's own whole copy (a Drive song is never downloaded twice)
 *   'wait'  the next piece is on its way;  'none'  nothing to hear (flat bars: never a made-up beat).
 * start() / stop(): nothing runs while stopped (stop frees the AudioContext and the work in progress). */
var MusicViz = (function () {
    'use strict';

    var BANDS = 40, LO_HZ = 50, HI_HZ = 6000, FPS = 30, N = 1024, RATE = 12000, SEG = 6, AHEAD = 10, MAXB = 40 * 1024 * 1024;
    var TV = typeof tizen !== 'undefined' || typeof webapis !== 'undefined';
    var on = false, noLive = TV;
    var edges = [];
    for (var e0 = 0; e0 <= BANDS; e0++) edges.push(LO_HZ * Math.pow(HI_HZ / LO_HZ, e0 / BANDS));

    /* ---------------- spectrum helpers ---------------- */
    function bandMap(binHz, nBins) {
        var m = { a: new Int16Array(BANDS), b: new Int16Array(BANDS), f: new Float32Array(BANDS) };
        for (var i = 0; i < BANDS; i++) {
            var lo = edges[i] / binHz, hi = edges[i + 1] / binHz, a = Math.ceil(lo), b = Math.floor(hi);
            if (b - a >= 1) { m.a[i] = a; m.b[i] = Math.min(b, nBins - 1); m.f[i] = -1; }
            else { var c = Math.sqrt(lo * hi); m.a[i] = Math.min(Math.floor(c), nBins - 2); m.b[i] = m.a[i] + 1; m.f[i] = c - m.a[i]; }
        }
        return m;
    }
    function cl(x) { return x > -200 ? x : -200; }
    function toBands(spec, m, out) {
        for (var i = 0; i < BANDS; i++) {
            var v;
            if (m.f[i] >= 0) v = cl(spec[m.a[i]]) * (1 - m.f[i]) + cl(spec[m.b[i]]) * m.f[i];
            else { v = -200; for (var k = m.a[i]; k <= m.b[i]; k++) if (spec[k] > v) v = spec[k]; }
            out[i] = cl(v);
        }
    }
    function flat(db) { for (var i = 0; i < BANDS; i++) db[i] = -200; }
    var rev = null, cosT = null, sinT = null, win = null, re = null, im = null, spec = null, outB = null, maps = {};
    function fftInit() {
        if (rev) return;
        rev = new Uint16Array(N); cosT = new Float32Array(N / 2); sinT = new Float32Array(N / 2); win = new Float32Array(N);
        re = new Float32Array(N); im = new Float32Array(N); spec = new Float32Array(N / 2); outB = new Float32Array(BANDS);
        for (var i = 0, bits = Math.log(N) / Math.LN2; i < N; i++) {
            var r = 0; for (var b = 0; b < bits; b++) r = (r << 1) | ((i >> b) & 1);
            rev[i] = r;
            win[i] = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / N) + 0.08 * Math.cos(4 * Math.PI * i / N);
        }
        for (var k = 0; k < N / 2; k++) { cosT[k] = Math.cos(2 * Math.PI * k / N); sinT[k] = -Math.sin(2 * Math.PI * k / N); }
    }
    function fft() {
        var i, j, t1;
        for (i = 0; i < N; i++) { j = rev[i]; if (j > i) { t1 = re[i]; re[i] = re[j]; re[j] = t1; t1 = im[i]; im[i] = im[j]; im[j] = t1; } }
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

    /* ---------------- live (a browser only) ---------------- */
    var ac = null, an = null, anSrc = null, anZero = null, anStream = null, anEl = null, anTrack = null, rewire = false, liveBuf = null, liveMap = null, quiet = 0, liveNext = 0;
    function htmlEl() { var h = Music._engines && Music._engines.HTML; return h && h._el ? h._el() : null; }
    function liveOk(a) {
        if (noLive || !a || !a.src || !(a.captureStream || a.mozCaptureStream) || !(window.AudioContext || window.webkitAudioContext)) return false;
        if (/^blob:/.test(a.src)) return true;
        try { return new URL(a.src, location.href).origin === location.origin; } catch (x) { return false; }
    }
    function liveClose() {
        try { if (anSrc) anSrc.disconnect(); if (an) an.disconnect(); if (anZero) anZero.disconnect(); } catch (x) {}
        try { if (anStream) anStream.getTracks().forEach(function (tr) { tr.stop(); }); } catch (x2) {}
        anSrc = an = anZero = anStream = anEl = anTrack = null;
        if (ac) { try { ac.close(); } catch (x3) {} ac = null; }
    }
    function liveOpen(a) {
        try {
            if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
            if (ac.state === 'suspended' && ac.resume) ac.resume().catch(function () {});
            if (anEl !== a || !anStream) {
                if (anStream) anStream.getTracks().forEach(function (tr) { tr.stop(); });
                anStream = (a.captureStream || a.mozCaptureStream).call(a); anEl = a;
                // a new song / copy: the browser ends the old sound track and adds a new one
                anStream.addEventListener('addtrack', function () { rewire = true; });
                anStream.addEventListener('removetrack', function () { rewire = true; });
            }
            var l = anStream.getAudioTracks(), tr = null;
            for (var i = l.length - 1; i >= 0 && !tr; i--) if (l[i].readyState === 'live') tr = l[i];
            if (!tr) return false;
            if (tr === anTrack && anSrc) return true;
            if (!an) {
                an = ac.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0;
                anZero = ac.createGain(); anZero.gain.value = 0; an.connect(anZero); anZero.connect(ac.destination);
                liveBuf = new Float32Array(an.frequencyBinCount); liveMap = bandMap(ac.sampleRate / an.fftSize, an.frequencyBinCount);
            }
            try { if (anSrc) anSrc.disconnect(); } catch (x0) {}
            anSrc = ac.createMediaStreamSource(new MediaStream([tr]));
            anSrc.connect(an);
            anTrack = tr; quiet = 0;
            return true;
        } catch (x) { return false; }
    }
    function liveRead(a, playing, db) {
        if (!anSrc || rewire || anTrack.readyState !== 'live') {
            rewire = false;
            if (Date.now() < liveNext || !liveOpen(a)) { liveNext = Math.max(liveNext, Date.now() + 100); flat(db); return 'wait'; }
        }
        an.getFloatFrequencyData(liveBuf);
        toBands(liveBuf, liveMap, db);
        var top = -200; for (var i = 0; i < BANDS; i++) if (db[i] > top) top = db[i];
        // silent while the song really plays: this browser gives a silent copy -> the file from now on
        if (top < -110 && playing && !a.paused && a.readyState > 2 && a.currentTime > 0.5) { if (++quiet > FPS * 1.5) { noLive = true; liveClose(); } } else quiet = 0;
        return 'live';
    }

    /* ---------------- the file, in pieces ---------------- */
    function u8(d) { return d instanceof Uint8Array ? d : new Uint8Array(d); }
    function rd(track, at, len, cb) { MusicSrc.read(track, at, len, function (x, d) { cb(x || (!d ? 'empty' : null), d ? u8(d) : null); }); }
    function u32(b, o) { return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]; }
    function str4(b, o) { return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]); }
    function decode(buf, cb) {
        var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext, done = false;
        if (!OAC) return cb('noaudio');
        function ok(b) { if (!done) { done = true; cb(null, b); } }
        function bad(e) { if (!done) { done = true; cb(e || 'decode'); } }
        try { var c = new OAC(1, 1, RATE), p = c.decodeAudioData(buf, ok, bad); if (p && p.then) p.then(ok, bad); } catch (x) { bad(x); }
    }
    function decoded(cb, t0) { return function (x, buf) { if (x || !buf || !buf.length) return cb(x || 'decode'); cb(null, buf.getChannelData(0), buf.sampleRate, t0, buf.numberOfChannels > 1 ? buf.getChannelData(1) : null); }; }

    // MP3
    var BR1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], BR2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    function mp3Head(b, o) {
        if (o + 4 > b.length || b[o] !== 255 || (b[o + 1] & 0xe0) !== 0xe0) return null;
        var ver = (b[o + 1] >> 3) & 3, lay = (b[o + 1] >> 1) & 3, bi = b[o + 2] >> 4, si = (b[o + 2] >> 2) & 3, pad = (b[o + 2] >> 1) & 1;
        if (ver === 1 || lay !== 1 || bi === 0 || bi === 15 || si === 3) return null;
        var sr = [44100, 48000, 32000][si] / (ver === 3 ? 1 : ver === 2 ? 2 : 4), br = (ver === 3 ? BR1 : BR2)[bi] * 1000, spf = ver === 3 ? 1152 : 576;
        return { ver: ver, sr: sr, br: br, spf: spf, len: Math.floor(spf / 8 * br / sr) + pad, mono: (b[o + 3] >> 6) === 3 };
    }
    function mp3Sync(b, from, sr) {
        for (var o = from; o + 4 < b.length; o++) {
            var h = mp3Head(b, o);
            if (h && (!sr || h.sr === sr)) { var h2 = mp3Head(b, o + h.len); if (h2 && h2.sr === h.sr) return o; }
        }
        return -1;
    }
    function mp3Probe(J, head, base, cb) {
        var s0 = mp3Sync(head, 0, 0);
        if (s0 < 0 || s0 > 8192) return cb('notmp3');
        var h = mp3Head(head, s0), xo = s0 + 4 + (h.ver === 3 ? (h.mono ? 17 : 32) : (h.mono ? 9 : 17)), tag = str4(head, xo);
        J.mp3 = h; J.off0 = base + s0; J.bytes = (J.size || 0) - J.off0; J.toc = null;
        if (tag === 'Xing' || tag === 'Info') {
            var fl = head[xo + 7], p = xo + 8, frames = 0;
            if (fl & 1) { frames = u32(head, p); p += 4; }
            if (fl & 2) { J.bytes = u32(head, p) || J.bytes; p += 4; }
            if (fl & 4 && tag === 'Xing') J.toc = Array.prototype.slice.call(head, p, p + 100);
            if (frames) J.dur = frames * h.spf / h.sr;
        }
        if (!(J.bytes > 0)) return cb('nosize');
        if (!J.dur) J.dur = J.bytes * 8 / h.br;
        J.kind = 'mp3'; cb(null);
    }
    function mp3Byte(J, t) {
        var f = Math.max(0, Math.min(1, t / J.dur));
        if (!J.toc) return J.off0 + Math.floor(f * J.bytes);
        var pc = f * 100, i = Math.min(99, Math.floor(pc)), a = J.toc[i], b = i < 99 ? J.toc[i + 1] : 256;
        return J.off0 + Math.floor((a + (b - a) * (pc - i)) / 256 * J.bytes);
    }
    function mp3Time(J, byte) {
        var lo = 0, hi = J.dur;
        for (var k = 0; k < 24; k++) { var m = (lo + hi) / 2; if (mp3Byte(J, m) < byte) lo = m; else hi = m; }
        return lo;
    }
    function mp3Piece(J, t0, seg, cb) {
        var b0 = Math.max(J.off0, mp3Byte(J, t0) - 2048), b1 = mp3Byte(J, t0 + seg) + 4096;
        rd(J.track, b0, b1 - b0, function (x, b) {
            if (x) return cb(x);
            var s = mp3Sync(b, 0, J.mp3.sr);
            if (s < 0) return cb('sync');
            decode(b.slice(s).buffer, decoded(cb, mp3Time(J, b0 + s)));
        });
    }

    // WAV
    function wavProbe(J, b, cb) {
        var o = 12, fmt = null;
        while (o + 8 <= b.length) {
            var id = str4(b, o), sz = (b[o + 4] | (b[o + 5] << 8) | (b[o + 6] << 16) | (b[o + 7] << 24)) >>> 0;
            if (id === 'fmt ') fmt = { tag: b[o + 8] | (b[o + 9] << 8), ch: b[o + 10] | (b[o + 11] << 8), sr: (b[o + 12] | (b[o + 13] << 8) | (b[o + 14] << 16) | (b[o + 15] << 24)) >>> 0, align: b[o + 20] | (b[o + 21] << 8), bits: b[o + 22] | (b[o + 23] << 8) };
            if (id === 'data') {
                if (!fmt || !fmt.sr || !fmt.align || [8, 16, 24, 32].indexOf(fmt.bits) < 0) return cb('wavfmt');
                J.kind = 'wav'; J.wav = fmt; J.off0 = o + 8; J.dur = (J.size ? Math.min(sz, J.size - o - 8) : sz) / fmt.align / fmt.sr;
                J.dec = Math.max(1, Math.floor(fmt.sr / RATE));
                return cb(null);
            }
            o += 8 + sz + (sz & 1);
        }
        cb('wavdata');
    }
    function wavPiece(J, t0, seg, cb) {
        var w = J.wav, pre = N / RATE + 0.05, from = Math.max(0, Math.floor((t0 - pre) * w.sr)), n = Math.ceil((seg + pre) * w.sr);
        rd(J.track, J.off0 + from * w.align, n * w.align, function (x, b) {
            if (x) return cb(x);
            var cnt = Math.floor(b.length / w.align), dec = J.dec, out = new Float32Array(Math.floor(cnt / dec)), bps = w.bits >> 3, chs = Math.min(2, w.ch);
            var dv = new DataView(b.buffer, b.byteOffset, b.byteLength), flt = w.tag === 3, i;
            // the usual 16-bit WAV: straight through a typed view (fast)
            if (bps === 2 && !(b.byteOffset & 1)) {
                var s16 = new Int16Array(b.buffer, b.byteOffset, b.byteLength >> 1), st = w.align >> 1, k2 = 1 / (32768 * dec * chs);
                for (i = 0; i < out.length; i++) { var sum = 0, base = i * dec * st; for (var d2 = 0; d2 < dec; d2++, base += st) { sum += s16[base]; if (chs > 1) sum += s16[base + 1]; } out[i] = sum * k2; }
                return cb(null, out, w.sr / dec, from / w.sr);
            }
            for (i = 0; i < out.length; i++) {
                var s = 0;
                for (var d = 0; d < dec; d++) {
                    var o = (i * dec + d) * w.align;
                    for (var c = 0; c < chs; c++, o += bps) {
                        s += bps === 2 ? dv.getInt16(o, true) / 32768 : bps === 1 ? (b[o] - 128) / 128 : bps === 3 ? ((b[o] | b[o + 1] << 8 | b[o + 2] << 16) << 8 >> 8) / 8388608 : flt ? dv.getFloat32(o, true) : dv.getInt32(o, true) / 2147483648;
                    }
                }
                out[i] = s / (dec * chs);
            }
            cb(null, out, w.sr / dec, from / w.sr);
        });
    }

    // FLAC: the stream header (STREAMINFO, marked last) + a piece from a frame start; the frame header tells its exact sample
    var CRC8 = null;
    function crc8(b, o, n) {
        if (!CRC8) { CRC8 = new Uint8Array(256); for (var i = 0; i < 256; i++) { var c = i; for (var k = 0; k < 8; k++) c = c & 128 ? ((c << 1) ^ 7) & 255 : (c << 1) & 255; CRC8[i] = c; } }
        var r = 0; for (var j = 0; j < n; j++) r = CRC8[r ^ b[o + j]]; return r;
    }
    function flacProbe(J, b, cb) {
        var o = 4, info = null;
        // metadata blocks; the audio starts after the last one (a big picture block may end past what was read)
        (function walk(b, base) {
            while (o - base + 4 <= b.length) {
                var hd = b[o - base], last = hd & 128, type = hd & 127, len = (b[o - base + 1] << 16) | (b[o - base + 2] << 8) | b[o - base + 3];
                if (type === 0) info = b.slice(o - base, o - base + 4 + 34);
                o += 4 + len;
                if (last) {
                    if (!info) return cb('flacinfo');
                    var sr = (info[14] << 12) | (info[15] << 4) | (info[16] >> 4), total = (info[17] & 15) * 4294967296 + u32(info, 18);
                    if (!sr) return cb('flacsr');
                    info[0] |= 128;                                               // STREAMINFO is the only (last) block
                    J.kind = 'flac'; J.head = new Uint8Array(4 + info.length); J.head.set([102, 76, 97, 67]); J.head.set(info, 4);
                    J.sr = sr; J.minBlock = (info[4] << 8) | info[5]; J.fixed = J.minBlock === ((info[6] << 8) | info[7]);
                    J.off0 = o; J.bytes = (J.size || 0) - o; J.dur = total / sr;
                    if (!(J.bytes > 0) || !J.dur) return cb('flacsize');
                    return cb(null);
                }
            }
            if (o > 4 * 1024 * 1024) return cb('flacmeta');
            rd(J.track, o, 65536, function (x, nb) { if (x) return cb(x); walk(nb, o); });
        })(b, 0);
    }
    function flacFrame(J, b) {
        for (var o = 0; o + 16 < b.length; o++) {
            if (b[o] !== 255 || (b[o + 1] & 0xfe) !== 0xf8) continue;
            var bs = b[o + 2] >> 4, src = b[o + 2] & 15, p = o + 4;
            if (bs === 0 || src === 15 || (b[o + 3] >> 4) > 10 || (b[o + 3] & 1)) continue;
            // the frame / sample number, UTF-8 style
            var c = b[p], n, extra;
            if (c < 0x80) { n = c; extra = 0; } else if ((c & 0xe0) === 0xc0) { n = c & 31; extra = 1; } else if ((c & 0xf0) === 0xe0) { n = c & 15; extra = 2; }
            else if ((c & 0xf8) === 0xf0) { n = c & 7; extra = 3; } else if ((c & 0xfc) === 0xf8) { n = c & 3; extra = 4; } else if ((c & 0xfe) === 0xfc) { n = c & 1; extra = 5; } else if (c === 0xfe) { n = 0; extra = 6; } else continue;
            var okU = true;
            for (var k = 1; k <= extra; k++) { if ((b[p + k] & 0xc0) !== 0x80) { okU = false; break; } n = n * 64 + (b[p + k] & 63); }
            if (!okU) continue;
            p += 1 + extra;
            if (bs === 6) p += 1; else if (bs === 7) p += 2;
            if (src === 12) p += 1; else if (src === 13 || src === 14) p += 2;
            if (p >= b.length || crc8(b, o, p - o) !== b[p]) continue;
            var sample = (b[o + 1] & 1) ? n : n * J.minBlock;
            return { at: o, t: sample / J.sr };
        }
        return null;
    }
    function flacPiece(J, t0, seg, cb) {
        var f = Math.max(0, t0 / J.dur), b0 = J.off0 + Math.floor(Math.max(0, f - 1 / J.dur) * J.bytes), len = Math.ceil((seg + 2) / J.dur * J.bytes) + 16384;
        rd(J.track, b0, len, function (x, b) {
            if (x) return cb(x);
            var fr = flacFrame(J, b);
            if (!fr) return cb('flacsync');
            // the guess was late (the song is denser here): read again from earlier
            if (fr.t > t0 && b0 > J.off0 && !J._back) { J._back = true; var back = Math.ceil((fr.t - t0 + 1) / J.dur * J.bytes); return rd(J.track, Math.max(J.off0, b0 - back), len + back, function (x2, b2) { J._back = false; if (x2) return cb(x2); var fr2 = flacFrame(J, b2); if (!fr2) return cb('flacsync'); var o2 = new Uint8Array(J.head.length + b2.length - fr2.at); o2.set(J.head); o2.set(b2.subarray(fr2.at), J.head.length); decode(o2.buffer, decoded(cb, fr2.t)); }); }
            var out = new Uint8Array(J.head.length + b.length - fr.at);
            out.set(J.head); out.set(b.subarray(fr.at), J.head.length);
            decode(out.buffer, decoded(cb, fr.t));
        });
    }

    // M4A / MP4: the AAC frames of the wanted seconds, found in the index (moov), wrapped as ADTS and decoded alone
    function box(b, o, end, type) {
        while (o + 8 <= end) {
            var sz = u32(b, o), ty = str4(b, o + 4);
            if (sz === 1) sz = u32(b, o + 8) * 4294967296 + u32(b, o + 12);
            if (sz < 8 || o + sz > end) return null;
            if (ty === type) return { o: o, end: o + sz, d: o + 8 };
            o += sz;
        }
        return null;
    }
    function path(b, o, end, list) {
        var r = { d: o, end: end };
        for (var i = 0; i < list.length && r; i++) r = box(b, r.d + (list[i - 1] === 'stsd' ? 8 : 0), r.end, list[i]);
        return r;
    }
    function m4aProbe(J, head, cb) {
        // top boxes: find moov (at the front, or after the sound: a few small reads of box headers)
        var at = 0, hops = 0;
        (function next(b, base) {
            var o = at - base;
            if (o + 16 > b.length) { if (++hops > 12 || (J.size && at >= J.size)) return cb('nomoov'); return rd(J.track, at, 16, function (x, h) { if (x) return cb(x); next(h, at); }); }
            var sz = u32(b, o), ty = str4(b, o + 4);
            if (sz === 1) sz = u32(b, o + 8) * 4294967296 + u32(b, o + 12);
            if (sz === 0 && J.size) sz = J.size - at;
            if (sz < 8) return cb('badbox');
            if (ty === 'moov') {
                if (sz > 16 * 1024 * 1024) return cb('bigmoov');
                if (o + sz <= b.length) return m4aIndex(J, b.subarray(o, o + sz), cb);
                return rd(J.track, at, sz, function (x, mv) { if (x) return cb(x); m4aIndex(J, mv, cb); });
            }
            at += sz;
            next(b, base);
        })(head, 0);
    }
    function m4aIndex(J, mv, cb) {
        var end = mv.length, o = 8, trak, stbl = null, scale = 0;
        while ((trak = box(mv, o, end, 'trak'))) {
            var hd = path(mv, trak.d, trak.end, ['mdia', 'hdlr']);
            if (hd && str4(mv, hd.d + 8) === 'soun') {
                var md = path(mv, trak.d, trak.end, ['mdia', 'mdhd']);
                scale = md ? (mv[md.d] === 1 ? u32(mv, md.d + 20) : u32(mv, md.d + 12)) : 0;
                stbl = path(mv, trak.d, trak.end, ['mdia', 'minf', 'stbl']);
                break;
            }
            o = trak.end;
        }
        if (!stbl || !scale) return cb('notrack');
        var stsd = box(mv, stbl.d, stbl.end, 'stsd'), mp4a = stsd && box(mv, stsd.d + 8, stsd.end, 'mp4a');
        if (!mp4a) return cb('notaac');
        var esds = box(mv, mp4a.d + 28, mp4a.end, 'esds');
        if (!esds) return cb('noesds');
        // the AudioSpecificConfig: tag 5 inside the descriptors
        var asc = -1;
        for (var k = esds.d + 4; k < esds.end - 2; k++) if (mv[k] === 5) { var q = k + 1, l = 0, n = 0; while (n++ < 4) { var c = mv[q++]; l = (l << 7) | (c & 127); if (!(c & 128)) break; } if (l >= 2 && l < 64) { asc = q; break; } }
        if (asc < 0) return cb('noasc');
        var ot = mv[asc] >> 3, sf = ((mv[asc] & 7) << 1) | (mv[asc + 1] >> 7), ch = (mv[asc + 1] >> 3) & 15;
        if (ot < 1 || ot > 4 || sf > 12 || !ch || ch > 7) return cb('aacprofile');
        var stts = box(mv, stbl.d, stbl.end, 'stts'), stsz = box(mv, stbl.d, stbl.end, 'stsz'), stsc = box(mv, stbl.d, stbl.end, 'stsc'),
            stco = box(mv, stbl.d, stbl.end, 'stco'), co64 = box(mv, stbl.d, stbl.end, 'co64');
        if (!stts || !stsz || !stsc || !(stco || co64)) return cb('notables');
        var cnt = u32(mv, stsz.d + 8), fixed = u32(mv, stsz.d + 4), size = new Uint32Array(cnt), off = new Float64Array(cnt), time = new Float64Array(cnt + 1), i;
        for (i = 0; i < cnt; i++) size[i] = fixed || u32(mv, stsz.d + 12 + i * 4);
        var s = 0, t = 0;
        for (var e = 0, ne = u32(mv, stts.d + 4); e < ne; e++) { var c2 = u32(mv, stts.d + 8 + e * 8), dl = u32(mv, stts.d + 12 + e * 8); for (var j = 0; j < c2 && s < cnt; j++) { time[s++] = t / scale; t += dl; } }
        while (s <= cnt) time[s++] = t / scale;
        var nch = u32(mv, (stco || co64).d + 4), chOff = function (ci) { return stco ? u32(mv, stco.d + 8 + ci * 4) : u32(mv, co64.d + 8 + ci * 8) * 4294967296 + u32(mv, co64.d + 12 + ci * 8); };
        var nsc = u32(mv, stsc.d + 4), si = 0;
        for (var r = 0; r < nsc; r++) {
            var first = u32(mv, stsc.d + 8 + r * 12) - 1, per = u32(mv, stsc.d + 12 + r * 12), lastC = r + 1 < nsc ? u32(mv, stsc.d + 8 + (r + 1) * 12) - 1 : nch;
            for (var cc = first; cc < lastC && si < cnt; cc++) { var po = chOff(cc); for (var m = 0; m < per && si < cnt; m++) { off[si] = po; po += size[si]; si++; } }
        }
        if (si < cnt) return cb('chunks');
        J.kind = 'm4a'; J.aac = { prof: ot - 1, sf: sf, ch: ch }; J.size_ = size; J.off_ = off; J.time_ = time; J.dur = time[cnt];
        cb(null);
    }
    function m4aPiece(J, t0, seg, cb) {
        var tm = J.time_, n = J.size_.length, lo = 0, hi = n - 1;
        while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (tm[mid] <= t0 - 0.15) lo = mid; else hi = mid - 1; }
        var a = lo, z = a;
        while (z < n - 1 && tm[z] < t0 + seg) z++;
        var b0 = J.off_[a], b1 = J.off_[z] + J.size_[z];
        for (var i = a; i <= z; i++) if (J.off_[i] < b0 || J.off_[i] + J.size_[i] > b1) return cb('scattered');
        if (b1 - b0 > 4 * 1024 * 1024) return cb('bigpiece');
        rd(J.track, b0, b1 - b0, function (x, b) {
            if (x) return cb(x);
            var tot = 0, k; for (k = a; k <= z; k++) tot += 7 + J.size_[k];
            var out = new Uint8Array(tot), o = 0, h = J.aac;
            for (k = a; k <= z; k++) {
                var sz = J.size_[k], s = J.off_[k] - b0, len = sz + 7;
                if (s + sz > b.length) break;
                out[o] = 255; out[o + 1] = 0xf1; out[o + 2] = (h.prof << 6) | (h.sf << 2) | (h.ch >> 2); out[o + 3] = ((h.ch & 3) << 6) | (len >> 11);
                out[o + 4] = (len >> 3) & 255; out[o + 5] = ((len & 7) << 5) | 31; out[o + 6] = 0xfc;
                out.set(b.subarray(s, s + sz), o + 7); o += len;
            }
            decode(out.slice(0, o).buffer, decoded(cb, tm[a]));
        });
    }

    // other formats: a USB file read in 1 MB pieces with pauses and decoded once; a Drive song: the player's own whole copy
    function wholeLoad(J) {
        function done(x, buf) { if (J.off) return; if (x || !buf || !buf.length) { J.fail = true; return; } J.pcm = buf.getChannelData(0); J.pcm2 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null; J.rate = buf.sampleRate; J.dur = buf.duration; J.loaded = true; }
        if (J.track.s === 'gd') {
            return (function wait() {
                if (J.off) return;
                var a = htmlEl();
                if (Music._grow && Music._grow() === 'whole' && a && /^blob:/.test(a.src)) return fetch(a.src).then(function (r) { return r.arrayBuffer(); }).then(function (b) { if (!J.off) decode(b, done); }, function () { J.fail = true; });
                if (Music._grow && !Music._grow()) { J.fail = true; return; }
                J.job = setTimeout(wait, 500);
            })();
        }
        if ((J.size || 0) > MAXB) { J.fail = true; return; }
        var parts = [], at = 0;
        (function next() {
            if (J.off) return;
            rd(J.track, at, 1024 * 1024, function (x, b) {
                if (J.off) return;
                if (x) { J.fail = true; return; }
                parts.push(b); at += b.length;
                if (b.length === 1024 * 1024 && at < MAXB && (!J.size || at < J.size)) { J.job = setTimeout(next, 30); return; }
                var all = new Uint8Array(at), o = 0;
                parts.forEach(function (p) { all.set(p, o); o += p.length; });
                parts = null;
                decode(all.buffer, done);
            });
        })();
    }

    function probe(J, cb) {
        rd(J.track, 0, 65536, function (x, b) {
            if (x || b.length < 16) return cb(x || 'short');
            J.size = J.track.size || 0;                                         // (every source notes the size on its first read)
            var t4 = str4(b, 0), t8 = str4(b, 4);
            function other() { J.kind = 'whole'; wholeLoad(J); cb(null); }
            function fine(e) { if (e) return other(); cb(null); }
            if (t4 === 'RIFF' && str4(b, 8) === 'WAVE') return wavProbe(J, b, fine);
            if (t4 === 'fLaC') return flacProbe(J, b, fine);
            if (t8 === 'ftyp') return m4aProbe(J, b, fine);
            if (t4 === 'OggS') return other();
            var start = 0;
            if (t4.slice(0, 3) === 'ID3') start = 10 + ((b[6] & 127) << 21 | (b[7] & 127) << 14 | (b[8] & 127) << 7 | (b[9] & 127)) + (b[5] & 16 ? 10 : 0);
            if (start + 8192 > b.length) return rd(J.track, start, 16384, function (x2, h) { if (x2) return cb(x2); mp3Probe(J, h, start, fine); });
            mp3Probe(J, b.subarray(start), start, fine);
        });
    }

    /* ---------------- the table: 30 spectra a second, made just ahead of where the song is ---------------- */
    var J = null, tickT = 0;
    function grow(n) {
        var m = Math.max(n, J.frames * 2), d = new Uint8Array(m * BANDS), r = new Uint8Array(m);
        d.set(J.data); r.set(J.ready); J.data = d; J.ready = r; J.frames = m;
    }
    function job(track, key) {
        if (J && J.key === key && !J.fail) { J.off = false; return J; }
        if (J) { J.off = true; clearTimeout(J.job); }
        J = { key: key, track: track, kind: '', size: 0, frames: 0, data: new Uint8Array(0), ready: new Uint8Array(0), busy: true, fail: false, off: false, job: 0, errs: 0 };
        var my = J;
        grow(60 * FPS);
        probe(my, function (x) {
            if (my.off) return;
            my.busy = false;
            if (x) { my.fail = true; return; }
            if (my.dur) grow(Math.ceil(my.dur * FPS) + 2);
        });
        return my;
    }
    // spectra of frames [f0, f1) from pcm (rate) starting at time t0, in slices of 5 ms so the page (and the music) never waits
    function frames(my, pcm, pcm2, rate, t0, f0, f1, done) {
        fftInit();
        var map = maps[rate] || (maps[rate] = bandMap(rate / N, N / 2)), f = f0;
        (function slice() {
            if (my.off) return;
            var end = Date.now() + 5;
            for (; f < f1; f++) {
                if (f >= my.frames) grow(f + 1);
                var e = Math.round((f / FPS - t0) * rate), k;
                if (e > pcm.length) break;
                for (k = 0; k < N; k++) { var j = e - N + k; re[k] = j >= 0 ? (pcm2 ? (pcm[j] + pcm2[j]) * 0.5 : pcm[j]) * win[k] : 0; im[k] = 0; }
                fft();
                for (k = 0; k < N / 2; k++) { var m = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / N; spec[k] = m > 1e-10 ? 20 * Math.log(m) / Math.LN10 : -200; }
                toBands(spec, map, outB);
                for (k = 0; k < BANDS; k++) { var q = Math.round((outB[k] + 120) * 2); my.data[f * BANDS + k] = q < 0 ? 0 : q > 255 ? 255 : q; }
                my.ready[f] = 1;
                if ((f & 3) === 3 && Date.now() > end) { f++; my.job = setTimeout(slice, 8); return; }
            }
            done();
        })();
    }
    function tick() {
        clearTimeout(tickT); tickT = 0;
        if (!on) return;
        tickT = setTimeout(tick, 200);
        var my = J;
        if (!my || my.off || my.busy || my.fail || !my.kind) return;
        var p = Math.max(0, Math.floor(Music.time() * FPS)), end = p + AHEAD * FPS, f = p;
        if (my.dur) end = Math.min(end, Math.ceil(my.dur * FPS));
        while (f < end && f < my.frames && my.ready[f]) f++;
        if (f >= end) return;
        my.busy = true;
        var fin = function () { my.busy = false; my.errs = 0; };
        if (my.kind === 'whole') { if (!my.loaded) { my.busy = false; return; } return frames(my, my.pcm, my.pcm2, my.rate, 0, f, Math.min(end, f + SEG * FPS), fin); }
        var piece = my.kind === 'mp3' ? mp3Piece : my.kind === 'wav' ? wavPiece : my.kind === 'flac' ? flacPiece : m4aPiece;
        // the moment the song is at has nothing yet: a short piece first (shows sooner), then 6 s pieces
        var seg = f === p ? 2 : SEG;
        piece(my, f / FPS, seg, function (x, pcm, rate, t0, pcm2) {
            if (my.off) return;
            if (x) { my.busy = false; if (++my.errs > 3) my.fail = true; return; }
            frames(my, pcm, pcm2, rate, t0, f, f + seg * FPS, fin);
        });
    }

    /* ---------------- API ---------------- */
    var st = null, stAt = 0;
    function read(db) {
        if (!on) { flat(db); return 'none'; }
        // the player's state, 5 times a second (not every frame: it is not free)
        var now = Date.now();
        if (!st || now - stAt > 200) { st = Music.state(); stAt = now; }
        var eng = Music.engineName(), a = eng === 'html' ? htmlEl() : null;
        if (!st.track || !eng) { flat(db); return 'none'; }
        if (a && liveOk(a)) return liveRead(a, st.playing, db);
        if (anStream) liveClose();
        var key = st.track.s + ':' + st.track.p, tb = job(st.track, key);
        if (!tickT) tick();
        if (tb.fail) { flat(db); return 'none'; }
        var fi = Math.floor(Music.time() * FPS);
        if (fi < 0 || fi >= tb.frames || !tb.ready[fi]) { flat(db); return 'wait'; }
        if (!st.playing || st.loading) { flat(db); return 'file'; }
        for (var i = 0; i < BANDS; i++) db[i] = tb.data[fi * BANDS + i] / 2 - 120;
        return 'file';
    }
    function start() { on = true; st = null; quiet = 0; rewire = false; liveNext = 0; }
    function stop() {
        on = false;
        clearTimeout(tickT); tickT = 0;
        liveClose();
        if (J) { J.off = true; clearTimeout(J.job); J.busy = false; if (J.kind === 'whole') J = null; }   // a small table is kept for the same song
    }

    return { BANDS: BANDS, LO_HZ: LO_HZ, HI_HZ: HI_HZ, FPS: FPS, start: start, stop: stop, read: read, _kind: function () { return J ? J.kind + (J.fail ? ' failed' : '') : ''; }, _noLive: function (v) { if (v !== undefined) noLive = v; return noLive; } };
})();
