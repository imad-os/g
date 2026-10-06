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
//   9. Super Jumper 2-player co-op: arrows + WASD, and two gamepads, each drive only their own hero

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
    const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--js-flags=--expose-gc', '--enable-precise-memory-info'] });

    console.log('1. hosted newer build runs');
    {
        const page = await newPage(browser, base);
        await routeHosted(page, { manifest: { build: 99 } });
        await page.goto(base + 'index.html');
        await page.waitForFunction(() => window.AppBoot && window.Menu && document.querySelector('.tile'), null, { timeout: 15000 });
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
        await page.waitForSelector('.tile', { timeout: 15000 });
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
        await page.waitForFunction(() => window.AppBoot && AppBoot.source() === 'local' && document.querySelector('.tile'), null, { timeout: 20000 });
        check(await page.evaluate(() => localStorage.getItem('boot_bad_build')) === '77', 'build 77 recorded as bad');
        check(await playable(page), 'bundled copy is playable after the fallback');
        await page.reload();
        await page.waitForSelector('.tile', { timeout: 15000 });
        check(await page.evaluate(() => AppBoot.source()) === 'local', 'blacklisted build is skipped on the next launch');
        await page.context().close();
    }

    console.log('4. hosted build for another shell is ignored');
    {
        const page = await newPage(browser, base);
        await routeHosted(page, { manifest: { build: 50, shell: 2 } });
        await page.goto(base + 'index.html');
        await page.waitForSelector('.tile', { timeout: 15000 });
        check(await page.evaluate(() => AppBoot.source()) === 'local', 'shell mismatch keeps the bundled copy');
        await page.context().close();
    }

    console.log('5/6. memory, destroy() and Back key');
    {
        const page = await newPage(browser, base);
        await routeHosted(page, { offline: true });
        await page.goto(base + 'index.html');
        await page.waitForSelector('.tile');
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
        await page.focus('#btn-scores'); await page.keyboard.press('Enter');
        check(await page.evaluate(() => !document.getElementById('scores').hidden), 'Top scores screen opens');
        const label = await page.evaluate(() => [...document.querySelectorAll('.score-col')].map((c) => c.getAttribute('aria-label')).join(' | '));
        check(/Neon Snake.*1: ZZZ, 1011 points/.test(label), 'Voice Guide label lists the table');
        await page.keyboard.press('Escape');
        check(await page.evaluate(() => document.getElementById('scores').hidden && document.activeElement.id === 'btn-scores'), 'Back closes the Scores screen');
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
