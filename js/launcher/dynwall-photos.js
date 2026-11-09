/* Photos of the Horizon background (owner request 2026-11-09): the Realistic style uses the built-in pack (wallpapers/real/<name>.jpg,
 * free licences, credits in wallpapers/real/CREDITS.md); the Custom style uses the profile's own set, loaded once from Google Drive
 * (or, in a PC browser, a folder of the computer) and kept on this device in IndexedDB (not in the backup: pictures are big). A name
 * the custom set lacks falls back to the built-in photo.
 *
 * One photo per weather, named like the files: clear-day clear-dawn clear-dusk clear-night partly-day cloudy-day cloudy-night
 * rain-day rain-night storm snow-day snow-night fog (.jpg / .jpeg / .png / .webp). The user's guide on screen is dwCustomGuide.
 *
 *   DynPhotos.names(k, phase)        the names to try for a sky (Weather.sky k) and a time of day, best first
 *   DynPhotos.get(style, k, phase, cb(img, id))   cb(null) when nothing could be loaded
 *   DynPhotos.custom()               { name: true } of the profile's own pictures (Store key dynwall_custom)
 *   DynPhotos.loadDrive(onStep, cb(err, n)) / loadFolder(onStep, cb) / clear(cb)
 */
var DynPhotos = (function () {
    'use strict';

    var NAMES = ['clear-day', 'clear-dawn', 'clear-dusk', 'clear-night', 'partly-day', 'cloudy-day', 'cloudy-night',
                 'rain-day', 'rain-night', 'storm', 'snow-day', 'snow-night', 'fog'];
    var DB = 'mypc-horizon', ST = 'pics', MAX_BYTES = 12 * 1048576;

    function base() { return (typeof AppBoot !== 'undefined' && AppBoot.base && AppBoot.base()) || ''; }
    function who() { var p = null; try { p = JSON.parse(localStorage.getItem('arc_profile')); } catch (e) {} return typeof p === 'string' && /^p\d+$/.test(p) ? p : 'p1'; }

    function names(k, phase) {
        var night = phase === 'night', t = phase === 'dawn' ? 'dawn' : phase === 'dusk' ? 'dusk' : night ? 'night' : 'day', out = [];
        function add() { for (var i = 0; i < arguments.length; i++) if (out.indexOf(arguments[i]) < 0) out.push(arguments[i]); }
        if (k === 'fog') add('fog', night ? 'cloudy-night' : 'cloudy-day');
        else if (k === 'storm') add('storm', night ? 'rain-night' : 'rain-day', 'rain-day');
        else if (k === 'snow') add(night ? 'snow-night' : 'snow-day', 'snow-day');
        else if (k === 'rain' || k === 'showers' || k === 'drizzle') add(night ? 'rain-night' : 'rain-day', 'rain-day', night ? 'cloudy-night' : 'cloudy-day');
        else if (k === 'cloudy') add(night ? 'cloudy-night' : 'cloudy-day', 'cloudy-day');
        else if (k === 'partly') { if (t === 'day') add('partly-day'); add('clear-' + t, night ? 'cloudy-night' : 'partly-day'); }
        add('clear-' + t);
        if (night) add('cloudy-night');
        add('clear-day');
        return out;
    }

    /* ---------- the profile's own set, in IndexedDB ---------- */
    var dbp = null;
    function db(cb) {
        if (dbp) return dbp.then(cb, function () { cb(null); });
        dbp = new Promise(function (ok, no) {
            try {
                var r = indexedDB.open(DB, 1);
                r.onupgradeneeded = function () { r.result.createObjectStore(ST); };
                r.onsuccess = function () { ok(r.result); };
                r.onerror = function () { no(r.error); };
            } catch (e) { no(e); }
        });
        dbp.then(cb, function () { dbp = null; cb(null); });
    }
    function idb(mode, fn, cb) {
        db(function (d) {
            if (!d) return cb && cb(null);
            try {
                var tx = d.transaction(ST, mode), st = tx.objectStore(ST), out = fn(st);
                tx.oncomplete = function () { if (cb) cb(out && 'result' in out ? out.result : true); };
                tx.onerror = tx.onabort = function () { if (cb) cb(null); };
            } catch (e) { if (cb) cb(null); }
        });
    }
    function custom() { var c = Store.get('dynwall_custom', null); return c && c.names && typeof c.names === 'object' ? c.names : {}; }

    /* ---------- loading a picture ---------- */
    var memo = { id: '', img: null, url: '' };
    function img(src, cb) {
        var im = new Image(), done = false;
        im.onload = function () { if (!done) { done = true; cb(im); } };
        im.onerror = function () { if (!done) { done = true; cb(null); } };
        im.src = src;
    }
    function get(style, k, phase, cb) {
        var list = names(k, phase), mine = style === 'custom' ? custom() : {}, i;
        for (i = 0; i < list.length; i++) if (mine[list[i]]) break;
        var own = i < list.length ? list[i] : '', id = own ? 'c:' + own + ':' + mine[own] : 'r:' + list[0];
        if (memo.id === id && memo.img) { var m = memo.img; return setTimeout(function () { cb(m, id); }, 0); }
        function keep(im, url) {
            if (memo.url) { try { URL.revokeObjectURL(memo.url); } catch (e) {} }
            memo = { id: im ? id : '', img: im, url: url || '' };
            cb(im, id);
        }
        function builtin(j) {
            if (j >= list.length) return keep(null);
            img(base() + 'wallpapers/real/' + list[j] + '.jpg', function (im) { if (im) { id = 'r:' + list[j]; keep(im); } else builtin(j + 1); });
        }
        if (!own) return builtin(0);
        idb('readonly', function (st) { return st.get(who() + '/' + own); }, function (blob) {
            if (!blob) return builtin(0);
            var url = URL.createObjectURL(blob);
            img(url, function (im) { if (im) keep(im, url); else { URL.revokeObjectURL(url); builtin(0); } });
        });
    }

    /* ---------- taking a set in: every picture made the size of the screen (cover) and kept as a JPEG ---------- */
    function nameOf(file) {
        var n = String(file || '').toLowerCase().replace(/\.(jpe?g|png|webp)$/, '').replace(/[\s_]+/g, '-');
        return NAMES.indexOf(n) >= 0 ? n : '';
    }
    function shrink(blob, cb) {
        var url = URL.createObjectURL(blob);
        img(url, function (im) {
            URL.revokeObjectURL(url);
            if (!im) return cb(null);
            var W = 1920, H = 1080, cv = document.createElement('canvas'), c = cv.getContext('2d');
            var iw = im.naturalWidth, ih = im.naturalHeight, sc = Math.max(W / iw, H / ih);
            cv.width = W; cv.height = H;
            c.drawImage(im, (W - iw * sc) / 2, (H - ih * sc) / 2, iw * sc, ih * sc);
            if (cv.toBlob) cv.toBlob(function (b) { cv.width = cv.height = 0; cb(b); }, 'image/jpeg', 0.85);
            else cb(null);
        });
    }
    function store(found, onStep, cb) {
        var keys = Object.keys(found), got = {}, n = 0;
        (function next(i) {
            if (i >= keys.length) {
                if (!n) return cb({ code: 'none' }, 0);
                var c = { names: got, at: Date.now() };
                Store.set('dynwall_custom', c);
                return cb(null, n);
            }
            var name = keys[i];
            if (onStep) { try { onStep(i, keys.length, name); } catch (e) {} }
            found[name](function (blob) {
                if (!blob) return next(i + 1);
                shrink(blob, function (small) {
                    if (!small) return next(i + 1);
                    idb('readwrite', function (st) { st.put(small, who() + '/' + name); }, function (ok) { if (ok) { got[name] = Date.now(); n++; } next(i + 1); });
                });
            });
        })(0);
    }
    // Google Drive (My PC's own sign-in): every image the account lets My PC see whose name is one of the 13
    function loadDrive(onStep, cb) {
        if (typeof GDrive === 'undefined') return cb({ code: 'nodrive' });
        GDrive.status(function (st) {
            if (!st.ok) return cb({ code: st.code || 'nouser' });
            var q = '(' + NAMES.map(function (n) { return "name contains '" + n + "'"; }).join(' or ') + ") and mimeType contains 'image/'";
            GDrive.list({ q: q, pageSize: 200, orderBy: 'modifiedTime desc', fields: 'id,name,mimeType,size,modifiedTime' }, function (e, r) {
                if (e) return cb({ code: e.code || 'error', message: e.message });
                var found = {};
                (r.files || []).forEach(function (f) {
                    var n = nameOf(f.name);
                    if (!n || found[n] || +f.size > MAX_BYTES) return;          // newest first: the first one of a name wins
                    found[n] = function (done) {
                        GDrive.download(f.id, { max: MAX_BYTES }, function (e2, d) { done(e2 || !d ? null : new Blob([d.buf], { type: d.type || f.mimeType || 'image/jpeg' })); });
                    };
                });
                if (!Object.keys(found).length) return cb({ code: 'none', limited: !GDrive.fullAccess() }, 0);
                store(found, onStep, cb);
            });
        });
    }
    // a folder of this computer (PC browsers only, like MyMusic's)
    function folderOk() { return typeof window.showDirectoryPicker === 'function' && typeof tizen === 'undefined'; }
    function loadFolder(onStep, cb) {
        if (!folderOk()) return cb({ code: 'nofolder' });
        window.showDirectoryPicker({ mode: 'read' }).then(function (dir) {
            var found = {}, it = dir.values();
            (function walk() {
                it.next().then(function (r) {
                    if (r.done) return Object.keys(found).length ? store(found, onStep, cb) : cb({ code: 'none' }, 0);
                    var h = r.value, n = h.kind === 'file' ? nameOf(h.name) : '';
                    if (n && !found[n]) found[n] = function (done) { h.getFile().then(function (f) { done(f.size > MAX_BYTES ? null : f); }, function () { done(null); }); };
                    walk();
                }, function () { cb({ code: 'error' }); });
            })();
        }, function () { cb({ code: 'cancelled' }); });
    }
    function clear(cb) {
        var mine = Object.keys(custom());
        Store.remove('dynwall_custom');
        memo = { id: '', img: null, url: '' };
        idb('readwrite', function (st) { mine.forEach(function (n) { st.delete(who() + '/' + n); }); }, function () { if (cb) cb(); });
    }

    return { NAMES: NAMES, names: names, get: get, custom: custom, loadDrive: loadDrive, loadFolder: loadFolder, folderOk: folderOk, clear: clear, _nameOf: nameOf };
})();
