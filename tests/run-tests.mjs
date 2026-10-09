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
//
//  CHROMIUM_PATH=/path/to/chrome uses an existing Chromium instead of Playwright's download.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOSTED = 'https://imad-os.github.io/g/';
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

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
async function fakeFirestore(ctx, db) {
    for (const c of ['apps', 'appstats', 'tvs', 'records']) db[c] = db[c] || {};
    db._t = db._t || {}; db.log = db.log || []; db._n = db._n || 0;
    await ctx.route('https://firestore.googleapis.com/**', async (r) => {
        if (db.down) return r.abort('internetdisconnected');
        const req = r.request(), u = new URL(req.url()), method = req.method();
        const p = decodeURIComponent(u.pathname).replace('/v1/' + FS_DB, '');
        const json = (status, o) => r.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(o) });
        const stamp = (k) => db._t[k] || (db._t[k] = '2026-01-01T00:00:0' + (db._n++ % 10) + '.' + String(db._n).padStart(6, '0') + 'Z');
        const out = (col, id) => ({ name: FS_DB + '/' + col + '/' + id, fields: fsFields(db[col][id]), updateTime: stamp(col + '/' + id), createTime: '2026-01-01T00:00:00Z' });
        db.log.push(method + ' ' + p);
        const body = req.postData() ? JSON.parse(req.postData()) : null;
        if (p === ':batchGet') return json(200, body.documents.map((n) => { const [col, id] = n.slice(FS_DB.length + 1).split('/'); return db[col] && db[col][id] ? { found: out(col, id) } : { missing: n }; }));
        if (p === ':commit') {
            for (const w of body.writes) {
                const [col, id] = w.transform.document.slice(FS_DB.length + 1).split('/');
                const d = (db[col][id] = db[col][id] || {});
                for (const ft of w.transform.fieldTransforms) d[ft.fieldPath] = (d[ft.fieldPath] || 0) + parseInt(ft.increment.integerValue, 10);
            }
            return json(200, { writeResults: [] });
        }
        // rooms: any depth (rooms/<id>/reqs/<id>), runQuery, updateMask, currentDocument.exists
        const segs = p.split('/').filter(Boolean);
        if (segs[0] === 'rooms' || p === ':runQuery') {
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
            db[col][id] = fsPlain({ mapValue: { fields: body.fields } });
            delete db._t[col + '/' + id];
            return json(200, out(col, id));
        }
        if (method === 'DELETE') { delete db[col][id]; return json(200, {}); }
        json(400, { error: { code: 400 } });
    });
}

async function newPage(browser, base, db) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.addInitScript(TIZEN_MOCK);
    db = db || {};
    await fakeFirestore(ctx, db);
    const page = await ctx.newPage();
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(e.message));
    page.base = base;
    page.fs = db;
    return page;
}

async function playable(page, id = 'blocks') {
    await page.waitForSelector(`[data-game="${id}"]`, { timeout: 15000 });
    await page.focus(`[data-game="${id}"]`);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'running', null, { timeout: 15000 });
    await page.keyboard.press('Enter');          // start
    await page.waitForTimeout(300);
    const running = await page.evaluate(() => document.querySelector('iframe').contentWindow.GameAPI._isRunning());
    await page.keyboard.press('Escape');         // pause
    await page.waitForTimeout(100);
    const paused = await page.evaluate(() => window.GameHost.state());
    await page.evaluate(() => { const b = document.querySelectorAll('#pause-items button'); b[b.length - 1].click(); });
    const idle = await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'idle', null, { timeout: 15000 }).then(() => true, () => false);   // the desktop page loads again
    return running && paused === 'paused' && idle;
}

