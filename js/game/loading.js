/* Loading screen with a real, byte-weighted progress bar, for every game.
 *
 * LoadBar    the bar component: one element's transform (scaleX), at most ~10 repaints per second, never moves
 *            backwards, role="progressbar" with aria-valuenow, Voice Guide: "Loading <game>", then every 25% at
 *            most, then "Ready". Also used for the per-stage loading screens of big games.
 * GameLoader downloads the files listed in a game manifest with XHR and reports real downloaded bytes / total.
 *            A failed file is retried once; 20 s without any progress is a timeout.
 *
 * ES5 only. */
var LoadBar = (function () {
    'use strict';
    var MIN_INTERVAL = 100;          // ms between repaints (low-end TVs)
    var fill, pct, bar, box, value = 0, painted = -1, lastPaint = 0, trailing = 0, spoken = 0, name = '', indeterminate = false;

    function $(id) { return document.getElementById(id); }

    function init() {
        box = $('game-loading'); fill = $('game-loading-fill'); pct = $('game-loading-pct'); bar = $('game-loading-bar');
    }

    function paint() {
        trailing = 0;
        lastPaint = Date.now();
        var p = Math.round(value * 100);
        if (p === painted) return;
        painted = p;
        var t = 'scaleX(' + value + ')';
        fill.style.webkitTransform = t;
        fill.style.transform = t;
        pct.textContent = p + '%';
        bar.setAttribute('aria-valuenow', String(p));
        // Voice Guide: every 25% at most, never every tick
        var step = Math.floor(p / 25);
        if (step > spoken && p < 100) { spoken = step; A11y.announce(I18n.t('loading') + ' ' + name + ' ' + (step * 25) + '%'); }
    }

    // New loading screen (game start-up or a stage): bar back to 0, title, "Loading <title>".
    function start(title, quiet) {
        if (!box) init();
        clearTimeout(trailing);
        trailing = 0;
        value = 0; painted = -1; spoken = 0; name = title || '';
        setIndeterminate(false);
        $('game-loading-title').textContent = name;
        box.hidden = false;
        paint();
        if (!quiet) A11y.announce(I18n.t('loading') + ' ' + name);
    }

    // value 0..1, non-decreasing, repainted at most ~10 times per second
    function set(v) {
        if (!(v > value)) return;
        if (indeterminate) setIndeterminate(false);
        value = v > 1 ? 1 : v;
        var now = Date.now();
        if (value >= 1 || now - lastPaint >= MIN_INTERVAL) { clearTimeout(trailing); paint(); }
        else if (!trailing) trailing = setTimeout(paint, MIN_INTERVAL - (now - lastPaint));
    }

    // A steady animation for remote games that report nothing: never a frozen screen. The only CSS
    // animation of the loading screen, and only while no byte-weighted progress exists.
    function setIndeterminate(on) {
        if (on === indeterminate) return;
        indeterminate = on;
        fill.className = 'bar-fill' + (on ? ' indeterminate' : '');
        if (on) { pct.textContent = ''; painted = -1; }
    }

    function done() {
        set(1);
        clearTimeout(trailing);
        trailing = 0;
        paint();
        box.hidden = true;
        A11y.announce(I18n.t('ready'));
    }

    function hide() { clearTimeout(trailing); trailing = 0; if (box) box.hidden = true; }

    // Maps a 0..1 phase into the [from, to] part of the bar.
    function phase(from, to) { return function (p) { set(from + (to - from) * Math.max(0, Math.min(1, p))); }; }

    return { init: init, start: start, set: set, done: done, hide: hide, phase: phase, setIndeterminate: setIndeterminate,
             value: function () { return value; } };
})();

