/* Player accounts: a profile can be a My PC account (a unique username and a password), the same on every TV
 * and phone. Its settings, saves and picture are kept in the cloud (Firestore "players/<uid>") and come back
 * wherever the player signs in.
 *
 * Sign-in is Firebase Authentication (REST, e-mail + password; the "e-mail" is <username>@players.mypc.app, no
 * mail is ever sent). Firebase checks the password and keeps it hashed; the rules let only that account read
 * or write its own document. This device keeps, per profile (arc_dev_acct, never in the TV backup):
 *   uid, rt     the account id and its refresh token (stays signed in, like a phone app)
 *   s, h        salt and an iterated SHA-256 of the password, so "Ask for the password" works offline
 *   at          time of the cloud copy this device has
 * The profile itself (arc_profiles) only gets the username (user) and the ask switch (ask).
 *
 *   Accounts.signUp(user, pw, pid|null, cb)   new account; pid: turn this local profile into it, null: a new profile
 *   Accounts.signIn(user, pw, cb)             existing account: adds (or finds) its profile on this device. cb(err, pid)
 *   Accounts.check(pid, pw, cb)               the password of a profile (offline first). cb(ok, err)
 *   Accounts.changePassword(pid, old, pw, cb)
 *   Accounts.pull(pid, timeout, cb)           brings the cloud copy if it is newer. cb(changed)
 *   Accounts.start()                          desktop page: upload what changed a little after it changes
 * Errors: 'taken', 'wrong', 'weak', 'invalid', 'many', 'offline', 'full', 'error'. */
