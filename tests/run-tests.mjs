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
    await page.waitForFunction(() => window.GameHost.state() === 'running', null, { timeout: 15000 });
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
        const sample = async () => { for (let i = 0; i < 4; i++) { await page.evaluate(() => { window.gc && window.gc(); }); await page.waitForTimeout(150); } return (await cdp.send('Runtime.getHeapUsage')).usedSize; };
        const heap = async () => Math.min(await sample(), await sample(), await sample());
        const ids = ['jumper', 'blocks', 'hopper', 'snake', 'breaker', 'merge'];
        // warm-up (first launch compiles code and fills caches)
        for (let r = 0; r < 2; r++) for (const id of ids) await cycle(page, id, true);
        const before = await heap();
        let audioClosed = true, loopStopped = true;
        for (let i = 0; i < 20; i++) {
            const r = await cycle(page, ids[i % ids.length], false);
            audioClosed = audioClosed && r.audio === 'closed';
            loopStopped = loopStopped && !r.running;
        }
        const after = await heap();
        const growth = (after - before) / before;
        check(await page.evaluate(() => document.querySelectorAll('iframe').length) === 0, 'no iframe left after 20 launches');
        check(audioClosed, 'every destroy() closed its AudioContext');
        check(loopStopped, 'every destroy() stopped its game loop');
        check(growth <= 0.10, `JS heap did not grow more than 10% (a drop is not a leak): ${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB (${(growth * 100).toFixed(1)}%)`);
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
        await page.waitForFunction(() => window.GameHost.state() === 'running');
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
        await page.waitForFunction(() => window.GameHost.state() === 'running');
        const scores = [500, 900, 100];
        for (const sc of scores) {
            await page.evaluate((v) => document.querySelector('iframe').contentWindow.GameAPI._gk.submitScore(v), sc);
            await page.waitForFunction(() => window.GameHost.state() === 'entry');
            await page.keyboard.press('ArrowUp');                     // A -> B on the first letter
            await page.focus('#entry-ok'); await page.keyboard.press('Enter');
            await page.waitForFunction(() => window.GameHost.state() === 'running');
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
        await page.waitForFunction(() => window.GameHost.state() === 'idle');
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
            window.__plug = () => { window.__pads = [pad(0), pad(1)]; window.dispatchEvent(new Event('gamepadconnected')); };
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
            await page.waitForFunction(() => window.GameHost.state() === 'running');
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
        await page.waitForFunction(() => window.GameHost.state() === 'entry', null, { timeout: 8000 });
        const t1 = await page.textContent('#entry-title');
        await page.focus('#entry-ok'); await page.keyboard.press('Enter');
        await page.waitForFunction(() => window.GameHost.state() === 'entry' && /2/.test(document.getElementById('entry-title').textContent));
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => window.GameHost.state() === 'running');
        const top = await page.evaluate(() => Scores.list('jumper').map((e) => e.n + ' ' + e.s).join(', '));
        check(/Player 1/.test(t1) && top === 'AAA 4321, PL2 1234', 'game over: both players enter initials (' + top + ')');
        await page.keyboard.press('Escape');
        await page.evaluate(() => { const b = document.querySelectorAll('#pause-items button'); b[b.length - 1].click(); });
        await page.waitForFunction(() => window.GameHost.state() === 'idle');

        // two gamepads: pad0 = P1, pad1 = P2
        await page.evaluate(() => window.__plug());
        await page.waitForTimeout(300);
        const tap = async (i, btn) => { await page.evaluate(([i, b]) => window.__press(i, b, true), [i, btn]); await page.waitForTimeout(120); await page.evaluate(([i, b]) => window.__press(i, b, false), [i, btn]); await page.waitForTimeout(120); };
        await page.focus('[data-game="jumper"]'); await tap(0, 0);
        await page.waitForFunction(() => window.GameHost.state() === 'running');
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
        await page.waitForFunction(() => window.GameHost.state() === 'running');
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
        await page.waitForFunction(() => window.GameHost.state() === 'running');
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
        await page.waitForFunction(() => window.GameHost.state() === 'running');
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
        await page.waitForFunction(() => window.GameHost.state() === 'running');
        check(await page.evaluate(() => [...document.querySelectorAll('#desk-icons img')].every((i) => !i.getAttribute('src'))), 'covers are released while a game runs');
        await page.keyboard.press('Escape');
        await page.evaluate(() => { const b = document.querySelectorAll('#pause-items button'); b[b.length - 1].click(); });
        await page.waitForFunction(() => window.GameHost.state() === 'idle');
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
        await page.waitForFunction(() => window.GameHost.state() === 'running');
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
        await page.waitForFunction(() => window.GameHost.state() === 'idle');
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
        await key('Escape', 'ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowLeft');
        check(await page.evaluate(() => AudioPrefs.music()) === 6, 'Settings > Sound: left lowers the music volume');
        await key('Escape', 'Escape');
        // explorer: Games folder starts a game; quitting comes back to the desktop
        await page.evaluate(() => Win.open('explorer', 'games'));
        await key('Enter');
        await page.waitForFunction(() => window.GameHost.state() === 'running', null, { timeout: 8000 });
        check(await page.evaluate(() => document.getElementById('window').hidden && Win.current() === null), 'opening a game from File Explorer closes the app first');
        await key('Escape');
        await page.evaluate(() => { const b = document.querySelectorAll('#pause-items button'); b[b.length - 1].click(); });
        await page.waitForFunction(() => window.GameHost.state() === 'idle');
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

    await browser.close();
    srv.close();
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
    process.exit(failures ? 1 : 0);
}

// Launch a game, start it, play briefly, quit to menu. Returns the state of the destroyed game.
async function cycle(page, id, warm) {
    await page.focus(`[data-game="${id}"]`);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.GameHost.state() === 'running', null, { timeout: 15000 });
    await page.evaluate(() => {
        const w = document.querySelector('iframe').contentWindow;
        window.__probe = { api: w.GameAPI, gk: w.GameAPI._gk };
        window.__probe.audio = window.__probe.gk.audio && window.__probe.gk.audio.ctx;
    });
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(warm ? 400 : 150);
    await page.keyboard.press('Escape');
    await page.evaluate(() => { const b = document.querySelectorAll('#pause-items button'); b[b.length - 1].click(); });
    await page.waitForFunction(() => window.GameHost.state() === 'idle');
    const r = await page.evaluate(() => {
        const p = window.__probe, out = { audio: p.audio ? p.audio.state : 'closed', running: p.api._isRunning() };
        window.__probe = null;
        return out;
    });
    return r;
}

main().catch((e) => { console.error(e); process.exit(1); });
