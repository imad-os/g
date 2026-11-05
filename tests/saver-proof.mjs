// A real-browser check that the music screensaver moves with the song's REAL sound, with screenshots.
//   CHROMIUM_PATH=... node tests/saver-proof.mjs <folder with pattern.mp3 + groove.mp3> <live|file>
// live: the web player (<audio>), listened to live. file: Samsung's player (AVPlay, mocked: it only keeps the time, it makes
// no sound in this browser), so every movement comes from the song file read and analysed at the player's position.
// pattern.mp3 (ffmpeg, 60 s, repeats every 8 s): 0-2 s an 80 Hz tone, 2-4 silence, 4-6 a 3000 Hz tone, 6-8 silence.
//   ffmpeg -f lavfi -i "aevalsrc='0.6*(lt(mod(t\,8)\,2)*sin(2*PI*80*t)+between(mod(t\,8)\,4\,6)*sin(2*PI*3000*t))':s=44100:d=60" -ac 2 pattern.mp3
// groove.mp3: any song, for the screenshots of each style. Never reaches the internet.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [DIR = '/tmp/saver', MODE = 'live'] = process.argv.slice(2);
const OUT = path.join(DIR, 'shots'); fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json' };
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
page.on('pageerror', (e) => errors.push(e.message));
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
        read: (e, at, len, cb) => fetch(b + '__songs/' + e.p, { headers: { Range: 'bytes=' + at + '-' + (at + len - 1) } }).then((r) => r.arrayBuffer()).then((x) => cb(null, new Uint8Array(x)), (x) => cb({ code: 'io' })),
        rename: (e, n, cb) => cb({ code: 'unsupported' })
    });
}, base);
const play = (file, title) => page.evaluate(([f, t]) => { Music.playList([{ s: 't', p: f, n: f, t: t, a: 'My PC test' }], 0); }, [file, title]);
const shot = (name) => page.screenshot({ path: path.join(OUT, MODE + '-' + name + '.png') });

// 1. the pattern: the bars must follow it
await page.evaluate(() => { Music.setPref('saver', 'bars'); Win.open('music'); });
await play('pattern.mp3', 'Test pattern (80 Hz, silence, 3 kHz, silence)');
await page.waitForFunction(() => Music.state().playing && !Music.state().loading && Music.time() > 0.2, null, { timeout: 15000 });
await page.evaluate(() => MusicSaver.show(true));
const rows = [];
let lowShot = false, highShot = false, quietShot = false;
const t0 = Date.now();
while (Date.now() - t0 < 19000) {
    const s = await page.evaluate(() => ({ t: Music.time(), lv: MusicSaver._levels(), src: MusicSaver._src(), eng: Music.engineName() }));
    const ph = s.t % 8, low = s.lv.slice(0, 6).reduce((a, b) => a + b) / 6, high = Math.max(...s.lv.slice(31, 38)), all = Math.max(...s.lv);
    const part = ph > 0.4 && ph < 1.7 ? 'tone80' : ph > 2.4 && ph < 3.7 ? 'silence' : ph > 4.4 && ph < 5.7 ? 'tone3k' : ph > 6.4 && ph < 7.7 ? 'silence' : '';
    rows.push({ t: +s.t.toFixed(2), part, low: +low.toFixed(2), high: +high.toFixed(2), all: +all.toFixed(2), src: s.src, eng: s.eng });
    if (s.src !== 'wait') {
        if (part === 'tone80' && !lowShot && ph > 0.8) { lowShot = true; await shot('pattern-80hz'); }
        if (part === 'tone3k' && !highShot && ph > 4.8) { highShot = true; await shot('pattern-3khz'); }
        if (part === 'silence' && !quietShot && ph > 2.9 && ph < 3.5) { quietShot = true; await shot('pattern-silence'); }
    }
    await page.waitForTimeout(100);
}
const ok = rows.filter((r) => r.part && r.src !== 'wait');
const avg = (list, k) => list.length ? +(list.reduce((a, r) => a + r[k], 0) / list.length).toFixed(2) : NaN;
const byPart = {};
for (const p of ['tone80', 'silence', 'tone3k']) { const l = ok.filter((r) => r.part === p); byPart[p] = { n: l.length, low: avg(l, 'low'), high: avg(l, 'high'), all: avg(l, 'all') }; }
console.log(MODE + ': engine ' + rows[rows.length - 1].eng + ', data from ' + [...new Set(rows.map((r) => r.src))].join(' -> '));
console.log('averages', JSON.stringify(byPart));
const pass = byPart.tone80.low > 0.5 && byPart.tone80.high < 0.15 && byPart.tone3k.high > 0.5 && byPart.tone3k.low < 0.15 && byPart.silence.all < 0.1;
console.log(pass ? 'OK: low bars only on the 80 Hz tone, right bars only on the 3 kHz tone, flat in the silences: the real sound' : 'NOT OK');
console.log(rows.filter((r, i) => i % 5 === 0).map((r) => r.t + ' ' + r.part + ' low=' + r.low + ' high=' + r.high + ' all=' + r.all + ' ' + r.src).join('\n'));
await page.evaluate(() => MusicSaver.hide());

// 2. every style with a song
await play('groove.mp3', 'Night Drive');
await page.waitForFunction(() => Music.state().playing && !Music.state().loading && Music.time() > 0.2, null, { timeout: 15000 });
for (const st of ['bars', 'waves', 'cover', 'ring']) {
    await page.evaluate((x) => { Music.setPref('saver', x); MusicSaver.show(true); }, st);
    await page.waitForFunction(() => MusicSaver._src() === 'live' || MusicSaver._src() === 'file', null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1600);
    await shot('style-' + st);
    await page.evaluate(() => MusicSaver.hide());
}
console.log(errors.length ? 'PAGE ERRORS ' + errors.join(' | ') : 'no page errors');
await browser.close(); app.close();
process.exit(pass ? 0 : 1);
