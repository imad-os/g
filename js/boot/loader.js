/* Arcade boot loader
 *
 * The packaged .wgt always contains a complete, working copy of the launcher and of every game.
 * At launch this loader checks the hosted copy (GitHub Pages) and runs it only when:
 *   - its app-manifest.json answers within MANIFEST_TIMEOUT_MS,
 *   - it was built for this native shell (same `shell` number: same config.xml, privileges,
 *     shell index.html and loader as the certified package),
 *   - its `build` is newer than the packaged one and not blacklisted on this TV.
 * Otherwise (no network, server down, bad deploy) the bundled copy runs: never a black screen.
 *
 * Slow network: when the hosted manifest does not answer in time, the last hosted build that ran
 * fine on this TV (saved as boot_good once it reached AppBoot.ready(), or by Settings > Update)
 * runs instead of the older bundled copy. Its files come from the hosted site as usual; if they
 * cannot be loaded the bundled copy runs for this session and this shortcut rests for 10 minutes.
 *
 * Hosted files are loaded into this packaged document (markup from app.html, CSS/JS from the
 * manifest, <base href> = hosted URL) so the Tizen/Samsung APIs keep working.
 *
 * A hosted build that fails to load a file, throws during start-up or does not call
 * AppBoot.ready() within READY_TIMEOUT_MS is set aside and the bundled copy restarts. It is tried
 * again after BAD_RETRY_MS (one failure can be a network hiccup or a slow TV start); only after
 * BAD_MAX failures in a row is it skipped until a newer build is published. (Before package 1.6.1 a
 * single failure skipped the build for good, so a TV could stay on its built-in copy for days.)
 *
 * The hosted copy is asked at its own address (pc.geekspro.us): the old imad-os.github.io/g address
 * only answers with a redirect, an extra round trip that ate most of the 4 s a TV waits at start.
 *
 * Saved copy (package 3.1.0, owner request 2026-11-28: "a weak network starts the old built-in copy; and why does it download
 * the online version at every start?"): once a hosted build has run, js/core/boot-cache.js (hosted code) saves its code
 * (app.html + every CSS / JS file of the manifest, ~2.5 MB) ONCE per build in IndexedDB on the TV (`mypc-boot`) and, when a
 * USB drive is plugged in, in <drive>/MyPC/boot/ (survives a reinstall or cleared app data). Here:
 *   - the hosted manifest says the same build as the saved copy: the code runs from the saved copy (no file downloads;
 *     pictures, sounds and games still come from the hosted site and the TV's cache). Reason 'cached'.
 *   - the hosted manifest does not answer, the hosted build is set aside, or the hosted files fail to load: the saved copy
 *     runs with the packaged pictures / games (`saved`), instead of the older built-in copy.
 *   - a newer hosted build: it runs online as before, and is saved after it started.
 * A saved copy that fails to start is set aside (boot_cache_bad = its build) and the normal choice runs again.
 * The start screen (index.html #bs-info) says what is going on: checking, downloading (files, bar), saved copy, offline.
 *
 * ES5 only: this file runs on every supported engine before anything else.
 */
