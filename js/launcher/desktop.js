/* The desktop: wallpaper, desktop icons (apps and games), taskbar with clock, and the Start menu.
 * Light on purpose for TVs: the built-in wallpapers are CSS (admins can add pictures for every My PC), the clock ticks once a minute and
 * only while the desktop is on screen, and game covers are released while an app or game runs. */
var Desktop = (function () {
    'use strict';

    var games = [];             // built-in games: [{ id, manifest, base, bundledBase }]
    var installed = [];         // installed from the App Store (Firebase catalog), same shape + remote
    var onPlay = null;
    var lastPlayed = null, clockTimer = 0, startReturn = null;

    // desktop apps (opened full screen by Win)
    var APPS = [
        { id: 'explorer', icon: 'pc', label: 'thisPc' },
        { id: 'store', icon: 'store', label: 'store' },
        { id: 'browser', icon: 'browser', label: 'browser' },
        { id: 'calculator', icon: 'calculator', label: 'calculator' },
        { id: 'calendar', icon: 'calendar', label: 'calendar' },
        { id: 'scores', icon: 'scores', label: 'leaderboards' },
        { id: 'gamepad', icon: 'controller', label: 'gamepad' },
        { id: 'settings', icon: 'settings', label: 'settings' }
    ];
    var PINNED = ['explorer', 'store', 'browser', 'calendar', 'calculator', 'settings'];
    // the Game controller is for phones and tablets (the TV is what it controls)
    if (window.tizen) APPS = APPS.filter(function (a) { return a.id !== 'gamepad'; });
    else PINNED.splice(5, 0, 'gamepad');
    var WALLPAPERS = ['bloom', 'aurora', 'sunset', 'night', 'aero', 'hills', 'dunes', 'material', 'lagoon'];   // the last five go with the themes (js/launcher/themes.js)

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
            iconUrl: a.icon || '', url: a.url || '', remote: { entry: a.entry, config: a.config || {}, version: a.version || '', touch: a.touch }
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

    // the shortcuts a profile removed from its home screen (they stay in Start): ids as in data-app / data-game
    function hiddenList() { var l = Store.get('home_hidden', []); return Array.isArray(l) ? l : []; }
    function onHome(id) { return id === 'getapp' || hiddenList().indexOf(id) < 0; }
    function setOnHome(id, on) {
        var l = hiddenList(), i = l.indexOf(id);
        if (id === 'getapp' || (on ? i < 0 : i >= 0)) return;
        if (on) l.splice(i, 1); else l.push(id);
        Store.set('home_hidden', l);
        renderIcons();
    }

    function renderIcons() {
        var box = $('desk-icons'), i;
        function add(kind, item) { if (item && onHome(item.id)) box.appendChild(button('dicon', kind, item, true)); }
        box.innerHTML = '';
        add('app', appById('explorer'));
        add('app', appById('browser'));
        add('app', appById('store'));
        add('app', appById('gamepad'));          // phones and tablets only
        box.appendChild(apkButton());
        for (i = 0; i < games.length; i++) add('game', games[i]);
        for (i = 0; i < installed.length; i++) add('game', installed[i]);
        add('app', appById('scores'));
    }

    /* ---------------- shortcut menu: hold OK, long-press or right-click a desktop icon or a Start tile ----------------
     * Open / Remove from (or Add to) the home screen / Uninstall (installed apps; admins only once roles exist). */
    var HOLD_MS = 600, holdEl = null, holdTimer = 0, pTimer = 0, px = 0, py = 0, swallowClick = false;

    function shortcutOf(node) {
        while (node && node.nodeType === 1) {
            if (/(^| )(dicon|stile)( |$)/.test(node.className)) return node;
            node = node.parentNode;
        }
        return null;
    }
    function shortcutId(b) { return b.getAttribute('data-app') || b.getAttribute('data-game'); }
    function canUninstall() { return typeof Profiles === 'undefined' || typeof Profiles.isAdmin !== 'function' || Profiles.isAdmin(); }
    function menuOpen() { return !$('dmenu-wrap').hidden; }

    function openMenu(b) {
        var id = shortcutId(b), g = b.getAttribute('data-game') ? gameById(id) : null, inStart = $('start').contains(b);
        var label = g ? I18n.pick(g.manifest.title) : ((b.querySelector('.lbl') || b).textContent || '');
        if (!id) return;
        if (!inStart) closeStart(true);
        var wrap = $('dmenu-wrap'), m = $('dmenu');
        m.innerHTML = '';
        m.setAttribute('aria-label', label);
        m.appendChild(el('div', 'dm-title', label));
        function item(text, cls, fn) {
            var x = el('button', 'dm-item' + (cls ? ' ' + cls : ''), text);
            x.setAttribute('data-focus', '');
            x.setAttribute('role', 'menuitem');
            x.onclick = fn;
            m.appendChild(x);
        }
        item(I18n.t('storeOpen'), '', function () { closeMenu(); b.click(); });
        if (id !== 'getapp') {
            if (!inStart) item(I18n.t('homeRemove'), '', function () {
                var list = $('desk-icons').children, at = Array.prototype.indexOf.call(list, b);
                closeMenu();
                setOnHome(id, false);
                Focus.focus(list[Math.min(at, list.length - 1)]);
                App.toast(I18n.t('homeRemoved').replace('%s', label));
            });
            else if (!onHome(id)) item(I18n.t('homeAdd'), '', function () {
                closeMenu();
                setOnHome(id, true);
                App.toast(I18n.t('homeAdded').replace('%s', label));
            });
        }
        if (g && g.installed && canUninstall()) item(I18n.t('storeUninstall'), 'dm-danger', function () {
            closeMenu();
            App.confirm(I18n.t('storeUninstallTitle').replace('%s', label), I18n.t('storeUninstallText'), function () {
                Cloud.uninstall(id.replace(/^app-/, ''));       // the desktop and Start redraw through Cloud.onChange
                App.toast(I18n.t('storeUninstalled').replace('%s', label));
                if (startOpen()) { renderStart(); Focus.focus($('start-pinned').firstChild); }
                else Focus.focus(firstIcon());
            });
        });
        wrap.hidden = false;
        // beside the shortcut (stage pixels: the stage is scaled to the window), kept above the taskbar
        var sr = $('stage').getBoundingClientRect(), k = sr.width / 1920 || 1, r = b.getBoundingClientRect();
        var x = (r.right - sr.left) / k + 8, y = (r.top - sr.top) / k, w = m.offsetWidth, h = m.offsetHeight;
        var rtl = document.documentElement.getAttribute('dir') === 'rtl';
        if (rtl || x + w > 1904) x = (r.left - sr.left) / k - w - 8;
        if (x < 16) x = Math.min(1904 - w, (r.right - sr.left) / k + 8);
        y = Math.max(16, Math.min(y, 1080 - $('taskbar').offsetHeight - h - 16));
        m.style.left = Math.round(x) + 'px';
        m.style.top = Math.round(y) + 'px';
        Focus.focus(b);
        Focus.push(m, m.querySelector('.dm-item'));
        A11y.announce(label);
    }
    function closeMenu() {
        if (!menuOpen()) return;
        $('dmenu-wrap').hidden = true;
        $('dmenu').innerHTML = '';
        Focus.pop();
    }
    function cancelHold() { clearTimeout(holdTimer); holdTimer = 0; holdEl = null; clearTimeout(pTimer); pTimer = 0; }

    // touch and mouse: a long press (or a right click) opens the menu and the click that follows is swallowed
    function bindHold(box) {
        box.addEventListener('pointerdown', function (e) {
            var b = e.button ? null : shortcutOf(e.target);
            clearTimeout(pTimer); pTimer = 0;
            if (!b) return;
            px = e.clientX; py = e.clientY;
            pTimer = setTimeout(function () { pTimer = 0; swallowClick = true; openMenu(b); }, HOLD_MS);
        });
        box.addEventListener('pointermove', function (e) {
            if (pTimer && Math.abs(e.clientX - px) + Math.abs(e.clientY - py) > 16) { clearTimeout(pTimer); pTimer = 0; }
        });
        function stop() { clearTimeout(pTimer); pTimer = 0; }
        box.addEventListener('pointerup', stop);
        box.addEventListener('pointercancel', stop);      // the list started scrolling
        box.addEventListener('contextmenu', function (e) {
            var b = shortcutOf(e.target);
            if (!b) return;
            e.preventDefault();
            stop();
            if (!menuOpen()) openMenu(b);
        });
    }

    // Get the app: on every device (owner decision), a shortcut to the latest My PC APK (android-controller/).
    // In a browser it downloads the file; inside the app (window.MyPCNative) it is "Update the app" and opens the phone's
    // browser on an http:// link (the app hands every link that is not https My PC to the browser, which downloads it)
    var APK = 'android-controller/My-PC.apk';
    function apkUrl() {
        var b = (typeof AppBoot !== 'undefined' && AppBoot.base && AppBoot.base()) || '';
        if (!/^https?:/.test(b)) b = location.href.split(/[?#]/)[0].replace(/[^/]*$/, '');
        return b + APK + '?b=' + (typeof AppBoot !== 'undefined' && AppBoot.build ? AppBoot.build() : '');      // the latest, not a cached copy
    }
    function apkButton() {
        var inApp = !!window.MyPCNative, b = button('dicon', 'app', { id: 'getapp', icon: 'getapp', label: inApp ? 'getAppUpdate' : 'getApp' }, true);
        b.onclick = function () {
            closeStart(true);
            // a link clicked inside this tap (a user gesture): the app is always asked about it and hands it to the browser
            var a = el('a');
            a.href = inApp ? apkUrl().replace(/^https:/, 'http:') : apkUrl(); a.rel = 'noopener';
            if (!inApp) a.setAttribute('download', 'My-PC.apk');
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            App.toast(I18n.t('getAppToast'));
        };
        return b;
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
        Icons.put($('input-indicator'), d === 'pad' ? 'gamepad' : d === 'keyboard' ? 'keyboard' : d === 'mouse' ? 'mouse' : 'remote');
        $('input-indicator').setAttribute('aria-label', I18n.t(d === 'pad' ? 'inputPad' : d === 'keyboard' ? 'inputKeys' : d === 'mouse' ? 'inputMouse' : 'inputRemote'));
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

    // built-in CSS ones + the pictures admins add for every My PC (App Store Manager > Settings, js/core/global-settings.js)
    function wallpapers() {
        var out = [], i;
        for (i = 0; i < WALLPAPERS.length; i++) out.push({ id: WALLPAPERS[i], title: I18n.t('wp_' + WALLPAPERS[i]) });
        var pics = typeof GlobalSettings !== 'undefined' ? GlobalSettings.wallpapers() : [];
        for (i = 0; i < pics.length; i++) out.push(pics[i]);
        return out;
    }
    function findWallpaper(id) { var l = wallpapers(); for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }
    function wallpaper() {
        var def = typeof GlobalSettings !== 'undefined' ? GlobalSettings.defaultWallpaper() : '';
        if (!findWallpaper(def)) def = 'bloom';
        var w = Store.get('wallpaper', def);
        return findWallpaper(w) ? w : def;
    }
    function setWallpaper(w) { Store.set('wallpaper', w); paintWallpaper(); }
    // a picture shows only once it loaded (the Bloom colours meanwhile, and if the address is broken)
    var wpShown = '';
    function paintWallpaper() {
        var box = $('wallpaper'), w = findWallpaper(wallpaper());
        if (!box || !w || wpShown === w.id) return;
        wpShown = w.id;
        if (!w.url) { box.className = 'wp wp-' + w.id; box.style.backgroundImage = ''; return; }
        if (box.className.indexOf('wp-img') < 0) { box.className = 'wp wp-bloom'; box.style.backgroundImage = ''; }
        var im = new Image(), id = w.id;
        im.onload = function () { if (wpShown !== id) return; box.className = 'wp wp-img'; box.style.backgroundImage = 'url("' + w.url + '")'; };
        im.onerror = function () { if (wpShown === id) { box.className = 'wp wp-bloom'; box.style.backgroundImage = ''; } };
        im.src = w.url;
    }

    /* ---------------- show / hide ---------------- */

    function render() {
        renderIcons();
        renderTaskbar();
        if (startOpen()) renderStart();
        paintWallpaper();
        I18n.apply($('desktop'));
        Themes.apply();
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
        cancelHold();
        closeMenu();
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

    // router (main.js): the desktop, the Start menu and the shortcut menu. pressed === false: OK was let go
    // (OK on a shortcut opens it when let go; held for HOLD_MS it opens the shortcut menu instead)
    function action(a, repeat, pressed) {
        if (pressed === false) {
            if (a !== 'confirm' || !holdTimer) return;
            var h = holdEl;
            cancelHold();
            if (h && h.parentNode) h.click();
            return;
        }
        if (a === 'left' || a === 'right' || a === 'up' || a === 'down') Focus.move(a);
        else if (a === 'confirm' && !repeat) {
            var c = Focus.current();
            cancelHold();
            if (c && !menuOpen() && shortcutOf(c) === c) {
                holdEl = c;
                holdTimer = setTimeout(function () { var b = holdEl; holdTimer = 0; holdEl = null; if (b && b.parentNode) openMenu(b); }, HOLD_MS);
            } else if (c) c.click();
        }
        else if (a === 'guide' && !repeat) { closeMenu(); toggleStart(); }   // the Guide key = the Windows key
        else if ((a === 'back' || a === 'cancel') && !repeat) {
            if (menuOpen()) closeMenu();
            else if (startOpen()) closeStart();
            else App.confirm(I18n.t('exitTitle'), I18n.t('exitText'), App.exitApp);
        }
    }

    function init(list, playCb) {
        games = list;
        setInstalled(Cloud.apps());          // last good list (works offline); main.js refreshes it
        onPlay = playCb;
        lastPlayed = Store.get('last_game', null);
        render();
        bindHold($('desk-icons'));
        bindHold($('start-pinned'));
        $('dmenu-wrap').addEventListener('click', function (e) { if (e.target === this) closeMenu(); });
        document.addEventListener('pointerdown', function () { swallowClick = false; }, true);
        document.addEventListener('click', function (e) {
            if (!swallowClick) return;
            swallowClick = false;
            e.preventDefault(); e.stopPropagation();
        }, true);
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
        onHome: onHome, setOnHome: setOnHome, openMenu: openMenu, closeMenu: closeMenu, menuOpen: menuOpen,
        updateTray: updateTray, tick: tick, wallpaper: wallpaper, setWallpaper: setWallpaper, wallpapers: wallpapers, paintWallpaper: paintWallpaper, WALLPAPERS: WALLPAPERS,
        APPS: APPS, appById: appById, coverUrl: coverUrl, dateText: dateText, timeText: timeText, locale: locale,
        setInstalled: setInstalled, fromCloud: fromCloud,
        games: all, builtIn: function () { return games; }, installed: function () { return installed; },
        lastPlayed: function () { return lastPlayed; }
    };
})();
