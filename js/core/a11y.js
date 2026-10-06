/* Accessibility (Samsung Voice Guide / TTS).
 * - The TV screen reader reads the focused element (real DOM focus) and the aria-live region.
 * - Decorative SVG and images are hidden from it, otherwise it reads file names.
 * - Never put aria-hidden on <body>.
 */
var A11y = (function () {
    'use strict';
    var region = null, clearTimer = null, setTimer = null;

    function hideDecorative(root) {
        if (!root || root.nodeType !== 1) return;
        var list = root.querySelectorAll('svg, img:not([alt])');
        for (var i = 0; i < list.length; i++) {
            if (list[i].tagName.toLowerCase() === 'svg') {
                list[i].setAttribute('aria-hidden', 'true');
                list[i].setAttribute('focusable', 'false');
            } else list[i].setAttribute('alt', '');
        }
    }

    function init() {
        region = document.getElementById('a11y-live');
        hideDecorative(document.body);
    }

    function announce(text) {
        if (!text) return;
        if (!region) region = document.getElementById('a11y-live');
        if (!region) return;
        // Clear first so the same message is announced again.
        region.textContent = '';
        clearTimeout(setTimer); clearTimeout(clearTimer);
        setTimer = setTimeout(function () { region.textContent = text; }, 60);
        clearTimer = setTimeout(function () { region.textContent = ''; }, 4000);
    }

    return { init: init, announce: announce, hideDecorative: hideDecorative };
})();
