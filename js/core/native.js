/* Makes the page behave like a native app: no pinch / double-tap / Ctrl+wheel / Ctrl +/- zoom, no text
 * selection or image dragging, no right-click menu, no rubber-band scrolling. (The same guard is in
 * games/shared/gamekit.js and sdk/mypc-sdk.js for games and store apps, which run in their own page.)
 * Input boxes still allow selecting text. */
(function () {
    'use strict';
    var NO_ZOOM = 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
    var m = document.querySelector('meta[name="viewport"]');
    if (!m) { m = document.createElement('meta'); m.name = 'viewport'; document.head.appendChild(m); }
    m.setAttribute('content', NO_ZOOM);

    function stop(e) { e.preventDefault(); }
    function field(e) { var t = e.target && e.target.tagName; return t === 'INPUT' || t === 'TEXTAREA'; }
    var opt = { passive: false };
    document.addEventListener('wheel', function (e) { if (e.ctrlKey) e.preventDefault(); }, opt);
    document.addEventListener('touchmove', function (e) { if (e.touches && e.touches.length > 1) e.preventDefault(); }, opt);
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (n) { document.addEventListener(n, stop, opt); });
    document.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '0' || e.key === '_')) e.preventDefault();
    }, opt);
    document.addEventListener('dblclick', stop, opt);
    document.addEventListener('contextmenu', stop, opt);
    document.addEventListener('dragstart', stop, opt);
    document.addEventListener('selectstart', function (e) { if (!field(e)) e.preventDefault(); }, opt);
})();
