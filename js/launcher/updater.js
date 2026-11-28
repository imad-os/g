/* My PC update (Settings > Update), like Windows Update: check, download with progress, restart.
 *
 * The startup check in the packaged loader only waits a few seconds for the update server. Here the
 * TV waits as long as it needs (20 s per request) and then saves the result as "boot_good", the
 * last known hosted build. A package with the smart loader (js/boot/loader.js) runs that saved build
 * when the server is slow at the next start, instead of falling back to the older built-in copy.
 *
 *   Updater.check()        look for a newer hosted build
 *   Updater.install()      download every file of it (progress), then state 'ready'
 *   Updater.restart()      reload the app (the loader starts the new build)
 *   Updater.state()        { state, remote, done, total, error }
 *   Updater.watch()        while My PC stays open: checks every 3 h, downloads quietly, restarts when nobody uses it
 *     state: idle | checking | uptodate | available | downloading | ready | error
 *     error: network | invalid | shell | download
 * Works with any loader: it only needs AppBoot.get / build / version / source / SHELL. */
var Updater = (function () {
    'use strict';

    // packages before 1.6.1 look at the old address (it redirects to pc.geekspro.us): saved builds must name the same one
    var REMOTE_OLD = 'https://imad-os.github.io/g/';
    var CHECK_TIMEOUT = 20000, FILE_TIMEOUT = 20000, PARALLEL = 3;
    var st = { state: 'idle', remote: null, done: 0, total: 0, error: '' };
    var listeners = [], token = 0, autoDone = false;

    function remoteBase() {
        var b = null;
        try { b = localStorage.getItem('boot_remote_base'); } catch (e) {}     // same override as the loader (staging, tests)
        // My PC opened from the web (a browser, the Android app): its own site. imad-os.github.io/g answers with a redirect
        // to the custom domain that carries no CORS header, so a check from another https origin always failed ('network')
        if (!b && location.protocol === 'https:') b = location.href.split(/[?#]/)[0].replace(/[^/]*$/, '');
        if (!b) b = AppBoot.remoteBase ? AppBoot.remoteBase() : REMOTE_OLD;
        return b.charAt(b.length - 1) === '/' ? b : b + '/';
    }

    function isValid(m) {
        return !!(m && typeof m.build === 'number' && m.css && m.css.length !== undefined &&
                  m.js && m.js.length && m.games && m.games.length !== undefined);
    }

    function emit() { for (var i = 0; i < listeners.length; i++) { try { listeners[i](st); } catch (e) {} } }
    function set(state, error) { st.state = state; st.error = error || ''; emit(); }

    /* ---------------- check ---------------- */

    function check() {
        if (st.state === 'checking' || st.state === 'downloading') return;
        var my = ++token, base = remoteBase();
        st.remote = null; st.done = st.total = 0;
        set('checking');
        AppBoot.get(base + 'app-manifest.json?t=' + Date.now(), CHECK_TIMEOUT, function (err, text) {
            if (my !== token) return;                                      // cancelled
            var m = null;
            try { m = JSON.parse(text); } catch (e) {}
            Store.set('update_checked', Date.now());
            if (err) return set('error', 'network');
            if (!isValid(m)) return set('error', 'invalid');
            if (m.shell !== AppBoot.SHELL) return set('error', 'shell');   // needs a new package from the store
            if (m.build > AppBoot.build()) { st.remote = m; return set('available'); }
            set('uptodate');
        });
    }

    // the Settings page checks once per session when it opens (like Windows Update)
    function autoCheck() { if (!autoDone) { autoDone = true; check(); } }

    /* ---------------- download ---------------- */

    function files(m) { return m.css.concat(m.js, ['app.html']); }

    function install() {
        var m = st.remote;
        if (!m || st.state === 'downloading' || st.state === 'checking') return;
        var my = ++token, base = remoteBase(), list = files(m), next = 0, active = 0, failed = false, texts = {};
        st.done = 0; st.total = list.length;
        set('downloading');

        function get(i, tries) {
            // same address as the loader uses for this build, so the TV's cache can answer later
            AppBoot.get(base + list[i] + '?b=' + m.build, FILE_TIMEOUT, function (err, text) {
                if (my !== token) return;
                if ((err || !text) && tries < 2) return get(i, tries + 1);
                active--;
                if (err || !text) failed = true; else { st.done++; texts[list[i]] = text; }
                if (failed) { if (!active) { st.remote = m; set('error', 'download'); } return; }
                emit();
                pump();
            });
        }
        function pump() {
            if (failed) return;
            while (active < PARALLEL && next < list.length) { active++; get(next++, 1); }
            if (!active && st.done === st.total) {
                // the saved copy (js/core/boot-cache.js): the next start runs it even if the network is weak again
                if (typeof BootCache !== 'undefined' && BootCache.supported()) BootCache.save(m, base, texts);
                texts = null;
                finish(m, base);
            }
        }
        pump();
    }

    // remember this build as the one to run when the server is slow at the next start
    function finish(m, base) {
        try { localStorage.setItem('boot_good', JSON.stringify({ manifest: m, base: base, at: Date.now() })); } catch (e) {}
        try { localStorage.setItem('boot_stale_fail', '0'); } catch (e2) {}
        set('ready');
    }

    function restart() {
        // the person asked for this build: a failure of it at an earlier start must not keep it away
        try { localStorage.removeItem('boot_bad_build'); localStorage.removeItem('boot_stale_fail'); } catch (e) {}
        var url = location.href.split(/[?#]/)[0];
        location.replace(url);
    }

    // leaving the page: stop waiting for results (the requests end on their own)
    function cancel() {
        token++;
        if (st.state === 'checking') set('idle');
        else if (st.state === 'downloading') set('available');
    }

    // The built-in copy ran because the update server did not answer at start (a slow network as the TV wakes up):
    // look again once the desktop is up, download the newer build quietly and say so. The next start runs it
    // (the loader finds it online, or runs this saved copy if the server is slow again). Desktop page only.
    // download a newer build quietly; fn(true) once it is ready (also saved on the TV / USB drive by install())
    function quietly(fn) {
        function on(s) {
            if (s.state === 'available') return install();
            if (s.state === 'downloading' || s.state === 'checking') return;
            offChange(on);
            fn(s.state === 'ready');
        }
        listeners.push(on);
        check();
    }
    function told(s) {
        if (window.Notify) Notify.show({ id: 'upd', kind: 'info', title: I18n.t('updBgTitle'), text: I18n.t('updBgReady').replace('{v}', s.remote.version || s.remote.build), timeout: 9000 });
    }

    /* While My PC stays open (owner 2026-11-28: "and when My PC is already open?"): every WATCH_EVERY and when the TV comes back
     * to My PC, look for a newer build and download it quietly. It starts by itself only while nobody uses My PC (the desktop,
     * no app window, no key / touch for IDLE_MS, no music playing); else a card says it starts next time, and it restarts as
     * soon as My PC is idle. Desktop page only (main.js); never on the web (the site is always current). */
    var WATCH_EVERY = 3 * 3600 * 1000, IDLE_MS = 10 * 60 * 1000, lastUse = Date.now(), watching = false, lastWatch = Date.now(), saidReady = false;
    function idle() {
        if (Date.now() - lastUse < IDLE_MS || document.hidden) return false;
        var d = document.getElementById('desktop');
        if (!d || d.hidden) return false;
        if (typeof Win !== 'undefined' && Win.current && Win.current()) return false;
        if (typeof GameHost !== 'undefined' && GameHost.active && GameHost.active()) return false;
        try { if (typeof Music !== 'undefined' && Music.state && Music.state().playing) return false; } catch (e) {}
        return true;
    }
    function tick() {
        if (document.hidden) return;
        if (st.state === 'ready' && st.remote) {
            if (!saidReady) { saidReady = true; told(st); }
            if (idle()) restart();
            return;
        }
        if (Date.now() - lastWatch < WATCH_EVERY || st.state === 'checking' || st.state === 'downloading') return;
        lastWatch = Date.now();
        quietly(function () {});
    }
    function watch(every) {
        if (watching || !window.AppBoot) return false;
        if (location.protocol === 'https:' && !localStorage.getItem('boot_remote_base')) return false;
        watching = true;
        if (every) WATCH_EVERY = every;
        var use = function () { lastUse = Date.now(); };
        ['keydown', 'pointerdown', 'touchstart', 'wheel'].forEach(function (e) { document.addEventListener(e, use, true); });
        setInterval(tick, 60000);
        document.addEventListener('visibilitychange', function () { if (!document.hidden) { if (Date.now() - lastWatch > 30 * 60000) lastWatch = 0; tick(); } });
        return true;
    }

    function background(delay) {
        var why = window.AppBoot && AppBoot.reason ? AppBoot.reason() : '';
        if (!window.AppBoot || AppBoot.source() !== 'local' || (why !== 'unreachable' && why !== 'saved')) return false;
        if (location.protocol === 'https:' && !localStorage.getItem('boot_remote_base')) return false;        // the web: always current
        setTimeout(function () {
            if (st.state !== 'idle') return;
            quietly(function (ok) { if (ok) { saidReady = true; told(st); } });
        }, delay === undefined ? 15000 : delay);
        return true;
    }
    function offChange(fn) { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }

    return {
        background: background,
        watch: watch,
        _idle: function (ms) { lastUse = Date.now() - ms; lastWatch = 0; tick(); },     // tests
        check: check, autoCheck: autoCheck, install: install, restart: restart, cancel: cancel,
        state: function () { return st; },
        onChange: function (fn) { listeners.push(fn); },
        offChange: offChange,
        lastChecked: function () { return Store.get('update_checked', 0); },
        info: function () {
            return { version: AppBoot.version(), build: AppBoot.build(), source: AppBoot.source(),
                     reason: AppBoot.reason ? AppBoot.reason() : '', smart: !!AppBoot.reason };
        }
    };
})();
