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
 *    after a click. The toolbar stays reachable with the mouse, or Guide on a gamepad. */
(function () {
    'use strict';

    var LINKS = [
        { name: 'Wikipedia', url: 'https://{lang}.m.wikipedia.org/', color: '#f3f3f3', fg: '#202020', letter: 'W' },
        { name: 'Wiktionary', url: 'https://{lang}.m.wiktionary.org/', color: '#cfe3ff', fg: '#1d3f73', letter: 'Wt' },
        { name: 'OpenStreetMap', url: 'https://www.openstreetmap.org/export/embed.html?bbox=-7.75%2C33.48%2C-7.45%2C33.65&layer=mapnik', color: '#7ebc6f', fg: '#fff', letter: 'M' },
        { name: 'Wikivoyage', url: 'https://{lang}.m.wikivoyage.org/', color: '#2a8fd8', fg: '#fff', letter: 'V' },
        { name: 'Arcade', url: 'https://imad-os.github.io/g/', color: '#2b2f7a', fg: '#ffd23f', letter: 'A' }
    ];
    var PAGE_H = 4000, STEP = 300;

    var body, bar, addr, view, frame, start, back, fwd, modeBtn, hist = [], pos = -1, scrollY = 0, native = false, pointerIn = false;

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
        Keyboard.open({ title: t('addressHint'), max: 60, mode: 'url', ok: t('go') }, function (s) { load(toUrl(s), true); Focus.focus(view); });
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
        var grid = el('div', 'br-links');
        for (var i = 0; i < LINKS.length; i++) {
            var L = LINKS[i], b = el('button', 'br-link');
            b.setAttribute('data-focus', '');
            var ic = el('span', 'br-link-ic', L.letter);
            ic.style.backgroundColor = L.color; ic.style.color = L.fg;
            b.appendChild(ic); b.appendChild(el('span', 'br-link-name', L.name));
            b.onclick = (function (u) { return function () { load(u.replace('{lang}', wikiLang()), true); Focus.focus(view); }; })(L.url);
            grid.appendChild(b);
        }
        start.appendChild(grid);
        start.appendChild(el('p', 'br-note', t('frameNote')));
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
        var shown = !!frame && !view.hidden;
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
        if (pos > 0) { pos--; load(hist[pos], false); return true; }
        if (pos === 0) { showStart(); Focus.focus(start.querySelector('[data-focus]')); return true; }
        return false;
    }

    Win.register('browser', {
        icon: 'browser',
        title: function () { return t('browser'); },
        open: function (b) {
            body = b; hist = []; pos = -1; native = wantNative();
            bar = el('div', 'br-bar');
            back = iconBtn('back', t('back'), function () { backKey(); });
            fwd = iconBtn('forward', t('forward'), function () { if (pos < hist.length - 1) { pos++; load(hist[pos], false); } });
            bar.appendChild(back); bar.appendChild(fwd);
            bar.appendChild(iconBtn('reload', t('reload'), function () { if (pos >= 0) load(hist[pos], false); }));
            bar.appendChild(iconBtn('home', t('home'), function () { showStart(); }));
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
            return start.querySelector('[data-focus]');
        },
        close: function () {
            window.removeEventListener('blur', onWindowBlur);
            // free the page completely
            if (frame) { try { frame.src = 'about:blank'; } catch (e) {} if (frame.parentNode) frame.parentNode.removeChild(frame); }
            frame = null; body = bar = addr = view = start = back = fwd = modeBtn = null; hist = []; pos = -1; pointerIn = false;
        },
        action: action,
        back: backKey
    });
})();
