/* Profile avatars: 8 simple glyphs on a coloured disc. Drawn as inline SVG (no image files, no emoji
 * fonts needed on the TV). Decorative: Voice Guide reads the profile name, never the glyph. */
var Avatars = (function () {
    'use strict';
    var NS = 'http://www.w3.org/2000/svg';
    // 24x24 paths: star, heart, bolt, face, diamond, moon, triangle, ring
    var PATHS = [
        'M12 2.5l2.9 6.3 6.8.7-5.1 4.6 1.5 6.7L12 17.3 5.9 20.8l1.5-6.7L2.3 9.5l6.8-.7z',
        'M12 21s-8-5.4-8-11a4.6 4.6 0 0 1 8-3 4.6 4.6 0 0 1 8 3c0 5.6-8 11-8 11z',
        'M13 2L4.5 13.5H11L10 22l9-12h-6.5z',
        'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm-3.2 6.5a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8zm6.4 0a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8zM7.5 14.5h9a4.5 4.5 0 0 1-9 0z',
        'M12 2l9 10-9 10L3 12z',
        'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z',
        'M12 3l10 17H2z',
        'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z'
    ];

    // <span class="avatar"> with the profile's colour and glyph (the guest gets a neutral face)
    function make(p, cls) {
        var span = document.createElement('span');
        span.className = cls || 'avatar';
        span.style.backgroundColor = p.color;
        span.setAttribute('aria-hidden', 'true');
        var svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('class', 'avatar-glyph');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        var path = document.createElementNS(NS, 'path');
        path.setAttribute('d', PATHS[(p.avatar | 0) % PATHS.length]);
        path.setAttribute('fill-rule', 'evenodd');
        path.setAttribute('fill', '#14183a');
        svg.appendChild(path);
        span.appendChild(svg);
        return span;
    }

    // Replaces the content of an existing element (e.g. the header avatar).
    function fill(el, p) {
        while (el.firstChild) el.removeChild(el.firstChild);
        var tmp = make(p);
        el.style.backgroundColor = p.color;
        el.appendChild(tmp.firstChild);
    }

    return { make: make, fill: fill, COUNT: PATHS.length };
})();
