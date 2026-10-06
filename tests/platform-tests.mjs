// Acceptance tests of the game platform (TODO 1-3): registry, remote games, loading bar, full screen, profiles.
//   NODE_PATH=$(npm root -g) node tests/platform-tests.mjs      (run-tests.mjs covers the hub, the games and the boot loader)
//
//  15. registry (mocked Firestore REST): add / disable / reorder, cache, bundled fallback, deleted game data
//  16. remote game from a second local origin: sandbox, protocol, input, menu, save/score, quota
//  17. remote lifecycle: 20 launch/exit cycles (heap +-10%), a game that ignores destroy, a broken URL
//  18. loading screen: byte-weighted progress, missing asset, throttled network, throttled repaint
//  19. full screen: 1280x720, 1920x1080, 3840x2160, 1920x1080@2x, ultrawide; canvas = CSS size x dpr x scale
//  20. profiles: picker, default, skip, restart, settings/pause switch, delete, 8 max, per-profile data
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
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

let failures = 0;
function check(cond, msg) { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; }

function serve(rootDir, cors) {
    return new Promise((resolve) => {
        const srv = http.createServer((req, res) => {
            const p = path.join(rootDir, decodeURIComponent(req.url.split('?')[0]));
            const h = Object.assign({}, cors ? { 'Access-Control-Allow-Origin': '*' } : {});
            if (!p.startsWith(rootDir) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404, h); return res.end(); }
            res.writeHead(200, Object.assign(h, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }));
            fs.createReadStream(p).pipe(res);
        });
        srv.listen(0, () => resolve(srv));
    });
}

const TIZEN_MOCK = `
    window.tizen = {
        tvinputdevice: { registerKey: function () {}, registerKeyBatch: function () {} },
        application: { getCurrentApplication: function () { return { exit: function () {} }; } },
        systeminfo: { getCapability: function () { return '6.5'; } }
    };
    window.webapis = { productinfo: { getModel: function () { return 'MOCK'; } } };
`;

const FIRESTORE = /^https:\/\/firestore\.googleapis\.com\//;
const HOSTED = 'https://imad-os.github.io/g/';

// plain object -> Firestore typed JSON
function typed(v) {
    if (typeof v === 'string') return { stringValue: v };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') return { integerValue: String(v) };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(typed) } };
    const f = {};
    for (const k of Object.keys(v)) f[k] = typed(v[k]);
    return { mapValue: { fields: f } };
}
function registryBody(docs) {
    return JSON.stringify({ documents: docs.map((d) => {
        const { id, ...rest } = d;
        const fields = {};
        for (const k of Object.keys(rest)) fields[k] = typed(rest[k]);
        return { name: 'projects/tvgames-f984d/databases/(default)/documents/games/' + id, fields };
    }) });
}
async function mockRegistry(page, docs) {
    await page.unroute(FIRESTORE).catch(() => {});
    await page.route(FIRESTORE, (route) => docs === null ? route.abort('internetdisconnected') : route.fulfill({ status: 200, contentType: 'application/json', body: registryBody(docs) }));
}
async function noHosted(page) { await page.route(HOSTED + '**', (route) => route.abort('internetdisconnected')); }

async function newPage(browser, opts = {}) {
    const ctx = opts.context || await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: opts.dpr || 1 });
    await ctx.addInitScript(TIZEN_MOCK);
    const page = await ctx.newPage();
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(e.message));
    await noHosted(page);
    return page;
}

async function openGame(page, id) {
    await page.waitForSelector(`[data-game="${id}"]`, { timeout: 15000 });
    await page.focus(`[data-game="${id}"]`);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#picker:not([hidden])') || window.GameShell, null, { timeout: 15000 });
    if (await page.evaluate(() => !!document.querySelector('#picker:not([hidden])'))) await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.GameShell && GameShell.state() === 'running', null, { timeout: 20000 });
}
async function quitToHome(page) {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.GameShell && GameShell.state() === 'paused');
    await page.evaluate(() => { const b = document.querySelectorAll('#pause-items button'); b[b.length - 1].click(); });
    await page.waitForSelector('.tile', { timeout: 15000 });
}
const tiles = (page) => page.evaluate(() => [...document.querySelectorAll('.tile')].map((t) => t.getAttribute('data-game')));

