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
        { id: 'time', icon: 'clock', label: 'sysTime' },
        { id: 'gaming', icon: 'controller', label: 'sysGaming' },
        { id: 'privacy', icon: 'shield', label: 'sysPrivacy' },
        { id: 'about', icon: 'info', label: 'about' }
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
            lines = t('privacyText');
            for (i = 0; i < lines.length; i++) out.push({ kind: 'text', value: lines[i] });
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
        tx.appendChild(el('div', 'set-user-sub', t('localAccount')));
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

    function showPage(id) {
        page = id;
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
        rows = rowsFor(page);
        var target = null;
        for (i = 0; i < rows.length; i++) {
            var r = rows[i], b;
            if (r.kind === 'wallpapers') { b = wallpaperRow(r); main.appendChild(b); if (i === focusIdx) target = b.querySelector('.on') || b.querySelector('button'); continue; }
            if (r.kind === 'profile') { main.appendChild(profileCard()); continue; }
            b = el('button', 'set-row' + (r.kind === 'text' ? ' set-text' : '') + (r.danger ? ' set-danger' : ''));
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

    function profileCard() {
        var p = Profiles.current(), c = el('div', 'set-card');
        c.appendChild(ProfilesUI.avatar(p, 'avatar avatar-big'));
        c.appendChild(el('div', 'set-card-name', ProfilesUI.nameOf(p)));
        c.appendChild(el('div', 'set-row-desc', t('localAccount') + ' · ' + Profiles.list().length + ' ' + t('profiles').toLowerCase()));
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

    function action(a, repeat) {
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
            renderNav();
            renderMain();
            return navBtn();
        },
        close: function () { body = nav = main = null; rows = []; },
        refresh: function () { if (nav) { renderNav(); renderMain(); } },
        action: action,
        back: back
    });
})();
