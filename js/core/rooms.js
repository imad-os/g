/* Rooms (lobbies) for apps and games: the shell side of MyPC.rooms (sdk/mypc-sdk.js).
 * Apps never see Firebase: they send small postMessage requests and the shell does the work with the same
 * Firestore REST helpers as the rest of My PC (js/core/cloud.js). Layout (firebase/firestore.rules):
 *   rooms/{room}            { app, name, max, n, at, exp }   exp = now + 45 s, refreshed every 15 s by the host's shell
 *   rooms/{room}/reqs/{req} { name, offer, exp, answer?, no? }
 * A Session belongs to ONE running app (its appId scopes every room it can list or open) and is destroyed with it:
 * the room and its requests are deleted. Payloads (offer / answer) are opaque strings, never parsed here.
 *   var s = new Rooms.Session(appId, profileName, function (event, data) { ... });   events: 'request', 'answer', 'denied', 'closed'
 *   s.call(op, args, function (errCode, result) { ... })    op: open list ask accept decline close cancel
 * Error codes: offline denied full gone invalid unavailable. */
var Rooms = (function () {
    'use strict';

    var L = { name: 24, payload: 6000, ttl: 45000, beat: 15000, askTtl: 60000, poll: 2000, askPoll: 1500, listMax: 20,
              minMax: 2, maxMax: 8, defMax: 2, asksPerMin: 5, opensPerMin: 6, timeout: 6000 };
    var ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';
    var asks = [], opens = [];                       // TV-wide rate limits (timestamps)

    function id(n) {
        var out = '', i, b = null;
        try { b = new Uint8Array(n); (window.crypto || window.msCrypto).getRandomValues(b); } catch (e) { b = null; }
        for (i = 0; i < n; i++) out += ALPHA.charAt((b ? b[i] : Math.floor(Math.random() * 256)) % ALPHA.length);
        return out;
    }
    function rate(list, max) {
        var t = Date.now(), i;
        for (i = list.length - 1; i >= 0; i--) if (t - list[i] > 60000) list.splice(i, 1);
        if (list.length >= max) return false;
        list.push(t);
        return true;
    }
    // Cloud error -> the documented code
    function code(err) {
        if (err === 'network') return 'offline';
        if (err === 'notfound' || err === 'conflict') return 'gone';
        if (err === 'http 403' || err === 'http 401') return 'denied';
        if (err === 'http 400') return 'invalid';
        return 'unavailable';
    }
    function now() { return Cloud.now(); }                 // server time (the TV's clock may be wrong)
    // learns the server's time once (the rules compare `exp` with it): cb(errCode | null)
    function sync(cb) {
        if (Cloud.synced()) return cb(null);
        Cloud.query('', { from: [{ collectionId: 'rooms' }], limit: 1 }, L.timeout, function (err) { cb(err ? code(err) : null); });
    }
    function str(v, max) { return typeof v === 'string' && v.length > 0 && v.length <= max; }
    function cleanName(v, def) { v = typeof v === 'string' ? v.replace(/\s+/g, ' ').replace(/^ | $/g, '').slice(0, L.name) : ''; return v || String(def || '').slice(0, L.name) || 'Player'; }
    function ms(t) { var n = typeof t === 'string' ? Date.parse(t) : +t; return isNaN(n) ? 0 : n; }

    function Session(appId, profileName, emit) {
        var self = this, room = null, asking = {}, dead = false;
        self.appId = appId;

        function fire(ev, d) { if (!dead) { try { emit(ev, d); } catch (e) {} } }

        /* ---------- host: heartbeat + request polling ---------- */
        function stopRoom() {
            if (!room) return;
            clearInterval(room.beat); clearInterval(room.poll);
            room = null;
        }
        function beat(r) {
            Cloud.patchMask('rooms/' + r.id, { exp: new Date(now() + L.ttl), n: r.n }, ['exp', 'n'], { exists: true }, L.timeout, function (err) {
                if ((err === 'notfound' || err === 'conflict') && room === r) { stopRoom(); fire('closed', { room: r.id }); }
            });
        }
        function poll(r) {
            if (r.busy) return;
            r.busy = true;
            Cloud.query('rooms/' + r.id, { from: [{ collectionId: 'reqs' }], limit: 25 }, L.timeout, function (err, docs) {
                r.busy = false;
                if (err || room !== r) return;
                for (var i = 0; i < docs.length; i++) {
                    var q = docs[i], d = q.data;
                    if (r.seen[q.id] || d.answer || d.no || !str(d.offer, L.payload) || ms(d.exp) < now()) continue;
                    r.seen[q.id] = 1;
                    fire('request', { room: r.id, id: q.id, name: cleanName(d.name, ''), offer: d.offer });
                }
            });
        }
        function wipe(r, cb) {                       // deletes the requests, then the room
            Cloud.query('rooms/' + r.id, { from: [{ collectionId: 'reqs' }], limit: 25 }, L.timeout, function (err, docs) {
                var left = 1, i;
                function one() { if (--left === 0 && cb) cb(); }
                for (i = 0; !err && docs && i < docs.length; i++) { left++; Cloud.remove('rooms/' + r.id + '/reqs/' + docs[i].id, L.timeout, one); }
                left++; Cloud.remove('rooms/' + r.id, L.timeout, one);
                one();
            });
        }

        /* ---------- guest: wait for the answer ---------- */
        function watch(a) {
            a.n = 0;
            a.timer = setInterval(function () {
                if (a.busy) return;
                if (++a.n % 3 === 0) {                                       // the host's app may have closed: its room is gone
                    a.busy = true;
                    return Cloud.get('rooms/' + a.room, L.timeout, function (err) { a.busy = false; if (err === 'notfound' && asking[a.id]) finish(a, 'gone', true); });
                }
                if (Date.now() - a.at > L.askTtl) return finish(a, 'timeout', true);
                a.busy = true;
                Cloud.get('rooms/' + a.room + '/reqs/' + a.id, L.timeout, function (err, d) {
                    a.busy = false;
                    if (!asking[a.id]) return;
                    if (err === 'notfound') return finish(a, 'gone', false);
                    if (err || !d) return;                                   // offline for a moment: keep trying until the timeout
                    if (d.answer) { finish(a, null, true); fire('answer', { req: a.id, answer: d.answer }); }
                    else if (d.no) finish(a, 'no', true);
                });
            }, L.askPoll);
        }
        function finish(a, why, del) {
            clearInterval(a.timer);
            delete asking[a.id];
            if (del) Cloud.remove('rooms/' + a.room + '/reqs/' + a.id, L.timeout, function () {});
            if (why) fire('denied', { req: a.id, why: why });
        }

        /* ---------- operations ---------- */
        var ops = {
            open: function (args, cb) {
                if (room) return cb('denied');                               // one open room at a time
                if (!rate(opens, L.opensPerMin)) return cb('denied');
                var max = Math.floor(+args.max || L.defMax);
                if (max < L.minMax || max > L.maxMax) max = Math.max(L.minMax, Math.min(L.maxMax, max));
                var r = { id: id(8), name: cleanName(args.name, profileName), max: max, n: 1, seen: {}, busy: false, beat: 0, poll: 0 };
                room = r;                                                    // reserved while the write is in flight
                sync(function (e0) {
                    if (room !== r) return;
                    if (e0) { room = null; return cb(e0); }
                    Cloud.patch('rooms/' + r.id, { app: appId, name: r.name, max: r.max, n: 1, at: now(), exp: new Date(now() + L.ttl) }, { exists: false }, L.timeout, function (err) {
                        if (room !== r) return;                              // closed meanwhile
                        if (err) { room = null; return cb(code(err)); }
                        r.beat = setInterval(function () { beat(r); }, L.beat);
                        r.poll = setInterval(function () { poll(r); }, L.poll);
                        cb(null, { id: r.id, name: r.name, max: r.max });
                    });
                });
            },
            list: function (args, cb) {
                var t0 = now();
                function done(err, docs) {
                    if (err) return cb(code(err));
                    var out = [], t1 = now();
                    for (var i = 0; i < docs.length; i++) {
                        var d = docs[i].data;
                        if (d.app !== appId || ms(d.exp) < t1 || !d.name) continue;
                        out.push({ id: docs[i].id, name: cleanName(d.name, ''), count: Math.max(1, d.n | 0), at: d.at | 0 });
                    }
                    out.sort(function (a, b) { return b.at - a.at; });
                    out = out.slice(0, L.listMax);
                    for (i = 0; i < out.length; i++) delete out[i].at;
                    cb(null, out);
                }
                var byApp = { fieldFilter: { field: { fieldPath: 'app' }, op: 'EQUAL', value: { stringValue: appId } } };
                var live = { fieldFilter: { field: { fieldPath: 'exp' }, op: 'GREATER_THAN', value: { timestampValue: new Date(t0).toISOString() } } };
                Cloud.query('', { from: [{ collectionId: 'rooms' }], where: { compositeFilter: { op: 'AND', filters: [byApp, live] } },
                                  orderBy: [{ field: { fieldPath: 'exp' }, direction: 'DESCENDING' }], limit: 50 }, L.timeout, function (err, docs) {
                    if (err === 'http 400' || err === 'conflict') {          // the (app, exp) index is not created yet: simpler query, filtered here
                        return Cloud.query('', { from: [{ collectionId: 'rooms' }], where: byApp, limit: 50 }, L.timeout, done);
                    }
                    done(err, docs);
                });
            },
            ask: function (args, cb) {
                var rid = args.room;
                if (!str(rid, 32) || !/^[a-z0-9]+$/.test(rid) || !str(args.offer, L.payload)) return cb('invalid');
                if (room && room.id === rid) return cb('invalid');
                if (!rate(asks, L.asksPerMin)) return cb('denied');
                sync(function (e0) { if (e0) return cb(e0); Cloud.get('rooms/' + rid, L.timeout, function (err, d) {
                    if (err) return cb(code(err));
                    if (!d || d.app !== appId || ms(d.exp) < now()) return cb('gone');
                    if ((d.n | 0) >= (d.max | 0)) return cb('full');
                    var a = { id: id(10), room: rid, at: Date.now(), busy: false, timer: 0 };      // local clock: only for the 60 s wait
                    Cloud.patch('rooms/' + rid + '/reqs/' + a.id, { name: cleanName(args.name, profileName), offer: args.offer, exp: new Date(now() + L.askTtl + 10000) }, { exists: false }, L.timeout, function (err2) {
                        if (err2) return cb(code(err2));
                        if (dead) { Cloud.remove('rooms/' + rid + '/reqs/' + a.id, L.timeout, function () {}); return cb('gone'); }
                        asking[a.id] = a;
                        watch(a);
                        cb(null, { id: a.id });
                    });
                }); });
            },
            cancel: function (args, cb) {
                var a = asking[args.req];
                if (!a) return cb(null, true);
                finish(a, null, true);
                cb(null, true);
            },
            accept: function (args, cb) {
                var r = room;
                if (!r || r.id !== args.room) return cb('gone');
                if (!str(args.req, 32) || !/^[a-z0-9]+$/.test(args.req) || !str(args.answer, L.payload)) return cb('invalid');
                if (r.n >= r.max) {
                    Cloud.patchMask('rooms/' + r.id + '/reqs/' + args.req, { no: true }, ['no'], { exists: true }, L.timeout, function () {});
                    return cb('full');
                }
                Cloud.patchMask('rooms/' + r.id + '/reqs/' + args.req, { answer: args.answer }, ['answer'], { exists: true }, L.timeout, function (err) {
                    if (err) return cb(code(err));
                    if (room === r) { r.n++; beat(r); }
                    cb(null, true);
                });
            },
            decline: function (args, cb) {
                var r = room;
                if (!r || r.id !== args.room) return cb('gone');
                if (!str(args.req, 32) || !/^[a-z0-9]+$/.test(args.req)) return cb('invalid');
                Cloud.patchMask('rooms/' + r.id + '/reqs/' + args.req, { no: true }, ['no'], { exists: true }, L.timeout, function (err) { cb(err ? code(err) : null, true); });
            },
            close: function (args, cb) {
                var r = room;
                if (!r || r.id !== args.room) return cb(null, true);         // already closed
                stopRoom();
                wipe(r, function () { cb(null, true); });
            }
        };

        // op: string, args: plain object from the app (never trusted), cb(errCode, result)
        self.call = function (op, args, cb) {
            if (dead || !ops.hasOwnProperty(op)) return cb('invalid');
            if (!args || typeof args !== 'object') args = {};
            ops[op](args, function (err, res) { if (!dead || op === 'close') cb(err || null, res); });
        };

        // the app was closed: nothing may be left behind
        self.destroy = function () {
            if (dead) return;
            var r = room, k;
            dead = true;
            stopRoom();
            // the page is about to change (the app closes by loading the desktop): keepalive deletes finish anyway
            for (k in asking) { clearInterval(asking[k].timer); Cloud.removeKeep('rooms/' + asking[k].room + '/reqs/' + asking[k].id); }
            asking = {};
            if (r) { for (k in r.seen) Cloud.removeKeep('rooms/' + r.id + '/reqs/' + k); Cloud.removeKeep('rooms/' + r.id); }
        };
    }

    return { Session: Session, LIMITS: L };
})();
