/* Network modes (owner request 2026-11-13): what this device can reach now, shown on the taskbar's Wi-Fi icon.
 *   'offline'  no network at all (no router / cable / Wi-Fi)
 *   'local'    a network (Wi-Fi / cable) but the internet is missing or limited: nothing answers, Facebook / Instagram
 *              are blocked (a school / work Wi-Fi), or Google's database (Firestore) does not answer. Multiplayer then uses
 *              rooms on this Wi-Fi (js/core/lan-db.js), never Firestore.
 *   'online'   the whole internet
 * How: the TV's own network state (webapis.network, privilege network.public) or navigator.onLine say if there is a network;
 * then three tiny requests (no-cors, 5 s each, so a DNS / HTTPS block page cannot pass as the real site): an internet site
 * (gstatic generate_204, else My PC's own site), Firestore, and Facebook + Instagram (blocked = both fail twice).
 * Checked 2 s after start, when the network changes, and every 10 minutes while My PC is shown (never while hidden).
 * The last answer is kept TV-wide in arc_dev_netmode (not backed up), so the game page knows it at once.
 *   NetMode.mode() -> 'offline' | 'local' | 'online';  NetMode.info() -> { mode, why, at }
 *     why: 'nonet' | 'noinet' (network, no internet) | 'blocked' (social sites blocked) | 'nocloud' (Firestore unreachable) | ''
 *   NetMode.check(force, cb(info));  NetMode.onChange(fn(info, old));  NetMode.start() (the desktop page, once)
 *   NetMode.rooms() -> 'lan' | 'cloud': where multiplayer rooms go (the setting arc_dev_netpref 'auto' | 'lan' | 'cloud' wins) */
var NetMode = (function () {
    'use strict';

    var KEY = 'arc_dev_netmode', PREF = 'arc_dev_netpref', EVERY = 600000, TIMEOUT = 5000, STALE = 300000;
    var PROBES = {
        inet: ['https://www.gstatic.com/generate_204', 'https://pc.geekspro.us/manifest.webmanifest'],
        cloud: ['https://firestore.googleapis.com/'],
        social: ['https://www.facebook.com/favicon.ico', 'https://www.instagram.com/favicon.ico']
    };
    var cur = load(), busy = null, timer = 0, started = false, fns = [];

    function load() {
        var v = null;
        try { v = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
        return v && v.mode ? v : { mode: 'online', why: '', at: 0 };
    }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch (e) {} }
    function emit(old) { for (var i = 0; i < fns.length; i++) { try { fns[i](cur, old); } catch (e) {} } }

    // the TV's own answer (true / false), or null when this is not a TV
    function gateway() {
        try {
            var n = webapis.network;
            if (n.getActiveConnectionType && n.getActiveConnectionType() === 0) return false;     // DISCONNECTED
            if (n.isConnectedToGateway) return !!n.isConnectedToGateway();
        } catch (e) {}
        return null;
    }
    function hasNetwork() {
        var g = gateway();
        if (g !== null) return g;
        return navigator.onLine !== false;
    }

    // one address: true when the real site answered (opaque answers count; a refused / failed / timed out request does not)
    function reach(url, cb) {
        var done = false, ctl = null, t;
        function end(ok) { if (done) return; done = true; clearTimeout(t); try { if (ctl && !ok) ctl.abort(); } catch (e) {} cb(ok); }
        t = setTimeout(function () { end(false); }, TIMEOUT);
        try {
            ctl = typeof AbortController === 'function' ? new AbortController() : null;
            fetch(url + (url.indexOf('?') < 0 ? '?' : '&') + 'nm=' + Date.now(), { mode: 'no-cors', cache: 'no-store', credentials: 'omit', signal: ctl ? ctl.signal : undefined })
                .then(function () { end(true); }, function () { end(false); });
        } catch (e) { end(false); }
    }
    // any of the list answers
    function any(list, cb) {
        var left = list.length, hit = false, i;
        if (!left) return cb(false);
        for (i = 0; i < list.length; i++) reach(list[i], function (ok) { if (ok) hit = true; if (--left === 0) cb(hit); });
    }

    function set(mode, why) {
        var old = cur;
        cur = { mode: mode, why: why, at: Date.now() };
        save();
        if (old.mode !== mode || old.why !== why) emit(old);
    }
    function classify(cb) {
        if (!hasNetwork()) { set('offline', 'nonet'); return cb(); }
        var r = {}, left = 3;
        function part(k) { return function (ok) { r[k] = ok; if (--left === 0) end(); }; }
        function end() {
            if (!r.inet && !r.cloud) { set(hasNetwork() ? 'local' : 'offline', hasNetwork() ? 'noinet' : 'nonet'); return cb(); }
            if (!r.social) {                                     // once more: a single slow answer must not look like a block
                return any(PROBES.social, function (ok) {
                    if (!ok) set('local', 'blocked'); else if (!r.cloud) set('local', 'nocloud'); else set('online', '');
                    cb();
                });
            }
            if (!r.cloud) set('local', 'nocloud'); else set('online', '');
            cb();
        }
        any(PROBES.inet, part('inet'));
        any(PROBES.cloud, part('cloud'));
        any(PROBES.social, part('social'));
    }

    // cb(info) once known; force = ask again even if the last answer is fresh
    function check(force, cb) {
        if (!force && cur.at && Date.now() - cur.at < STALE) { if (cb) cb(cur); return; }
        if (busy) { if (cb) busy.push(cb); return; }
        busy = cb ? [cb] : [];
        classify(function () { var l = busy; busy = null; for (var i = 0; i < l.length; i++) { try { l[i](cur); } catch (e) {} } });
    }
    function plan() {
        clearTimeout(timer);
        timer = setTimeout(function () {
            if (document.hidden) return plan();
            check(true, plan);
        }, EVERY);
    }
    function soon() { clearTimeout(timer); timer = setTimeout(function () { check(true, plan); }, 1500); }
    function start() {
        if (started) return;
        started = true;
        window.addEventListener('offline', function () { set('offline', 'nonet'); soon(); });
        window.addEventListener('online', soon);
        try { webapis.network.addNetworkStateChangeListener(function () { soon(); }); } catch (e) {}
        document.addEventListener('visibilitychange', function () { if (!document.hidden && Date.now() - cur.at > EVERY) soon(); });
        if (!hasNetwork()) set('offline', 'nonet');
        clearTimeout(timer);
        timer = setTimeout(function () { check(true, plan); }, 2000);
    }

    function pref() { var p = null; try { p = JSON.parse(localStorage.getItem(PREF)); } catch (e) {} return p === 'lan' || p === 'cloud' ? p : 'auto'; }
    function setPref(p) { try { localStorage.setItem(PREF, JSON.stringify(p === 'lan' || p === 'cloud' ? p : 'auto')); } catch (e) {} emit(cur); }
    function rooms() { var p = pref(); if (p !== 'auto') return p; return cur.mode === 'online' ? 'cloud' : 'lan'; }

    return {
        mode: function () { return cur.mode; }, info: function () { return cur; }, check: check, start: start, rooms: rooms, pref: pref, setPref: setPref,
        onChange: function (fn) { if (fns.indexOf(fn) < 0) fns.push(fn); },
        offChange: function (fn) { var i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); },
        PROBES: PROBES, _set: set
    };
})();
