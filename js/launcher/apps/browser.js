/* Browser app: address bar (on-screen keyboard), back / forward / reload / home, quick links.
 * Pages load in one sandboxed iframe that is destroyed when the app closes. Some websites refuse
 * to be shown in a frame.
 *
 * A web page in a frame that has the keyboard focus keeps every key, Back included, and My PC can
 * not take them back (cross-origin). So there are two modes:
 *  - remote mode (default): the frame ignores the pointer (it can not get focus by a click) and a page
 *    script that grabs focus loses it again. Up/Down, Channel Up/Down (PageUp/PageDown) scroll the page
 *    from the outside by moving a tall iframe inside a clipped viewport; Guide (F6) goes to the toolbar.
 *  - mouse mode (default when a mouse was used): the page is a normal frame: click, mouse wheel, keys
 *    after a click. The toolbar stays reachable with the mouse, or Guide on a gamepad.
 *
 * Bookmarks (per profile, key br_marks, backed up like every profile key): tiles on the start page, YouTube / Facebook /
 * Wikipedia / OpenStreetMap until the user changes them. Save one with the star on the toolbar or the + button while a page
 * shows, or the "Add bookmark" tile. Hold OK, + , a long press or a right click on a tile: Open / Rename / Change the address /
 * Move / Remove. Sites known to refuse frames (YouTube, Facebook...) open outside My PC: the YouTube app or the TV's own web
 * browser on the TV (privilege application.launch), a new tab elsewhere (the Android app hands it to the phone). */