var Accounts = (function () {
    'use strict';

    var SECRETS = 'arc_dev_acct', DIRTY = 'arc_dev_acct_dirty', DOMAIN = '@players.mypc.app';
    var AUTH = 'https://identitytoolkit.googleapis.com/v1/accounts:', TOKEN = 'https://securetoken.googleapis.com/v1/token';
    var MAX_BLOB = 800000, DEBOUNCE = 15000, ROUNDS = 3000;
    var tokens = {}, timer = 0, busy = false, started = false;

    /* ---------------- SHA-256 (small, no WebCrypto: works in any page, also file:// and http) ---------------- */
    var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
        0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
        0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
        0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    var W = new Array(64);
    function sha256(str) {
        var bytes = unescape(encodeURIComponent(str)), n = bytes.length, words = [], i, j;
        for (i = 0; i < n; i++) words[i >> 2] |= bytes.charCodeAt(i) << (24 - (i % 4) * 8);
        words[n >> 2] |= 0x80 << (24 - (n % 4) * 8);
        var len = ((n + 8) >> 6) * 16 + 16;
        for (i = words.length; i < len; i++) words[i] = words[i] | 0;
        words[len - 1] = n * 8;
        var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
        for (i = 0; i < len; i += 16) {
            var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], k = h[7];
            for (j = 0; j < 64; j++) {
                if (j < 16) W[j] = words[i + j] | 0;
                else {
                    var x = W[j - 15], y = W[j - 2];
                    W[j] = (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + W[j - 7] + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10)) + W[j - 16] | 0;
                }
                var t1 = k + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K[j] + W[j] | 0;
                var t2 = (((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c)) | 0;
                k = g; g = f; f = e; e = d + t1 | 0; d = c; c = b; b = a; a = t1 + t2 | 0;
            }
            h[0] = h[0] + a | 0; h[1] = h[1] + b | 0; h[2] = h[2] + c | 0; h[3] = h[3] + d | 0;
            h[4] = h[4] + e | 0; h[5] = h[5] + f | 0; h[6] = h[6] + g | 0; h[7] = h[7] + k | 0;
        }
        var out = '';
        for (i = 0; i < 8; i++) out += ('0000000' + (h[i] >>> 0).toString(16)).slice(-8);
        return out;
    }
    function verifier(pw, salt) { var v = sha256(salt + ':' + pw); for (var i = 0; i < ROUNDS; i++) v = sha256(v + salt); return v; }
    function newSalt() { var s = ''; for (var i = 0; i < 4; i++) s += Math.floor(Math.random() * 4294967296).toString(16); return s; }

    /* ---------------- this device's secrets ---------------- */
    function all() { var m = Store.rawGet(SECRETS); return m && typeof m === 'object' ? m : {}; }
    function sec(pid) { return all()[pid] || null; }
    // written without the write hooks: the TV backup never sees it, and it is not a change of the profile
    function saveAll(m) { try { localStorage.setItem(SECRETS, JSON.stringify(m)); } catch (e) {} }
    function setSec(pid, v) { var m = all(); if (v) m[pid] = v; else delete m[pid]; saveAll(m); }
    function dirtyMap() { var m = Store.rawGet(DIRTY); return m && typeof m === 'object' ? m : {}; }
    function setDirty(pid, t) { var m = dirtyMap(); if (t) m[pid] = t; else delete m[pid]; try { localStorage.setItem(DIRTY, JSON.stringify(m)); } catch (e) {} }

    /* ---------------- usernames ---------------- */
    function clean(u) { return String(u || '').toLowerCase().replace(/\s+/g, ''); }
    // 3 to 16: letters, digits, _ and . (not first or last, never two dots)
    function validName(u) { return /^[a-z0-9][a-z0-9_.]{1,14}[a-z0-9_]$/.test(u) && u.indexOf('..') < 0; }
    function email(u) { return clean(u) + DOMAIN; }

    /* ---------------- Firebase Authentication (REST) ---------------- */
    function why(err, r) {
        if (err === 'network') return 'offline';
        var m = r && r.error && r.error.message ? String(r.error.message) : '';
        if (/EMAIL_EXISTS/.test(m)) return 'taken';
        if (/INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND|USER_DISABLED/.test(m)) return 'wrong';
        if (/WEAK_PASSWORD/.test(m)) return 'weak';
        if (/INVALID_EMAIL/.test(m)) return 'invalid';
        if (/TOO_MANY_ATTEMPTS/.test(m)) return 'many';
        return 'error';
    }
    function auth(op, body, cb) {
        body.returnSecureToken = true;
        Cloud.request('POST', AUTH + op, body, 9000, function (err, r) {
            if (err || !r || !r.localId && !r.idToken) return cb(why(err, r), null);
            cb(null, r);
        });
    }
    function remember(pid, r) { tokens[pid] = { t: r.idToken, exp: Date.now() + ((parseInt(r.expiresIn, 10) || 3600) - 120) * 1000 }; }

    // a fresh ID token for a linked profile: cb(err, token)
    function token(pid, cb) {
        var s = sec(pid), c = tokens[pid];
        if (!s || !s.rt) return cb('signedout');
        if (c && c.exp > Date.now()) return cb(null, c.t);
        Cloud.request('POST', TOKEN, { grant_type: 'refresh_token', refresh_token: s.rt }, 8000, function (err, r) {
            if (err || !r || !r.id_token) {
                // the account was removed or its password changed somewhere else: sign in again
                if (!err || /^http 4/.test(err)) { if (r && r.error) { s.rt = ''; setSec(pid, s); } return cb('signedout'); }
                return cb('offline');
            }
            tokens[pid] = { t: r.id_token, exp: Date.now() + ((parseInt(r.expires_in, 10) || 3600) - 120) * 1000 };
            if (r.refresh_token && r.refresh_token !== s.rt) { s.rt = r.refresh_token; setSec(pid, s); }
            cb(null, r.id_token);
        });
    }

    /* ---------------- the profile's cloud copy ---------------- */
    function prefix(pid) { return 'arc_' + pid + '_'; }
    function snapshot(pid) {
        var out = {}, pre = prefix(pid);
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (k && k.indexOf(pre) === 0 && !/_cloud_apps$/.test(k)) out[k.slice(pre.length)] = localStorage.getItem(k);
            }
        } catch (e) {}
        return out;
    }
    /* The cloud copy is browsable in the Firebase console: data.<game id>.<key> holds a game's saves (localStorage
     * "game_<id>_<key>", the value as stored), settings.<key> the rest of the profile. Older builds wrote all of it
     * as one JSON string "blob". A copy that still has one is merged (no key lost: the new fields win on the same
     * key, this device keeps what the copy does not have) and the next upload writes it without the blob. */
    var GAME_KEY = /^game_([a-z0-9-]+)_(.+)$/, RESERVED = /^__.*__$/;
    function split(keys) {
        var data = {}, settings = {}, m;
        for (var k in keys) {
            if ((m = GAME_KEY.exec(k)) && !RESERVED.test(m[2])) (data[m[1]] = data[m[1]] || {})[m[2]] = keys[k];
            else if (!RESERVED.test(k)) settings[k] = keys[k];      // Firestore refuses field names like __x__
        }
        return { data: data, settings: settings };
    }
    // the old single string, if the copy still has a real one (null: none, or the short mark of build 71)
    function legacyOf(d) {
        var o = null;
        if (typeof d.blob !== 'string' || d.blob.charAt(0) !== '{') return null;
        try { o = JSON.parse(d.blob); } catch (e) { return null; }
        return o && typeof o === 'object' ? o : null;
    }
    // the profile's keys from a cloud copy, old and new shape merged (null: nothing usable in it)
    function keysOf(d) {
        var out = legacyOf(d), k, id, any = !!out;
        out = out || {};
        if (d.settings && typeof d.settings === 'object') { any = true; for (k in d.settings) out[k] = d.settings[k]; }
        if (d.data && typeof d.data === 'object') {
            any = true;
            for (id in d.data) {
                var g = d.data[id];
                if (g && typeof g === 'object') for (k in g) out['game_' + id + '_' + k] = g[k];
            }
        }
        return any ? out : null;
    }
    function docFor(pid, legacy) {
        var p = Profiles.find(pid) || {}, keys = snapshot(pid), size = JSON.stringify(keys).length;
        var d = { user: p.user || '', name: p.name || '', color: p.color || '', size: size, at: Date.now(), from: Device.model() };
        if (legacy) d.blob = JSON.stringify(keys);
        else { var s = split(keys); d.data = s.data; d.settings = s.settings; }
        if (p.av) d.av = p.av;
        if (p.photo) d.photo = p.photo;
        return d;
    }
    // a time in ms (not "| 0": that cuts it to 32 bits, and a cut time against a whole one picks the wrong copy)
    function ms(v) { v = +v; return v > 0 ? v : 0; }
    function okKey(k, v) { return typeof v === 'string' && /^[a-z0-9_.-]{1,80}$/i.test(k); }
    // puts a newer cloud copy over this profile's data (without the write hooks: it is not a local change).
    // Keys this device has and the copy lacks are kept, so a copy that misses something never wipes progress.
    // skip: parts changed here and not uploaded yet (they stay as they are on this device)
    function apply(pid, data, skip) {
        var keys = keysOf(data);
        if (!keys) return false;
        var pre = prefix(pid);
        try {
            for (var key in keys) if (okKey(key, keys[key]) && !(skip && inParts(skip, key))) localStorage.setItem(pre + key, keys[key]);
            localStorage.setItem('arc_dev_backup_dirty', '1');          // the TV backup copies it later
        } catch (e2) {}
        Profiles.setMeta(pid, data);
        return true;
    }
    // an older copy that still has the old blob: what this device lacks comes from it (this device wins), then
    // the next upload writes the merged profile in the new shape, without the blob. 0: no blob, -1: nothing added
    function migrate(pid, data) {
        if (!legacyOf(data)) return 0;
        var keys = keysOf(data), pre = prefix(pid), added = 0;
        try {
            for (var key in keys) if (okKey(key, keys[key]) && localStorage.getItem(pre + key) === null) { localStorage.setItem(pre + key, keys[key]); added++; }
            var cur = sec(pid);
            if (cur && cur.v2) { cur.v2 = false; setSec(pid, cur); }          // the next upload writes the whole merged copy
            if (added) localStorage.setItem('arc_dev_backup_dirty', '1');
        } catch (e) {}
        setDirty(pid, Date.now());                 // uploaded soon (also after a reload: Accounts.start)
        return added || -1;
    }

    /* What changed on this device since the last upload, per profile (arc_dev_acct_parts, kept over page changes:
     * the game page writes, the desktop uploads): { g: { <game id>: 1 }, s: { <settings key>: 1 } }. An upload writes
     * only those (updateMask data.<id> / settings.<key>), so an old copy of another game here never overwrites the
     * cloud. The whole document is written only when it does not exist yet or still has the old blob. */
    var PARTS = 'arc_dev_acct_parts';
    function partsMap() { var m = Store.rawGet(PARTS); return m && typeof m === 'object' ? m : {}; }
    function getParts(pid) { var p = partsMap()[pid]; return p && typeof p === 'object' ? { g: p.g || {}, s: p.s || {} } : { g: {}, s: {} }; }
    function setParts(pid, v) { var m = partsMap(); if (v) m[pid] = v; else delete m[pid]; try { localStorage.setItem(PARTS, JSON.stringify(m)); } catch (e) {} }
    function addParts(pid, more) {
        var p = getParts(pid), k;
        for (k in more.g) p.g[k] = 1;
        for (k in more.s) p.s[k] = 1;
        setParts(pid, p);
    }
    function partOf(key) {
        var m = GAME_KEY.exec(key);
        if (m && !RESERVED.test(m[2])) return { g: m[1] };
        return RESERVED.test(key) ? null : { s: key };
    }
    function inParts(parts, key) { var w = partOf(key); return !!w && (w.g ? !!parts.g[w.g] : !!parts.s[w.s]); }
    function quote(name) { return '`' + String(name).replace(/[\\`]/g, '\\$&') + '`'; }
    var META = ['user', 'name', 'color', 'av', 'photo', 'size', 'at', 'from'];

    // newer cloud copy -> this device; what changed here since the last upload is kept when it is newer still
    function take(pid, data) {
        var mine = dirtyMap()[pid] || 0, keep = mine > ms(data.at) ? getParts(pid) : null;
        if (!apply(pid, data, keep)) return false;
        var cur = sec(pid);
        if (cur) { cur.at = ms(data.at); cur.v2 = !legacyOf(data); setSec(pid, cur); }
        if (legacyOf(data)) setDirty(pid, Date.now());          // written again in the new shape, without the blob
        else if (!keep) { setParts(pid, null); setDirty(pid, 0); }
        return true;
    }

    function upload(pid, cb) {
        cb = cb || function () {};
        var s = sec(pid);
        if (!s || !s.uid) return cb('signedout');
        var parts = getParts(pid), started = Date.now();
        setParts(pid, null);
        function fail(e) { addParts(pid, parts); cb(e === 'network' ? 'offline' : e); }
        token(pid, function (err, t) {
            if (err) return fail(err);
            var path = 'players/' + s.uid;
            function saved(d, v2) {
                var now = sec(pid);
                if (now) { now.at = d.at; now.v2 = v2; setSec(pid, now); }
                if ((dirtyMap()[pid] || 0) <= started) setDirty(pid, 0);
                cb(null);
            }
            function whole() {
                var d = docFor(pid);
                if (d.size > MAX_BLOB) return fail('too big');
                Cloud.patch(path, d, null, 10000, function (e2) {
                    // rules from before data / settings (not published again): the old single-blob shape
                    if (e2 === 'http 403') {
                        var old = docFor(pid, true); old.at = d.at;
                        return Cloud.patch(path, old, null, 10000, function (e3) { if (e3) return fail(e3); saved(old, false); }, t);
                    }
                    if (e2) return fail(e2);
                    saved(d, true);
                }, t);
            }
            function some() {
                var keys = snapshot(pid), full = docFor(pid), d = {}, fields = META.slice(), i, k, w;
                if (full.size > MAX_BLOB) return fail('too big');
                for (i = 0; i < META.length; i++) if (full[META[i]] !== undefined) d[META[i]] = full[META[i]];
                d.data = {}; d.settings = {};
                for (k in parts.g) { fields.push('data.' + quote(k)); if (full.data[k]) d.data[k] = full.data[k]; }
                for (k in parts.s) { fields.push('settings.' + quote(k)); if (keys[k] !== undefined && (w = partOf(k)) && w.s) d.settings[k] = keys[k]; }
                if (!Object.keys(d.data).length) delete d.data;              // nothing in the body that is not in the mask
                if (!Object.keys(d.settings).length) delete d.settings;
                Cloud.patchMask(path, d, fields, { exists: true }, 10000, function (e2) {
                    if (e2 === 'notfound' || e2 === 'http 403') return whole();
                    if (e2) return fail(e2);
                    saved(d, true);
                }, t);
            }
            if (s.v2) return some();
            // first upload from this device: is the cloud copy already in the new shape?
            Cloud.get(path, 8000, function (e2, data) {
                if (e2 === 'notfound') return whole();
                if (e2 || !data) return fail(e2 || 'error');
                if (!legacyOf(data) && data.data) return some();
                if (ms(data.at) > ms(s.at)) take(pid, data); else migrate(pid, data);
                whole();
            }, t);
        });
    }

    // newer copy in the cloud (played on another device) -> it comes here (except what changed here after it)
    function pull(pid, timeout, cb) {
        var s = sec(pid);
        if (!s || !s.uid || !s.rt) return cb(false);
        var done = false, tm = setTimeout(function () { finish(false); }, timeout || 3000);
        function finish(v) { if (done) return; done = true; clearTimeout(tm); cb(v); }
        token(pid, function (err, t) {
            if (err) return finish(false);
            Cloud.get('players/' + s.uid, 8000, function (e2, data) {
                if (done) return;
                if (e2 === 'notfound') { upload(pid); return finish(false); }
                if (e2 || !data) return finish(false);
                var cur = sec(pid);
                if (cur && !legacyOf(data) && data.data && !cur.v2) { cur.v2 = true; setSec(pid, cur); }
                if (ms(data.at) > ms(s.at)) {
                    var ok = take(pid, data);
                    if (dirtyMap()[pid]) schedule(pid, 3000);
                    return finish(ok);
                }
                var added = migrate(pid, data);
                if (added) { upload(pid); return finish(added > 0); }
                if (dirtyMap()[pid]) schedule(pid, 3000);
                finish(false);
            }, t);
        });
    }

    function schedule(pid, delay) {
        if (!started) return;
        clearTimeout(timer);
        timer = setTimeout(function () {
            if (busy) return schedule(pid, 5000);
            busy = true;
            upload(pid, function () { busy = false; });
        }, delay === undefined ? DEBOUNCE : delay);
    }

    // a change in a linked profile's data (also on the game page: uploaded later from the desktop)
    Store.onWrite(function (k) {
        var m = /^arc_(p\d+)_/.exec(k), pid = m ? m[1] : (k === 'arc_profiles' ? Store.profile() : null);
        if (!pid || !sec(pid) || /_cloud_apps$/.test(k)) return;
        var w = m ? partOf(k.slice(m[0].length)) : null;
        if (w) { var p = getParts(pid); if (w.g) p.g[w.g] = 1; else p.s[w.s] = 1; setParts(pid, p); }
        var d = dirtyMap()[pid] || 0, now = Date.now();
        if (now - d > 2000) setDirty(pid, now);
        if (pid === Store.profile()) schedule(pid);
    });

    function start() {
        started = true;
        var pid = Store.profile();
        if (sec(pid) && dirtyMap()[pid]) schedule(pid, 5000);
    }

    /* ---------------- the account flows ---------------- */
    function link(pid, user, pw, r) {
        var salt = newSalt();
        setSec(pid, { uid: r.localId, rt: r.refreshToken, s: salt, h: verifier(pw, salt), at: 0 });
        remember(pid, r);
        Profiles.setAccount(pid, user);
    }
    function findUid(uid) { var m = all(); for (var pid in m) if (m[pid].uid === uid && Profiles.find(pid)) return pid; return null; }
    function findUser(user) { var l = Profiles.list(); for (var i = 0; i < l.length; i++) if (l[i].user === user) return l[i].id; return null; }

    function signUp(user, pw, pid, cb) {
        user = clean(user);
        if (!validName(user)) return cb('invalid');
        if (String(pw).length < 6) return cb('weak');
        if (!pid && Profiles.list().length >= Profiles.MAX) return cb('full');
        auth('signUp', { email: email(user), password: pw }, function (err, r) {
            if (err) return cb(err);
            var p = pid ? Profiles.find(pid) : Profiles.create(user);
            if (!p) return cb('full');
            if (pid && !p.name) Profiles.rename(p.id, user);
            link(p.id, user, pw, r);
            upload(p.id, function () { cb(null, p.id); });
        });
    }

    function signIn(user, pw, cb) {
        user = clean(user);
        if (!validName(user)) return cb('wrong');
        auth('signInWithPassword', { email: email(user), password: pw }, function (err, r) {
            if (err) return cb(err);
            var pid = findUid(r.localId) || findUser(user), fresh = !pid;
            if (fresh) {
                if (Profiles.list().length >= Profiles.MAX) return cb('full');
                pid = Profiles.create(user).id;
            }
            var before = sec(pid);
            link(pid, user, pw, r);
            if (before && before.uid === r.localId) { var s = sec(pid); s.at = ms(before.at); setSec(pid, s); }
            Cloud.get('players/' + r.localId, 8000, function (e2, data) {
                var cur = sec(pid);
                if (!e2 && data && cur && (ms(data.at) > ms(cur.at) || fresh)) {
                    take(pid, data);
                    if (dirtyMap()[pid]) upload(pid);
                } else if (e2 === 'notfound' || (cur && dirtyMap()[pid]) || (!e2 && data && migrate(pid, data))) upload(pid);
                cb(null, pid);
            }, r.idToken);
        });
    }

    // the password of a profile: this device's copy first (works offline), then Firebase (changed elsewhere)
    function check(pid, pw, cb) {
        var s = sec(pid), p = Profiles.find(pid);
        if (s && s.h && s.s && verifier(pw, s.s) === s.h) return cb(true);
        if (!p || !p.user) return cb(false, 'wrong');
        auth('signInWithPassword', { email: email(p.user), password: pw }, function (err, r) {
            if (err) return cb(false, err === 'offline' && s && s.h ? 'wrong' : err);
            var keep = s && s.uid === r.localId ? ms(s.at) : 0;
            link(pid, p.user, pw, r);
            var n = sec(pid); n.at = keep; setSec(pid, n);
            cb(true);
        });
    }

    function changePassword(pid, old, pw, cb) {
        var p = Profiles.find(pid);
        if (!p || !p.user) return cb('signedout');
        if (String(pw).length < 6) return cb('weak');
        auth('signInWithPassword', { email: email(p.user), password: old }, function (err, r) {
            if (err) return cb(err);
            auth('update', { idToken: r.idToken, password: pw }, function (e2, r2) {
                if (e2) return cb(e2);
                var keep = ms((sec(pid) || {}).at);
                link(pid, p.user, pw, { localId: r.localId, refreshToken: r2.refreshToken || r.refreshToken, idToken: r2.idToken || r.idToken, expiresIn: r2.expiresIn });
                var n = sec(pid); n.at = keep; setSec(pid, n);
                cb(null);
            });
        });
    }

    // this device forgets the account (the profile and the cloud copy stay)
    function forget(pid) { setSec(pid, null); setDirty(pid, 0); delete tokens[pid]; }

    function isAccount(pid) { var p = Profiles.find(pid); return !!(p && p.user); }
    function signedIn(pid) { var s = sec(pid); return !!(s && s.uid && s.rt); }
    // "Ask for the password" for this profile (needs an account)
    function asks(pid) { var p = Profiles.find(pid); return !!(p && p.user && p.ask); }

    // this page's session already passed the password (switching profile, or the start screen)
    var UNLOCK = 'mypc_unlocked';
    function unlocked(pid) { try { return sessionStorage.getItem(UNLOCK) === pid; } catch (e) { return false; } }
    function unlock(pid) { try { sessionStorage.setItem(UNLOCK, pid); } catch (e) {} }

    return {
        signUp: signUp, signIn: signIn, check: check, changePassword: changePassword, forget: forget,
        pull: pull, upload: upload, start: start, isAccount: isAccount, signedIn: signedIn, asks: asks,
        unlocked: unlocked, unlock: unlock, validName: validName, clean: clean,
        _sha256: sha256, _secrets: all
    };
})();
