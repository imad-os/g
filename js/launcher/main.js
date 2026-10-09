/* Launcher entry point and the single input router (the only place that handles Back). */
var App = (function () {
    'use strict';

    var dialogOpen = false, dialogYes = null, toastTimer = 0, benchCancel = null;

    function $(id) { return document.getElementById(id); }

    /* ---------- screen fit: the UI is laid out at 1920x1080 and scaled to the window ---------- */
    function fit() {
        var w = window.innerWidth || 1920, h = window.innerHeight || 1080;
        var s = Math.min(w / 1920, h / 1080), st = $('stage');
        var tr = Math.abs(s - 1) < 0.01 ? '' : 'scale(' + s + ')';
        st.style.webkitTransform = tr;
        st.style.transform = tr;
        st.style.left = Math.max(0, (w - 1920 * s) / 2) + 'px';
        st.style.top = Math.max(0, (h - 1080 * s) / 2) + 'px';
    }

    /* ---------- dialogs & toasts ---------- */
    function confirm(title, text, onYes) {
        $('dialog-title').textContent = title;
        $('dialog-text').textContent = text;
        $('dialog-yes').textContent = I18n.t('yes');
        $('dialog-no').textContent = I18n.t('no');
        dialogYes = onYes;
        dialogOpen = true;
        $('dialog-backdrop').hidden = false;
        Focus.push($('dialog'), $('dialog-no'));
    }
    function closeDialog() {
        dialogOpen = false;
        $('dialog-backdrop').hidden = true;
        Focus.pop();
    }

    function toast(text) {
        var t = $('toast');
        t.textContent = text;
        t.hidden = false;
        A11y.announce(text);
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
    }

    /* ---------- network status popup ----------
     * Uses the browser online/offline events and, on the TV, webapis.network (privilege
     * network.public). The app keeps working offline; this only informs the user. */
    var netDown = false, netTimer = 0;
    function showNet(ok) {
        var el = $('netpop');
        $('netpop-text').textContent = I18n.t(ok ? 'netOn' : 'netOff');
        el.className = 'netpop' + (ok ? ' ok' : '');
        el.hidden = false;
        A11y.announce(I18n.t(ok ? 'netOn' : 'netOff'));
        clearTimeout(netTimer);
        netTimer = setTimeout(function () { el.hidden = true; }, ok ? 3000 : 7000);
    }
    function netChange(online) {
        if (online === !netDown) return;
        netDown = !online;
        showNet(online);
    }
    function watchNetwork() {
        window.addEventListener('offline', function () { netChange(false); });
        window.addEventListener('online', function () { netChange(true); });
        try {
            var NS = webapis.network.NetworkState;
            webapis.network.addNetworkStateChangeListener(function (v) {
                if (v === NS.GATEWAY_DISCONNECTED || v === NS.LAN_CABLE_DETACHED || v === NS.WIFI_MODULE_STATE_DETACHED) netChange(false);
                else if (v === NS.GATEWAY_CONNECTED) netChange(true);
            });
        } catch (e) {}
        if (navigator.onLine === false) netChange(false);
    }

    function exitApp() {
        try { tizen.application.getCurrentApplication().exit(); return; } catch (e) {}
        try { window.close(); } catch (e2) {}
    }

    function updateIndicator() { if (window.Desktop) Desktop.updateTray(); }

    /* ---------- router ---------- */
    function route(action, pressed, repeat, dev) {
        if (Welcome.open()) { Welcome.action(action, pressed); return; }
        if (action === 'padConnected') { toast(I18n.t('padOn')); return; }

        if (dialogOpen) {
            if (!pressed) return;
            if (action === 'left' || action === 'right') Focus.move(action);
            else if (action === 'confirm' && !repeat) Focus.current() && Focus.current().click();
            else if ((action === 'back' || action === 'cancel') && !repeat) closeDialog();
            return;
        }

        // Tab / Shift+Tab walk through the buttons of the current screen (a game that runs does not get them)
        if ((action === 'tab' || action === 'tabBack') && !(GameHost.active() && GameHost.state() === 'running')) {
            if (pressed) Focus.step(action === 'tab' ? 1 : -1);
            return;
        }

        // multiplayer screens (host / join / waiting / "wants to join") sit over the running game
        if (Multiplayer.screenOpen()) { Multiplayer.action(action, pressed, repeat); return; }

        if (GameHost.active()) return GameHost.onAction(action, pressed, repeat, dev);

        if (action === 'padLost') { toast(I18n.t('padOff').split('.')[0]); return; }
        if (!pressed) return;

        // top to bottom: keyboard over everything, profiles overlay, the open app, the desktop
        if (Keyboard.isOpen()) return Keyboard.action(action, repeat);
        if (ProfilesUI.screenOpen()) return ProfilesUI.screenAction(action, repeat);
        if (Win.isOpen()) return Win.action(action, repeat, dev);
        Desktop.action(action, repeat);
    }

    /* ---------- game list from the active app manifest ---------- */
    // only: load just this game's manifest (game page)
    function loadGames(done, only) {
        var active = AppBoot.manifest(), local = AppBoot.localManifest();
        var base = AppBoot.base(), localBase = AppBoot.localBase();
        var remote = AppBoot.source() === 'remote';
        var ids = only ? active.games.filter(function (g) { return g === only; }) : active.games, out = [], pending = ids.length;
        if (!pending) return done(out);

        function inLocal(id) { for (var i = 0; i < local.games.length; i++) if (local.games[i] === id) return true; return false; }
        function fetchManifest(b, id, cb) {
            AppBoot.get(b + 'games/' + id + '/game-manifest.json?b=' + AppBoot.build(), remote && b === base ? 10000 : 0, function (err, text) {
                var m = null;
                try { m = JSON.parse(text); } catch (e) {}
                cb(err || !m || m.id !== id ? null : m);
            });
        }
        function finish() {
            if (--pending) return;
            // keep the manifest order
            var sorted = [];
            for (var i = 0; i < ids.length; i++) for (var j = 0; j < out.length; j++) if (out[j].id === ids[i]) sorted.push(out[j]);
            done(sorted);
        }
        ids.forEach(function (id) {
            var hasLocal = inLocal(id);
            fetchManifest(base, id, function (m) {
                var entry = { id: id, manifest: m, base: base, bundledBase: hasLocal ? (remote ? localBase : '') : null };
                if (m && m.minShell && m.minShell > AppBoot.SHELL) m = null;
                if (!remote || !hasLocal) {
                    if (m) out.push(entry);
                    return finish();
                }
                // Keep the bundled manifest so a broken hosted game can fall back to it.
                fetchManifest(localBase, id, function (lm) {
                    entry.bundledManifest = lm;
                    if (!m && lm) { entry.manifest = lm; entry.base = localBase; }
                    if (entry.manifest) out.push(entry);
                    finish();
                });
            });
        });
    }

    /* ---------- two pages: the desktop and the game are never in memory together ----------
     * Opening a game loads index.html?play=<id>: the browser throws the whole desktop page away
     * (DOM, images, timers, JS heap) and this page starts only that game. Quitting loads
     * index.html?from=<id>: a fresh desktop, focused on the game's icon. Same packaged index.html
     * and boot loader, so it needs no new TV package. */
    function param(name) {
        var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(location.search);
        return m ? decodeURIComponent(m[1]) : null;
    }
    // absolute URL of this page (relative URLs would follow the hosted copy's <base href>)
    function page(query) { return location.href.split(/[?#]/)[0] + query; }
    function goHome(id) { location.replace(page(id ? '?from=' + encodeURIComponent(id) : '')); }

    function play(g) {
        if (benchCancel) { benchCancel(); benchCancel = null; }
        Desktop.hide();
        Desktop.releaseImages();
        location.replace(page('?play=' + encodeURIComponent(g.id)));
    }

    // game page: no desktop at all, only the game layer
    function startGame(id) {
        $('desktop').hidden = true;
        var go = function (g) {
            AppBoot.ready();
            if (!g) return goHome(id);                 // uninstalled or unknown: back to the desktop
            Store.set('last_game', g.id);
            GameHost.launch(g, goHome);
        };
        if (id.indexOf('app-') === 0) {
            // an installed app: from the saved Firebase list (no network needed)
            var list = Cloud.apps(), a = null;
            for (var i = 0; i < list.length; i++) if ('app-' + list[i].id === id) a = list[i];
            if (!a) return go(null);
            Cloud.count(a.id, 'opens');                // "popular" in the App Store
            var g = Desktop.fromCloud(a);
            // Before the app opens (behind its loading screen): read its document again so the config
            // is current. Offline or slow (2.5 s), the saved copy is used. Uninstalled: back to the desktop.
            g.remote.prepare = function (done) {
                Cloud.fetchApp(a.id, function (err, fresh) {
                    if (err === 'notfound') return done(false);
                    if (!err && fresh) { g.remote.entry = fresh.entry; g.remote.config = fresh.config; g.remote.version = fresh.version || ''; }
                    done(true);
                });
            };
            return go(g);
        }
        loadGames(function (games) { go(games[0] || null); }, id);
    }

    function profileChanged() { Desktop.profileChanged(); Win.refresh(); }

    function start() {
        fit();
        window.addEventListener('resize', fit);
        I18n.apply();
        A11y.init();
        if (Perf.profile().tier !== 'low') document.documentElement.className += ' hi';
        Input.init();
        Input.setHandler(route);
        Input.onDevice(updateIndicator);
        updateIndicator();
        showVersion();
        GameHost.init();
        Multiplayer.init();
        Win.init();
        watchNetwork();
        $('dialog-yes').onclick = function () { var cb = dialogYes; closeDialog(); if (cb) cb(); };
        $('dialog-no').onclick = closeDialog;

        // Multitasking: pause the game (and its audio) when the app goes to the background.
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) {
                Input.releaseAll();
                if (GameHost.state() === 'running') GameHost.openPause();
            }
        });

        var playId = param('play');
        if (playId) return startGame(playId);

        // My PC was reinstalled or the TV was reset: bring back this TV's profiles, settings, apps and records
        if (Store.fresh()) {
            return Backup.restore(function (restored) {
                if (restored) return location.replace(page('?restored=1'));
                desktop();
            });
        }
        desktop();
    }

    function desktop() {
        loadGames(function (games) {
            Desktop.init(games, play);
            ProfilesUI.init(profileChanged);
            Desktop.show();
            // apps installed from the computer: shown from the cache now, updated when Firebase answers
            Cloud.refresh(function (err, list, changed) {
                if (err || !changed) return;
                var keep = Focus.current();
                Desktop.setInstalled(list);
                if (!document.getElementById('desktop').hidden) Focus.focus(keep && document.body.contains(keep) ? keep : document.querySelector('#desk-icons [data-focus]'));
            });
            // installed or uninstalled in the App Store
            Cloud.onChange(function () { Desktop.setInstalled(Cloud.apps()); });
            I18n.apply();
            AppBoot.ready();
            Welcome.afterBoot();
            Backup.start();
            World.flush();
            // One-time device benchmark while the menu is idle.
            setTimeout(function () {
                if (!GameHost.active()) benchCancel = Perf.benchmark(function () { benchCancel = null; });
            }, 1500);
        });
    }

    // Version on the home screen, so it is easy to see that an online update arrived
    // (the hosted copy is picked up on the next start, no new package needed).
    function showVersion() {
        $('app-version').textContent = 'v' + AppBoot.version() + ' (' + I18n.t('build') + ' ' + AppBoot.build() + ')';
    }

    // after a language change: everything that is not data-i18n driven
    function refresh() { Desktop.render(); ProfilesUI.renderButton(); showVersion(); Desktop.tick(); }

    return { start: start, confirm: confirm, toast: toast, refresh: refresh, exitApp: exitApp };
})();

App.start();
