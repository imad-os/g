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
//   8. top-10 tables: a qualifying score asks for initials and appears on the Scores screen
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

async function newPage(browser, base) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.addInitScript(TIZEN_MOCK);
    const page = await ctx.newPage();
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(e.message));
    page.base = base;
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
    await page.waitForTimeout(100);
    return running && paused === 'paused' && (await page.evaluate(() => window.GameHost.state())) === 'idle';
}

async function main() {
    const srv = await serve();
    const base = `http://localhost:${srv.address().port}/`;
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--autoplay-policy=no-user-gesture-required', '--js-flags=--expose-gc', '--enable-precise-memory-info'] });

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
            await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'entry');
            await page.keyboard.press('ArrowUp');                     // A -> B on the first letter
            await page.focus('#entry-ok'); await page.keyboard.press('Enter');
            await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'running');
        }
        await page.evaluate(() => document.querySelector('iframe').contentWindow.GameAPI._gk.submitScore(0));
        check(await page.evaluate(() => window.GameHost.state()) === 'running', 'a zero score does not ask for initials');
        const list = await page.evaluate(() => Scores.list('snake'));
        check(list.length === 3 && list[0].s === 900 && list[2].s === 100, 'table sorted best first: ' + list.map((e) => e.n + ' ' + e.s).join(', '));
        check(list[1].n === 'BAA' && list[0].n === 'CAA', 'initials entered with the remote are saved and remembered for next time (' + list[1].n + ', ' + list[0].n + ')');
        for (let i = 0; i < 12; i++) await page.evaluate((v) => Scores.add('snake', 'ZZZ', v), 1000 + i);
        check(await page.evaluate(() => Scores.list('snake').length) === 10, 'table keeps only the top 10');
        await page.keyboard.press('Escape');
        await page.evaluate(() => { const b = document.querySelectorAll('#pause-items button'); b[b.length - 1].click(); });
        await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'idle' && !!document.querySelector('#desk-icons .dicon') && document.activeElement !== document.body);
        await page.focus('[data-app="scores"]'); await page.keyboard.press('Enter');
        check(await page.evaluate(() => Win.current() === 'scores' && !document.getElementById('window').hidden), 'Leaderboards app opens full screen');
        const label = await page.evaluate(() => [...document.querySelectorAll('.score-col')].map((c) => c.getAttribute('aria-label')).join(' | '));
        check(/Neon Snake.*1: ZZZ, 1011 points/.test(label), 'Voice Guide label lists the table');
        await page.keyboard.press('Escape');
        check(await page.evaluate(() => document.getElementById('window').hidden && document.activeElement.getAttribute('data-app') === 'scores'), 'Back closes the app and refocuses its icon');
        check(page.errors.length === 0, 'no page errors ' + page.errors.join('; '));
        await page.context().close();
    }

    console.log('9. Super Jumper 2-player co-op');
    {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
        await ctx.addInitScript(TIZEN_MOCK);
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
        await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'entry', null, { timeout: 8000 });
        const t1 = await page.textContent('#entry-title');
        await page.focus('#entry-ok'); await page.keyboard.press('Enter');
        await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'entry' && /2/.test(document.getElementById('entry-title').textContent));
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'running');
        const top = await page.evaluate(() => Scores.list('jumper').map((e) => e.n + ' ' + e.s).join(', '));
        check(/Player 1/.test(t1) && top === 'AAA 4321, PL2 1234', 'game over: both players enter initials (' + top + ')');
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
        await page.evaluate(() => { AudioPrefs.setMusic(3); Scores.add('snake', 'PPP', 70); });
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
        check(await page.evaluate(() => Store.profile() === 'p2' && Profiles.current().name === 'Ana'), 'a new profile is created and becomes active');
        check(await page.evaluate(() => Scores.list('snake').length === 0 && Store.get('vol_music') === 3), 'the new profile has its own scores; settings are shared');
        check(await page.evaluate(() => Scores.lastName(1)) === 'ANA', 'initials start from the profile name');
        await page.keyboard.press('Escape');
        check(/Ana/.test(await page.textContent('#btn-profile')), 'home shows the active profile');
        await page.reload();
        await page.waitForFunction(() => { const b = document.getElementById('profile-name'); return b && b.textContent; });
        check(await page.evaluate(() => Store.profile()) === 'p2', 'the active profile is remembered');
        await page.focus('#tb-start'); await page.keyboard.press('Enter');
        await page.focus('#btn-profile'); await page.keyboard.press('Enter');
        await page.focus('[data-profile="p1"]'); await page.keyboard.press('Enter');
        check(await page.evaluate(() => Store.profile() === 'p1' && Scores.list('snake').length === 1 && document.getElementById('profiles').hidden), 'switching back from the home screen restores that profile');
        await page.focus('#btn-profile'); await page.keyboard.press('Enter');
        await page.focus('[data-profile="p2"]'); await page.keyboard.press('Enter');
        await page.focus('#btn-profile'); await page.keyboard.press('Enter');
        await page.focus('#profile-delete'); await page.keyboard.press('Enter');
        await page.focus('#dialog-yes'); await page.keyboard.press('Enter');
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
        check(await page.evaluate(() => document.querySelectorAll('.score-col').length) === 6, 'Parchís (no points) has no top-10 column');
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
        check(await page.evaluate(() => Desktop.startOpen() && document.querySelectorAll('#start-pinned [data-focus]').length === 13), 'Start menu lists 6 apps and 7 games');
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
        await page.context().route(APP + '**', (r) => {
            const rel = r.request().url().slice(APP.length).split('?')[0] || 'index.html';
            const p = path.join(ROOT, 'sdk/example', rel);
            if (!fs.existsSync(p)) return r.fulfill({ status: 404, body: '' });
            r.fulfill({ status: 200, contentType: TYPES[path.extname(p)] || (p.endsWith('.svg') ? 'image/svg+xml' : 'text/plain'), headers: { 'Access-Control-Allow-Origin': '*' }, body: fs.readFileSync(p) });
        });
        let firestoreUp = true, liveSpeed = 1, removed = false;
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
        await page.context().route('https://firestore.googleapis.com/**', (r) => {
            if (!firestoreUp) return r.abort('internetdisconnected');
            const json = (status, o) => r.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(o) });
            if (r.request().url().indexOf('/documents/apps/star-catcher') > 0) return removed ? json(404, { error: { code: 404, status: 'NOT_FOUND' } }) : json(200, { fields: Object.assign({}, doc.fields, { config: cfgValue(liveSpeed) }) });
            json(200, { documents: [doc, hidden] });
        });
        await page.goto(base + 'index.html');
        const icon = '#desk-icons [data-game="app-star-catcher"]';
        const shown = await page.waitForSelector(icon, { timeout: 8000 }).then(() => true, () => false);
        check(shown && await page.evaluate(() => !document.querySelector('[data-game="app-hidden-one"]')), 'the installed app from Firebase appears on the desktop (hidden ones do not)');
        await page.focus(icon); await page.keyboard.press('Enter');
        const ran = await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'running', null, { timeout: 10000 }).then(() => true, () => false);
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
        const entry = await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'entry', null, { timeout: 4000 }).then(() => true, () => false);
        check(entry, 'MyPC.submitScore asks for initials (top 10)');
        await page.focus('#entry-ok'); await page.keyboard.press('Enter');
        check(await page.evaluate(() => Scores.list('app-star-catcher')[0].s === 321), 'the score is saved in its own top-10 table');
        await page.keyboard.press('Escape');
        await page.evaluate(() => { const b = document.querySelectorAll('#pause-items button'); b[b.length - 1].click(); });
        await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'idle' && !!document.querySelector('#desk-icons .dicon') && document.activeElement !== document.body);
        check(await page.evaluate(() => document.querySelectorAll('iframe').length === 0 && document.activeElement.getAttribute('data-game') === 'app-star-catcher'), 'quitting removes the iframe and returns to its desktop icon');
        // the owner changes the config in the installer: the next launch gets it (the saved list still has the old one)
        liveSpeed = 3;
        await page.focus(icon); await page.keyboard.press('Enter');
        await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'running', null, { timeout: 10000 });
        const f2 = page.frames().find((f) => f.url().indexOf(APP) === 0);
        check(await f2.evaluate(() => MyPC.app_config.speed) === 3, 'the config is read again from Firebase before the app opens (the saved copy was older)');
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
                export async function getDocs(c) { return { docs: Object.values(db[c.name] || {}).map((x) => ({ data: () => x })) }; }
                export async function setDoc(r, data) { (db[r.col] = db[r.col] || {})[r.id] = data; }
                export async function updateDoc(r, f) { Object.assign(db[r.col][r.id], f); }
                export async function deleteDoc(r) { delete db[r.col][r.id]; }
                export function serverTimestamp() { return 'now'; }`
        };
        await page.addInitScript(() => {
            window.__db = { admins: { U1: { name: 'owner' } }, apps: {
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
        await page.goto(base + 'installer/index.html');
        await page.waitForSelector('#catalog .app', { timeout: 8000 });
        const rows = await page.evaluate(() => [...document.querySelectorAll('#catalog .app')].map((r) => r.textContent));
        check(rows.length === 3 && !rows.some((t) => /speedy|nopages|archived/.test(t)), 'only g_ repositories with GitHub Pages are listed (' + rows.length + ')');
        check(rows.some((t) => /Star Catcher.*Not installed/.test(t)) && rows.some((t) => /Old Game.*Installed/.test(t)) && rows.some((t) => /g_broken.*not installable/.test(t)),
            'each app shows its status: new, installed, or not a My PC app');
        check(await page.evaluate(() => [...document.querySelectorAll('#catalog .app')].find((r) => /Old Game/.test(r.textContent)).querySelector('input').disabled), 'installed apps cannot be selected again');
        await page.check('#sel-all');
        await page.click('#btn-install-sel');
        await page.waitForFunction(() => window.__db.apps['star-catcher'], null, { timeout: 5000 }).catch(() => {});
        const db = await page.evaluate(() => window.__db.apps);
        check(db['star-catcher'] && db['star-catcher'].order === 1 && db['star-catcher'].url === 'https://imad-os.github.io/g_star/' && db['star-catcher'].installedBy === 'U1' && Object.keys(db).length === 2,
            '"Install selected" installs the new app only, after the installed ones');
        await page.waitForFunction(() => /Star Catcher.*Installed/.test(document.getElementById('catalog').textContent) && !/Not installed/.test(document.getElementById('catalog').textContent));
        check(true, 'after installing, the catalog marks it installed');
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

    await browser.close();
    srv.close();
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
    process.exit(failures ? 1 : 0);
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
