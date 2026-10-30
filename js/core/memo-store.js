/* Voice memos of the Memo app, kept apart per profile (each My PC user sees only their own).
 *
 * The app only talks to this interface; where the memos live is an adapter, so a cloud one (Firebase: Firestore for the
 * list + Storage for the sound) can replace the local one later without touching the app:
 *   MemoStore.list(cb)          cb(err, [memo, ...]) newest first
 *   MemoStore.get(id, cb)       cb(err, memo | null)
 *   MemoStore.save(memo, cb)    cb(err, memo)   (new when it has no id)
 *   MemoStore.remove(id, cb)    cb(err)
 *   MemoStore.dropProfile(p)    deletes every memo of a profile (Profiles.remove)
 *   MemoStore.use(adapter)      adapter: { list(profile, cb), get(profile, id, cb), put(profile, memo, cb), del(profile, id, cb), drop(profile, cb) }
 * A memo: { id, created, updated, seconds, parts: [{ audio: Blob, mime, seconds }] } (one part per recording, up to 15 s each).
 * Local adapter: IndexedDB "mypc_memo" (sound as Blobs, no base64; localStorage is far too small for audio). */
var MemoStore = (function () {
    'use strict';

    function profile() { return Store.profile(); }
    function newId() { return 'm' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36); }
    function total(m) { var s = 0; for (var i = 0; i < m.parts.length; i++) s += +m.parts[i].seconds || 0; return Math.round(s * 10) / 10; }

    var local = (function () {
        var DB = 'mypc_memo', OS = 'memos', db = null, waiting = null;
        function open(cb) {
            if (db) return cb(null, db);
            if (waiting) return waiting.push(cb);
            waiting = [cb];
            function done(err, d) { db = d || null; var w = waiting; waiting = null; for (var i = 0; i < w.length; i++) w[i](err, d); }
            var req;
            try { req = indexedDB.open(DB, 1); } catch (e) { return done(e); }
            req.onupgradeneeded = function () {
                var s = req.result.createObjectStore(OS, { keyPath: 'key' });
                s.createIndex('profile', 'profile');
            };
            req.onsuccess = function () { done(null, req.result); };
            req.onerror = function () { done(req.error || new Error('IndexedDB')); };
        }
        function tx(mode, cb, fn) {
            open(function (err, d) {
                if (err) return cb(err);
                var t, out;
                try { t = d.transaction(OS, mode); out = fn(t.objectStore(OS)); } catch (e) { return cb(e); }
                t.oncomplete = function () { cb(null, out && 'result' in out ? out.result : out); };
                t.onerror = t.onabort = function () { cb(t.error || new Error('IndexedDB')); };
            });
        }
        function strip(r) { return r.memo; }
        return {
            list: function (p, cb) {
                tx('readonly', function (err, rows) {
                    if (err) return cb(err);
                    cb(null, (rows || []).map(strip));
                }, function (s) { return s.index('profile').getAll(p); });
            },
            get: function (p, id, cb) { tx('readonly', function (err, r) { cb(err, r ? strip(r) : null); }, function (s) { return s.get(p + '/' + id); }); },
            put: function (p, m, cb) { tx('readwrite', function (err) { cb(err, m); }, function (s) { s.put({ key: p + '/' + m.id, profile: p, memo: m }); }); },
            del: function (p, id, cb) { tx('readwrite', function (err) { cb(err); }, function (s) { s.delete(p + '/' + id); }); },
            drop: function (p, cb) {
                tx('readwrite', function (err) { cb(err); }, function (s) {
                    var c = s.index('profile').openKeyCursor(IDBKeyRange.only(p));
                    c.onsuccess = function () { var k = c.result; if (k) { s.delete(k.primaryKey); k.continue(); } };
                });
            }
        };
    })();

    var ad = local;
    function safe(cb) { return typeof cb === 'function' ? cb : function () {}; }

    return {
        use: function (adapter) { ad = adapter || local; },
        list: function (cb) {
            cb = safe(cb);
            ad.list(profile(), function (err, l) {
                if (err) return cb(err, []);
                l.sort(function (a, b) { return b.updated - a.updated; });
                cb(null, l);
            });
        },
        get: function (id, cb) { ad.get(profile(), id, safe(cb)); },
        save: function (m, cb) {
            var now = Date.now();
            if (!m.id) { m.id = newId(); m.created = now; }
            m.updated = now;
            m.parts = m.parts || [];
            m.seconds = total(m);
            ad.put(profile(), m, safe(cb));
        },
        remove: function (id, cb) { ad.del(profile(), id, safe(cb)); },
        dropProfile: function (p, cb) { ad.drop(p, safe(cb)); }
    };
})();
