/* World records: the best 10 scores of each game on every My PC, in Firestore "records/<gameId>".
 *   World.submit(gameId, name, score)   after a new record on this TV (queued when offline, sent later)
 *   World.fetch(ids, cb)                cb(err, { gameId: [{ n, s, d, tv }] }) (last good copy when offline)
 *   World.cached()                      the last good copy
 * Two TVs writing at the same moment cannot erase each other: a write only succeeds on the version it read
 * (Firestore precondition), otherwise it reads again and retries. */
var World = (function () {
    'use strict';

    var QUEUE = 'arc_dev_world_queue', CACHE = 'arc_dev_world_cache', OFF = 'arc_dev_world_off', MAX = 10;
    var flushing = false;

    function queue() { var q = Store.rawGet(QUEUE); return q && q.length !== undefined ? q : []; }
    function cached() { return Store.rawGet(CACHE) || {}; }

    function merge(list, e) {
        var out = [], i;
        for (i = 0; i < (list || []).length; i++) {
            var x = list[i];
            if (x && typeof x.s === 'number' && !(x.tv === e.tv && x.n === e.n && x.s === e.s && x.d === e.d)) out.push(x);
        }
        out.push(e);
        out.sort(function (a, b) { return b.s - a.s || a.d - b.d; });
        if (out.length > MAX) out.length = MAX;
        return out;
    }

    function sendOne(e, tries, cb) {
        Cloud.get('records/' + e.g, 4000, function (err, data, updateTime) {
            if (err && err !== 'notfound') return cb(false);
            var list = data && data.list ? data.list : [];
            var next = merge(list, { n: e.n, s: e.s, d: e.d, tv: e.tv });
            var made = false;
            for (var i = 0; i < next.length; i++) if (next[i].tv === e.tv && next[i].s === e.s && next[i].d === e.d) made = true;
            if (!made) return cb(true);                        // not good enough for the world: done
            Cloud.patch('records/' + e.g, { list: next, updatedAt: Date.now() }, err === 'notfound' ? { exists: false } : { updateTime: updateTime }, 5000, function (err2) {
                if (err2 === 'conflict' && tries < 3) return sendOne(e, tries + 1, cb);
                if (!err2) { var c = cached(); c[e.g] = next; Store.rawSet(CACHE, c); }
                cb(!err2);
            });
        });
    }

    function flush() {
        if (flushing) return;
        var q = queue();
        if (!q.length) return;
        flushing = true;
        sendOne(q[0], 1, function (ok) {
            flushing = false;
            if (!ok) return;                                    // offline: try again next time
            var rest = queue();
            rest.shift();
            Store.rawSet(QUEUE, rest);
            if (rest.length) flush();
        });
    }

    function on() { return !Store.rawGet(OFF); }

    function submit(gameId, name, score) {
        if (!(score > 0) || !on()) return;
        var q = queue();
        q.push({ g: gameId, n: String(name).slice(0, 24), s: score | 0, d: Date.now(), tv: Device.id() });
        if (q.length > 50) q = q.slice(-50);
        Store.rawSet(QUEUE, q);
        flush();
    }

    function fetch(ids, cb) {
        var paths = [];
        for (var i = 0; i < ids.length; i++) paths.push('records/' + ids[i]);
        if (!paths.length) return cb(null, {});
        Cloud.batchGet(paths, 5000, function (err, docs) {
            if (err) return cb(err, cached());
            var out = {};
            for (var j = 0; j < ids.length; j++) {
                var d = docs['records/' + ids[j]];
                out[ids[j]] = d && d.data.list ? d.data.list : [];
            }
            Store.rawSet(CACHE, out);
            cb(null, out);
        });
    }

    return { submit: submit, fetch: fetch, flush: flush, cached: cached, merge: merge,
             on: on, setOn: function (v) { Store.rawSet(OFF, !v); if (!v) Store.rawSet(QUEUE, []); } };
})();
