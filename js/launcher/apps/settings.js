/* Control Panel (was Settings; Windows 11 style). It opens on a grid of categories; a category shows the pages on the
 * left and its rows on the right.
 * Remote: up/down moves, left/right changes a value (or goes back to the page list), OK picks,
 * Back goes from a row to the page list, then to the grid, then closes.
 * Roles (js/core/storage.js): the rows that change the whole TV are for an administrator; a user sees them as
 * "Administrator only". Accounts > Other users (administrators): roles, add and remove users. */
(function () {
    'use strict';

    var GFX = ['auto', 'low', 'mid', 'high'];
    var GFX_KEYS = { auto: 'gfxAuto', low: 'gfxLow', mid: 'gfxMid', high: 'gfxHigh' };
    var PAGES = [
        { id: 'system', icon: 'system', label: 'sysSystem' },
        { id: 'display', icon: 'rotate', label: 'sysDisplay' },          // phones and tablets only (removed below on a TV)
        { id: 'personal', icon: 'brush', label: 'sysPersonal' },
        { id: 'widgets', icon: 'widgets', label: 'sysWidgets' },
        { id: 'apps', icon: 'folder', label: 'sysApps' },
        { id: 'accounts', icon: 'accounts', label: 'sysAccounts' },
        { id: 'drive', icon: 'drive', label: 'sysDrive' },
        { id: 'sound', icon: 'sound', label: 'sysSound' },
        { id: 'devices', icon: 'gamepad', label: 'sysDevices' },
        { id: 'shortcuts', icon: 'remote', label: 'sysShortcuts' },
        { id: 'time', icon: 'clock', label: 'sysTime' },
        { id: 'gaming', icon: 'controller', label: 'sysGaming' },
        { id: 'ai', icon: 'globe', label: 'sysAi' },
        { id: 'privacy', icon: 'shield', label: 'sysPrivacy' },
        { id: 'notifications', icon: 'bell', label: 'sysNotifs' },
        { id: 'about', icon: 'info', label: 'about' },
        { id: 'update', icon: 'reload', label: 'sysUpdate' }
    ];

    if (!window.Rotation || !Rotation.phone()) PAGES = PAGES.filter(function (p) { return p.id !== 'display'; });
    Shortcuts.setPages(PAGES);

    var body, nav, main, home, page = null, rows = [], userId = null;

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }
    function t(k) { return I18n.t(k); }

    function rowsFor(id) {
        var out = [], i, lines;
        if (sub === 'phonectrl' && id === 'devices') { phoneRows(out); return out; }
        if (sub === 'motionmoves' && id === 'devices') { movesRows(out); return out; }
        if (id === 'ai') { aiRows(out); return out; }
        if (id === 'widgets') { if (sub === 'widget') widgetRows(out); else widgetsRows(out); return out; }
        if (id === 'notifications') { notifRows(out); return out; }
        if (id === 'drive') { driveRows(out); return out; }
        if (id === 'shortcuts') { scRows(out); return out; }
        if (sub === 'users' && id === 'accounts') { usersRows(out); return out; }
        if (sub === 'user' && id === 'accounts') { userRows(out); return out; }
        if (sub === 'padtest' && id === 'devices') {
            var pl = Input.pads();
            if (pl.length) out.push({ kind: 'padtest', pad: pl[0].index }); else out.push({ kind: 'text', value: t('devNoPad') });
            out.push({ kind: 'action', label: t('back'), primary: true, run: function () { leaveSub(); } });
            return out;
        }
        if (id === 'system') {
            out.push({ kind: 'select', label: t('graphics'), desc: t('graphicsDesc'), value: function () { return t(GFX_KEYS[Perf.setting()]); },
                       adjust: function (d) { var i2 = (GFX.indexOf(Perf.setting()) + d + GFX.length) % GFX.length; Perf.setSetting(GFX[i2]); } });
            out.push({ kind: 'info', label: t('device'), value: Perf.describe() });
            out.push({ kind: 'info', label: t('network'), value: t(navigator.onLine === false ? 'netOffShort' : 'netOnShort') });
            out.push({ kind: 'info', label: t('storage'), value: storageText() });
        } else if (id === 'display') {
            displayRows(out);
        } else if (id === 'personal') {
            out.push({ kind: 'themes', label: t('theme'), desc: t('themeDesc') });
            out.push({ kind: 'wallpapers', label: t('background'), live: false });
            // live backgrounds (js/launcher/dynwall.js, js/core/events.js), owner request 2026-11-05: their own section; the one in use
            // shows what it does and only its own options (per profile)
            out.push({ kind: 'wallpapers', label: t('dwLiveBg'), live: true });
            var cw = Desktop.wallpaper();
            if (window.DynWall && DynWall.is(cw)) {
                out.push({ kind: 'text', value: t('wp_' + cw) + ': ' + t('dwAbout_' + cw) });
                if (cw === 'dyn_astro') {
                    out.push({ kind: 'toggle', label: t('dwCaptionAstro'), get: function () { return DynWall.prefs().caption; }, set: function (v) { DynWall.setPref('caption', v); } });
                } else {
                    // Horizon: weather, then holidays, then football (with its rules written out), then the name on screen
                    out.push({ kind: 'toggle', label: t('dwWeatherOn'), desc: t('dwWeatherOnDesc'), get: function () { return DynWall.prefs().weather; }, set: function (v) { DynWall.setPref('weather', v); } });
                    out.push({ kind: 'action', label: t('dwWeatherPlace'), desc: wxPlaceText(), run: function () { showPage('widgets'); sub = 'widget'; widgetId = 'weather'; var f = renderMain(1); if (f) Focus.focus(f); } });   // Control Panel > Widgets > Weather
                    out.push({ kind: 'toggle', label: t('dwMotion'), desc: t('dwMotionDesc'), get: function () { return DynWall.prefs().motion; }, set: function (v) { DynWall.setPref('motion', v); } });
                    out.push({ kind: 'select', label: t('dwCountry'), value: function () { return t('cc_' + Events.prefs().country); },
                               adjust: function (d) { var l = Events.COUNTRIES, i2 = (l.indexOf(Events.prefs().country) + d + l.length) % l.length; Events.setPrefs({ country: l[i2] }); DynWall.refresh(); } });
                    out.push({ kind: 'toggle', label: t('dwFootball'), desc: t('dwFootballDesc'), get: function () { return Events.prefs().football; }, set: function (v) { Events.setPrefs({ football: v }); DynWall.refresh(); } });
                    out.push({ kind: 'text', value: t('dwFootballRules') });
                    out.push({ kind: 'toggle', label: t('dwCaption'), get: function () { return DynWall.prefs().caption; }, set: function (v) { DynWall.setPref('caption', v); } });
                }
            }
        } else if (id === 'apps') {
            var inst = Desktop.installed();
            out.push({ kind: 'text', value: t('installHint') });
            out.push({ kind: 'action', label: t('openStore'), primary: true, run: function () { Win.open('store'); } });
            out.push({ kind: 'action', label: t('refreshApps'), run: function () {
                Cloud.refresh(function (err, list) {
                    if (!err) Desktop.setInstalled(list);
                    App.toast(t(err ? 'appsOffline' : 'appsRefreshed'));
                    if (Win.current() === 'settings') { var f = renderMain(1); if (f) Focus.focus(f); }
                });
            } });
            if (!inst.length) out.push({ kind: 'info', label: t('installedApps'), value: t('noApps') });
            for (i = 0; i < inst.length; i++) {
                (function (g) {
                    out.push({ kind: 'action', label: I18n.pick(g.manifest.title), desc: g.url, run: function () { Desktop.play(g); } });
                })(inst[i]);
            }
        } else if (id === 'accounts') {
            out.push({ kind: 'profile' });
            out.push({ kind: 'select', label: t('theme'), value: function () { return t('th_' + Themes.current()); }, adjust: function (d) {
                var l = Themes.LIST, k = 0;
                for (var j = 0; j < l.length; j++) if (l[j].id === Themes.current()) k = j;
                Themes.set(l[(k + d + l.length) % l.length].id);
            } });
            accountRows(out);
            out.push({ kind: 'action', label: t('profilePicture'), desc: t('pictureHint'), run: function () { ProfilesUI.openPicker(true); } });
            out.push({ kind: 'action', label: t('manageProfiles'), desc: t('profilesHint'), run: function () { ProfilesUI.open(); } });
            out.push({ kind: 'info', label: t('yourRole'), value: t(Profiles.isAdmin() ? 'roleAdmin' : 'roleUser'), desc: t('roleDesc') });
            if (Profiles.isAdmin()) {
                out.push({ kind: 'action', label: t('otherUsers'), desc: t('otherUsersDesc'), run: function () { sub = 'users'; var f = renderMain(1); if (f) Focus.focus(f); } });
                if (!Profiles.current().user) out.push({ kind: 'text', value: t('adminNoPw') });
            }
        } else if (id === 'sound') {
            out.push({ kind: 'slider', label: t('musicVol'), value: function () { return AudioPrefs.music(); }, adjust: function (d) { AudioPrefs.setMusic(AudioPrefs.music() + d); } });
            out.push({ kind: 'slider', label: t('sfxVol'), value: function () { return AudioPrefs.sfx(); }, adjust: function (d) { AudioPrefs.setSfx(AudioPrefs.sfx() + d); } });
            out.push({ kind: 'select', label: t('ntSound'), desc: t('ntSoundDesc'), value: function () { return t('nts_' + AudioPrefs.notifySound()); }, adjust: function (d) {
                var l = AudioPrefs.NOTIFY_SOUNDS, k = (l.indexOf(AudioPrefs.notifySound()) + d + l.length) % l.length;
                AudioPrefs.setNotifySound(l[k]);                       // plays it, so the user hears the choice
            } });
        } else if (id === 'time') {
            out.push({ kind: 'select', label: t('language'), value: function () { return I18n.NAMES[I18n.lang()]; }, adjust: function (d) {
                var l = I18n.LANGS, k = (l.indexOf(I18n.lang()) + d + l.length) % l.length;
                I18n.setLang(l[k]); App.refresh(); Win.setTitle(t('settings')); renderNav();
            } });
            out.push({ kind: 'toggle', label: t('clock24'), get: function () { return Store.get('clock24', I18n.lang() !== 'en'); }, set: function (v) { Store.set('clock24', v); } });
            // the time zone: Automatic = the TV's own clock (js/core/clock.js); a fixed UTC offset only if that is still wrong.
            // Left / right walk the offsets; the automatic one is shown as Automatic.
            if (window.Clock) admin(out, { kind: 'select', label: t('tzLabel'), desc: t('tzDesc'), value: function () {
                var m = Clock.manual();
                return m === null ? t('tzAuto') + ' (' + utcText(Clock.auto()) + ')' : utcText(m);
            }, adjust: function (d) {
                var m = Clock.manual(), a = Clock.auto(), v = (m === null ? a : m) + d * 60;
                if (v > 14 * 60) v = -12 * 60; else if (v < -12 * 60) v = 14 * 60;
                Clock.setManual(v === a ? null : v);
                Desktop.tick();
            } });
            var now = new Date();
            out.push({ kind: 'info', label: t('dateTime'), value: Desktop.timeText(now) + ', ' + Desktop.dateText(now, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) });
        } else if (id === 'gaming') {
            lines = t('controlsText');
            for (i = 0; i < lines.length; i++) out.push({ kind: 'text', value: lines[i] });
            out.push({ kind: 'action', label: t('resetProgress'), desc: t('resetText'), danger: true, run: function () {
                App.confirm(t('resetTitle'), t('resetText'), function () { Store.clearPrefix('game_'); App.toast(t('resetDone')); });
            } });
        } else if (id === 'privacy') {
            admin(out, { kind: 'toggle', label: t('cloudBackup'), desc: t('cloudBackupDesc'), get: function () { return Backup.on(); }, set: function (v) { Backup.setOn(v); } });
            admin(out, { kind: 'toggle', label: t('worldShare'), desc: t('worldShareDesc'), get: function () { return World.on(); }, set: function (v) { World.setOn(v); } });
            admin(out, { kind: 'toggle', label: t('errReports'), desc: t('errReportsDesc'), get: function () { return Reports.on(); }, set: function (v) { Reports.setOn(v); } });
            admin(out, { kind: 'action', label: t('deleteBackup'), danger: true, run: function () {
                App.confirm(t('deleteBackup') + '?', t('cloudBackupDesc'), function () {
                    Backup.erase(function (err) { App.toast(t(err ? 'cloudFail' : 'deleteBackupDone')); if (Win.current() === 'settings') { var f = renderMain(1); if (f) Focus.focus(f); } });
                });
            } });
            out.push({ kind: 'action', label: t('permReset'), desc: t('permResetDesc'), run: function () { Bridges.reset(); App.toast(t('permResetDone')); } });
            lines = t('privacyText');
            for (i = 0; i < lines.length; i++) out.push({ kind: 'text', value: lines[i] });
        } else if (id === 'devices') {
            devicesRows(out);
        } else if (id === 'update') {
            updateRows(out);
        } else if (id === 'about') {
            out.push({ kind: 'info', label: t('version'), value: AppBoot.version() });
            out.push({ kind: 'info', label: t('build'), value: String(AppBoot.build()) });
            out.push({ kind: 'info', label: t('online'), value: t(AppBoot.source() === 'remote' ? 'onlineYes' : 'onlineNo') });
            out.push({ kind: 'info', label: t('device'), value: Perf.describe() });
        }
        return out;
    }

    // approximate localStorage use of the whole app (UTF-16: 2 bytes per character)
    function storageText() {
        var n = 0;
        try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k.indexOf('arc_') === 0) n += (k.length + (localStorage.getItem(k) || '').length) * 2; } } catch (e) {}
        return Math.max(1, Math.round(n / 1024)) + ' KB';
    }

    function renderNav() {
        nav.innerHTML = '';
        var p = Profiles.current(), card = el('div', 'set-user');
        card.appendChild(ProfilesUI.avatar(p, 'avatar avatar-mid'));
        var tx = el('div', 'set-user-text');
        tx.appendChild(el('div', 'set-user-name', ProfilesUI.nameOf(p)));
        tx.appendChild(el('div', 'set-user-sub', p.user ? '@' + p.user : t('localAccount')));
        card.appendChild(tx);
        nav.appendChild(card);
        for (var i = 0; i < PAGES.length; i++) {
            var pg = PAGES[i], b = el('button', 'set-nav-btn' + (pg.id === page ? ' on' : ''));
            b.setAttribute('data-focus', '');
            b.setAttribute('data-page', pg.id);
            var ic = el('span', 'set-nav-ic'); Icons.put(ic, pg.icon);
            b.appendChild(ic);
            b.appendChild(el('span', '', t(pg.label)));
            b.onclick = (function (id) { return function () { showPage(id); focusFirstRow(); }; })(pg.id);
            b.onfocus = (function (id) { return function () { if (id !== page) showPage(id); }; })(pg.id);
            nav.appendChild(b);
        }
    }

    function navBtn(id) { return nav.querySelector('[data-page="' + (id || page) + '"]'); }

    /* ---------- Update (Windows Update style): the work is done by Updater (js/launcher/updater.js) ---------- */

    function updateRows(out) {
        var u = Updater.state(), inf = Updater.info(), title, detail = '', prog = null;
        if (u.state === 'checking') title = t('updChecking');
        else if (u.state === 'available') { title = t('updAvailable'); detail = t('updNew') + ': v' + u.remote.version + ' (' + t('build') + ' ' + u.remote.build + ')'; }
        else if (u.state === 'downloading') { title = t('updDownloading'); detail = u.done + ' / ' + u.total; prog = u.total ? u.done / u.total : 0; }
        else if (u.state === 'ready') title = t('updReady');
        else if (u.state === 'uptodate') title = t('updUpToDate');
        else if (u.state === 'error') title = t(u.error === 'shell' ? 'updNeedsPackage' : u.error === 'download' ? 'updDownloadFailed' : 'updCheckFailed');
        else title = t('updCheck');
        out.push({ kind: 'status', title: title, detail: detail, progress: prog, busy: u.state === 'checking' || u.state === 'downloading' });

        if (u.state === 'ready') out.push({ kind: 'action', label: t('updRestart'), primary: true, run: function () { Updater.restart(); } });
        else if (u.state === 'available' || (u.state === 'error' && u.error === 'download' && u.remote)) out.push({ kind: 'action', label: t('updInstall'), primary: true, run: function () { Updater.install(); } });
        if (u.state !== 'checking' && u.state !== 'downloading' && u.state !== 'ready') out.push({ kind: 'action', label: t('updCheck'), run: function () { Updater.check(); } });

        out.push({ kind: 'info', label: t('version'), value: inf.version });
        out.push({ kind: 'info', label: t('build'), value: String(inf.build) });
        out.push({ kind: 'info', label: t('updRunning'), value: t(inf.source === 'remote' ? 'updRunOnline' : 'updRunBuiltIn') });
        var last = Updater.lastChecked();
        out.push({ kind: 'info', label: t('updLast'), value: last ? Desktop.dateText(new Date(last), { day: 'numeric', month: 'short' }) + ' ' + Desktop.timeText(new Date(last)) : t('updNever') });
        var why = { stale: 'updWhyStale', unreachable: 'updWhyUnreachable', bad: 'updWhyBad', forced: 'updWhyForced' }[inf.reason];
        if (why) out.push({ kind: 'info', label: t('updWhy'), value: t(why) });
        // what made the last online build give up on this TV (package 1.6.1+)
        var lf = (inf.reason === 'bad' || inf.reason === 'forced') && AppBoot.lastFail ? AppBoot.lastFail() : null;
        if (lf && lf.why) out.push({ kind: 'info', label: t('updFailWhy'), value: t('build') + ' ' + lf.b + ': ' + lf.why });
        if (!inf.smart) out.push({ kind: 'text', value: t('updOldPackage') });
    }

    /* ---------- Notifications (js/launcher/push.js): the last ones received, and which apps may send them ---------- */

    // the list changes after a check, a read or a switch (async): redraw it if it is still on screen
    function notifRedraw() { setTimeout(function () { if (Win.current() === 'settings' && page === 'notifications' && main) rerender(); }, 0); }
    function notifRows(out) {
        var p = Profiles.current(), list = Push.list(), i;
        if (!p.user) { out.push({ kind: 'text', value: t('notifNoAccount') }); return; }
        out.push({ kind: 'action', label: t('notifCheck'), primary: true, run: function () {
            Push.check(function (e, n) { App.toast(e ? t('notifOffline') : n ? t('notifNew').replace('%s', n) : t('notifChecked'), { kind: e ? 'err' : 'info' }); notifRedraw(); });
        } });
        // History (Push keeps 7 days on this device), one heading per day, newest first
        out.push({ kind: 'text', value: t('notifHistory') });
        if (!list.length) out.push({ kind: 'info', label: t('notifs'), value: t('notifNone') });
        var day0 = new Date(); day0.setHours(0, 0, 0, 0);
        var lastDay = null;
        for (i = 0; i < list.length; i++) {
            (function (it) {
                var when = new Date(it.at), d = new Date(it.at); d.setHours(0, 0, 0, 0);
                if (d.getTime() !== lastDay) {
                    lastDay = d.getTime();
                    var ago = Math.round((day0 - d) / 86400000);
                    out.push({ kind: 'text', value: ago <= 0 ? t('notifToday') : ago === 1 ? t('notifYesterday') : Desktop.dateText(when, { weekday: 'long', day: 'numeric', month: 'long' }) });
                }
                out.push({ kind: 'action', label: (it.read ? '' : '\u25CF ') + it.title,
                           desc: [it.name, it.text, Desktop.timeText(when)].filter(Boolean).join(' \u00B7 ') + (it.read ? '' : ' \u00B7 ' + t('notifUnread')),
                           run: function () { Push.open(it); notifRedraw(); } });
            })(list[i]);
        }
        if (list.length) out.push({ kind: 'action', label: t('notifClear'), danger: true, run: function () { Push.clear(); App.toast(t('notifCleared')); notifRedraw(); } });
        out.push({ kind: 'text', value: t('notifApps') });
        var apps = Cloud.apps().filter(function (a) { return a.services && a.services.length; });
        if (!apps.length) out.push({ kind: 'text', value: t('notifAppsNone') });
        for (i = 0; i < apps.length; i++) {
            (function (a) {
                out.push({ kind: 'toggle', label: a.name, get: function () { return Push.state(a.id) === 'granted'; },
                           set: function (v) { Push.set(a.id, v, function (e) { if (e) App.toast(t('notifFailed'), { kind: 'err' }); notifRedraw(); }); } });
            })(apps[i]);
        }
    }

    /* ---------- Devices: what is connected, and a live test of the controller buttons ---------- */

    var PAD_BUTTONS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', '\u29C9', '\u2630', 'L3', 'R3', '\u25B2', '\u25BC', '\u25C0', '\u25B6', '\u24D6'];
    var sub = null;                 // 'padtest': the controller test page (opened by its button, Back returns)
    var padRaf = 0, padCard = null, padIdx = 0, padMask = '';

    function devicesRows(out) {
        var seen = Input.seen(), pads = Input.pads(), i;
        if (seen.remote) out.push({ kind: 'info', label: t('devRemote'), value: t('devDetected') });
        out.push({ kind: 'info', label: t('devKeyboard'), value: seen.keyboard ? t('devDetected') : t('devPressKey') });
        out.push({ kind: 'info', label: t('devMouse'), value: seen.mouse ? t('devDetected') : t('devMoveMouse') });
        if (!pads.length) out.push({ kind: 'info', label: t('devControllers'), value: t('devNoPad') });
        for (i = 0; i < pads.length; i++) out.push({ kind: 'info', label: t('devController') + ' ' + (i + 1), value: pads[i].name + (pads[i].standard ? '' : ' \u00B7 ' + t('devGeneric')) });
        out.push({ kind: 'action', label: t('devTestOpen'), desc: pads.length ? t('devTest') : t('devNoPad'), run: function () { sub = 'padtest'; var f = renderMain(0); if (f) Focus.focus(f); } });
        out.push({ kind: 'text', value: t('devMapHelp') });
        // this phone itself (js/core/haptics.js): the same settings as the Game controller's (screen rotation: Display)
        if (Haptics.phone()) {
            out.push({ kind: 'slider', label: t('gcVib'), desc: t('gcVibDesc'), max: Haptics.MAX, value: function () { return Haptics.level(); }, adjust: function (d) { Haptics.set('vib', Haptics.level() + d); } });
        }
        var pl0 = Controllers.players();
        out.push({ kind: 'action', label: t('ctrlTitle'), desc: !Controllers.on() ? t('ctrlOff') : (pl0[1] || pl0[2]) ? [pl0[1], pl0[2]].filter(Boolean).join(', ') : t('ctrlScanDesc'),
                   run: function () { sub = 'phonectrl'; if (Controllers.on()) Controllers.pair(); var f = renderMain(1); if (f) Focus.focus(f); } });
    }

    /* ---------- Display (phones and tablets): screen rotation, js/core/rotation.js (also in the Game controller's settings) ---------- */
    var ROT_KEYS = { auto: 'rotAuto', portrait: 'rotPortrait', landscape: 'rotLandscape', manual: 'rotManual' };
    function displayRows(out) {
        var M = Rotation.MODES;
        out.push({ kind: 'select', label: t('rotTitle'), desc: t('rotDesc'), value: function () { return t(ROT_KEYS[Rotation.mode()]); },
                   adjust: function (d) { Rotation.set(M[(M.indexOf(Rotation.mode()) + d + M.length) % M.length]); refreshDisplay(); } });
        out.push({ kind: 'text', value: t(ROT_KEYS[Rotation.mode()] + 'Desc') });
        if (Rotation.mode() === 'manual') out.push({ kind: 'action', label: t('rotNow'), primary: true, run: function () { if (!Rotation.turn()) App.toast(t('rotUpdate')); } });
        if (!Rotation.canPortrait()) out.push({ kind: 'text', value: t('rotUpdate') });
    }
    // the rows below the choice change with it (the focus stays on the choice)
    function refreshDisplay() { setTimeout(function () { if (Win.current() === 'settings' && page === 'display') { var f = renderMain(0); if (f) Focus.focus(f); } }, 0); }

    // Phones as player 1 / 2 (js/launcher/controllers.js): their own page, with the pairing QR code
    function phoneRows(out) {
        var pl = Controllers.players(), n;
        out.push({ kind: 'action', label: t('back'), run: function () { leaveSub(); } });
        out.push({ kind: 'toggle', label: t('ctrlTitle'), desc: t('ctrlDesc'), get: function () { return Controllers.on(); }, set: function (v) { Controllers.setOn(v); } });
        if (!Controllers.on()) return;
        var st = Controllers.status();
        out.push({ kind: 'qr', url: Controllers.pairUrl(), code: Controllers.code().toUpperCase() });
        out.push({ kind: 'info', label: t('ctrlStatus'), value: st.s === 'ready' ? t('ctrlReady') : st.s === 'error' ? t(st.err === 'offline' ? 'ctrlErr_offline' : st.err === 'denied' ? 'ctrlErr_denied' : 'ctrlErr_other') + ' (' + st.err + ')' : t('ctrlOpening') });
        for (n = 1; n <= 2; n++) out.push({ kind: 'info', label: t('ctrlPlayer') + ' ' + n, value: pl[n] || t('ctrlFree') });
        out.push({ kind: 'action', label: t('ctrlPair'), desc: t('ctrlPairDesc'), run: function () { Controllers.pair(); App.toast(t('ctrlPairing')); } });
        out.push({ kind: 'action', label: t('ctrlNew'), run: function () { Controllers.newCode(); var f = renderMain(1); if (f) Focus.focus(f); } });
        out.push({ kind: 'action', label: t('ctrlMoves'), desc: t('ctrlMovesDesc'), run: function () { sub = 'motionmoves'; var f = renderMain(1); if (f) Focus.focus(f); } });
        out.push({ kind: 'action', label: t('ctrlForget'), danger: true, run: function () { Controllers.forget(); App.toast(t('ctrlForgot')); } });
    }

    // Motion moves (phones in "Motion moves" mode): how strong each move must be, harder while running, the repeat guard.
    // Saved on this TV and sent to the phones at once (Controllers.setTune). The live test below shows what the phones
    // detect, with the gait, so a move that fires by itself (a JUMP while running) can be tuned away; meanwhile the moves
    // do not press buttons here.
    var monLog = [], monEl = null;
    function movesRows(out) {
        var L = SensorProto.TUNE_LIM;
        Controllers.monitor(onMove);
        function set(fn) { var x = Controllers.tune(); fn(x); Controllers.setTune(x); }
        function step(v, d, lim, k) { return Math.max(lim[0], Math.min(lim[1], Math.round((v + d * k) * 100) / 100)); }
        function times(v) { return v.toFixed(1) + '\u00D7'; }
        out.push({ kind: 'action', label: t('back'), run: function () { leaveSub(); } });
        out.push({ kind: 'text', value: t('mvHelp') });
        out.push({ kind: 'select', label: t('mvSens'), desc: t('mvSensDesc'), value: function () { return times(Controllers.tune().sensitivity); },
                   adjust: function (d) { set(function (x) { x.sensitivity = step(x.sensitivity, d, L.sensitivity, 0.1); }); } });
        [['mvSide', ['LEFT', 'RIGHT']], ['mvJump', ['JUMP']], ['mvDuck', ['DUCK']]].forEach(function (m) {
            out.push({ kind: 'select', label: t(m[0]), desc: t('mvLimitDesc'), value: function () { return times(Controllers.tune().scales[m[1][0]]); },
                       adjust: function (d) { set(function (x) { m[1].forEach(function (k) { x.scales[k] = step(x.scales[k], d, L.scale, 0.1); }); }); } });
        });
        out.push({ kind: 'select', label: t('mvRun'), desc: t('mvRunDesc'), value: function () { return times(Controllers.tune().run_scale); },
                   adjust: function (d) { set(function (x) { x.run_scale = step(x.run_scale, d, L.run_scale, 0.1); }); } });
        out.push({ kind: 'select', label: t('mvGuard'), desc: t('mvGuardDesc'), value: function () { return Controllers.tune().guard_ms + ' ms'; },
                   adjust: function (d) { set(function (x) { x.guard_ms = step(x.guard_ms, d, L.guard_ms, 100); }); } });
        out.push({ kind: 'motionlog' });
        out.push({ kind: 'action', label: t('mvReset'), run: function () { Controllers.setTune(null); var c = Focus.current(), idx = c ? c.getAttribute('data-row') : null; var f = renderMain(idx === null ? 1 : +idx); if (f) Focus.focus(f); App.toast(t('mvReset')); } });
    }
    function onMove(p, m) {
        if (!m || m.type !== 'action') return;
        var d = new Date();
        monLog.unshift({ p: p, a: m.action, c: m.confidence, g: m.gait || '', at: ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2), t: Date.now() });
        if (monLog.length > 8) monLog.pop();
        paintMoves();
        A11y.announce(m.action);
    }
    function moveTip() {
        var a = monLog[0], b = monLog[1];
        if (!a) return '';
        if (a.a === 'JUMP' && a.g === 'RUN') return t('mvTipJumpRun');
        if (b && a.a !== b.a && /^(LEFT|RIGHT)$/.test(a.a) && /^(LEFT|RIGHT)$/.test(b.a) && a.t - b.t < 1200) return t('mvTipSide');
        return '';
    }
    function paintMoves() {
        if (!monEl || !monEl.parentNode) return;
        var list = monEl.querySelector('.set-mv-list'), tip = monEl.querySelector('.set-mv-tip'), i;
        list.innerHTML = '';
        if (!monLog.length) list.appendChild(el('div', 'set-row-desc', t('mvNone')));
        for (i = 0; i < monLog.length; i++) {
            var x = monLog[i], line = el('div', 'set-mv' + (i === 0 ? ' new' : ''));
            line.appendChild(el('span', 'set-mv-a', x.a));
            line.appendChild(el('span', 'set-row-desc', 'P' + x.p + (x.c !== undefined ? ' \u00B7 ' + Math.round(x.c * 100) + '%' : '') + (x.g ? ' \u00B7 ' + t('gait' + x.g) : '') + ' \u00B7 ' + x.at));
            list.appendChild(line);
        }
        tip.textContent = moveTip();
    }
    function motionCard() {
        var c = el('div', 'set-padtest set-mvlog');
        c.setAttribute('role', 'status'); c.setAttribute('aria-live', 'polite');
        c.appendChild(el('div', 'set-row-name', t('mvTest')));
        c.appendChild(el('div', 'set-row-desc', t('mvTestHelp')));
        c.appendChild(el('div', 'set-mv-tip'));
        c.appendChild(el('div', 'set-mv-list'));
        monEl = c;
        setTimeout(paintMoves, 0);
        return c;
    }

    // My PC account of the active profile (js/core/accounts.js): make one, password, sign-in on a phone
    function accountRows(out) {
        var p = Profiles.current(), id = p.id;
        function again() { if (Win.current() === 'settings' && page === 'accounts') { var f = renderMain(1); if (f) Focus.focus(f); } }
        if (!p.user) {
            out.push({ kind: 'action', primary: true, label: t('makeAccount'), desc: t('makeAccountDesc'), run: function () { ProfilesUI.newAccount(id, again); } });
            return;
        }
        if (!Accounts.signedIn(id)) {
            out.push({ kind: 'action', primary: true, label: t('signInAgain'), desc: t('signInAgainDesc'), run: function () {
                ProfilesUI.askPassword(id, function () { App.toast(t('acctSignedIn')); Accounts.pull(id, 5000, function (changed) { if (changed) Welcome.switchUser(id, true); else again(); }); });
            } });
        }
        out.push({ kind: 'toggle', label: t('askPw'), desc: t('askPwDesc'), get: function () { return Accounts.asks(id); }, set: function (v) { Profiles.setAsk(id, v); if (v) Accounts.unlock(id); } });
        out.push({ kind: 'action', label: t('changePw'), run: function () { ProfilesUI.changePassword(id, again); } });
        out.push({ kind: 'qr', url: Controllers.pairUrl().replace(/\?.*$/, '?signin=' + encodeURIComponent(p.user)), code: p.user,
            title: t('usePhone'), help: t('usePhoneHelp'), codeLabel: t('username') });
    }

    /* ---------- Google Drive (js/core/gdrive.js): ONE sign-in per profile, used by Music and by every app (MyPC.drive) ---------- */
    function driveAgain(idx) { setTimeout(function () { if (Win.current() === 'settings' && page === 'drive' && main) { var f = renderMain(idx === undefined ? 1 : idx); if (f && idx !== -1) Focus.focus(f); } }, 0); }
    function driveRows(out) {
        if (!GDrive.config()) {
            out.push({ kind: 'text', value: t('gdNoConfig') });
            out.push({ kind: 'action', label: t('aiCheck'), run: function () { App.toast(t('aiChecking')); GDrive.syncConfig(function () { driveAgain(0); }); } });
            return;
        }
        var list = GDrive.accounts(), act = GDrive.active(), i;
        out.push({ kind: 'status', title: act && !act.needsReauth ? t('gdAs').replace('%s', act.email) : act ? t('gdReauth').replace('%s', act.email) : t('gdNone'),
                   detail: act && !act.needsReauth ? t('gdAsDesc') : t('gdNoneDesc') });
        if (!act || act.needsReauth) out.push({ kind: 'action', primary: true, label: t('gdSignIn'), desc: t('gdSignInDesc'), run: function () { DriveUI.signIn(function () { driveAgain(); }); } });
        if (list.length > 1 || (act && act.needsReauth)) {
            for (i = 0; i < list.length; i++) {
                (function (a) {
                    out.push({ kind: 'action', label: a.email + (act && a.id === act.id ? '  \u2713' : ''), desc: a.needsReauth ? t('gdNeedsSignIn') : (act && a.id === act.id ? t('gdInUse') : t('gdUseThis')),
                               run: function () { if (a.needsReauth) return DriveUI.signIn(function () { driveAgain(); }); GDrive.use(a.id); App.toast(t('gdAs').replace('%s', a.email), { id: 'gdrive', kind: 'ok' }); driveAgain(); } });
                })(list[i]);
            }
        }
        if (act && act.limited) out.push({ kind: 'action', primary: true, label: t('gdLimited'), desc: t('gdLimitedDesc'), run: function () { DriveUI.signIn(function () { driveAgain(); }); } });
        if (act && !act.needsReauth) {
            if (GDrive.pickerUrl() && !act.full) out.push({ kind: 'action', primary: true, label: t('gdAddTitle'), desc: t('gdAddDesc'), run: function () { DriveUI.addFiles(); } });
            out.push({ kind: 'action', label: t('gdAnother'), desc: t('gdAnotherDesc'), run: function () { DriveUI.signIn(function () { driveAgain(); }); } });
        }
        // the apps this profile allowed (MyPC.drive asks once per app)
        var ok = Store.get('drive_apps', null) || {}, ids = Object.keys(ok), apps = Cloud.apps();
        if (ids.length) out.push({ kind: 'text', value: t('gdApps') });
        ids.forEach(function (id) {
            var name = id;
            for (var j = 0; j < apps.length; j++) if (apps[j].id === id) name = apps[j].name || id;
            out.push({ kind: 'toggle', label: name, get: function () { return Bridges.allowed(id, 'drive'); }, set: function (v) { if (!v) Bridges.forget(id, 'drive'); } });
        });
        if (act) out.push({ kind: 'action', label: t('gdSignOut').replace('%s', act.email), danger: true, run: function () {
            App.confirm(t('gdSignOut').replace('%s', act.email) + '?', t('gdSignOutText'), function () {
                GDrive.signOut(act.id, function () { App.toast(t('gdSignedOut'), { id: 'gdrive', kind: 'info' }); driveAgain(0); });
            });
        } });
        var lines = t('gdPrivacy');
        if (GDrive.fullAccess() || (act && act.full)) lines = [lines[0], t('gdPrivacyFull')];
        for (i = 0; i < lines.length; i++) out.push({ kind: 'text', value: lines[i] });
    }

    /* ---------- AI (js/core/ai.js): the services apps can use, set for every My PC in the App Store Manager ---------- */
    function keyHint(p) { return p.key ? t('aiKeySet').replace('%s', p.key.slice(-4)) : (p.preset === 'ollama' ? '' : t('aiNoKey')); }
    function aiRows(out) {
        out.push({ kind: 'text', value: t('aiHint') });
        var l = AI.list(), d = AI.defaultId();
        if (!l.length) out.push({ kind: 'text', value: t('aiNoneYet') });
        l.forEach(function (p) {
            var tk = AI.tasks(p), can = ['speech', 'transcribe', 'image', 'video'].filter(function (k) { return tk[k]; }).map(function (k) { return t('aiTask_' + k); });
            out.push({ kind: 'action', label: p.name + (p.id === d ? ' (' + t('aiDefault') + ')' : ''), desc: [p.model, p.preset === 'ollama' ? (p.mode === 'completion' ? '/api/generate' : '/api/chat') : '', keyHint(p)].concat(can).filter(Boolean).join(' · '),
                       run: function () { aiTest(p.id); } });
        });
        out.push({ kind: 'action', label: t('aiCheck'), run: aiSync });
    }
    function aiSync() {
        App.toast(t('aiChecking'));
        Bridges.syncAi(function (e) {
            if (e) App.toast(t('aiCheckFail'));
            if (Win.current() === 'settings' && page === 'ai') { var f = renderMain(AI.list().length + 1); if (f) Focus.focus(f); }
        });
    }
    function aiTest(id) {
        var p = AI.find(id);
        if (!p) return;
        App.toast(t('aiTesting'));
        AI.start({ prompt: 'Reply with the single word OK.', maxTokens: 20, timeout: 30000 }, p, null, { lan: true }).promise.then(function (r) {
            App.toast(t('aiTestOk').replace('%s', (r.text || '').trim().slice(0, 60) || r.model));
        }, function (e) { App.toast(t('aiTestFail').replace('%s', String(e && e.message || e).slice(0, 140))); });
    }

    /* ---------- roles: what only an administrator changes, Other users (js/core/storage.js) ---------- */

    // a row that changes the whole TV: an administrator gets it, a user sees it as "Administrator only"
    function utcText(v) { var a = Math.abs(v); return 'UTC' + (v < 0 ? '\u2212' : '+') + Math.floor(a / 60) + (a % 60 ? ':' + ('0' + a % 60).slice(-2) : ''); }
    function admin(out, r) {
        if (Profiles.isAdmin()) out.push(r);
        else out.push({ kind: 'info', label: r.label, value: t('adminOnlyShort'), desc: r.desc });
    }
    function again(idx) { if (Win.current() === 'settings' && page === 'accounts') { var f = renderMain(idx); if (f) Focus.focus(f); } }

    // Other users: every profile of this TV with its role; OK opens it (role, remove), Add a user
    function usersRows(out) {
        out.push({ kind: 'action', label: t('back'), run: function () { leaveSub(); } });
        out.push({ kind: 'text', value: t('roleDesc') });
        Profiles.list().forEach(function (p) {
            var me = p.id === Profiles.current().id;
            out.push({ kind: 'action', label: ProfilesUI.nameOf(p) + (me ? ' (' + t('active') + ')' : ''),
                       desc: t(p.role === 'admin' ? 'roleAdmin' : 'roleUser') + (p.user ? ' · @' + p.user : ' · ' + t('localAccount')),
                       run: function () { sub = 'user'; userId = p.id; var f = renderMain(1); if (f) Focus.focus(f); } });
        });
        if (Profiles.list().length < Profiles.MAX) out.push({ kind: 'action', primary: true, label: t('addUser'), desc: t('addUserDesc'), run: function () { ProfilesUI.open(); } });
    }
    function userRows(out) {
        var p = Profiles.find(userId);
        out.push({ kind: 'action', label: t('back'), run: function () { leaveSub(); } });
        if (!p || !Profiles.isAdmin()) return;
        out.push({ kind: 'info', label: ProfilesUI.nameOf(p), value: p.user ? '@' + p.user : t('localAccount') });
        out.push({ kind: 'select', label: t('role'), desc: t('roleDesc'), value: function () { return t(Profiles.isAdmin(userId) ? 'roleAdmin' : 'roleUser'); }, adjust: function () {
            var to = Profiles.isAdmin(userId) ? 'user' : 'admin';
            if (!Profiles.setRole(userId, to)) return App.toast(t('lastAdmin'));
            App.toast(t('roleChanged').replace('%s', ProfilesUI.nameOf(p)).replace('%r', t(to === 'admin' ? 'roleAdmin' : 'roleUser')));
            // an administrator who made themself a user: the Control Panel shows what a user may change
            if (userId === Profiles.current().id && to === 'user') { sub = null; setTimeout(function () { var f = renderMain(0); if (f) Focus.focus(f); }, 0); }
        } });
        if (Profiles.canRemove(p.id) && p.id !== Profiles.current().id) {
            out.push({ kind: 'action', label: t('removeUser'), danger: true, run: function () {
                App.confirm(t('removeUser') + '?', t('removeUserText').replace('%s', ProfilesUI.nameOf(p)), function () {
                    var n = ProfilesUI.nameOf(p);
                    Accounts.forget(p.id);
                    Profiles.remove(p.id);
                    App.toast(t('userRemoved').replace('%s', n));
                    sub = 'users'; again(1);
                });
            } });
        }
    }

    /* ---------- Widgets (js/launcher/widgets.js): per profile, the list, then a page per widget ---------- */
    var widgetId = null;
    function everyText(sec) {
        return sec < 60 ? t('wgSec').replace('%n', sec) : sec < 3600 ? t('wgMinN').replace('%n', sec / 60) : t('wgHourN').replace('%n', sec / 3600);
    }
    function widgetDesc(d) {
        var c = Widgets.conf(d.id), p = [t(c.show ? 'on' : 'off'), everyText(c.every)];
        if (c.bg) p.push(t('wgBgShort'));
        if (d.app) p.push(d.approved ? t('wgFrom').replace('%s', d.app.name) : t('wgPending'));
        return p.join(' \u00B7 ');
    }
    function widgetsRows(out) {
        out.push({ kind: 'toggle', label: t('wgShowAll'), desc: t('wgShowAllDesc'), get: function () { return Widgets.on(); }, set: function (v) { Widgets.setOn(v); } });
        out.push({ kind: 'text', value: t('wgHelp') });
        Widgets.list().forEach(function (d) {
            out.push({ kind: 'action', label: d.title(), desc: widgetDesc(d), run: function () { sub = 'widget'; widgetId = d.id; var f = renderMain(1); if (f) Focus.focus(f); } });
        });
        out.push({ kind: 'text', value: t('wgAppsHelp') });
    }
    function widgetRows(out) {
        var d = Widgets.find(widgetId);
        out.push({ kind: 'action', label: t('back'), run: function () { leaveSub(); } });
        if (!d) return;
        var id = d.id;
        if (d.app) {
            out.push({ kind: 'info', label: d.title(), value: d.approved ? t('wgFrom').replace('%s', d.app.name) : t('wgPending'), desc: I18n.pick(d.w.description) || '' });
        }
        out.push({ kind: 'toggle', label: t('wgShow'), desc: t('wgShowDesc'), get: function () { return Widgets.conf(id).show; }, set: function (v) { Widgets.set(id, 'show', v); } });
        out.push({ kind: 'select', label: t('wgEvery'), desc: t('wgEveryDesc'), value: function () { return everyText(Widgets.conf(id).every); }, adjust: function (k) {
            var l = d.choices, i = l.indexOf(Widgets.conf(id).every);
            Widgets.set(id, 'every', l[Math.max(0, Math.min(l.length - 1, i + k))]);
        } });
        out.push({ kind: 'toggle', label: t('wgBg'), desc: t(id === 'music' ? 'wgBgMusic' : 'wgBgDesc'), get: function () { return Widgets.conf(id).bg; }, set: function (v) { Widgets.set(id, 'bg', v); } });
        (d.settings ? d.settings() : []).forEach(function (st) {
            if (st.type === 'toggle') out.push({ kind: 'toggle', label: st.label, get: function () { return !!Widgets.conf(id).s[st.id]; }, set: function (v) { Widgets.setSetting(id, st.id, v); } });
            else if (st.type === 'select') out.push({ kind: 'select', label: st.label, value: function () {
                var v = Widgets.conf(id).s[st.id], o = st.options.filter(function (x) { return x.value === v; })[0];
                return o ? I18n.pick(o.label) : v;
            }, adjust: function (k) {
                var l = st.options, i = 0, v = Widgets.conf(id).s[st.id];
                for (var j = 0; j < l.length; j++) if (l[j].value === v) i = j;
                Widgets.setSetting(id, st.id, l[(i + k + l.length) % l.length].value);
            } });
            else out.push({ kind: 'action', label: st.label, desc: Widgets.conf(id).s[st.id] || (id === 'weather' ? t('wgAuto') : '\u2014'), run: function () {
                var c = Focus.current(), idx = c ? +c.getAttribute('data-row') : 1;
                Keyboard.open({ title: st.label, text: Widgets.conf(id).s[st.id] || '', max: 60, hint: id === 'weather' ? t('wgPlaceHint') : '' }, function (v) {
                    Widgets.setSetting(id, st.id, String(v || '').trim());
                    if (Win.current() === 'settings' && sub === 'widget') { var f = renderMain(idx); if (f) Focus.focus(f); }
                });
            } });
        });
        out.push({ kind: 'action', label: t('wgNow'), run: function () { Widgets.refreshNow(id); App.toast(t('wgNowDone').replace('%s', d.title())); } });
        out.push({ kind: 'action', label: t('wgUp'), run: function () { if (Widgets.move(id, -1)) App.toast(t('wgMoved')); } });
        out.push({ kind: 'action', label: t('wgDown'), run: function () { if (Widgets.move(id, 1)) App.toast(t('wgMoved')); } });
        out.push({ kind: 'action', label: t('wgReset'), run: function () {
            Widgets.reset(id);
            var c = Focus.current(), idx = c ? +c.getAttribute('data-row') : 1, f = renderMain(idx);
            if (f) Focus.focus(f);
            App.toast(t('wgResetDone'));
        } });
    }

    /* ---------- Shortcuts (js/launcher/shortcuts.js): this profile's remote buttons -> actions ----------
     * the list, then one shortcut (Button, Action, App or page, Save, Remove); each choice is a list of its own */
    var scIdx = -1, scDraft = null;
    function scGo(to, idx) { sub = to; var f = renderMain(idx === undefined ? 1 : idx); if (f) Focus.focus(f); }
    function scRows(out) {
        if (sub === 'sckey') return scKeyRows(out);
        if (sub === 'scact') return scActRows(out);
        if (sub === 'scarg') return scArgRows(out);
        if (sub === 'shortcut') return scEditRows(out);
        var l = Shortcuts.list();
        out.push({ kind: 'text', value: t('scHelp') });
        l.forEach(function (s, i) {
            out.push({ kind: 'action', label: Shortcuts.buttonName(s.key), desc: Shortcuts.describe(s), run: function () {
                scIdx = i; scDraft = { key: s.key, act: s.act, arg: s.arg, name: s.name }; scGo('shortcut');
            } });
        });
        if (!l.length) out.push({ kind: 'info', label: t('sysShortcuts'), value: t('scNone') });
        out.push({ kind: 'action', label: t('scAdd'), primary: true, run: function () {
            var used = {}, k, free = null;
            l.forEach(function (s) { used[s.key] = 1; });
            for (k = 0; k < Shortcuts.BUTTONS.length && !free; k++) if (!used[Shortcuts.BUTTONS[k].id]) free = Shortcuts.BUTTONS[k].id;
            scIdx = -1; scDraft = { key: free || 'red', act: 'app', arg: null };
            scGo('shortcut');
        } });
        out.push({ kind: 'action', label: t('scReset'), desc: t('scResetDesc'), run: function () {
            App.confirm(t('scReset') + '?', t('scResetDesc'), function () { Shortcuts.reset(); App.toast(t('scResetDone')); scGo(null, 1); });
        } });
    }
    function scEditRows(out) {
        var d = scDraft, a = Shortcuts.action(d.act), cur = Shortcuts.forKey(d.key);
        out.push({ kind: 'action', label: t('back'), run: function () { leaveSub(); } });
        out.push({ kind: 'action', label: t('scButton'), desc: Shortcuts.listening() ? t('scListen') : Shortcuts.buttonName(d.key), run: scListen });
        if (Shortcuts.listening()) out.push({ kind: 'status', title: t('scListen'), detail: t('scListenLeft').replace('%n', scLeft), busy: true });
        out.push({ kind: 'action', label: t('scAction'), desc: a ? t(a.label) : '\u2014', run: function () { scGo('scact', 0); } });
        if (a && a.arg) out.push({ kind: 'action', label: t(a.arg === 'app' ? 'scWhichApp' : 'scWhichPage'),
            desc: d.arg ? Shortcuts.describe(d) : t('scPick'), run: function () { scGo('scarg', 0); } });
        // another shortcut already on this button is replaced when this one is saved
        var l = Shortcuts.list();
        if (cur && !(scIdx >= 0 && l[scIdx] && l[scIdx].key === d.key)) out.push({ kind: 'text', value: t('scReplaces').replace('%s', Shortcuts.describe(cur)) });
        out.push({ kind: 'action', label: t('scList'), desc: t('scListDesc'), run: function () { scGo('sckey', 0); } });
        var b = Shortcuts.button(d.key);
        if (b && b.use) out.push({ kind: 'text', value: t('scUse').replace('%s', t(b.use)) });
        out.push({ kind: 'action', label: t('scSave'), primary: true, run: function () {
            if (a && a.arg && !d.arg) { App.toast(t('scPick')); return scGo('scarg', 0); }
            Shortcuts.put(scIdx, { key: d.key, act: d.act, arg: d.arg, name: d.name });
            App.toast(t('scSaved').replace('%s', Shortcuts.buttonName(d.key)));
            scDraft = null; scGo(null, 1);
        } });
        if (scIdx >= 0) out.push({ kind: 'action', label: t('scRemove'), danger: true, run: function () {
            Shortcuts.remove(scIdx);
            App.toast(t('scRemoved').replace('%s', Shortcuts.buttonName(d.key)));
            scDraft = null; scGo(null, 1);
        } });
    }
    // Button: listen 5 s for the button the user presses on the remote (Back cancels); the list stays for a keyboard / PC
    var scLeft = 5, scTick = 0;
    function scListen() {
        scLeft = 5;
        Shortcuts.listen(function (id, why) {
            clearInterval(scTick); scTick = 0;
            if (!scDraft || Win.current() !== 'settings' || sub !== 'shortcut') return;
            if (id) { scDraft.key = id; A11y.announce(Shortcuts.buttonName(id)); }
            else if (why === 'timeout') App.toast(t('scNoKey'), { id: 'shortcut', kind: 'warn' });
            scGo('shortcut', 1);
        }, 5000);
        scGo('shortcut', 1);
        A11y.announce(t('scListen'));
        scTick = setInterval(function () {
            scLeft = Math.max(0, scLeft - 1);
            var d = main && main.querySelector('.set-status .set-row-desc');
            if (d) d.textContent = t('scListenLeft').replace('%n', scLeft);
        }, 1000);
    }
    // every button of the remote, with what it does now
    function scKeyRows(out) {
        out.push({ kind: 'action', label: t('back'), run: function () { leaveSub(); } });
        Shortcuts.BUTTONS.forEach(function (b) {
            var s = Shortcuts.forKey(b.id);
            out.push({ kind: 'action', label: Shortcuts.buttonName(b.id) + (b.id === scDraft.key ? '  \u2713' : ''),
                desc: s ? Shortcuts.describe(s) : b.use ? t(b.use) : t('scFree'),
                run: function () { scDraft.key = b.id; scGo('shortcut', 1); } });
        });
    }
    function scActRows(out) {
        out.push({ kind: 'action', label: t('back'), run: function () { leaveSub(); } });
        Shortcuts.ACTIONS.forEach(function (a) {
            out.push({ kind: 'action', label: t(a.label) + (a.id === scDraft.act ? '  \u2713' : ''), desc: t(a.label + 'Desc'), run: function () {
                if (scDraft.act !== a.id) { scDraft.arg = null; scDraft.name = null; }
                scDraft.act = a.id;
                if (a.arg && !scDraft.arg) scGo('scarg', 0); else scGo('shortcut', 2);
            } });
        });
    }
    function scArgRows(out) {
        var a = Shortcuts.action(scDraft.act);
        out.push({ kind: 'action', label: t('back'), run: function () { leaveSub(); } });
        var l = a.arg === 'page' ? Shortcuts.pages().filter(function (p) { return p.id !== 'shortcuts'; }).map(function (p) { return { id: p.id, name: t(p.label) }; })
                                 : Shortcuts.targets();
        l.forEach(function (x) {
            out.push({ kind: 'action', label: x.name + (x.id === scDraft.arg ? '  \u2713' : ''), desc: x.game ? t('scGame') : '', run: function () {
                scDraft.arg = x.id; scDraft.name = x.name; scGo('shortcut', 3);
            } });
        });
    }

    function leaveSub() {
        if (sub === 'sckey' || sub === 'scact' || sub === 'scarg') { var i0 = { sckey: 1, scact: 2, scarg: 3 }[sub]; scGo('shortcut', i0); return; }
        if (sub === 'shortcut') { var i1 = scIdx >= 0 ? scIdx + 1 : Shortcuts.list().length + 1; scDraft = null; scGo(null, i1); return; }
        if (sub === 'widget') {
            var at = 0, l = Widgets.list();
            for (var w = 0; w < l.length; w++) if (l[w].id === widgetId) at = w;
            sub = null; widgetId = null;
            var fw = renderMain(2 + at); if (fw) Focus.focus(fw);
            return;
        }
        if (sub === 'user') { sub = 'users'; var f0 = renderMain(1); if (f0) Focus.focus(f0); return; }
        var back = sub === 'motionmoves' ? 'phonectrl' : null;
        if (sub === 'motionmoves') { Controllers.monitor(null); monEl = null; }
        sub = back;
        var f = renderMain(back ? 1 : 0); if (f) Focus.focus(f);
    }
    // the phone controller opens its room in the background: show what happens (status, players) as it changes
    function onCtrl() {
        if (!main || page !== 'devices' || (sub && sub !== 'phonectrl')) return;
        var c = Focus.current(), idx = c && inMain(c) ? c.getAttribute('data-row') : null, f = renderMain(idx === null ? -1 : +idx);
        if (idx !== null && f) Focus.focus(f);
    }
    // the pairing QR code: the phone's camera opens My PC on the Game controller with this TV's code
    function qrCard(r) {
        var card = el('div', 'set-qr'), box = el('div', 'set-qr-img'), txt = el('div', 'set-qr-txt');
        box.innerHTML = QR.svg(r.url, { quiet: 3 });
        var title = r.title || t('ctrlScan'), code = r.codeLabel || t('ctrlCode');
        card.setAttribute('aria-label', title + ' ' + code + ' ' + r.code);
        txt.appendChild(el('div', 'set-row-name', title));
        txt.appendChild(el('div', 'set-row-desc', r.help || t('ctrlScanHelp')));
        txt.appendChild(el('div', 'set-qr-code', code + ': ' + r.code));
        card.appendChild(box); card.appendChild(txt);
        return card;
    }
    function stopPadTest() { if (padRaf) cancelAnimationFrame(padRaf); padRaf = 0; padCard = null; }

    function padTestCard(r) {
        var card = el('div', 'set-padtest'), grid = el('div', 'pt-grid'), i;
        card.setAttribute('aria-label', t('devTest'));
        card.appendChild(el('div', 'set-row-desc', t('devTest')));
        for (i = 0; i < PAD_BUTTONS.length; i++) grid.appendChild(el('span', 'pt-b', PAD_BUTTONS[i]));
        card.appendChild(grid);
        var sticks = el('div', 'pt-sticks');
        for (i = 0; i < 2; i++) { var box = el('span', 'pt-stick'); box.appendChild(el('span', 'pt-dot')); sticks.appendChild(box); }
        card.appendChild(sticks);
        padCard = card; padIdx = r.pad; padMask = '';
        if (!padRaf) padRaf = requestAnimationFrame(tickPad);
        return card;
    }

    function tickPad() {
        padRaf = requestAnimationFrame(tickPad);
        if (!padCard || !navigator.getGamepads) return;
        var list = navigator.getGamepads() || [], p = list[padIdx], i, mask = '';
        if (!p) return;
        for (i = 0; i < PAD_BUTTONS.length; i++) mask += p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.5) ? '1' : '0';
        for (i = 0; i < 4; i++) mask += '|' + Math.round((p.axes[i] || 0) * 10);
        if (mask === padMask) return;               // nothing changed: touch nothing
        padMask = mask;
        var bs = padCard.querySelectorAll('.pt-b'), dots = padCard.querySelectorAll('.pt-dot');
        for (i = 0; i < bs.length; i++) bs[i].className = 'pt-b' + (mask.charAt(i) === '1' ? ' on' : '');
        for (i = 0; i < 2; i++) {
            dots[i].style.left = (50 + (p.axes[i * 2] || 0) * 40) + '%';
            dots[i].style.top = (50 + (p.axes[i * 2 + 1] || 0) * 40) + '%';
        }
    }

    // a controller came or went, or a keyboard / mouse was used: redraw the Devices page
    function onDevices() { if (main && page === 'devices') rerender(); }

    // the Updater changed (progress, result): redraw the page
    function onUpdater() { if (main && page === 'update') rerender(); }

    // redraw the page and keep the focus on the same row
    function rerender() {
        var c = Focus.current(), inRows = !!c && inMain(c) && c.getAttribute('data-row') !== null;
        var idx = inRows ? +c.getAttribute('data-row') : -1, oldKind = rows[idx] && rows[idx].kind;
        var target = renderMain(idx >= 0 ? idx : undefined);
        if (!inRows) return;                       // the focus is on the page list: leave it there
        // same kind of row at that place: keep the focus; otherwise (the button you pressed is gone) the main action
        var same = target && rows[idx] && rows[idx].kind === oldKind;
        Focus.focus(same ? target : (main.querySelector('.set-primary') || main.querySelector('[data-focus]') || navBtn()));
    }

    function showPage(id) {
        page = id; sub = null;
        stopPadTest();
        if (id === 'update') Updater.autoCheck();
        if (id === 'personal' && typeof GlobalSettings !== 'undefined') GlobalSettings.sync(function (e, changed) {
            Desktop.paintWallpaper();
            if (changed && Win.current() === 'settings' && page === 'personal' && !(Focus.current() && inMain(Focus.current()))) renderMain();
        });
        if (id === 'drive' && !GDrive.config()) GDrive.syncConfig(function () { if (Win.current() === 'settings' && page === 'drive' && !(Focus.current() && inMain(Focus.current()))) renderMain(); });
        if (id === 'ai') Bridges.syncAi(function () { if (Win.current() === 'settings' && page === 'ai' && !(Focus.current() && inMain(Focus.current()))) renderMain(); });
        var btns = nav.querySelectorAll('.set-nav-btn');
        for (var i = 0; i < btns.length; i++) btns[i].className = 'set-nav-btn' + (btns[i].getAttribute('data-page') === id ? ' on' : '');
        renderMain();
    }

    function valueText(r) {
        if (r.kind === 'toggle') return t(r.get() ? 'on' : 'off');
        return String(r.value());
    }

    /* ---------- the home grid (like the Windows 11 Control Panel): a card per category ---------- */

    function renderHome() {
        home.innerHTML = '';
        var p = Profiles.current(), card = el('div', 'set-user cp-user');
        card.appendChild(ProfilesUI.avatar(p, 'avatar avatar-mid'));
        var tx = el('div', 'set-user-text');
        tx.appendChild(el('div', 'set-user-name', ProfilesUI.nameOf(p)));
        tx.appendChild(el('div', 'set-user-sub', (p.user ? '@' + p.user + ' · ' : '') + t(Profiles.isAdmin() ? 'roleAdmin' : 'roleUser')));
        card.appendChild(tx);
        home.appendChild(card);
        home.appendChild(el('h3', 'set-title cp-title', t('cpHint')));
        var grid = el('div', 'cp-grid'), first = null;
        for (var i = 0; i < PAGES.length; i++) {
            var pg = PAGES[i], b = el('button', 'cp-tile');
            b.setAttribute('data-focus', '');
            b.setAttribute('data-page', pg.id);
            var ic = el('span', 'cp-ic'); Icons.put(ic, pg.icon);
            b.appendChild(ic);
            var tt = el('span', 'cp-text');
            tt.appendChild(el('span', 'cp-name', t(pg.label)));
            tt.appendChild(el('span', 'cp-desc', t('cpd_' + pg.id)));
            b.appendChild(tt);
            b.setAttribute('aria-label', t(pg.label) + '. ' + t('cpd_' + pg.id));
            b.onclick = (function (id) { return function () { openPage(id); }; })(pg.id);
            grid.appendChild(b);
            if (!first) first = b;
        }
        home.appendChild(grid);
        return first;
    }
    function showHome(focusId) {
        stopPadTest();
        if (sub === 'motionmoves') { Controllers.monitor(null); monEl = null; }
        page = null; sub = null;
        nav.hidden = main.hidden = true;
        home.hidden = false;
        Win.setTitle(t('settings'));
        var f = renderHome(), b = focusId && home.querySelector('[data-page="' + focusId + '"]');
        return b || f;
    }
    function openPage(id) {
        home.hidden = true;
        nav.hidden = main.hidden = false;
        renderNav();
        page = id;
        showPage(id);
        if (!rows.length || !main.querySelector('[data-focus]')) Focus.focus(navBtn());
        else focusFirstRow();
    }

    function renderMain(focusIdx) {
        if (!page) return null;
        main.innerHTML = '';
        var lbl = '';
        for (var i = 0; i < PAGES.length; i++) if (PAGES[i].id === page) lbl = t(PAGES[i].label);
        var wd = page === 'widgets' && sub === 'widget' ? Widgets.find(widgetId) : null;
        if (wd) lbl += ' \u203A ' + wd.title();                      // Widgets > Weather
        main.appendChild(el('h3', 'set-title', lbl));
        try { rows = rowsFor(page); } catch (e) { rows = [{ kind: 'text', value: String(e && e.message || e) }]; }   // a broken row never blocks the page
        var target = null;
        for (i = 0; i < rows.length; i++) {
            var r = rows[i], b;
            if (r.kind === 'wallpapers') { b = wallpaperRow(r, i); main.appendChild(b); if (i === focusIdx) target = b.querySelector('.on') || b.querySelector('button'); continue; }
            if (r.kind === 'themes') { b = themeRow(r, i); main.appendChild(b); if (i === focusIdx) target = b.querySelector('.on') || b.querySelector('button'); continue; }
            if (r.kind === 'profile') { main.appendChild(profileCard()); continue; }
            if (r.kind === 'status') { main.appendChild(statusCard(r)); continue; }
            if (r.kind === 'padtest') { main.appendChild(padTestCard(r)); continue; }
            if (r.kind === 'qr') { main.appendChild(qrCard(r)); continue; }
            if (r.kind === 'motionlog') { main.appendChild(motionCard()); continue; }
            b = el('button', 'set-row' + (r.kind === 'text' ? ' set-text' : '') + (r.danger ? ' set-danger' : '') + (r.primary ? ' set-primary' : ''));
            b.setAttribute('data-focus', '');
            b.setAttribute('data-row', i);
            if (r.kind === 'text') { b.textContent = r.value; b.setAttribute('aria-label', r.value); }
            else {
                var left = el('span', 'set-row-l');
                left.appendChild(el('span', 'set-row-name', r.label));
                if (r.desc) left.appendChild(el('span', 'set-row-desc', r.desc));
                b.appendChild(left);
                var aria = r.label;
                if (r.kind === 'slider') {
                    var v = r.value(), sl = el('span', 'set-slider'), bar = el('span', 'set-slider-bar'), fill = el('span', 'set-slider-fill');
                    fill.style.width = (v * 100 / (r.max || 10)) + '%';
                    bar.appendChild(fill); sl.appendChild(bar); sl.appendChild(el('span', 'set-val', String(v)));
                    b.appendChild(sl);
                    aria += ': ' + v + '. ' + t('adjustHint');
                } else if (r.kind === 'toggle') {
                    var on = r.get(), tg = el('span', 'set-toggle' + (on ? ' on' : ''));
                    tg.appendChild(el('span', 'set-knob'));
                    b.appendChild(el('span', 'set-val', t(on ? 'on' : 'off')));
                    b.appendChild(tg);
                    aria += ': ' + t(on ? 'on' : 'off');
                } else if (r.kind === 'select') {
                    b.appendChild(el('span', 'set-val set-select', '‹  ' + valueText(r) + '  ›'));
                    aria += ': ' + valueText(r) + '. ' + t('adjustHint');
                } else if (r.kind === 'info') {
                    b.appendChild(el('span', 'set-val set-info', r.value));
                    aria += ': ' + r.value;
                } else if (r.kind === 'action') {
                    b.appendChild(el('span', 'set-val set-chev', '›'));
                }
                if (r.desc) aria += '. ' + r.desc;
                b.setAttribute('aria-label', aria);
            }
            b.onclick = (function (row, idx) { return function () { activate(row, idx); }; })(r, i);
            main.appendChild(b);
            if (i === focusIdx) target = b;
        }
        return target;
    }

    // big status line with an optional progress bar (Update page)
    function statusCard(r) {
        var c = el('div', 'set-card set-status' + (r.busy ? ' busy' : ''));
        c.setAttribute('role', 'status');
        c.appendChild(el('div', 'set-card-name', r.title));
        if (r.detail) c.appendChild(el('div', 'set-row-desc', r.detail));
        if (r.progress !== null && r.progress !== undefined) {
            var bar = el('div', 'set-slider-bar set-progress'), fill = el('span', 'set-slider-fill');
            fill.style.width = Math.round(r.progress * 100) + '%';
            bar.appendChild(fill);
            bar.setAttribute('role', 'progressbar');
            bar.setAttribute('aria-valuenow', String(Math.round(r.progress * 100)));
            c.appendChild(bar);
        }
        return c;
    }

    function profileCard() {
        var p = Profiles.current(), c = el('div', 'set-card');
        c.appendChild(ProfilesUI.avatar(p, 'avatar avatar-big'));
        c.appendChild(el('div', 'set-card-name', ProfilesUI.nameOf(p)));
        c.appendChild(el('div', 'set-row-desc', (p.user ? t('acctOf').replace('%s', p.user) : t('localAccount')) + ' · ' + Profiles.list().length + ' ' + t('profiles').toLowerCase()));
        return c;
    }

    // the Weather widget's place and units (Horizon uses the same ones)
    function wxPlaceText() {
        var st = typeof Weather !== 'undefined' ? Weather.settings() : { place: '', units: 'c' }, l = Store.get('weather_loc', null);
        var where = st.place ? st.place : (l && l.name ? l.name + ' (' + t('wxAuto') + ')' : t('wxAuto'));
        return where + ' · ' + (st.units === 'f' ? '°F' : '°C');
    }
    function wallpaperRow(r, idx) {
        var box = el('div', 'set-wps' + (r.live ? ' set-wps-live' : ''));
        box.appendChild(el('div', 'set-row-name', r.label));
        var list = el('div', 'set-wp-list'), live = window.DynWall ? DynWall.is : function () { return false; };
        var all = Desktop.wallpapers().filter(function (w) { return !!w.dyn === !!r.live; });
        function mark() {
            var bs = list.querySelectorAll('.set-wp'), now = Desktop.wallpaper();
            for (var k = 0; k < bs.length; k++) {
                var on = bs[k].getAttribute('data-wp') === now;
                bs[k].className = bs[k].className.replace(/ on$/, '') + (on ? ' on' : '');
                bs[k].setAttribute('aria-label', bs[k].getAttribute('data-name') + (on ? '. ' + t('active') : ''));
            }
        }
        for (var i = 0; i < all.length; i++) {
            var w = all[i], b = el('button', 'set-wp ' + (w.url ? 'set-wp-img' : 'wp-' + w.id));
            b.setAttribute('data-focus', '');
            b.setAttribute('data-wp', w.id);
            b.setAttribute('data-name', w.title);
            // a picture added in the App Store Manager: its small version when there is one (cheaper to decode)
            if (w.url) b.style.backgroundImage = 'url("' + (w.thumb || w.url) + '")';
            b.appendChild(el('span', 'set-wp-name', w.title));
            b.onclick = (function (id, title) {
                return function () {
                    var was = Desktop.wallpaper();
                    Desktop.setWallpaper(id);
                    A11y.announce(title);
                    // a live one in or out: the page shows the chosen one's details and options below (focus stays on this card)
                    if (live(was) || live(id)) { var f = renderMain(idx); if (f) Focus.focus(f); } else mark();
                };
            })(w.id, w.title);
            list.appendChild(b);
        }
        mark();
        box.appendChild(list);
        return box;
    }

    // theme cards: a small picture of the theme's desktop (its background and its taskbar)
    function themeRow(r, idx) {
        var box = el('div', 'set-wps');
        box.appendChild(el('div', 'set-row-name', r.label));
        box.appendChild(el('div', 'set-row-desc', r.desc));
        var list = el('div', 'set-wp-list'), cur = Themes.current();
        Themes.LIST.forEach(function (th) {
            var b = el('button', 'set-wp set-th wp-' + th.wp + (th.id === cur ? ' on' : ''));
            b.setAttribute('data-focus', '');
            b.setAttribute('data-theme', th.id);
            b.setAttribute('aria-label', t('th_' + th.id) + (th.id === cur ? '. ' + t('active') : ''));
            b.appendChild(el('span', 'set-th-bar set-th-' + th.id));
            b.appendChild(el('span', 'set-wp-name', t('th_' + th.id)));
            b.onclick = function () {
                Themes.set(th.id);
                var f = renderMain(idx);
                if (f) Focus.focus(f);
                A11y.announce(t('th_' + th.id));
            };
            list.appendChild(b);
        });
        box.appendChild(list);
        return box;
    }

    function activate(r, idx) {
        if (r.kind === 'slider' && r.max && r.value() >= r.max) { r.adjust(-r.max); return refresh(idx); }   // a short scale (0..3) goes round on OK / tap
        if (r.kind === 'select' || r.kind === 'slider') return change(idx, 1);
        if (r.kind === 'toggle') { r.set(!r.get()); return refresh(idx); }
        if (r.kind === 'action') r.run();
    }

    function change(idx, d) {
        var r = rows[idx];
        if (r.kind === 'slider' && ((d > 0 && r.value() >= (r.max || 10)) || (d < 0 && r.value() <= 0))) return;
        r.adjust(d);
        refresh(idx);
    }

    function refresh(idx) {
        var target = renderMain(idx);
        if (target) Focus.focus(target);
        var r = rows[idx];
        if (r && r.kind !== 'text') A11y.announce(r.kind === 'toggle' ? t(r.get() ? 'on' : 'off') : String(r.kind === 'info' ? r.value : r.value()));
    }

    function focusFirstRow() {
        var f = main.querySelector('[data-focus]');
        if (f) Focus.focus(f);
    }

    function inMain(e) { return e && main.contains(e); }
    function inNav(e) { return e && nav.contains(e); }

    // moves within one column (the spatial default could jump between the columns)
    function column(dir) {
        var c = Focus.current(), box = inNav(c) ? nav : main;
        var list = box.querySelectorAll('[data-focus]'), i;
        // swatches (themes, backgrounds): a row of their own; up/down leave the row, and enter another on its chosen one
        function rep(box2) { return box2.querySelector('.on') || box2.firstChild; }
        list = Array.prototype.filter.call(list, function (x) { return x.className.indexOf('set-wp') !== 0 || x === c || (x === rep(x.parentNode) && !(c && x.parentNode === c.parentNode)); });
        for (i = 0; i < list.length; i++) if (list[i] === c) break;
        var n = list[i + (dir === 'down' ? 1 : -1)];
        if (n) Focus.focus(n);
    }

    function action(a, repeat, dev) {
        // while the controller test shows, the buttons of a controller only test (B must not close Settings);
        // its D-pad and stick still move through the page, so it can always be left
        if (padCard && dev && dev.indexOf('pad') === 0 && a !== 'up' && a !== 'down' && a !== 'left' && a !== 'right') return true;
        var c = Focus.current();
        if (!page) return false;                    // the grid: moves on screen (Focus.move)
        if (a === 'up' || a === 'down') { if (inNav(c) || inMain(c)) { column(a); return true; } return false; }
        if (a === 'left' || a === 'right') {
            var rtl = I18n.rtl(), toNav = (a === 'left') !== rtl;
            if (inMain(c)) {
                var idx = c.getAttribute('data-row');
                if (idx !== null && rows[+idx] && (rows[+idx].kind === 'select' || rows[+idx].kind === 'slider')) { change(+idx, toNav ? -1 : 1); return true; }
                if (c.className.indexOf('set-wp') === 0) {
                    var sib = toNav ? c.previousSibling : c.nextSibling;
                    if (sib) { Focus.focus(sib); return true; }
                    if (!toNav) return true;
                }
                if (toNav) { Focus.focus(navBtn()); return true; }
                return true;
            }
            if (inNav(c)) { if (!toNav) focusFirstRow(); return true; }
            return false;
        }
        return false;
    }

    function back() {
        var c = Focus.current();
        if (!page) return false;                    // the grid: Back closes
        if (sub) { leaveSub(); return true; }
        if (inMain(c)) { Focus.focus(navBtn()); return true; }
        Focus.focus(showHome(page));               // the page list: back to the grid
        return true;
    }

    Win.register('settings', {
        icon: 'settings',
        title: function () { return t('settings'); },
        open: function (b, arg) {
            body = b;
            page = arg || null;
            sub = null;
            nav = el('nav', 'set-nav');
            main = el('div', 'set-main');
            home = el('div', 'cp-home');
            body.appendChild(nav); body.appendChild(main); body.appendChild(home);
            Updater.onChange(onUpdater);
            Input.onDevices(onDevices);
            Controllers.onChange(onCtrl);
            if (!page) return showHome();
            home.hidden = true;
            if (page === 'update') Updater.autoCheck();
            renderNav();
            renderMain();
            return navBtn();
        },
        close: function () { Shortcuts.stopListen(); clearInterval(scTick); scTick = 0; Updater.offChange(onUpdater); Input.offDevices(onDevices); Controllers.offChange(onCtrl); Controllers.monitor(null); monEl = null; sub = null; Updater.cancel(); stopPadTest(); body = nav = main = home = null; rows = []; page = null; },
        refresh: function () { if (!nav) return; if (!page) { var c = Focus.current(), id = c && c.getAttribute('data-page'); Focus.focus(showHome(id)); return; } renderNav(); renderMain(); },
        action: action,
        back: back
    });
})();
