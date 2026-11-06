/* Google Drive for My PC: ONE sign-in per profile (Control Panel > Google Drive), used by My PC itself (Music) and by
 * every installed app through MyPC.drive (sdk/mypc-sdk.js, js/launcher/bridges.js). Apps never get a token, a client
 * secret or a refresh token: My PC sends every Drive request for them. (Owner request 2026-11-05.)
 *
 * Google client: one "TVs and Limited Input devices" OAuth client for every My PC, set by an admin in the App Store
 * Manager > Google Drive (Firestore settings/google, read by every TV; copied into arc_dev_google by syncConfig).
 * Until that document exists, the client in the MyDrive app's config (apps/mydrive.config.google) is used.
 * Sign-in, two ways (owner request 2026-11-05: full access to the whole Drive):
 *   - phone sign-in (when the Manager has the web client's secret): the TV shows a QR code for drive-signin.html; the phone
 *     signs in on Google's page with the FULL Drive scope and drops the one-time code in Firestore gauth/<random id>; the TV
 *     reads it there (every 3 s while the screen is open, 10 min max), trades it with its PKCE verifier and deletes it.
 *     Google's device flow cannot ask for the full Drive scope (only drive.file), hence this.
 *   - else Google's device flow (a code + google.com/device), scope drive.file: My PC only sees the files it (or an app
 *     through it) created, and the files picked with "Add files from your phone" (drive-picker.html).
 *
 * Accounts are per profile (Store key 'gdrive': { accounts: [{ id, email, name, picture, refreshToken, scope, cid,
 * addedAt, needsReauth }], active }), so they follow the profile's player account and the TV backup like every other
 * profile setting (the owner's choice for MyDrive's tokens too). Access tokens stay in memory only. Accounts linked in
 * MyDrive before this (its save data game_app-mydrive_data) are taken over once, same Google client.
 *
 *   GDrive.config() -> { tvClientId, tvClientSecret, pickerClientId, pickerApiKey, projectNumber, webClientSecret } | null
 *   GDrive.fullAccess()                      true when sign-ins get the whole Drive (phone sign-in set up)
 *   GDrive.syncConfig(cb)                    cb(err) once the copy of settings/google is fresh
 *   GDrive.status(cb)                        cb({ ok, code: 'noconfig' | 'nouser' | 'reauth', account })
 *   GDrive.accounts() / active() / use(id) / signOut(id, cb)
 *   GDrive.signIn(onCode, cb) -> { cancel() }   onCode({ url, expiresAt, userCode } device flow | { phone: true, url, expiresAt });
 *                                            cb(err, account); accounts: { id, email, name, picture, needsReauth, full, limited }
 *   GDrive.list(opts, cb)  get(id, cb)  mkdir(name, parent, cb)  rename(id, name, cb)  move(id, to, cb)  copy(id, to, name, cb)
 *   GDrive.star(id, on, cb)  trash(id, cb)  untrash(id, cb)  remove(id, cb)  read(id, start, end, cb)  download(id, opts, cb)
 *   GDrive.upload(opts, onProgress, cb)  exportFile(id, mime, cb)  thumb(link, size, cb)  about(cb)  appFolder(appId, title, cb)
 *   GDrive.request(req, cb)  an authorized Drive request (My PC only)        GDrive.token(cb)  (My PC only: Music's service worker)
 * Every call returns { abort() }. Errors: { code, message, status }, code one of noconfig signed-out reauth denied expired
 * not-found permission quota range too-big bad-request network timeout cancelled http.
 * Standalone (the SDK in a plain browser) loads this file too: GDrive.setStorage({ load, save }) and setConfig(cfg). */
