/* Toasts and the network status popup, used by the home page and by game.html.
 * Samsung checklist: a network disconnection must be shown to the user. Uses the browser
 * online/offline events and, on the TV, webapis.network (privilege network.public).
 * The app keeps working offline; this only informs the user.
 * Needs #netpop, #netpop-text and #toast in the page. */
var Net = (function () {
    'use strict';
    var down = false, popTimer = 0, toastTimer = 0;

    function $(id) { return document.getElementById(id); }

    function show(ok) {
        var el = $('netpop');
        if (!el) return;
        $('netpop-text').textContent = I18n.t(ok ? 'netOn' : 'netOff');
        el.className = 'netpop' + (ok ? ' ok' : '');
        el.hidden = false;
        A11y.announce(I18n.t(ok ? 'netOn' : 'netOff'));
        clearTimeout(popTimer);
        popTimer = setTimeout(function () { el.hidden = true; }, ok ? 3000 : 7000);
    }

    function change(online) {
        if (online === !down) return;
        down = !online;
        show(online);
    }

    function watch() {
        window.addEventListener('offline', function () { change(false); });
        window.addEventListener('online', function () { change(true); });
        try {
            var NS = webapis.network.NetworkState;
            webapis.network.addNetworkStateChangeListener(function (v) {
                if (v === NS.GATEWAY_DISCONNECTED || v === NS.LAN_CABLE_DETACHED || v === NS.WIFI_MODULE_STATE_DETACHED) change(false);
                else if (v === NS.GATEWAY_CONNECTED) change(true);
            });
        } catch (e) {}
        if (navigator.onLine === false) change(false);
    }

    function toast(text) {
        var t = $('toast');
        if (!t) return;
        t.textContent = text;
        t.hidden = false;
        A11y.announce(text);
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
    }

    // The UI is laid out at 1920x1080 and scaled to the real viewport, centred (ultrawide screens
    // get background on the sides). Returns the layout so callers can pass it to games.
    function fit(stage) {
        var w = window.innerWidth || 1920, h = window.innerHeight || 1080;
        var s = Math.min(w / 1920, h / 1080);
        var tr = Math.abs(s - 1) < 0.001 ? '' : 'scale(' + s + ')';
        stage.style.webkitTransform = tr;
        stage.style.transform = tr;
        stage.style.left = Math.max(0, (w - 1920 * s) / 2) + 'px';
        stage.style.top = Math.max(0, (h - 1080 * s) / 2) + 'px';
        return { cssWidth: Math.round(1920 * s), cssHeight: Math.round(1080 * s), scale: s, dpr: window.devicePixelRatio || 1,
                 safeArea: { left: 96, top: 54, right: 96, bottom: 54 } };
    }

    return { watch: watch, toast: toast, fit: fit, online: function () { return !down; } };
})();
