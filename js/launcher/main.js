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

    function exitApp() {
        try { tizen.application.getCurrentApplication().exit(); return; } catch (e) {}
        try { window.close(); } catch (e2) {}
    }

    function updateIndicator() {
        var d = Input.device();
        $('input-indicator').textContent = I18n.t(d === 'pad' ? 'inputPad' : d === 'keyboard' ? 'inputKeys' : 'inputRemote');
    }

    /* ---------- router ---------- */
    function route(action, pressed, repeat, dev) {
        if (action === 'padConnected') { toast(I18n.t('padOn')); return; }

        if (dialogOpen) {
            if (!pressed) return;
            if (action === 'left' || action === 'right') Focus.move(action);
            else if (action === 'confirm' && !repeat) Focus.current() && Focus.current().click();
            else if ((action === 'back' || action === 'cancel') && !repeat) closeDialog();
            return;
        }

        if (GameHost.active()) return GameHost.onAction(action, pressed, repeat, dev);

        if (action === 'padLost') { toast(I18n.t('padOff').split('.')[0]); return; }
        if (!pressed) return;
        var isBack = (action === 'back' || action === 'cancel') && !repeat;

        if (!$('page').hidden) {
            if (isBack) Menu.closePage();
            else if (action === 'confirm' && !repeat) Menu.confirmFocused();
            return;
        }
        if (!$('scores').hidden) {
            if (isBack) Menu.closeScores();
            else if (action === 'left' || action === 'right' || action === 'up' || action === 'down') Focus.move(action);
            else if (action === 'confirm' && !repeat) Menu.confirmFocused();
            return;
        }
        if (!$('settings').hidden) {
            if (isBack) Menu.closeSettings();
            else if (action === 'up' || action === 'down') Focus.move(action);
            else if (action === 'left' || action === 'right') Menu.settingsAdjust(action);
            else if (action === 'confirm' && !repeat) Menu.confirmFocused();
            return;
        }
        // main menu
        if (isBack) confirm(I18n.t('exitTitle'), I18n.t('exitText'), exitApp);
        else if (action === 'left' || action === 'right' || action === 'up' || action === 'down') Focus.move(action);
        else if (action === 'confirm' && !repeat) Menu.confirmFocused();
    }

    /* ---------- game list from the active app manifest ---------- */
    function loadGames(done) {
        var active = AppBoot.manifest(), local = AppBoot.localManifest();
        var base = AppBoot.base(), localBase = AppBoot.localBase();
        var remote = AppBoot.source() === 'remote';
        var ids = active.games, out = [], pending = ids.length;
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

    function onGameExit(id) {
        Menu.show();
        var tile = Menu.tileFor(id);
        if (tile) Focus.focus(tile);
    }

    function play(g) {
        if (benchCancel) { benchCancel(); benchCancel = null; }
        Menu.hide();
        Menu.releaseImages();
        GameHost.launch(g, onGameExit);
    }

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
        GameHost.init();
        $('dialog-yes').onclick = function () { var cb = dialogYes; closeDialog(); if (cb) cb(); };
        $('dialog-no').onclick = closeDialog;

        // Multitasking: pause the game (and its audio) when the app goes to the background.
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) {
                Input.releaseAll();
                if (GameHost.state() === 'running') GameHost.openPause();
            }
        });

        loadGames(function (games) {
            Menu.init(games, play);
            Menu.show();
            I18n.apply();
            AppBoot.ready();
            // One-time device benchmark while the menu is idle.
            setTimeout(function () {
                if (!GameHost.active()) benchCancel = Perf.benchmark(function () { benchCancel = null; });
            }, 1500);
        });
    }

    return { start: start, confirm: confirm, toast: toast };
})();

App.start();
