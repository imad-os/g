/* Device performance profile.
 *
 * Picks a quality tier from what the TV exposes (Tizen version, CPU cores, RAM) and from a short
 * GPU/canvas benchmark run once per device while the menu is idle. Games receive the profile
 * through host.quality and also adapt at run time: when frames drop they lower their effects and
 * switch to a 30 fps render mode (gameplay keeps running at a fixed 60 Hz).
 *
 *   low  : 480x270 canvas (scaled by the GPU), few particles, 1 parallax layer, 2 music voices
 *   mid  : 960x540 canvas, more particles, 2 parallax layers, 3 voices
 *   high : 1920x1080 canvas (native, no scaling), all effects
 */
var Perf = (function () {
    'use strict';

    var TIERS = ['low', 'mid', 'high'];
    var PROFILES = {
        low:  { tier: 'low',  scale: 1, particles: 24,  parallax: 1, clouds: false, shake: true, musicVoices: 2, smoothUI: false },
        mid:  { tier: 'mid',  scale: 2, particles: 64,  parallax: 2, clouds: true,  shake: true, musicVoices: 3, smoothUI: true },
        high: { tier: 'high', scale: 4, particles: 160, parallax: 3, clouds: true,  shake: true, musicVoices: 3, smoothUI: true }
    };
    var BENCH_KEY = 'perf_bench_v1';

    var signals = null;

    function tizenVersion() {
        try {
            var v = tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version');
            return parseFloat(v) || 0;
        } catch (e) { return 0; }
    }

    function detect() {
        if (signals) return signals;
        var s = {
            tv: !!window.tizen,
            tizen: window.tizen ? tizenVersion() : 0,
            cores: navigator.hardwareConcurrency || 0,
            memGB: navigator.deviceMemory || 0,
            bench: Store.get(BENCH_KEY, null)       // { fps, ms } from a previous run
        };
        signals = s;
        return s;
    }

    // Heuristic tier, refined by the benchmark when we have one.
    function autoTier() {
        var s = detect(), t;
        if (s.tv) {
            if (s.tizen && s.tizen < 5) t = 0;           // 2018-2019 TVs
            else if (s.tizen && s.tizen < 7) t = 1;      // 2020-2022
            else t = 2;                                  // 2023+
            if (s.cores && s.cores <= 2) t = Math.min(t, 0);
            else if (s.cores && s.cores <= 4) t = Math.min(t, 1);
        } else {
            t = 2;
            if (s.cores && s.cores <= 2) t = 1;
        }
        if (s.memGB && s.memGB <= 1) t = 0;
        else if (s.memGB && s.memGB <= 2) t = Math.min(t, 1);
        if (s.bench) {
            if (s.bench.fps < 45) t = Math.min(t, 0);
            else if (s.bench.fps < 57) t = Math.min(t, 1);
            else if (s.bench.fps >= 59 && s.bench.ms < 6) t = Math.max(t, s.tv ? 1 : 2);
        }
        return TIERS[t];
    }

    function setting() { return Store.get('gfx', 'auto'); }

    function profile() {
        var choice = setting();
        var tier = choice === 'auto' ? autoTier() : choice;
        var p = PROFILES[tier] || PROFILES.mid, out = {};
        for (var k in p) out[k] = p[k];
        out.auto = choice === 'auto';
        // A PC window smaller than 1080p does not need a 1080p canvas.
        if (!window.tizen && out.scale === 4) {
            var h = (window.innerHeight || 1080) * (window.devicePixelRatio || 1);
            out.scale = h >= 1000 ? 4 : h >= 700 ? 3 : 2;
        }
        return out;
    }

    // ~0.6 s rAF benchmark drawing a typical game frame at 960x540. Runs once per device/engine,
    // only while the launcher is idle, and never while a game is running.
    function benchmark(done) {
        var s = detect();
        if (s.bench && s.bench.ua === navigator.userAgent) { if (done) done(s.bench); return; }
        var c = document.createElement('canvas');
        c.width = 960; c.height = 540;
        var ctx = c.getContext('2d');
        var spr = document.createElement('canvas');
        spr.width = 64; spr.height = 64;
        var sctx = spr.getContext('2d');
        sctx.fillStyle = '#e94'; sctx.fillRect(0, 0, 64, 64);
        sctx.fillStyle = '#4ae'; sctx.fillRect(8, 8, 48, 48);
        var frames = 0, start = 0, last = 0, work = 0, id = 0;
        function frame(ts) {
            if (!start) { start = last = ts; id = requestAnimationFrame(frame); return; }
            var t0 = Date.now();
            ctx.fillStyle = '#123'; ctx.fillRect(0, 0, 960, 540);
            for (var i = 0; i < 400; i++) ctx.drawImage(spr, 0, 0, 32, 32, (i * 37) % 928, (i * 53) % 508, 32, 32);
            ctx.getImageData(0, 0, 1, 1);   // force the frame to be rasterised
            work += Date.now() - t0;
            frames++;
            last = ts;
            if (ts - start < 600) id = requestAnimationFrame(frame);
            else finish();
        }
        function finish() {
            var res = { fps: Math.round(frames * 1000 / Math.max(1, last - start)), ms: +(work / frames).toFixed(2), ua: navigator.userAgent };
            Store.set(BENCH_KEY, res);
            signals.bench = res;
            c.width = c.height = spr.width = spr.height = 0;   // free the backing stores
            if (done) done(res);
        }
        id = requestAnimationFrame(frame);
        return function cancel() { cancelAnimationFrame(id); };
    }

    function describe() {
        var s = detect(), p = profile();
        return p.tier + (p.auto ? ' (auto)' : '') + ' · ' + (480 * p.scale) + 'x' + (270 * p.scale) +
            (s.tizen ? ' · Tizen ' + s.tizen : '') + (s.cores ? ' · ' + s.cores + ' cores' : '') +
            (s.bench ? ' · bench ' + s.bench.fps + ' fps / ' + s.bench.ms + ' ms' : '');
    }

    return { profile: profile, setting: setting, setSetting: function (v) { Store.set('gfx', v); },
             benchmark: benchmark, describe: describe, detect: detect };
})();
