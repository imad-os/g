/* Installed apps, read from Firebase (Firestore REST API: no Firebase SDK, nothing from a CDN).
 *
 * Apps are installed from a computer with the installer page (installer/index.html). The TV only
 * reads the public list: collection "apps", one document per app (see firebase/SETUP.md).
 *   Cloud.apps()        the last good list (cached on this TV, so it works offline)
 *   Cloud.refresh(cb)   fetches the list; cb(err, list, changed)
 * The web API key is an identifier, not a secret: firebase/firestore.rules only let admins write. */
var Cloud = (function () {
    'use strict';

    var CFG = { apiKey: 'AIzaSyBT0nk8uKUofgF5obP11R96lHtXbEVlKtc', projectId: 'tvgames-f984d' };
    var URL = 'https://firestore.googleapis.com/v1/projects/' + CFG.projectId + '/databases/(default)/documents/apps?pageSize=100&key=' + CFG.apiKey;
    var TIMEOUT = 5000, CACHE = 'cloud_apps';

    function fromValue(v) {
        if ('stringValue' in v) return v.stringValue;
        if ('integerValue' in v) return parseInt(v.integerValue, 10);
        if ('doubleValue' in v) return v.doubleValue;
        if ('booleanValue' in v) return v.booleanValue;
        if ('timestampValue' in v) return v.timestampValue;
        if ('mapValue' in v) return fromFields(v.mapValue.fields || {});
        return null;
    }
    function fromFields(f) { var o = {}; for (var k in f) o[k] = fromValue(f[k]); return o; }

    // keeps only well-formed, enabled https apps (a bad document never breaks the desktop)
    function clean(list) {
        var out = [];
        for (var i = 0; i < list.length; i++) {
            var a = list[i];
            if (!a || a.enabled === false || !/^[a-z0-9-]{2,32}$/.test(a.id || '') || !/^https:\/\//.test(a.entry || '')) continue;
            if (!a.name || (typeof a.name !== 'string' && !a.name.en)) continue;
            out.push(a);
        }
        out.sort(function (x, y) { return (x.order || 0) - (y.order || 0); });
        return out;
    }

    function apps() { return clean(Store.get(CACHE, [])); }

    function refresh(cb) {
        var x = new XMLHttpRequest(), done = false;
        function end(err, list) {
            if (done) return;
            done = true;
            if (err) return cb(err, apps(), false);
            var before = JSON.stringify(Store.get(CACHE, []));
            Store.set(CACHE, list);
            cb(null, clean(list), before !== JSON.stringify(list));
        }
        try { x.open('GET', URL, true); } catch (e) { return end('network'); }
        x.timeout = TIMEOUT;
        x.onload = function () {
            if (x.status !== 200) return end('http ' + x.status);
            var r = null;
            try { r = JSON.parse(x.responseText); } catch (e) {}
            if (!r) return end('json');
            var docs = r.documents || [], list = [];
            for (var i = 0; i < docs.length; i++) list.push(fromFields(docs[i].fields || {}));
            end(null, list);
        };
        x.onerror = x.ontimeout = function () { end('network'); };
        try { x.send(); } catch (e) { end('network'); }
    }

    return { apps: apps, refresh: refresh, url: URL, clean: clean };
})();
