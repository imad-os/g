/* Notify: the one notification look of My PC (Windows style toasts).
 * A small card rises from the bottom right corner, stays a few seconds, then slides back down.
 * The background follows the kind: ok (green: connected), err (red: disconnected, failed),
 * warn (amber), info (default dark). Up to 3 stay on screen, the newest at the bottom.
 *
 * Notify.show('text') or Notify.show({
 *     text: 'Gamepad connected',     // the message (required unless title is set)
 *     title: 'Soccer live',          // optional first line (the app or service name)
 *     kind: 'ok' | 'err' | 'warn' | 'info',
 *     image: 'https://…/logo.png',   // optional picture in place of the status icon
 *     id: 'net',                     // same id = the card is updated in place (no second card)
 *     timeout: 4000,                 // ms on screen; 0 = stays until Notify.hide(id)
 *     onClick: fn,                   // touch / mouse click on the card (the card then closes)
 *     silent: true                   // no sound (the sound is the profile's choice: Control Panel > Sound)
 * }) -> the card's id.  Notify.hide(id), Notify.clear().
 *
 * Built for low-end TVs: only transform / opacity animate (no blur, no layout per frame),
 * no timers while nothing is shown, cards are removed from the DOM when gone.
 * Voice Guide: err cards are role="alert", the others go through A11y.announce. */
var Notify = (function () {
    'use strict';
    var MAX = 3, OUT_MS = 260, KINDS = { ok: 1, err: 1, warn: 1, info: 1 };
    var box = null, cards = [], seq = 0;

    function root() {
        if (!box) box = document.getElementById('toast');
        return box;
    }
    function find(id) {
        for (var i = 0; i < cards.length; i++) if (cards[i].id === id) return cards[i];
        return null;
    }
    function fill(c, o) {
        var kind = KINDS[o.kind] ? o.kind : 'info', el = c.el, html;
        el.className = 'nt nt-' + kind + (c.shown ? ' in' : '');
        if (kind === 'err') el.setAttribute('role', 'alert'); else el.removeAttribute('role');
        el.innerHTML = '';
        if (o.image) {
            html = document.createElement('img');
            html.className = 'nt-img'; html.alt = ''; html.src = String(o.image);
            html.onerror = function () { this.style.display = 'none'; };
        } else {
            html = document.createElement('span');
            html.className = 'nt-ic';
            html.setAttribute('aria-hidden', 'true');
        }
        el.appendChild(html);
        var body = document.createElement('div');
        body.className = 'nt-body';
        if (o.title) { var ti = document.createElement('div'); ti.className = 'nt-title'; ti.textContent = String(o.title); body.appendChild(ti); }
        if (o.text) { var tx = document.createElement('div'); tx.className = 'nt-text'; tx.textContent = String(o.text); body.appendChild(tx); }
        el.appendChild(body);
        c.onClick = typeof o.onClick === 'function' ? o.onClick : null;
        el.style.cursor = c.onClick ? 'pointer' : '';
        if (kind !== 'err' && typeof A11y !== 'undefined') A11y.announce((o.title ? o.title + '. ' : '') + (o.text || ''));
        clearTimeout(c.timer);
        var ms = typeof o.timeout === 'number' ? o.timeout : (kind === 'err' ? 6000 : 3500);
        c.timer = ms > 0 ? setTimeout(function () { hide(c.id); }, ms) : 0;
    }

    function show(o) {
        if (typeof o === 'string') o = { text: o };
        o = o || {};
        if (!o.text && !o.title) return null;
        var b = root();
        if (!b) return null;
        var c = o.id != null ? find(String(o.id)) : null;
        if (c && !c.gone) {
            fill(c, o);
            if (b.lastChild !== c.el) b.appendChild(c.el);        // updated: it becomes the newest
            cards.splice(cards.indexOf(c), 1); cards.push(c);
            return c.id;
        }
        if (c) drop(c);                                            // was sliding out: replace it
        c = { id: o.id != null ? String(o.id) : 'n' + (++seq), el: document.createElement('div'), timer: 0, shown: false, gone: false };
        c.el.onclick = function () { var f = c.onClick; hide(c.id); if (f) try { f(); } catch (e) {} };
        fill(c, o);
        cards.push(c);
        b.appendChild(c.el);
        b.hidden = false;
        if (!o.silent && typeof AudioPrefs !== 'undefined' && AudioPrefs.notify) AudioPrefs.notify();
        while (cards.length - gone() > MAX) for (var i = 0; i < cards.length; i++) if (!cards[i].gone) { hide(cards[i].id); break; }
        void c.el.offsetWidth;                                     // start below, then rise
        c.shown = true;
        c.el.className += ' in';
        return c.id;
    }
    function gone() { var n = 0; for (var i = 0; i < cards.length; i++) if (cards[i].gone) n++; return n; }

    function drop(c) {
        clearTimeout(c.timer); clearTimeout(c.outTimer);
        var i = cards.indexOf(c);
        if (i >= 0) cards.splice(i, 1);
        if (c.el.parentNode) c.el.parentNode.removeChild(c.el);
        if (!cards.length && root()) root().hidden = true;
    }
    function hide(id) {
        var c = find(String(id));
        if (!c || c.gone) return;
        c.gone = true;
        clearTimeout(c.timer);
        c.el.className = c.el.className.replace(' in', '') + ' out';   // slides down and fades
        c.outTimer = setTimeout(function () { drop(c); }, OUT_MS);
    }
    function clear() { while (cards.length) drop(cards[0]); }

    return { show: show, hide: hide, clear: clear, count: function () { return cards.length - gone(); } };
})();
