/* The TV pointer driven by a phone in Motion data mode, like a TV "magic remote": the phone turns, the pointer moves
 * (the phone side is js/core/aim.js; the messages come through js/launcher/controllers.js). Only on the My PC screens
 * (never on a game's page). What it points at gets the focus, so the white ring shows it and the phone's A button is the
 * usual OK on it. Hidden after a few seconds without movement or when an arrow is pressed; it comes back in the centre.
 * Cheap on slow TVs: one small fixed element moved with a transform once per frame at most, the item under it looked
 * up ~10 times a second, nothing at all while it is hidden.
 *   Pointer.allowed()  Pointer.move(dx, dy) (hundredths of a degree)  .center()  .hide()  .visible()  .press() -> true if handled */
var Pointer = (function () {
    'use strict';

    var HIDE_MS = 5000, HOVER_MS = 100, SPAN = 30;        // SPAN: degrees to turn for the whole width of the screen
    var el = null, x = 0, y = 0, shown = false, last = 0, lastHover = 0, raf = 0, hoverT = 0, idleT = 0;
    var SVG = '<svg width="34" height="46" viewBox="0 0 34 46"><path d="M2 2v36l9-8 6 13 6-3-6-12h12z" fill="#fff" stroke="#000" stroke-width="2.5" stroke-linejoin="round"/></svg>';

    function allowed() { return !/[?&]play=/.test(location.search); }
    function make() {
        el = document.createElement('div');
        el.className = 'ptr';
        el.setAttribute('aria-hidden', 'true');
        el.innerHTML = SVG;
        document.body.appendChild(el);
    }
    function center() { x = Math.round(window.innerWidth / 2); y = Math.round(window.innerHeight / 2); }
    function show() {
        if (shown) return;
        if (!el) make();
        shown = true; el.style.display = 'block';
        idleT = setInterval(function () { if (Date.now() - last > HIDE_MS) hide(); }, 1000);
    }
    function hide() {
        if (!shown) return;
        shown = false; el.style.display = 'none';
        clearInterval(idleT); clearTimeout(hoverT); hoverT = 0;
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
    }
    function draw() {
        raf = 0;
        if (!shown) return;
        el.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
        var wait = HOVER_MS - (Date.now() - lastHover);
        if (wait <= 0) hover(); else if (!hoverT) hoverT = setTimeout(hover, wait);
    }
    function target() {
        var e = document.elementFromPoint(x, y);
        return e && e !== el ? e : null;
    }
    // the item under the pointer gets the focus (no scrolling: the list must not move under the pointer)
    function hover() {
        hoverT = 0; lastHover = Date.now();
        if (!shown) return null;
        var e = target(), f = e && e.closest ? e.closest('[data-focus]') : null;
        if (f && f !== document.activeElement && !f.disabled) { try { f.focus({ preventScroll: true }); } catch (er) {} }
        return e;
    }
    function move(dx, dy) {
        var now = Date.now();
        if (!shown) { center(); show(); }
        // a little acceleration: slow turns are precise, quick ones cross the screen
        var dt = Math.max(16, Math.min(200, now - last)), deg = Math.sqrt(dx * dx + dy * dy) / 100, speed = deg * 1000 / dt;
        var k = window.innerWidth / SPAN / 100 * (0.6 + Math.min(1, speed / 90));
        last = now;
        x = Math.max(0, Math.min(window.innerWidth - 2, x + dx * k));     // the edges hold the pointer: turning back re-aligns it
        y = Math.max(0, Math.min(window.innerHeight - 2, y + dy * k));
        if (!raf) raf = requestAnimationFrame(draw);
    }
    // the phone's A button: on an item, the item gets the focus and the usual OK follows (false); elsewhere a plain click (true)
    function press() {
        if (!shown) return false;
        last = Date.now();
        var e = hover();
        if (!e || (e.closest && e.closest('[data-focus]'))) return false;
        try { e.click(); } catch (er) {}
        return true;
    }

    return {
        allowed: allowed, move: move, hide: hide, press: press,
        center: function () { center(); show(); last = Date.now(); if (!raf) raf = requestAnimationFrame(draw); },
        visible: function () { return shown; },
        pos: function () { return { x: x, y: y }; }
    };
})();
