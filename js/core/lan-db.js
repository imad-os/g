/* Rooms on the home network (owner request 2026-11-13): when the internet is missing or limited (js/core/netmode.js), multiplayer
 * rooms live on a "room hub" on this Wi-Fi instead of Firestore. A Samsung TV web app can not listen on a port, so the hub is My PC's
 * Android app (android-controller LanServer.java + LanDb.java, port 47800, while the app is open) or a computer running
 * `node tools/lan-hub.mjs`. Every device (the TVs too) is a client: it finds the hubs by asking GET /mypc/hello on its own
 * address (127.0.0.1), the hubs it used before (arc_dev_lanhubs) and, if none answers, every address of its /24 (Lan.scan, js/core/lan.js).
 * A hub is a tiny in-memory document store with the same shape as Firestore's rooms (js/core/rooms.js runs unchanged on it):
 *   POST /db  body (text/plain, no CORS preflight) { op, path | parent + coll, data, fields, exists, limit } -> { t: hub time ms, data | docs | err }
 *   ops: get, set (whole doc), merge (only `fields`), del, list (one collection); err: notfound conflict invalid full
 *   documents expire at their `exp` (ISO time or ms; without one: 1 hour after the last write); 400 documents, 8 KB each, at most.
 * LanDb.hub(base) = one hub with the Cloud-like calls Rooms uses (get patch patchMask query remove removeKeep now synced);
 * LanDb.multi([hubs]) = several hubs as one: rooms are listed from all, every later call goes to the hub that holds that room,
 * new rooms go to the first hub. LanDb.find(cb(err | 'nohub', multi), { scan: true }) finds them. Polling a hub costs nothing
 * (no Firestore), so rooms on a hub check every 2 s (Rooms, `db.local`). */
