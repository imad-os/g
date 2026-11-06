// The music audio visualizer at 60 frames a second, every style, in a real browser, with screenshots (owner rule 2026-11-06).
//   CHROMIUM_PATH=... THROTTLE=4 node tests/viz-fps-proof.mjs <folder with groove.mp3> <live|file> [song]
// live: the web player (<audio>) heard live; file: Samsung's player (AVPlay, mocked: no sound here), so the visualizer reads the
// song file in pieces like on the TV. THROTTLE=n: the page's CPU n times slower. CH + is pressed (PageUp = the same action)
// to go through the styles, then CH −, then another key must close it.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [DIR = '/tmp/saver', MODE = 'live', SONG = 'groove.mp3'] = process.argv.slice(2);
const OUT = path.join(DIR, 'shots'); fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.webmanifest': 'application/manifest+json' };
const app = http.createServer((q, r) => {
    const u = decodeURIComponent(q.url.split('?')[0]);
    const p = u.startsWith('/__songs/') ? path.join(DIR, path.basename(u)) : path.join(ROOT, u);
    if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end(); }
    const size = fs.statSync(p).size, m = /bytes=(\d+)-(\d*)/.exec(q.headers.range || '');
    const type = { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Accept-Ranges': 'bytes' };
    if (m) { const a = +m[1], b = m[2] ? Math.min(+m[2], size - 1) : size - 1; r.writeHead(206, Object.assign(type, { 'Content-Range': 'bytes ' + a + '-' + b + '/' + size, 'Content-Length': b - a + 1 })); return fs.createReadStream(p, { start: a, end: b }).pipe(r); }
    r.writeHead(200, Object.assign(type, { 'Content-Length': size }));
    fs.createReadStream(p).pipe(r);
}).listen(0);
const base = 'http://localhost:' + app.address().port + '/';

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--autoplay-policy=no-user-gesture-required', '--no-proxy-server'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' });
await ctx.route(/imad-os\.github\.io|firestore\.googleapis|identitytoolkit|securetoken|api\.open-meteo|get\.geojs/, (r) => r.abort('internetdisconnected'));
const page = await ctx.newPage();
const errors = [];
// THROTTLE=6: the page's CPU 6 times slower, like a TV
if (process.env.THROTTLE) await (await ctx.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: +process.env.THROTTLE });
page.on('pageerror', (e) => errors.push(e.message));
// NOCAP=1: a browser without captureStream (some TVs): the other live path (the player's sound through Web Audio)
if (process.env.NOCAP) await page.addInitScript(() => { delete HTMLMediaElement.prototype.captureStream; HTMLMediaElement.prototype.captureStream = undefined; });
if (MODE === 'file') {
    // Samsung's player: opens the address, "plays" by the clock (no sound at all here)
    await page.addInitScript(() => {
        const av = { state: 'NONE', cur: 0, t: 0, l: null, url: '' };
        window.__av = av;
        window.webapis = { productinfo: { getModel: () => 'MOCK' }, avplay: {
            open: (u) => { av.url = u; av.state = 'IDLE'; av.cur = 0; }, setListener: (l) => { av.l = l; }, setDisplayRect() {},
            prepareAsync: (ok) => setTimeout(() => { av.state = 'READY'; ok(); }, 10),
            play: () => { av.state = 'PLAYING'; av.t = Date.now(); }, pause: () => { if (av.state === 'PLAYING') av.cur += Date.now() - av.t; av.state = 'PAUSED'; },
            stop: () => { av.state = 'IDLE'; }, close: () => { av.state = 'NONE'; },
            seekTo: (ms, ok) => { av.cur = ms; av.t = Date.now(); if (ok) setTimeout(ok, 1); },
            getCurrentTime: () => av.state === 'PLAYING' ? av.cur + Date.now() - av.t : av.cur, getDuration: () => 60000, getState: () => av.state
        } };
    });
}
await page.goto(base + 'index.html');
await page.waitForSelector('#desk-icons .dicon', { timeout: 30000 });
// a source for the test songs, on this computer: the player gets their address, the screensaver may read them
await page.evaluate((b) => {
    MusicSrc.add('t', {
        list: (d, cb) => cb(null, []),
        url: (e, cb) => cb(null, { url: b + '__songs/' + e.p }),
        read: (e, at, len, cb) => fetch(b + '__songs/' + e.p, { headers: { Range: 'bytes=' + at + '-' + (at + len - 1) } }).then((r) => { const m = /\/(\d+)/.exec(r.headers.get('content-range') || ''); if (m) e.size = +m[1]; window.__reads = (window.__reads || 0) + 1; window.__bytes = (window.__bytes || 0) + len; return r.arrayBuffer(); }).then((x) => cb(null, new Uint8Array(x)), (x) => cb({ code: 'io' })),
        rename: (e, n, cb) => cb({ code: 'unsupported' })
    });
}, base);
const play = (file, title) => page.evaluate(([f, t]) => { Music.playList([{ s: 't', p: f, n: f, t: t, a: 'My PC test' }], 0); }, [file, title]);
const shot = (name) => page.screenshot({ path: path.join(OUT, MODE + '-' + SONG.replace(/\W+/g, '-') + name + '.png') });


