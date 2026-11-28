/* New versions of installed apps without pressing Update in the App Store Manager (owner request 2026-11-28: "I don't want to be
 * updating in App Store Manager every time").
 *
 * The store (Firestore `apps/<id>`) keeps the version the Manager last published, and the TV opens an app as
 * `<entry>?mypc_v=<version>` so a new version never opens from the TV's cache. Here the TV reads the app's OWN
 * `mypc-app.json` on its site (a few hundred bytes) and, when its `version` is another one, that version is used instead:
 *   - when the app opens (in parallel with the store's document, 2.5 s max: offline = the store's version);
 *   - on the desktop, at most every 6 h per app, for apps with a copy on a USB drive (js/core/app-usb.js) so the copy follows.
 * Only the version follows by itself. A new name / icon / entry, services or widgets (code the admin approves) still need
 * the Manager's Update. Cache: TV-wide `arc_dev_applive` { <id>: { v, at } } (not backed up).
 *
 *   AppLive.check(app, cb)    app { id, url }; cb(version | '') - '' when the site did not answer
 *   AppLive.version(app)      the version to open: the higher of the live one (when known) and app.version
 *   AppLive.newer(live, store) the higher of two versions
 *   AppLive.seen(id, v)       the version opened last time on this TV ('' the first time), then remembers v (`arc_dev_appseen`)
 *   AppLive.withLive(list)    copies of the store list with the live versions (for AppUsb.refresh)
 *   AppLive.refresh(list, cb) desktop: checks the apps that are due, cb(changed)
 * ES5 (Chrome 108 TVs). */
var AppLive = (function () {
    'use strict';

    var KEY = 'arc_dev_applive', TIMEOUT = 2500, EVERY = 6 * 3600 * 1000;
    var st = null;

    function load() { if (!st) { try { st = JSON.parse(localStorage.getItem(KEY)); } catch (e) { st = null; } if (!st || typeof st !== 'object') st = {}; } return st; }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(load())); } catch (e) {} }
    function siteOf(app) {
        var u = String((app && (app.url || app.entry)) || '').replace(/[?#].*$/, '');
        if (!/^https:\/\//i.test(u)) return '';
        return u.replace(/[^/]*$/, '');
    }
    function okVersion(v) { return typeof v === 'string' && v.length > 0 && v.length <= 40 && /^[\w.+-]+$/.test(v); }

    function get(url, cb) {
        if (typeof AppBoot !== 'undefined' && AppBoot.get) return AppBoot.get(url, TIMEOUT, cb);
        var x = new XMLHttpRequest(), done = false;
        function fin(e, t) { if (!done) { done = true; cb(e, t); } }
        try {
            x.open('GET', url, true); x.timeout = TIMEOUT;
            x.onload = function () { fin(x.status >= 200 && x.status < 300 ? null : 'HTTP ' + x.status, x.responseText); };
            x.onerror = function () { fin('network'); }; x.ontimeout = function () { fin('timeout'); };
            x.send();
        } catch (e) { fin(String(e)); }
    }

    function check(app, cb) {
        var site = siteOf(app);
        if (!app || !app.id || !site) return setTimeout(function () { cb(''); }, 0);
        get(site + 'mypc-app.json?t=' + Date.now(), function (err, text) {
            var m = null;
            if (!err) { try { m = JSON.parse(text); } catch (e) { m = null; } }
            var v = m && okVersion(m.version) ? m.version : '';
            if (v) { load()[app.id] = { v: v, at: Date.now() }; save(); }
            cb(v);
        });
    }

    // the higher of two versions ("1.10.0" > "1.9.2"); the live one when they can not be compared
    function cmp(a, b) {
        var x = String(a).split(/[.+-]/), y = String(b).split(/[.+-]/);
        for (var i = 0; i < Math.max(x.length, y.length); i++) {
            var p = x[i] === undefined ? 0 : x[i], q = y[i] === undefined ? 0 : y[i];
            var n = /^\d+$/.test(p), m = /^\d+$/.test(q);
            if (n && m) { if (+p !== +q) return +p > +q ? 1 : -1; }
            else if (p !== q) return p > q ? 1 : -1;
        }
        return 0;
    }
    function newer(live, store) {
        if (!okVersion(live)) return store || '';
        if (!store) return live;
        return cmp(live, store) >= 0 ? live : store;
    }
    function version(app) {
        var r = app && load()[app.id];
        return newer(r && r.v, (app && app.version) || '');
    }

    function withLive(list) {
        return (list || []).map(function (a) {
            var v = version(a);
            if (!a || v === (a.version || '')) return a;
            var c = {}, k;
            for (k in a) c[k] = a[k];
            c.version = v;
            return c;
        });
    }

    function refresh(list, only, cb) {
        var due = (list || []).filter(function (a) {
            var r = a && load()[a.id];
            return a && a.id && siteOf(a) && (!only || only(a)) && (!r || Date.now() - (r.at || 0) > EVERY);
        }), changed = false, left = due.length;
        if (!left) return cb && setTimeout(function () { cb(false); }, 0);
        due.forEach(function (a) {
            var before = version(a);
            check(a, function () { if (version(a) !== before) changed = true; if (--left === 0 && cb) cb(changed); });
        });
    }

    // the version this TV opened last time; remembers this one. '' the first time
    function seen(id, v) {
        var k = 'arc_dev_appseen', o = null;
        try { o = JSON.parse(localStorage.getItem(k)); } catch (e) {}
        if (!o || typeof o !== 'object') o = {};
        var prev = o[id] || '';
        if (v) { o[id] = v; try { localStorage.setItem(k, JSON.stringify(o)); } catch (e2) {} }
        return prev;
    }

    return { seen: seen, check: check, version: version, newer: newer, withLive: withLive, refresh: refresh };
})();