var LanDb = (function () {
    'use strict';

    var PORT = 47800, HELLO = '/mypc/hello', SAVED = 'arc_dev_lanhubs', KEEP = 6, CACHE_MS = 20000;
    var cache = null, cacheAt = 0, finding = null, missAt = 0, MISS_MS = 10000;      // a failed search is not repeated for 10 s

    function savedList() { var v = null; try { v = JSON.parse(localStorage.getItem(SAVED)); } catch (e) {} return v && v.length !== undefined ? v : []; }
    function save(list) { try { localStorage.setItem(SAVED, JSON.stringify(list.slice(0, KEEP))); } catch (e) {} }

    // fetch with a time limit: cb(err | null, json)
    function post(url, body, timeout, cb) {
        var done = false, ctl = null, t;
        function end(err, j) { if (done) return; done = true; clearTimeout(t); if (err) { try { if (ctl) ctl.abort(); } catch (e) {} } cb(err, j); }
        t = setTimeout(function () { end('network'); }, timeout || 4000);
        try {
            ctl = typeof AbortController === 'function' ? new AbortController() : null;
            var o = { method: body === null ? 'GET' : 'POST', cache: 'no-store', credentials: 'omit', signal: ctl ? ctl.signal : undefined };
            if (body !== null) o.body = JSON.stringify(body);              // a string body = text/plain: a "simple" request, no preflight
            fetch(url, o).then(function (r) { return r.json(); }).then(function (j) { end(null, j); }, function () { end('network'); });
        } catch (e) { end('network'); }
    }
    var ERR = { notfound: 'notfound', conflict: 'conflict', invalid: 'http 400', full: 'http 429' };

    function hub(base, info) {
        var off = null, url = base + '/db';
        function call(body, timeout, cb) {
            var t0 = Date.now();
            post(url, body, timeout, function (err, j) {
                if (err || !j || typeof j !== 'object') return cb('network');
                if (typeof j.t === 'number') off = j.t - Math.round((t0 + Date.now()) / 2);
                if (j.err) return cb(ERR[j.err] || 'http 400', j);
                cb(null, j);
            });
        }
        function pre(p) { return p && typeof p.exists === 'boolean' ? p.exists : undefined; }
        return {
            base: base, id: info && info.id || base, name: info && info.name || '', local: true,
            get: function (path, timeout, cb) { call({ op: 'get', path: path }, timeout, function (err, j) { cb(err, err ? null : j.data); }); },
            patch: function (path, data, p, timeout, cb) { call({ op: 'set', path: path, data: data, exists: pre(p) }, timeout, function (err) { cb(err); }); },
            patchMask: function (path, data, fields, p, timeout, cb) { call({ op: 'merge', path: path, data: data, fields: fields, exists: pre(p) }, timeout, function (err) { cb(err); }); },
            query: function (parent, q, timeout, cb) {
                var coll = q && q.from && q.from[0] && q.from[0].collectionId;
                call({ op: 'list', parent: parent || '', coll: coll, limit: q && q.limit || 50 }, timeout, function (err, j) { cb(err, err ? null : j.docs || []); });
            },
            remove: function (path, timeout, cb) { call({ op: 'del', path: path }, timeout, function (err) { cb(err === 'notfound' ? null : err); }); },
            removeKeep: function (path) {
                try { fetch(url, { method: 'POST', body: JSON.stringify({ op: 'del', path: path }), keepalive: true, credentials: 'omit' }).catch(function () {}); }
                catch (e) { call({ op: 'del', path: path }, 2000, function () {}); }
            },
            now: function () { return Date.now() + (off || 0); },
            synced: function () { return off !== null; }
        };
    }

    // several hubs as one (each phone with My PC open is a hub; a guest may find a different one first)
    function multi(hubs) {
        var owner = {}, first = hubs[0];
        function route(path) { var m = /^rooms\/([^\/]+)/.exec(path || ''); return m && owner[m[1]] || first; }
        function by(fn) { return function (path) { var h = route(path); return h[fn].apply(h, arguments); }; }
        return {
            hubs: hubs, local: true, base: first.base,
            get: by('get'), patch: by('patch'), patchMask: by('patchMask'), remove: by('remove'), removeKeep: by('removeKeep'),
            query: function (parent, q, timeout, cb) {
                if (parent) return route(parent).query(parent, q, timeout, cb);
                var left = hubs.length, all = [], seen = {}, ok = false, lastErr = null;
                hubs.forEach(function (h) {
                    h.query('', q, timeout, function (err, docs) {
                        if (err) lastErr = err; else ok = true;
                        for (var i = 0; !err && i < docs.length; i++) {
                            if (seen[docs[i].id]) continue;
                            seen[docs[i].id] = 1; owner[docs[i].id] = h;
                            // every hub has its own clock: `exp` is turned into this device's time of the first hub
                            var d = docs[i].data, e = typeof d.exp === 'string' ? Date.parse(d.exp) : +d.exp;
                            if (!isNaN(e) && h !== first) d.exp = e - h.now() + first.now();
                            all.push(docs[i]);
                        }
                        if (--left === 0) cb(ok ? null : lastErr, ok ? all : null);
                    });
                });
            },
            now: function () { return first.now(); },
            synced: function () { return first.synced(); }
        };
    }

    function hello(base, timeout, cb) {
        post(base + HELLO, null, timeout, function (err, j) { cb(!err && j && j.app === 'mypc' && j.db === 1 ? j : null); });
    }
    function own() { return 'http://127.0.0.1:' + PORT; }

    // cb(null, multi) | cb('nohub'); opts.scan = also scan the /24 when the known hubs do not answer (or always with opts.scan === 'always')
    function find(cb, opts) {
        opts = opts || {};
        if (cache && Date.now() - cacheAt < CACHE_MS && opts.scan !== 'always') return cb(null, cache);
        if (finding) { finding.push(cb); return; }
        if (!cache && missAt && Date.now() - missAt < MISS_MS) return cb('nohub', null);
        finding = [cb];
        var found = [], ids = {}, bases = [own()].concat(savedList()), left, i;
        function add(base, j) {
            if (!j || ids[j.id || base]) return;
            ids[j.id || base] = 1;
            found.push(hub(base, j));
        }
        function done() {
            var l = finding; finding = null;
            if (found.length) { cache = multi(found); cacheAt = Date.now(); save(found.map(function (h) { return h.base; }).filter(function (b) { return b !== own(); })); }
            else { cache = null; missAt = Date.now(); }
            for (var k = 0; k < l.length; k++) { try { l[k](found.length ? null : 'nohub', cache); } catch (e) {} }
        }
        function scan() {
            if (!opts.scan || !window.Lan || !Lan.scan) return done();
            var ended = false;
            function fin() { if (!ended) { ended = true; done(); } }
            try {
                var p = Lan.scan({ port: PORT, path: HELLO, timeout: 700,
                    match: function (j) { return !!(j && j.app === 'mypc' && j.db === 1); },
                    onFound: function (a, b) {
                        // (ip, json) or ({ ip | url, json | data })
                        var ip = typeof a === 'string' ? a : a && (a.ip || a.host || a.url), j = typeof a === 'string' ? b : a && (a.json || a.data || a.info);
                        if (!ip) return;
                        add(/^https?:/.test(ip) ? ip.replace(/\/mypc\/hello.*$/, '').replace(/\/$/, '') : 'http://' + ip + ':' + PORT, j || { app: 'mypc', db: 1, id: ip });
                    },
                    onDone: fin });
                if (p && typeof p.then === 'function') p.then(fin, fin);
            } catch (e) { fin(); }
        }
        left = bases.length;
        for (i = 0; i < bases.length; i++) (function (b) {
            hello(b, 1500, function (j) {
                add(b, j);
                if (--left === 0) { if (found.length && opts.scan !== 'always') done(); else scan(); }
            });
        })(bases[i]);
    }

    return { hub: hub, multi: multi, find: find, hello: hello, PORT: PORT, forget: function () { cache = null; cacheAt = 0; missAt = 0; } };
})();
