/* This TV's identity and its cloud backup.
 *
 * Device.id(): "tv-" + a hash of the TV's own unique id (Samsung DUID, from webapis.productinfo; it stays
 * the same after a factory reset). The DUID itself never leaves the TV. Without it (a PC browser, an
 * older package without the productinfo privilege) a random id is kept in storage instead.
 *
 * Backup: everything My PC keeps on the TV (profiles with their settings and saves, installed apps, records)
 * is copied to Firestore "tvs/<id>" a little after it changes. When My PC starts on a TV with nothing saved
 * (reinstalled, or the TV was reset) it looks for that copy first and puts it back.
 * The document also holds a summary (model, version, installed apps, best scores) for the App Store Manager. */
var Device = (function () {
    'use strict';

    // cyrb53: small, fast 53-bit string hash (two seeds = 106 bits, enough for an id)
    function cyrb53(str, seed) {
        var h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
        for (var i = 0, ch; i < str.length; i++) {
            ch = str.charCodeAt(i);
            h1 = Math.imul(h1 ^ ch, 2654435761);
            h2 = Math.imul(h2 ^ ch, 1597334677);
        }
        h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
        h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
        return 4294967296 * (2097151 & h2) + (h1 >>> 0);
    }
    function hex(n) { return ('00000000000000' + n.toString(16)).slice(-14); }

    function source() {
        try { var d = webapis.productinfo.getDuid(); if (d && String(d).length >= 8) return { v: String(d), src: 'duid' }; } catch (e) {}
        try { var t = tizen.systeminfo.getCapability('http://tizen.org/system/tizenid'); if (t && String(t).length >= 10) return { v: String(t), src: 'tizen' }; } catch (e2) {}
        var r = Store.rawGet('arc_dev_tvrand');
        if (!r) {
            r = '';
            for (var i = 0; i < 4; i++) r += Math.floor(Math.random() * 4294967296).toString(16);
            Store.rawSet('arc_dev_tvrand', r);
        }
        return { v: r, src: 'random' };
    }

    var s = source();
    var id = 'tv-' + hex(cyrb53('mypc:' + s.v, 1)) + hex(cyrb53('mypc:' + s.v, 2));

    function model() {
        try { return String(webapis.productinfo.getRealModel() || webapis.productinfo.getModel() || '').slice(0, 40); } catch (e) {}
        try { return String(webapis.productinfo.getModel() || '').slice(0, 40); } catch (e2) {}
        return navigator.platform ? 'Browser ' + String(navigator.platform).slice(0, 30) : 'Browser';
    }

    return { id: function () { return id; }, source: function () { return s.src; }, model: model };
})();

var Backup = (function () {
    'use strict';

    var DIRTY = 'arc_dev_backup_dirty', LAST = 'arc_dev_backup_at', FIRST = 'arc_dev_first_seen', OFF = 'arc_dev_backup_off';
    var MAX_BLOB = 800000;
    var DEBOUNCE = 20000, DAILY = 24 * 3600 * 1000;
    // not copied: this TV's identity, caches that come back from the internet, bookkeeping
    var SKIP = /^arc_dev_(tvrand|backup_|catalog|appstats|world_queue|world_cache|seen_build|touchpad|update_checked|perf_bench|settings_v2|scores_v2)|^arc_p\d+_cloud_apps$/;
    var timer = 0, busy = false, enabled = false;

    function mine(k) { return k && k.indexOf('arc_') === 0 && !SKIP.test(k); }

    // every key of My PC, as stored (JSON text)
    function snapshot() {
        var out = {};
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (mine(k)) out[k] = localStorage.getItem(k);
            }
        } catch (e) {}
        return out;
    }

    function summary() {
        var top = {}, l = Profiles.list(), names = [], keys = snapshot();
        for (var k in keys) {
            var m = /^arc_dev_top_(.+)$/.exec(k);
            if (!m) continue;
            var t = Store.rawGet(k);
            if (t && t[0]) top[m[1]] = { n: String(t[0].n || '').slice(0, 24), s: t[0].s | 0 };
        }
        for (var i = 0; i < l.length; i++) names.push(Profiles.name(l[i], I18n.t('player')).slice(0, 24));
        return { top: top, names: names };
    }

    function doc() {
        var blob = JSON.stringify(snapshot()), sum = summary();
        if (!Store.rawGet(FIRST)) Store.rawSet(FIRST, Date.now());
        return {
            tv: Device.id(), src: Device.source(), model: Device.model(),
            version: String(AppBoot.version()), build: AppBoot.build() | 0, lang: I18n.lang(),
            firstSeen: Store.rawGet(FIRST) | 0, lastSeen: Date.now(),
            profiles: sum.names.length, names: sum.names, installed: Cloud.installedIds().slice(0, 200), top: sum.top,
            blob: blob, size: blob.length
        };
    }

    function on() { return !Store.rawGet(OFF); }

    function upload(cb) {
        if (!on()) return cb && cb('off');
        if (busy) return cb && cb('busy');
        var d = doc();
        if (d.size > MAX_BLOB) return cb && cb('too big');
        busy = true;
        Cloud.patch('tvs/' + Device.id(), d, null, 10000, function (err) {
            busy = false;
            if (!err) { Store.rawSet(LAST, Date.now()); try { localStorage.removeItem(DIRTY); } catch (e) {} }
            if (cb) cb(err);
        });
    }

    function schedule(delay) {
        if (!enabled || !on()) return;
        clearTimeout(timer);
        timer = setTimeout(function () { upload(); }, delay === undefined ? DEBOUNCE : delay);
    }

    // on the desktop page: upload what changed (also while a game page was open), and at least once a day
    function start() {
        enabled = true;
        var dirty = false, last = Store.rawGet(LAST) || 0;
        try { dirty = localStorage.getItem(DIRTY) !== null; } catch (e) {}
        if (dirty || Date.now() - last > DAILY) schedule(6000);
    }

    // A fresh My PC: look for this TV's copy. cb(restored)
    function restore(cb) {
        Cloud.get('tvs/' + Device.id(), 4000, function (err, data) {
            var keys = null;
            if (!err && data && typeof data.blob === 'string') { try { keys = JSON.parse(data.blob); } catch (e) {} }
            if (!keys || typeof keys !== 'object') return cb(false);
            var n = 0;
            try {
                // what a fresh start already wrote (default profile...) is replaced by the copy
                for (var i = localStorage.length - 1; i >= 0; i--) { var k = localStorage.key(i); if (mine(k)) localStorage.removeItem(k); }
                for (var key in keys) if (mine(key) && typeof keys[key] === 'string') { localStorage.setItem(key, keys[key]); n++; }
            } catch (e2) {}
            cb(n > 0);
        });
    }

    Store.onWrite(function (k) {
        if (!mine(k)) return;
        try { localStorage.setItem(DIRTY, '1'); } catch (e) {}
        schedule();
    });

    // Settings > Privacy: turn it off (nothing is sent any more), or delete the copy in the cloud
    function setOn(v) { Store.rawSet(OFF, !v); if (v) { enabled = true; schedule(1000); } else clearTimeout(timer); }
    function erase(cb) { clearTimeout(timer); Cloud.remove('tvs/' + Device.id(), 6000, function (err) { cb(err === 'notfound' ? null : err); }); }

    return { start: start, restore: restore, upload: upload, doc: doc, snapshot: snapshot, on: on, setOn: setOn, erase: erase };
})();
