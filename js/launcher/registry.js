/* Game registry: the list of games shown on the home page.
 *
 * Source of truth: Firestore project from firebase/firebase-config.js, collection `games` (document id = game id),
 * read with the REST API and plain XHR: no Firebase SDK, nothing from a CDN, 3 s timeout. Only `enabled` games
 * are shown, sorted by `order`. Fields: title, description, url, cover, enabled, order, minShell, sdk, build,
 * bundled, tags, updatedAt (see firebase/SETUP.md).
 *
 * Never an empty or black home:  network list -> last good list (localStorage) -> bundled app-manifest games.
 * Bundled games (bundled: true, url games/<id>/) always run from the package (or its hosted copy).
 * Remote games are only listed when online, or cached and not known to be offline.
 *
 * ES5 only. */
var Registry = (function () {
    'use strict';
    var CACHE_KEY = 'arc_registry_cache', TIMEOUT_MS = 3000, SDK = 1;

    function endpoint() {
        var c = window.FIREBASE_CONFIG || {};
        return 'https://firestore.googleapis.com/v1/projects/' + c.projectId + '/databases/(default)/documents/games?pageSize=300&key=' + c.apiKey;
    }

    // Firestore typed JSON -> plain value
    function val(v) {
        if (!v) return null;
        if ('stringValue' in v) return v.stringValue;
        if ('integerValue' in v) return parseInt(v.integerValue, 10);
        if ('doubleValue' in v) return v.doubleValue;
        if ('booleanValue' in v) return v.booleanValue;
        if ('timestampValue' in v) return v.timestampValue;
        if ('nullValue' in v) return null;
        var out, k, i;
        if ('mapValue' in v) { out = {}; var f = v.mapValue.fields || {}; for (k in f) out[k] = val(f[k]); return out; }
        if ('arrayValue' in v) { out = []; var a = v.arrayValue.values || []; for (i = 0; i < a.length; i++) out.push(val(a[i])); return out; }
        return null;
    }

    function parseDoc(doc) {
        var f = doc.fields || {}, out = { id: String(doc.name || '').replace(/^.*\//, '') }, k;
        for (k in f) out[k] = val(f[k]);
        return out;
    }

    function parseList(json) {
        var docs = (json && json.documents) || [], out = [];
        for (var i = 0; i < docs.length; i++) out.push(parseDoc(docs[i]));
        return out;
    }

    function usable(d, shell) {
        return d && d.enabled === true && typeof d.url === 'string' && d.title && d.title.en &&
               (d.sdk === undefined || d.sdk <= SDK) && (d.minShell === undefined || d.minShell <= shell) && /^[a-z0-9-]{2,32}$/.test(d.id);
    }

    function sorted(list) {
        return list.slice().sort(function (a, b) { return (a.order - b.order) || (a.id < b.id ? -1 : 1); });
    }

    function fetchNetwork(cb) {
        var done = false, xhr = new XMLHttpRequest();
        function finish(err, list) { if (done) return; done = true; cb(err, list); }
        try {
            xhr.open('GET', endpoint(), true);
            xhr.timeout = TIMEOUT_MS;
            xhr.onload = function () {
                var j = null;
                try { j = JSON.parse(xhr.responseText); } catch (e) {}
                if (xhr.status >= 200 && xhr.status < 300 && j) finish(null, parseList(j)); else finish('HTTP ' + xhr.status);
            };
            xhr.onerror = function () { finish('network error'); };
            xhr.ontimeout = function () { finish('timeout'); };
            xhr.send();
        } catch (e) { finish(String(e)); }
        setTimeout(function () { if (!done) { try { xhr.abort(); } catch (e) {} finish('timeout'); } }, TIMEOUT_MS + 100);
    }

    function isBundled(d) { return d.bundled === true || /^games\/[a-z0-9-]+\/$/.test(d.url); }

    // done(entries, source): entries = [{ id, bundled, doc }] in display order; source = network | cache | bundled
    // bundledIds: the games of the package (app-manifest.json), used as the last fallback
    function load(bundledIds, shell, done) {
        function fromBundled() {
            var out = [];
            for (var i = 0; i < bundledIds.length; i++) out.push({ id: bundledIds[i], bundled: true, doc: null });
            return out;
        }
        function build(list, source) {
            var out = [], s = sorted(list), offline = navigator.onLine === false;
            for (var i = 0; i < s.length; i++) {
                var d = s[i];
                if (!usable(d, shell)) continue;
                if (isBundled(d)) { if (bundledIds.indexOf(d.id) >= 0) out.push({ id: d.id, bundled: true, doc: d }); continue; }
                // https only (the Firestore rules enforce it too); http://localhost lets tests and developers try a game
                if (!/^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)[:\/])/.test(d.url)) continue;
                if (source !== 'network' && offline) continue;      // cached remote games only while online
                out.push({ id: d.id, bundled: false, doc: d });
            }
            return out.length ? out : fromBundled();
        }
        var cached = Store.rawGet(CACHE_KEY);
        var cachedList = cached && cached.list && cached.list.length ? cached.list : null;

        fetchNetwork(function (err, list) {
            if (!err && list.length) {
                // A game deleted from the registry: its saves and scores go too (every profile).
                if (cachedList) {
                    var now = {}, i;
                    for (i = 0; i < list.length; i++) now[list[i].id] = 1;
                    for (i = 0; i < cachedList.length; i++) {
                        var old = cachedList[i];
                        if (!now[old.id] && !isBundled(old)) Store.dropGame(old.id);
                    }
                }
                Store.rawSet(CACHE_KEY, { t: Date.now(), list: list });
                return done(build(list, 'network'), 'network');
            }
            if (cachedList) return done(build(cachedList, 'cache'), 'cache');
            done(fromBundled(), 'bundled');
        });
    }

    return { load: load, parseList: parseList, parseDoc: parseDoc, endpoint: endpoint, SDK: SDK };
})();