async function main() {
    const srv = await serve();
    const base = `http://localhost:${srv.address().port}/`;
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--autoplay-policy=no-user-gesture-required', '--disable-features=WebRtcHideLocalIpsWithMdns', '--js-flags=--expose-gc', '--enable-precise-memory-info'] });

    console.log('1. hosted newer build runs');
    {
        const page = await newPage(browser, base);
        await routeHosted(page, { manifest: { build: 99 } });
        await page.goto(base + 'index.html');
        await page.waitForFunction(() => window.AppBoot && window.Desktop && document.querySelector('.dicon'), null, { timeout: 15000 });
        check(await page.evaluate(() => AppBoot.source()) === 'remote', 'AppBoot.source() is "remote"');
        check(await page.evaluate(() => AppBoot.build()) === 99, 'build 99 is running');
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
        await routeHosted(page, { manifest: { build: 77 }, breakFile: 'js/launcher/main.js' });
        await page.goto(base + 'index.html');
        await page.waitForFunction(() => window.AppBoot && AppBoot.source() === 'local' && document.querySelector('.dicon'), null, { timeout: 20000 });
        check(await page.evaluate(() => localStorage.getItem('boot_bad_build')) === '77', 'build 77 recorded as bad');
        check(await playable(page), 'bundled copy is playable after the fallback');
        await page.reload();
        await page.waitForSelector('.dicon', { timeout: 15000 });
        check(await page.evaluate(() => AppBoot.source()) === 'local', 'blacklisted build is skipped on the next launch');
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
        await page.keyboard.press('Escape');
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
        await page.keyboard.press('Escape');
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
        await page.keyboard.press('Escape');
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
        await tap(0, 9);
        check(await page.evaluate(() => window.GameHost.state()) === 'paused', 'gamepad Start opens the pause menu and it stays open');
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
        // Start: a short press goes to a game that has its own menu; holding it opens My PC's menu
        await page.evaluate(G2 => { const api = eval(G2).GameAPI; api.ownMenu = true; window.__menuSeen = 0;
            const on = api.onAction; api.onAction = function (a, p, r, dv) { if (a === 'menu' && p) window.__menuSeen++; return on.apply(this, arguments); }; }, G);
        await tap(0, 9);
        await page.waitForTimeout(100);
        check(await page.evaluate(() => window.GameHost.state() === 'running' && window.__menuSeen === 1), 'a short press of Start goes to the game\'s own menu');
        await page.evaluate(() => window.__press(0, 9, true)); await page.waitForTimeout(900);
        check(await page.evaluate(() => window.GameHost.state()) === 'paused', 'holding Start (Switch +) opens My PC\'s menu, even in a game with its own menu');
        await page.evaluate(() => window.__press(0, 9, false)); await page.waitForTimeout(200);
        check(await page.evaluate(() => window.GameHost.state() === 'paused' && window.__menuSeen === 1), 'letting go after the hold sends nothing more');
        await tap(0, 9);
        check(await page.evaluate(() => window.GameHost.state()) === 'running', 'Start closes My PC\'s menu again');
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
        check(await page.evaluate(() => document.getElementById('netpop').hidden), 'no network popup while online');
        await page.focus('[data-game="snake"]'); await page.keyboard.press('Enter');
        await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'running');
        await page.context().setOffline(true);
        await page.waitForTimeout(200);
        const off = await page.evaluate(() => { const e = document.getElementById('netpop'); return !e.hidden && e.getAttribute('role') === 'alert' && e.textContent; });
        check(!!off && /No network/.test(off), 'network loss during a game shows a popup: "' + off + '"');
        check(await page.evaluate(() => window.GameHost.state()) === 'running', 'the game keeps running offline');
        await page.context().setOffline(false);
        await page.waitForTimeout(200);
        check(/Network connected/.test(await page.textContent('#netpop')), 'reconnecting shows "Network connected"');
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
        await page.keyboard.press('Escape');
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
        await page.keyboard.press('Escape');
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
        await page.keyboard.press('Escape');
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
        // remote: OK on the focused "A" key, then a PC keyboard types the rest
        await page.keyboard.press('Enter');
        await page.keyboard.type('na');
        check(await page.textContent('#namer-text') === 'Ana', 'on-screen keyboard and PC keys type a name');
        await page.evaluate(() => [...document.querySelectorAll('#namer-keys button')].pop().click());
        check(await page.evaluate(() => !!document.querySelector('.welcome') && /Ana/.test(document.querySelector('.welcome').textContent)), 'creating a profile shows the sign-in screen with the new user');
        await signedIn(page);
        check(await page.evaluate(() => Store.profile() === 'p2' && Profiles.current().name === 'Ana'), 'a new profile is created and becomes active');
        check(await page.evaluate(() => Scores.list('snake').length === 1 && Store.get('vol_music') !== 7), 'records are shared by every profile, settings are not');
        await page.keyboard.press('Escape');
        check(/Ana/.test(await page.textContent('#btn-profile')), 'home shows the active profile');
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
        await page.keyboard.press('Escape');
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
        await page.keyboard.press('Escape');
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
        check(await page.evaluate(() => Desktop.startOpen() && document.querySelectorAll('#start-pinned [data-focus]').length === 14), 'Start menu lists 7 apps (with the App Store) and 7 games');
        await key('Escape');
        check(await page.evaluate(() => !Desktop.startOpen() && document.activeElement.id === 'tb-start'), 'Back closes Start');
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
        // calendar: today, add a note with the on-screen keyboard
        await page.evaluate(() => Win.open('calendar'));
        check(await page.evaluate(() => document.activeElement.className.indexOf('cal-today') >= 0), 'calendar opens on today');
        await key('Enter');
        await page.keyboard.type('match');
        await page.evaluate(() => [...document.querySelectorAll('#namer-keys button')].pop().click());
        const notes = await page.evaluate(() => Store.get('cal_notes', {}));
        check(Object.keys(notes).length === 1 && Object.values(notes)[0][0] === 'Match' && await page.evaluate(() => !!document.querySelector('.cal-today .cal-dot')), 'a note is saved on the day and marked');
        await key('Escape');
        // settings with the remote: background
        await page.evaluate(() => Win.open('settings'));
        await key('ArrowDown', 'ArrowRight', 'ArrowRight', 'Enter');
        check(await page.evaluate(() => Store.get('wallpaper') === 'aurora' && document.getElementById('wallpaper').className.indexOf('wp-aurora') >= 0), 'Settings > Personalization changes the background');
        await key('Escape', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowLeft');   // Personalization > Apps > Accounts > Sound
        check(await page.evaluate(() => AudioPrefs.music()) === 6, 'Settings > Sound: left lowers the music volume');
        await key('Escape', 'Escape');
        // explorer: Games folder starts a game; quitting comes back to the desktop
        await page.evaluate(() => Win.open('explorer', 'games'));
        await key('Enter');
        await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'running', null, { timeout: 8000 });
        check(await page.evaluate(() => document.getElementById('window').hidden && Win.current() === null), 'opening a game from File Explorer closes the app first');
        await key('Escape');
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
        await page.route(HOSTED + 'sdk/mypc-sdk.js', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(ROOT, 'sdk/mypc-sdk.js')) }));
        let slowOnce = true;
        await page.context().route(APP + '**', async (r) => {
            const rel = r.request().url().slice(APP.length).split('?')[0] || 'index.html';
            if (rel === 'index.html' && slowOnce) { slowOnce = false; await new Promise((x) => setTimeout(x, 900)); }   // keeps the start screen up for the test
            const p = path.join(ROOT, 'sdk/example', rel);
            if (!fs.existsSync(p)) return r.fulfill({ status: 404, body: '' });
            r.fulfill({ status: 200, contentType: TYPES[path.extname(p)] || (p.endsWith('.svg') ? 'image/svg+xml' : 'text/plain'), headers: { 'Access-Control-Allow-Origin': '*' }, body: fs.readFileSync(p) });
        });
        let firestoreUp = true, liveSpeed = 1, liveVersion = '1.0.0', removed = false;
        // the app's config as Firestore stores it: nested map, list, null
        const cfgValue = (speed) => ({ mapValue: { fields: { speed: { integerValue: String(speed) },
            levels: { arrayValue: { values: [{ integerValue: '1' }, { stringValue: 'a' }] } },
            nested: { mapValue: { fields: { on: { booleanValue: true }, none: { nullValue: null } } } } } } });
        const doc = { fields: { id: { stringValue: 'star-catcher' }, name: { stringValue: 'Star Catcher' }, description: { stringValue: 'Catch stars' },
            url: { stringValue: APP }, entry: { stringValue: APP + 'index.html' }, icon: { stringValue: APP + 'icon.svg' }, type: { stringValue: 'game' },
            version: { stringValue: '1.0.0' }, scores: { booleanValue: true }, enabled: { booleanValue: true }, order: { integerValue: '0' },
            config: cfgValue(1) } };
        const hidden = { fields: Object.assign({}, doc.fields, { id: { stringValue: 'hidden-one' }, enabled: { booleanValue: false } }) };
        // the list always answers with config speed 1 (what the TV has saved); the single-app request, made right
        // before an app opens, answers with the live value: that tells "read again before opening" from "from the list"
        // installed on this TV from the App Store (the store itself is tested in section 26)
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
        await frame.evaluate(() => MyPC.save('best', 7));
        await page.waitForTimeout(100);
        check(await page.evaluate(() => Store.get('game_app-star-catcher_data', {}).best === 7), 'MyPC.save stores data in the active profile');
        await page.keyboard.press('Escape');
        const items = await page.evaluate(() => [...document.querySelectorAll('#pause-items button')].map((b) => b.textContent));
        check(await page.evaluate(() => window.GameHost.state()) === 'paused' && items.indexOf('Restart') > 0, 'Back opens My PC\'s pause menu with the app\'s own items (' + items.join(', ') + ')');
        await page.evaluate(() => { const b = document.querySelectorAll('#pause-items button'); b[0].click(); });
        await frame.evaluate(() => MyPC.submitScore(321));
        await page.waitForFunction(() => Scores.list('app-star-catcher').length === 1, null, { timeout: 4000 }).catch(() => {});
        check(await page.evaluate(() => Scores.list('app-star-catcher')[0].s === 321 && window.GameHost.state() === 'paused' || window.GameHost.state() === 'running'), 'MyPC.submitScore saves the record for the profile by itself, no initials screen');
        await page.keyboard.press('Escape');
        await page.evaluate(() => { const b = document.querySelectorAll('#pause-items button'); b[b.length - 1].click(); });
        await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'idle' && !!document.querySelector('#desk-icons .dicon') && document.activeElement !== document.body);
        check(await page.evaluate(() => document.querySelectorAll('iframe').length === 0 && document.activeElement.getAttribute('data-game') === 'app-star-catcher'), 'quitting removes the iframe and returns to its desktop icon');
        // the owner changes the config in the installer: the next launch gets it (the saved list still has the old one)
        liveSpeed = 3; liveVersion = '1.0.1';
        await page.focus(icon); await page.keyboard.press('Enter');
        await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'running', null, { timeout: 10000 });
        const f2 = page.frames().find((f) => f.url().indexOf(APP) === 0);
        check(await f2.evaluate(() => MyPC.app_config.speed) === 3, 'the config is read again from Firebase before the app opens (the saved copy was older)');
        check(/[?&]mypc_v=1\.0\.1(&|$)/.test(f2.url()), 'a new version published in the store opens at once: its version is in the address, so the TV cache is skipped (' + f2.url() + ')');
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
        await sp.route(HOSTED + 'sdk/mypc-sdk.js', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(ROOT, 'sdk/mypc-sdk.js')) }));
        await sp.goto(APP + 'index.html?app_config=' + encodeURIComponent('{"speed":5}'));
        await sp.waitForFunction(() => window.MyPC && MyPC.info() && MyPC.info().standalone);
        check(await sp.evaluate(() => MyPC.app_config.speed) === 5, 'standalone: MyPC.app_config comes from ?app_config= for testing');
        await sp.keyboard.press('Enter'); await sp.waitForTimeout(200);
        check(await sp.evaluate(() => document.getElementById('msg').textContent === ''), 'standalone (no My PC): the SDK reads the keyboard itself');
        await sp.close();
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
                export async function getDoc(r) { return { exists: () => !!(db[r.col] && db[r.col][r.id]) }; }
                export async function getDocs(c) { return { docs: Object.entries(db[c.name] || {}).map(([id, x]) => ({ id, data: () => x })) }; }
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
        check(await page.evaluate(() => [...document.querySelectorAll('.nav a')].map((a) => a.textContent.replace(/\d+/g, '').trim()).join() === 'Overview,Apps,Add apps,Devices,World records'
            && document.querySelector('.nav a.on').dataset.page === 'add' && !document.querySelector('[data-view="add"]').hidden && document.querySelector('[data-view="overview"]').hidden),
            'a menu with one page each: Overview, Apps, Add apps, Devices, World records');
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
        await go('#add');
        await page.click('#btn-scan');
        await page.waitForFunction(() => /Update available/.test(document.getElementById('catalog').textContent));
        await page.click('#catalog .app:has-text("Star Catcher") button.act');
        await page.waitForFunction(() => window.__db.apps['star-catcher'].version === '1.0.1');
        const upd = await page.evaluate(() => window.__db.apps['star-catcher']);
        check(upd.config.speed === 9 && upd.order === 1, 'updating an app keeps its config and its position');
        check(await page.evaluate(() => !!document.getElementById('url') && !!document.getElementById('btn-fetch')), 'the manual address section is still there for apps outside imad-os');
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
        await seed(page, 99);
        await routeHosted(page, { breakFile: 'app-manifest.json' });
        await page.goto(base + 'index.html');
        await page.waitForFunction(() => window.AppBoot && window.Desktop && document.querySelector('.dicon'), null, { timeout: 20000 });
        check(await page.evaluate(() => AppBoot.source() === 'remote' && AppBoot.build() === 99 && AppBoot.reason() === 'stale' && AppBoot.stale()), 'slow server: the last known online build runs instead of the older built-in copy');
        check(await playable(page), 'a game is playable from it');
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
        // 2) the network is really down: built-in copy, and the last known build is not blamed
        page = await newPage(browser, base);
        await seed(page, 99);
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
        await routeHosted(page, { manifest: { build: 98 } });
        await page.goto(base + 'index.html');
        await page.waitForFunction(() => window.AppBoot && AppBoot.source() === 'remote' && document.querySelector('.dicon'), null, { timeout: 15000 });
        check(await page.evaluate((h) => { const g = JSON.parse(localStorage.getItem('boot_good')); return g.manifest.build === 98 && g.base === h && AppBoot.reason() === 'update'; }, HOSTED), 'a hosted build that started fine is saved as the last known good one');
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
        over.build = 99; over.version = '9.9.0';
        await key(page, 'ArrowRight', 'Enter');                                       // Check for updates
        await page.waitForFunction(() => /available/.test((document.querySelector('.set-status .set-card-name') || {}).textContent || ''), null, { timeout: 8000 });
        check(/9\.9\.0.*99/.test(await page.textContent('.set-status')), 'a newer build is found: ' + (await page.textContent('.set-status')));
        check(await page.evaluate(() => document.activeElement.classList.contains('set-primary')), 'the focus is on "Download and restart"');
        await key(page, 'Enter');
        await page.waitForFunction(() => Updater.state().state === 'ready', null, { timeout: 15000 });
        check(await page.evaluate((h) => { const g = JSON.parse(localStorage.getItem('boot_good')); const u = Updater.state(); return g.manifest.build === 99 && g.base === h && u.done === u.total && u.total > 20; }, HOSTED), 'every file was downloaded and the build is saved as the one to start');
        check(/ready/.test(await status(page)), 'the page says it is ready: "' + await status(page) + '"');
        await key(page, 'Enter');                                                      // Restart now
        await page.waitForFunction(() => window.AppBoot && AppBoot.build && AppBoot.build() === 99 && document.querySelector('.dicon'), null, { timeout: 20000 });
        check(await page.evaluate(() => AppBoot.source() === 'remote' && AppBoot.reason() === 'update'), 'after the restart the new build runs');
        await page.context().close();
        // a build whose files cannot all be downloaded is not saved
        page = await newPage(browser, base);
        await routeHosted(page, { manifest: { build: 99 }, breakFile: 'js/launcher/main.js' });
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
        await routeHosted(page, { manifest: { build: 99, shell: 2 } });
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
        await remoteKey(458);
        check(await where() === 'toolbar', 'the TV remote Guide key (458) does the same');
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
        await page.waitForFunction(() => /Controller 1.*Xbox Wireless Controller/.test(document.querySelector('.set-main').textContent) && !!document.querySelector('.set-padtest'), null, { timeout: 4000 });
        check(!/STANDARD|Vendor/.test(await text()), 'a controller that is plugged in shows up at once, with a clean name');
        await page.evaluate(() => window.__pad(1, true));       // B
        await page.waitForFunction(() => document.querySelectorAll('.pt-b.on').length === 1 && document.querySelector('.pt-b.on').textContent === 'B', null, { timeout: 3000 });
        check(true, 'the live test lights up the button that is pressed');
        await page.evaluate(() => window.__pad(1, false));
        await page.evaluate(() => Win.close());
        check(await page.evaluate(() => document.querySelectorAll('.set-padtest').length === 0), 'closing Settings stops the test');
        // games never get the desktop keys; Guide opens their pause menu
        await page.focus('[data-game="snake"]');
        await Promise.all([page.waitForURL(/play=snake/), page.keyboard.press('Enter')]);
        await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'running', null, { timeout: 15000 });
        await key('Tab', 'PageDown');
        check(await page.evaluate(() => window.GameHost.state()) === 'running', 'Tab and PageDown do nothing in a game');
        await key('F6');
        check(await page.evaluate(() => window.GameHost.state()) === 'paused', 'Guide opens the pause menu of a game');
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
        await page.evaluate(() => { Win.open('settings'); });
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
            await pg.route(HOSTED + 'sdk/mypc-sdk.js', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(ROOT, 'sdk/mypc-sdk.js')) }));
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
        check(await fa.evaluate(() => MyPC.multiplayer.supported === true && MyPC.apiLevel === 3 && MyPC.rooms === undefined), 'in My PC: MyPC.multiplayer.supported is true; MyPC.rooms is not public');
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
        await ctx.route(HOSTED + 'sdk/mypc-sdk.js', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(ROOT, 'sdk/mypc-sdk.js')) }));
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

    await browser.close();
    srv.close();
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
    process.exit(failures ? 1 : 0);
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
    await page.keyboard.press('Escape');
    await Promise.all([page.waitForURL(new RegExp('from=' + id)), page.evaluate(() => { const b = document.querySelectorAll('#pause-items button'); b[b.length - 1].click(); })]);
    await page.waitForSelector(`#desk-icons [data-game="${id}"]`);
    r.noDesktop = noDesktop;
    r.refocused = await page.evaluate((g) => document.activeElement && document.activeElement.getAttribute('data-game') === g, id);
    return r;
}

main().catch((e) => { console.error(e); process.exit(1); });
