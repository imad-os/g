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
 * Hosted files are loaded into this packaged document (markup from app.html, CSS/JS from the
 * manifest, <base href> = hosted URL) so the Tizen/Samsung APIs keep working.
 *
 * A hosted build that fails to load a file, throws during start-up or does not call
 * AppBoot.ready() within READY_TIMEOUT_MS is blacklisted and the bundled copy restarts.
 *
 * ES5 only: this file runs on every supported engine before anything else.
 */
(function () {
    'use strict';

    var SHELL = 1;                                    // bump only together with a new .wgt
    var DEFAULT_REMOTE_BASE = 'https://imad-os.github.io/g/';
    var MANIFEST_TIMEOUT_MS = 2500;
    var FILE_TIMEOUT_MS = 10000;
    var READY_TIMEOUT_MS = 20000;

    var LS_BAD_BUILD = 'boot_bad_build';
    var LS_REMOTE_BASE = 'boot_remote_base';          // optional override (staging, tests)
    var SS_FORCE_LOCAL = 'boot_force_local';

    var state = {
        source: 'local', base: '', build: 0, version: '', ready: false, aborting: false,
        manifest: null, localManifest: null, localBase: ''
    };
    var readyTimer = null;

    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
    function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
    function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
    function ssDel(k) { try { sessionStorage.removeItem(k); } catch (e) {} }

    function log(msg) { try { console.log('[Boot] ' + msg); } catch (e) {} }

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

    function isValid(m) {
        return !!(m && typeof m.build === 'number' && m.css && m.css.length !== undefined &&
                  m.js && m.js.length && m.games && m.games.length !== undefined);
    }

    // Hosted build failed: remember it and restart with the bundled copy.
    function fallbackToLocal(reason) {
        if (state.source !== 'remote' || state.aborting) return;
        state.aborting = true;
        log('hosted build ' + state.build + ' rejected (' + reason + '), restarting with bundled copy');
        lsSet(LS_BAD_BUILD, String(state.build));
        ssSet(SS_FORCE_LOCAL, '1');
        location.reload();
    }

    function hideSplash() {
        var s = document.getElementById('boot-splash');
        if (s && s.parentNode) s.parentNode.removeChild(s);
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
        for (var i = 0; i < list.length; i++) {
            (function (src) {
                var s = document.createElement('script');
                s.src = url(src);
                s.async = false;
                s.onload = function () { if (--remaining === 0 && !failed) onDone(); };
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

    function boot(manifest, base) {
        state.source = base ? 'remote' : 'local';
        state.base = base;
        state.build = manifest.build;
        state.version = manifest.version || '';
        state.manifest = manifest;
        log('starting ' + state.source + ' build ' + state.build + ' (' + state.version + ')');

        get(url('app.html'), base ? FILE_TIMEOUT_MS : 0, function (err, html) {
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

    function start() {
        state.localBase = packagedBase();
        get('app-manifest.json', 0, function (err, text) {
            var local = parse(text);
            if (!isValid(local)) { log('bundled manifest unreadable: ' + err); return; }
            state.localManifest = local;

            if (ssGet(SS_FORCE_LOCAL)) {
                ssDel(SS_FORCE_LOCAL);
                return boot(local, '');
            }

            var base = remoteBase();
            if (base === state.localBase) return boot(local, '');   // PC browser on the hosted site itself

            get(base + 'app-manifest.json?t=' + Date.now(), MANIFEST_TIMEOUT_MS, function (rErr, rText) {
                var remote = parse(rText);
                var bad = lsGet(LS_BAD_BUILD);
                if (rErr || !isValid(remote)) {
                    log('hosted manifest unavailable (' + (rErr || 'invalid') + ')');
                } else if (remote.shell !== SHELL) {
                    log('hosted build ' + remote.build + ' needs shell ' + remote.shell + ', package has ' + SHELL);
                } else if (remote.build <= local.build) {
                    log('bundled build ' + local.build + ' is up to date');
                } else if (bad === String(remote.build)) {
                    log('hosted build ' + remote.build + ' previously failed, skipping');
                } else {
                    return boot(remote, base);
                }
                boot(local, '');
            });
        });
    }

    window.AppBoot = {
        SHELL: SHELL,
        // Called by the launcher once it is initialised.
        ready: function () {
            if (state.ready || state.aborting) return;
            state.ready = true;
            if (readyTimer) clearTimeout(readyTimer);
            window.removeEventListener('error', onStartupError);
            hideSplash();
            log('ready (' + state.source + ' build ' + state.build + ')');
        },
        get: get,
        source: function () { return state.source; },
        build: function () { return state.build; },
        version: function () { return state.version; },
        base: function () { return state.base; },              // '' when bundled
        manifest: function () { return state.manifest; },
        localManifest: function () { return state.localManifest; },
        localBase: function () { return state.localBase; }   // absolute URL of the packaged copy
    };

    start();
})();
