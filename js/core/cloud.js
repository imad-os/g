/* My PC and Firebase (Firestore REST API: no Firebase SDK, nothing from a CDN).
 *
 * The App Store catalog: collection "apps", one document per app or game, published by the owner with the
 * App Store Manager page (installer/index.html). A TV installs only what the user picks in the App Store app.
 *   Cloud.catalog()          every app of the store (last good list, cached on this TV: works offline)
 *   Cloud.apps()             the installed ones (Desktop, Start, File Explorer)
 *   Cloud.refresh(cb)        fetches the catalog; cb(err, installedApps, changed)
 *   Cloud.fetchApp(id, cb)   one app, fresh (right before it opens, so its config is current)
 *   Cloud.install(id) / uninstall(id) / isInstalled(id) / installedIds()
 *   Cloud.stats(cb)          { appId: { installs, opens } } from "appstats" (popular apps)
 *   Cloud.count(id, field)   +1 on "installs" or "opens" of an app
 * Generic REST helpers for the other modules (backup.js, world.js): Cloud.get / patch / batchGet / commit.
 * The web API key is an identifier, not a secret: firebase/firestore.rules decide what anyone may write. */
var Cloud = (function () {
    'use strict';

    var CFG = { apiKey: 'AIzaSyBT0nk8uKUofgF5obP11R96lHtXbEVlKtc', projectId: 'tvgames-f984d' };
    var DB = 'projects/' + CFG.projectId + '/databases/(default)/documents';
    var ROOT = 'https://firestore.googleapis.com/v1/' + DB;
    var URL = ROOT + '/apps?pageSize=200&key=' + CFG.apiKey;
    var TIMEOUT = 5000, ONE_TIMEOUT = 2500;
    var CATALOG = 'arc_dev_catalog', INSTALLED = 'arc_dev_installed', STATS = 'arc_dev_appstats';
    var listeners = [];

    /* ---------------- REST ---------------- */

    function fromValue(v) {
        if ('stringValue' in v) return v.stringValue;
        if ('integerValue' in v) return parseInt(v.integerValue, 10);
        if ('doubleValue' in v) return v.doubleValue;
        if ('booleanValue' in v) return v.booleanValue;
        if ('timestampValue' in v) return v.timestampValue;
        if ('mapValue' in v) return fromFields(v.mapValue.fields || {});
        if ('arrayValue' in v) { var out = [], vals = v.arrayValue.values || []; for (var i = 0; i < vals.length; i++) out.push(fromValue(vals[i])); return out; }
        return null;       // nullValue
    }
    function fromFields(f) { var o = {}; for (var k in f) o[k] = fromValue(f[k]); return o; }

    function toValue(v) {
        if (v === null || v === undefined) return { nullValue: null };
        if (typeof v === 'boolean') return { booleanValue: v };
        if (typeof v === 'number') return Math.floor(v) === v && Math.abs(v) < 9e15 ? { integerValue: String(v) } : { doubleValue: v };
        if (typeof v === 'string') return { stringValue: v };
        if (v.length !== undefined) { var vals = []; for (var i = 0; i < v.length; i++) vals.push(toValue(v[i])); return { arrayValue: { values: vals } }; }
        return { mapValue: { fields: toFields(v) } };
    }
    function toFields(o) { var f = {}; for (var k in o) if (o[k] !== undefined) f[k] = toValue(o[k]); return f; }

    // cb(err, json, status): err is null, 'notfound', 'conflict', 'network' or 'http <n>'
    function request(method, url, body, timeout, cb) {
        var x = new XMLHttpRequest(), done = false;
        function end(err, json, st) { if (done) return; done = true; cb(err, json, st); }
        try { x.open(method, url + (url.indexOf('?') < 0 ? '?' : '&') + 'key=' + CFG.apiKey, true); } catch (e) { return end('network', null, 0); }
        x.timeout = timeout || TIMEOUT;
        if (body) x.setRequestHeader('Content-Type', 'application/json');
        x.onload = function () {
            var r = null;
            try { r = JSON.parse(x.responseText); } catch (e) {}
            if (x.status === 404) return end('notfound', r, 404);
            if (x.status === 409 || x.status === 412 || (r && r.error && r.error.status === 'FAILED_PRECONDITION')) return end('conflict', r, x.status);
            if (x.status !== 200) return end('http ' + x.status, r, x.status);
            end(r ? null : 'json', r, 200);
        };
        x.onerror = x.ontimeout = function () { end('network', null, 0); };
        try { x.send(body ? JSON.stringify(body) : null); } catch (e) { end('network', null, 0); }
    }

    // path like "tvs/tv-123": cb(err, data, updateTime)
    function get(path, timeout, cb) {
        request('GET', ROOT + '/' + path, null, timeout, function (err, r) {
            if (err || !r) return cb(err || 'json', null, null);
            cb(null, fromFields(r.fields || {}), r.updateTime || null);
        });
    }
    // writes the whole document. pre: { updateTime } or { exists: false } (optimistic lock), or null
    function patch(path, data, pre, timeout, cb) {
        var q = '';
        if (pre && pre.updateTime) q = '?currentDocument.updateTime=' + encodeURIComponent(pre.updateTime);
        else if (pre && pre.exists === false) q = '?currentDocument.exists=false';
        request('PATCH', ROOT + '/' + path + q, { fields: toFields(data) }, timeout, function (err, r) {
            cb(err, r ? r.updateTime : null);
        });
    }
    // several documents at once: cb(err, { path: { data, updateTime } | null })
    function batchGet(paths, timeout, cb) {
        var docs = [];
        for (var i = 0; i < paths.length; i++) docs.push(DB + '/' + paths[i]);
        request('POST', ROOT + ':batchGet', { documents: docs }, timeout, function (err, r) {
            if (err || !r || r.length === undefined) return cb(err || 'json', null);
            var out = {};
            for (var j = 0; j < r.length; j++) {
                if (r[j].found) out[r[j].found.name.slice(DB.length + 1)] = { data: fromFields(r[j].found.fields || {}), updateTime: r[j].found.updateTime };
                else if (r[j].missing) out[r[j].missing.slice(DB.length + 1)] = null;
            }
            cb(null, out);
        });
    }
    function remove(path, timeout, cb) { request('DELETE', ROOT + '/' + path, null, timeout, function (err) { cb(err); }); }
    function commit(writes, timeout, cb) { request('POST', ROOT + ':commit', { writes: writes }, timeout, function (err) { if (cb) cb(err); }); }

    /* ---------------- catalog ---------------- */

    // keeps only well-formed, enabled https apps (a bad document never breaks the desktop)
    function clean(list) {
        var out = [];
        for (var i = 0; i < list.length; i++) {
            var a = list[i];
            if (!a || a.enabled === false || !/^[a-z0-9-]{2,32}$/.test(a.id || '') || !/^https:\/\//.test(a.entry || '')) continue;
            if (!a.name || (typeof a.name !== 'string' && !a.name.en)) continue;
            // config: the app's settings object, edited in the App Store Manager (always a plain object)
            if (!a.config || typeof a.config !== 'object' || a.config.length !== undefined) a.config = {};
            out.push(a);
        }
        out.sort(function (x, y) { return (x.order || 0) - (y.order || 0); });
        return out;
    }

    function rawCatalog() { var l = Store.rawGet(CATALOG); return l && l.length !== undefined ? l : []; }
    function catalog() { return clean(rawCatalog()); }

    /* ---------------- installed on this TV (all profiles, like a PC) ---------------- */

    function installedList() { var l = Store.rawGet(INSTALLED); return l && l.length !== undefined ? l : []; }
    function installedIds() { var l = installedList(), out = []; for (var i = 0; i < l.length; i++) out.push(l[i].id); return out; }
    function isInstalled(id) { return installedIds().indexOf(id) >= 0; }
    function apps() {
        var ids = installedIds(), all = catalog(), out = [];
        for (var i = 0; i < all.length; i++) if (ids.indexOf(all[i].id) >= 0) out.push(all[i]);
        return out;
    }
    function emit() { for (var i = 0; i < listeners.length; i++) { try { listeners[i](); } catch (e) {} } }
    function install(id) {
        if (isInstalled(id)) return;
        var l = installedList();
        l.push({ id: id, at: Date.now() });
        Store.rawSet(INSTALLED, l);
        count(id, 'installs');
        emit();
    }
    function uninstall(id) {
        var l = installedList(), out = [];
        for (var i = 0; i < l.length; i++) if (l[i].id !== id) out.push(l[i]);
        Store.rawSet(INSTALLED, out);
        emit();
    }

    // Before the App Store, every app of the list was on every TV: keep those installed (once).
    (function migrate() {
        if (Store.rawGet(INSTALLED) !== undefined) return;
        var ids = [], cat = [];
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (!/^arc_p\d+_cloud_apps$/.test(k)) continue;
                var l = clean(Store.rawGet(k) || []);
                for (var j = 0; j < l.length; j++) if (ids.indexOf(l[j].id) < 0) { ids.push(l[j].id); cat.push(l[j]); }
            }
        } catch (e) {}
        if (cat.length && !rawCatalog().length) Store.rawSet(CATALOG, cat);
        var out = [];
        for (var n = 0; n < ids.length; n++) out.push({ id: ids[n], at: 0 });
        Store.rawSet(INSTALLED, out);
    })();

    function refresh(cb) {
        request('GET', URL, null, TIMEOUT, function (err, r) {
            if (err) return cb(err, apps(), false);
            var docs = r.documents || [], list = [];
            for (var i = 0; i < docs.length; i++) {
                var a = fromFields(docs[i].fields || {});
                if (!a.installedAt) a.installedAt = docs[i].createTime || '';      // "new" in the store
                list.push(a);
            }
            var before = JSON.stringify(rawCatalog());
            Store.rawSet(CATALOG, list);
            cb(null, apps(), before !== JSON.stringify(list));
        });
    }

    // cb(err, app): err 'notfound' when it was removed from the store or hidden, 'network' / 'http n' otherwise.
    function fetchApp(id, cb) {
        get('apps/' + encodeURIComponent(id), ONE_TIMEOUT, function (err, data) {
            if (err) return cb(err);
            var list = clean([data]);
            cb(list.length ? null : 'notfound', list[0]);       // hidden or malformed counts as gone
        });
    }

    /* ---------------- store statistics ---------------- */

    function statsCached() { return Store.rawGet(STATS) || {}; }
    function stats(cb) {
        request('GET', ROOT + '/appstats?pageSize=300', null, TIMEOUT, function (err, r) {
            if (err) return cb(err, statsCached());
            var out = {}, docs = (r && r.documents) || [];
            for (var i = 0; i < docs.length; i++) {
                var f = fromFields(docs[i].fields || {});
                out[docs[i].name.split('/').pop()] = { installs: f.installs || 0, opens: f.opens || 0 };
            }
            Store.rawSet(STATS, out);
            cb(null, out);
        });
    }
    // +1, done by Firestore itself (two TVs at the same time both count)
    function count(id, field) {
        commit([{ transform: { document: DB + '/appstats/' + id, fieldTransforms: [{ fieldPath: field, increment: { integerValue: '1' } }] } }], TIMEOUT);
    }

    return {
        catalog: catalog, apps: apps, refresh: refresh, fetchApp: fetchApp, clean: clean, url: URL,
        install: install, uninstall: uninstall, isInstalled: isInstalled, installedIds: installedIds,
        onChange: function (fn) { listeners.push(fn); },
        stats: stats, statsCached: statsCached, count: count,
        get: get, patch: patch, remove: remove, batchGet: batchGet, commit: commit, toFields: toFields, fromFields: fromFields
    };
})();
