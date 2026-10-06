/* Launcher entry point and the single input router (the only place that handles Back). */
var App = (function () {
    'use strict';

    var dialogOpen = false, dialogYes = null, benchCancel = null, games = [];

    function $(id) { return document.getElementById(id); }

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

    function toast(text) { Net.toast(text); }

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

        if (action === 'padLost') { toast(I18n.t('padOff').split('.')[0]); return; }
        if (!pressed) return;
        var isBack = (action === 'back' || action === 'cancel') && !repeat;

        if (Picker.isOpen()) return Picker.action(action, repeat);
        if (ProfilesUI.stylerOpen()) return ProfilesUI.stylerAction(action, repeat);
        if (ProfilesUI.namerOpen()) return ProfilesUI.namerAction(action, repeat);
        if (ProfilesUI.screenOpen()) return ProfilesUI.screenAction(action, repeat);
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

    /* ---------- game list: the registry (Firestore) -> cache -> bundled games ---------- */
    function loadGames(done) {
        var active = AppBoot.manifest(), local = AppBoot.localManifest();
        var base = AppBoot.base(), localBase = AppBoot.localBase();
        var remote = AppBoot.source() === 'remote';

        function inLocal(id) { for (var i = 0; i < local.games.length; i++) if (local.games[i] === id) return true; return false; }
        function fetchManifest(b, id, cb) {
            AppBoot.get(b + 'games/' + id + '/game-manifest.json?b=' + AppBoot.build(), remote && b === base ? 10000 : 0, function (err, text) {
                var m = null;
                try { m = JSON.parse(text); } catch (e) {}
                cb(err || !m || m.id !== id ? null : m);
            });
        }

        // ids shown: bundled games must be in the package (or in the hosted manifest)
        var bundledIds = active.games.slice();
        for (var k = 0; k < local.games.length; k++) if (bundledIds.indexOf(local.games[k]) < 0) bundledIds.push(local.games[k]);

        Registry.load(bundledIds, AppBoot.SHELL, function (entries) {
            var out = [], pending = entries.length;
            if (!pending) return done(out);
            function finish() {
                if (--pending) return;
                var sorted = [];
                for (var i = 0; i < entries.length; i++) for (var j = 0; j < out.length; j++) if (out[j].id === entries[i].id) sorted.push(out[j]);
                done(sorted);
            }
            entries.forEach(function (en) {
                var id = en.id;
                if (!en.bundled) {
                    var d = en.doc, cover = d.cover ? new URL(d.cover, d.url).href : '';
                    out.push({ id: id, remote: true, url: d.url, base: null, bundledBase: null,
                               manifest: { id: id, build: d.build || 0, cover: cover, title: d.title, description: d.description || {}, tags: d.tags || [] } });
                    return finish();
                }
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
        });
    }

    /* ---------- launching: the home document is replaced by game.html ---------- */

    function launch(g, profileId) {
        if (benchCancel) { benchCancel(); benchCancel = null; }
        Profiles.use(profileId);
        var tile = Menu.tileFor(g.id), img = tile && tile.querySelector('img');
        var m = g.manifest;
        var desc = {
            id: g.id, remote: !!g.remote, url: g.url || '', base: g.base, bundledBase: g.bundledBase,
            title: m.title, build: m.build || 0,
            cover: img ? img.src : '', coverReady: !!(img && img.complete && img.naturalWidth > 0)
        };
        try { sessionStorage.setItem('arc_launch', JSON.stringify(desc)); } catch (e) {}
        location.replace(AppBoot.localBase() + 'game.html?id=' + encodeURIComponent(g.id) + '&profile=' + encodeURIComponent(profileId));
    }

    // Choosing a game: the profile picker, unless a default profile is set.
    function play(g) {
        var def = Profiles.defaultId();
        if (def) return launch(g, def);
        openPicker(g, null);
    }

    function openPicker(g, preselect) {
        Picker.show({
            title: I18n.t('whoPlays'), showDefault: true, preselect: preselect,
            onPick: function (id) { launch(g, id); },
            onCancel: function () { var t = Menu.tileFor(g.id); if (t) Focus.focus(t); },
            onNew: function () {
                ProfilesUI.create(function (p) { openPicker(g, p ? p.id : null); });
            }
        });
    }

    function start() {
        Net.fit($('stage'));
        window.addEventListener('resize', function () { Net.fit($('stage')); });
        I18n.apply();
        A11y.init();
        if (Perf.profile().tier !== 'low') document.documentElement.className += ' hi';
        Input.init();
        Input.setHandler(route);
        Input.onDevice(updateIndicator);
        updateIndicator();
        showVersion();
        Net.watch();
        Picker.init();
        $('dialog-yes').onclick = function () { var cb = dialogYes; closeDialog(); if (cb) cb(); };
        $('dialog-no').onclick = closeDialog;

        document.addEventListener('visibilitychange', function () { if (document.hidden) Input.releaseAll(); });

        loadGames(function (list) {
            games = list;
            var from = (/[?&]from=([a-z0-9-]+)/.exec(location.search) || [])[1];
            if (from) Store.set('last_game', from);
            Menu.init(games, play);
            ProfilesUI.init(Menu.profileChanged);
            Menu.show();
            I18n.apply();
            AppBoot.ready();
            var g = null;
            if (from && /[?&]pick=1/.test(location.search)) for (var i = 0; i < games.length; i++) if (games[i].id === from) g = games[i];
            if (g) play(g);
            // One-time device benchmark while the menu is idle.
            setTimeout(function () { if (!Picker.isOpen()) benchCancel = Perf.benchmark(function () { benchCancel = null; }); }, 1500);
        });
    }

    // re-applies texts that are not data-i18n driven (called after a language change)
    // Version on the home screen, so it is easy to see that an online update arrived
    // (the hosted copy is picked up on the next start, no new package needed).
    function showVersion() {
        $('app-version').textContent = 'v' + AppBoot.version() + ' (' + I18n.t('build') + ' ' + AppBoot.build() + ')';
    }

    function refresh() { updateIndicator(); ProfilesUI.renderButton(); showVersion(); }

    return { start: start, confirm: confirm, toast: toast, refresh: refresh };
})();

App.start();
