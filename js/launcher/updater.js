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
 *     state: idle | checking | uptodate | available | downloading | ready | error
 *     error: network | invalid | shell | download
 * Works with any loader: it only needs AppBoot.get / build / version / source / SHELL. */
var Updater = (function () {
    'use strict';

    var REMOTE_DEFAULT = 'https://imad-os.github.io/g/';
    var CHECK_TIMEOUT = 20000, FILE_TIMEOUT = 20000, PARALLEL = 3;
    var st = { state: 'idle', remote: null, done: 0, total: 0, error: '' };
    var listeners = [], token = 0, autoDone = false;

    function remoteBase() {
        var b = null;
        try { b = localStorage.getItem('boot_remote_base'); } catch (e) {}     // same override as the loader (staging, tests)
        b = b || REMOTE_DEFAULT;
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
        var my = ++token, base = remoteBase(), list = files(m), next = 0, active = 0, failed = false;
        st.done = 0; st.total = list.length;
        set('downloading');

        function get(i, tries) {
            // same address as the loader uses for this build, so the TV's cache can answer later
            AppBoot.get(base + list[i] + '?b=' + m.build, FILE_TIMEOUT, function (err, text) {
                if (my !== token) return;
                if ((err || !text) && tries < 2) return get(i, tries + 1);
                active--;
                if (err || !text) failed = true; else st.done++;
                if (failed) { if (!active) { st.remote = m; set('error', 'download'); } return; }
                emit();
                pump();
            });
        }
        function pump() {
            if (failed) return;
            while (active < PARALLEL && next < list.length) { active++; get(next++, 1); }
            if (!active && st.done === st.total) finish(m, base);
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
        var url = location.href.split(/[?#]/)[0];
        location.replace(url);
    }

    // leaving the page: stop waiting for results (the requests end on their own)
    function cancel() {
        token++;
        if (st.state === 'checking') set('idle');
        else if (st.state === 'downloading') set('available');
    }

    return {
        check: check, autoCheck: autoCheck, install: install, restart: restart, cancel: cancel,
        state: function () { return st; },
        onChange: function (fn) { listeners.push(fn); },
        offChange: function (fn) { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
        lastChecked: function () { return Store.get('update_checked', 0); },
        info: function () {
            return { version: AppBoot.version(), build: AppBoot.build(), source: AppBoot.source(),
                     reason: AppBoot.reason ? AppBoot.reason() : '', smart: !!AppBoot.reason };
        }
    };
})();