(function () {
    'use strict';

    var SHELL = 1;                                    // bump only together with a new .wgt
    var DEFAULT_REMOTE_BASE = 'https://pc.geekspro.us/';
    var OLD_REMOTE_BASES = ['https://imad-os.github.io/g/'];   // same site (redirects): a build saved under it still counts
    var MANIFEST_TIMEOUT_MS = 5000;
    var BAD_RETRY_MS = 30 * 60 * 1000;                // a failed build is tried again after this
    var BAD_MAX = 3;                                  // ... until it failed this many times in a row
    var FILE_TIMEOUT_MS = 10000;
    var STALE_FILE_TIMEOUT_MS = 6000;                 // when running the last known hosted build without a fresh manifest
    var STALE_RETRY_MS = 10 * 60 * 1000;
    var READY_TIMEOUT_MS = 20000;

    var LS_BAD_BUILD = 'boot_bad_build';              // { b: build, n: failures, at: time } (packages before 1.6.1: the build number alone)
    var LS_GOOD = 'boot_good';                        // { manifest, base, at }: last hosted build that ran fine
    var LS_STALE_FAIL = 'boot_stale_fail';            // time the last-known build could not be loaded
    var LS_REMOTE_BASE = 'boot_remote_base';
    var LS_LAST_FAIL = 'boot_last_fail';              // { b, why, at }: why the last hosted build was given up (Control Panel > Update)          // optional override (staging, tests)
    var SS_FORCE_LOCAL = 'boot_force_local';
    // package 1.6.2: the copy this start picked and that reached ready ({ m: manifest, base, stale, reason }). Opening a game
    // (?play=) or quitting it (?from=) is a page change inside the same start: it boots that copy again at once instead of
    // asking the server (up to 5 s) at every switch. A real start (no ?play / ?from) or Settings > Update's Restart asks again.
    var SS_PICK = 'boot_pick';
    // the saved copy (see the top): format shared with js/core/boot-cache.js, CACHE_V changes only together
    var CACHE_V = 1, IDB_NAME = 'mypc-boot', IDB_STORE = 'b', IDB_KEY = 'cur';
    var LS_CACHE_BAD = 'boot_cache_bad';              // build of a saved copy that failed to start here
    var LS_CACHE_USB = 'boot_cache_usb';              // { p: path of the bundle on the USB drive, b: build } (boot-cache.js)
    var SS_FORCE_CACHE = 'boot_force_cache';          // the hosted files failed: the next page load runs the saved copy
    var USB_DIR = '/MyPC/boot/';
    var IDB_READ_MS = 2500, USB_READ_MS = 4000;

    var state = {
        source: 'local', base: '', build: 0, version: '', ready: false, aborting: false,
        manifest: null, localManifest: null, localBase: '',
        stale: false,         // running the last known hosted build (no fresh manifest)
        cached: '',           // the code runs from the saved copy: 'idb' (this TV) | 'usb' (USB drive)
        cacheBuild: 0,        // build of the usable saved copy found at start (0 = none)
        reason: ''            // why this copy runs: update | stale | current | unreachable | bad | shell | forced | cached | saved
    };
    var readyTimer = null;

    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
    function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
    function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
    function ssDel(k) { try { sessionStorage.removeItem(k); } catch (e) {} }

    function log(msg) { try { console.log('[Boot] ' + msg); } catch (e) {} }

    /* ---------------- the start screen's info (index.html #bs-info; package 3.1.0) ---------------- */
    // the language My PC used last (main.js saves boot_lang at ready), else the TV's
    var TXT = {
        en: { check: 'Checking for updates…', update: 'Downloading update', start: 'Starting My PC', cached: 'Starting · saved copy, nothing to download',
              saved: 'Weak or no network · starting the saved copy', offline: 'No network · starting the built-in copy', builtin: 'Built-in copy',
              tv: 'Saved on this TV', usb: 'Saved on the USB drive', online: 'Online', ver: 'Version', build: 'Build', files: 'files' },
        fr: { check: 'Recherche de mises à jour…', update: 'Téléchargement de la mise à jour', start: 'Démarrage de My PC', cached: 'Démarrage · copie enregistrée, rien à télécharger',
              saved: 'Réseau faible ou absent · démarrage de la copie enregistrée', offline: 'Pas de réseau · démarrage de la copie intégrée', builtin: 'Copie intégrée',
              tv: 'Enregistrée sur ce téléviseur', usb: 'Enregistrée sur la clé USB', online: 'En ligne', ver: 'Version', build: 'Build', files: 'fichiers' },
        es: { check: 'Buscando actualizaciones…', update: 'Descargando la actualización', start: 'Iniciando My PC', cached: 'Iniciando · copia guardada, nada que descargar',
              saved: 'Red débil o sin red · iniciando la copia guardada', offline: 'Sin red · iniciando la copia integrada', builtin: 'Copia integrada',
              tv: 'Guardada en este televisor', usb: 'Guardada en la memoria USB', online: 'En línea', ver: 'Versión', build: 'Compilación', files: 'archivos' },
        ar: { check: 'جارٍ البحث عن تحديثات…', update: 'جارٍ تنزيل التحديث', start: 'جارٍ تشغيل My PC', cached: 'جارٍ التشغيل · نسخة محفوظة، لا شيء للتنزيل',
              saved: 'شبكة ضعيفة أو غير متوفرة · تشغيل النسخة المحفوظة', offline: 'لا توجد شبكة · تشغيل النسخة المدمجة', builtin: 'النسخة المدمجة',
              tv: 'محفوظة على هذا التلفاز', usb: 'محفوظة على ذاكرة USB', online: 'عبر الإنترنت', ver: 'الإصدار', build: 'البناء', files: 'ملفات' }
    };
    var lang = (function () { var l = String(lsGet('boot_lang') || (navigator.language || 'en')).slice(0, 2).toLowerCase(); return TXT[l] ? l : 'en'; })();
    function T(k) { return TXT[lang][k] || TXT.en[k]; }
    function infoEl(id) { return document.getElementById(id); }
    var infoTimer = null;
    // status line, meta line (version · build · where from), bar 0..1 (null = hide). Shown after 400 ms so a fast start stays a clean logo.
    function info(status, meta, bar) {
        var box = infoEl('bs-info');
        if (!box) return;
        try {
            if (lang === 'ar') box.setAttribute('dir', 'rtl');
            if (status !== undefined) infoEl('bs-status').textContent = status;
            if (meta !== undefined) infoEl('bs-meta').textContent = meta;
            var b = infoEl('bs-bar');
            if (bar === null) b.className = 'bs-bar';
            else if (bar !== undefined) { b.className = 'bs-bar on'; b.firstChild.style.width = Math.round(Math.max(0, Math.min(1, bar)) * 100) + '%'; }
            if (!infoTimer) infoTimer = setTimeout(function () { box.className = 'bs-info on'; }, 400);
        } catch (e) {}
    }
    function metaOf(m, where) {
        var p = [];
        if (m && m.version) p.push(T('ver') + ' ' + m.version);
        if (m && m.build) p.push(T('build') + ' ' + m.build);
        if (where) p.push(where);
        return p.join('  ·  ');
    }
    function mb(n) { return n >= 1048576 ? (Math.round(n / 104857.6) / 10) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }

    function slash(b) { return b.charAt(b.length - 1) === '/' ? b : b + '/'; }
    function remoteBase() { return slash(lsGet(LS_REMOTE_BASE) || DEFAULT_REMOTE_BASE); }

    // Absolute URL of the packaged folder (used by the launcher to fall back to bundled games).
    function packagedBase() {
        var a = document.createElement('a');
        a.href = 'index.html';
        return a.href.replace(/index\.html.*$/, '');
    }

    // XHR works for both packaged files and https on every Tizen version.
    function get(url, timeoutMs, cb) {
        var done = false;
        var xhr = new XMLHttpRequest();
        function finish(err, text) { if (done) return; done = true; cb(err, text); }
        try {
            xhr.open('GET', url, true);
            if (timeoutMs) xhr.timeout = timeoutMs;
            xhr.onload = function () {
                // Packaged files report status 0 on some firmwares.
                var ok = (xhr.status >= 200 && xhr.status < 300) || (xhr.status === 0 && xhr.responseText);
                finish(ok ? null : 'HTTP ' + xhr.status, xhr.responseText);
            };
            xhr.onerror = function () { finish('network error'); };
            xhr.ontimeout = function () { finish('timeout'); };
            xhr.send();
        } catch (e) { finish(String(e)); }
        // Some old engines ignore xhr.timeout: enforce it ourselves.
        if (timeoutMs) setTimeout(function () { if (!done) { try { xhr.abort(); } catch (e) {} finish('timeout'); } }, timeoutMs + 100);
    }

    function parse(text) { try { return JSON.parse(text); } catch (e) { return null; } }

    // the saved last-known-good hosted manifest, only when it belongs to this hosted address (or its old name)
    function readGood(base) {
        var o = parse(lsGet(LS_GOOD));
        if (!o || !isValid(o.manifest)) return null;
        if (o.base === base) return o.manifest;
        if (base === DEFAULT_REMOTE_BASE) for (var i = 0; i < OLD_REMOTE_BASES.length; i++) if (o.base === OLD_REMOTE_BASES[i]) return o.manifest;
        return null;
    }

    // the hosted build that failed here: { b, n, at }. An old package's mark (the number alone) is tried again at once.
    function readBad() {
        var v = lsGet(LS_BAD_BUILD), o = parse(v);
        if (typeof o === 'number') return { b: o, n: 1, at: 0 };
        return o && typeof o.b === 'number' ? o : null;
    }
    function isBad(build) {
        var o = readBad();
        return !!(o && o.b === build && (o.n >= BAD_MAX || Date.now() - (o.at || 0) < BAD_RETRY_MS));
    }
    function markBad(build) {
        var o = readBad();
        var n = o && o.b === build ? (o.n | 0) + 1 : 1;
        lsSet(LS_BAD_BUILD, JSON.stringify({ b: build, n: n, at: Date.now() }));
    }

    function isValid(m) {
        return !!(m && typeof m.build === 'number' && m.css && m.css.length !== undefined &&
                  m.js && m.js.length && m.games && m.games.length !== undefined);
    }

    // Hosted build failed: remember it and restart with the bundled copy.
    function fallbackToLocal(reason) {
        if (state.aborting) return;
        if (state.cached) {
            // the saved copy itself failed: set it aside; the next load chooses again without it
            state.aborting = true;
            log('saved copy of build ' + state.build + ' rejected (' + reason + ')');
            lsSet(LS_CACHE_BAD, String(state.build));
            lsSet(LS_LAST_FAIL, JSON.stringify({ b: state.build, why: ('saved copy: ' + reason).slice(0, 200), at: Date.now() }));
            if (state.source !== 'remote') ssSet(SS_FORCE_LOCAL, '1');      // no server either: straight to the built-in copy
            ssDel(SS_PICK);
            location.reload();
            return;
        }
        if (state.source !== 'remote') return;
        state.aborting = true;
        log('hosted build ' + state.build + ' rejected (' + reason + '), restarting with bundled copy');
        // a build that failed with a fresh manifest is bad; a last-known build that failed (maybe only
        // the network) is not blamed, it just rests for a while
        if (state.stale) lsSet(LS_STALE_FAIL, String(Date.now()));
        else markBad(state.build);
        lsSet(LS_LAST_FAIL, JSON.stringify({ b: state.build, why: String(reason).slice(0, 200), at: Date.now() }));
        // a saved copy of another build beats the older built-in copy (a weak network: the hosted files did not all come)
        ssSet(state.cacheBuild && state.cacheBuild !== state.build ? SS_FORCE_CACHE : SS_FORCE_LOCAL, '1');
        ssDel(SS_PICK);
        location.reload();
    }

    function hideSplash() {
        var s = document.getElementById('boot-splash');
        if (!s || !s.parentNode) return;
        if (/(^| )warm( |$)/.test(document.documentElement.className)) { s.parentNode.removeChild(s); return; }
        s.className = 'bye';                                           // fade out, then free it
        setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 400);
    }

    function url(path) {
        return state.base ? state.base + path + '?b=' + state.build : path;
    }

    function loadCss(list) {
        for (var i = 0; i < list.length; i++) {
            var link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = url(list[i]);
            document.head.appendChild(link);
        }
    }

    // async=false keeps execution order identical to static <script> tags.
    function loadJs(list, onDone) {
        var remaining = list.length;
        var failed = false;
        var showing = state.base && state.base !== state.localBase && (state.stale || state.reason === 'update');
        for (var i = 0; i < list.length; i++) {
            (function (src) {
                var s = document.createElement('script');
                s.src = url(src);
                s.async = false;
                s.onload = function () {
                    --remaining;
                    if (showing) info(T('update') + '  ·  ' + (list.length - remaining) + ' / ' + list.length + ' ' + T('files'), undefined, (list.length - remaining) / list.length);
                    if (remaining === 0 && !failed) onDone();
                };
                s.onerror = function () {
                    failed = true;
                    log('failed to load ' + src);
                    if (state.source === 'remote') fallbackToLocal('script ' + src);
                };
                document.body.appendChild(s);
            })(list[i]);
        }
    }

    function onStartupError() {
        if (!state.ready) fallbackToLocal('error during start-up');
    }

    function boot(manifest, base, stale) {
        state.stale = !!stale;
        state.source = base ? 'remote' : 'local';
        state.base = base;
        state.build = manifest.build;
        state.version = manifest.version || '';
        state.manifest = manifest;
        log('starting ' + state.source + ' build ' + state.build + ' (' + state.version + ')');
        if (!base || base === state.localBase) info(T(state.reason === 'unreachable' ? 'offline' : 'start'), metaOf(manifest, T('builtin')), null);
        else if (stale || state.reason === 'update') info(T('update'), metaOf(manifest, T('online')), 0);
        else info(T('start'), metaOf(manifest, T('online')), null);

        get(url('app.html'), base ? (stale ? STALE_FILE_TIMEOUT_MS : FILE_TIMEOUT_MS) : 0, function (err, html) {
            if (err || !html) {
                if (base) return fallbackToLocal('app.html ' + err);
                log('bundled app.html missing: ' + err);
                return;
            }
            if (base) {
                // Relative image/asset URLs in the hosted markup resolve to the hosted copy.
                var baseEl = document.createElement('base');
                baseEl.href = base;
                document.head.insertBefore(baseEl, document.head.firstChild);
                window.addEventListener('error', onStartupError);
            }

            loadCss(manifest.css);
            var splash = document.getElementById('boot-splash');
            if (splash) splash.insertAdjacentHTML('beforebegin', html);
            else document.body.insertAdjacentHTML('afterbegin', html);

            loadJs(manifest.js, function () {
                readyTimer = setTimeout(function () {
                    if (state.ready) return;
                    if (state.source === 'remote') fallbackToLocal('not ready after ' + READY_TIMEOUT_MS + 'ms');
                    else hideSplash();
                }, READY_TIMEOUT_MS);
            });
        });
    }

    /* ---------------- the saved copy ---------------- */

    function readIdb(cb) {
        var done = false, db = null;
        function fin(v) { if (done) return; done = true; try { if (db) db.close(); } catch (e) {} cb(v || null); }
        try {
            if (!window.indexedDB) return fin(null);
            var rq = indexedDB.open(IDB_NAME, 1);
            rq.onupgradeneeded = function () { try { rq.result.createObjectStore(IDB_STORE); } catch (e) {} };
            rq.onerror = function () { fin(null); };
            rq.onblocked = function () { fin(null); };
            rq.onsuccess = function () {
                db = rq.result;
                try {
                    var g = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(IDB_KEY);
                    g.onsuccess = function () { fin(g.result); };
                    g.onerror = function () { fin(null); };
                } catch (e) { fin(null); }
            };
        } catch (e) { fin(null); }
        setTimeout(function () { fin(null); }, IDB_READ_MS);
    }

    // a whole text file of the USB drive (Tizen filesystem API, privileges filesystem.read + externalstorage, package 1.6.0+)
    function readUsbText(path, cb) {
        var fs = typeof tizen !== 'undefined' && tizen.filesystem, fh = null, done = false;
        function fin(t) { if (done) return; done = true; try { if (fh) fh.close(); } catch (e) {} fh = null; cb(t || null); }
        if (!fs || !fs.openFile || typeof TextDecoder === 'undefined') return fin(null);
        try {
            fh = fs.openFile(path, 'r');
            var size = fh.seek(0, 'END');
            fh.seek(0, 'BEGIN');
            if (!(size > 0) || size > 64 * 1024 * 1024) return fin(null);
            var dec = function (d) { try { return new TextDecoder('utf-8').decode(d instanceof Uint8Array ? d : new Uint8Array(d)); } catch (e) { return null; } };
            if (fh.readDataNonBlocking) fh.readDataNonBlocking(function (d) { fin(dec(d)); }, function () { fin(null); }, size);
            else fin(dec(fh.readData(size)));
        } catch (e) { fin(null); }
    }
    // the remembered bundle, else <drive>/MyPC/boot/current.json on the drives under /opt/media
    function readUsb(cb) {
        var done = false;
        function fin(v) { if (done) return; done = true; cb(v || null); }
        setTimeout(function () { fin(null); }, USB_READ_MS);
        var fs = typeof tizen !== 'undefined' && tizen.filesystem;
        if (!fs) return fin(null);
        function scan() {
            if (!fs.listDirectory) return fin(null);
            try {
                fs.listDirectory('/opt/media', function (names) {
                    var drives = [];
                    for (var i = 0; i < (names || []).length; i++) if (/^USBDrive/i.test(names[i])) drives.push('/opt/media/' + names[i]);
                    (function next() {
                        if (!drives.length) return fin(null);
                        var dir = drives.shift() + USB_DIR;
                        readUsbText(dir + 'current.json', function (t) {
                            var c = parse(t);
                            if (!c || typeof c.f !== 'string' || !/^mypc-\d+\.json$/.test(c.f)) return next();
                            readUsbText(dir + c.f, function (t2) { var b = parse(t2); if (b) fin(b); else next(); });
                        });
                    })();
                }, function () { fin(null); });
            } catch (e) { fin(null); }
        }
        var known = parse(lsGet(LS_CACHE_USB));
        if (known && typeof known.p === 'string' && /^\/opt\/media\/[^.]/.test(known.p)) {
            return readUsbText(known.p, function (t) { var b = parse(t); if (b) fin(b); else scan(); });
        }
        scan();
    }

    // a saved copy this package can run: complete, for this shell, newer than the built-in copy, not set aside
    function usable(b, local) {
        if (!b || b.v !== CACHE_V || !isValid(b.manifest) || b.manifest.shell !== SHELL || typeof b.html !== 'string' || !b.files) return false;
        if (!(b.manifest.build > local.build) || lsGet(LS_CACHE_BAD) === String(b.manifest.build)) return false;
        var list = b.manifest.css.concat(b.manifest.js);
        for (var i = 0; i < list.length; i++) if (typeof b.files[list[i]] !== 'string') return false;
        return true;
    }
    // cb({ b, from } | null): this TV first (fast), the USB drive only when this TV has none
    function readCache(local, cb) {
        if (location.protocol === 'https:' && !lsGet(LS_REMOTE_BASE)) return cb(null);     // the web: always the current site
        readIdb(function (b) {
            if (usable(b, local)) return cb({ b: b, from: 'idb' });
            readUsb(function (u) { cb(usable(u, local) ? { b: u, from: 'usb' } : null); });
        });
    }

    // url(...) in a saved style sheet: relative to its own file (it now sits in a <style> of index.html)
    function fixCss(text, path) {
        var dir = path.slice(0, path.lastIndexOf('/') + 1);
        return text.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, function (m, q, u) {
            if (/^(data:|[a-z][a-z0-9+.-]*:|\/|#)/i.test(u)) return m;
            var parts = (dir + u).split('/'), out = [];
            for (var i = 0; i < parts.length; i++) {
                if (parts[i] === '..') out.pop();
                else if (parts[i] !== '.') out.push(parts[i]);
            }
            return 'url(' + q + out.join('/') + q + ')';
        });
    }

    // run the saved code. base = the hosted address (same build online: its pictures / games) or '' (offline: the packaged ones)
    function bootCache(b, from, base, reason) {
        var m = b.manifest;
        state.cached = from;
        state.stale = false;
        state.source = base ? 'remote' : 'local';
        state.base = base;
        state.build = m.build;
        state.version = m.version || '';
        state.manifest = m;
        state.reason = reason;
        log('starting build ' + m.build + ' from the saved copy (' + from + ', ' + reason + ')');
        var size = b.html.length;
        for (var k in b.files) if (b.files.hasOwnProperty(k)) size += b.files[k].length;
        info(T(reason === 'cached' ? 'cached' : 'saved'), metaOf(m, T(from === 'usb' ? 'usb' : 'tv') + '  ·  ' + mb(size)), null);
        var boxOn = infoEl('bs-info');
        if (boxOn && reason !== 'cached') boxOn.className = 'bs-info on';      // a weak network: say it at once
        if (base) {
            var baseEl = document.createElement('base');
            baseEl.href = base;
            document.head.insertBefore(baseEl, document.head.firstChild);
        }
        window.addEventListener('error', onStartupError);
        for (var i = 0; i < m.css.length; i++) {
            var st = document.createElement('style');
            st.setAttribute('data-src', m.css[i]);
            st.textContent = fixCss(b.files[m.css[i]], m.css[i]);
            document.head.appendChild(st);
        }
        var splash = document.getElementById('boot-splash');
        if (splash) splash.insertAdjacentHTML('beforebegin', b.html);
        else document.body.insertAdjacentHTML('afterbegin', b.html);
        var at = base || state.localBase;
        for (var j = 0; j < m.js.length && !state.aborting; j++) {
            var s = document.createElement('script');
            s.text = b.files[m.js[j]] + '\n//# sourceURL=' + at + m.js[j];
            document.body.appendChild(s);                    // runs now, in order
        }
        b = null;
        readyTimer = setTimeout(function () {
            if (!state.ready) fallbackToLocal('not ready after ' + READY_TIMEOUT_MS + 'ms');
        }, READY_TIMEOUT_MS);
    }

    function start() {
        state.localBase = packagedBase();
        // My PC opened from its web site (a browser, the Android app): this site IS the hosted copy. Read its manifest fresh
        // and load its files with the build in the address, so the browser's cache (10 min on GitHub Pages) never mixes an
        // old file into a new build. (The github.io address redirects to the custom domain without a CORS header, so asking
        // it from here always failed and an older saved build could start.) TVs (file:) are not concerned.
        var web = location.protocol === 'https:' && !lsGet(LS_REMOTE_BASE);
        get(web ? 'app-manifest.json?t=' + Date.now() : 'app-manifest.json', 0, function (err, text) {
            var local = parse(text);
            if (!isValid(local)) { log('bundled manifest unreadable: ' + err); return; }
            state.localManifest = local;

            if (ssGet(SS_FORCE_LOCAL)) {
                ssDel(SS_FORCE_LOCAL);
                state.reason = 'forced';
                return boot(local, '');
            }

            if (web) { state.reason = 'current'; return boot(local, state.localBase); }

            // the hosted files failed a moment ago (weak network): the saved copy, else the built-in one
            if (ssGet(SS_FORCE_CACHE)) {
                ssDel(SS_FORCE_CACHE);
                return readCache(local, function (c) {
                    if (c) return bootCache(c.b, c.from, '', 'saved');
                    state.reason = 'forced';
                    boot(local, '');
                });
            }

            var base = remoteBase();

            // a page change inside this start (a game opens or quits): the same copy as the desktop, no server round trip
            var pick = /[?&](play|from)=/.test(location.search) ? parse(ssGet(SS_PICK)) : null;
            if (pick && isValid(pick.m) && pick.m.shell === SHELL && pick.c) {
                return readCache(local, function (c) {
                    if (c && c.b.manifest.build === pick.m.build) { log('page change: same saved copy as at start'); return bootCache(c.b, c.from, pick.base || '', pick.reason || 'cached'); }
                    decide(local, base);
                });
            }
            if (pick && isValid(pick.m) && pick.m.shell === SHELL && (pick.base ? !isBad(pick.m.build) : pick.m.build === local.build)) {
                state.reason = pick.reason || 'current';
                log('page change: same copy as at start (build ' + pick.m.build + ')');
                return boot(pick.m, pick.base || '', !!pick.stale);
            }

            if (base === state.localBase) { state.reason = 'current'; return boot(local, ''); }   // PC browser on the hosted site itself
            decide(local, base);
        });
    }

    // ask the hosted manifest and read the saved copy at the same time, then pick
    function decide(local, base) {
        var cache, remoteDone = false, cacheDone = false, rErr, rText;
        info(T('check'), metaOf(local, ''), null);
        readCache(local, function (c) { cache = c; cacheDone = true; if (c) state.cacheBuild = c.b.manifest.build; if (remoteDone) pick(); });
        get(base + 'app-manifest.json?t=' + Date.now(), MANIFEST_TIMEOUT_MS, function (e, t) { rErr = e; rText = t; remoteDone = true; if (cacheDone) pick(); });

        function pick() {
            var remote = parse(rText), why;
            var saved = cache ? cache.b : null, savedBuild = saved ? saved.manifest.build : 0;
            if (rErr || !isValid(remote)) {
                log('hosted manifest unavailable (' + (rErr || 'invalid') + ')');
                // slow or no network: the saved copy (nothing to download), else the last hosted build that worked here
                if (saved) return bootCache(saved, cache.from, '', 'saved');
                var good = readGood(base), failedAt = parseInt(lsGet(LS_STALE_FAIL), 10) || 0;
                if (good && good.build > local.build && good.shell === SHELL && !isBad(good.build) && Date.now() - failedAt > STALE_RETRY_MS) {
                    log('using the last hosted build ' + good.build + ' (server slow or unreachable)');
                    state.reason = 'stale';
                    return boot(good, base, true);
                }
                why = 'unreachable';
            } else if (remote.shell !== SHELL) {
                log('hosted build ' + remote.build + ' needs shell ' + remote.shell + ', package has ' + SHELL);
                why = 'shell';
            } else if (remote.build <= local.build) {
                log('bundled build ' + local.build + ' is up to date');
                why = 'current';
            } else if (savedBuild === remote.build) {
                // the build online is the one saved here: its code from the saved copy, nothing downloaded again
                return bootCache(saved, cache.from, base, 'cached');
            } else if (isBad(remote.build)) {
                log('hosted build ' + remote.build + ' failed here recently, skipping');
                if (saved) return bootCache(saved, cache.from, '', 'saved');
                why = 'bad';
            } else {
                state.reason = 'update';
                return boot(remote, base);
            }
            state.reason = why;
            boot(local, '');
        }
    }

    window.AppBoot = {
        SHELL: SHELL,
        // Called by the launcher once it is initialised.
        ready: function () {
            if (state.ready || state.aborting) return;
            state.ready = true;
            if (readyTimer) clearTimeout(readyTimer);
            window.removeEventListener('error', onStartupError);
            // a hosted build that reached this point works on this TV: remember it for slow starts
            if (state.source === 'remote' && !state.stale) lsSet(LS_GOOD, JSON.stringify({ manifest: state.manifest, base: state.base, at: Date.now() }));
            // it works now: forget an earlier failure of this build
            if (state.source === 'remote') { var b = readBad(); if (b && b.b === state.build) { try { localStorage.removeItem(LS_BAD_BUILD); } catch (e) {} } }
            if (state.stale) lsSet(LS_STALE_FAIL, '0');
            ssSet(SS_PICK, JSON.stringify({ m: state.manifest, base: state.base, stale: state.stale, reason: state.reason, c: state.cached ? 1 : 0 }));
            hideSplash();
            log('ready (' + state.source + ' build ' + state.build + ')');
        },
        get: get,
        source: function () { return state.source; },
        build: function () { return state.build; },
        version: function () { return state.version; },
        base: function () { return state.base; },              // '' when bundled
        reason: function () { return state.reason; },          // why this copy runs (see state.reason); Settings > Update shows it
        stale: function () { return state.stale; },
        cached: function () { return state.cached; },          // 'idb' | 'usb' when the code runs from the saved copy (3.1.0+)
        // the saved copy's format (js/core/boot-cache.js writes it; its presence says this package can read one)
        cacheInfo: { v: CACHE_V, db: IDB_NAME, store: IDB_STORE, key: IDB_KEY, usbDir: USB_DIR, usbKey: LS_CACHE_USB, badKey: LS_CACHE_BAD },
        remoteBase: remoteBase,                                 // where this package looks for the hosted copy (1.6.1+)
        lastFail: function () { return parse(lsGet(LS_LAST_FAIL)); },   // { b, why, at } of the last hosted build given up
        manifest: function () { return state.manifest; },
        localManifest: function () { return state.localManifest; },
        localBase: function () { return state.localBase; }   // absolute URL of the packaged copy
    };

    start();
})();
