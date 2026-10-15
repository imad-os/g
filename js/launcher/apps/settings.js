/* Settings app (Windows 11 style): pages on the left, rows on the right.
 * Remote: up/down moves, left/right changes a value (or goes back to the page list), OK picks,
 * Back goes from a row to the page list, then closes. */
(function () {
    'use strict';

    var GFX = ['auto', 'low', 'mid', 'high'];
    var GFX_KEYS = { auto: 'gfxAuto', low: 'gfxLow', mid: 'gfxMid', high: 'gfxHigh' };
    var PAGES = [
        { id: 'system', icon: 'system', label: 'sysSystem' },
        { id: 'personal', icon: 'brush', label: 'sysPersonal' },
        { id: 'apps', icon: 'folder', label: 'sysApps' },
        { id: 'accounts', icon: 'accounts', label: 'sysAccounts' },
        { id: 'sound', icon: 'sound', label: 'sysSound' },
        { id: 'devices', icon: 'gamepad', label: 'sysDevices' },
        { id: 'time', icon: 'clock', label: 'sysTime' },
        { id: 'gaming', icon: 'controller', label: 'sysGaming' },
        { id: 'privacy', icon: 'shield', label: 'sysPrivacy' },
        { id: 'about', icon: 'info', label: 'about' },
        { id: 'update', icon: 'reload', label: 'sysUpdate' }
    ];

    var body, nav, main, page = 'system', rows = [];

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
        } else if (id === 'personal') {
            out.push({ kind: 'wallpapers', label: t('background') });
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
            accountRows(out);
            out.push({ kind: 'action', label: t('profilePicture'), desc: t('pictureHint'), run: function () { ProfilesUI.openPicker(true); } });
            out.push({ kind: 'action', label: t('manageProfiles'), desc: t('profilesHint'), run: function () { ProfilesUI.open(); } });
        } else if (id === 'sound') {
            out.push({ kind: 'slider', label: t('musicVol'), value: function () { return AudioPrefs.music(); }, adjust: function (d) { AudioPrefs.setMusic(AudioPrefs.music() + d); } });
            out.push({ kind: 'slider', label: t('sfxVol'), value: function () { return AudioPrefs.sfx(); }, adjust: function (d) { AudioPrefs.setSfx(AudioPrefs.sfx() + d); } });
        } else if (id === 'time') {
            out.push({ kind: 'select', label: t('language'), value: function () { return I18n.NAMES[I18n.lang()]; }, adjust: function (d) {
                var l = I18n.LANGS, k = (l.indexOf(I18n.lang()) + d + l.length) % l.length;
                I18n.setLang(l[k]); App.refresh(); Win.setTitle(t('settings')); renderNav();
            } });
            out.push({ kind: 'toggle', label: t('clock24'), get: function () { return Store.get('clock24', I18n.lang() !== 'en'); }, set: function (v) { Store.set('clock24', v); } });
            var now = new Date();
            out.push({ kind: 'info', label: t('dateTime'), value: Desktop.timeText(now) + ', ' + Desktop.dateText(now, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) });
        } else if (id === 'gaming') {
            lines = t('controlsText');
            for (i = 0; i < lines.length; i++) out.push({ kind: 'text', value: lines[i] });
            out.push({ kind: 'action', label: t('resetProgress'), desc: t('resetText'), danger: true, run: function () {
                App.confirm(t('resetTitle'), t('resetText'), function () { Store.clearPrefix('game_'); App.toast(t('resetDone')); });
            } });
        } else if (id === 'privacy') {
            out.push({ kind: 'toggle', label: t('cloudBackup'), desc: t('cloudBackupDesc'), get: function () { return Backup.on(); }, set: function (v) { Backup.setOn(v); } });
            out.push({ kind: 'toggle', label: t('worldShare'), desc: t('worldShareDesc'), get: function () { return World.on(); }, set: function (v) { World.setOn(v); } });
            out.push({ kind: 'action', label: t('deleteBackup'), danger: true, run: function () {
                App.confirm(t('deleteBackup') + '?', t('cloudBackupDesc'), function () {
                    Backup.erase(function (err) { App.toast(t(err ? 'cloudFail' : 'deleteBackupDone')); if (Win.current() === 'settings') { var f = renderMain(1); if (f) Focus.focus(f); } });
                });
            } });
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
        if (!inf.smart) out.push({ kind: 'text', value: t('updOldPackage') });
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
        var pl0 = Controllers.players();
        out.push({ kind: 'action', label: t('ctrlTitle'), desc: !Controllers.on() ? t('ctrlOff') : (pl0[1] || pl0[2]) ? [pl0[1], pl0[2]].filter(Boolean).join(', ') : t('ctrlScanDesc'),
                   run: function () { sub = 'phonectrl'; if (Controllers.on()) Controllers.pair(); var f = renderMain(1); if (f) Focus.focus(f); } });
    }

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
        out.push({ kind: 'action', label: t('ctrlForget'), danger: true, run: function () { Controllers.forget(); App.toast(t('ctrlForgot')); } });
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

    function leaveSub() { sub = null; var f = renderMain(0); if (f) Focus.focus(f); }
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
        var btns = nav.querySelectorAll('.set-nav-btn');
        for (var i = 0; i < btns.length; i++) btns[i].className = 'set-nav-btn' + (btns[i].getAttribute('data-page') === id ? ' on' : '');
        renderMain();
    }

    function valueText(r) {
        if (r.kind === 'toggle') return t(r.get() ? 'on' : 'off');
        return String(r.value());
    }

    function renderMain(focusIdx) {
        main.innerHTML = '';
        var lbl = '';
        for (var i = 0; i < PAGES.length; i++) if (PAGES[i].id === page) lbl = t(PAGES[i].label);
        main.appendChild(el('h3', 'set-title', lbl));
        try { rows = rowsFor(page); } catch (e) { rows = [{ kind: 'text', value: String(e && e.message || e) }]; }   // a broken row never blocks the page
        var target = null;
        for (i = 0; i < rows.length; i++) {
            var r = rows[i], b;
            if (r.kind === 'wallpapers') { b = wallpaperRow(r); main.appendChild(b); if (i === focusIdx) target = b.querySelector('.on') || b.querySelector('button'); continue; }
            if (r.kind === 'profile') { main.appendChild(profileCard()); continue; }
            if (r.kind === 'status') { main.appendChild(statusCard(r)); continue; }
            if (r.kind === 'padtest') { main.appendChild(padTestCard(r)); continue; }
            if (r.kind === 'qr') { main.appendChild(qrCard(r)); continue; }
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
                    fill.style.width = (v * 10) + '%';
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

    function wallpaperRow(r) {
        var box = el('div', 'set-wps');
        box.appendChild(el('div', 'set-row-name', r.label));
        var list = el('div', 'set-wp-list'), cur = Desktop.wallpaper();
        for (var i = 0; i < Desktop.WALLPAPERS.length; i++) {
            var w = Desktop.WALLPAPERS[i], b = el('button', 'set-wp wp-' + w + (w === cur ? ' on' : ''));
            b.setAttribute('data-focus', '');
            b.setAttribute('data-wp', w);
            b.setAttribute('aria-label', t('wp_' + w) + (w === cur ? '. ' + t('active') : ''));
            b.appendChild(el('span', 'set-wp-name', t('wp_' + w)));
            b.onclick = (function (name) { return function () {
                Desktop.setWallpaper(name);
                var all = list.querySelectorAll('.set-wp');
                for (var k = 0; k < all.length; k++) all[k].className = 'set-wp wp-' + all[k].getAttribute('data-wp') + (all[k].getAttribute('data-wp') === name ? ' on' : '');
                A11y.announce(t('wp_' + name));
            }; })(w);
            list.appendChild(b);
        }
        box.appendChild(list);
        return box;
    }

    function activate(r, idx) {
        if (r.kind === 'select' || r.kind === 'slider') return change(idx, 1);
        if (r.kind === 'toggle') { r.set(!r.get()); return refresh(idx); }
        if (r.kind === 'action') r.run();
    }

    function change(idx, d) {
        var r = rows[idx];
        if (r.kind === 'slider' && ((d > 0 && r.value() >= 10) || (d < 0 && r.value() <= 0))) return;
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
        if (c && c.className.indexOf('set-wp') === 0) {
            // wallpaper swatches: one row; up/down leave the row
            list = Array.prototype.filter.call(list, function (x) { return x.className.indexOf('set-wp') !== 0 || x === c; });
        }
        for (i = 0; i < list.length; i++) if (list[i] === c) break;
        var n = list[i + (dir === 'down' ? 1 : -1)];
        if (n) Focus.focus(n);
    }

    function action(a, repeat, dev) {
        // while the controller test shows, the buttons of a controller only test (B must not close Settings);
        // its D-pad and stick still move through the page, so it can always be left
        if (padCard && dev && dev.indexOf('pad') === 0 && a !== 'up' && a !== 'down' && a !== 'left' && a !== 'right') return true;
        var c = Focus.current();
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
        if (sub) { leaveSub(); return true; }
        if (inMain(c)) { Focus.focus(navBtn()); return true; }
        return false;
    }

    Win.register('settings', {
        icon: 'settings',
        title: function () { return t('settings'); },
        open: function (b, arg) {
            body = b;
            page = arg || 'system';
            nav = el('nav', 'set-nav');
            main = el('div', 'set-main');
            body.appendChild(nav); body.appendChild(main);
            Updater.onChange(onUpdater);
            Input.onDevices(onDevices);
            Controllers.onChange(onCtrl);
            if (page === 'update') Updater.autoCheck();
            renderNav();
            renderMain();
            return navBtn();
        },
        close: function () { Updater.offChange(onUpdater); Input.offDevices(onDevices); Controllers.offChange(onCtrl); sub = null; Updater.cancel(); stopPadTest(); body = nav = main = null; rows = []; },
        refresh: function () { if (nav) { renderNav(); renderMain(); } },
        action: action,
        back: back
    });
})();