var GameLoader = (function () {
    'use strict';
    var STALL_MS = 20000, PARALLEL = 4;

    function typeOf(path) {
        if (/\.(png|jpe?g|gif|webp)$/i.test(path)) return 'image';
        if (/\.(mp3|ogg|wav|m4a|aac)$/i.test(path)) return 'audio';
        if (/\.json$/i.test(path)) return 'json';
        return 'text';
    }

    // spec: { files: [{ path, size }], base, build, onProgress(0..1) }
    // callback: cb(err, { path: text | parsed JSON | Blob | ArrayBuffer })  -- err names the failed file
    // returns { abort() }
    function run(spec, cb) {
        var files = spec.files, n = files.length, i, total = 0, known = 0, knownN = 0;
        var loaded = [], size = [], started = 0, finished = 0, active = 0, out = {}, over = false, stall = 0, xhrs = [];
        for (i = 0; i < n; i++) if (files[i].size > 0) { known += files[i].size; knownN++; }
        var avg = knownN ? known / knownN : 1;
        for (i = 0; i < n; i++) { size[i] = files[i].size > 0 ? files[i].size : avg; total += size[i]; loaded[i] = 0; }
        if (!n) { if (spec.onProgress) spec.onProgress(1); return { abort: function () {} }; }

        function report() {
            var sum = 0;
            for (var k = 0; k < n; k++) sum += loaded[k];
            if (spec.onProgress) spec.onProgress(Math.min(1, sum / total));
        }
        function arm() {
            clearTimeout(stall);
            stall = setTimeout(function () { finish('timeout'); }, STALL_MS);
        }
        function finish(err) {
            if (over) return;
            over = true;
            clearTimeout(stall);
            if (err) for (var k = 0; k < xhrs.length; k++) { try { xhrs[k].abort(); } catch (e) {} }
            xhrs.length = 0;
            cb(err, err ? null : out);
        }

        function fetchOne(idx, attempt) {
            var f = files[idx], kind = typeOf(f.path), xhr = new XMLHttpRequest();
            xhrs.push(xhr);
            var url = spec.base + f.path + (spec.build ? '?b=' + spec.build : '');
            try {
                xhr.open('GET', url, true);
                if (kind === 'image') xhr.responseType = 'blob';
                else if (kind === 'audio') xhr.responseType = 'arraybuffer';
            } catch (e) { return fail(); }
            xhr.onprogress = function (e) {
                if (over) return;
                loaded[idx] = Math.min(size[idx], e.loaded);
                // "almost done" stays below 100% of the file until onload confirms it
                if (loaded[idx] >= size[idx]) loaded[idx] = size[idx] * 0.99;
                arm(); report();
            };
            xhr.onload = function () {
                if (over) return;
                // Packaged files report status 0 on some firmwares.
                var ok = (xhr.status >= 200 && xhr.status < 300) || (xhr.status === 0 && (xhr.response || xhr.responseText));
                if (!ok) return fail();
                var v = kind === 'text' || kind === 'json' ? xhr.responseText : xhr.response;
                if (kind === 'json') { try { v = JSON.parse(v); } catch (e) { return fail(); } }
                out[f.path] = v;
                loaded[idx] = size[idx];
                finished++; active--;
                arm(); report();
                if (finished === n) finish(null); else next();
            };
            xhr.onerror = xhr.ontimeout = fail;
            function fail() {
                if (over) return;
                if (attempt < 1) { loaded[idx] = 0; return fetchOne(idx, attempt + 1); }   // retried once
                finish(f.path);
            }
            try { xhr.send(); } catch (e2) { fail(); }
        }

        function next() {
            while (!over && active < PARALLEL && started < n) { active++; fetchOne(started++, 0); }
        }
        arm();
        next();
        return { abort: function () { over = true; clearTimeout(stall); for (var k = 0; k < xhrs.length; k++) { try { xhrs[k].abort(); } catch (e) {} } xhrs.length = 0; } };
    }

    // Decodes downloaded images (Image.decode where available) and audio files. Returns assets a game can
    // fetch with Arcade.asset(path): parsed JSON, a blob: URL for images, an AudioBuffer for audio.
    function decode(results, files, onProgress, cb) {
        var todo = [], i, assets = {}, urls = [];
        for (i = 0; i < files.length; i++) {
            var p = files[i].path, kind = typeOf(p);
            if (kind === 'json') assets[p] = results[p];
            else if (kind === 'image' || kind === 'audio') todo.push({ path: p, kind: kind });
        }
        var left = todo.length, ctx = null;
        function one() {
            if (onProgress) onProgress(todo.length ? 1 - left / todo.length : 1);
            if (--left <= 0) { if (ctx && ctx.close) { try { ctx.close(); } catch (e) {} } cb(assets, urls); }
        }
        if (!todo.length) return cb(assets, urls);
        for (i = 0; i < todo.length; i++) (function (t) {
            if (t.kind === 'image') {
                var u = (window.URL || window.webkitURL).createObjectURL(results[t.path]), img = new Image();
                urls.push(u);
                assets[t.path] = u;
                img.onload = img.onerror = one;
                img.src = u;
                if (img.decode) { try { img.decode().then(one, one); img.onload = img.onerror = null; } catch (e) { img.onload = img.onerror = one; } }
            } else {
                var AC = window.AudioContext || window.webkitAudioContext;
                if (!AC) return one();
                try { ctx = ctx || new AC(); ctx.decodeAudioData(results[t.path], function (b) { assets[t.path] = b; one(); }, one); } catch (e2) { one(); }
            }
        })(todo[i]);
    }

    return { run: run, decode: decode, typeOf: typeOf };
})();
