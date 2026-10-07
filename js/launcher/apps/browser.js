/* Browser app: address bar (on-screen keyboard), back / forward / reload / home, quick links.
 * Pages load in one sandboxed iframe that is destroyed when the app closes. The remote never
 * gives focus to the page (it would keep the Back key): up/down scroll it from the outside by
 * moving a tall iframe inside a clipped viewport. Some websites refuse to be shown in a frame. */
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

    var body, addr, view, frame, start, back, fwd, hist = [], pos = -1, scrollY = 0;

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
        if (!frame) {
            frame = document.createElement('iframe');
            frame.className = 'br-frame';
            frame.setAttribute('tabindex', '-1');
            frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
            frame.setAttribute('referrerpolicy', 'no-referrer');
            view.insertBefore(frame, view.firstChild);
        }
        frame.style.height = PAGE_H + 'px';
        frame.style.webkitTransform = frame.style.transform = 'translateY(0)';
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

    function scroll(d) {
        var max = PAGE_H - view.offsetHeight;
        var y = Math.max(0, Math.min(max, scrollY + d * STEP));
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

    function action(a, repeat) {
        if (inView() && (a === 'up' || a === 'down')) {
            if (scroll(a === 'down' ? 1 : -1)) return true;
            return a === 'down';      // at the top, Up goes to the toolbar
        }
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
            body = b; hist = []; pos = -1;
            var bar = el('div', 'br-bar');
            back = iconBtn('back', t('back'), function () { backKey(); });
            fwd = iconBtn('forward', t('forward'), function () { if (pos < hist.length - 1) { pos++; load(hist[pos], false); } });
            bar.appendChild(back); bar.appendChild(fwd);
            bar.appendChild(iconBtn('reload', t('reload'), function () { if (pos >= 0) load(hist[pos], false); }));
            bar.appendChild(iconBtn('home', t('home'), function () { showStart(); }));
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
            updateButtons();
            return start.querySelector('[data-focus]');
        },
        close: function () {
            // free the page completely
            if (frame) { try { frame.src = 'about:blank'; } catch (e) {} if (frame.parentNode) frame.parentNode.removeChild(frame); }
            frame = null; body = addr = view = start = back = fwd = null; hist = []; pos = -1;
        },
        action: action,
        back: backKey
    });
})();
