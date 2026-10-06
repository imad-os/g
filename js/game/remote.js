/* Remote games (another GitHub Pages origin): ONE sandboxed iframe inside game.html, talking to the hub
 * through the Arcade SDK protocol { v: 1, type, id, data } over postMessage.
 *
 * The iframe is on another origin: it cannot reach the hub's DOM or storage. The top-level page stays the
 * packaged game.html, so Back, Tizen APIs and certification behaviour are kept (navigating the top level to
 * an outside URL would need tizen:allow-navigation, which switches the app to a strict CSP).
 *
 * Lifecycle on exit: destroy -> wait <= 1 s for `destroyed` -> src = about:blank -> remove the iframe.
 * A game that ignores `destroy` is removed anyway. */
var RemoteGame = (function () {
    'use strict';
    var PROTOCOL = 1, DESTROY_WAIT_MS = 1000;
    var iframe = null, onMsg = null, destroyTimer = 0, closing = null;

    function $(id) { return document.getElementById(id); }

    function listener(e) {
        if (!iframe || e.source !== iframe.contentWindow) return;     // only our game
        var m = e.data;
        if (!m || m.v !== PROTOCOL || typeof m.type !== 'string') return;
        if (m.type === 'destroyed' && closing) { var c = closing; closing = null; clearTimeout(destroyTimer); remove(); c(); return; }
        if (onMsg && !closing) onMsg(m.type, m.data || {}, m.id || 0);
    }

    function remove() {
        if (!iframe) return;
        try { iframe.src = 'about:blank'; } catch (e) {}
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        iframe = null;
        window.removeEventListener('message', listener, false);
        onMsg = null;
    }

    function open(url, title, cb) {
        remove();
        onMsg = cb;
        iframe = document.createElement('iframe');
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
        iframe.setAttribute('tabindex', '-1');
        iframe.setAttribute('title', title || '');
        iframe.setAttribute('aria-hidden', 'true');
        iframe.setAttribute('scrolling', 'no');
        window.addEventListener('message', listener, false);
        $('game-frame-box').appendChild(iframe);
        iframe.src = url;
    }

    function send(type, data, id) {
        if (!iframe || !iframe.contentWindow) return;
        try { iframe.contentWindow.postMessage({ v: PROTOCOL, type: type, id: id || 0, data: data === undefined ? null : data }, '*'); } catch (e) {}
    }

    // cb is called once the iframe is gone
    function close(cb) {
        if (!iframe) { if (cb) cb(); return; }
        closing = function () { if (cb) cb(); };
        send('destroy');
        destroyTimer = setTimeout(function () {
            if (!closing) return;
            var c = closing;
            closing = null;
            remove();
            c();
        }, DESTROY_WAIT_MS);
    }

    return { open: open, send: send, close: close, active: function () { return !!iframe; }, frame: function () { return iframe; } };
})();