// every style for 6 s with the song playing: frames drawn, the worst gap between two, the gaps over 20 ms (a dropped frame at 60)
await page.evaluate(() => { Music.setPref('saver', 'bars'); Win.open('music'); });
await play(SONG, 'Night Drive');
await page.waitForFunction(() => Music.state().playing && !Music.state().loading && Music.time() > 0.2, null, { timeout: 15000 });
await page.evaluate(() => { window.__long = []; try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(Math.round(e.duration)))).observe({ entryTypes: ['longtask'] }); } catch (x) {} MusicSaver.show(true); });
await page.waitForFunction(() => MusicSaver._src() === 'live' || MusicSaver._src() === 'file', null, { timeout: 15000 }).catch(() => {});
const res = [];
let ok = true;
const styles = await page.evaluate(() => MusicSaver.STYLES);
// start on Bars, then CH + (PageUp, the TV's ChannelUp 427 is the same action) through every style
await page.evaluate(() => { while (MusicSaver.style() !== 'bars') MusicSaver.input(true, 'pageUp'); });
for (let i = 0; i < styles.length; i++) {
    if (i) { await page.keyboard.press('PageUp'); await page.waitForTimeout(250); }
    const st = await page.evaluate(() => MusicSaver.style());
    if (process.env.VIZ && process.env.VIZ.split(',').indexOf(st) < 0) continue;   // VIZ=scope,pulse: only those
    await page.waitForTimeout(1200);
    await page.evaluate(() => { MusicSaver._statsReset(); window.__long = []; });
    await page.waitForTimeout(6000);
    const s = await page.evaluate(() => Object.assign(MusicSaver._stats(), { on: MusicSaver.isOn(), src: MusicSaver._src(), long: window.__long.slice(), lv: Math.max(...MusicSaver._levels()) }));
    const fps = +(s.frames / 6).toFixed(1);
    res.push({ style: st, fps, worst: s.worst, slow: s.slow, drawMs: s.drawMs, src: s.src, moving: s.lv > 0.2, particles: s.particles, long: s.long.join(',') });
    if (!s.on || st !== styles[i]) ok = false;
    await shot('viz-' + st);
}
// CH − goes back, any other key closes it
await page.keyboard.press('PageDown'); await page.waitForTimeout(200);
const back = await page.evaluate(() => MusicSaver.style());
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(300);
const closed = !(await page.evaluate(() => MusicSaver.isOn()));
const kept = await page.evaluate(() => Music.prefs().saver);
console.log('throttle x' + (process.env.THROTTLE || 1) + ', ' + MODE + ' (' + SONG + ')');
console.table(res);
console.log('CH+ went through ' + res.map((r) => r.style).join(' > ') + '; CH- back to ' + back + '; another key closed it: ' + closed + '; style kept: ' + kept);
console.log(errors.length ? 'PAGE ERRORS ' + errors.join(' | ') : 'no page errors');
await browser.close(); app.close();
process.exit(ok && closed && !errors.length ? 0 : 1);
