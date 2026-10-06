/* GameKit: shared runtime for every game (runs inside the game iframe).
 *
 * - Builds window.GameAPI (init/start/pause/resume/destroy/menuItems/onMenu/onAction) from a
 *   small game definition, so each game only writes load/start/update/render.
 * - Fixed 60 Hz update with interpolated rendering; at most 5 catch-up steps per frame.
 * - Adapts to the TV: starts from host.quality (tier picked by the launcher) and, in Auto mode,
 *   lowers effects -> 30 fps rendering -> canvas resolution when frames keep dropping.
 * - One AudioContext per game: original chiptune music and SFX synthesised with oscillators
 *   (no audio files to download or decode). Created in start(), closed in destroy().
 * - No setTimeout/setInterval: everything runs from the single rAF loop, so destroy() only has
 *   to cancel one rAF and close the AudioContext.
 * ES5 only (runs on Tizen 4.0 / Chromium 56 and newer).
 */
var GK = (function () {
    'use strict';

    var W = 480, H = 270, STEP = 1000 / 60;

    /* ------------------------------------------------------------------ audio */

    function Synth(q) {
        this.ctx = null; this.q = q;
        this.musicVol = 0.7; this.sfxVol = 0.8; this.ducked = false;
        this.song = null; this.step = 0; this.nextTime = 0; this.active = 0;
    }
    Synth.prototype.create = function () {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC || this.ctx) return;
        try { this.ctx = new AC(); } catch (e) { this.ctx = null; return; }
        var c = this.ctx;
        this.master = c.createGain(); this.master.connect(c.destination);
        this.mGain = c.createGain(); this.mGain.connect(this.master);
        this.sGain = c.createGain(); this.sGain.connect(this.master);
        this.applyVolume();
        var len = Math.floor(c.sampleRate * 0.4);
        this.noise = c.createBuffer(1, len, c.sampleRate);
        var d = this.noise.getChannelData(0), seed = 7;
        for (var i = 0; i < len; i++) { seed = (seed * 16807) % 2147483647; d[i] = seed / 1073741823.5 - 1; }
    };
    Synth.prototype.applyVolume = function () {
        if (!this.ctx) return;
        this.mGain.gain.value = this.musicVol * 0.55 * (this.ducked ? 0.3 : 1);
        this.sGain.gain.value = this.sfxVol * 0.6;
    };
    Synth.prototype.setVolumes = function (m, s) { this.musicVol = m; this.sfxVol = s; this.applyVolume(); };
    Synth.prototype.duck = function (on) { this.ducked = on; this.applyVolume(); };
    Synth.prototype.suspend = function () { if (this.ctx && this.ctx.suspend) { try { this.ctx.suspend(); } catch (e) {} } };
    Synth.prototype.resume = function () {
        if (!this.ctx) return;
        if (this.ctx.resume && this.ctx.state !== 'running') { try { this.ctx.resume(); } catch (e) {} }
        this.nextTime = this.ctx.currentTime + 0.06;
    };
    Synth.prototype.close = function () {
        this.song = null;
        if (this.ctx) { try { this.ctx.close(); } catch (e) {} }
        this.ctx = null; this.noise = null;
    };

    function freq(n) { return 440 * Math.pow(2, (n - 69) / 12); }
    var NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    function midi(tok) {   // "C#5" -> 73
        var n = NOTE[tok.charAt(0)], i = 1;
        if (tok.charAt(1) === '#') { n++; i++; } else if (tok.charAt(1) === 'b') { n--; i++; }
        return n + 12 * (parseInt(tok.slice(i), 10) + 1);
    }

    // tone(type, f0, f1, dur, vol, when, dest)
    Synth.prototype.tone = function (type, f0, f1, dur, vol, t, dest) {
        var c = this.ctx, o = c.createOscillator(), g = c.createGain();
        o.type = type;
        o.frequency.setValueAtTime(f0, t);
        if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(g); g.connect(dest);
        o.start(t); o.stop(t + dur + 0.02);
        return o;
    };
    Synth.prototype.noiseHit = function (dur, vol, t, dest, hp) {
        var c = this.ctx, s = c.createBufferSource(), g = c.createGain();
        s.buffer = this.noise;
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        if (hp) {
            var f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp;
            s.connect(f); f.connect(g);
        } else s.connect(g);
        g.connect(dest);
        s.start(t); s.stop(t + dur + 0.02);
        return s;
    };

    // SFX presets: [wave, f0, f1, dur, vol] steps played in sequence; 'n' = noise
    var SFX = {
        jump:    [['square', 260, 620, 0.12, 0.25]],
        bigjump: [['square', 200, 520, 0.16, 0.25]],
        coin:    [['square', 988, 988, 0.06, 0.2], ['square', 1319, 1319, 0.22, 0.2]],
        stomp:   [['square', 420, 120, 0.1, 0.3], ['n', 0, 0, 0.06, 0.25]],
        kick:    [['square', 300, 900, 0.07, 0.25]],
        bump:    [['triangle', 160, 90, 0.1, 0.45]],
        brk:     [['n', 0, 0, 0.18, 0.4], ['square', 180, 60, 0.12, 0.2]],
        power:   [['square', 392, 392, 0.06, 0.2], ['square', 523, 523, 0.06, 0.2], ['square', 659, 659, 0.06, 0.2], ['square', 784, 784, 0.06, 0.2], ['square', 1047, 1047, 0.14, 0.2]],
        sprout:  [['triangle', 300, 900, 0.35, 0.3]],
        fire:    [['square', 900, 300, 0.08, 0.18]],
        pipe:    [['square', 160, 80, 0.12, 0.3], ['square', 160, 80, 0.12, 0.3], ['square', 160, 80, 0.12, 0.3]],
        oneup:   [['square', 659, 659, 0.08, 0.2], ['square', 784, 784, 0.08, 0.2], ['square', 1319, 1319, 0.08, 0.2], ['square', 1047, 1047, 0.08, 0.2], ['square', 1175, 1175, 0.08, 0.2], ['square', 1568, 1568, 0.16, 0.2]],
        hurt:    [['square', 600, 150, 0.3, 0.25]],
        die:     [['square', 700, 600, 0.12, 0.25], ['square', 600, 120, 0.6, 0.25]],
        check:   [['triangle', 523, 523, 0.1, 0.35], ['triangle', 784, 784, 0.1, 0.35], ['triangle', 1047, 1047, 0.2, 0.35]],
        goal:    [['square', 523, 1047, 0.5, 0.22]],
        tick:    [['square', 1500, 1500, 0.03, 0.12]],
        move:    [['square', 220, 220, 0.03, 0.12]],
        rotate:  [['triangle', 600, 800, 0.05, 0.25]],
        drop:    [['triangle', 200, 80, 0.1, 0.4]],
        clear:   [['square', 523, 523, 0.07, 0.2], ['square', 659, 659, 0.07, 0.2], ['square', 784, 784, 0.07, 0.2], ['square', 1047, 1047, 0.16, 0.2]],
        tetra:   [['square', 523, 1047, 0.1, 0.22], ['square', 659, 1319, 0.1, 0.22], ['square', 784, 1568, 0.25, 0.22]],
        over:    [['triangle', 392, 392, 0.2, 0.4], ['triangle', 330, 330, 0.2, 0.4], ['triangle', 262, 262, 0.5, 0.4]],
        bounce:  [['triangle', 300, 600, 0.08, 0.35]],
        spring:  [['square', 200, 1000, 0.25, 0.22]],
        blip:    [['square', 880, 880, 0.04, 0.15]],
        eat:     [['square', 660, 990, 0.06, 0.22]],
        boss:    [['square', 150, 60, 0.4, 0.3], ['n', 0, 0, 0.3, 0.3]],
        merge:   [['triangle', 500, 750, 0.08, 0.3]],
        lose:    [['square', 400, 100, 0.4, 0.25]]
    };

    Synth.prototype.sfx = function (name, pitch) {
        var c = this.ctx, seq = SFX[name];
        if (!c || !seq || c.state !== 'running' || this.sfxVol <= 0) return;
        if (this.active > 8) return;   // cap simultaneous voices on weak TVs
        var t = c.currentTime, self = this, p = pitch || 1, last = null;
        for (var i = 0; i < seq.length; i++) {
            var s = seq[i];
            last = s[0] === 'n' ? this.noiseHit(s[3], s[4], t, this.sGain) : this.tone(s[0], s[1] * p, s[2] * p, s[3], s[4], t, this.sGain);
            t += s[3] * 0.9;
        }
        this.active++;
        last.onended = function () { self.active--; };
    };

    // Song: { bpm, tracks: [{ wave, vol, notes: "C5 - E5 . ..." }, { drums: "k . h . s . h ." }] }
    // One token per 16th note: note = new note, '-' = hold, '.' = rest.
    function parseSong(song) {
        if (song._parsed) return song;
        for (var i = 0; i < song.tracks.length; i++) {
            var tr = song.tracks[i], toks = (tr.notes || tr.drums).split(/\s+/), out = [];
            // "A4:4" = note held for 4 steps, ".:8" = 8 steps of rest, "k:2" = drum + 1 empty step
            for (var j = 0; j < toks.length; j++) {
                if (!toks[j]) continue;
                var p = toks[j].split(':'), n = p.length > 1 ? parseInt(p[1], 10) : 1;
                out.push(p[0]);
                for (var r = 1; r < n; r++) out.push(p[0] === '.' ? '.' : tr.drums ? '.' : '-');
            }
            tr.steps = out;
            tr.len = [];
            for (j = 0; j < out.length; j++) {
                var L = 0;
                if (!tr.drums && out[j] !== '-' && out[j] !== '.') { L = 1; while (out[(j + L) % out.length] === '-' && L < out.length) L++; }
                tr.len.push(L);
                if (!tr.drums && out[j] !== '-' && out[j] !== '.') out[j] = midi(out[j]);
            }
        }
        song._parsed = true;
        return song;
    }

    Synth.prototype.music = function (song) {
        if (this.song === song) return;
        this.song = song ? parseSong(song) : null;
        this.step = 0;
        if (this.ctx) this.nextTime = this.ctx.currentTime + 0.08;
    };

    // Called every frame from the game loop (lookahead scheduler, no timers).
    Synth.prototype.tick = function () {
        var c = this.ctx, s = this.song;
        if (!c || !s || c.state !== 'running' || this.musicVol <= 0) { if (c && s) this.nextTime = c.currentTime + 0.05; return; }
        var dt = 60 / s.bpm / 4, maxVoices = this.q.musicVoices || 3;
        if (this.nextTime < c.currentTime - 0.2) this.nextTime = c.currentTime + 0.02;
        while (this.nextTime < c.currentTime + 0.15) {
            var t = this.nextTime;
            for (var i = 0; i < s.tracks.length && i < maxVoices; i++) {
                var tr = s.tracks[i], idx = this.step % tr.steps.length, v = tr.steps[idx];
                if (tr.drums) {
                    if (v === 'k') this.tone('sine', 150, 45, 0.12, 0.6 * (tr.vol || 1), t, this.mGain);
                    else if (v === 's') this.noiseHit(0.1, 0.32 * (tr.vol || 1), t, this.mGain, 1200);
                    else if (v === 'h') this.noiseHit(0.03, 0.12 * (tr.vol || 1), t, this.mGain, 6000);
                } else if (typeof v === 'number') {
                    var dur = tr.len[idx] * dt * 0.92;
                    this.tone(tr.wave || 'square', freq(v + (s.transpose || 0)), 0, dur, tr.vol || 0.15, t, this.mGain);
                }
            }
            this.step++;
            if (s.once && this.step >= s.tracks[0].steps.length) { this.song = null; return; }
            this.nextTime += dt;
        }
    };

    /* ------------------------------------------------------------------ helpers */

    function rng(seed) {
        var s = (seed >>> 0) || 1;
        return function () { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
    }
    function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

    // Fixed-size particle pool: no allocation in the game loop.
    function Particles(max) {
        this.max = max; this.n = 0;
        this.x = new Float32Array(max); this.y = new Float32Array(max);
        this.vx = new Float32Array(max); this.vy = new Float32Array(max);
        this.life = new Float32Array(max); this.g = new Float32Array(max);
        this.size = new Float32Array(max); this.col = new Array(max);
    }
    Particles.prototype.add = function (x, y, vx, vy, life, col, size, g) {
        if (this.n >= this.max) return;
        var i = this.n++;
        this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
        this.life[i] = life; this.col[i] = col; this.size[i] = size || 2; this.g[i] = g === undefined ? 0.15 : g;
    };
    Particles.prototype.update = function () {
        for (var i = 0; i < this.n; i++) {
            this.vy[i] += this.g[i]; this.x[i] += this.vx[i]; this.y[i] += this.vy[i];
            if (--this.life[i] <= 0) {   // swap-remove
                var j = --this.n;
                this.x[i] = this.x[j]; this.y[i] = this.y[j]; this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j];
                this.life[i] = this.life[j]; this.col[i] = this.col[j]; this.size[i] = this.size[j]; this.g[i] = this.g[j];
                i--;
            }
        }
    };
    Particles.prototype.draw = function (ctx, ox, oy) {
        for (var i = 0; i < this.n; i++) {
            ctx.fillStyle = this.col[i];
            ctx.fillRect((this.x[i] - ox) | 0, (this.y[i] - oy) | 0, this.size[i], this.size[i]);
        }
    };
    Particles.prototype.clear = function () { this.n = 0; };

    /* ------------------------------------------------------------------ game wrapper */

    function create(def) {
        var host = null, canvas = null, ctx = null;
        var raf = 0, running = false, last = 0, acc = 0, frameN = 0;
        var edges = [], edgeN = 0;
        var perf = { level: 0, sum: 0, n: 0, grace: 120, slowWindows: 0 };
        var started = false, destroyed = false;
        var onKeyDown = null, onKeyUp = null;

        var gk = {
            W: W, H: H, def: def, frame: 0, renderEvery: 1,
            rng: rng, clamp: clamp, Particles: Particles,
            isDown: function (a) { return host ? host.input.isDown(a) : false; },
            pressed: function (a) { for (var i = 0; i < edgeN; i++) if (edges[i] === a) return true; return false; },
            announce: function (t) { if (host) host.announce(t); },
            save: function (k, v) { if (host) host.save(k, v); },
            load: function (k, d) { return host ? host.load(k, d) : d; },
            exit: function () { if (host) host.exitToMenu(); },
            pause: function () { if (host) host.pause(); },
            perfGrace: function (f) { perf.grace = f || 90; perf.sum = perf.n = 0; },
            setText: function (el, v) { v = String(v); if (el._v !== v) { el._v = v; el.textContent = v; } }
        };

        function setupCanvas() {
            var q = gk.q;
            gk.scale = Math.max(def.minScale || 1, Math.min(def.maxScale || 4, q.scale));
            canvas.width = W * gk.scale;
            canvas.height = H * gk.scale;
            ctx.setTransform(gk.scale, 0, 0, gk.scale, 0, 0);
            ctx.imageSmoothingEnabled = !def.pixelArt;
            ctx.webkitImageSmoothingEnabled = !def.pixelArt;
        }

        // Adaptive quality: average frame time over ~2 s windows.
        function monitor(dt) {
            if (perf.grace > 0) { perf.grace--; return; }
            perf.sum += dt; perf.n++;
            if (perf.n < 120) return;
            var avg = perf.sum / perf.n * gk.renderEvery;   // per rendered frame
            var fps = 1000 / (perf.sum / perf.n);
            perf.sum = perf.n = 0;
            gk.fps = Math.round(fps);
            if (fps >= 52) { perf.slowWindows = 0; return; }
            if (++perf.slowWindows < 2) return;
            perf.slowWindows = 0;
            degrade(avg);
        }

        function degrade() {
            var q = gk.q;
            if (perf.level === 0 && q.auto) {
                perf.level = 1;
                q.particles = Math.max(12, q.particles >> 1);
                q.parallax = Math.max(1, q.parallax - 1);
                q.clouds = false;
                if (def.onQuality) def.onQuality(gk, 1);
            } else if (perf.level <= 1) {
                perf.level = 2;
                gk.renderEvery = 2;                         // 30 fps rendering, 60 Hz gameplay
                if (def.onQuality) def.onQuality(gk, 2);
            } else if (perf.level === 2 && q.auto && gk.scale > (def.minScale || 1)) {
                perf.level = 3;
                q.scale = Math.max(def.minScale || 1, gk.scale >> 1);
                setupCanvas();
                if (def.onQuality) def.onQuality(gk, 3);
            }
            perf.grace = 60;
            try { console.log('[GameKit] quality level ' + perf.level + ' (scale ' + gk.scale + ', render every ' + gk.renderEvery + ')'); } catch (e) {}
        }

        function frame(ts) {
            raf = requestAnimationFrame(frame);
            host.input.poll();
            if (!last) last = ts;
            var dt = ts - last;
            last = ts;
            if (dt > 250) dt = 250;
            acc += dt;
            var steps = 0;
            while (acc >= STEP && steps < 5) {
                def.update(gk);
                gk.frame++;
                edgeN = 0;               // edges are consumed by the first update that sees them
                acc -= STEP;
                steps++;
            }
            if (steps === 5) acc = 0;    // too slow: drop time instead of spiralling
            if (gk.audio) gk.audio.tick();
            monitor(dt);
            frameN++;
            if (steps && frameN % gk.renderEvery === 0) def.render(gk, acc / STEP);
        }

        function startLoop() {
            if (running || destroyed) return;
            running = true; last = 0; acc = 0;
            raf = requestAnimationFrame(frame);
        }
        function stopLoop() {
            running = false;
            if (raf) cancelAnimationFrame(raf);
            raf = 0;
        }

        var api = {
            init: function (h) {
                host = h;
                gk.host = h;
                gk.lang = h.lang;
                gk.q = h.quality;
                canvas = document.getElementById('game');
                ctx = canvas.getContext('2d', { alpha: false });
                gk.canvas = canvas; gk.ctx = ctx;
                setupCanvas();
                document.documentElement.setAttribute('lang', h.lang);
                document.documentElement.setAttribute('dir', h.rtl ? 'rtl' : 'ltr');
                onKeyDown = function (e) { h.forwardKey(e, true); };
                onKeyUp = function (e) { h.forwardKey(e, false); };
                document.addEventListener('keydown', onKeyDown);
                document.addEventListener('keyup', onKeyUp);
                gk.audio = new Synth(gk.q);
                gk.audio.setVolumes(h.volume.music, h.volume.sfx);
                var done = function () { h.progress(1); h.loaded(); };
                if (def.load) def.load(gk, h.progress, done, h.failed);
                else done();
            },
            start: function () {
                started = true;
                gk.audio.create();
                gk.audio.resume();
                def.start(gk);
                gk.perfGrace(120);
                startLoop();
            },
            pause: function () {
                stopLoop();
                if (gk.audio) gk.audio.suspend();
                if (def.pause) def.pause(gk);
            },
            resume: function () {
                if (gk.audio) gk.audio.resume();
                if (def.resume) def.resume(gk);
                gk.perfGrace(60);
                startLoop();
            },
            destroy: function () {
                destroyed = true;
                stopLoop();
                if (gk.audio) gk.audio.close();
                if (def.destroy) { try { def.destroy(gk); } catch (e) {} }
                if (onKeyDown) { document.removeEventListener('keydown', onKeyDown); document.removeEventListener('keyup', onKeyUp); }
                if (canvas) { canvas.width = canvas.height = 0; }
                window.GameAPI = null;
                gk.host = host = null; gk.canvas = gk.ctx = canvas = ctx = null; gk.audio = null;
            },
            menuItems: function () { return def.menuItems ? def.menuItems(gk) : []; },
            onMenu: function (id) { return def.onMenu ? def.onMenu(gk, id) : undefined; },
            onAction: function (a, pressed, repeat) {
                if (pressed && !repeat && edgeN < 16) edges[edgeN++] = a;
                if (pressed && gk.audio && gk.audio.ctx && gk.audio.ctx.state === 'suspended' && running) gk.audio.resume();
                if (def.onAction) def.onAction(gk, a, pressed, repeat);
            },
            // test/diagnostic hooks
            _gk: gk,
            _isRunning: function () { return running; },
            _hasAudio: function () { return !!(gk.audio && gk.audio.ctx); }
        };

        window.GameAPI = api;
        // Errors before the game is loaded make the launcher show Retry / Back (or the bundled copy).
        window.onerror = function (msg) {
            if (host && !started) host.failed(String(msg));
            else if (!host && parent.ArcadeHost && parent.ArcadeHost.isLoading()) {
                // not attached yet: the launcher's load timeout will report it
            }
        };
        if (parent && parent.ArcadeHost) parent.ArcadeHost.attach(window);
        return gk;
    }

    /* ------------------------------------------------------------------ drawing helpers */

    function text(ctx, s, x, y, size, color, align, bold) {
        ctx.font = (bold === false ? '' : 'bold ') + size + 'px Arial, sans-serif';
        ctx.textAlign = align || 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = color || '#fff';
        ctx.fillText(s, x, y);
    }
    function roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }
    // Picks the current language from { en, fr, es, ar } tables.
    function tr(table, lang) { return function (k) { var t = table[lang] || table.en; return t[k] !== undefined ? t[k] : table.en[k]; }; }

    // DOM HUD (crisp text at any canvas resolution, only touched when a value changes).
    // hud([['score', 'Score'], ...]) -> { score: <span>, ... }
    function hud(items, rows) {
        var root = document.getElementById('hud'), out = {};
        root.innerHTML = '';
        var row = document.createElement('div');
        row.className = 'hud-row';
        root.appendChild(row);
        for (var i = 0; i < items.length; i++) {
            if (items[i] === '|') { row = document.createElement('div'); row.className = 'hud-row'; root.appendChild(row); continue; }
            var d = document.createElement('div'), s = document.createElement('small'), v = document.createElement('span');
            d.className = 'hud-item';
            s.textContent = items[i][1];
            if (items[i][1]) d.appendChild(s);
            d.appendChild(v);
            row.appendChild(d);
            out[items[i][0]] = v;
            out[items[i][0] + 'Box'] = d;
        }
        return out;
    }
    function banner(title, sub) {
        var b = document.getElementById('banner');
        if (!title) { b.hidden = true; return; }
        b.innerHTML = '';
        b.appendChild(document.createTextNode(title));
        if (sub) { var s = document.createElement('small'); s.textContent = sub; b.appendChild(s); }
        b.hidden = false;
    }

    return { create: create, rng: rng, hud: hud, banner: banner, clamp: clamp, text: text, roundRect: roundRect, tr: tr, Particles: Particles, W: W, H: H };
})();