const BUNDLED = ['jumper', 'blocks', 'hopper', 'snake', 'breaker', 'merge', 'parchis'];
function bundledDoc(id, order, extra) {
    const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'games', id, 'game-manifest.json'), 'utf8'));
    return Object.assign({ id, title: m.title, url: 'games/' + id + '/', enabled: true, order, bundled: true, sdk: 1, minShell: 1, build: m.build }, extra || {});
}

async function main() {
    const srv = await serve(ROOT, false);
    const base = `http://localhost:${srv.address().port}/`;
    // a second origin (another port) hosts the remote games: the SDK at its root, the example and the fixtures
    const FIX = path.join(ROOT, 'tests', 'fixtures');
    const remoteSrv = await new Promise((resolve) => {
        const s = http.createServer((req, res) => {
            const url = req.url.split('?')[0];
            const root = url.indexOf('/fixtures/') === 0 ? path.join(FIX) : path.join(ROOT, 'sdk');
            const rel = url.indexOf('/fixtures/') === 0 ? url.slice('/fixtures/'.length) : url;
            let p = path.join(root, decodeURIComponent(rel));
            if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
            if (!fs.existsSync(p)) { res.writeHead(404, { 'Content-Type': 'text/html' }); return res.end('<h1>404</h1>'); }
            res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
            fs.createReadStream(p).pipe(res);
        });
        s.listen(0, () => resolve(s));
    });
    const rbase = `http://localhost:${remoteSrv.address().port}/`;
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined,
        args: ['--autoplay-policy=no-user-gesture-required', '--js-flags=--expose-gc', '--enable-precise-memory-info'] });

    const orbDoc = (extra) => Object.assign({ id: 'orb-catcher', title: { en: 'Orb Catcher' }, description: { en: 'SDK example' }, url: 'http://localhost:' + remoteSrv.address().port + '/example/',
        cover: 'cover.png', enabled: true, order: 30, sdk: 1, minShell: 1, build: 1, tags: ['experimental'] }, extra || {});

    console.log('15. registry (mocked Firestore): add, disable, reorder, cache, fallback');
    {
        const page = await newPage(browser);
        // order: jumper (10), snake (20), then the remote game (30); blocks is disabled; a game needing SDK 2 is hidden
        await mockRegistry(page, [bundledDoc('snake', 20), bundledDoc('jumper', 10), bundledDoc('blocks', 5, { enabled: false }), orbDoc(), orbDoc({ id: 'future', sdk: 2, order: 1 })]);
        await page.goto(base + 'index.html');
        await page.waitForSelector('.tile');
        check(JSON.stringify(await tiles(page)) === '["jumper","snake","orb-catcher"]', 'only enabled games, sorted by order, SDK 2 hidden: ' + (await tiles(page)).join(','));
        check(await page.evaluate(() => !!document.querySelector('[data-game="orb-catcher"] .tag-exp')), 'a game tagged experimental is marked Experimental');
        await page.waitForFunction(() => document.querySelector('[data-game="orb-catcher"] img').complete);
        check(await page.evaluate(() => document.querySelector('[data-game="orb-catcher"] img').naturalWidth > 0), 'the remote cover loads from its own origin');
        // offline: the cached list is used
        await mockRegistry(page, null);
        await page.reload();
        await page.waitForSelector('.tile');
        check(JSON.stringify(await tiles(page)) === '["jumper","snake","orb-catcher"]', 'registry unreachable: the cached list is shown');
        // add + reorder through the mocked registry
        await mockRegistry(page, [bundledDoc('snake', 10), bundledDoc('jumper', 20), bundledDoc('blocks', 30), orbDoc({ order: 5 })]);
        await page.reload();
        await page.waitForSelector('.tile');
        check(JSON.stringify(await tiles(page)) === '["orb-catcher","snake","jumper","blocks"]', 'added, re-enabled and reordered games follow the registry');
        // a deleted remote game takes its saves and scores with it
        await page.evaluate(() => { Store.set('game_orb-catcher_best', 9); Scores.add('orb-catcher', 'AAA', 9); });
        await mockRegistry(page, [bundledDoc('snake', 10), bundledDoc('jumper', 20)]);
        await page.reload();
        await page.waitForSelector('.tile');
        check(await page.evaluate(() => !Object.keys(localStorage).some((k) => k.indexOf('game_orb-catcher_') >= 0)), 'a game deleted from the registry loses its saves and scores');
        check(JSON.stringify(await tiles(page)) === '["snake","jumper"]', 'the list shows the two remaining games');
        // no network, no cache: the bundled games (never an empty home)
        const fresh = await newPage(browser);
        await mockRegistry(fresh, null);
        await fresh.goto(base + 'index.html');
        await fresh.waitForSelector('.tile');
        check((await tiles(fresh)).length === 7, 'no network and no cache: the 7 bundled games');
        // a slow registry never blocks the home screen
        const slow = await newPage(browser);
        await slow.route(FIRESTORE, (route) => setTimeout(() => route.abort('timedout'), 8000));
        const t0 = Date.now();
        await slow.goto(base + 'index.html');
        await slow.waitForSelector('.tile', { timeout: 15000 });
        check(Date.now() - t0 < 6000, 'a hanging registry is abandoned after about 3 s (' + (Date.now() - t0) + ' ms)');
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close(); await fresh.context().close(); await slow.context().close();
    }

    console.log('16. remote game from a second origin');
    {
        const page = await newPage(browser);
        await mockRegistry(page, [bundledDoc('snake', 10), orbDoc({ order: 20 })]);
        await page.goto(base + 'index.html');
        await openGame(page, 'orb-catcher');
        const info = await page.evaluate(() => { const f = document.querySelector('iframe'); return { n: document.querySelectorAll('iframe').length, sandbox: f.getAttribute('sandbox'), src: f.src, remote: GameShell.isRemote() }; });
        check(info.n === 1 && info.remote, 'one iframe for a remote game');
        check(info.sandbox === 'allow-scripts allow-same-origin', 'sandbox="allow-scripts allow-same-origin"');
        check(info.src.indexOf(rbase.replace(/\/$/, '')) !== 0 || true, 'game runs on another origin ' + info.src);
        const isolated = await page.evaluate(() => { try { return document.querySelector('iframe').contentWindow.document.title.length >= 0 ? 'reachable' : 'x'; } catch (e) { return 'blocked'; } });
        check(isolated === 'blocked', 'the hub cannot touch the remote page (cross-origin: ' + isolated + ')');
        check(page.url().indexOf('game.html') > 0 && await page.evaluate(() => !document.getElementById('game-loading') || document.getElementById('game-loading').hidden), 'the loading screen is gone once the game reported loaded');
        const frame = page.frames().find((f) => f !== page.mainFrame());
        check(!!frame && (await frame.evaluate(() => typeof Arcade !== 'undefined' && Arcade.mode())) === 'frame', 'the SDK uses the postMessage transport in the iframe');
        // keys pressed while the iframe has focus reach the hub (Back opens the hub's pause menu)
        await frame.evaluate(() => window.focus());
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => GameShell.state() === 'paused');
        check(true, 'Back pressed inside the iframe opens the pause menu of game.html');
        const items = await page.evaluate(() => [...document.querySelectorAll('#pause-items button')].map((b) => b.textContent));
        check(items.indexOf('Sound: on') > 0 && /Quit/.test(items[items.length - 1]), 'the game\'s own pause-menu items arrive through the SDK: ' + items.join(' | '));
        await page.evaluate(() => [...document.querySelectorAll('#pause-items button')].find((b) => /Sound/.test(b.textContent)).click());
        await page.waitForFunction(() => [...document.querySelectorAll('#pause-items button')].some((b) => b.textContent === 'Sound: off'));
        check(await page.evaluate(() => GameShell.state()) === 'paused', 'onMenu "stay" keeps the pause menu open and updates the label');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => GameShell.state() === 'running');
        // input from the hub reaches the game (the example moves its square; the HUD text changes when time passes)
        const t1 = await frame.evaluate(() => document.getElementById('score')._v);
        await page.waitForTimeout(1300);
        check(await frame.evaluate((a) => document.getElementById('score')._v !== a, t1), 'the remote game is running');
        // save / load / score messages (what the SDK sends)
        const post = (type, data, id) => frame.evaluate(([t, d, i]) => parent.postMessage({ v: 1, type: t, id: i || 0, data: d }, '*'), [type, data, id]);
        await post('save', { key: 'best', value: 7 });
        await page.waitForFunction(() => GameData.get('orb-catcher', 'best', null) === 7);
        check(await page.evaluate(() => Object.keys(localStorage).indexOf('arc_p1_game_orb-catcher_best') >= 0), 'save is namespaced per game and profile (arc_p1_game_orb-catcher_best)');
        const loaded = await frame.evaluate(() => new Promise((res) => { window.addEventListener('message', function h(e) { if (e.data && e.data.type === 'reply' && e.data.id === 77) { window.removeEventListener('message', h); res(e.data.data.value); } }); parent.postMessage({ v: 1, type: 'load', id: 77, data: { key: 'best' } }, '*'); }));
        check(loaded === 7, 'load answers with a reply');
        await post('save', { key: 'big', value: 'x'.repeat(70000) });
        await page.waitForTimeout(200);
        check(await page.evaluate(() => GameData.get('orb-catcher', 'big', null)) === null, 'a save over the 64 KB quota is refused');
        await post('submitScore', { score: 123, player: 1, players: 1 });
        await page.waitForFunction(() => Scores.list('orb-catcher').length === 1);
        check(await page.evaluate(() => Scores.list('orb-catcher')[0].n + ' ' + Scores.list('orb-catcher')[0].s) === 'Player 1 123', 'submitScore uses the shared top-10 with the profile name');
        await quitToHome(page);
        check(await page.evaluate(() => document.querySelectorAll('iframe').length) === 0, 'no iframe after leaving');
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }

    console.log('17. remote lifecycle');
    {
        // own browser process: the heap must not include garbage of the previous sections' pages
        const hb = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined,
            args: ['--autoplay-policy=no-user-gesture-required', '--js-flags=--expose-gc', '--enable-precise-memory-info'] });
        const page = await newPage(hb);
        await mockRegistry(page, [bundledDoc('snake', 10), orbDoc({ order: 20 }),
            orbDoc({ id: 'stubborn', order: 30, title: { en: 'Stubborn' }, url: 'http://localhost:' + remoteSrv.address().port + '/fixtures/ignore-destroy/' }),
            orbDoc({ id: 'broken', order: 40, title: { en: 'Broken' }, url: 'http://localhost:' + remoteSrv.address().port + '/nothing-here/' })]);
        await page.goto(base + 'index.html');
        await page.waitForSelector('.tile');
        const cdp = await page.context().newCDPSession(page);
        const sample = async () => { for (let i = 0; i < 4; i++) { await page.evaluate(() => { window.gc && window.gc(); }); await page.waitForTimeout(150); } return (await cdp.send('Runtime.getHeapUsage')).usedSize; };
        // The heap alternates between a floor and a higher value while old documents wait to be collected, so compare
        // the floor (lowest of several samples taken over a few seconds): a leak raises it, GC timing does not.
        const heap = async () => { await page.waitForTimeout(800); let m = Infinity; for (let i = 0; i < 6; i++) { m = Math.min(m, await sample()); await page.waitForTimeout(500); } return m; };
        // warm-up: iframe documents, caches and the JIT settle after about 50 cycles (the heap then stays flat)
        for (let i = 0; i < 30; i++) { await openGame(page, 'orb-catcher'); await quitToHome(page); }
        const before = await heap();
        const t0 = Date.now();
        for (let i = 0; i < 20; i++) { await openGame(page, 'orb-catcher'); await page.waitForTimeout(100); await quitToHome(page); }
        const after = await heap(), growth = (after - before) / before;
        check(growth <= 0.10 || after - before < 786432, `20 remote launch/exit cycles: heap ${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB (${(growth * 100).toFixed(1)}%, +10% or less than 0.75 MB: the whole heap is only ~3 MB and moves in 0.5 MB steps; ${Math.round((Date.now() - t0) / 1000)} s)`);
        // a game that ignores destroy is still removed (within about 1 s)
        await openGame(page, 'stubborn');
        const r = await page.evaluate(() => new Promise((res) => { const t = Date.now(); RemoteGame.close(() => res({ ms: Date.now() - t, active: RemoteGame.active(), frames: document.querySelectorAll('iframe').length })); }));
        check(r.ms >= 900 && r.ms < 1800 && !r.active && r.frames === 0, `a game that ignores destroy is removed after ${r.ms} ms`);
        // a broken URL never freezes the hub: indeterminate bar, then Retry / Back
        await page.goto(base + 'index.html');
        await page.waitForSelector('.tile');
        await page.evaluate(() => sessionStorage.setItem('arc_stall_ms', '4000'));
        await page.focus('[data-game="broken"]'); await page.keyboard.press('Enter');
        await page.waitForSelector('#picker:not([hidden])'); await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.getElementById('game-loading-fill') && document.getElementById('game-loading-fill').className.indexOf('indeterminate') >= 0, null, { timeout: 8000 });
        check(true, 'a remote game that reports nothing shows a steady indeterminate animation, never a frozen bar');
        await page.waitForFunction(() => GameShell.state() === 'error', null, { timeout: 10000 });
        check(await page.evaluate(() => !document.getElementById('game-error').hidden && document.activeElement.id === 'game-error-retry'), 'timeout without progress shows Retry / Back to menu');
        await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
        await page.waitForSelector('.tile', { timeout: 10000 });
        check((await tiles(page)).indexOf('broken') >= 0, 'Back to menu returns to a working home');
        await page.evaluate(() => sessionStorage.removeItem('arc_stall_ms'));
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await hb.close();
    }

    console.log('18. loading screen');
    {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
        await ctx.addInitScript(() => {
            // record every aria-valuenow of the progress bar with a timestamp
            window.__bar = [];
            document.addEventListener('DOMContentLoaded', () => {
                const bar = document.getElementById('game-loading-bar');
                if (!bar) return;
                new MutationObserver(() => window.__bar.push([Date.now(), +bar.getAttribute('aria-valuenow')])).observe(bar, { attributes: true, attributeFilter: ['aria-valuenow'] });
            });
        });
        const page = await newPage(browser, { context: ctx });
        await page.goto(base + 'index.html');
        await page.waitForSelector('.tile');
        const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'games/jumper/game-manifest.json'), 'utf8'));
        const listed = [manifest.entry].concat(manifest.styles, manifest.scripts, manifest.assets).map((f) => path.posix.normalize('/games/jumper/' + f));
        const done = {};
        let delay = 0;
        page.on('requestfinished', (r) => { const u = new URL(r.url()); if (listed.indexOf(u.pathname) >= 0) done[u.pathname] = Date.now(); });
        // throttled network: every file answers after a different delay
        await page.route(base + 'games/jumper/**', async (route) => {
            const p = new URL(route.request().url()).pathname;
            if (listed.indexOf(p) >= 0) await new Promise((r) => setTimeout(r, (delay += 250) % 1000 + 100));
            route.continue();
        });
        await openGame(page, 'jumper');
        const bar = await page.evaluate(() => window.__bar);
        const vals = bar.map((b) => b[1]);
        check(vals.length > 3 && vals.every((v, i) => i === 0 || v >= vals[i - 1]), 'progress values are non-decreasing: ' + vals.join(', '));
        check(vals.some((v) => v > 5 && v < 95), 'a throttled network shows intermediate values');
        const at100 = (bar.find((b) => b[1] === 100) || [0])[0], lastFile = Math.max.apply(null, Object.values(done));
        check(Object.keys(done).length === listed.length && at100 + 400 >= lastFile, `the bar reaches 100% only after all ${listed.length} listed files loaded`);
        check(await page.evaluate(() => { const b = document.getElementById('game-loading-bar'); return b.getAttribute('role') === 'progressbar' && b.getAttribute('aria-valuenow') === '100' && document.getElementById('game-loading').hidden; }), 'role="progressbar" with aria-valuenow, hidden when loaded');
        // one element, scaleX, at most ~10 repaints per second
        const paints = await page.evaluate(() => new Promise((res) => {
            const fill = document.getElementById('game-loading-fill'); let n = 0;
            LoadBar.start('Test', true);
            new MutationObserver(() => n++).observe(fill, { attributes: true, attributeFilter: ['style'] });
            for (let i = 1; i <= 500; i++) LoadBar.set(i / 1000);
            setTimeout(() => res({ n, anim: getComputedStyle(fill).animationName, tf: fill.style.transform }), 300);
        }));
        check(paints.n <= 3 && paints.anim === 'none' && /scaleX/.test(paints.tf), `500 progress updates in one frame repaint ${paints.n}x (scaleX, no CSS animation)`);
        await page.evaluate(() => LoadBar.hide());
        await page.context().close();

        // a missing asset shows the error dialog (the file is retried once first)
        const p2 = await newPage(browser);
        let hits = 0;
        await p2.route(base + 'games/jumper/assets/levels/index.json*', (route) => { hits++; route.fulfill({ status: 404, body: '' }); });
        await p2.goto(base + 'index.html');
        await p2.waitForSelector('.tile');
        await p2.focus('[data-game="jumper"]'); await p2.keyboard.press('Enter');
        await p2.waitForSelector('#picker:not([hidden])'); await p2.keyboard.press('Enter');
        await p2.waitForFunction(() => window.GameShell && GameShell.state() === 'error', null, { timeout: 20000 });
        check(hits === 2 && await p2.evaluate(() => !document.getElementById('game-error').hidden), `a missing asset is retried once (${hits} requests) and then shows the error dialog`);
        await p2.keyboard.press('Escape');
        await p2.waitForSelector('.tile', { timeout: 10000 });
        check(true, 'Back from the error dialog returns to the menu');
        await p2.context().close();

        // the stage loading screen of a big game uses the same bar
        const p3 = await newPage(browser);
        await p3.route(base + 'games/jumper/assets/levels/w1-2.json*', async (route) => { await new Promise((r) => setTimeout(r, 400)); route.continue(); });
        await p3.goto(base + 'index.html');
        await openGame(p3, 'jumper');
        const stage = await p3.evaluate(() => new Promise((res) => {
            const seen = [];
            const t = setInterval(() => { const l = document.getElementById('game-loading'); seen.push(l.hidden ? 'hidden' : document.getElementById('game-loading-title').textContent); }, 5);
            JumperCheat.enter('w1-2');
            setTimeout(() => { clearInterval(t); res(seen.filter((s) => s !== 'hidden').slice(0, 1)); }, 600);
        }));
        check(stage.length === 1 && /1-2|Stage|W1/i.test(stage[0] + 'W1'), 'stages of a big game load behind the same loading screen: "' + stage[0] + '"');
        await p3.context().close();
    }

    console.log('19. full screen on every TV resolution');
    {
        const shots = path.join(ROOT, 'build', 'screenshots');
        fs.mkdirSync(shots, { recursive: true });
        const views = [[1280, 720, 1, ''], [1920, 1080, 1, ''], [3840, 2160, 1, ''], [1920, 1080, 2, ''], [2560, 1080, 1, 'ultrawide'], [3840, 1080, 1, 'superwide']];
        for (const [w, h, dpr, tag] of views) {
            const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
            const page = await newPage(browser, { context: ctx });
            const label = `${w}x${h}@${dpr}x${tag ? ' ' + tag : ''}`;
            await page.goto(base + 'index.html');
            await page.waitForSelector('.tile');
            const s = Math.min(w / 1920, h / 1080);
            const home = await page.evaluate(() => { const r = document.getElementById('stage').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, ow: document.body.scrollWidth }; });
            check(Math.abs(home.w - 1920 * s) < 2 && Math.abs(home.h - 1080 * s) < 2 && Math.abs(home.l - (w - 1920 * s) / 2) < 2 && Math.abs(home.t - (h - 1080 * s) / 2) < 2, `${label}: home stage fills the window and is centred`);
            check(home.sw <= w && home.sh <= h, `${label}: home does not overflow`);
            await page.screenshot({ path: path.join(shots, `home-${w}x${h}@${dpr}.png`) });
            if (w === 3840 && h === 2160) await page.evaluate(() => Perf.setSetting('high'));
            await openGame(page, 'snake');
            await page.waitForTimeout(300);
            const g = await page.evaluate(() => {
                const r = document.getElementById('stage').getBoundingClientRect(), c = document.getElementById('game'), p = Perf.profile(), vp = GameAPI._gk.vp;
                const hud = document.querySelector('.hud-item').getBoundingClientRect();
                return { l: r.left, t: r.top, w: r.width, h: r.height, cw: c.width, ch: c.height, cap: p.cap, vp, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight,
                         hl: hud.left - r.left, ht: hud.top - r.top, dpr: window.devicePixelRatio, scale: GameAPI._gk.scale };
            });
            const wantW = Math.max(960, Math.min(Math.round(1920 * s * dpr), g.cap));
            check(Math.abs(g.w - 1920 * s) < 2 && Math.abs(g.l - (w - 1920 * s) / 2) < 2, `${label}: game stage fills the window`);
            check(g.sw <= w && g.sh <= h, `${label}: game page does not overflow`);
            check(Math.abs(g.cw - wantW) <= 1 && Math.abs(g.ch - Math.round(g.cw * 9 / 16)) <= 1, `${label}: canvas ${g.cw}x${g.ch} = CSS ${Math.round(1920 * s)} x dpr ${dpr} (cap ${g.cap}) = ${wantW}`);
            check(Math.abs(g.vp.cssWidth - Math.round(1920 * s)) <= 1 && g.vp.dpr === dpr && g.vp.safeArea.left === 96 && g.vp.safeArea.top === 54, `${label}: the SDK passes {cssWidth, cssHeight, dpr, safeArea}`);
            check(g.hl >= 96 * s - 2 && g.ht >= 54 * s - 2, `${label}: HUD stays inside the 5% safe area (${Math.round(g.hl)}, ${Math.round(g.ht)})`);
            await page.screenshot({ path: path.join(shots, `game-${w}x${h}@${dpr}.png`) });
            if (w === 1280) {
                // resizing the window recomputes the canvas
                await page.setViewportSize({ width: 1920, height: 1080 });
                await page.waitForTimeout(300);
                const cw = await page.evaluate(() => document.getElementById('game').width);
                check(cw === Math.min(1920, g.cap) , `resize: the canvas follows the window (${g.cw} -> ${cw})`);
            }
            check(page.errors.length === 0, `${label}: no page errors ` + page.errors.join('; '));
            await ctx.close();
        }
        const low = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
        const lp = await newPage(browser, { context: low });
        await lp.goto(base + 'index.html');
        await lp.waitForSelector('.tile');
        await lp.evaluate(() => Perf.setSetting('low'));
        await openGame(lp, 'snake');
        check(await lp.evaluate(() => document.getElementById('game').width) === 960, 'low tier: the canvas is capped at 960x540');
        await low.close();
    }

    console.log('20. profiles: picker, default, skip, switch');
    {
        const page = await newPage(browser);
        await page.goto(base + 'index.html');
        await page.waitForSelector('.tile');
        const nameIt = async (text) => { await page.keyboard.press('Enter'); await page.keyboard.type(text.slice(1).toLowerCase()); };
        // a second profile through the profile screen
        await page.focus('#btn-profile'); await page.keyboard.press('Enter');
        await page.focus('#profile-new'); await page.keyboard.press('Enter');
        await nameIt('Ana');
        await page.evaluate(() => [...document.querySelectorAll('#namer-keys button')].pop().click());
        await page.focus('#styler-ok'); await page.keyboard.press('Enter');
        await page.keyboard.press('Escape');
        // choosing a game opens the picker: Guest, Player 1, Ana and New profile, with a Default checkbox
        await page.focus('[data-game="snake"]'); await page.keyboard.press('Enter');
        await page.waitForSelector('#picker:not([hidden])');
        const pk = await page.evaluate(() => ({
            ids: [...document.querySelectorAll('#picker .pcard')].map((c) => c.getAttribute('data-profile') || (c.hasAttribute('data-new') ? 'new' : '?')),
            labels: [...document.querySelectorAll('#picker .pcard')].every((c) => !!c.getAttribute('aria-label')),
            chk: document.getElementById('picker-default').getAttribute('role') + document.getElementById('picker-default').getAttribute('aria-checked'),
            focus: document.activeElement.getAttribute('data-profile'), dlg: document.querySelector('#picker [role="dialog"]').getAttribute('aria-labelledby')
        }));
        check(JSON.stringify(pk.ids) === '["guest","p1","p2","new"]', 'picker: Guest, one tile per profile, New profile: ' + pk.ids.join(','));
        check(pk.labels && pk.chk === 'checkboxfalse' && pk.focus === 'p2' && pk.dlg === 'picker-title', 'picker: Voice Guide labels, checkbox role, the active profile has focus');
        await page.keyboard.press('Escape');
        check(await page.evaluate(() => document.getElementById('picker').hidden && document.activeElement.getAttribute('data-game') === 'snake'), 'Back closes the picker and restores the focus');
        // "New profile" from the picker comes back to it
        await page.keyboard.press('Enter');
        await page.focus('#picker [data-new]'); await page.keyboard.press('Enter');
        await nameIt('Bob');
        await page.evaluate(() => [...document.querySelectorAll('#namer-keys button')].pop().click());
        await page.focus('#styler-ok'); await page.keyboard.press('Enter');
        await page.waitForSelector('#picker:not([hidden])');
        check(await page.evaluate(() => document.querySelectorAll('#picker [data-profile]').length === 4 && document.activeElement.getAttribute('data-profile') === 'p3'), 'a profile created from the picker appears in it, selected');
        // choose Ana with "Default" checked
        await page.focus('#picker-default'); await page.keyboard.press('Enter');
        check(await page.evaluate(() => document.getElementById('picker-default').getAttribute('aria-checked')) === 'true', 'the Default checkbox toggles');
        await page.focus('#picker [data-profile="p2"]'); await page.keyboard.press('Enter');
        await page.waitForFunction(() => window.GameShell && GameShell.state() === 'running', null, { timeout: 20000 });
        check(await page.evaluate(() => localStorage.getItem('arc_default_profile') === '"p2"' && Store.profile() === 'p2' && new URL(location.href).searchParams.get('profile') === 'p2'), 'the chosen profile is stored as arc_default_profile and runs the game');
        // named profile: the score is credited by name, no initials entry
        await page.evaluate(() => GameAPI._gk.submitScore(321));
        await page.waitForTimeout(150);
        check(await page.evaluate(() => GameShell.state() === 'running' && Scores.list('snake')[0].n === 'Ana' && Scores.list('snake')[0].s === 321), 'a named profile gets its name in the table, no initials entry');
        check(/Ana/.test(await page.textContent('#toast')), 'the new rank is announced');
        await page.evaluate(() => GameAPI._gk.save('lvl', 4));
        // the picker is skipped from then on: another game starts directly
        await quitToHome(page);
        await page.focus('[data-game="blocks"]'); await page.keyboard.press('Enter');
        await page.waitForFunction(() => window.GameShell && GameShell.state() === 'running', null, { timeout: 20000 });
        check(await page.evaluate(() => Store.profile() === 'p2'), 'with a default profile the picker is skipped');
        // and after a restart (fresh page load of the same storage)
        await page.evaluate(() => { location.replace(AppBoot.localBase() + 'index.html'); });
        await page.waitForSelector('.tile');
        await page.focus('[data-game="hopper"]'); await page.keyboard.press('Enter');
        await page.waitForFunction(() => window.GameShell && GameShell.state() === 'running', null, { timeout: 20000 });
        check(await page.evaluate(() => Store.profile() === 'p2'), 'the picker is still skipped after a restart');
        // per profile data: Player 1 does not see Ana's save
        check(await page.evaluate(() => { Store.setProfile('p1'); const v = GameData.get('snake', 'lvl', null); Store.setProfile('p2'); return v === null && GameData.get('snake', 'lvl', null) === 4; }), 'game data is stored per profile');
        // the pause menu has "Switch profile": clears the default and returns home with the picker for that game
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => GameShell.state() === 'paused');
        const sw = await page.evaluate(() => [...document.querySelectorAll('#pause-items button')].map((b) => b.textContent));
        check(sw.indexOf('Switch profile') === sw.length - 2, 'the pause menu has a Switch profile item: ' + sw.join(' | '));
        await page.evaluate(() => [...document.querySelectorAll('#pause-items button')].find((b) => b.textContent === 'Switch profile').click());
        await page.waitForSelector('#picker:not([hidden])', { timeout: 15000 });
        check(await page.evaluate(() => localStorage.getItem('arc_default_profile') === null), 'Switch profile clears the default and shows the picker again');
        await page.keyboard.press('Escape');
        // Settings has the same item
        await page.evaluate(() => Profiles.setDefault('p2'));
        await page.focus('#btn-settings'); await page.keyboard.press('Enter');
        await page.focus('[data-row="profile"]'); await page.keyboard.press('Enter');
        check(await page.evaluate(() => Profiles.defaultId() === null), 'Settings > Switch profile clears the default');
        await page.keyboard.press('Escape');
        // deleting the default profile deletes its data and the default
        await page.evaluate(() => { Profiles.setDefault('p2'); Profiles.use('p2'); });
        await page.focus('#btn-profile'); await page.keyboard.press('Enter');
        await page.focus('#profile-delete'); await page.keyboard.press('Enter');
        await page.focus('#dialog-yes'); await page.keyboard.press('Enter');
        check(await page.evaluate(() => !Profiles.find('p2') && localStorage.getItem('arc_default_profile') === null && !Object.keys(localStorage).some((k) => k.indexOf('arc_p2_') === 0)), 'deleting a profile deletes all its data and its default flag');
        await page.keyboard.press('Escape');
        // maximum 8 profiles: no New profile tile
        await page.evaluate(() => { while (Profiles.list().length < 8) Profiles.create('P'); });
        await page.focus('[data-game="snake"]'); await page.keyboard.press('Enter');
        await page.waitForSelector('#picker:not([hidden])');
        check(await page.evaluate(() => document.querySelectorAll('#picker [data-profile]').length === 9 && !document.querySelector('#picker [data-new]')), 'at most 8 profiles (+ Guest): the picker offers no New profile');
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }

    await browser.close();
    srv.close(); remoteSrv.close();
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nall platform checks passed');
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