(function () {
    'use strict';

    // bookmarks of a profile that never changed them ({lang} = the language of My PC)
    var DEFAULTS = [
        { n: 'YouTube', u: 'https://www.youtube.com/' },
        { n: 'Facebook', u: 'https://www.facebook.com/' },
        { n: 'Wikipedia', u: 'https://{lang}.m.wikipedia.org/' },
        { n: 'OpenStreetMap', u: 'https://www.openstreetmap.org/export/embed.html?bbox=-7.75%2C33.48%2C-7.45%2C33.65&layer=mapnik' }
    ];
    // tile looks of well-known sites [background, letter colour, letter]; others get a colour from their address
    var LOOKS = {
        'youtube.com': ['#ff0033', '#fff', '\u25B6'], 'facebook.com': ['#1877f2', '#fff', 'f'], 'wikipedia.org': ['#f3f3f3', '#202020', 'W'],
        'openstreetmap.org': ['#7ebc6f', '#fff', 'M'], 'instagram.com': ['#d62976', '#fff', 'I'], 'x.com': ['#000', '#fff', 'X']
    };
    var COLORS = ['#2a8fd8', '#7c5cff', '#e0663a', '#1aa37a', '#c2417a', '#c79a1d', '#4a6fd8', '#8a4fd0'];
    // sites that refuse to be shown in a frame (X-Frame-Options / CSP): they open outside My PC
    var NO_FRAME = /(^|\.)(youtube\.com|youtu\.be|facebook\.com|fb\.com|instagram\.com|x\.com|twitter\.com|google\.[a-z.]+|netflix\.com|tiktok\.com|linkedin\.com|whatsapp\.com|amazon\.[a-z.]+|github\.com|twitch\.tv)$/i;
    var YOUTUBE_TV = '111299001912';      // the YouTube app on Samsung TVs
    var MAX_MARKS = 24, HOLD_MS = 600;
    var PAGE_H = 4000, STEP = 300;

    var body, bar, addr, view, frame, start, back, fwd, modeBtn, starBtn, grid, menuWrap = null, holdTimer = 0, holdEl = null, swallow = false,
        hist = [], pos = -1, scrollY = 0, native = false, pointerIn = false;

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }
    function t(k) { return I18n.t(k); }
    function wikiLang() { return { en: 'en', fr: 'fr', es: 'es', ar: 'ar' }[I18n.lang()] || 'en'; }

    // text typed in the address bar -> URL (a search on Wikipedia when it is not an address)
    function toUrl(s) {
        s = s.replace(/^\s+|\s+$/g, '');
        if (/^https?:\/\//i.test(s)) return s;
        if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(s)) return 'https://' + s;
        return 'https://' + wikiLang() + '.m.wikipedia.org/w/index.php?search=' + encodeURIComponent(s);
    }

    function tf(k, v) { return t(k).replace('%s', v); }
    function hostOf(u) { var m = /^https?:\/\/([^\/?#:]+)/i.exec(u || ''); return m ? m[1].toLowerCase().replace(/^(www|m)\./, '') : ''; }
    function real(u) { return String(u).replace('{lang}', wikiLang()); }

    /* ---------------- bookmarks ---------------- */
    function marks() {
        var v = Store.get('br_marks', null);
        return Array.isArray(v) ? v : DEFAULTS.slice();
    }
    function saveMarks(list) { Store.set('br_marks', list); }
    function markIndex(url) {
        var list = marks(), u = String(url || '').replace(/\/+$/, '');
        for (var i = 0; i < list.length; i++) if (real(list[i].u).replace(/\/+$/, '') === u) return i;
        return -1;
    }
    function look(u) {
        var h = hostOf(real(u)), k;
        for (k in LOOKS) if (h === k || h.slice(-k.length - 1) === '.' + k) return LOOKS[k];
        var sum = 0;
        for (var i = 0; i < h.length; i++) sum = (sum * 31 + h.charCodeAt(i)) % 997;
        return [COLORS[sum % COLORS.length], '#fff', ''];
    }
    function nameFor(u) { var h = hostOf(u); return h ? h.charAt(0).toUpperCase() + h.slice(1) : u; }

    function addMark(url, name) {
        var list = marks();
        if (markIndex(url) >= 0) return true;
        if (list.length >= MAX_MARKS) { App.toast(t('brMarksFull'), { kind: 'warn' }); return false; }
        list.push({ n: name || nameFor(url), u: url });
        saveMarks(list);
        App.toast(tf('brMarked', name || nameFor(url)), { kind: 'ok' });
        return true;
    }
    // the page that shows now: in the bookmarks or out of them (star, + button)
    function toggleMark() {
        if (pos < 0) return;
        var url = hist[pos], i = markIndex(url), list = marks();
        if (i >= 0) {
            var n = list[i].n;
            list.splice(i, 1); saveMarks(list);
            App.toast(tf('brUnmarked', n), { kind: 'info' });
        } else addMark(url);
        updateButtons();
        renderMarks();
    }

    // sites that refuse frames: the YouTube app / the TV's web browser, a new tab on a computer
    function openOutside(url) {
        var yt = /(^|\.)(youtube\.com|youtu\.be)$/i.test(hostOf(url));
        var ti = window.tizen && tizen.application;
        if (ti) {
            var fail = function () { App.toast(t('brOutFail'), { kind: 'err' }); };
            var browse = function () {
                try {
                    var ctl = new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/view', url);
                    tizen.application.launchAppControl(ctl, null, function () {}, function () {
                        try { tizen.application.launchAppControl(ctl, 'org.tizen.browser', function () {}, fail); } catch (e) { fail(); }
                    });
                } catch (e) { fail(); }
            };
            App.toast(t(yt ? 'brOutYt' : 'brOutTv'), { kind: 'info' });
            if (yt) { try { tizen.application.launch(YOUTUBE_TV, function () {}, browse); return; } catch (e) {} }
            browse();
            return;
        }
        App.toast(t('brOutTab'), { kind: 'info' });
        try { window.open(url, '_blank', 'noopener'); } catch (e) {}
    }
    // every page the user asks for goes through here
    function go(url) {
        if (NO_FRAME.test(hostOf(url))) { openOutside(url); return; }
        load(url, true);
        Focus.focus(view);
    }

    function iconBtn(icon, label, fn) {
        var b = el('button', 'icon-btn');
        Icons.put(b, icon);
        b.setAttribute('data-focus', '');
        b.setAttribute('aria-label', label);
        b.onclick = fn;
        return b;
    }

    // mouse mode: the setting, or (not set) whether a mouse / pointer has been used on this TV
    function wantNative() { var v = Store.get('br_native', null); return v === null ? !!Input.seen().mouse : !!v; }

    function applyMode() {
        if (modeBtn) {
            Icons.put(modeBtn, native ? 'mouse' : 'remote');
            modeBtn.setAttribute('aria-label', t(native ? 'brSwitchRemote' : 'brSwitchMouse'));
        }
        if (!frame) return;
        scrollY = 0;
        if (native) {
            frame.style.height = view.offsetHeight + 'px';           // the page scrolls itself (mouse wheel, touch)
            frame.style.pointerEvents = '';
            frame.setAttribute('tabindex', '0');
        } else {
            frame.style.height = PAGE_H + 'px';                      // scrolled from the outside
            frame.style.pointerEvents = 'none';                      // a click can not give the page the keyboard
            frame.setAttribute('tabindex', '-1');
        }
        frame.style.webkitTransform = frame.style.transform = 'translateY(0)';
    }

    function toggleMode() {
        native = !native;
        Store.set('br_native', native);
        applyMode();
        App.toast(t(native ? 'brModeMouse' : 'brModeRemote'));
        if (!native && frame && document.activeElement === frame) Focus.focus(view);
    }

    function updateButtons() {
        var on = pos >= 0 && markIndex(hist[pos]) >= 0;
        starBtn.disabled = pos < 0;
        Icons.put(starBtn, on ? 'star' : 'staro');
        starBtn.setAttribute('aria-label', t(on ? 'brUnmarkThis' : 'brMarkThis'));
        starBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
        back.disabled = pos < 0;
        fwd.disabled = pos >= hist.length - 1;
        addr.textContent = pos >= 0 ? hist[pos] : t('addressHint');
        addr.className = 'br-addr' + (pos >= 0 ? '' : ' br-addr-empty');
    }

    function load(url, push) {
        if (push) { hist.length = pos + 1; hist.push(url); pos = hist.length - 1; }
        start.hidden = true;
        view.hidden = false;
        scrollY = 0;
        pointerIn = false;                    // a stale pointer position must not count as "the user clicked"
        if (!frame) {
            frame = document.createElement('iframe');
            frame.className = 'br-frame';
            frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
            frame.setAttribute('referrerpolicy', 'no-referrer');
            frame.addEventListener('mouseenter', function () { pointerIn = true; });
            frame.addEventListener('mouseleave', function () { pointerIn = false; });
            view.insertBefore(frame, view.firstChild);
        }
        applyMode();
        frame.src = url;
        updateButtons();
        A11y.announce(t('loading') + ' ' + url);
    }

    function showStart() {
        pos = -1; hist.length = 0;
        if (frame) { frame.src = 'about:blank'; }
        view.hidden = true;
        start.hidden = false;
        updateButtons();
    }

    function scroll(d, page) {
        if (native || !frame) return false;
        var max = PAGE_H - view.offsetHeight;
        var y = Math.max(0, Math.min(max, scrollY + d * (page ? Math.round(view.offsetHeight * 0.85) : STEP)));
        if (y === scrollY) return false;
        scrollY = y;
        frame.style.webkitTransform = frame.style.transform = 'translateY(' + (-y) + 'px)';
        return true;
    }

    function typeAddress() {
        Keyboard.open({ title: t('addressHint'), max: 60, mode: 'url', ok: t('go') }, function (s) { if (String(s || '').trim()) go(toUrl(s)); });
    }

    function tile(m, i) {
        var L = look(m.u), b = el('button', 'br-link');
        b.setAttribute('data-focus', '');
        b.setAttribute('data-mark', String(i));
        var ic = el('span', 'br-link-ic', L[2] || (m.n || '?').charAt(0).toUpperCase());
        ic.style.backgroundColor = L[0]; ic.style.color = L[1];
        b.appendChild(ic); b.appendChild(el('span', 'br-link-name', m.n));
        b.onclick = function () { if (swallow) { swallow = false; return; } go(real(m.u)); };
        return b;
    }
    // the tiles; keep: index of the tile to focus afterwards (-1 = Add)
    function renderMarks(keep) {
        if (!grid) return;
        var list = marks(), had = grid.contains(document.activeElement);
        grid.innerHTML = '';
        for (var i = 0; i < list.length; i++) grid.appendChild(tile(list[i], i));
        var add = el('button', 'br-link br-add');
        add.setAttribute('data-focus', '');
        var ai = el('span', 'br-link-ic br-add-ic'); Icons.put(ai, 'plus');
        add.appendChild(ai); add.appendChild(el('span', 'br-link-name', t('brAddMark')));
        add.onclick = addByAddress;
        grid.appendChild(add);
        if (keep !== undefined || had) {
            var k = keep === undefined || keep < 0 ? grid.lastChild : grid.children[Math.min(keep, grid.children.length - 1)];
            Focus.focus(k);
        }
    }
    function addByAddress() {
        if (marks().length >= MAX_MARKS) { App.toast(t('brMarksFull'), { kind: 'warn' }); return; }
        Keyboard.open({ title: t('brAddMark'), max: 80, mode: 'url', ok: t('save') }, function (s) {
            s = String(s || '').trim();
            if (!s) return;
            var u = toUrl(s);
            if (markIndex(u) >= 0) { App.toast(tf('brMarked', nameFor(u)), { kind: 'ok' }); return; }
            if (addMark(u)) renderMarks(marks().length - 1);
        });
    }

    /* the menu of a bookmark: hold OK, +, a long press or a right click */
    function closeMenu() {
        if (!menuWrap) return false;
        if (menuWrap.parentNode) menuWrap.parentNode.removeChild(menuWrap);
        menuWrap = null;
        Focus.pop();
        return true;
    }
    function openMenu(b) {
        var i = +b.getAttribute('data-mark'), list = marks(), m = list[i];
        if (!m) return;
        closeMenu();
        menuWrap = el('div', 'dmenu-wrap br-menu-wrap');
        var box = el('div', 'dmenu br-menu');
        box.setAttribute('role', 'menu');
        box.setAttribute('aria-label', m.n);
        box.appendChild(el('div', 'dm-title', m.n));
        function item(text, fn, cls) {
            var x = el('button', 'dm-item' + (cls ? ' ' + cls : ''), text);
            x.setAttribute('data-focus', '');
            x.setAttribute('role', 'menuitem');
            x.onclick = function () { closeMenu(); fn(); };
            box.appendChild(x);
        }
        function move(d) { var l = marks(), j = i + d, x = l[i]; l[i] = l[j]; l[j] = x; saveMarks(l); renderMarks(j); }
        item(t('storeOpen'), function () { go(real(m.u)); });
        item(t('brRename'), function () {
            Keyboard.open({ title: t('brRename'), text: m.n, max: 30, mode: 'title' }, function (v) {
                v = String(v || '').trim(); if (!v) return;
                var l = marks(); if (!l[i]) return;
                l[i].n = v; saveMarks(l); renderMarks(i);
            });
        });
        item(t('brEditUrl'), function () {
            Keyboard.open({ title: t('brEditUrl'), text: real(m.u), max: 80, mode: 'url', ok: t('save') }, function (v) {
                v = String(v || '').trim(); if (!v) return;
                var l = marks(); if (!l[i]) return;
                l[i].u = toUrl(v); saveMarks(l); renderMarks(i);
            });
        });
        var rtl = document.documentElement.getAttribute('dir') === 'rtl';
        if (i > 0) item(t(rtl ? 'brMoveRight' : 'brMoveLeft'), function () { move(-1); });
        if (i < list.length - 1) item(t(rtl ? 'brMoveLeft' : 'brMoveRight'), function () { move(1); });
        item(t('brRemove'), function () {
            var l = marks(); l.splice(i, 1); saveMarks(l);
            App.toast(tf('brUnmarked', m.n), { kind: 'info' });
            renderMarks(Math.min(i, l.length));
            if (pos >= 0) updateButtons();
        }, 'dm-danger');
        menuWrap.appendChild(box);
        menuWrap.addEventListener('pointerdown', function (e) { if (e.target === menuWrap) { closeMenu(); Focus.focus(b); } });
        body.appendChild(menuWrap);
        Focus.focus(b);
        Focus.push(box, box.querySelector('.dm-item'));
        A11y.announce(m.n);
    }
    function isMark(n) { return !!n && n.hasAttribute && n.hasAttribute('data-mark'); }
    function holdEnd() {
        if (!holdTimer) return;
        clearTimeout(holdTimer); holdTimer = 0;
        var x = holdEl; holdEl = null;
        if (x && x.parentNode) x.click();
    }
    // touch / mouse: a long press or a right click
    function bindHold(root) {
        var pt = 0, px = 0, py = 0;
        function target(n) { while (n && n !== root) { if (isMark(n)) return n; n = n.parentNode; } return null; }
        function stop() { clearTimeout(pt); pt = 0; }
        root.addEventListener('pointerdown', function (e) {
            var b = e.button ? null : target(e.target);
            stop();
            swallow = false;                 // the click after a long press went to the menu's backdrop
            if (!b) return;
            px = e.clientX; py = e.clientY;
            pt = setTimeout(function () { pt = 0; swallow = true; openMenu(b); }, HOLD_MS);
        });
        root.addEventListener('pointermove', function (e) { if (pt && Math.abs(e.clientX - px) + Math.abs(e.clientY - py) > 16) stop(); });
        root.addEventListener('pointerup', stop);
        root.addEventListener('pointercancel', stop);
        root.addEventListener('contextmenu', function (e) { var b = target(e.target); if (!b) return; e.preventDefault(); stop(); openMenu(b); });
    }

    function buildStart() {
        start = el('div', 'br-start');
        start.appendChild(el('h3', 'br-hello', t('browserHello')));
        var s = el('button', 'br-search');
        s.setAttribute('data-focus', '');
        var si = el('span', 'br-search-ic'); Icons.put(si, 'search');
        s.appendChild(si); s.appendChild(el('span', '', t('addressHint')));
        s.onclick = typeAddress;
        start.appendChild(s);
        start.appendChild(el('h4', 'br-marks-t', t('brMarks')));
        grid = el('div', 'br-links');
        grid.setAttribute('role', 'list');
        bindHold(grid);
        renderMarks();
        start.appendChild(grid);
        start.appendChild(el('p', 'br-note', t('brMarkHint')));
        start.appendChild(el('p', 'br-note br-note2', t('frameNote')));
        return start;
    }

    function inView() { var c = Focus.current(); return c && c.className.indexOf('br-view') >= 0; }

    // the buttons on top: the first one that can be used
    function toolbarTarget() {
        var list = bar.querySelectorAll('[data-focus]');
        for (var i = 0; i < list.length; i++) if (!list[i].disabled) return list[i];
        return null;
    }
    function inToolbar() { var c = Focus.current(); return !!c && bar.contains(c); }

    // a page script took the keyboard from My PC (autofocus, focus()): take it back, unless the user clicked the page
    function onWindowBlur() {
        setTimeout(function () {
            if (!frame || native || pointerIn || document.activeElement !== frame) return;
            Focus.focus(view);
        }, 0);
    }

    function action(a, repeat, dev) {
        var shown = !!frame && !view.hidden, cur = Focus.current();
        if (menuWrap) {
            if (a === 'menu') { if (!repeat) closeMenu(); return true; }
            return false;                          // arrows / OK move in the menu (Win), Back closes it (backKey)
        }
        // + : the menu of a bookmark, or (a page shows) this page in / out of the bookmarks
        if (a === 'menu') {
            if (!repeat) { if (isMark(cur)) openMenu(cur); else if (pos >= 0) toggleMark(); }
            return true;
        }
        // hold OK on a bookmark: its menu; let go before: open it (release)
        if (a === 'confirm' && isMark(cur)) {
            if (!repeat) {
                clearTimeout(holdTimer); holdEl = cur;
                holdTimer = setTimeout(function () { holdTimer = 0; var x = holdEl; holdEl = null; if (x && x.parentNode) openMenu(x); }, HOLD_MS);
            }
            return true;
        }
        // Guide / F6: to the buttons on top, and back to the page from there
        if (a === 'guide') {
            if (!repeat) {
                if (inToolbar() && shown) Focus.focus(view);
                else if (inToolbar()) Focus.focus(start.querySelector('[data-focus]'));
                else Focus.focus(toolbarTarget());
            }
            return true;
        }
        // Channel Up / Down, PageUp / PageDown, LB / RB: a page at a time
        if (a === 'pageUp' || a === 'pageDown') { if (shown) scroll(a === 'pageDown' ? 1 : -1, true); return true; }
        // mouse wheel: scrolls the page wherever the focus is
        if (dev === 'mouse' && shown && !native && (a === 'up' || a === 'down')) { scroll(a === 'down' ? 1 : -1); return true; }
        if (inView() && (a === 'up' || a === 'down')) {
            if (scroll(a === 'down' ? 1 : -1)) return true;
            return a === 'down';      // at the top, Up goes to the toolbar
        }
        // mouse mode: OK on the page gives the page the keyboard (arrows, PageDown... scroll it natively)
        if (inView() && native && a === 'confirm' && !repeat) { frame.focus(); App.toast(t('brPageFocus')); return true; }
        return false;
    }

    function backKey() {
        if (closeMenu()) return true;
        if (pos > 0) { pos--; load(hist[pos], false); return true; }
        if (pos === 0) { showStart(); Focus.focus(start.querySelector('[data-focus]')); return true; }
        return false;
    }

    Win.register('browser', {
        icon: 'browser',
        title: function () { return t('browser'); },
        open: function (b, arg) {
            body = b; hist = []; pos = -1; native = wantNative();
            bar = el('div', 'br-bar');
            back = iconBtn('back', t('back'), function () { backKey(); });
            fwd = iconBtn('forward', t('forward'), function () { if (pos < hist.length - 1) { pos++; load(hist[pos], false); } });
            bar.appendChild(back); bar.appendChild(fwd);
            bar.appendChild(iconBtn('reload', t('reload'), function () { if (pos >= 0) load(hist[pos], false); }));
            bar.appendChild(iconBtn('home', t('home'), function () { showStart(); }));
            starBtn = iconBtn('staro', t('brMarkThis'), toggleMark);
            bar.appendChild(starBtn);
            modeBtn = iconBtn('remote', '', toggleMode);
            bar.appendChild(modeBtn);
            addr = el('button', 'br-addr');
            addr.setAttribute('data-focus', '');
            addr.onclick = typeAddress;
            bar.appendChild(addr);
            body.appendChild(bar);
            view = el('div', 'br-view');
            view.setAttribute('data-focus', '');
            view.setAttribute('tabindex', '0');
            view.setAttribute('aria-label', t('pageHint'));
            view.hidden = true;
            body.appendChild(view);
            body.appendChild(buildStart());
            applyMode();
            updateButtons();
            window.addEventListener('blur', onWindowBlur);
            // Win.open('browser', 'https://…'): opens on that page (a push notification's link)
            if (typeof arg === 'string' && /^https:\/\//.test(arg)) {
                if (!NO_FRAME.test(hostOf(arg))) { load(arg, true); return view; }
                openOutside(arg);
            }
            return start.querySelector('[data-focus]');
        },
        close: function () {
            window.removeEventListener('blur', onWindowBlur);
            clearTimeout(holdTimer); holdTimer = 0; holdEl = null;
            if (menuWrap) closeMenu();
            // free the page completely
            if (frame) { try { frame.src = 'about:blank'; } catch (e) {} if (frame.parentNode) frame.parentNode.removeChild(frame); }
            frame = null; body = bar = addr = view = start = back = fwd = modeBtn = starBtn = grid = null; hist = []; pos = -1; pointerIn = false;
        },
        action: action,
        release: function (a) { if (a === 'confirm') holdEnd(); },
        back: backKey
    });
})();