var GDrive = (function () {
    'use strict';

    var API = 'https://www.googleapis.com/drive/v3', UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
    var TOKEN_URL = 'https://oauth2.googleapis.com/token', DEVICE_URL = 'https://oauth2.googleapis.com/device/code', REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
    var SCOPE = 'https://www.googleapis.com/auth/drive.file', SCOPES = 'openid email profile ' + SCOPE;
    var FULL = 'https://www.googleapis.com/auth/drive', SIGNIN = 'https://imad-os.github.io/g/drive-signin.html';
    var FS = 'https://firestore.googleapis.com/v1/projects/tvgames-f984d/databases/(default)/documents/gauth/', FS_KEY = 'AIzaSyBT0nk8uKUofgF5obP11R96lHtXbEVlKtc';
    var FOLDER = 'application/vnd.google-apps.folder';
    var FIELDS = 'id,name,mimeType,size,modifiedTime,createdTime,starred,trashed,parents,hasThumbnail,thumbnailLink,iconLink,fileExtension,description,' +
        'appProperties,imageMediaMetadata(width,height),videoMediaMetadata(width,height,durationMillis),owners(displayName),' +
        'capabilities(canRename,canTrash,canUntrash,canDelete,canCopy,canMoveItemWithinDrive,canAddChildren,canDownload,canEdit)';
    var KEY = 'gdrive', OLD = 'game_app-mydrive_data', CFG_KEY = 'arc_dev_google', CFG_AT = 'arc_dev_google_at';
    var PICKER = 'https://imad-os.github.io/g/drive-picker.html';
    var CHUNK = 4 * 1024 * 1024, DL_MAX = 200 * 1024 * 1024, MAX_ACCOUNTS = 8;

    var storage = null, cfgOverride = null, cfgMem = null, appCfg = null;
    var tokens = {}, waiting = {}, folders = {}, listeners = [];

    function err(code, message, status) { return { code: code, message: message || code, status: status || 0 }; }
    function str(v, n) { return typeof v === 'string' ? v.trim().slice(0, n || 300) : ''; }
    function later(fn) { setTimeout(fn, 0); }
    function noop() {}
    function enc(s) { return encodeURIComponent(s); }
    function q(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

    /* ---------------- the Google client (App Store Manager > Google Drive) ---------------- */
    function cleanCfg(d) {
        d = d && typeof d === 'object' ? d : {};
        return { tvClientId: str(d.tvClientId, 200), tvClientSecret: str(d.tvClientSecret, 200), pickerClientId: str(d.pickerClientId, 200),
                 pickerApiKey: str(d.pickerApiKey, 200), projectNumber: str(d.projectNumber, 40).replace(/[^0-9]/g, ''), webClientSecret: str(d.webClientSecret, 200) };
    }
    // the web client (the Picker's) with its secret = phone sign-in with full Drive access
    function webOk(c) { return !!(c && c.pickerClientId && c.webClientSecret); }
    function okCfg(c) { return !!(c && ((c.tvClientId && c.tvClientSecret) || webOk(c))); }
    function fullAccess() { return webOk(config()); }
    function managed() {
        if (cfgMem) return cfgMem;
        var v = null;
        try { v = JSON.parse(localStorage.getItem(CFG_KEY)); } catch (e) {}
        return (cfgMem = cleanCfg(v));
    }
    // until settings/google exists: the client in the MyDrive app's config (it was the only place before)
    function fromMyDrive() {
        if (appCfg) return appCfg;
        var l = typeof Cloud !== 'undefined' ? Cloud.apps() : [];
        for (var i = 0; i < l.length; i++) if (l[i].id === 'mydrive' && l[i].config && l[i].config.google) return cleanCfg(l[i].config.google);
        return null;
    }
    function config() {
        if (cfgOverride) return okCfg(cfgOverride) ? cfgOverride : null;
        var m = managed();
        if (okCfg(m)) return m;
        var o = fromMyDrive();
        return okCfg(o) ? o : null;
    }
    var syncWait = null;
    function syncConfig(cb) {
        if (syncWait) { if (cb) syncWait.push(cb); return; }
        syncWait = cb ? [cb] : [];
        function done(e) { var l = syncWait; syncWait = null; for (var i = 0; i < l.length; i++) { try { l[i](e); } catch (x) {} } }
        if (typeof Cloud === 'undefined') return later(function () { done('offline'); });
        Cloud.get('settings/google', 4000, function (e, d) {
            if (e && e !== 'notfound') return done(e);
            cfgMem = cleanCfg(e ? {} : d);
            try { localStorage.setItem(CFG_KEY, JSON.stringify(cfgMem)); localStorage.setItem(CFG_AT, String(Date.now())); } catch (x) {}
            if (okCfg(cfgMem)) return done(null);
            // none set there yet: MyDrive's config, read again (the saved catalog may be older than the Manager's last change)
            if (typeof Cloud.fetchApp !== 'function') return done(null);
            Cloud.fetchApp('mydrive', function (e2, fresh) { if (!e2 && fresh && fresh.config && fresh.config.google) appCfg = cleanCfg(fresh.config.google); done(null); });
        });
    }
    // at start: only when the copy is older than 12 h (Firestore cost); status() reads it at once when nothing is set
    function syncSoon() {
        var at = 0;
        try { at = +localStorage.getItem(CFG_AT) || 0; } catch (e) {}
        if (Date.now() - at > 12 * 3600 * 1000) syncConfig();
    }
    function pickerUrl() {
        var c = config();
        if (!c || !c.pickerClientId || !c.pickerApiKey || !c.projectNumber) return '';
        return PICKER + '#c=' + enc(c.pickerClientId) + '&k=' + enc(c.pickerApiKey) + '&p=' + enc(c.projectNumber);
    }

    /* ---------------- accounts of this profile ---------------- */
    function profileId() { return typeof Store !== 'undefined' && Store.profile ? Store.profile() : 'local'; }
    function cleanAcc(a) {
        if (!a || typeof a !== 'object' || typeof a.id !== 'string' || !a.id) return null;
        return { id: a.id.slice(0, 64), email: str(a.email, 120), name: str(a.name, 80), picture: /^https:\/\//.test(a.picture || '') ? str(a.picture, 500) : '',
                 refreshToken: typeof a.refreshToken === 'string' ? a.refreshToken : '', scope: str(a.scope, 500), cid: str(a.cid, 200),
                 addedAt: +a.addedAt || 0, needsReauth: !!a.needsReauth };
    }
    function load() {
        var d = storage ? storage.load() : (typeof Store !== 'undefined' ? Store.get(KEY, null) : null);
        if (!d && !storage && typeof Store !== 'undefined') {
            // once: the accounts this profile linked in MyDrive (same Google client, so their refresh tokens keep working)
            var o = Store.get(OLD, null);
            if (o && Array.isArray(o.accounts) && o.accounts.length) {
                d = { accounts: o.accounts, active: o.active || '' };
                save(d);
            }
        }
        d = d && typeof d === 'object' ? d : {};
        var l = (Array.isArray(d.accounts) ? d.accounts : []).map(cleanAcc).filter(Boolean).slice(0, MAX_ACCOUNTS);
        return { accounts: l, active: typeof d.active === 'string' ? d.active : '' };
    }
    function save(d) {
        if (storage) storage.save(d); else if (typeof Store !== 'undefined') Store.set(KEY, d);
        for (var i = 0; i < listeners.length; i++) { try { listeners[i](); } catch (e) {} }
    }
    function isFull(a) { return String(a.scope || '').split(/\s+/).indexOf(FULL) >= 0; }
    // limited: signed in with drive.file while full access could be had (sign in again to see the whole Drive)
    function pub(a) { return a ? { id: a.id, email: a.email, name: a.name || a.email, picture: a.picture, needsReauth: a.needsReauth || !a.refreshToken,
                                   full: isFull(a), limited: !isFull(a) && fullAccess() } : null; }
    function activeAcc() {
        var d = load(), a = null;
        for (var i = 0; i < d.accounts.length; i++) if (d.accounts[i].id === d.active) a = d.accounts[i];
        return a || d.accounts[0] || null;
    }
    function patch(id, p) {
        var d = load();
        for (var i = 0; i < d.accounts.length; i++) if (d.accounts[i].id === id) for (var k in p) d.accounts[i][k] = p[k];
        save(d);
    }
    function accounts() { return load().accounts.map(pub); }
    function active() { return pub(activeAcc()); }
    function use(id) { var d = load(); for (var i = 0; i < d.accounts.length; i++) if (d.accounts[i].id === id) { d.active = id; save(d); return true; } return false; }
    function onChange(fn) { listeners.push(fn); }
    function tkey(a) { return profileId() + '/' + a.id; }

    // what stands between this profile and its Drive: cb({ ok, code, account }); reads the client once when none is known
    function status(cb) {
        function answer() {
            var a = activeAcc();
            if (!config()) return cb({ ok: false, code: 'noconfig', account: null });
            if (!a) return cb({ ok: false, code: 'nouser', account: null });
            if (!a.refreshToken || a.needsReauth) return cb({ ok: false, code: 'reauth', account: pub(a) });
            cb({ ok: true, code: '', account: pub(a) });
        }
        if (config()) return later(answer);
        syncConfig(function () { answer(); });
    }
    function statusNow() {
        var a = activeAcc();
        return { ok: !!(config() && a && a.refreshToken && !a.needsReauth), configured: !!config(), full: fullAccess(), account: pub(a) };
    }

    /* ---------------- web requests ---------------- */
    function http(req, cb) {
        if (typeof WebProxy === 'undefined') { later(function () { cb(err('unsupported', 'No web requests here.')); }); return { abort: noop }; }
        return WebProxy.request(req, {}, null, function (e, r) {
            if (e) return cb(err(e.code === 'timeout' ? 'timeout' : e.code === 'cancelled' ? 'cancelled' : e.code === 'bad-request' ? 'bad-request' : 'network', e.message));
            cb(null, r);
        });
    }
    function form(o) { var s = []; for (var k in o) if (o[k] !== undefined && o[k] !== '') s.push(enc(k) + '=' + enc(o[k])); return s.join('&'); }
    var FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };
    function hasDrive(scope) { return String(scope || '').split(/\s+/).indexOf(SCOPE) >= 0 || /\/auth\/drive(\s|$)/.test(String(scope || '')); }

    // the client an account was signed in with (its refresh token only works with that one)
    function client(c, a) {
        if (webOk(c) && a.cid === c.pickerClientId) return { id: c.pickerClientId, secret: c.webClientSecret };
        if (c.tvClientId && c.tvClientSecret && (!a.cid || a.cid === c.tvClientId)) return { id: c.tvClientId, secret: c.tvClientSecret };
        if (c.tvClientId && c.tvClientSecret && !webOk(c)) return { id: c.tvClientId, secret: c.tvClientSecret };
        return null;
    }
    // a valid access token of the active account (refreshed when needed, one refresh at a time)
    function token(cb, fresh) {
        var a = activeAcc(), c = config();
        if (!c) return later(function () { cb(err('noconfig', 'Google Drive is not set up for My PC yet.')); });
        if (!a) return later(function () { cb(err('signed-out', 'No Google account is signed in on this profile.')); });
        if (!a.refreshToken || a.needsReauth) return later(function () { cb(err('reauth', 'Google asks to sign in to ' + (a.email || 'this account') + ' again.')); });
        var k = tkey(a), t = tokens[k], cl = client(c, a);
        if (!cl) return later(function () { cb(err('reauth', 'Sign in to ' + (a.email || 'this account') + ' again.')); });
        if (!fresh && t && t.exp > Date.now()) return later(function () { cb(null, t.tok); });
        if (waiting[k]) { waiting[k].push(cb); return; }
        waiting[k] = [cb];
        http({ url: TOKEN_URL, method: 'POST', headers: FORM, responseType: 'json', timeout: 15000,
               body: form({ client_id: cl.id, client_secret: cl.secret, refresh_token: a.refreshToken, grant_type: 'refresh_token' }) }, function (e, r) {
            var x = null;
            if (e) x = e;
            else if (!r.ok || !r.body || !r.body.access_token) {
                var code = (r.body && r.body.error) || '';
                if (/invalid_grant|unauthorized_client|invalid_client/.test(code)) { patch(a.id, { needsReauth: true }); x = err('reauth', code === 'invalid_grant' ? 'Access to ' + (a.email || 'this account') + ' expired or was removed. Sign in again.' : 'The Google client of My PC is not set up correctly (' + code + ').'); }
                else x = err('http', 'Google: ' + (code || r.status), r.status);
            } else if (r.body.scope && !hasDrive(r.body.scope)) { patch(a.id, { needsReauth: true }); x = err('reauth', 'Google Drive access was not allowed. Sign in again and allow Drive.'); }
            else {
                tokens[k] = { tok: r.body.access_token, exp: Date.now() + ((+r.body.expires_in || 3600) - 120) * 1000 };
                if (r.body.refresh_token && r.body.refresh_token !== a.refreshToken) patch(a.id, { refreshToken: r.body.refresh_token });     // Google may rotate it
            }
            var l = waiting[k]; delete waiting[k];
            for (var i = 0; i < l.length; i++) { try { l[i](x, x ? null : tokens[k].tok); } catch (y) {} }
        });
    }

    function apiError(r) {
        var b = r.body && typeof r.body === 'object' ? r.body : {}, e = b.error || {}, reason = (e.errors && e.errors[0] && e.errors[0].reason) || '', msg = e.message || ('HTTP ' + r.status);
        if (r.status === 401) return err('reauth', 'Google refused the sign-in. Sign in again.', 401);
        if (r.status === 403 && /quota|rateLimit|limitExceeded/i.test(reason)) return err('quota', 'Google Drive is busy (quota). Try again in a minute.', 403);
        if (r.status === 403) return err('permission', 'Not allowed with this file: ' + msg, 403);
        if (r.status === 404) return err('not-found', 'This file no longer exists, or My PC cannot see it.', 404);
        if (r.status === 416) return err('range', 'Outside the file.', 416);
        if (r.status === 400) return err('bad-request', msg, 400);
        return err('http', msg, r.status);
    }

    // an authorized request: a 401 gets a new token once, a rate limit / 5xx is tried again (up to 2 times)
    function request(req, cb) {
        var h = { off: false, cur: null, abort: function () { if (this.off) return; this.off = true; if (this.cur) try { this.cur.abort(); } catch (x) {} cb(err('cancelled', 'Cancelled.')); } };
        var tries = 0, fresh = false;
        function go() {
            token(function (e, tok) {
                if (h.off) return;
                if (e) { h.off = true; return cb(e); }
                var r2 = {}, k, hd = {};
                for (k in req) r2[k] = req[k];
                for (k in req.headers || {}) hd[k] = req.headers[k];
                hd.Authorization = 'Bearer ' + tok;
                r2.headers = hd;
                if (!r2.timeout) r2.timeout = 30000;
                h.cur = http(r2, function (e2, r) {
                    if (h.off) return;
                    if (e2) {
                        if ((e2.code === 'network' || e2.code === 'timeout') && tries++ < 2 && !req.noRetry) return setTimeout(go, 700 * tries);
                        h.off = true; return cb(e2);
                    }
                    if (r.status === 401 && !fresh) { fresh = true; delete tokens[tkey(activeAcc() || { id: '' })]; return go(); }
                    var body = JSON.stringify(r.body || '').slice(0, 2000);
                    if (r.status === 403 && /insufficient authentication scopes|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(body)) {
                        var a = activeAcc(); if (a) patch(a.id, { needsReauth: true });
                        h.off = true; return cb(err('reauth', 'Google Drive access was not allowed. Sign in again and allow Drive.', 403));
                    }
                    if ((r.status === 429 || r.status >= 500 || (r.status === 403 && /rateLimit/i.test(body))) && tries++ < 2) return setTimeout(go, 800 * tries + Math.random() * 300);
                    h.off = true;
                    if ((r.status >= 200 && r.status < 300) || (req.ok && req.ok(r.status))) return cb(null, r);
                    cb(apiError(r));
                });
            }, fresh);
        }
        go();
        return h;
    }
    function json(url, opts, cb) {
        var r = { url: url, responseType: 'json' };
        for (var k in opts || {}) r[k] = opts[k];
        return request(r, function (e, res) { cb(e, e ? null : res.body); });
    }

    /* ---------------- sign-in (Google's device flow) ---------------- */
    function idToken(jwt) {
        try {
            var p = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
            while (p.length % 4) p += '=';
            var s = atob(p), u = '';
            for (var i = 0; i < s.length; i++) u += '%' + ('00' + s.charCodeAt(i).toString(16)).slice(-2);
            var c = JSON.parse(decodeURIComponent(u));
            return { id: String(c.sub || ''), email: c.email || '', name: c.name || c.email || '', picture: c.picture || '' };
        } catch (e) { return null; }
    }
    function signIn(onCode, cb) {
        if (fullAccess()) return phoneSignIn(onCode, cb);
        var c = config(), h = { off: false, cur: null, timer: 0, cancel: function () { if (this.off) return; this.off = true; clearTimeout(this.timer); if (this.cur) try { this.cur.abort(); } catch (x) {} cb(err('cancelled', 'Cancelled.')); } };
        if (!c || !c.tvClientId) { later(function () { h.off = true; cb(err('noconfig', 'Google Drive is not set up for My PC yet.')); }); return h; }
        h.cur = http({ url: DEVICE_URL, method: 'POST', headers: FORM, responseType: 'json', timeout: 15000, body: form({ client_id: c.tvClientId, scope: SCOPES }) }, function (e, r) {
            if (h.off) return;
            if (e || !r.ok || !r.body || !r.body.device_code) { h.off = true; return cb(e || err(r.body && r.body.error === 'invalid_client' ? 'noconfig' : 'http', 'Google: ' + ((r.body && (r.body.error_description || r.body.error)) || r.status), r.status)); }
            var b = r.body, every = Math.max(5, +b.interval || 5), until = Date.now() + (+b.expires_in || 1800) * 1000;
            try { onCode({ userCode: b.user_code, url: b.verification_url || b.verification_uri || 'https://www.google.com/device', expiresAt: until }); } catch (x) {}
            function poll() {
                h.timer = setTimeout(function () {
                    if (h.off) return;
                    if (Date.now() > until) { h.off = true; return cb(err('expired', 'The code expired. Start again.')); }
                    h.cur = http({ url: TOKEN_URL, method: 'POST', headers: FORM, responseType: 'json', timeout: 15000,
                                   body: form({ client_id: c.tvClientId, client_secret: c.tvClientSecret, device_code: b.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) }, function (e2, r2) {
                        if (h.off) return;
                        if (e2) return poll();                                  // a network hiccup: ask again
                        var t = r2.body || {};
                        if (r2.ok && t.access_token) { h.off = true; return finish(t); }
                        if (t.error === 'authorization_pending') return poll();
                        if (t.error === 'slow_down') { every += 5; return poll(); }
                        h.off = true;
                        cb(t.error === 'access_denied' ? err('denied', 'The sign-in was refused on the phone.') : t.error === 'expired_token' ? err('expired', 'The code expired. Start again.') : err('http', 'Google: ' + (t.error || r2.status), r2.status));
                    });
                }, every * 1000);
            }
            poll();
        });
        function finish(t) { saveAccount(t, c.tvClientId, cb); }
        return h;
    }

    /* ---------------- phone sign-in (full Drive): QR -> drive-signin.html -> Firestore gauth/<id> -> the TV ---------------- */
    function rnd(n) {
        var a = new Uint8Array(n), s = '', abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
        crypto.getRandomValues(a);
        for (var i = 0; i < n; i++) s += abc[a[i] & 63];
        return s;
    }
    function b64url(buf) { var b = new Uint8Array(buf), s = ''; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
    // PKCE: S256 where the browser can hash (secure pages), else plain (the verifier then rides in the QR code; the code
    // still needs this TV's request within minutes and the client secret)
    function challenge(v, cb) {
        try {
            if (crypto.subtle && typeof TextEncoder !== 'undefined') return crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)).then(function (d) { cb(b64url(d), 'S256'); }, function () { cb(v, 'plain'); });
        } catch (e) {}
        later(function () { cb(v, 'plain'); });
    }
    function lang() { try { return (typeof I18n !== 'undefined' && I18n.lang && I18n.lang()) || 'en'; } catch (e) { return 'en'; } }
    function phoneSignIn(onCode, cb) {
        var c = config(), sid = rnd(32), ver = rnd(64), until = Date.now() + 10 * 60 * 1000;
        var h = { off: false, cur: null, timer: 0, cancel: function () { if (this.off) return; this.off = true; clearTimeout(this.timer); if (this.cur) try { this.cur.abort(); } catch (x) {} gone(); cb(err('cancelled', 'Cancelled.')); } };
        function gone() { http({ url: FS + sid + '?key=' + FS_KEY, method: 'DELETE', timeout: 8000 }, noop); }
        challenge(ver, function (ch, how) {
            if (h.off) return;
            var url = SIGNIN + '#s=' + sid + '&c=' + enc(c.pickerClientId) + '&h=' + enc(ch) + '&m=' + how + '&l=' + enc(lang());
            try { onCode({ phone: true, url: url, expiresAt: until }); } catch (x) {}
            poll();
        });
        function poll() {
            h.timer = setTimeout(function () {
                if (h.off) return;
                if (Date.now() > until) { h.off = true; return cb(err('expired', 'The sign-in took too long. Start again.')); }
                h.cur = http({ url: FS + sid + '?key=' + FS_KEY, responseType: 'json', timeout: 10000 }, function (e, r) {
                    if (h.off) return;
                    if (e || r.status === 404 || !r.ok) return poll();
                    var f = (r.body && r.body.fields) || {}, code = f.code && f.code.stringValue, bad = f.err && f.err.stringValue;
                    gone();
                    if (bad || !code) { h.off = true; return cb(err('denied', 'The sign-in was refused on the phone.')); }
                    h.cur = http({ url: TOKEN_URL, method: 'POST', headers: FORM, responseType: 'json', timeout: 15000,
                                   body: form({ client_id: c.pickerClientId, client_secret: c.webClientSecret, code: code, code_verifier: ver, redirect_uri: SIGNIN, grant_type: 'authorization_code' }) }, function (e2, r2) {
                        if (h.off) return;
                        h.off = true;
                        if (e2) return cb(e2);
                        var t = r2.body || {};
                        if (!r2.ok || !t.access_token) return cb(err(t.error === 'invalid_client' || t.error === 'redirect_uri_mismatch' ? 'noconfig' : 'http', 'Google: ' + (t.error_description || t.error || r2.status), r2.status));
                        saveAccount(t, c.pickerClientId, cb);
                    });
                });
            }, 3000);
        }
        return h;
    }

    function saveAccount(t, cid, cb) {
        function finish(t) {
            var who = t.id_token ? idToken(t.id_token) : null;
            if (!who || !who.id) return cb(err('http', 'Google did not say which account signed in.'));
            if (t.scope && !hasDrive(t.scope)) {
                revoke(t.refresh_token || t.access_token);
                return cb(err('denied', 'Google Drive access was not allowed. Sign in again and tick the Google Drive box on Google\'s page.'));
            }
            var d = load(), old = null, i;
            for (i = 0; i < d.accounts.length; i++) if (d.accounts[i].id === who.id) old = d.accounts[i];
            var rt = t.refresh_token || (old && old.refreshToken) || '';
            if (!rt) return cb(err('http', 'Google did not give a refresh token.'));
            if (old && old.cid !== cid && !t.refresh_token) return cb(err('http', 'Google did not give a refresh token.'));
            var acc = cleanAcc({ id: who.id, email: who.email, name: who.name, picture: who.picture, refreshToken: rt, scope: t.scope || '', cid: cid, addedAt: Date.now() });
            d.accounts = d.accounts.filter(function (x) { return x.id !== who.id; });
            if (d.accounts.length >= MAX_ACCOUNTS) d.accounts.shift();
            d.accounts.push(acc);
            d.active = acc.id;
            save(d);
            tokens[tkey(acc)] = { tok: t.access_token, exp: Date.now() + ((+t.expires_in || 3600) - 120) * 1000 };
            folders = {};
            cb(null, pub(acc));
        }
        finish(t);
    }
    function revoke(tok) { if (tok) http({ url: REVOKE_URL, method: 'POST', headers: FORM, body: form({ token: tok }), timeout: 10000 }, noop); }
    // removes the account from this profile and gives Google's grant back (every device of this profile loses it)
    function signOut(id, cb) {
        var d = load(), a = null;
        for (var i = 0; i < d.accounts.length; i++) if (d.accounts[i].id === id) a = d.accounts[i];
        if (!a) return later(function () { if (cb) cb(null); });
        d.accounts = d.accounts.filter(function (x) { return x.id !== id; });
        if (d.active === id) d.active = d.accounts.length ? d.accounts[0].id : '';
        delete tokens[tkey(a)]; folders = {};
        save(d);
        // MyDrive's old copy would bring it back at the next start
        if (!storage && typeof Store !== 'undefined') { var o = Store.get(OLD, null); if (o && Array.isArray(o.accounts)) { o.accounts = o.accounts.filter(function (x) { return x && x.id !== id; }); Store.set(OLD, o); } }
        revoke(a.refreshToken);
        later(function () { if (cb) cb(null); });
    }

    /* ---------------- files ---------------- */
    var DOCS = "(mimeType contains 'application/vnd.google-apps.document' or mimeType contains 'application/vnd.google-apps.spreadsheet' or " +
               "mimeType contains 'application/vnd.google-apps.presentation' or mimeType = 'application/pdf' or mimeType contains 'text/' or " +
               "mimeType contains 'officedocument' or mimeType contains 'msword' or mimeType contains 'ms-excel' or mimeType contains 'ms-powerpoint')";
    // opts: { folder, place: 'all' | 'starred' | 'recent' | 'images' | 'videos' | 'audio' | 'documents' | 'trash' | 'folders',
    //         search, q, orderBy, pageSize (1-1000, default 100), pageToken, fields }
    function listQuery(o) {
        var alive = 'trashed = false', cond = [], order = o.orderBy || 'folder,name_natural';
        if (o.q) cond.push('(' + String(o.q) + ')');
        if (o.folder) cond.push("'" + q(o.folder) + "' in parents");
        if (o.search) cond.push("name contains '" + q(o.search) + "'");
        switch (o.place) {
            case 'starred': cond.push('starred = true'); break;
            case 'recent': cond.push("mimeType != '" + FOLDER + "'"); if (!o.orderBy) order = 'recency desc'; break;
            case 'images': cond.push("mimeType contains 'image/'"); break;
            case 'videos': cond.push("mimeType contains 'video/'"); break;
            case 'audio': cond.push("mimeType contains 'audio/'"); break;
            case 'documents': cond.push(DOCS); break;
            case 'folders': cond.push("mimeType = '" + FOLDER + "'"); break;
        }
        cond.push(o.place === 'trash' ? 'trashed = true' : alive);
        if (!o.folder && !o.place && !o.search && !o.q) cond.unshift("'root' in parents");
        return { q: cond.join(' and '), orderBy: order };
    }
    function list(o, cb) {
        o = o && typeof o === 'object' ? o : {};
        var lq = listQuery(o), size = Math.max(1, Math.min(1000, Math.round(+o.pageSize || 100)));
        var url = API + '/files?q=' + enc(lq.q) + '&orderBy=' + enc(lq.orderBy) + '&pageSize=' + size + '&spaces=drive' +
                  '&fields=' + enc('nextPageToken,files(' + (o.fields || FIELDS) + ')') + (o.pageToken ? '&pageToken=' + enc(o.pageToken) : '');
        return json(url, { timeout: 30000 }, function (e, b) { cb(e, e ? null : { files: (b && b.files) || [], next: (b && b.nextPageToken) || '' }); });
    }
    function get(id, cb) {
        if (id === 'root') return json(API + '/files/root?fields=' + enc(FIELDS), {}, function (e, b) { if (b) b.name = b.name || 'My Drive'; cb(e, b); });
        return json(API + '/files/' + enc(id) + '?fields=' + enc(FIELDS), {}, cb);
    }
    function cleanName(n) {
        n = String(n || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
        return n && n.length <= 255 ? n : null;
    }
    function bad(cb, m) { later(function () { cb(err('bad-request', m)); }); return { abort: noop }; }
    function mkdir(name, parent, cb, props) {
        var n = cleanName(name);
        if (!n) return bad(cb, 'A folder needs a name (255 characters at most).');
        var meta = { name: n, mimeType: FOLDER, parents: [parent || 'root'] };
        if (props) meta.appProperties = props;
        return json(API + '/files?fields=' + enc(FIELDS), { method: 'POST', json: meta }, cb);
    }
    function update(id, meta, extra, cb) { return json(API + '/files/' + enc(id) + '?fields=' + enc(FIELDS) + (extra || ''), { method: 'PATCH', json: meta }, cb); }
    function rename(id, name, cb) { var n = cleanName(name); if (!n) return bad(cb, 'The name cannot be empty (255 characters at most).'); return update(id, { name: n }, '', cb); }
    function star(id, on, cb) { return update(id, { starred: !!on }, '', cb); }
    function trash(id, cb) { return update(id, { trashed: true }, '', cb); }
    function untrash(id, cb) { return update(id, { trashed: false }, '', cb); }
    function setInfo(id, meta, cb) {
        var m = {};
        if (meta && typeof meta.description === 'string') m.description = meta.description.slice(0, 4000);
        if (meta && meta.appProperties && typeof meta.appProperties === 'object') m.appProperties = meta.appProperties;
        return update(id, m, '', cb);
    }
    function move(id, to, cb) {
        var h = { cur: null, abort: function () { if (this.cur) this.cur.abort(); } };
        h.cur = json(API + '/files/' + enc(id) + '?fields=parents', {}, function (e, b) {
            if (e) return cb(e);
            var from = ((b && b.parents) || []).map(enc).join(',');
            h.cur = update(id, {}, '&addParents=' + enc(to || 'root') + (from ? '&removeParents=' + from : ''), cb);
        });
        return h;
    }
    function copy(id, to, name, cb) {
        var meta = {};
        if (to) meta.parents = [to];
        if (name) { var n = cleanName(name); if (!n) return bad(cb, 'Bad name.'); meta.name = n; }
        return json(API + '/files/' + enc(id) + '/copy?fields=' + enc(FIELDS), { method: 'POST', json: meta }, cb);
    }
    function remove(id, cb) { return request({ url: API + '/files/' + enc(id), method: 'DELETE' }, function (e) { cb(e, e ? null : true); }); }

    // bytes [start, end] (end included) -> { buf, total, type }
    function read(id, start, end, cb) {
        start = Math.max(0, Math.floor(+start || 0));
        end = end === undefined || end === null ? start + CHUNK - 1 : Math.max(start, Math.floor(+end));
        return request({ url: API + '/files/' + enc(id) + '?alt=media', headers: { Range: 'bytes=' + start + '-' + end }, responseType: 'arraybuffer', timeout: 60000 }, function (e, r) {
            if (e) return e.code === 'range' ? cb(null, { buf: new ArrayBuffer(0), total: start, type: '' }) : cb(e);     // past the end: nothing more
            var m = /\/(\d+)\s*$/.exec((r.headers && r.headers['content-range']) || ''), buf = r.body || new ArrayBuffer(0);
            cb(null, { buf: buf, total: m ? +m[1] : (r.status === 200 ? buf.byteLength : 0), type: (r.headers && r.headers['content-type']) || '' });
        });
    }
    // the whole file, in pieces so the progress moves (opts: { onProgress(0..1), max: bytes }) -> { buf, type, size }
    function download(id, opts, cb) {
        opts = opts || {};
        var max = Math.min(+opts.max || DL_MAX, DL_MAX), parts = [], at = 0, type = '', total = 0, h = { cur: null, off: false, abort: function () { if (this.off) return; this.off = true; if (this.cur) this.cur.abort(); cb(err('cancelled', 'Cancelled.')); } };
        (function next() {
            h.cur = read(id, at, at + CHUNK - 1, function (e, r) {
                if (h.off) return;
                if (e) { h.off = true; return cb(e); }
                type = type || r.type; total = total || r.total;
                var n = r.buf.byteLength;
                if (n) { parts.push(new Uint8Array(r.buf)); at += n; }
                if (opts.onProgress) { try { opts.onProgress(total ? Math.min(1, at / total) : 1); } catch (x) {} }
                if (total && total > max) { h.off = true; return cb(err('too-big', 'The file is bigger than ' + Math.round(max / 1048576) + ' MB.')); }
                if (!n || !total || at >= total) {
                    var out = new Uint8Array(at), o = 0;
                    for (var i = 0; i < parts.length; i++) { out.set(parts[i], o); o += parts[i].length; }
                    h.off = true;
                    return cb(null, { buf: out.buffer, type: type, size: at });
                }
                next();
            });
        })();
        return h;
    }
    function exportFile(id, mime, cb) {
        return request({ url: API + '/files/' + enc(id) + '/export?mimeType=' + enc(mime || 'application/pdf'), responseType: 'arraybuffer', timeout: 60000 }, function (e, r) {
            cb(e, e ? null : { buf: r.body, type: (r.headers && r.headers['content-type']) || mime });
        });
    }
    function thumb(link, size, cb) {
        if (!/^https:\/\/[a-z0-9.-]+\.(googleusercontent|google|googleapis)\.com\//i.test(String(link || ''))) return bad(cb, 'Not a Drive thumbnail address.');
        return request({ url: String(link).replace(/=s\d+$/, '') + '=s' + Math.max(32, Math.min(1600, Math.round(+size || 320))), responseType: 'arraybuffer', timeout: 20000, noRetry: true }, function (e, r) {
            cb(e, e ? null : { buf: r.body, type: (r.headers && r.headers['content-type']) || 'image/jpeg' });
        });
    }
    function about(cb) { return json(API + '/about?fields=' + enc('user(displayName,emailAddress,photoLink),storageQuota'), {}, cb); }

    // opts: { name, data: Blob | ArrayBuffer | typed array | string, type, parent, id (replace that file's content),
    //         description, appProperties }   resumable upload in 4 MB pieces; onProgress(0..1)
    function upload(o, onProgress, cb) {
        o = o || {};
        var data = o.data, blob;
        if (typeof Blob !== 'undefined' && data instanceof Blob) blob = data;
        else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) blob = new Blob([data], { type: o.type || '' });
        else if (typeof data === 'string') blob = new Blob([data], { type: o.type || 'text/plain' });
        else return bad(cb, 'Give the file\'s data: a Blob, an ArrayBuffer or a string.');
        var name = o.id && !o.name ? null : cleanName(o.name || (data && data.name));
        if (!o.id && !name) return bad(cb, 'The file needs a name (255 characters at most).');
        var type = o.type || blob.type || 'application/octet-stream', size = blob.size;
        var meta = {};
        if (name) meta.name = name;
        if (!o.id) meta.parents = [o.parent || 'root'];
        if (typeof o.description === 'string') meta.description = o.description.slice(0, 4000);
        if (o.appProperties && typeof o.appProperties === 'object') meta.appProperties = o.appProperties;
        if (o.type) meta.mimeType = o.type;
        var h = { cur: null, off: false, abort: function () { if (this.off) return; this.off = true; if (this.cur) this.cur.abort(); cb(err('cancelled', 'Cancelled.')); } };
        h.cur = request({ url: UPLOAD + (o.id ? '/' + enc(o.id) : '') + '?uploadType=resumable&fields=' + enc(FIELDS), method: o.id ? 'PATCH' : 'POST', responseType: 'json',
                          headers: { 'X-Upload-Content-Type': type, 'X-Upload-Content-Length': String(size) }, json: meta }, function (e, r) {
            if (h.off) return;
            if (e) { h.off = true; return cb(e); }
            var session = r.headers && r.headers.location;
            if (!session) { h.off = true; return cb(err('http', 'Google did not open an upload session.')); }
            var at = 0;
            (function piece() {
                var end = Math.min(size, at + CHUNK);
                h.cur = request({ url: session, method: 'PUT', responseType: 'json', timeout: 120000, ok: function (s) { return s === 308; },
                                  headers: { 'Content-Range': size ? 'bytes ' + at + '-' + (end - 1) + '/' + size : 'bytes */0' }, body: blob.slice(at, end) }, function (e2, r2) {
                    if (h.off) return;
                    if (e2) { h.off = true; return cb(e2); }
                    if (r2.status === 200 || r2.status === 201) { h.off = true; if (onProgress) try { onProgress(1); } catch (x) {} return cb(null, r2.body); }
                    var m = /bytes=0-(\d+)/.exec((r2.headers && r2.headers.range) || '');
                    at = m ? +m[1] + 1 : end;
                    if (onProgress) try { onProgress(size ? at / size : 1); } catch (x) {}
                    piece();
                });
            })();
        });
        return h;
    }

    // a folder of this app's own in "My PC" (found by appProperties, made when missing): saves, exports, settings
    function findFolder(cond, cb) {
        return json(API + '/files?q=' + enc(cond + " and mimeType = '" + FOLDER + "' and trashed = false") + '&pageSize=1&fields=' + enc('files(' + FIELDS + ')'), {}, function (e, b) {
            cb(e, e ? null : ((b && b.files) || [])[0] || null);
        });
    }
    function appFolder(appId, title, cb) {
        var a = activeAcc(), k = (a ? tkey(a) : '') + '/' + appId;
        if (folders[k]) { var f0 = folders[k]; later(function () { cb(null, f0); }); return { abort: noop }; }
        var h = { cur: null, abort: function () { if (this.cur) this.cur.abort(); } };
        function root(done) {
            if (folders[(a ? tkey(a) : '') + '/'] ) return done(null, folders[(a ? tkey(a) : '') + '/']);
            h.cur = findFolder("appProperties has { key='mypc' and value='root' }", function (e, f) {
                if (e) return done(e);
                if (f) { folders[(a ? tkey(a) : '') + '/'] = f; return done(null, f); }
                h.cur = mkdir('My PC', 'root', function (e2, f2) { if (!e2) folders[(a ? tkey(a) : '') + '/'] = f2; done(e2, f2); }, { mypc: 'root' });
            });
        }
        h.cur = findFolder("appProperties has { key='mypcApp' and value='" + q(appId) + "' }", function (e, f) {
            if (e) return cb(e);
            if (f) { folders[k] = f; return cb(null, f); }
            root(function (e2, r) {
                if (e2) return cb(e2);
                h.cur = mkdir(cleanName(title) || appId, r.id, function (e3, f3) { if (!e3) folders[k] = f3; cb(e3, f3); }, { mypcApp: appId });
            });
        });
        return h;
    }

    function setStorage(s) { storage = s && typeof s.load === 'function' && typeof s.save === 'function' ? s : null; tokens = {}; folders = {}; }
    function setConfig(c) { cfgOverride = c ? cleanCfg(c) : null; }

    return {
        FOLDER: FOLDER, SCOPE: SCOPE, FULL: FULL, FIELDS: FIELDS, SIGNIN: SIGNIN, fullAccess: fullAccess,
        config: config, syncConfig: syncConfig, syncSoon: syncSoon, pickerUrl: pickerUrl, cleanConfig: cleanCfg,
        status: status, statusNow: statusNow, accounts: accounts, active: active, use: use, signIn: signIn, signOut: signOut, onChange: onChange,
        list: list, get: get, mkdir: function (n, p, cb) { return mkdir(n, p, cb); }, rename: rename, move: move, copy: copy, star: star, trash: trash, untrash: untrash,
        remove: remove, setInfo: setInfo, read: read, download: download, upload: upload, exportFile: exportFile, thumb: thumb, about: about, appFolder: appFolder,
        request: request, token: token, setStorage: setStorage, setConfig: setConfig,
        _reset: function () { tokens = {}; waiting = {}; folders = {}; cfgMem = null; appCfg = null; }
    };
})();
if (typeof module !== 'undefined') module.exports = GDrive;
