/* The desktop: wallpaper, desktop icons (apps and games), taskbar with clock, and the Start menu.
 * Light on purpose for TVs: the wallpaper is CSS (no image), the clock ticks once a minute and
 * only while the desktop is on screen, and game covers are released while an app or game runs. */
var Desktop = (function () {
    'use strict';

    var games = [];             // built-in games: [{ id, manifest, base, bundledBase }]
    var installed = [];         // installed from the computer (Firebase), same shape + remote
    var onPlay = null;
    var lastPlayed = null, clockTimer = 0, startReturn = null;

    // desktop apps (opened full screen by Win)
    var APPS = [
        { id: 'explorer', icon: 'pc', label: 'thisPc' },
        { id: 'browser', icon: 'browser', label: 'browser' },
        { id: 'calculator', icon: 'calculator', label: 'calculator' },
        { id: 'calendar', icon: 'calendar', label: 'calendar' },
        { id: 'scores', icon: 'scores', label: 'leaderboards' },
        { id: 'settings', icon: 'settings', label: 'settings' }
    ];
    var PINNED = ['explorer', 'browser', 'calendar', 'calculator', 'settings'];
    var WALLPAPERS = ['bloom', 'aurora', 'sunset', 'night'];

    function $(id) { return document.getElementById(id); }
    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }
    function appById(id) { for (var i = 0; i < APPS.length; i++) if (APPS[i].id === id) return APPS[i]; return null; }
    function all() { return games.concat(installed); }
    function gameById(id) { var l = all(); for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }

    // a Firebase app document -> a launcher entry (installed apps run from their own https site)
    function fromCloud(a) {
        return {
            id: 'app-' + a.id, installed: true, kind: a.type === 'app' ? 'app' : 'game',
            manifest: { title: a.name, description: a.description || '', build: a.version || '1', scores: a.type !== 'app' && a.scores !== false },
            iconUrl: a.icon || '', url: a.url || '', remote: { entry: a.entry, config: a.config || {} }
        };
    }
    function setInstalled(list) {
        installed = [];
        for (var i = 0; i < list.length; i++) installed.push(fromCloud(list[i]));
        if (onPlay) render();
    }

    function badgeFor(g) {
        var seen = Store.get('seen_builds', {});
        if (seen[g.id] === undefined) return 'new';
        if (g.manifest.build > seen[g.id]) return 'upd';
        return '';
    }
    function markSeen(g) {
        var seen = Store.get('seen_builds', {});
        seen[g.id] = g.manifest.build;
        Store.set('seen_builds', seen);
    }

    function coverUrl(g) { return g.installed ? g.iconUrl : g.base + 'games/' + g.id + '/' + (g.manifest.cover || 'cover.png'); }

    // icon picture: an SVG for apps, the game's cover (cropped square) for games
    function picture(kind, item) {
        var box = el('span', 'ic');
        if (kind === 'app') { box.className = 'ic ic-app'; Icons.put(box, item.icon); return box; }
        var img = document.createElement('img');
        img.alt = '';
        img.setAttribute('data-src', coverUrl(item));
        if (item.installed) box.className = 'ic ic-installed';
        img.src = img.getAttribute('data-src');
        // hide a broken cover, but not the "error" of releaseImages() clearing it while a game runs
        img.onerror = function () { if (this.getAttribute('src')) this.style.visibility = 'hidden'; };
        img.onload = function () { this.style.visibility = ''; };
        box.appendChild(img);
        return box;
    }

    // a launcher button: desktop icon, Start menu tile or taskbar button
    function button(cls, kind, item, withLabel) {
        var b = el('button', cls), label;
        b.setAttribute('data-focus', '');
        b.setAttribute('role', 'listitem');
        if (kind === 'app') {
            label = I18n.t(item.label);
            b.setAttribute('data-app', item.id);
            b.onclick = function () { closeStart(true); Win.open(item.id); };
        } else {
            label = I18n.pick(item.manifest.title);
            b.setAttribute('data-game', item.id);
            var badge = badgeFor(item), aria = label + '. ' + I18n.pick(item.manifest.description);
            if (badge) { b.appendChild(el('span', 'dot' + (badge === 'upd' ? ' dot-upd' : ''))); aria += '. ' + I18n.t(badge === 'new' ? 'badgeNew' : 'badgeUpdated'); }
            if (item.id === lastPlayed) aria += '. ' + I18n.t('lastPlayed');
            b.setAttribute('aria-label', aria);
            b.onclick = function () { closeStart(true); play(item); };
        }
        if (!b.getAttribute('aria-label')) b.setAttribute('aria-label', label);
        b.insertBefore(picture(kind, item), b.firstChild);
        if (withLabel) b.appendChild(el('span', 'lbl', label));
        return b;
    }

    /* ---------------- desktop icons ---------------- */

    function renderIcons() {
        var box = $('desk-icons'), i;
        box.innerHTML = '';
        box.appendChild(button('dicon', 'app', appById('explorer'), true));
        box.appendChild(button('dicon', 'app', appById('browser'), true));
        for (i = 0; i < games.length; i++) box.appendChild(button('dicon', 'game', games[i], true));
        for (i = 0; i < installed.length; i++) box.appendChild(button('dicon', 'game', installed[i], true));
        box.appendChild(button('dicon', 'app', appById('scores'), true));
    }

    /* ---------------- taskbar ---------------- */

    function renderTaskbar() {
        var box = $('tb-apps');
        box.innerHTML = '';
        var st = el('button', 'tb-btn tb-start');
        st.id = 'tb-start';
        st.setAttribute('data-focus', '');
        st.setAttribute('aria-label', I18n.t('start'));
        Icons.put(st, 'start');
        st.onclick = toggleStart;
        box.appendChild(st);
        for (var i = 0; i < PINNED.length; i++) {
            var b = button('tb-btn', 'app', appById(PINNED[i]), false);
            b.id = 'tb-' + PINNED[i];
            box.appendChild(b);
        }
        $('tray-clock').onclick = function () { Win.open('calendar'); };
        updateTray();
    }

    function updateTray() {
        var d = Input.device();
        Icons.put($('input-indicator'), d === 'pad' ? 'gamepad' : d === 'keyboard' ? 'keyboard' : 'remote');
        $('input-indicator').setAttribute('aria-label', I18n.t(d === 'pad' ? 'inputPad' : d === 'keyboard' ? 'inputKeys' : 'inputRemote'));
        Icons.put($('tray-net'), navigator.onLine === false ? 'wifiOff' : 'wifi');
        Icons.put($('tray-vol'), AudioPrefs.music() + AudioPrefs.sfx() ? 'volume' : 'mute');
    }

    /* ---------------- clock (once a minute, only while visible) ---------------- */

    function locale() { return { en: 'en-US', fr: 'fr-FR', es: 'es-ES', ar: 'ar-MA' }[I18n.lang()] || 'en-US'; }
    function use24() { return Store.get('clock24', I18n.lang() !== 'en'); }
    function two(n) { return (n < 10 ? '0' : '') + n; }
    function timeText(d) {
        var h = d.getHours(), m = two(d.getMinutes());
        if (use24()) return two(h) + ':' + m;
        return ((h + 11) % 12 + 1) + ':' + m + (h < 12 ? ' AM' : ' PM');
    }
    function dateText(d, opts) {
        try { return d.toLocaleDateString(locale(), opts || { day: 'numeric', month: 'numeric', year: 'numeric' }); }
        catch (e) { return d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear(); }
    }

    function tick() {
        clearTimeout(clockTimer);
        var d = new Date();
        $('tray-time').textContent = timeText(d);
        $('tray-date').textContent = dateText(d);
        $('tray-clock').setAttribute('aria-label', timeText(d) + ', ' + dateText(d, { weekday: 'long', day: 'numeric', month: 'long' }));
        clockTimer = setTimeout(tick, (60 - d.getSeconds()) * 1000 + 50);
    }
    function stopClock() { clearTimeout(clockTimer); clockTimer = 0; }

    /* ---------------- Start menu ---------------- */

    function renderStart() {
        var pin = $('start-pinned'), rec = $('start-recent'), i;
        pin.innerHTML = '';
        for (i = 0; i < APPS.length; i++) pin.appendChild(button('stile', 'app', APPS[i], true));
        for (i = 0; i < games.length; i++) pin.appendChild(button('stile', 'game', games[i], true));
        for (i = 0; i < installed.length; i++) pin.appendChild(button('stile', 'game', installed[i], true));
        rec.innerHTML = '';
        var g = gameById(lastPlayed) || games[0];
        if (g) {
            var r = button('srec', 'game', g, false);
            var t = el('span', 'srec-text');
            t.appendChild(el('span', 'srec-title', I18n.pick(g.manifest.title)));
            t.appendChild(el('span', 'srec-sub', I18n.t(gameById(lastPlayed) ? 'lastPlayed' : 'recommendedSub')));
            r.appendChild(t);
            rec.appendChild(r);
        }
        var sc = button('srec', 'app', appById('scores'), false), t2 = el('span', 'srec-text');
        t2.appendChild(el('span', 'srec-title', I18n.t('leaderboards')));
        t2.appendChild(el('span', 'srec-sub', I18n.t('leaderboardsSub')));
        sc.appendChild(t2);
        rec.appendChild(sc);
        Icons.put($('btn-power'), 'power');
        $('btn-power').onclick = function () { App.confirm(I18n.t('exitTitle'), I18n.t('exitText'), App.exitApp); };
    }

    function startOpen() { return !$('start').hidden; }
    function toggleStart() { if (startOpen()) closeStart(); else openStart(); }
    function openStart() {
        renderStart();
        $('start').hidden = false;
        startReturn = Focus.current();
        Focus.push($('start'), $('start-pinned').firstChild);
        A11y.announce(I18n.t('start'));
    }
    // quiet = an item was chosen (focus goes to what opens next)
    function closeStart(quiet) {
        if (!startOpen()) return;
        $('start').hidden = true;
        Focus.pop();
        if (!quiet && $('tb-start')) Focus.focus($('tb-start'));
    }

    /* ---------------- wallpaper ---------------- */

    function wallpaper() { var w = Store.get('wallpaper', 'bloom'); return WALLPAPERS.indexOf(w) >= 0 ? w : 'bloom'; }
    function setWallpaper(w) { Store.set('wallpaper', w); $('wallpaper').className = 'wp wp-' + wallpaper(); }

    /* ---------------- show / hide ---------------- */

    function render() {
        renderIcons();
        renderTaskbar();
        if (startOpen()) renderStart();
        $('wallpaper').className = 'wp wp-' + wallpaper();
        I18n.apply($('desktop'));
    }

    function firstIcon() { return $('desk-icons').firstChild; }

    // focusSel: element or id/selector to focus when the desktop comes back
    function show(focusEl) {
        $('desktop').hidden = false;
        restoreImages();
        updateTray();
        tick();
        Focus.reset();
        Focus.set($('desktop'), focusEl || tileFor(lastPlayed) || firstIcon());
    }
    function hide() {
        closeStart(true);
        $('desktop').hidden = true;
        stopClock();
    }

    // Frees decoded cover images while a game or app runs (RAM on low-end TVs).
    function releaseImages() {
        var imgs = $('desktop').querySelectorAll('img');
        // removeAttribute, not src = '': an empty src fires "error", which used to hide the cover for good
        for (var i = 0; i < imgs.length; i++) imgs[i].removeAttribute('src');
    }
    function restoreImages() {
        var imgs = $('desktop').querySelectorAll('img');
        for (var i = 0; i < imgs.length; i++) {
            if (imgs[i].getAttribute('src')) continue;
            imgs[i].style.visibility = '';
            imgs[i].src = imgs[i].getAttribute('data-src');
        }
    }

    function tileFor(id) { return id ? $('desk-icons').querySelector('[data-game="' + id + '"]') : null; }
    function iconForApp(id) { return $('desk-icons').querySelector('[data-app="' + id + '"]') || $('tb-' + id); }

    function play(g) {
        lastPlayed = g.id;
        Store.set('last_game', g.id);
        markSeen(g);
        if (Win.isOpen()) Win.close(true);
        onPlay(g);
    }

    // another profile is active: its own last game, "new" badges and scores
    function profileChanged() {
        lastPlayed = Store.get('last_game', null);
        var keep = Focus.current() && Focus.current().id;
        render();
        if (keep && $(keep) && !$('desktop').hidden) Focus.focus($(keep));
    }

    // router (main.js): the desktop and the Start menu
    function action(a, repeat) {
        if (a === 'left' || a === 'right' || a === 'up' || a === 'down') Focus.move(a);
        else if (a === 'confirm' && !repeat) { var c = Focus.current(); if (c) c.click(); }
        else if ((a === 'back' || a === 'cancel') && !repeat) {
            if (startOpen()) closeStart();
            else App.confirm(I18n.t('exitTitle'), I18n.t('exitText'), App.exitApp);
        }
    }

    function init(list, playCb) {
        games = list;
        setInstalled(Cloud.apps());          // last good list (works offline); main.js refreshes it
        onPlay = playCb;
        lastPlayed = Store.get('last_game', null);
        render();
        // the Windows key (PC keyboards) opens Start
        document.addEventListener('keydown', function (e) {
            if ((e.keyCode === 91 || e.keyCode === 92) && !$('desktop').hidden && !GameHost.active()) { e.preventDefault(); toggleStart(); }
        });
        window.addEventListener('online', updateTray);
        window.addEventListener('offline', updateTray);
        AudioPrefs.onChange(updateTray);
    }

    return {
        init: init, show: show, hide: hide, render: render, action: action, play: play,
        releaseImages: releaseImages, restoreImages: restoreImages, tileFor: tileFor, iconForApp: iconForApp,
        startOpen: startOpen, openStart: openStart, closeStart: closeStart, profileChanged: profileChanged,
        updateTray: updateTray, tick: tick, wallpaper: wallpaper, setWallpaper: setWallpaper, WALLPAPERS: WALLPAPERS,
        APPS: APPS, appById: appById, coverUrl: coverUrl, dateText: dateText, timeText: timeText, locale: locale,
        setInstalled: setInstalled, fromCloud: fromCloud,
        games: all, builtIn: function () { return games; }, installed: function () { return installed; },
        lastPlayed: function () { return lastPlayed; }
    };
})();
