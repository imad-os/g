// Automated acceptance tests (Playwright + Chromium, mocked tizen/webapis).
//
//   npm i -D playwright      (or use a global install: NODE_PATH=$(npm root -g))
//   node tests/run-tests.mjs
//
// Proves:
//   1. a newer hosted build runs (and a game is playable)
//   2. offline falls back to the bundled copy (and a game is playable)
//   3. a broken hosted build is blacklisted and the bundled copy runs (and a game is playable)
//   4. a hosted build for another shell is ignored
//   5. launch/exit x20: no leaked iframes, JS heap back to baseline +-10%
//   6. destroy() closes the AudioContext, stops the rAF loop; Back opens pause; Back on menu asks to exit
//   7. Super Jumper: every stage loads and can be finished
//   8. top-10 tables: a qualifying score is saved under the profile's name and appears on the Scores screen
//  10. network loss shows a popup (Samsung checklist), reconnecting shows another; favicon served
//   9. Super Jumper 2-player co-op: arrows + WASD, and two gamepads, each drive only their own hero
//  11. Super Jumper controls: stable ground contact, Down ducks, steering and momentum in the air
//  12. menu covers come back after a game
//  13. profiles: create, switch from home, separate saves, shared settings, delete
//  14. Parchís: Moroccan rules, a full CPU game, a person's turn
//  15. desktop shell: taskbar clock, Start menu, full-screen apps (calculator, calendar, settings,
//      explorer, browser) that free everything when they close
//  16. installed apps: list from Firebase (mocked), My PC SDK in a sandboxed cross-origin iframe
//  17. installer: mypc-app.json parsing
//  18. installer page: catalog of imad-os's g_ repositories (GitHub API and Firebase mocked)
//  19. smart startup: slow server -> last known online build; failures are not blamed
//  20. Settings > Update: check, download with progress, restart; error cases
//  21. Browser: focus theft, Guide, Channel / Page keys, wheel, remote and mouse modes
//  22. Tab, wheel, Guide, device detection, Settings > Devices with a simulated controller
//  24. Super Jumper stages: different layouts and hills
//  25. Profiles: own settings (language, clock, background), switch-user screen, update message, shared records
//  26. App Store: catalog, New / Popular, search, install, open, uninstall; desktop and Explorer follow
//  27. TV id, cloud backup and restore after a reinstall, world records
//  23. Boot screen: black, inline logo, orbit dots, fades out; no logo when opening a game
//  34. phone controller (the existing virtual pad) as P1 / P2;  35. its sensor modes (moves, metrics, raw, live / debug screens)
//  37. app bridges: MyPC.net, MyPC.ai (Gemini, NVIDIA, Magpie speech), MyPC.mic, permission prompts, Settings > AI; update screen on a phone
//  40. settings of every My PC (App Store Manager > Settings, settings/mypc): backgrounds on the TV
//  Unit tests without a browser (Bluetooth heart-rate bridge, controller protocol, motion engine): node tests/unit-tests.mjs
//
//  CHROMIUM_PATH=/path/to/chrome uses an existing Chromium instead of Playwright's download.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOSTED = 'https://pc.geekspro.us/';          // the loader asks the site itself (the old github.io address only redirects)
const OLD_HOSTED = 'https://imad-os.github.io/g/';
// the build in the repo, and a newer one for the update tests (so they keep working at every build bump)
const BUILD = JSON.parse(fs.readFileSync(path.join(ROOT, 'app-manifest.json'), 'utf8')).build, NEXT = BUILD + 1;
const TYPES = { '.jpg': 'image/jpeg', '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

let failures = 0;
function check(cond, msg) { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; }

function serve() {
    return new Promise((resolve) => {
        const srv = http.createServer((req, res) => {
            const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
            if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
            res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
            fs.createReadStream(p).pipe(res);
        });
        srv.listen(0, () => resolve(srv));
    });
}

// Mock of the Samsung/Tizen APIs the app touches.
const TIZEN_MOCK = `
    window.__exited = false;
    window.tizen = {
        tvinputdevice: { registerKey: function () {}, registerKeyBatch: function () {} },
        application: { getCurrentApplication: function () { return { exit: function () { window.__exited = true; } }; } },
        systeminfo: { getCapability: function () { return '6.5'; } }
    };
    window.webapis = { productinfo: { getModel: function () { return 'MOCK'; } } };
`;

// Serves the hosted copy from the repo, optionally altering the manifest or breaking a file.
async function routeHosted(page, { manifest, breakFile, offline } = {}) {
    await page.route(HOSTED + '**', async (route) => {
        if (offline) return route.abort('internetdisconnected');
        const rel = route.request().url().slice(HOSTED.length).split('?')[0];
        if (breakFile && rel === breakFile) return route.fulfill({ status: 404, body: '' });
        if (rel === 'app-manifest.json' && manifest) {
            const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'app-manifest.json'), 'utf8'));
            return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(Object.assign(m, manifest)) });
        }
        const p = path.join(ROOT, rel);
        if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) return route.fulfill({ status: 404, body: '' });
        return route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: TYPES[path.extname(p)] || 'application/octet-stream', body: fs.readFileSync(p) });
    });
}

// An in-memory Firestore behind the REST API the TV uses (list, get, patch with preconditions, batchGet,
// commit with increments). Every test page gets one, so tests never reach the real database.
// db: { apps: { id: {...} }, appstats, tvs, records } (plain objects); db.down = true makes it unreachable.
const FS_DB = 'projects/tvgames-f984d/databases/(default)/documents';
function fsValue(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === 'string') return { stringValue: v };
    if (v instanceof Date) return { timestampValue: v.toISOString() };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(fsValue) } };
    return { mapValue: { fields: fsFields(v) } };
}
function fsFields(o) { const f = {}; for (const k in o) f[k] = fsValue(o[k]); return f; }
function fsPlain(v) {
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return parseInt(v.integerValue, 10);
    if ('doubleValue' in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('timestampValue' in v) return v.timestampValue;
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(fsPlain);
    if ('mapValue' in v) { const o = {}; for (const k in v.mapValue.fields || {}) o[k] = fsPlain(v.mapValue.fields[k]); return o; }
    return null;
}
// Firebase Authentication (REST) for player accounts: signUp, signInWithPassword, update (password), token refresh.
// db.auth = { 'name@players.mypc.app': { uid, pw, rts: [valid refresh tokens] } }; a password change revokes the others.
async function fakeAuth(ctx, db) {
    db.auth = db.auth || {}; db._u = db._u || 0;
    const json = (r, status, o) => r.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(o) });
    const fail = (r, m) => json(r, 400, { error: { code: 400, message: m } });
    const issue = (u) => { const rt = 'rt-' + u.uid + '-' + (++db._u); u.rts.push(rt); return { localId: u.uid, idToken: 'id-' + u.uid + '-' + db._u, refreshToken: rt, expiresIn: '3600' }; };
    const byUid = (uid) => Object.values(db.auth).find((u) => u.uid === uid);
    await ctx.route('https://identitytoolkit.googleapis.com/**', async (r) => {
        if (db.down) return r.abort('internetdisconnected');
        const op = new URL(r.request().url()).pathname.split('accounts:')[1], b = JSON.parse(r.request().postData() || '{}');
        db.authLog = db.authLog || []; db.authLog.push(op + ' ' + (b.email || ''));
        if (op === 'signUp') {
            if (db.auth[b.email]) return fail(r, 'EMAIL_EXISTS');
            if (!b.password || b.password.length < 6) return fail(r, 'WEAK_PASSWORD : Password should be at least 6 characters');
            const u = db.auth[b.email] = { uid: 'uid' + (++db._u), pw: b.password, rts: [] };
            return json(r, 200, issue(u));
        }
        if (op === 'signInWithPassword') {
            const u = db.auth[b.email];
            if (!u || u.pw !== b.password) return fail(r, 'INVALID_LOGIN_CREDENTIALS');
            return json(r, 200, issue(u));
        }
        if (op === 'update') {
            const u = byUid(String(b.idToken).split('-')[1]);
            if (!u) return fail(r, 'INVALID_ID_TOKEN');
            u.pw = b.password; u.rts = [];
            return json(r, 200, issue(u));
        }
        fail(r, 'OPERATION_NOT_ALLOWED');
    });
    await ctx.route('https://securetoken.googleapis.com/**', async (r) => {
        if (db.down) return r.abort('internetdisconnected');
        const b = JSON.parse(r.request().postData() || '{}'), u = byUid(String(b.refresh_token).split('-')[1]);
        db.authLog = db.authLog || []; db.authLog.push('refresh');
        if (!u || u.rts.indexOf(b.refresh_token) < 0) return fail(r, 'TOKEN_EXPIRED');
        json(r, 200, { id_token: 'id-' + u.uid + '-' + (++db._u), refresh_token: b.refresh_token, expires_in: '3600', user_id: u.uid });
    });
}

async function fakeFirestore(ctx, db) {
    for (const c of ['apps', 'appstats', 'tvs', 'records', 'players', 'errors']) db[c] = db[c] || {};
    db._t = db._t || {}; db.log = db.log || []; db._n = db._n || 0;
    await fakeAuth(ctx, db);
    await ctx.route('https://firestore.googleapis.com/**', async (r) => {
        if (db.down) return r.abort('internetdisconnected');
        const req = r.request(), u = new URL(req.url()), method = req.method();
        const p = decodeURIComponent(u.pathname).replace('/v1/' + FS_DB, '');
        const json = (status, o) => r.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(o) });
        const stamp = (k) => db._t[k] || (db._t[k] = '2026-01-01T00:00:0' + (db._n++ % 10) + '.' + String(db._n).padStart(6, '0') + 'Z');
        const out = (col, id) => ({ name: FS_DB + '/' + col + '/' + id, fields: fsFields(db[col][id]), updateTime: stamp(col + '/' + id), createTime: '2026-01-01T00:00:00Z' });
        db.log.push(method + ' ' + p);
        // a player's own document: only with that account's ID token (firebase/firestore.rules)
        if (p.indexOf('/players/') === 0) {
            const tok = (req.headers()['authorization'] || '').replace('Bearer ', ''), uid = p.split('/')[2];
            db.playerAuth = db.playerAuth || []; db.playerAuth.push(tok);
            if (tok.split('-')[1] !== uid) return json(403, { error: { code: 403, status: 'PERMISSION_DENIED' } });
            // rules not published again after a change of shape: data / settings are refused
            const pb = req.postData() ? JSON.parse(req.postData()) : null;
            if (db.oldPlayerRules && method === 'PATCH' && pb && pb.fields && (pb.fields.data || pb.fields.settings || u.searchParams.getAll('updateMask.fieldPaths').length)) return json(403, { error: { code: 403, status: 'PERMISSION_DENIED' } });
        }
        const body = req.postData() ? JSON.parse(req.postData()) : null;
        if (p === ':batchGet') return json(200, body.documents.map((n) => { const [col, id] = n.slice(FS_DB.length + 1).split('/'); return db[col] && db[col][id] ? { found: out(col, id) } : { missing: n }; }));
        if (p === ':commit') {
            for (const w of body.writes) {
                if (w.update) {                                             // a new document (error reports): currentDocument.exists false
                    const [col, id] = w.update.name.slice(FS_DB.length + 1).split('/');
                    db[col] = db[col] || {};
                    if (w.currentDocument && w.currentDocument.exists === false && db[col][id]) return json(409, { error: { code: 409, status: 'ALREADY_EXISTS' } });
                    db[col][id] = fsPlain({ mapValue: { fields: w.update.fields } });
                    continue;
                }
                const [col, id] = w.transform.document.slice(FS_DB.length + 1).split('/');
                const d = (db[col][id] = db[col][id] || {});
                for (const ft of w.transform.fieldTransforms) d[ft.fieldPath] = (d[ft.fieldPath] || 0) + parseInt(ft.increment.integerValue, 10);
            }
            return json(200, { writeResults: [] });
        }
        // rooms: any depth (rooms/<id>/reqs/<id>), runQuery, updateMask, currentDocument.exists
        const segs = p.split('/').filter(Boolean);
        if (segs[0] === 'rooms' || segs[0] === 'inbox' || segs[0] === 'subs' || segs[0] === 'gauth' || p === ':runQuery') {
            if (segs[0] === 'inbox' || segs[0] === 'subs') { db.pushAuth = db.pushAuth || []; db.pushAuth.push(method + ' ' + p + ' ' + (req.headers()['authorization'] || '')); }
            const last = segs[segs.length - 1];
            if (last.endsWith(':runQuery')) {
                db.queries = db.queries || [];
                const sq = body.structuredQuery, parent = segs.slice(0, -1).concat([last.slice(0, -9)]).filter(Boolean).join('/');
                const colPath = (sq.from[0].collectionId === 'rooms' ? 'rooms' : parent + '/' + sq.from[0].collectionId).replace('//', '/');
                db.queries.push({ col: colPath, sq });
                const flat = (w) => !w ? [] : w.compositeFilter ? w.compositeFilter.filters.flatMap(flat) : [w.fieldFilter];
                const filters = flat(sq.where);
                if (db.noIndex && filters.length > 1) return json(400, { error: { code: 400, status: 'FAILED_PRECONDITION', message: 'The query requires an index.' } });
                if (!sq.limit) return json(403, { error: { code: 403, status: 'PERMISSION_DENIED' } });      // the rules need a limit
                const val = (v) => v.timestampValue ? Date.parse(v.timestampValue) : fsPlain(v);
                const num = (v) => typeof v === 'string' && /^\d{4}-/.test(v) ? Date.parse(v) : v;
                let docs = Object.keys(db[colPath] || {}).map((k) => ({ k, d: db[colPath][k] }));
                for (const f of filters) docs = docs.filter(({ d }) => f.op === 'EQUAL' ? d[f.field.fieldPath] === fsPlain(f.value) : num(d[f.field.fieldPath]) > val(f.value));
                if (sq.orderBy) { const o = sq.orderBy[0]; docs.sort((a, b) => (num(a.d[o.field.fieldPath]) - num(b.d[o.field.fieldPath])) * (o.direction === 'DESCENDING' ? -1 : 1)); }
                docs = docs.slice(0, sq.limit);
                const readTime = new Date(Date.now() + (db.skewMs || 0)).toISOString();
                return json(200, docs.length ? docs.map(({ k }) => ({ document: out(colPath, k), readTime })) : [{ readTime }]);
            }
            const isDoc = segs.length % 2 === 0, colPath = (isDoc ? segs.slice(0, -1) : segs).join('/'), did = isDoc ? last : null;
            db[colPath] = db[colPath] || {};
            if (method === 'GET' && !isDoc) return json(200, { documents: Object.keys(db[colPath]).map((k) => out(colPath, k)) });
            if (method === 'GET') return db[colPath][did] ? json(200, out(colPath, did)) : json(404, { error: { code: 404, status: 'NOT_FOUND' } });
            if (method === 'DELETE') { delete db[colPath][did]; return json(200, {}); }
            if (method === 'PATCH') {
                const mask = u.searchParams.getAll('updateMask.fieldPaths');
                if (u.searchParams.get('currentDocument.exists') === 'false' && db[colPath][did]) return json(409, { error: { code: 409, status: 'ALREADY_EXISTS' } });
                if (u.searchParams.get('currentDocument.exists') === 'true' && !db[colPath][did]) return json(404, { error: { code: 404, status: 'NOT_FOUND' } });
                const plain = fsPlain({ mapValue: { fields: body.fields } });
                if (mask.length) { db[colPath][did] = db[colPath][did] || {}; for (const f of mask) db[colPath][did][f] = plain[f]; }
                else db[colPath][did] = plain;
                db.rules = db.rules || []; db.rules.push({ col: colPath, id: did, mask, data: plain });
                delete db._t[colPath + '/' + did];
                return json(200, out(colPath, did));
            }
        }
        const [col, id] = segs;
        if (!db[col]) return json(404, { error: { code: 404, status: 'NOT_FOUND' } });
        if (method === 'GET' && !id) return json(200, { documents: Object.keys(db[col]).map((k) => out(col, k)) });
        if (method === 'GET') return db[col][id] ? json(200, out(col, id)) : json(404, { error: { code: 404, status: 'NOT_FOUND' } });
        if (method === 'PATCH') {
            const exists = u.searchParams.get('currentDocument.exists'), ut = u.searchParams.get('currentDocument.updateTime');
            if (exists === 'false' && db[col][id]) return json(409, { error: { code: 409, status: 'ALREADY_EXISTS' } });
            if (ut && stamp(col + '/' + id) !== ut) return json(400, { error: { code: 400, status: 'FAILED_PRECONDITION' } });
            const mask = u.searchParams.getAll('updateMask.fieldPaths');
            if (exists === 'true' && !db[col][id]) return json(404, { error: { code: 404, status: 'NOT_FOUND' } });
            if (mask.length) {                                             // field paths like data.`app-x` (players)
                const plain = fsPlain({ mapValue: { fields: body.fields } }), d = db[col][id] = db[col][id] || {};
                db.masks = db.masks || []; db.masks.push({ col, id, mask });
                for (const f of mask) {
                    const seg = (f.match(/`(?:[^`\\]|\\.)*`|[^.]+/g) || []).map((x) => x[0] === '`' ? x.slice(1, -1).replace(/\\(.)/g, '$1') : x);
                    let src = plain, dst = d;
                    for (let i = 0; i < seg.length - 1; i++) { src = src && src[seg[i]]; dst = dst[seg[i]] = dst[seg[i]] && typeof dst[seg[i]] === 'object' ? dst[seg[i]] : {}; }
                    const last = seg[seg.length - 1], v = src ? src[last] : undefined;
                    if (v === undefined) delete dst[last]; else dst[last] = v;
                }
                delete db._t[col + '/' + id];
                return json(200, out(col, id));
            }
            db[col][id] = fsPlain({ mapValue: { fields: body.fields } });
            delete db._t[col + '/' + id];
            return json(200, out(col, id));
        }
        if (method === 'DELETE') { delete db[col][id]; return json(200, {}); }
        json(400, { error: { code: 400 } });
    });
}

// An Open-Meteo forecast answer (js/core/weather.js asks now + hours + 7 days in one request): the hours start 2 hours before now
// a made-up world cloud map (grey, equirectangular, as clouds.matteason.co.uk serves): a band of clouds over the equator, a
// storm turning west of Morocco (30 N, 20 W) and a front over Europe; BMP so no image library is needed
function cloudMapBmp(w = 512, h = 256) {
    const row = Math.ceil(w * 3 / 4) * 4, buf = Buffer.alloc(54 + row * h);
    buf.write('BM', 0); buf.writeUInt32LE(buf.length, 2); buf.writeUInt32LE(54, 10); buf.writeUInt32LE(40, 14);
    buf.writeInt32LE(w, 18); buf.writeInt32LE(h, 22); buf.writeUInt16LE(1, 26); buf.writeUInt16LE(24, 28); buf.writeUInt32LE(row * h, 34);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const lon = x / w * 360 - 180, lat = 90 - y / h * 180;
        let v = Math.max(0, 1 - Math.abs(lat - 4) / 8) * (0.6 + 0.4 * Math.sin(lon / 9));          // the band over the equator
        const dx = (lon + 20) * Math.cos(30 * Math.PI / 180), dy = lat - 30, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
        if (r < 14) v = Math.max(v, (1 - r / 14) * (0.55 + 0.45 * Math.cos(a * 2 - r * 0.7)));     // the storm's arms
        if (r < 2.2) v = Math.max(v, 0.15);                                                           // its eye
        v = Math.max(v, Math.max(0, 1 - Math.abs(lat - 52 - lon * 0.25) / 4) * (lon > -10 && lon < 30 ? 0.9 : 0));   // a front over Europe
        const g = Math.round(Math.min(1, v) * 255), o = 54 + (h - 1 - y) * row + x * 3;
        buf[o] = buf[o + 1] = buf[o + 2] = g;
    }
    return buf;
}
const CLOUD_BMP = cloudMapBmp();
function forecastBody(temp) {
    const day = (i) => `2026-11-${String(5 + i).padStart(2, '0')}`, hours = [];
    // 7 whole days of hours (like the real answer); hours 7..33 keep the values the older checks expect (index i = hour - 7);
    // Saturday 7 Nov 15:00 is a thunderstorm (the hours of a picked day)
    for (let n = 0; n < 168; n++) hours.push(new Date(Date.UTC(2026, 10, 5, n)).toISOString().slice(0, 16));
    const old = (n) => n >= 7 && n < 34, hr = (n) => n % 24, DAYT = [9, 8, 8, 11, 16, 19, 17, 13];
    return {
        current: { time: '2026-11-05T09:45', temperature_2m: temp, apparent_temperature: temp - 2, relative_humidity_2m: 60, precipitation: 0.4, weather_code: 2, is_day: 1,
                   cloud_cover: 40, pressure_msl: 1016.2, wind_speed_10m: 14, wind_direction_10m: 270, wind_gusts_10m: 31 },
        hourly: { time: hours, temperature_2m: hours.map((_, n) => (old(n) ? temp + (n - 7) % 5 : DAYT[Math.floor(hr(n) / 3)] + Math.floor(n / 24))),
                  precipitation_probability: hours.map((_, n) => (old(n) ? (n - 7) * 3 : (n * 7) % 100)),
                  weather_code: hours.map((_, n) => (old(n) ? (n - 7 === 12 ? 95 : (n - 7) % 3 ? 2 : 61) : n === 63 ? 95 : hr(n) < 6 ? 0 : 3)),
                  is_day: hours.map((_, n) => (old(n) ? (n - 7 < 9 ? 1 : 0) : hr(n) >= 7 && hr(n) <= 18 ? 1 : 0)) },
        daily: { time: [0, 1, 2, 3, 4, 5, 6].map(day), weather_code: [2, 61, 3, 0, 95, 71, 45], temperature_2m_max: [24, 22, 19, 25, 21, 8, 17], temperature_2m_min: [15, 14, 12, 16, 13, 1, 10],
                 precipitation_sum: [0.4, 6.2, 0, 0, 12.5, 3, 0], precipitation_probability_max: [20, 80, 5, 0, 95, 60, 10], wind_speed_10m_max: [18, 25, 12, 9, 40, 22, 11],
                 wind_gusts_10m_max: [35, 48, 20, 15, 70, 40, 18], wind_direction_10m_dominant: [270, 225, 180, 90, 315, 0, 45],
                 sunrise: [0, 1, 2, 3, 4, 5, 6].map((i) => day(i) + 'T07:31'), sunset: [0, 1, 2, 3, 4, 5, 6].map((i) => day(i) + 'T18:12'), uv_index_max: [4.2, 2, 3.1, 5, 1, 0.5, 2.5] }
    };
}

// opts.phone: a touch phone (no Tizen mock); opts.viewport; opts.touch: touch screen without the phone flags (a desktop with a touch screen)
async function newPage(browser, base, db, opts) {
    opts = opts || {};
    const ctx = await browser.newContext(Object.assign(opts.phone ? { viewport: opts.viewport || { width: 844, height: 390 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 720 }, hasTouch: !!opts.touch }, opts.tz ? { timezoneId: opts.tz } : {}));
    if (!opts.phone && !opts.desktop) await ctx.addInitScript(TIZEN_MOCK);
    db = db || {};
    await fakeFirestore(ctx, db);
    // the Weather widget's services (js/launcher/widgets.js): never the real ones in tests
    await ctx.route(/^https:\/\/(get\.geojs\.io|geocoding-api\.open-meteo\.com|api\.open-meteo\.com)\//, (r) => {
        const u = r.request().url(), body = /geojs/.test(u) ? { latitude: '33.59', longitude: '-7.61', city: 'Casablanca' }
            : /geocoding/.test(u) ? (/name=Nowhere/.test(u) ? {} : { results: [{ latitude: 48.85, longitude: 2.35, name: 'Paris' }] })
            : forecastBody(/latitude=48/.test(u) ? 12.4 : 21.4);
        (db.weather = db.weather || []).push(u);
        return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
    });
    // the events services (js/core/events.js): never the real ones in tests (db.cal / db.espn give the answers, else nothing)
    await ctx.route(/^https:\/\/(www\.googleapis\.com\/calendar|calendar\.google\.com|site\.api\.espn\.com)\//, (r) => {
        const u = r.request().url();
        (db.events = db.events || []).push(u);
        const json = (b) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) });
        if (/espn/.test(u)) { const lg = /soccer\/([^/]+)\//.exec(u)[1]; return json({ events: (db.espn && db.espn[lg]) || [] }); }
        if (/googleapis/.test(u)) return db.cal ? json({ items: db.cal }) : r.fulfill({ status: 403, body: '{}' });
        return db.ics ? r.fulfill({ status: 200, contentType: 'text/calendar', body: db.ics }) : r.fulfill({ status: 404, body: '' });
    });
    // the cloud map of Earth now (js/launcher/dynwall.js clouds()): never the real one in tests (db.noClouds: no internet there)
    await ctx.route(/^https:\/\/clouds\.matteason\.co\.uk\//, (r) => {
        (db.clouds = db.clouds || []).push(r.request().url());
        return db.noClouds ? r.abort() : r.fulfill({ status: 200, contentType: 'image/bmp', headers: { 'Access-Control-Allow-Origin': '*' }, body: CLOUD_BMP });
    });
    const page = await ctx.newPage();
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(e.message));
    page.base = base;
    page.fs = db;
    return page;
}

// the TV remote's Back (keyCode 10009): in a game only this one opens My PC\'s menu (Esc goes to the game)
async function tvBack(page) {
    await page.evaluate(() => { const k = (d) => Input.onKey({ keyCode: 10009, repeat: false, preventDefault() {} }, d); k(true); k(false); });
}
// My PC's menu over an installed app: the remote's Back twice quickly (API 18: one Back is the app's own)
async function tvMenu(page) {
    await page.evaluate(() => { const k = (d) => Input.onKey({ keyCode: 10009, repeat: false, preventDefault() {} }, d); k(true); k(false); k(true); k(false); });
}

async function playable(page, id = 'blocks') {
    await page.waitForSelector(`[data-game="${id}"]`, { timeout: 15000 });
    await page.focus(`[data-game="${id}"]`);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'running', null, { timeout: 15000 });
    await page.keyboard.press('Enter');          // start
    await page.waitForTimeout(300);
    const running = await page.evaluate(() => document.querySelector('iframe').contentWindow.GameAPI._isRunning());
    await page.keyboard.press('Escape');         // a keyboard's Esc goes to the game: no My PC menu
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(100);
    const stays = await page.evaluate(() => window.GameHost.state()) === 'running';
    await tvBack(page);         // pause
    await page.waitForTimeout(100);
    const paused = await page.evaluate(() => window.GameHost.state());
    await page.evaluate(() => { const b = document.querySelectorAll('#pause-items button'); b[b.length - 1].click(); });
    const idle = await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'idle', null, { timeout: 15000 }).then(() => true, () => false);   // the desktop page loads again
    return running && stays && paused === 'paused' && idle;
}

async function main() {
    const srv = await serve();
    const base = `http://localhost:${srv.address().port}/`;
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--autoplay-policy=no-user-gesture-required', '--disable-features=WebRtcHideLocalIpsWithMdns', '--js-flags=--expose-gc', '--enable-precise-memory-info', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
    // MYPC_ONLY=music node tests/run-tests.mjs: only the Music app's checks (quick while working on it)
    if (process.env.MYPC_ONLY === 'wall') { await wallTests(browser, base); await browser.close(); srv.close(); console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed'); process.exit(failures ? 1 : 0); }
    if (process.env.MYPC_ONLY === 'speedy') { await speedyTests(browser, base); await browser.close(); srv.close(); console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed'); process.exit(failures ? 1 : 0); }
    if (process.env.MYPC_ONLY === 'video') { await videoTests(browser, base); await browser.close(); srv.close(); console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed'); process.exit(failures ? 1 : 0); }
    if (process.env.MYPC_ONLY === 'copy') { await copyTests(browser, base); await browser.close(); srv.close(); console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed'); process.exit(failures ? 1 : 0); }
    if (process.env.MYPC_ONLY === 'drive') { await driveTests(browser, base); await drivePhoneTests(browser, base); await browser.close(); srv.close(); console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed'); process.exit(failures ? 1 : 0); }
    if (process.env.MYPC_ONLY === 'calendar') { await calendarTests(browser, base); await browser.close(); srv.close(); console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed'); process.exit(failures ? 1 : 0); }
    if (process.env.MYPC_ONLY === 'clock') { await clockTests(browser, base); await browser.close(); srv.close(); console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed'); process.exit(failures ? 1 : 0); }
    if (process.env.MYPC_ONLY === 'pads') { await padTests(browser, base); await browser.close(); srv.close(); console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed'); process.exit(failures ? 1 : 0); }
    if (process.env.MYPC_ONLY === 'themes') { await themeTests(browser, base); await browser.close(); srv.close(); console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed'); process.exit(failures ? 1 : 0); }
    if (process.env.MYPC_ONLY === 'ring') { await ringTests(browser, base); await browser.close(); srv.close(); console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed'); process.exit(failures ? 1 : 0); }
    if (process.env.MYPC_ONLY === 'flow') { await flowTests(browser, base); await browser.close(); srv.close(); console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed'); process.exit(failures ? 1 : 0); }
    if (process.env.MYPC_ONLY === 'music') { await musicTests(browser, base); await browser.close(); srv.close(); console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed'); process.exit(failures ? 1 : 0); }

    console.log('1. hosted newer build runs');
    {
        const page = await newPage(browser, base);
        await routeHosted(page, { manifest: { build: NEXT } });
        await page.goto(base + 'index.html');
        await page.waitForFunction(() => window.AppBoot && window.Desktop && document.querySelector('.dicon'), null, { timeout: 15000 });
        check(await page.evaluate(() => AppBoot.source()) === 'remote', 'AppBoot.source() is "remote"');
        check(await page.evaluate(() => AppBoot.build()) === NEXT, 'build ' + NEXT + ' is running');
        check(await page.evaluate(() => document.querySelector('base') && document.querySelector('base').href) === HOSTED, '<base href> points to the hosted copy');
        check(await playable(page), 'a game is playable from the hosted copy');
        check(await playable(page, 'jumper'), 'Super Jumper loads from the hosted copy');
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }

    console.log('2. offline falls back to the bundled copy');
    {
        const page = await newPage(browser, base);
        await routeHosted(page, { offline: true });
        const t0 = Date.now();
        await page.goto(base + 'index.html');
        await page.waitForSelector('.dicon', { timeout: 15000 });
        check(await page.evaluate(() => AppBoot.source()) === 'local', 'AppBoot.source() is "local"');
        check(Date.now() - t0 < 6000, 'menu shown quickly without network (' + (Date.now() - t0) + ' ms)');
        check(await playable(page), 'a game is playable offline');
        await page.context().close();
    }

    console.log('3. broken hosted build is blacklisted');
    {
        const page = await newPage(browser, base);
        await routeHosted(page, { manifest: { build: 9077 }, breakFile: 'js/launcher/main.js' });
        await page.goto(base + 'index.html');
        await page.waitForFunction(() => window.AppBoot && AppBoot.source() === 'local' && document.querySelector('.dicon'), null, { timeout: 20000 });
        check(await page.evaluate(() => { const b = JSON.parse(localStorage.getItem('boot_bad_build')); const f = AppBoot.lastFail(); return b.b === 9077 && b.n === 1 && f.b === 9077 && /main\.js/.test(f.why); }), 'build 9077 set aside (1st failure) and why is kept for Control Panel > Update');
        check(await playable(page), 'bundled copy is playable after the fallback');
        await page.goto(base + 'index.html');                    // a real start (a reload of ?from= is a page change: same copy)
        await page.waitForSelector('.dicon', { timeout: 15000 });
        check(await page.evaluate(() => AppBoot.source() === 'local' && AppBoot.reason() === 'bad'), 'the failed build is skipped at the next start (for 30 minutes)');
        // Control Panel > My PC Update says why
        await page.evaluate(() => Win.open('settings', 'update'));
        await page.waitForTimeout(400);
        if (process.env.MYPC_SHOTS) await page.screenshot({ path: path.join(process.env.MYPC_SHOTS, 'update-why.png') });
        check(/What went wrong[\s\S]*9077[\s\S]*main\.js/.test(await page.textContent('body')), 'Control Panel > My PC Update shows what made the online build fail');
        await page.context().close();
    }

    console.log('3b. a failed online build is tried again (one failure can be the network), given up after 3');
    {
        const page = await newPage(browser, base);
        await routeHosted(page, { manifest: { build: NEXT } });
        // an old package's mark (the number alone) and a failure 31 minutes ago: both are tried again now
        await page.addInitScript((n) => { if (!sessionStorage.getItem('__s')) { sessionStorage.setItem('__s', '1'); localStorage.setItem('boot_bad_build', String(n)); } }, NEXT);
        await page.goto(base + 'index.html');
        await page.waitForFunction(() => window.AppBoot && window.Desktop && document.querySelector('.dicon'), null, { timeout: 20000 });
        check(await page.evaluate((n) => AppBoot.source() === 'remote' && AppBoot.build() === n && localStorage.getItem('boot_bad_build') === null, NEXT),
            'a build an older package set aside for good is tried again, and the mark goes once it runs');
        await page.evaluate((n) => localStorage.setItem('boot_bad_build', JSON.stringify({ b: n, n: 2, at: Date.now() - 31 * 60000 })), NEXT);
        await page.reload();
        await page.waitForFunction(() => window.AppBoot && window.Desktop && document.querySelector('.dicon'), null, { timeout: 20000 });
        check(await page.evaluate((n) => AppBoot.source() === 'remote' && AppBoot.build() === n, NEXT), 'a build that failed 31 minutes ago runs again');
        await page.evaluate((n) => localStorage.setItem('boot_bad_build', JSON.stringify({ b: n, n: 3, at: Date.now() - 31 * 60000 })), NEXT);
        await page.reload();
        await page.waitForSelector('.dicon', { timeout: 15000 });
        check(await page.evaluate(() => AppBoot.source() === 'local' && AppBoot.reason() === 'bad'), 'after 3 failures in a row it waits for a newer build');
        await page.context().close();
    }

    console.log('3c. the server is slow as the TV starts: the built-in copy downloads the update and says so');
    {
        const page = await newPage(browser, base);
        let slow = true;
        await routeHosted(page, {});
        await page.route(HOSTED + 'app-manifest.json*', async (route) => {      // registered last: asked first
            if (slow) return route.abort('timedout');
            const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'app-manifest.json'), 'utf8'));
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(Object.assign(m, { build: NEXT, version: '9.9.9' })) });
        });
        await page.goto(base + 'index.html');
        await page.waitForFunction(() => window.AppBoot && window.Desktop && document.querySelector('.dicon'), null, { timeout: 20000 });
        check(await page.evaluate(() => AppBoot.source() === 'local' && AppBoot.reason() === 'unreachable'), 'no answer at start: the built-in copy runs');
        slow = false;
        await page.evaluate(() => { Updater.state().state = 'idle'; Updater.background(10); });
        await page.waitForFunction(() => Updater.state().state === 'ready', null, { timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(300);
        if (process.env.MYPC_SHOTS) await page.screenshot({ path: path.join(process.env.MYPC_SHOTS, 'update-background.png') });
        check(await page.evaluate((n) => { const g = JSON.parse(localStorage.getItem('boot_good')); return Updater.state().state === 'ready' && g.manifest.build === n; }, NEXT) && /My PC update downloaded[\s\S]*9\.9\.9/.test(await page.textContent('#toast')),
            'once the network answers the update is downloaded in the background and a notification says it starts next time');
        await page.reload();
        await page.waitForFunction(() => window.AppBoot && window.Desktop && document.querySelector('.dicon'), null, { timeout: 20000 });
        check(await page.evaluate((n) => AppBoot.source() === 'remote' && AppBoot.build() === n, NEXT), 'the next start runs the online build');
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }

    console.log('4. hosted build for another shell is ignored');
    {
        const page = await newPage(browser, base);
        await routeHosted(page, { manifest: { build: 50, shell: 2 } });
        await page.goto(base + 'index.html');
        await page.waitForSelector('.dicon', { timeout: 15000 });
        check(await page.evaluate(() => AppBoot.source()) === 'local', 'shell mismatch keeps the bundled copy');
        await page.context().close();
    }

    if (process.env.MYPC_ONLY === 'boot') { await browser.close(); srv.close(); console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed'); process.exit(failures ? 1 : 0); }   // MYPC_ONLY=boot: start-up / update checks only

    console.log('5/6. memory, destroy() and Back key');
    {
        const page = await newPage(browser, base);
        await routeHosted(page, { offline: true });
        await page.goto(base + 'index.html');
        await page.waitForSelector('.dicon');
        await page.keyboard.press('Escape');
        check(await page.evaluate(() => !document.getElementById('dialog-backdrop').hidden), 'Back on the main menu opens the exit confirmation');
        await page.keyboard.press('Escape');
        check(await page.evaluate(() => document.getElementById('dialog-backdrop').hidden), 'Back closes the exit confirmation');
        const cdp = await page.context().newCDPSession(page);
        // Detached iframes need a few GC rounds; take the lowest of several samples on each side
        // (single samples move by ~0.4 MB on a ~3 MB heap because of V8 bookkeeping).
        // (the old pages of the page switches are freed by a full collection, hence HeapProfiler.collectGarbage)
        const sample = async () => { for (let i = 0; i < 4; i++) { await page.evaluate(() => { window.gc && window.gc(); }); await page.waitForTimeout(150); } await cdp.send('HeapProfiler.collectGarbage'); return (await cdp.send('Runtime.getHeapUsage')).usedSize; };
        const heap = async () => Math.min(await sample(), await sample(), await sample());
        const ids = ['jumper', 'blocks', 'hopper', 'snake', 'breaker', 'merge'];
        // warm-up (first launch compiles code and fills caches)
        for (let r = 0; r < 2; r++) for (const id of ids) await cycle(page, id, true);
        const before = await heap();
        let audioClosed = true, loopStopped = true, noDesktop = true, refocused = true;
        for (let i = 0; i < 20; i++) {
            const r = await cycle(page, ids[i % ids.length], false);
            audioClosed = audioClosed && r.audio === 'closed';
            loopStopped = loopStopped && !r.running;
            noDesktop = noDesktop && r.noDesktop;
            refocused = refocused && r.refocused;
        }
        const after = await heap();
        const growth = (after - before) / before;
        check(noDesktop, 'a game runs on its own page: the desktop is never built there (20 launches)');
        check(refocused, 'quitting reloads a fresh desktop focused on the game icon');
        check(await page.evaluate(() => document.querySelectorAll('iframe').length) === 0, 'no iframe left on the desktop after 20 launches');
        check(audioClosed, 'every destroy() closed its AudioContext');
        check(loopStopped, 'every destroy() stopped its game loop');
        check(growth <= 0.10, `desktop JS heap did not grow more than 10% over 20 launches (a drop is not a leak): ${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB (${(growth * 100).toFixed(1)}%)`);
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }

    console.log('7. Super Jumper stages');
    {
        const page = await newPage(browser, base);
        await routeHosted(page, { offline: true });
        await page.goto(base + 'index.html');
        await page.waitForSelector('[data-game="jumper"]');
        await page.focus('[data-game="jumper"]');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'running');
        const G = 'document.querySelector("iframe").contentWindow';
        const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'games/jumper/assets/levels/index.json'), 'utf8')).stages;
        for (const st of index) {
            await page.evaluate(G + `.JumperCheat.enter("${st.id}")`);
            const ok = await page.waitForFunction(G + '.JumperDebug().mode === "play"', null, { timeout: 8000 }).then(() => true, () => false);
            if (st.fortress) {
                // walk into the arena through its entrance, then stomp the boss (hp set to 1 by the cheat)
                const door = await page.evaluate(G + '.JumperCheat.door()');
                await page.evaluate(G + `.JumperCheat.warpTo(${door - 48}, 250)`);
                await page.keyboard.down('ArrowRight'); await page.waitForTimeout(900); await page.keyboard.up('ArrowRight');
                for (let k = 0; k < 15; k++) {
                    const b = await page.evaluate(G + '.JumperCheat.bossHits()');
                    if (!b || (await page.evaluate(G + '.JumperDebug().mode')) !== 'play') break;
                    await page.evaluate(G + `.JumperCheat.warpTo(${b.x + 8}, ${b.y - 40})`);
                    await page.waitForTimeout(300);
                }
            } else {
                const g = await page.evaluate(G + '.JumperCheat.goal()');
                await page.evaluate(G + `.JumperCheat.warpTo(${g.x - 40}, ${g.ground - 120})`);
                await page.keyboard.down('ArrowRight'); await page.waitForTimeout(1200); await page.keyboard.up('ArrowRight');
            }
            const done = await page.waitForFunction(G + '.JumperDebug().mode === "map"', null, { timeout: 15000 }).then(() => true, () => false);
            check(ok && done, `${st.id} ${st.name}: loads and can be finished`);
        }
        const save = await page.evaluate(G + '.JumperCheat.save()');
        check(Object.keys(save.cleared).length === index.length, 'all stages recorded as cleared');
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }

    console.log('\nSuper Jumper: controls feel and every stage played by the auto-player');
    {
        // the game's own physics, run without a browser (tools/play-levels.mjs)
        const { makeWorld } = await import('../tools/play-levels.mjs');
        const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'games/jumper/assets/levels/w1-1.json'), 'utf8'));
        const w = makeWorld(map), s0 = w.save();
        const run = (n, set) => { for (let i = 0; i < n; i++) { Object.assign(w.inp, { left: false, right: false, jump: false, jumpPressed: false }, set ? set(i) : {}); w.step(); } };
        run(10); run(40, () => ({ right: true }));
        const x0 = w.p.x;
        let stop = 0; while (w.p.vx > 0 && stop < 60) { run(1); stop++; }
        check(stop <= 8 && w.p.x - x0 < 10, `letting go of the arrow stops the hero in ${stop} frames (${(w.p.x - x0).toFixed(1)} px)`);
        w.load(s0); run(10); run(40, () => ({ right: true }));
        let turn = 0; while (w.p.vx >= 0 && turn < 60) { run(1, () => ({ left: true })); turn++; }
        check(turn <= 6, `turning around takes ${turn} frames`);
        // TV remote: the arrow is let go a moment before OK
        w.load(s0); run(10); run(40, () => ({ right: true })); run(5);
        run(1, () => ({ jump: true, jumpPressed: true })); run(10, () => ({ jump: true }));
        check(!w.p.onGround && w.p.vx > 1.2, `arrow then OK (remote) still jumps forward (vx ${w.p.vx.toFixed(2)})`);
        const { spawnSync } = await import('node:child_process');
        const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/play-levels.mjs'), '--quick'], { encoding: 'utf8' });
        const lines = r.stdout.trim().split('\n');
        check(r.status === 0 && lines.length === 15, 'the auto-player (weaker than a person: walking, lower jump) finishes all 15 stages' + (r.status ? ':\n' + lines.filter((l) => !/finished/.test(l)).join('\n') : ''));
    }

    console.log('8. top-10 score tables');
    {
        const page = await newPage(browser, base);
        await routeHosted(page, { offline: true });
        await page.goto(base + 'index.html');
        await page.waitForSelector('[data-game="snake"]');
        await page.focus('[data-game="snake"]');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'running');
        const scores = [500, 900, 100];
        for (const sc of scores) {
            await page.evaluate((v) => document.querySelector('iframe').contentWindow.GameAPI._gk.submitScore(v), sc);
            await page.waitForFunction((n) => Scores.list('snake').length >= n, scores.indexOf(sc) + 1);
        }
        await page.evaluate(() => document.querySelector('iframe').contentWindow.GameAPI._gk.submitScore(0));
        check(await page.evaluate(() => window.GameHost.state()) === 'running', 'a zero score is not recorded and nothing pops up');
        const list = await page.evaluate(() => Scores.list('snake'));
        check(list.length === 3 && list[0].s === 900 && list[2].s === 100, 'table sorted best first: ' + list.map((e) => e.n + ' ' + e.s).join(', '));
        check(list.every((e) => e.n === 'Player 1' && e.p === 'p1') && !(await page.evaluate(() => !!document.getElementById('entry'))), 'records are saved automatically under the profile name, no initials screen (' + list.map((e) => e.n).join(', ') + ')');
        for (let i = 0; i < 12; i++) await page.evaluate((v) => Scores.add('snake', 'ZZZ', v), 1000 + i);
        check(await page.evaluate(() => Scores.list('snake').length) === 10, 'table keeps only the top 10');
        await tvBack(page);
        await page.evaluate(() => { const b = document.querySelectorAll('#pause-items button'); b[b.length - 1].click(); });
        await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'idle' && !!document.querySelector('#desk-icons .dicon') && document.activeElement !== document.body);
        await page.focus('[data-app="scores"]'); await page.keyboard.press('Enter');
        check(await page.evaluate(() => Win.current() === 'scores' && !document.getElementById('window').hidden), 'Leaderboards app opens full screen');
        const label = await page.evaluate(() => [...document.querySelectorAll('.lb-tab')].map((c) => c.getAttribute('aria-label')).join(' | '));
        check(/Neon Snake.*1: ZZZ, 1011 points/.test(label), 'Voice Guide label lists the table');
        await page.focus('.lb-tab'); await page.waitForTimeout(100);
        check(await page.evaluate(() => /ZZZ/.test(document.querySelector('.lb-pane').textContent) && !!document.querySelector('.lb-podium .lb-crown') && document.querySelectorAll('.lb-hall').length === 1), 'Hall of Fame: overall champion on the podium');
        await page.keyboard.press('ArrowDown');
        check(await page.evaluate(() => document.querySelector('.lb-pane h2').textContent !== 'Hall of Fame' && document.activeElement.classList.contains('lb-tab')), 'Down moves to a game and the right side follows');
        await page.keyboard.press('Escape');
        check(await page.evaluate(() => document.getElementById('window').hidden && document.activeElement.getAttribute('data-app') === 'scores'), 'Back closes the app and refocuses its icon');
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }

    console.log('9. Super Jumper 2-player co-op');
    {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
        await ctx.addInitScript(TIZEN_MOCK);
        await fakeFirestore(ctx, {});
        await ctx.addInitScript(() => {
            function pad(i) { const b = []; for (let k = 0; k < 17; k++) b.push({ pressed: false, value: 0 }); return { index: i, id: 'Mock ' + i, connected: true, mapping: 'standard', buttons: b, axes: [0, 0, 0, 0] }; }
            window.__pads = [];
            navigator.getGamepads = () => (window.top.__pads || []);
            window.__press = (i, b, on) => { window.__pads[i].buttons[b].pressed = on; window.__pads[i].buttons[b].value = on ? 1 : 0; };
            window.__plug = () => { window.__pads = [pad(0), pad(1)]; try { sessionStorage.setItem('__plugged', '1'); } catch (e) {} window.dispatchEvent(new Event('gamepadconnected')); };
            // real pads stay connected across page switches (desktop <-> game page)
            if (window.top === window && sessionStorage.getItem('__plugged')) {
                window.__pads = [pad(0), pad(1)];
                const once = setInterval(() => { if (window.Input) { clearInterval(once); window.dispatchEvent(new Event('gamepadconnected')); } }, 50);
            }
        });
        const page = await ctx.newPage();
        page.errors = []; page.on('pageerror', (e) => page.errors.push(e.message));
        await routeHosted(page, { offline: true });
        await page.goto(base + 'index.html');
        await page.waitForSelector('[data-game="jumper"]');
        const G = 'document.querySelector("iframe").contentWindow';
        const dbg = () => page.evaluate(G + '.JumperDebug()');
        const openJumper = async () => {
            await page.focus('[data-game="jumper"]'); await page.keyboard.press('Enter');
            await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'running');
            await page.waitForTimeout(300);
        };
        // keyboard: arrows = P1, WASD = P2
        await openJumper();
        await tvBack(page);
        await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
        await page.keyboard.press('KeyF');
        await page.waitForTimeout(100);
        let d = await dbg();
        check(d.twoP && d.p1Dev === 'keys' && d.p2.dev === 'keys2', 'P2 joins with W A S D + F while P1 keeps the arrows');
        await page.evaluate(G + '.JumperCheat.enter("w1-1")');
        await page.waitForFunction(G + '.JumperDebug().mode === "play"');
        d = await dbg(); let x1 = d.x, x2 = d.p2.x;
        await page.keyboard.down('KeyD'); await page.waitForTimeout(600); await page.keyboard.up('KeyD');
        d = await dbg();
        check(d.p2.x - x2 > 20 && Math.abs(d.x - x1) < 1, 'D moves only player 2');
        await page.evaluate(G + '.JumperCheat.kill(2)');
        await page.waitForTimeout(3000);
        d = await dbg();
        check(!d.p2.dead && d.p2.lives === 4 && d.mode === 'play', 'a fallen player 2 respawns next to player 1 (stage keeps going)');
        await page.evaluate(G + '.JumperCheat.setScore(1, 4321)'); await page.evaluate(G + '.JumperCheat.setScore(2, 1234)');
        await page.evaluate(G + '.JumperCheat.setLives(1, 1)'); await page.evaluate(G + '.JumperCheat.setLives(2, 1)');
        await page.evaluate(G + '.JumperCheat.kill(2)'); await page.evaluate(G + '.JumperCheat.kill(1)');
        await page.waitForFunction(() => Scores.list('jumper').length >= 2, null, { timeout: 8000 });
        const top = await page.evaluate(() => Scores.list('jumper').map((e) => e.n + ' ' + e.s).join(', '));
        check(top === 'Player 1 4321, Player 2 1234', 'game over: both players are recorded automatically (' + top + ')');
        await tvBack(page);
        await page.evaluate(() => { const b = document.querySelectorAll('#pause-items button'); b[b.length - 1].click(); });
        await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'idle' && !!document.querySelector('#desk-icons .dicon') && document.activeElement !== document.body);

        // two gamepads: pad0 = P1, pad1 = P2
        await page.evaluate(() => window.__plug());
        await page.waitForTimeout(300);
        const tap = async (i, btn) => { await page.evaluate(([i, b]) => window.__press(i, b, true), [i, btn]); await page.waitForTimeout(120); await page.evaluate(([i, b]) => window.__press(i, b, false), [i, btn]); await page.waitForTimeout(120); };
        await page.focus('[data-game="jumper"]'); await tap(0, 0);
        await page.waitForURL(/play=jumper/);
        await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'running' && window.Input.padCount() === 2, null, { timeout: 8000 });
        await page.waitForTimeout(300);
        const combo = async (i, ms) => { await page.evaluate((i) => { window.__press(i, 8, true); window.__press(i, 9, true); }, i); await page.waitForTimeout(ms);
            await page.evaluate((i) => { window.__press(i, 8, false); window.__press(i, 9, false); }, i); await page.waitForTimeout(150); };
        await tap(0, 9);
        await tap(0, 1);
        check(await page.evaluate(() => window.GameHost.state()) === 'running', 'in a game without its own menu, Start alone and B do not open My PC\'s menu');
        await combo(0, 400);
        check(await page.evaluate(() => window.GameHost.state()) === 'running', 'a short Start + Select does not open it either');
        await combo(0, 1300);
        check(await page.evaluate(() => window.GameHost.state()) === 'paused', 'holding Start + Select (Switch + and -) opens My PC\'s menu and it stays open');
        await tap(0, 13);
        check(/Two players/.test(await page.evaluate(() => document.activeElement.textContent)), 'gamepad D-pad moves through the pause menu');
        await tap(0, 0);
        await tap(1, 0);
        d = await dbg();
        check(d.twoP && d.p1Dev === 'pad0' && d.p2.dev === 'pad1', 'second gamepad joins as player 2');
        await page.evaluate(G + '.JumperCheat.enter("w1-1")');
        await page.waitForFunction(G + '.JumperDebug().mode === "play"');
        d = await dbg(); x1 = d.x; x2 = d.p2.x;
        await page.evaluate(() => window.__press(1, 15, true)); await page.waitForTimeout(600); await page.evaluate(() => window.__press(1, 15, false));
        d = await dbg();
        check(d.p2.x - x2 > 20 && Math.abs(d.x - x1) < 1, 'gamepad 2 moves only player 2');
        await page.evaluate(() => window.__press(0, 15, true)); await page.waitForTimeout(600); await page.evaluate(() => window.__press(0, 15, false));
        d = await dbg();
        check(d.x - x1 > 20, 'gamepad 1 moves player 1');
        // Start: a press goes to a game that has its own menu; holding Start + Select opens My PC\'s menu
        await page.evaluate(G2 => { const api = eval(G2).GameAPI; api.ownMenu = true; window.__menuSeen = 0;
            const on = api.onAction; api.onAction = function (a, p, r, dv) { if (a === 'menu' && p) window.__menuSeen++; return on.apply(this, arguments); }; }, G);
        await tap(0, 9);
        await page.waitForTimeout(100);
        check(await page.evaluate(() => window.GameHost.state() === 'running' && window.__menuSeen === 1), 'a press of Start goes to the game\'s own menu');
        await page.evaluate(() => window.__press(0, 9, true)); await page.waitForTimeout(1300); await page.evaluate(() => window.__press(0, 9, false)); await page.waitForTimeout(150);
        check(await page.evaluate(() => window.GameHost.state() === 'running' && window.__menuSeen === 2), 'holding Start alone is still the game\'s menu');
        await page.evaluate(() => { window.__press(0, 8, true); window.__press(0, 9, true); }); await page.waitForTimeout(1300);
        check(await page.evaluate(() => window.GameHost.state()) === 'paused', 'holding Start + Select opens My PC\'s menu, even in a game with its own menu');
        await page.evaluate(() => { window.__press(0, 8, false); window.__press(0, 9, false); }); await page.waitForTimeout(200);
        check(await page.evaluate(() => window.GameHost.state() === 'paused' && window.__menuSeen === 2), 'letting go after the hold sends nothing more');
        await tap(0, 9);
        check(await page.evaluate(() => window.GameHost.state()) === 'running', 'Start closes My PC\'s menu again');
        // My PC loses the focus (PC window in the background, TV on another app): the game pauses under My PC's menu
        await page.evaluate(() => { window.__chimes = 0; const c = AudioPrefs.chime; AudioPrefs.chime = function () { window.__chimes++; return c(); }; document.hasFocus = () => false; window.dispatchEvent(new Event('blur')); });
        await page.waitForTimeout(300);
        check(await page.evaluate(() => window.GameHost.state() === 'paused' && !document.getElementById('pause').hidden), 'My PC losing the focus pauses the game and shows the menu');
        check(await page.evaluate(() => window.__chimes === 1), 'the menu plays its sound when it shows');
        check(await page.evaluate(() => fetch('sounds/menu.wav').then((r) => r.ok && r.headers.get('content-length') < 20000 || r.ok)), 'the menu sound is a small file (sounds/menu.wav)');
        await page.evaluate(() => { delete document.hasFocus; document.querySelector('#pause-items button').click(); });
        check(await page.evaluate(() => window.GameHost.state()) === 'running', 'Resume brings it back');
        await page.evaluate(() => window.dispatchEvent(new Event('blur')));
        await page.waitForTimeout(300);
        check(await page.evaluate(() => window.GameHost.state()) === 'running', 'a blur that leaves the focus in the page (a click into the game frame) does not pause');
        await page.evaluate(() => { window.__pads[1].connected = false; window.dispatchEvent(new Event('gamepaddisconnected')); });
        await page.waitForTimeout(300);
        check(await page.evaluate(() => window.GameHost.state()) === 'paused', 'unplugging a gamepad pauses the game');
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await ctx.close();
    }

    console.log('10. network popup and icons');
    {
        const page = await newPage(browser, base);
        await routeHosted(page, { offline: true });
        const icons = [];
        page.on('response', (r) => { if (/favicon\.ico|icon-32\.png|icon\.png/.test(r.url())) icons.push(r.status()); });
        await page.goto(base + 'index.html');
        await page.waitForSelector('.dicon');
        check(await page.evaluate(() => !/No network connection|Network connected/.test(document.getElementById('toast').textContent)), 'no network notice while online');   // (the fake forecast's weather warnings may show)
        await page.focus('[data-game="snake"]'); await page.keyboard.press('Enter');
        await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'running');
        await page.context().setOffline(true);
        await page.waitForTimeout(200);
        const off = await page.evaluate(() => { const e = document.querySelector('#toast .nt-err'); return !!e && e.getAttribute('role') === 'alert' && e.textContent; });
        check(!!off && /No network/.test(off), 'network loss during a game shows a popup: "' + off + '"');
        check(await page.evaluate(() => window.GameHost.state()) === 'running', 'the game keeps running offline');
        await page.context().setOffline(false);
        await page.waitForTimeout(200);
        check(/Network connected/.test(await page.evaluate(() => { const e = document.querySelector('#toast .nt-ok'); return e ? e.textContent : ''; })), 'reconnecting shows "Network connected" (green)');
        check(await page.evaluate(() => document.querySelectorAll('#toast .nt:not(.out)').length) === 1, 'the network notice is updated in place, not stacked');
        // the one notification look: bottom right, rises in, slides down on timeout, same id updates, 3 at most
        const nt = await page.evaluate(async () => {
            Notify.clear();
            const r = {};
            Notify.show({ id: 'a', kind: 'ok', text: 'one', title: 'Title' });
            const el = document.querySelector('#toast .nt');
            r.cls = el.className; r.title = el.querySelector('.nt-title').textContent;
            const box = document.getElementById('toast').getBoundingClientRect();
            r.right = box.right > window.innerWidth * 0.8;
            Notify.show({ id: 'a', kind: 'err', text: 'two' });
            r.same = document.querySelectorAll('#toast .nt').length === 1 && /nt-err/.test(el.className) && el.textContent === 'two';
            for (let i = 0; i < 5; i++) Notify.show('n' + i);
            r.max = Notify.count();
            Notify.show({ text: 'short', timeout: 50 });
            await new Promise((ok) => setTimeout(ok, 120));
            r.out = !!document.querySelector('#toast .nt.out');
            Notify.clear();
            r.empty = document.getElementById('toast').hidden && !document.querySelector('#toast .nt');
            return r;
        });
        check(/nt-ok/.test(nt.cls) && nt.title === 'Title' && nt.right, 'a notification is a green card in the bottom right corner: ' + JSON.stringify(nt));
        check(nt.same, 'the same id updates the card (red now) instead of adding one');
        check(nt.max === 3, 'at most 3 notifications on screen');
        check(nt.out && nt.empty, 'on timeout the card slides down, then everything is removed');
        // notification sound: the profile's choice (Control Panel > Sound), one small <audio>, 'off' and silent: true play nothing
        const snd = await page.evaluate(async () => {
            const played = []; const orig = HTMLMediaElement.prototype.play;
            HTMLMediaElement.prototype.play = function () { played.push(this.src.split('/').pop()); return Promise.resolve(); };
            const wait = () => new Promise((ok) => setTimeout(ok, 450));
            const r = { def: AudioPrefs.notifySound() };
            Notify.clear(); await wait(); Notify.show('ding'); r.first = played.slice();
            await wait(); played.length = 0; Notify.show({ text: 'quiet', silent: true }); r.silent = played.length;
            await wait(); AudioPrefs.setNotifySound('bubble'); r.preview = played.slice(); r.saved = Store.get('notif_sound');
            await wait(); played.length = 0; AudioPrefs.setNotifySound('off'); Notify.show('nothing'); r.off = played.length;
            AudioPrefs.setNotifySound('crystal'); Notify.clear();
            HTMLMediaElement.prototype.play = orig;
            return r;
        });
        check(snd.def === 'crystal' && snd.first.join() === 'notify-crystal.wav', 'a notification plays the default sound: ' + JSON.stringify(snd));
        check(snd.silent === 0 && snd.off === 0, 'silent: true and the Off choice play no sound');
        check(snd.preview.join() === 'notify-bubble.wav' && snd.saved === 'bubble', 'choosing a sound plays it and saves it for the profile');
        const fav = await page.evaluate(() => [...document.querySelectorAll('link[rel~="icon"]')].map((l) => l.getAttribute('href')));
        // headless Chromium never requests favicons itself: fetch the declared files
        let served = true;
        for (const f of fav) served = served && (await page.request.get(base + f)).status() === 200;
        check(fav.indexOf('favicon.ico') >= 0 && served && icons.every((st) => st === 200), 'favicon declared and served (' + fav.join(', ') + ')');
        await page.context().close();
        const { size } = fs.statSync(path.join(ROOT, 'icon.png'));
        const png = fs.readFileSync(path.join(ROOT, 'icon.png'));
        check(png.readUInt32BE(16) === 512 && png.readUInt32BE(20) === 423 && png[25] === 2 && size < 300 * 1024,
            'icon.png is 512x423, 24-bit RGB, ' + Math.round(size / 1024) + ' KB (< 300 KB)');
    }

    console.log('11. Super Jumper controls: stable ground, duck, air steering');
    {
        const page = await newPage(browser, base);
        await routeHosted(page, { offline: true });
        await page.goto(base + 'index.html');
        await page.waitForSelector('[data-game="jumper"]');
        await page.focus('[data-game="jumper"]'); await page.keyboard.press('Enter');
        await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'running');
        await page.waitForTimeout(300);
        const G = 'document.querySelector("iframe").contentWindow';
        const dbg = () => page.evaluate(G + '.JumperDebug()');
        await page.evaluate(G + '.JumperCheat.enter("w1-1")');
        await page.waitForFunction(G + '.JumperDebug().mode === "play"');
        await page.waitForTimeout(800);
        let grounded = true;
        for (let i = 0; i < 12; i++) { grounded = grounded && (await dbg()).onGround; await page.waitForTimeout(17); }
        check(grounded, 'standing hero stays on the ground every frame (no flicker)');
        await page.keyboard.down('ArrowDown');
        let ducked = true, pounded = false;
        for (let i = 0; i < 10; i++) { await page.waitForTimeout(40); const d = await dbg(); ducked = ducked && d.crouch && /crouch/.test(d.frameName); pounded = pounded || d.gp > 0 || !d.onGround; }
        await page.keyboard.up('ArrowDown');
        check(ducked && !pounded, 'Down while standing ducks (no ground-pound slam)');
        await page.waitForTimeout(200);
        let d = await dbg(); const x0 = d.x;
        await page.keyboard.down('Space'); await page.waitForTimeout(60);
        await page.keyboard.down('ArrowRight'); await page.waitForTimeout(350);
        await page.keyboard.up('ArrowRight');
        d = await dbg();
        const airX = d.x;
        check(!d.onGround && d.x - x0 > 12, 'Right steers the hero in the air without run (' + Math.round(d.x - x0) + ' px)');
        await page.waitForTimeout(150);
        d = await dbg();
        check(d.x - airX > 6, 'the jump keeps its momentum after the arrow is released (remote friendly)');
        await page.keyboard.up('Space');
        await page.waitForTimeout(900);
        d = await dbg();
        for (let i = 0; i < 40 && !d.onGround; i++) { await page.waitForTimeout(50); d = await dbg(); }
        const y0 = d.y; let top = y0;
        await page.keyboard.down('Space');
        for (let i = 0; i < 45; i++) { await page.waitForTimeout(16); const q = await dbg(); if (q.y < top) top = q.y; }
        await page.keyboard.up('Space');
        check(y0 - top >= 72, 'a standing jump rises at least 4.5 tiles, enough for the high bricks (' + Math.round(y0 - top) + ' px)');
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }

    console.log('11b. Super Jumper 2 players: lives, deaths, respawns, power-ups');
    {
        const page = await newPage(browser, base);
        await routeHosted(page, { offline: true });
        await page.goto(base + 'index.html');
        await page.waitForSelector('[data-game="jumper"]');
        await page.focus('[data-game="jumper"]'); await page.keyboard.press('Enter');
        await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'running');
        await page.waitForTimeout(300);
        const G = 'document.querySelector("iframe").contentWindow';
        const dbg = () => page.evaluate(G + '.JumperDebug()');
        await tvBack(page);
        await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
        await page.keyboard.press('KeyF');
        await page.waitForTimeout(100);
        await page.evaluate(G + '.JumperCheat.enter("w1-1")');
        await page.waitForFunction(G + '.JumperDebug().mode === "play"');
        let d = await dbg();
        check(d.hudLives === '\u00D7 5' && d.hudLives2 === '\u00D7 5', 'HUD shows each hero with its own lives (' + d.hudLives + ' / ' + d.hudLives2 + ')');
        check(await page.evaluate(G + '.JumperCheat.tiles(15)') >= 3, 'stages have several power-up blocks (grow berry / fire bloom)');
        // player 1 falls while player 2 plays on: P1 respawns next to P2
        await page.evaluate(G + '.JumperCheat.kill(1)');
        await page.waitForFunction(G + '.JumperDebug().dead === false', null, { timeout: 5000 }).catch(() => {});
        d = await dbg();
        check(!d.dead && d.lives === 4 && d.mode === 'play' && Math.abs(d.x - d.p2.x) < 20, 'a fallen player 1 respawns next to player 2');
        // player 1 waits to respawn while player 2 leaves co-op: no frozen game
        await page.waitForTimeout(2600);
        await page.evaluate(G + '.JumperCheat.kill(1)');
        await page.waitForTimeout(300);
        await page.evaluate(G + '.JumperCheat.leave()');
        const ok = await page.waitForFunction(G + '.JumperDebug().mode === "play" && ' + G + '.JumperDebug().dead === false', null, { timeout: 8000 }).then(() => true, () => false);
        d = await dbg();
        check(ok && d.lives === 3 && !d.twoP, 'player 2 leaving while player 1 is down restarts the stage (no freeze)');
        // back to two players: P1 loses the last life and sits out, P2 plays on; then P2 falls
        await tvBack(page);
        await page.evaluate(() => [...document.querySelectorAll('#pause-items button')].filter((b) => /Two players/.test(b.textContent))[0].click());
        await page.keyboard.press('KeyF');
        await page.waitForTimeout(300);
        await page.evaluate(G + '.JumperCheat.setLives(1, 1)');
        await page.evaluate(G + '.JumperCheat.kill(1)');
        await page.waitForTimeout(3000);
        d = await dbg();
        check(d.out && d.mode === 'play' && !d.p2.dead && d.hudLives === '\u00D7 0', 'player 1 out of lives sits out while player 2 plays on');
        await page.evaluate(G + '.JumperCheat.kill(2)');
        await page.waitForFunction(G + '.JumperDebug().mode === "retry"', null, { timeout: 5000 }).catch(() => {});
        d = await dbg();
        check(d.mode === 'retry' && d.p2.lives === 4, 'the stage card (hero x lives) shows before the restart');
        await page.waitForFunction(G + '.JumperDebug().mode === "play"', null, { timeout: 5000 }).catch(() => {});
        d = await dbg();
        check(d.mode === 'play' && !d.p2.dead, 'the stage restarts with player 2');
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }

    console.log('12. covers come back after a game');
    {
        const page = await newPage(browser, base);
        await routeHosted(page, { offline: true });
        await page.goto(base + 'index.html');
        await page.waitForSelector('[data-game="snake"]');
        await page.waitForFunction(() => [...document.querySelectorAll('#desk-icons img')].every((i) => i.complete));
        await page.focus('[data-game="snake"]'); await page.keyboard.press('Enter');
        await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'running');
        check(await page.evaluate(() => [...document.querySelectorAll('#desk-icons img')].every((i) => !i.getAttribute('src'))), 'covers are released while a game runs');
        await tvBack(page);
        await page.evaluate(() => { const b = document.querySelectorAll('#pause-items button'); b[b.length - 1].click(); });
        await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'idle' && !!document.querySelector('#desk-icons .dicon') && document.activeElement !== document.body);
        await page.waitForFunction(() => [...document.querySelectorAll('#desk-icons img')].every((i) => i.complete), null, { timeout: 5000 }).catch(() => {});
        const vis = await page.evaluate(() => [...document.querySelectorAll('#desk-icons img')].map((i) => i.style.visibility !== 'hidden' && i.naturalWidth > 0));
        check(vis.length === 7 && vis.every(Boolean), 'all 7 covers visible again on the home screen');
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }

    console.log('13. profiles');
    {
        const page = await newPage(browser, base);
        await routeHosted(page, { offline: true });
        await page.goto(base + 'index.html');
        await page.waitForFunction(() => { const b = document.getElementById('profile-name'); return b && b.textContent; }, null, { timeout: 5000 }).catch(() => {});
        check(await page.textContent('#profile-name') === 'Player 1', 'a first profile "Player 1" exists');
        const ver = JSON.parse(fs.readFileSync(path.join(ROOT, 'app-manifest.json'), 'utf8'));
        check(await page.textContent('#app-version') === 'v' + ver.version + ' (Build ' + ver.build + ')', 'home shows the version: ' + await page.textContent('#app-version'));
        await page.evaluate(() => { AudioPrefs.setMusic(7); Scores.add('snake', 'PPP', 70); });
        await page.focus('#tb-start'); await page.keyboard.press('Enter');
        check(await page.evaluate(() => Desktop.startOpen()), 'the Start button opens the Start menu');
        await page.focus('#btn-profile'); await page.keyboard.press('Enter');
        check(await page.evaluate(() => !document.getElementById('profiles').hidden), 'the profile button in Start opens the Profiles screen');
        await page.focus('#profile-new'); await page.keyboard.press('Enter');
        // remote: OK on the focused "a" key, then a PC keyboard types the rest (a username: lower case)
        await page.keyboard.press('Enter');
        await page.keyboard.type('nA');
        check(await page.textContent('#namer-text') === 'ana', 'on-screen keyboard and PC keys type a username');
        const okKey = () => page.evaluate(() => [...document.querySelectorAll('#namer-keys button')].pop().click());
        await okKey();
        await page.keyboard.type('secret1');
        check(await page.textContent('#namer-text') === '•••••••', 'the password is hidden while it is typed');
        await okKey();
        await page.keyboard.type('secret1');
        await okKey();
        await page.waitForSelector('.welcome', { timeout: 5000 }).catch(() => {});
        check(await page.evaluate(() => !!document.querySelector('.welcome') && /ana/.test(document.querySelector('.welcome').textContent)), 'creating a profile shows the sign-in screen with the new user');
        await signedIn(page);
        check(await page.evaluate(() => Store.profile() === 'p2' && Profiles.current().name === 'ana' && Profiles.current().user === 'ana'), 'a new profile is an account named after its username, and becomes active');
        check(await page.evaluate(() => Scores.list('snake').length === 1 && Store.get('vol_music') !== 7), 'records are shared by every profile, settings are not');
        await page.keyboard.press('Escape');
        check(/ana/.test(await page.textContent('#btn-profile')), 'home shows the active profile');
        await page.reload();
        await page.waitForFunction(() => { const b = document.getElementById('profile-name'); return b && b.textContent; });
        check(await page.evaluate(() => Store.profile()) === 'p2', 'the active profile is remembered');
        await page.focus('#tb-start'); await page.keyboard.press('Enter');
        await page.focus('#btn-profile'); await page.keyboard.press('Enter');
        await page.focus('[data-profile="p1"]'); await page.keyboard.press('Enter');
        await signedIn(page);
        check(await page.evaluate(() => Store.profile() === 'p1' && Store.get('vol_music') === 7 && document.getElementById('profiles').hidden), 'switching back signs in as that profile with its own settings');
        await page.focus('#tb-start'); await page.keyboard.press('Enter');
        await page.focus('#btn-profile'); await page.keyboard.press('Enter');
        await page.focus('[data-profile="p2"]'); await page.keyboard.press('Enter');
        await signedIn(page);
        await page.focus('#tb-start'); await page.keyboard.press('Enter');
        await page.focus('#btn-profile'); await page.keyboard.press('Enter');
        await page.focus('#profile-delete'); await page.keyboard.press('Enter');
        await page.focus('#dialog-yes'); await page.keyboard.press('Enter');
        await signedIn(page);
        check(await page.evaluate(() => Profiles.list().length === 1 && Store.profile() === 'p1' && !Object.keys(localStorage).some((k) => k.indexOf('arc_p2_') === 0)), 'deleting a profile removes it and its data');
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }

    console.log('14. Parchís (Moroccan rules)');
    {
        const page = await newPage(browser, base);
        await routeHosted(page, { offline: true });
        await page.goto(base + 'index.html');
        await page.waitForSelector('[data-game="parchis"]');
        await page.evaluate(() => Store.set('game_parchis_setup', { n: 4, cpu: [true, true, true, true] }));
        await page.focus('[data-game="parchis"]'); await page.keyboard.press('Enter');
        await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'running');
        await page.waitForTimeout(200);
        const G = 'document.querySelector("iframe").contentWindow';
        const C = G + '.ParchisCheat';
        const rule = (js) => page.evaluate(C + js);
        check(await rule('.tryMove(0, 0, 4)') === null && (await rule('.tryMove(0, 0, 5)')).to === 0, 'a piece leaves the nest only with a 5');
        await rule('.set(1, 0, 61)');                                         // blue on square 14 (not safe)
        await rule('.set(0, 1, 7)');
        check(JSON.stringify((await rule('.tryMove(0, 1, 3)')).capture) === '[1,0]', 'landing on a lone rival captures it');
        await rule('.set(1, 0, 58)'); await rule('.set(0, 1, 4)');            // blue on safe square 11
        const sm = await rule('.tryMove(0, 1, 3)');
        check(sm && sm.capture === null, 'no capture on a safe square');
        await rule('.set(2, 0, 60)'); await rule('.set(2, 1, 60)'); await rule('.set(0, 2, 24)');   // red wall on square 30
        check(await rule('.tryMove(0, 2, 4)') === null && await rule('.tryMove(0, 2, 1)') !== null, 'two pieces of one colour make a wall nobody passes');
        await rule('.set(0, 3, 69)');
        check(await rule('.tryMove(0, 3, 3)') === null && (await rule('.tryMove(0, 3, 2)')).to === 71, 'the centre needs the exact number');
        await rule('.set(0, 2, -1)'); await rule('.set(1, 1, 51)');           // blue on yellow's exit
        check(JSON.stringify((await rule('.tryMove(0, 2, 5)')).capture) === '[1,1]', 'coming out captures a rival on the exit square');
        // a full 4-CPU game reaches a winner
        await page.keyboard.press('Enter');
        await rule('.turbo(40)');
        await page.waitForFunction(G + '.ParchisDebug().state === "over"', null, { timeout: 120000 }).catch(() => {});
        const end = await page.evaluate(G + '.ParchisDebug()');
        check(end.state === 'over' && end.pieces[end.winner].every((v) => v === 71), 'a 4-player CPU game ends with a winner (' + ['yellow', 'blue', 'red', 'green'][end.winner] + ')');
        await rule('.turbo(1)');
        // a person plays: OK rolls, a single legal move plays by itself
        await tvBack(page);
        await page.evaluate(() => { const b = document.querySelectorAll('#pause-items button'); b[1].click(); });   // New game
        await page.waitForFunction(G + '.ParchisDebug().state === "setup"');
        // setup with the remote: Players 4 -> 2, Yellow CPU -> Person, then Start game
        for (const k of ['ArrowDown', 'ArrowLeft', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowDown', 'ArrowDown', 'Enter']) { await page.keyboard.press(k); await page.waitForTimeout(40); }
        await page.waitForFunction(G + '.ParchisDebug().state === "roll"');
        const st = await page.evaluate(G + '.ParchisDebug()');
        check(st.turn === 0 && JSON.stringify(st.seats) === '[0,2]', '2 players sit opposite each other; yellow starts');
        await rule('.die(5)');
        await page.keyboard.press('Enter');
        await page.waitForFunction(G + '.ParchisDebug().pieces[0].indexOf(0) >= 0', null, { timeout: 5000 }).catch(() => {});
        check((await page.evaluate(G + '.ParchisDebug()')).pieces[0].indexOf(0) >= 0, 'OK rolls; a 5 brings a piece out');
        await tvBack(page);
        await page.evaluate(() => { const b = document.querySelectorAll('#pause-items button'); b[b.length - 1].click(); });
        await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'idle' && !!document.querySelector('#desk-icons .dicon') && document.activeElement !== document.body);
        await page.focus('[data-app="scores"]'); await page.keyboard.press('Enter');
        check(await page.evaluate(() => document.querySelectorAll('.lb-tab').length) === 7, 'Hall of Fame + one list per game; Parchís (no points) has none');
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }

    console.log('15. desktop shell: taskbar, Start, full-screen apps');
    {
        const page = await newPage(browser, base);
        await routeHosted(page, { offline: true });
        await page.goto(base + 'index.html');
        await page.waitForSelector('#desk-icons [data-game="parchis"]');
        const key = async (...ks) => { for (const k of ks) { await page.keyboard.press(k); await page.waitForTimeout(40); } };
        check(/\d{1,2}:\d{2}/.test(await page.textContent('#tray-time')) && (await page.textContent('#tray-date')).length > 5, 'taskbar clock shows time and date (' + await page.textContent('#tray-time') + ')');
        check(await page.evaluate(() => document.querySelectorAll('#desk-icons [data-game]').length === 7 && !!document.querySelector('#desk-icons [data-app="explorer"]')), 'desktop icons: 7 games plus apps');
        await page.focus('#tb-start'); await key('Enter');
        check(await page.evaluate(() => Desktop.startOpen() && document.querySelectorAll('#start-pinned [data-focus]').length === 18), 'Start menu lists 11 apps (with the App Store, Memo, Music, Playtime and Weather) and 7 games');
        await key('Escape');
        check(await page.evaluate(() => !Desktop.startOpen() && document.activeElement.id === 'tb-start'), 'Back closes Start');
        // shortcut menu: hold OK on a shortcut (a short press still opens it), a long press with the mouse or a finger, a right click
        await page.focus('#desk-icons [data-game="parchis"]');
        await page.keyboard.down('Enter'); await page.waitForTimeout(800); await page.keyboard.up('Enter');
        check(await page.evaluate(() => Desktop.menuOpen() && GameHost.state() === 'idle' && [...document.querySelectorAll('#dmenu .dm-item')].map((b) => b.textContent).join('|') === 'Open|Remove from home screen' && document.activeElement.textContent === 'Open'),
            'holding OK on a shortcut opens its menu instead of the game (Open, Remove; no Uninstall for a built-in game)');
        await key('ArrowDown', 'Enter');
        check(await page.evaluate(() => !Desktop.menuOpen() && !document.querySelector('#desk-icons [data-game="parchis"]') && !Desktop.onHome('parchis') && Store.get('home_hidden', []).indexOf('parchis') >= 0 && document.activeElement.classList.contains('dicon')),
            'Remove from home screen hides the shortcut for this profile; the focus stays on the desktop');
        await page.focus('#tb-start'); await key('Enter');
        await page.evaluate(() => document.querySelector('#start-pinned [data-game="parchis"]').scrollIntoView());
        const tbox = await (await page.$('#start-pinned [data-game="parchis"]')).boundingBox();
        await page.mouse.move(tbox.x + tbox.width / 2, tbox.y + tbox.height / 2); await page.mouse.down(); await page.waitForTimeout(800); await page.mouse.up();
        check(await page.evaluate(() => Desktop.menuOpen() && Desktop.startOpen() && GameHost.state() === 'idle' && [...document.querySelectorAll('#dmenu .dm-item')].map((b) => b.textContent).join('|') === 'Open|Add to home screen'),
            'a long press on a Start tile shows its menu with Add to home screen, and does not open the game');
        await page.click('#dmenu button:nth-of-type(2)');
        check(await page.evaluate(() => !Desktop.menuOpen() && Desktop.startOpen() && Desktop.onHome('parchis') && !!document.querySelector('#desk-icons [data-game="parchis"]')), 'Add to home screen brings the shortcut back');
        await key('Escape');
        await page.click('#desk-icons [data-app="explorer"]', { button: 'right' });
        check(await page.evaluate(() => Desktop.menuOpen() && document.querySelectorAll('#dmenu .dm-item').length === 2), 'a right click opens the menu too');
        await key('Escape');
        check(await page.evaluate(() => !Desktop.menuOpen() && document.activeElement.getAttribute('data-app') === 'explorer' && document.getElementById('window').hidden), 'Back closes the menu and goes back to the shortcut');
        await key('Enter');
        check(await page.evaluate(() => Win.current() === 'explorer'), 'a short OK still opens the shortcut');
        await key('Escape');
        // many shortcuts on a small screen: the icons scroll sideways, the focus brings the last one into view
        await page.setViewportSize({ width: 740, height: 360 });
        await page.waitForTimeout(150);
        await page.evaluate(() => { Desktop.setInstalled(Array.from({ length: 60 }, (x, i) => ({ id: 'many' + i, name: 'App ' + i, type: 'game' }))); });
        const fits = await page.evaluate(() => {
            const box = document.getElementById('desk-icons'), l = box.querySelectorAll('.dicon'), last = l[l.length - 1];
            last.focus();
            const r = last.getBoundingClientRect(), b = box.getBoundingClientRect();
            return JSON.stringify({ ok: box.scrollWidth > box.clientWidth && box.scrollLeft > 0 && r.left >= b.left - 1 && r.right <= b.right + 1, sw: box.scrollWidth, cw: box.clientWidth, sl: box.scrollLeft, r: [r.left, r.right], b: [b.left, b.right], a: document.activeElement === last });
        });
        check(JSON.parse(fits).ok, fits + ' ' + 'on a small screen, many shortcuts scroll sideways and the focused one is in view');
        await page.evaluate(() => Desktop.setInstalled(Cloud.apps()));
        await page.setViewportSize({ width: 1280, height: 720 });
        // calculator from the taskbar, with the remote
        await page.focus('#tb-calculator'); await key('Enter');
        check(await page.evaluate(() => !document.getElementById('window').hidden && document.getElementById('desktop').hidden), 'an app opens full screen and the desktop is hidden');
        check(await page.evaluate(() => [...document.querySelectorAll('#desktop img')].every((i) => !i.getAttribute('src'))), 'desktop covers are released while an app runs');
        await key('Enter', 'ArrowRight', 'Enter', 'ArrowDown', 'ArrowRight', 'Enter', 'ArrowDown', 'ArrowDown', 'Enter');   // 5, 6, +, =
        check(await page.textContent('.calc-disp') === '112', 'calculator with the remote: 56 + 56 = ' + await page.textContent('.calc-disp'));
        await page.keyboard.type('7*6=');
        check(await page.textContent('.calc-disp') === '42', 'calculator with a PC keyboard: 7*6 = 42');
        await key('Escape');
        check(await page.evaluate(() => document.getElementById('window').hidden && document.getElementById('win-body').childNodes.length === 0 && document.activeElement.id === 'tb-calculator'), 'Back closes the app, frees its content and refocuses the taskbar button');
        // focus memory: closing an app or a game focuses again the item it was opened from
        await page.focus('#desk-icons [data-app="explorer"]'); await key('Enter'); await key('Escape');
        check(await page.evaluate(() => document.activeElement.getAttribute('data-app') === 'explorer' && document.getElementById('desk-icons').contains(document.activeElement)), 'an app opened from its desktop icon refocuses that icon');
        await page.focus('#tb-explorer'); await key('Enter'); await key('Escape');
        check(await page.evaluate(() => document.activeElement.id === 'tb-explorer'), 'the same app opened from the taskbar refocuses the taskbar button, not the desktop icon');
        const quitGame = async (id) => {
            await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'running', null, { timeout: 15000 });
            await tvMenu(page);
            await Promise.all([page.waitForURL(new RegExp('from=' + id)), page.evaluate(() => { const b = document.querySelectorAll('#pause-items button'); b[b.length - 1].click(); })]);
            await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'idle' && !!document.querySelector('#desk-icons .dicon') && document.activeElement !== document.body);
        };
        await page.evaluate(() => Store.set('last_game', 'parchis'));
        await page.evaluate(() => Desktop.openStart());
        await page.focus('#start-pinned [data-game="snake"]');
        await Promise.all([page.waitForURL(/play=snake/), key('Enter')]);
        await quitGame('snake');
        check(await page.evaluate(() => document.activeElement.getAttribute('data-game') === 'snake' && document.getElementById('desk-icons').contains(document.activeElement) && !Desktop.startOpen()), 'a game opened from a Start tile comes back to its desktop icon');
        await page.evaluate(() => Desktop.setOnHome('snake', false));
        await page.evaluate(() => Desktop.openStart());
        await page.focus('#start-pinned [data-game="snake"]');
        await Promise.all([page.waitForURL(/play=snake/), key('Enter')]);
        await quitGame('snake');
        check(await page.evaluate(() => document.activeElement.id === 'tb-start'), 'a game opened from Start and not on the home screen comes back to the Start button');
        await page.evaluate(() => Desktop.setOnHome('snake', true));
        await page.focus('#tray-clock'); await key('Enter');
        check(await page.evaluate(() => Win.current() === 'calendar'), 'the clock opens the calendar');
        await key('Escape');
        check(await page.evaluate(() => document.activeElement.id === 'tray-clock'), 'closing the calendar refocuses the clock it was opened from');
        // calendar: today, add a note with the on-screen keyboard
        await page.evaluate(() => Win.open('calendar'));
        check(await page.evaluate(() => document.activeElement.className.indexOf('cal-today') >= 0), 'calendar opens on today');
        await key('Enter');
        await page.keyboard.type('match');
        await page.evaluate(() => [...document.querySelectorAll('#namer-keys button')].pop().click());
        await page.waitForSelector('.cal-save');
        await page.click('.cal-save');
        const mine = await page.evaluate(() => Events.mine().map((e) => Object.assign({ today: e.date === Events.ymd(new Date()) }, e)));
        check(mine.length === 1 && mine[0].title === 'Match' && mine[0].today && await page.evaluate(() => /Match/.test(document.querySelector('.cal-today').textContent)),
            'an event is saved on the day and shown in it');
        await key('Escape');
        // Memo: the record key (R = the red button) records a new memo, again on its screen adds a part, Play plays both
        await page.evaluate(() => Win.open('memo'));
        await page.waitForFunction(() => !!document.querySelector('.memo-empty'), null, { timeout: 3000 }).catch(() => {});
        check(await page.evaluate(() => document.activeElement.id === 'memo-new' && !!document.querySelector('.memo-empty')), 'Memo opens on its (empty) list, focus on New memo');
        await key('r');
        await page.waitForFunction(() => document.querySelector('.memo-mic.memo-on'), null, { timeout: 5000 });
        await page.waitForTimeout(1200);
        await key('r');
        await page.waitForFunction(() => document.activeElement.id === 'memo-play', null, { timeout: 5000 });
        await key('r');
        await page.waitForFunction(() => document.querySelector('.memo-mic.memo-on'), null, { timeout: 5000 });
        await page.waitForTimeout(800);
        await key('Escape');      // Back while recording: saved, back on the list with the memo focused
        await page.waitForFunction(() => document.activeElement && document.activeElement.className === 'memo-item', null, { timeout: 5000 });
        const memos = await page.evaluate(() => new Promise((ok) => MemoStore.list((e, l) => ok(l.map((m) => ({ n: m.parts.length, s: m.seconds, mime: m.parts[0].mime, size: m.parts[0].audio.size }))))));
        check(memos.length === 1 && memos[0].n === 2 && memos[0].s > 1 && memos[0].size > 500, 'Memo: one memo with two recordings ' + JSON.stringify(memos));
        await key('Enter');
        await page.waitForFunction(() => document.activeElement.id === 'memo-play');
        await key('Enter');
        check(await page.evaluate(() => document.getElementById('memo-play').textContent === 'Stop'), 'Memo: OK on Play plays the memo');
        await key('Enter', 'ArrowRight', 'Enter', 'Enter');      // stop, Delete twice
        await page.waitForFunction(() => document.querySelector('.memo-empty'), null, { timeout: 5000 });
        const other = await page.evaluate(() => new Promise((ok) => { MemoStore.save({ parts: [{ audio: new Blob(['x']), mime: 'audio/wav', seconds: 1 }] }, () => {
            const p = Store.profile(); Store.setProfile('p9'); MemoStore.list((e, l) => { Store.setProfile(p); ok(l.length); }); }); }));
        check(other === 0, 'Memo: another profile does not see the memos');
        await key('Escape');
        check(await page.evaluate(() => Win.current() === null && !Mic.active()), 'Memo closes with the microphone off');
        // the Control Panel (was Settings) opens on a grid of categories
        await page.evaluate(() => Win.open('settings'));
        check(await page.evaluate(() => document.querySelectorAll('.cp-tile').length === 16 && document.getElementById('win-title').textContent === 'Control Panel' &&
            document.activeElement.getAttribute('data-page') === 'system' && document.querySelector('.set-nav').hidden), 'the Control Panel opens on a grid of 16 categories, focus on the first');
        await key('ArrowRight', 'Enter');
        check(await page.evaluate(() => !document.querySelector('.cp-home') .offsetParent && document.querySelector('.set-title').textContent === 'Personalization' &&
            document.activeElement.getAttribute('data-theme') === 'win11'), 'OK on a card opens its page, focus on its first row (the theme)');
        // settings with the remote: background (the row under the themes)
        await key('ArrowDown', 'ArrowRight', 'Enter');
        check(await page.evaluate(() => Store.get('wallpaper') === 'aurora' && document.getElementById('wallpaper').className.indexOf('wp-aurora') >= 0), 'Settings > Personalization changes the background');
        await key('Escape', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowLeft');   // Personalization > Widgets > Apps > Accounts > Google Drive > Sound
        check(await page.evaluate(() => AudioPrefs.music()) === 6, 'Settings > Sound: left lowers the music volume');
        await key('Escape', 'Escape');
        check(await page.evaluate(() => Win.current() === 'settings' && !!document.querySelector('.cp-grid') && !document.querySelector('.cp-home').hidden &&
            document.activeElement.getAttribute('data-page') === 'sound'), 'Back from the page list goes to the grid, on the category just left');
        await key('Escape');
        check(await page.evaluate(() => Win.current() === null), 'Back on the grid closes the Control Panel');
        // explorer: Games folder starts a game; quitting comes back to the desktop
        await page.evaluate(() => Win.open('explorer', 'games'));
        await key('Enter');
        await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'running', null, { timeout: 8000 });
        check(await page.evaluate(() => document.getElementById('window').hidden && Win.current() === null), 'opening a game from File Explorer closes the app first');
        await tvMenu(page);
        await page.evaluate(() => { const b = document.querySelectorAll('#pause-items button'); b[b.length - 1].click(); });
        await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'idle' && !!document.querySelector('#desk-icons .dicon') && document.activeElement !== document.body);
        check(await page.evaluate(() => !document.getElementById('desktop').hidden && document.activeElement.getAttribute('data-game') === 'jumper'), 'quitting the game returns to the desktop');
        // browser: the page iframe is gone after closing
        await page.evaluate(() => Win.open('browser'));
        await key('Enter'); await page.keyboard.type('example.com');
        await page.evaluate(() => [...document.querySelectorAll('#namer-keys button')].pop().click());
        check(await page.evaluate(() => document.querySelectorAll('.br-frame').length === 1 && document.activeElement.className.indexOf('br-view') >= 0), 'browser loads the address and focuses the page');
        await key('Escape', 'Escape');
        check(await page.evaluate(() => document.querySelectorAll('iframe').length === 0 && document.getElementById('window').hidden), 'closing the browser removes its page');
        // open/close every app 5 times: nothing left behind
        for (let i = 0; i < 5; i++) for (const a of ['explorer', 'browser', 'calculator', 'calendar', 'settings', 'scores']) { await page.evaluate((x) => Win.open(x), a); await page.evaluate(() => Win.close()); }
        check(await page.evaluate(() => document.getElementById('win-body').childNodes.length === 0 && document.querySelectorAll('iframe').length === 0 && !document.getElementById('desktop').hidden), 'apps opened and closed 30 times leave nothing behind');
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }

    console.log('16. installed apps: Firebase list, My PC SDK, sandboxed iframe');
    {
        const APP = 'https://apps.example.test/star/';
        const page = await newPage(browser, base);
        await routeHosted(page, { offline: true });
        // the SDK and the example app, served from "other websites"
        await page.route(OLD_HOSTED + 'sdk/mypc-sdk.js', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(ROOT, 'sdk/mypc-sdk.js')) }));
        let slowOnce = true;
        await page.context().route(APP + '**', async (r) => {
            const rel = r.request().url().slice(APP.length).split('?')[0] || 'index.html';
            if (rel === 'index.html' && slowOnce) { slowOnce = false; await new Promise((x) => setTimeout(x, 900)); }   // keeps the start screen up for the test
            const p = path.join(ROOT, 'sdk/example', rel);
            if (!fs.existsSync(p)) return r.fulfill({ status: 404, body: '' });
            r.fulfill({ status: 200, contentType: TYPES[path.extname(p)] || (p.endsWith('.svg') ? 'image/svg+xml' : 'text/plain'), headers: { 'Access-Control-Allow-Origin': '*' }, body: fs.readFileSync(p) });
        });
        let firestoreUp = true, liveSpeed = 1, liveVersion = '1.0.0', removed = false, liveBg = false;
        // the app's config as Firestore stores it: nested map, list, null
        const cfgValue = (speed) => ({ mapValue: { fields: Object.assign({ speed: { integerValue: String(speed) },
            levels: { arrayValue: { values: [{ integerValue: '1' }, { stringValue: 'a' }] } },
            nested: { mapValue: { fields: { on: { booleanValue: true }, none: { nullValue: null } } } } }, liveBg ? { allow_background_running: { booleanValue: true } } : {}) } });
        const loseFocus = async () => { await page.evaluate(() => { document.hasFocus = () => false; window.dispatchEvent(new Event('blur')); }); await page.waitForTimeout(300); await page.evaluate(() => { delete document.hasFocus; }); };
        const doc = { fields: { id: { stringValue: 'star-catcher' }, name: { stringValue: 'Star Catcher' }, description: { stringValue: 'Catch stars' },
            url: { stringValue: APP }, entry: { stringValue: APP + 'index.html' }, icon: { stringValue: APP + 'icon.svg' }, type: { stringValue: 'game' },
            version: { stringValue: '1.0.0' }, scores: { booleanValue: true }, enabled: { booleanValue: true }, order: { integerValue: '0' },
            config: cfgValue(1) } };
        const hidden = { fields: Object.assign({}, doc.fields, { id: { stringValue: 'hidden-one' }, enabled: { booleanValue: false } }) };
        // the list always answers with config speed 1 (what the TV has saved); the single-app request, made right
        // before an app opens, answers with the live value: that tells "read again before opening" from "from the list"
        // installed on this TV from the App Store (the store itself is tested in section 26)
        // a game controller on the TV (top page only): MyPC.gamepad must see every button, not only the mapped actions
        await page.addInitScript(() => {
            if (window.top !== window) return;
            const b = []; for (let k = 0; k < 18; k++) b.push({ pressed: false, value: 0 });
            window.__pads = [];
            navigator.getGamepads = () => window.__pads;
            window.__plug = () => { window.__pads = [{ index: 0, id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 02fd)', connected: true, mapping: 'standard', buttons: b, axes: [0, 0, 0, 0] }]; window.dispatchEvent(new Event('gamepadconnected')); };
            window.__gp = (i, v) => { b[i].value = v; b[i].pressed = v > 0.5; };
        });
        await page.addInitScript(() => { if (!localStorage.getItem('arc_dev_installed')) localStorage.setItem('arc_dev_installed', JSON.stringify([{ id: 'star-catcher', at: 1 }, { id: 'hidden-one', at: 1 }])); });
        await page.context().route('https://firestore.googleapis.com/**', (r) => {
            if (!firestoreUp) return r.abort('internetdisconnected');
            if (!/\/documents\/apps(\/|\?|$)/.test(r.request().url())) return r.fallback();      // counters, backup...: the shared fake
            const json = (status, o) => r.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(o) });
            if (r.request().url().indexOf('/documents/apps/star-catcher') > 0) return removed ? json(404, { error: { code: 404, status: 'NOT_FOUND' } }) : json(200, { fields: Object.assign({}, doc.fields, { config: cfgValue(liveSpeed), version: { stringValue: liveVersion } }) });
            json(200, { documents: [doc, hidden] });
        });
        await page.goto(base + 'index.html');
        const icon = '#desk-icons [data-game="app-star-catcher"]';
        const shown = await page.waitForSelector(icon, { timeout: 8000 }).then(() => true, () => false);
        check(shown && await page.evaluate(() => !document.querySelector('[data-game="app-hidden-one"]')), 'the installed app from Firebase appears on the desktop (hidden ones do not)');
        await page.focus(icon); await page.keyboard.press('Enter');
        await page.waitForSelector('#game-loading:not([hidden]) .gl-icon img', { timeout: 8000 });
        check(await page.evaluate(() => document.getElementById('game-loading-title').textContent === 'Star Catcher' && /icon\.svg$/.test(document.querySelector('.gl-icon img').src) &&
            /Getting things ready/.test(document.querySelector('.gl-status').textContent) && document.getElementById('game-loading-bar').getAttribute('aria-label') === 'Opening'),
            'the start screen shows the app icon and name, with PC-style texts ("Opening", "Getting things ready…")');
        const ran = await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'running', null, { timeout: 10000 }).then(() => true, () => false);
        check(await page.evaluate(() => document.getElementById('game-loading').hidden && document.querySelector('.gl-icon').childNodes.length === 0), 'once the app is open, the start screen is hidden and its icon is freed');
        const fr = await page.evaluate(() => { const f = document.querySelector('iframe'); return f && { src: f.src, sandbox: f.getAttribute('sandbox') }; });
        check(ran && fr && fr.src.indexOf(APP) === 0 && fr.sandbox === 'allow-scripts allow-same-origin allow-pointer-lock', 'it opens full screen in a sandboxed iframe on its own origin, and reports ready through the SDK');
        const frame = page.frames().find((f) => f.url().indexOf(APP) === 0);
        check(!!frame && await frame.evaluate(() => MyPC.isHosted() && MyPC.info().lang === 'en' && !MyPC.info().standalone), 'the app gets the init data from My PC (hosted, language)');
        check(JSON.stringify(await frame.evaluate(() => MyPC.app_config)) === JSON.stringify({ speed: 1, levels: [1, 'a'], nested: { on: true, none: null } }),
            'MyPC.app_config is the config object saved in Firebase (nested values and lists included)');
        await page.keyboard.press('Enter');                          // OK on the remote -> "confirm" action -> the game starts
        await page.waitForTimeout(300);
        check(await frame.evaluate(() => document.getElementById('msg').textContent === ''), 'remote input reaches the app as actions');
        await page.keyboard.down('ArrowRight'); await page.waitForTimeout(150);
        check(await frame.evaluate(() => MyPC.isDown('right')), 'held keys are held actions (MyPC.isDown)');
        await page.keyboard.up('ArrowRight');
        await frame.evaluate(() => { window.__life = []; window.addEventListener('message', (e) => { if (e.data && e.data.mypc === 1 && /^(pause|resume)$/.test(e.data.type)) __life.push(e.data.type); }); });
        await loseFocus();
        check(await page.evaluate(() => window.GameHost.state() === 'paused' && !document.getElementById('pause').hidden) && (await frame.evaluate(() => __life.join())) === 'pause',
            'My PC losing the focus pauses the app (onPause) under My PC\'s menu');
        check(await page.evaluate(() => { const t = document.getElementById('pause-bg'); return !t.classList.contains('on') && t.textContent === 'Background: off'; }), 'the menu shows a grey "Background: off" tag');
        await page.evaluate(() => document.querySelector('#pause-items button').click());
        await page.waitForTimeout(150);
        check(await frame.evaluate(() => __life.join()) === 'pause,resume', 'Resume resumes it (onResume)');
        await frame.evaluate(() => MyPC.save('best', 7));
        await page.waitForTimeout(100);
        check(await page.evaluate(() => Store.get('game_app-star-catcher_data', {}).best === 7), 'MyPC.save stores data in the active profile');
        // MyPC.sensors (phones in a sensor mode): the app says which moves it wants; events come back with the player number
        await frame.evaluate(() => { window.__sv = []; window.__sm = []; MyPC.sensors.on('action', (e, p) => __sv.push(e.action + '/' + p)); MyPC.sensors.on('metrics', (m) => __sm.push(m.gait)); MyPC.sensors.on('config', (c) => { window.__scfg = c; }); MyPC.sensors.setup({ moves: ['JUMP', 'DUCK', 'NOPE'], metrics: { hz: 1 } }); });
        await frame.waitForFunction(() => window.__scfg, null, { timeout: 3000 });
        check(await frame.evaluate(() => JSON.stringify(__scfg.moves) === '["JUMP","DUCK"]' && __scfg.metrics.enabled && MyPC.apiLevel >= 8), 'MyPC.sensors.setup: the phones are asked for the known moves only, with metrics');
        await page.evaluate(() => { Controllers.inject(2, { type: 'action', action: 'JUMP', timestamp: Date.now(), sequence: 1 }); Controllers.inject(1, { type: 'metrics', gait: 'RUN', cadence: 160, sequence: 2 }); });
        await frame.waitForFunction(() => __sv.length && __sm.length, null, { timeout: 3000 });
        check(await frame.evaluate(() => __sv[0] === 'JUMP/2' && __sm[0] === 'RUN'), 'moves and metrics from the phones reach the app with the player number');
        // MyPC.gamepad: every button (LB, X, Y, an analog RT, a button past the standard 17) and the right stick, unmapped
        await frame.evaluate(() => { window.__gb = []; window.__gpads = null; MyPC.gamepad.on('button', (i, p, v, dev, name) => __gb.push(name + ':' + (p ? 1 : 0) + ':' + v + ':' + dev)); MyPC.gamepad.on('pads', (l) => { __gpads = l; }); });
        await page.evaluate(() => window.__plug());
        await frame.waitForFunction(() => __gpads && __gpads.length === 1, null, { timeout: 4000 }).catch(() => {});
        check(await frame.evaluate(() => __gpads && __gpads[0].dev === 'pad0' && __gpads[0].name === 'Xbox Wireless Controller' && __gpads[0].standard && __gpads[0].buttons === 18 && MyPC.apiLevel >= 9),
            'MyPC.gamepad lists the connected controller (name, standard mapping, its 18 buttons)');
        for (const [i, v] of [[4, 1], [2, 1], [3, 1], [7, 0.6], [17, 1]]) { await page.evaluate(([x, y]) => window.__gp(x, y), [i, v]); await page.waitForTimeout(60); }
        await page.evaluate(() => { window.__pads[0].axes[2] = 0.8; });
        await frame.waitForFunction(() => __gb.length >= 5 && MyPC.gamepad.axis(2) > 0.7, null, { timeout: 3000 }).catch(() => {});
        check(await frame.evaluate(() => ['LB:1:1:pad0', 'X:1:1:pad0', 'Y:1:1:pad0', 'RT:1:0.6:pad0', 'Button17:1:1:pad0'].every((e) => __gb.indexOf(e) >= 0) &&
            MyPC.gamepad.pressed(4) && MyPC.gamepad.pressed(3, 'pad0') && MyPC.gamepad.value(7) > 0.59 && MyPC.gamepad.axis(2, 'pad0') > 0.7),
            'every controller button reaches the app with its name and analog value (LB, X, Y, RT 0.6, a 18th button), and the right stick (' + await frame.evaluate(() => __gb.join(' ')) + ')');
        await tvMenu(page);
        await page.waitForTimeout(150);
        await frame.evaluate(() => { __gb.length = 0; });
        await page.evaluate(() => window.__gp(5, 1));
        await page.waitForTimeout(200);
        check(await frame.evaluate(() => !MyPC.gamepad.pressed(4) && !MyPC.gamepad.pressed(7) && __gb.length === 0), 'under My PC\'s pause menu the app gets no button and held buttons are let go');
        await page.evaluate(() => { for (const i of [2, 3, 4, 5, 7, 17]) window.__gp(i, 0); window.__pads[0].axes[2] = 0; });
        await page.evaluate(() => { const b = document.querySelectorAll('#pause-items button'); b[0].click(); });
        await page.waitForFunction(() => window.GameHost.state() === 'running');
        await page.waitForTimeout(150);
        check(await frame.evaluate(() => MyPC.bluetooth.capabilities().then(() => 'yes', (e) => e.message)) === 'Bluetooth is not allowed for this app.', 'MyPC.bluetooth is refused to an app that is not allowed to use it');
        // MyPC.text (API 13): the app's focused text field is told to My PC; a phone in Text mode types into it
        await frame.evaluate(() => { const i = document.createElement('input'); i.id = '__tx'; i.placeholder = 'Your name'; window.__txi = []; window.__txe = 0; i.addEventListener('input', () => __txi.push(i.value)); i.addEventListener('keydown', (e) => { if (e.keyCode === 13) __txe++; }); document.body.appendChild(i); i.focus(); });
        await page.waitForFunction(() => TextIn.current() && TextIn.current().src === 'app', null, { timeout: 3000 }).catch(() => {});
        const af = await page.evaluate(() => TextIn.current());
        check(af && af.src === 'app' && af.label === 'Your name' && af.kind === 'text' && await frame.evaluate(() => MyPC.apiLevel >= 13), 'the app\'s focused text field reaches My PC (MyPC.text, API 13) ' + JSON.stringify(af));
        await page.evaluate(() => { TextIn.put('Imad', false); TextIn.put('Imad K', true); });
        await frame.waitForFunction(() => window.__txe === 1, null, { timeout: 3000 }).catch(() => {});
        check(await frame.evaluate(() => document.getElementById('__tx').value === 'Imad K' && __txi.join('|') === 'Imad|Imad K' && __txe === 1), 'the phone\'s text is written into the app\'s field (input events), Send presses Enter there');
        await frame.evaluate(() => { const i = document.getElementById('__tx'); i.blur(); window.__own = []; MyPC.text.open({ value: 'AAA', kind: 'name', label: 'Hero', max: 7, onInput: (v) => __own.push('i:' + v), onSend: (v) => __own.push('s:' + v) }); });
        await page.waitForFunction(() => TextIn.current() && TextIn.current().label === 'Hero', null, { timeout: 3000 }).catch(() => {});
        await page.evaluate(() => TextIn.put('Bob the great', true));
        await frame.waitForFunction(() => __own.length === 2, null, { timeout: 3000 }).catch(() => {});
        check(await frame.evaluate(() => __own.join('|') === 'i:Bob the|s:Bob the'), 'MyPC.text.open: a canvas field gets the text (onInput, then onSend; max kept) ' + await frame.evaluate(() => __own.join('|')));
        await frame.evaluate(() => { MyPC.text.close(); document.getElementById('__tx').remove(); });
        await page.waitForFunction(() => TextIn.current() === null, null, { timeout: 3000 }).catch(() => {});
        check(await page.evaluate(() => TextIn.current() === null), 'with no field open in the app, My PC has no text field either');
        await tvMenu(page);
        const items = await page.evaluate(() => [...document.querySelectorAll('#pause-items button')].map((b) => b.textContent));
        check(await page.evaluate(() => window.GameHost.state()) === 'paused' && items.indexOf('Restart') > 0, 'Back opens My PC\'s pause menu with the app\'s own items (' + items.join(', ') + ')');
        await page.evaluate(() => { const b = document.querySelectorAll('#pause-items button'); b[0].click(); });
        await frame.evaluate(() => MyPC.submitScore(321));
        await page.waitForFunction(() => Scores.list('app-star-catcher').length === 1, null, { timeout: 4000 }).catch(() => {});
        check(await page.evaluate(() => Scores.list('app-star-catcher')[0].s === 321 && window.GameHost.state() === 'paused' || window.GameHost.state() === 'running'), 'MyPC.submitScore saves the record for the profile by itself, no initials screen');
        await tvMenu(page);
        await page.evaluate(() => { const b = document.querySelectorAll('#pause-items button'); b[b.length - 1].click(); });
        await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'idle' && !!document.querySelector('#desk-icons .dicon') && document.activeElement !== document.body);
        check(await page.evaluate(() => document.querySelectorAll('iframe').length === 0 && document.activeElement.getAttribute('data-game') === 'app-star-catcher'), 'quitting removes the iframe and returns to its desktop icon');
        check(await page.evaluate(() => Controllers.sensorConfig() === null), 'quitting the app stops its sensor setup (phones go back to the default moves)');
        // the owner changes the config in the installer: the next launch gets it (the saved list still has the old one)
        liveSpeed = 3; liveVersion = '1.0.1'; liveBg = true;
        await page.focus(icon); await page.keyboard.press('Enter');
        await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'running', null, { timeout: 10000 });
        const f2 = page.frames().find((f) => f.url().indexOf(APP) === 0);
        check(await f2.evaluate(() => MyPC.app_config.speed) === 3, 'the config is read again from Firebase before the app opens (the saved copy was older)');
        check(/[?&]mypc_v=1\.0\.1(&|$)/.test(f2.url()), 'a new version published in the store opens at once: its version is in the address, so the TV cache is skipped (' + f2.url() + ')');
        // "allow_background_running": true in the config: losing the focus does nothing (no menu, no onPause)
        await f2.evaluate(() => { window.__life = []; window.addEventListener('message', (e) => { if (e.data && e.data.mypc === 1 && /^(pause|resume)$/.test(e.data.type)) __life.push(e.data.type); }); });
        await loseFocus();
        check(await page.evaluate(() => window.GameHost.state() === 'running' && document.getElementById('pause').hidden) && (await f2.evaluate(() => __life.length)) === 0,
            'allow_background_running: losing the focus leaves the app running, no menu');
        await tvMenu(page);
        check(await page.evaluate(() => { const t = document.getElementById('pause-bg'); return t.classList.contains('on') && t.textContent === 'Background: on'; }), 'the menu (opened with Back) shows a green "Background: on" tag');
        await page.evaluate(() => document.querySelector('#pause-items button').click());
        await page.waitForTimeout(150);
        liveBg = false;
        await f2.evaluate(() => MyPC.exit());
        check(await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'idle' && !!document.querySelector('#desk-icons .dicon') && document.activeElement !== document.body, null, { timeout: 4000 }).then(() => true, () => false), 'MyPC.exit() closes the app');
        // uninstalled meanwhile: opening it sends you straight back to the desktop
        removed = true;
        await page.focus(icon);
        await Promise.all([page.waitForURL(/play=app-star-catcher/), page.keyboard.press('Enter')]);
        await page.waitForURL(/from=app-star-catcher/, { timeout: 8000 });
        check(await page.waitForSelector(icon, { timeout: 8000 }).then(() => true, () => false) && await page.evaluate(() => document.querySelectorAll('iframe').length === 0), 'an app uninstalled meanwhile does not open: back to the desktop');
        removed = false;
        // listed in File Explorer and Settings > Apps
        await page.evaluate(() => Win.open('explorer', 'games'));
        check(await page.evaluate(() => [...document.querySelectorAll('.fx-name')].some((n) => n.textContent === 'Star Catcher')), 'File Explorer > Games lists the installed game');
        await page.evaluate(() => Win.open('settings', 'apps'));
        check(await page.evaluate(() => [...document.querySelectorAll('.set-row-name')].some((n) => n.textContent === 'Star Catcher')), 'Settings > Apps lists it');
        await page.evaluate(() => Win.close());
        // offline: the saved list is used
        firestoreUp = false;
        await page.reload();
        check(await page.waitForSelector(icon, { timeout: 8000 }).then(() => true, () => false), 'offline, the last list from Firebase is still shown');
        await page.focus(icon); await page.keyboard.press('Enter');
        await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'running', null, { timeout: 10000 });
        const f3 = page.frames().find((f) => f.url().indexOf(APP) === 0);
        check(await f3.evaluate(() => MyPC.app_config.speed) === 1, 'offline, the app opens with the last saved config');
        await f3.evaluate(() => MyPC.exit());
        await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'idle' && !!document.querySelector('#desk-icons .dicon') && document.activeElement !== document.body, null, { timeout: 6000 });
        // standalone: the example opened directly in a browser
        const sp = await page.context().newPage();
        await sp.route(OLD_HOSTED + 'sdk/mypc-sdk.js', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(ROOT, 'sdk/mypc-sdk.js')) }));
        await sp.goto(APP + 'index.html?app_config=' + encodeURIComponent('{"speed":5}'));
        await sp.waitForFunction(() => window.MyPC && MyPC.info() && MyPC.info().standalone);
        check(await sp.evaluate(() => MyPC.app_config.speed) === 5, 'standalone: MyPC.app_config comes from ?app_config= for testing');
        await sp.keyboard.press('Enter'); await sp.waitForTimeout(200);
        check(await sp.evaluate(() => document.getElementById('msg').textContent === ''), 'standalone (no My PC): the SDK reads the keyboard itself');
        await sp.close();
        // the shortcut menu (hold OK) of an installed app: Open, Remove from home screen, Uninstall (asks first)
        await page.focus(icon);
        await page.keyboard.down('Enter'); await page.waitForTimeout(800); await page.keyboard.up('Enter');
        check(await page.evaluate(() => Desktop.menuOpen() && GameHost.state() === 'idle' && [...document.querySelectorAll('#dmenu .dm-item')].map((b) => b.textContent).join('|') === 'Open|Remove from home screen|Uninstall'),
            'holding OK on an installed app shows Open, Remove from home screen and Uninstall');
        await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
        check(await page.evaluate(() => App.dialogOpen() && /Uninstall Star Catcher/.test(document.getElementById('dialog-title').textContent)), 'Uninstall asks first');
        await page.click('#dialog-yes');
        await page.waitForFunction((s) => !document.querySelector(s), icon, { timeout: 3000 }).catch(() => {});
        check(await page.evaluate((s) => !document.querySelector(s) && !Cloud.isInstalled('star-catcher') && document.activeElement.classList.contains('dicon'), icon), 'Uninstall from the shortcut menu removes the app from this TV');
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }

    console.log('17. installer: reading mypc-app.json');
    {
        const lib = require(path.join(ROOT, 'installer/installer-lib.js'));
        const l1 = lib.locate('someone.github.io/neon');
        check(l1.base === 'https://someone.github.io/neon/' && l1.manifest === 'https://someone.github.io/neon/mypc-app.json', 'an address without https or a slash is completed');
        check(lib.locate('https://a.github.io/x/index.html?y=1#z').base === 'https://a.github.io/x/', 'a page address points to its folder');
        let err = '';
        try { lib.locate('http://evil.example/'); } catch (e) { err = e.message; }
        check(/https/.test(err), 'plain http is refused');
        const ex = JSON.parse(fs.readFileSync(path.join(ROOT, 'sdk/example/mypc-app.json'), 'utf8'));
        const a = lib.toApp(ex, 'https://imad-os.github.io/g/sdk/example/', 3);
        check(a.id === 'star-catcher' && a.entry === 'https://imad-os.github.io/g/sdk/example/index.html' && a.icon === 'https://imad-os.github.io/g/sdk/example/icon.svg' && a.order === 3 && a.enabled && a.scores,
            'the example manifest becomes a valid app document');
        const cat = lib.catalog([{ name: 'g_a', has_pages: true }, { name: 'G_B' }, { name: 'x', has_pages: true }, { name: 'g_c', has_pages: false }], 'Imad-OS', 'g_');
        check(cat.length === 2 && cat[0].base === 'https://imad-os.github.io/g_a/' && cat[1].manifest === 'https://imad-os.github.io/G_B/mypc-app.json', 'catalog: g_ repos with Pages -> their app addresses');
        check(lib.status([{ id: 'a', url: 'u', version: '1', entry: 'e', name: 'n', icon: '' }], { id: 'a', url: 'u', version: '2', entry: 'e', name: 'n', icon: '' }) === 'update' &&
              lib.status([], { id: 'a' }) === 'new', 'status: new / update');
        check(JSON.stringify(a.config) === '{"speed":1}', 'the manifest\'s "config" becomes the app\'s default config');
        let cErr = [];
        for (const t of ['[1,2]', 'nope', '"text"', 'null', '{"big":"' + 'x'.repeat(9000) + '"}']) { try { lib.parseConfig(t); cErr.push('accepted ' + t.slice(0, 10)); } catch (e) { /* refused */ } }
        check(!cErr.length && JSON.stringify(lib.parseConfig('')) === '{}' && JSON.stringify(lib.parseConfig('{"a":[1,{"b":null}]}')) === '{"a":[1,{"b":null}]}', 'config text must be a JSON object under the size limit (empty = {}) ' + cErr.join(','));
        const bad = [{}, { mypc: 1, id: 'X!', name: 'a' }, { mypc: 1, id: 'ok-id', name: 'n', config: [1] }, { mypc: 1, id: 'ok-id' }, { mypc: 1, id: 'ok-id', name: 'n', type: 'video' }];
        check(bad.every((m) => { try { lib.toApp(m, 'https://a.b/'); return false; } catch (e) { return !!e.message; } }), 'invalid manifests are refused with a message');
    }

    console.log('18. installer page: catalog of the owner\'s g_ repositories');
    {
        const page = await newPage(browser, base);
        const GS = 'https://www.gstatic.com/firebasejs/12.0.0/';
        // stand-ins for the Firebase modules (signed in as an admin, in-memory Firestore)
        const FAKE = {
            'firebase-app.js': 'export function initializeApp() { return {}; }',
            'firebase-auth.js': `export function getAuth() { return {}; }
                export function onAuthStateChanged(a, cb) { setTimeout(() => cb({ uid: 'U1', email: 'owner@example.com' }), 0); }
                export class GoogleAuthProvider {}
                export function signInWithPopup() {} export function signInWithEmailAndPassword() {} export function createUserWithEmailAndPassword() {}
                export function signOut() {} export function sendPasswordResetEmail() {}`,
            'firebase-firestore.js': `const db = window.__db;
                export function getFirestore() { return {}; }
                export function collection(d, name) { return { name }; }
                export function doc(d, col, id) { return { col, id }; }
                export async function getDoc(r) { return { exists: () => !!(db[r.col] && db[r.col][r.id]), data: () => db[r.col][r.id] }; }
                export async function getDocs(c) {
                    let docs = Object.entries(db[c.name] || {}).map(([id, x]) => ({ id, data: () => x }));
                    for (const o of c.ops || []) {
                        if (o.w) docs = docs.filter((d) => d.data()[o.w] === o.v);
                        if (o.by) docs.sort((a, b) => (a.data()[o.by] < b.data()[o.by] ? -1 : 1) * (o.dir === 'desc' ? -1 : 1));
                        if (o.lim) docs = docs.slice(0, o.lim);
                    }
                    return { docs };
                }
                export function query(c, ...ops) { return { name: c.name, ops }; }
                export function where(w, op, v) { return { w, v }; }
                export function orderBy(by, dir) { return { by, dir }; }
                export function limit(lim) { return { lim }; }
                export async function setDoc(r, data) { (db[r.col] = db[r.col] || {})[r.id] = data; }
                export async function updateDoc(r, f) { Object.assign(db[r.col][r.id], f); }
                export async function deleteDoc(r) { delete db[r.col][r.id]; }
                export function serverTimestamp() { return 'now'; }`
        };
        await page.addInitScript(() => {
            const now = Date.now();
            window.__db = { admins: { U1: { name: 'owner' } },
                appstats: { 'old-game': { installs: 4, opens: 11 } },
                tvs: { 'tv-aaaabbbbccccddddeeeeffff0000': { tv: 'tv-aaaabbbbccccddddeeeeffff0000', model: 'QE55Q80D', version: '2.9.0', build: 17, lang: 'fr', src: 'duid',
                         firstSeen: now - 20 * 86400000, lastSeen: now - 3600000, profiles: 2, names: ['Ana', 'Sam'], installed: ['old-game'], top: { jumper: { n: 'Ana', s: 4321 } }, size: 2048,
                         blob: JSON.stringify({ arc_dev_installed: JSON.stringify([{ id: 'old-game', at: Date.UTC(2026, 8, 14, 12) }]),
                                                arc_profiles: JSON.stringify([{ id: 'p1', name: 'Ana', color: '#ffd23f' }, { id: 'p2', name: 'Sam', color: '#4cd97b' }]) }) },
                       'tv-1111222233334444555566667777': { tv: 'tv-1111222233334444555566667777', model: 'Browser', version: '2.8.0', build: 16, lang: 'en', src: 'random',
                         firstSeen: now - 90 * 86400000, lastSeen: now - 30 * 86400000, profiles: 1, names: ['Player 1'], installed: [], top: {}, blob: '{}', size: 512 } },
                records: { jumper: { list: [{ n: 'Ana', s: 4321, d: 1, tv: 'tv-a' }, { n: 'Leo', s: 999, d: 2, tv: 'tv-b' }], updatedAt: 1 } },
                errors: {
                    e1: { app: 'app-old-game', kind: 'load', msg: 'timeout: the SDK never answered in 20 s', n: 1, at: now - 3600000, tv: 'tv-aaaabbbbccccddddeeeeffff0000', model: 'QE55Q80D', ver: '2.19.0', build: 67, appv: '1.0.0', user: 'Ana', where: 'tv', stage: 'loading' },
                    e2: { app: 'app-old-game', kind: 'load', msg: 'timeout: the SDK never answered in 20 s', n: 2, at: now - 7200000, tv: 'tv-1111222233334444555566667777', model: 'Browser', ver: '2.18.0', build: 66, appv: '1.0.0', where: 'web' },
                    e3: { app: 'jumper', kind: 'error', msg: 'TypeError: x is undefined', src: 'games/jumper/js/game.js:10:5', stack: 'TypeError: x is undefined\n    at step (game.js:10:5)', n: 5, at: now - 60000, tv: 'tv-aaaabbbbccccddddeeeeffff0000', model: 'QE55Q80D', ver: '2.19.0', where: 'tv' },
                    e4: { app: 'jumper', kind: 'error', msg: 'old one', n: 1, at: now - 20 * 86400000, tv: 'tv-a', where: 'tv' } },
                apps: {
                'old-game': { id: 'old-game', name: 'Old Game', url: 'https://imad-os.github.io/g_oldgame/', entry: 'https://imad-os.github.io/g_oldgame/index.html', icon: '', type: 'game', version: '1.0.0', enabled: true, order: 0 } } };
        });
        await page.route(GS + '**', (r) => { const f = r.request().url().slice(GS.length); r.fulfill({ status: 200, contentType: 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: FAKE[f] || '' }); });
        await page.route('https://api.github.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify([
            { name: 'g_star', has_pages: true }, { name: 'g_oldgame', has_pages: true }, { name: 'g_broken', has_pages: true },
            { name: 'g_nopages', has_pages: false }, { name: 'speedy', has_pages: true }, { name: 'g_archived', has_pages: true, archived: true }]) }));
        const ex = JSON.parse(fs.readFileSync(path.join(ROOT, 'sdk/example/mypc-app.json'), 'utf8'));
        let starVersion = ex.version;
        await page.route('https://imad-os.github.io/**', (r) => {
            const u = r.request().url();
            const send = (o) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(o) });
            if (u.indexOf('/g_star/mypc-app.json') > 0) return send(Object.assign({}, ex, { version: starVersion }));
            if (u.indexOf('/g_oldgame/mypc-app.json') > 0) return send({ mypc: 1, id: 'old-game', name: 'Old Game', type: 'game', version: '1.0.0' });
            r.fulfill({ status: 404, body: '' });
        });
        await page.goto(base + 'installer/index.html#add');
        await page.waitForSelector('#catalog .app', { timeout: 8000 });
        const go = async (h) => { await page.evaluate((x) => { location.hash = x; }, h); await page.waitForTimeout(80); };
        const rows = await page.evaluate(() => [...document.querySelectorAll('#catalog .app')].map((r) => r.textContent));
        check(rows.length === 3 && !rows.some((t) => /speedy|nopages|archived/.test(t)), 'only g_ repositories with GitHub Pages are listed (' + rows.length + ')');
        check(rows.some((t) => /Star Catcher.*Not in store/.test(t)) && rows.some((t) => /Old Game.*In store/.test(t)) && rows.some((t) => /g_broken.*not a My PC app/.test(t)),
            'each app shows its status: not in the store, in the store, or not a My PC app');
        check(/App Store Manager/.test(await page.title()) && /App Store Manager/.test(await page.textContent('.brand')), 'the installer is now the App Store Manager');
        check(await page.evaluate(() => [...document.querySelectorAll('.nav a')].map((a) => a.textContent.replace(/\d+/g, '').trim()).join() === 'Overview,Apps,Add apps,AI services,Google Drive,Services,Widgets,Settings,Devices,World records,Errors,Stream lists'
            && document.querySelector('.nav a.on').dataset.page === 'add' && !document.querySelector('[data-view="add"]').hidden && document.querySelector('[data-view="overview"]').hidden),
            'a menu with one page each: Overview, Apps, Add apps, AI services, Google Drive, Services, Widgets, Settings, Devices, World records, Errors (+ the Stream lists link)');
        check(await page.evaluate(() => [...document.querySelectorAll('#catalog .app')].find((r) => /Old Game/.test(r.textContent)).querySelector('input').disabled), 'installed apps cannot be selected again');
        await page.check('#sel-all');
        await page.click('#btn-install-sel');
        await page.waitForFunction(() => window.__db.apps['star-catcher'], null, { timeout: 5000 }).catch(() => {});
        const db = await page.evaluate(() => window.__db.apps);
        check(db['star-catcher'] && db['star-catcher'].order === 1 && db['star-catcher'].url === 'https://imad-os.github.io/g_star/' && db['star-catcher'].installedBy === 'U1' && Object.keys(db).length === 2,
            '"Add selected to the store" publishes the new app only, after the ones already there');
        await page.waitForFunction(() => /Star Catcher.*In store/.test(document.getElementById('catalog').textContent) && !/Not in store/.test(document.getElementById('catalog').textContent));
        check(true, 'after adding, the catalog marks it in the store');
        // Overview: totals, most installed apps, recent TVs
        await go('#overview');
        const sum = await page.textContent('#tv-summary');
        check(/2\s*TVs with My PC/.test(sum) && /1\s*used in the last 7 days/.test(sum) && /4\s*installs/.test(sum) && /11\s*apps opened/.test(sum), 'Overview: TVs, active TVs, installs and opens (' + sum + ')');
        check(/Old Game\s*4/.test(await page.textContent('#top-apps')) && /QE55Q80D/.test(await page.textContent('#recent')), 'Overview: most installed apps and recently active TVs');
        // Devices: one row per TV, newest activity first; a TV's page lists its profiles and apps with install dates
        await go('#devices');
        const tvText = await page.evaluate(() => [...document.querySelectorAll('#tvs .tv')].map((r) => r.textContent));
        check(tvText.length === 2 && /QE55Q80D/.test(tvText[0]) && /Ana, Sam/.test(tvText[0]) && /Super Jumper: Ana 4321/.test(tvText[0]),
            'Devices lists each TV: model, profiles and best scores (newest first)');
        await page.click('#tvs .tv:has-text("QE55Q80D")');
        await page.waitForFunction(() => !document.querySelector('[data-view="device"]').hidden);
        const dev = await page.evaluate(() => ({ apps: document.getElementById('dd-apps').textContent, prof: document.getElementById('dd-profiles').textContent }));
        check(/Old Game/.test(dev.apps) && /2026/.test(dev.apps) && /Ana/.test(dev.prof) && /Sam/.test(dev.prof), 'a device page shows its profiles and its apps with the install date (' + dev.apps + ')');
        // Errors: one row per problem (same app + kind + message), newest first; a row opens every report with its device and stack
        await go('#errors');
        await page.waitForFunction(() => document.querySelectorAll('#er-groups tr[data-err]').length > 0, null, { timeout: 4000 }).catch(() => {});
        const eg = await page.evaluate(() => [...document.querySelectorAll('#er-groups tr[data-err]')].map((r) => r.textContent));
        check(eg.length === 2 && /x is undefined/.test(eg[0]) && /Super Jumper/.test(eg[0]) && /SDK never answered/.test(eg[1]) && /Old Game/.test(eg[1]) && /could not open/.test(eg[1]) && /Old Game\s*3\s*2/.test(eg[1]),
            'Errors groups the reports of the last 7 days by problem: the same timeout on 2 TVs is one row (3 times, 2 TVs); a 20-day-old one is not shown (' + eg.join(' | ') + ')');
        await page.click('#er-groups tr[data-err]:has-text("x is undefined")');
        const det = await page.textContent('#er-occ');
        check(/QE55Q80D/.test(det) && /game\.js:10:5/.test(det) && /at step/.test(det) && /5 times/.test(det) && /2\.19\.0/.test(det), 'a problem shows each report: time, device, My PC version, place, count and stack');
        await page.selectOption('#er-when', '30');
        check(await page.evaluate(() => document.querySelectorAll('#er-groups tr[data-err]').length) === 3, 'the period filter shows older reports (30 days)');
        await go('#app/old-game');
        check(await page.getAttribute('#ad-errors', 'href') === '#errors/app-old-game', 'an app page links to its errors');
        await go('#errors/app-old-game');
        await page.waitForFunction(() => document.querySelectorAll('#er-groups tr[data-err]').length === 1 && document.getElementById('er-app').value === 'app-old-game', null, { timeout: 4000 }).catch(() => {});
        check(await page.evaluate(() => document.querySelectorAll('#er-groups tr[data-err]').length === 1 && document.getElementById('er-app').value === 'app-old-game'), 'Errors for one app: only its reports, the app chosen in the filter');
        page.once('dialog', (d) => d.accept());
        await page.click('#er-groups tr[data-err]');
        await page.click('#er-del');
        await page.waitForFunction(() => !window.__db.errors.e1 && !window.__db.errors.e2, null, { timeout: 4000 }).catch(() => {});
        check(await page.evaluate(() => !window.__db.errors.e1 && !window.__db.errors.e2 && !!window.__db.errors.e3), 'Delete these reports removes that problem\'s reports only');
        await go('#records');
        check(/Super Jumper.*Ana – 4321.*Leo – 999/.test(await page.textContent('#records')), 'World records are listed per game');
        // Apps: counters per app; an app's page lists the devices that installed it
        await go('#apps');
        check(/4 installs · 11 opens · on 1 device/.test(await page.textContent('#list')), 'each app in the store shows its installs, opens and devices');
        await page.click('#list .app:has-text("Old Game") a.name');
        await page.waitForFunction(() => !document.querySelector('[data-view="app"]').hidden);
        const devRows = await page.evaluate(() => [...document.querySelectorAll('#app-devices tr')].map((r) => r.textContent));
        check(devRows.length === 1 && /QE55Q80D/.test(devRows[0]) && /2026/.test(devRows[0]) && /Ana/.test(devRows[0]) && /Sam/.test(devRows[0]),
            'an app\'s page lists the devices that installed it, with the date and their profiles (' + devRows.join(' | ') + ')');
        await go('#apps');
        check(JSON.stringify(db['star-catcher'].config) === '{"speed":1}', 'a new app starts with the default config from its manifest');
        // the config editor
        const row = (name) => '#list .app:has-text("' + name + '")';
        await page.click(row('Old Game') + ' button.cfg');
        check(await page.evaluate(() => !document.getElementById('cfg-modal').hidden) && /Old Game/.test(await page.textContent('#cfg-title')), 'the Config button opens the editor for that app');
        await page.fill('#cfg-text', '{ "speed": 2, ');
        await page.click('#cfg-save');
        check(/Not valid JSON/.test(await page.textContent('#cfg-msg')) && await page.evaluate(() => window.__db.apps['old-game'].config === undefined && !document.getElementById('cfg-modal').hidden), 'invalid JSON is refused with a message and nothing is saved');
        await page.fill('#cfg-text', '[1, 2]');
        await page.click('#cfg-save');
        check(/JSON object/.test(await page.textContent('#cfg-msg')), 'a config that is not an object is refused');
        await page.fill('#cfg-text', '{ "speed": 2, "levels": [1, 2], "nested": { "on": true } }');
        await page.click('#cfg-save');
        await page.waitForFunction(() => document.getElementById('cfg-modal').hidden);
        check(await page.evaluate(() => JSON.stringify(window.__db.apps['old-game'].config)) === '{"speed":2,"levels":[1,2],"nested":{"on":true}}', 'Save writes the config object into the app\'s document');
        check(/3 settings/.test(await page.textContent(row('Old Game'))), 'the app row shows how many settings it has');
        await page.click(row('Old Game') + ' button.cfg');
        check(JSON.parse(await page.inputValue('#cfg-text')).nested.on === true, 'the editor shows the saved config again');
        await page.keyboard.press('Escape');
        // an update keeps the config the owner set (the app's default does not overwrite it)
        await page.click(row('Star Catcher') + ' button.cfg');
        await page.fill('#cfg-text', '{ "speed": 9 }'); await page.click('#cfg-save');
        await page.waitForFunction(() => window.__db.apps['star-catcher'].config.speed === 9);
        starVersion = '1.0.1';
        await page.evaluate(() => { window.__db['subs/star-catcher/users'] = { sara: { at: 1, app: 'star-catcher' } }; });
        await go('#add');
        await page.click('#btn-scan');
        await page.waitForFunction(() => /Update available/.test(document.getElementById('catalog').textContent));
        await page.click('#catalog .app:has-text("Star Catcher") button.act');
        await page.waitForFunction(() => window.__db.apps['star-catcher'].version === '1.0.1');
        const upd = await page.evaluate(() => window.__db.apps['star-catcher']);
        check(upd.config.speed === 9 && upd.order === 1, 'updating an app keeps its config and its position');
        await page.waitForFunction(() => Object.keys(window.__db['inbox/sara/items'] || {}).length === 1, null, { timeout: 4000 }).catch(() => {});
        const upn = await page.evaluate(() => Object.values(window.__db['inbox/sara/items'] || {}));
        check(upn.length === 1 && upn[0].title === 'Star Catcher was updated' && /1\.0\.1/.test(upn[0].text) && upn[0].app === 'star-catcher' && upn[0].link === 'app',
            'App updates (built in): a new version notifies the players who allowed the app (' + JSON.stringify(upn) + ')');
        check(await page.evaluate(() => !!document.getElementById('url') && !!document.getElementById('btn-fetch')), 'the manual address section is still there for apps outside imad-os');
        // AI services: set once here for every My PC (Firestore settings/ai)
        await go('#ai');
        check(/No AI service yet/.test(await page.textContent('#ai-list')) && await page.evaluate(() => document.getElementById('ai-save').disabled), 'AI services: empty at first, nothing to save');
        await page.selectOption('#ai-preset', 'nvidia'); await page.click('#ai-add');
        await page.selectOption('#ai-preset', 'gemini'); await page.click('#ai-add');
        check(await page.evaluate(() => document.activeElement.id === 'ai-1-key' && document.getElementById('ai-0-speechUrl').value === '877104f7-e885-42b9-8de8-f6e4c6303969' && !document.getElementById('ai-1-speechUrl')),
            'adding a service puts the cursor in its API key; NVIDIA shows its Magpie function, already filled in');
        await page.fill('#ai-0-key', 'nvapi-xyz'); await page.fill('#ai-1-key', 'GK'); await page.fill('#ai-0-model', 'meta/llama-3.1-8b-instruct');
        check(await page.getAttribute('#ai-0-key', 'type') === 'password', 'keys are hidden while typed');
        await page.click('#ai-list button[data-def="1"]');
        await page.click('#ai-save');
        await page.waitForFunction(() => window.__db.settings && window.__db.settings.ai);
        const sa = await page.evaluate(() => window.__db.settings.ai);
        check(sa.list.length === 2 && sa.list[0].id === 'nvidia' && sa.list[0].key === 'nvapi-xyz' && sa.list[0].model === 'meta/llama-3.1-8b-instruct' && sa.list[0].speechUrl && sa.list[1].preset === 'gemini' &&
            sa.def === 'gemini' && sa.updatedBy === 'owner@example.com' && /Saved/.test(await page.textContent('#ai-msg')), 'Save writes the services, their keys and the default into settings/ai');
        page.once('dialog', (d) => d.accept());
        await page.click('#ai-list button[data-del="0"]'); await page.click('#ai-save');
        await page.waitForFunction(() => window.__db.settings.ai.list.length === 1);
        check(await page.evaluate(() => window.__db.settings.ai.def === 'gemini'), 'Remove (after a question) takes a service out for every My PC');
        // Settings of every My PC (Firestore settings/mypc): backgrounds
        await page.route('https://pics.example/**', (r) => r.fulfill({ status: 404, body: '' }));
        await go('#settings');
        check(await page.evaluate(() => !document.querySelector('[data-view="settings"]').hidden && document.querySelector('.nav a.on').dataset.page === 'settings' &&
            /No background added yet/.test(document.getElementById('gs-wps').textContent) && document.getElementById('gs-save').disabled), 'Settings: a page of its own, no background yet, nothing to save');
        await page.click('#gs-add');
        check(await page.evaluate(() => document.activeElement.id === 'gs-0-url'), 'Add background puts the cursor in its address');
        await page.fill('#gs-0-url', 'https://pics.example/walls/blue-lake_at-night.jpg?w=1920');
        check(await page.getAttribute('#gs-0-title', 'placeholder') === 'Blue lake at night', 'an empty title shows the one taken from the address');
        await page.click('#gs-add');
        await page.fill('#gs-1-url', 'https://pics.example/dunes.png'); await page.fill('#gs-1-title', 'Golden dunes'); await page.fill('#gs-1-thumb', 'https://pics.example/dunes-small.png');
        await page.click('#gs-add');
        await page.fill('#gs-2-url', 'http://pics.example/x.jpg');
        await page.click('#gs-save');
        check(/https/.test(await page.textContent('#gs-msg')) && !(await page.evaluate(() => window.__db.settings.mypc)), 'an address that is not https:// is refused before saving');
        page.once('dialog', (d) => d.accept());
        await page.click('.wp-row[data-i="2"] button[data-del]');
        await page.selectOption('#gs-default', 'u:https://pics.example/dunes.png');
        await page.click('.wp-row[data-i="1"] button[data-mv="-1"]');
        await page.fill('#gs-fast', 'Imad12, bad name!');
        await page.click('#gs-save');
        check(/Not a username: name!/.test(await page.textContent('#gs-msg')) && !(await page.evaluate(() => window.__db.settings.mypc)), 'Fast push notifications: a wrong username is refused before saving');
        await page.fill('#gs-fast', 'Imad12\nsara.k, imad12');
        await page.click('#gs-save');
        await page.waitForFunction(() => window.__db.settings.mypc);
        const gm = await page.evaluate(() => window.__db.settings.mypc);
        check(gm.wallpapers.length === 2 && gm.wallpapers[0].title === 'Golden dunes' && gm.wallpapers[0].thumb === 'https://pics.example/dunes-small.png' &&
            gm.wallpapers[1].title === 'Blue lake at night' && gm.wallpaper === 'u:https://pics.example/dunes.png' && gm.updatedBy === 'owner@example.com' && /Saved/.test(await page.textContent('#gs-msg')),
            'Save writes the backgrounds in their order (empty titles filled from the address) and the one of new profiles into settings/mypc');
        check(JSON.stringify(gm.notifyFast) === '["imad12","sara.k"]' && /2 \/ 200/.test(await page.textContent('#gs-fast-count')), 'and the accounts with fast push notifications (lower case, once each): ' + JSON.stringify(gm.notifyFast));
        // Send a test notification: a form with default values, written into that account's inbox
        await page.click('#nt-open');
        const ntv = await page.evaluate(() => ['to', 't', 'm', 'i', 'l'].map((k) => document.getElementById('nt-' + k).value));
        check(!(await page.evaluate(() => document.getElementById('nt-modal').hidden)) && ntv[0] === 'imad12' && ntv[1] === 'Test notification' && /^https:\/\//.test(ntv[3]) && /^https:\/\//.test(ntv[4]),
            'Send a test notification opens a form filled with default values, to the first fast account: ' + JSON.stringify(ntv));
        await page.fill('#nt-to', 'no!'); await page.click('#nt-send');
        check(/username/.test(await page.textContent('#nt-msg')), 'a wrong username is refused');
        await page.fill('#nt-to', 'Tester'); await page.fill('#nt-i', 'http://x.com/a.png'); await page.click('#nt-send');
        check(/https/.test(await page.textContent('#nt-msg')) && !(await page.evaluate(() => window.__db['inbox/tester/items'])), 'a picture that is not https is refused');
        await page.fill('#nt-i', ''); await page.fill('#nt-t', 'Hello TV'); await page.click('#nt-send');
        await page.waitForFunction(() => window.__db['inbox/tester/items'], null, { timeout: 4000 }).catch(() => {});
        const ntd = await page.evaluate(() => Object.values(window.__db['inbox/tester/items'] || {}));
        check(ntd.length === 1 && ntd[0].title === 'Hello TV' && ntd[0].app === 'mypc' && ntd[0].name === 'My PC' && /App Store Manager/.test(ntd[0].text) && !ntd[0].image && /^https:/.test(ntd[0].link) && /Sent to tester/.test(await page.textContent('#nt-msg')),
            'Send writes it into inbox/<username>/items like a service would: ' + JSON.stringify(ntd));
        await page.click('#nt-cancel');
        // Services: push notification services of the store apps (installer/services.js)
        let svcCode = "export default async function (ctx) { return { notifications: [{ username: '*', title: 'Goal! Raja', message: 'origin ' + self.origin + ' ' + (() => { try { indexedDB.open('x'); return 'idb-open'; } catch (e) { return 'idb-blocked'; } })() + ' ' + (ctx.state ? ctx.state.n : 0), link: 'app?match=7' }, { username: 'stranger', title: 'No' }], state: { n: ((ctx.state && ctx.state.n) || 0) + 1 } }; }";
        await page.route('https://imad-os.github.io/g_soccer/services/notify.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: svcCode }));
        await page.evaluate(() => {
            window.__db.apps.soccer = { id: 'soccer', name: 'Soccer Live', url: 'https://imad-os.github.io/g_soccer/', entry: 'https://imad-os.github.io/g_soccer/index.html', icon: '', type: 'app', version: '1.0.0', enabled: true, order: 5,
                services: [{ id: 'goals', file: 'https://imad-os.github.io/g_soccer/services/notify.js', every: 5, title: 'Goal alerts' }] };
            window.__db['subs/soccer/users'] = { imad12: { at: 1, app: 'soccer' }, 'sara.k': { at: 2, app: 'soccer' } };
        });
        await page.evaluate(() => document.getElementById('btn-reload').click());
        await go('#services');
        await page.waitForFunction(() => /Soccer Live/.test(document.getElementById('sv-list').textContent), null, { timeout: 5000 });
        const svRow = 'tr[data-k="soccer__goals"]';
        check(/Goal alerts/.test(await page.textContent(svRow)) && /Waiting for approval/.test(await page.textContent(svRow)) && /\b2\b/.test(await page.textContent(svRow + ' td.num')) &&
            await page.evaluate(() => document.querySelector('tr[data-k="soccer__goals"] button[data-act="now"]').disabled) && /App updates/.test(await page.textContent('#sv-list')),
            'Services lists an app\'s service waiting for approval, how many players allowed the app, and the built-in App updates');
        const svHidden = await page.evaluate(() => ({ others: Object.keys(window.__db.apps).filter((id) => id !== 'soccer' && !(window.__db.apps[id].services || []).length),
            rows: [...document.querySelectorAll('#sv-list tr')].map((tr) => tr.dataset.k) }));
        check(svHidden.others.length > 0 && svHidden.rows.length === 2 && svHidden.rows.every((k) => k.startsWith('soccer__')),
            'Services hides the apps with no service of their own, like Widgets (' + svHidden.others.join() + ' hidden; rows ' + svHidden.rows.join() + ')');
        if (process.env.MYPC_SHOTS) await page.screenshot({ path: path.join(process.env.MYPC_SHOTS, 'manager-services.png') });
        check(/Services run in this tab/.test(await page.textContent('#sv-runner')) && await page.evaluate(() => !!window.__db.services._runner), 'this tab holds the runner lease');
        await page.click(svRow + ' button[data-act="review"]');
        await page.waitForFunction(() => !document.getElementById('sv-modal').hidden);
        check(/Goal! Raja/.test(await page.textContent('#sv-mbody')) && /SHA-256 [0-9a-f]{64}/.test(await page.textContent('#sv-mbody')), 'Review shows the code and its SHA-256 before approval');
        await page.click('#sv-approve');
        await page.waitForFunction(() => window.__db.services.soccer__goals && window.__db.services.soccer__goals.hash);
        await page.waitForFunction(() => document.querySelector('tr[data-k="soccer__goals"] .tag').textContent === 'On', null, { timeout: 3000 }).catch(() => {});
        check(await page.evaluate(() => window.__db.services.soccer__goals.enabled === true && window.__db.services.soccer__goals.every === 5) && await page.textContent(svRow + ' .tag') === 'On', 'Approve turns it on, every 5 minutes');
        await page.click(svRow + ' button[data-act="test"]');
        await page.waitForFunction(() => /would be sent/.test(document.getElementById('sv-mbody').textContent), null, { timeout: 8000 });
        const tb = await page.textContent('#sv-mbody');
        check(/2 notification\(s\) would be sent, 1 dropped/.test(tb) && /Nothing was sent/.test(tb) && /did not allow/.test(tb) && !(await page.evaluate(() => window.__db['inbox/imad12/items'])),
            'Test runs it and shows the rows (the user who did not allow the app is dropped), nothing is sent: ' + tb.slice(0, 160));
        await page.click('#sv-close');
        await page.click(svRow + ' button[data-act="now"]');
        await page.waitForFunction(() => window.__db['inbox/imad12/items'] && window.__db.services.soccer__goals.lastRun, null, { timeout: 8000 });
        const inb = await page.evaluate(() => ({ a: Object.values(window.__db['inbox/imad12/items']), b: Object.values(window.__db['inbox/sara.k/items'] || {}), s: window.__db['inbox/stranger/items'], d: window.__db.services.soccer__goals }));
        check(inb.a.length === 1 && inb.b.length === 1 && !inb.s && inb.a[0].title === 'Goal! Raja' && inb.a[0].name === 'Soccer Live' && inb.a[0].link === 'app?match=7' && inb.a[0].exp instanceof Object,
            'Run now writes one inbox item per opted-in player, none for the others');
        check(/^origin null idb-blocked 0$/.test(inb.a[0].text), 'the service runs in an opaque origin with no access to the page\'s storage (' + inb.a[0].text + ')');
        check(inb.d.lastSent === 2 && inb.d.lastDropped === 1 && inb.d.state === '{"n":1}' && inb.d.log.length === 1 && /2 sent, 1 dropped/.test(await page.textContent(svRow)), 'the run is logged and its state saved for the next run');
        await page.evaluate(() => { window.__db.services.soccer__goals.lastRun = Date.now() - 6 * 60000; });
        await page.evaluate(() => { location.hash = '#services'; });
        svcCode = svcCode.replace('Goal! Raja', 'Changed');
        await page.click(svRow + ' button[data-act="now"]');
        await page.waitForFunction(() => /approve the new code/.test(document.querySelector('tr[data-k="soccer__goals"]').textContent), null, { timeout: 8000 });
        check(/Code changed: approve again/.test(await page.textContent(svRow)) && await page.evaluate(() => Object.keys(window.__db['inbox/imad12/items']).length === 1),
            'a changed file is not run: it waits for a new approval');
        // phone sized: a top bar with the tabs, nothing wider than the screen
        await page.setViewportSize({ width: 390, height: 844 });
        let wide = [];
        for (const h of ['#overview', '#apps', '#add', '#ai', '#services', '#settings', '#devices', '#records', '#errors']) {
            await go(h);
            if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) wide.push(h);
        }
        check(wide.length === 0 && await page.evaluate(() => { const r = document.querySelector('.nav').getBoundingClientRect(); return r.top < 140 && r.width >= 380; }),
            'on a phone every page fits the screen width and the tabs are a row at the top (' + wide.join() + ')');
        await page.setViewportSize({ width: 1280, height: 800 });
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }

    console.log('19. smart startup: slow server -> last known online build');
    {
        const full = JSON.parse(fs.readFileSync(path.join(ROOT, 'app-manifest.json'), 'utf8'));
        const seed = (page, build) => page.addInitScript(([m, hosted, b]) => {
            try { if (!localStorage.getItem('__seeded')) { localStorage.setItem('boot_good', JSON.stringify({ manifest: Object.assign({}, m, { build: b }), base: hosted, at: Date.now() })); localStorage.setItem('__seeded', '1'); } } catch (e) {}
        }, [full, HOSTED, build]);
        // 1) the server does not answer the manifest, but the last online build is known and its files load
        let page = await newPage(browser, base);
        await seed(page, NEXT);
        await routeHosted(page, { breakFile: 'app-manifest.json' });
        await page.goto(base + 'index.html');
        await page.waitForFunction(() => window.AppBoot && window.Desktop && document.querySelector('.dicon'), null, { timeout: 20000 });
        check(await page.evaluate((n) => AppBoot.source() === 'remote' && AppBoot.build() === n && AppBoot.reason() === 'stale' && AppBoot.stale(), NEXT), 'slow server: the last known online build runs instead of the older built-in copy');
        check(await playable(page), 'a game is playable from it');
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
        // 1b) a build saved by a package that still used the old github.io address counts too
        page = await newPage(browser, base);
        await page.addInitScript(([m, hosted, b]) => { try { if (!localStorage.getItem('__seeded')) { localStorage.setItem('boot_good', JSON.stringify({ manifest: Object.assign({}, m, { build: b }), base: hosted, at: Date.now() })); localStorage.setItem('__seeded', '1'); } } catch (e) {} }, [full, OLD_HOSTED, NEXT]);
        await routeHosted(page, { breakFile: 'app-manifest.json' });
        await page.goto(base + 'index.html');
        await page.waitForFunction(() => window.AppBoot && window.Desktop && document.querySelector('.dicon'), null, { timeout: 20000 });
        check(await page.evaluate((n) => AppBoot.source() === 'remote' && AppBoot.build() === n && AppBoot.reason() === 'stale' && AppBoot.base() === 'https://pc.geekspro.us/', NEXT), 'a last online build saved under the old address runs from pc.geekspro.us');
        await page.context().close();
        // 2) the network is really down: built-in copy, and the last known build is not blamed
        page = await newPage(browser, base);
        await seed(page, NEXT);
        await routeHosted(page, { offline: true });
        await page.goto(base + 'index.html');
        await page.waitForFunction(() => window.AppBoot && AppBoot.source() === 'local' && document.querySelector('.dicon'), null, { timeout: 20000 });
        check(await page.evaluate(() => localStorage.getItem('boot_bad_build') === null && Number(localStorage.getItem('boot_stale_fail')) > 0 && AppBoot.reason() === 'forced'), 'offline: the built-in copy runs and the last known build is not marked bad');
        await page.reload();
        await page.waitForSelector('.dicon', { timeout: 15000 });
        check(await page.evaluate(() => AppBoot.source() === 'local' && AppBoot.reason() === 'unreachable'), 'the shortcut rests for a while after a failure (no slow start every time)');
        await page.context().close();
        // 3) a hosted build that reaches ready is remembered
        page = await newPage(browser, base);
        await routeHosted(page, { manifest: { build: NEXT } });
        await page.goto(base + 'index.html');
        await page.waitForFunction(() => window.AppBoot && AppBoot.source() === 'remote' && document.querySelector('.dicon'), null, { timeout: 15000 });
        await page.waitForFunction(() => localStorage.getItem('boot_good'), null, { timeout: 8000 }).catch(() => {});
        check(await page.evaluate(([h, b]) => { const g = JSON.parse(localStorage.getItem('boot_good')) || { manifest: {} }; return g.manifest.build === b && g.base === h && AppBoot.reason() === 'update'; }, [HOSTED, NEXT]), 'a hosted build that started fine is saved as the last known good one');
        await page.context().close();
    }

    console.log('20. Settings > Update');
    {
        const key = async (page, ...ks) => { for (const k of ks) { await page.keyboard.press(k); await page.waitForTimeout(50); } };
        const status = (page) => page.evaluate(() => (document.querySelector('.set-status .set-card-name') || {}).textContent || '');
        // up to date -> a newer build appears -> check, download with progress, restart into it
        let page = await newPage(browser, base);
        const over = {};
        await routeHosted(page, { manifest: over });
        await page.goto(base + 'index.html');
        await page.waitForSelector('.dicon', { timeout: 15000 });
        check(await page.evaluate(() => AppBoot.source()) === 'local' && await page.evaluate(() => typeof AppBoot.reason === 'function'), 'the built-in copy of the same build runs, with the smart loader');
        await page.evaluate(() => Win.open('settings', 'update'));
        await page.waitForFunction(() => /up to date/.test((document.querySelector('.set-status .set-card-name') || {}).textContent || ''), null, { timeout: 8000 });
        check(true, 'opening the page checks by itself: "' + await status(page) + '"');
        check(await page.evaluate(() => !/Never/.test(document.querySelector('.set-main').textContent) && /Built-in copy/.test(document.querySelector('.set-main').textContent)), 'it shows the last check and where the app runs from');
        over.build = NEXT; over.version = '9.9.0';
        await key(page, 'ArrowRight', 'Enter');                                       // Check for updates
        await page.waitForFunction(() => /available/.test((document.querySelector('.set-status .set-card-name') || {}).textContent || ''), null, { timeout: 8000 });
        check(new RegExp('9\\.9\\.0.*' + NEXT).test(await page.textContent('.set-status')), 'a newer build is found: ' + (await page.textContent('.set-status')));
        check(await page.evaluate(() => document.activeElement.classList.contains('set-primary')), 'the focus is on "Download and restart"');
        await key(page, 'Enter');
        await page.waitForFunction(() => Updater.state().state === 'ready', null, { timeout: 15000 });
        check(await page.evaluate(([h, n]) => { const g = JSON.parse(localStorage.getItem('boot_good')); const u = Updater.state(); return g.manifest.build === n && g.base === h && u.done === u.total && u.total > 20; }, [HOSTED, NEXT]), 'every file was downloaded and the build is saved as the one to start');
        check(/ready/.test(await status(page)), 'the page says it is ready: "' + await status(page) + '"');
        await key(page, 'Enter');                                                      // Restart now
        await page.waitForFunction((n) => window.AppBoot && AppBoot.build && AppBoot.build() === n && document.querySelector('.dicon'), NEXT, { timeout: 20000 });
        check(await page.evaluate(() => AppBoot.source() === 'remote' && AppBoot.reason() === 'update'), 'after the restart the new build runs');
        await page.context().close();
        // a build whose files cannot all be downloaded is not saved
        page = await newPage(browser, base);
        await routeHosted(page, { manifest: { build: NEXT }, breakFile: 'js/launcher/main.js' });
        await page.goto(base + 'index.html');
        await page.waitForFunction(() => window.AppBoot && AppBoot.source() === 'local' && document.querySelector('.dicon'), null, { timeout: 20000 });
        await page.evaluate(() => Win.open('settings', 'update'));
        await page.waitForFunction(() => /available/.test((document.querySelector('.set-status .set-card-name') || {}).textContent || ''), null, { timeout: 8000 });
        await key(page, 'ArrowRight', 'Enter');                                        // into the page, then "Download and restart"
        await page.waitForFunction(() => Updater.state().state === 'error', null, { timeout: 20000 });
        check(/did not finish/.test(await status(page)) && await page.evaluate(() => localStorage.getItem('boot_good') === null), 'a failed download changes nothing and is not saved');
        check(await page.evaluate(() => document.activeElement.classList.contains('set-primary')), 'it offers to try again');
        await page.context().close();
        // the server does not answer: a clear message, and the reason of the last start
        page = await newPage(browser, base);
        await routeHosted(page, { breakFile: 'app-manifest.json' });
        await page.goto(base + 'index.html');
        await page.waitForSelector('.dicon', { timeout: 15000 });
        await page.evaluate(() => Win.open('settings', 'update'));
        await page.waitForFunction(() => /Couldn't check/.test((document.querySelector('.set-status .set-card-name') || {}).textContent || ''), null, { timeout: 8000 });
        check(/did not answer when the app started/.test(await page.textContent('.set-main')), 'it explains why the built-in copy ran at the last start');
        await page.context().close();
        // a build for another shell cannot be installed from here
        page = await newPage(browser, base);
        await routeHosted(page, { manifest: { build: NEXT, shell: 2 } });
        await page.goto(base + 'index.html');
        await page.waitForSelector('.dicon', { timeout: 15000 });
        await page.evaluate(() => Win.open('settings', 'update'));
        await page.waitForFunction(() => /Samsung store/.test((document.querySelector('.set-status .set-card-name') || {}).textContent || ''), null, { timeout: 8000 });
        check(true, 'a build that needs a new package says so');
        await page.context().close();
    }

    console.log('21. Browser: never stuck, remote / keyboard / mouse / gamepad');
    {
        const SITE = 'https://web.example.test/';
        const page = await newPage(browser, base);
        await page.addInitScript(() => {
            window.__keys = [];
            window.tizen.tvinputdevice.registerKeyBatch = (k) => window.__keys.push(...k);
            const mk = (i) => { const b = []; for (let k = 0; k < 17; k++) b.push({ pressed: false, value: 0 }); return { index: i, id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 02fd)', connected: true, mapping: 'standard', buttons: b, axes: [0, 0, 0, 0] }; };
            window.__pads = [];
            navigator.getGamepads = () => window.__pads;
            window.__plug = () => { window.__pads = [mk(0)]; window.dispatchEvent(new Event('gamepadconnected')); };
            window.__pad = (b, on) => { window.__pads[0].buttons[b].pressed = on; window.__pads[0].buttons[b].value = on ? 1 : 0; };
        });
        await routeHosted(page, { offline: true });
        // a web app that keeps grabbing the keyboard and is much taller than the screen
        await page.route(SITE + '**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body:
            '<!doctype html><title>Fake web app</title><body style="margin:0"><input id="i" autofocus><div style="height:6000px;background:linear-gradient(#fff,#08f)">tall page</div>' +
            '<script>setInterval(function(){document.getElementById("i").focus();},300)<\/script>' }));
        await page.goto(base + 'index.html');
        await page.waitForSelector('.dicon', { timeout: 15000 });
        check(await page.evaluate(() => ['ChannelUp', 'ChannelDown', 'Guide'].every((k) => window.__keys.indexOf(k) >= 0)), 'the TV keys Channel Up, Channel Down and Guide are registered');
        const key = async (...ks) => { for (const k of ks) { await page.keyboard.press(k); await page.waitForTimeout(60); } };
        const remoteKey = (code) => page.evaluate((c) => { for (const type of ['keydown', 'keyup']) { const e = new KeyboardEvent(type, { bubbles: true }); Object.defineProperty(e, 'keyCode', { get: () => c }); document.dispatchEvent(e); } }, code);
        const scrollY = () => page.evaluate(() => { const m = /translateY\((-?[\d.]+)px\)/.exec(document.querySelector('.br-frame').style.transform || ''); return m ? -parseFloat(m[1]) : 0; });
        const pad = async (b) => { await page.evaluate((x) => window.__pad(x, true), b); await page.waitForTimeout(120); await page.evaluate((x) => window.__pad(x, false), b); await page.waitForTimeout(120); };
        const where = () => page.evaluate(() => { const a = document.activeElement; return a === document.body ? 'body' : a.tagName === 'IFRAME' ? 'page' : a.closest('.br-bar') ? 'toolbar' : a.classList.contains('br-view') ? 'view' : 'other'; });
        await page.evaluate(() => Win.open('browser'));
        await key('Enter');
        await page.keyboard.type('web.example.test');
        await page.evaluate(() => [...document.querySelectorAll('#namer-keys button')].pop().click());
        await page.waitForTimeout(900);                                      // the page runs its focus grabbing
        check(await page.evaluate(() => Store.get('br_native', null) === null && document.querySelector('.br-frame').style.pointerEvents === 'none'), 'remote mode by default: the page ignores the pointer, so a click can not trap the keyboard');
        // a page script (or anything) that takes the keyboard away from My PC loses it again
        await page.evaluate(() => document.querySelector('.br-frame').focus());
        await page.waitForTimeout(150);
        check(await where() === 'view', 'a page that grabs the keyboard does not keep it (My PC takes it back)');
        // scrolling from the outside: arrows, Channel Up / Down, PageUp / PageDown, gamepad LB / RB, the mouse wheel
        await key('ArrowDown');
        check(await scrollY() === 300, 'Down scrolls the page');
        await remoteKey(428);
        const afterCh = await scrollY();
        check(afterCh > 800, 'Channel Down scrolls a page (' + afterCh + ' px)');
        await remoteKey(427);
        check(await scrollY() === 300, 'Channel Up scrolls a page back');
        await key('PageDown');
        check(await scrollY() > 800, 'PageDown on a keyboard scrolls a page');
        await key('PageUp');
        await page.evaluate(() => window.__plug());
        await page.waitForTimeout(300);
        await pad(5);
        check(await scrollY() > 800, 'RB on a gamepad scrolls a page');
        await pad(4);
        await page.mouse.move(640, 400);
        await page.mouse.move(650, 410);
        await page.mouse.wheel(0, 200);
        await page.waitForTimeout(200);
        check(await scrollY() === 600, 'the mouse wheel scrolls the page (' + await scrollY() + ' px)');
        // from far down the page, Guide reaches the buttons on top (no need to scroll back up)
        await key('F6');
        check(await where() === 'toolbar', 'F6 (the Guide key) moves to the browser buttons from deep inside a page');
        await key('F6');
        check(await where() === 'view', 'Guide again goes back to the page');
        // the remote's Guide key is a shortcut by default (switch user); without one it does what F6 does
        await page.evaluate(() => { while (Shortcuts.list().length) Shortcuts.remove(0); });
        await remoteKey(458);
        check(await where() === 'toolbar', 'the TV remote Guide key (458) does the same when this profile has no Guide shortcut');
        await key('ArrowRight');
        check(await where() === 'toolbar', 'the arrows move along the buttons');
        await page.evaluate(() => Win.close());
        // mouse mode: the page is a normal frame; a click may keep the keyboard; Guide on a gamepad still gets out
        await page.evaluate(() => Store.set('br_native', true));
        await page.evaluate(() => Win.open('browser'));
        await key('Enter');
        await page.keyboard.type('web.example.test');
        await page.evaluate(() => [...document.querySelectorAll('#namer-keys button')].pop().click());
        await page.waitForTimeout(700);
        check(await page.evaluate(() => { const f = document.querySelector('.br-frame'), v = document.querySelector('.br-view'); return f.style.pointerEvents === '' && f.offsetHeight === v.offsetHeight && /Switch to remote mode/.test(document.querySelector('.br-bar [aria-label^="Switch"]').getAttribute('aria-label')); }),
            'mouse mode: the page is as tall as the window and takes the pointer; the toolbar offers remote mode');
        await page.mouse.click(640, 400);
        await page.waitForTimeout(250);
        check(await where() === 'page', 'a click gives the page the keyboard (and My PC does not take it away)');
        await pad(16);                                                       // Guide button on a gamepad
        check(await where() === 'toolbar', 'Guide on a gamepad gets out of the page');
        await page.evaluate(() => document.querySelector('.br-bar [aria-label^="Switch"]').click());
        check(await page.evaluate(() => Store.get('br_native') === false && document.querySelector('.br-frame').style.pointerEvents === 'none'), 'the toolbar button switches back to remote mode');
        await page.evaluate(() => Win.close());
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }

    console.log('22. keyboard, mouse and controllers: Tab, wheel, Guide, Settings > Devices');
    {
        const page = await newPage(browser, base);
        await page.addInitScript(() => {
            const mk = (i, id) => { const b = []; for (let k = 0; k < 17; k++) b.push({ pressed: false, value: 0 }); return { index: i, id, connected: true, mapping: 'standard', buttons: b, axes: [0, 0, 0, 0] }; };
            window.__pads = [];
            navigator.getGamepads = () => window.__pads;
            window.__plug = () => { window.__pads = [mk(0, 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 02fd)')]; window.dispatchEvent(new Event('gamepadconnected')); };
            window.__pad = (b, on) => { window.__pads[0].buttons[b].pressed = on; window.__pads[0].buttons[b].value = on ? 1 : 0; };
        });
        await routeHosted(page, { offline: true });
        await page.goto(base + 'index.html');
        await page.waitForSelector('.dicon', { timeout: 15000 });
        const key = async (...ks) => { for (const k of ks) { await page.keyboard.press(k); await page.waitForTimeout(60); } };
        const focused = () => page.evaluate(() => (document.activeElement.getAttribute('data-app') || document.activeElement.getAttribute('data-game') || document.activeElement.id || document.activeElement.tagName));
        const first = await focused();
        await key('Tab');
        const second = await focused();
        await key('Tab');
        const third = await focused();
        await key('Shift+Tab');
        check(first !== second && second !== third && await focused() === second, 'Tab moves to the next button, Shift+Tab to the previous (' + first + ' > ' + second + ' > ' + third + ')');
        await page.mouse.move(300, 300); await page.mouse.move(320, 320);
        check(await page.evaluate(() => document.getElementById('input-indicator').getAttribute('aria-label')) === 'Mouse', 'moving the mouse shows the mouse in the taskbar');
        const before = await focused();
        await page.mouse.wheel(0, 200);
        await page.waitForTimeout(200);
        check(await focused() !== before, 'the mouse wheel moves through the desktop');
        await key('ArrowRight');
        check(await page.evaluate(() => document.getElementById('input-indicator').getAttribute('aria-label')) !== 'Mouse', 'pressing a key switches the indicator away from the mouse');
        await page.click('#tb-start');
        check(await page.evaluate(() => Desktop.startOpen()), 'a mouse click opens Start');
        await key('Escape');
        await key('F6');
        check(await page.evaluate(() => Desktop.startOpen()), 'Guide (F6) opens Start, like the Windows key');
        await key('Escape');
        // Settings > Devices
        await page.evaluate(() => Win.open('settings', 'devices'));
        const text = () => page.evaluate(() => document.querySelector('.set-main').textContent);
        check(/Keyboard.*Detected/.test(await text()) && /Mouse \/ pointer.*Detected/.test(await text()) && /None connected/.test(await text()), 'Devices lists the keyboard and mouse that were used, and no controller yet');
        await page.evaluate(() => window.__plug());
        await page.waitForFunction(() => /Controller 1.*Microsoft Xbox One S Controller · Xbox/.test(document.querySelector('.set-main').textContent), null, { timeout: 4000 });
        check(!/STANDARD|Vendor/.test(await text()), 'a controller that is plugged in shows up at once, with a clean name');
        check(await page.evaluate(() => !document.querySelector('.set-padtest')), 'the button test is not on the Devices list');
        await page.evaluate(() => [...document.querySelectorAll('.set-row')].find((r) => /Test controller buttons/.test(r.textContent)).click());
        await page.waitForFunction(() => !!document.querySelector('.set-padtest'), null, { timeout: 3000 });
        check(true, '"Test controller buttons" opens the test on its own page');
        await page.evaluate(() => window.__pad(1, true));       // B
        await page.waitForFunction(() => document.querySelectorAll('.pt-b.on').length === 1 && document.querySelector('.pt-b.on .pt-l').textContent === 'B', null, { timeout: 3000 });
        check(true, 'the live test lights up the button that is pressed (an Xbox pad: button 1 is its B)');
        await page.evaluate(() => window.__pad(1, false));
        await page.evaluate(() => [...document.querySelectorAll('.set-row')].find((r) => /Back/.test(r.textContent)).click());
        check(await page.evaluate(() => !document.querySelector('.set-padtest') && /Test controller buttons/.test(document.querySelector('.set-main').textContent)), 'Back on the test page returns to the Devices list');
        await page.evaluate(() => Win.close());
        check(await page.evaluate(() => document.querySelectorAll('.set-padtest').length === 0), 'closing Settings stops the test');
        // games never get the desktop keys; only a controller's Home (and the remote's Back) opens their pause menu
        await page.focus('[data-game="snake"]');
        await Promise.all([page.waitForURL(/play=snake/), page.keyboard.press('Enter')]);
        await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'running', null, { timeout: 15000 });
        await key('Tab', 'PageDown');
        check(await page.evaluate(() => window.GameHost.state()) === 'running', 'Tab and PageDown do nothing in a game');
        await key('F6');
        check(await page.evaluate(() => window.GameHost.state()) === 'running', 'Guide (F6 / the remote\'s Guide key) does not open My PC\'s menu over a game (owner rule 2026-11-11)');
        await page.evaluate(() => GameHost.onAction('guide', true, false, 'pad0'));
        check(await page.evaluate(() => window.GameHost.state()) === 'paused', 'a controller\'s Home opens the pause menu of a game');
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }

    console.log('26. App Store on the TV: browse, search, install, uninstall');
    {
        const APP = 'https://apps.example.test/';
        const db = {
            apps: {
                'star-catcher': { id: 'star-catcher', name: 'Star Catcher', description: 'Catch falling stars', url: APP + 'star/', entry: APP + 'star/index.html', icon: '', type: 'game', version: '1.0.0', enabled: true, order: 0, installedAt: '2026-03-01T10:00:00Z' },
                'paint-pad': { id: 'paint-pad', name: 'Paint Pad', description: 'Draw with the remote', url: APP + 'paint/', entry: APP + 'paint/index.html', icon: '', type: 'app', version: '2.1.0', enabled: true, order: 1, installedAt: '2026-09-01T10:00:00Z' },
                'old-one': { id: 'old-one', name: 'Old One', description: 'A classic', url: APP + 'old/', entry: APP + 'old/index.html', icon: '', type: 'game', version: '1.0.0', enabled: true, order: 2, installedAt: '2025-01-01T10:00:00Z' },
                'secret': { id: 'secret', name: 'Secret', url: APP + 's/', entry: APP + 's/index.html', type: 'game', enabled: false, order: 3 }
            },
            appstats: { 'old-one': { installs: 9, opens: 40 } }
        };
        const page = await newPage(browser, base, db);
        await routeHosted(page, { offline: true });
        await page.goto(base + 'index.html');
        await page.waitForSelector('#desk-icons [data-app="store"]');
        check(await page.evaluate(() => !!document.getElementById('tb-store') && !document.querySelector('[data-game^="app-"]')), 'App Store is on the desktop and the taskbar; nothing from the store is installed by itself');
        await page.focus('#desk-icons [data-app="store"]'); await page.keyboard.press('Enter');
        await page.waitForSelector('.st-hero');
        await page.waitForFunction(() => document.querySelectorAll('.st-section').length >= 2);
        // the install / open counters arrive a moment after the catalog
        await page.waitForFunction(() => { const p = document.querySelectorAll('.st-section')[1]; return p && /Old One/.test((p.querySelector('.st-card-name') || {}).textContent || ''); }, null, { timeout: 5000 }).catch(() => {});
        const home = await page.evaluate(() => ({ hero: document.querySelector('.st-hero-name').textContent,
            sections: [...document.querySelectorAll('.st-section')].map((x) => x.querySelector('h2').textContent + ': ' + [...x.querySelectorAll('.st-card-name')].map((n) => n.textContent).join(', ')) }));
        check(home.hero === 'Paint Pad' && /^New: Paint Pad, Star Catcher, Old One/.test(home.sections[0]) && /^Popular: Old One/.test(home.sections[1]) && !home.sections.join().includes('Secret'),
            'Home: the newest app is featured, New is by date, Popular by installs and opens, hidden apps are not shown (' + home.sections.join(' | ') + ')');
        // search with the remote: the Search page opens the on-screen keyboard
        await page.focus('.st-nav-btn[data-page="search"]'); await page.keyboard.press('Enter');
        await page.waitForFunction(() => Keyboard.isOpen());
        await page.keyboard.type('star');
        await page.evaluate(() => [...document.querySelectorAll('#namer-keys button')].pop().click());
        await page.waitForFunction(() => document.querySelectorAll('.st-main .st-card').length === 1);
        check(await page.textContent('.st-main .st-card .st-card-name') === 'Star Catcher' && /star/i.test(await page.textContent('#store-search')), 'Search finds apps by name');
        // the app's page: Install with the remote
        await page.focus('.st-main .st-card'); await page.keyboard.press('Enter');
        await page.waitForSelector('#store-install');
        check(await page.evaluate(() => document.activeElement.id === 'store-install' && /Catch falling stars/.test(document.querySelector('.st-detail-desc').textContent)), 'OK opens the app\'s page, focused on Install');
        await page.keyboard.press('Enter');
        check(await page.evaluate(() => !!document.querySelector('.st-progress')), 'installing shows a progress bar');
        await page.waitForSelector('#store-open', { timeout: 5000 });
        check(await page.evaluate(() => Cloud.isInstalled('star-catcher') && document.activeElement.id === 'store-open' && !!document.getElementById('store-uninstall')), 'after installing: Open and Uninstall');
        check(await page.evaluate(() => Desktop.installed().some((g) => g.id === 'app-star-catcher')), 'the installed game is on the desktop');
        await page.waitForFunction(() => true);
        await page.waitForTimeout(200);
        check((db.appstats['star-catcher'] || {}).installs === 1, 'the install is counted for "Popular" (' + JSON.stringify(db.appstats['star-catcher']) + ')');
        // Back returns from the app's page to the list, then closes the store
        await page.keyboard.press('Escape');
        check(await page.evaluate(() => !document.querySelector('.st-detail') && document.activeElement.classList.contains('st-card')), 'Back goes from the app\'s page to the list, focused on the same app');
        await page.focus('.st-nav-btn[data-page="library"]'); await page.keyboard.press('Enter');
        check(/Star Catcher/.test(await page.textContent('.st-main')) && await page.evaluate(() => document.querySelectorAll('.st-row').length) === 1, 'Library lists what is installed on this TV');
        await page.evaluate(() => Win.open('explorer', 'games'));
        check(/Star Catcher/.test(await page.textContent('.fx-list')), 'File Explorer shows the installed game');
        // uninstall from the store
        await page.evaluate(() => Win.open('store'));
        await page.waitForSelector('.st-card[data-store-app="star-catcher"]');
        await page.focus('.st-card[data-store-app="star-catcher"]'); await page.keyboard.press('Enter');
        await page.waitForSelector('#store-uninstall');
        await page.focus('#store-uninstall'); await page.keyboard.press('Enter');
        await page.focus('#dialog-yes'); await page.keyboard.press('Enter');
        await page.waitForSelector('#store-install');
        check(await page.evaluate(() => !Cloud.isInstalled('star-catcher') && !Desktop.installed().length), 'Uninstall removes it from this TV and from the desktop');
        // offline: the saved catalog still shows
        db.down = true;
        await page.evaluate(() => Win.close());
        await page.reload();
        await page.waitForSelector('#desk-icons [data-app="store"]');
        await page.evaluate(() => Win.open('store'));
        await page.waitForSelector('.st-hero');
        await page.waitForSelector('.st-note', { timeout: 8000 }).catch(() => {});
        check(await page.evaluate(() => document.querySelector('.st-hero-name').textContent === 'Paint Pad' && !!document.querySelector('.st-note')), 'offline, the store shows the saved list with a note');
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }

    console.log('27. TV id, cloud backup and restore, world records');
    {
        const db = {};
        const duid = (id) => `window.webapis.productinfo.getDuid = function () { return '${id}'; };`;
        // TV 1: a few things to keep
        let page = await newPage(browser, base, db);
        await page.addInitScript(duid('DUID-TEST-0001'));
        await routeHosted(page, { offline: true });
        await page.goto(base + 'index.html');
        await page.waitForSelector('#desk-icons .dicon');
        const tv1 = await page.evaluate(() => Device.id());
        check(/^tv-[a-f0-9]{28}$/.test(tv1) && await page.evaluate(() => Device.source()) === 'duid' && !(await page.evaluate(() => JSON.stringify(Backup.doc()))).includes('DUID-TEST'),
            'the TV id comes from the TV\'s own id, hashed (the DUID itself is never sent)');
        await page.evaluate(() => {
            Profiles.rename('p1', 'Ana'); Store.set('wallpaper', 'night'); I18n.setLang('es');
            const p = Profiles.create('Sam'); Store.rawSet('arc_' + p.id + '_wallpaper', JSON.stringify('aurora'));
            Store.rawSet('arc_dev_installed', [{ id: 'paint-pad', at: 5 }]);
            Scores.add('snake', 'Ana', 777, 'p1'); Store.set('game_snake_data', { level: 4 });
        });
        await page.evaluate(() => new Promise((res) => Backup.upload(res)));
        const doc = db.tvs[tv1];
        check(doc && doc.tv === tv1 && doc.model === 'MOCK' && doc.installed.join() === 'paint-pad' && doc.top.snake.s === 777 && doc.names.join() === 'Ana,Sam' && doc.lang === 'es' && doc.blob.length > 100,
            'the backup holds profiles, settings, installed apps and records, with a summary for the App Store Manager');
        // Settings > Privacy: off means nothing is sent; "delete" removes the copy
        await page.evaluate(() => Backup.setOn(false));
        check(await page.evaluate(() => new Promise((res) => Backup.upload(res))) === 'off', 'with cloud backup turned off nothing is sent');
        await page.evaluate(() => new Promise((res) => Backup.erase(res)));
        check(!db.tvs[tv1], 'Delete the cloud backup removes this TV\'s copy');
        await page.evaluate(() => Backup.setOn(true));
        await page.evaluate(() => new Promise((res) => Backup.upload(res)));
        check(!!db.tvs[tv1], 'turned on again, the backup is sent again');
        // world records: two TVs, sorted, top 10 only
        await page.evaluate(() => World.submit('snake', 'Ana', 500));
        await page.waitForFunction(() => !(Store.rawGet('arc_dev_world_queue') || []).length, null, { timeout: 5000 }).catch(() => {});
        await page.context().close();
        // TV 1 again, after a reinstall (empty storage): everything comes back
        page = await newPage(browser, base, db);
        await page.addInitScript(duid('DUID-TEST-0001'));
        await routeHosted(page, { offline: true });
        await page.goto(base + 'index.html');
        await page.waitForSelector('.welcome', { timeout: 10000 }).catch(() => {});
        check(await page.evaluate(() => !!document.querySelector('.welcome') && document.querySelector('.welcome').textContent.indexOf(I18n.t('restoredTitle')) >= 0), 'a reinstalled My PC finds its backup and says welcome back (in the restored language)');
        await page.waitForSelector('#desk-icons .dicon');
        const back = await page.evaluate(() => ({ names: Profiles.list().map((p) => p.name).join(), wp: Store.get('wallpaper'), lang: I18n.lang(), apps: Cloud.installedIds().join(),
            rec: Scores.list('snake').map((e) => e.n + ' ' + e.s).join(), save: Store.get('game_snake_data', {}).level }));
        check(back.names === 'Ana,Sam' && back.wp === 'night' && back.lang === 'es' && back.apps === 'paint-pad' && back.rec === 'Ana 777' && back.save === 4,
            'profiles, settings, installed apps, records and saves are restored (' + JSON.stringify(back) + ')');
        // a start where the DUID cannot be read keeps the same id (saved on the TV), so the backup never moves
        await page.addInitScript(() => { window.webapis.productinfo.getDuid = function () { throw new Error('not ready'); }; });
        await page.reload();
        await page.waitForSelector('#desk-icons .dicon');
        check(await page.evaluate(() => Device.id()) === tv1, 'a start where the DUID cannot be read keeps this TV\'s id');
        await page.context().close();
        // TV 3 was backed up under its Tizen id (DUID unreadable then); after a reinstall with the DUID readable it finds that copy
        page = await newPage(browser, base, db);
        const tz = `window.tizen.systeminfo.getCapability = function (k) { return k === 'http://tizen.org/system/tizenid' ? 'TIZENID-TEST-0003' : '9.0'; };`;
        await page.addInitScript(tz);
        await page.addInitScript(() => { window.webapis.productinfo.getDuid = function () { return ''; }; });
        await routeHosted(page, { offline: true });
        await page.goto(base + 'index.html');
        await page.waitForSelector('#desk-icons .dicon');
        const tv3old = await page.evaluate(() => Device.id());
        check(await page.evaluate(() => Device.source()) === 'tizen', 'without a DUID the Tizen id is used');
        await page.evaluate(() => { Profiles.rename('p1', 'Zoe'); });
        await page.evaluate(() => new Promise((res) => Backup.upload(res)));
        await page.context().close();
        page = await newPage(browser, base, db);
        await page.addInitScript(tz);
        await page.addInitScript(duid('DUID-TEST-0003'));
        await routeHosted(page, { offline: true });
        await page.goto(base + 'index.html');
        await page.waitForSelector('#desk-icons .dicon', { timeout: 10000 });
        check(await page.evaluate(() => Device.id()) !== tv3old && await page.evaluate(() => Profiles.list().map((p) => p.name).join()) === 'Zoe',
            'a backup saved under the Tizen id is found after a reinstall and the TV moves to its DUID id');
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
        // TV 2: another id, its own record; the world list keeps both, best first
        page = await newPage(browser, base, db);
        await page.addInitScript(duid('DUID-TEST-0002'));
        await routeHosted(page, { offline: true });
        await page.goto(base + 'index.html');
        await page.waitForSelector('#desk-icons .dicon');
        check(await page.evaluate(() => Device.id()) !== tv1, 'another TV has another id');
        for (const v of [900, 100]) await page.evaluate((x) => World.submit('snake', 'Leo', x), v);
        await page.waitForFunction(() => !(Store.rawGet('arc_dev_world_queue') || []).length, null, { timeout: 5000 }).catch(() => {});
        const world = (db.records.snake || { list: [] }).list.map((e) => e.n + ' ' + e.s).join(', ');
        check(world === 'Leo 900, Ana 500, Leo 100', 'world records from every TV, best first (' + world + ')');
        for (let i = 0; i < 12; i++) await page.evaluate((x) => World.submit('snake', 'Max', x), 1000 + i);
        await page.waitForFunction(() => !(Store.rawGet('arc_dev_world_queue') || []).length, null, { timeout: 8000 }).catch(() => {});
        check(db.records.snake.list.length === 10 && db.records.snake.list[0].s === 1011, 'the world table keeps the best 10');
        // Leaderboards: This TV / World
        await page.focus('#desk-icons [data-app="scores"]'); await page.keyboard.press('Enter');
        await page.focus('.lb-scope-btn[data-scope="world"]'); await page.keyboard.press('Enter');
        await page.waitForFunction(() => /Max/.test(document.querySelector('.lb-pane').textContent), null, { timeout: 5000 }).catch(() => {});
        check(await page.evaluate(() => /Max/.test(document.querySelector('.lb-pane').textContent) && document.querySelector('.lb-scope-btn.on').getAttribute('data-scope') === 'world'), 'Leaderboards > World shows the world records');
        await page.focus('.lb-scope-btn[data-scope="tv"]'); await page.keyboard.press('Enter');
        check(await page.evaluate(() => !/Max/.test(document.querySelector('.lb-pane').textContent)), 'This TV shows only this TV\'s records');
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }

    console.log('25. profiles are users: own settings, switch-user screen, update message, shared records');
    {
        const page = await newPage(browser, base);
        await routeHosted(page, { offline: true });
        await page.goto(base + 'index.html');
        await page.waitForSelector('#desk-icons .dicon');
        await page.evaluate(() => { I18n.setLang('fr'); Store.set('wallpaper', 'aurora'); Store.set('clock24', true); Scores.add('snake', 'Player 1', 900, 'p1'); });
        await page.evaluate(() => { const p = Profiles.create('Sam'); Welcome.switchUser(p.id); });
        check(await page.evaluate(() => !!document.querySelector('.welcome-user .avatar') && /Sam/.test(document.querySelector('.welcome').textContent)), 'switching user shows the sign-in screen with the avatar and name');
        check(await signedIn(page), 'the app restarts as the other user');
        check(await page.evaluate(() => Store.profile() === 'p2' && I18n.lang() === 'en' && Store.get('wallpaper') !== 'aurora' && Store.get('clock24') !== true), 'the new profile has its own language, clock and background');
        await page.evaluate(() => { I18n.setLang('es'); Store.set('wallpaper', 'bloom'); Scores.add('snake', 'Sam', 500, 'p2'); });
        await page.evaluate(() => Welcome.switchUser('p1'));
        check(await signedIn(page), 'switching back works');
        check(await page.evaluate(() => Store.profile() === 'p1' && I18n.lang() === 'fr' && Store.get('wallpaper') === 'aurora' && Store.get('clock24') === true && document.documentElement.lang === 'fr'), 'every profile keeps its own language, clock and background');
        await page.focus('[data-app="scores"]'); await page.keyboard.press('Enter');
        const hall = await page.evaluate(() => document.querySelector('.lb-pane').textContent);
        check(/Joueur 1/.test(hall) && /Sam/.test(hall), 'Leaderboards show the results of every profile');
        await page.evaluate(() => Win.close());
        // update message: once per new build
        await page.evaluate(() => Store.rawSet('arc_dev_seen_build', 1));
        await page.reload();
        await page.waitForSelector('.welcome-update');
        check(await page.evaluate(() => document.querySelector('.welcome-update').textContent.indexOf(AppBoot.version()) > 0), 'after an update the boot shows that My PC was updated, with the version');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => !document.querySelector('.welcome'), null, { timeout: 4000 });
        await page.reload();
        await page.waitForSelector('#desk-icons .dicon'); await page.waitForTimeout(600);
        check(await page.evaluate(() => !document.querySelector('.welcome')), 'the update message shows only once per build');
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }

    console.log('24. Super Jumper stages differ from each other');
    {
        const dir = path.join(ROOT, 'games/jumper/assets/levels');
        const sig = new Map();
        let flat = [], land = 0;
        for (const f of fs.readdirSync(dir).filter((n) => /^w\d-\d\.json$/.test(n))) {
            const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), t = m.layers.find((l) => l.name === 'tiles').data, W = m.width;
            const heights = new Set(), cols = [];
            for (let x = 0; x < W; x++) { let g = -1; for (let y = 0; y < m.height; y++) if (t[y * W + x] === 1) { g = y; break; } heights.add(g); cols.push(g); }
            const water = m.properties.some((p) => p.name === 'water' && p.value), fort = m.properties.some((p) => p.name === 'fortress' && p.value);
            if (water || fort) continue;
            land++;
            const key = cols.slice(16, 200).join(',');
            sig.set(key, (sig.get(key) || 0) + 1);
            if (heights.size < 3) flat.push(f);
        }
        check(sig.size === land, 'every land stage has its own ground profile (' + sig.size + ' of ' + land + ')');
        check(flat.length === 0, 'land stages have hills, not one flat floor' + (flat.length ? ' (flat: ' + flat.join(', ') + ')' : ''));
    }

    console.log('23. boot screen (Windows style, light)');
    {
        const page = await newPage(browser, base);
        await page.goto(base + 'index.html', { waitUntil: 'commit' });
        await page.waitForSelector('#boot-splash .bs-spin', { state: 'attached', timeout: 5000 }).catch(() => {});
        const first = await page.evaluate(() => {
            const s = document.getElementById('boot-splash');
            return s ? { svg: !!s.querySelector('svg'), dots: s.querySelectorAll('.bs-spin i').length, img: s.querySelectorAll('img').length,
                         bg: getComputedStyle(s).backgroundColor } : null;
        });
        check(first && first.svg && first.dots === 5 && first.img === 0 && first.bg === 'rgb(0, 0, 0)', 'black splash with inline logo, 5 orbit dots and no image to decode');
        await page.waitForFunction(() => !document.getElementById('boot-splash'), null, { timeout: 20000 });
        check(true, 'splash removed after the desktop is ready');
        await page.evaluate(() => { Win.register('boom', { icon: 'settings', title: function () { return 'Boom'; }, open: function () { throw new Error('kaput'); }, close: function () {} }); Win.open('boom'); });
        check(await page.evaluate(() => !document.getElementById('window').hidden && /kaput/.test(document.getElementById('win-body').textContent)), 'an app that fails to open shows the error instead of nothing');
        await page.evaluate(() => Win.close());
        await page.goto(base + 'index.html?play=jumper', { waitUntil: 'commit' });
        const warm = await page.waitForFunction(() => document.documentElement.classList.contains('warm'), null, { timeout: 5000 }).then(() => true, () => false);
        check(warm, 'opening a game uses the plain black screen (warm)');
        await page.context().close();
    }

    console.log('28. profile pictures: drawn avatars, photo, Settings entry');
    {
        const page = await newPage(browser, base);
        await routeHosted(page, { offline: true });
        await page.goto(base + 'index.html');
        await page.waitForSelector('#desk-icons .dicon');
        await page.focus('#tb-start'); await page.keyboard.press('Enter');
        await page.focus('#btn-profile'); await page.keyboard.press('Enter');
        await page.focus('#profile-picture'); await page.keyboard.press('Enter');
        check(await page.evaluate(() => !document.getElementById('profiles-picker').hidden && document.querySelectorAll('#pic-grid .pic-cell').length === Avatars.IDS.length + 1), 'the picture picker lists the initial letter and all the drawn avatars (' + await page.evaluate(() => Avatars.IDS.length) + ')');
        check(await page.evaluate(() => Avatars.IDS.length >= 16 && Avatars.IDS.every((id) => Avatars.svg(id).indexOf('<svg') === 0)), 'every avatar is drawn');
        await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
        check(await page.evaluate(() => !!Profiles.current().av && document.querySelector('#profile-avatar svg') !== null && document.getElementById('profiles-picker').hidden), 'picking an avatar saves it and shows it on the home button');
        await page.keyboard.press('Escape');
        check(await page.evaluate(() => document.getElementById('profiles').hidden), 'Back leaves the profiles screen');
        // a photo (a data image, as the camera-less TV flow produces)
        const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 8; c.getContext('2d').fillStyle = '#f00'; c.getContext('2d').fillRect(0, 0, 8, 8); return c.toDataURL('image/png'); });
        const out = await page.evaluate((src) => new Promise((res) => { ProfilesUI.openPicker(true); document.getElementById('pic-web'); res(true); }), png);
        await page.evaluate((src) => { Profiles.setPicture(Profiles.current().id, { photo: src }); ProfilesUI.renderButton(); }, png);
        check(await page.evaluate(() => !!document.querySelector('#profile-avatar img') && !!Profiles.current().photo), 'a photo shows on the home button');
        check(await page.evaluate(() => Backup.snapshot().arc_profiles.indexOf('photo') > 0), 'the picture is part of the cloud backup');
        await page.keyboard.press('Escape');
        await page.evaluate(() => { Win.open('settings', 'accounts'); });
        await page.waitForSelector('.set-nav-btn[data-page="accounts"]');
        await page.focus('.set-nav-btn[data-page="accounts"]'); await page.keyboard.press('Enter');
        const hasRow = await page.evaluate(() => [...document.querySelectorAll('.set-row')].some((r) => /Profile picture/.test(r.textContent)));
        check(hasRow, 'Settings > Accounts has a "Profile picture" entry');
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }

    console.log('29. native app feel: no zoom, no selection, no context menu');
    {
        const page = await newPage(browser, base);
        await routeHosted(page, { offline: true });
        await page.goto(base + 'index.html');
        await page.waitForSelector('#desk-icons .dicon');
        const r = await page.evaluate(() => {
            const fire = (type, init) => { const e = new Event(type, { bubbles: true, cancelable: true }); Object.assign(e, init || {}); document.body.dispatchEvent(e); return e.defaultPrevented; };
            const key = (k) => { const e = new KeyboardEvent('keydown', { key: k, ctrlKey: true, bubbles: true, cancelable: true }); document.body.dispatchEvent(e); return e.defaultPrevented; };
            const w = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true }); document.body.dispatchEvent(w);
            const plain = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }); document.body.dispatchEvent(plain);
            return { meta: document.querySelector('meta[name="viewport"]').content, ctrlWheel: w.defaultPrevented, plainWheel: plain.defaultPrevented,
                     plus: key('+'), minus: key('-'), zero: key('0'), gesture: fire('gesturestart'), dbl: fire('dblclick'), ctx: fire('contextmenu'), sel: fire('selectstart'),
                     css: getComputedStyle(document.body).userSelect, ta: getComputedStyle(document.documentElement).touchAction };
        });
        check(/user-scalable=no/.test(r.meta) && /maximum-scale=1/.test(r.meta), 'the viewport forbids zoom');
        check(r.ctrlWheel && !r.plainWheel, 'Ctrl+wheel zoom is blocked, the plain wheel still scrolls menus');
        check(r.plus && r.minus && r.zero, 'Ctrl + / - / 0 browser zoom keys are blocked');
        check(r.gesture && r.dbl && r.ctx && r.sel, 'pinch gesture, double-click, right-click menu and text selection are blocked');
        check(r.css === 'none' && /pan-x/.test(r.ta), 'CSS: no selection, no pinch (touch-action: ' + r.ta + ')');
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }

    console.log('30. rooms (lobbies): shell module on two TVs sharing one Firestore');
    {
        const db = {};
        const mk = async () => { const pg = await newPage(browser, base, db); await routeHosted(pg, { offline: true }); await pg.goto(base + 'index.html'); await pg.waitForSelector('#desk-icons .dicon'); return pg; };
        const A = await mk(), B = await mk();
        // a session per TV: events are collected in window.ev
        const mkSession = (pg, app, name) => pg.evaluate(([app, name]) => { window.ev = []; window.S = new Rooms.Session(app, name, (e, d) => window.ev.push([e, d])); return true; }, [app, name]);
        const call = (pg, op, args) => pg.evaluate(([op, args]) => new Promise((res) => window.S.call(op, args, (e, r) => res({ e, r }))), [op, args]);
        const evs = (pg, name) => pg.waitForFunction((n) => window.ev.some((x) => x[0] === n), name, { timeout: 8000 }).then(() => pg.evaluate((n) => window.ev.filter((x) => x[0] === n).map((x) => x[1]), name), () => []);
        await mkSession(A, 'ping-game', 'Host Ana'); await mkSession(B, 'ping-game', 'Guest Ben');
        await B.evaluate(() => { Rooms.LIMITS.asksPerMin = 1000; });             // the rate limit has its own check below
        const ROOMS = (r) => Object.keys(db.rooms || {}).length;

        const o = await call(A, 'open', { name: 'Ana room', max: 2 });
        check(!o.e && /^[a-z0-9]{8}$/.test(o.r.id) && o.r.max === 2, 'host opens a room: the shell makes the id (' + (o.r && o.r.id) + ')');
        const doc = db.rooms[o.r.id];
        check(doc.app === 'ping-game' && doc.name === 'Ana room' && doc.n === 1 && doc.max === 2 && typeof doc.exp === 'string' && Date.parse(doc.exp) - Date.now() > 30000 && Date.parse(doc.exp) - Date.now() < 60000, 'the room document has app, name, max, n and exp about 45 s ahead');
        check((await call(A, 'open', { name: 'again' })).e === 'denied', 'a second open room on the same TV is refused (denied)');

        let l = await call(B, 'list', {});
        check(!l.e && l.r.length === 1 && l.r[0].id === o.r.id && l.r[0].name === 'Ana room' && l.r[0].count === 1, 'guest lists the room of this app: { id, name, count }');
        check(db.queries.some((q) => q.col === 'rooms' && String(JSON.stringify(q.sq.where)).indexOf('"app"') > 0 && q.sq.limit === 50), 'the list is an app-filtered query (limit 50)');
        await mkSession(B, 'other-game', 'Guest Ben');
        check((await call(B, 'list', {})).r.length === 0 && (await call(B, 'ask', { room: o.r.id, name: 'x', offer: 'o' })).e === 'gone', 'another app never lists or joins this room');
        await mkSession(B, 'ping-game', 'Guest Ben');

        // simple query fallback while the composite index is not built
        db.noIndex = true;
        check((await call(B, 'list', {})).r.length === 1, 'without the composite index the list still works (simpler query, filtered on the TV)');
        db.noIndex = false;

        // ask -> request -> accept -> answer
        const ask = await call(B, 'ask', { room: o.r.id, name: 'Ben', offer: 'OFFER-1' });
        check(!ask.e && !!ask.r.id, 'guest asks to join');
        const rq = await evs(A, 'request');
        check(rq.length === 1 && rq[0].id === ask.r.id && rq[0].name === 'Ben' && rq[0].offer === 'OFFER-1' && rq[0].room === o.r.id, 'host receives the request promptly with name and offer');
        const acc = await call(A, 'accept', { room: o.r.id, req: rq[0].id, answer: 'ANSWER-1' });
        check(!acc.e, 'host accepts');
        const an = await evs(B, 'answer');
        check(an.length === 1 && an[0].answer === 'ANSWER-1' && an[0].req === ask.r.id, 'guest receives the answer string');
        await B.waitForFunction((id) => true, 0);
        check(db.rooms[o.r.id].n === 2 && !(db['rooms/' + o.r.id + '/reqs'] || {})[ask.r.id], 'player count is 2 and the guest removed its request');
        // full
        check((await call(B, 'ask', { room: o.r.id, name: 'Cy', offer: 'o2' })).e === 'full', 'a full room answers "full"');

        // decline
        await call(A, 'close', { room: o.r.id });
        check(!db.rooms[o.r.id] && Object.keys(db['rooms/' + o.r.id + '/reqs'] || {}).length === 0, 'closing deletes the room and its requests');
        const o2 = await call(A, 'open', { name: 'Two', max: 4 });
        await A.evaluate(() => { window.ev = []; }); await B.evaluate(() => { window.ev = []; });
        const ask2 = await call(B, 'ask', { room: o2.r.id, name: 'Ben', offer: 'O2' });
        const rq2 = await evs(A, 'request');
        await call(A, 'decline', { room: o2.r.id, req: rq2[rq2.length - 1].id });
        const dn = await evs(B, 'denied');
        check(dn.length === 1 && dn[0].why === 'no' && dn[0].req === ask2.r.id, 'declined: the guest gets denied "no"');

        // room closed while a guest waits
        await B.evaluate(() => { window.ev = []; });
        const ask3 = await call(B, 'ask', { room: o2.r.id, name: 'Ben', offer: 'O3' });
        await call(A, 'close', { room: o2.r.id });
        const gone = await evs(B, 'denied');
        check(gone.length === 1 && gone[0].why === 'gone', 'room closed while asking: the guest gets denied "gone"');

        // timeout (shortened for the test)
        const o3 = await call(A, 'open', { name: 'Three' });
        await B.evaluate(() => { window.ev = []; Rooms.LIMITS.askTtl = 2500; });
        const ask4 = await call(B, 'ask', { room: o3.r.id, name: 'Ben', offer: 'O4' });
        const to = await evs(B, 'denied');
        check(to.length === 1 && to[0].why === 'timeout', 'nobody answers: the guest gets denied "timeout"');
        check(Object.keys(db['rooms/' + o3.r.id + '/reqs'] || {}).length === 0, 'a timed-out request is deleted');
        await B.evaluate(() => { Rooms.LIMITS.askTtl = 60000; });

        // cancel
        const ask5 = await call(B, 'ask', { room: o3.r.id, name: 'Ben', offer: 'O5' });
        await call(B, 'cancel', { req: ask5.r.id });
        await B.waitForTimeout(300);
        check(Object.keys(db['rooms/' + o3.r.id + '/reqs'] || {}).length === 0, 'cancel deletes the request');

        // validation and caps
        check((await call(B, 'ask', { room: o3.r.id, name: 'Ben', offer: 'x'.repeat(6001) })).e === 'invalid', 'an offer over 6000 characters is invalid');
        check((await call(B, 'ask', { room: 'BAD ID!', name: 'Ben', offer: 'x' })).e === 'invalid', 'a malformed room id is invalid');
        check((await call(A, 'accept', { room: o3.r.id, req: 'abcdefgh', answer: 'y'.repeat(6001) })).e === 'invalid', 'an answer over 6000 characters is invalid');
        check((await call(A, 'nonsense', {})).e === 'invalid', 'an unknown operation is invalid');

        // rate limit: 5 asks per minute (4 made on this TV so far: ask, full-ask, ask2, ask3, timeout, ask5 ... use a fresh page)
        const C = await mk(); await mkSession(C, 'ping-game', 'Cy');
        const codes = [];
        for (let i = 0; i < 6; i++) codes.push((await call(C, 'ask', { room: o3.r.id, name: 'Cy', offer: 'o' + i })).e);
        check(codes.slice(0, 5).every((c) => !c) && codes[5] === 'denied', 'max 5 asks per minute per TV: the 6th is denied (' + codes.join(',') + ')');
        await C.evaluate(() => window.S.destroy());

        // offline
        db.down = true;
        const off = await call(B, 'list', {});
        const off2 = await call(A, 'open', {}).then((r) => r);
        check(off.e === 'offline', 'offline: list answers "offline"');
        db.down = false;

        // heartbeat keeps the room alive; expired rooms are not listed
        await A.evaluate(() => Rooms.LIMITS.beat);
        const beatBefore = db.rooms[o3.r.id].exp;
        await A.waitForTimeout(100);
        db.rooms[o3.r.id].exp = new Date(Date.now() - 5000).toISOString();
        check((await call(B, 'list', {})).r.length === 0, 'a room whose host stopped heartbeating (expired) is not listed');
        // the host's shell finds the room gone at the next heartbeat
        delete db.rooms[o3.r.id];
        // destroy: the app is closed -> nothing is left
        const o4 = await call(A, 'open', { name: 'Four' });
        check(!o4.e || o4.e === 'denied', 'a host can open again after the room is gone');
        await A.evaluate(() => window.S.destroy());
        await A.waitForTimeout(500);
        check(Object.keys(db.rooms || {}).length === 0, 'destroying the session (app closed) deletes the room');

        // request polling backs off once the room is quiet, stops while it is full, and `wake` makes it fast again
        {
            const E = await mk(); await mkSession(E, 'ping-game', 'Eve');
            await E.evaluate(() => { Rooms.LIMITS.poll = 100; Rooms.LIMITS.fastFor = 600; });
            const oe = await call(E, 'open', { name: 'Quiet', max: 2, idle: 1 });       // idle is clamped to at least the fast rate
            const polls = () => db.queries.filter((q) => q.col === 'rooms/' + oe.r.id + '/reqs').length;
            await E.evaluate(() => { Rooms.LIMITS.pollMaxIdle = 800; });
            await E.waitForTimeout(600); const fastN = polls();
            await call(E, 'close', { room: oe.r.id });
            await E.evaluate(() => { Rooms.LIMITS.poll = 100; Rooms.LIMITS.fastFor = 300; });
            const oq = await call(E, 'open', { name: 'Quiet2', max: 2, idle: 600 });
            const pq = () => db.queries.filter((q) => q.col === 'rooms/' + oq.r.id + '/reqs').length;
            const light = () => E.evaluate(() => ({ c: document.getElementById('tray-poll').className, t: document.getElementById('tray-poll').title }));
            const l0 = await light();
            check(/fast/.test(l0.c) && /every 2 s/.test(l0.t) && /room was opened/.test(l0.t), 'taskbar light: green while checking every 2 s, its title says why (' + l0.t + ')');
            await E.waitForTimeout(400); const a0 = pq();
            await E.waitForTimeout(1800); const a1 = pq() - a0;
            const l1 = await light();
            check(/slow/.test(l1.c) && /slowed down/.test(l1.t) && /a minute without requests/.test(l1.t), 'taskbar light: orange once slowed down (' + l1.t + ')');
            check(fastN >= 4 && a1 >= 1 && a1 <= 8, 'polls every 2 s (shortened) at first, then backs off to the idle rate (' + fastN + ' fast, ' + a1 + ' in 1.8 s idle)');
            await call(E, 'wake', { room: oq.r.id });
            const w0 = pq(); await E.waitForTimeout(250);
            check(pq() - w0 >= 2, 'wake: polls fast again (' + (pq() - w0) + ' in 250 ms)');
            await call(E, 'count', { room: oq.r.id, n: 2 });
            await E.waitForTimeout(400); const f0 = pq(); await E.waitForTimeout(1500);
            check(pq() === f0, 'a full room is not polled');
            const l2 = await light();
            check(/tray-poll off/.test(l2.c) && /room is full/.test(l2.t), 'taskbar light: grey while the room is full (' + l2.t + ')');
            await call(E, 'count', { room: oq.r.id, n: 1 });
            const g0 = pq(); await E.waitForTimeout(250);
            check(pq() - g0 >= 2, 'a player left: polls fast again');
            await E.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); });
            await E.waitForTimeout(400); const h0 = pq(); await E.waitForTimeout(1500);
            check(pq() === h0, 'no polling while My PC is hidden');
            await E.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
            const v0 = pq(); await E.waitForTimeout(250);
            const lv = await light();
            check(pq() - v0 === 1 && /slow/.test(lv.c) && /shown again/.test(lv.t), 'shown again: one check at once, then still slowed down (' + (pq() - v0) + ', ' + lv.c + ')');
            await E.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); document.dispatchEvent(new Event('visibilitychange')); });
            const v1 = pq(); await E.waitForTimeout(250);
            check(pq() - v1 <= 1 && /slow/.test((await light()).c), 'shown events in a row (a window uncovering the browser) never restart the fast checks');
            // 2 minutes (shortened) after the last thing that happened: resting, grey, one check a minute (shortened)
            await E.evaluate(() => { Rooms.LIMITS.restAfter = 500; Rooms.LIMITS.rest = 1500; });
            await E.waitForFunction(() => /tray-poll rest/.test(document.getElementById('tray-poll').className), null, { timeout: 4000 }).catch(() => {});
            const lr = await light(); const r0 = pq(); await E.waitForTimeout(1200);
            check(/tray-poll rest/.test(lr.c) && /resting, one check every 60 s/.test(lr.t) && /2 minutes without anything/.test(lr.t) && pq() - r0 <= 1, 'resting: grey, one check a minute after 2 minutes with nothing (' + lr.t + ', ' + (pq() - r0) + ' check)');
            await call(E, 'wake', { room: oq.r.id }); await E.waitForTimeout(150);
            check(/tray-poll fast/.test((await light()).c), 'resting ends at the next thing that happens (wake): green again');
            await E.evaluate(() => { Rooms.LIMITS.restAfter = 120000; Rooms.LIMITS.rest = 60000; });
            await E.evaluate(() => window.S.destroy());
            const l3 = await light();
            check(/tray-poll off/.test(l3.c) && /No Firestore checks/.test(l3.t), 'taskbar light: grey with "No Firestore checks" once no room is open');
            check(E.errors.length === 0, 'no page errors while polling ' + E.errors.join('; '));
            await E.context().close();
        }

        // a TV whose clock is wrong: exp follows the server's time
        db.skewMs = 3600000;
        const D = await mk(); await mkSession(D, 'ping-game', 'Dee');
        const o5 = await call(D, 'open', { name: 'Skew' });
        const dx = Date.parse(db.rooms[o5.r.id].exp) - (Date.now() + 3600000);
        check(!o5.e && dx > 30000 && dx < 60000, 'exp uses the server clock, not the TV clock (an hour apart here)');
        await D.evaluate(() => window.S.destroy());
        db.skewMs = 0;
        check(A.errors.length + B.errors.length === 0, 'no page errors ' + A.errors.concat(B.errors).join('; '));
        await A.context().close(); await B.context().close(); await C.context().close(); await D.context().close();
    }

    console.log('31. multiplayer through the SDK: the shell owns host / join / accept (two TVs), standalone tabs, old shell');
    {
        const APP = 'https://apps.example.test/mp/';
        const db = {};
        db.apps = { 'ping-friends': { id: 'ping-friends', name: 'Ping Friends', description: 'x', url: APP, entry: APP + 'multiplayer.html', icon: '', type: 'game', version: '1.0.0', enabled: true, order: 0, config: {} } };
        const setup = async (shellLacksMp) => {
            const pg = await newPage(browser, base, db);
            await routeHosted(pg, { offline: true });
            await pg.route(OLD_HOSTED + 'sdk/mypc-sdk.js', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(ROOT, 'sdk/mypc-sdk.js')) }));
            await pg.context().route(APP + '**', (r) => {
                const rel = r.request().url().slice(APP.length).split('?')[0] || 'multiplayer.html';
                const p = path.join(ROOT, 'sdk/example', rel);
                if (!fs.existsSync(p)) return r.fulfill({ status: 404, body: '' });
                r.fulfill({ status: 200, contentType: TYPES[path.extname(p)] || 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' }, body: fs.readFileSync(p) });
            });
            await pg.addInitScript(() => { if (!localStorage.getItem('arc_dev_installed')) localStorage.setItem('arc_dev_installed', JSON.stringify([{ id: 'ping-friends', at: 1 }])); });
            // an older My PC (or a browser without WebRTC): the shell does not offer multiplayer
            if (shellLacksMp) await pg.addInitScript(() => { Object.defineProperty(window, 'RTCPeerConnection', { value: undefined, configurable: true }); });
            return pg;
        };
        const openApp = async (pg) => {
            await pg.goto(base + 'index.html');
            await pg.waitForSelector('#desk-icons [data-game="app-ping-friends"]', { timeout: 8000 });
            await pg.focus('#desk-icons [data-game="app-ping-friends"]'); await pg.keyboard.press('Enter');
            await pg.waitForFunction(() => window.GameHost && window.GameHost.state() === 'running', null, { timeout: 10000 });
            const f = pg.frames().find((x) => x.url().indexOf(APP) === 0);
            await f.waitForFunction(() => window.MyPC && MyPC.info());
            return f;
        };
        const screen = (pg, title) => pg.waitForFunction((t) => { const e = document.getElementById('mp'); return e && !e.hidden && document.getElementById('mp-title').textContent === t; }, title, { timeout: 8000 }).then(() => true, () => false);
        const hidden = (pg) => pg.waitForFunction(() => document.getElementById('mp').hidden && document.getElementById('mp-ask').hidden, null, { timeout: 8000 }).then(() => true, () => false);
        const press = async (pg, k) => { await pg.keyboard.press(k); await pg.waitForTimeout(80); };
        const A = await setup(), B = await setup();
        const fa = await openApp(A), fb = await openApp(B);
        check(await fa.evaluate(() => MyPC.multiplayer.supported === true && MyPC.apiLevel >= 3 && MyPC.rooms === undefined), 'in My PC: MyPC.multiplayer.supported is true; MyPC.rooms is not public');
        await B.evaluate(() => { Rooms.LIMITS.asksPerMin = 1000; });

        // host(): the shell's own "Open a room" screen; Back cancels
        await fa.evaluate(() => { window.hp = MyPC.multiplayer.host({ max: 1 }).then((s) => { window.S = s; return 'ok'; }, (e) => e.code); });
        check(await screen(A, 'Open a room') && await A.evaluate(() => GameHost.state() === 'paused' && /Player 1/.test(document.getElementById('mp-text').textContent)), 'host(): My PC shows "Open a room" (room name = the profile name) and pauses the game');
        await press(A, 'Escape');
        check(await fa.evaluate(() => window.hp) === 'cancelled' && await hidden(A) && await A.evaluate(() => GameHost.state() === 'running'), 'Back cancels: host() rejects { code: "cancelled" } and the game resumes');
        // join(): empty list, Back cancels
        await fb.evaluate(() => { window.jp = MyPC.multiplayer.join().then((p) => { window.P = p; return 'ok'; }, (e) => e.code); });
        check(await screen(B, 'Join a friend') && await B.evaluate(() => /No rooms yet/.test(document.getElementById('mp-list').textContent)), 'join(): "Join a friend" with an empty list message');
        await press(B, 'Escape');
        check(await fb.evaluate(() => window.jp) === 'cancelled' && await hidden(B), 'Back cancels join(): { code: "cancelled" }');

        // a real flow: host opens, guest picks, host accepts
        await fa.evaluate(() => { window.hp = MyPC.multiplayer.host({ max: 1 }).then((s) => { window.S = s; window.got = []; s.onPeer((p) => { window.PA = p; window.msgsA = []; p.onMessage((m) => msgsA.push(m)); p.onClose(() => { window.closedA = true; }); }); return 'ok'; }, (e) => e.code); });
        await screen(A, 'Open a room'); await press(A, 'Enter');
        check(await fa.evaluate(() => window.hp) === 'ok' && await hidden(A), 'host(): confirming opens the room and resolves a session');
        const room = Object.values(db.rooms)[0];
        check(Object.keys(db.rooms).length === 1 && room.app === 'app-ping-friends' && room.name === 'Player 1' && room.max === 2, 'the room is for this app, named after the profile (max = host + 1 guest)');
        await fb.evaluate(() => { window.jp = MyPC.multiplayer.join().then((p) => { window.PB = p; window.msgsB = []; p.onMessage((m) => msgsB.push(m)); p.onClose(() => { window.closedB = true; }); return 'ok'; }, (e) => e.code); });
        await screen(B, 'Join a friend');
        await B.waitForFunction(() => document.querySelectorAll('#mp-list .mp-room').length === 1, null, { timeout: 8000 });
        check(await B.evaluate(() => /Player 1/.test(document.querySelector('#mp-list .mp-room').textContent) && /1 player/.test(document.querySelector('#mp-list .mp-room').textContent)), 'join(): the list shows the open room of this app');
        await press(B, 'Enter');
        check(await screen(B, 'Joining') && await B.evaluate(() => /Waiting for Player 1/.test(document.getElementById('mp-text').textContent)), 'the guest sees "Waiting for <host> to accept..."');
        await A.waitForFunction(() => !document.getElementById('mp-ask').hidden, null, { timeout: 10000 });
        check(await A.evaluate(() => /Player 1 wants to join/.test(document.getElementById('mp-ask-title').textContent) && GameHost.state() === 'paused'), 'the host sees "<name> wants to join: Accept / Decline" over the game, paused');
        await press(A, 'Enter');                                       // Accept has the focus
        check(await fa.evaluate(() => new Promise((r) => { const t = setInterval(() => { if (window.PA) { clearInterval(t); r(true); } }, 50); setTimeout(() => r(false), 12000); })), 'after Accept the host gets onPeer with a connected peer');
        check(await fb.evaluate(() => window.jp) === 'ok' && await fb.evaluate(() => window.PB.name === 'Player 1'), 'the guest\'s join() resolves with the host as a peer');
        check(await hidden(A) && await hidden(B) && await A.evaluate(() => GameHost.state() === 'running') && await B.evaluate(() => GameHost.state() === 'running'), 'screens closed and both games resume');
        check(await fa.evaluate(() => window.S.peers.length === 1 && window.S.peers[0] === window.PA), 'session.peers lists the peer');
        await fb.evaluate(() => PB.send({ n: 1, s: 'from guest' })); await fa.evaluate(() => PA.send('from host'));
        await fa.waitForFunction(() => window.msgsA.length === 1); await fb.waitForFunction(() => window.msgsB.length === 1);
        check(await fa.evaluate(() => JSON.stringify(msgsA[0])) === '{"n":1,"s":"from guest"}' && await fb.evaluate(() => msgsB[0]) === 'from host', 'messages arrive both ways (objects and strings, relayed by the shell)');
        check(await fa.evaluate(() => PA.send('x'.repeat(5000)) === false) && await fa.evaluate(() => PA.send(undefined) === false), 'a message over 4 KB (or not JSON) is refused: send() returns false');
        await A.waitForTimeout(500);
        check(Object.keys(db.rooms || {}).length === 0, 'when max guests are in, the room closes by itself');
        await fb.evaluate(() => PB.close());
        await fa.waitForFunction(() => window.closedA, null, { timeout: 8000 }).catch(() => {});
        check(await fa.evaluate(() => window.closedA === true && window.S.peers.length === 0), 'closing one side: the other gets onClose and session.peers updates');

        // decline
        await fa.evaluate(() => { window.hp = MyPC.multiplayer.host({ max: 2 }).then((s) => { window.S = s; return 'ok'; }, (e) => e.code); });
        await screen(A, 'Open a room'); await press(A, 'Enter'); await A.waitForTimeout(300);
        await fb.evaluate(() => { window.jp = MyPC.multiplayer.join().then(() => 'ok', (e) => e.code); });
        await B.waitForFunction(() => document.querySelectorAll('#mp-list .mp-room').length === 1, null, { timeout: 8000 });
        await press(B, 'Enter');
        await A.waitForFunction(() => !document.getElementById('mp-ask').hidden, null, { timeout: 10000 });
        await press(A, 'ArrowRight'); await press(A, 'Enter');        // Decline
        check(await fb.evaluate(() => window.jp) === 'denied' && await hidden(B), 'declined: the guest\'s join() rejects { code: "denied" } (the shell showed the reason)');
        // timeout
        await B.evaluate(() => { Rooms.LIMITS.askTtl = 2500; });
        await fb.evaluate(() => { window.jp = MyPC.multiplayer.join().then(() => 'ok', (e) => e.code); });
        await B.waitForFunction(() => document.querySelectorAll('#mp-list .mp-room').length === 1, null, { timeout: 8000 });
        await press(B, 'Enter');
        check(await fb.evaluate(() => window.jp) === 'timeout', 'nobody answers: join() rejects "timeout"');
        await B.evaluate(() => { Rooms.LIMITS.askTtl = 60000; });
        await A.waitForFunction(() => !document.getElementById('mp-ask').hidden, null, { timeout: 5000 }).catch(() => {});
        await press(A, 'Escape');                                      // Back = Decline
        await hidden(A);
        // cancel while waiting
        await fb.evaluate(() => { window.jp = MyPC.multiplayer.join().then(() => 'ok', (e) => e.code); });
        await B.waitForFunction(() => document.querySelectorAll('#mp-list .mp-room').length === 1, null, { timeout: 8000 });
        await press(B, 'Enter'); await screen(B, 'Joining');
        await press(B, 'Escape');
        check(await fb.evaluate(() => window.jp) === 'cancelled', 'cancel while waiting: join() rejects "cancelled"');
        await A.waitForFunction(() => !document.getElementById('mp-ask').hidden, null, { timeout: 5000 }).catch(() => {});
        await press(A, 'Escape'); await hidden(A);
        // room closed while a guest waits
        await fb.evaluate(() => { window.jp = MyPC.multiplayer.join().then(() => 'ok', (e) => e.code); });
        await B.waitForFunction(() => document.querySelectorAll('#mp-list .mp-room').length === 1, null, { timeout: 8000 });
        await press(B, 'Enter'); await screen(B, 'Joining');
        await fa.evaluate(() => S.close());
        check(await fb.evaluate(() => window.jp) === 'gone', 'the host closed the room: join() rejects "gone"');
        await A.waitForFunction(() => document.getElementById('mp-ask').hidden || true); 
        await A.evaluate(() => { document.getElementById('mp-ask').hidden || document.getElementById('mp-ask-no').click(); });
        // offline
        await fa.evaluate(() => { window.hp = MyPC.multiplayer.host({ max: 1 }).then((s) => { window.S = s; return 'ok'; }, (e) => e.code); });
        await screen(A, 'Open a room'); await press(A, 'Enter'); await A.waitForTimeout(300);
        await fb.evaluate(() => { window.jp = MyPC.multiplayer.join().then(() => 'ok', (e) => e.code); });
        await B.waitForFunction(() => document.querySelectorAll('#mp-list .mp-room').length === 1, null, { timeout: 8000 });
        db.down = true;
        await press(B, 'Enter');
        check(await fb.evaluate(() => window.jp) === 'offline', 'offline: join() rejects "offline"');
        db.down = false;
        await fa.evaluate(() => S.close());
        // rate limit: 5 asks per minute
        const C = await setup(); const fc = await openApp(C);
        await fa.evaluate(() => { window.hp = MyPC.multiplayer.host({ max: 7 }).then((s) => { window.S2 = s; return 'ok'; }, (e) => e.code); });
        await screen(A, 'Open a room'); await press(A, 'Enter'); await A.waitForTimeout(300);
        const codes = [];
        for (let i = 0; i < 6; i++) {
            await fc.evaluate(() => { window.jp = MyPC.multiplayer.join().then(() => 'ok', (e) => e.code); });
            await C.waitForFunction(() => document.querySelectorAll('#mp-list .mp-room').length === 1, null, { timeout: 8000 });
            await press(C, 'Enter');
            if (i < 5) {
                const n0 = (db.rules || []).filter((x) => /\/reqs$/.test(x.col) && !x.mask.length).length;
                await screen(C, 'Joining');
                await C.waitForFunction(() => true); await new Promise((r) => { const t = setInterval(() => { if ((db.rules || []).filter((x) => /\/reqs$/.test(x.col) && !x.mask.length).length > n0) { clearInterval(t); r(); } }, 50); });
                await press(C, 'Escape'); codes.push(await fc.evaluate(() => window.jp));
            }
            else codes.push(await fc.evaluate(() => window.jp));
        }
        check(codes.slice(0, 5).every((c) => c === 'cancelled') && codes[5] === 'denied', 'rate limit: the 6th ask within a minute rejects "denied" (' + codes.join(',') + ')');
        await A.waitForTimeout(300);
        await A.evaluate(() => { for (let i = 0; i < 8; i++) if (!document.getElementById('mp-ask').hidden) document.getElementById('mp-ask-no').click(); });
        // the app quits: rooms and screens are gone
        await fa.evaluate(() => MyPC.exit()).catch(() => {});
        await A.waitForFunction(() => window.GameHost && window.GameHost.state() === 'idle', null, { timeout: 8000 }).catch(() => {});
        await A.waitForTimeout(800);
        check(Object.keys(db.rooms || {}).length === 0, 'quitting the app deletes its room');
        check(A.errors.length + B.errors.length + C.errors.length === 0, 'no page errors ' + A.errors.concat(B.errors, C.errors).join('; '));
        await A.context().close(); await B.context().close(); await C.context().close();

        // an older My PC: supported is false, host() / join() reject "unavailable"
        const O = await setup(true);
        const fo = await openApp(O);
        check(await fo.evaluate(() => MyPC.multiplayer.supported === false) && await fo.evaluate(() => MyPC.multiplayer.host({ max: 1 }).then(() => 'ok', (e) => e.code)) === 'unavailable', 'old shell: MyPC.multiplayer.supported is false and host() rejects "unavailable"');
        await O.context().close();

        // standalone: two tabs, minimal DOM screens
        const ctx = await browser.newContext();
        await ctx.route(OLD_HOSTED + 'sdk/mypc-sdk.js', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(ROOT, 'sdk/mypc-sdk.js')) }));
        await ctx.route(APP + '**', (r) => { const rel = r.request().url().slice(APP.length).split('?')[0] || 'multiplayer.html'; const p = path.join(ROOT, 'sdk/example', rel); r.fulfill({ status: 200, contentType: TYPES[path.extname(p)] || 'text/html', headers: { 'Access-Control-Allow-Origin': '*' }, body: fs.readFileSync(p) }); });
        const t1 = await ctx.newPage(), t2 = await ctx.newPage();
        for (const t of [t1, t2]) { await t.goto(APP + 'multiplayer.html'); await t.waitForFunction(() => window.MyPC && MyPC.info() && MyPC.info().standalone); }
        check(await t1.evaluate(() => MyPC.multiplayer.supported === true && MyPC.rooms === undefined), 'standalone: MyPC.multiplayer is supported (tabs of the same browser)');
        await t1.evaluate(() => { window.hp = MyPC.multiplayer.host({ max: 1 }).then((s) => { window.S = s; s.onPeer((p) => { window.PA = p; window.mA = []; p.onMessage((m) => mA.push(m)); }); return 'ok'; }, (e) => e.code); });
        await t1.waitForFunction(() => /Open a room/.test(document.body.innerText));
        await t1.keyboard.press('Enter');
        check(await t1.evaluate(() => window.hp) === 'ok', 'standalone: host() shows a minimal screen and opens the room');
        await t2.evaluate(() => { window.jp = MyPC.multiplayer.join().then((p) => { window.PB = p; window.mB = []; p.onMessage((m) => mB.push(m)); return 'ok'; }, (e) => e.code); });
        await t2.waitForFunction(() => /Join a friend/.test(document.body.innerText) && /Player/.test(document.body.innerText));
        await t2.keyboard.press('Enter');
        await t1.waitForFunction(() => /wants to join/.test(document.body.innerText), null, { timeout: 8000 });
        await t1.keyboard.press('Enter');
        check(await t2.evaluate(() => new Promise((r) => { const i = setInterval(() => { if (window.PB) { clearInterval(i); r(true); } }, 50); setTimeout(() => r(false), 12000); })) && await t1.evaluate(() => !!window.PA), 'standalone: join, accept and connect between two tabs');
        await t2.evaluate(() => PB.send({ hi: 1 })); await t1.evaluate(() => PA.send('yo'));
        await t1.waitForFunction(() => window.mA.length === 1); await t2.waitForFunction(() => window.mB.length === 1);
        check(await t1.evaluate(() => mA[0].hi) === 1 && await t2.evaluate(() => mB[0]) === 'yo', 'standalone: messages both ways');
        await ctx.close();

        // the two copies of the connection code (shell and SDK) stay identical
        const grab = (f) => { const t = fs.readFileSync(path.join(ROOT, f), 'utf8'); const a = t.indexOf('/* netlink:begin'), b = t.indexOf('/* netlink:end */'); return t.slice(a, b).split('\n').map((l) => l.trim()).join('\n'); };
        check(grab('js/core/netlink.js') === grab('sdk/mypc-sdk.js') && grab('js/core/netlink.js').length > 1000, 'js/core/netlink.js and the copy inside sdk/mypc-sdk.js are identical');
    }

    console.log('32. touch controls: the shell draws the pad on phones (844x390, 390x844), MyPC.pad, "touch" manifest field');
    {
        const APP = 'https://apps.example.test/pad/';
        const mkdoc = (id, order, entry, touch) => Object.assign({ id, name: 'Pad ' + id, description: 'x', url: APP, entry: APP + (entry || 'index.html'), icon: '', type: 'game', version: '1.0.0', enabled: true, order, config: {} }, touch === undefined ? {} : { touch });
        const db = { apps: {
            'pad-def': mkdoc('pad-def', 0),
            'pad-cust': mkdoc('pad-cust', 1, 'index.html', { buttons: [{ label: 'X', action: 'cancel' }], catalog: [{ label: 'X', action: 'cancel' }, { label: 'Y', action: 'run' }], scale: { stick: 1.5 } }),
            'pad-off': mkdoc('pad-off', 2, 'index.html', false),
            'pad-optoff': mkdoc('pad-optoff', 3, 'inline.html?mode=off'),
            'pad-own': mkdoc('pad-own', 4, 'inline.html?mode=own')
        } };
        const INLINE = `<!doctype html><meta charset=utf-8><body style="background:#123"><script src="${OLD_HOSTED}sdk/mypc-sdk.js"></script><script>
            var mode = (/mode=(\\w+)/.exec(location.search) || [])[1]; window.padLog = [];
            MyPC.init({ pad: mode === 'off' ? false : undefined, onInit: function () { if (mode === 'own') MyPC.pad.init({ force: true, onAction: function (a, d) { window.padLog.push([a, d]); } }); MyPC.ready(); } });
        <\/script>`;
        const setup = async (o) => {
            const pg = await newPage(browser, base, db, o);
            await routeHosted(pg, { offline: true });
            await pg.route(OLD_HOSTED + 'sdk/mypc-sdk.js', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(ROOT, 'sdk/mypc-sdk.js')) }));
            await pg.context().route(APP + '**', (r) => {
                const rel = r.request().url().slice(APP.length).split('?')[0] || 'index.html';
                if (rel === 'inline.html') return r.fulfill({ status: 200, contentType: 'text/html', headers: { 'Access-Control-Allow-Origin': '*' }, body: INLINE });
                const p = path.join(ROOT, 'sdk/example', rel);
                if (!fs.existsSync(p)) return r.fulfill({ status: 404, body: '' });
                r.fulfill({ status: 200, contentType: TYPES[path.extname(p)] || 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' }, body: fs.readFileSync(p) });
            });
            await pg.addInitScript(() => { if (!localStorage.getItem('arc_dev_installed')) localStorage.setItem('arc_dev_installed', JSON.stringify(['pad-def', 'pad-cust', 'pad-off', 'pad-optoff', 'pad-own'].map((id) => ({ id, at: 1 })))); });
            return pg;
        };
        const openApp = async (pg, id) => {
            await pg.goto(base + 'index.html');
            await pg.waitForSelector(`#desk-icons [data-game="app-${id}"]`, { timeout: 8000 });
            await pg.focus(`#desk-icons [data-game="app-${id}"]`); await pg.keyboard.press('Enter');
            await pg.waitForFunction(() => window.GameHost && window.GameHost.state() === 'running', null, { timeout: 10000 });
            const f = pg.frames().find((x) => x.url().indexOf(APP) === 0);
            await f.waitForFunction(() => window.MyPC && MyPC.info());
            return f;
        };
        const padOf = (pg) => pg.evaluate(() => {
            const root = [...document.body.children].find((e) => e.style && e.style.zIndex === '99999');
            if (!root) return null;
            const r = (e) => { const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height }; };
            const out = { stick: r(root.querySelector('#vp-stick') || root.querySelector('#vp-dpad')), labels: {}, panel: null };
            [...root.querySelectorAll('div')].forEach((e) => { const t = e.textContent; if (!e.children.length && t && t.length <= 3 && e.style.position === 'absolute' && e.style.display !== 'none') out.labels[t] = r(e); });
            const panel = [...root.children].find((e) => e.style.position === 'fixed' && e.style.inset === '0px');
            out.panel = !!panel && panel.style.display === 'block';
            return out;
        });
        const fingers = async (pg) => {
            const cdp = await pg.context().newCDPSession(pg);
            let pts = [];
            const send = (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: p.id })) });
            return {
                down: async (id, x, y) => { pts = pts.filter((p) => p.id !== id).concat([{ id, x, y }]); await send('touchStart'); },
                move: async (id, x, y) => { pts = pts.map((p) => p.id === id ? { id, x, y } : p); await send('touchMove'); },
                up: async (id) => { const gone = pts.filter((p) => p.id === id); pts = pts.filter((p) => p.id !== id); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: gone.map((p) => ({ x: p.x, y: p.y, id: p.id })) }); }
            };
        };
        const tap = async (pg, x, y) => { const f = await fingers(pg); await f.down(9, x, y); await pg.waitForTimeout(60); await f.up(9); await pg.waitForTimeout(80); };
        const wait = (pg) => pg.waitForTimeout(120);

        const P = await setup({ phone: true });
        const fr = await openApp(P, 'pad-def');
        let pad = await padOf(P);
        check(!!pad && !!pad.stick && !!pad.labels.A && !!pad.labels.B && !!pad.labels['⚙'] && !!pad.labels['+'] && !pad.labels.C && !pad.labels.II && !pad.labels['☰'], 'phone 844x390: the shell draws the pad (stick, A, B, the + button, gear; never A B C) above the app, nothing to code in the app');
        check(['X', 'Y', 'L', 'R'].every((l) => pad.labels[l]) && !pad.labels.ZL && await P.evaluate(() => {
            const o = PadSpec.options({}), h = document.getElementById('vp-home');
            return o.id === 'controller2' && o.home === true && o.dpadSwitch === true && o.scale.stick === 1.35 && o.catalog.length === 12 && !!h && h.style.display === 'flex';
        }), 'the pad over the game IS the phone controller\'s pad (PadSpec): A B X Y, L R, + and Home shown, the gear adds the rest, same sizes and saved layout (' + Object.keys(pad.labels).join(' ') + ')');
        check(await P.evaluate(() => { const r = [...document.body.children].find((e) => e.style && e.style.zIndex === '99999'); return r.parentNode === document.body && !document.getElementById('desktop').offsetParent; }), 'the pad lives on the page, over the game layer (the desktop is not built on the game page)');
        // the stick
        const fg = await fingers(P);
        await fg.down(1, pad.stick.x + 45, pad.stick.y); await wait(P);
        check(await fr.evaluate(() => MyPC.isDown('right') && !MyPC.isDown('left')), 'stick right = the SDK action "right"');
        await fg.move(1, pad.stick.x - 45, pad.stick.y); await wait(P);
        check(await fr.evaluate(() => MyPC.isDown('left') && !MyPC.isDown('right')), 'stick left = "left" (right released)');
        await fg.move(1, pad.stick.x + 40, pad.stick.y - 40); await wait(P);
        check(await fr.evaluate(() => MyPC.isDown('right') && MyPC.isDown('up')), 'a diagonal sends two actions');
        await fg.up(1); await wait(P);
        check(await fr.evaluate(() => !MyPC.isDown('right') && !MyPC.isDown('up') && !MyPC.isDown('left')), 'letting go releases the stick');
        // buttons: A = confirm + jump (like the remote's OK), B = run + back, held while the finger stays (owner decision 2026-11-11)
        await fg.down(2, pad.labels.A.x, pad.labels.A.y); await wait(P);
        check(await fr.evaluate(() => MyPC.isDown('confirm') && MyPC.isDown('jump') && !MyPC.isDown('run')), 'A = "confirm" + "jump" (the remote\'s OK), like a Nintendo pad\'s A, held while pressed');
        await P.waitForTimeout(300);
        check(await fr.evaluate(() => MyPC.isDown('jump')), 'a button stays held');
        // multi-touch: stick + A + B at once
        await fg.down(1, pad.stick.x + 45, pad.stick.y); await fg.down(3, pad.labels.B.x, pad.labels.B.y); await wait(P);
        check(await fr.evaluate(() => MyPC.isDown('right') && MyPC.isDown('jump') && MyPC.isDown('run') && MyPC.isDown('cancel')), 'multi-touch: stick + A + B (run + back) at the same time');
        await fg.up(2); await wait(P);
        check(await fr.evaluate(() => !MyPC.isDown('jump') && MyPC.isDown('run') && MyPC.isDown('right')), 'releasing A keeps B and the stick');
        await fg.up(3); await fg.up(1); await wait(P);
        check(await fr.evaluate(() => !MyPC.isDown('run') && !MyPC.isDown('right')), 'all released');

        // the pause button: My PC's pause menu; the pad hides while it is open; the menu offers "Touch pad settings"
        await tap(P, pad.labels['+'].x, pad.labels['+'].y);
        check(await P.evaluate(() => GameHost.state() === 'paused'), 'the + button opens My PC\'s pause menu');
        check(!(await padOf(P)), 'the pad is hidden while My PC\'s pause menu is open');
        const items = await P.evaluate(() => [...document.querySelectorAll('#pause-items button')].map((b) => b.textContent));
        check(items.indexOf('Touch pad settings') > 0, 'the pause menu has "Touch pad settings" (' + items.join(', ') + ')');
        // customize from the pause menu: add ZL, close, resume: it is there
        await P.evaluate(() => { [...document.querySelectorAll('#pause-items button')].find((b) => b.textContent === 'Touch pad settings').click(); });
        await wait(P);
        pad = await padOf(P);
        check(!!pad && pad.panel === true, 'Touch pad settings opens the pad\'s settings panel over the pause menu');
        await P.evaluate(() => { [...document.querySelectorAll('div')].find((e) => !e.children.length && e.textContent === 'ZL' && e.style.cursor === 'pointer').click(); });
        await P.evaluate(() => { [...document.querySelectorAll('div')].find((e) => !e.children.length && e.textContent === 'Close').click(); });
        await wait(P);
        check(!(await padOf(P)) && await P.evaluate(() => GameHost.state() === 'paused' && !document.getElementById('pause').hidden), 'closing the panel goes back to the pause menu (pad hidden, game still paused)');
        await P.evaluate(() => document.querySelector('#pause-items button').click());      // Resume
        await wait(P);
        pad = await padOf(P);
        check(!!pad && !!pad.labels.ZL && !!pad.labels.X && !!pad.labels.A && !!pad.labels.B, 'back in the game the pad has the new button ZL');
        await fg.down(5, pad.labels.L.x, pad.labels.L.y); await wait(P);
        check(await P.evaluate(() => Input.isDownDev('touch', 'pageUp')), 'L = "pageUp", like a real pad\'s L');
        await fg.up(5); await wait(P);
        await fg.down(4, pad.labels.X.x, pad.labels.X.y); await wait(P);
        check(await fr.evaluate(() => MyPC.isDown('run') && !MyPC.isDown('cancel')), 'X = "run", like a Nintendo pad\'s X');
        await fg.up(4);
        // the gear pauses the game while the panel is open (the library ignores a tap that follows another within 350 ms: no double-tap zoom)
        await P.waitForTimeout(450);
        await tap(P, pad.labels['⚙'].x, pad.labels['⚙'].y);
        const gearInfo = JSON.stringify([await P.evaluate(() => GameHost.state()), (await padOf(P) || {}).panel, pad.labels['⚙']]);
        check(await P.evaluate(() => GameHost.state() === 'paused') && (await padOf(P)).panel === true, 'the gear opens the settings and pauses the game');
        await P.evaluate(() => { [...document.querySelectorAll('div')].find((e) => !e.children.length && e.textContent === 'Close').click(); });
        await wait(P);
        check(await P.evaluate(() => GameHost.state() === 'running') && !!(await padOf(P)), 'closing the settings resumes the game');
        // the layout is saved on the device (per app) and survives a reload
        const saved = await P.evaluate(() => Store.rawGet('arc_dev_vpad:controller2'));
        check(!!saved && Object.values(saved.on).filter(Boolean).length === 1, 'the layout is saved once for every app and the phone controller (vpad:controller2)');
        await openApp(P, 'pad-def');                                   // loads the page again: the saved layout comes back
        pad = await padOf(P);
        check(!!pad && !!pad.labels.ZL, 'after a reload the customized layout is back');
        // the panel: Stick / D-pad (no left-half zone with the D-pad), + and Home are buttons like the others; hide / show from the pause menu
        const zone = () => P.evaluate(() => { const r = [...document.body.children].find((e) => e.style && e.style.zIndex === '99999'); return !!r && [...r.children].some((e) => e.style.width === '50%'); });
        check(await zone() && await P.evaluate(() => document.getElementById('vp-home').style.display === 'flex'), 'the stick has its left-half zone; Home is shown, like on the phone controller');
        await P.evaluate(() => VirtualPad.openSettings()); await wait(P);
        const chip = (t) => P.evaluate((t) => { [...document.querySelectorAll('div')].find((e) => !e.children.length && e.textContent === t && e.style.cursor === 'pointer').click(); }, t);
        await chip('D-pad'); await wait(P);
        check(await P.evaluate(() => !!document.getElementById('vp-dpad') && !document.getElementById('vp-stick')) && !(await zone()) && (await padOf(P)).panel === true && await P.evaluate(() => GameHost.state() === 'paused'),
            'D-pad: drawn in place of the stick, the left half is free for taps, the panel stays open and the game stays paused');
        await chip('Close'); await wait(P);
        check(await P.evaluate(() => GameHost.state() === 'running' && document.getElementById('vp-home').style.display === 'flex' && Store.rawGet('arc_dev_vpad:controller2').dp === true && PadSpec.dpad()), 'the D-pad choice is saved with the shared layout (the Game controller\'s GamePad setting)');
        const hb2 = await P.evaluate(() => { const r = document.getElementById('vp-home').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
        await P.waitForTimeout(450); await tap(P, hb2[0], hb2[1]);
        check(await P.evaluate(() => GameHost.state() === 'paused'), 'Home opens My PC\'s menu (like a pad\'s Guide button)');
        const item = (t) => P.evaluate((t) => { const b = [...document.querySelectorAll('#pause-items button')].find((b) => b.textContent === t); if (b) b.click(); return !!b; }, t);
        check(await item('Hide touch pad'), 'the pause menu has "Hide touch pad"');
        check(await P.evaluate(() => [...document.querySelectorAll('#pause-items button')].some((b) => b.textContent === 'Show touch pad') && ![...document.querySelectorAll('#pause-items button')].some((b) => b.textContent === 'Touch pad settings')), 'then "Show touch pad" (and no pad settings while hidden)');
        await item('Resume'); await wait(P);
        check(!(await padOf(P)) && await P.evaluate(() => GameHost.state() === 'running' && Store.rawGet('arc_dev_padhide')['app-pad-def'] === 1), 'hidden: the game runs with no pad, kept for this app');
        await P.evaluate(() => GameHost.openPause()); await wait(P);
        await item('Show touch pad'); await item('Resume'); await wait(P);
        check(!!(await padOf(P)) && await P.evaluate(() => !!document.getElementById('vp-dpad')), 'shown again from the pause menu, with the D-pad');
        await P.evaluate(() => VirtualPad.openSettings()); await wait(P);
        await chip('Hide the pad'); await wait(P);
        check(!(await padOf(P)) && await P.evaluate(() => GameHost.state() === 'running' && TouchPad.hidden()), '"Hide the pad" in the panel hides it and the game goes on');
        await P.evaluate(() => TouchPad.setHidden(false)); await wait(P);
        // quitting removes the pad
        await P.evaluate(() => { GameHost.openPause(); }); await wait(P);
        await P.evaluate(() => { const b = document.querySelectorAll('#pause-items button'); b[b.length - 1].click(); });
        await P.waitForFunction(() => window.GameHost && window.GameHost.state() === 'idle', null, { timeout: 8000 });
        check(!(await padOf(P)), 'quitting the app removes the pad');

        // portrait phone
        const Q = await setup({ phone: true, viewport: { width: 390, height: 844 } });
        const fq = await openApp(Q, 'pad-def');
        await Q.evaluate(() => { const c = document.getElementById('turn-cover'); if (c) c.remove(); });   // the "turn your phone" cover is tested in section 33
        const pq = await padOf(Q);
        const inView = (e) => e.x - e.w / 2 >= -1 && e.x + e.w / 2 <= 391 && e.y - e.h / 2 >= -1 && e.y + e.h / 2 <= 845;
        check(!!pq && inView(pq.stick) && inView(pq.labels.A) && inView(pq.labels.B), 'phone 390x844: the pad fits the screen');
        const fq1 = await fingers(Q);
        await fq1.down(1, pq.stick.x, pq.stick.y + 45); await Q.waitForTimeout(150);
        check(await fq.evaluate(() => MyPC.isDown('down')), 'portrait: stick down = "down"');
        await fq1.up(1);
        await Q.context().close();

        // the manifest: custom buttons and scale; touch:false; the app's own pad option; an app that draws its own pad
        const C1 = await setup({ phone: true }); await openApp(C1, 'pad-cust');
        const pc = await padOf(C1);
        check(!!pc && !!pc.labels.X && !pc.labels.A && !pc.labels.B && pc.stick.w > 100, '"touch": { buttons, catalog, scale } from the store changes the buttons and the stick size');
        await C1.context().close();
        const C2 = await setup({ phone: true }); await openApp(C2, 'pad-off');
        check(!(await padOf(C2)), '"touch": false: the shell draws nothing (the app has its own touch UI)');
        await C2.context().close();
        const C3 = await setup({ phone: true }); await openApp(C3, 'pad-optoff');
        check(!(await padOf(C3)), 'MyPC.init({ pad: false }) hides the shell pad too');
        await C3.context().close();
        const C4 = await setup({ phone: true }); const f4 = await openApp(C4, 'pad-own');
        await C4.waitForTimeout(400);
        const p4 = await padOf(C4);
        check(!!p4 && !!p4.labels.A && await f4.evaluate(() => MyPC.pad.active()) && await f4.evaluate(() => !document.querySelector('body > div[style*="99999"]')), 'an app that calls MyPC.pad.init({ force: true }): the SHELL draws that pad (right size, above the app), nothing is drawn inside the app');
        const f4t = await fingers(C4);
        await f4t.down(1, p4.stick.x + 45, p4.stick.y); await C4.waitForTimeout(150);
        check(await f4.evaluate(() => window.padLog.some((e) => e[0] === 'right' && e[1] === true) && !MyPC.isDown('right')), 'the presses of the app\'s own pad go to the app\'s onAction (not to the default input)');
        await f4t.up(1); await C4.waitForTimeout(100);
        check(await f4.evaluate(() => window.padLog.some((e) => e[0] === 'right' && e[1] === false)), 'and the release too');
        await f4.evaluate(() => MyPC.pad.hide()); await C4.waitForTimeout(300);
        const p5 = await padOf(C4);
        check(!!p5 && !!p5.labels.A, 'MyPC.pad.hide() gives the screen back to the shell\'s default pad');
        await C4.context().close();

        // not on a desktop mouse browser, not on a TV (even with touch), unless forced
        const D = await setup({ desktop: true }); await openApp(D, 'pad-def');
        check(!(await padOf(D)), 'a desktop browser with a mouse: no pad');
        await D.context().close();
        const T = await setup({ phone: true }); await T.addInitScript(() => { window.tizen = { tvinputdevice: { registerKey() {}, registerKeyBatch() {} }, application: { getCurrentApplication() { return { exit() {} }; } }, systeminfo: { getCapability() { return '8.0'; } } }; });
        await openApp(T, 'pad-def');
        check(!(await padOf(T)), 'on a TV (Tizen), never, even with a touch screen');
        await T.context().close();
        const F = await setup({ desktop: true }); await F.addInitScript(() => localStorage.setItem('arc_dev_touchpad', '1'));
        await openApp(F, 'pad-def');
        check(!!(await padOf(F)), 'forced for debugging (arc_dev_touchpad = 1, set by ?pad=1): shown on a desktop');
        check(!Object.keys(await F.evaluate(() => Backup.snapshot())).some((k) => /touchpad/.test(k)), 'the debugging switch is not part of the cloud backup');
        await F.context().close();

        // standalone SDK on a phone: MyPC.init({ pad: true }) shows the pad and feeds the SDK directly (no fake keyboard events)
        const S = await setup({ phone: true });
        await S.goto(APP + 'index.html');
        await S.waitForFunction(() => window.MyPC && MyPC.info() && MyPC.info().standalone);
        await S.evaluate(() => { window.keyEvents = 0; document.addEventListener('keydown', () => window.keyEvents++, true); });
        const ps = await padOf(S);
        check(!!ps && !!ps.labels.A, 'standalone on a phone: MyPC.init({ pad: true }) shows the pad');
        const fs2 = await fingers(S);
        await fs2.down(1, ps.stick.x + 45, ps.stick.y); await S.waitForTimeout(150);
        check(await S.evaluate(() => MyPC.isDown('right') && window.keyEvents === 0), 'standalone: the pad drives the SDK input directly (0 keyboard events)');
        await fs2.up(1);
        await S.context().close();

        // validation and the copies
        const clean = await P.evaluate(() => ({
            off: TouchPad.clean(false).off === true,
            def: TouchPad.clean(undefined).buttons.length === 2 && TouchPad.clean(true).catalog.length === 4 && TouchPad.clean(true).std && TouchPad.clean({ scale: { btn: 1.2 } }).std && !TouchPad.clean({ buttons: [{ label: 'A', action: 'ok' }] }).std,
            long: TouchPad.clean({ buttons: [{ label: 'ABCD', action: 'ok' }, { label: 'Z', action: 'fly' }] }).buttons.length === 2,
            max: TouchPad.clean({ catalog: Array.from({ length: 12 }, (_, i) => ({ label: 'b' + i, action: 'ok' })) }).catalog.length === 8,
            scale: TouchPad.clean({ scale: { stick: 9, btn: 1.25 } }).scale.stick === undefined && TouchPad.clean({ scale: { stick: 9, btn: 1.25 } }).scale.btn === 1.25
        }));
        check(Object.values(clean).every(Boolean), 'TouchPad.clean: false = off, bad labels / actions dropped, 8 entries at most, scale limited (' + JSON.stringify(clean) + ')');
        const lib = require(path.join(ROOT, 'installer/installer-lib.js'));
        const base0 = 'https://x.github.io/g_x/';
        const mf = (touch) => ({ mypc: 1, id: 'abc', name: 'Abc', touch });
        let bad = [];
        for (const t of [{ buttons: [{ label: 'ABCD', action: 'ok' }] }, { buttons: [{ label: 'A', action: 'jump' }] }, { catalog: Array.from({ length: 9 }, (_, i) => ({ label: 'b', action: 'ok' })) }, { scale: { stick: 5 } }, 'yes']) { try { lib.toApp(mf(t), base0, 0); bad.push('accepted ' + JSON.stringify(t)); } catch (e) { /* refused: good */ } }
        check(bad.length === 0, 'the App Store Manager refuses a bad "touch" (label > 3 chars, unknown action, > 8 entries, bad scale)' + bad.join('; '));
        check(lib.toApp(mf(false), base0, 0).touch === false && lib.toApp(mf({ buttons: [{ label: 'A', action: 'ok' }] }), base0, 0).touch.buttons.length === 1 && !('touch' in lib.toApp(mf(undefined), base0, 0)), '"touch": false and { buttons } are stored in the app document; nothing is stored by default');
        check(/'touch'(, '\w+')*\]\)/.test(fs.readFileSync(path.join(ROOT, 'firebase/firestore.rules'), 'utf8')) && /d\.touch is map/.test(fs.readFileSync(path.join(ROOT, 'firebase/firestore.rules'), 'utf8')), 'the Firestore rules accept the "touch" field');
        const norm = (t) => t.replace('window.VirtualPad = (function', 'var VirtualPad = (function').split('\n').map((l) => l.trim()).join('\n').trim();
        const canon = norm(fs.readFileSync(path.join(ROOT, 'sdk/pad/virtual-pad.js'), 'utf8'));
        const shellCopy = fs.readFileSync(path.join(ROOT, 'js/core/virtual-pad.js'), 'utf8');
        const sdkText = fs.readFileSync(path.join(ROOT, 'sdk/mypc-sdk.js'), 'utf8');
        const sdkBlock = norm(sdkText.slice(sdkText.indexOf('/* vpad:begin'), sdkText.indexOf('/* vpad:end */')).replace(/^.*\n/, ''));
        check(norm(shellCopy) === canon.replace('var VirtualPad = (function', 'window.VirtualPad = (function').replace('var VirtualPad', 'window.VirtualPad') || norm(shellCopy).replace('window.VirtualPad = (function', 'var VirtualPad = (function') === canon, 'js/core/virtual-pad.js is the same file as sdk/pad/virtual-pad.js (node tools/sync-pad.mjs)');
        check(sdkBlock === canon, 'the copy inside sdk/mypc-sdk.js is the same library (node tools/sync-pad.mjs)');
        check(P.errors.length === 0, 'no page errors ' + P.errors.join('; '));
        await P.context().close();
    }

    // ---- 33. installable web app + landscape on phones
    {
        const mfst = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
        const sizes = mfst.icons.map((i) => i.sizes);
        check(mfst.display === 'fullscreen' && mfst.orientation === 'landscape' && mfst.start_url && sizes.includes('192x192') && sizes.includes('512x512') && mfst.icons.some((i) => i.purpose === 'maskable'), 'manifest.webmanifest: installable (fullscreen, landscape, 192 + 512 + maskable icons)');
        check(mfst.icons.every((i) => fs.existsSync(path.join(ROOT, i.src))) && /addEventListener\('fetch'/.test(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8')), 'the icons exist and sw.js has a fetch handler');
        const W = await newPage(browser, base, {}, { phone: true, viewport: { width: 390, height: 844 } });
        await W.goto(base + 'index.html');
        await W.waitForFunction(() => window.PWA, null, { timeout: 15000 });
        const w1 = await W.evaluate(() => ({ link: !!document.querySelector('link[rel=manifest]'), sw: 'serviceWorker' in navigator, cover: (document.getElementById('turn-cover') || {}).hidden }));
        check(w1.link && w1.cover === false, 'phone held upright: the "turn your phone" cover shows');
        await W.setViewportSize({ width: 844, height: 390 });
        await W.waitForFunction(() => document.getElementById('turn-cover').hidden === true, null, { timeout: 3000 });
        check(true, 'phone on its side: the cover goes away');
        await W.waitForTimeout(800);
        const fitR = await W.evaluate(() => { const r = document.getElementById('stage').getBoundingClientRect(); return [r.top, r.bottom, r.left, r.right, innerWidth, innerHeight]; });
        check(fitR[0] >= -1 && fitR[1] <= fitR[5] + 1 && fitR[2] >= -1 && fitR[3] <= fitR[4] + 1 && (fitR[1] - fitR[0] > fitR[5] - 2 || fitR[3] - fitR[2] > fitR[4] - 2), 'after turning the phone from upright to sideways the whole screen fits, nothing cut at the bottom (' + fitR.map(Math.round) + ')');
        const sw = await W.waitForFunction(() => navigator.serviceWorker.getRegistration().then((r) => !!r), null, { timeout: 8000 }).then(() => true, () => false);
        check(sw, 'the service worker registers');
        check(W.errors.length === 0, 'no page errors ' + W.errors.join('; '));
        await W.context().close();
    }

    // ---- 33a. phones held upright: Control Panel > Display (Screen rotation) and a tall screen that fills the phone
    console.log('33a. screen rotation and portrait');
    {
        const R = await newPage(browser, base, {}, { phone: true, viewport: { width: 390, height: 844 } });
        await R.goto(base + 'index.html');
        await R.waitForFunction(() => window.Desktop && document.querySelector('.dicon'), null, { timeout: 20000 });
        check(await R.evaluate(() => Rotation.mode() === 'landscape' && Rotation.want() === 'landscape' && document.getElementById('turn-cover').hidden === false), 'a phone starts in Landscape (held): upright in a browser tab the "turn your phone" cover shows');
        await R.evaluate(() => Win.open('settings', 'display'));
        const d1 = await R.evaluate(() => ({ title: document.querySelector('.set-title').textContent, row: document.querySelector('.set-row').textContent }));
        check(d1.title === 'Display' && /Screen rotation/.test(d1.row) && /Landscape/.test(d1.row), 'Control Panel > Display shows Screen rotation (' + d1.row + ')');
        await R.evaluate(() => { const r = document.querySelector('.set-row'); r.focus(); });
        await R.keyboard.press('ArrowLeft'); await R.waitForTimeout(100);
        check(await R.evaluate(() => Rotation.mode() === 'portrait' && Store.rawGet('arc_dev_ctrlphone').opt.orient === 'portrait'), 'the remote\'s arrows change it (Landscape < Portrait), kept on the phone');
        await R.keyboard.press('ArrowLeft'); await R.waitForTimeout(800);
        const t1 = await R.evaluate(() => { const r = document.getElementById('stage').getBoundingClientRect(); return { mode: Rotation.mode(), tall: document.documentElement.classList.contains('tall'), size: App.screenSize(), r: [r.left, r.top, r.width, r.height], cover: document.getElementById('turn-cover').hidden }; });
        check(t1.mode === 'auto' && t1.cover === true, 'Auto: no cover, the phone can be held upright (' + t1.mode + ')');
        check(t1.tall && t1.size.w === 1080 && t1.size.h === Math.round(1080 * 844 / 390) && Math.abs(t1.r[2] - 390) < 2 && Math.abs(t1.r[3] - 844) < 2 && Math.abs(t1.r[1]) < 1, 'upright, My PC fills the whole tall screen (1080 x ' + t1.size.h + ', ' + t1.r.map(Math.round) + ')');
        await R.evaluate(() => Win.close());
        const tb = await R.evaluate(() => { const c = document.getElementById('tray-clock').getBoundingClientRect(), b = [...document.querySelectorAll('#tb-apps .tb-btn')].filter((e) => e.offsetWidth).map((e) => e.getBoundingClientRect()); return { clockL: c.left, last: Math.max(...b.map((x) => x.right)), rot: document.getElementById('tray-rot').hidden }; });
        check(tb.last <= tb.clockL && tb.rot, 'upright, the taskbar buttons and the clock do not overlap; no Rotate button outside Manual (' + Math.round(tb.last) + ' <= ' + Math.round(tb.clockL) + ')');
        await R.evaluate(() => Rotation.set('manual'));
        check(await R.evaluate(() => Rotation.side() === 'portrait' && !document.getElementById('tray-rot').hidden), 'Manual: it stays as it is (upright here) and a Rotate button shows on the taskbar');
        await R.evaluate(() => document.getElementById('tray-rot').click());
        check(await R.evaluate(() => Rotation.side() === 'landscape' && Rotation.want() === 'landscape'), 'Rotate turns it sideways');
        await R.setViewportSize({ width: 844, height: 390 }); await R.waitForTimeout(800);
        check(await R.evaluate(() => !document.documentElement.classList.contains('tall') && App.screenSize().w === 1920 && document.getElementById('turn-cover').hidden), 'sideways: the 1920x1080 screen again, no cover');
        // a built-in game keeps 16:9 across the width of a tall screen; the game menu has Rotate screen in Manual
        await R.evaluate(() => Rotation.set('auto'));
        await R.setViewportSize({ width: 390, height: 844 }); await R.waitForTimeout(500);
        await R.evaluate(() => document.querySelector('[data-game="blocks"]').click());
        await R.waitForFunction(() => window.GameHost && GameHost.state() === 'running', null, { timeout: 15000 });
        await R.waitForTimeout(500);
        const g = await R.evaluate(() => { const r = document.querySelector('#game-frame-box iframe').getBoundingClientRect(); return { wide: document.getElementById('game-frame-box').classList.contains('wide'), r: [r.left, r.top, r.width, r.height] }; });
        check(g.wide && Math.abs(g.r[2] - 390) < 2 && Math.abs(g.r[3] - 390 * 9 / 16) < 2 && g.r[1] > 100, 'upright, a built-in game is shown 16:9 across the width, in the middle (' + g.r.map(Math.round) + ')');
        await R.evaluate(() => { Rotation.set('manual'); GameHost.openPause(); });
        check(await R.evaluate(() => [...document.querySelectorAll('#pause-items button')].some((b) => b.textContent === 'Rotate screen')), 'Manual: the game menu has Rotate screen');
        check(R.errors.length === 0, 'no page errors ' + R.errors.join('; '));
        await R.context().close();
        // the Android app: orient for app 2.4.0+ (MyPCNative 5); an older app cannot turn upright (held landscape, Display says to update)
        for (const v of [5, 4]) {
            const N = await newPage(browser, base, {}, { phone: true, viewport: { width: 844, height: 390 } });
            await N.addInitScript((ver) => { window.__nat = []; window.MyPCNative = { version: () => ver, settings: (j) => __nat.push(j), caps: () => '{}', motion: () => {}, active: () => {} }; }, v);
            await N.goto(base + 'index.html');
            await N.waitForFunction(() => window.Desktop && document.querySelector('.dicon'), null, { timeout: 20000 });
            await N.evaluate(() => { __nat.length = 0; Rotation.set('portrait'); Rotation.set('auto'); });
            const n = await N.evaluate(() => __nat.slice());
            if (v === 5) check(n[0] === '{"orient":"portrait","rotate":false}' && n[1] === '{"orient":"any","rotate":true}', 'Android app 2.4.0: Portrait and Auto go to the app (' + n.join(' ') + ')');
            else {
                await N.evaluate(() => { Rotation.set('portrait'); Win.open('settings', 'display'); });
                check(n[0] === '{"orient":"landscape","rotate":false}' && await N.evaluate(() => [...document.querySelectorAll('.set-row')].some((r) => /Update the My PC app/.test(r.textContent))), 'an older Android app stays sideways for Portrait, and Display asks to update the app (' + n.join(' ') + ')');
            }
            check(N.errors.length === 0, 'no page errors ' + N.errors.join('; '));
            await N.context().close();
        }
        // a TV: no Display page, never tall
        const T = await newPage(browser, base);
        await T.goto(base + 'index.html');
        await T.waitForFunction(() => window.Desktop && document.querySelector('.dicon'), null, { timeout: 20000 });
        await T.evaluate(() => Win.open('settings'));
        check(await T.evaluate(() => ![...document.querySelectorAll('.cp-tile')].some((b) => /Display/.test(b.textContent)) && !document.documentElement.classList.contains('tall') && document.getElementById('tray-rot').hidden), 'a TV has no Display page and no Rotate button');
        await T.context().close();
    }

    // ---- 33b. typing in a text field: the phone's keyboard types, B / Backspace are not Back until the field is left
    console.log('33b. text fields keep their keys while typing');
    {
        const ph = await newPage(browser, base, {}, { phone: true, viewport: { width: 844, height: 390 } });
        await ph.goto(base + 'index.html');
        await ph.waitForFunction(() => window.Win && document.querySelector('[data-game]'), null, { timeout: 20000 });
        await ph.evaluate(() => Win.open('gamepad'));
        await ph.fill('.gc-code', '');
        await ph.focus('.gc-code');
        await ph.keyboard.type('bwasdzx');
        await ph.keyboard.press('Backspace');
        const st = await ph.evaluate(() => ({ v: document.querySelector('.gc-code').value, open: Win.isOpen(), f: document.activeElement === document.querySelector('.gc-code') }));
        check(st.v.toLowerCase() === 'bwasdz' && st.open && st.f, 'B, W A S D, Z, X type into the field and Backspace erases, nothing goes back (' + st.v + ')');
        const scaleNow = () => ph.evaluate(() => document.getElementById('stage').style.transform + '|' + document.getElementById('stage').style.top);
        const before = await scaleNow();
        await ph.setViewportSize({ width: 844, height: 190 }); await ph.waitForTimeout(800);       // the phone's keyboard takes the lower half
        const during = await scaleNow();
        check(before === during && await ph.evaluate(() => document.body.style.height === '390px'), 'the phone keyboard opening leaves the screen as it is (no shrinking into the space above it): ' + before + ' / ' + during);
        await ph.setViewportSize({ width: 844, height: 390 }); await ph.waitForTimeout(800);
        check(await scaleNow() === before && await ph.evaluate(() => !document.body.style.height), 'and the keyboard closing changes nothing');
        await ph.focus('.gc-code');
        await ph.keyboard.press('Escape');
        await ph.waitForFunction(() => document.activeElement !== document.querySelector('.gc-code'), null, { timeout: 2000 });
        check(await ph.evaluate(() => Win.isOpen()), 'Esc (the keyboard closing) leaves the field without going back');
        await ph.keyboard.press('Backspace');
        await ph.waitForFunction(() => !Win.isOpen(), null, { timeout: 2000 });
        check(true, 'out of the field, Backspace is Back again');
        check(ph.errors.length === 0, 'no page errors ' + ph.errors.join('; '));
        await ph.context().close();
    }

    // ---- 34. phone controller: P1 / P2 from a phone, reconnecting when the TV changes page
    console.log('34. phone controller (Game controller app, Controllers, Input.remote)');
    {
        const db = {};
        const tv = await newPage(browser, base, db);
        await tv.goto(base + 'index.html');
        await tv.waitForFunction(() => window.Controllers && document.querySelector('[data-game]'), null, { timeout: 20000 });
        check(await tv.evaluate(() => !Controllers.on() && Controllers.players()[1] === null), 'off by default: nothing is opened');
        check(Object.keys(db.rooms || {}).length === 0, 'no room is created while it is off');
        await tv.evaluate(() => Controllers.setOn(true));
        const code = await tv.evaluate(() => Controllers.code());
        await tv.waitForFunction((c) => true, code);
        await new Promise((r) => setTimeout(r, 1500));
        check(await tv.evaluate(() => Controllers.status().s === 'ready'), 'the status says Ready once the room is open');
        check(/^[a-z0-9]{8}$/.test(code) && db.rooms && db.rooms[code] && db.rooms[code].app === 'controller' && db.rooms[code].max === 3, 'a room "controller" is open under the TV\'s code');
        // Settings > Devices: the phone controller has its own page with the pairing QR code
        await tv.evaluate(() => Win.open('settings', 'devices'));
        check(!(await tv.evaluate(() => [...document.querySelectorAll('.set-row')].some((r) => /Auto rotate|Vibration/.test(r.textContent)))), 'the TV\'s Devices page has no phone rows (Auto rotate, Vibration)');
        await tv.evaluate(() => [...document.querySelectorAll('.set-row')].find((r) => /Phone controller/.test(r.textContent)).click());
        await tv.waitForSelector('.set-qr svg path', { timeout: 3000 });
        const qr = await tv.evaluate(() => ({ url: Controllers.pairUrl(), code: document.querySelector('.set-qr-code').textContent, toggle: [...document.querySelectorAll('.set-row')].some((r) => /Phone controller/.test(r.textContent)), focus: document.activeElement.textContent }));
        check(qr.url.endsWith('index.html?pair=' + code) && /^https:/.test(qr.url) && qr.code.indexOf(code.toUpperCase()) >= 0 && qr.toggle, 'the Phone controller page shows a QR code with the pairing link (' + qr.url + ') and the code under it');
        check(await tv.evaluate(() => { const m = QR.matrix(Controllers.pairUrl()); return m && m.length >= 21 && m.length % 4 === 1 && m[0][0] && m[6][6] && !m[7][7]; }), 'the QR matrix has its finder patterns');
        await tv.keyboard.press('Escape');
        check(await tv.evaluate(() => !document.querySelector('.set-qr') && [...document.querySelectorAll('.set-row')].some((r) => /Phone controller/.test(r.textContent))), 'Back returns to Devices, where the phone controller is one row');
        await tv.evaluate(() => Win.close());
        const phone = async (n, p) => {
            const ph = await newPage(browser, base, db, { phone: true, viewport: { width: 844, height: 390 } });
            await ph.goto(base + 'index.html');
            await ph.waitForFunction(() => window.Win && document.querySelector('[data-game]'), null, { timeout: 20000 });
            await ph.evaluate(() => Win.open('gamepad'));
            await ph.fill('.gc-code', code);
            if (p === 2) await ph.click('.gc-join .btn:nth-of-type(2)');
            await ph.click('.gc-go');
            return ph;
        };
        // the pad is the virtual pad My PC already has (js/core/virtual-pad.js): its round buttons carry their label
        const vbtn = (ph, label) => ph.evaluate((l) => { const b = [...document.querySelectorAll('div')].find((d) => d.textContent === l && d.style.borderRadius === '50%' && d.style.display !== 'none'); const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, label);
        const press = async (ph, label, down) => { const [x, y] = await vbtn(ph, label); await ph.mouse.move(x, y); if (down) await ph.mouse.down(); else await ph.mouse.up(); };
        check(await tv.evaluate(() => !Desktop.appById('gamepad')), 'the Game controller app is not on the TV');
        const P1 = await phone(1, 1);
        await tv.waitForFunction(() => Controllers.players()[1], null, { timeout: 40000 });
        check(await P1.evaluate(() => !!Desktop.appById('gamepad') && !!document.getElementById('tb-gamepad')), 'the Game controller app is a system app on the phone (taskbar)');
        await P1.waitForFunction(() => window.GamepadApp && window.GamepadApp.linked(), null, { timeout: 10000 });
        check(await P1.evaluate(() => VirtualPad.active() && !!document.getElementById('vp-stick') && !document.querySelector('.gc-bar').hidden && document.querySelector('.gc-badge').textContent === 'P1'), 'the phone shows the existing virtual pad (stick, A, B, gear, pause) as P1');
        await press(P1, 'A', true);
        await tv.waitForFunction(() => Input.isDownDev('pad101', 'jump') && Input.isDownDev('pad101', 'confirm'), null, { timeout: 3000 });
        check(!(await tv.evaluate(() => Input.isDownDev('pad102', 'jump'))), 'P1 button A (like a Nintendo pad\'s A, owner decision 2026-11-11) = OK / jump on the "pad101" device only');
        await press(P1, 'A', false);
        await tv.waitForFunction(() => !Input.isDownDev('pad101', 'jump'), null, { timeout: 3000 });
        check(true, 'releasing the button releases the action');
        const st = await P1.evaluate(() => { const r = document.getElementById('vp-stick').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, r.width / 2]; });
        await P1.mouse.move(st[0], st[1]); await P1.mouse.down(); await P1.mouse.move(st[0] + st[2] * 0.9, st[1], { steps: 3 });
        await tv.waitForFunction(() => Input.isDownDev('pad101', 'right') && !Input.isDownDev('pad101', 'left'), null, { timeout: 3000 });
        check(true, 'pushing the stick to the right gives right');
        await P1.mouse.up();
        await tv.waitForFunction(() => !Input.isDownDev('pad101', 'right'), null, { timeout: 3000 });
        check(await P1.evaluate(() => [...document.querySelectorAll('div')].filter((d) => /^[AB]$/.test(d.textContent) && d.style.borderRadius === '50%').every((d) => getComputedStyle(d).display === 'flex' && getComputedStyle(d).justifyContent === 'center')), 'the button letters are centred');
        // floating stick: a touch anywhere in the left half puts the stick there; it goes back when the finger is lifted
        const home = await P1.evaluate(() => { const r = document.getElementById('vp-stick').getBoundingClientRect(); return [r.left, r.top]; });
        await P1.mouse.move(320, 170); await P1.mouse.down(); await P1.mouse.move(320 - 60, 170, { steps: 3 });
        await tv.waitForFunction(() => Input.isDownDev('pad101', 'left'), null, { timeout: 3000 });
        const moved = await P1.evaluate(() => { const r = document.getElementById('vp-stick').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
        check(Math.abs(moved[0] - 320) < 2 && Math.abs(moved[1] - 170) < 2, 'a touch in the left half starts the stick under the finger (' + moved.map(Math.round) + ')');
        await P1.mouse.up();
        await tv.waitForFunction(() => !Input.isDownDev('pad101', 'left'), null, { timeout: 3000 });
        const back = await P1.evaluate(() => { const r = document.getElementById('vp-stick').getBoundingClientRect(); return [r.left, r.top]; });
        check(back[0] === home[0] && back[1] === home[1], 'lifting the finger puts the stick back in its place and releases the direction');
        check(!(await P1.evaluate(() => { const e = document.elementFromPoint(640, 170); return e && e.parentNode && e.parentNode.id !== 'vp-stick' && e.style.width === '50%'; })), 'the right half is not a stick zone');
        const P2 = await phone(2, 2);
        await tv.waitForFunction(() => Controllers.players()[2], null, { timeout: 40000 });
        await press(P2, 'A', true);
        await tv.waitForFunction(() => Input.isDownDev('pad102', 'confirm'), null, { timeout: 3000 });
        check(!(await tv.evaluate(() => Input.isDownDev('pad101', 'confirm'))) && await tv.evaluate(() => Input.isDownDev('pad102', 'jump')), 'P2 button A = OK and jump, like a Nintendo pad\'s A (owner decision 2026-11-11), on the "pad102" device (the second player every game supports)');
        await press(P2, 'A', false);
        await press(P2, 'Y', true);
        await tv.waitForFunction(() => Input.isDownDev('pad102', 'run') && !Input.isDownDev('pad102', 'cancel'), null, { timeout: 3000 });
        await press(P2, 'Y', false);
        const dia = await P2.evaluate(() => { const c = {}; for (const l of ['A', 'B', 'X', 'Y']) { const d = [...document.querySelectorAll('div')].find((e) => e.textContent === l && e.style.borderRadius === '50%'); const r = d.getBoundingClientRect(); c[l] = [r.left + r.width / 2, r.top + r.height / 2]; } return c; });
        check(dia.A[0] > dia.X[0] && dia.Y[0] < dia.X[0] && dia.X[1] < dia.A[1] && dia.B[1] > dia.A[1] && Math.abs(dia.X[0] - dia.B[0]) < 2 && Math.abs(dia.A[1] - dia.Y[1]) < 2, 'A B X Y in the Nintendo diamond: A right, B bottom, X top, Y left; Y = run (' + JSON.stringify(dia) + ')');
        check(db.rooms[code].n === 3, 'the room counts the TV and both phones');
        // the Home button (like a Nintendo Switch's): below and left of the face buttons
        const hb = await P2.evaluate(() => { const r = document.getElementById('vp-home').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
        check(hb[0] < dia.Y[0] && hb[1] > dia.Y[1], 'the pad has a Home button below and left of the face buttons (' + hb.map(Math.round) + ')');
        // every phone button must do what the same button of a real Nintendo pad does on the TV: a fake pad (standard mapping,
        // read by position) is pressed and compared with the phone's button, for each of A B X Y
        await tv.evaluate(() => {
            window.__gp = { index: 0, id: 'Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)', connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
            window.__orig = navigator.getGamepads; navigator.getGamepads = () => [window.__gp];
            window.dispatchEvent(new Event('gamepadconnected'));
            window.__held = (dev) => ['jump', 'confirm', 'run', 'cancel'].filter((a) => Input.isDownDev(dev, a)).join();
        });
        const real = {};
        // a Switch Pro on a TV comes by LETTER (A = 0, B = 1, X = 2, Y = 3, imad's TV 2026-11-11): A = OK, B = Back (owner decision)
        for (const [name, idx] of [['A', 0], ['B', 1], ['X', 2], ['Y', 3]]) {
            await tv.evaluate((i) => { __gp.buttons[i] = { pressed: true, value: 1 }; }, idx);
            await tv.waitForFunction(() => __held('pad0') !== '', null, { timeout: 3000 });
            real[name] = await tv.evaluate(() => __held('pad0'));
            await tv.evaluate((i) => { __gp.buttons[i] = { pressed: false, value: 0 }; }, idx);
            await tv.waitForFunction(() => __held('pad0') === '', null, { timeout: 3000 });
        }
        for (const name of ['A', 'B', 'X', 'Y']) {
            await press(P2, name, true);
            await tv.waitForFunction(() => __held('pad102') !== '', null, { timeout: 3000 });
            const got = await tv.evaluate(() => __held('pad102'));
            check(got.split(',').sort().join() === real[name].split(',').sort().join(), 'phone ' + name + ' sends what ' + name + ' of a Nintendo pad sends (' + got + ' = ' + real[name] + ')');
            await press(P2, name, false);
            await tv.waitForFunction(() => __held('pad102') === '', null, { timeout: 3000 });
        }
        check(await tv.evaluate(() => Input.pads().some((q) => q.index === 102 && q.standard && q.buttons === 18)), 'the phone is a standard gamepad (pad102, 18 buttons like a Switch Pro controller) in the TV\'s pad list, like a real controller');
        // + = Start (menu), Home = Guide: the same actions a real pad's Start and Home give
        await tv.evaluate(() => { window.__seen = []; const r = Input.virtualPad; Input.virtualPad = function (p, m) { if (m & (1 << 9)) __seen.push('menu'); if (m & (1 << 16)) __seen.push('guide'); return r.apply(this, arguments); }; });
        const [px, py] = await P2.evaluate(() => { const e = [...document.querySelectorAll('div')].find((d) => d.textContent === '+'); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
        await P2.mouse.move(px, py); await P2.mouse.down(); await P2.mouse.up();
        await P2.mouse.move(hb[0], hb[1]); await P2.mouse.down(); await P2.mouse.up();
        await tv.waitForFunction(() => __seen.join() === 'menu,guide', null, { timeout: 3000 });
        check(true, 'phone + sets button 9 (a pad\'s Start) and Home sets button 16 (a pad\'s Guide button) of the virtual gamepad');
        // L and R are on the pad at first: shoulder pills at the top corners, L = button 4 and R = button 5 like a Switch Pro controller
        const sh = await P2.evaluate(() => { const c = {}; for (const l of ['L', 'R', 'ZL', 'ZR']) { const d = [...document.querySelectorAll('div')].find((e) => e.textContent === l && /px$/.test(e.style.borderRadius) && e.style.position === 'absolute'); const r = d && d.getBoundingClientRect(); c[l] = d && d.style.display === 'flex' ? [r.left + r.width / 2, r.top + r.height / 2, r.width, r.height] : null; } return c; });
        check(sh.L && sh.R && !sh.ZL && !sh.ZR && sh.L[0] < 844 / 3 && sh.R[0] > 844 * 2 / 3 && sh.L[1] < dia.X[1] && sh.R[1] < dia.X[1] && Math.abs(sh.L[1] - sh.R[1]) < 2 && sh.L[2] > sh.L[3], 'L and R are shown at first, as pills at the top left and top right (ZL / ZR only from the gear) (' + JSON.stringify(sh) + ')');
        await tv.evaluate(() => { window.__lr = []; const r = Input.virtualPad; Input.virtualPad = function (p, m) { if (m & (1 << 4)) __lr.push('L'); if (m & (1 << 5)) __lr.push('R'); return r.apply(this, arguments); }; });
        for (const l of ['L', 'R']) { const q = sh[l]; await P2.mouse.move(q[0], q[1]); await P2.mouse.down(); await P2.mouse.up(); }
        await tv.waitForFunction(() => __lr.indexOf('L') >= 0 && __lr.indexOf('R') >= 0, null, { timeout: 3000 });
        check(true, 'phone L sets button 4 and R sets button 5 of the virtual gamepad (a Switch Pro controller\'s L and R)');
        await tv.evaluate(() => { __gp.buttons[16] = { pressed: true, value: 1 }; });
        await tv.waitForFunction(() => Input.isDownDev('pad0', 'guide'), null, { timeout: 3000 });
        check(true, 'a real pad\'s Home button is the same Guide action');
        await tv.evaluate(() => { __gp.buttons[16] = { pressed: false, value: 0 }; navigator.getGamepads = window.__orig; window.dispatchEvent(new Event('gamepaddisconnected')); });
        // nothing over the pad but the status (bottom centre); the gear (top left) panel has Mode, Advanced settings, Leave
        const lay = await P2.evaluate(() => {
            const bar = document.querySelector('.gc-bar'), r = bar.getBoundingClientRect();
            const gear = [...document.querySelectorAll('div')].find((d) => d.textContent === '⚙');
            gear.click();
            const acts = [...document.querySelectorAll('[data-act]')].map((b) => b.getAttribute('data-act') + ':' + b.textContent);
            return { btns: bar.querySelectorAll('button, .btn').length, mid: Math.abs(r.left + r.width / 2 - innerWidth / 2), low: innerHeight - r.bottom, state: bar.textContent, setbtn: !!document.querySelector('.gc-setbtn'), acts, barHidden: bar.hidden };
        });
        check(lay.btns === 0 && !lay.setbtn && lay.mid < 3 && lay.low < 40 && /P[12]/.test(lay.state), 'Buttons mode: no buttons over the pad, only the connection status at the bottom centre (' + JSON.stringify(lay) + ')');
        check(lay.acts.join() === 'mode:Mode,advanced:Advanced settings,leave:Leave' && lay.barHidden, 'the pad\'s gear panel (top left) has Mode, Advanced settings and Leave at the top; the status hides under it');
        // Advanced settings: a browser shows only what it can do (no Background); big checkboxes; GamePad
        // draws a D-pad in place of the stick, kept on the phone
        await P2.evaluate(() => document.querySelector('[data-act="advanced"]').click());
        const ps = await P2.evaluate(() => ({ opts: [...document.querySelectorAll('.gc-phoneset input[type=checkbox]')].map((c) => c.getAttribute('data-opt') + ':' + c.checked), pad: VirtualPad.active(),
            size: document.querySelector('.gc-phoneset input[type=checkbox]').getBoundingClientRect().height }));
        check(ps.opts.indexOf('dpad:false') >= 0 && ps.opts.join() === 'awake:true,bg:true,dpad:false' && !ps.pad, 'Advanced settings always lists Stay awake, Background and GamePad, even in a browser, over a hidden pad (' + ps.opts + ')');
        check(await P2.evaluate(() => { const r = document.querySelector('.gc-phoneset .gc-rot'); return !!r && /Screen rotation/.test(r.textContent) && /Landscape/.test(r.textContent); }), 'Settings has Screen rotation (Landscape at first: the screen never turns), the same setting as Control Panel > Display');
        check(ps.size >= 24, 'the checkboxes are finger-sized (' + Math.round(ps.size) + ' px)');
        await P2.click('.gc-phoneset [data-opt=dpad]');
        await P2.click('.gc-phoneset .btn-primary');
        check(await P2.evaluate(() => VirtualPad.active() && !!document.getElementById('vp-dpad') && !document.getElementById('vp-stick') && PadSpec.dpad() === true && Store.rawGet('arc_dev_vpad:controller2').dp === true), 'GamePad on: a D-pad in place of the stick, kept on the phone in the pad\'s layout (the same D-pad choice as its gear panel and the pad over games)');
        const dp = await P2.evaluate(() => { const r = document.getElementById('vp-dpad').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, r.width / 2]; });
        await P2.mouse.move(dp[0] + dp[2] * 0.7, dp[1]); await P2.mouse.down();
        await tv.waitForFunction(() => Input.isDownDev('pad102', 'right') && !Input.isDownDev('pad102', 'up'), null, { timeout: 3000 });
        await P2.mouse.move(dp[0] + dp[2] * 0.6, dp[1] - dp[2] * 0.6, { steps: 3 });          // slide to the corner: up + right
        await tv.waitForFunction(() => Input.isDownDev('pad102', 'right') && Input.isDownDev('pad102', 'up'), null, { timeout: 3000 });
        await P2.mouse.up();
        await tv.waitForFunction(() => !Input.isDownDev('pad102', 'right') && !Input.isDownDev('pad102', 'up'), null, { timeout: 3000 });
        check(true, 'the D-pad gives right, slides to up + right (diagonal) and lets go of both');
        // a third phone cannot take a player that is taken, and unknown phones are refused once pairing is closed
        await tv.evaluate(() => Controllers.pair(0));
        const P3 = await phone(3, 1);
        await P3.waitForFunction(() => /./.test(document.querySelector('.gc-err').textContent), null, { timeout: 40000 });
        check(await P3.evaluate(() => document.querySelector('.gc-join').hidden === false), 'a new phone is refused when pairing is closed');
        // the TV changes page (a game opens): the phones come back by themselves
        await tv.goto(base + 'index.html?play=blocks');
        await tv.waitForFunction(() => window.Controllers && Controllers.players()[1] && Controllers.players()[2], null, { timeout: 60000 });
        check(true, 'after the TV loaded another page both phones reconnected as P1 and P2');
        check(await tv.evaluate(() => !Input.isDownDev('pad101', 'right') && !Input.isDownDev('pad102', 'run')), 'nothing stays pressed across the page change');
        await tv.waitForFunction(() => GameHost.state() === 'running', null, { timeout: 30000 });
        const homeBtn = async () => { const h = await P2.evaluate(() => { const r = document.getElementById('vp-home').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }); await P2.mouse.move(h[0], h[1]); await P2.mouse.down(); await P2.mouse.up(); };
        await homeBtn();
        await tv.waitForFunction(() => GameHost.state() === 'paused', null, { timeout: 3000 });
        check(true, 'Home (the Guide button) in a game opens My PC\'s pause menu, like a real pad\'s Home');
        await press(P2, 'B', true); await press(P2, 'B', false);
        await tv.waitForFunction(() => GameHost.state() === 'running', null, { timeout: 3000 });
        check(true, 'B (back, like a Nintendo pad\'s B) closes the pause menu');
        db.down = true; await tv.evaluate(() => { Controllers.setOn(false); Controllers.setOn(true); });
        await tv.waitForFunction(() => Controllers.status().s === 'error', null, { timeout: 15000 });
        check(await tv.evaluate(() => Controllers.status().err === 'offline'), 'a room that cannot open shows the reason (offline) instead of nothing');
        db.down = false;
        await tv.evaluate(() => Controllers.setOn(false));
        await P1.waitForFunction(() => !(window.GamepadApp && window.GamepadApp.linked()), null, { timeout: 10000 });
        check(await tv.evaluate(() => Controllers.players()[1] === null), 'turning it off disconnects the phones');
        // the pad layout is kept: show C from the gear panel, leave, open the app again
        await P1.evaluate(() => Win.close());
        await P1.evaluate(() => Win.open('gamepad'));
        await P1.waitForFunction(() => VirtualPad.active() && GamepadApp.running(), null, { timeout: 5000 });
        check(true, 'a phone that was paired connects to its TV by itself when the Game controller opens');
        await P1.evaluate(() => { [...document.querySelectorAll('div')].find((d) => d.textContent === '⚙').click(); });
        await P1.evaluate(() => { [...document.querySelectorAll('div')].find((d) => d.textContent === 'Y' && d.style.borderRadius !== '50%').click(); [...document.querySelectorAll('div')].find((d) => d.textContent === 'Close').click(); });
        await P1.evaluate(() => Win.close());
        await P1.reload();
        await P1.waitForFunction(() => window.Win && document.querySelector('[data-game]'), null, { timeout: 20000 });
        await P1.evaluate(() => Win.open('gamepad'));
        await P1.waitForFunction(() => VirtualPad.active(), null, { timeout: 5000 });
        check(await P1.evaluate(() => [...document.querySelectorAll('div')].some((d) => d.textContent === 'Y' && d.style.borderRadius === '50%' && d.style.display === 'none') && [...document.querySelectorAll('div')].some((d) => d.textContent === 'X' && d.style.borderRadius === '50%' && d.style.display === 'flex') && !!Store.rawGet('arc_dev_vpad:controller2')), 'the pad settings are kept after closing the app and reloading (no setting up again; Y hidden here)');
        // Settings: Disconnect / Forget TV; a phone with no TV opens on Connect (not the code box: no keyboard popping up)
        await P1.evaluate(() => document.querySelector('[data-act="advanced"]').click());      // at once: the boot screen may still be fading out over it
        check(await P1.evaluate(() => !!document.querySelector('.gc-phoneset .gc-disc') && /^Forget TV/.test(document.querySelector('.gc-phoneset .gc-forget').textContent)), 'Settings has Disconnect and Forget TV while connected');
        await P1.click('.gc-phoneset .gc-forget');
        check(await P1.evaluate(() => !GamepadApp.running() && !Store.rawGet('arc_dev_ctrlphone').paired && !Store.rawGet('arc_dev_ctrlphone').code && document.querySelector('.gc-code').value === ''), 'Forget TV disconnects and forgets the code');
        await P1.evaluate(() => { Win.close(); Win.open('gamepad'); });
        await P1.waitForTimeout(300);
        check(await P1.evaluate(() => !GamepadApp.running() && document.activeElement === document.querySelector('.gc-go')), 'a forgotten TV is not connected again; the Game controller opens with Connect focused');
        check(tv.errors.length === 0 && P1.errors.length === 0 && P2.errors.length === 0, 'no page errors ' + tv.errors.concat(P1.errors, P2.errors).join('; '));
        for (const pg of [tv, P1, P2, P3]) await pg.context().close();
    }

    // ---- 34b. Buttons mode's mic button: the phone is the TV's microphone (Memo records from it); no Microphone mode any more
    console.log('34b. phone controller microphone in Buttons mode (phone mic -> TV, Memo)');
    {
        const db = {};
        const tv = await newPage(browser, base, db);
        await tv.goto(base + 'index.html');
        await tv.waitForFunction(() => window.Controllers && document.querySelector('[data-game]'), null, { timeout: 20000 });
        await tv.evaluate(() => Controllers.setOn(true));
        const code = await tv.evaluate(() => Controllers.code());
        await tv.waitForFunction(() => Controllers.status().s === 'ready', null, { timeout: 10000 });
        const ph = await newPage(browser, base, db, { phone: true, viewport: { width: 844, height: 390 } });
        await ph.goto(base + 'index.html');
        await ph.waitForFunction(() => window.Win && document.querySelector('[data-game]'), null, { timeout: 20000 });
        await ph.evaluate(() => Win.open('gamepad'));
        await ph.fill('.gc-code', code);
        const names = await ph.evaluate(() => [...document.querySelectorAll('.gc-modes .btn')].map((b) => b.textContent));
        check(names.indexOf('Microphone') < 0 && names[0] === 'Buttons', 'there is no separate Microphone mode any more (' + names.join(', ') + ')');
        await ph.evaluate(() => [...document.querySelectorAll('.gc-modes .btn')][0].click());
        await ph.click('.gc-go');
        await tv.waitForFunction(() => Controllers.modes()[1] === 'pad', null, { timeout: 40000 });
        await ph.waitForFunction(() => window.GamepadApp && GamepadApp.linked() && VirtualPad.active(), null, { timeout: 10000 });
        const pad = await ph.evaluate(() => {
            const vis = (e) => !!e && e.style.display !== 'none';
            const face = ['A', 'B', 'X', 'Y'].every((l) => [...document.querySelectorAll('div')].some((d) => d.textContent === l && d.style.borderRadius === '50%' && vis(d)));
            const m = document.getElementById('vp-mic'), pl = document.getElementById('vp-plus'), r = m && m.getBoundingClientRect(), q = pl.getBoundingClientRect();
            return { face, stick: !!document.getElementById('vp-stick'), home: vis(document.getElementById('vp-home')), plus: vis(pl), mic: vis(m), mx: r && r.left + r.width / 2, my: r && r.top, plusBottom: q.bottom, plusX: q.left + q.width / 2 };
        });
        check(pad.face && pad.stick && pad.home && pad.plus && pad.mic, 'Buttons mode shows the virtual pad (stick, A B X Y, +, Home) with its microphone button');
        check(Math.abs(pad.mx - pad.plusX) < 2 && pad.my > pad.plusBottom, 'the microphone button sits at the top centre, under the + button');
        await tv.evaluate(() => Win.open('memo'));
        await tv.waitForFunction(() => document.activeElement && document.activeElement.id === 'memo-new', null, { timeout: 5000 });
        check(await tv.evaluate(() => Mic.phone()), 'the TV sees a phone microphone (Mic.phone())');
        const tap = async () => { const r = await ph.evaluate(() => { const b = document.getElementById('vp-mic').getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }); await ph.mouse.move(r[0], r[1]); await ph.mouse.down(); await ph.mouse.up(); };
        await tap();                                                     // the phone's mic button = the Record key: a new memo starts
        await tv.waitForFunction(() => document.querySelector('.memo-mic.memo-on') && Mic.active(), null, { timeout: 8000 });
        await ph.waitForFunction(() => /229, 57, 53/.test(document.getElementById('vp-mic').style.background), null, { timeout: 8000 });
        check(true, 'the phone\'s mic button starts a memo on the TV, and the button turns red while the phone records');
        await tv.waitForTimeout(1600);
        await tap();                                                     // and stops it
        await tv.waitForFunction(() => !Mic.active() && document.activeElement && document.activeElement.id === 'memo-play', null, { timeout: 8000 });
        const m1 = await tv.evaluate(() => new Promise((ok) => MemoStore.list((e, l) => Promise.all(l.map((m) => m.parts[0].audio.arrayBuffer().then((b) => {
            const pcm = new Int16Array(b, 44); let peak = 0; for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
            return { n: m.parts.length, s: m.seconds, mime: m.parts[0].mime, size: m.parts[0].audio.size, rate: new DataView(b).getUint32(24, true), peak };
        }))).then(ok))));
        check(m1.length === 1 && m1[0].mime === 'audio/wav' && m1[0].rate === 16000 && m1[0].s >= 1 && m1[0].size > 16000 && m1[0].peak > 1000, 'the memo was recorded from the phone (16 kHz WAV over the link, not silence) ' + JSON.stringify(m1));
        await ph.waitForFunction(() => !/229, 57, 53/.test(document.getElementById('vp-mic').style.background), null, { timeout: 5000 });
        check(await ph.evaluate(() => !Mic.active()), 'the phone closes its microphone when the TV stops');
        // from the TV: Record more starts the phone's microphone; Stop on the TV stops it
        await tv.evaluate(() => document.getElementById('memo-rec').click());
        await tv.waitForFunction(() => document.querySelector('.memo-mic.memo-on') && Mic.active(), null, { timeout: 8000 });
        await ph.waitForFunction(() => Mic.active(), null, { timeout: 5000 });
        await tv.waitForTimeout(800);
        await tv.evaluate(() => document.getElementById('memo-rec').click());
        await tv.waitForFunction(() => !Mic.active() && !document.querySelector('.memo-mic.memo-on'), null, { timeout: 8000 });
        await ph.waitForFunction(() => !Mic.active(), null, { timeout: 5000 });
        const n2 = await tv.evaluate(() => new Promise((ok) => MemoStore.list((e, l) => ok(l[0].parts.length))));
        check(n2 === 2, 'Record more on the TV records a second part from the phone; Stop on the TV closes the phone\'s microphone');
        // the phone leaves while recording: the TV keeps what it got
        await tv.evaluate(() => document.getElementById('memo-rec').click());
        await ph.waitForFunction(() => Mic.active(), null, { timeout: 8000 });
        await tv.waitForTimeout(700);
        await ph.evaluate(() => document.querySelector('[data-act="leave"]').click());
        await tv.waitForFunction(() => !Mic.active(), null, { timeout: 10000 });
        const n3 = await tv.evaluate(() => new Promise((ok) => MemoStore.list((e, l) => ok(l[0].parts.length))));
        check(n3 === 3 && await tv.evaluate(() => !Mic.phone()), 'a phone that leaves while recording ends the recording, and what was recorded is kept');
        // the shell's touch pad over games: the mic button is only offered in its gear panel
        check(await ph.evaluate(() => { VirtualPad.hide(); VirtualPad.init({ force: true, id: 't', home: true, mic: null }); const m = document.getElementById('vp-mic'); const r = m && m.style.display === 'none'; VirtualPad.hide(); return r; }), 'with mic: null the pad only offers the microphone button (hidden at first, in the gear panel)');
        check(tv.errors.length === 0 && ph.errors.length === 0, 'no page errors ' + tv.errors.concat(ph.errors).join('; '));
        await tv.evaluate(() => Win.close());
        for (const pg of [tv, ph]) await pg.context().close();
    }

    // ---- 34c. Text mode: the phone's own keyboard types into the TV's text field (Browser address bar, a My PC field)
    console.log('34c. phone controller Text mode (phone keyboard -> TV text field, live or Send)');
    {
        const db = {};
        const tv = await newPage(browser, base, db);
        await tv.goto(base + 'index.html');
        await tv.waitForFunction(() => window.Controllers && document.querySelector('[data-game]'), null, { timeout: 20000 });
        await tv.evaluate(() => Controllers.setOn(true));
        const code = await tv.evaluate(() => Controllers.code());
        await tv.waitForFunction(() => Controllers.status().s === 'ready', null, { timeout: 10000 });
        const ph = await newPage(browser, base, db, { phone: true, viewport: { width: 844, height: 390 } });
        await ph.goto(base + 'index.html');
        await ph.waitForFunction(() => window.Win && document.querySelector('[data-game]'), null, { timeout: 20000 });
        await ph.evaluate(() => Win.open('gamepad'));
        await ph.fill('.gc-code', code);
        const names = await ph.evaluate(() => [...document.querySelectorAll('.gc-modes .btn')].map((b) => b.textContent));
        check(names[names.length - 1] === 'Text', 'the Game controller has a Text mode (' + names.join(', ') + ')');
        await ph.evaluate(() => [...document.querySelectorAll('.gc-modes .btn')].find((b) => b.textContent === 'Text').click());
        await ph.click('.gc-go');
        await tv.waitForFunction(() => Controllers.modes()[1] === 'text', null, { timeout: 40000 });
        await ph.waitForFunction(() => window.GamepadApp && GamepadApp.linked() && !document.querySelector('.gc-txt').hidden, null, { timeout: 10000 });
        check(await ph.evaluate(() => !VirtualPad.active() && !document.querySelector('.gc-tinto').classList.contains('on') && /No text field/.test(document.querySelector('.gc-tinto').textContent)), 'Text mode shows its own screen (no pad) and says no text field is open on the TV');
        const labels = await ph.evaluate(() => [...document.querySelectorAll('.gc-tnav .gc-tbtn')].map((b) => b.textContent).join(''));
        check(labels === '▲◀▶▼AB', 'Text mode has arrows and A / B to reach a field on the TV (' + labels + ')');
        // Send with no field: nothing is sent, the phone says so
        await ph.fill('.gc-tin', 'hello');
        await ph.click('.gc-tsend');
        check(await ph.evaluate(() => /Open a text field/.test(document.querySelector('.gc-txt .gc-tcue').textContent) && document.querySelector('.gc-tin').value === 'hello'), 'Send with no text field on the TV keeps the text and says to open a field first');
        await ph.fill('.gc-tin', '');
        // the phone's A = OK: the Browser's search box opens the on-screen keyboard; the phone sees the field
        await tv.evaluate(() => Win.open('browser'));
        await tv.waitForFunction(() => document.activeElement && document.activeElement.classList.contains('br-search'), null, { timeout: 5000 });
        await ph.dispatchEvent('.gc-ta', 'pointerdown'); await ph.dispatchEvent('.gc-ta', 'pointerup');
        await tv.waitForFunction(() => Keyboard.isOpen(), null, { timeout: 5000 });
        await ph.waitForFunction(() => document.querySelector('.gc-tinto').classList.contains('on'), null, { timeout: 5000 });
        const into = await ph.evaluate(() => ({ t: document.querySelector('.gc-tinto').textContent, im: document.querySelector('.gc-tin').getAttribute('inputmode'), cap: document.querySelector('.gc-tin').getAttribute('autocapitalize') }));
        check(/Typing into: .*(address|search)/i.test(into.t) && into.im === 'url' && into.cap === 'off', 'A on the phone opened the Browser\'s address keyboard; the phone shows that field and an address keyboard ' + JSON.stringify(into));
        // live: each letter shows on the TV; Backspace deletes a letter and is never Back
        await ph.focus('.gc-tin');
        await ph.keyboard.type('Wikipedia.org', { delay: 15 });
        await tv.waitForFunction(() => document.getElementById('namer-text').textContent === 'wikipedia.org', null, { timeout: 5000 }).catch(() => {});
        check(await tv.evaluate(() => document.getElementById('namer-text').textContent) === 'wikipedia.org', 'Live: what is typed on the phone appears in the TV keyboard as it is typed (its rules kept: lower case for an address)');
        await ph.keyboard.press('Backspace'); await ph.keyboard.press('Backspace'); await ph.keyboard.press('Backspace');
        await tv.waitForTimeout(400);
        check(await tv.evaluate(() => Keyboard.isOpen() && document.getElementById('namer-text').textContent === 'wikipedia.' && Win.current() === 'browser') && await ph.evaluate(() => GamepadApp.running() && document.activeElement === document.querySelector('.gc-tin')),
            'Backspace on the phone deletes a letter on the TV: no Back, the keyboard and the phone screen stay');
        await ph.keyboard.type('org');
        await ph.keyboard.press('Enter');
        await tv.waitForFunction(() => !Keyboard.isOpen(), null, { timeout: 5000 }).catch(() => {});
        check(await tv.evaluate(() => !Keyboard.isOpen() && /wikipedia\.org/.test((document.querySelector('.br-frame') || {}).src || '')), 'Enter on the phone = Send: the Browser goes to the address');
        await ph.waitForFunction(() => !document.querySelector('.gc-tinto').classList.contains('on'), null, { timeout: 5000 }).catch(() => {});
        check(await ph.evaluate(() => !document.querySelector('.gc-tinto').classList.contains('on') && document.querySelector('.gc-tin').value === ''), 'the keyboard closed on the TV: the phone shows no field and its box is empty again');
        // Send mode (Live off): nothing reaches the TV until Send
        await ph.click('.gc-tlive input');
        check(await ph.evaluate(() => JSON.parse(localStorage.getItem('arc_dev_ctrlphone')).txt.live === false), 'Live off is kept on the phone');
        await tv.evaluate(() => document.querySelector('.br-addr').click());
        await ph.waitForFunction(() => document.querySelector('.gc-tinto').classList.contains('on'), null, { timeout: 5000 });
        await ph.fill('.gc-tin', 'example.com');
        await tv.waitForTimeout(300);
        check(await tv.evaluate(() => Keyboard.isOpen() && document.getElementById('namer-text').textContent !== 'example.com'), 'Live off: typing on the phone does not change the TV field yet');
        await ph.click('.gc-tsend');
        await tv.waitForFunction(() => !Keyboard.isOpen(), null, { timeout: 5000 }).catch(() => {});
        check(await tv.evaluate(() => /example\.com/.test(document.querySelector('.br-frame').src)), 'Send puts the text in the field and presses OK (the Browser opens example.com)');
        // a text field of My PC itself (input with the focus): its text comes to the phone, Send writes it and presses Enter
        await tv.evaluate(() => { Win.close(); const i = document.createElement('input'); i.id = '__f'; i.value = 'old'; i.setAttribute('aria-label', 'Note'); window.__enter = 0; i.addEventListener('keydown', (e) => { if (e.keyCode === 13) __enter++; }); document.body.appendChild(i); i.focus(); });
        await ph.waitForFunction(() => /Note/.test(document.querySelector('.gc-tinto').textContent), null, { timeout: 5000 });
        check(await ph.evaluate(() => document.querySelector('.gc-tin').value === 'old'), 'a focused My PC text field: its label and text come to the phone');
        await ph.fill('.gc-tin', 'new note');
        await ph.click('.gc-tsend');
        await tv.waitForFunction(() => window.__enter === 1, null, { timeout: 5000 }).catch(() => {});
        check(await tv.evaluate(() => document.getElementById('__f').value === 'new note' && __enter === 1), 'Send writes the text into that field and presses Enter on it');
        await tv.evaluate(() => document.getElementById('__f').remove());
        check(tv.errors.length === 0 && ph.errors.length === 0, 'no page errors ' + tv.errors.concat(ph.errors).join('; '));
        for (const pg of [tv, ph]) await pg.context().close();
    }

    // ---- 35. phone controller sensor modes: moves, metrics, raw data, live and debug screens
    console.log('35. phone controller sensor modes (sensor-actions, sensor-raw, protocol v1)');
    {
        const db = {};
        const tv = await newPage(browser, base, db);
        await tv.goto(base + 'index.html');
        await tv.waitForFunction(() => window.Controllers && document.querySelector('[data-game]'), null, { timeout: 20000 });
        await tv.evaluate(() => { Controllers.setOn(true); window.__rem = []; const r = Input.remote; Input.remote = function (p, a, d) { __rem.push(p + ':' + a + ':' + (d ? 1 : 0)); return r.apply(this, arguments); }; });
        await tv.waitForFunction(() => Controllers.status().s === 'ready', null, { timeout: 15000 });
        const code = await tv.evaluate(() => Controllers.code());
        const phone = async (p, modeIdx) => {
            const ph = await newPage(browser, base, db, { phone: true, viewport: { width: 844, height: 390 } });
            await ph.goto(base + 'index.html');
            await ph.waitForFunction(() => window.Win && document.querySelector('[data-game]'), null, { timeout: 20000 });
            await ph.evaluate(() => Win.open('gamepad'));
            await ph.fill('.gc-code', code);
            await ph.click('.gc-join .gc-row:not(.gc-modes) .btn:nth-of-type(' + p + ')');
            await ph.click('.gc-modes .btn:nth-of-type(' + (modeIdx + 1) + ')');
            await ph.click('.gc-go');
            await ph.waitForFunction(() => window.GamepadApp && GamepadApp.linked() && GamepadApp.config(), null, { timeout: 40000 });
            return ph;
        };
        // synthetic motion, phone in landscape (top to the left): up = +x, right = -y. segments [ms, vertical, lateral, freefall]
        const feed = (ph, parts) => ph.evaluate((parts) => {
            let t = (window.__t || 1000);
            for (const [ms, v, l, free] of parts) for (let i = 0; i < ms / 16.67; i++, t += 16.67) {
                const lin = free ? [-9.81, 0, 0] : [v, -l, 0];
                GamepadApp.feed({ t, acceleration: { x: lin[0], y: lin[1], z: lin[2] }, accelerationIncludingGravity: { x: lin[0] + 9.81, y: lin[1], z: lin[2] }, rotationRate: { alpha: 0, beta: 0, gamma: 0 } });
            }
            window.__t = t;
        }, parts);
        const JUMP = [[1500, 0, 0], [160, -6, 0], [140, 12, 0], [320, 0, 0, true], [80, 22, 0], [1500, 0, 0]];
        const LEFT = [[1500, 0, 0], [130, 0, -8], [130, 0, 8], [1500, 0, 0]];
        const P1 = await phone(1, 1);
        check(await P1.evaluate(() => GamepadApp.mode() === 'sensor-actions' && !VirtualPad.active() && !document.querySelector('.gc-sense').hidden), 'sensor-actions: the live screen shows instead of the pad');
        check(await P1.evaluate(() => JSON.stringify(GamepadApp.config().moves) === '["LEFT","RIGHT","JUMP","DUCK","DUCK_END"]' && !GamepadApp.config().metrics.enabled), 'with no game asking, the TV sends the default moves and no metrics');
        check(await tv.evaluate(() => Controllers.modes()[1] === 'sensor-actions'), 'the TV knows player 1 is a motion controller');
        // no app asked: moves work the TV like buttons
        await feed(P1, JUMP);
        await tv.waitForFunction(() => __rem.indexOf('1:ok:1') >= 0 && __rem.indexOf('1:ok:0') >= 0, null, { timeout: 4000 });
        await feed(P1, LEFT);
        await tv.waitForFunction(() => __rem.indexOf('1:left:1') >= 0, null, { timeout: 4000 });
        check(true, 'without a game listening, JUMP presses OK and LEFT presses left on the TV');
        // Settings > Devices > Phone controller > Motion moves on the TV: the limits go to the phones at once; live test
        await tv.evaluate(() => { Win.open('settings', 'devices'); [...document.querySelectorAll('.set-row')].find((r) => /Phone controller/.test(r.textContent)).click(); });
        await tv.evaluate(() => [...document.querySelectorAll('.set-row')].find((r) => /Motion moves/.test(r.textContent)).click());
        await tv.waitForSelector('.set-mvlog', { timeout: 3000 });
        await tv.evaluate(() => [...document.querySelectorAll('.set-row')].find((x) => /Jump limit/.test(x.textContent)).click());
        await P1.waitForFunction(() => GamepadApp.config().tune.scales.JUMP > 1.05, null, { timeout: 4000 });
        check(await tv.evaluate(() => Controllers.tune().scales.JUMP === 1.1 && /1\.1\u00D7/.test([...document.querySelectorAll('.set-row')].find((x) => /Jump limit/.test(x.textContent)).textContent)),
            'Motion moves on the TV: OK on Jump limit raises it (\u2039 \u203A on the remote), saved on the TV and sent to the phone at once');
        await tv.evaluate(() => { __rem.length = 0; });
        await feed(P1, JUMP);
        await tv.waitForFunction(() => /JUMP/.test(document.querySelector('.set-mv-list').textContent), null, { timeout: 4000 });
        check(await tv.evaluate(() => __rem.filter((x) => /:1$/.test(x)).length === 0 && /Standing|Walking|Running/.test(document.querySelector('.set-mv-list').textContent)), 'its live test lists what the phone detects, with the gait, and the moves press no buttons meanwhile');
        await tv.evaluate(() => [...document.querySelectorAll('.set-row')].find((x) => /Default move settings/.test(x.textContent)).click());
        await P1.waitForFunction(() => GamepadApp.config().tune.scales.JUMP === 1, null, { timeout: 4000 });
        await tv.evaluate(() => Win.close());
        await feed(P1, JUMP);
        await tv.waitForFunction(() => __rem.indexOf('1:ok:1') >= 0, null, { timeout: 4000 });
        check(true, 'Default move settings resets them; once the page is closed the moves press buttons again');
        // the phone's own settings: − / + buttons, no number fields, and they scroll with a finger even after the pad was used
        await P1.evaluate(() => [...document.querySelectorAll('.gc-live .btn')].find((b) => /Settings/.test(b.textContent)).click());
        check(await P1.evaluate(() => !document.querySelector('.gc-settings input[type=number]') && !document.querySelector('.gc-settings select') && document.querySelectorAll('.gc-settings .gc-step').length === 12 && /Motion moves/.test(document.querySelector('.gc-tvnote').textContent)),
            'phone settings: every value has \u2212 / + buttons (no number fields), and it says the move limits are set on the TV');
        await P1.evaluate(() => [...document.querySelectorAll('.gc-settings .gc-step')][9].click());     // Sensitivity +
        check(await P1.evaluate(() => Math.abs(Store.rawGet('arc_dev_ctrlphone').prefs.sensitivity - 1.1) < 1e-6 && /1\.1/.test(document.querySelectorAll('.gc-settings .gc-pval')[4].textContent)), 'a + press changes the value, shows it and keeps it');
        check(await P1.evaluate(() => { VirtualPad.init({ force: true }); VirtualPad.hide(); const e = new TouchEvent('touchmove', { bubbles: true, cancelable: true }); document.querySelector('.gc-settings').dispatchEvent(e); return !e.defaultPrevented; }),
            'swiping the settings is not cancelled by the virtual pad (they scroll on Android)');
        check(await P1.waitForFunction(() => /JUMP|LEFT/.test(document.querySelector('.gc-last').textContent), null, { timeout: 3000 }).then(() => true, () => false), 'the live screen shows the last move');
        // a game asks for JUMP only, with metrics twice a second
        const got = await tv.evaluate(() => { window.__ev = []; Controllers.sensorSetup({ moves: ['JUMP'], metrics: { hz: 2 }, profile: { age: 40, height: 182, weight: 80, phone_position: 'right hand' } }, (p, m) => __ev.push([p, m.type, m.action || m.gait])); return Controllers.sensorConfig().moves; });
        await P1.waitForFunction(() => JSON.stringify(GamepadApp.config().moves) === '["JUMP"]', null, { timeout: 4000 });
        check(got.join() === 'JUMP' && await P1.evaluate(() => GamepadApp.config().profile.height === 182 && /game/i.test(document.querySelector('.gc-note').textContent)), 'the game config reaches the phone at once (moves, profile from the game)');
        await feed(P1, LEFT);
        await feed(P1, JUMP);
        await tv.waitForFunction(() => __ev.some((e) => e[1] === 'action'), null, { timeout: 4000 });
        await tv.waitForFunction(() => __ev.filter((e) => e[1] === 'metrics').length >= 2, null, { timeout: 4000 });
        const ev = await tv.evaluate(() => __ev);
        check(ev.filter((e) => e[1] === 'action').map((e) => e[2]).join() === 'JUMP', 'only the move the game asked for is sent (LEFT was not): ' + JSON.stringify(ev.filter((e) => e[1] === 'action')));
        check(ev.some((e) => e[1] === 'metrics' && e[0] === 1), 'metrics come at the low rate the game asked for');
        const st = await tv.evaluate(() => Controllers.sensorStats()[1].stats);
        check(st.actions >= 3 && st.duplicate === 0 && st.invalid === 0, 'TV stats: actions counted, no duplicate or invalid message (' + JSON.stringify(st) + ')');
        await P1.waitForFunction(() => /[0-9]+ ms/.test(document.querySelector('.gc-line').textContent), null, { timeout: 4000 });
        check(true, 'acks come back: the phone shows the latency');
        // a duplicated message (same sequence twice) is dropped by the TV and reported back
        await P1.evaluate(() => { GamepadApp.send({ type: 'action', action: 'JUMP', timestamp: Date.now(), sequence: 900 }); GamepadApp.send({ type: 'action', action: 'JUMP', timestamp: Date.now(), sequence: 900 }); });
        await tv.waitForFunction(() => Controllers.sensorStats()[1].stats.duplicate === 1, null, { timeout: 4000 });
        check(await tv.evaluate(() => __ev.filter((e) => e[1] === 'action').length) === 2, 'a duplicated action reaches the game once');
        // debug screen
        await P1.click('.gc-stop .btn:nth-of-type(2)');
        await P1.waitForTimeout(400);
        const dbg = await P1.evaluate(() => [...document.querySelectorAll('.gc-pre')].map((p) => p.textContent).join('\n'));
        check(/acc\+g/.test(dbg) && /JUMP/.test(dbg) && /cooldown|idle/.test(dbg), 'the debug screen shows readings, the classifier states and the events');
        await P1.click('.gc-debug .btn:nth-of-type(1)');           // record
        await feed(P1, JUMP);
        await P1.click('.gc-debug .btn:nth-of-type(1)');           // stop
        const n0 = await tv.evaluate(() => __ev.filter((e) => e[1] === 'action').length);
        await P1.click('.gc-debug .btn:nth-of-type(2)');           // replay
        await P1.waitForFunction(() => GamepadApp.log().some((l) => /replay\s+JUMP/.test(l)), null, { timeout: 8000 });
        check(await tv.evaluate((n) => __ev.filter((e) => e[1] === 'action').length === n, n0), 'record and replay: the replayed jump is found again and is not sent to the TV');
        // the game goes away: back to the default moves
        await tv.evaluate(() => Controllers.sensorSetup(null));
        await P1.waitForFunction(() => GamepadApp.config().moves.length === 5, null, { timeout: 4000 });
        check(true, 'when the game stops, the phone gets the default moves again');
        // sensor-raw on player 2
        const P2 = await phone(2, 2);
        await tv.evaluate(() => { window.__raw = []; Controllers.sensorSetup({ moves: [], raw: { hz: 30 } }, (p, m) => { if (m.type === 'raw') __raw.push([p, m.s.length, m.hz]); }); });
        await P2.waitForFunction(() => GamepadApp.config().raw.hz === 30, null, { timeout: 4000 });
        await P2.evaluate(() => { const t0 = performance.now(); window.__rawT = setInterval(() => GamepadApp.feed({ acceleration: { x: 1, y: 0, z: 0 }, accelerationIncludingGravity: { x: 10.8, y: 0, z: 0 }, rotationRate: { alpha: 1, beta: 2, gamma: 3 } }), 8); setTimeout(() => clearInterval(window.__rawT), 1000); });
        await P2.waitForTimeout(1400);
        const raw = await tv.evaluate(() => __raw);
        const total = raw.reduce((a, r) => a + r[1], 0);
        check(raw.length > 0 && raw.every((r) => r[0] === 2 && r[1] <= 12 && r[2] === 30) && total >= 22 && total <= 34, 'sensor-raw: samples arrive in small batches at the asked rate (' + total + ' samples for 1 s at 30 Hz, ' + raw.length + ' messages)');
        // the app goes away: a Motion data phone stays raw (it never points); Pointer is its own mode
        await tv.evaluate(() => Controllers.sensorSetup(null));
        await P2.waitForFunction(() => GamepadApp.config().raw && !GamepadApp.config().pointer && !GamepadApp.pointing(), null, { timeout: 4000 });
        check(await P2.evaluate(() => !document.querySelector('.gc-sense').hidden && !VirtualPad.active()), 'Motion data stays raw data on the My PC screens (no pointer)');
        // switch P2 to Pointer: its own screen, no stick, settings, big A and B
        await P2.click('.gc-stop .gc-modebtn');
        await P2.click('.gc-modepick .btn:nth-of-type(4)');
        await P2.waitForFunction(() => GamepadApp.mode() === 'pointer' && GamepadApp.linked() && GamepadApp.pointing(), null, { timeout: 40000 });
        await tv.waitForFunction(() => Controllers.modes()[2] === 'pointer', null, { timeout: 10000 });
        check(await P2.evaluate(() => !document.querySelector('.gc-ptr').hidden && document.querySelector('.gc-sense').hidden && !VirtualPad.active() && !document.getElementById('vp-stick')
            && document.querySelectorAll('.gc-ptr .gc-step').length === 6 && document.querySelectorAll('.gc-ptr input[type=checkbox]').length === 2 && !!document.querySelector('.gc-pa') && !!document.querySelector('.gc-pb')),
            'Pointer mode: its own screen with smoothness / speed / steady zone, swap left-right / up-down, Calibrate, Center, big A and B; no stick');
        check(await P2.evaluate(() => { const a = document.querySelector('.gc-pa').getBoundingClientRect(), b = document.querySelector('.gc-pb').getBoundingClientRect(); return a.left > b.left && a.top < b.top; }), 'A sits right of B and higher, as on a Nintendo controller');
        // held like a remote (screen up): alpha = turning left; tilt = turning the top of the screen's picture up, which is a
        // rotation around the device x axis in portrait and around y in landscape
        const turn = (ph, alpha, tilt, ms) => ph.evaluate(([alpha, tilt, ms]) => new Promise((done) => { const t0 = performance.now(); const a = ((screen.orientation ? screen.orientation.angle : 0) / 90) & 3;
            const beta = a === 0 ? tilt : a === 2 ? -tilt : 0, gamma = a === 1 ? -tilt : a === 3 ? tilt : 0; const id = setInterval(() => {
            GamepadApp.feed({ acceleration: { x: 0, y: 0, z: 0 }, accelerationIncludingGravity: { x: 0, y: 0, z: 9.81 }, rotationRate: { alpha, beta, gamma } });
            if (performance.now() - t0 > ms) { clearInterval(id); done(); } }, 10); }), [alpha, tilt, ms]);
        await tv.evaluate(() => { window.__tvRaw = __raw.length; });
        await turn(P2, 0, 0, 300);
        await turn(P2, 40, 0, 500);                               // held like a remote, turned left 20 degrees
        await turn(P2, 0, 0, 400);
        await tv.waitForFunction(() => Pointer.visible() && Pointer.pos().x < innerWidth / 2 - 100, null, { timeout: 4000 });
        const pt = await tv.evaluate(() => ({ p: Pointer.pos(), w: innerWidth, h: innerHeight, raw: __raw.length - __tvRaw, el: getComputedStyle(document.querySelector('.ptr')).transform }));
        check(Math.abs(pt.p.y - pt.h / 2) < 3 && pt.raw === 0 && /matrix/.test(pt.el), 'pointer: turning the phone left moves the TV pointer left only, drawn with a transform, no raw samples sent (' + JSON.stringify(pt.p) + ')');
        await P2.click('.gc-pcenter');
        await tv.waitForFunction(() => Math.abs(Pointer.pos().x - Math.round(innerWidth / 2)) < 2, null, { timeout: 4000 });
        check(true, 'pointer: Center puts it back in the middle of the screen');
        await turn(P2, 0, 30, 400);                               // tilt up: the pointer goes up over the desktop and focuses what it is on
        await turn(P2, 0, 0, 400);
        await tv.waitForFunction(() => Pointer.pos().y < innerHeight / 2 - 50, null, { timeout: 4000 });
        await tv.waitForTimeout(250);
        check(await tv.evaluate(() => { const p = Pointer.pos(), e = document.elementFromPoint(p.x, p.y), f = e && e.closest('[data-focus]'); return !f || document.activeElement === f; }), 'pointer: the item under it gets the focus');
        await tv.evaluate(() => { __rem.length = 0; window.__pr = 0; const p = Pointer.press; Pointer.press = function () { __pr++; return p.apply(this, arguments); }; });
        const pos0 = await tv.evaluate(() => Pointer.pos());
        await P2.locator('.gc-pa').dispatchEvent('pointerdown');
        await turn(P2, 60, 0, 150);                               // the hand moves while pressing
        await P2.locator('.gc-pa').dispatchEvent('pointerup');
        await P2.locator('.gc-pb').dispatchEvent('pointerdown'); await P2.locator('.gc-pb').dispatchEvent('pointerup');
        await tv.waitForFunction(() => __rem.indexOf('2:b:0') >= 0, null, { timeout: 4000 });
        const pos1 = await tv.evaluate(() => Pointer.pos());
        check(await tv.evaluate(() => __pr === 1 && (__rem.indexOf('2:ok:1') >= 0 || !document.elementFromPoint(Pointer.pos().x, Pointer.pos().y).closest('[data-focus]')) && __rem.indexOf('2:b:1') >= 0) && Math.abs(pos1.x - pos0.x) < 3 && Math.abs(pos1.y - pos0.y) < 3, 'pointer: A is OK on what it points at, B is back; the pointer holds still while A is pressed (' + JSON.stringify([pos0, pos1]) + ')');
        check(await tv.evaluate(() => Controllers.sensorStats()[2].stats.invalid === 0), 'pointer messages are valid on the TV');
        // the settings: kept on the phone
        await P2.evaluate(() => [...document.querySelectorAll('.gc-ptr .gc-step')][1].click());     // smoothness +
        check(await P2.evaluate(() => Store.rawGet('arc_dev_ctrlphone').ptr.smooth === 6 && GamepadApp.aim().options().smooth === 6 && document.querySelector('.gc-ptr .gc-pval').textContent === '6'), 'pointer settings apply at once, show their value and are kept on the phone');
        // calibration: hold still, then turn "right" and tilt "up"; this phone's directions come out reversed, so both get swapped
        await P2.evaluate(() => GamepadApp.calibrate());
        await turn(P2, 0, 0, 900);
        await P2.waitForFunction(() => /right/i.test(document.querySelector('.gc-ptr .gc-tcue').textContent), null, { timeout: 4000 });
        await turn(P2, 15, 0, 2500);                              // the player turns right, the sensors say left
        await P2.waitForFunction(() => /up/i.test(document.querySelector('.gc-ptr .gc-tcue').textContent), null, { timeout: 4000 });
        await turn(P2, 0, -15, 2500);                             // the player tilts up, the sensors say down
        await P2.waitForFunction(() => /Calibrated/.test(document.querySelector('.gc-ptr .gc-tcue').textContent), null, { timeout: 4000 });
        check(await P2.evaluate(() => { const o = GamepadApp.aim().options(); return o.swapX && o.swapY && document.querySelectorAll('.gc-ptr input:checked').length === 2; }), 'Calibrate finds reversed directions and swaps them (left / right and up / down)');
        check(P2.errors.length === 0, 'no page errors on the pointer phone ' + P2.errors.join('; '));
        // pairing by QR code: the phone camera opens My PC with ?pair=<code>; the Game controller opens and connects by itself
        await P1.context().close();
        await tv.waitForFunction(() => Controllers.players()[1] === null, null, { timeout: 15000 });
        const Q = await newPage(browser, base, db, { phone: true, viewport: { width: 844, height: 390 } });
        await Q.goto(base + 'index.html?pair=' + code);
        await Q.waitForFunction(() => window.GamepadApp && GamepadApp.linked(), null, { timeout: 40000 });
        check(await tv.evaluate(() => !!Controllers.players()[1]) && await Q.evaluate(() => !/pair=/.test(location.search)), 'scanning the QR code (opening its link) pairs the phone at once, and the link is cleaned from the address');
        check(await Q.evaluate(() => GamepadApp.scanCode('https://x.test/index.html?pair=' + 'ab') === '' && GamepadApp.scanCode('not a code!') === ''), 'a scanned QR code that is not a My PC pairing link is ignored');
        // switching mode while connected: Mode > Motion moves reconnects as a motion controller, same player
        await Q.evaluate(() => document.querySelector('[data-act="mode"]').click());
        await Q.click('.gc-modepick .btn:nth-of-type(2)');
        await Q.waitForFunction(() => GamepadApp.mode() === 'sensor-actions' && GamepadApp.linked() && !document.querySelector('.gc-sense').hidden && !VirtualPad.active(), null, { timeout: 40000 });
        await tv.waitForFunction(() => Controllers.modes()[1] === 'sensor-actions', null, { timeout: 10000 });
        check(true, 'the Mode button switches a connected phone from buttons to motion moves (same player, reconnected by itself)');
        await Q.click('.gc-stop .gc-modebtn');
        await Q.click('.gc-modepick .btn:nth-of-type(1)');
        await Q.waitForFunction(() => GamepadApp.mode() === 'pad' && GamepadApp.linked() && VirtualPad.active(), null, { timeout: 40000 });
        check(true, 'and back to buttons from the motion screen');
        check(Q.errors.length === 0, 'no page errors on the scanning phone ' + Q.errors.join('; '));
        await Q.context().close();
        await tv.waitForFunction(() => Controllers.players()[1] === null, null, { timeout: 15000 });
        // Keyboard mode: a keyboard plugged into the phone is a whole Switch Pro style controller; keys are mapped to controls
        // (kept on the phone) and the TV gets gamepad buttons (18, Capture = 17) and both sticks, never keys
        const K = await newPage(browser, base, db, { phone: true, viewport: { width: 844, height: 390 } });
        await K.goto(base + 'index.html');
        await K.waitForFunction(() => window.Win && document.querySelector('[data-game]'), null, { timeout: 20000 });
        await K.evaluate(() => Win.open('gamepad'));
        await K.fill('.gc-code', code);
        await K.click('.gc-modes .btn:nth-of-type(5)');
        await K.click('.gc-go');
        await K.waitForFunction(() => window.GamepadApp && GamepadApp.linked() && GamepadApp.mode() === 'keyboard', null, { timeout: 40000 });
        await tv.waitForFunction(() => Controllers.modes()[1] === 'keyboard', null, { timeout: 10000 });
        check(await K.evaluate(() => !document.querySelector('.gc-kb').hidden && !VirtualPad.active() && document.querySelectorAll('.gc-kpic [data-k]').length === 26
            && ['A', 'B', 'X', 'Y', 'L', 'R', 'ZL', 'ZR', '+', '−'].every((l) => [...document.querySelectorAll('.gc-kpic text')].some((x) => x.textContent === l))
            && !/\bC\b/.test([...document.querySelectorAll('.gc-kpic text:not(.k)')].map((x) => x.textContent).join(' '))), 'Keyboard mode shows the controller (every Switch Pro control: A B X Y, L R ZL ZR, − +, Home, Capture, D-pad, both sticks), no virtual pad');
        await tv.evaluate(() => { window.__vp = null; const r = Input.virtualPad; Input.virtualPad = function (p, m, x, y, n, rx, ry) { if (p === 1 && m !== null) __vp = { m, x, y, rx, ry }; return r.apply(this, arguments); }; });
        await K.keyboard.down('z');
        await tv.waitForFunction(() => Input.isDownDev('pad101', 'up'), null, { timeout: 3000 });
        check(await K.evaluate(() => document.querySelector('[data-k=up]').classList.contains('on')) && await tv.evaluate(() => __vp.m === 1 << 12), 'Z (default) = D-pad up on the TV (button 12), lit on the phone');
        await K.keyboard.up('z');
        await tv.waitForFunction(() => !Input.isDownDev('pad101', 'up'), null, { timeout: 3000 });
        check(await K.evaluate(() => !document.querySelector('[data-k=up]').classList.contains('on')), 'letting go of the key releases the button and its light');
        await K.keyboard.down('l');
        await tv.waitForFunction(() => Input.isDownDev('pad101', 'jump') && Input.isDownDev('pad101', 'confirm'), null, { timeout: 3000 });
        await K.keyboard.up('l');
        await K.keyboard.down('k');
        await tv.waitForFunction(() => Input.isDownDev('pad101', 'run') && Input.isDownDev('pad101', 'cancel'), null, { timeout: 3000 });
        await K.keyboard.up('k');
        check(true, 'L key = A (OK / jump), K key = B (run + back), like a Nintendo pad\'s A and B (owner decision 2026-11-11)');
        for (const [key, bit, name] of [['u', 4, 'L'], ['o', 5, 'R'], ['a', 6, 'ZL'], ['p', 7, 'ZR'], ['Backspace', 8, '−'], ['Enter', 9, '+'], ['f', 10, 'left stick click'], ['m', 11, 'right stick click'], ['h', 16, 'Home'], ['c', 17, 'Capture']]) {
            await K.keyboard.down(key);
            await tv.waitForFunction((b) => __vp && __vp.m === 1 << b, bit, { timeout: 3000 });
            await K.keyboard.up(key);
            await tv.waitForFunction(() => __vp && __vp.m === 0, null, { timeout: 3000 });
        }
        check(true, 'every other Switch Pro button reaches the TV as its standard gamepad button (L 4, R 5, ZL 6, ZR 7, − 8, + 9, stick clicks 10 / 11, Home 16, Capture 17)');
        await K.keyboard.down('Numpad6'); await K.keyboard.down('ArrowLeft');
        await tv.waitForFunction(() => __vp && __vp.rx === 1 && __vp.x === -1, null, { timeout: 3000 });
        check(await tv.evaluate(() => { const p = Input.pads().find((q) => q.index === 101); return p && p.buttons === 18 && p.axes === 4 && Input.isDownDev('pad101', 'left'); }), 'arrows = left stick (axes 0 / 1), numeric keypad = right stick (axes 2 / 3); the phone is an 18-button standard pad on the TV');
        await K.keyboard.up('Numpad6'); await K.keyboard.up('ArrowLeft');
        // mapping: tap a control on the picture, press a key; a key belongs to one control only; kept on the phone
        await K.click('.gc-kpic [data-k=x]');
        check(await K.evaluate(() => document.querySelector('[data-k=x]').classList.contains('wait') && /X/.test(document.querySelector('.gc-kcue').textContent)), 'tapping X waits for its key');
        await K.keyboard.press('w');
        check(await K.evaluate(() => GamepadApp.keys().x === 'w' && Store.rawGet('arc_dev_ctrlphone').keys.x === 'w' && document.querySelector('[data-k=x] .k').textContent === 'W'), 'the key is mapped, shown on the button and kept on the phone');
        await K.keyboard.down('w');
        await tv.waitForFunction(() => __vp && __vp.m === 1 << 2, null, { timeout: 3000 });
        await K.keyboard.up('w');
        await K.click('.gc-kpic [data-k=y]'); await K.keyboard.press('w');
        check(await K.evaluate(() => GamepadApp.keys().y === 'w' && GamepadApp.keys().x === ''), 'a key given to Y is taken from X (one key, one control)');
        await K.click('.gc-kacts .btn-primary');                   // Map keys: every control in turn
        await K.keyboard.press('e');
        check(await K.evaluate(() => GamepadApp.keys().up === 'e' && document.querySelector('[data-k=down]').classList.contains('wait')), 'Map keys asks for every control in turn (D-pad up, then down…)');
        await K.click('.gc-kacts .btn-primary:not([hidden])');      // Done
        await K.click('.gc-kacts .btn:nth-of-type(2)');             // Default keys
        check(await K.evaluate(() => GamepadApp.keys().up === 'z' && GamepadApp.keys().x === 'i' && GamepadApp.keys().y === 'j'), 'Default keys: ZQSD = D-pad, I = X, J = Y');
        await K.keyboard.down('Escape'); await K.keyboard.up('Escape');
        check(await K.evaluate(() => GamepadApp.running() && GamepadApp.linked()), 'keys never reach the phone\'s own screens (Esc does not leave the controller)');
        check(K.errors.length === 0, 'no page errors on the keyboard phone ' + K.errors.join('; '));
        await K.context().close();
        await tv.waitForFunction(() => Controllers.players()[1] === null, null, { timeout: 15000 });
        // the Android app (android-controller/): window.MyPCNative + assets/bridge.js; ?ctrl=1 opens the Game controller,
        // its own QR scanner answers, native motion samples replace devicemotion, the app is told when the link runs
        const A = await newPage(browser, base, db, { phone: true, viewport: { width: 844, height: 390 } });
        await A.addInitScript(() => { window.__nat = []; window.MyPCNative = { caps: () => '{"motion":true,"linear":true,"gyro":true}',
            motion: (on) => __nat.push('motion:' + on), active: (on) => __nat.push('active:' + on), scanQr: () => __nat.push('scan'), version: () => 3, settings: (j) => __nat.push('settings:' + j) };
            navigator.vibrate = (ms) => { __nat.push('vib:' + ms); return true; }; });
        await A.addInitScript({ path: path.join(ROOT, 'android-controller/app/src/main/assets/bridge.js') });
        // an older app saved Auto rotate on (the old default, no rv: 2): My PC holds landscape anyway, for the whole app, from the start
        await A.addInitScript(() => { if (!localStorage.getItem('arc_dev_ctrlphone')) localStorage.setItem('arc_dev_ctrlphone', JSON.stringify({ opt: { rotate: true, awake: true, bg: true, dpad: false } })); });
        await A.goto(base + 'index.html?ctrl=1');
        await A.waitForFunction(() => window.GamepadApp && !!document.querySelector('.gc-scanbtn'), null, { timeout: 20000 });
        check(await A.evaluate(() => __nat[0] === 'settings:{"orient":"landscape","rotate":false}'), 'Android app: My PC tells the app at start to hold landscape (the default screen rotation, even over an old saved default) (' + await A.evaluate(() => __nat.join()) + ')');
        check(await A.evaluate(() => __nat.indexOf('settings:{"awake":true,"bg":true}') >= 0), 'Android app: the phone settings (Stay awake and Background on) go to the app when the Game controller opens');
        await A.click('.gc-phonebtn');
        check(await A.evaluate(() => [...document.querySelectorAll('.gc-phoneset input')].map((c) => c.getAttribute('data-opt')).join() === 'awake,bg,dpad,vib' && !!document.querySelector('.gc-phoneset .gc-rot')), 'Android app: Settings has Stay awake, Background, GamePad, Screen rotation and Vibration');
        // Vibration: a 0..3 slider (2 at first); each press buzzes at that strength, 0 never buzzes
        check(await A.evaluate(() => document.querySelector('.gc-phoneset .gc-range').value === '2' && document.querySelector('.gc-phoneset .gc-range').max === '3'), 'Android app: Settings has a Vibration slider from 0 to 3, at 2 at first');
        await A.click('.gc-vib .gc-step:last-of-type');
        check(await A.evaluate(() => Store.rawGet('arc_dev_ctrlphone').opt.vib === 3 && Haptics.level() === 3 && __nat[__nat.length - 1] === 'vib:40' && document.querySelector('.gc-vibval').textContent === '3'), 'Android app: + sets Vibration to 3 (strongest), buzzes so it can be felt, keeps it on the phone (' + await A.evaluate(() => __nat.slice(-2).join()) + ')');
        await A.evaluate(() => { const s = document.querySelector('.gc-phoneset .gc-range'); s.value = '0'; s.dispatchEvent(new Event('change')); });
        check(await A.evaluate(() => Store.rawGet('arc_dev_ctrlphone').opt.vib === 0 && document.querySelector('.gc-vibval').textContent === 'Off'), 'Android app: the slider at 0 turns Vibration off');
        await A.evaluate(() => { __nat.length = 0; Haptics.buzz(); });
        check(await A.evaluate(() => !__nat.some((x) => /^vib/.test(x))), 'Android app: Vibration 0 never buzzes');
        await A.evaluate(() => { const s = document.querySelector('.gc-phoneset .gc-range'); s.value = '1'; s.dispatchEvent(new Event('change')); __nat.length = 0; Haptics.buzz(); });
        check(await A.evaluate(() => __nat.join() === 'vib:10'), 'Android app: Vibration 1 is a light buzz (' + await A.evaluate(() => __nat.join()) + ')');
        await A.click('.gc-rot .gc-step:last-of-type'); await A.click('.gc-rot .gc-step:last-of-type');     // Landscape > Manual > Auto
        await A.click('.gc-phoneset [data-opt=bg]');
        await A.click('.gc-phoneset .btn-primary');
        check(await A.evaluate(() => __nat.indexOf('settings:{"awake":true,"bg":false}') >= 0 && Store.rawGet('arc_dev_ctrlphone').opt.orient === 'auto' && Store.rawGet('arc_dev_ctrlphone').opt.bg === false), 'Android app: Screen rotation Auto and Background off are kept on the phone, Background tells the app at once');
        check(await A.evaluate(() => __nat[__nat.length - 1] === 'settings:{"orient":"landscape","rotate":false}'), 'Android app: the Game controller itself stays sideways while it is open, whatever the screen rotation');
        await A.reload();
        await A.waitForFunction(() => window.GamepadApp && !!document.querySelector('.gc-scanbtn'), null, { timeout: 20000 });
        check(await A.evaluate(() => __nat[0] === 'settings:{"orient":"any","rotate":true}' && __nat.indexOf('settings:{"awake":true,"bg":false}') >= 0 && Haptics.level() === 1), 'Android app: the settings (Screen rotation Auto, Vibration 1) are still there after the app restarts (' + await A.evaluate(() => __nat.join()) + ')');
        await A.evaluate(() => Rotation.set('landscape'));
        await A.click('.gc-phonebtn');
        await A.click('.gc-phoneset [data-opt=bg]');
        await A.click('.gc-phoneset .btn-primary');
        await A.click('.gc-modes .btn:nth-of-type(2)');           // Motion moves
        await A.click('.gc-scanbtn');
        check(await A.evaluate(() => __nat.indexOf('scan') >= 0 && !document.querySelector('.gc-scanner')), 'Android app: Scan QR code opens the app\'s own scanner');
        await A.evaluate((c) => GamepadApp.scanCode('https://imad-os.github.io/g/index.html?pair=' + c), code);   // what the app does with the scan
        await A.waitForFunction(() => GamepadApp.linked(), null, { timeout: 40000 });
        check(await A.evaluate(() => __nat.indexOf('active:true') >= 0 && __nat.indexOf('motion:true') >= 0), 'Android app: the scanned code connects; the app keeps the link awake and starts its native sensors (' + await A.evaluate(() => __nat.join()) + ')');
        const mag = await A.evaluate(() => {
            const n = performance.now(), s = [];
            for (let i = 0; i < 20; i++) s.push([1000 + i * 10, 0, 0, 0, 0, 9.81, 0, 1, 2, 3]);
            __mypcMotion({ n: 1200, s });
            return GamepadApp.engine().debug().signals.magnitude;
        });
        check(Math.abs(mag - 9.81) < 0.05, 'Android app: native samples reach the motion engine (|g| ' + mag + ')');
        // Train tab: Record 5 for LEFT, the player steps left on every Go (native samples), the limit is set from them
        await A.evaluate(() => { const b = [...document.querySelectorAll('.gc-stop .btn')].find((x) => x.textContent === I18n.t('gcTrain')); b.click(); });
        await A.evaluate(() => {
            window.__tick = 0;
            window.__feed = setInterval(() => {      // 10 ms samples: still, but a strong step left 1.5 s after every Go
                const now = performance.now(), cue = document.querySelector('.gc-tcue'), s = [];
                for (let i = 0; i < 4; i++) {
                    const k = __tick++, go = cue && cue.classList.contains('go');
                    if (go && !window.__goAt) window.__goAt = now; if (!go) window.__goAt = 0;
                    const into = window.__goAt ? now - __goAt : -1, l = into > 200 && into < 330 ? -8 : into >= 330 && into < 460 ? 8 : 0;
                    s.push([20000 + k * 10, l, -l, 0, l, -l, 9.81, 0, 0, 0]);     // up = z; sideways on x and -y (screen angle 0 or 90)
                }
                __mypcMotion({ n: 20000 + __tick * 10, s });
            }, 40);
        });
        await A.click('.gc-tmove .btn');                               // LEFT: Record 5
        await A.waitForFunction(() => { const d = Store.rawGet('arc_dev_ctrltrain'); return d && d.reps.LEFT && d.reps.LEFT.length === 5; }, null, { timeout: 30000 });
        const tr = await A.evaluate(() => { clearInterval(__feed); return Store.rawGet('arc_dev_ctrltrain'); });
        check(tr.report.length === 1 && tr.report[0].move === 'LEFT' && tr.define.LEFT && tr.define.LEFT.below < 0, 'Android app: the Train tab records a move 5 times and sets its limit (' + JSON.stringify(tr.report) + ')');
        await A.evaluate(() => document.querySelector('.gc-leave2').click());
        check(await A.evaluate(() => __nat.slice(-2).sort().join() === 'active:false,motion:false'), 'Android app: leaving stops the native sensors and the keep-awake (' + await A.evaluate(() => __nat.join()) + ')');
        // Control Panel on the phone: Display > Screen rotation (the Game controller's setting) and Devices > Vibration (for the whole My PC app)
        await A.evaluate(() => { Win.close(); Win.open('settings', 'display'); });
        await A.waitForFunction(() => [...document.querySelectorAll('.set-row')].some((r) => /Screen rotation/.test(r.textContent)), null, { timeout: 5000 });
        await A.evaluate(() => { __nat.length = 0; [...document.querySelectorAll('.set-row')].find((r) => /Screen rotation/.test(r.textContent)).click(); });
        check(await A.evaluate(() => Rotation.mode() === 'manual' && __nat.join() === 'settings:{"orient":"landscape","rotate":false}' && Store.rawGet('arc_dev_ctrlphone').opt.orient === 'manual' && [...document.querySelectorAll('.set-row')].some((r) => /Rotate screen/.test(r.textContent))), 'Android app: OK on Screen rotation in Control Panel > Display goes to the next choice (Manual: held, Rotate screen shows) and tells the app at once (' + await A.evaluate(() => __nat.join()) + ')');
        await A.evaluate(() => { Rotation.set('landscape'); Win.close(); Win.open('settings', 'devices'); });
        await A.waitForFunction(() => [...document.querySelectorAll('.set-row')].some((r) => /Vibration/.test(r.textContent)), null, { timeout: 5000 });
        const cpRows = await A.evaluate(() => [...document.querySelectorAll('.set-row')].map((r) => r.querySelector('.set-row-name') ? r.querySelector('.set-row-name').textContent : '').filter((x) => /rotat|Vibration/i.test(x)));
        check(cpRows.join() === 'Vibration', 'Android app: Control Panel > Devices has Vibration (screen rotation moved to Display) (' + cpRows + ')');
        await A.evaluate(() => { __nat.length = 0; });
        await A.evaluate(() => [...document.querySelectorAll('.set-row')].find((r) => /Vibration/.test(r.textContent)).click());
        check(await A.evaluate(() => Haptics.level() === 2 && __nat[__nat.length - 1] === 'vib:22'), 'Android app: OK on Vibration in Control Panel goes one step stronger and buzzes (' + await A.evaluate(() => __nat.join()) + ')');
        await A.evaluate(() => Win.close());
        check(A.errors.length === 0, 'no page errors in the Android app ' + A.errors.join('; '));
        await A.context().close();
        // the Android app opens My PC itself: phone-sized taskbar and icons, a Game controller shortcut, the phone's Back is the
        // TV remote's Back (exit asks first, then the app closes)
        const H = await newPage(browser, base, db, { phone: true, viewport: { width: 844, height: 390 } });
        await H.addInitScript(() => { window.__nat = []; window.MyPCNative = { caps: () => '{"motion":true}', motion: () => {}, active: () => {}, exit: () => __nat.push('exit') }; });
        await H.goto(base + 'index.html');
        await H.waitForSelector('#desk-icons .dicon', { timeout: 20000 });
        const look = await H.evaluate(() => ({ compact: document.documentElement.classList.contains('compact'), pad: !!document.querySelector('#desk-icons [data-app="gamepad"]'),
            btn: document.querySelector('.tb-btn').getBoundingClientRect().height, apps: document.querySelector('.tb-apps').getBoundingClientRect().right, tray: document.querySelector('.tray').getBoundingClientRect().left }));
        check(look.compact && look.btn >= 50 && look.apps < look.tray, 'phone: taskbar buttons big enough for a finger (' + Math.round(look.btn) + ' px), not over the clock ' + JSON.stringify(look));
        check(look.pad, 'phone: the Game controller has a desktop shortcut');
        check(await H.evaluate(() => { const b = document.querySelector('[data-app="getapp"]'); return !!b && b.textContent === I18n.t('getAppUpdate'); }), 'inside the Android app the shortcut is "Update the app"');
        // an Android phone's browser: "Get the app" downloads the latest APK
        const G = await newPage(browser, base, db, { phone: true, viewport: { width: 844, height: 390 } });
        await G.addInitScript(() => {
            Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36' });
            window.__dl = []; HTMLAnchorElement.prototype.click = function () { __dl.push([this.href, this.getAttribute('download')]); };
        });
        await G.goto(base + 'index.html');
        await G.waitForSelector('#desk-icons [data-app="getapp"]', { timeout: 20000 });
        await G.evaluate(() => document.querySelector('[data-app="getapp"]').click());
        const dl = await G.evaluate(() => __dl[0] || []);
        check(/android-controller\/My-PC\.apk\?b=\d+$/.test(dl[0] || '') && dl[1] === 'My-PC.apk', 'Android browser: "Get the app" downloads the latest APK (' + dl.join(' ') + ')');
        check(G.errors.length === 0, 'no page errors with Get the app ' + G.errors.join('; '));
        await G.context().close();
        await H.evaluate(() => Input.systemBack());
        await H.waitForFunction(() => !document.getElementById('dialog-backdrop').hidden, null, { timeout: 4000 });
        await H.evaluate(() => document.getElementById('dialog-yes').click());
        check(await H.evaluate(() => __nat.join()) === 'exit', 'Android app: Back on the desktop asks to exit, Yes closes the app');
        check(H.errors.length === 0, 'no page errors in My PC on the phone ' + H.errors.join('; '));
        await H.context().close();
        check(tv.errors.length === 0 && P1.errors.length === 0 && P2.errors.length === 0, 'no page errors ' + tv.errors.concat(P1.errors, P2.errors).join('; '));
        for (const pg of [tv, P2]) await pg.context().close();
    }

    console.log('36. player accounts: unique username + password, per-profile cloud copy, phone sign-in, password lock');
    {
        const db = {};
        const tv = await newPage(browser, base, db);
        await routeHosted(tv, { offline: true });
        await tv.goto(base + 'index.html');
        await tv.waitForSelector('#desk-icons .dicon');
        check(await tv.evaluate(() => Accounts._sha256('abc')) === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'SHA-256 of "abc" is the standard value');
        const okKey = (pg) => pg.evaluate(() => [...document.querySelectorAll('#namer-keys button')].pop().click());
        const typeIn = async (pg, txt) => { await pg.waitForFunction(() => window.ProfilesUI && Keyboard.isOpen()); await pg.keyboard.type(txt); await okKey(pg); };
        const toast = (pg) => pg.evaluate(() => document.getElementById('toast').hidden ? '' : document.getElementById('toast').textContent);
        // a local profile becomes an account (Settings > Accounts)
        await tv.evaluate(() => { Store.set('game_snake_lvl', 5); Win.open('settings'); });
        await tv.evaluate(() => document.querySelector('[data-page="accounts"]').click());
        const makeRow = await tv.evaluate(() => { const b = [...document.querySelectorAll('.set-row')].find((x) => /Create an account/.test(x.textContent)); if (b) b.click(); return !!b; });
        check(makeRow, 'Settings > Accounts offers "Create an account for this profile" on a local profile');
        await typeIn(tv, 'Imad12');
        check(await tv.evaluate(() => document.getElementById('namer-title').textContent) === 'Password', 'the username is lower case and the password comes next');
        await typeIn(tv, 'short');
        check(/at least 6/.test(await toast(tv)), 'a password under 6 characters is refused: ' + await toast(tv));
        await typeIn(tv, 'Secret#1'); await typeIn(tv, 'Secret#2');
        check(/not the same/.test(await toast(tv)), 'two different passwords are refused');
        await typeIn(tv, 'Secret#1'); await typeIn(tv, 'Secret#1');
        await tv.waitForFunction(() => !!Profiles.current().user, null, { timeout: 5000 }).catch(() => {});
        const uid = db.auth['imad12@players.mypc.app'] && db.auth['imad12@players.mypc.app'].uid;
        await tv.waitForFunction(() => true);
        await tv.waitForTimeout(300);
        check(!!uid && await tv.evaluate(() => Profiles.current().id === 'p1' && Profiles.current().user === 'imad12'), 'the account imad12 is created in Firebase Authentication and linked to this profile');
        check(!!db.players[uid] && db.players[uid].data.snake.lvl === '5' && db.players[uid].user === 'imad12', 'the profile\'s saves are in players/<uid> (data.<game>.<key>)');
        check(typeof db.players[uid].settings === 'object' && !Object.keys(db.players[uid].settings).some((k) => /^game_/.test(k)) && !('blob' in db.players[uid]),
            'other keys are in settings; no old blob field');
        check(db.playerAuth.every((t) => t.indexOf('id-' + uid) === 0), 'players/<uid> is only reached with that account\'s token');
        const ls = await tv.evaluate(() => Object.keys(localStorage).map((k) => k + '=' + localStorage.getItem(k)).join('\n'));
        check(ls.indexOf('Secret#1') < 0 && JSON.stringify(db.players[uid]).indexOf('Secret#1') < 0, 'the password is stored nowhere in plain text');
        check(await tv.evaluate(() => !Object.keys(Backup.snapshot()).some((k) => /acct/.test(k)) && Backup.snapshot().arc_profiles.indexOf('imad12') > 0), 'the TV backup has the username but not the account\'s token or check code');
        check(await tv.evaluate(() => /Account imad12/.test(document.querySelector('.set-card').textContent) && !!document.querySelector('.set-qr svg')), 'Settings shows the account and a "Use on your phone" QR code');
        await tv.evaluate(() => Win.close());
        // the same username can't be taken twice
        await tv.evaluate(() => ProfilesUI.open());
        await tv.focus('#profile-new'); await tv.keyboard.press('Enter');
        await typeIn(tv, 'imad12'); await typeIn(tv, 'other99'); await typeIn(tv, 'other99');
        await tv.waitForFunction(() => /already exists/.test(document.getElementById('toast').textContent), null, { timeout: 5000 }).catch(() => {});
        check(/Username already exists/.test(await toast(tv)) && await tv.evaluate(() => Keyboard.isOpen() && document.getElementById('namer-text').textContent === 'imad12'), 'a taken username shows "Username already exists" and asks for another one');
        await tv.evaluate(() => Keyboard.close());
        await tv.evaluate(() => ProfilesUI.close());
        check(await tv.evaluate(() => Profiles.list().length) === 1, 'no profile is added for a taken username');

        // a phone signs in to the same account and continues
        const ph = await newPage(browser, base, db, { phone: true });
        await routeHosted(ph, { offline: true });
        await ph.goto(base + 'index.html?signin=imad12');
        await ph.waitForFunction(() => window.ProfilesUI && Keyboard.isOpen && Keyboard.isOpen(), null, { timeout: 15000 }).catch(() => {});
        check(await ph.evaluate(() => document.getElementById('namer-text').textContent) === 'imad12', 'the "Use on phone" link opens Sign in with the username filled in');
        await okKey(ph);
        await typeIn(ph, 'wrong11');
        await ph.waitForFunction(() => /Wrong username or password/.test(document.getElementById('toast').textContent), null, { timeout: 5000 }).catch(() => {});
        check(/Wrong username or password/.test(await toast(ph)), 'a wrong password is refused on the phone');
        await typeIn(ph, 'Secret#1');
        await signedIn(ph);
        check(await ph.evaluate(() => Profiles.current().user === 'imad12' && Store.get('game_snake_lvl') === 5), 'on the phone the profile comes with its progress (level 5)');
        await ph.evaluate(() => Store.set('game_snake_lvl', 9));
        await ph.evaluate(() => new Promise((res) => Accounts.upload(Store.profile(), res)));
        check(db.players[uid].data.snake.lvl === '9', 'progress made on the phone goes to the account');
        // the TV starts again: the newer copy comes back
        await tv.reload();
        await signedIn(tv);
        check(await tv.evaluate(() => Store.get('game_snake_lvl')) === 9 && db.authLog.includes('refresh'), 'the TV picks up the phone\'s progress at the next start (token refreshed)');
        // a copy written by an older build (one "blob" string) still comes back, and the next upload moves it to data
        db.players[uid] = { user: 'imad12', name: 'imad12', color: '#4cd97b', size: 0, at: Date.now() + 60000, from: 'old build',
            blob: JSON.stringify({ 'game_snake_lvl': '11', 'game_app-real-soccer-6_data': '{"goals":3}', theme: '"win11"' }) };
        await tv.reload();
        await signedIn(tv);
        check(await tv.evaluate(() => Store.get('game_snake_lvl') === 11 && Store.get('game_app-real-soccer-6_data').goals === 3), 'an old single-blob copy is still read (no save lost)');
        await tv.evaluate(() => new Promise((res) => Accounts.upload(Store.profile(), res)));
        await tv.waitForFunction(() => true); await tv.waitForTimeout(300);
        check(db.players[uid].data.snake.lvl === '11' && db.players[uid].data['app-real-soccer-6'].data === '{"goals":3}' && db.players[uid].settings.theme === '"win11"' && !('blob' in db.players[uid]),
            'the next upload writes it as data.<game>.<key> + settings and removes the old blob');
        // a copy with both shapes (old blob left next to data): merged, nothing lost, then the blob goes
        db.players[uid].blob = JSON.stringify({ 'game_hopper_best': '[7]', 'game_snake_lvl': '1' });
        await tv.evaluate(() => Store.remove('game_hopper_best'));
        const merged = await tv.evaluate(() => new Promise((res) => Accounts.pull(Store.profile(), 3000, res)));
        await tv.waitForTimeout(300);
        check(await tv.evaluate(() => Store.get('game_snake_lvl') === 11 && JSON.stringify(Store.get('game_hopper_best')) === '[7]') && merged === true,
            'old blob keys this device lacks are merged in (hopper), the newer value wins (snake 11)');
        check(!('blob' in db.players[uid]) && db.players[uid].data.hopper.best === '[7]' && db.players[uid].data.snake.lvl === '11', 'then the doc is written in the new shape without the blob');
        // a newer copy that lacks a key never wipes this device's progress
        await tv.evaluate(() => Store.set('game_merge_best', 4096));
        db.players[uid] = Object.assign({}, db.players[uid], { at: Date.now() + 120000, data: { snake: { lvl: '13' } } });
        const pr = await tv.evaluate(() => new Promise((res) => Accounts.pull(Store.profile(), 3000, res)));
        const kept = await tv.evaluate(() => [Store.get('game_snake_lvl'), Store.get('game_merge_best'), JSON.stringify(Store.get('game_hopper_best'))].join());
        check(kept === '13,4096,[7]', 'a newer copy (another device) wins over an older local change, updates what it has and keeps what it lacks (' + kept + ')');
        // rules not published again yet: the upload falls back to the old shape instead of failing
        db.oldPlayerRules = true;
        await tv.evaluate(() => Store.set('game_snake_lvl', 12));
        const old = await tv.evaluate(() => new Promise((res) => Accounts.upload(Store.profile(), res)));
        check(old === null && !db.players[uid].data && JSON.parse(db.players[uid].blob).game_snake_lvl === '12', 'with the old rules the copy is saved in the old shape');
        db.oldPlayerRules = false;
        await tv.evaluate(() => new Promise((res) => Accounts.upload(Store.profile(), res)));
        check(db.players[uid].data.snake.lvl === '12' && !('blob' in db.players[uid]), 'and in the new shape (old blob removed) once the rules are published');
        // back from a game: only that game goes up (another game's newer saves in the cloud stay as they are)
        db.players[uid].data.hopper = { best: '[99]' };                   // played on the phone meanwhile
        db.masks = [];
        await tv.evaluate(() => Store.set('game_snake_lvl', 20));
        await tv.evaluate(() => new Promise((res) => Accounts.upload(Store.profile(), res)));
        const m1 = (db.masks.pop() || { mask: [] }).mask;
        check(db.players[uid].data.snake.lvl === '20' && db.players[uid].data.hopper.best === '[99]' && m1.filter((f) => /^data\./.test(f)).join() === 'data.`snake`',
            'an upload writes only the game that changed (data.`snake`); hopper\'s newer cloud save is kept: ' + m1.join(' '));
        await tv.evaluate(() => Store.set('game_app-real-soccer-6_data', { goals: 5 }));
        await tv.evaluate(() => new Promise((res) => Accounts.upload(Store.profile(), res)));
        check(db.players[uid].data['app-real-soccer-6'].data === '{"goals":5}' && db.players[uid].data.snake.lvl === '20', 'a store app id with dashes is written as its own field');
        // a newer cloud copy at the start: other games come from it, a game changed here after it stays
        db.players[uid].at = Date.now(); db.players[uid].data.snake = { lvl: '30' }; db.players[uid].data.merge = { best: '1' };
        await tv.waitForTimeout(20);
        await tv.evaluate(() => Store.set('game_merge_best', 5000));
        await tv.evaluate(() => new Promise((res) => Accounts.pull(Store.profile(), 3000, res)));
        const both = await tv.evaluate(() => [Store.get('game_snake_lvl'), Store.get('game_merge_best')].join());
        check(both === '30,5000', 'a newer cloud copy brings the other games, the game changed here after it is kept (' + both + ')');
        const prules = fs.readFileSync(path.join(ROOT, 'firebase/firestore.rules'), 'utf8');
        check(/d\.data is map/.test(prules) && /shortText\(d\.blob, 20\)/.test(prules), 'the rules want data as a map and refuse a whole-profile blob');

        // "Ask for the password": the start shows the password screen first
        await tv.evaluate(() => { Profiles.setAsk('p1', true); sessionStorage.clear(); });
        await tv.reload();
        await tv.waitForFunction(() => window.ProfilesUI && Keyboard.isOpen(), null, { timeout: 15000 }).catch(() => {});
        check(await tv.evaluate(() => Keyboard.isOpen() && /Password/.test(document.getElementById('namer-title').textContent) && !document.getElementById('profiles').hidden), 'with "Ask for the password" on, My PC starts on the password screen');
        await tv.keyboard.press('Escape');
        check(await tv.evaluate(() => !Keyboard.isOpen() && !document.getElementById('profiles').hidden && document.getElementById('profile-rename').hidden), 'Back shows the profiles (nothing else) while locked');
        await tv.focus('#profiles-close'); await tv.keyboard.press('Enter');
        check(await tv.evaluate(() => Keyboard.isOpen()), 'closing the profiles asks for the password again');
        db.down = true;                                      // offline: the check code on the TV is enough
        await typeIn(tv, 'nope123');
        await tv.waitForFunction(() => /Wrong password/.test(document.getElementById('toast').textContent) && Keyboard.isOpen(), null, { timeout: 5000 }).catch(() => {});
        check(await tv.evaluate(() => Keyboard.isOpen()), 'a wrong password keeps the screen');
        await typeIn(tv, 'Secret#1');
        check(await tv.evaluate(() => !Keyboard.isOpen() && document.getElementById('profiles').hidden), 'the right password opens the desktop, also offline');
        db.down = false;

        // change the password on the TV: the phone has to sign in again
        const changed = await tv.evaluate(() => new Promise((res) => Accounts.changePassword('p1', 'Secret#1', 'Newpass9', res)));
        check(changed === null && db.auth['imad12@players.mypc.app'].pw === 'Newpass9', 'the password can be changed');
        await ph.reload();
        await signedIn(ph);
        check(await ph.evaluate(() => !Accounts.signedIn(Store.profile())), 'the phone is signed out after a password change somewhere else');
        const again = await ph.evaluate(() => new Promise((res) => Accounts.check(Store.profile(), 'Newpass9', (ok) => res(ok && Accounts.signedIn(Store.profile())))));
        check(again, 'the new password signs it in again');
        check(tv.errors.length === 0 && ph.errors.length === 0, 'no page errors ' + tv.errors.concat(ph.errors).join('; '));
        await tv.context().close(); await ph.context().close();
    }

    console.log('37. app bridges: MyPC.net (web requests), MyPC.ai (Gemini, NVIDIA / OpenAI-compatible), MyPC.mic, permissions; update screen on a phone');
    {
        const APP = 'https://apps.example.test/star/';
        const fdb = {};
        const page = await newPage(browser, base, fdb);
        await page.context().grantPermissions(['microphone']);
        await routeHosted(page, { offline: true });
        await page.route(OLD_HOSTED + 'sdk/mypc-sdk.js', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(ROOT, 'sdk/mypc-sdk.js')) }));
        await page.context().route(APP + '**', (r) => {
            const rel = r.request().url().slice(APP.length).split('?')[0] || 'index.html', p = path.join(ROOT, 'sdk/example', rel);
            if (!fs.existsSync(p)) return r.fulfill({ status: 404, body: '' });
            r.fulfill({ status: 200, contentType: TYPES[path.extname(p)] || 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' }, body: fs.readFileSync(p) });
        });
        const doc = { fields: { id: { stringValue: 'star-catcher' }, name: { stringValue: 'Star Catcher' }, url: { stringValue: APP }, entry: { stringValue: APP + 'index.html' },
            icon: { stringValue: APP + 'icon.svg' }, type: { stringValue: 'game' }, version: { stringValue: '1.0.0' }, enabled: { booleanValue: true }, order: { integerValue: '0' } } };
        await page.addInitScript(() => { if (!localStorage.getItem('arc_dev_installed')) localStorage.setItem('arc_dev_installed', JSON.stringify([{ id: 'star-catcher', at: 1 }])); });
        await page.context().route('https://firestore.googleapis.com/**', (r) => {
            if (!/\/documents\/apps(\/|\?|$)/.test(r.request().url())) return r.fallback();
            const body = r.request().url().indexOf('/documents/apps/star-catcher') > 0 ? doc : { documents: [doc] };
            r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
        });
        // "other websites" the app calls. (Chromium needs a CORS header here; on the TV My PC's requests have no CORS limit.)
        const seen = {};
        const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
        await page.context().route('https://api.nocors.test/**', (r) => {
            const q = r.request();
            if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
            seen.net = { method: q.method(), header: q.headers()['x-test'], body: q.postData() };
            if (/bin$/.test(q.url())) return r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: cors, body: Buffer.from([7, 8, 9, 10]) });
            if (/sse$/.test(q.url())) return r.fulfill({ status: 200, contentType: 'text/event-stream', headers: cors, body: 'data: one\n\ndata: two\n\n' });
            r.fulfill({ status: 201, contentType: 'application/json', headers: Object.assign({ 'X-Reply': 'yes', 'Access-Control-Expose-Headers': 'X-Reply' }, cors), body: JSON.stringify({ hello: 'world' }) });
        });
        const gemPng = Buffer.from([137, 80, 78, 71]).toString('base64');
        await page.context().route('https://generativelanguage.googleapis.com/**', (r) => {
            const q = r.request();
            if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
            seen.gemini = { url: q.url(), key: q.headers()['x-goog-api-key'], body: JSON.parse(q.postData() || '{}') };
            r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"a": 1}' }, { inlineData: { mimeType: 'image/png', data: gemPng } }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 } }) });
        });
        await page.context().route('https://integrate.api.nvidia.com/**', (r) => {
            const q = r.request();
            if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
            seen.nvidia = { url: q.url(), auth: q.headers().authorization, body: JSON.parse(q.postData() || '{}') };
            if (seen.nvidia.body.stream) return r.fulfill({ status: 200, contentType: 'text/event-stream', headers: cors, body: 'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\ndata: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n' });
            r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ choices: [{ message: { content: 'Hi there' }, finish_reason: 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } }) });
        });
        await page.context().route('https://ollama.test/**', (r) => {
            const q = r.request();
            if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
            seen.ollama = { url: q.url(), body: JSON.parse(q.postData() || '{}') };
            if (/\/api\/generate$/.test(q.url())) {
                if (seen.ollama.body.stream) return r.fulfill({ status: 200, contentType: 'application/x-ndjson', headers: cors, body: '{"response":"Sa","done":false}\n{"response":"lut","done":false}\n{"response":"","done":true,"done_reason":"stop","prompt_eval_count":2,"eval_count":2}\n' });
                return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ model: 'phi', response: 'Completed', done: true, done_reason: 'stop', prompt_eval_count: 3, eval_count: 1 }) });
            }
            if (seen.ollama.body.stream) return r.fulfill({ status: 200, contentType: 'application/x-ndjson', headers: cors, body: '{"message":{"role":"assistant","content":"Bon"},"done":false}\n{"message":{"role":"assistant","content":"jour"},"done":false}\n{"message":{"role":"assistant","content":""},"done":true,"done_reason":"stop","prompt_eval_count":3,"eval_count":2}\n' });
            r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ model: 'llama3.1:8b', message: { role: 'assistant', content: 'Hello from Ollama' }, done: true, done_reason: 'stop', prompt_eval_count: 5, eval_count: 4 }) });
        });
        await page.context().route('https://877104f7-e885-42b9-8de8-f6e4c6303969.invocation.api.nvcf.nvidia.com/**', (r) => {
            const q = r.request();
            if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
            seen.magpie = { url: q.url(), auth: q.headers().authorization, type: q.headers()['content-type'] || '', body: (q.postDataBuffer() || Buffer.alloc(0)).toString('latin1') };
            r.fulfill({ status: 200, contentType: 'audio/wav', headers: cors, body: Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(40)]) });
        });
        await page.goto(base + 'index.html');
        const icon = '#desk-icons [data-game="app-star-catcher"]';
        async function openApp() {
            await page.waitForSelector(icon, { timeout: 8000 });
            await page.focus(icon); await page.keyboard.press('Enter');
            await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'running', null, { timeout: 10000 });
            const f = page.frames().find((x) => x.url().indexOf(APP) === 0);
            await f.waitForFunction(() => MyPC.info() && MyPC.info().bridges);
            return f;
        }
        let frame = await openApp();
        check(await frame.evaluate(() => MyPC.apiLevel >= 10 && MyPC.info().bridges.net === 1 && MyPC.info().bridges.ai === 1), 'the app learns that My PC does web requests, AI and the microphone for it (API 10)');
        const nst = await frame.evaluate(() => Promise.all([MyPC.notify.status(), MyPC.notify.request()]).then((a) => a.concat([MyPC.apiLevel, MyPC.launch, MyPC.info().notify])));
        check(nst[0] === 'no-account' && nst[1] === 'no-account' && nst[2] >= 12 && nst[3] === null && nst[4] === 1 && !(await page.evaluate(() => App.dialogOpen())),
            'MyPC.notify (API 12): a profile without an account cannot get notifications, nothing is asked; MyPC.launch is null (' + JSON.stringify(nst) + ')');
        await frame.evaluate(() => { window.__launches = []; const o = MyPC.info; });
        const dl = await page.evaluate(() => GameHost.deepLink('app-star-catcher', { link: 'star-catcher:challenge/1', app: 'star-catcher', path: 'challenge/1', title: 'New challenge', text: '', at: 1 }));
        await frame.waitForFunction(() => MyPC.launch && MyPC.launch.path === 'challenge/1', null, { timeout: 3000 }).catch(() => {});
        check(dl === true && await frame.evaluate(() => MyPC.launch && MyPC.launch.path === 'challenge/1' && MyPC.launch.app === 'star-catcher') &&
            await page.evaluate(() => GameHost.deepLink('app-other', { path: 'x' })) === false, 'a deep link for the open app reaches it at once (MyPC.launch, onLaunch); another app\'s is not sent to it');
        // MyPC.net
        const r1 = await frame.evaluate(() => MyPC.net.fetch('https://api.nocors.test/items', { method: 'POST', headers: { 'X-Test': 'abc', Cookie: 'no' }, json: { n: 1 }, responseType: 'json' }).then((r) => ({ status: r.status, body: r.body, json: r.json(), h: r.headers['x-reply'] })));
        check(r1.status === 201 && r1.body.hello === 'world' && r1.json.hello === 'world' && r1.h === 'yes' && seen.net.method === 'POST' && seen.net.header === 'abc' && seen.net.body === '{"n":1}',
            'MyPC.net.fetch sends the request from My PC (method, headers, JSON body) and gives back status, headers and the parsed answer');
        const bin = await frame.evaluate(() => MyPC.net.fetch('https://api.nocors.test/file.bin', { responseType: 'arraybuffer' }).then((r) => r.body instanceof ArrayBuffer ? Array.from(new Uint8Array(r.body)).join(',') : 'no'));
        check(bin === '7,8,9,10', 'binary answers arrive as an ArrayBuffer (' + bin + ')');
        const sse = await frame.evaluate(() => { const parts = []; return MyPC.net.fetch('https://api.nocors.test/sse', { onChunk: (t) => parts.push(t) }).then((r) => parts.join('') === r.body && /two/.test(r.body)); });
        check(sse, 'onChunk streams the answer while it arrives (Server-Sent Events)');
        const lan = await frame.evaluate(() => MyPC.net.fetch('http://192.168.1.1/admin').then(() => 'ok', (e) => e.code));
        const file = await frame.evaluate(() => MyPC.net.fetch('file:///etc/passwd').then(() => 'ok', (e) => e.code));
        check(lan === 'blocked' && file === 'bad-request', 'the local network (the router...) and non-web addresses are refused (' + lan + ', ' + file + ')');
        // MyPC.ai without any service
        const none = await frame.evaluate(() => MyPC.ai.chat('hi').then(() => 'ok', (e) => e.code));
        check(none === 'no-provider' && /App Store Manager/.test(await page.textContent('#toast')), 'MyPC.ai with no AI service set up: a clear error, and the TV says where to add one');
        // the owner adds Gemini and NVIDIA in the App Store Manager (settings/ai); the TV copies them
        fdb.settings = { ai: { def: 'gemini', list: [
            { id: 'gemini', preset: 'gemini', type: 'gemini', name: 'Google Gemini', url: 'https://generativelanguage.googleapis.com/v1beta', key: 'GKEY-secret', model: 'gemini-2.5-flash' },
            { id: 'nvidia', preset: 'nvidia', type: 'openai', name: 'NVIDIA', url: 'https://integrate.api.nvidia.com/v1', key: 'nvapi-secret', model: 'meta/llama-3.3-70b-instruct', speechUrl: '877104f7-e885-42b9-8de8-f6e4c6303969' }] } };
        await page.evaluate(() => new Promise((r) => Bridges.syncAi(r)));
        check(await page.evaluate(() => AI.list().length === 2 && AI.defaultId() === 'gemini' && AI.find('nvidia').key === 'nvapi-secret'), 'My PC copies the AI services set in the App Store Manager (settings/ai)');
        const provs = await frame.evaluate(() => MyPC.ai.providers());
        check(provs.length === 2 && provs[0].id === 'gemini' && provs[0].isDefault && provs[1].preset === 'nvidia' && !JSON.stringify(provs).includes('secret') && !JSON.stringify(provs).includes('https'),
            'MyPC.ai.providers() lists the services by name and model, never their keys or addresses');
        const gen = frame.evaluate(() => MyPC.ai.generate({ system: 'You grade drawings.', rules: ['Be short', 'Use French'], context: { level: 2 },
            prompt: ['Describe this', { type: 'image', data: new Uint8Array([1, 2, 3]).buffer, mime: 'image/png' }], output: ['json', 'image'], schema: { type: 'object' }, temperature: 0.2 })
            .then((r) => ({ json: r.json, text: r.text, img: r.parts.filter((p) => p.type === 'image').map((p) => p.mime + ':' + (p.data instanceof ArrayBuffer ? p.data.byteLength : -1)), usage: r.usage, all: JSON.stringify(r) })));
        await page.waitForSelector('#dialog-backdrop:not([hidden])', { timeout: 4000 });
        check(/Star Catcher wants to use AI/.test(await page.textContent('#dialog-title')) && /Google Gemini/.test(await page.textContent('#dialog-text')) && await page.textContent('#dialog-yes') === 'Allow' &&
            await page.evaluate(() => GameHost.state()) === 'paused', 'the first AI request asks the user (Allow / Don\'t allow), with the app paused under the question');
        await page.click('#dialog-yes');
        const g = await gen;
        const gb = seen.gemini.body;
        check(seen.gemini.key === 'GKEY-secret' && /models\/gemini-2\.5-flash:generateContent$/.test(seen.gemini.url) && /You grade drawings/.test(gb.systemInstruction.parts[0].text) && /- Use French/.test(gb.systemInstruction.parts[0].text) &&
            /"level":2/.test(gb.systemInstruction.parts[0].text) && gb.contents[0].parts[1].inline_data.data === 'AQID' && gb.contents[0].parts[1].inline_data.mime_type === 'image/png' &&
            gb.generationConfig.responseMimeType === 'application/json' && gb.generationConfig.temperature === 0.2 && gb.generationConfig.responseModalities.join() === 'TEXT,IMAGE',
            'Gemini gets the system text with the rules and context, the image as inline data, JSON and image output, and the key in its header');
        check(g.json && g.json.a === 1 && g.img[0] === 'image/png:4' && g.usage.total === 8 && !g.all.includes('GKEY'), 'the answer comes back as text, parsed JSON and an image (ArrayBuffer), with usage; the key never reaches the app');
        check(await page.evaluate(() => GameHost.state()) === 'running', 'after the answer the app runs again');
        const deltas = await frame.evaluate(() => { const d = []; return MyPC.ai.generate({ provider: 'nvidia', prompt: 'hi', maxTokens: 50 }, { onDelta: (t) => d.push(t) }).then((r) => d.join('|') + '=' + r.text + ':' + r.finish); });
        check(deltas === 'Hel|lo=Hello:stop' && seen.nvidia.auth === 'Bearer nvapi-secret' && /\/v1\/chat\/completions$/.test(seen.nvidia.url) && seen.nvidia.body.model === 'meta/llama-3.3-70b-instruct' && seen.nvidia.body.max_tokens === 50 && seen.nvidia.body.stream === true,
            'NVIDIA (OpenAI-compatible): streamed pieces through onDelta, Bearer key, the service\'s model; no second question once allowed (' + deltas + ')');
        const own = await frame.evaluate(() => MyPC.ai.generate({ provider: { type: 'openai', url: 'https://integrate.api.nvidia.com/v1', key: 'app-own-key', model: 'm1' }, messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'Q' }, { role: 'assistant', content: 'A' }, { role: 'user', content: 'Q2' }] }).then((r) => r.text));
        check(own === 'Hi there' && seen.nvidia.auth === 'Bearer app-own-key' && seen.nvidia.body.messages.map((m) => m.role).join() === 'system,user,assistant,user', 'an app can bring its own provider and key; messages keep their roles');
        const oll = await frame.evaluate(() => MyPC.ai.generate({ provider: { preset: 'ollama', url: 'https://ollama.test/v1', model: 'llama3.1:8b' }, system: 'S', prompt: 'Hello', temperature: 0.5, maxTokens: 20 }).then((r) => r.text + ':' + r.usage.total));
        const ob = seen.ollama.body;
        check(oll === 'Hello from Ollama:9' && /^https:\/\/ollama\.test\/api\/chat$/.test(seen.ollama.url) && ob.model === 'llama3.1:8b' && ob.stream === false && ob.messages.map((m) => m.role + '=' + m.content).join() === 'system=S,user=Hello' &&
            ob.options.temperature === 0.5 && ob.options.num_predict === 20, 'Ollama uses its own POST /api/chat (model, messages, stream: false) and reads message.content (' + oll + ', ' + seen.ollama.url + ')');
        const ollS = await frame.evaluate(() => { const d = []; return MyPC.ai.generate({ provider: { type: 'ollama', url: 'https://ollama.test', model: 'llama3.1:8b' }, prompt: 'hi' }, { onDelta: (t) => d.push(t) }).then((r) => d.join('|') + '=' + r.text + ':' + r.finish); });
        check(ollS === 'Bon|jour=Bonjour:stop' && seen.ollama.body.stream === true, 'Ollama streaming reads its one-JSON-per-line answer (' + ollS + ')');
        // completion mode: POST /api/generate with one prompt, answer in "response"
        const olc = await frame.evaluate(() => MyPC.ai.generate({ provider: { type: 'ollama', url: 'https://ollama.test', model: 'phi', mode: 'completion' }, system: 'S', prompt: 'Hello', maxTokens: 9 }).then((r) => r.text + ':' + r.usage.total));
        const cb = seen.ollama.body;
        check(olc === 'Completed:4' && /\/api\/generate$/.test(seen.ollama.url) && cb.prompt === 'Hello' && cb.system === 'S' && !cb.messages && cb.stream === false && cb.options.num_predict === 9,
            'Ollama completion mode uses POST /api/generate (prompt, system) and reads response (' + olc + ', ' + seen.ollama.url + ')');
        const olcT = await frame.evaluate(() => MyPC.ai.generate({ provider: { type: 'ollama', url: 'https://ollama.test', model: 'phi' }, mode: 'completion', messages: [{ role: 'user', content: 'Q' }, { role: 'assistant', content: 'A' }], prompt: 'Q2' }).then((r) => r.text));
        check(olcT === 'Completed' && seen.ollama.body.prompt === 'User: Q\n\nAssistant: A\n\nUser: Q2\n\nAssistant:', 'a request\'s mode: \'completion\' writes earlier turns into the one prompt (' + JSON.stringify(seen.ollama.body.prompt) + ')');
        const olcS = await frame.evaluate(() => { const d = []; return MyPC.ai.generate({ provider: { type: 'ollama', url: 'https://ollama.test', model: 'phi', mode: 'completion' }, prompt: 'hi' }, { onDelta: (t) => d.push(t) }).then((r) => d.join('|') + '=' + r.text); });
        check(olcS === 'Sa|lut=Salut' && seen.ollama.body.stream === true, 'Ollama completion streaming reads response pieces (' + olcS + ')');
        const olMgr = await page.evaluate(() => { const was = localStorage.getItem('arc_dev_ai'); AI.setManaged({ list: [{ id: 'ol', preset: 'ollama', url: 'http://192.168.1.10:11434', model: 'phi', mode: 'completion' }, { id: 'ol2', preset: 'ollama', url: 'http://x:11434' }] }); const p = AI.providers(); if (was === null) localStorage.removeItem('arc_dev_ai'); else localStorage.setItem('arc_dev_ai', was); return p[0].mode + ',' + p[1].mode; });
        check(olMgr === 'completion,chat', 'an Ollama service keeps its mode from the App Store Manager (chat by default) and apps see it in providers() (' + olMgr + ')');
        const unsup = await frame.evaluate(() => MyPC.ai.generate({ provider: 'nvidia', task: 'video', prompt: 'a cat' }).then(() => 'ok', (e) => e.code));
        check(unsup === 'http' || unsup === 'unsupported' || unsup === 'network', 'a task the service cannot do fails with an error, not a hang (' + unsup + ')');
        // NVIDIA Magpie-Multilingual text to speech (an NVCF function, multipart form, .wav back)
        const tts = await frame.evaluate(() => MyPC.ai.generate({ provider: 'nvidia', task: 'speech', model: 'magpie-multilingual', prompt: 'Hola', voice: 'Aria', language: 'es-US' })
            .then((r) => r.parts.map((p) => p.type + ':' + p.mime + ':' + (p.data instanceof ArrayBuffer ? new TextDecoder().decode(p.data.slice(0, 4)) + p.data.byteLength : 'x')).join()));
        const mb = seen.magpie && seen.magpie.body || '';
        check(tts === 'audio:audio/wav:RIFF44' && /\/v1\/audio\/synthesize$/.test(seen.magpie.url) && seen.magpie.auth === 'Bearer nvapi-secret' && /^multipart\/form-data; boundary=/.test(seen.magpie.type) &&
            /name="text"\r\n\r\nHola\r\n/.test(mb) && /name="language"\r\n\r\nes-US\r\n/.test(mb) && /name="voice"\r\n\r\nMagpie-Multilingual\.ES-US\.Aria\r\n/.test(mb),
            'NVIDIA Magpie speech: a multipart form (text, language, voice) to its NVCF function with the TV\'s key, the .wav comes back as an audio part (' + tts + ')');
        const ttsAr = await frame.evaluate(() => MyPC.ai.generate({ provider: 'nvidia', task: 'speech', prompt: 'مرحبا', language: 'ar' }).then(() => 'ok', (e) => e.code));
        const asr = await frame.evaluate(() => MyPC.ai.generate({ provider: 'nvidia', task: 'transcribe', prompt: [{ type: 'audio', data: new Uint8Array([1, 2]).buffer, mime: 'audio/wav' }] }).then(() => 'ok', (e) => e.code));
        const pv2 = await frame.evaluate(() => MyPC.ai.providers().then((l) => l.find((x) => x.preset === 'nvidia').tasks));
        check(ttsAr === 'unsupported' && asr === 'unsupported' && pv2.speech && !pv2.transcribe && pv2.chat, 'Magpie refuses languages it does not speak; speech to text waits for its function; providers() tells the app which tasks exist (' + ttsAr + ', ' + asr + ')');
        const rawNv = await frame.evaluate(() => MyPC.ai.raw({ provider: 'nvidia', url: 'https://877104f7-e885-42b9-8de8-f6e4c6303969.invocation.api.nvcf.nvidia.com/v1/audio/synthesize', method: 'POST',
            form: { text: 'Hi', language: 'en-US', voice: 'Magpie-Multilingual.EN-US.Aria' }, responseType: 'arraybuffer' }).then((r) => r.status + ':' + (r.body instanceof ArrayBuffer ? r.body.byteLength : -1)));
        const rawBad = await frame.evaluate(() => MyPC.ai.raw({ provider: 'nvidia', url: 'https://evil.example.com/steal', method: 'POST', json: {} }).then(() => 'ok', (e) => e.code));
        check(rawNv === '200:44' && /name="voice"\r\n\r\nMagpie-Multilingual\.EN-US\.Aria/.test(seen.magpie.body) && rawBad === 'blocked', 'MyPC.ai.raw reaches NVIDIA\'s own hosts with a form and binary answer; any other host never gets the key (' + rawNv + ', ' + rawBad + ')');
        // MyPC.mic: allowed once, red microphone while it listens, a .wav at the end
        const micP = frame.evaluate(() => { window.__chunks = 0; window.__lv = 0; MyPC.mic.on('data', () => __chunks++); MyPC.mic.on('level', () => __lv++); return MyPC.mic.start({ chunkMs: 100, sampleRate: 16000 }).then((i) => i.sampleRate + ':' + i.format, (e) => 'err:' + e.code + ' ' + e.message); });
        await page.waitForSelector('#dialog-backdrop:not([hidden])', { timeout: 4000 });
        check(/wants to use the microphone/.test(await page.textContent('#dialog-title')), 'the microphone asks first');
        await page.click('#dialog-yes');
        const micInfo = await micP;
        check(/^\d+:wav$/.test(micInfo) && await page.evaluate(() => !!document.querySelector('.mic-on')), 'the microphone starts and a red microphone shows over the app (' + micInfo + ')');
        await page.waitForTimeout(700);
        const rec = await frame.evaluate(() => MyPC.mic.stop().then((r) => ({ riff: r && new TextDecoder().decode(r.audio.slice(0, 4)), mime: r && r.mime, len: r && r.audio.byteLength, chunks: __chunks, lv: __lv })));
        check(rec.riff === 'RIFF' && rec.mime === 'audio/wav' && rec.len > 44 && rec.chunks > 0 && rec.lv > 0 && await page.evaluate(() => !document.querySelector('.mic-on')),
            'stop() gives the recording as a .wav; live chunks and levels came while it listened; the red microphone goes away (' + rec.len + ' bytes, ' + rec.chunks + ' chunks)');
        const ended = frame.evaluate(() => new Promise((res) => { const off = MyPC.mic.on('end', (e) => { off(); res(e.reason + ':' + !!(e.result && e.result.audio)); }); MyPC.mic.start({ chunkMs: 0 }); }));
        await page.waitForSelector('.mic-on', { timeout: 4000 });
        await tvMenu(page);
        check(await ended === 'paused:true' && await page.evaluate(() => !document.querySelector('.mic-on')), 'My PC\'s menu stops the microphone; the app gets "end" with the recording so far');
        await page.evaluate(() => { const b = document.querySelectorAll('#pause-items button'); b[b.length - 1].click(); });
        await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'idle' && !!document.querySelector('#desk-icons .dicon') && document.activeElement !== document.body, null, { timeout: 8000 });
        // Settings > Privacy forgets the permissions: the next request asks again, and "Don't allow" is an error
        await page.evaluate(() => Win.open('settings', 'privacy'));
        await page.evaluate(() => [...document.querySelectorAll('.set-row')].find((r) => /Forget what apps were allowed/.test(r.textContent)).click());
        check(await page.evaluate(() => !Bridges.allowed('app-star-catcher', 'ai') && !Bridges.allowed('app-star-catcher', 'mic')), 'Settings > Privacy & security > Forget what apps were allowed');
        await page.evaluate(() => Win.close());
        frame = await openApp();
        const denied = frame.evaluate(() => MyPC.ai.chat('hi').then(() => 'ok', (e) => e.code));
        await page.waitForSelector('#dialog-backdrop:not([hidden])', { timeout: 4000 });
        await page.click('#dialog-no');
        check(await denied === 'denied' && await frame.evaluate(() => MyPC.ai.chat('again').then(() => 'ok', (e) => e.code)) === 'denied' && await page.evaluate(() => document.getElementById('dialog-backdrop').hidden),
            '"Don\'t allow" refuses, and the app cannot ask again until it is opened again');
        // Settings > AI lists the services; keys are not in the cloud backup
        await frame.evaluate(() => MyPC.exit());
        await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'idle' && !!document.querySelector('#desk-icons .dicon') && document.activeElement !== document.body, null, { timeout: 8000 });
        await page.evaluate(() => Win.open('settings', 'ai'));
        const aiPage = await page.textContent('.set-main');
        check(/Google Gemini \(default\)/.test(aiPage) && /NVIDIA/.test(aiPage) && /Key saved \(…cret\)/.test(aiPage) && /App Store Manager/.test(aiPage) && /NVIDIA.*voice/.test(aiPage) && !/Add an AI service|API key/.test(aiPage),
            'Settings > AI only shows what the App Store Manager set: the services, the default one, that a key is saved (last 4 characters), what each can do; nothing to type on the TV');
        fdb.settings.ai.list.pop();
        await page.evaluate(() => [...document.querySelectorAll('.set-row')].find((r) => /Check again/.test(r.textContent)).click());
        await page.waitForFunction(() => !/NVIDIA/.test(document.querySelector('.set-main').textContent));
        check(await page.evaluate(() => AI.list().length === 1), 'Check again gets the App Store Manager\'s list again (a service removed there goes away)');
        await page.evaluate(() => Win.close());
        check(await page.evaluate(() => !JSON.stringify(Backup.doc()).includes('secret')), 'AI keys are never in the cloud backup');
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }
    console.log('38. error reports: SDK errors (even before MyPC.init), load failures, dedupe, privacy switch');
    {
        const APP = 'https://apps.example.test/buggy/', STUCK = 'https://apps.example.test/stuck/';
        const mk = (id, url) => ({ id, name: id, url, entry: url + 'index.html', icon: '', type: 'game', version: '2.0.1', enabled: true, order: 0, config: {} });
        const page = await newPage(browser, base, { apps: { buggy: mk('buggy', APP), stuck: mk('stuck', STUCK) } });
        await routeHosted(page, { offline: true });
        await page.route(OLD_HOSTED + 'sdk/mypc-sdk.js', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(ROOT, 'sdk/mypc-sdk.js')) }));
        // an app that throws before MyPC.init, misses a file, throws in onStart and reports a caught error; another one that never loads
        const BUGGY = `<!doctype html><meta charset=utf-8><body><script src="${OLD_HOSTED}sdk/mypc-sdk.js"></script>
            <script>window.early.boom = 1;</script><img src="missing.png">
            <script>MyPC.init({ onInit: function () { MyPC.ready(); }, onStart: function () { throw new Error('start went wrong'); } });</script>`;
        await page.context().route('https://apps.example.test/**', (r) => {
            const u = r.request().url();
            if (u.indexOf(APP + 'index.html') === 0) return r.fulfill({ status: 200, contentType: 'text/html', body: BUGGY });
            r.fulfill({ status: 404, contentType: 'text/html', body: 'Not found' });
        });
        await page.addInitScript(() => { if (!localStorage.getItem('arc_dev_installed')) localStorage.setItem('arc_dev_installed', JSON.stringify([{ id: 'buggy', at: 1 }, { id: 'stuck', at: 1 }])); });
        await page.goto(base + 'index.html');
        const icon = (id) => '#desk-icons [data-game="app-' + id + '"]';
        await page.waitForSelector(icon('buggy'), { timeout: 10000 });
        await page.focus(icon('buggy')); await page.keyboard.press('Enter');
        await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'running', null, { timeout: 10000 });
        const frame = page.frames().find((f) => f.url().indexOf(APP) === 0);
        await frame.evaluate(() => { for (let i = 0; i < 5; i++) setTimeout(() => { throw new Error('loop error'); }, 0); MyPC.report(new Error('save failed'), { slot: 2 }); Promise.reject(new Error('no answer')); });
        await page.waitForTimeout(3500);                         // repeats are counted every 3 s
        await page.evaluate(() => Reports.flush());
        await page.waitForFunction(() => true);
        await page.waitForTimeout(400);
        let reps = Object.values(page.fs.errors);
        const by = (k, re) => reps.find((r) => r.app === 'app-buggy' && r.kind === k && re.test(r.msg));
        check(by('error', /boom/) && by('error', /boom/).stage === 'loading', 'an error thrown before MyPC.init is saved (sent as soon as the SDK runs)');
        check(by('resource', /missing\.png/), 'a file that fails to load is saved');
        check(by('handler', /onStart: start went wrong/), 'an error thrown in an SDK callback (onStart) is saved');
        check(by('report', /save failed \| \{"slot":2\}/), 'MyPC.report(error, data) is saved with its data');
        check(by('rejection', /no answer/), 'an unhandled promise rejection is saved');
        const loop = by('error', /loop error/);
        check(loop && loop.n === 5 && reps.filter((r) => /loop error/.test(r.msg)).length === 1, 'the same error 5 times is one report with n = 5 (' + (loop && loop.n) + ')');
        const one = by('error', /boom/) || {};
        check(one.appv === '2.0.1' && one.sdk === 21 && /^tv-/.test(one.tv) && one.ver && one.build > 0 && one.model && one.lang === 'en' && one.where === 'tv' && one.url.indexOf(APP) === 0 && /^\d{4}-/.test(one.at) && Date.parse(one.exp) - Date.parse(one.at) === 30 * 86400000,
            'each report has the app version, SDK level, TV id and model, My PC version and build, language, place, address, time and a 30-day expiry (' + JSON.stringify(one) + ')');
        const keys = new Set(reps.flatMap((r) => Object.keys(r)));
        const allowed = ['app', 'kind', 'msg', 'stack', 'src', 'stage', 'appv', 'sdk', 'n', 'at', 'exp', 'tv', 'model', 'ver', 'build', 'lang', 'user', 'where', 'ua', 'url'];
        const rules = fs.readFileSync(path.join(ROOT, 'firebase/firestore.rules'), 'utf8');
        check([...keys].every((k) => allowed.includes(k) && rules.includes("'" + k + "'")), 'reports only use the fields the Firestore rules allow (' + [...keys].join(',') + ')');
        await frame.evaluate(() => MyPC.exit());
        await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'idle' && !!document.querySelector('#desk-icons .dicon'), null, { timeout: 8000 });
        // an app whose page never answers: given up after 8 s with Back, the report says why
        await page.waitForSelector(icon('stuck'), { timeout: 10000 });
        await page.focus(icon('stuck')); await page.keyboard.press('Enter');
        await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'loading', null, { timeout: 10000 });
        await page.waitForTimeout(8300);
        await page.evaluate(() => { const k = (d) => Input.onKey({ keyCode: 10009, repeat: false, preventDefault() {} }, d); k(true); k(false); });
        await page.waitForFunction(() => !!document.querySelector('#desk-icons .dicon') && !/play=/.test(location.search), null, { timeout: 10000 });
        await page.waitForFunction(() => !(Store.rawGet('arc_dev_reports_q') || []).length, null, { timeout: 9000 }).catch(() => {});      // saved by the app page, sent by the desktop page
        await page.waitForTimeout(400);
        reps = Object.values(page.fs.errors);
        const stuck = reps.find((r) => r.app === 'app-stuck' && r.kind === 'load');
        check(stuck && /closed while still loading/.test(stuck.msg) && /SDK never answered/.test(stuck.msg) && stuck.stage === 'loading', 'an app that never opens is reported when the user gives up, with the reason (' + (stuck && stuck.msg) + ')');
        // Settings > Privacy & security > Send error reports: off means nothing is sent
        await page.evaluate(() => Win.open('settings', 'privacy'));
        await page.evaluate(() => [...document.querySelectorAll('.set-row')].find((r) => /Send error reports/.test(r.textContent)).click());
        const before = Object.keys(page.fs.errors).length;
        await page.evaluate(() => { Reports.add('mypc', { kind: 'shell', msg: 'test after off' }); Reports.flush(); });
        await page.waitForTimeout(400);
        check(await page.evaluate(() => !Reports.on()) && Object.keys(page.fs.errors).length === before, 'with Send error reports off nothing is sent');
        check(/Error reports:/.test(await page.textContent('.set-main')), 'the privacy text explains the error reports');
        await page.evaluate(() => Win.close());
        await page.context().close();
    }
    {
        // the "My PC is up to date" screen on a phone: it fits the screen (it used to be 1920 wide and went off screen)
        const page = await newPage(browser, base, null, { phone: true });
        await routeHosted(page, { offline: true });
        await page.goto(base + 'index.html');
        await page.waitForFunction(() => window.Desktop && document.querySelector('.dicon'), null, { timeout: 15000 });
        await page.evaluate(() => Store.rawSet('arc_dev_seen_build', 1));
        await page.reload();
        await page.waitForSelector('.welcome-update', { timeout: 15000 });
        const box = await page.evaluate(() => { const w = document.querySelector('.welcome').getBoundingClientRect(), c = document.querySelector('.welcome-card').getBoundingClientRect(), t = document.querySelector('.welcome-title').getBoundingClientRect();
            return { w: w.width, h: w.height, vw: innerWidth, vh: innerHeight, cl: c.left, cr: c.right, ct: c.top, cb: c.bottom, tw: t.width }; });
        check(box.w === box.vw && box.h === box.vh && box.cl >= 0 && box.cr <= box.vw && box.ct >= 0 && box.cb <= box.vh, 'on a phone the update screen fills the screen and its text is fully visible (' + JSON.stringify(box) + ')');
        await page.context().close();
    }

    console.log('38. roles (administrator / user), themes per profile, Control Panel > Other users');
    {
        const page = await newPage(browser, base);
        await page.goto(base + 'index.html');
        await page.waitForFunction(() => window.Desktop && document.querySelector('.dicon'), null, { timeout: 15000 });
        // the first profile is the administrator, also on an older list without roles
        check(await page.evaluate(() => Profiles.isAdmin() && Profiles.current().role === 'admin'), 'a new TV: its first profile is the administrator');
        await page.evaluate(() => { Store.rawSet('arc_profiles', [{ id: 'p1', name: 'Dad', color: '#ffd23f' }, { id: 'p2', name: 'Kid', color: '#4cd97b' }]); });
        check(await page.evaluate(() => Profiles.isAdmin('p1') && !Profiles.isAdmin('p2') && Profiles.admins() === 1), 'profiles made before roles: the first one becomes the administrator, the others users');
        check(await page.evaluate(() => !Profiles.setRole('p1', 'user') && Profiles.isAdmin('p1') && !Profiles.canRemove('p1')), 'the last administrator can be neither made a user nor removed');
        check(await page.evaluate(() => { const p = Profiles.create('Mum'); return p.role === 'user'; }), 'a profile added once the TV has a real administrator is a user');
        check(await page.evaluate(() => Backup.snapshot().arc_profiles.indexOf('"role":"admin"') > 0), 'roles are kept in the TV backup');
        // the administrator: Install in the App Store, Other users in the Control Panel
        await page.evaluate(() => Win.open('settings', 'accounts'));
        check(await page.evaluate(() => [...document.querySelectorAll('.set-row-name')].some((n) => n.textContent === 'Other users') && /Administrator/.test(document.querySelector('.set-main').textContent)), 'Accounts shows the role and, for an administrator, Other users');
        await page.evaluate(() => [...document.querySelectorAll('.set-row')].find((r) => /Other users/.test(r.textContent)).click());
        check(await page.evaluate(() => ['Dad', 'Kid', 'Mum'].every((n) => [...document.querySelectorAll('.set-row-name')].some((x) => x.textContent.indexOf(n) === 0))), 'Other users lists every profile');
        await page.evaluate(() => [...document.querySelectorAll('.set-row')].find((r) => /^Kid/.test(r.querySelector('.set-row-name') ? r.querySelector('.set-row-name').textContent : '')).click());
        await page.evaluate(() => [...document.querySelectorAll('.set-row')].find((r) => /Role/.test(r.textContent)).click());
        check(await page.evaluate(() => Profiles.isAdmin('p2') && Profiles.admins() === 2), 'OK on Role makes Kid an administrator');
        await page.evaluate(() => [...document.querySelectorAll('.set-row')].find((r) => /Role/.test(r.textContent)).click());
        check(await page.evaluate(() => !Profiles.isAdmin('p2')), 'and again makes Kid a user');
        await page.evaluate(() => [...document.querySelectorAll('.set-row')].find((r) => /Remove this user/.test(r.textContent)).click());
        await page.evaluate(() => document.getElementById('dialog-yes').click());
        check(await page.evaluate(() => !Profiles.find('p2') && document.querySelector('.set-main').textContent.indexOf('Kid') < 0), 'Remove this user (after a question) removes Kid and goes back to the list');
        await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
        await page.evaluate(() => Win.close());
        // a user: no Install / Uninstall, no new profiles, TV-wide settings are "Administrator only"
        await page.evaluate(() => { Store.setProfile(Profiles.list().find((p) => p.name === 'Mum').id); });
        check(await page.evaluate(() => !Profiles.isAdmin()), 'switched to Mum, a user');
        await page.evaluate(() => Win.open('settings', 'privacy'));
        check(await page.evaluate(() => !document.querySelector('.set-main .set-toggle') && /Administrator only/.test(document.querySelector('.set-main').textContent)), 'a user sees cloud backup and world records as "Administrator only"');
        await page.evaluate(() => Win.open('settings', 'accounts'));
        check(await page.evaluate(() => ![...document.querySelectorAll('.set-row-name')].some((n) => n.textContent === 'Other users') && /User/.test(document.querySelector('.set-main').textContent)), 'a user has no Other users');
        await page.evaluate(() => Win.close());
        await page.evaluate(() => ProfilesUI.open());
        check(await page.evaluate(() => document.getElementById('profile-new').hidden && document.getElementById('profile-signin').hidden && document.getElementById('profile-delete').hidden && !document.getElementById('profiles-adminonly').hidden),
            'the profiles screen of a user: no New profile, Sign in or Delete, and it says why');
        await page.keyboard.press('Escape');
        // themes: per profile, one class on <html>, the theme's background, nothing broken
        await page.evaluate(() => Win.open('settings', 'personal'));
        check(await page.evaluate(() => document.querySelectorAll('.set-th').length === Themes.LIST.length && Themes.LIST.length === 8 && document.querySelectorAll('.set-wp:not(.set-th)').length === Desktop.WALLPAPERS.length + DynWall.IDS.length), 'Personalization has the 8 themes and the backgrounds (+ the 2 live ones)');
        await page.evaluate(() => document.querySelector('.set-th[data-theme="xp"]').click());
        check(await page.evaluate(() => document.documentElement.classList.contains('th-xp') && Store.get('theme') === 'xp' && Store.get('wallpaper') === 'hills' && document.activeElement.getAttribute('data-theme') === 'xp'), 'picking a theme applies it with its background and keeps the focus on it');
        await page.evaluate(() => Win.close());
        const tb = await page.evaluate(() => { const s = document.getElementById('tb-start'); return { label: s.getAttribute('data-label'), after: getComputedStyle(s, ':after').content, bg: getComputedStyle(document.querySelector('.taskbar')).backgroundImage }; });
        check(tb.label === 'start' && /start/.test(tb.after) && /gradient/.test(tb.bg), 'XP style: blue taskbar and the green "start" button');
        for (const th of ['win7', 'mac', 'android', 'ios', 'win11']) {
            await page.evaluate((x) => Themes.set(x), th);
            const r = await page.evaluate(() => { const a = document.querySelector('#tb-apps').getBoundingClientRect(), t = document.querySelector('.tray').getBoundingClientRect(), st = document.getElementById('stage').getBoundingClientRect();
                return { inside: a.left >= st.left - 1 && a.right <= st.right + 1 && a.bottom <= st.bottom + 1 && t.top >= st.top - 1 && t.bottom <= st.bottom + 1 }; });
            check(r.inside && await page.evaluate((x) => document.documentElement.className.split(' ').filter((c) => c.indexOf('th-') === 0).join() === 'th-' + x, th), th + ' style: one theme class, the dock / taskbar and the tray stay on screen');
        }
        await page.evaluate(() => Themes.set('mac'));
        await page.evaluate(() => { Store.setProfile('p1'); Desktop.render(); });
        check(await page.evaluate(() => Themes.current() === 'win11' && document.documentElement.classList.contains('th-win11')), 'each profile has its own theme');
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }

    console.log('40. settings of every My PC: backgrounds added in the App Store Manager');
    {
        const db = { settings: { mypc: { wallpaper: 'u:https://pics.example/dunes.png', wallpapers: [
            { url: 'https://pics.example/dunes.png', title: 'Golden dunes', thumb: 'https://pics.example/dunes-small.png' },
            { url: 'https://pics.example/broken.jpg', title: '' }, { url: 'http://pics.example/plain.jpg', title: 'Not https' }] } } };
        const page = await newPage(browser, base, db);
        const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
        await page.context().route('https://pics.example/**', (r) => /broken/.test(r.request().url()) ? r.fulfill({ status: 404, body: '' }) : r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
        await routeHosted(page, { offline: true });
        await page.goto(base + 'index.html');
        await page.waitForSelector('#desk-icons .dicon');
        await page.waitForFunction(() => document.getElementById('wallpaper').className === 'wp wp-img', null, { timeout: 8000 });
        check(await page.evaluate(() => /dunes\.png/.test(document.getElementById('wallpaper').style.backgroundImage) && JSON.parse(localStorage.getItem('arc_dev_global')).wallpapers.length === 2),
            'My PC copies settings/mypc at start: a new profile gets the background chosen for new profiles (only https pictures are kept)');
        check(await page.evaluate(() => Desktop.wallpapers().map((w) => w.title).join() === 'Bloom,Aurora,Sunset,Night sky,Glass,Green hills,Dunes,Material,Lagoon,Night lake,Quest,Horizon,Earth now,Golden dunes,Broken'),
            'the pictures come after the built-in backgrounds, a missing title taken from the address');
        await page.evaluate(() => Win.open('settings', 'personal'));
        await page.waitForSelector('.set-wp[data-wp="u:https://pics.example/broken.jpg"]');
        check(await page.evaluate(() => { const b = document.querySelector('.set-wp[data-wp].on'); return b && b.getAttribute('data-wp') === 'u:https://pics.example/dunes.png' && /dunes-small/.test(b.style.backgroundImage) && document.querySelectorAll('.set-wp[data-wp]').length === 15; }),
            'Settings > Personalization shows the pictures (their small version), the one in use marked');
        await page.evaluate(() => document.querySelector('.set-wp[data-wp="u:https://pics.example/broken.jpg"]').click());
        await page.waitForTimeout(300);
        check(await page.evaluate(() => Store.get('wallpaper') === 'u:https://pics.example/broken.jpg' && document.getElementById('wallpaper').className === 'wp wp-bloom'),
            'a picture that does not load leaves the Bloom colours on screen');
        // the admin removes that picture: the profile goes back to the background of new profiles
        db.settings.mypc.wallpapers.splice(1, 1);
        await page.evaluate(() => new Promise((r) => GlobalSettings.sync(() => { Desktop.paintWallpaper(); r(); })));
        check(await page.evaluate(() => Desktop.wallpaper() === 'u:https://pics.example/dunes.png'), 'a picture taken out in the App Store Manager falls back to the background of new profiles');
        check(await page.evaluate(() => !!localStorage.getItem('arc_dev_global') && !('arc_dev_global' in Backup.snapshot())), 'the copy of the settings is not in the TV backup');
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }

    console.log('41. push notifications on the TV: inbox of the player account, toasts, Control Panel > Notifications, opt-in');
    {
        const now = Date.now();
        const db = { apps: { soccer: { id: 'soccer', name: 'Soccer Live', url: 'https://soccer.example/', entry: 'https://soccer.example/index.html', icon: 'https://soccer.example/icon.png', type: 'app', version: '1.0.0', enabled: true, order: 0,
            services: [{ id: 'goals', file: 'https://soccer.example/services/notify.js', every: 5, title: 'Goal alerts' }] } } };
        const page = await newPage(browser, base, db);
        await page.addInitScript(() => { if (!localStorage.getItem('arc_dev_installed')) localStorage.setItem('arc_dev_installed', JSON.stringify([{ id: 'soccer', at: 1 }])); });
        await routeHosted(page, { offline: true });
        await page.goto(base + 'index.html');
        await page.waitForSelector('#desk-icons .dicon');
        check(await page.evaluate(() => Push.state('soccer')) === 'no-account', 'a local profile gets no notifications (no account)');
        await page.evaluate(() => new Promise((r) => Accounts.signUp('imad12', 'Secret#1', Profiles.current().id, r)));
        check(await page.evaluate(() => Profiles.current().user === 'imad12' && Push.state('soccer') === 'default'), 'once it is an account, nothing is decided yet');
        // the player allows the app: subs/soccer/users/imad12, with the account's token
        await page.evaluate(() => new Promise((r) => Push.set('soccer', true, r)));
        check(db['subs/soccer/users'] && db['subs/soccer/users'].imad12 && db['subs/soccer/users'].imad12.app === 'soccer' && await page.evaluate(() => Push.state('soccer')) === 'granted' &&
            db.pushAuth.some((x) => /^PATCH \/subs\/soccer\/users\/imad12 Bearer id-/.test(x)), 'Allow writes the opt-in document with the player\'s token');
        // the Manager left two notifications in the inbox
        db['inbox/imad12/items'] = {
            'soccer-a-0': { app: 'soccer', name: 'Soccer Live', title: 'Goal! Raja', text: "12' 1-0", link: 'https://news.example/raja', at: now - 60000, exp: new Date(now + 1e9) },
            'soccer-a-1': { app: 'soccer', name: 'Soccer Live', title: 'Kick-off', text: 'Raja - Wydad', link: 'app?match=7', at: now - 120000, exp: new Date(now + 1e9) } };
        const n1 = await page.evaluate(() => new Promise((r) => Push.check((e, n) => r(e || n))));
        await page.waitForFunction(() => document.querySelectorAll('#toast .nt').length >= 2, null, { timeout: 3000 }).catch(() => {});
        const cards = await page.evaluate(() => [...document.querySelectorAll('#toast .nt')].map((c) => c.textContent + '|' + ((c.querySelector('img') || {}).src || '')));
        check(n1 === 2 && cards.some((c) => /Goal! Raja.*Soccer Live · 12' 1-0\|https:\/\/soccer\.example\/icon\.png/.test(c)) && cards.some((c) => /Kick-off/.test(c)),
            'new notifications show as cards with the app name, the message and the app\'s icon: ' + JSON.stringify(cards));
        check(db.pushAuth.some((x) => /^POST \/inbox\/imad12:runQuery Bearer id-/.test(x)) && await page.evaluate(() => Push.list().length === 2 && Push.unread() === 2 && Store.get('notif_seen') > 0),
            'the inbox is read with the account\'s token; both are kept, unread');
        check(await page.evaluate(() => new Promise((r) => Push.check((e, n) => r(n)))) === 0, 'reading again brings nothing twice');
        // Firestore free quota: every 30 minutes, every 2 minutes only for the accounts listed in the App Store Manager
        check(await page.evaluate(() => Push.every()) === 30 * 60000, 'an account not listed for fast notifications reads its inbox every 30 minutes');
        db.settings = { mypc: { wallpapers: [], notifyFast: ['imad12'] } };
        await page.evaluate(() => new Promise((r) => GlobalSettings.sync(r)));
        check(await page.evaluate(() => Push.every()) === 2 * 60000 && await page.evaluate(() => Store.get('notif_last') > Date.now() - 60000), 'a listed account reads it every 2 minutes; the last read time is kept');
        const reads = () => db.pushAuth.filter((x) => /runQuery/.test(x)).length, before = reads();
        await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
        await page.waitForTimeout(300);
        check(reads() === before, 'coming back to the front does not read again before the interval has passed');
        // Control Panel > Notifications
        await page.evaluate(() => Win.open('settings', 'notifications'));
        await page.waitForSelector('.set-main .set-row');
        const cp = await page.textContent('.set-main');
        check(/Notifications/.test(cp) && /Goal! Raja/.test(cp) && /Kick-off/.test(cp) && /Clear all/.test(cp) && /Apps that may send notifications/.test(cp) && /Soccer Live/.test(cp),
            'Control Panel > Notifications lists them and the apps that may send them');
        // the app's switch blocks it again (the opt-in document is deleted)
        await page.evaluate(() => [...document.querySelectorAll('.set-main .set-row')].find((b) => /^Soccer Live/.test(b.textContent.trim())).click());
        await page.waitForFunction(() => Push.state('soccer') === 'denied', null, { timeout: 4000 }).catch(() => {});
        check(await page.evaluate(() => Push.state('soccer')) === 'denied', 'the app\'s switch in Control Panel blocks it again');
        check(!(db['subs/soccer/users'] || {}).imad12, 'the opt-in document is gone');
        // OK on a notification with an https link opens the Browser on it and marks it read
        await page.evaluate(() => [...document.querySelectorAll('.set-main .set-row')].find((b) => /Goal! Raja/.test(b.textContent)).click());
        await page.waitForFunction(() => Win.current() === 'browser', null, { timeout: 4000 }).catch(() => {});
        check(await page.evaluate(() => Win.current() === 'browser' && Push.unread() === 1), 'a notification with an https link opens it in the Browser and is read');
        await page.evaluate(() => Win.close());
        // deep links: '<app id>:<path>'
        const pl = await page.evaluate(() => [Push.parseLink('soccer:match/7', 'x'), Push.parseLink('app?match=7', 'soccer'), Push.parseLink('https://a.b/', 'soccer'), Push.parseLink('', 'soccer')]);
        check(JSON.stringify(pl) === JSON.stringify([{ app: 'soccer', path: 'match/7' }, { app: 'soccer', path: '?match=7' }, { url: 'https://a.b/' }, { app: 'soccer', path: '' }]),
            'deep links: soccer:match/7 opens Soccer Live with the path match/7; app?... is the notification\'s own app: ' + JSON.stringify(pl));
        db.apps.other = { id: 'other', name: 'Other App', url: 'https://other.example/', entry: 'https://other.example/index.html', type: 'app', version: '1.0.0', enabled: true, order: 1 };
        await page.evaluate(() => new Promise((r) => Cloud.refresh(r)));
        await page.evaluate(() => Push.open({ id: 'x', app: 'soccer', title: 'T', link: 'other:news/1', at: Date.now() }));
        check(/Other App is not installed/.test(await page.textContent('#toast')) && await page.evaluate(() => Win.current() === null && !sessionStorage.getItem('mypc_launch')), 'a deep link to an app that is not installed says so and opens nothing');
        await page.evaluate(() => { window.__played = null; const p = Desktop.play; Desktop.play = (g) => { window.__played = g.id; }; Push.open({ id: 'y', app: 'other', title: 'Goal', text: '1-0', link: 'soccer:match/7', at: 5 }); Desktop.play = p; });
        const lj = await page.evaluate(() => ({ played: window.__played, s: JSON.parse(sessionStorage.getItem('mypc_launch') || 'null') }));
        check(lj.played === 'app-soccer' && lj.s.id === 'app-soccer' && lj.s.launch.path === 'match/7' && lj.s.launch.app === 'soccer' && lj.s.launch.link === 'soccer:match/7' && lj.s.launch.title === 'Goal',
            'a deep link opens that app and hands it the path (MyPC.launch): ' + JSON.stringify(lj));
        // history: 7 days on this device, by day
        const hist = await page.evaluate(() => {
            const now = Date.now(), d = 86400000;
            Store.set('notifs', [{ id: 'h1', app: 'soccer', title: 'Now one', at: now - 1000, read: true }, { id: 'h2', app: 'soccer', title: 'Yesterday one', at: now - d - 60000, read: true },
                                 { id: 'h3', app: 'soccer', title: 'Six days', at: now - 6 * d, read: true }, { id: 'h4', app: 'soccer', title: 'Too old', at: now - 8 * d, read: true }]);
            const ids = Push.list().map((x) => x.id).join(',');
            return { ids, saved: Store.get('notifs').length };
        });
        await page.evaluate(() => Win.open('settings', 'notifications'));
        await page.waitForTimeout(300);
        const hp = await page.textContent('.set-main');
        check(hist.ids === 'h1,h2,h3' && hist.saved === 3 && /History: the last 7 days/.test(hp) && /Today/.test(hp) && /Six days/.test(hp) && !/Too old/.test(hp) && hp.indexOf('Now one') < hp.indexOf('Six days'),
            'the history keeps the last 7 days on this device and lists them by day: ' + JSON.stringify(hist));
        await page.evaluate(() => Win.close());
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }

    console.log('42. desktop widgets: Weather, Playtime, System Monitor, Music Player; Control Panel > Widgets; paused while an app runs; app widgets');
    {
        const code = "export default async function (ctx) { const st = ctx.state || { n: 0 }; if (ctx.action === 'add') st.n++; " +
            "return { view: { big: st.n + ' / ' + ctx.settings.goal, sub: 'stars', icon: '⭐', buttons: [{ id: 'add', label: '+1' }], link: 'level/2', html: '<b>no</b>' }, state: st }; }";
        const sha = 'a'.repeat(64);
        const app = (widgets) => ({ id: 'stars', name: 'Star Catcher', url: 'https://stars.example/', entry: 'https://stars.example/index.html', icon: '', type: 'game', version: '1.0.0', enabled: true, order: 0, widgets });
        const w = { id: 'stars', title: 'Stars', file: 'https://stars.example/widgets/stars.js', size: 'medium', every: 15, background: false,
            settings: [{ id: 'goal', label: 'Daily goal', type: 'select', default: '50', options: [{ value: '20', label: '20' }, { value: '50', label: '50' }] }] };
        const db = { apps: { stars: app([Object.assign({ sha }, w)]), pending: Object.assign(app([w]), { id: 'pending', name: 'Pending' }) },
            widgets: { stars__stars: { app: 'stars', widget: 'stars', code, sha, at: 1 } } };
        const page = await newPage(browser, base, db);
        await page.addInitScript(() => { if (!localStorage.getItem('arc_dev_installed')) localStorage.setItem('arc_dev_installed', JSON.stringify([{ id: 'stars', at: 1 }, { id: 'pending', at: 1 }])); });
        // the TV's player (plays by the clock) and a test source of 5 songs for the Music Player card
        await page.addInitScript(() => {
            const av = { state: 'NONE', cur: 0, t: 0, l: null };
            window.webapis = window.webapis || {};
            window.webapis.avplay = {
                open: () => { av.state = 'IDLE'; av.cur = 0; }, setListener: (l) => { av.l = l; }, setDisplayRect() {},
                prepareAsync: (ok) => setTimeout(() => { av.state = 'READY'; ok(); }, 10),
                play: () => { av.state = 'PLAYING'; av.t = Date.now(); }, pause: () => { if (av.state === 'PLAYING') av.cur += Date.now() - av.t; av.state = 'PAUSED'; },
                stop: () => { av.state = 'IDLE'; }, close: () => { av.state = 'NONE'; }, seekTo: (ms, ok) => { av.cur = ms; av.t = Date.now(); if (ok) setTimeout(ok, 1); },
                getCurrentTime: () => av.state === 'PLAYING' ? av.cur + Date.now() - av.t : av.cur, getDuration: () => 200000, getState: () => av.state
            };
        });
        await routeHosted(page, { offline: true });
        await page.goto(base + 'index.html');
        await page.waitForSelector('#desk-icons .dicon');
        await page.evaluate(() => {
            MusicSrc.add('t', { list: (d, cb) => cb({ code: 'unsupported' }), read: (e, a, l, cb) => cb({ code: 'unsupported' }), url: (e, cb) => cb(null, { url: 'https://music.test/' + e.n, path: '/t/' + e.n }) });
            Music.playList(['Morning Pixels', 'Neon Avenue', 'Level Two', 'Night Drive', 'Last Boss'].map((t, i) => ({ s: 't', p: '/t/' + i + '.mp3', n: i + '.mp3', t, a: 'Lab' })), 0);
            Music.pause();
        });
        // owner decision 2026-11-05: only Weather is on by default; the others (and app widgets) are turned on by the user
        check(await page.evaluate(() => [...document.querySelectorAll('#desk-widgets .wdg')].map((c) => c.id).join() === 'wdg-weather' &&
            ['playtime', 'sysmon', 'music', 'stars__stars'].every((id) => Widgets.conf(id).show === false) && Widgets._timers().join() === 'weather'),
            'a new profile shows only the Weather widget; the others are off and run nothing');
        await page.evaluate(() => ['playtime', 'sysmon', 'music', 'stars__stars'].forEach((id) => Widgets.set(id, 'show', true)));
        await page.waitForFunction(() => /21/.test((document.getElementById('wdg-weather') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
        await page.waitForFunction(() => /Morning Pixels/.test((document.getElementById('wdg-music') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
        const cards = await page.evaluate(() => [...document.querySelectorAll('#desk-widgets .wdg')].map((c) => c.id + ':' + c.textContent));
        check(['wdg-weather', 'wdg-playtime', 'wdg-sysmon', 'wdg-music'].every((id) => cards.some((c) => c.indexOf(id + ':') === 0)) && cards.some((c) => /wdg-weather:.*21°.*Casablanca.*Partly cloudy/.test(c)) &&
            cards.some((c) => /wdg-sysmon:.*(Memory|My PC memory)/.test(c)) && cards.some((c) => /wdg-music:.*Morning Pixels/.test(c)) && cards.some((c) => /wdg-playtime:.*0 min/.test(c)),
            'the desktop shows Weather (place from the internet address), Playtime, System Monitor and Music Player: ' + JSON.stringify(cards).slice(0, 400));
        const layout = await page.evaluate(() => { const i = document.getElementById('desk-icons').getBoundingClientRect(), w = document.getElementById('desk-widgets').getBoundingClientRect(); return { iconsRight: i.right, wLeft: w.left, h: w.bottom, bar: document.getElementById('taskbar').getBoundingClientRect().top }; });
        check(layout.iconsRight <= layout.wLeft + 1 && layout.h <= layout.bar, 'the widgets sit on the right, beside the icons and above the taskbar ' + JSON.stringify(layout));
        // the approved app widget ran in its Worker; the one waiting for approval did not
        await page.waitForFunction(() => /0 \/ 50/.test((document.getElementById('wdg-stars__stars') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
        const st = await page.evaluate(() => ({ t: (document.getElementById('wdg-stars__stars') || {}).textContent || '', html: /&lt;b&gt;|<b>no<\/b>/.test(document.getElementById('wdg-stars__stars').innerHTML),
            pending: !!document.getElementById('wdg-pending__stars'), code: !!(JSON.parse(localStorage.getItem('arc_dev_wcode') || '{}').stars__stars) }));
        check(/Stars/.test(st.t) && /0 \/ 50/.test(st.t) && /stars/.test(st.t) && !st.html && !st.pending && st.code,
            'an approved app widget runs its approved code (default settings, no HTML); one waiting for approval is not shown; the code is kept on the TV: ' + JSON.stringify(st));
        await page.click('#wdg-stars__stars .wdg-btn');
        await page.waitForFunction(() => /1 \/ 50/.test(document.getElementById('wdg-stars__stars').textContent), null, { timeout: 5000 }).catch(() => {});
        check(await page.evaluate(() => /1 \/ 50/.test(document.getElementById('wdg-stars__stars').textContent)), 'a card button runs the widget again with ctx.action and keeps its state');
        const reads = db.log.filter((x) => /widgets\/stars__stars/.test(x)).length;
        await page.evaluate(() => Widgets.refreshNow('stars__stars'));
        await page.waitForTimeout(400);
        check(db.log.filter((x) => /widgets\/stars__stars/.test(x)).length === reads && reads === 1, 'the approved code is read from Firestore once, then from the TV');

        // refreshing: every shown widget has its timer on the desktop; an open app stops them all but the background ones
        await page.evaluate(() => Music.play());
        await page.waitForTimeout(100);
        const onDesk = await page.evaluate(() => Widgets._timers());
        await page.evaluate(() => Win.open('calculator'));
        await page.waitForTimeout(200);
        const inApp = await page.evaluate(() => Widgets._timers());
        check(onDesk.indexOf('sysmon') >= 0 && onDesk.indexOf('weather') >= 0 && onDesk.indexOf('music') >= 0 && onDesk.indexOf('stars__stars') >= 0 && inApp.join() === 'music',
            'refresh timers: all on the desktop ' + onDesk + '; only Music (background by default) while an app is open: ' + inApp);
        const before = await page.evaluate(() => Music.state().pos);
        await page.waitForTimeout(1200);
        check(await page.evaluate((b) => Music.state().playing && Music.state().pos >= b + 1, before), 'the music keeps playing while the app is open');
        await page.evaluate(() => Win.close());
        await page.waitForTimeout(200);
        check((await page.evaluate(() => Widgets._timers())).indexOf('sysmon') >= 0, 'back on the desktop the widgets refresh again');

        // Control Panel > Widgets: the list, then a page per widget (show, refresh rate, background, own settings)
        await page.evaluate(() => Win.open('settings', 'widgets'));
        await page.waitForTimeout(200);
        const cp = await page.textContent('.set-main');
        check(/Show widgets on the desktop/.test(cp) && /Weather/.test(cp) && /Playtime/.test(cp) && /System Monitor/.test(cp) && /MyMusic|Music Player/.test(cp) && /Stars/.test(cp) && /every 30 min/.test(cp) && /every 5 s/.test(cp),
            'Control Panel > Widgets lists every widget with its state and refresh rate');
        await page.evaluate(() => { const b = [...document.querySelectorAll('.set-main .set-row')].find((x) => /System Monitor/.test(x.textContent)); b.click(); });
        await page.waitForTimeout(200);
        const sp = await page.textContent('.set-main');
        check(/Show on the desktop/.test(sp) && /Refresh/.test(sp) && /Run in the background/.test(sp) && /Refresh now/.test(sp) && /Move up/.test(sp), 'a widget\'s page: show, refresh rate, background, refresh now, order');
        // the refresh rate changes with the arrows
        await page.evaluate(() => { const b = [...document.querySelectorAll('.set-main .set-row')].find((x) => /^Refresh/.test(x.textContent) && !/now/.test(x.textContent)); b.focus(); });
        await page.keyboard.press('ArrowRight');
        check(await page.evaluate(() => Widgets.conf('sysmon').every) === 10 && /every 10 s/.test(await page.textContent('.set-main')), 'Right picks the next refresh rate (5 s -> 10 s)');
        await page.evaluate(() => Widgets.set('sysmon', 'bg', true));
        await page.evaluate(() => Widgets.set('sysmon', 'show', false));
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
        check(await page.evaluate(() => !!document.querySelector('.set-main') && /Show widgets/.test(document.querySelector('.set-main').textContent)), 'Back returns to the list');
        await page.evaluate(() => Win.close());
        await page.waitForTimeout(200);
        check(await page.evaluate(() => !document.getElementById('wdg-sysmon') && Widgets._timers().indexOf('sysmon') < 0), 'a hidden widget has no card and no timer');
        await page.evaluate(() => { Widgets.set('sysmon', 'show', true); Win.open('calculator'); });
        await page.waitForTimeout(200);
        check((await page.evaluate(() => Widgets._timers())).indexOf('sysmon') >= 0, 'with "Run in the background" on, it keeps refreshing while an app is open');
        await page.evaluate(() => Win.close());

        // Weather: a typed place, units
        await page.evaluate(() => { Widgets.setSetting('weather', 'units', 'c'); Widgets.setSetting('weather', 'place', 'Paris'); });
        await page.waitForFunction(() => /12°.*Paris/.test(document.getElementById('wdg-weather').textContent), null, { timeout: 5000 }).catch(() => {});
        check(await page.evaluate(() => /12°.*Paris/.test(document.getElementById('wdg-weather').textContent)) && db.weather.some((u) => /geocoding.*name=Paris/.test(u)), 'Weather: a typed city is looked up (Open-Meteo geocoding) and shown');
        await page.evaluate(() => Widgets.setSetting('weather', 'units', 'f'));
        await page.waitForTimeout(500);
        check(db.weather.some((u) => /temperature_unit=fahrenheit/.test(u)), 'Weather: Fahrenheit asks the forecast in °F');

        // per profile: another profile has its own widgets
        const other = await page.evaluate(() => { const mine = Store.get('widgets'); const p2 = Profiles.create('Sara'); Store.setProfile(p2.id); const o = Store.get('widgets', null); const c = Widgets.conf('sysmon').every; Store.setProfile('p1'); return { mine: !!mine, other: o, every: c }; });
        check(other.mine && other.other === null && other.every === 5, 'widget settings are per profile: a new profile starts from the defaults ' + JSON.stringify(other));
        // master switch
        await page.evaluate(() => Widgets.setOn(false));
        check(await page.evaluate(() => document.getElementById('desk-widgets').hidden && Widgets._timers().length === 0 && !document.getElementById('desktop').classList.contains('has-wdg')), 'Show widgets off: no cards, no timers, the icons get the whole desktop');
        await page.evaluate(() => Widgets.setOn(true));
        // Music app and the card's buttons
        await page.evaluate(() => Win.open('music'));
        await page.waitForTimeout(150);
        await page.waitForSelector('.mx-np:not([hidden])', { timeout: 3000 }).catch(() => {});
        check(await page.evaluate(() => /Morning Pixels|Neon Avenue|Level Two|Night Drive|Last Boss/.test(document.querySelector('.mx-np').textContent)), 'the Music app opens on Now playing while a song plays');
        await page.evaluate(() => Win.close());
        await page.waitForTimeout(150);
        const t0 = await page.evaluate(() => Music.state().index);
        await page.click('#wdg-music .wdg-btn[data-b="next"]');
        check(await page.evaluate((t) => Music.state().index === (t + 1) % 5, t0), 'the Music Player card\'s Next button changes the track');
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }

    console.log('43. Weather app: now, 24 hours, 7 days; shares its place, units and data with the widget; follows the theme; remote only');
    {
        const db = {};
        const page = await newPage(browser, base, db);
        await routeHosted(page, { offline: true });
        await page.goto(base + 'index.html');
        await page.waitForSelector('#desk-icons .dicon');
        await page.waitForFunction(() => /21°/.test((document.getElementById('wdg-weather') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
        const asked = db.weather.filter((u) => /api\.open-meteo/.test(u)).length;
        check(asked === 1 && await page.evaluate(() => !!document.querySelector('#desk-icons [data-app="weather"], #desk-icons [data-id="weather"]') || !!Desktop.appById('weather')), 'Weather is a desktop app; the widget asked the forecast once: ' + asked);
        // the widget: temperature on the left, a big sky picture beside it, warnings (rain within 6 h by default, a storm within 24 h = danger)
        const wg = await page.evaluate(() => { const c = document.getElementById('wdg-weather'); return { art: !!c.querySelector('.wdg-hero .wdg-art svg'), big: getComputedStyle(c.querySelector('.wdg-big')).fontSize,
            artW: c.querySelector('.wdg-art').getBoundingClientRect().width, danger: (c.querySelector('.wdg-danger') || {}).textContent, warn: (c.querySelector('.wdg-warn') || {}).textContent,
            toast: document.getElementById('toast').textContent }; });
        check(wg.art && wg.big === '68px' && /Storm danger in about 10 h/.test(wg.danger) && /Rain in about 1 h/.test(wg.warn) && /Danger: storm/.test(wg.toast) && /Weather warning/.test(wg.toast),
            'Weather widget: big temperature + big sky picture, rain and storm warnings on the card and once as notifications ' + JSON.stringify(wg));
        // the sky picture moves (CSS only), and nothing runs while an app hides the desktop
        const an = await page.evaluate(() => { const a = document.querySelector('#wdg-weather .wdg-art .wa'); return a ? a.getAnimations({ subtree: true }).length : -1; });
        check(an >= 2 && /wa-drop/.test(await page.evaluate(() => Weather.art('storm'))) && /wa-bolt/.test(await page.evaluate(() => Weather.art('storm'))) && /wa-spin/.test(await page.evaluate(() => Weather.art('sun'))), 'the widget\'s sky picture is animated (' + an + ' animations): sun turns, clouds drift, rain falls, lightning flashes');
        await page.evaluate(() => Win.open('calculator'));
        check(await page.evaluate(() => document.querySelector('#wdg-weather .wa').getAnimations({ subtree: true }).length) === 0, 'no animation runs while an app is open (desktop hidden)');
        await page.evaluate(() => { Win.close(); Widgets.setSetting('weather', 'anim', false); });
        await page.waitForFunction(() => !document.querySelector('#wdg-weather .wa') && document.querySelector('#wdg-weather .wdg-art svg'), null, { timeout: 5000 }).catch(() => {});
        check(await page.evaluate(() => !document.querySelector('#wdg-weather .wa') && !!document.querySelector('#wdg-weather .wdg-art svg')), 'Animated picture off: a still picture');
        await page.evaluate(() => Widgets.setSetting('weather', 'anim', true));
        await page.evaluate(() => { Widgets.setSetting('weather', 'tsize', 'xl'); Widgets.setSetting('weather', 'isize', 's'); Widgets.setSetting('weather', 'warn', '0'); });
        await page.waitForFunction(() => document.querySelector('#wdg-weather .wdg-big') && document.querySelector('#wdg-weather .wdg-big').style.fontSize === '84px', null, { timeout: 5000 }).catch(() => {});
        const wg2 = await page.evaluate(() => { const c = document.getElementById('wdg-weather'); return { big: c.querySelector('.wdg-big').style.fontSize, art: c.querySelector('.wdg-art').style.width, alerts: c.querySelectorAll('.wdg-alert').length, told: Store.get('wx_told').length }; });
        check(wg2.big === '84px' && wg2.art === '72px' && wg2.alerts === 0 && wg2.told === 2, 'its settings: temperature size, picture size, warnings off; each warning is told only once ' + JSON.stringify(wg2));
        await page.evaluate(() => { Widgets.setSetting('weather', 'tsize', 'l'); Widgets.setSetting('weather', 'isize', 'l'); Widgets.setSetting('weather', 'warn', '6'); });
        // OK on the widget card opens the app, drawn at once from the widget's data (no second request)
        await page.evaluate(() => document.getElementById('wdg-weather').click());
        await page.waitForSelector('.wx');
        const v = await page.evaluate(() => ({
            app: Win.current(), temp: document.querySelector('.wx-temp').textContent, cond: document.querySelector('.wx-cond').textContent, feels: document.querySelector('.wx-feels').textContent,
            place: document.querySelector('.wx-place').textContent, days: [...document.querySelectorAll('.wx-day')].filter((d) => !d.hidden).length,
            hours: [...document.querySelectorAll('.wx-hour')].filter((d) => !d.hidden).length, firstHour: document.querySelector('.wx-hour-t').textContent,
            stats: [...document.querySelectorAll('.wx-stat-v')].map((e) => e.textContent), sky: document.querySelector('.wx').className,
            focus: document.activeElement && document.activeElement.className, title: document.getElementById('win-title').textContent }));
        check(v.app === 'weather' && v.title === 'Weather' && v.temp === '21°' && v.cond === 'Partly cloudy' && /Feels like 19°/.test(v.feels) && /H 24°/.test(v.feels) && /Casablanca/.test(v.place),
            'the app shows now: temperature, condition, feels like, high / low, the place ' + JSON.stringify(v));
        check(v.days === 7 && v.hours === 8 && v.firstHour === 'Now' && /wx-partly/.test(v.sky) && /wx-day/.test(v.focus), '7 days, 8 hours (every 3 h from now), a sky for the weather, focus on today');
        check(v.stats[0] === '14 km/h W' && v.stats[1] === '31 km/h' && /0.4 mm · 20 %/.test(v.stats[2]) && v.stats[3] === '60 %' && v.stats[4] === '1016 hPa' && /4 · Moderate/.test(v.stats[5]) && /7:31|07:31/.test(v.stats[6]),
            'details now: wind + direction, gusts, precipitation + chance, humidity, pressure, UV, sunrise ' + JSON.stringify(v.stats));
        check(db.weather.filter((u) => /api\.open-meteo/.test(u)).length === asked, 'opening the app right after the widget asks nothing again (shared data)');
        const al = await page.evaluate(() => ({ d: (document.querySelector('.wx-alert.wx-danger') || {}).textContent, w: (document.querySelector('.wx-alert.wx-warn') || {}).textContent,
            hot: (document.querySelector('.wx-hour.wx-hot') || {}).textContent, chip: document.querySelector('.wx-wchip').textContent }));
        check(/Danger: storm.*Storm danger in about 10 h/.test(al.d) && /Weather warning.*Rain in about 1 h/.test(al.w) && /7:00 PM/.test(al.hot) && al.chip === '6 h', 'the app shows the storm (danger) and rain warnings beside the temperature; the storm hour is red in the 24 hours ' + JSON.stringify(al));
        await page.evaluate(() => document.querySelector('.wx-wchip').click());
        check(await page.evaluate(() => document.querySelector('.wx-wchip').textContent === '8 h' && Widgets.conf('weather').s.warn === '8'), 'the warnings button goes to the next time (6 h -> 8 h), same setting as the widget');
        await page.evaluate(() => { Widgets.setSetting('weather', 'warn', '6'); Focus.focus(document.querySelector('.wx-day')); });
        // at night never a sun: partly cloudy = moon + cloud (owner report 2026-11-07), clear = moon
        const night = await page.evaluate(() => ({ p: Weather.sky(2, false).ic, c: Weather.sky(0, false).ic, d: Weather.sky(2, true).ic, art: /#ffc83d/.test(Weather.art('pnight')), icon: /#ffc83d/.test(Icons.svg('pnight')),
            hours: [...document.querySelectorAll('.wx-hour')].filter((h) => !h.hidden && /PM|AM/.test(h.querySelector('.wx-hour-t').textContent) && /^(9:00 PM|12:00 AM|3:00 AM)/.test(h.getAttribute('aria-label')) && /#ffc83d/.test(h.innerHTML)).length }));
        check(night.p === 'pnight' && night.c === 'moon' && night.d === 'partly' && !night.art && !night.icon && night.hours === 0, 'at night the pictures show the moon, never the sun ' + JSON.stringify(night));
        // a picked day: the hours strip shows that day's 8 points (every 3 h), its storm in red; Today goes back to the next 24 hours
        await page.evaluate(() => Focus.focus(document.querySelectorAll('.wx-day')[2]));
        const sat = await page.evaluate(() => ({ h: document.querySelector('.wx-hours-c .wx-h').textContent, t: [...document.querySelectorAll('.wx-hour-t')].map((e) => e.textContent),
            v: [...document.querySelectorAll('.wx-hour-v')].map((e) => e.textContent), hot: [...document.querySelectorAll('.wx-hour')].map((e) => e.classList.contains('wx-hot')).indexOf(true) }));
        check(/^Saturday, hour by hour$/.test(sat.h) && sat.t.join() === '12:00 AM,3:00 AM,6:00 AM,9:00 AM,12:00 PM,3:00 PM,6:00 PM,9:00 PM' && sat.v.join() === '11°,10°,10°,13°,18°,21°,19°,15°' && sat.hot === 5,
            'picking Saturday shows its 24 hours as 8 points (every 3 h), the storm at 3 PM in red ' + JSON.stringify(sat));
        await page.evaluate(() => Focus.focus(document.querySelectorAll('.wx-hour')[5]));
        check(await page.evaluate(() => /Saturday/.test(document.querySelector('.wx-hours-c .wx-h').textContent) && /3:00 PM, 21°, Thunderstorm/.test(document.activeElement.getAttribute('aria-label'))), 'going into the hours keeps the picked day (Voice Guide reads its hour)');
        await page.evaluate(() => Focus.focus(document.querySelector('.wx-day')));
        check(await page.evaluate(() => document.querySelector('.wx-hours-c .wx-h').textContent === 'Next 24 hours' && document.querySelector('.wx-hour-t').textContent === 'Now'), 'Today: the next 24 hours from now again');
        // the remote: Down goes through the days; the details follow the focused day
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        const d4 = await page.evaluate(() => ({ t: document.querySelector('.wx-det .wx-h').textContent, s: [...document.querySelectorAll('.wx-stat-v')].map((e) => e.textContent), a: document.activeElement.getAttribute('aria-label'), on: document.querySelector('.wx-day.on') === document.activeElement }));
        check(d4.on && /40 km\/h NW/.test(d4.s[0]) && /12.5 mm · 95 %/.test(d4.s[2]) && /Thunderstorm/.test(d4.a) && /high 21°|H 21°/.test(d4.a) && !/Today/.test(d4.t), 'Down x4 = the 5th day: its wind, rain and an aria label for Voice Guide ' + JSON.stringify(d4));
        // units: °F for the app and the widget, one request
        await page.evaluate(() => document.querySelector('.wx-units').click());
        await page.waitForFunction(() => document.querySelector('.wx-units').textContent === '°F' && !/Refreshing/.test(document.querySelector('.wx-when').textContent), null, { timeout: 5000 }).catch(() => {});
        check(db.weather.some((u) => /api\.open-meteo.*temperature_unit=fahrenheit.*precipitation_unit=inch/.test(u)) && await page.evaluate(() => Widgets.conf('weather').s.units === 'f' && / mph/.test(document.querySelector('.wx-stat-v').textContent)),
            'the °C / °F button switches the app and the widget (mph, inches)');
        // place: typed with the on-screen keyboard
        await page.evaluate(() => document.querySelector('.wx-place').click());
        await page.waitForFunction(() => Keyboard.isOpen());
        await page.evaluate(() => { Keyboard.setText('Paris'); Keyboard.submit(); });
        await page.waitForFunction(() => /Paris/.test(document.querySelector('.wx-place').textContent) && /12°|54°/.test(document.querySelector('.wx-temp').textContent), null, { timeout: 5000 }).catch(() => {});
        check(await page.evaluate(() => /Paris/.test(document.querySelector('.wx-place').textContent) && Widgets.conf('weather').s.place === 'Paris' && document.activeElement === document.querySelector('.wx-place')), 'a typed city is the place of the app and the widget');
        await page.evaluate(() => document.querySelector('.wx-place').click());
        await page.waitForFunction(() => Keyboard.isOpen());
        await page.evaluate(() => { Keyboard.setText('Nowhere'); Keyboard.submit(); });
        await page.waitForFunction(() => /Place not found: Nowhere/.test(document.querySelector('.wx-msg').textContent), null, { timeout: 5000 }).catch(() => {});
        check(await page.evaluate(() => /Place not found: Nowhere/.test(document.querySelector('.wx-msg').textContent) && document.querySelector('.wx-temp').textContent === '--'), 'an unknown place says so');
        // one timer while open, none after
        check(await page.evaluate(() => { Win.close(); return !document.querySelector('.wx'); }), 'Back / close frees the app');
        // the theme: the accent and card shape change with it, in French it is translated
        await page.evaluate(() => { Widgets.setSetting('weather', 'place', ''); Themes.set('ios'); Win.open('weather'); });
        await page.waitForSelector('.wx-card');
        const th = await page.evaluate(() => ({ r: getComputedStyle(document.querySelector('.wx-card')).borderTopLeftRadius, acc: getComputedStyle(document.querySelector('.wx-day.on, .wx-units')).color }));
        await page.evaluate(() => { Win.close(); Themes.set('win11'); Win.open('weather'); });
        await page.waitForSelector('.wx-card');
        const th2 = await page.evaluate(() => getComputedStyle(document.querySelector('.wx-card')).borderTopLeftRadius);
        check(th.r === '26px' && th2 === '22px', 'the cards follow the theme (iOS 26 px, Windows 11 22 px) ' + JSON.stringify([th, th2]));
        await page.evaluate(() => { Win.close(); I18n.setLang('fr'); Win.open('weather'); });
        await page.waitForSelector('.wx');
        await page.waitForFunction(() => /Maintenant/.test(document.querySelector('.wx-hours').textContent), null, { timeout: 5000 }).catch(() => {});
        check(await page.evaluate(() => document.getElementById('win-title').textContent === 'Météo' && /Prévisions sur 7 jours/.test(document.querySelector('.wx-side').textContent) && /Maintenant/.test(document.querySelector('.wx-hours').textContent)), 'translated (French)');
        await page.evaluate(() => { Win.close(); I18n.setLang('en'); });
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }

    console.log('42b. widgets on the game page: only the background ones run, Playtime counts');
    {
        const page = await newPage(browser, base);
        await routeHosted(page, { offline: true });
        await page.goto(base + 'index.html');
        await page.waitForSelector('[data-game="blocks"]');
        await page.focus('[data-game="blocks"]');
        await Promise.all([page.waitForURL(/play=blocks/), page.keyboard.press('Enter')]);
        await page.waitForFunction(() => window.GameHost && GameHost.state() === 'running', null, { timeout: 15000 });
        check(await page.evaluate(() => Widgets._timers().length === 0 && !document.querySelector('#desk-widgets .wdg')), 'the game page builds no widget and runs none (Music is paused)');
        await page.evaluate(() => { Playtime._check(); });
        const pt = await page.evaluate(() => { const l = Date.now; Date.now = () => l() + 40000; Playtime._check(); Date.now = l; return Playtime.summary(); });
        check(pt.today >= 39 && pt.top && pt.top.id === 'blocks', 'Playtime counts the time the game runs: ' + JSON.stringify(pt));
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }

    console.log('42c. Playtime app: in Start, opened from its widget; per profile stats, 7 / 30 days, OK on a game plays it');
    {
        const page = await newPage(browser, base);
        await routeHosted(page, { offline: true });
        await page.goto(base + 'index.html');
        await page.waitForSelector('#desk-icons .dicon');
        check(await page.evaluate(() => !!Desktop.appById('playtime')), 'Playtime is one of the apps (Start > All apps)');
        await page.evaluate(() => {
            const d = new Date(), k = (n) => { const x = new Date(d.getTime()); x.setDate(x.getDate() - n); return Playtime.day(x); }, days = {};
            days[k(0)] = 1500; days[k(1)] = 3900; days[k(2)] = 600; days[k(8)] = 900; days[k(20)] = 7200;
            Store.set('playtime', { days, games: { blocks: { s: 9000, t: 'Block Drop', at: Date.now(), n: 6, best: 3000 }, gone: { s: 1200, t: 'Old Game', at: Date.now() - 86400000 * 3 } } });
        });
        await page.evaluate(() => Widgets.set('playtime', 'show', true));      // off by default
        await page.waitForSelector('#wdg-playtime');
        await page.focus('#wdg-playtime'); await page.keyboard.press('Enter');          // OK on the Playtime widget opens the app
        await page.waitForSelector('.pt-card');
        const ui = await page.evaluate(() => ({
            cards: [...document.querySelectorAll('.pt-card')].map((c) => c.getAttribute('aria-label')),
            bars: document.querySelectorAll('.pt-col').length, games: [...document.querySelectorAll('.pt-game')].map((g) => g.getAttribute('aria-label')),
            focus: document.activeElement.className, title: document.getElementById('win-title').textContent }));
        check(ui.title === 'Playtime' && ui.bars === 7 && /pt-card/.test(ui.focus) && /Today: 25 min/.test(ui.cards[0]) && /This week: 1 h 40 min/.test(ui.cards[1]) &&
            /Streak: 3 days/.test(ui.cards[3]) && /Best day/.test(ui.cards[3]),
            'Playtime opens on its cards: today, this week, daily average, streak: ' + JSON.stringify(ui.cards));
        check(ui.games.length === 2 && /^Block Drop: 2 h 30 min\. 6 sessions, longest 50 min, last played Today\. OK to play/.test(ui.games[0]) && /not installed any more/.test(ui.games[1]),
            'games: most played first, sessions, longest, last played; a removed game is still listed: ' + JSON.stringify(ui.games));
        await page.click('.pt-range-btn:nth-child(2)');
        check(await page.evaluate(() => document.querySelectorAll('.pt-col').length === 30 && /Last 30 days/.test(document.querySelector('.pt-h').textContent) && Store.get('playtime_range') === 30),
            '30 days: 30 bars, remembered for the profile');
        await page.evaluate(() => { Win.close(); Win.open('playtime'); });
        check(await page.evaluate(() => document.querySelectorAll('.pt-col').length === 30), 'it opens again on 30 days');
        await page.evaluate(() => Win.refresh());
        check(await page.evaluate(() => document.querySelectorAll('.pt-chart').length === 1 && /pt-card/.test(document.activeElement.className)), 'a redraw (language or profile change) builds it once and keeps the focus in it');
        await page.focus('.pt-game');
        await Promise.all([page.waitForURL(/play=blocks/), page.keyboard.press('Enter')]);
        check(true, 'OK on a game in Playtime plays it');
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }
    await musicTests(browser, base);
    await driveTests(browser, base);
    await copyTests(browser, base);
    await drivePhoneTests(browser, base);
    await calendarTests(browser, base);
    await clockTests(browser, base);

    console.log('42d. remote shortcuts (per profile): Play / Pause = music, Guide = users; Control Panel > Shortcuts; the game menu\'s music button');
    {
        const page = await newPage(browser, base);
        await routeHosted(page, { offline: true });
        await page.goto(base + 'index.html');
        await page.waitForSelector('#desk-icons .dicon');
        const remote = (c) => page.evaluate((k) => { for (const d of [true, false]) Input.onKey({ keyCode: k, repeat: false, preventDefault() {} }, d); }, c);
        check(await page.evaluate(() => JSON.stringify(Shortcuts.list()) === JSON.stringify([{ key: 'playpause', act: 'music' }, { key: 'guide', act: 'users' }])),
            'the defaults are only Play / Pause = music and Guide = switch user');
        await page.evaluate(() => { if (Music.has && !Music.has()) window.__noMusic = true; });
        const noMusic = await page.evaluate(() => !!window.__noMusic);
        const was = await page.evaluate(() => Music.state().playing);
        await remote(10252);
        await page.waitForTimeout(100);
        if (noMusic) check(/No music/.test(await page.textContent('#toast')), 'Play / Pause with nothing to play says so');
        else check(await page.evaluate((w) => Music.state().playing === !w, was), 'the Play / Pause key plays or pauses the music');
        await remote(458);
        await page.waitForTimeout(150);
        check(await page.evaluate(() => ProfilesUI.screenOpen() && !Desktop.startOpen()), 'the Guide key opens the users screen (switch user), not Start');
        await page.evaluate(() => ProfilesUI.close());
        // Control Panel > Shortcuts: add Blue = open Calculator, with the remote alone
        await page.evaluate(() => Win.open('settings', 'shortcuts'));
        await page.waitForTimeout(150);
        const cp = await page.textContent('.set-main');
        check(/Play \/ Pause/.test(cp) && /Play \/ pause music/.test(cp) && /Guide/.test(cp) && /Switch user/.test(cp) && /Add a shortcut/.test(cp), 'Control Panel > Shortcuts lists this user\'s shortcuts');
        const row = (re) => page.evaluate((s) => { const b = [...document.querySelectorAll('.set-main .set-row')].find((x) => new RegExp(s).test(x.textContent)); if (b) { b.focus(); b.click(); } return !!b; }, re);
        await row('Add a shortcut');
        await row('^Button');
        check(await page.evaluate(() => Shortcuts.listening()) && /Press a button: remote, keyboard or controller/.test(await page.textContent('.set-main')) && /5 s left/.test(await page.textContent('.set-main')),
            'Button listens for the next button of any device (5 s countdown)');
        await remote(37);                                   // an arrow: not a shortcut button, still listening
        check(await page.evaluate(() => Shortcuts.listening()), 'an arrow is not taken (still listening)');
        await remote(10009);                                // Back cancels, and stays on the shortcut
        check(await page.evaluate(() => !Shortcuts.listening() && Win.current() === 'settings' && /^Button/.test(document.activeElement.textContent)), 'Back cancels the listening');
        await row('^Button');
        await remote(406);
        await page.waitForTimeout(100);
        check(await page.evaluate(() => !Shortcuts.listening() && /Blue button/.test(document.activeElement.textContent)), 'pressing Blue picks the Blue button');
        // any key of any device: a keyboard letter, a controller button (a phone in Buttons mode is a standard pad)
        await row('^Button');
        await remote(75);
        await page.waitForTimeout(100);
        check(await page.evaluate(() => /Key K/.test(document.activeElement.textContent)), 'a keyboard key (K) is picked');
        await row('^Button');
        await page.evaluate(() => { Input.virtualPad(1, 1 << 12, 0, 0, 'Test'); Input.virtualPad(1, 0, 0, 0, 'Test'); });   // D-pad up: kept
        check(await page.evaluate(() => Shortcuts.listening()), 'the controller D-pad is not taken');
        await page.evaluate(() => { Input.virtualPad(1, 1 << 2, 0, 0, 'Test'); Input.virtualPad(1, 0, 0, 0, 'Test'); });     // X (button 2)
        await page.waitForTimeout(100);
        check(await page.evaluate(() => /Controller X/.test(document.activeElement.textContent)), 'a controller button (X) is picked');
        await row('^Button');
        await remote(406);
        await page.waitForTimeout(100);
        await row('^Choose the button from a list');
        const keys = await page.evaluate(() => document.querySelectorAll('.set-main .set-row').length);
        check(keys >= 30 && /Blue button/.test(await page.textContent('.set-main')) && /Number 5/.test(await page.textContent('.set-main')), 'the list (for a keyboard) has every remote button (' + (keys - 1) + ')');
        await row('^Blue button');
        await row('^Action');
        check(/Open an app or game/.test(await page.textContent('.set-main')) && /Open a Control Panel page/.test(await page.textContent('.set-main')), 'Action lists every action');
        await row('^Open an app or game');
        check(/Calculator/.test(await page.textContent('.set-main')) && /Block Drop/.test(await page.textContent('.set-main')), 'then every app and game');
        await row('^Calculator');
        await row('^Save');
        check(await page.evaluate(() => Shortcuts.forKey('blue') && Shortcuts.forKey('blue').arg === 'calculator') && /Open Calculator/.test(await page.textContent('.set-main')), 'saved: Blue = Open Calculator');
        await page.evaluate(() => Win.close());
        await remote(406);
        await page.waitForTimeout(200);
        check(await page.evaluate(() => Win.current() === 'calculator'), 'the Blue key opens Calculator');
        // a controller button runs its shortcut (and gives no action of its own)
        await page.evaluate(() => { Win.close(); Shortcuts.put(-1, { key: 'p3', act: 'app', arg: 'weather' }); Input.virtualPad(1, 1 << 3, 0, 0, 'Test'); Input.virtualPad(1, 0, 0, 0, 'Test'); });
        await page.waitForTimeout(200);
        check(await page.evaluate(() => Win.current() === 'weather'), 'controller X opens Weather');
        await page.evaluate(() => { Win.close(); Shortcuts.put(-1, { key: 'k75', act: 'app', arg: 'calculator' }); Input.virtualPad(1, null); });
        await remote(75);
        await page.waitForTimeout(200);
        check(await page.evaluate(() => Win.current() === 'calculator'), 'keyboard K opens Calculator');
        // a Control Panel page
        await page.evaluate(() => Shortcuts.put(-1, { key: 'n1', act: 'page', arg: 'sound' }));
        await remote(49);
        await page.waitForTimeout(200);
        check(await page.evaluate(() => Win.current() === 'settings' && /Sound/.test(document.querySelector('.set-main .set-title').textContent)), 'Number 1 opens Control Panel > Sound');
        // edit then remove with the Control Panel
        await page.evaluate(() => { Win.close(); Win.open('settings', 'shortcuts'); });
        await row('^Number 1');
        await row('^Remove this shortcut');
        check(await page.evaluate(() => !Shortcuts.forKey('n1')), 'Remove deletes it');
        // per profile: another user has only the defaults
        const other = await page.evaluate(() => { const p2 = Profiles.create('Sara'); Store.setProfile(p2.id); const l = Shortcuts.list().map((s) => s.key).join(); Store.setProfile('p1'); return l; });
        check(other === 'playpause,guide', 'another user has their own (the defaults): ' + other);
        // one shortcut per button: Guide set to Start replaces Switch user
        await page.evaluate(() => Shortcuts.put(-1, { key: 'guide', act: 'start' }));
        check(await page.evaluate(() => Shortcuts.list().filter((s) => s.key === 'guide').length === 1 && Shortcuts.forKey('guide').act === 'start'), 'one shortcut per button (the new one replaces the old)');
        await page.evaluate(() => { Win.close(); Shortcuts.reset(); Shortcuts.put(-1, { key: 'blue', act: 'app', arg: 'calculator' }); });
        // in a game: the menu has Play / Pause music; Guide asks before leaving for the users screen; Blue (Calculator) too
        await page.focus('[data-game="blocks"]');
        await Promise.all([page.waitForURL(/play=blocks/), page.keyboard.press('Enter')]);
        await page.waitForFunction(() => window.GameHost && GameHost.state() === 'running', null, { timeout: 15000 });
        await tvBack(page);
        await page.waitForTimeout(100);
        const items = await page.evaluate(() => [...document.querySelectorAll('#pause-items button')].map((b) => b.textContent));
        check(items.some((x) => /^(Play|Pause) music$/.test(x)), 'the game menu has a Play / Pause music button: ' + items.join(', '));
        await page.evaluate(() => [...document.querySelectorAll('#pause-items button')].find((b) => /music$/.test(b.textContent)).click());
        await page.waitForTimeout(100);
        check(await page.evaluate(() => GameHost.state() === 'paused' && /music$/.test(document.activeElement.textContent)), 'it keeps the menu open, on the same button');
        await page.evaluate(() => [...document.querySelectorAll('#pause-items button')][0].click());   // Resume
        await remote(458);
        await page.waitForTimeout(150);
        check(await page.evaluate(() => App.dialogOpen() && GameHost.state() === 'paused' && /Leave the game/.test(document.getElementById('dialog-title').textContent)), 'Guide in a game asks first (the game waits)');
        await page.evaluate(() => document.getElementById('dialog-no').click());
        await page.waitForTimeout(100);
        check(await page.evaluate(() => !App.dialogOpen() && GameHost.state() === 'running'), 'Cancel: back to the game');
        await remote(406);
        await page.waitForTimeout(150);
        await Promise.all([page.waitForURL((u) => !/play=/.test(u)), page.evaluate(() => document.getElementById('dialog-yes').click())]);
        await page.waitForFunction(() => window.Win && Win.current() === 'calculator', null, { timeout: 15000 }).catch(() => {});
        check(await page.evaluate(() => Win.current() === 'calculator' && !Store.get('sc_next', null)), 'Leave and open: the game closes and Calculator opens on the desktop');
        // the Memo app keeps its own Play / Pause
        await page.evaluate(() => { Win.close(); Win.open('memo'); window.__t = Music.state().playing; });
        await remote(10252);
        await page.waitForTimeout(100);
        check(await page.evaluate(() => Music.state().playing === window.__t), 'in Memo, Play / Pause stays Memo\'s');
        await page.evaluate(() => { Win.close(); I18n.setLang('fr'); Win.open('settings', 'shortcuts'); });
        check(/Raccourcis/.test(await page.textContent('.set-main')) && /Changer d’utilisateur/.test(await page.textContent('.set-main')), 'translated (French)');
        await page.evaluate(() => { Win.close(); I18n.setLang('en'); });
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }

    await wallTests(browser, base);
    await flowTests(browser, base);
    await ringTests(browser, base);
    await themeTests(browser, base);
    await videoTests(browser, base);
    await speedyTests(browser, base);

    await browser.close();
    srv.close();
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
    process.exit(failures ? 1 : 0);
}

// 43. The Music app with a simulated USB drive (Tizen filesystem), the TV's player (AVPlay) and Google Drive through MyDrive.
// A fake Google (sign-in + Drive API v3) for the Drive tests: files in memory, Range reads, resumable uploads.
async function fakeGoogle(ctx, g) {
    g.files = g.files || {}; g.calls = []; g.n = 0; g.uploads = {};
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Expose-Headers': 'Location, Range, Content-Range' };
    const jwt = (o) => 'h.' + Buffer.from(JSON.stringify(o)).toString('base64url') + '.s';
    const meta = (f) => { const o = Object.assign({}, f); delete o.data; if (f.data) o.size = String(f.data.length); return o; };
    await ctx.route(/^https:\/\/(oauth2|www)\.googleapis\.com\//, async (r) => {
        const q = r.request(), u = new URL(q.url()), m = q.method(), body = q.postData() || '';
        if (m === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
        g.calls.push(m + ' ' + u.pathname + u.search + ' ' + (q.headers().authorization || '') + ' ' + (q.headers().range || q.headers()['content-range'] || ''));
        const json = (o, st, h) => r.fulfill({ status: st || 200, contentType: 'application/json', headers: Object.assign({}, cors, h || {}), body: JSON.stringify(o) });
        if (/device\/code/.test(u.pathname)) return json({ device_code: 'DEV1', user_code: 'WXYZ-1234', verification_url: 'https://www.google.com/device', expires_in: 1800, interval: 5 });
        if (u.hostname === 'oauth2.googleapis.com' && /token/.test(u.pathname)) {
            if (/device_code/.test(body)) return json({ access_token: 'AT-secret', refresh_token: 'RT-secret', expires_in: 3600, scope: 'openid email profile https://www.googleapis.com/auth/drive.file', id_token: jwt({ sub: 'g7', email: 'sara@example.com', name: 'Sara' }) });
            const f = new URLSearchParams(body);
            if (f.get('grant_type') === 'authorization_code') {        // the phone sign-in (drive-signin.html): checked like Google does
                g.codeSwap = Object.fromEntries(f);
                if (f.get('client_secret') !== 'wsec') return json({ error: 'invalid_client', error_description: 'The provided client secret is invalid.' }, 401);
                const ok = f.get('code') === g.code && f.get('client_id') === 'web.apps.googleusercontent.com' && f.get('client_secret') === 'wsec' &&
                    f.get('redirect_uri') === 'https://pc.geekspro.us/drive-signin.html' &&
                    crypto.createHash('sha256').update(f.get('code_verifier') || '').digest('base64url') === g.challenge;
                if (!ok) return json({ error: 'invalid_grant' }, 400);
                g.code = '';                                        // one use only
                return json({ access_token: 'AT-secret', refresh_token: 'RT-full', expires_in: 3600, scope: 'openid email profile https://www.googleapis.com/auth/drive', id_token: jwt({ sub: 'g7', email: 'sara@example.com', name: 'Sara' }) });
            }
            if (f.get('client_id') === 'web.apps.googleusercontent.com') return json({ access_token: 'AT-secret', expires_in: 3600, scope: 'https://www.googleapis.com/auth/drive' });
            return json({ access_token: 'AT-secret', expires_in: 3600, scope: 'https://www.googleapis.com/auth/drive.file' });
        }
        if (u.hostname === 'oauth2.googleapis.com') return json({});
        if (!/Bearer AT-secret/.test(q.headers().authorization || '')) return json({ error: { code: 401, message: 'no token' } }, 401);
        const path = decodeURIComponent(u.pathname);
        // resumable uploads
        if (/^\/upload\/drive\/v3\/files/.test(path) && u.searchParams.get('upload_id')) {
            const up = g.uploads[u.searchParams.get('upload_id')], cr = /bytes (\d+)-(\d+)\/(\d+)/.exec(q.headers()['content-range'] || '');
            if (!up) return json({ error: { code: 404, message: 'No such upload' } }, 404);
            const st = /bytes \*\/(\d+)/.exec(q.headers()['content-range'] || '');
            if (st && +st[1] > 0) {                     // "how much do you have?" (an upload going on after a break)
                g.statusAsks = (g.statusAsks || 0) + 1;
                const have = up.parts.reduce((n, b) => n + b.length, 0);
                return r.fulfill({ status: 308, headers: Object.assign(have ? { Range: 'bytes=0-' + (have - 1) } : {}, cors), body: '' });
            }
            if (cr && +cr[1] !== up.parts.reduce((n, b) => n + b.length, 0)) return json({ error: { code: 400, message: 'wrong offset ' + cr[1] } }, 400);
            const chunk = q.postDataBuffer() || Buffer.alloc(0);
            up.parts.push(chunk);
            if (cr && +cr[2] < +cr[3] - 1) return r.fulfill({ status: 308, headers: Object.assign({ Range: 'bytes=0-' + cr[2] }, cors), body: '' });
            const f = up.id ? g.files[up.id] : (g.files['u' + (++g.n)] = { id: 'u' + g.n, mimeType: up.type });
            Object.assign(f, up.meta); f.data = Buffer.concat(up.parts); f.mimeType = up.meta.mimeType || f.mimeType || up.type;
            return json(meta(f), 200);
        }
        if (/^\/upload\/drive\/v3\/files/.test(path)) {
            const id = path.split('/')[5] || '', key = 'S' + (++g.n);
            g.uploads[key] = { id, meta: JSON.parse(body || '{}'), parts: [], type: q.headers()['x-upload-content-type'] };
            return r.fulfill({ status: 200, headers: Object.assign({ Location: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=' + key }, cors), body: '' });
        }
        const seg = path.replace('/drive/v3/', '').split('/');
        if (seg[0] === 'about') return json({ user: { displayName: 'Sara', emailAddress: 'sara@example.com' }, storageQuota: g.quota || { limit: '100', usage: '10' } });
        if (seg[0] === 'files' && seg.length === 1 && m === 'GET') {
            const qs = u.searchParams.get('q') || '';
            let l = Object.values(g.files).filter((f) => !!f.trashed === /trashed = true/.test(qs));
            const par = /'([^']+)' in parents/.exec(qs); if (par) l = l.filter((f) => (f.parents || ['root']).includes(par[1]));
            const ap = /key='([^']+)' and value='([^']+)'/.exec(qs); if (ap) l = l.filter((f) => f.appProperties && f.appProperties[ap[1]] === ap[2]);
            const nm = /name = '([^']+)'/.exec(qs); if (nm) l = l.filter((f) => f.name === nm[1]);
            if (/mimeType = 'application\/vnd.google-apps.folder'/.test(qs)) l = l.filter((f) => f.mimeType === 'application/vnd.google-apps.folder');
            if (/mimeType contains 'audio\/'/.test(qs)) l = l.filter((f) => /^audio\//.test(f.mimeType));
            if (/sharedWithMe = true/.test(qs)) l = l.filter((f) => f.shared);
            return json({ files: l.slice(0, +u.searchParams.get('pageSize') || 100).map(meta) });
        }
        if (seg[0] === 'files' && seg.length === 1 && m === 'POST') {
            const d = JSON.parse(body), id = 'd' + (++g.n);
            g.files[id] = Object.assign({ id }, d);
            return json(meta(g.files[id]));
        }
        const f = g.files[seg[1]];
        if (!f) return json({ error: { code: 404, message: 'File not found' } }, 404);
        if (seg[2] === 'export') { g.exports = (g.exports || 0) + 1; return r.fulfill({ status: 200, contentType: u.searchParams.get('mimeType'), headers: cors, body: Buffer.from('EXPORT ' + f.name + ' as ' + u.searchParams.get('mimeType')) }); }
        if (seg[2] === 'copy') { const id = 'c' + (++g.n); g.files[id] = Object.assign({}, f, { id }, JSON.parse(body || '{}')); return json(meta(g.files[id])); }
        if (m === 'DELETE') { delete g.files[seg[1]]; return r.fulfill({ status: 204, headers: cors, body: '' }); }
        if (m === 'PATCH') {
            Object.assign(f, JSON.parse(body || '{}'));
            if (u.searchParams.get('addParents')) f.parents = [u.searchParams.get('addParents')];
            return json(meta(f));
        }
        if (u.searchParams.get('alt') === 'media') {
            const all = f.data || Buffer.alloc(0), rg = /bytes=(\d+)-(\d+)/.exec(q.headers().range || '');
            const a = rg ? +rg[1] : 0, b = rg ? Math.min(+rg[2], all.length - 1) : all.length - 1;
            if (rg && a >= all.length) return r.fulfill({ status: 416, headers: cors, body: '' });
            return r.fulfill({ status: rg ? 206 : 200, contentType: f.mimeType, headers: Object.assign({ 'Content-Range': 'bytes ' + a + '-' + b + '/' + all.length }, cors), body: all.subarray(a, b + 1) });
        }
        return json(meta(f));
    });
}

// 44b. Whole Drive: the phone sign-in (drive-signin.html, Google's page with the full drive scope, the code through Firestore gauth/<id>)
async function drivePhoneTests(browser, base) {
    console.log('44b. Google Drive: phone sign-in for the whole Drive (QR -> phone -> Google -> Firestore -> TV), limited accounts, Music sees every folder and Shared with me');
    const db = { apps: {}, settings: { google: { tvClientId: 'cid.apps.googleusercontent.com', tvClientSecret: 'sec', pickerClientId: 'web.apps.googleusercontent.com', pickerApiKey: 'PKEY', projectNumber: '123', webClientSecret: 'wsec' } } };
    const page = await newPage(browser, base, db);
    const ctx = page.context();
    const g = { files: {
        f1: { id: 'f1', name: 'Albums', mimeType: 'application/vnd.google-apps.folder', parents: ['root'] },
        f2: { id: 'f2', name: 'Holiday.mp3', mimeType: 'audio/mpeg', parents: ['f1'], data: Buffer.from('ID3' + 'y'.repeat(3000)) },
        f3: { id: 'f3', name: 'Report.pdf', mimeType: 'application/pdf', parents: ['root'] },
        f4: { id: 'f4', name: 'From Omar.mp3', mimeType: 'audio/mpeg', parents: ['x'], shared: true, data: Buffer.from('ID3zz') } } };
    await fakeGoogle(ctx, g);
    // the phone page from the repo, and Google's sign-in page: checks what My PC asks, then sends the phone back with a code
    await ctx.route(/^https:\/\/pc\.geekspro\.us\/drive-signin\.html/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(path.join(ROOT, 'drive-signin.html')) }));
    await ctx.route('https://accounts.google.com/**', (r) => {
        const u = new URL(r.request().url());
        g.auth = Object.fromEntries(u.searchParams);
        g.code = '4/one-time-code'; g.challenge = u.searchParams.get('code_challenge');
        // (a 302 here would not go through the routes: Playwright only routes the first address of a redirect)
        const back = u.searchParams.get('redirect_uri') + '?state=' + u.searchParams.get('state') + '&code=' + encodeURIComponent(g.code) + '&scope=x';
        r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Google</title><script>location.replace(' + JSON.stringify(back) + ')</script>' });
    });
    await routeHosted(page, { offline: true });
    const shots = process.env.MYPC_SHOTS;
    const shot = async (pg, name) => { if (shots) { await pg.waitForTimeout(150); await pg.screenshot({ path: path.join(shots, name + '.png') }); } };
    await page.goto(base + 'index.html');
    await page.waitForSelector('#desk-icons .dicon');
    // an account signed in the old way (TV code, drive.file): still works, but My PC says it only sees some files
    await page.evaluate(() => { Store.set('gdrive', { accounts: [{ id: 'g7', email: 'sara@example.com', name: 'Sara', refreshToken: 'RT-old', scope: 'https://www.googleapis.com/auth/drive.file', cid: 'cid.apps.googleusercontent.com' }], active: 'g7' }); });
    await page.evaluate(() => GDrive.syncConfig(() => Win.open('settings', 'drive')));
    await page.waitForFunction(() => /only sees some of your files/.test((document.querySelector('.set-main') || document.body).textContent), null, { timeout: 5000 }).catch(() => {});
    const cp0 = await page.evaluate(() => ({ t: document.querySelector('.set-main').textContent, full: GDrive.fullAccess(), a: GDrive.active() }));
    await shot(page, 'drive-5-limited');
    check(cp0.full && cp0.a.limited && !cp0.a.full && /My PC only sees some of your files/.test(cp0.t) && /Add files from your phone/.test(cp0.t),
        'with the web client secret set, an old drive.file account is "limited": Control Panel offers to sign in again for the whole Drive ' + JSON.stringify(cp0.a));
    // the TV still remembers an old, wrong secret (imad, 2026-11-06: fixed in the Manager, the TV kept its 12 h copy): sign-in reads the Manager's first
    await page.evaluate(() => { localStorage.setItem('arc_dev_google', JSON.stringify(Object.assign({}, GDrive.config(), { webClientSecret: 'old-wrong' }))); GDrive._reset(); });
    // sign in: a QR code for the phone page (no code to type)
    await page.evaluate(() => { const s = GDrive.signIn; GDrive.signIn = (on, cb) => s((c) => { window.__gurl = c.url; on(c); }, cb); });
    await page.evaluate(() => [...document.querySelectorAll('.set-main .set-row')].find((b) => /only sees some of your files/.test(b.textContent)).click());
    await page.waitForFunction(() => window.__gurl && document.querySelector('.gdui-qr svg'), null, { timeout: 5000 }).catch(() => {});
    const tv = await page.evaluate(() => ({ url: window.__gurl, text: document.querySelector('.gdui').textContent, code: !!document.querySelector('.gdui-code') }));
    await shot(page, 'drive-6-phone-qr');
    const hp = new URLSearchParams((tv.url || '#').split('#')[1]);
    check(/^https:\/\/pc\.geekspro\.us\/drive-signin\.html#s=[A-Za-z0-9_-]{32}&c=web\.apps\.googleusercontent\.com&h=[A-Za-z0-9_-]{43}&m=S256&l=en$/.test(tv.url) && !tv.code && /Scan this code with your phone/.test(tv.text),
        'the TV shows a QR code for drive-signin.html with a random id, the web client and a PKCE S256 challenge (never the verifier or a secret) ' + tv.url);
    // the phone: opens the page, presses Continue with Google, Google sends it back, the page tells the TV through Firestore
    const phone = await ctx.newPage();
    await phone.setViewportSize({ width: 412, height: 860 });
    await phone.goto(tv.url);
    await shot(phone, 'drive-7-phone-page');
    const before = await phone.evaluate(() => document.body.innerText);
    await Promise.all([phone.waitForURL(/drive-signin\.html$/, { timeout: 8000 }).catch(() => {}), phone.click('#go')]);
    await phone.waitForFunction(() => /Look at your TV/.test(document.getElementById('msg').textContent), null, { timeout: 8000 }).catch(() => {});
    const done = await phone.evaluate(() => ({ msg: (document.getElementById('msg') || document.body).textContent, url: location.href }));
    await shot(phone, 'drive-8-phone-done');
    check(/Continue with Google/.test(before) && /all the files and folders/.test(before), 'the phone page says what My PC will see and has one button ' + before.slice(0, 120));
    check(g.auth && g.auth.scope === 'openid email profile https://www.googleapis.com/auth/drive' && g.auth.access_type === 'offline' && g.auth.code_challenge_method === 'S256' &&
        g.auth.state === hp.get('s') && g.auth.client_id === 'web.apps.googleusercontent.com' && g.auth.redirect_uri === 'https://pc.geekspro.us/drive-signin.html',
        'Google\'s page is asked for the WHOLE Drive (scope drive), offline, PKCE S256, the TV\'s id as state ' + JSON.stringify(g.auth));
    check(/Look at your TV/.test(done.msg) && done.url === 'https://pc.geekspro.us/drive-signin.html', 'back from Google the phone page hands the code to the TV and says so; the code leaves the address bar ' + JSON.stringify(done));
    // the TV picks it up (every 3 s), trades it with its verifier and the secret, deletes it
    await page.waitForFunction(() => !DriveUI.screenOpen() && GDrive.active() && GDrive.active().full, null, { timeout: 12000 }).catch(() => {});
    const acc = await page.evaluate(() => ({ a: GDrive.active(), st: Store.get('gdrive', {}), t: document.querySelector('.set-main').textContent }));
    const sw = g.codeSwap || {};
    check(acc.a && acc.a.full && !acc.a.limited && acc.st.accounts.length === 1 && acc.st.accounts[0].cid === 'web.apps.googleusercontent.com' && acc.st.accounts[0].refreshToken === 'RT-full',
        'the TV is signed in with the whole Drive: the same Google account is replaced, with the web client ' + JSON.stringify(acc.a));
    check(sw.client_secret === 'wsec' && sw.code_verifier && sw.code_verifier.length === 64 && !tv.url.includes(sw.code_verifier) && !Object.keys(db.gauth || {}).length && db.log.some((l) => /^DELETE \/gauth\//.test(l)),
        'the code was traded by the TV with its own PKCE verifier (never in the QR) and the web client secret, and the Firestore note is deleted ' + JSON.stringify(db.log.filter((l) => /gauth/.test(l)).slice(-3)));
    await shot(page, 'drive-9-full');
    check(!/only sees some of your files/.test(acc.t) && !/Add files from your phone/.test(acc.t) && /every file and folder of this Google Drive/.test(acc.t),
        'Control Panel: no "limited" row and no Add files any more; the privacy text says My PC sees every file and folder ' + acc.t.slice(0, 200));
    // Music: My Drive shows every folder and file of the account, plus Shared with me
    const r = await page.evaluate(() => new Promise((res) => {
        const out = {};
        setTimeout(() => res(Object.assign(out, { timeout: true })), 8000);
        out.roots = MusicSrc.gdRoots().map((x) => x.p).join();
        const names = (l) => l.dirs.concat(l.tracks).map((x) => x.n).join();
        MusicSrc.list({ s: 'gd', p: 'root', dir: true }, (e, l) => { out.root = e ? e.code : names(l);
            MusicSrc.list({ s: 'gd', p: '*shared', dir: true }, (e2, l2) => { out.shared = e2 ? e2.code : names(l2); res(out); }); });
    }));
    check(r.roots === 'root,*audio,*shared' && /Albums/.test(r.root) && /From Omar\.mp3/.test(r.shared), 'Music: My Drive lists the real folders (Albums), and Shared with me the files shared with the account ' + JSON.stringify(r));
    await page.evaluate(() => { Win.close && Win.close(); Win.open('music'); });
    await page.waitForTimeout(400);
    await page.evaluate(() => { const b = [...document.querySelectorAll('[data-focus]')].find((x) => /Google Drive/.test(x.textContent)); if (b) b.click(); });
    await page.waitForFunction(() => /Shared with me/.test(document.body.textContent), null, { timeout: 5000 }).catch(() => {});
    const mu = await page.evaluate(() => document.body.textContent);
    await shot(page, 'drive-10-music');
    check(/Shared with me/.test(mu) && !/Add files from your phone/.test(mu), 'Music\'s Google Drive page has Shared with me and no "Add files from your phone"');
    // a refused sign-in on the phone: the TV says so
    await page.evaluate(() => { window.__gurl = ''; window.__res = null; DriveUI.signIn((e) => { window.__res = e ? e.code : 'ok'; }); });
    await page.waitForFunction(() => window.__gurl, null, { timeout: 5000 });
    const sid = new URLSearchParams((await page.evaluate(() => window.__gurl)).split('#')[1]).get('s');
    await phone.goto('https://pc.geekspro.us/drive-signin.html?state=' + sid + '&error=access_denied');
    await phone.waitForFunction(() => /cancelled/.test(document.getElementById('msg').textContent), null, { timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => /not allowed/.test((document.querySelector('.gdui') || document.body).textContent), null, { timeout: 8000 }).catch(() => {});
    check(/not allowed/.test(await page.evaluate(() => document.querySelector('.gdui').textContent)), 'Cancel on Google\'s page: the phone says nothing was shared and the TV shows "not allowed" with Try again');
    await page.keyboard.press('Escape');
    // the TV client's secret pasted as the web client's (imad, 2026-11-06): Google says invalid_client; My PC says which field is wrong
    await page.evaluate(() => { GDrive.setConfig(Object.assign({}, GDrive.config(), { webClientSecret: 'sec' })); window.__gurl = ''; DriveUI.signIn(() => {}); });
    await page.waitForFunction(() => window.__gurl, null, { timeout: 5000 });
    const sid2 = new URLSearchParams((await page.evaluate(() => window.__gurl)).split('#')[1]).get('s');
    g.code = '4/another';
    await phone.goto('https://pc.geekspro.us/drive-signin.html?state=' + sid2 + '&code=' + encodeURIComponent(g.code));
    await page.waitForFunction(() => /web client secret/.test((document.querySelector('.gdui') || document.body).textContent), null, { timeout: 8000 }).catch(() => {});
    const bad = await page.evaluate(() => (document.querySelector('.gdui') || document.body).textContent);
    await shot(page, 'drive-11-wrong-secret');
    check(/refused My PC's web client secret/.test(bad) && !/not set up for My PC yet/.test(bad), 'a wrong web client secret: the TV says the Web client secret is wrong (not "not set up") ' + bad.slice(0, 160));
    await page.keyboard.press('Escape');
    check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
    await ctx.close();
}

// 44. Google Drive in the SDK (MyPC.drive, API 14): one sign-in per profile in My PC, every request sent by My PC.
// MYPC_ONLY=drive node tests/run-tests.mjs runs just these.
async function driveTests(browser, base) {
    console.log('44. Google Drive for apps (MyPC.drive): sign in once in My PC, permission per app, list / upload / read / rename / trash / delete, app folder, streaming; Control Panel > Google Drive');
    // the app: its own https origin, the SDK from My PC, a service worker that imports sdk/drive-sw.js
    const APP = 'https://driveapp.example.test/';
    const APP_HTML = `<!doctype html><meta charset=utf-8><title>Drive Test</title><body style="background:#123;color:#fff;font:40px sans-serif"><p id=t>Drive test app</p>
<script src="${OLD_HOSTED}sdk/mypc-sdk.js"></script><script>MyPC.init({ onInit() { MyPC.ready(); window.__ok = 1; } });</script>`;
    const db = { apps: {}, settings: { google: { tvClientId: 'cid.apps.googleusercontent.com', tvClientSecret: 'sec', pickerClientId: 'web.apps.googleusercontent.com', pickerApiKey: 'PKEY', projectNumber: '123' } } };
    db.apps.drivetest = { id: 'drivetest', name: 'Drive Test', url: APP, entry: APP + 'index.html', icon: '', type: 'app', version: '1.0.0', enabled: true, order: 1, config: {} };
    const page = await newPage(browser, base, db);
    const g = { files: { s1: { id: 's1', name: 'Song.mp3', mimeType: 'audio/mpeg', parents: ['root'], data: Buffer.from('ID3' + 'x'.repeat(5000)) } } };
    await fakeGoogle(page.context(), g);
    await page.addInitScript((a) => { if (!localStorage.getItem('arc_dev_installed')) { localStorage.setItem('arc_dev_installed', JSON.stringify([{ id: 'drivetest', at: 1 }])); localStorage.setItem('arc_dev_catalog', JSON.stringify([a])); } }, db.apps.drivetest);
    await routeHosted(page, { offline: true });
    const sdkFile = (f) => (r) => r.fulfill({ status: 200, contentType: 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: fs.readFileSync(path.join(ROOT, 'sdk', f)) });
    await page.route(OLD_HOSTED + 'sdk/mypc-sdk.js', sdkFile('mypc-sdk.js'));
    await page.context().route(OLD_HOSTED + 'sdk/drive-sw.js', sdkFile('drive-sw.js'));          // imported by the app's worker
    await page.context().route(APP + '**', (r) => {
        if (/sw\.js/.test(r.request().url())) return r.fulfill({ status: 200, contentType: 'application/javascript', body: `importScripts('${OLD_HOSTED}sdk/drive-sw.js');` });
        r.fulfill({ status: 200, contentType: 'text/html', body: APP_HTML });
    });
    const shot = async (name) => { if (process.env.MYPC_SHOTS) { await page.waitForTimeout(150); await page.screenshot({ path: path.join(process.env.MYPC_SHOTS, name + '.png') }); } };
    await page.goto(base + 'index.html');
    await page.waitForSelector('#desk-icons .dicon');
    await page.waitForFunction(() => Desktop.games().some((x) => x.id === 'app-drivetest'), null, { timeout: 10000 });
    async function openApp() {
        await Promise.all([page.waitForURL(/play=app-drivetest/), page.evaluate(() => Desktop.play(Desktop.games().find((x) => x.id === 'app-drivetest')))]);
        await page.waitForFunction(() => window.GameHost && GameHost.state() === 'running', null, { timeout: 10000 });
        const f = page.frames().find((x) => x.url().indexOf(APP) === 0);
        await f.waitForFunction(() => window.__ok === 1 && MyPC.info() && MyPC.info().bridges);
        return f;
    }
    let app = await openApp();
    const st0 = await app.evaluate(() => MyPC.drive.status().then((s) => ({ s, api: MyPC.apiLevel, b: MyPC.info().bridges.drive })));
    check(st0.api >= 14 && st0.b === 1 && st0.s.configured && !st0.s.signedIn && st0.s.needsSignIn && !st0.s.allowed && st0.s.account === null && st0.s.picker,
        'MyPC.drive (API 14): the app learns Drive is set up for My PC but this profile is not signed in yet ' + JSON.stringify(st0));
    const e0 = await app.evaluate(() => MyPC.drive.list().then(() => 'ok', (e) => e.code));
    check(e0 === 'signed-out', 'a Drive call before any sign-in fails with signed-out (the app should call MyPC.drive.signIn()) ' + e0);
    // MyPC.drive.signIn(): My PC's own sign-in screen over the app; the app is paused meanwhile
    const pSign = app.evaluate(() => MyPC.drive.signIn().then((a) => a, (e) => 'err ' + e.code));
    await page.waitForFunction(() => document.querySelector('.gdui-code') && document.querySelector('.gdui-code').textContent === 'WXYZ-1234', null, { timeout: 5000 }).catch(() => {});
    const over = await page.evaluate(() => ({ open: DriveUI.screenOpen(), state: GameHost.state() }));
    await shot('drive-1-signin-over-app');
    check(over.open && over.state === 'paused', 'My PC shows its sign-in screen over the app and pauses it ' + JSON.stringify(over));
    const signed = await pSign;
    const after = await page.evaluate(() => ({ state: GameHost.state(), allowed: Bridges.allowed('drivetest', 'drive') }));
    check(signed && signed.email === 'sara@example.com' && after.state === 'running' && after.allowed, 'once allowed on the phone the app gets the account (no token) and runs again; signing in from the app allowed it ' + JSON.stringify(signed) + JSON.stringify(after));
    // every operation, with the token only in My PC's requests
    const res = await app.evaluate(async () => {
        const D = MyPC.drive, out = {}, prog = [];
        out.list = (await D.list({ folder: 'root' })).files.map((f) => f.name);
        const folder = await D.createFolder('Saves');
        out.folder = folder.mimeType === D.FOLDER;
        const up = await D.upload({ name: 'notes.txt', data: 'hello drive', type: 'text/plain', parent: folder.id }, { onProgress: (p) => prog.push(p) });
        out.up = up.name + ' ' + up.size; out.prog = prog;
        const big = new Uint8Array(9 * 1024 * 1024); for (let i = 0; i < big.length; i++) big[i] = i & 255;
        const upBig = await D.upload({ name: 'big.bin', data: big.buffer }, { onProgress: (p) => prog.push(p) });
        out.big = upBig.size;
        const r = await D.read(upBig.id, 1000, 1009);
        out.read = Array.from(new Uint8Array(r.buf)).join(',') + ' / ' + r.total;
        out.text = await D.readText(up.id);
        out.rename = (await D.rename(up.id, 'renamed.txt')).name;
        out.moved = (await D.move(up.id, 'root')).parents.join();
        out.copy = (await D.copy(up.id, folder.id, 'copy.txt')).name;
        out.trash = (await D.trash(up.id)).trashed;
        out.restore = (await D.restore(up.id)).trashed;
        out.star = (await D.star(up.id)).starred;
        out.removed = await D.remove(upBig.id);
        out.gone = await D.get(upBig.id).then(() => 'still there', (e) => e.code);
        const af = await D.appFolder(), af2 = await D.appFolder();
        out.appFolder = af.name + ' ' + (af.id === af2.id);
        await D.saveJson('save.json', { level: 3 });
        await D.saveJson('save.json', { level: 4 });
        out.json = JSON.stringify(await D.loadJson('save.json')) + ' ' + JSON.stringify(await D.loadJson('none.json', { level: 0 }));
        out.about = (await D.about()).user.emailAddress;
        const s = await D.stream('s1');
        out.blob = s.mode + ' ' + /^blob:/.test(s.url) + ' ' + (await (await fetch(s.url)).text()).slice(0, 3); s.close();
        out.badName = await D.rename(up.id, '   ').then(() => 'ok', (e) => e.code);
        out.missing = await D.get('nope').then(() => 'ok', (e) => e.code);
        const ab = D.download('s1'); ab.abort(); out.abort = await ab.then(() => 'ok', (e) => e.code);
        out.seen = JSON.stringify(out);
        return out;
    });
    const tokenInApp = /AT-secret|RT-secret|GOCSPX|sec\b/.test(res.seen);
    check(res.list.join() === 'Song.mp3' && res.folder && res.up === 'notes.txt 11' && res.prog.includes(1) && res.big === String(9 * 1024 * 1024), 'list, createFolder and upload (a 9 MB file in 4 MB pieces, with progress) ' + JSON.stringify({ l: res.list, up: res.up, big: res.big, p: res.prog.length }));
    const ups = g.calls.filter((c) => /upload_id/.test(c));
    check(ups.length === 6 && ups.filter((c) => / 9437184$/.test(c) || /\/9437184/.test(c)).length === 3 && ups.every((c) => /Bearer AT-secret/.test(c)), 'uploads are resumable, in 4 MB pieces (3 for 9 MB), each with the token from My PC (' + ups.length + ' PUTs) ' + JSON.stringify(ups.map((c) => c.slice(-30))));
    check(res.read === '232,233,234,235,236,237,238,239,240,241 / 9437184' && res.text === 'hello drive', 'read(id, start, end) gives those bytes and the size; readText the whole file ' + res.read);
    check(res.rename === 'renamed.txt' && res.moved === 'root' && res.copy === 'copy.txt' && res.trash === true && res.restore === false && res.star === true && res.removed === true && res.gone === 'not-found',
        'rename, move, copy, trash, restore, star and remove (for ever) ' + JSON.stringify([res.rename, res.moved, res.copy, res.trash, res.restore, res.star, res.removed, res.gone]));
    check(res.appFolder === 'Drive Test true' && res.json === '{"level":4} {"level":0}' && Object.values(g.files).filter((f) => f.name === 'save.json').length === 1 && Object.values(g.files).some((f) => f.name === 'My PC' && f.appProperties && f.appProperties.mypc === 'root'),
        'appFolder() is "My PC/Drive Test", made once; saveJson replaces the same file, loadJson reads it (or the default) ' + res.appFolder + ' ' + res.json);
    check(res.about === 'sara@example.com' && /^blob true ID3/.test(res.blob) && res.badName === 'bad-request' && res.missing === 'not-found' && res.abort === 'cancelled',
        'about(), stream() without a worker gives a playable blob: address, errors have codes, a call can be aborted ' + JSON.stringify([res.about, res.blob, res.badName, res.missing, res.abort]));
    check(!tokenInApp && !(await app.evaluate(() => JSON.stringify(localStorage) + document.cookie)).includes('secret'), 'the app never sees a token, a refresh token or the client secret');
    // the user must allow each app: another app's permission was not given, and a refusal is final for that run
    await page.evaluate(() => Bridges.forget('drivetest', 'drive'));
    const pAsk = app.evaluate(() => MyPC.drive.list().then(() => 'ok', (e) => e.code));
    await page.waitForFunction(() => App.dialogOpen(), null, { timeout: 4000 }).catch(() => {});
    const q = await page.evaluate(() => document.getElementById('dialog-title').textContent + ' | ' + document.getElementById('dialog-text').textContent);
    await shot('drive-2-permission');
    await page.evaluate(() => document.getElementById('dialog-no').click());
    const denied = await pAsk;
    check(/Drive Test wants to use your Google Drive/.test(q) && /sara@example.com/.test(q) && denied === 'denied', 'without permission My PC asks once ("Drive Test wants to use your Google Drive"); Don\'t allow gives denied ' + q);
    await tvMenu(page);
    await Promise.all([page.waitForURL(/from=app-drivetest/), page.evaluate(() => { const b = document.querySelectorAll('#pause-items button'); b[b.length - 1].click(); })]);
    await page.waitForSelector('#desk-icons .dicon');
    // Control Panel > Google Drive: the account, Add files, the apps allowed, Sign out
    await page.evaluate(() => { Store.set('drive_apps', { drivetest: 1 }); Win.open('settings', 'drive'); });
    await page.waitForFunction(() => /Signed in as sara@example.com/.test((document.querySelector('.set-main') || document.body).textContent), null, { timeout: 4000 }).catch(() => {});
    const cp = await page.evaluate(() => document.querySelector('.set-main') ? document.querySelector('.set-main').textContent : document.body.textContent);
    await shot('drive-3-control-panel');
    check(/Signed in as sara@example.com/.test(cp) && /Add files from your phone/.test(cp) && /Drive Test/.test(cp) && /Sign out of sara@example.com/.test(cp), 'Control Panel > Google Drive shows the account, Add files from your phone, the apps allowed and Sign out');
    await page.evaluate(() => [...document.querySelectorAll('.set-main .set-row')].find((b) => /Add files from your phone/.test(b.textContent)).click());
    const pk = await page.evaluate(() => ({ open: DriveUI.screenOpen(), qr: !!document.querySelector('.gdui-qr svg'), text: document.querySelector('.gdui').textContent }));
    await shot('drive-4-add-files');
    const pkUrl = await page.evaluate(() => GDrive.pickerUrl());
    check(pk.open && pk.qr && /sara@example.com/.test(pk.text) && pkUrl === 'https://pc.geekspro.us/drive-picker.html#c=web.apps.googleusercontent.com&k=PKEY&p=123', 'Add files from your phone: a QR code for My PC\'s picker page with the Picker settings ' + pkUrl);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    check(!(await page.evaluate(() => DriveUI.screenOpen())), 'Back closes it');
    await page.evaluate(() => [...document.querySelectorAll('.set-main .set-row')].find((b) => /Sign out of/.test(b.textContent)).click());
    await page.evaluate(() => document.getElementById('dialog-yes').click());
    await page.waitForFunction(() => !GDrive.active(), null, { timeout: 3000 }).catch(() => {});
    check(await page.evaluate(() => !GDrive.active() && !(Store.get('gdrive', {}).accounts || []).length) && g.calls.some((c) => /revoke/.test(c)), 'Sign out forgets the account on this profile and gives Google\'s access back (revoke)');
    // another profile has its own Google account (none here)
    check(await page.evaluate(() => { const p2 = Profiles.create('Nadia'); Store.setProfile(p2.id); const a = GDrive.active(); Store.setProfile('p1'); return a === null; }), 'Google accounts are per profile');
    check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
    await page.context().close();

    // Standalone (the app opened in a browser, outside My PC): the SDK runs My PC's Drive module in the page with the Google
    // client of every My PC; MyPC.drive.stream() through the app's own service worker (sdk/drive-sw.js) plays a song.
    const F = await import('./music-fixtures.mjs');
    const song = Buffer.from(F.mp3({ title: 'Worker Song', silent: 900 }));
    const solo = http.createServer((req, res) => {
        if (req.url.startsWith('/sw.js')) { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(`importScripts('${base}sdk/drive-sw.js');`); }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!doctype html><meta charset=utf-8><title>Solo</title><body><audio id=a></audio><script src="${base}sdk/mypc-sdk.js"></script><script>MyPC.init({ onInit() { window.__ok = 1; } });</script>`);
    });
    await new Promise((ok) => solo.listen(0, '127.0.0.1', ok));
    const SOLO = 'http://127.0.0.1:' + solo.address().port + '/';
    const ctx2 = await browser.newContext();
    const g2 = { files: { w1: { id: 'w1', name: 'Worker Song.mp3', mimeType: 'audio/mpeg', parents: ['root'], data: song } } };
    await fakeGoogle(ctx2, g2);
    await ctx2.route('https://firestore.googleapis.com/**', (r) => {
        const u = r.request().url();
        if (/documents\/settings\/google/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ fields: fsFields(db.settings.google) }) });
        r.fulfill({ status: 404, headers: { 'Access-Control-Allow-Origin': '*' }, body: '{}' });
    });
    const sp = await ctx2.newPage();
    sp.errors = []; sp.on('pageerror', (e) => sp.errors.push(e.message));
    await sp.addInitScript(() => localStorage.setItem('mypc_drive', JSON.stringify({ accounts: [{ id: 'g7', email: 'sara@example.com', name: 'Sara', refreshToken: 'RT-secret' }], active: 'g7' })));
    await sp.goto(SOLO);
    await sp.waitForFunction(() => window.__ok === 1);
    const solo1 = await sp.evaluate(async () => {
        const st = await MyPC.drive.status(), l = await MyPC.drive.list({ place: 'audio' });
        const s = await MyPC.drive.stream(l.files[0], { worker: 'sw.js' });
        const r = await fetch(s.url, { headers: { Range: 'bytes=0-2' } });
        const out = { st: st.signedIn + ' ' + (st.account && st.account.email), names: l.files.map((f) => f.name).join(), mode: s.mode, status: r.status, range: r.headers.get('content-range'), body: await r.text() };
        const a = document.getElementById('a');
        a.src = s.url; a.muted = true;
        await a.play().catch((e) => { out.playErr = String(e); });
        await new Promise((ok) => setTimeout(ok, 1500));
        out.t = a.currentTime; out.dur = a.duration;
        a.pause(); a.removeAttribute('src'); a.load(); s.close();
        out.after = (await fetch(s.url, { headers: { Range: 'bytes=0-2' } })).status;
        return out;
    });
    const pieces = g2.calls.filter((c) => /alt=media/.test(c));
    check(solo1.st === 'true sara@example.com' && solo1.names === 'Worker Song.mp3', 'standalone: MyPC.drive uses My PC\'s Google client (settings/google) and the account saved in this browser ' + JSON.stringify(solo1).slice(0, 200));
    check(solo1.mode === 'worker' && solo1.status === 206 && solo1.range === 'bytes 0-2/' + song.length && solo1.body === 'ID3' && solo1.after === 404,
        'stream() through the app\'s service worker (sdk/drive-sw.js): Range requests get 206 pieces; close() ends the address ' + JSON.stringify(solo1));
    check(solo1.t > 0.5 && !solo1.playErr && pieces.length >= 2 && pieces.every((c) => /Bearer AT-secret/.test(c) && /bytes=\d+-\d+/.test(c)),
        'an <audio> plays the Drive song from that address (' + solo1.t.toFixed(2) + ' s played), read by Range with the token as a header (' + pieces.length + ' pieces)');
    check(sp.errors.length === 0, 'standalone: no page errors ' + sp.errors.join('; '));
    await ctx2.close();
    solo.close();
}

// 46. The clock follows the TV, not the web engine's old time zones (js/core/clock.js). MYPC_ONLY=clock runs only these.
// Chromium still puts Morocco at GMT+1 although it is plain UTC since 2026-09-20: at 18:15 UTC the TV says 18:15, the engine 19:15.
async function clockTests(browser, base) {
    console.log('46. Clock: the TV\'s own time (Morocco on UTC since 2026-09-20, the TV\'s clock, a fixed offset in Control Panel)');
    const NOW = '2026-11-07T18:15:00Z';
    async function at(tz, prep) {
        const page = await newPage(browser, base, { settings: { mypc: { wallpapers: [] } } }, { tz });
        await page.clock.setFixedTime(new Date(NOW));
        await routeHosted(page, { offline: true });
        if (prep) await page.addInitScript(prep);
        await page.goto(base + 'index.html');
        await page.waitForSelector('#desk-icons .dicon');
        await page.evaluate(() => Desktop.tick());
        return page;
    }
    const tray = (page) => page.evaluate(() => document.getElementById('tray-time').textContent + ' ' + document.getElementById('tray-date').textContent);
    // 1. Morocco, the engine's zone data is old (GMT+1), no TV clock to ask: the known change puts it right
    {
        const page = await at('Africa/Casablanca');
        const r = await page.evaluate(() => {
            const d = new Date(), aug = new Date(Date.UTC(2026, 7, 1, 12)), made = new Date(2026, 10, 7, 18, 15), s = new Date('2026-11-07T20:30');
            const m = new Date(); m.setHours(23, 0, 0, 0);
            return { info: Clock.info(), h: d.getHours(), off: d.getTimezoneOffset(), aug: aug.getHours(), made: made.getTime() === Date.UTC(2026, 10, 7, 18, 15), str: s.getTime() === Date.UTC(2026, 10, 7, 20, 30),
                     set: m.getTime() === Date.UTC(2026, 10, 7, 23), loc: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }), inst: d instanceof Date && Object.prototype.toString.call(d) === '[object Date]',
                     iso: d.toISOString(), today: Events.today() };
        });
        check(r.info.source === 'rule' && r.info.shift === -60 && r.h === 18 && r.off === 0, 'Morocco after 2026-09-20: 18:15 UTC reads 18:15 (the engine said 19:15): ' + JSON.stringify(r.info));
        check(r.aug === 13, 'Morocco before 2026-09-20 keeps GMT+1 (12:00 UTC in August = 13:00)');
        check(r.made && r.str && r.set, 'dates made from local fields, local date-time text and setHours use the right clock');
        check(r.loc === '6:15 PM' && r.inst && r.iso === '2026-11-07T18:15:00.000Z' && r.today === '2026-11-07', 'toLocaleTimeString, instanceof, toISOString (unchanged) and the Calendar\'s today: ' + r.loc);
        check(/^6:15 PM/.test(await tray(page)), 'the taskbar clock shows the TV\'s 6:15 PM: ' + await tray(page));
        if (process.env.MYPC_SHOTS) await page.screenshot({ path: path.join(process.env.MYPC_SHOTS, 'clock-desktop.png') });
        // Control Panel > Date and time: Automatic (UTC+0); right = a fixed UTC+1, left again = Automatic
        await page.evaluate(() => Win.open('settings', 'time'));
        const row = page.locator('button', { hasText: 'Time zone' }).first();
        await row.waitFor({ timeout: 8000 });
        check(/Automatic \(UTC\+0\)/.test(await row.textContent()), 'Control Panel > Date and time: Time zone Automatic (UTC+0): ' + await row.textContent());
        if (process.env.MYPC_SHOTS) await page.screenshot({ path: path.join(process.env.MYPC_SHOTS, 'clock-control-panel.png') });
        await row.click();
        const fixed = await page.evaluate(() => ({ m: Clock.manual(), h: new Date().getHours(), saved: localStorage.getItem('arc_dev_clock_adj') }));
        check(fixed.m === 60 && fixed.h === 19 && fixed.saved === '60' && /UTC\+1/.test(await page.locator('button', { hasText: 'Time zone' }).first().textContent()) && /^7:15 PM/.test(await tray(page)),
            'a fixed UTC+1 moves every clock to 7:15 PM and is kept for the TV: ' + JSON.stringify(fixed));
        await page.keyboard.press('ArrowLeft').catch(() => {});
        await page.evaluate(() => { Clock.setManual(null); Desktop.tick(); });
        check(await page.evaluate(() => Clock.manual() === null && new Date().getHours() === 18 && localStorage.getItem('arc_dev_clock_adj') === null), 'back to Automatic');
        check(!page.errors.length, 'no page errors: ' + page.errors.join(' | '));
        await page.context().close();
    }
    // 2. a TV whose engine zone is off by one hour while the TV's own clock (tizen.time) is right
    {
        const page = await at('Europe/Paris', () => {
            const D = Date;
            window.tizen.time = { getLocalTimezone: () => 'Africa/Casablanca', getCurrentDateTime: () => { const u = new D(D.now()); return { getFullYear: () => u.getUTCFullYear(), getMonth: () => u.getUTCMonth(), getDate: () => u.getUTCDate(), getHours: () => u.getUTCHours(), getMinutes: () => u.getUTCMinutes(), getSeconds: () => u.getUTCSeconds(), getMilliseconds: () => u.getUTCMilliseconds() }; } };
        });
        const r = await page.evaluate(() => ({ info: Clock.info(), h: new Date().getHours() }));
        check(r.info.source === 'tv' && r.info.shift === -60 && r.h === 18 && /^6:15 PM/.test(await tray(page)), 'the TV\'s own clock wins over the engine (TV 18:15, engine 19:15): ' + JSON.stringify(r.info));
        await page.context().close();
    }
    // 3. nothing wrong: nothing is patched
    {
        const page = await at('UTC');
        check(await page.evaluate(() => Clock.info().source === '' && new Date().getHours() === 18 && Date.prototype.getHours.toString().indexOf('native code') > 0), 'a right zone: Date is left alone');
        await page.context().close();
    }
}

// MYPC_ONLY=calendar node tests/run-tests.mjs: only these checks. The TV's clock is set to Thursday 5 November 2026, 10:00.
async function calendarTests(browser, base) {
    console.log('45. Calendar: Moroccan holidays from Google, Hijri date, widget (off by default), own events, reminders, Manager events');
    const CalFix = await import('./calendar-fixtures.mjs');
    const db = { ics: CalFix.ics('en'), settings: { mypc: { wallpapers: [], events: [{ date: '2026-11-07', title: 'Raja – Wydad derby', tag: 'derby', time: '20:00' }] } } };
    const page = await newPage(browser, base, db);
    await routeHosted(page, { offline: true });
    const calErrors = [];
    page.on('pageerror', (e) => calErrors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') calErrors.push(m.text()); });
    await page.clock.setSystemTime(new Date(2026, 10, 5, 10, 0, 0));
    const shot = async (name) => { if (process.env.MYPC_SHOTS) { await page.waitForTimeout(200); await page.screenshot({ path: path.join(process.env.MYPC_SHOTS, 'calendar-' + name + '.png') }); } };
    await page.goto(base + 'index.html');
    await page.waitForSelector('#desk-icons .dicon');
    check(await page.evaluate(() => Widgets.conf('calendar').show === false && !document.getElementById('wdg-calendar')), 'the Calendar widget is off by default (only Weather is on)');
    await page.evaluate(() => { Widgets.set('weather', 'show', false); Widgets.set('calendar', 'show', true); });
    // the site's copy has no holidays yet (the weekly Action fills it): the TV asks Google's .ics itself; the big events come from the copy
    await page.waitForFunction(() => Events.source().holidays === 'ics', null, { timeout: 8000 }).catch(() => {});
    check(await page.evaluate(() => Events.source().holidays === 'ics') && db.events.some((u) => /calendar\.google\.com\/calendar\/ical\/en\.ma/.test(u)),
        'holidays: the site\'s copy first, then Google\'s "Holidays in Morocco" .ics (no Calendar API key here)');
    await page.waitForFunction(() => /Tomorrow/.test((document.getElementById('wdg-calendar') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
    const w = await page.evaluate(() => { const c = document.getElementById('wdg-calendar'); return { text: c.textContent, page: c.querySelector('.wdg-page').textContent, label: c.getAttribute('aria-label'), kinds: [...c.querySelectorAll('.wdg-ev')].map((x) => x.className) }; });
    check(/Thursday/.test(w.text) && /November 5, 2026/.test(w.text) && /25 Jumada al-Ula 1448 AH/.test(w.text) && /Nov5/.test(w.page.replace(/\s/g, '')),
        'widget: weekday, Gregorian date, Moroccan Hijri date, a calendar page: ' + w.text);
    check(/Tomorrow: Green March Day/.test(w.label) && w.kinds.join().indexOf('wdg-ev-holiday') >= 0, 'widget: tomorrow\'s holiday (Green March) for Voice Guide too');
    check(/Tomorrow: Green March Day/.test(await page.textContent('#toast')), 'the day before a holiday: told once as a notification');
    check(await page.evaluate(() => { const n = Widgets._timers(); return n.join() === 'calendar'; }), 'one timer for the widget');
    await shot('widget');
    // the Manager's events reach every calendar (settings/mypc, read at start)
    check(await page.evaluate(() => Events.day('2026-11-07').some((e) => e.t === 'Raja – Wydad derby' && e.kind === 'event' && e.time === '20:00')), 'events set in the App Store Manager show on the TV\'s calendar');
    // the old day notes become all-day events
    check(await page.evaluate(() => { Store.remove('cal_events'); Store.set('cal_notes', { '2026-11-20': ['Buy bread'] }); const m = Events.mine(); return m.length === 1 && m[0].title === 'Buy bread' && m[0].date === '2026-11-20' && Store.get('cal_notes', null) === null; }),
        'old Calendar notes become events once');
    // the app: Hijri day in each cell, holiday chips, OK on a day adds an event (title, then time / reminder / repeat), Back leaves the editor
    await page.evaluate(() => Win.open('calendar'));
    await page.waitForSelector('.cal-day[data-day="6"]', { timeout: 8000 }).catch(() => {});
    check(await page.evaluate(() => !!document.querySelector('.cal-day[data-day="6"]')), 'the Calendar app opens' + (calErrors.length ? ': ' + calErrors.filter((m) => /\[Win\]|Error/.test(m)).join(' | ') : ''));
    const cells = await page.evaluate(() => ({ six: document.querySelector('.cal-day[data-day="6"]').textContent, five: document.querySelector('.cal-day[data-day="5"]').className, sub: document.querySelector('.cal-hmonths').textContent,
                                              side: document.querySelector('.cal-side').textContent }));
    check(/^626Green March Day$/.test(cells.six) && /cal-today/.test(cells.five) && cells.sub === 'Jumada al-Ula – Jumada al-Akhira 1448', 'the month: Hijri day numbers, holiday chip, today, the Hijri months: ' + cells.six + ' / ' + cells.sub);
    check(/25 Jumada al-Ula 1448 AH/.test(cells.side) && /Google Calendar/.test(cells.side), 'the side: the day\'s Hijri date; where the holidays come from');
    await page.focus('.cal-day[data-day="12"]');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => Keyboard.info && Keyboard.info());
    await page.evaluate(() => { Keyboard.setText('Dentist'); Keyboard.submit(); });
    await page.waitForSelector('[data-f="title"]');
    check(await page.evaluate(() => document.activeElement.getAttribute('data-f') === 'title' && /Dentist/.test(document.activeElement.textContent)), 'OK on a day: type the title, then the event\'s page opens on it');
    for (let i = 0; i < 2; i++) await page.click('[data-f="time"] [data-s="1"]');
    await page.click('[data-f="remind"]'); await page.click('[data-f="remind"]'); await page.click('[data-f="remind"]');
    await page.click('[data-f="repeat"]');
    await shot('editor');
    await page.click('.cal-save');
    const saved = await page.evaluate(() => Events.mine().filter((e) => e.title === 'Dentist')[0]);
    check(saved && saved.date === '2026-11-12' && saved.time === '09:15' && saved.remind === 60 && saved.yearly === true, 'saved: day, time (09:00 + 15 min), 1 hour before, every year ' + JSON.stringify(saved));
    check(await page.evaluate(() => /Dentist/.test(document.querySelector('.cal-day[data-day="12"]').textContent) && document.activeElement.getAttribute('data-day') === '12'), 'the day shows it; focus back on the day');
    check(await page.evaluate(() => Events.day('2027-11-12', true).some((e) => e.t === 'Dentist') && !Events.day('2026-11-12').some((e) => e.kind === 'mine')), 'a yearly event comes back next year; the wallpaper never sees own events');
    check(await page.evaluate(() => Events.hijriText('2027-05-17') === '10 Dhu al-Hijjah 1448 AH' && Events.hijriText('2027-05-16') === '9 Dhu al-Hijjah 1448 AH'),
        'Google\'s Eid al-Adha 2027 (a day after Umm al-Qura in the fixture) moves that month\'s Hijri dates');
    await page.evaluate(() => document.querySelector('.cal-ev.cal-k-mine').click());
    check(await page.evaluate(() => !!document.querySelector('.cal-del')), 'OK on one of your events opens it (Delete there)');
    await tvBack(page);
    check(await page.evaluate(() => !document.querySelector('.cal-del') && !document.getElementById('window').hidden), 'Back leaves the event\'s page, not the app');
    await page.keyboard.press('PageDown');
    check(await page.evaluate(() => /December 2026/.test(document.querySelector('.cal-title').textContent) && /Champions League night/.test(document.querySelector('.cal-grid').textContent)), 'next month (Channel Down): big events (Champions League nights)');
    await page.keyboard.press('PageUp');
    await page.focus('.cal-day[data-day="5"]');
    await shot('app');
    // Hijri correction for this profile
    await page.click('[data-step="plus"]');
    check(await page.evaluate(() => /26 Jumada al-Ula/.test(document.querySelector('.cal-side').textContent) && Events.hijriAdj() === 1), 'Hijri date correction (+1 day) for this profile');
    await page.click('[data-step="minus"]');
    // reminders: one timer to the next one; a card at the time
    await page.evaluate(() => { Win.close(); Events.add({ date: '2026-11-05', time: '10:30', title: 'Call the bank', remind: 15 }); });
    check(await page.evaluate(() => CalRemind._due().some((r) => r.e.t === 'Call the bank' && r.at === new Date(2026, 10, 5, 10, 15).getTime())), 'reminder due 15 minutes before');
    await page.clock.setSystemTime(new Date(2026, 10, 5, 10, 16, 0));
    await page.evaluate(() => CalRemind.check());
    check(/Call the bank/.test(await page.textContent('#toast')), 'the reminder shows as a notification card');
    check(await page.evaluate(() => { const n = document.querySelectorAll('#toast .ntf, #toast > *').length; CalRemind.check(); return document.querySelectorAll('#toast .ntf, #toast > *').length === n; }), 'and only once');
    // Arabic
    await page.evaluate(() => { I18n.setLang('ar'); Widgets.render(); Widgets.refreshNow('calendar'); });
    await page.waitForTimeout(200);
    check(await page.evaluate(() => { const t = document.getElementById('wdg-calendar').textContent; return /الخميس/.test(t) && /جمادى الأولى 1448 هـ/.test(t) && t.indexOf(I18n.t('ev_greenmarch')) >= 0 && /غدًا/.test(t); }),
        'Arabic: the holiday\'s Arabic name, the Hijri date in Arabic');
    await shot('widget-ar');
    check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
    await page.context().close();
}

// Its own function so that MYPC_ONLY=music runs just these checks.
async function musicTests(browser, base) {
    console.log('43. Music: USB drive, song details and covers, hold-OK menu, playlists, the TV player, queue, resume, screensaver, Google Drive');
    const F = await import('./music-fixtures.mjs');
    const cover = F.png(32, 32, [30, 140, 220]), art = F.png(24, 24, [220, 60, 40]);
    const D = '/opt/media/USBDriveA1';
    const files = {
        [D + '/Music/Artist A/Album One/cover.png']: cover,
        [D + '/Music/Artist A/Album One/01 - Song One.mp3']: F.mp3({ title: 'Song One', artist: 'Artist A', album: 'Album One', track: 1, pic: art }),
        [D + '/Music/Artist A/Album One/02 - Song Two.mp3']: F.mp3({ title: 'Song Two', artist: 'Artist A', album: 'Album One', track: 2 }),
        [D + '/Music/Artist A/Album One/03 Song Three.flac']: F.flac({ title: 'Song Three', artist: 'Artist A', album: 'Album One', seconds: 200 }),
        [D + '/Music/Artist A/Album Two/01.m4a']: F.m4a({ title: 'Harbor', artist: 'Artist A', album: 'Album Two', pic: art }),
        [D + '/Music/Artist A/Album Two/02 Broken.mp3']: F.mp3({ title: 'Broken' }),
        [D + '/Music/Loose.wav']: F.wav({ title: 'Loose Tone', artist: 'Lab' }),
        [D + '/Photos/beach.jpg']: cover,
        [D + '/.Trashes/x.mp3']: F.mp3({ title: 'hidden' })
    };
    const b64 = {};
    for (const k in files) b64[k] = Buffer.from(files[k]).toString('base64');
    const MOCK = ([files, D]) => {
        const bin = (s) => { const r = atob(s), b = new Uint8Array(r.length); for (let i = 0; i < r.length; i++) b[i] = r.charCodeAt(i); return b; };
        const tree = {}; // path -> Uint8Array | true (folder)
        const addDirs = (p) => { const parts = p.split('/'); for (let i = 2; i < parts.length; i++) tree[parts.slice(0, i).join('/')] = true; };
        for (const k in files) { tree[k] = bin(files[k]); addDirs(k); }
        const fsErr = (name) => { const e = new Error(name); e.name = name; return e; };
        const listeners = [];
        window.__usb = { tree, mounted: true, listeners, reads: 0 };
        const fs = {
            listStorages: (ok) => setTimeout(() => ok(window.__usb.mounted ? [{ label: 'removable_sda1', type: 'EXTERNAL', state: 'MOUNTED' }, { label: 'internal0', type: 'INTERNAL', state: 'MOUNTED' }] : [{ label: 'internal0', type: 'INTERNAL', state: 'MOUNTED' }]), 5),
            resolve: (loc, ok, err) => setTimeout(() => { if (loc === 'removable_sda1' && window.__usb.mounted) ok({ fullPath: 'removable_sda1', toURI: () => 'file://' + D }); else err(fsErr('NotFoundError')); }, 5),
            listDirectory: (p, ok, err) => setTimeout(() => {
                if (p === '/opt/media') return ok(window.__usb.mounted ? ['USBDriveA1'] : []);
                if (tree[p] !== true || !window.__usb.mounted) return err(fsErr('NotFoundError'));
                const out = []; for (const k in tree) if (k.indexOf(p + '/') === 0 && k.slice(p.length + 1).indexOf('/') < 0) out.push(k.slice(p.length + 1));
                ok(out.reverse(), p);
            }, 5),
            isDirectory: (p) => { if (!(p in tree) && p !== '/opt/media/USBDriveA1') throw fsErr('NotFoundError'); return tree[p] === true || p === D; },
            toURI: (p) => 'file://' + encodeURI(p),
            openFile: (p) => {
                const d = tree[p]; if (!d || d === true || !window.__usb.mounted) throw fsErr('NotFoundError');
                let pos = 0;
                return { seek: (o, w) => (pos = w === 'END' ? d.length + o : o), readDataNonBlocking: (ok, e, n) => { window.__usb.reads++; const r = d.slice(pos, pos + n); pos += r.length; setTimeout(() => ok(r), 3); }, close() {}, closeNonBlocking() {} };
            },
            rename: (p, name, ok, err) => setTimeout(() => {
                const to = p.slice(0, p.lastIndexOf('/') + 1) + name;
                if (to in tree) return err(fsErr('InvalidValuesError'));
                for (const k of Object.keys(tree)) if (k === p || k.indexOf(p + '/') === 0) { tree[to + k.slice(p.length)] = tree[k]; delete tree[k]; }
                ok();
            }, 5),
            addStorageStateChangeListener: (fn) => { listeners.push(fn); return 1; }
        };
        window.tizen.filesystem = fs;
        // the TV's player: opens paths and URLs, "plays" by the clock; a file named Broken fails to open
        const av = { log: [], state: 'NONE', cur: 0, t: 0, l: null, url: '' };
        window.__av = av;
        window.webapis.avplay = {
            open: (u) => { av.log.push('open ' + u); av.url = u; av.state = 'IDLE'; av.cur = 0; },
            setListener: (l) => { av.l = l; }, setDisplayRect() {},
            prepareAsync: (ok, err) => setTimeout(() => { if (/Broken/.test(av.url)) return err('PLAYER_ERROR_INVALID_URI'); av.state = 'READY'; ok(); }, 10),
            play: () => { av.state = 'PLAYING'; av.t = Date.now(); av.log.push('play'); },
            pause: () => { if (av.state === 'PLAYING') av.cur += Date.now() - av.t; av.state = 'PAUSED'; av.log.push('pause'); },
            stop: () => { av.state = 'IDLE'; }, close: () => { av.state = 'NONE'; av.log.push('close'); },
            seekTo: (ms, ok) => { av.cur = ms; av.t = Date.now(); av.log.push('seek ' + ms); if (ok) setTimeout(ok, 1); },
            getCurrentTime: () => av.state === 'PLAYING' ? av.cur + Date.now() - av.t : av.cur,
            getDuration: () => 200000, getState: () => av.state,
        };
        av.end = () => av.l && av.l.onstreamcompleted();
    };
    const db = { apps: {} };
    const page = await newPage(browser, base, db);
    await page.addInitScript(MOCK, [b64, D]);
    await routeHosted(page, { offline: true });
    await page.goto(base + 'index.html');
    await page.waitForSelector('#desk-icons .dicon');
    const key = (code, down) => page.evaluate(([c, d]) => Input.onKey({ keyCode: c, repeat: false, preventDefault() {} }, d), [code, down]);
    const press = async (code) => { await key(code, true); await key(code, false); };
    // MYPC_SHOTS=<folder>: screenshots of each screen (to look at the design)
    const shot = async (name) => { if (process.env.MYPC_SHOTS) { await page.waitForTimeout(150); await page.screenshot({ path: path.join(process.env.MYPC_SHOTS, name + '.png') }); } };
    const focusText = (sel, re) => page.evaluate(([s, r]) => { const b = [...document.querySelectorAll(s)].find((x) => new RegExp(r).test(x.textContent)); if (b) b.focus(); return !!b; }, [sel, re.source]);

    // Home: the USB drive and Google Drive
    await page.evaluate(() => Win.open('music'));
    await page.waitForFunction(() => [...document.querySelectorAll('.mx-tile')].some((t) => /USB A1/.test(t.textContent)), null, { timeout: 5000 }).catch(() => {});
    const home = await page.evaluate(() => ({ tiles: [...document.querySelectorAll('.mx-tile')].map((t) => t.textContent), side: [...document.querySelectorAll('.mx-nav')].map((t) => t.textContent) }));
    await shot('1-home');
    check(home.tiles.some((t) => /USB A1/.test(t)) && home.tiles.some((t) => /Google Drive/.test(t)) && home.side.some((t) => /USB A1/.test(t)), 'Home lists the USB drive plugged into the TV and Google Drive ' + JSON.stringify(home));

    // a folder: sub-folders as tiles, songs as rows; hidden and system folders are left out
    await page.evaluate(() => [...document.querySelectorAll('.mx-tile')].find((t) => /USB A1/.test(t.textContent)).click());
    await page.waitForSelector('.mx-grid .mx-tile');
    const root = await page.evaluate(() => [...document.querySelectorAll('.mx-scroll .mx-tile, .mx-scroll .mx-row')].map((t) => t.querySelector('.mx-name, .mx-rt').textContent));
    check(root.join() === 'Music,Photos', 'the drive shows its folders, without .Trashes: ' + root);
    await page.evaluate(() => [...document.querySelectorAll('.mx-tile')].find((t) => /Music/.test(t.textContent)).click());
    await page.waitForFunction(() => document.querySelectorAll('.mx-row').length === 1);
    await page.evaluate(() => [...document.querySelectorAll('.mx-tile')].find((t) => /Artist A/.test(t.textContent)).click());
    await page.waitForFunction(() => /Album One/.test((document.querySelector('.mx-grid') || {}).textContent || ''));
    // the folder tile shows the folder's cover.png
    await page.waitForFunction(() => { const t = [...document.querySelectorAll('.mx-tile')].find((x) => /Album One/.test(x.textContent)); return t && t.querySelector('img'); }, null, { timeout: 6000 }).catch(() => {});
    await shot('2-artist');
    const tileArt = await page.evaluate(() => { const t = [...document.querySelectorAll('.mx-tile')].find((x) => /Album One/.test(x.textContent)); const i = t && t.querySelector('img'); return i ? i.src.slice(0, 5) : ''; });
    check(tileArt === 'blob:', 'a folder tile shows its cover picture (cover.png, made small): ' + tileArt);
    // inside the album: titles, artists and the song's own cover from the files
    await page.evaluate(() => [...document.querySelectorAll('.mx-tile')].find((t) => /Album One/.test(t.textContent)).click());
    await page.waitForFunction(() => document.querySelectorAll('.mx-row').length === 3);
    await page.waitForFunction(() => /Song Three/.test(document.querySelector('.mx-rows').textContent) && document.querySelector('.mx-row img'), null, { timeout: 8000 }).catch(() => {});
    const rows = await page.evaluate(() => [...document.querySelectorAll('.mx-row')].map((r) => r.querySelector('.mx-rt').textContent + '|' + r.querySelector('.mx-ra').textContent + '|' + !!r.querySelector('img')));
    await shot('3-album');
    check(rows[0] === 'Song One|Artist A · Album One|true' && /^Song Two\|Artist A/.test(rows[1]) && /^Song Three\|Artist A · Album One/.test(rows[2]),
        'songs show the title, artist and album inside the files, and their cover: ' + JSON.stringify(rows));
    check(await page.evaluate(() => /Song Three.*3:20/.test(document.querySelector('.mx-rows').textContent)), 'the FLAC song shows its length (3:20)');

    // hold OK on a folder: its menu; Save as playlist
    await page.evaluate(() => Focus.focus(document.querySelector('.mx-act-main')));
    await press(10009);                                    // back to Artist A
    await page.waitForFunction(() => /Album Two/.test(document.querySelector('.mx-scroll').textContent));
    await focusText('.mx-tile', /Album One/);
    await key(13, true); await page.waitForTimeout(750); await key(13, false);
    const menu = await page.evaluate(() => document.querySelector('.mx-menu') ? [...document.querySelectorAll('.mx-menu-i')].map((b) => b.textContent) : null);
    await shot('4-menu');
    check(menu && ['Play all', 'Shuffle', 'Save as playlist', 'Rename'].every((x) => menu.indexOf(x) >= 0), 'holding OK on a folder opens its menu: ' + JSON.stringify(menu));
    check(await page.evaluate(() => /Album One/.test(document.querySelector('.mx-title').textContent) === false), 'letting OK go after the hold does not open the folder');
    await focusText('.mx-menu-i', /Save as playlist/);
    await press(13);
    await page.waitForFunction(() => Keyboard.isOpen());
    await page.evaluate(() => Keyboard.submit());
    const lists = await page.evaluate(() => Store.get('music_lists'));
    check(lists && lists.length === 1 && lists[0].n === 'Album One' && lists[0].dir && lists[0].dir.p === '/opt/media/USBDriveA1/Music/Artist A/Album One', 'Save as playlist keeps the folder as a playlist of this profile');
    // + on a folder: the same menu; Play all plays it with the TV's player
    await focusText('.mx-tile', /Album One/);
    await press(80); // P = pause key: nothing queued yet, does nothing
    await page.evaluate(() => Win.action('menu', false));
    await focusText('.mx-menu-i', /^Play all$/);
    await press(13);
    await page.waitForFunction(() => Music.engineName() === 'av' && document.querySelector('.mx-np') && !document.querySelector('.mx-np').hidden, null, { timeout: 5000 }).catch(() => {});
    let st = await page.evaluate(() => ({ s: Music.state(), log: __av.log.slice(), np: document.querySelector('.mx-np-title').textContent, eng: Music.engineName() }));
    check(st.s.playing && st.eng === 'av' && st.log.indexOf('open /opt/media/USBDriveA1/Music/Artist A/Album One/01 - Song One.mp3') >= 0 && st.np === 'Song One' && st.s.count === 3,
        'Play all: the TV\'s own player opens the first song by its path; Now playing shows it ' + JSON.stringify({ log: st.log, np: st.np, eng: st.eng }));
    await page.waitForFunction(() => document.querySelector('.mx-np-art img'), null, { timeout: 5000 }).catch(() => {});
    await page.evaluate(() => Focus.focus(document.querySelector('.mx-cb-main')));
    await shot('5-np-win11');
    for (const th of ['ios', 'android', 'win7', 'xp', 'mac']) { await page.evaluate((x) => Themes.set(x), th); await shot('5-np-' + th); }
    await page.evaluate(() => Themes.set('win11'));
    check(await page.evaluate(() => !!document.querySelector('.mx-np-art img') && !!document.querySelector('.mx-np').style.getPropertyValue('--mx-tint')), 'Now playing shows the song\'s cover and takes its colour');
    // the remote's ⏭ and the end of a song
    await press(10233);
    await page.waitForFunction(() => Music.state().title === 'Song Two' && Music.state().playing);
    await page.evaluate(() => __av.end());
    await page.waitForFunction(() => Music.state().title === 'Song Three' && Music.state().playing, null, { timeout: 4000 }).catch(() => {});
    check(await page.evaluate(() => Music.state().title === 'Song Three' && /03 Song Three\.flac/.test(__av.url)), 'the ⏭ key and the end of a song move on to the next one');
    // seek on the bar
    await page.evaluate(() => Focus.focus(document.querySelector('.mx-np-seek')));
    await press(39); await press(39);
    const sk = await page.evaluate(() => ({ pos: Music.state().pos, log: __av.log.filter((l) => /^seek/.test(l)) }));
    check(sk.pos >= 19 && sk.log.some((l) => /^seek (1\d|2\d)\d{3}$/.test(l)), 'Right on the bar moves 10 s forward ' + JSON.stringify(sk));
    // ⏯ pauses anywhere
    await press(10252);
    check(await page.evaluate(() => !Music.state().playing && __av.state === 'PAUSED'), 'the Play / Pause key pauses');
    await press(10252);
    check(await page.evaluate(() => Music.state().playing && __av.state === 'PLAYING'), 'and plays again');
    // shuffle / repeat buttons
    await page.evaluate(() => document.querySelector('.mx-cb[data-c="repeat"]').click());
    check(await page.evaluate(() => Music.state().repeat === 'all' && document.querySelector('.mx-cb[data-c="repeat"]').classList.contains('on')), 'Repeat: all');
    await page.evaluate(() => __av.end());
    await page.waitForFunction(() => Music.state().title === 'Song One' && Music.state().playing, null, { timeout: 4000 }).catch(() => {});
    check(await page.evaluate(() => Music.state().title === 'Song One'), 'repeat all: after the last song, the first one');
    await page.evaluate(() => Music.setRepeat('off'));
    // Back: Now playing -> the folder; the mini player shows the song
    await press(10009);
    check(await page.evaluate(() => document.querySelector('.mx-np').hidden && !document.querySelector('.mx-mini').hidden && /Song One/.test(document.querySelector('.mx-mini').textContent)), 'Back leaves Now playing; the mini player under the list shows the song');

    // playlists screen and a playlist of a folder
    await page.evaluate(() => document.querySelector('.mx-nav[data-nav="lists"]').click());
    check(await page.evaluate(() => /Album One/.test(document.querySelector('.mx-scroll').textContent)), 'Playlists lists the saved folder');

    // a song that cannot be played: the TV's player, then the web player, then the next song
    await page.evaluate(() => Music.playList([{ s: 'usb', p: '/opt/media/USBDriveA1/Music/Artist A/Album Two/02 Broken.mp3', n: '02 Broken.mp3' }, { s: 'usb', p: '/opt/media/USBDriveA1/Music/Artist A/Album Two/01.m4a', n: '01.m4a' }], 0));
    await page.waitForFunction(() => Music.state().index === 1 && Music.state().playing, null, { timeout: 8000 }).catch(() => {});
    check(await page.evaluate(() => Music.state().index === 1 && Music.state().playing && /01\.m4a/.test(__av.url)), 'a song that fails in both players is skipped (with a notice) and the next one plays');
    await page.waitForFunction(() => Music.state().title === 'Harbor', null, { timeout: 5000 }).catch(() => {});
    check(await page.evaluate(() => Music.state().title === 'Harbor' && Music.queue().list[1].t === 'Harbor'), 'the details of an M4A (moov after the sound) are read and kept in the queue');

    // rename a song from its menu
    await page.evaluate(() => { Win.close(); Music.pause(); Win.open('music'); });
    await page.waitForTimeout(100);
    await page.evaluate(() => [...document.querySelectorAll('.mx-tile')].find((t) => /USB A1/.test(t.textContent)).click());
    await page.waitForSelector('.mx-grid .mx-tile');
    await page.evaluate(() => [...document.querySelectorAll('.mx-tile')].find((t) => /Music/.test(t.textContent)).click());
    await page.waitForFunction(() => document.querySelectorAll('.mx-row').length === 1);
    await focusText('.mx-row', /Loose/);
    await key(13, true); await page.waitForTimeout(750); await key(13, false);
    await focusText('.mx-menu-i', /^Rename$/);
    await press(13);
    await page.waitForFunction(() => Keyboard.isOpen());
    await page.evaluate(() => { Keyboard.setText('Calm Tone'); Keyboard.submit(); });
    await page.waitForFunction(() => '/opt/media/USBDriveA1/Music/Calm Tone.wav' in __usb.tree, null, { timeout: 3000 }).catch(() => {});
    check(await page.evaluate(() => '/opt/media/USBDriveA1/Music/Calm Tone.wav' in __usb.tree && !('/opt/media/USBDriveA1/Music/Loose.wav' in __usb.tree)), 'Rename renames the file on the drive (its extension kept)');

    // the screensaver: shown, then any key brings My PC back and does nothing else
    await page.evaluate(() => MusicSaver.show(true));
    await page.waitForTimeout(150);
    await page.waitForTimeout(800);
    await shot('6-saver-bars');
    check(await page.evaluate(() => !!document.querySelector('.mxs canvas') && MusicSaver.isOn()), 'the screensaver draws its visualizer');
    const title0 = await page.evaluate(() => document.querySelector('.mx-title').textContent);
    await press(10009);
    check(await page.evaluate((t0) => !MusicSaver.isOn() && !document.querySelector('.mxs') && document.querySelector('.mx-title').textContent === t0 && Win.isOpen(), title0), 'a key closes the screensaver and does nothing else (Back did not leave the folder)');
    await page.evaluate(() => { Music.setPref('saver', 'cover'); MusicSaver.show(true); });
    await shot('6-saver-cover');
    await page.evaluate(() => { MusicSaver.hide(); Music.setPref('saver', 'waves'); MusicSaver.show(true); });
    await page.waitForTimeout(1200);
    await shot('6-saver-waves');
    await page.evaluate(() => { MusicSaver.hide(); Music.setPref('saver', 'cover'); MusicSaver.show(true); });
    check(await page.evaluate(() => !!document.querySelector('.mxs-cover') && !document.querySelector('.mxs canvas')), 'the Cover screensaver needs no canvas');
    // the song top left, the time top right
    const lay = await page.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); const t = r('.mxs-title'), c = r('.mxs-clock'); return { tl: t.left < innerWidth * 0.1 && t.top < innerHeight * 0.15, tr: c.right > innerWidth * 0.9 && c.top < innerHeight * 0.15 }; });
    check(lay.tl && lay.tr, 'the screensaver shows the song top left and the time top right ' + JSON.stringify(lay));
    await page.evaluate(() => { MusicSaver.hide(); Music.setPref('saver', 'ring'); MusicSaver.show(true); });
    await page.waitForTimeout(300);
    await shot('6-saver-ring');
    check(await page.evaluate(() => !!document.querySelector('.mxs-s-ring canvas') && getComputedStyle(document.querySelector('.mxs-s-ring .mxs-cover')).borderRadius === '50%'), 'the Ring screensaver draws its bars around a round cover');
    await page.evaluate(() => MusicSaver.hide());
    // the new styles (owner request 2026-11-06): Waveform, Particles, Pulsating rings; CH + / CH − change the style in place
    for (const st of ['scope', 'particles', 'pulse']) {
        await page.evaluate((x) => { MusicSaver.hide(); Music.setPref('saver', x); MusicSaver.show(true); }, st);
        await page.waitForTimeout(600);
        await shot('6-viz-' + st);
        check(await page.evaluate((x) => MusicSaver.isOn() && MusicSaver.style() === x && !!document.querySelector('.mxs-s-' + x + ' canvas') && MusicSaver._stats().frames > 10, st), 'the audio visualizer draws the ' + st + ' style');
    }
    await page.evaluate(() => { MusicSaver.hide(); Music.setPref('saver', 'bars'); MusicSaver.show(true); });
    await page.waitForTimeout(400);
    await press(427);                                                                   // CH +
    check(await page.evaluate(() => MusicSaver.isOn() && MusicSaver.style() === 'scope' && !!document.querySelector('.mxs-s-scope') && document.querySelectorAll('.mxs').length === 1 && Music.prefs().saver === 'scope'), 'CH + shows the next style and keeps it (the visualizer stays open)');
    await page.waitForTimeout(250); await press(428); await page.waitForTimeout(250); await press(428);   // CH − twice
    check(await page.evaluate(() => MusicSaver.isOn() && MusicSaver.style() === 'cover' && Music.prefs().saver === 'cover'), 'CH − goes back, round to the last style');
    await page.evaluate(() => Music.setPref('saver', 'off'));
    await page.waitForTimeout(250); await press(427);
    await page.waitForTimeout(100);
    const offT = await page.evaluate(() => ({ on: MusicSaver.isOn(), st: MusicSaver.style(), saver: Music.prefs().saver, viz: Music.prefs().vizStyle }));
    check(offT.st === 'bars' && offT.saver === 'off' && offT.viz === 'bars', 'with the automatic visualizer off, CH + only remembers the style for the button ' + JSON.stringify(offT));
    await press(13);
    check(await page.evaluate(() => !MusicSaver.isOn()), 'another key still closes it');
    await page.evaluate(() => MusicSaver.hide());
    // Now playing's Screensaver button: with the remote's OK, and with a mouse click (the click and a resting pointer do not close it)
    await page.evaluate(() => { Music.setPref('saver', 'bars'); Win.open('music', 'np'); });
    await page.waitForSelector('.mx-np:not([hidden]) .mx-np-tool');
    const svBtn = () => page.evaluate(() => [...document.querySelectorAll('.mx-np-tool')].find((b) => /Audio visualizer/.test(b.textContent)).focus());
    await svBtn(); await press(13);
    await page.waitForTimeout(300);
    check(await page.evaluate(() => MusicSaver.isOn()), 'OK on Now playing\'s Screensaver button opens it');
    await press(13);
    check(await page.evaluate(() => !MusicSaver.isOn() && !!document.querySelector('.mx-np:not([hidden])')), 'a key closes it, back on Now playing');
    const box = await page.evaluate(() => { const r = [...document.querySelectorAll('.mx-np-tool')].find((b) => /Audio visualizer/.test(b.textContent)).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.mouse.move(box.x, box.y); await page.mouse.click(box.x, box.y);
    await page.mouse.move(box.x + 3, box.y + 2);
    await page.waitForTimeout(1500);
    await page.mouse.move(box.x + 8, box.y + 6);
    check(await page.evaluate(() => MusicSaver.isOn()), 'a mouse click on the button opens it, and the click or a resting pointer does not close it');
    await page.mouse.move(box.x + 200, box.y + 120);
    check(await page.evaluate(() => !MusicSaver.isOn()), 'moving the pointer for real closes it');
    await page.waitForTimeout(700);
    // armed only while music plays
    await page.evaluate(() => { Music.setPref('saver', 'bars'); Music.play(); });
    await page.waitForFunction(() => Music.state().playing);
    check(await page.evaluate(() => MusicSaver._armed()), 'while a song plays the screensaver waits for the remote to rest');
    await page.evaluate(() => Music.pause());
    check(await page.evaluate(() => !MusicSaver._armed()), 'paused: no screensaver timer');
    // Play in the background (owner request 2026-11-06): in a browser (PC, phone) a hidden tab keeps playing when it is on;
    // on the TV (webapis) hidden always pauses (another app or source is on screen)
    const bgT = await page.evaluate(async () => {
        const hide = (h) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); document.dispatchEvent(new Event('visibilitychange')); };
        const wait = (ms) => new Promise((r) => setTimeout(r, ms)), out = {};
        Music.play(); await wait(300);
        out.tvRow = Music.canBackground();
        Music.setPref('bg', true); hide(true); await wait(200); out.tvHidden = Music.state().playing; hide(false); await wait(400);
        const w = window.webapis, tz = window.tizen; delete window.webapis; delete window.tizen;
        out.webRow = Music.canBackground();
        hide(true); await wait(200); out.webBgOn = Music.state().playing; hide(false); await wait(100);
        Music.setPref('bg', false); hide(true); await wait(200); out.webBgOff = Music.state().playing;
        window.webapis = w; if (tz) window.tizen = tz; hide(false); await wait(400); out.back = Music.state().playing;
        delete document.hidden; Music.pause();
        return out;
    });
    check(!bgT.tvRow && bgT.tvHidden === false && bgT.webRow && bgT.webBgOn === true && bgT.webBgOff === false && bgT.back === true, 'Play in the background: a hidden browser tab plays on when it is on, pauses when off; the TV always pauses ' + JSON.stringify(bgT));
    // real sound on the TV's player: AVPlay gives no sound data, so the song file is read and analysed, shown at the player's
    // position. A 440 Hz tone: the middle bars move, the low and the high ones stay down; paused: everything goes flat.
    const q0 = await page.evaluate(() => { const q = Music.queue(); return { list: q.list.slice(), i: q.order[q.at] }; });
    await page.evaluate(([p, b]) => { const r = atob(b), u = new Uint8Array(r.length); for (let i = 0; i < r.length; i++) u[i] = r.charCodeAt(i); __usb.tree[p] = u; Music.setPref('saver', 'bars');
        Music.playList([{ s: 'usb', p: p, n: 'Tone 440.wav', t: 'Tone 440' }], 0); }, [D + '/Music/Tone 440.wav', Buffer.from(F.wav({ title: 'Tone 440', seconds: 30 })).toString('base64')]);
    await page.waitForFunction(() => Music.engineName() === 'av' && Music.state().playing && !Music.state().loading, null, { timeout: 5000 }).catch(() => {});
    await page.evaluate(() => MusicSaver.show(true));
    await page.waitForFunction(() => MusicSaver._src() === 'file' && Math.max(...MusicSaver._levels()) > 0.5, null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400);
    const lvT = await page.evaluate(() => ({ src: MusicSaver._src(), lv: MusicSaver._levels() }));
    const mid = Math.max(...lvT.lv.slice(16, 21)), lowB = Math.max(...lvT.lv.slice(0, 8)), highB = Math.max(...lvT.lv.slice(30));
    check(lvT.src === 'file' && mid > 0.5 && lowB < 0.1 && highB < 0.1, 'on the TV player the screensaver shows the song\'s real sound (440 Hz: the middle bars only) ' + JSON.stringify({ src: lvT.src, mid, lowB, highB }));
    await page.evaluate(() => Music.pause());
    await page.waitForTimeout(900);
    check(await page.evaluate(() => Math.max(...MusicSaver._levels()) < 0.05), 'paused: the bars go flat (nothing made up)');
    await page.evaluate(() => MusicSaver.hide());
    await page.evaluate((q) => { Music.playList(q.list, q.i); Music.pause(); }, q0);           // the queue as it was, for the checks below

    // the widget on the desktop follows the player
    await page.evaluate(() => { Win.close(); Widgets.set('music', 'show', true); Music.play(); });      // the widget is off by default
    await page.waitForTimeout(300);
    await shot('7-widget');
    check(await page.evaluate(() => /Harbor/.test(document.getElementById('wdg-music').textContent)), 'the Music Player widget shows the song playing');

    // resume after a game: the page changes, then back on the desktop it plays on where it was
    await page.waitForTimeout(1600);
    const pos0 = await page.evaluate(() => Music.state().pos);
    await page.evaluate(() => { location.replace(location.href.split('?')[0] + '?play=blocks'); });
    await page.waitForFunction(() => window.GameHost && GameHost.state() === 'running', null, { timeout: 15000 });
    await page.waitForFunction(() => Music.state().playing, null, { timeout: 5000 }).catch(() => {});
    const inGame = await page.evaluate(() => ({ s: Music.state(), log: __av.log.slice(), reads: __usb.reads }));
    check(inGame.s.playing && inGame.s.title === 'Harbor' && inGame.log.some((l) => /^seek \d+/.test(l) && +l.slice(5) >= Math.floor(pos0 * 1000) - 500),
        'the music plays on under the game, from where it was ' + JSON.stringify(inGame.log));
    await page.evaluate(() => Music.pause());
    check(await page.evaluate(() => Music.has() && !Music.state().playing), 'on the game page Music can be paused (the game menu)');
    await page.evaluate(() => Music.play());
    await page.waitForFunction(() => Music.state().playing, null, { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const pos1 = await page.evaluate(() => Music.state().pos);
    await page.evaluate(() => { location.replace(location.href.split('?')[0] + '?from=blocks'); });
    await page.waitForSelector('#desk-icons .dicon');
    await page.waitForFunction(() => Music.state().playing, null, { timeout: 5000 }).catch(() => {});
    const res = await page.evaluate(() => ({ s: Music.state(), log: __av.log.slice() }));
    check(res.s.playing && res.s.title === 'Harbor' && res.log.some((l) => /^open .*01\.m4a/.test(l)) && res.log.some((l) => /^seek \d+/.test(l) && +l.slice(5) >= Math.floor(pos1 * 1000) - 500),
        'back from a game the music plays on from where it was ' + JSON.stringify(res.log) + ' at ' + pos1);
    // another profile has its own queue and playlists
    const other = await page.evaluate(() => { const p2 = Profiles.create('Nadia'); Store.setProfile(p2.id); const o = { q: Store.get('music', null), l: Store.get('music_lists', null) }; Store.setProfile('p1'); return o; });
    check(other.q === null && other.l === null, 'queue and playlists are per profile');

    // the drive is removed
    await page.evaluate(() => Win.open('music'));
    await page.waitForFunction(() => [...document.querySelectorAll('.mx-nav')].some((t) => /USB A1/.test(t.textContent)));
    await page.evaluate(() => { __usb.mounted = false; __usb.listeners.forEach((f) => f({ label: 'removable_sda1', state: 'REMOVED' })); });
    await page.waitForFunction(() => ![...document.querySelectorAll('.mx-nav')].some((t) => /USB A1/.test(t.textContent)), null, { timeout: 4000 }).catch(() => {});
    check(await page.evaluate(() => ![...document.querySelectorAll('.mx-nav')].some((t) => /USB A1/.test(t.textContent)) && /No USB drive/.test(document.querySelector('.mx-scroll').textContent)), 'a removed drive leaves the side bar and Home');
    await page.evaluate(() => Music.stop());

    // Google Drive: My PC's own sign-in (js/core/gdrive.js, Control Panel > Google Drive); every missing piece has its own message
    const gdText = () => page.evaluate(async () => { document.querySelector('.mx-nav[data-nav="gd"]').click(); for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 50)); const m = document.querySelector('.mx-msg, .mx-scroll .mx-grid'); if (m) return document.querySelector('.mx-main').textContent; } return document.querySelector('.mx-main').textContent; });
    let gt = await gdText();
    await shot('8-gd-noconfig');
    check(/not set up for My PC yet/.test(gt) && /App Store Manager > Google Drive/.test(gt) && !/Sign in with Google/.test(gt), 'no Google client anywhere: says an App Store manager adds it in the App Store Manager > Google Drive');
    // the client of every My PC: Firestore settings/google (App Store Manager > Google Drive)
    db.settings = { google: { tvClientId: 'cid.apps.googleusercontent.com', tvClientSecret: 'sec', pickerClientId: 'web.apps.googleusercontent.com', pickerApiKey: 'PKEY', projectNumber: '123' } };
    await page.evaluate(() => { localStorage.removeItem('arc_dev_google_at'); GDrive._reset(); });
    // a profile that linked its account in MyDrive before: taken over once (same Google client), here one Google wants signed in again
    await page.evaluate(() => Store.set('game_app-mydrive_data', { accounts: [{ id: 'g1', email: 'imad@example.com', name: 'Imad', refreshToken: 'RT', needsReauth: true }], active: 'g1' }));
    gt = await gdText();
    const moved = await page.evaluate(() => (Store.get('gdrive', {}).accounts || []).map((a) => a.email + ':' + a.refreshToken).join());
    check(/sign in to imad@example.com again/.test(gt) && /Sign in with Google/.test(gt) && moved === 'imad@example.com:RT', 'the account linked in MyDrive is taken over; Google wants it signed in again: says so, with its address ' + moved);
    await page.evaluate(() => { Store.remove('gdrive'); Store.remove('game_app-mydrive_data'); });
    gt = await gdText();
    check(/Sign in to Google Drive once for/.test(gt) && /Sign in with Google/.test(gt), 'nobody signed in on this profile: one button signs in right here');
    const gcalls = [];
    const jwt = (o) => 'h.' + Buffer.from(JSON.stringify(o)).toString('base64url') + '.s';
    await page.context().route(/^https:\/\/(oauth2|www)\.googleapis\.com\//, async (r) => {
        const u = r.request().url(), body = r.request().postData() || '';
        gcalls.push(r.request().method() + ' ' + u + ' ' + (r.request().headers().authorization || '') + ' ' + body);
        const json = (o, st) => r.fulfill({ status: st || 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(o) });
        if (/device\/code/.test(u)) return json({ device_code: 'DEV1', user_code: 'ABCD-EFGH', verification_url: 'https://www.google.com/device', expires_in: 1800, interval: 5 });
        if (/oauth2.*token/.test(u) && /device_code/.test(body)) return json({ access_token: 'AT1', refresh_token: 'RT', expires_in: 3600, scope: 'openid email profile https://www.googleapis.com/auth/drive.file', id_token: jwt({ sub: 'g1', email: 'imad@example.com', name: 'Imad' }) });
        if (/oauth2/.test(u)) return json({ access_token: 'AT1', expires_in: 3600, scope: 'openid https://www.googleapis.com/auth/drive.file' });
        if (/alt=media/.test(u)) {        // a1: 600 silent MP3 frames; a2: a 60 s WAV sent slowly; by Range like Drive does
            const wavSong = /files\/a2\?/.test(u);
            if (wavSong) await new Promise((ok) => setTimeout(ok, 350));
            const all = wavSong ? Buffer.from(F.wav({ title: 'Long Tone', seconds: 60 })) : Buffer.from(F.mp3({ title: 'Cloud Song', artist: 'Sky', silent: 600 })), m = /bytes=(\d+)-(\d+)/.exec(r.request().headers().range || '');
            const a = m ? +m[1] : 0, b = m ? Math.min(+m[2], all.length - 1) : all.length - 1;
            return r.fulfill({ status: m ? 206 : 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Range', 'Content-Range': 'bytes ' + a + '-' + b + '/' + all.length }, body: all.subarray(a, b + 1) });
        }
        if (/files\?/.test(u)) return json({ files: [{ id: 'f1', name: 'Albums', mimeType: 'application/vnd.google-apps.folder' }, { id: 'a1', name: 'Cloud Song.mp3', mimeType: 'audio/mpeg', size: '5000' }, { id: 'a2', name: 'Long Tone.wav', mimeType: 'audio/wav', size: '1920088' }, { id: 'n1', name: 'notes.txt', mimeType: 'text/plain' }] });
        return r.fulfill({ status: 404, body: '' });
    });
    // Sign in with Google: My PC's sign-in screen over Music (a QR code for google.com/device and the code)
    await page.evaluate(() => [...document.querySelectorAll('.mx-msg button')].find((b) => /Sign in with Google/.test(b.textContent)).click());
    await page.waitForFunction(() => document.querySelector('.gdui-code') && document.querySelector('.gdui-code').textContent === 'ABCD-EFGH', null, { timeout: 5000 }).catch(() => {});
    const sui = await page.evaluate(() => ({ code: (document.querySelector('.gdui-code') || {}).textContent, qr: !!document.querySelector('.gdui-qr svg'), text: (document.querySelector('.gdui') || {}).textContent || '', focus: document.activeElement && document.activeElement.textContent }));
    await shot('8b-gd-signin');
    check(sui.code === 'ABCD-EFGH' && sui.qr && /google\.com\/device/.test(sui.text) && sui.focus === 'Cancel', 'the sign-in screen shows Google\'s code, a QR code for google.com/device, and Cancel has the focus ' + JSON.stringify(sui));
    await page.waitForFunction(() => !DriveUI.screenOpen(), null, { timeout: 12000 }).catch(() => {});
    await page.waitForFunction(() => document.querySelector('.mx-scroll .mx-grid'), null, { timeout: 5000 }).catch(() => {});
    gt = await page.evaluate(() => document.querySelector('.mx-main').textContent);
    const acc = await page.evaluate(() => ({ a: GDrive.active(), saved: Store.get('gdrive', {}), toast: document.getElementById('toast').textContent }));
    check(acc.a && acc.a.email === 'imad@example.com' && acc.saved.accounts[0].refreshToken === 'RT' && acc.saved.accounts[0].cid === 'cid.apps.googleusercontent.com' && /signed in as imad@example.com/.test(acc.toast),
        'once allowed on the phone the profile is signed in (its refresh token saved with the profile, never sent to apps) ' + JSON.stringify(acc.a));
    check(/My Drive/.test(gt) && /All my music files/.test(gt) && /Add files from your phone/.test(gt) && /imad@example.com/.test(gt), 'signed in: My Drive, All my music files and Add files from your phone, as that account: ' + gt);
    await page.evaluate(() => [...document.querySelectorAll('.mx-tile')].find((t) => /^My Drive/.test(t.textContent)).click());
    await page.waitForFunction(() => document.querySelectorAll('.mx-row').length === 2, null, { timeout: 5000 }).catch(() => {});
    const gl = await page.evaluate(() => [...document.querySelectorAll('.mx-scroll .mx-tile, .mx-scroll .mx-row')].map((t) => t.querySelector('.mx-name, .mx-rt').textContent));
    await shot('9-gd-list');
    check(gl.join() === 'Albums,Cloud Song,Long Tone', 'a Drive folder lists folders and songs only: ' + gl);
    check(gcalls.some((c) => /device\/code/.test(c) && /client_id=cid/.test(c) && /drive\.file/.test(c)) && gcalls.some((c) => /device_code=DEV1/.test(c) && /client_secret=sec/.test(c)) && gcalls.some((c) => /drive\/v3\/files\?.*%27root%27%20in%20parents/.test(c) && /Bearer AT1/.test(c)),
        'the sign-in uses the Google client of every My PC (settings/google), then Drive is asked with the token ' + JSON.stringify(gcalls).slice(0, 600));
    await page.evaluate(() => [...document.querySelectorAll('.mx-row')][0].click());
    await page.waitForFunction(() => Music.engineName() || Music.state().error, null, { timeout: 8000 }).catch(() => {});
    const gp = await page.evaluate(() => ({ playing: Music.state().playing, engine: Music.engineName(), error: Music.state().error, stream: Music._streaming(), ms: Music._engines.HTML._src ? Music._engines.HTML._src() : '' }));
    const media = gcalls.filter((c) => /alt=media/.test(c));
    check(gp.playing && gp.engine === 'html' && gp.stream && /^blob:/.test(gp.ms) && !gcalls.some((c) => /access_token=/.test(c)) && media.length && media.every((c) => /Bearer AT1/.test(c)),
        'a Drive song plays at once: read in pieces with the token as a header (Google refuses it in the address) ' + JSON.stringify(gp) + ' ' + media.length + ' piece(s)');
    await page.waitForTimeout(600);
    const ld = await page.evaluate(() => ({ loaded: Music.state().loaded, mini: (document.querySelector('.mx-mini-bar .mx-load') || {}).style ? document.querySelector('.mx-mini-bar .mx-load').style.transform : '' }));
    check(ld.loaded === 1 && /scaleX\(1\)/.test(ld.mini), 'the light grey bar under the progress shows how much of the song has arrived (all of this short one) ' + JSON.stringify(ld));
    // a format the stream cannot take (WAV here; FLAC, M4A, Ogg on the TV): it plays from the first pieces while the rest downloads
    await page.evaluate(() => Music.stop());
    const tClick = Date.now();
    await page.evaluate(() => [...document.querySelectorAll('.mx-row')].find((r) => /Long Tone/.test(r.textContent)).click());
    await page.waitForFunction(() => Music.engineName() === 'html' && Music._grow() === 'piece', null, { timeout: 8000 }).catch(() => {});
    const g1 = await page.evaluate(() => ({ grow: Music._grow(), playing: Music.state().playing, loaded: Music.state().loaded, title: Music.state().title }));
    const startedIn = Date.now() - tClick;
    check(g1.grow === 'piece' && g1.playing && g1.loaded > 0 && g1.loaded < 1, 'a song in another format starts from its first pieces while the rest downloads (' + startedIn + ' ms) ' + JSON.stringify(g1));
    await page.waitForFunction(() => Music._grow() === 'whole', null, { timeout: 15000 }).catch(() => {});
    const p1 = await page.evaluate(() => Music.state().pos);
    await page.waitForTimeout(900);
    const g2 = await page.evaluate(() => ({ grow: Music._grow(), playing: Music.state().playing, loaded: Music.state().loaded, pos: Music.state().pos }));
    check(g2.grow === 'whole' && g2.playing && g2.loaded === 1 && g2.pos > p1 && p1 > 0.5, 'once all of it is here the player moves to the whole song at the same place and plays on ' + JSON.stringify(g2) + ' from ' + p1);
    await page.evaluate(() => Music.stop());
    await page.evaluate(() => Music.stop());

    // themes: Now playing follows the profile's theme
    await page.evaluate(() => { Themes.set ? Themes.set('ios') : null; });
    const ios = await page.evaluate(() => { Music.play(); document.querySelector('.mx-nav[data-nav="np"]').click(); const a = document.querySelector('.mx-np-art'); return { th: document.documentElement.className, r: getComputedStyle(a).borderTopLeftRadius }; });
    check(!/th-ios/.test(ios.th) || ios.r === '30px', 'iOS theme: Now playing looks like Apple Music (rounded cover) ' + JSON.stringify(ios));
    await page.evaluate(() => { Music.stop(); Win.close(); });
    check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
    await page.context().close();
}

// After a profile switch the app restarts as that profile (welcome screen): wait for the new desktop.
async function signedIn(page) {
    for (let i = 0; i < 80; i++) {
        await page.waitForTimeout(250);
        try {
            if (await page.evaluate(() => location.search === '' && !document.querySelector('.welcome') && !!document.querySelector('#desk-icons .dicon') && !!window.Welcome)) return true;
        } catch (e) { /* the page is reloading */ }
    }
    return false;
}

// Launch a game, start it, play briefly, quit to menu. Returns the state of the destroyed game.
// One launch/exit through the two pages: desktop -> index.html?play=<id> -> index.html?from=<id>.
async function cycle(page, id, warm) {
    await page.focus(`[data-game="${id}"]`);
    await Promise.all([page.waitForURL(new RegExp('play=' + id)), page.keyboard.press('Enter')]);
    await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'running', null, { timeout: 15000 });
    const noDesktop = await page.evaluate(() => document.querySelectorAll('#desk-icons *, #desktop img').length === 0);
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(warm ? 400 : 150);
    // the destroy() contract, checked directly on the game (the page switch frees it anyway)
    const r = await page.evaluate(() => {
        const api = document.querySelector('iframe').contentWindow.GameAPI, gk = api._gk, ctx = gk.audio && gk.audio.ctx;
        api.destroy();
        return { audio: ctx ? ctx.state : 'closed', running: api._isRunning() };
    });
    await tvMenu(page);
    await Promise.all([page.waitForURL(new RegExp('from=' + id)), page.evaluate(() => { const b = document.querySelectorAll('#pause-items button'); b[b.length - 1].click(); })]);
    await page.waitForSelector(`#desk-icons [data-game="${id}"]`);
    r.noDesktop = noDesktop;
    r.refocused = await page.evaluate((g) => document.activeElement && document.activeElement.getAttribute('data-game') === g, id);
    return r;
}

main().catch((e) => { console.error(e); process.exit(1); });

// 44. Live backgrounds (js/launcher/dynwall.js) and the events (js/core/events.js). MYPC_ONLY=wall runs only these;
// MYPC_SHOTS=<folder> saves a screenshot of each background.
async function wallTests(browser, base) {
    console.log('44. Live backgrounds: Horizon (weather, holidays, big football nights), Earth now; drawn once, stopped under apps; Google holidays, built-in Eid dates, ESPN football');
    const shots = process.env.MYPC_SHOTS;
    const match = (when, home, away, abbr) => ({ date: when, season: { slug: 'league-phase' }, competitions: [{ competitors: [
        { homeAway: 'home', team: { displayName: home, shortDisplayName: home, abbreviation: abbr || home.slice(0, 3).toUpperCase() } },
        { homeAway: 'away', team: { displayName: away, shortDisplayName: away, abbreviation: away.slice(0, 3).toUpperCase() } }] }] });
    const GOOGLE = [['2026-11-06', 'Green March'], ['2026-11-18', 'Independence Day'], ['2026-05-27', 'Eid al-Adha'], ['2026-05-28', 'Eid al-Adha Holiday'],
                    ['2026-07-30', 'Feast of the Throne'], ['2027-01-14', 'Amazigh New Year'], ['2026-12-31', "New Year's Eve"]]
        .map(([d, n]) => ({ summary: n, start: { date: d }, end: { date: d.slice(0, 8) + String(+d.slice(8) + 1).padStart(2, '0') }, description: /Eve/.test(n) ? 'Observance' : 'Public holiday' }));
    // one page per moment (the date is fixed in the page, the timers run)
    async function at(when, db, prep) {
        const page = await newPage(browser, base, db, { tz: 'Africa/Casablanca' });
        await page.clock.setFixedTime(new Date(when));
        await routeHosted(page, { offline: true });
        // db.noSite: My PC's own weekly copy (data/events-ma.json) is missing, so Google itself is asked
        if (db.noSite) await page.route(/data\/events-ma\.json/, (r) => r.fulfill({ status: 404, body: '' }));
        if (prep) await page.addInitScript(prep);
        await page.goto(base + 'index.html');
        await page.waitForSelector('#desk-icons .dicon');
        return page;
    }
    const painted = (page, k) => page.waitForFunction((k) => DynWall._key().indexOf(k) === 0, k, { timeout: 15000 }).then(() => true, () => false);
    // the canvas really has a picture (many different colours), not a flat fill
    const varied = (page) => page.evaluate(() => {
        const c = document.querySelector('#wallpaper .dw-cv'); if (!c || !c.width) return 0;
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, seen = new Set();
        for (let i = 0; i < d.length; i += 4 * 997) seen.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4));
        return seen.size;
    });
    const shot = async (page, name) => { if (shots) { await page.evaluate(() => Notify.clear()); await page.waitForTimeout(200); await page.screenshot({ path: path.join(shots, name + '.png') }); } };
    const cap = (page) => page.evaluate(() => { const c = document.querySelector('#wallpaper .dw-cap'); return c && !c.hidden ? c.textContent : ''; });

    // events.js alone: Google's names map to our ids, the built-in Moroccan dates, the .ics and ESPN readers
    {
        const page = await at('2026-11-05T12:00:00Z', {});
        const r = await page.evaluate(() => {
            const b = Events._builtin(2026), on = (id) => b.filter((e) => e.id === id).map((e) => e.d).join(' ');
            const ics = Events._fromIcs('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20270314\r\nDTEND;VALUE=DATE:20270315\r\nSUMMARY:Eid al-Fitr\r\nDESCRIPTION:Public holiday\r\nEND:VEVENT\r\nEND:VCALENDAR');
            const espn = Events._fromEspn(JSON.stringify({ events: [{ date: '2026-11-07T19:00Z', competitions: [{ competitors: [{ homeAway: 'home', team: { displayName: 'Morocco', abbreviation: 'MAR' } }, { homeAway: 'away', team: { displayName: 'Senegal' } }] }] },
                                                                    { date: '2026-11-07T19:00Z', competitions: [{ competitors: [{ homeAway: 'home', team: { displayName: 'Japan' } }, { homeAway: 'away', team: { displayName: 'Peru' } }] }] }] }), ['fifa.friendly', '']);
            return { fitr: on('eidfitr'), adha: on('eidadha'), mawlid: on('mawlid'), ramadan: on('ramadan'), green: on('greenmarch'), unity: on('unity'), yen: on('yennayer'),
                     names: ['Green March', 'Feast of the Throne', 'Eid al-Adha Holiday', 'Hijra New Year', "The Prophet Muhammad's Birthday", 'Amazigh New Year', 'Anniversary of the Revolution of the King and the People'].map(Events._idOf).join(','),
                     ics: ics && ics[0] && ics[0].id + '@' + ics[0].d, espn: espn.map((e) => e.id + ':' + e.teams.join('-')).join(',') };
        });
        check(r.fitr === '2026-03-20 2026-03-21' && r.adha === '2026-05-27 2026-05-28' && r.mawlid === '2026-08-25' && r.ramadan === '2026-02-18',
              'built-in Islamic days (Umm al-Qura, Intl): Eid al-Fitr 20-21 March 2026, Eid al-Adha 27-28 May 2026, Mawlid 25 August 2026 ' + JSON.stringify(r));
        check(r.green === '2026-11-06' && r.unity === '2026-10-31' && r.yen === '2026-01-14', 'built-in fixed Moroccan holidays (Green March, Unity Day, Amazigh New Year)');
        check(r.names === 'greenmarch,throne,eidadha,hijri,mawlid,yennayer,revolution', 'Google\'s English holiday names map to the backgrounds: ' + r.names);
        check(r.ics === 'eidfitr@2027-03-14' && r.espn === 'morocco:Morocco-Senegal', 'the .ics reader and ESPN reader (a friendly counts only when Morocco plays): ' + r.ics + ' ' + r.espn);
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }

    // the football rules (owner rule 2026-11-09): Champions League semi-finals and final only, Morocco's matches only, Moroccan clubs only in Africa
    {
        const page = await at('2026-11-05T12:00:00Z', {});
        const r = await page.evaluate(() => {
            const m = (h, a, slug, ha) => ({ date: '2027-05-05T19:00Z', season: { slug }, competitions: [{ competitors: [{ homeAway: 'home', team: { displayName: h, abbreviation: ha || '' } }, { homeAway: 'away', team: { displayName: a } }] }] });
            const run = (lg, list) => Events._fromEspn(JSON.stringify({ events: list }), lg).map((e) => e.id + ':' + e.teams.join('-')).join(',');
            return {
                ucl: run(['uefa.champions', 'ucl'], [m('Inter', 'Arsenal', 'league-phase'), m('Lille', 'PSG', 'round-of-16'), m('Bayern', 'Real Madrid', 'quarterfinals'),
                                                     m('Barcelona', 'Liverpool', 'semifinals'), m('Chelsea', 'Milan', 'final')]),
                caf: run(['caf.champions', 'cafcl'], [m('Wydad AC', 'Al Ahly'), m('Esperance', 'Raja Casablanca'), m('Mamelodi Sundowns', 'TP Mazembe'), m('RS Berkane', 'Simba'), m('AS FAR', 'Petro de Luanda')]),
                wc: run(['fifa.world', 'worldcup'], [m('Brazil', 'France'), m('Morocco', 'Spain', '', 'MAR')]),
                afcon: run(['caf.nations', 'afcon'], [m('Senegal', 'Egypt'), m('Nigeria', 'Morocco')])
            };
        });
        check(r.ucl === 'uclsemi:Barcelona-Liverpool,uclfinal:Chelsea-Milan', 'Champions League: only the semi-finals and the final (league phase, last 16, quarter-finals left out): ' + r.ucl);
        check(r.caf === 'cafcl:Wydad AC-Al Ahly,cafcl:Esperance-Raja Casablanca,cafcl:RS Berkane-Simba,cafcl:AS FAR-Petro de Luanda', 'CAF Champions League: only the Moroccan clubs\' matches: ' + r.caf);
        check(r.wc === 'morocco:Morocco-Spain' && r.afcon === 'morocco:Nigeria-Morocco', 'World Cup and AFCON: only Morocco\'s matches: ' + r.wc + ' ' + r.afcon);
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }

    // Horizon on a day with no holiday and no match: the sky of the forecast (no second request), stopped under an app, moving rain only when asked
    {
        const db = {};
        const page = await at('2026-11-05T11:00:00Z', db);
        await page.evaluate(() => Desktop.setWallpaper('dyn_horizon'));
        check(await page.waitForFunction(() => !document.getElementById('tray-wp').hidden, null, { timeout: 3000 }).then(() => true, () => false), 'while it asks for new data, the refresh icon shows next to the clock');
        await shot(page, 'tray-refresh');
        check(await painted(page, 'w,partly,day'), 'Horizon draws the forecast\'s sky (partly cloudy, day): ' + await page.evaluate(() => DynWall._key()));
        check(await page.waitForFunction(() => document.getElementById('tray-wp').hidden, null, { timeout: 4000 }).then(() => true, () => false), 'done: the refresh icon goes away');
        check(await varied(page) > 40, 'the canvas holds a real picture (' + await varied(page) + ' colours)');
        check(db.weather.filter((u) => /api\.open-meteo/.test(u)).length === 1, 'one forecast request for the widget and the background together');
        await shot(page, 'weather-partly-day');
        // under an app: no timer; back on the desktop: it runs again
        await page.evaluate(() => Win.open('calculator'));
        await page.waitForTimeout(100);
        check(await page.evaluate(() => DynWall._timer() === 0), 'an app on screen: the background has no timer (nothing runs)');
        await page.evaluate(() => Win.close());
        await page.waitForTimeout(100);
        check(await page.evaluate(() => DynWall._timer() !== 0), 'back on the desktop: it checks again');
        // rain at night, with the moving layer (3 November: no holiday the day after)
        await page.context().route(/api\.open-meteo\.com/, (r) => { const b = forecastBody(9); Object.assign(b.current, { weather_code: 63, is_day: 0, cloud_cover: 95, time: '2026-11-03T22:00' }); b.daily.sunrise = b.daily.sunrise.map((x) => x.slice(0, 11) + '07:31'); return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) }); });
        await page.clock.setFixedTime(new Date('2026-11-03T22:00:00Z'));
        await page.evaluate(() => { localStorage.removeItem('arc_dev_wxfc'); DynWall.setPref('motion', true); });
        check(await painted(page, 'w,rain,night'), 'rain at night: ' + await page.evaluate(() => DynWall._key()));
        check(await page.evaluate(() => { const f = document.querySelector('#wallpaper .dw-fx'); return !!f && getComputedStyle(f).animationName === 'dw-fall'; }), 'Moving rain and snow on: one sliding layer (CSS transform)');
        await shot(page, 'weather-rain-night');
        // showers by day (imad's report 2026-11-09: rain on the widget, hardly any on the background): the same forecast, a grey sky, rain that is clearly seen and moves
        await page.context().route(/api\.open-meteo\.com/, (r) => { const b = forecastBody(22); Object.assign(b.current, { weather_code: 81, is_day: 1, cloud_cover: 80, time: '2026-11-03T12:00' }); return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) }); });
        await page.clock.setFixedTime(new Date('2026-11-03T12:00:00Z'));
        await page.evaluate(() => { localStorage.removeItem('arc_dev_wxfc'); DynWall.refresh(); });
        check(await painted(page, 'w,showers,day'), 'showers: ' + await page.evaluate(() => DynWall._key()));
        const rainy = await page.evaluate(async () => {
            const t = DynArt.rainTile('showers', 512), d = t.getContext('2d').getImageData(0, 0, 512, 512).data; let lit = 0;
            for (let i = 3; i < d.length; i += 4) if (d[i] > 90) lit++;
            const f = document.querySelector('#wallpaper .dw-fx'), y0 = new DOMMatrix(getComputedStyle(f).transform).m42;
            await new Promise((ok) => setTimeout(ok, 150));
            return { lit, moved: Math.abs(new DOMMatrix(getComputedStyle(f).transform).m42 - y0), widget: Weather.peek().data.now.code };
        });
        check(rainy.lit > 1500 && rainy.moved > 5 && rainy.widget === 81, 'the rain layer is clearly seen (' + rainy.lit + ' bright pixels per tile) and moves (' + rainy.moved.toFixed(0) + ' px in 150 ms); same forecast as the widget');
        await shot(page, 'weather-showers-day');
        // raindrops on the glass: Medium by default, High / Low / Off; Off = no drops at all
        check(/,medium\|/.test(await page.evaluate(() => DynWall._key())), 'raindrops on the glass: Medium by default ' + await page.evaluate(() => DynWall._key()));
        await page.evaluate(() => DynWall.setPref('glass', 'high'));
        check(await painted(page, 'w,showers,day') && /,high\|/.test(await page.evaluate(() => DynWall._key())), 'High: ' + await page.evaluate(() => DynWall._key()));
        await page.evaluate(() => DynWall.setPref('motion', false));
        await page.waitForTimeout(300);
        await shot(page, 'weather-glass-high');
        const lens = await page.evaluate(() => {        // the drops: the same scene drawn with and without them differs in many places
            const W = 480, H = 270, a = document.createElement('canvas'), b = document.createElement('canvas'); a.width = b.width = W; a.height = b.height = H;
            const s = { k: 'rain', phase: 'day', sunT: 0.4, season: 'autumn', temp: 12, seed: 3 };
            DynArt.weather(a.getContext('2d'), W, H, s); DynArt.weather(b.getContext('2d'), W, H, Object.assign({}, s, { glass: 'high' }));
            const da = a.getContext('2d').getImageData(0, 0, W, H).data, db = b.getContext('2d').getImageData(0, 0, W, H).data; let diff = 0;
            for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 30) diff++;
            return diff;
        });
        check(lens > 2000, 'High draws drops over the picture (' + lens + ' pixels changed)');
        await page.evaluate(() => DynWall.setPref('glass', 'off'));
        check(await page.waitForFunction(() => /,\|/.test(DynWall._key()), null, { timeout: 8000 }).then(() => true, () => false), 'Off: no drops ' + await page.evaluate(() => DynWall._key()));
        // game style: the same scene in pixel art (hard edges, short palette)
        await page.evaluate(() => DynWall.setPref('style', 'pixel'));
        check(await page.waitForFunction(() => /\|pixel\|/.test(DynWall._key()), null, { timeout: 8000 }).then(() => true, () => false), 'Game style: ' + await page.evaluate(() => DynWall._key()));
        check(await page.evaluate(() => { const c = document.querySelector('#wallpaper .dw-cv'), d = c.getContext('2d').getImageData(0, 0, 60, 1).data; let runs = 0;
            for (let i = 4; i < d.length; i += 4) if (d[i] !== d[i - 4] || d[i + 1] !== d[i - 3] || d[i + 2] !== d[i - 2]) runs++; return runs <= 12; }), 'pixel art: colours come in blocks');
        await shot(page, 'weather-pixel');
        await page.evaluate(() => DynWall.setPref('style', 'cartoon'));
        await page.evaluate(() => { DynWall.setPref('glass', 'medium'); DynWall.setPref('motion', true); });
        await page.waitForFunction(() => !!document.querySelector('#wallpaper .dw-fx'), null, { timeout: 8000 }).catch(() => {});
        await page.evaluate(() => Win.open('calculator'));
        check(await page.evaluate(() => document.querySelector('#wallpaper .dw-fx').style.animationPlayState === 'paused'), 'the moving layer pauses under an app');
        await page.evaluate(() => { Win.close(); DynWall.setPref('motion', false); });
        await page.waitForTimeout(150);
        check(await page.evaluate(() => !document.querySelector('#wallpaper .dw-fx')), 'off by default / turned off: no moving layer');
        // snow, cold, winter at dusk
        await page.context().route(/api\.open-meteo\.com/, (r) => { const b = forecastBody(-2); Object.assign(b.current, { weather_code: 73, is_day: 1, cloud_cover: 90, time: '2026-11-05T17:50' }); return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) }); });
        await page.clock.setFixedTime(new Date('2026-11-05T17:50:00Z'));
        await page.evaluate(() => { localStorage.removeItem('arc_dev_wxfc'); DynWall.refresh(); });
        check(await painted(page, 'w,snow,dusk'), 'snow at dusk: ' + await page.evaluate(() => DynWall._key()));
        await shot(page, 'weather-snow-dusk');
        await page.context().route(/api\.open-meteo\.com/, (r) => { const b = forecastBody(31); Object.assign(b.current, { weather_code: 95, is_day: 1, cloud_cover: 100, time: '2026-11-05T15:00' }); return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) }); });
        await page.clock.setFixedTime(new Date('2026-11-05T15:00:00Z'));
        await page.evaluate(() => { localStorage.removeItem('arc_dev_wxfc'); DynWall.refresh(); });
        check(await painted(page, 'w,storm,day'), 'thunderstorm: ' + await page.evaluate(() => DynWall._key()));
        await shot(page, 'weather-storm');
        await page.context().route(/api\.open-meteo\.com/, (r) => { const b = forecastBody(36); Object.assign(b.current, { weather_code: 0, is_day: 1, cloud_cover: 0, time: '2026-11-05T13:00' }); return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) }); });
        await page.clock.setFixedTime(new Date('2026-07-05T13:00:00+01:00'));
        await page.evaluate(() => { localStorage.removeItem('arc_dev_wxfc'); DynWall.refresh(); });
        check(await painted(page, 'w,clear,day') && /summer/.test(await page.evaluate(() => DynWall._key())), 'clear, hot, summer: ' + await page.evaluate(() => DynWall._key()));
        await shot(page, 'weather-clear-summer');
        // Show the weather off: the picture of the season (summer = the beach)
        await page.clock.setFixedTime(new Date('2026-08-02T12:00:00+01:00'));
        await page.evaluate(() => DynWall.setPref('weather', false));
        check(await painted(page, 'e,season'), 'Show the weather off: the season\'s picture: ' + await page.evaluate(() => DynWall._key()));
        await shot(page, 'event-summer');
        await page.evaluate(() => DynWall.setPref('weather', true));
        // an old choice (Live weather / Holidays and events) is now Horizon
        await page.evaluate(() => { Store.set('wallpaper', 'dyn_events'); Desktop.paintWallpaper(); });
        check(await page.evaluate(() => DynWall.current() === 'dyn_horizon'), 'a profile that had Live weather or Holidays and events gets Horizon');
        // another background: the canvas is freed
        await page.evaluate(() => Desktop.setWallpaper('bloom'));
        check(await page.evaluate(() => !document.querySelector('#wallpaper .dw-cv') && DynWall.current() === '' && DynWall._timer() === 0), 'another background: canvas removed, no timer');
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }

    // Realistic and My pictures styles (owner request 2026-11-09): a photo per weather (built-in pack, else the profile's own set), with the same rain and glass
    {
        const db = {};
        const svg = (name, c1, c2) => '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + c1 + '"/><stop offset="1" stop-color="' + c2 + '"/></linearGradient></defs>' +
            '<rect width="1920" height="1080" fill="url(#g)"/><path d="M0 760 Q480 640 960 720 T1920 700 V1080 H0Z" fill="#35502f"/><text x="960" y="560" font-size="90" text-anchor="middle" fill="#fff" font-family="sans-serif">' + name + '</text></svg>';
        const page = await at('2026-11-03T12:00:00Z', db, () => { localStorage.setItem('arc_p1_events', JSON.stringify({ country: 'ma', football: false })); });
        await page.route(/wallpapers\/real\/([a-z-]+)\.jpg/, (r) => { const n = /real\/([a-z-]+)\.jpg/.exec(r.request().url())[1]; (db.photos = db.photos || []).push(n);
            return r.continue(); });                                     // the real built-in pack (wallpapers/real)
        await page.context().route(/api\.open-meteo\.com/, (r) => { const b = forecastBody(14); Object.assign(b.current, { weather_code: 63, is_day: 1, cloud_cover: 95, time: '2026-11-03T12:00' }); return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) }); });
        await page.evaluate(() => { localStorage.removeItem('arc_dev_wxfc'); DynWall.setPref('style', 'real'); Desktop.setWallpaper('dyn_horizon'); });
        check(await painted(page, 'p,r:rain-day,rain,day'), 'Realistic: the built-in rain photo ' + await page.evaluate(() => DynWall._key()));
        check((db.photos || []).join() === 'rain-day', 'only that one photo is read ' + (db.photos || []).join());
        check(await page.evaluate(() => DynPhotos.names('partly', 'night').join() === 'clear-night,cloudy-night,clear-day' && DynPhotos.names('showers', 'dusk')[0] === 'rain-day' &&
                                        DynPhotos._nameOf('Rain Day.JPG') === 'rain-day' && DynPhotos._nameOf('holiday.jpg') === ''), 'the photo names and their fallbacks');
        check(await page.evaluate(() => new Promise((ok) => DynPhotos.get('real', 'rain', 'day', (im) => ok(!!im && im.naturalWidth === 1920 && im.naturalHeight === 1080)))), 'the built-in photo is a real 1920x1080 picture');
        await shot(page, 'style-realistic-rain');
        if (shots) for (const [k, ph] of [['storm', 'day'], ['clear', 'night'], ['snow', 'day'], ['fog', 'day'], ['rain', 'night'], ['clear', 'dusk']]) {
            await page.evaluate(([k, ph]) => new Promise((ok) => DynPhotos.get('real', k, ph, (im) => { const c = document.querySelector('#wallpaper .dw-cv'), x = c.getContext('2d');
                DynArt.photo(x, c.width, c.height, im, { k, phase: ph, glass: 'medium', seed: 7 }); ok(); })), [k, ph]);
            await shot(page, 'style-realistic-' + k + '-' + ph);
        }
        // My pictures: two of the 13 found in Google Drive (any case, spaces or _), shrunk to the screen and kept on the TV
        await page.evaluate((pics) => {
            GDrive.status = (cb) => setTimeout(() => cb({ ok: true, code: '' }), 0);
            GDrive.fullAccess = () => true;
            GDrive.list = (o, cb) => { window.__q = o.q; setTimeout(() => cb(null, { files: [{ id: 'a', name: 'Rain_Day.JPG', mimeType: 'image/svg+xml', size: '900' }, { id: 'b', name: 'clear-day.png', mimeType: 'image/svg+xml', size: '900' }, { id: 'c', name: 'cat.jpg', mimeType: 'image/jpeg', size: '9' }] }), 0); };
            GDrive.download = (id, o, cb) => setTimeout(() => cb(null, { buf: new TextEncoder().encode(pics[id]).buffer, type: 'image/svg+xml' }), 0);
        }, { a: svg('my rain', '#30405a', '#7a8aa0'), b: svg('my sun', '#2d7fd6', '#bfe3ff') });
        await page.evaluate(() => { DynWall.setPref('style', 'custom'); Win.open('settings', 'personal'); });
        await page.waitForTimeout(300);
        let txt = await page.textContent('.set-main');
        check(/My pictures/.test(txt) && /rain-day/.test(txt) && /Take my pictures from Google Drive/.test(txt) && /0 \/ 13/.test(txt), 'My pictures: the guide (file names), the count and where to take them from');
        await page.evaluate(() => { const m = document.querySelector('.set-main'); m.scrollTop = 0; });
        await shot(page, 'style-custom-guide');
        await page.evaluate(() => [...document.querySelectorAll('.set-main .set-row')].find((b) => /^Take my pictures from Google Drive$/.test((b.querySelector('.set-row-name') || {}).textContent)).focus());
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => Object.keys(DynPhotos.custom()).length === 2, null, { timeout: 8000 }).catch(() => {});
        check(await page.evaluate(() => Object.keys(DynPhotos.custom()).sort().join() === 'clear-day,rain-day' && /rain-day/.test(window.__q)), 'two pictures taken in, the others left out: ' + await page.evaluate(() => Object.keys(DynPhotos.custom()).join()));
        await page.waitForTimeout(400);
        check(/2 \/ 13/.test(await page.textContent('.set-main')), 'the count says 2 / 13');
        await page.evaluate(() => Win.close());
        check(await painted(page, 'p,c:rain-day'), 'My pictures: your rain picture is used ' + await page.evaluate(() => DynWall._key()));
        await shot(page, 'style-custom-rain');
        await page.evaluate(() => DynPhotos.clear(() => DynWall.refresh()));
        check(await painted(page, 'p,r:rain-day'), 'removed: back to the built-in photo');
        await page.evaluate(() => DynWall.setPref('style', 'cartoon'));
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }

    // the last picture is kept on the TV: the next start shows it at once (no default sky), then checks quietly (owner request 2026-11-09)
    {
        const db = {};
        const page = await at('2026-11-05T20:30:00Z', db, () => { localStorage.setItem('arc_p1_events', JSON.stringify({ country: 'ma', football: false })); });
        await page.evaluate(() => Desktop.setWallpaper('dyn_horizon'));
        check(await painted(page, 'e,greenmarch'), 'Horizon drawn: ' + await page.evaluate(() => DynWall._key()));
        await page.waitForFunction(() => { const l = JSON.parse(localStorage.getItem('arc_dev_dwlast') || 'null'); return l && l.k === DynWall._key(); }, null, { timeout: 6000 }).catch(() => {});
        const last = await page.evaluate(() => JSON.parse(localStorage.getItem('arc_dev_dwlast') || 'null'));
        check(last && last.id === 'dyn_horizon' && last.p === 'p1' && /^data:image\/jpeg/.test(last.img) && last.img.length < 600000 && /Green March/.test(last.t),
              'the picture is kept on the TV (JPEG, ' + (last ? Math.round(last.img.length / 1024) : 0) + ' KB) with its caption');
        // next start: every service slow (4 s); the kept picture and caption are there at once, and nothing is drawn again for the same state
        await page.context().route(/(open-meteo|googleapis|calendar\.google|espn|events-ma\.json)/, async (r) => { await new Promise((ok) => setTimeout(ok, 4000)); r.abort(); });
        await page.reload();
        await page.waitForSelector('#desk-icons .dicon');
        const first = await page.evaluate(() => { const c = document.querySelector('#wallpaper .dw-cv'); const t = document.querySelector('#wallpaper .dw-cap');
            return { last: !!c && c.classList.contains('dw-last') && /^url\("?data:image\/jpeg/.test(c.style.backgroundImage), cap: t && !t.hidden ? t.textContent : '', key: DynWall._key() }; });
        check(first.last && /Tomorrow: Green March Day/.test(first.cap) && first.key === last.k, 'next start: the kept picture and its caption show at once ' + JSON.stringify({ last: first.last, cap: first.cap }));
        await shot(page, 'start-kept-picture');
        await page.waitForTimeout(5000);
        check(await page.evaluate((k) => DynWall._key() === k && document.querySelector('#wallpaper .dw-cv').classList.contains('dw-last'), last.k), 'same day, same state after the check: not drawn again');
        // a profile with another background never gets it
        check(await page.evaluate(() => { const l = JSON.parse(localStorage.getItem('arc_dev_dwlast')); return l.p === 'p1'; }), 'kept for its profile only');
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }

    // Earth now: the globe with day and night, the Moon in its phase, redrawn every 10 minutes at most
    {
        const db0 = {}, page = await at('2026-11-05T17:30:00Z', db0);
        await page.evaluate(() => Desktop.setWallpaper('dyn_astro'));
        check(await painted(page, 'a,'), 'Earth now is drawn');
        const r = await page.evaluate(() => {
            const c = document.querySelector('#wallpaper .dw-cv'), g = c.getContext('2d'), W = c.width, H = c.height, R = Math.min(W, H) * 0.42;
            const px = (x, y) => { const d = g.getImageData(Math.round(x) - 20, Math.round(y) - 20, 40, 40).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return Math.round(s / (d.length / 4)); };
            // 17:30 in Morocco (plain UTC since 2026-09-20): the Sun is over the Americas, so the west (left) of the globe is day, the east (Africa, Europe) is night
            // the light alone: a white day photo and a black night one, drawn the same way
            const t = document.createElement('canvas'); t.width = 400; t.height = 400; const tg = t.getContext('2d');
            const flat = (v) => ({ w: 1, h: 1, d: new Uint8ClampedArray([v, v, v, 255]) });
            DynArt.earth(tg, 400, 400, flat(255), flat(0), null, { lat: 18, lon: -7.6, at: Date.now() });
            const lp = (x, y) => { const d = tg.getImageData(x, y, 1, 1).data; return d[0] + d[1] + d[2]; };
            return { west: lp(200 - 110, 200), east: lp(200 + 110, 200), photo: px(W / 2, H / 2), sun: DynArt.sun(Date.now()) };
        });
        check(r.west > 400 && r.east < 120 && r.photo > 20 && r.sun.lon < -70 && r.sun.lon > -100 && r.sun.lat < -14 && r.sun.lat > -17, 'the day side is lit and the night side is dark (west ' + r.west + ', east ' + r.east + ', Sun over ' + r.sun.lat.toFixed(1) + ', ' + r.sun.lon.toFixed(1) + ')');
        check(await cap(page) === '', 'no text over the Earth (owner request 2026-11-12): "' + await cap(page) + '"');
        // the real clouds: one map asked, drawn on the globe (white over the Atlantic storm by day, city lights hidden by night)
        const cl = await page.evaluate(() => {
            const m = DynWall._clouds(), flat = (v) => ({ w: 1, h: 1, d: new Uint8ClampedArray([v, v, v, 255]) });
            const t = document.createElement('canvas'); t.width = t.height = 400; const tg = t.getContext('2d');
            // seen from over the storm at noon there: white where the storm is, the dark sea (flat 20) without clouds
            const noon = Date.UTC(2026, 10, 5, 13, 20), opts = (c) => ({ lat: 30, lon: -20, at: noon, clouds: c });
            // the mean of the 60 x 60 pixels around the storm (east of the centre: the eye itself is clear)
            const sum = (x, y) => { const d = tg.getImageData(x - 30, y - 30, 60, 60).data; let v = 0; for (let i = 0; i < d.length; i += 4) v += d[i] + d[i + 1] + d[i + 2]; return Math.round(v / 3600); };
            DynArt.earth(tg, 400, 400, flat(20), flat(0), null, opts(m)); const withC = sum(200 + 20, 200), farSea = sum(200 + 150, 200 - 150);
            DynArt.earth(tg, 400, 400, flat(20), flat(0), null, opts(null)); const noC = sum(200 + 20, 200);
            // by night city lights (flat 250) are hidden under the storm
            const night = Date.UTC(2026, 10, 5, 1, 20);
            DynArt.earth(tg, 400, 400, flat(20), flat(120), null, { lat: 30, lon: -20, at: night, clouds: m }); const lightsC = sum(200 + 20, 200);
            DynArt.earth(tg, 400, 400, flat(20), flat(120), null, { lat: 30, lon: -20, at: night, clouds: null }); const lights = sum(200 + 20, 200);
            const saved = JSON.parse(localStorage.getItem('arc_dev_dwclouds') || 'null');
            return { w: m && m.w, h: m && m.h, withC, noC, farSea, lightsC, lights, saved: !!(saved && /^data:image\/jpeg/.test(saved.img)), kb: saved ? Math.round(saved.img.length / 1024) : 0 };
        });
        check(db0.clouds.length === 1 && /images\/(2048x1024|1024x512)\/clouds\.jpg\?h=\d+$/.test(db0.clouds[0]) && cl.w >= 1024 && cl.h === cl.w / 2,
              'one cloud map asked (' + db0.clouds.join(' ') + '), kept as ' + cl.w + 'x' + cl.h);
        check(cl.withC > cl.noC + 80 && cl.lightsC < cl.lights - 25, 'the storm is drawn: white by day (' + cl.withC + ' vs ' + cl.noC + ' without clouds), hiding the city lights by night (' + cl.lightsC + ' vs ' + cl.lights + ')');
        check(cl.saved && cl.kb < 400, 'a copy is kept on the device for restarts and no internet (' + cl.kb + ' KB)');
        // 10 minutes later: drawn again, the map NOT asked again (once an hour at most)
        await page.clock.setFixedTime(new Date('2026-11-05T17:41:00Z'));
        await page.evaluate(() => DynWall.refresh());
        check(await painted(page, 'a,' + Math.floor(Date.parse('2026-11-05T17:41:00Z') / 600000)) && db0.clouds.length === 1, 'redrawn 10 min later from the clouds in memory (asked ' + db0.clouds.length + ' time)');
        await shot(page, 'earth-now');
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }
    // Earth now without internet: the clouds kept on the device are drawn; none at all: the globe without clouds, no error
    {
        const db1 = { noClouds: true };
        const page = await at('2026-11-05T19:00:00Z', db1, () => {
            const c = document.createElement('canvas'); c.width = 64; c.height = 32; const g = c.getContext('2d');
            g.fillStyle = '#000'; g.fillRect(0, 0, 64, 32); g.fillStyle = '#fff'; g.fillRect(20, 6, 20, 10);
            localStorage.setItem('arc_dev_dwclouds', JSON.stringify({ at: Date.parse('2026-11-05T17:00:00Z'), img: c.toDataURL('image/jpeg', 0.9) }));
        });
        await page.evaluate(() => Desktop.setWallpaper('dyn_astro'));
        check(await painted(page, 'a,'), 'drawn with no internet');
        const m = await page.evaluate(() => { const c = DynWall._clouds(); return c ? { w: c.w, white: c.a[Math.round(c.h * 0.35) * c.w + Math.round(c.w * 0.47)], black: c.a[5] } : null; });
        check(db1.clouds.length === 1 && m && m.white > 200 && m.black < 30, 'no internet: the copy on the device is used (' + JSON.stringify(m) + ')');
        await page.evaluate(() => { localStorage.removeItem('arc_dev_dwclouds'); DynWall._cloudsReset(); DynWall.refresh(); });
        await page.waitForTimeout(800);
        check(await page.evaluate(() => DynWall._clouds() === null) && await varied(page) > 20, 'nothing kept and no internet: the globe without clouds');
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }

    // Horizon on holidays and match days
    const nights = { 'uefa.champions': [match('2026-11-05T20:00:00Z', 'Real Madrid', 'Liverpool', 'RMA'), match('2026-11-05T20:00:00Z', 'Inter', 'Arsenal')] };
    {
        // the evening before Green March (Google's calendar, through the Calendar API), football off
        const db = { cal: GOOGLE, espn: nights, noSite: true };
        const page = await at('2026-11-05T20:30:00Z', db, () => { localStorage.setItem('arc_p1_events', JSON.stringify({ country: 'ma', football: false })); });
        await page.evaluate(() => Desktop.setWallpaper('dyn_horizon'));
        check(await painted(page, 'e,greenmarch'), 'the evening before Green March shows it: ' + await page.evaluate(() => DynWall._key()));
        check(/Tomorrow: Green March Day/.test(await cap(page)), 'caption: ' + await cap(page));
        check(db.events.some((u) => /googleapis\.com\/calendar\/v3\/calendars\/en\.ma%23holiday%40group\.v\.calendar\.google\.com/.test(u)) && !db.events.some((u) => /espn/.test(u)),
              'Google\'s Moroccan holiday calendar asked; football off: ESPN never asked');
        check(await page.evaluate(() => Events.source().holidays === 'api'), 'holidays came from Google');
        await shot(page, 'event-greenmarch-eve');
        // football on: a league-phase Champions League night changes nothing
        await page.evaluate(() => { Events.setPrefs({ football: true }); DynWall.refresh(); });
        await page.waitForFunction(() => document.getElementById('tray-wp').hidden && DynWall._key(), null, { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(300);
        check(await page.evaluate(() => DynWall._key().indexOf('e,greenmarch') === 0 && !Events.day(Events.today()).some((e) => e.kind === 'football')),
              'football on: an ordinary Champions League night (league phase) is left out: ' + await page.evaluate(() => DynWall._key()));
        // Arabic, right to left
        await page.evaluate(() => { I18n.setLang('ar'); Desktop.render(); });
        await page.waitForTimeout(300);
        check(/عيد المسيرة الخضراء|المسيرة الخضراء/.test(await cap(page)), 'translated (Arabic): ' + await cap(page));
        await page.evaluate(() => { I18n.setLang('en'); Desktop.render(); });
        // Control Panel > Personalisation: the rows work with the remote
        await page.evaluate(() => Win.open('settings', 'personal'));
        await page.waitForTimeout(200);
        const txt = await page.textContent('.set-main');
        const lists = await page.evaluate(() => [...document.querySelectorAll('.set-wps:not(.set-wps-live) .set-wp:not(.set-th)')].map((b) => b.getAttribute('data-wp')).join() + '|' +
                                                [...document.querySelectorAll('.set-wps-live .set-wp')].map((b) => b.getAttribute('data-wp')).join());
        check(/Live backgrounds/.test(txt) && lists === 'bloom,aurora,sunset,night,aero,hills,dunes,material,lagoon,nightlake,quest|dyn_horizon,dyn_astro',
              'Personalization: the live backgrounds have their own section, Horizon and Earth now ' + lists);
        check(/Horizon: the weather, the holidays and the big football nights/.test(txt) && /Show the weather/.test(txt) && /Weather place and units/.test(txt) && /Moving rain and snow/.test(txt) && /Raindrops on the glass/.test(txt) && /Style/.test(txt) && /Drawn/.test(txt) && /Medium/.test(txt) &&
              /Holidays of/.test(txt) && /Morocco/.test(txt) && /Football nights/.test(txt) && /semi-finals and final only/.test(txt) && /CAF Champions League/.test(txt) && /Show the event’s name/.test(txt),
              'Horizon in use: what it does, the weather, rain and snow, holidays and football options, and the football rules written out');
        await page.evaluate(() => { const m = document.querySelector('.set-main'); m.scrollTop = m.scrollHeight; });
        await shot(page, 'personalize-horizon');
        // Weather place and units opens Control Panel > Widgets > Weather
        await page.evaluate(() => { [...document.querySelectorAll('.set-main .set-row')].find((b) => /Weather place and units/.test(b.textContent)).focus(); });
        await page.keyboard.press('Enter');
        await page.waitForTimeout(200);
        check(/Widgets › Weather/.test(await page.textContent('.set-main .set-title')), 'Weather place and units opens Widgets > Weather: ' + await page.textContent('.set-main .set-title'));
        await page.evaluate(() => { Win.close(); Win.open('settings', 'personal'); });
        await page.waitForTimeout(200);
        // choosing Earth now: its details and its option replace the others, the focus stays on its card
        await page.focus('.set-wps-live .set-wp[data-wp="dyn_astro"]');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(200);
        const txt2 = await page.textContent('.set-main');
        check(await page.evaluate(() => Desktop.wallpaper() === 'dyn_astro' && document.activeElement.getAttribute('data-wp') === 'dyn_astro') &&
              /Earth now: the Earth seen from space/.test(txt2) && /real clouds/.test(txt2) && /EUMETSAT/.test(txt2) && !/Moon’s phase|Holidays of|Moving rain/.test(txt2), 'OK on Earth now: it is used at once, its details and the clouds\' credit show (no title switch any more), focus stays on it');
        await page.focus('.set-wps:not(.set-wps-live) .set-wp[data-wp="aurora"]');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(200);
        check(await page.evaluate(() => Desktop.wallpaper() === 'aurora' && !/Moving rain|Holidays of/.test(document.querySelector('.set-main').textContent) && document.activeElement.getAttribute('data-wp') === 'aurora'),
              'a still background: no live options shown');
        await page.evaluate(() => { Desktop.setWallpaper('dyn_horizon'); Win.close(); });
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }
    {
        // My PC's copy and Google unreachable (on the web: no CORS for the .ics): the built-in dates; Eid al-Adha
        const db = { noSite: true };
        const page = await at('2026-05-27T10:00:00+01:00', db);
        await page.evaluate(() => Desktop.setWallpaper('dyn_horizon'));
        check(await painted(page, 'e,eidadha'), 'Eid al-Adha from the built-in dates when Google cannot be reached: ' + await page.evaluate(() => DynWall._key()));
        check(/Eid al-Adha/.test(await cap(page)) && /Eid Mubarak/.test(await cap(page)), 'caption: ' + await cap(page));
        for (let i = 0; i < 50 && !db.events.some((u) => /calendar\.google\.com\/calendar\/ical\//.test(u)); i++) await page.waitForTimeout(100);   // My PC's own copy is asked first
        check(db.events.some((u) => /calendar\.google\.com\/calendar\/ical\//.test(u)), 'after the API, the public .ics was tried');
        await shot(page, 'event-eid-adha');
        await page.evaluate(() => DynWall.setPref('weather', false));       // the season's picture on other days
        for (const [when, id, name] of [['2026-07-30T12:00:00+01:00', 'throne', 'event-throne'], ['2026-01-14T12:00:00+01:00', 'yennayer', 'event-yennayer'],
                                         ['2026-03-01T21:00:00+01:00', 'ramadan', 'event-ramadan'], ['2026-08-25T12:00:00+01:00', 'mawlid', 'event-mawlid'],
                                         ['2026-12-31T22:00:00Z', 'nye', 'event-new-year-eve'],
                                         ['2026-11-18T12:00:00Z', 'independence', 'event-independence'], ['2026-10-12T12:00:00Z', 'season', 'event-autumn']]) {
            await page.clock.setFixedTime(new Date(when));
            await page.evaluate(() => DynWall.refresh());
            check(await painted(page, 'e,' + id), when.slice(0, 10) + ': ' + await page.evaluate(() => DynWall._key()) + ' ' + await cap(page));
            await shot(page, name);
        }
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }
    {
        // Morocco plays today (a friendly) beats a Champions League semi-final
        const semi = (when, h, a) => Object.assign(match(when, h, a), { season: { slug: 'semifinals' } });
        const db = { cal: GOOGLE, espn: { 'fifa.friendly': [match('2026-11-12T20:00:00Z', 'Morocco', 'Senegal', 'MAR')], 'uefa.champions': [semi('2026-11-12T20:00:00Z', 'Barcelona', 'Bayern'), semi('2026-11-13T20:00:00Z', 'Chelsea', 'Milan')],
                                         'caf.champions': [match('2026-11-14T19:00:00Z', 'Wydad AC', 'Al Ahly'), match('2026-11-14T19:00:00Z', 'Esperance', 'TP Mazembe')] } };
        const page = await at('2026-11-12T15:00:00Z', db);
        await page.evaluate(() => Desktop.setWallpaper('dyn_horizon'));
        check(await painted(page, 'e,morocco'), 'Morocco\'s match: ' + await page.evaluate(() => DynWall._key()));
        check(/Morocco plays today/.test(await cap(page)) && /Morocco – Senegal\s+(20:00|8:00 PM)/.test(await cap(page)), 'caption with the kick-off in local time: ' + await cap(page));
        await shot(page, 'event-morocco-match');
        await page.clock.setFixedTime(new Date('2026-11-13T15:00:00Z'));
        await page.evaluate(() => DynWall.refresh());
        check(await painted(page, 'e,uclsemi') && /Champions League semi-final/.test(await cap(page)) && /Chelsea – Milan/.test(await cap(page)), 'a Champions League semi-final: ' + await cap(page));
        await shot(page, 'event-ucl-semi');
        await page.clock.setFixedTime(new Date('2026-11-14T15:00:00Z'));
        await page.evaluate(() => DynWall.refresh());
        check(await painted(page, 'e,cafcl') && /CAF Champions League/.test(await cap(page)) && /Wydad AC – Al Ahly/.test(await cap(page)) && !/Esperance/.test(await cap(page)), 'a Moroccan club in the CAF Champions League (other matches left out): ' + await cap(page));
        await shot(page, 'event-caf-wydad');
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }
}

// 45. Opening and quitting (owner's question 2026-11-09): the menu's "Quit", an app under My PC's menu gets no input and is held
// still, a page change reuses the copy picked at start (no server wait), Quit does not read the store again. MYPC_ONLY=flow.
// MYPC_SHOTS=<folder> saves screenshots; the switch times with and without the saved pick are printed.
async function flowTests(browser, base) {
    console.log('45. Open / Quit: "Quit" in 4 languages, no input to a paused app, it is held still, fast page changes');
    const shots = process.env.MYPC_SHOTS;
    const APP = 'https://apps.example.test/flow/';
    const mkdoc = (id, order, mode) => ({ id, name: 'Flow ' + id, description: 'x', url: APP, entry: APP + 'index.html?mode=' + mode, icon: '', type: 'game', version: '1.0.0', enabled: true, order, config: {} });
    const db = { apps: { 'flow-good': mkdoc('flow-good', 0, 'good'), 'flow-bare': mkdoc('flow-bare', 1, 'bare') } };
    // a tiny WAV (1 s of silence) for the <audio> the app plays
    const wav = (() => { const n = 8000, b = Buffer.alloc(44 + n); b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40); b.fill(128, 44); return b; })();
    const APPHTML = `<!doctype html><meta charset=utf-8><body style="background:#246;color:#fff;font:40px sans-serif"><div id=t>app</div><script src="${OLD_HOSTED}sdk/mypc-sdk.js"></script><script>
        var mode = (/mode=(\\w+)/.exec(location.search) || [])[1]; window.keys = []; window.frames_ = 0; window.inputs = [];
        document.addEventListener('keydown', function (e) { keys.push(e.keyCode); });
        window.addEventListener('keydown', function (e) { keys.push('w' + e.keyCode); });
        var ac = new AudioContext(); window.ac = ac;
        var au = new Audio('s.wav'); au.loop = true; window.au = au;
        var stop = false, loop = function () { frames_++; document.getElementById('t').textContent = 'frame ' + frames_; if (!stop) requestAnimationFrame(loop); };
        var h = { onInit: function () { MyPC.ready(); }, onStart: function () { requestAnimationFrame(loop); au.play(); },
                  onInput: function (a, p) { inputs.push(a + (p ? '+' : '-')); } };
        if (mode === 'good') { h.onPause = function () { window.paused = 1; }; h.onResume = function () { window.paused = 0; }; }
        MyPC.init(h);
    <\/script>`;
    const pg = await newPage(browser, base, db);
    const hostedHits = [];
    // the hosted copy (a newer build), 250 ms away like a TV on Wi-Fi
    await pg.route(HOSTED + '**', async (route) => {
        const rel = route.request().url().slice(HOSTED.length).split('?')[0];
        if (rel === 'app-manifest.json') hostedHits.push(Date.now());
        await new Promise((x) => setTimeout(x, 250));
        if (rel === 'app-manifest.json') {
            const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'app-manifest.json'), 'utf8'));
            return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(Object.assign(m, { build: NEXT })) });
        }
        const p = path.join(ROOT, rel);
        if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) return route.fulfill({ status: 404, body: '' });
        return route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'max-age=600' }, contentType: TYPES[path.extname(p)] || 'application/octet-stream', body: fs.readFileSync(p) });
    });
    await pg.route(OLD_HOSTED + 'sdk/mypc-sdk.js', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(ROOT, 'sdk/mypc-sdk.js')) }));
    await pg.context().route(APP + '**', (r) => {
        const rel = r.request().url().slice(APP.length).split('?')[0] || 'index.html';
        if (rel === 's.wav') return r.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Access-Control-Allow-Origin': '*' }, body: wav });
        return r.fulfill({ status: 200, contentType: 'text/html', headers: { 'Access-Control-Allow-Origin': '*' }, body: APPHTML });
    });
    // a controller the app reads itself (navigator.getGamepads inside its frame)
    await pg.context().addInitScript(() => { if (window.top === window) return; const pad = { index: 0, id: 'Test pad', connected: true, mapping: 'standard', buttons: [{ pressed: true, value: 1 }, { pressed: false, value: 0.2 }, { pressed: false, value: 0.3 }, { pressed: false, value: 0.4 }], axes: [0, 0] }; navigator.getGamepads = () => [pad, null, null, null]; });
    await pg.addInitScript(() => { if (!localStorage.getItem('arc_dev_installed')) localStorage.setItem('arc_dev_installed', JSON.stringify([{ id: 'flow-good', at: 1 }, { id: 'flow-bare', at: 1 }])); });

    const t0 = Date.now();
    await pg.goto(base + 'index.html');
    await pg.waitForSelector('#desk-icons [data-game="app-flow-good"]', { timeout: 15000 });
    const startMs = Date.now() - t0;
    check(hostedHits.length === 1 && await pg.evaluate((n) => AppBoot.build() === n, NEXT), 'a real start asks the server once and runs the newer hosted build');
    const appsReads = () => pg.fs.log.filter((l) => l === 'GET /apps').length;
    const reads0 = appsReads();

    const open = async (id, forget) => {
        if (forget) await pg.evaluate(() => Object.keys(sessionStorage).filter((k) => k === 'boot_pick' || /^arc_(games|sync)_/.test(k)).forEach((k) => sessionStorage.removeItem(k)));   // as before build 136 / package 1.6.2
        const hits = hostedHits.length, t = Date.now();
        await pg.focus(`#desk-icons [data-game="app-${id}"]`);
        await Promise.all([pg.waitForURL(new RegExp('play=app-' + id)), pg.keyboard.press('Enter')]);
        await pg.waitForFunction(() => window.GameHost && window.GameHost.state() === 'running', null, { timeout: 15000 });
        const ms = Date.now() - t;
        const f = pg.frames().find((x) => x.url().indexOf(APP) === 0);
        await f.waitForFunction(() => window.MyPC && MyPC.info() && window.frames_ > 3);
        return { f, ms, asked: hostedHits.length - hits };
    };
    const quit = async (id, forget) => {
        if (forget) await pg.evaluate(() => Object.keys(sessionStorage).filter((k) => k === 'boot_pick' || /^arc_(games|sync)_/.test(k)).forEach((k) => sessionStorage.removeItem(k)));
        const hits = hostedHits.length;
        await tvMenu(pg);
        await pg.waitForFunction(() => !document.getElementById('pause').hidden);
        const t = Date.now();
        await Promise.all([pg.waitForURL(new RegExp('from=app-' + id)), pg.evaluate(() => { const b = document.querySelectorAll('#pause-items button'); b[b.length - 1].click(); })]);
        await pg.waitForSelector(`#desk-icons [data-game="app-${id}"]`, { timeout: 15000 });
        await pg.waitForFunction(() => window.Desktop && document.activeElement && document.activeElement.getAttribute('data-game'));
        if (process.env.FLOW_DEBUG) console.log('       quit breakdown', JSON.stringify(await pg.evaluate(() => { const r = performance.getEntriesByType('resource'); const scripts = r.filter((x) => x.initiatorType === 'script'); return { now: Math.round(performance.now()), files: r.length, lastScriptEnd: Math.round(Math.max(...scripts.map((x) => x.responseEnd))), cached: r.filter((x) => x.transferSize === 0).length }; })));
        return { ms: Date.now() - t, asked: hostedHits.length - hits };
    };

    // an app with onPause / onResume
    let o = await open('flow-good');
    const f = o.f;
    check(o.asked === 0 && await pg.evaluate((n) => AppBoot.build() === n, NEXT), `opening an app: no server round trip, same hosted build as the desktop (${o.ms} ms)`);
    check(await f.evaluate(() => navigator.getGamepads()[0] && navigator.getGamepads()[0].id === 'Test pad' && !au.paused), 'running: the app reads its pad and plays its sound');
    // My PC's menu > App settings (owner request 2026-11-12): per user; "Read the controllers directly" = Blocked hides the pads from the app
    const menuOpen = async () => { await tvMenu(pg); await pg.waitForFunction(() => !document.getElementById('pause').hidden); await pg.waitForTimeout(650); };
    const menuItems = () => pg.evaluate(() => [...document.querySelectorAll('#pause-items button')].map((b) => b.textContent));
    const menuClick = (id) => pg.evaluate((id) => document.querySelector('#pause-items [data-id="' + id + '"]').click(), id);
    await menuOpen();
    const mainItems = await menuItems();
    await menuClick('_appset');
    const setItems = await menuItems();
    const setText = await pg.evaluate(() => document.getElementById('pause').innerText);
    check(mainItems.indexOf('App settings') === mainItems.length - 2 && setItems.join('|') === 'Run in the background: Off|Read the controllers directly: Allowed|Every button goes to the app: On|Notifications: Shown|Back'
          && /Flow flow-good, for .+ only/.test(setText) && /keeps running when you switch/.test(setText),
        'My PC\'s menu has App settings (before Quit): background, read the controllers directly, every button, notifications, for this user only (' + setItems.join(' | ') + ')');
    await menuClick('_s_direct');
    await menuClick('_s_bg');
    if (shots) await pg.screenshot({ path: path.join(shots, 'appset-1-menu.png') });
    const prefs1 = await pg.evaluate(() => ({ p: Store.get('app_prefs', {})['app-flow-good'], items: [...document.querySelectorAll('#pause-items button')].map((b) => b.textContent), tag: document.getElementById('pause-bg').textContent }));
    check(prefs1.p && prefs1.p.direct === false && prefs1.p.bg === true && prefs1.items[0] === 'Run in the background: On' && prefs1.items[1] === 'Read the controllers directly: Blocked' && /on/i.test(prefs1.tag) && prefs1.items.indexOf('Back to the default settings') >= 0,
        'toggling them saves this user\'s app_prefs (direct: false, bg: true); the menu\'s Background tag follows ' + JSON.stringify(prefs1));
    await pg.keyboard.press('Escape');
    await pg.waitForTimeout(100);
    check((await menuItems())[0] === 'Resume' && await pg.evaluate(() => !document.getElementById('pause').hidden), 'Back in App settings goes back to the menu (not to the app)');
    await menuClick('_resume');
    await pg.waitForFunction(() => GameHost.state() === 'running');
    await f.waitForTimeout(100);
    check(await f.evaluate(() => navigator.getGamepads().filter(Boolean).length === 0), 'Blocked: navigator.getGamepads() gives the app no controller, even while it runs');
    await menuOpen(); await menuClick('_appset'); await menuClick('_s_direct'); await menuClick('_s_bg'); await menuClick('_s_back'); await menuClick('_resume');
    await pg.waitForFunction(() => GameHost.state() === 'running');
    await f.waitForTimeout(100);
    check(await f.evaluate(() => navigator.getGamepads()[0] && navigator.getGamepads()[0].buttons[0].value === 1) && await pg.evaluate(() => !Store.get('app_prefs', {})['app-flow-good']),
        'Allowed again: the app reads its pad (nothing left in app_prefs once every setting is back to its default)');
    // the button map reaches the app's own navigator.getGamepads() too (same object every call)
    await pg.evaluate(() => { window.__tp = { index: 0, id: 'Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)', connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })) };
        window.__realGp = navigator.getGamepads; navigator.getGamepads = () => [window.__tp, null, null, null]; window.dispatchEvent(new Event('gamepadconnected'));
        Input.setPadMap('057e:2009', [3, 2, 1, 0]); });
    await f.waitForFunction(() => navigator.getGamepads()[0].buttons[0].value === 0.4, null, { timeout: 3000 }).catch(() => {});
    const mapped = await f.evaluate(() => { const a = navigator.getGamepads()[0], b = navigator.getGamepads()[0]; return { v: [0, 1, 2, 3].map((i) => a.buttons[i].value), id: a.id, same: a === b, n: a.buttons.length }; });
    check(mapped.v.join() === '0.4,0.3,0.2,1' && mapped.id === 'Test pad' && mapped.same && mapped.n === 4, 'the player\'s button map (Control Panel > Gaming) is applied to the app\'s own navigator.getGamepads() ' + JSON.stringify(mapped));
    await pg.evaluate(() => { Input.setPadMap('057e:2009', null); navigator.getGamepads = window.__realGp; window.dispatchEvent(new Event('gamepaddisconnected')); });
    await f.waitForFunction(() => navigator.getGamepads()[0].buttons[0].value === 1, null, { timeout: 3000 }).catch(() => {});
    check(await f.evaluate(() => navigator.getGamepads()[0].buttons[0].value === 1), 'map removed: the app reads the pad as it is again');
    await f.evaluate(() => document.getElementById('t').click());          // a click puts the focus inside the app's frame (a PC)
    await tvMenu(pg);
    await pg.waitForFunction(() => !document.getElementById('pause').hidden);
    const menu = await pg.evaluate(() => [...document.querySelectorAll('#pause-items button')].map((b) => b.textContent));
    check(menu[menu.length - 1] === 'Quit' && menu.indexOf('Quit to menu') < 0, 'the menu says "Quit" ' + JSON.stringify(menu));
    if (shots) await pg.screenshot({ path: path.join(shots, 'flow-menu-quit.png') });
    check(await pg.evaluate(() => { const fr = GameHost.frame(); return fr.hasAttribute('inert') && document.activeElement !== fr; }), 'paused: the app\'s frame is inert and does not have the focus');
    const k0 = await f.evaluate(() => { inputs.length = 0; return keys.length; });
    await pg.keyboard.press('ArrowDown');                                   // moves in My PC's menu
    await f.evaluate(() => { document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 39, bubbles: true })); window.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 13 })); });
    const pausedState = await f.evaluate(() => ({ keys: keys.length, inputs: inputs.length, pads: navigator.getGamepads().filter(Boolean).length, au: au.paused, paused: window.paused }));
    check(pausedState.keys === k0 && pausedState.inputs === 0, 'paused: no key reaches the app\'s own listeners, no action ' + JSON.stringify(pausedState));
    check(pausedState.pads === 0, 'paused: navigator.getGamepads() shows the app no pad');
    check(pausedState.au === true && pausedState.paused === 1, 'paused: onPause ran and the app\'s playing <audio> is paused');
    check(await pg.evaluate(() => document.activeElement && document.activeElement.parentNode.id === 'pause-items' && document.activeElement !== document.querySelector('#pause-items button')), 'the arrow moved in My PC\'s menu instead');
    await pg.evaluate(() => document.querySelector('#pause-items button').click());       // Resume
    await pg.waitForFunction(() => GameHost.state() === 'running');
    await f.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 39, bubbles: true })));
    await f.waitForFunction(() => !au.paused, null, { timeout: 3000 }).catch(() => {});
    check(await f.evaluate((n) => keys.length > n && navigator.getGamepads()[0] && !au.paused && window.paused === 0, k0) && await pg.evaluate(() => !GameHost.frame().hasAttribute('inert')), 'Resume: keys, the pad and the sound come back');
    // owner rule 2026-11-11: only the remote's Back and the controller's Home open My PC's menu. The remote's Guide key (458, between CH + and
    // CH − on a Samsung remote) and F6 leave the app alone; a pad's Home does open it
    await pg.evaluate(() => { for (const c of [458, 117]) { Input.onKey({ keyCode: c, repeat: false, preventDefault() {} }, true); Input.onKey({ keyCode: c, repeat: false, preventDefault() {} }, false); } });
    await pg.waitForTimeout(200);
    const afterGuide = await pg.evaluate(() => GameHost.state());
    await pg.evaluate(() => GameHost.onAction('guide', true, false, 'pad0'));
    await pg.waitForTimeout(200);
    const afterHome = await pg.evaluate(() => GameHost.state());
    check(afterGuide === 'running' && afterHome === 'paused', 'the remote\'s Guide key (between CH + and CH −) and F6 do not open My PC\'s menu over an app; a controller\'s Home does (' + afterGuide + ', ' + afterHome + ')');
    await pg.evaluate(() => document.querySelector('#pause-items button').click());
    await pg.waitForFunction(() => GameHost.state() === 'running');
    o = await quit('flow-good');
    check(o.asked === 0 && appsReads() === reads0, `Quit: back to the desktop without asking the server or reading the store list again (${o.ms} ms)`);

    // an app without onPause (it cannot stop itself): held still under the menu
    o = await open('flow-bare');
    const fb = o.f;
    await fb.evaluate(() => new Promise((r) => setTimeout(r, 300)));
    await tvMenu(pg);
    await pg.waitForFunction(() => !document.getElementById('pause').hidden);
    const a = await fb.evaluate(() => new Promise((r) => setTimeout(() => { const n = frames_; setTimeout(() => r({ n, m: frames_, ac: ac.state, au: au.paused }), 500); }, 100)));
    check(a.n === a.m && a.au, 'no onPause: its frames wait under the menu and its sound stops ' + JSON.stringify(a));
    if (shots) await pg.screenshot({ path: path.join(shots, 'flow-bare-held.png') });
    await pg.evaluate(() => document.querySelector('#pause-items button').click());
    await fb.waitForFunction((n) => frames_ > n + 5, a.m, { timeout: 3000 }).catch(() => {});
    check(await fb.evaluate((n) => frames_ > n + 5 && !au.paused, a.m), 'Resume: it moves and plays again');
    const quick = await quit('flow-bare');

    // the same switches the old way (the loader asks the server at every page change): for the numbers
    const slowOpen = await open('flow-good', true);
    const slowQuit = await quit('flow-good', true);
    check(slowOpen.asked === 1 && slowQuit.asked === 1, 'the old way (before build 136 / package 1.6.2) each switch asks the server again');
    console.log(`       start ${startMs} ms; open ${o.ms} ms / quit ${quick.ms} ms now; ${slowOpen.ms} ms / ${slowQuit.ms} ms the old way (server 250 ms away)`);
    if (shots) await pg.screenshot({ path: path.join(shots, 'flow-desktop-after-quit.png') });

    // the label in every language
    const labels = await pg.evaluate(() => ['en', 'fr', 'es', 'ar'].map((l) => { const was = I18n.lang(); I18n.setLang(l); const t = I18n.t('quit'); I18n.setLang(was); return t; }));
    check(JSON.stringify(labels) === JSON.stringify(['Quit', 'Quitter', 'Salir', 'خروج']), '"Quit" in the 4 languages ' + JSON.stringify(labels));
    check(pg.errors.length === 0, 'no page errors ' + pg.errors.join('; '));
    await pg.context().close();
}

// 47. The focus ring of a desktop icon / Start tile shows whole at every edge (the scrolling box clips anything outside it). MYPC_ONLY=ring.
async function ringTests(browser, base) {
    console.log('47. Focus ring: desktop icons and Start tiles show their whole ring at the left, top and bottom edges');
    const shots = process.env.MYPC_SHOTS;
    const page = await newPage(browser, base, {});
    // the ring of the focused item: drawn, and every side of it inside the box that clips it
    const ring = () => page.evaluate(() => {
        const el = document.activeElement, r = el.getBoundingClientRect(), cs = getComputedStyle(el).boxShadow;
        const m = /(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px/.exec(cs), k = r.width / el.offsetWidth;   // the stage is scaled
        const s = /inset/.test(cs) || !m ? 0 : +m[4] * k;
        let box = el.parentElement; while (box && getComputedStyle(box).overflowX === 'visible' && getComputedStyle(box).overflowY === 'visible') box = box.parentElement;
        const b = box.getBoundingClientRect();
        const cut = { left: b.left - (r.left - s), top: b.top - (r.top - s), right: r.right + s - b.right, bottom: r.bottom + s - b.bottom };
        return { drawn: !!m, cut: Object.keys(cut).filter((x) => cut[x] > 0.5) };
    });
    const say = (r) => r.cut.length ? ' (cut at the ' + r.cut.join(', ') + ')' : '';
    await page.goto(base + 'index.html');
    await page.waitForSelector('#desk-icons .dicon', { timeout: 15000 });
    await page.evaluate(() => { const d = document.getElementById('desk-icons'); while (d.querySelectorAll('.dicon').length < 12) d.appendChild(d.querySelector('.dicon').cloneNode(true)); });   // enough to fill a column and wrap
    const perCol = await page.evaluate(() => { const a = document.querySelectorAll('#desk-icons .dicon'), x = a[0].offsetLeft; let n = 0; while (a[n] && a[n].offsetLeft === x) n++; return n; });
    for (const [i, name] of [[0, 'top-left'], [perCol - 1, 'bottom-left'], [perCol, 'top of column 2']]) {
        await page.evaluate((i) => document.querySelectorAll('#desk-icons .dicon')[i].focus(), i);
        const r = await ring();
        check(r.drawn && r.cut.length === 0, `desktop icon at the ${name}: ring drawn whole${say(r)}`);
        if (shots) await page.screenshot({ path: path.join(shots, 'ring-desktop-' + name.replace(/ /g, '-') + '.png') });
    }
    await page.evaluate(() => Desktop.openStart());
    await page.waitForSelector('#start-pinned .stile', { timeout: 5000 });
    await page.evaluate(() => document.querySelector('#start-pinned .stile').focus());
    const r = await ring();
    check(r.drawn && r.cut.length === 0, `first Start tile: ring drawn whole${say(r)}`);
    if (shots) { await page.waitForTimeout(500); await page.screenshot({ path: path.join(shots, 'ring-start.png') }); }
    // every theme (its class only; nothing saved): the top-left icon and the first Start tile
    const ids = await page.evaluate(() => Themes.LIST.map((t) => t.id));
    for (const id of ids) {
        await page.evaluate((id) => { const h = document.documentElement; Themes.LIST.forEach((t) => h.classList.toggle('th-' + t.id, t.id === id)); }, id);
        const out = [];
        for (const sel of ['#start-pinned .stile', '#desk-icons .dicon']) {
            if (sel[1] === 'd') await page.evaluate(() => Desktop.closeStart());
            await page.evaluate((sel) => document.querySelector(sel).focus(), sel);
            const t = await ring();
            if (t.cut.length) out.push(sel + say(t));
        }
        check(out.length === 0, `theme ${id}: first icon and Start tile not cut` + (out.length ? ' ' + out.join('; ') : ''));
        if (shots && (id === 'win7' || id === 'xp')) await page.screenshot({ path: path.join(shots, 'ring-desktop-' + id + '.png') });
        await page.evaluate(() => Desktop.openStart());
    }
    check(page.errors.length === 0, 'no page errors' + (page.errors.length ? ': ' + page.errors[0] : ''));
    await page.context().close();
}

// 50. Neon night and Quest themes (owner request 2026-11-12): their widgets turn on, the clock beside the weather ticks with the
// desktop's clock, System Monitor draws CPU / RAM / disk rings, Quick launch opens apps, the A / B hints, nothing off screen. MYPC_ONLY=themes.
async function themeTests(browser, base) {
    console.log('50. Neon night and Quest themes: clock + weather card, rings, Quick launch, floating taskbar, button hints');
    const shots = process.env.MYPC_SHOTS;
    const page = await newPage(browser, base, {});
    await page.addInitScript(() => {
        const si = window.tizen.systeminfo;
        si.getTotalMemory = () => 2048 * 1048576; si.getAvailableMemory = () => 1350 * 1048576;
        si.getPropertyValue = (n, ok) => setTimeout(() => ok(n === 'CPU' ? { load: 0.12 } : { units: [{ type: 'INTERNAL', capacity: 8e9, availableCapacity: 2.4e9 }, { type: 'USB_HOST', capacity: 3e10, availableCapacity: 1e10 }] }), 5);
    });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(base + 'index.html');
    await page.waitForSelector('#desk-icons .dicon', { timeout: 15000 });
    check(await page.evaluate(() => !Widgets.conf('sysmon').show && !Widgets.conf('quick').show), 'before: only Weather is on (owner decision)');
    await page.evaluate(() => Themes.set('neon'));
    await page.waitForTimeout(300);
    check(await page.evaluate(() => !Widgets.conf('sysmon').show && !Widgets.conf('quick').show), 'picking a theme never shows a widget (owner rule)');
    await page.evaluate(() => { Widgets.set('sysmon', 'show', true); Widgets.set('quick', 'show', true); });
    await page.waitForFunction(() => document.querySelector('#wdg-weather .wdg-art') && document.querySelectorAll('#wdg-sysmon .wdg-ring').length === 3 && document.querySelectorAll('#wdg-quick .wdg-lb').length === 4, null, { timeout: 8000 });
    // owner request 2026-11-12 (2): no clock in the Weather card with these themes; their own icon pack on the desktop, the taskbar and Start
    const pk = await page.evaluate(() => ({ clock: !!document.querySelector('#wdg-weather .wdg-clock'), icon: document.querySelector('#desk-icons [data-app="explorer"] svg').innerHTML.indexOf('nGpc') >= 0,
        start: document.querySelector('#tb-start svg').innerHTML.indexOf('nGstart') >= 0, tb: document.querySelector('#tb-store svg').innerHTML.indexOf('nGstore') >= 0 }));
    check(!pk.clock && pk.icon && pk.start && pk.tb, 'Neon night: Weather without the clock, its own icons on the desktop, Start and the taskbar ' + JSON.stringify(pk));
    await page.evaluate(() => Widgets.setSetting('weather', 'clock', 'yes'));
    await page.waitForFunction(() => document.querySelector('#wdg-weather .wdg-ck-h'), null, { timeout: 8000 });
    const n = await page.evaluate(() => ({
        cls: document.documentElement.classList.contains('th-neon'), wp: Store.get('wallpaper'),
        on: ['weather', 'sysmon', 'quick'].every((w) => Widgets.conf(w).show),
        time: document.querySelector('#wdg-weather .wdg-ck-h').textContent, date: document.querySelector('#wdg-weather .wdg-ck-d').textContent,
        tray: document.getElementById('tray-time').textContent,
        rings: [...document.querySelectorAll('#wdg-sysmon .wdg-ring')].map((r) => r.textContent),
        tb: (() => { const r = document.getElementById('taskbar').getBoundingClientRect(), s = document.getElementById('stage').getBoundingClientRect(); return { l: r.left - s.left, b: s.bottom - r.bottom, rad: getComputedStyle(document.getElementById('taskbar')).borderRadius }; })(),
        title: getComputedStyle(document.getElementById('desk-title')).clip, label: getComputedStyle(document.getElementById('tb-start'), ':after').content
    }));
    check(n.cls && n.wp === 'nightlake' && n.on, 'Neon night: theme class, its night lake background (widgets turned on by the test) ' + JSON.stringify([n.wp, n.on]));
    check(n.time && n.tray.indexOf(n.time) === 0 && /\d{4}/.test(n.date), 'the Weather card shows the clock and the date, the same time as the taskbar ' + JSON.stringify([n.time, n.tray, n.date]));
    check(n.rings.join() === '12%CPU,34%RAM,70%Disk', 'System Monitor draws rings: CPU 12 %, RAM 34 %, disk 70 % (TV systeminfo) ' + n.rings.join());
    check(n.tb.l > 10 && n.tb.b > 10 && n.tb.rad === '46px' && /My PC/.test(n.label), 'the taskbar floats (gaps all round, rounded) with "My PC" beside Start ' + JSON.stringify(n.tb) + n.label);
    // the widgets' clock follows the desktop's clock tick
    await page.evaluate(() => { const o = Date; window.__D = o; Date = function (...a) { return a.length ? new o(...a) : new o(2026, 10, 12, 21, 7, 0); }; Date.now = o.now; Date.prototype = o.prototype; Desktop.tick(); });
    const tk = await page.evaluate(() => [document.querySelector('#wdg-weather .wdg-ck-h').textContent, document.getElementById('tray-time').textContent]);
    await page.evaluate(() => { Date = window.__D; Desktop.tick(); });
    check(tk[1].indexOf(tk[0]) === 0 && /^(21|9):07/.test(tk[0]), 'the clock beside the weather changes with the desktop\'s minute tick ' + JSON.stringify(tk));
    // nothing of the desktop under the taskbar or off screen
    const fit = await page.evaluate(() => {
        const s = document.getElementById('stage').getBoundingClientRect(), tb = document.getElementById('taskbar').getBoundingClientRect(), out = [];
        document.querySelectorAll('#desk-widgets .wdg, #desk-title').forEach((e) => { const r = e.getBoundingClientRect(); if (r.bottom > tb.top + 1 || r.right > s.right || r.left < s.left || r.top < s.top) out.push(e.id || e.className); });
        return out;
    });
    check(fit.length === 0, 'Neon night: the title and the widgets stay above the taskbar, on screen ' + fit.join());
    // Quick launch: the remote reaches its buttons, OK opens the app
    await page.evaluate(() => document.querySelector('#wdg-quick [data-b="music"]').focus());
    await page.evaluate(() => document.querySelector('#wdg-quick [data-b="store"]').click());
    check(await page.waitForFunction(() => Win.current() === 'store', null, { timeout: 5000 }).then(() => true, () => false), 'Quick launch: OK on App Store opens it');
    if (shots) { await page.waitForTimeout(600); await page.screenshot({ path: path.join(shots, 'neon-2-window.png') }); }
    await page.evaluate(() => Win.close());
    await page.evaluate(() => Desktop.openStart());
    if (shots) { await page.waitForTimeout(300); await page.screenshot({ path: path.join(shots, 'neon-3-start.png') }); }
    await page.evaluate(() => Desktop.closeStart());
    // the Weather setting "Show the clock": off hides it even with this theme
    await page.evaluate(() => Widgets.setSetting('weather', 'clock', 'no'));
    await page.waitForFunction(() => !document.querySelector('#wdg-weather .wdg-clock'), null, { timeout: 5000 });
    await page.evaluate(() => Widgets.setSetting('weather', 'clock', 'auto'));
    if (shots) { await page.waitForTimeout(600); await page.evaluate(() => Notify.clear()); await page.waitForTimeout(500); await page.screenshot({ path: path.join(shots, 'neon-1-desktop.png') }); }
    // Quest: hidden widgets stay hidden when the theme changes (owner rule 2026-11-12)
    await page.evaluate(() => { Widgets.set('quick', 'show', false); Themes.set('quest'); });
    check(await page.evaluate(() => !Widgets.conf('quick').show && !document.getElementById('wdg-quick') && Widgets.conf('sysmon').show), 'changing the theme keeps a hidden widget hidden');
    await page.evaluate(() => Widgets.set('quick', 'show', true));
    await page.waitForFunction(() => document.querySelectorAll('#wdg-sysmon .wdg-ring').length === 3, null, { timeout: 8000 });
    check(await page.evaluate(() => document.querySelector('#desk-icons [data-app="explorer"] svg').innerHTML.indexOf('#ffcc4d') >= 0 && !document.querySelector('#wdg-weather .wdg-clock')), 'Quest: its own icon pack (gold emblems), no clock in Weather');
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    const q = await page.evaluate(() => ({
        cls: document.documentElement.className.split(' ').filter((c) => c.indexOf('th-') === 0).join(), wp: Store.get('wallpaper'),
        hints: [...document.querySelectorAll('#th-hints b')].map((b) => b.textContent).join(''), hintTxt: document.getElementById('th-hints').textContent,
        hintsBox: (() => { const r = document.getElementById('th-hints').getBoundingClientRect(), s = document.getElementById('stage').getBoundingClientRect(); return r.right <= s.right && r.left >= s.left && r.width > 100; })(),
        start: getComputedStyle(document.getElementById('tb-start')).backgroundColor, dtitle: getComputedStyle(document.getElementById('desk-title')).clip
    }));
    check(q.cls === 'th-quest' && q.wp === 'quest' && q.start === 'rgb(255, 204, 77)', 'Quest: theme class, its background, the gold Start tab ' + JSON.stringify([q.cls, q.wp, q.start]));
    check(q.hints === 'AAB' && /Open/.test(q.hintTxt) && /Back/.test(q.hintTxt) && q.hintsBox, 'Quest: the button hints use A and B (A = Open, hold A = more, B = Back), on screen ' + q.hintTxt);
    if (shots) { await page.evaluate(() => document.querySelector('#desk-icons .dicon').focus()); await page.evaluate(() => Notify.clear()); await page.waitForTimeout(700); await page.screenshot({ path: path.join(shots, 'quest-1-desktop.png') }); }
    await page.evaluate(() => Desktop.openStart());
    if (shots) { await page.waitForTimeout(300); await page.screenshot({ path: path.join(shots, 'quest-2-start.png') }); }
    await page.evaluate(() => Desktop.closeStart());
    await page.evaluate(() => document.querySelector('#wdg-quick [data-b="music"]').click());
    if (shots) { await page.waitForTimeout(800); await page.evaluate(() => Notify.clear()); await page.screenshot({ path: path.join(shots, 'quest-5-window.png') }); }
    check(await page.waitForFunction(() => document.activeElement && document.activeElement.closest('.mx') && /255, 204, 77/.test(getComputedStyle(document.activeElement).boxShadow), null, { timeout: 5000 }).then(() => true, () => false), 'Quest: MyMusic\'s focused item has the gold Quest focus');
    await page.evaluate(() => { Win.close(); Win.open('settings', 'personal'); });
    await page.waitForSelector('.set-th', { timeout: 5000 });
    if (shots) { await page.waitForTimeout(400); await page.screenshot({ path: path.join(shots, 'quest-3-control-panel.png') }); }
    await page.evaluate(() => Win.close());
    // owner request 2026-11-12 (3): the built-in apps, dialogs and notifications follow the theme too
    const plain = await page.evaluate(() => { Themes.set('win11'); Win.open('settings', 'widgets'); const r = document.querySelector('.set-row');
        return { win: getComputedStyle(document.querySelector('.window')).backgroundImage, row: getComputedStyle(r).backgroundColor }; });
    await page.evaluate(() => Win.close());
    for (const t of ['quest', 'neon']) {
        await page.evaluate((t) => { Themes.set(t); Win.open('settings', 'widgets'); }, t);
        await page.waitForSelector('.set-row', { timeout: 5000 });
        await page.evaluate(() => document.querySelectorAll('.set-row')[1].focus());
        const a = await page.evaluate(() => { const r = document.querySelectorAll('.set-row'); return { win: getComputedStyle(document.querySelector('.window')).backgroundImage,
            row: getComputedStyle(r[0]).backgroundImage, foc: getComputedStyle(r[1]).boxShadow }; });
        check(plain.win === 'none' && /gradient/.test(a.win) && /gradient/.test(a.row) && a.foc !== 'none', t + ': Control Panel (Widgets) has the theme\'s window, rows and focus ' + JSON.stringify([plain, a.win.slice(0, 40), a.row.slice(0, 40), a.foc.slice(0, 40)]));
        if (shots) { await page.waitForTimeout(300); await page.screenshot({ path: path.join(shots, t + '-apps-1-widgets.png') }); }
        await page.evaluate(() => { Win.close(); Win.open('settings'); });
        await page.waitForSelector('.cp-tile', { timeout: 5000 });
        await page.evaluate(() => document.querySelectorAll('.cp-tile')[1].focus());
        if (shots) { await page.waitForTimeout(300); await page.screenshot({ path: path.join(shots, t + '-apps-2-control-panel.png') }); }
        await page.evaluate(() => { Win.close(); Win.open('explorer'); });
        await page.waitForSelector('.fx-item', { timeout: 5000 });
        await page.evaluate(() => document.querySelector('.fx-item').focus());
        check(await page.evaluate(() => /gradient/.test(getComputedStyle(document.querySelector('.window')).backgroundImage) && getComputedStyle(document.querySelector('.fx-item')).boxShadow !== 'none'), t + ': File Explorer follows the theme');
        if (shots) { await page.waitForTimeout(300); await page.screenshot({ path: path.join(shots, t + '-apps-3-explorer.png') }); }
        await page.evaluate(() => { Win.close(); Notify.clear(); });
        await page.waitForTimeout(400);
        await page.evaluate(() => { Notify.show({ title: 'App Store', text: 'Speedy IPTV was installed', kind: 'ok', timeout: 0 });
            Notify.show({ title: 'Weather', text: 'Rain in about 2 hours', kind: 'warn', timeout: 0 }); Notify.show({ title: 'Network', text: 'The TV is offline', kind: 'err', timeout: 0 }); });
        await page.waitForTimeout(600);
        const nt = await page.evaluate(() => { const c = document.querySelector('#toast .nt'); return c && { bg: getComputedStyle(c).backgroundImage, rad: getComputedStyle(c).borderRadius, clip: getComputedStyle(c).clipPath }; });
        check(nt && (t === 'neon' ? /gradient/.test(nt.bg) && nt.rad === '26px' : /polygon/.test(nt.clip)), t + ': notification cards use the theme ' + JSON.stringify(nt && [nt.bg.slice(0, 30), nt.rad, nt.clip.slice(0, 20)]));
        if (shots) await page.screenshot({ path: path.join(shots, t + '-apps-4-notify.png') });
        await page.evaluate(() => { Notify.clear(); App.confirm('Uninstall Speedy IPTV?', 'Its saved games stay in your account.', function () {}); });
        await page.waitForTimeout(300);
        if (shots) await page.screenshot({ path: path.join(shots, t + '-apps-5-dialog.png') });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
    }
    // owner report 2026-11-12: the loading screen of games and apps (the game page builds no desktop) follows the theme too
    for (const t of ['neon', 'quest']) {
        await page.evaluate((t) => Themes.set(t), t);
        await page.route('**/games/jumper/index.html*', (r) => setTimeout(() => r.continue().catch(() => {}), 6000));
        await page.goto(base + 'index.html?play=jumper');
        await page.waitForSelector('#game-loading:not([hidden])', { timeout: 8000 }).catch(() => {});
        const lt = await page.waitForFunction((t) => document.documentElement.classList.contains('th-' + t) && document.querySelector('#game-loading'), t, { timeout: 8000 }).then(() => true, () => false);
        await page.evaluate(() => { document.getElementById('game-loading-fill').style.width = '62%'; });
        check(lt && /gradient/.test(await page.evaluate(() => getComputedStyle(document.getElementById('game-loading')).backgroundImage)), t + ': the game page has the theme, its loading screen follows it');
        if (shots) { await page.waitForTimeout(200); await page.screenshot({ path: path.join(shots, t + '-apps-6-loading.png') }); }
        await page.unrouteAll({ behavior: 'ignoreErrors' });
        await page.goto(base + 'index.html');
        await page.waitForSelector('#desk-icons .dicon', { timeout: 15000 });
    }
    // back to Windows 11: the hints go, the widgets stay as the profile left them, plain look again
    await page.evaluate(() => Themes.set('win11'));
    const w = await page.evaluate(() => ({ hints: !!document.getElementById('th-hints'), rings: document.querySelectorAll('#wdg-sysmon .wdg-ring').length, clock: !!document.querySelector('#wdg-weather .wdg-clock'), bar: !!document.querySelector('#wdg-sysmon .wdg-big') }));
    check(!w.hints && !w.rings && !w.clock && w.bar && await page.evaluate(() => document.querySelector('#desk-icons [data-app="explorer"] svg').innerHTML.indexOf('#ffcc4d') < 0), 'Windows 11 again (its own icons): no hints, System Monitor back to its value + bar, no clock in Weather ' + JSON.stringify(w));
    // Arabic: right to left, the strings translated
    await page.evaluate(() => { I18n.setLang('ar'); Desktop.render(); Themes.set('quest'); });
    await page.waitForTimeout(300);
    const ar = await page.evaluate(() => ({ t: document.getElementById('th-hints').textContent, dir: document.documentElement.dir || document.body.dir, r: (() => { const r = document.getElementById('th-hints').getBoundingClientRect(), s = document.getElementById('stage').getBoundingClientRect(); return r.left - s.left; })() }));
    check(/رجوع|المزيد/.test(ar.t) && ar.r > 1000, 'Quest in Arabic: hints translated, on the right (right to left) ' + JSON.stringify(ar));
    if (shots) await page.screenshot({ path: path.join(shots, 'quest-4-arabic.png') });
    await page.evaluate(() => { I18n.setLang('en'); });
    check(page.errors.length === 0, 'no page errors' + (page.errors.length ? ': ' + page.errors[0] : ''));
    await page.context().close();
}

// 49. Which controller it is (js/core/pad-info.js): Control Panel > Gaming shows its brand / model / button names, and the button
// test lights the name printed on THAT controller (owner report 2026-11-11: a Switch Pro's A lit "B"). MYPC_ONLY=pads.
async function padTests(browser, base) {
    console.log('49. Controllers: brand, model and the names printed on their buttons (Switch Pro, Xbox)');
    const shots = process.env.MYPC_SHOTS;
    const page = await newPage(browser, base, {});
    await page.goto(base + 'index.html');
    await page.waitForSelector('#desk-icons .dicon', { timeout: 15000 });
    const plug = (id) => page.evaluate((id) => {
        window.__gp = { index: 0, id, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })) };
        navigator.getGamepads = () => [window.__gp, null, null, null];
        window.dispatchEvent(new Event('gamepadconnected'));
    }, id);
    const btn = (i, on) => page.evaluate(([i, on]) => { __gp.buttons[i] = { pressed: on, value: on ? 1 : 0 }; }, [i, on]);
    await plug('Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)');
    await page.evaluate(() => Win.open('settings', 'gaming'));
    await page.waitForSelector('.set-row', { timeout: 5000 });
    const txt = await page.evaluate(() => document.querySelector('#win, body').innerText);
    check(/Nintendo Switch Pro Controller/.test(txt) && /Nintendo · Switch Pro Controller/.test(txt) && /B bottom, A right/.test(txt) && /057e:2009/.test(txt) && /Swap A ↔ B and X ↔ Y/.test(txt) && /Automatic \(Off\)/.test(txt) && /A is OK \/ jump and B is Back/.test(txt),
        'Control Panel > Gaming shows the controller: Nintendo Switch Pro Controller, its button names, USB id 057e:2009, nothing swapped on a TV (it sends A first)');
    if (shots) await page.screenshot({ path: path.join(shots, 'pads-1-gaming-switch-pro.png') });
    // on a TV the Switch Pro sends its buttons by LETTER (A = 0, B = 1, X = 2, Y = 3): A = OK, B = Back (owner decision 2026-11-11)
    const held = () => page.evaluate(() => ['jump', 'confirm', 'run', 'cancel'].filter((a) => Input.isDownDev('pad0', a)).sort().join());
    const acts = {};
    for (const [n, i] of [['A', 0], ['B', 1], ['X', 2], ['Y', 3]]) { await btn(i, true); await page.waitForTimeout(80); acts[n] = await held(); await btn(i, false); await page.waitForTimeout(80); }
    check(acts.A === 'confirm,jump' && acts.B === 'cancel,run' && acts.X === 'run' && acts.Y === 'run', 'TV, Switch Pro: A = OK / jump, B = Back / run, X and Y = run (' + JSON.stringify(acts) + ')');
    // the button test: press the Switch Pro's A (button 0 on this TV)
    await page.evaluate(() => { const b = [...document.querySelectorAll('[data-row]')].find((e) => /Test the buttons/.test(e.textContent)); b.focus(); b.click(); });
    await page.waitForSelector('.set-padtest .pt-b', { timeout: 5000 });
    const names = await page.evaluate(() => [...document.querySelectorAll('.pt-b .pt-l')].map((e) => e.textContent));
    check(names.slice(0, 4).join() === 'A,B,X,Y' && names[4] === 'L' && names[7] === 'ZR' && names[9] === '+' && names[16] === 'Home' && names[17] === 'Capture',
        'the test names the Switch Pro\'s buttons A B X Y, L R ZL ZR, − +, Home, Capture (' + names.join(' ') + ')');
    const lights = async (i) => {
        await btn(i, true);
        await page.waitForFunction(() => document.querySelectorAll('.pt-b.on').length === 1, null, { timeout: 3000 }).catch(() => {});
        const r = await page.evaluate(() => ({ on: [...document.querySelectorAll('.pt-b.on .pt-l')].map((e) => e.textContent).join(), last: document.querySelector('.pt-last').textContent }));
        await btn(i, false); await page.waitForTimeout(80);
        return r;
    };
    const la = await lights(0), lb = await lights(1), lx = await lights(2), ly = await lights(3);
    check(la.on === 'A' && /^A \(button 0\): OK, jump$/.test(la.last) && lb.on === 'B' && /^B \(button 1\): Back, run$/.test(lb.last) && lx.on === 'X' && ly.on === 'Y',
        'pressing A lights "A" (OK), B lights "B" (Back), X lights "X", Y lights "Y" (' + JSON.stringify([la, lb, lx, ly]) + ')');
    if (shots) { await btn(0, true); await page.waitForTimeout(150); await page.screenshot({ path: path.join(shots, 'pads-2-test-switch-pro-A.png') }); await btn(0, false); }
    check(await page.evaluate(() => Win.current() === 'settings' && !!document.querySelector('.set-padtest')), 'the controller\'s buttons only test (A / B do not close the page)');
    // the player can force it: "Swap" -> the pad's button 1 is My PC's 0
    await page.evaluate(() => Input.setPadOrder('057e:2009', 'swap'));
    await page.waitForTimeout(100);
    const kb = await lights(0);
    check(kb.on === 'B' && await page.evaluate(() => JSON.parse(localStorage.getItem('arc_dev_padorder'))['057e:2009'] === 'swap'), 'Swap: the pad\'s button 0 now lights B, kept for that controller model (' + JSON.stringify(kb) + ')');
    await page.evaluate(() => Input.setPadOrder('057e:2009', 'auto'));
    // Control Panel > Gaming > Map the buttons (owner request 2026-11-12): My PC asks for each button, the player presses one
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => [...document.querySelectorAll('[data-row]')].some((e) => /Map the buttons/.test(e.textContent)), null, { timeout: 3000 }).catch(() => {});
    await page.evaluate(() => { const b = [...document.querySelectorAll('[data-row]')].find((e) => /Map the buttons/.test(e.textContent)); b.focus(); b.click(); });
    await page.waitForSelector('.set-padmap .pm-ask', { timeout: 5000 });
    const ask = () => page.evaluate(() => ({ ask: document.querySelector('.pm-ask').textContent, sub: document.querySelector('.pm-sub').textContent, last: document.querySelector('.set-padmap .pt-last').textContent }));
    const a0 = await ask();
    check(a0.ask === 'Press the button that should be A' && /^Button 1 of 18 · skipped in \d s$/.test(a0.sub), 'the mapper asks "Press the button that should be A", button 1 of 18 ' + JSON.stringify(a0));
    if (shots) await page.screenshot({ path: path.join(shots, 'pads-4-mapper-ask-A.png') });
    const press = async (i) => { await btn(i, true); await page.waitForTimeout(60); await btn(i, false); await page.waitForTimeout(60); };
    await press(3);                    // A = the pad's button 3
    const a1 = await ask();
    const noAct = await page.evaluate(() => !Input.isDownDev('pad0', 'confirm') && Win.current() === 'settings' && !!document.querySelector('.set-padmap'));
    await press(3);                    // the same button again for B: refused
    const a2 = await ask();
    check(a1.ask === 'Press the button that should be B' && a1.last === 'A = button 3' && noAct && a2.ask === a1.ask && a2.last === 'That button is already A',
        'pressing a button sets it ("A = button 3") without doing anything else; a button already used is refused ' + JSON.stringify([a1, a2]));
    await press(2);
    await page.evaluate(() => { const b = [...document.querySelectorAll('[data-row]')].find((e) => /Skip this button/.test(e.textContent)); b.click(); });   // X: OK on the remote = skip
    await press(0);                    // Y = the pad's button 0
    for (let i = 4; i < 18; i++) await press(i);
    await page.waitForFunction(() => /Map saved/.test(document.querySelector('.pm-ask').textContent), null, { timeout: 3000 }).catch(() => {});
    const saved = await page.evaluate(() => ({ map: JSON.parse(localStorage.getItem('arc_dev_padmap') || '{}')['057e:2009'], order: Input.pads()[0].order.set, ask: document.querySelector('.pm-ask').textContent }));
    check(saved.ask === 'Map saved' && saved.map && saved.map.slice(0, 6).join() === '3,2,1,0,4,5' && saved.map.length === 18 && saved.order === 'custom',
        'the map is saved for that controller model, TV-wide; skipped X takes the button B gave up (1) ' + JSON.stringify(saved));
    if (shots) await page.screenshot({ path: path.join(shots, 'pads-5-mapper-saved.png') });
    await page.waitForTimeout(150);
    await btn(3, true); await page.waitForTimeout(100);
    const mA = await held(); await btn(3, false);          // A = OK: it pressed the focused "Test the buttons"
    await page.waitForSelector('.set-padtest:not(.set-padmap) .pt-b', { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(100);
    const tA = await lights(3), tY = await lights(0);
    check(mA === 'confirm,jump' && tA.on === 'A' && /^A \(button 0\): OK, jump$/.test(tA.last) && tY.on === 'Y', 'with the map the pad\'s button 3 is A (OK, it opened the test) and the test lights A for it, Y for button 0 ' + JSON.stringify([mA, tA, tY]));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    check(/Your own map/.test(await page.evaluate(() => document.body.innerText)), 'Control Panel > Gaming shows "Your own map" for the controller');
    await page.evaluate(() => { const b = [...document.querySelectorAll('[data-row]')].find((e) => /Swap A ↔ B/.test(e.textContent)); b.focus(); });
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);
    check(await page.evaluate(() => !localStorage.getItem('arc_dev_padmap') && Input.pads()[0].order.set === 'auto'), 'choosing Automatic again drops the map: back to the order My PC chooses');
    await page.evaluate(() => { const b = [...document.querySelectorAll('[data-row]')].find((e) => /Test the buttons/.test(e.textContent)); b.focus(); b.click(); });
    await page.waitForSelector('.set-padtest .pt-b', { timeout: 5000 });
    // an Xbox pad: A is the bottom button (0)
    await page.evaluate(() => { navigator.getGamepads = () => [null, null, null, null]; window.dispatchEvent(new Event('gamepaddisconnected')); });
    await plug('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)');
    await page.waitForFunction(() => { const l = document.querySelector('.pt-b .pt-l'); return l && l.textContent === 'A'; }, null, { timeout: 3000 }).catch(() => {});
    await btn(0, true);
    await page.waitForFunction(() => /^A \(button 0\)/.test(document.querySelector('.pt-last').textContent), null, { timeout: 3000 }).catch(() => {});
    const xb = await page.evaluate(() => ({ names: [...document.querySelectorAll('.pt-b .pt-l')].slice(0, 6).map((e) => e.textContent).join(), last: document.querySelector('.pt-last').textContent, title: document.querySelector('.pt-name').textContent }));
    check(xb.title === 'Microsoft Xbox Series X|S Controller' && xb.names === 'A,B,X,Y,LB,RB' && xb.last === 'A (button 0): OK, jump', 'an Xbox pad: A B X Y LB RB, its A (bottom) = OK (' + JSON.stringify(xb) + ')');
    if (shots) await page.screenshot({ path: path.join(shots, 'pads-3-test-xbox-A.png') });
    await btn(0, false);
    // Control Panel > Devices names it too; French strings
    await page.evaluate(() => Win.open('settings', 'devices'));
    await page.waitForTimeout(300);
    check(/Microsoft Xbox Series X\|S Controller · Xbox/.test(await page.evaluate(() => document.body.innerText)) && /A: OK · B: Back · LB \/ RB/.test(await page.evaluate(() => document.body.innerText)),
        'Control Panel > Devices: the controller\'s brand / model and its own button names in the help');
    // Control Panel > Gaming > Settings of each app and game: the same settings as My PC's menu > App settings, per user
    await page.evaluate(() => Win.open('settings', 'gaming'));
    await page.waitForTimeout(300);
    await page.evaluate(() => { const b = [...document.querySelectorAll('[data-row]')].find((e) => /Settings of each app and game/.test(e.textContent)); b.focus(); b.click(); });
    await page.waitForTimeout(200);
    const gl = await page.evaluate(() => [...document.querySelectorAll('[data-row]')].map((e) => e.textContent));
    const gid = await page.evaluate(() => Desktop.games()[0].id), gname = await page.evaluate(() => I18n.pick(Desktop.games()[0].manifest.title));
    check(gl.some((x) => x.indexOf(gname) === 0 && /Default settings/.test(x)), 'Settings of each app and game lists the games with "Default settings" (' + gl.slice(0, 3).join(' | ') + ')');
    await page.evaluate((n) => { const b = [...document.querySelectorAll('[data-row]')].find((e) => e.textContent.indexOf(n) === 0); b.focus(); b.click(); }, gname);
    await page.waitForTimeout(200);
    const one = await page.evaluate(() => [...document.querySelectorAll('[data-row]')].map((e) => e.textContent).join(' | '));
    await page.evaluate(() => { const b = [...document.querySelectorAll('[data-row]')].find((e) => /^Notifications/.test(e.textContent)); b.focus(); b.click(); });
    await page.waitForTimeout(100);
    const q = await page.evaluate((id) => Store.get('app_prefs', {})[id], gid);
    if (shots) await page.screenshot({ path: path.join(shots, 'pads-6-app-settings-cp.png') });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    const gl2 = await page.evaluate(() => [...document.querySelectorAll('[data-row]')].map((e) => e.textContent));
    check(/Run in the background/.test(one) && !/Read the controllers directly/.test(one) && q && q.quiet === true && gl2.some((x) => x.indexOf(gname) === 0 && /Notifications: Hidden/.test(x)),
        'a built-in game\'s page: background + notifications (no direct-controller row: it has no SDK); hiding notifications is saved for this user and shown in the list');
    check(await page.evaluate((id) => { GameHost.resetAppPrefs(id); return !Store.get('app_prefs', {})[id]; }, gid), 'Back to the default settings clears them');
    check(page.errors.length === 0, 'no page errors' + (page.errors.length ? ': ' + page.errors[0] : ''));
    await page.context().close();
    // Chrome on a computer reads a Switch Pro itself, by place (A = button 1): My PC swaps it, so A is OK there too
    const pc = await newPage(browser, base, {}, { desktop: true });
    await pc.goto(base + 'index.html');
    await pc.waitForSelector('#desk-icons .dicon', { timeout: 15000 });
    await pc.evaluate(() => { window.__gp = { index: 0, id: 'Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)', connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })) };
        navigator.getGamepads = () => [window.__gp, null, null, null]; window.dispatchEvent(new Event('gamepadconnected')); });
    await pc.evaluate(() => { __gp.buttons[1] = { pressed: true, value: 1 }; });
    await pc.waitForTimeout(150);
    const pcA = await pc.evaluate(() => ({ acts: ['jump', 'confirm', 'run', 'cancel'].filter((a) => Input.isDownDev('pad0', a)).sort().join(), swap: Input.pads()[0].order.swap }));
    check(pcA.acts === 'confirm,jump' && pcA.swap === true, 'Chrome on a computer: the Switch Pro\'s A (its button 1, by place) is OK / jump too (' + JSON.stringify(pcA) + ')');
    await pc.context().close();
}

// 48. Copies between Google Drive and the USB drives of the TV (js/core/copy-jobs.js, js/core/usb-fs.js, MyPC.usb / MyPC.copy, API 16):
// both ways, whole folders, 4 MB pieces, Google Docs exported, same files skipped, keep both / replace, going on after a page
// change (USB file and Google upload), USB removed, not enough space, the app bridge with its permission. MYPC_ONLY=copy runs only these.
// A fake USB drive (Tizen filesystem with writes) and a fake Google Drive; MYPC_SHOTS=<folder> saves screenshots.
const USB_MOCK = (D) => {
    if (window.top !== window) return;
    const tree = {};          // path -> Uint8Array | true (folder)
    const fsErr = (name, m) => { const e = new Error(m || name); e.name = name; return e; };
    const U = window.__usb = { tree, mounted: true, writes: 0, reads: 0, free: 0, slow: 0, cost: 0 };
    // a slow drive (U.cost ms): the Tizen calls that wait for the drive on the page's own thread
    const wait = () => { if (U.cost) { const t = performance.now() + U.cost; while (performance.now() < t) {} } };
    tree['/opt/media'] = true; tree[D] = true;
    const kids = (p) => Object.keys(tree).filter((k) => k.indexOf(p + '/') === 0 && k.slice(p.length + 1).indexOf('/') < 0).map((k) => k.slice(p.length + 1));
    const live = (p) => U.mounted || p.indexOf(D) !== 0;
    U.put = (p, bytes) => { const parts = p.split('/'); for (let i = 2; i < parts.length; i++) tree[parts.slice(0, i).join('/')] = true; tree[p] = bytes; };
    // the drive keeps its files across page changes: the test hands the last snapshot to the next page
    try {
        const x = new XMLHttpRequest(); x.open('GET', 'https://usb-seed.test/seed', false); x.send();
        const seed = JSON.parse(x.responseText || '{}');
        for (const k in seed) tree[k] = seed[k] === true ? true : Uint8Array.from(atob(seed[k]), (c) => c.charCodeAt(0));
    } catch (e) {}
    U.dump = () => { const o = {}; for (const k in tree) { const v = tree[k]; if (v === true) o[k] = true; else { let s = ''; for (let i = 0; i < v.length; i += 32768) s += String.fromCharCode.apply(null, v.subarray(i, i + 32768)); o[k] = btoa(s); } } return o; };
    U.text = (p) => (tree[p] && tree[p] !== true ? new TextDecoder().decode(tree[p]) : null);
    U.sum = (p) => { const d = tree[p]; if (!d || d === true) return null; let h = 0; for (let i = 0; i < d.length; i++) h = (h * 31 + d[i]) >>> 0; return d.length + ':' + h; };
    window.tizen.systeminfo.getPropertyValueArray = (name, ok) => setTimeout(() => ok(U.mounted ? [{ type: 'INTERNAL', capacity: 8e9, availableCapacity: 4e9 }, { type: 'USB_HOST', capacity: 32e9, availableCapacity: U.free || 16e9, isRemovable: true }] : [{ type: 'INTERNAL', capacity: 8e9, availableCapacity: 4e9 }]), 2);
    window.tizen.filesystem = {
        listStorages: (ok) => setTimeout(() => ok(U.mounted ? [{ label: 'removable_sda1', type: 'EXTERNAL', state: 'MOUNTED' }] : []), 2),
        resolve: (loc, ok, err) => setTimeout(() => (loc === 'removable_sda1' && U.mounted ? ok({ fullPath: loc, toURI: () => 'file://' + D }) : err(fsErr('NotFoundError'))), 2),
        listDirectory: (p, ok, err) => setTimeout(() => (tree[p] === true && live(p) ? ok(kids(p), p) : err(fsErr('NotFoundError'))), 2),
        isDirectory: (p) => { wait(); if (!(p in tree) || !live(p)) throw fsErr('NotFoundError'); return tree[p] === true; },
        isFile: (p) => { if (!(p in tree) || !live(p)) throw fsErr('NotFoundError'); return tree[p] !== true; },
        toURI: (p) => 'file://' + encodeURI(p),
        createDirectory: (p, parents, ok, err) => setTimeout(() => { if (!live(p)) return err(fsErr('NotFoundError')); if (p in tree) return err(fsErr('IOError', 'exists')); U.put(p + '/x', 0); delete tree[p + '/x']; ok(p); }, 2),
        deleteFile: (p, ok, err) => setTimeout(() => { if (tree[p] && tree[p] !== true) { delete tree[p]; ok(); } else err(fsErr('NotFoundError')); }, 2),
        openFile: (p, mode) => {
            wait();
            if (!live(p)) throw fsErr('NotFoundError');
            const dir = p.slice(0, p.lastIndexOf('/'));
            if (mode === 'r') { if (!tree[p] || tree[p] === true) throw fsErr('NotFoundError'); }
            else { if (tree[dir] !== true) throw fsErr('NotFoundError'); if (mode === 'w' || !tree[p]) tree[p] = new Uint8Array(0); }
            let pos = mode === 'a' ? tree[p].length : 0;
            return {
                seek: (o, w) => (pos = w === 'END' ? tree[p].length + o : o),
                readDataNonBlocking: (ok, e, n) => { U.reads++; const r = tree[p].slice(pos, pos + n); pos += r.length; setTimeout(() => ok(r), 2); },
                writeDataNonBlocking: (data, ok, e) => setTimeout(() => {
                    if (!U.mounted) return e(fsErr('IOError', 'Input/output error'));
                    const old = tree[p], b = new Uint8Array(old.length + data.length); b.set(old); b.set(data, old.length); tree[p] = b; pos = b.length; U.writes++; ok();
                }, U.slow || 2),
                close() {}, closeNonBlocking(ok) { setTimeout(() => ok && ok(), 1); }
            };
        },
        addStorageStateChangeListener: () => 1
    };
};
async function copyTests(browser, base) {
    console.log('48. Copies Google Drive <-> USB (MyPC.copy, API 16): folders both ways, 4 MB pieces, Docs exported, skip / keep both / replace, going on after a page change, USB removed, space, the app bridge');
    const D = '/opt/media/USBDriveA1', MB = 1024 * 1024;
    const big = (n, seed) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * 7 + seed) & 255; return b; };
    const sum = (b) => { let h = 0; for (let i = 0; i < b.length; i++) h = (h * 31 + b[i]) >>> 0; return b.length + ':' + h; };
    const APP = 'https://mydrive.example.test/';
    const APP_HTML = `<!doctype html><meta charset=utf-8><title>MyDrive</title><body style="background:#123;color:#fff;font:40px sans-serif"><p id=t>MyDrive (test)</p>
<script src="${OLD_HOSTED}sdk/mypc-sdk.js"></script><script>MyPC.init({ onInit() { MyPC.ready(); window.__ok = 1; } });</script>`;
    const db = { apps: {}, settings: { google: { tvClientId: 'cid.apps.googleusercontent.com', tvClientSecret: 'sec', pickerClientId: 'web.apps.googleusercontent.com', pickerApiKey: 'PKEY', projectNumber: '123' } } };
    db.apps.mydrive = { id: 'mydrive', name: 'MyDrive', url: APP, entry: APP + 'index.html', icon: '', type: 'app', version: '1.2.0', enabled: true, order: 1, config: {} };
    const page = await newPage(browser, base, db);
    const ctx = page.context();
    const film = big(9 * MB + 12345, 3), photo = big(300000, 9), song = big(5 * MB + 7, 5);
    const g = { files: {
        root: { id: 'root', name: 'My Drive', mimeType: 'application/vnd.google-apps.folder', parents: ['none'] },
        h1: { id: 'h1', name: 'Holiday: 2026', mimeType: 'application/vnd.google-apps.folder', parents: ['root'] },
        p1: { id: 'p1', name: 'beach.jpg', mimeType: 'image/jpeg', parents: ['h1'], data: photo },
        v1: { id: 'v1', name: 'Videos', mimeType: 'application/vnd.google-apps.folder', parents: ['h1'] },
        m1: { id: 'm1', name: 'film.mp4', mimeType: 'video/mp4', parents: ['v1'], data: film },
        d1: { id: 'd1', name: 'Plan', mimeType: 'application/vnd.google-apps.document', parents: ['h1'] },
        q1: { id: 'q1', name: 'Survey', mimeType: 'application/vnd.google-apps.form', parents: ['h1'] },
        e1: { id: 'e1', name: 'empty.txt', mimeType: 'text/plain', parents: ['h1'], data: Buffer.alloc(0) } }, quota: { limit: '16000000000', usage: '1000' } };
    await fakeGoogle(ctx, g);
    let usbSeed = {};
    await ctx.route('https://usb-seed.test/seed', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(usbSeed) }));
    const snapshot = async () => { usbSeed = await page.evaluate(() => window.__usb.dump()); };
    await ctx.addInitScript(USB_MOCK, D);
    await page.addInitScript((a) => { if (!localStorage.getItem('arc_dev_installed')) { localStorage.setItem('arc_dev_installed', JSON.stringify([{ id: 'mydrive', at: 1 }])); localStorage.setItem('arc_dev_catalog', JSON.stringify([a])); } }, db.apps.mydrive);
    await routeHosted(page, { offline: true });
    const sdkFile = (f) => (r) => r.fulfill({ status: 200, contentType: 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: fs.readFileSync(path.join(ROOT, 'sdk', f)) });
    await page.route(OLD_HOSTED + 'sdk/mypc-sdk.js', sdkFile('mypc-sdk.js'));
    await ctx.route(APP + '**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: APP_HTML }));
    const shot = async (name) => { if (process.env.MYPC_SHOTS) { await page.waitForTimeout(150); await page.screenshot({ path: path.join(process.env.MYPC_SHOTS, 'copy-' + name + '.png') }); } };
    await page.goto(base + 'index.html');
    await page.waitForSelector('#desk-icons .dicon');
    const signIn = () => page.evaluate(() => Store.set('gdrive', { accounts: [{ id: 'g7', email: 'sara@example.com', name: 'Sara', refreshToken: 'RT-secret', scope: 'https://www.googleapis.com/auth/drive', cid: 'cid.apps.googleusercontent.com', addedAt: 1 }], active: 'g7' }));
    await signIn();
    const waitJob = (id, states, ms) => page.waitForFunction(([id, st]) => { const j = CopyJobs.list().find((x) => x.id === id); return j && st.includes(j.state); }, [id, states], { timeout: ms || 20000 }).catch(() => {});
    const job = (id) => page.evaluate((id) => CopyJobs.list().find((x) => x.id === id), id);
    const start = (o) => page.evaluate((o) => new Promise((res) => CopyJobs.start(o, (e, j) => res(e ? { error: e } : j))), o);

    // --- Drive -> USB: a whole folder; its sub-folder, a 9 MB film in 4 MB pieces, a Google Doc saved as .docx, a form left out
    await page.evaluate((D) => window.__usb.put(D + '/Backup/old.txt', new TextEncoder().encode('old')), D);
    let j = await start({ dir: 'toUsb', items: ['h1'], dest: D + '/Backup' });
    check(j && j.id && j.dir === 'toUsb' && j.dest.name === 'USB A1/Backup', 'CopyJobs.start (Drive -> USB) gives a job at once ' + JSON.stringify(j && (j.error || j.dest)));
    await page.waitForFunction(() => /File \d+ of \d+/.test(document.getElementById('toast').textContent), null, { timeout: 8000 }).catch(() => {});
    const card1 = await page.evaluate(() => [...document.querySelectorAll('#toast .nt')].map((c) => c.textContent).filter((x) => /Copying/.test(x)).join(' | '));
    await shot('1-progress-card');
    await waitJob(j.id, ['done', 'failed']);
    j = await job(j.id);
    const H = D + '/Backup/Holiday_ 2026';
    const usb1 = await page.evaluate(([H]) => ({ film: window.__usb.sum(H + '/Videos/film.mp4'), photo: window.__usb.sum(H + '/beach.jpg'), doc: window.__usb.text(H + '/Plan.docx'),
        empty: window.__usb.tree[H + '/empty.txt'] instanceof Uint8Array, form: Object.keys(window.__usb.tree).some((k) => /Survey/.test(k)), old: window.__usb.text(window.__usb.tree ? H.replace('/Holiday_ 2026', '/old.txt') : '') }), [H]);
    const filmReads = g.calls.filter((c) => /files\/m1\?alt=media/.test(c)).map((c) => c.split(' ').pop());
    check(/Copying to USB A1\/Backup/.test(card1) && /File \d+ of 5/.test(card1), 'a progress card shows while it copies: "Copying to USB A1/Backup · File n of 5 · %" ' + card1);
    check(j.state === 'done' && j.files === 5 && j.doneFiles === 4 && j.failed.length === 1 && /form/.test(j.failed[0].message) && j.progress === 1, 'the job ends done: 4 of 5 files copied, the form is reported as not copyable ' + JSON.stringify([j.state, j.files, j.doneFiles, j.failed]));
    check(usb1.film === sum(film) && usb1.photo === sum(photo) && usb1.empty && /EXPORT Plan as application\/vnd.openxmlformats-officedocument.wordprocessingml.document/.test(usb1.doc) && !usb1.form && usb1.old === 'old',
        'the folder is on the USB drive byte for byte (":" made "_" for FAT), sub-folder included, the Doc as Plan.docx, an empty file, nothing else touched ' + JSON.stringify(usb1));
    check(filmReads.length === 3 && filmReads[0] === 'bytes=0-4194303' && filmReads[2] === 'bytes=8388608-' + (film.length - 1), 'the 9 MB film is read in 4 MB Range pieces, never whole ' + JSON.stringify(filmReads));
    await page.waitForFunction(() => /Copy finished/.test((document.querySelector('#toast') || {}).textContent || ''), null, { timeout: 4000 }).catch(() => {});
    const done1 = await page.evaluate(() => document.getElementById('toast').textContent);
    await shot('2-done-card');
    check(/Copy finished/.test(done1) && /4 files copied to USB A1\/Backup/.test(done1) && /1 could not be copied/.test(done1), 'the card then says what was copied ' + done1);

    // --- the same copy again: everything already there is skipped without reading it again (same size); keep both / replace
    const before = g.calls.length;
    j = await start({ dir: 'toUsb', items: ['h1'], dest: D + '/Backup' });
    await waitJob(j.id, ['done', 'failed']);
    j = await job(j.id);
    check(j.state === 'done' && j.doneFiles === 4 - 1 && j.skipped === 1 && !g.calls.slice(before).some((c) => /alt=media/.test(c)), 'the same copy again: files already on the USB drive with the same size count as copied, nothing is downloaded again (the Doc, exported, is skipped as already there) ' + JSON.stringify([j.doneFiles, j.skipped]));
    await page.evaluate((H) => window.__usb.put(H + '/beach.jpg', new TextEncoder().encode('another picture')), H);
    j = await start({ dir: 'toUsb', items: ['p1'], dest: H, ifExists: 'skip' });
    await waitJob(j.id, ['done']); j = await job(j.id);
    const kept0 = await page.evaluate((H) => window.__usb.text(H + '/beach.jpg'), H);
    check(j.skipped === 1 && kept0 === 'another picture', 'ifExists skip: a different file with the same name is left alone (skipped: 1)');
    j = await start({ dir: 'toUsb', items: ['p1'], dest: H, ifExists: 'keep' });
    await waitJob(j.id, ['done']);
    const kept = await page.evaluate((H) => [window.__usb.text(H + '/beach.jpg'), window.__usb.sum(H + '/beach (2).jpg')], H);
    check(kept[0] === 'another picture' && kept[1] === sum(photo), 'ifExists keep: the copy is "beach (2).jpg", the other file stays');
    j = await start({ dir: 'toUsb', items: ['p1'], dest: H, ifExists: 'replace' });
    await waitJob(j.id, ['done']);
    check(await page.evaluate((H) => window.__usb.sum(H + '/beach.jpg'), H) === sum(photo), 'ifExists replace: the file is overwritten');

    // --- USB -> Drive: a folder with a sub-folder and a 5 MB song, by the resumable upload in 4 MB pieces
    await page.evaluate(([D, song, photo]) => { const b = (a) => Uint8Array.from(atob(a), (c) => c.charCodeAt(0)); window.__usb.put(D + '/Music/Album/song.mp3', b(song)); window.__usb.put(D + '/Music/cover.jpg', b(photo)); }, [D, song.toString('base64'), photo.toString('base64')]);
    const puts0 = g.calls.filter((c) => /^PUT/.test(c)).length;
    j = await start({ dir: 'toDrive', items: [D + '/Music'], dest: 'root' });
    check(j && j.dest && j.dest.name === 'My Drive', 'CopyJobs.start (USB -> Drive) into My Drive ' + JSON.stringify(j && (j.error || j.dest)));
    await waitJob(j.id, ['done', 'failed']);
    j = await job(j.id);
    const music = Object.values(g.files).find((f) => f.name === 'Music' && f.mimeType === 'application/vnd.google-apps.folder');
    const album = music && Object.values(g.files).find((f) => f.name === 'Album' && (f.parents || []).includes(music.id));
    const up = album && Object.values(g.files).find((f) => f.name === 'song.mp3' && (f.parents || []).includes(album.id));
    const cov = music && Object.values(g.files).find((f) => f.name === 'cover.jpg' && (f.parents || []).includes(music.id));
    const puts = g.calls.filter((c) => /^PUT/.test(c)).slice(puts0).map((c) => c.split(' ').pop());
    check(j.state === 'done' && j.doneFiles === 2 && up && sum(up.data) === sum(song) && cov && sum(cov.data) === sum(photo) && up.mimeType === 'audio/mpeg',
        'the USB folder is in Google Drive with its sub-folder, byte for byte, with the right file types ' + JSON.stringify([j.state, j.doneFiles, !!up, !!cov, j.error, j.failed]));
    check(puts.includes('0-4194303/' + song.length) && puts.includes('4194304-' + (song.length - 1) + '/' + song.length), 'the 5 MB song went up in 4 MB pieces ' + JSON.stringify(puts));
    j = await start({ dir: 'toDrive', items: [D + '/Music'], dest: 'root' });
    await waitJob(j.id, ['done']); j = await job(j.id);
    check(j.doneFiles === 2 && Object.values(g.files).filter((f) => f.name === 'song.mp3').length === 1, 'the same copy again: Drive already has them (same size), nothing is uploaded twice');

    // --- going on after a page change (opening / quitting an app reloads the page): a USB file from its size, an upload from what Google has
    const film2 = big(12 * MB + 99, 7);
    g.files.m2 = { id: 'm2', name: 'long.mkv', mimeType: 'video/x-matroska', parents: ['root'], data: film2 };
    await page.evaluate(() => { window.__usb.slow = 150; });
    j = await start({ dir: 'toUsb', items: ['m2'], dest: D });
    await page.waitForFunction((D) => (window.__usb.tree[D + '/long.mkv'] || {}).length >= 4194304, D, { timeout: 15000 }).catch(() => {});
    await page.evaluate(() => { CopyJobs._reset(); CopyJobs.init(); window.__usb.slow = 0; });       // the page is gone; the next one starts
    await waitJob(j.id, ['done', 'failed'], 30000);
    const m2Reads = g.calls.filter((c) => /files\/m2\?alt=media/.test(c)).map((c) => c.split(' ').pop());
    check((await job(j.id)).state === 'done' && await page.evaluate((D) => window.__usb.sum(D + '/long.mkv'), D) === sum(film2) && m2Reads.filter((r) => r === 'bytes=0-4194303').length === 1,
        'Drive -> USB cut by a page change: the next page goes on from the file\'s size (the first 4 MB are not read again), the file is whole ' + JSON.stringify(m2Reads));
    const big2 = big(10 * MB + 1, 11);
    await page.evaluate(([D, b]) => window.__usb.put(D + '/big.bin', Uint8Array.from(atob(b), (c) => c.charCodeAt(0))), [D, big2.toString('base64')]);
    await page.route('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=**', async (r) => { await new Promise((ok) => setTimeout(ok, 400)); r.fallback(); });
    j = await start({ dir: 'toDrive', items: [D + '/big.bin'], dest: 'root' });
    await page.waitForFunction((id) => { const x = CopyJobs.list().find((y) => y.id === id); return x && x.current && x.current.done >= 4194304; }, j.id, { timeout: 20000 }).catch(() => {});
    await page.evaluate(() => { CopyJobs._reset(); CopyJobs.init(); });
    await waitJob(j.id, ['done', 'failed'], 30000);
    await page.unroute('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=**');
    const bigUp = Object.values(g.files).filter((f) => f.name === 'big.bin');
    check((await job(j.id)).state === 'done' && bigUp.length === 1 && sum(bigUp[0].data) === sum(big2) && g.statusAsks >= 1,
        'USB -> Drive cut by a page change: the next page asks Google how much it has and sends only the rest; one file, whole ' + JSON.stringify([bigUp.length, g.statusAsks]));

    // --- paused while a piece is being written: that write still lands, so the next run waits for it (else the file got it twice)
    await page.evaluate((D) => { window.__usb.slow = 1500; window.__usb.put(D + '/PauseTest/x.txt', new Uint8Array(1)); }, D);
    j = await start({ dir: 'toUsb', items: ['p1'], dest: D + '/PauseTest' });
    await page.waitForFunction((D) => window.__usb.tree[D + '/PauseTest/beach.jpg'] !== undefined, D, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(300);
    await page.evaluate((id) => { CopyJobs.pause(id); window.__usb.slow = 0; CopyJobs.resume(id); }, j.id);
    await waitJob(j.id, ['done', 'failed']);
    await page.waitForTimeout(1800);
    check(await page.evaluate((D) => window.__usb.sum(D + '/PauseTest/beach.jpg'), D) === sum(photo), 'paused while a piece was being written, then resumed at once: the file is whole, not written twice');

    // --- the USB drive pulled out in the middle: the copy stops with a red card that says so; not enough space: stops before copying
    await page.evaluate(() => { window.__usb.slow = 600; });
    j = await start({ dir: 'toUsb', items: ['m2'], dest: D + '/Backup' });
    await page.waitForFunction((D) => (window.__usb.tree[D + '/Backup/long.mkv'] || {}).length > 0, D, { timeout: 15000 }).catch(() => {});
    await page.evaluate(() => { window.__usb.mounted = false; });
    await waitJob(j.id, ['failed', 'done']);
    const gone = await job(j.id);
    await page.waitForFunction(() => /Copy stopped/.test(document.getElementById('toast').textContent), null, { timeout: 4000 }).catch(() => {});
    const goneCard = await page.evaluate(() => document.getElementById('toast').textContent);
    await shot('3-usb-removed');
    check(gone.state === 'failed' && gone.error.code === 'gone' && /The USB drive was removed/.test(goneCard), 'USB drive removed while copying: the job fails with gone and a red card ' + JSON.stringify(gone.error));
    await page.evaluate(() => { window.__usb.mounted = true; window.__usb.slow = 0; window.__usb.free = 1000; });
    j = await start({ dir: 'toUsb', items: ['m2'], dest: D });
    await waitJob(j.id, ['failed', 'done']);
    const full = await job(j.id);
    check(full.state === 'failed' && full.error.code === 'full' && /Not enough space/.test(full.error.message), 'not enough free space on the drive: it stops before copying anything ' + JSON.stringify(full.error));
    await page.evaluate(() => { window.__usb.free = 0; });
    const bad = await start({ dir: 'toUsb', items: ['m2'], dest: '/opt/media/USBDriveA1/../../etc' });
    const bad2 = await start({ dir: 'toDrive', items: ['/etc/passwd'], dest: 'root' });
    check(bad.error && bad.error.code === 'bad-request' && bad2.error && bad2.error.code === 'bad-request', 'paths outside the plugged USB drives are refused (no "..", no /etc)');
    await page.evaluate(() => { Notify.clear(); for (const k of Object.keys(window.__usb.tree)) if (/long\.mkv|big\.bin|film\.mp4|song\.mp3/.test(k)) delete window.__usb.tree[k]; });
    await snapshot();

    // --- the app bridge: MyPC.usb with its permission, MyPC.copy with job news; no My PC card while the app shows its own
    await page.waitForFunction(() => Desktop.games().some((x) => x.id === 'app-mydrive'), null, { timeout: 10000 });
    await Promise.all([page.waitForURL(/play=app-mydrive/), page.evaluate(() => Desktop.play(Desktop.games().find((x) => x.id === 'app-mydrive')))]);
    await page.waitForFunction(() => window.GameHost && GameHost.state() === 'running', null, { timeout: 10000 });
    const app = page.frames().find((x) => x.url().indexOf(APP) === 0);
    await app.waitForFunction(() => window.__ok === 1 && MyPC.info() && MyPC.info().bridges);
    const b0 = await app.evaluate(() => ({ api: MyPC.apiLevel, usb: MyPC.info().bridges.usb, copy: MyPC.info().bridges.copy }));
    check(b0.api >= 16 && b0.usb === 1 && b0.copy === 1, 'MyPC.usb / MyPC.copy (API 16) are offered on a TV ' + JSON.stringify(b0));
    await page.evaluate(() => Store.set('drive_apps', { mydrive: 1 }));
    const pDrives = app.evaluate(() => MyPC.usb.drives().then((d) => d, (e) => 'err ' + e.code));
    await page.waitForFunction(() => App.dialogOpen(), null, { timeout: 4000 }).catch(() => {});
    const askUsb = await page.evaluate(() => document.getElementById('dialog-title').textContent + ' | ' + document.getElementById('dialog-text').textContent);
    await shot('4-usb-permission');
    await page.evaluate(() => document.getElementById('dialog-yes').click());
    const drives = await pDrives;
    check(/MyDrive wants to use your USB drives/.test(askUsb) && Array.isArray(drives) && drives[0].path === D && drives[0].name === 'USB A1' && drives[0].free > 0, 'MyPC.usb.drives(): asked once ("MyDrive wants to use your USB drives"), then the drives with their free space ' + askUsb + JSON.stringify(drives));
    const appRes = await app.evaluate(async (D) => {
        const out = {};
        out.list = (await MyPC.usb.list(D)).map((f) => (f.dir ? '[' + f.name + ']' : f.name + ' ' + f.size)).join(', ');
        out.mk = (await MyPC.usb.createFolder(D, 'From Drive')).path;
        out.rd = new TextDecoder().decode((await MyPC.usb.read(D + '/Backup/old.txt', 0, 99)).buf);
        out.out = await MyPC.usb.list('/etc').then(() => 'ok', (e) => e.code);
        const news = [];
        MyPC.copy.onChange((job) => news.push(job.state + ' ' + job.doneFiles + '/' + job.files));
        const job = await MyPC.copy.toUsb([{ id: 'p1', name: 'beach.jpg' }, 'v1'], out.mk, { ifExists: 'keep' });
        out.job = job.dir + ' ' + job.state + ' ' + job.app;
        await new Promise((ok) => { const t = setInterval(() => { if (news.some((n) => /^done/.test(n))) { clearInterval(t); ok(); } }, 50); setTimeout(ok, 20000); });
        out.news = news;
        out.jobs = (await MyPC.copy.jobs()).map((x) => x.state + ' ' + x.dest.name);
        out.cleared = !!(await MyPC.copy.clear(job.id));
        out.after = (await MyPC.copy.jobs()).length;
        out.other = await MyPC.copy.cancel('nope').then(() => 'ok', (e) => e.code);
        return out;
    }, D);
    const cardWhileApp = await page.evaluate(() => [...document.querySelectorAll('#toast .nt')].map((c) => c.textContent).join(' | '));
    const fromDrive = await page.evaluate((D) => [window.__usb.sum(D + '/From Drive/beach.jpg'), window.__usb.sum(D + '/From Drive/Videos/film.mp4')], D);
    check(/\[Backup\]/.test(appRes.list) && /\[Music\]/.test(appRes.list) && /^\[/.test(appRes.list) && appRes.mk === D + '/From Drive' && appRes.rd === 'old' && appRes.out === 'bad-request',
        'the app lists a USB folder (folders first, sizes), makes a folder, reads a file; a path outside the drives is refused ' + JSON.stringify([appRes.list, appRes.mk, appRes.rd, appRes.out]));
    check(appRes.job === 'toUsb queued mydrive' && appRes.news.some((n) => /^copying/.test(n)) && appRes.news.some((n) => n === 'done 2/2') && fromDrive[0] === sum(photo) && fromDrive[1] === sum(film),
        'MyPC.copy.toUsb(): a job of the app, news while it runs (copying ... done 2/2), the files on the drive ' + JSON.stringify(appRes.news.slice(-3)));
    check(!/Copying to|Copy finished/.test(cardWhileApp), 'while the app shows its own progress (onChange) My PC adds no card over it ' + cardWhileApp);
    check(appRes.jobs.length >= 1 && /^done USB A1\/From Drive/.test(appRes.jobs[appRes.jobs.length - 1]) && appRes.cleared && appRes.other === 'not-found', 'copy.jobs() lists only this app\'s copies; clear() forgets an ended one; another id is not-found ' + JSON.stringify(appRes.jobs));
    // a copy started in the app goes on after the app is closed, and My PC's card shows it on the desktop
    await page.evaluate(() => { window.__usb.slow = 100; });
    const j3 = await app.evaluate(() => MyPC.copy.toUsb(['m2'], '/opt/media/USBDriveA1/From Drive').then((x) => x.id));
    await page.waitForFunction((id) => { const x = CopyJobs.list().find((y) => y.id === id); return x && x.state === 'copying' && x.doneBytes > 0; }, j3, { timeout: 15000 }).catch(() => {});
    await page.evaluate(() => { for (const k of Object.keys(window.__usb.tree)) if (/film\.mp4/.test(k)) delete window.__usb.tree[k]; });
    await snapshot();                // what the drive holds now goes with it to the next page (the copy keeps writing meanwhile)
    await tvMenu(page);
    await Promise.all([page.waitForURL(/from=app-mydrive/), page.evaluate(() => { const b = document.querySelectorAll('#pause-items button'); b[b.length - 1].click(); })]);
    await page.waitForSelector('#desk-icons .dicon');
    await page.evaluate(() => { window.__usb.slow = 0; });
    await page.waitForFunction(() => /Copying to USB A1\/From Drive/.test(document.getElementById('toast').textContent), null, { timeout: 8000 }).catch(() => {});
    const deskCard = await page.evaluate(() => document.getElementById('toast').textContent);
    await shot('5-desktop-after-quit');
    await page.waitForFunction((id) => { const x = CopyJobs.list().find((y) => y.id === id); return x && x.state === 'done'; }, j3, { timeout: 30000 }).catch(() => {});
    check(/Copying to USB A1\/From Drive/.test(deskCard) && (await job(j3)).state === 'done' && await page.evaluate((D) => window.__usb.sum(D + '/From Drive/long.mkv'), D) === sum(film2),
        'quitting the app does not stop its copy: the desktop page goes on with it, with My PC\'s card ' + deskCard);
    check(!page.errors.length, 'no page errors ' + page.errors.join(' | '));
    await page.context().close();
}

// the TV's AVPlay, faked: window.__av = { log, rects, l (the listener), url, state }; '/broken' fails to connect, '/live' has no length
const FAKE_AVPLAY = () => {
        const av = { log: [], state: 'NONE', cur: 0, t: 0, l: null, url: '', rects: [] };
        window.__av = av;
        window.webapis.avplay = {
            open: (u) => { av.log.push('open ' + u); av.url = u; av.state = 'IDLE'; av.cur = 0; },
            setListener: (l) => { av.l = l; }, setDisplayRect: (x, y, w, h) => { av.rects.push([x, y, w, h].join(',')); },
            setDisplayMethod: (m) => av.log.push('method ' + m), setStreamingProperty: (k, v) => av.log.push('prop ' + k),
            prepareAsync: (ok, err) => setTimeout(() => { if (/broken/.test(av.url)) return err('PLAYER_ERROR_CONNECTION_FAILED'); av.state = 'READY'; ok(); }, 10),
            play: () => { av.state = 'PLAYING'; av.t = Date.now(); av.log.push('play'); },
            pause: () => { if (av.state === 'PLAYING') av.cur += Date.now() - av.t; av.state = 'PAUSED'; av.log.push('pause'); },
            stop: () => { av.state = 'IDLE'; av.log.push('stop'); }, close: () => { av.state = 'NONE'; av.log.push('close'); },
            suspend: () => av.log.push('suspend'), restore: () => av.log.push('restore'),
            seekTo: (ms, ok) => { av.cur = ms; av.t = Date.now(); av.log.push('seek ' + ms); if (ok) setTimeout(ok, 1); },
            getCurrentTime: () => av.state === 'PLAYING' ? av.cur + Date.now() - av.t : av.cur,
            getDuration: () => /live/.test(av.url) ? 0 : 5400000, getState: () => av.state,
            getTotalTrackInfo: () => (av.log.push('totalTracks'), [{ type: 'VIDEO', index: 0, extra_info: '{"Width":1920,"Height":1080,"fourCC":"H264"}' },
                { type: 'AUDIO', index: 1, extra_info: '{"language":"ara","channels":2,"fourCC":"AAC"}' }, { type: 'AUDIO', index: 2, extra_info: '{"language":"fra","channels":6}' },
                { type: 'TEXT', index: 3, extra_info: '{"track_lang":"eng","subtitle_type":"srt"}' }]),
            getCurrentStreamInfo: () => [{ type: 'AUDIO', index: av.audio || 1 }, { type: 'TEXT', index: 3 }],
            setSelectTrack: (k, i) => { av.log.push('track ' + k + ' ' + i); if (k === 'AUDIO') av.audio = i; },
            setSilentSubtitle: (b) => av.log.push('silent ' + b), setSpeed: (r) => av.log.push('speed ' + r)
        };
};
// 49. API 17 for installed apps: MyPC.video (the TV's own player, AVPlay, behind the app), MyPC.back (the remote's Back for the
// app's own screens), keys: ['channel', 'media'] (CH + / CH - and the media keys go to the app), MyPC.text.keyboard (My PC's
// on-screen keyboard over the app). MYPC_ONLY=video runs only these.
async function videoTests(browser, base) {
    console.log('49. Video player, Back (every button to the app), channel / media keys and the keyboard for apps (API 17 / 18)');
    const APP = 'https://vtest.example.test/';
    const APP_HTML = `<!doctype html><meta charset=utf-8><title>VTest</title><body style="background:transparent;color:#fff;font:40px sans-serif"><p id=t style="background:#123;margin:0;padding:20px">VTest</p>
<script src="${OLD_HOSTED}sdk/mypc-sdk.js"></script><script>window.__in = []; window.__ev = []; window.__life = [];
MyPC.init({ keys: ['channel', 'media'], onInit() { MyPC.ready(); window.__ok = 1; }, onPause() { __life.push('pause'); }, onResume() { __life.push('resume'); },
  onInput(a, p, r) { if (p) __in.push(a); if (a === 'cancel' && p && window.__root) return false; } });
['state', 'time', 'sub', 'error', 'buffer', 'info'].forEach((n) => MyPC.video.on(n, (d) => __ev.push(n + ':' + (d.state || d.text || d.code || (d.t !== undefined ? Math.round(d.t) : '') || d.p || ''))));</script>`;
    const db = { apps: {} };
    db.apps.vtest = { id: 'vtest', name: 'VTest', url: APP, entry: APP + 'index.html', icon: '', type: 'app', version: '1.0.0', enabled: true, order: 1, config: {} };
    const page = await newPage(browser, base, db);
    const ctx = page.context();
    await ctx.addInitScript(FAKE_AVPLAY);
    await page.addInitScript((a) => { if (!localStorage.getItem('arc_dev_installed')) { localStorage.setItem('arc_dev_installed', JSON.stringify([{ id: 'vtest', at: 1 }])); localStorage.setItem('arc_dev_catalog', JSON.stringify([a])); } }, db.apps.vtest);
    await routeHosted(page, { offline: true });
    await page.route(OLD_HOSTED + 'sdk/mypc-sdk.js', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: fs.readFileSync(path.join(ROOT, 'sdk', 'mypc-sdk.js')) }));
    await ctx.route(APP + '**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: APP_HTML }));
    const shot = async (name) => { if (process.env.MYPC_SHOTS) { await page.waitForTimeout(150); await page.screenshot({ path: path.join(process.env.MYPC_SHOTS, 'video-' + name + '.png') }); } };
    const key = async (code) => { for (const d of [true, false]) await page.evaluate(([c, d]) => Input.onKey({ keyCode: c, repeat: false, preventDefault() {} }, d), [code, d]); };
    await page.goto(base + 'index.html');
    await page.waitForSelector('#desk-icons .dicon');
    await page.waitForFunction(() => Desktop.games().some((x) => x.id === 'app-vtest'), null, { timeout: 10000 });
    await Promise.all([page.waitForURL(/play=app-vtest/), page.evaluate(() => Desktop.play(Desktop.games().find((x) => x.id === 'app-vtest')))]);
    await page.waitForFunction(() => window.GameHost && GameHost.state() === 'running', null, { timeout: 10000 });
    const app = page.frames().find((x) => x.url().indexOf(APP) === 0);
    await app.waitForFunction(() => window.__ok === 1 && MyPC.info() && MyPC.info().bridges);
    const b0 = await app.evaluate(() => ({ api: MyPC.apiLevel, video: MyPC.info().bridges.video, kb: MyPC.info().bridges.keyboard, sup: MyPC.video.supported() }));
    check(b0.api >= 18 && b0.video === 1 && b0.kb === 1 && b0.sup === true, 'API 18+ on a TV: MyPC.video and the keyboard are offered ' + JSON.stringify(b0));

    // open a live stream in a small box (a preview): the TV's player gets the address and the box scaled to its 1920x1080 plane
    const r1 = await app.evaluate(() => MyPC.video.open('http://iptv.example:8080/live/u/p/1.ts', { live: true, rect: { x: 640, y: 180, w: 640, h: 360 }, ua: 'SpeedyTest' }).then((r) => r, (e) => 'err ' + e.code));
    const st1 = await page.evaluate(() => ({ log: window.__av.log.join(' | '), rect: window.__av.rects[window.__av.rects.length - 1], cls: document.documentElement.classList.contains('av-video'),
        bg: getComputedStyle(document.body).backgroundColor, layer: getComputedStyle(document.getElementById('game-layer')).backgroundColor, vw: innerWidth }));
    const k = 1920 / await app.evaluate(() => innerWidth);      // the app's own pixels (its frame is scaled with My PC's 1920 wide stage)
    check(r1 && r1.live === true && r1.tracks && r1.tracks.audio.length === 2 && r1.tracks.text[0].lang === 'eng' && r1.tracks.video.w === 1920 && r1.tracks.cur.audio === 1,
        'MyPC.video.open() plays the stream and gives its tracks (audio, subtitles, video size) ' + JSON.stringify(r1));
    // the black box: while a video is open, once a second, what the player and memory look like (cleared on a clean close)
    await page.waitForTimeout(1200);
    const tr = await page.evaluate(() => JSON.parse(localStorage.getItem('arc_dev_av_trace') || 'null'));
    check(tr && tr.app === 'app-vtest' && /\/live\/\*\/\*\/1\.ts$/.test(tr.url) && tr.st === 'PLAYING' && tr.log.some((x) => /open/.test(x)) && tr.log.some((x) => /ready/.test(x)),
        'while a video plays My PC keeps a small black box of it (no user name / password from the address) ' + JSON.stringify(tr && { url: tr.url, st: tr.st, log: tr.log }));
    check(/open http:\/\/iptv\.example:8080\/live\/u\/p\/1\.ts/.test(st1.log) && /prop USER_AGENT/.test(st1.log) && /LETTER_BOX/.test(st1.log) && /play( \| totalTracks)?$/.test(st1.log),
        'an http stream goes to the TV\'s player (no mixed-content block), with the user agent and letter box ' + st1.log);
    check(st1.rect === [640 * k, 180 * k, 640 * k, 360 * k].map(Math.round).join(','), 'the preview box is placed on the TV\'s 1920x1080 video plane ' + st1.rect);
    check(st1.cls && /rgba\(0, 0, 0, 0\)|transparent/.test(st1.bg) && /rgba\(0, 0, 0, 0\)|transparent/.test(st1.layer), 'My PC\'s layers turn transparent so the picture shows through ' + st1.bg + ' ' + st1.layer);
    // the file's own subtitles start silent (imad 2026-11-11: USB MKV films closed My PC a few seconds in): nothing reaches the app until it asks
    await page.evaluate(() => window.__av.l.onsubtitlechange(1500, 'Not asked for'));
    await page.waitForTimeout(80);
    const sub0 = await app.evaluate(() => window.__ev.join(' '));
    check(/silent true \| play/.test(st1.log) && !/Not asked for/.test(sub0), 'the subtitles inside the file are off until the app turns them on ' + st1.log);
    await app.evaluate(() => MyPC.video.subtitles(true));
    await page.evaluate(() => { const l = window.__av.l; l.oncurrentplaytime(1000); l.oncurrentplaytime(1200); l.onsubtitlechange(2000, 'Hello there'); l.onbufferingstart(); l.onbufferingprogress(50); l.onbufferingcomplete(); });
    await page.waitForTimeout(100);
    const ev1 = await app.evaluate(() => window.__ev.join(' '));
    check(/time:1/.test(ev1) && (ev1.match(/time:/g) || []).length === 1 && /sub:Hello there/.test(ev1) && /state:buffering/.test(ev1) && /buffer:50/.test(ev1),
        'the app gets the player\'s news: time (at most twice a second), subtitles text, buffering ' + ev1);
    // a whole-screen VOD with a resume point; seek, tracks, speed
    const r2 = await app.evaluate(() => MyPC.video.open('http://iptv.example:8080/movie/u/p/7.mkv', { start: 600 }).then((r) => r, (e) => 'err ' + e.code));
    const ops = await app.evaluate(async () => [await MyPC.video.seek(1200), (await MyPC.video.track('audio', 2)).cur.audio, await MyPC.video.subtitles(false), await MyPC.video.speed(4), (await MyPC.video.state()).state]);
    const log2 = await page.evaluate(() => window.__av.log.join(' | '));
    check(r2.duration === 5400 && /stop \| .*close \| open http:\/\/iptv\.example:8080\/movie/.test(log2) && /seek 600000/.test(log2) && ops[0] === 1200 && ops[1] === 2 && /silent true/.test(log2) && ops[3] === 4 && ops[4] === 'playing',
        'a film: the last video closes first, it starts at the resume point; seek, audio track, subtitles off, speed x4 ' + JSON.stringify(ops));
    const live = await app.evaluate(() => MyPC.video.open('http://iptv.example/live/2.ts', { live: true }).then(() => MyPC.video.seek(30)).then(() => 'moved', (e) => e.code));
    const broken = await app.evaluate(() => MyPC.video.open('http://iptv.example/broken.ts').then(() => 'ok', (e) => e.code));
    const badUrl = await app.evaluate(() => MyPC.video.open('javascript:alert(1)').then(() => 'ok', (e) => e.code));
    check(live === 'live' && broken === 'network' && badUrl === 'bad-request', 'a live stream cannot seek; a stream that does not connect fails with network; other addresses are refused ' + [live, broken, badUrl]);

    // the remote's Back (API 18, "Every button goes to the app" on by default): the app's 'cancel'; Back twice quickly = My PC's menu
    await app.evaluate(() => MyPC.video.open('http://iptv.example:8080/movie/u/p/8.mp4'));
    await app.evaluate(() => { window.__in = []; });
    await page.evaluate(() => { window.__av.log = []; Store.set('back_hint', []); });
    await tvBack(page);
    await page.waitForTimeout(900);
    const one = { st: await page.evaluate(() => GameHost.state()), ins: await app.evaluate(() => window.__in.join(' ')), hint: await page.evaluate(() => document.getElementById('toast').textContent) };
    check(one.st === 'running' && one.ins === 'cancel' && /twice quickly/.test(one.hint), 'one Back goes to the app as "cancel" (My PC stays out of the way); the first time, a card says how to reach My PC\'s menu ' + JSON.stringify(one));
    await shot('1-back-hint');
    await page.evaluate(() => { const k = (d) => Input.onKey({ keyCode: 10009, repeat: false, preventDefault() {} }, d); k(true); k(false); k(true); k(false); });
    await page.waitForTimeout(150);
    const menu = await page.evaluate(() => ({ st: GameHost.state(), log: window.__av.log.join(' | ') }));
    await shot('2-menu-over-video');
    await page.waitForTimeout(650);
    await tvBack(page);
    await page.waitForTimeout(100);
    const after = await page.evaluate(() => ({ st: GameHost.state(), log: window.__av.log.join(' | ') }));
    check(menu.st === 'paused' && /pause/.test(menu.log) && after.st === 'running' && /play$/.test(after.log), 'Back twice quickly: My PC\'s menu, the video pauses under it; Back again plays on ' + menu.log + ' / ' + after.log);
    // the app says it has nothing to close: onInput returns false for "cancel" (its first screen) -> My PC's menu at once
    await app.evaluate(() => { window.__root = true; });
    await page.waitForTimeout(500);
    await tvBack(page);
    await page.waitForTimeout(150);
    check(await page.evaluate(() => GameHost.state()) === 'paused', 'Back on the app\'s first screen (onInput returned false): My PC\'s menu');
    await page.waitForTimeout(650); await tvBack(page); await page.waitForTimeout(100);
    await app.evaluate(() => { window.__root = false; });
    // MyPC.back(true) then back(false): the app said it has nothing to close -> the menu without asking it
    await app.evaluate(() => { MyPC.back(true); window.__in = []; });
    await page.waitForTimeout(500);
    await tvBack(page);
    await key(427); await key(428); await key(415); await key(417); await key(10233);
    await page.waitForTimeout(100);
    const ins = await app.evaluate(() => window.__in.join(' '));
    check(await page.evaluate(() => GameHost.state()) === 'running' && /^cancel pageUp pageDown playPause mediaFf mediaNext$/.test(ins), 'MyPC.back(true): Back is the app\'s "cancel"; keys: channel + media: CH + / CH -, Play / Pause, ⏩, ⏭ reach the app ' + ins);
    await app.evaluate(() => { MyPC.back(false); window.__in = []; });
    await page.waitForTimeout(500);
    await tvBack(page);
    await page.waitForTimeout(100);
    check(await page.evaluate(() => GameHost.state()) === 'paused' && await app.evaluate(() => window.__in.join(' ')) === '', 'MyPC.back(false) after true: Back opens My PC\'s menu at once');
    await page.waitForTimeout(650); await tvBack(page); await page.waitForTimeout(100);
    // Control Panel > Gaming > "Every button goes to the app" off: Back = My PC's menu unless MyPC.back(true), as before
    await page.evaluate(() => Store.set('app_keys', false));
    await app.evaluate(() => { window.__in = []; });
    await tvBack(page); await page.waitForTimeout(100);
    const old1 = await page.evaluate(() => GameHost.state());
    await page.waitForTimeout(650); await tvBack(page); await page.waitForTimeout(100);
    await app.evaluate(() => MyPC.back(true)); await page.waitForTimeout(500);
    await tvBack(page); await page.waitForTimeout(100);
    const old2 = [await page.evaluate(() => GameHost.state()), await app.evaluate(() => window.__in.join(' '))];
    await app.evaluate(() => MyPC.back(false));
    await page.evaluate(() => Store.set('app_keys', true));
    check(old1 === 'paused' && old2[0] === 'running' && old2[1] === 'cancel', 'with the setting off: Back opens My PC\'s menu, unless the app has a screen to close ' + JSON.stringify([old1, old2]));
    await page.waitForTimeout(500);

    // My PC's keyboard over the app (MyPC.text.keyboard): typed with the remote, the app paused meanwhile
    await app.evaluate(() => { window.__life = []; window.__kb = MyPC.text.keyboard({ label: 'Search channels', value: 'bein', kind: 'search' }).then((v) => { window.__kbv = v; }); });
    await page.waitForFunction(() => Keyboard.isOpen(), null, { timeout: 3000 }).catch(() => {});
    const kbo = await page.evaluate(() => ({ title: document.getElementById('namer-title').textContent, text: document.getElementById('namer-text').textContent, st: GameHost.state() }));
    await key(39); await key(40);
    await shot('2-keyboard-over-app');
    await page.evaluate(() => { Keyboard.setText('bein sports'); Keyboard.submit(); });
    await app.waitForFunction(() => window.__kbv !== undefined, null, { timeout: 3000 }).catch(() => {});
    const kbv = await app.evaluate(() => [window.__kbv, window.__life.join(' ')]);
    check(kbo.title === 'Search channels' && kbo.text === 'bein' && kbo.st === 'paused' && kbv[0] === 'bein sports' && kbv[1] === 'pause resume' && await page.evaluate(() => GameHost.state()) === 'running',
        'MyPC.text.keyboard(): My PC\'s keyboard opens over the app (arrows move in it, not in the app), the text comes back ' + JSON.stringify([kbo, kbv]));
    await app.evaluate(() => { window.__kbv = undefined; MyPC.text.keyboard({ label: 'x' }).then((v) => { window.__kbv = v; }); });
    await page.waitForFunction(() => Keyboard.isOpen(), null, { timeout: 3000 }).catch(() => {});
    await tvBack(page);
    await app.waitForFunction(() => window.__kbv !== undefined, null, { timeout: 3000 }).catch(() => {});
    check(await app.evaluate(() => window.__kbv) === null && await page.evaluate(() => GameHost.state()) === 'running', 'Back on the keyboard: null, the app runs again');

    // a USB film: only after MyPC.usb was allowed; played from the TV's file path
    await page.evaluate(() => { window.UsbFs.inside = (p) => /^\/opt\/media\/USBDriveA1\//.test(p) && p.indexOf('..') < 0; });
    const u1 = await app.evaluate(() => MyPC.video.open('/opt/media/USBDriveA1/Films/Movie (2020).mkv').then(() => 'ok', (e) => e.code));
    await page.evaluate(() => { const p = JSON.parse(localStorage.getItem('arc_dev_perm') || '{}'); p['app-vtest'] = { usb: 1 }; localStorage.setItem('arc_dev_perm', JSON.stringify(p)); });
    const u2 = await app.evaluate(() => MyPC.video.open('/opt/media/USBDriveA1/Films/Movie (2020).mkv').then(() => 'ok', (e) => e.code));
    // imad's TV (build 153): asking the TV's player for a USB MKV's tracks (Subtitles button) froze My PC; a file's tracks are never read
    const ulog1 = await page.evaluate(() => window.__av.log.filter((x) => /totalTracks|^track /.test(x)).length);
    const ut = await app.evaluate(async () => { const t = await MyPC.video.tracks(); const k = await MyPC.video.track('text', 3).then(() => 'ok', (e) => e.code); return { t, k }; });
    const ulog2 = await page.evaluate(() => window.__av.log.filter((x) => /totalTracks|^track /.test(x)).length);
    check(ut.t.file === true && !ut.t.text.length && !ut.t.audio.length && ut.k === 'unsupported' && ulog2 === ulog1, 'a USB file\'s tracks are never asked from the TV\'s player (it hangs on some MKVs): empty lists, track() refused ' + JSON.stringify(ut) + ' ' + ulog2);
    const u3 = await app.evaluate(() => MyPC.video.open('/opt/media/USBDriveA1/../../etc/passwd').then(() => 'ok', (e) => e.code));
    const ulog = await page.evaluate(() => window.__av.log.filter((x) => /^open file/.test(x)).join(' | '));
    check(u1 === 'denied' && u2 === 'ok' && u3 === 'bad-request' && /open file:\/\/\/opt\/media\/USBDriveA1\/Films\/Movie%20\(2020\)\.mkv/.test(ulog), 'a USB film plays from its file path once USB drives are allowed; paths outside a drive are refused ' + [u1, u2, u3, ulog]);

    // quitting the app closes the player and gives My PC its background back
    await page.evaluate(() => { window.__av.log = []; });
    await tvBack(page);
    await Promise.all([page.waitForURL(/from=app-vtest/), page.evaluate(() => { const b = document.querySelectorAll('#pause-items button'); b[b.length - 1].click(); })]);
    await page.waitForSelector('#desk-icons .dicon');
    check(!(await page.evaluate(() => document.documentElement.classList.contains('av-video'))), 'after Quit the desktop is drawn normally again');
    check(await page.evaluate(() => localStorage.getItem('arc_dev_av_trace')) === null, 'a clean Quit leaves no black box behind');
    // My PC closed while a video played (the TV killed it: no time to clean up): the next start says so and sends a report
    await page.evaluate(() => localStorage.setItem('arc_dev_av_trace', JSON.stringify({ app: 'app-vtest', url: 'http://x/movie/*/*/1.mkv', from: Date.now() - 6000, at: Date.now() - 500, st: 'PLAYING', t: 5200,
        ev: { time: 50 }, log: ['0s open', '0.4s ready', '0.5s play'], mem: { free: 12, total: 2500, heap: 80 }, low: 12 })));
    await page.reload();
    await page.waitForSelector('#desk-icons .dicon');
    await page.waitForFunction(() => /closed while a video played/.test(document.getElementById('toast').textContent), null, { timeout: 8000 }).catch(() => {});
    const crash = await page.evaluate(() => ({ card: document.getElementById('toast').textContent, left: localStorage.getItem('arc_dev_av_trace') }));
    await shot('crash-card');
    check(/after 6 s, player PLAYING at 5 s, free memory 12 MB/.test(crash.card) && crash.left === null, 'after a crash during a video the next start shows what was seen (time, player, memory) and reports it ' + crash.card.slice(0, 160));
    check(!page.errors.length, 'no page errors ' + page.errors.join(' | '));
    await page.context().close();
}

// 50. Speedy IPTV (github.com/imad-os/g_iptv) installed in My PC: the TV's player for live channels, films and USB files,
// the remote's Back / CH + / CH − / media keys, My PC's keyboard for its forms, USB films and shows with their subtitle files.
// Skipped when the g_iptv checkout is not next to this one (or SPEEDY_DIR). MYPC_ONLY=speedy runs only these.
async function speedyTests(browser, base) {
    const DIR = path.resolve(process.env.SPEEDY_DIR || path.join(ROOT, '..', 'g_iptv'));
    if (!fs.existsSync(path.join(DIR, 'tests', 'fixtures.mjs'))) { console.log('50. Speedy IPTV: skipped (no checkout at ' + DIR + ')'); return; }
    console.log('50. Speedy IPTV in My PC: the TV\'s player, Back, CH + / CH −, media keys, the keyboard, USB films and shows with subtitles');
    const fx = await import(new URL('file://' + path.join(DIR, 'tests', 'fixtures.mjs')).href);
    const APP = 'https://speedy.example.test/', D = '/opt/media/USBDriveA1';
    const db = { apps: {} };
    db.apps.speedy = { id: 'speedy', name: 'Speedy IPTV', url: APP, entry: APP + 'index.html', icon: '', type: 'app', version: '1.0.0', enabled: true, order: 1, config: { orientation: 'landscape' } };
    const page = await newPage(browser, base, db);
    const ctx = page.context();
    await ctx.addInitScript(FAKE_AVPLAY);
    await ctx.addInitScript(USB_MOCK, D);
    await ctx.addInitScript(() => { if (location.hostname === 'speedy.example.test') window.__speedyHold = 4000; });
    const b64 = (x) => Buffer.from(x).toString('base64');
    // a real little film (VP9, 6 s, a test picture) for "a picture taken from the film" (Speedy, when no poster is next to it)
    let clip = null;
    try {
        const { spawnSync } = await import('node:child_process');
        const out = path.join(os.tmpdir(), 'speedy-clip-' + process.pid + '.mp4');
        const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25', '-t', '6', '-c:v', 'libvpx-vp9', '-b:v', '300k', '-deadline', 'realtime', '-movflags', '+faststart', out]);
        if (r.status === 0) { clip = fs.readFileSync(out); fs.unlinkSync(out); }
    } catch (e) { clip = null; }
    const seed = {};
    for (const [p, v] of Object.entries({
        'Films/Movie.Name.2020.1080p.BluRay.x264.mkv': 'film', 'Films/Movie.Name.2020.1080p.BluRay.x264.srt': fx.SRT_EN, 'Films/Movie.Name.2020.1080p.BluRay.x264.ar.srt': fx.srtArabic1256(),
        'Films/Other Film (2018).mp4': clip || 'film2', 'Films/notes.txt': 'x', 'Films/Movie.Name.2020-sample.mkv': 's',
        'TV/My Show/Season 1/My.Show.S01E01.mkv': 'e1', 'TV/My Show/Season 1/My.Show.S01E02.mkv': 'e2', 'TV/My Show/Season 1/My.Show.S01E02.srt': fx.SRT_EN })) {
        const full = D + '/' + p, parts = full.split('/');
        for (let i = 2; i < parts.length; i++) seed[parts.slice(0, i).join('/')] = true;
        seed[full] = b64(v);
    }
    await ctx.route('https://usb-seed.test/seed', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(seed) }));
    await page.addInitScript((a) => { if (!localStorage.getItem('arc_dev_installed')) { localStorage.setItem('arc_dev_installed', JSON.stringify([{ id: 'speedy', at: 1 }])); localStorage.setItem('arc_dev_catalog', JSON.stringify([a])); localStorage.setItem('arc_dev_perm', JSON.stringify({ 'app-speedy': { usb: 1 } })); } }, db.apps.speedy);
    await routeHosted(page, { offline: true });
    const stats = await fx.routeAll(ctx, { appBase: APP, sdk: path.join(ROOT, 'sdk', 'mypc-sdk.js') });
    await page.route(OLD_HOSTED + 'sdk/mypc-sdk.js', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: fs.readFileSync(path.join(ROOT, 'sdk', 'mypc-sdk.js')) }));
    const shot = async (name) => { if (process.env.MYPC_SHOTS) { await page.waitForTimeout(300); await page.screenshot({ path: path.join(process.env.MYPC_SHOTS, 'speedy-' + name + '.png') }); } };
    const key = async (code, n) => { for (let i = 0; i < (n || 1); i++) { for (const d of [true, false]) await page.evaluate(([c, d]) => Input.onKey({ keyCode: c, repeat: false, preventDefault() {} }, d), [code, d]); await page.waitForTimeout(40); } };
    const OK = 13, UP = 38, DOWN = 40, RIGHT = 39;
    const typeIn = async (text) => { await page.waitForFunction(() => Keyboard.isOpen(), null, { timeout: 5000 }); await page.evaluate((t) => { Keyboard.setText(t); Keyboard.submit(); }, text); await page.waitForTimeout(150); };
    await page.goto(base + 'index.html');
    await page.waitForSelector('#desk-icons .dicon');
    await page.waitForFunction(() => Desktop.games().some((x) => x.id === 'app-speedy'), null, { timeout: 10000 });
    await Promise.all([page.waitForURL(/play=app-speedy/), page.evaluate(() => Desktop.play(Desktop.games().find((x) => x.id === 'app-speedy')))]);
    await page.waitForFunction(() => window.GameHost && GameHost.state() === 'running', null, { timeout: 15000 });
    const app = page.frames().find((x) => x.url().indexOf(APP) === 0);
    await app.waitForFunction(() => typeof UI !== 'undefined' && UI.top() && UI.top().constructor.name === 'HomeScreen', null, { timeout: 15000 });
    const top = () => app.evaluate(() => UI.top().constructor.name);
    const b0 = await app.evaluate(() => ({ hosted: MyPC.isHosted(), api: MyPC.apiLevel, video: MyPC.video.supported(), usb: Usb.available() }));
    check(b0.hosted && b0.api >= 17 && b0.video && b0.usb, 'Speedy runs inside My PC with the TV\'s player and USB drives ' + JSON.stringify(b0));
    await shot('1-welcome');

    // a playlist typed with My PC's keyboard (the remote alone): server, user, password, name, Save
    await key(OK);
    await app.waitForSelector('.form .field');
    await page.waitForTimeout(200);
    for (const v of [fx.XT, 'demo', 'pass', 'My TV server']) { await key(OK); await typeIn(v); }
    await key(OK);
    await app.waitForSelector('.home .home-tiles .tile', { timeout: 20000 });
    const tiles = await app.evaluate(() => [...document.querySelectorAll('.home .tile .tt')].map((x) => x.textContent).join(','));
    check(tiles === 'Live TV,Movies,Series,USB', 'the playlist is saved through My PC\'s keyboard (server answered through MyPC.net); the home screen has a USB tile on the TV ' + tiles);
    await app.waitForFunction(() => /Active/.test(document.querySelector('.acct').textContent), null, { timeout: 10000 }).catch(() => {});
    await shot('2-home');

    // Back on the home screen: My PC's menu (the app has nothing to close); Back again: Resume
    await tvBack(page); await page.waitForTimeout(150);
    const m1 = await page.evaluate(() => GameHost.state());
    await shot('3-mypc-menu');
    await page.waitForTimeout(650);
    await tvBack(page); await page.waitForTimeout(150);
    check(m1 === 'paused' && await page.evaluate(() => GameHost.state()) === 'running', 'Back on Speedy\'s home screen (nothing left to close there) opens My PC\'s menu, Back again goes on ' + m1);

    // Live TV: a channel in the box plays on the TV's video plane (the page is transparent there), full screen, CH + zaps
    await key(OK);
    await app.waitForFunction(() => UI.top().constructor.name === 'LiveScreen' && UI.top().items.length > 0, null, { timeout: 30000 });
    const bi = await app.evaluate(() => UI.top().cats.findIndex((c) => c.name === 'Big list'));
    await key(DOWN, bi); await page.waitForTimeout(350); await key(OK);
    await app.waitForFunction(() => UI.top().zone === 'ch' && UI.top().items.length === 4000, null, { timeout: 10000 });
    await key(DOWN, 5); await key(OK);
    await page.waitForFunction(() => window.__av.state === 'PLAYING', null, { timeout: 10000 });
    await page.waitForTimeout(300);
    const pv = await page.evaluate(() => ({ url: window.__av.url, rect: window.__av.rects[window.__av.rects.length - 1], av: document.documentElement.classList.contains('av-video'), log: window.__av.log.join(' | ') }));
    const box = await app.evaluate(() => { const b = document.querySelector('.pv-box').getBoundingClientRect(); return { b: [b.x, b.y, b.width, b.height], w: innerWidth, video: document.documentElement.classList.contains('video'), vid: document.getElementById('vid') ? getComputedStyle(document.getElementById('vid')).display : 'none', bg: getComputedStyle(document.querySelector('.pv-box')).backgroundColor, mode: Player.mode() }; });
    const k = 1920 / box.w, want = box.b.map((x) => Math.round(x * k)).join(',');
    check(/^http:\/\/iptv\.test:8080\/live\/demo\/pass\/6\.ts$/.test(pv.url) && box.mode === 'preview' && pv.av && box.video && box.vid === 'none', 'OK on a channel: the TV\'s player plays its .ts stream (no hls.js, no <video>) ' + JSON.stringify([pv.url, box.mode, box.vid]));
    check(pv.rect === want, 'the picture is placed exactly in the preview box on the 1920x1080 plane ' + pv.rect + ' = ' + want);
    check(/rgba\(0, 0, 0, 0\)|transparent/.test(box.bg), 'the preview box is see-through so the video plane shows ' + box.bg);
    await shot('4-live-preview');
    await key(OK);
    await app.waitForFunction(() => Player.mode() === 'full', null, { timeout: 5000 });
    await page.waitForTimeout(200);
    const full = await page.evaluate(() => window.__av.rects[window.__av.rects.length - 1]);
    check(full === '0,0,1920,1080', 'OK again: full screen on the whole plane ' + full);
    await key(427);
    await app.waitForFunction(() => /\/7\.ts$/.test(Player.current().url), null, { timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => /\/7\.ts$/.test(window.__av.url), null, { timeout: 5000 }).catch(() => {});
    const z = await page.evaluate(() => window.__av.url);
    await shot('5-live-zap');
    await key(428); await key(428);
    await page.waitForFunction(() => /\/5\.ts$/.test(window.__av.url), null, { timeout: 5000 }).catch(() => {});
    const z2 = await page.evaluate(() => window.__av.url);
    check(/\/7\.ts$/.test(z) && /\/5\.ts$/.test(z2), 'CH + zaps up, CH − twice zaps down (one open after the keys stop) ' + z + ' ' + z2);
    // Back closes Speedy's own layers, never My PC's menu
    await tvBack(page); await page.waitForTimeout(500);
    await tvBack(page); await page.waitForTimeout(500);
    const lb = await app.evaluate(() => ({ mode: Player.mode(), top: UI.top().constructor.name }));
    check(lb.mode === 'preview' && lb.top === 'LiveScreen' && await page.evaluate(() => GameHost.state()) === 'running', 'Back from full screen: the picture goes back into the box, inside the app (My PC\'s menu stays shut) ' + JSON.stringify(lb));
    await page.waitForTimeout(200);
    const backRect = await page.evaluate(() => window.__av.rects[window.__av.rects.length - 1]);
    check(backRect !== '0,0,1920,1080', 'the plane shrinks back to the box ' + backRect);
    for (let i = 0; i < 4 && await top() !== 'HomeScreen'; i++) { await tvBack(page); await page.waitForTimeout(500); }
    const off = await page.evaluate(() => ({ log: window.__av.log.slice(-3).join(' | '), av: document.documentElement.classList.contains('av-video') }));
    check(await top() === 'HomeScreen' && /close/.test(off.log) && !off.av, 'leaving Live TV closes the TV\'s player and My PC draws its layers again ' + JSON.stringify(off));

    // a film: plays from its resume point on the TV's player; Play / Pause and ⏩ from the remote
    await key(RIGHT); await key(OK);
    await app.waitForFunction(() => UI.top().constructor.name === 'BrowseScreen' && UI.top().items.length > 0, null, { timeout: 60000 });
    await key(RIGHT); await page.waitForTimeout(300); await key(OK);
    await app.waitForFunction(() => UI.top().constructor.name === 'MovieScreen', null, { timeout: 10000 });
    await app.waitForTimeout(500);
    await key(OK);
    await page.waitForFunction(() => window.__av.state === 'PLAYING' && /\/movie\//.test(window.__av.url), null, { timeout: 10000 });
    await page.waitForTimeout(300);
    const fm = await page.evaluate(() => window.__av.url);
    check(/^http:\/\/iptv\.test:8080\/movie\/demo\/pass\/\d+\.(mkv|mp4)$/.test(fm), 'a film plays on the TV\'s player from the server\'s own file ' + fm);
    await app.waitForFunction(() => !Player.state().ui, null, { timeout: 8000 }).catch(() => {});
    const fu = await app.evaluate(() => ({ ui: Player.state().ui, spin: !!document.querySelector('#player .pl-center .spin'), playing: Player.state().playing }));
    check(fu.ui === false && !fu.spin && fu.playing, 'an online film: the controls and the loader go away by themselves once it plays ' + JSON.stringify(fu));
    await shot('6a-film-clean');
    await page.evaluate(() => { window.__av.log = []; });
    await key(415);
    await page.waitForTimeout(250);
    const p1 = await page.evaluate(() => window.__av.log.join(' | '));
    await shot('6-film-paused');
    await key(415);
    await page.waitForTimeout(150);
    await key(417);
    await page.waitForTimeout(1200);
    const p2 = await page.evaluate(() => window.__av.log.join(' | '));
    check(/pause/.test(p1) && /play/.test(p2) && /seek \d+/.test(p2), 'the remote\'s Play / Pause pauses and plays; ⏩ seeks forward ' + p1 + ' / ' + p2);
    for (let i = 0; i < 5 && await top() !== 'HomeScreen'; i++) { await tvBack(page); await page.waitForTimeout(500); }
    const saved = await app.evaluate(() => Store.recent(null, ['vod']).length);
    check(saved >= 1, 'the film is in Continue watching after Back');

    // USB: films and shows found on the drive, a film plays from its file with the subtitle files next to it
    await app.evaluate(() => { const h = UI.top(); h.zone = 0; h.ti = h.tiles.findIndex((t) => t.id === 'usb'); h.paint(); });
    await key(OK);
    await app.waitForFunction(() => UI.top().constructor.name === 'UsbScreen' && UI.top().lib, null, { timeout: 15000 });
    const lib = await app.evaluate(() => ({ tabs: UI.top().tabs.map((t) => t.name + ':' + t.n), movies: UI.top().lib.movies.map((m) => m.title + '|' + m.year), shows: UI.top().lib.shows.map((s) => s.name + ':' + s.eps.length) }));
    check(lib.movies.join(',') === 'Movie Name|2020,Other Film|2018' && lib.shows.join(',') === 'My Show:2', 'the USB drive: 2 films (clean names, years; the release sample and a text file left out) and a show with 2 episodes ' + JSON.stringify(lib));
    // no poster next to "Other Film": a picture taken from the film itself (kept on the device); "Movie Name" (not a real video) gets none, quietly
    if (clip) {
        await app.waitForFunction(() => [...document.querySelectorAll('.usb .grid *')].some((e) => /blob:/.test(e.style.backgroundImage)), null, { timeout: 20000 }).catch(() => {});
        const fr = await app.evaluate(async () => {
            const cells = [...document.querySelectorAll('.usb .grid *')].filter((e) => /blob:/.test(e.style.backgroundImage));
            const d = await new Promise((res) => { const r = indexedDB.open('speedy-frames', 1); r.onsuccess = () => res(r.result); r.onerror = () => res(null); });
            const keys = d ? await new Promise((res) => { const q = d.transaction('f').objectStore('f').getAllKeys(); q.onsuccess = () => res(q.result.map((k) => k.replace(/^.*\//, ''))); q.onerror = () => res([]); }) : [];
            return { cells: cells.length, keys, tryLeft: localStorage.getItem('speedy_frame_try') };
        });
        check(fr.cells >= 1 && fr.keys.some((k) => /^Other Film \(2018\)\.mp4\|/.test(k)) && !fr.tryLeft, 'a USB film with no poster file shows a picture taken from the film, kept on the device ' + JSON.stringify(fr));
    } else console.log('  skip the picture-from-the-film check (no ffmpeg)');
    await shot('7-usb-movies');
    await app.waitForFunction(() => UI.top().items.length > 0 && UI.top().view, null, { timeout: 5000 }).catch(() => {});
    const view = await app.evaluate(() => ({ view: UI.top().view, first: UI.top().items[0] && (UI.top().items[0].title || UI.top().items[0].name) }));
    await key(RIGHT); await page.waitForTimeout(200);
    await key(OK);
    await page.waitForFunction(() => /^file:/.test(window.__av.url) && window.__av.state === 'PLAYING', null, { timeout: 10000 }).catch(() => {});
    const uf = await page.evaluate(() => window.__av.url);
    check(/^file:\/\/\/opt\/media\/USBDriveA1\/Films\/Movie\.Name\.2020\.1080p\.BluRay\.x264\.mkv$/.test(uf), 'OK on a USB film: the TV\'s player opens the file itself ' + uf + ' ' + JSON.stringify(view));
    await app.waitForFunction(() => Player.state().cues > 0, null, { timeout: 5000 }).catch(() => {});
    await page.evaluate(() => { const l = window.__av.l; l.oncurrentplaytime(2000); l.oncurrentplaytime(2500); });
    await app.waitForFunction(() => /Hello from the subtitle file/.test(Player.state().sub), null, { timeout: 3000 }).catch(() => {});
    const subs = await app.evaluate(() => ({ files: (Player.current().files || []).map((x) => x.label + ':' + x.lang), cues: Player.state().cues, text: Player.state().sub }));
    check(subs.files.length === 2 && subs.files.some((x) => /:ar$/.test(x)) && subs.cues === 2 && /Hello from the subtitle file/.test(subs.text),
        'its subtitle files (English, Arabic) are found; the English one is read from the drive and shown in time with the TV\'s player ' + JSON.stringify(subs));
    await page.waitForTimeout(400);
    await shot('8-usb-film');
    check(/TV player/.test(await app.evaluate(() => document.querySelector('#player .pl-tags').textContent)), 'the player says it is the TV player (Settings > Player = Auto)');
    // imad 2026-11-11: the controls and the loader stayed on over a USB film. The TV says "buffering" late (after it already plays) and
    // never "done": the moving time clears the loader; the controls hide by themselves 5 s after it plays
    await page.evaluate(() => { const l = window.__av.l; l.onbufferingstart(); window.__tk = setInterval(() => l.oncurrentplaytime(window.webapis.avplay.getCurrentTime()), 100); });
    await app.waitForTimeout(300);
    const ld0 = await app.evaluate(() => !!document.querySelector('#player .pl-center .spin'));
    await app.waitForTimeout(1500);
    const ld1 = await app.evaluate(() => ({ spin: !!document.querySelector('#player .pl-center .spin'), st: Player.state() }));
    await app.waitForFunction(() => !Player.state().ui, null, { timeout: 8000 }).catch(() => {});
    const ld2 = await app.evaluate(() => ({ ui: Player.state().ui, top: getComputedStyle(document.querySelector('#player .pl-top')).display, bot: getComputedStyle(document.querySelector('#player .pl-bot')).display, playing: Player.state().playing }));
    check(!ld1.spin && !ld1.st.buffering && ld1.st.playing, 'a late "buffering" report with no end: once the time moves the loader goes away (it plays) ' + JSON.stringify({ before: ld0, after: ld1.spin, buffering: ld1.st.buffering }));
    check(ld2.ui === false && ld2.top === 'none' && ld2.bot === 'none' && ld2.playing, 'the player\'s controls hide by themselves a few seconds after the film plays ' + JSON.stringify(ld2));
    await shot('8b-usb-film-clean');
    // imad 2026-11-11 (build 153): Subtitles on a USB MKV froze My PC (the TV's player asked for the file's tracks). Now: Off, the files next to it
    const tt0 = await page.evaluate(() => window.__av.log.filter((x) => x === 'totalTracks').length);
    await key(OK); await page.waitForTimeout(200); await key(RIGHT, 4); await key(OK);
    await app.waitForFunction(() => !!document.querySelector('.menu'), null, { timeout: 4000 }).catch(() => {});
    await app.waitForTimeout(300);
    const sm = await app.evaluate(() => ({ title: (document.querySelector('.menu h2') || {}).textContent, items: [...document.querySelectorAll('.menu .li .nm')].map((x) => x.firstChild.textContent) }));
    const tt1 = await page.evaluate(() => window.__av.log.filter((x) => x === 'totalTracks').length);
    await shot('8c-usb-subtitles-menu');
    check(sm.title === 'Subtitles' && sm.items[0] === 'Off' && sm.items.filter((x) => /\.srt$|English|Arabic/i.test(x)).length === 2 && tt1 === tt0 && !(await app.evaluate(() => document.querySelector('.pl-msg') && document.querySelector('.pl-msg').textContent)),
        'Subtitles on a USB film: Off + its 2 subtitle files, and the TV\'s player is never asked for the file\'s tracks (it hung on an MKV) ' + JSON.stringify(sm) + ' ' + [tt0, tt1]);
    await tvBack(page); await page.waitForTimeout(700); // (two Backs within 450 ms = My PC's menu)
    // Remote buttons (API 19, MyPC.buttons): the yellow key opens the subtitles, the blue one the player's options, by default
    await key(405); await app.waitForTimeout(400);
    const yb = await app.evaluate(() => (document.querySelector('.menu h2') || {}).textContent || '');
    await tvBack(page); await page.waitForTimeout(700);
    await key(406); await app.waitForTimeout(400);
    const bb = await app.evaluate(() => (document.querySelector('.menu h2') || {}).textContent || '');
    await tvBack(page); await page.waitForTimeout(700);
    check(yb === 'Subtitles' && bb === 'Movie Name' && await page.evaluate(() => GameHost.state()) === 'running', 'in the player the remote\'s yellow key opens Subtitles, the blue one the player\'s options (Settings > Remote buttons defaults) ' + JSON.stringify([yb, bb]));
    await page.evaluate(() => clearInterval(window.__tk));
    for (let i = 0; i < 4 && await top() !== 'UsbScreen'; i++) { await tvBack(page); await page.waitForTimeout(500); }
    // a show: its page, the first episode, then the next one by itself at the end (with its own subtitle file)
    if (await app.evaluate(() => UI.top().zone) === 'grid') await tvBack(page);
    await key(DOWN); await page.waitForTimeout(500); await key(RIGHT); await key(OK);
    await app.waitForFunction(() => UI.top().constructor.name === 'SeriesScreen', null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    await shot('9-usb-show');
    const sh = await app.evaluate(() => ({ top: UI.top().constructor.name, title: (document.querySelector('.screen.on h1') || {}).textContent }));
    await key(OK);
    await page.waitForFunction(() => /S01E01\.mkv$/.test(window.__av.url) && window.__av.state === 'PLAYING', null, { timeout: 8000 }).catch(() => {});
    const e1 = await page.evaluate(() => window.__av.url);
    check(sh.top === 'SeriesScreen' && /\/TV\/My%20Show\/Season%201\/My\.Show\.S01E01\.mkv$/.test(e1), 'a USB show opens its page; OK plays the first episode from the drive ' + JSON.stringify(sh) + ' ' + e1);
    await page.evaluate(() => { const l = window.__av.l; l.oncurrentplaytime(5399000); l.onstreamcompleted(); });
    await page.waitForFunction(() => /S01E02\.mkv$/.test(window.__av.url) && window.__av.state === 'PLAYING', null, { timeout: 15000 }).catch(() => {});
    await app.waitForFunction(() => Player.state().cues > 0, null, { timeout: 5000 }).catch(() => {});
    const e2 = await page.evaluate(() => window.__av.url), e2s = await app.evaluate(() => ({ cur: Player.current().sub, files: (Player.current().files || []).length, cues: Player.state().cues }));
    check(/S01E02\.mkv$/.test(e2) && e2s.files === 1 && e2s.cues === 2, 'at the end of an episode the next one plays by itself, with its subtitle file ' + e2 + ' ' + JSON.stringify(e2s));
    for (let i = 0; i < 6 && await top() !== 'HomeScreen'; i++) { await tvBack(page); await page.waitForTimeout(500); }
    const uh = await app.evaluate(() => UI.top().rec.filter((r) => r.kind === 'usb').map((r) => r.name + (r.key[1] === '#' ? ' (show)' : '')));
    check(uh.join(',') === 'My Show (show),Movie Name', 'Continue watching keeps the USB show once (not each episode) and the film ' + JSON.stringify(uh));
    await app.evaluate(() => { const h = UI.top(); h.zone = h.zones.indexOf('row'); h.row.setCount(h.rec.length, h.rec.findIndex((r) => r.key[1] === '#')); h.paint(); });
    await page.evaluate(() => { window.__av.log = []; });
    await app.evaluate(() => Store.setPref('engine', 'web'));      // Settings > Player = Web: a USB file still needs the TV's player
    await key(OK);
    await page.waitForFunction(() => /S01E02\.mkv$/.test(window.__av.url) && window.__av.state === 'PLAYING', null, { timeout: 8000 }).catch(() => {});
    const wu = await app.evaluate(() => ({ eng: Player.state().engine, tag: document.querySelector('#player .pl-tags').textContent }));
    await app.evaluate(() => Store.setPref('engine', 'auto'));
    check(wu.eng === 'tv' && /TV player/.test(wu.tag), 'with Settings > Player = Web player a USB file still plays on the TV player (only it reads the drive), and says so ' + JSON.stringify(wu));
    const rs = await page.evaluate(() => window.__av.log.filter((x) => /^(open|seek)/.test(x)).join(' | '));
    check(/open file:.*S01E02\.mkv/.test(rs), 'OK on the show in Continue watching goes on with its last episode ' + rs);
    for (let i = 0; i < 4 && await top() !== 'HomeScreen'; i++) { await tvBack(page); await page.waitForTimeout(500); }

    // imad 2026-11-11: "it freezes for seconds and closes the whole My PC" with USB films. A folder read asked the drive about every
    // entry in one go on My PC's own thread (a slow drive: seconds without an answer). Now a few at a time: My PC never stops long
    await page.evaluate((D) => { for (let i = 0; i < 300; i++) window.__usb.put(D + '/Big/Film ' + i + ' (2020).mkv', new Uint8Array(10)); window.__usb.cost = 4; }, D);
    await page.evaluate(() => { window.__gap = 0; let last = performance.now(); window.__probe = setInterval(() => { const n = performance.now(); window.__gap = Math.max(window.__gap, n - last); last = n; }, 5); });
    const t0 = Date.now();
    const bigL = await app.evaluate((D) => MyPC.usb.list(D + '/Big').then((l) => l.length + ' ' + l[0].size, (e) => 'err ' + e.code), D);
    const gap = await page.evaluate(() => { clearInterval(window.__probe); window.__usb.cost = 0; return Math.round(window.__gap); });
    check(/^300 10$/.test(bigL) && gap < 120, 'a folder of 300 films on a slow drive is read in small pieces: My PC never stops more than ' + gap + ' ms (' + bigL + ', ' + (Date.now() - t0) + ' ms in all)');
    // a big poster next to a film (2000x3000) is made small before it is shown: a screen of them never fills the TV's memory
    await page.evaluate(async (D) => { const c = new OffscreenCanvas(2000, 3000), g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, 2000, 3000); const b = await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
        window.__usb.put(D + '/Big/Film 7 (2020).jpg', new Uint8Array(await b.arrayBuffer())); }, D);
    const pic = await app.evaluate((D) => new Promise((res) => { Usb.forget(); Usb.picture({ dir: D + '/Big', name: 'Film 7 (2020).mkv' }, (u) => { if (!u) return res('none'); const im = new Image(); im.onload = () => res(im.naturalWidth + 'x' + im.naturalHeight); im.src = u; }); }), D);
    const pic2 = await app.evaluate((D) => new Promise((res) => Usb.picture({ dir: D + '/Big', name: 'Film 8 (2020).mkv' }, (u) => res(u || 'none'))), D);
    check(pic === '320x480' && pic2 === 'none', 'a USB poster is shown 320 px wide (read once, one at a time), and only beside its own film ' + pic + ' / ' + pic2);
    // Settings > Remote buttons: Favorite gets the 2 key by "Press the button"; the 2 key then adds a favourite, CH + still pages
    await app.evaluate(() => UI.push(Buttons.screen()));
    await app.waitForTimeout(300);
    await key(DOWN, 2); await key(OK); await app.waitForTimeout(300); await key(OK); await app.waitForTimeout(300);
    await key(50); await app.waitForTimeout(400);
    const bm = await app.evaluate(() => ({ fav: Buttons.map().fav, two: Buttons.actionFor('2', false), red: Buttons.actionFor('red', false), row: document.querySelector('.screen.on .lb .vi.f .val') && document.querySelector('.screen.on .lb .vi.f .val').textContent }));
    await shot('10-remote-buttons');
    const before = await app.evaluate(() => { window.__acts.length = 0; return 0; });
    await key(50); await key(427); await app.waitForTimeout(300);
    const got = await app.evaluate((n) => window.__acts.slice(n), before);
    check(bm.fav === '2' && bm.two === 'fav' && bm.red === '' && /Number 2/.test(bm.row) && got.indexOf('fav') >= 0 && got.indexOf('pageUp') >= 0,
        'Settings > Remote buttons: "Press the button" gives Favorite the 2 key (it reaches Speedy by name), CH + still pages ' + JSON.stringify({ bm, got }));
    // the remote's Guide key (the button between CH + and CH − on imad's remote) and any other key of the TV can be learned too
    await key(UP, 2); await key(DOWN, 3); await key(OK); await app.waitForTimeout(300); await key(OK); await app.waitForTimeout(300);
    await key(458); await app.waitForTimeout(400);
    await page.evaluate(() => { Input.BUTTONS[10225] = 'k10225'; });
    await key(DOWN); await key(OK); await app.waitForTimeout(300); await key(OK); await app.waitForTimeout(300);
    await key(10225); await app.waitForTimeout(400);
    const gm = await app.evaluate(() => ({ menu: Buttons.map().menu, search: Buttons.map().search, g: Buttons.actionFor('guide', false), k: Buttons.actionFor('k10225', false), lab: Buttons.label('k10225') }));
    await shot('10b-remote-buttons-guide');
    check(gm.menu === 'guide' && gm.search === 'k10225' && gm.g === 'menu' && gm.k === 'search' && gm.lab === 'Button 10225' && await page.evaluate(() => GameHost.state()) === 'running',
        'the remote\'s Guide key and a key My PC has no name for can be given to an action too (Guide stays in Speedy) ' + JSON.stringify(gm));
    await app.evaluate(() => Store.setPref('btns', {}));
    await tvBack(page); await page.waitForTimeout(700);
    check(stats.live >= 0, 'requests: ' + JSON.stringify({ api: stats.api, film: stats.film }));
    check(!page.errors.length, 'no page errors ' + page.errors.join(' | '));
    await page.context().close();
}
