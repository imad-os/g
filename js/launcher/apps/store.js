/* App Store: find, install, open and uninstall apps and games published with the App Store Manager.
 *   Home      a featured app (the newest), New, Popular (installs + opens on every My PC), Games, Apps
 *   Games / Apps   everything of that kind
 *   Library   what is installed on this TV (Open / Uninstall)
 *   Search    by name or description (on-screen keyboard)
 *   a card    -> the app's page: Install (short progress) / Open / Uninstall
 * Shows the saved catalog at once (works offline) and refreshes it from Firebase in the background.
 * Installed apps appear on the desktop, in Start and in File Explorer. */
(function () {
    'use strict';

    var body = null, nav = null, main = null, page = 'home', detail = null, query = '';
    var stats = {}, offline = false, installing = null, timer = 0, backFocus = null;
    var PAGES = [
        { id: 'home', icon: 'home', label: 'storeHome' },
        { id: 'games', icon: 'gamepadNav', label: 'storeGames' },
        { id: 'apps', icon: 'appsNav', label: 'storeApps' },
        { id: 'library', icon: 'library', label: 'storeLibrary' },
        { id: 'search', icon: 'search', label: 'storeSearch' }
    ];

    function t(k) { return I18n.t(k); }
    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }
    function nameOf(a) { return typeof a.name === 'string' ? a.name : I18n.pick(a.name); }
    function descOf(a) { return typeof a.description === 'string' ? a.description : (a.description ? I18n.pick(a.description) : ''); }
    function kindOf(a) { return t(a.type === 'app' ? 'storeApp' : 'storeGame'); }
    function score(a) { var s = stats[a.id] || {}; return (s.installs || 0) * 3 + (s.opens || 0); }
    function added(a) { var v = Date.parse(a.installedAt || ''); return isNaN(v) ? 0 : v; }
    function installsText(a) { var n = (stats[a.id] || {}).installs || 0; return t('storeInstalls').replace('%s', n); }

    function icon(a, cls) {
        var box = el('span', 'st-icon' + (cls ? ' ' + cls : ''));
        if (a.icon) {
            var img = document.createElement('img');
            img.alt = '';
            img.src = a.icon;
            img.onerror = function () { this.style.visibility = 'hidden'; };
            box.appendChild(img);
        } else box.appendChild(el('span', 'st-letter', nameOf(a).charAt(0)));
        return box;
    }

    // a card: OK opens the app's page
    function card(a) {
        var b = el('button', 'st-card');
        b.setAttribute('data-focus', '');
        b.setAttribute('data-store-app', a.id);
        b.appendChild(icon(a));
        var tx = el('span', 'st-card-text');
        tx.appendChild(el('span', 'st-card-name', nameOf(a)));
        tx.appendChild(el('span', 'st-card-sub', kindOf(a) + (Cloud.isInstalled(a.id) ? ' · ' + t('storeInstalled') : '')));
        b.appendChild(tx);
        if (Cloud.isInstalled(a.id)) b.appendChild(el('span', 'st-check', '✓'));
        b.setAttribute('aria-label', nameOf(a) + '. ' + kindOf(a) + '. ' + (Cloud.isInstalled(a.id) ? t('storeInstalled') + '. ' : '') + descOf(a));
        b.onclick = function () { openDetail(a, b); };
        return b;
    }

    function grid(list, max) {
        var g = el('div', 'st-grid');
        for (var i = 0; i < list.length && (!max || i < max); i++) g.appendChild(card(list[i]));
        return g;
    }
    function section(title, list, max) {
        if (!list.length) return null;
        var s = el('section', 'st-section');
        s.appendChild(el('h2', 'st-h', title));
        s.appendChild(grid(list, max));
        return s;
    }
    function empty(text) { return el('p', 'st-empty', text); }

    function sorted(list, fn) { return list.slice().sort(fn); }
    function newest(list) { return sorted(list, function (a, b) { return added(b) - added(a); }); }
    function popular(list) { return sorted(list, function (a, b) { return score(b) - score(a) || added(b) - added(a); }); }

    /* ---------------- pages ---------------- */

    function hero(a) {
        var h = el('div', 'st-hero');
        h.appendChild(icon(a, 'st-hero-icon'));
        var tx = el('div', 'st-hero-text');
        tx.appendChild(el('span', 'st-badge', t('storeFeatured')));
        tx.appendChild(el('h1', 'st-hero-name', nameOf(a)));
        tx.appendChild(el('p', 'st-hero-desc', descOf(a)));
        var go = el('button', 'btn btn-primary st-hero-btn', Cloud.isInstalled(a.id) ? t('storeOpen') : t('storeSeeMore'));
        go.setAttribute('data-focus', '');
        go.setAttribute('data-store-app', a.id);
        go.setAttribute('aria-label', t('storeFeatured') + ': ' + nameOf(a) + '. ' + descOf(a));
        go.onclick = function () { if (Cloud.isInstalled(a.id)) openApp(a); else openDetail(a, go); };
        tx.appendChild(go);
        h.appendChild(tx);
        return h;
    }

    function renderPage() {
        main.innerHTML = '';
        main.scrollTop = 0;
        detail = null;
        var all = Cloud.catalog(), i, list;
        if (offline) main.appendChild(el('p', 'st-note', t('storeOffline')));
        if (page === 'home') {
            if (!all.length) { main.appendChild(empty(t('storeEmpty'))); return null; }
            var fresh = newest(all);
            main.appendChild(hero(fresh[0]));
            [section(t('storeNew'), fresh, 5), section(t('storePopular'), popular(all), 5),
             section(t('storeGames'), popular(all.filter(function (a) { return a.type !== 'app'; })), 5),
             section(t('storeApps'), popular(all.filter(function (a) { return a.type === 'app'; })), 5)].forEach(function (s) { if (s) main.appendChild(s); });
        } else if (page === 'games' || page === 'apps') {
            list = popular(all.filter(function (a) { return (a.type === 'app') === (page === 'apps'); }));
            main.appendChild(el('h1', 'st-title', t(page === 'apps' ? 'storeApps' : 'storeGames')));
            main.appendChild(list.length ? grid(list) : empty(t('storeEmpty')));
        } else if (page === 'library') {
            main.appendChild(el('h1', 'st-title', t('storeLibrary')));
            list = Cloud.apps();
            if (!list.length) main.appendChild(empty(t('storeLibraryEmpty')));
            for (i = 0; i < list.length; i++) main.appendChild(libraryRow(list[i]));
        } else if (page === 'search') {
            main.appendChild(el('h1', 'st-title', t('storeSearch')));
            var box = el('button', 'st-search' + (query ? '' : ' st-search-empty'), query || t('storeSearchHint'));
            box.setAttribute('data-focus', '');
            box.id = 'store-search';
            box.setAttribute('aria-label', t('storeSearch') + (query ? ': ' + query : ''));
            box.onclick = askQuery;
            main.appendChild(box);
            if (query) {
                var q = query.toLowerCase();
                list = all.filter(function (a) { return nameOf(a).toLowerCase().indexOf(q) >= 0 || descOf(a).toLowerCase().indexOf(q) >= 0; });
                main.appendChild(list.length ? grid(popular(list)) : empty(t('storeNoResults')));
            }
        }
        return main.querySelector('[data-focus]');
    }

    function libraryRow(a) {
        var r = el('div', 'st-row');
        r.appendChild(icon(a));
        var tx = el('div', 'st-row-text');
        tx.appendChild(el('div', 'st-card-name', nameOf(a)));
        tx.appendChild(el('div', 'st-card-sub', kindOf(a) + (a.version ? ' · ' + t('storeVersion') + ' ' + a.version : '')));
        r.appendChild(tx);
        var open = el('button', 'btn btn-primary', t('storeOpen')), del = el('button', 'btn', t('storeUninstall'));
        open.setAttribute('data-focus', ''); del.setAttribute('data-focus', '');
        open.setAttribute('aria-label', t('storeOpen') + ' ' + nameOf(a));
        del.setAttribute('aria-label', t('storeUninstall') + ' ' + nameOf(a));
        open.onclick = function () { openApp(a); };
        del.onclick = function () { askUninstall(a); };
        r.appendChild(open); r.appendChild(del);
        return r;
    }

    // the app's page
    function openDetail(a, from) {
        backFocus = from ? from.getAttribute('data-store-app') : null;
        detail = a;
        main.innerHTML = '';
        main.scrollTop = 0;
        var back = el('button', 'icon-btn st-back');
        Icons.put(back, 'back');
        back.setAttribute('data-focus', '');
        back.setAttribute('aria-label', t('back'));
        back.onclick = closeDetail;
        main.appendChild(back);
        var top = el('div', 'st-detail');
        top.appendChild(icon(a, 'st-detail-icon'));
        var tx = el('div', 'st-detail-text');
        tx.appendChild(el('h1', 'st-detail-name', nameOf(a)));
        tx.appendChild(el('div', 'st-card-sub', kindOf(a) + (a.version ? ' · ' + t('storeVersion') + ' ' + a.version : '') + ' · ' + installsText(a)));
        tx.appendChild(el('p', 'st-detail-desc', descOf(a)));
        var acts = el('div', 'st-actions');
        acts.id = 'store-actions';
        tx.appendChild(acts);
        top.appendChild(tx);
        main.appendChild(top);
        var first = renderActions();
        Win.setTitle(nameOf(a) + ' – ' + t('store'));
        A11y.announce(nameOf(a) + '. ' + kindOf(a) + '. ' + descOf(a));
        Focus.focus(first);
    }

    function renderActions() {
        var a = detail, acts = document.getElementById('store-actions');
        if (!a || !acts) return null;
        acts.innerHTML = '';
        if (installing === a.id) {
            var bar = el('div', 'st-progress'), fill = el('span', 'st-progress-fill');
            fill.id = 'store-progress';
            bar.appendChild(fill);
            acts.appendChild(el('span', 'st-installing', t('storeInstalling')));
            acts.appendChild(bar);
            return null;
        }
        if (Cloud.isInstalled(a.id)) {
            var open = el('button', 'btn btn-primary', t('storeOpen')), del = el('button', 'btn', t('storeUninstall'));
            open.id = 'store-open'; del.id = 'store-uninstall';
            open.setAttribute('data-focus', ''); del.setAttribute('data-focus', '');
            open.onclick = function () { openApp(a); };
            del.onclick = function () { askUninstall(a); };
            acts.appendChild(open); acts.appendChild(del);
            return open;
        }
        var get = el('button', 'btn btn-primary', t('storeGet'));
        get.id = 'store-install';
        get.setAttribute('data-focus', '');
        get.setAttribute('aria-label', t('storeGet') + ' ' + nameOf(a));
        get.onclick = function () { install(a); };
        acts.appendChild(get);
        return get;
    }

    function closeDetail() {
        if (!detail) return false;
        var id = backFocus;
        var first = renderPage();
        Win.setTitle(t('store'));
        var back = id ? main.querySelector('[data-store-app="' + id + '"]') : null;
        Focus.focus(back || first || navBtn(page));
        return true;
    }

    /* ---------------- install / open / uninstall ---------------- */

    // a short progress bar, like a real store (the app runs from its website: nothing to download)
    function install(a) {
        if (installing) return;
        installing = a.id;
        renderActions();
        A11y.announce(t('storeInstalling'));
        var p = 0;
        (function step() {
            p += 12 + Math.random() * 18;
            var f = document.getElementById('store-progress');
            if (f) f.style.transform = 'scaleX(' + Math.min(1, p / 100) + ')';
            if (p < 100) { timer = setTimeout(step, 120); return; }
            installing = null;
            Cloud.install(a.id);                       // Desktop updates through Cloud.onChange
            App.toast(t('storeInstalledToast').replace('%s', nameOf(a)));
            if (detail && detail.id === a.id) Focus.focus(renderActions());
        })();
    }

    function openApp(a) { Desktop.play(Desktop.fromCloud(a)); }

    function askUninstall(a) {
        App.confirm(t('storeUninstallTitle').replace('%s', nameOf(a)), t('storeUninstallText'), function () {
            Cloud.uninstall(a.id);
            App.toast(t('storeUninstalled').replace('%s', nameOf(a)));
            if (detail) Focus.focus(renderActions());
            else { var f = renderPage(); Focus.focus(f || navBtn(page)); }
        });
    }

    function askQuery() {
        Keyboard.open({ title: t('storeSearch'), text: query, max: 30, mode: 'text', placeholder: t('storeSearchHint') }, function (v) {
            query = String(v || '').trim();
            renderPage();
            var r = main.querySelector('.st-card');
            Focus.focus(r || document.getElementById('store-search'));
            if (query) A11y.announce(main.querySelectorAll('.st-card').length + ' ' + t('items'));
        });
    }

    /* ---------------- navigation ---------------- */

    function navBtn(id) { return nav.querySelector('[data-page="' + id + '"]'); }

    function renderNav() {
        nav.innerHTML = '';
        for (var i = 0; i < PAGES.length; i++) {
            var p = PAGES[i], b = el('button', 'st-nav-btn' + (p.id === page ? ' on' : ''));
            b.setAttribute('data-focus', '');
            b.setAttribute('data-page', p.id);
            var ic = el('span', 'st-nav-ic'); Icons.put(ic, p.icon);
            b.appendChild(ic);
            b.appendChild(el('span', 'st-nav-lbl', t(p.label)));
            b.onclick = (function (id) { return function () { show(id); }; })(p.id);
            nav.appendChild(b);
        }
    }

    function show(id) {
        page = id;
        var btns = nav.querySelectorAll('.st-nav-btn');
        for (var i = 0; i < btns.length; i++) btns[i].className = 'st-nav-btn' + (btns[i].getAttribute('data-page') === id ? ' on' : '');
        Win.setTitle(t('store'));
        var first = renderPage();
        if (id === 'search' && !query) return askQuery();
        Focus.focus(first || navBtn(id));
    }

    // fresh catalog and counters from Firebase: redraw only if something changed, keeping the focus
    function refresh() {
        Cloud.refresh(function (err, list, changed) {
            if (!body) return;
            offline = !!err;
            Cloud.stats(function (err2, s) {
                if (!body) return;
                var statsChanged = JSON.stringify(s) !== JSON.stringify(stats);
                stats = s || {};
                if (!changed && !statsChanged && !err) return;
                if (detail) return;                    // never redraw under the user's feet on an app page
                var cur = Focus.current(), key = cur && (cur.getAttribute('data-store-app') || cur.getAttribute('data-page'));
                renderPage();
                var again = key ? (main.querySelector('[data-store-app="' + key + '"]') || navBtn(key)) : null;
                if (cur && body.contains(cur)) return;
                if (again) Focus.focus(again);
            });
        });
    }

    Win.register('store', {
        icon: 'store',
        title: function () { return t('store'); },
        open: function (b, arg) {
            body = b; page = arg || 'home'; detail = null; installing = null; offline = false;
            stats = Cloud.statsCached();
            nav = el('nav', 'st-nav');
            main = el('div', 'st-main');
            body.appendChild(nav); body.appendChild(main);
            renderNav();
            var first = renderPage();
            refresh();
            return first || navBtn(page);
        },
        close: function () { clearTimeout(timer); installing = null; body = nav = main = detail = null; },
        refresh: function () { if (nav) { renderNav(); if (detail) openDetail(detail); else renderPage(); } },
        back: function () { return closeDetail(); }
    });
})();
