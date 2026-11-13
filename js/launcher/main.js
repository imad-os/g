/* Launcher entry point and the single input router (the only place that handles Back). */
var App = (function () {
    'use strict';

    var dialogOpen = false, dialogYes = null, dialogNo = null, benchCancel = null;

    function $(id) { return document.getElementById(id); }

    /* ---------- screen fit: the UI is laid out at 1920x1080 and scaled to the window ---------- */
    // the size of what is visible now. Phones report the old size for a moment after a rotation, so refit() checks again.
    function viewSize() {
        var v = window.visualViewport, d = document.documentElement;
        var w = (v && v.width) || d.clientWidth || window.innerWidth || 1920, h = (v && v.height) || d.clientHeight || window.innerHeight || 1080;
        return [Math.round(w), Math.round(h)];
    }
    var fitTimers = [];
    function refit() {
        fit();
        for (var i = 0; i < fitTimers.length; i++) clearTimeout(fitTimers[i]);
        fitTimers = [setTimeout(fit, 100), setTimeout(fit, 300), setTimeout(fit, 700)];
    }
    // the phone's keyboard opening (same width, a text field focused, much less height) leaves the screen as it is: no shrinking
    // into the space left above the keyboard; the page keeps its full height (a WebView resizes the window for the keyboard)
    var full = null;
    function keyboardUp(w, h) {
        var a = document.activeElement, t = a && (a.tagName === 'TEXTAREA' || a.isContentEditable || (a.tagName === 'INPUT' && !/^(button|checkbox|radio|range|submit|reset|file|color|image|hidden)$/i.test(a.type || '')));
        return !!(t && full && Math.abs(w - full[0]) < 2 && h < full[1] - 80);
    }
    function fit() {
        var vs = viewSize(), w = vs[0], h = vs[1], de = document.documentElement;
        if (keyboardUp(w, h)) { de.style.height = document.body.style.height = full[1] + 'px'; return; }
        if (de.style.height) de.style.height = document.body.style.height = '';
        full = [w, h];
        if (window.scrollX || window.scrollY) window.scrollTo(0, 0);         // a rotation can leave the page scrolled
        // a tall window (a phone held upright, js/core/rotation.js) gets a tall screen that fills it: 1080 wide and as tall
        // as the window (CSS --sw / --sh, html.tall); the TV and wide windows keep 1920x1080
        var tall = !window.tizen && h > w * 1.1, sw = tall ? 1080 : 1920, sh = tall ? Math.round(1080 * h / w) : 1080;
        var s = Math.min(w / sw, h / sh), st = $('stage');
        var tr = Math.abs(s - 1) < 0.01 ? '' : 'scale(' + s + ')';
        st.style.webkitTransform = tr;
        st.style.transform = tr;
        if (tall !== de.classList.contains('tall') || (tall && screenH !== sh)) {
            screenW = sw; screenH = sh;
            de.classList.toggle('tall', tall);
            if (tall) { de.style.setProperty('--sw', sw + 'px'); de.style.setProperty('--sh', sh + 'px'); }
            else { de.style.removeProperty('--sw'); de.style.removeProperty('--sh'); }
            try { window.dispatchEvent(new Event('mypc-screen')); } catch (e) {}
        }
        // a phone shows the 1920x1080 screen at about a third of its size: bigger taskbar and desktop icons (css .compact)
        de.classList.toggle('compact', !window.tizen && s < 0.6);
        st.style.left = Math.max(0, (w - sw * s) / 2) + 'px';
        st.style.top = Math.max(0, (h - sh * s) / 2) + 'px';
    }
    // the size My PC's screen is laid out at: 1920x1080, or 1080 x taller on a phone held upright
    var screenW = 1920, screenH = 1080;
    function screenSize() { return { w: screenW, h: screenH, tall: screenW < screenH }; }

    /* ---------- dialogs & toasts ---------- */
    // opts (optional): { yes: 'Allow', no: "Don't allow", onNo: fn } (onNo also runs on Back)
    function confirm(title, text, onYes, opts) {
        opts = opts || {};
        $('dialog-title').textContent = title;
        $('dialog-text').textContent = text;
        $('dialog-yes').textContent = opts.yes || I18n.t('yes');
        $('dialog-no').textContent = opts.no || I18n.t('no');
        dialogYes = onYes;
        dialogNo = opts.onNo || null;
        dialogOpen = true;
        $('dialog-backdrop').hidden = false;
        Focus.push($('dialog'), $('dialog-no'));
    }
    function closeDialog() {
        dialogOpen = false;
        dialogNo = null;
        $('dialog-backdrop').hidden = true;
        Focus.pop();
    }
    function dialogRefused() { var cb = dialogNo; closeDialog(); if (cb) cb(); }

    // every notice uses the one toast look (js/launcher/notify.js); opts: { kind, title, id, timeout, image, onClick }
    function toast(text, opts) {
        var o = {}, k;
        if (opts) for (k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k];
        o.text = text;
        return Notify.show(o);
    }

    /* ---------- network status notice ----------
     * Uses the browser online/offline events and, on the TV, webapis.network (privilege
     * network.public). The app keeps working offline; this only informs the user. */
    var netDown = false;
    function showNet(ok) {
        Notify.show({ id: 'net', kind: ok ? 'ok' : 'err', text: I18n.t(ok ? 'netOn' : 'netOff'), timeout: ok ? 3000 : 7000 });
    }
    function netChange(online) {
        if (online === !netDown) return;
        netDown = !online;
        showNet(online);
    }
    function watchNetwork() {
        // network modes (owner request 2026-11-13, js/core/netmode.js): offline / home network only / online on the Wi-Fi icon,
        // one card when the mode changes (none at start while online)
        if (window.NetMode) {
            NetMode.onChange(function (cur, old) {
                if (old === cur || (old.mode === cur.mode && cur.mode !== 'local')) return;
                if (!old.at && cur.mode === 'online') return;
                if (window.Desktop && Desktop.netCard) Desktop.netCard();
            });
            NetMode.start();
            return;
        }
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
        try { if (window.MyPCNative && window.MyPCNative.exit) { window.MyPCNative.exit(); return; } } catch (e1) {}   // the Android app
        try { window.close(); } catch (e2) {}
    }

    function updateIndicator() { if (window.Desktop) Desktop.updateTray(); }

    /* ---------- router ---------- */
    function route(action, pressed, repeat, dev) {
        if (Welcome.open()) { Welcome.action(action, pressed); return; }
        if (action === 'padConnected') {
            // the controller's brand and model (js/core/pad-info.js) as the card's title
            var pl = Input.pads(), lp = pl[pl.length - 1], nm = lp ? (lp.brand && (lp.model || '').toLowerCase().indexOf(lp.brand.toLowerCase()) !== 0 ? lp.brand + ' ' + lp.model : lp.model || lp.name) : '';
            toast(I18n.t('padOn'), { id: 'pad', kind: 'ok', title: nm || undefined });
            return;
        }

        if (dialogOpen) {
            if (!pressed) return;
            if (action === 'left' || action === 'right') Focus.move(action);
            else if (action === 'confirm' && !repeat) Focus.current() && Focus.current().click();
            else if ((action === 'back' || action === 'cancel') && !repeat) dialogRefused();
            return;
        }

        // Tab / Shift+Tab walk through the buttons of the current screen (a game that runs does not get them)
        if ((action === 'tab' || action === 'tabBack') && !(GameHost.active() && GameHost.state() === 'running')) {
            if (pressed) Focus.step(action === 'tab' ? 1 : -1);
            return;
        }

        // Google Drive sign-in / "add files" (js/launcher/drive-ui.js), over an app or the desktop
        if (DriveUI.screenOpen()) { DriveUI.action(action, pressed, repeat); return; }

        // multiplayer screens (host / join / waiting / "wants to join") sit over the running game
        if (Multiplayer.screenOpen()) { Multiplayer.action(action, pressed, repeat); return; }

        // My PC's on-screen keyboard opened for the app (MyPC.text.keyboard, API 17) sits over it
        if (GameHost.active() && Keyboard.isOpen()) { if (pressed) Keyboard.action(action, repeat); return; }
        if (GameHost.active()) return GameHost.onAction(action, pressed, repeat, dev);

        if (action === 'padLost') { toast(I18n.t('padOff').split('.')[0], { id: 'pad', kind: 'err' }); return; }
        // the Music audio visualizer (js/launcher/music-saver.js): CH + / CH − change its style, any other key brings My PC back
        if (typeof MusicSaver !== 'undefined' && MusicSaver.input(pressed, action)) return;
        if (!pressed) {
            // OK let go on the desktop: opens the shortcut (held long, it showed the shortcut menu instead)
            if (action === 'confirm' && !Keyboard.isOpen() && !ProfilesUI.screenOpen() && !Win.isOpen()) Desktop.action(action, repeat, false);
            else if (Win.isOpen() && !Keyboard.isOpen() && !ProfilesUI.screenOpen()) Win.release(action);
            return;
        }
        // the remote's media keys play the music anywhere on the desktop and in the apps (js/core/music.js)
        if (mediaKey(action, repeat)) return;

        // top to bottom: keyboard over everything, profiles overlay, the open app, the desktop
        if (Keyboard.isOpen()) return Keyboard.action(action, repeat);
        if (ProfilesUI.screenOpen()) return ProfilesUI.screenAction(action, repeat);
        if (Win.isOpen()) return Win.action(action, repeat, dev);
        Desktop.action(action, repeat);
    }

    // Play / Pause (and P), ⏭ ⏮ ⏩ ⏪ ⏹: the Music player, once it has songs. The Memo app keeps Play / Pause for its memos.
    function mediaKey(action, repeat) {
        if (typeof Music === 'undefined' || !Music.has() || Keyboard.isOpen()) return false;
        if (Win.current() === 'videos') return false;           // MyVideos plays / pauses / seeks its own video
        if (action === 'pause') {
            if (Win.current() === 'memo') return false;
            if (!repeat) { Music.toggle(); toast(Music.state().playing ? '▶  ' + Music.state().title : '❚❚  ' + I18n.t('wgPause'), { id: 'music', kind: 'info', timeout: 2500 }); }
            return true;
        }
        if (action === 'mediaNext' || action === 'mediaPrev') {
            if (!repeat) { if (action === 'mediaNext') Music.next(); else Music.prev(); toast('♪  ' + Music.state().title, { id: 'music', kind: 'info', timeout: 2500 }); }
            return true;
        }
        if (action === 'mediaFf' || action === 'mediaRew') { Music.seekBy(action === 'mediaFf' ? 15 : -15); return true; }
        if (action === 'mediaStop') { if (!repeat) Music.stop(); return true; }
        return false;
    }

    /* ---------- game list from the active app manifest ---------- */
    // only: load just this game's manifest (game page)
    function loadGames(done, only) {
        var active = AppBoot.manifest(), local = AppBoot.localManifest();
        var base = AppBoot.base(), localBase = AppBoot.localBase();
        var remote = AppBoot.source() === 'remote';
        var ids = only ? active.games.filter(function (g) { return g === only; }) : active.games, out = [], pending = ids.length;
        if (!pending) return done(out);
        // a page change inside this start (a game opens or quits): the list read at start, no request per game (2 per game
        // on the hosted copy) while the player waits. A real start reads them again.
        var KEY = 'arc_games_' + AppBoot.source() + '_' + AppBoot.build(), kept = null;
        if (only || param('from')) { try { kept = JSON.parse(sessionStorage.getItem(KEY)); } catch (e) {} }
        if (kept && kept.length) {
            var pick = kept.filter(function (g) { return !only || g.id === only; });
            if (pick.length || !only) return done(pick);
        }
        if (!only) { var save = done; done = function (list) { try { sessionStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {} save(list); }; }

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
     * and boot loader, so it needs no new TV package.
     * Why not one page with the game in a frame over the desktop (reviewed 2026-11-09, owner's question): it would open and
     * quit faster, but the desktop (pictures, live background canvas, widgets, the whole session's memory) would stay in the
     * TV's small memory under every game, and a same-origin built-in game left referenced by the desktop would keep its whole
     * window alive. A page change frees all of it for sure. What made a switch slow is cut instead: the loader reuses the
     * copy it picked at start (package 1.6.2, js/boot/loader.js), and the desktop does not read the store / settings again
     * at every Quit (syncDue below). */
    function param(name) {
        var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(location.search);
        return m ? decodeURIComponent(m[1]) : null;
    }
    // absolute URL of this page (relative URLs would follow the hosted copy's <base href>)
    function page(query) { return location.href.split(/[?#]/)[0] + query; }
    function goHome(id) { Playtime.stop(); location.replace(page(id ? '?from=' + encodeURIComponent(id) : '')); }

    function play(g) {
        if (benchCancel) { benchCancel(); benchCancel = null; }
        Desktop.hide();
        Desktop.releaseImages();
        location.replace(page('?play=' + encodeURIComponent(g.id)));
    }

    // game page: no desktop at all, only the game layer
    function startGame(id) {
        $('desktop').hidden = true;
        if (window.Themes) Themes.apply();             // the game page builds no desktop: the profile's theme for the loading screen, My PC's menu, cards
        var go = function (g) {
            AppBoot.ready();
            if (!g) return goHome(id);                 // uninstalled or unknown: back to the desktop
            Store.set('last_game', g.id);
            GameHost.launch(g, goHome);
            Playtime.start(g.id, I18n.pick(g.manifest.title));     // the Playtime widget
            Widgets.background();                      // only the widgets that run in the background (Control Panel > Widgets)
            Push.start();                              // notifications also arrive during a game (small cards, no focus taken)
            CalRemind.start();                         // the profile's calendar reminders, also over a game
            CopyJobs.init();                           // copies Google Drive <-> USB go on here too (js/core/copy-jobs.js)
            Music.init({ resume: true, lite: true });  // the music goes on under the game (the game menu can pause it)
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
                    if (!err && fresh) { g.remote.entry = fresh.entry; g.remote.config = fresh.config; g.remote.version = fresh.version || ''; g.remote.touch = fresh.touch; }
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
        window.addEventListener('resize', refit);
        window.addEventListener('orientationchange', refit);
        if (window.visualViewport) window.visualViewport.addEventListener('resize', refit);
        if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', refit);
        I18n.apply();
        A11y.init();
        if (Perf.profile().tier !== 'low') document.documentElement.className += ' hi';
        Input.init();
        Input.setHandler(route);
        // MyPC.buttons (API 19): an app that maps the remote's buttons itself gets them by name, unless one of My PC's screens is over it
        Input.setRawHook(function (n, down, repeat) {
            if (!GameHost.active() || dialogOpen || Welcome.open() || DriveUI.screenOpen() || Multiplayer.screenOpen() || Keyboard.isOpen()) return false;
            return GameHost.rawButton(n, down, repeat);
        });
        Shortcuts.init();                       // this profile's remote shortcuts (Control Panel > Shortcuts)
        Input.onDevice(updateIndicator);
        updateIndicator();
        showVersion();
        GameHost.init();
        Multiplayer.init();
        Controllers.start();
        Win.init();
        watchNetwork();
        $('dialog-yes').onclick = function () { var cb = dialogYes; closeDialog(); if (cb) cb(); };
        $('dialog-no').onclick = dialogRefused;

        // Multitasking: My PC goes to the background (TV: another app or source; PC: window minimized or another window
        // focused; phone: another app) -> the game pauses (and its audio) under My PC's menu, Resume brings it back.
        // Apps with "allow_background_running": true keep running, no menu (GameHost.background).
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) {
                Input.releaseAll();
                GameHost.background();
            }
        });
        // a blur also fires when the focus only moves into the game's own frame (a click on a PC): then the page still has it
        var blurTimer = 0;
        window.addEventListener('blur', function () {
            clearTimeout(blurTimer);
            blurTimer = setTimeout(function () {
                if (document.hasFocus && document.hasFocus()) return;
                Input.releaseAll();
                GameHost.background();
            }, 150);
        });
        window.addEventListener('focus', function () { clearTimeout(blurTimer); });

        var playId = param('play');
        if (playId) return startGame(playId);

        // My PC was reinstalled or the TV was reset: bring back this TV's profiles, settings, apps and records
        if (Store.fresh()) {
            return Backup.restore(function (restored) {
                if (restored) return location.replace(page('?restored=1'));
                desktop();
            });
        }
        // a profile that is a My PC account: bring its progress from the other TV or phone first (not when a game closes)
        var cur = Profiles.current().id;
        if (!param('from') && !param('synced') && Accounts.signedIn(cur)) {
            return Accounts.pull(cur, 2500, function (changed) {
                if (changed) return location.replace(page('?synced=1'));
                desktop();
            });
        }
        desktop();
    }

    // Back from a game (?from=) the desktop page starts again: the store catalog, the AI services and the settings of every
    // My PC were read minutes ago. Read them again only every 30 min (and always at a real start): 3 Firestore reads and the
    // network less at every Quit (owner: quick and light app switches).
    var SYNC_EVERY = 30 * 60 * 1000;
    function syncDue(name) {
        var k = 'arc_sync_' + name, now = Date.now(), at = 0;
        try { at = +sessionStorage.getItem(k) || 0; } catch (e) {}
        if (param('from') && at && now - at < SYNC_EVERY && now >= at) return false;
        try { sessionStorage.setItem(k, String(now)); } catch (e) {}
        return true;
    }

    function desktop() {
        // the profile's music: back from a game, it plays on where it was (Music app > Settings)
        Music.init({ resume: !!param('from') });
        if (typeof MusicSaver !== 'undefined') MusicSaver.init();
        loadGames(function (games) {
            Desktop.init(games, play);
            ProfilesUI.init(profileChanged);
            Desktop.show();
            // apps installed from the computer: shown from the cache now, updated when Firebase answers
            if (syncDue('apps')) Cloud.refresh(function (err, list, changed) {
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
            Updater.background();                      // built-in copy because the server was slow at start: fetch the update now
            // a profile that asks for its password (Settings > Accounts), or "Use on phone" (?signin=<username>)
            var signin = param('signin');
            if (!ProfilesUI.gate() && signin && Accounts.validName(Accounts.clean(signin))) {
                try { history.replaceState(null, '', page('')); } catch (e0) {}
                setTimeout(function () { ProfilesUI.signIn(Accounts.clean(signin)); }, 300);
            }
            // a TV's pairing QR code was scanned with the phone camera: straight to the Game controller, connecting
            var pair = param('pair');
            if (pair && /^[a-z0-9]{6,16}$/i.test(pair)) {
                try { history.replaceState(null, '', page('')); } catch (e) {}
                setTimeout(function () { Win.open('gamepad', { pair: pair.toLowerCase() }); }, 300);
            } else if (param('ctrl') === '1') {                   // the Android controller app (android-controller/) opens on it
                setTimeout(function () { Win.open('gamepad'); }, 300);
            }
            ShareRx.resume();                                    // Receiver was on before a game / app page in this session
            // a share from Android's share menu (the My PC app): its Send to TV screen
            // a TV's Receiver QR code (or link) opened on a phone: Send to TV adds that TV for sending over the internet
            var sendto = param('sendto');
            if (sendto && /^[2-9A-HJ-NP-Z]{10}$/i.test(sendto)) {
                try { history.replaceState(null, '', page('')); } catch (e3) {}
                setTimeout(function () { Win.open('sendtv', { add: sendto }); }, 300);
            } else if (window.ShareOut && (param('share') === '1' || ShareOut.pending())) {
                try { history.replaceState(null, '', page('')); } catch (e2) {}
                setTimeout(function () { Win.open('sendtv'); }, 300);
            }
            if (!ProfilesUI.screenOpen()) Shortcuts.resume();         // a shortcut pressed in a game that asked to open something here
            Backup.start();
            Accounts.start();
            Push.start();                                        // push notifications of a signed-in player account (js/launcher/push.js)
            CalRemind.start();                                   // the profile's calendar reminders (js/launcher/cal-remind.js)
            CopyJobs.init();                                     // copies Google Drive <-> USB started earlier go on (js/core/copy-jobs.js)
            World.flush();
            if (syncDue('ai')) Bridges.syncAi();                 // the AI services set in the App Store Manager
            GDrive.syncSoon();                                   // the Google client of every My PC (settings/google), twice a day at most
            if (syncDue('global')) GlobalSettings.sync(function (e, changed) { if (changed) Desktop.paintWallpaper(); });   // its Settings (backgrounds, events)
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

    return { start: start, confirm: confirm, toast: toast, refresh: refresh, exitApp: exitApp, screenSize: screenSize, dialogOpen: function () { return dialogOpen; } };
})();

App.start();
