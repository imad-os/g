/* File Explorer app: a small virtual file system over what is on this TV.
 *   Home        quick access folders and the last played game
 *   This PC     the "Local Disk" (saved data use) and the folders
 *   Desktop, Games, Apps   open a game or an app
 *   Pictures    the backgrounds: OK sets one
 *   Documents   the saved data of each game for the active profile */
(function () {
    'use strict';

    var FOLDERS = [
        { id: 'home', icon: 'home', label: 'home' },
        { id: 'pc', icon: 'pc', label: 'thisPc' },
        { id: 'desktop', icon: 'desktop', label: 'desktopFolder' },
        { id: 'games', icon: 'game', label: 'gamesFolder' },
        { id: 'apps', icon: 'folder', label: 'appsFolder' },
        { id: 'pictures', icon: 'picture', label: 'pictures' },
        { id: 'documents', icon: 'document', label: 'documents' }
    ];
    var QUOTA = 5 * 1024 * 1024;     // typical localStorage quota on TVs

    var body, side, path, list, status, cur = 'home', hist = [];

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }
    function t(k) { return I18n.t(k); }
    function folder(id) { for (var i = 0; i < FOLDERS.length; i++) if (FOLDERS[i].id === id) return FOLDERS[i]; return FOLDERS[0]; }

    // bytes used in localStorage by a key prefix
    function bytes(prefix) {
        var n = 0;
        try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k.indexOf(prefix) === 0) n += (k.length + (localStorage.getItem(k) || '').length) * 2; } } catch (e) {}
        return n;
    }
    function size(n) { return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB'; }

    function item(icon, name, detail, run, img) {
        var b = el('button', 'fx-item');
        b.setAttribute('data-focus', '');
        var ic = el('span', 'fx-ic');
        if (img) { var im = document.createElement('img'); im.alt = ''; im.src = img; ic.appendChild(im); ic.className += ' fx-thumb'; }
        else if (icon.indexOf('wp-') === 0) ic.className += ' fx-wp ' + icon;
        else Icons.put(ic, icon);
        b.appendChild(ic);
        b.appendChild(el('span', 'fx-name', name));
        if (detail) b.appendChild(el('span', 'fx-detail', detail));
        b.setAttribute('aria-label', name + (detail ? '. ' + detail : ''));
        b.onclick = run;
        return b;
    }

    function openFolder(id) { return function () { go(id); }; }
    function openApp(id) { return function () { Win.open(id); }; }
    function playGame(g) { return function () { Desktop.play(g); }; }

    function items(id) {
        var out = [], i, games = Desktop.games(), apps = Desktop.APPS;
        if (id === 'home') {
            for (i = 2; i < FOLDERS.length; i++) out.push(item(FOLDERS[i].icon, t(FOLDERS[i].label), '', openFolder(FOLDERS[i].id)));
            var lp = null;
            for (i = 0; i < games.length; i++) if (games[i].id === Desktop.lastPlayed()) lp = games[i];
            if (lp) out.push(item('game', I18n.pick(lp.manifest.title), t('lastPlayed'), playGame(lp), Desktop.coverUrl(lp)));
        } else if (id === 'pc') {
            var used = bytes('arc_'), d = el('button', 'fx-item fx-drive');
            d.setAttribute('data-focus', '');
            var ic = el('span', 'fx-ic'); Icons.put(ic, 'drive'); d.appendChild(ic);
            var tx = el('span', 'fx-drive-text');
            tx.appendChild(el('span', 'fx-name', t('localDisk')));
            var bar = el('span', 'fx-bar'), fill = el('span', 'fx-bar-fill');
            fill.style.width = Math.max(1, Math.min(100, used / QUOTA * 100)) + '%';
            bar.appendChild(fill); tx.appendChild(bar);
            var info = size(QUOTA - used) + ' ' + t('freeOf') + ' ' + size(QUOTA);
            tx.appendChild(el('span', 'fx-detail', info));
            d.appendChild(tx);
            d.setAttribute('aria-label', t('localDisk') + '. ' + info);
            d.onclick = openFolder('documents');
            out.push(d);
            for (i = 2; i < FOLDERS.length; i++) out.push(item(FOLDERS[i].icon, t(FOLDERS[i].label), '', openFolder(FOLDERS[i].id)));
        } else if (id === 'desktop') {
            out.push(item('pc', t('thisPc'), '', openApp('explorer')));
            out.push(item('browser', t('browser'), '', openApp('browser')));
            for (i = 0; i < games.length; i++) out.push(item('game', I18n.pick(games[i].manifest.title), t('game'), playGame(games[i]), Desktop.coverUrl(games[i])));
            out.push(item('scores', t('leaderboards'), '', openApp('scores')));
        } else if (id === 'games') {
            for (i = 0; i < games.length; i++) out.push(item('game', I18n.pick(games[i].manifest.title), I18n.pick(games[i].manifest.description), playGame(games[i]), Desktop.coverUrl(games[i])));
        } else if (id === 'apps') {
            for (i = 0; i < apps.length; i++) out.push(item(apps[i].icon, t(apps[i].label), t('app'), openApp(apps[i].id)));
        } else if (id === 'pictures') {
            var curWp = Desktop.wallpaper();
            for (i = 0; i < Desktop.WALLPAPERS.length; i++) {
                var w = Desktop.WALLPAPERS[i];
                out.push(item('wp-' + w, t('wp_' + w) + '.jpg', w === curWp ? t('currentBackground') : t('setBackground'), (function (name) {
                    return function () { Desktop.setWallpaper(name); App.toast(t('backgroundSet')); render(); };
                })(w)));
            }
        } else if (id === 'documents') {
            var p = 'arc_' + Store.profile() + '_game_';
            for (i = 0; i < games.length; i++) {
                var n = bytes(p + games[i].id + '_');
                out.push(item('document', I18n.pick(games[i].manifest.title) + ' – ' + t('savedData'), n ? size(n) : t('noData'), playGame(games[i])));
            }
            var cn = bytes('arc_' + Store.profile() + '_cal_notes');
            out.push(item('calendar', t('calendar') + ' – ' + t('notes'), cn ? size(cn) : t('noData'), openApp('calendar')));
        }
        return out;
    }

    function renderSide() {
        side.innerHTML = '';
        for (var i = 0; i < FOLDERS.length; i++) {
            var f = FOLDERS[i], b = el('button', 'fx-nav' + (f.id === cur ? ' on' : ''));
            b.setAttribute('data-focus', '');
            b.setAttribute('data-folder', f.id);
            var ic = el('span', 'fx-nav-ic'); Icons.put(ic, f.icon);
            b.appendChild(ic); b.appendChild(el('span', '', t(f.label)));
            b.onclick = openFolder(f.id);
            side.appendChild(b);
        }
    }

    function render() {
        var f = folder(cur);
        path.textContent = (cur === 'home' || cur === 'pc' ? '' : t('thisPc') + '  ›  ') + t(f.label);
        list.innerHTML = '';
        var its = items(cur);
        if (!its.length) list.appendChild(el('p', 'fx-empty', t('emptyFolder')));
        for (var i = 0; i < its.length; i++) list.appendChild(its[i]);
        status.textContent = its.length + ' ' + t('items');
        var navs = side.querySelectorAll('.fx-nav');
        for (i = 0; i < navs.length; i++) navs[i].className = 'fx-nav' + (navs[i].getAttribute('data-folder') === cur ? ' on' : '');
        Win.setTitle(t(f.label) + ' – ' + t('explorer'));
        return list.querySelector('[data-focus]');
    }

    function go(id, noHist) {
        if (id !== cur && !noHist) hist.push(cur);
        cur = id;
        var first = render();
        if (first) Focus.focus(first);
        A11y.announce(t(folder(id).label) + ', ' + status.textContent);
    }

    function toolbar() {
        var bar = el('div', 'fx-bar-top'), back = el('button', 'icon-btn'), up = el('button', 'icon-btn');
        Icons.put(back, 'back'); Icons.put(up, 'up');
        back.setAttribute('data-focus', ''); up.setAttribute('data-focus', '');
        back.setAttribute('aria-label', t('back')); up.setAttribute('aria-label', t('upFolder'));
        back.onclick = function () { goBack(); };
        up.onclick = function () { if (cur !== 'home' && cur !== 'pc') go('pc'); };
        bar.appendChild(back); bar.appendChild(up);
        path = el('div', 'fx-path');
        bar.appendChild(path);
        return bar;
    }

    function goBack() { if (!hist.length) return false; go(hist.pop(), true); return true; }

    Win.register('explorer', {
        icon: 'explorer',
        title: function () { return t('explorer'); },
        open: function (b, arg) {
            body = b; hist = []; cur = arg || 'home';
            body.appendChild(toolbar());
            var wrap = el('div', 'fx-wrap');
            side = el('nav', 'fx-side');
            list = el('div', 'fx-list');
            list.setAttribute('role', 'list');
            wrap.appendChild(side); wrap.appendChild(list);
            body.appendChild(wrap);
            status = el('div', 'fx-status');
            body.appendChild(status);
            renderSide();
            return render();
        },
        close: function () { body = side = path = list = status = null; hist = []; },
        back: goBack
    });
})();
