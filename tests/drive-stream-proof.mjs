// A real-browser check of Google Drive playback in the Music app, the way a person sees it, with screenshots.
//   CHROMIUM_PATH=... node tests/drive-stream-proof.mjs <out folder> <web|tv> <mp3|m4a|wav> <cert.pem> <key.pem>
// web: My PC as a web page (its service worker on); tv: no service worker, like the TV (Media Source / pieces).
// "Google Drive" is a local HTTPS server here that sends the song by Range at about 1 MB a second, streaming the body
// like the real one, so the download of the ~8 MB song takes ~8 s. Never reaches the real Google.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';      // so the routes also see the service worker's requests
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as F from './music-fixtures.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [OUT = '/tmp/drive-proof', MODE = 'web', FORMAT = 'mp3', CERT, KEY] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
const app = http.createServer((q, r) => {
    const p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(r);
}).listen(0);
const base = 'http://localhost:' + app.address().port + '/';

// real songs made with ffmpeg next to the out folder (big.mp3, big.m4a with its index at the end, big.flac); wav from the fixtures
const real = (f) => () => fs.readFileSync(path.join(OUT, '..', f));
const songs = {
    mp3: { name: 'Big Song.mp3', mime: 'audio/mpeg', data: real('big.mp3') },
    m4a: { name: 'Big Song.m4a', mime: 'audio/mp4', data: real('big.m4a') },
    flac: { name: 'Big Song.flac', mime: 'audio/flac', data: real('big.flac') },
    wav: { name: 'Big Tone.wav', mime: 'audio/wav', data: () => F.wav({ title: 'Big Tone', seconds: 240 }) }
};
const S = songs[FORMAT], song = Buffer.from(S.data());
const RATE = 1024 * 1024, log = [];
// "Google": token, list, and the file by Range, streamed in 64 KB pieces at RATE
const google = https.createServer({ cert: fs.readFileSync(CERT), key: fs.readFileSync(KEY) }, (q, r) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, range', 'Access-Control-Expose-Headers': 'Content-Range, Content-Length', 'Access-Control-Allow-Methods': 'GET, POST' };
    log.push((Date.now() % 100000) + ' ' + q.method + ' ' + q.url.replace(/\?.*/, '') + ' ' + (q.headers.range || '') + ' auth=' + !!q.headers.authorization);
    if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
    const json = (o) => { r.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, cors)); r.end(JSON.stringify(o)); };
    if (/\/token/.test(q.url)) return json({ access_token: 'AT1', expires_in: 3600, scope: 'https://www.googleapis.com/auth/drive.file' });
    if (/alt=media/.test(q.url)) {
        if (!q.headers.authorization) { r.writeHead(401, cors); return r.end(); }
        const m = /bytes=(\d+)-(\d*)/.exec(q.headers.range || ''), a = m ? +m[1] : 0, b = m && m[2] ? Math.min(+m[2], song.length - 1) : song.length - 1;
        r.writeHead(m ? 206 : 200, Object.assign({ 'Content-Type': S.mime, 'Accept-Ranges': 'bytes', 'Content-Length': b - a + 1, 'Content-Range': 'bytes ' + a + '-' + b + '/' + song.length }, cors));
        let at = a, gone = false;
        q.on('close', () => { if (at <= b) log.push((Date.now() % 100000) + ' STOPPED by the player: ' + q.url.replace(/\?.*/, '') + ' ' + (q.headers.range || '') + ' at ' + at); gone = true; });
        (function send() {
            if (gone) return;
            if (at > b) return r.end();
            const n = Math.min(65536, b - at + 1);
            r.write(song.subarray(at, at + n)); at += n;
            setTimeout(send, n / RATE * 1000);
        })();
        return;
    }
    if (/files/.test(q.url)) return json({ files: [{ id: 'big1', name: S.name, mimeType: S.mime, size: String(song.length) }, { id: 'big2', name: '2 ' + S.name, mimeType: S.mime, size: String(song.length) }] });
    r.writeHead(404, cors); r.end();
}).listen(0);
const G = 'https://localhost:' + google.address().port;

// the browser (and its service worker) reach "Google" at this machine: no request routing involved
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--host-resolver-rules=MAP www.googleapis.com 127.0.0.1:' + google.address().port + ', MAP oauth2.googleapis.com 127.0.0.1:' + google.address().port, '--ignore-certificate-errors', '--no-proxy-server'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true, serviceWorkers: MODE === 'web' ? 'allow' : 'block' });
await ctx.route(/imad-os\.github\.io|firestore\.googleapis|identitytoolkit|securetoken|api\.open-meteo|get\.geojs/, (r) => r.abort('internetdisconnected'));
const page = await ctx.newPage();
if (process.env.THROTTLE) await (await ctx.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: +process.env.THROTTLE });
page.on('pageerror', (e) => log.push('PAGE ERROR ' + e.message));
const mydrive = { id: 'mydrive', name: 'MyDrive', url: 'https://mydrive.example/', entry: 'https://mydrive.example/index.html', icon: '', type: 'app', version: '1.0.4', enabled: true, order: 1, config: { google: { tvClientId: 'cid', tvClientSecret: 'sec' } } };
await page.addInitScript((a) => { localStorage.setItem('arc_dev_installed', JSON.stringify([{ id: 'mydrive', at: 1 }])); localStorage.setItem('arc_dev_catalog', JSON.stringify([a])); }, mydrive);
await page.goto(base + 'index.html');
await page.waitForSelector('#desk-icons .dicon', { timeout: 30000 });
if (MODE === 'web') await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 15000 }).catch(() => log.push('NO SERVICE WORKER'));
await page.evaluate(() => { Store.set('game_app-mydrive_data', { accounts: [{ id: 'g1', email: 'imad@example.com', name: 'Imad', refreshToken: 'RT' }], active: 'g1' }); Win.open('music'); });
await page.waitForSelector('.mx-nav[data-nav="gd"]');
await page.click('.mx-nav[data-nav="gd"]');
await page.waitForFunction(() => [...document.querySelectorAll('.mx-tile')].some((t) => /^My Drive/.test(t.textContent)), null, { timeout: 10000 });
await page.evaluate(() => [...document.querySelectorAll('.mx-tile')].find((t) => /^My Drive/.test(t.textContent)).click());
await page.waitForSelector('.mx-row', { timeout: 15000 }).catch(async () => { console.log('NO SONG ROW\n' + log.join('\n')); await page.screenshot({ path: path.join(OUT, 'fail.png') }); process.exit(1); });
const t0 = Date.now();
await page.click('.mx-row >> nth=0');            // a real click, like a person
const states = [];
let shotAt = 0;
if (process.env.SAVER) {
    // the screensaver over a Drive song: SAVER=0 opens it at once, SAVER=3 after 3 s. Its bars must move from the song's first
    // second, the song must not stall, and the song must be downloaded only once (no second download for the analysis)
    const at = +process.env.SAVER || 0;
    if (at) await page.waitForTimeout(at * 1000);
    await page.evaluate(() => { Music.setPref('saver', 'bars'); MusicSaver.show(true); });
    const ts = Date.now();
    const seq = [];
    for (let i = 0; i < 80; i++) {
        seq.push(await page.evaluate(() => { const s = Music.state(); return { pos: +s.pos.toFixed(2), play: s.playing && !s.loading, src: MusicSaver._src(), lv: +Math.max(...MusicSaver._levels()).toFixed(2), ctx: MusicSaver._ctx ? MusicSaver._ctx() : '' }; }));
        seq[i].t = Date.now() - ts;
        if (i === 25) await page.screenshot({ path: path.join(OUT, 'saver-' + MODE + '-' + FORMAT + '.png') });
        if (i === 40) { await page.evaluate(() => Music.next()); seq[i].next = true; }
        await page.waitForTimeout(100);
    }
    const first = seq.find((x) => x.lv > 0.2), firstPlay = seq.find((x) => x.play && x.pos > 0.05);
    const ni = seq.findIndex((x) => x.next), back = seq.findIndex((x, i) => i > ni + 2 && x.lv > 0.2 && x.play);
    console.log('after Next (the saver open): the bars move again after ' + (back > 0 ? seq[back].t - seq[ni].t + ' ms (song at ' + seq[back].pos + ' s)' : 'NEVER'));
    let stalls = 0; for (let i = 5; i < seq.length; i++) if ((i < ni || i > ni + 20) && seq[i].play && seq[i - 5].play && seq[i].pos - seq[i - 5].pos < 0.2) stalls++;   // (not while Next opens the next song)
    const gets = log.filter((l) => /GET \S*files\/big\d /.test(l));
    console.log('saver ' + MODE + ' ' + FORMAT + ' opened ' + (at ? at + ' s after the click' : 'at the click') + ': bars move after ' + (first ? first.t + ' ms (song at ' + first.pos + ' s, ' + first.src + ')' : 'NEVER'));
    console.log('song playing after ' + (firstPlay ? firstPlay.t : 'NEVER') + ' ms; stalls (0.5 s windows without progress while playing): ' + stalls);
    console.log('requests for the song: ' + gets.length + ' (' + gets.map((l) => l.split(' ').slice(3, 4).join('')).join(' ') + ')' + (log.some((l) => /STOPPED/.test(l)) ? ' some stopped' : ''));
    console.log(seq.filter((x, i) => process.env.ALL || i % 4 === 0).map((x) => x.t + 'ms pos=' + x.pos + ' ' + x.src + ' lv=' + x.lv + ' ' + x.ctx).join('\n'));
    console.log(log.filter((l) => /PAGE ERROR/.test(l)).join('\n'));
    await browser.close(); app.close(); google.close();
    process.exit(0);
}
if (process.env.NEXT) {
    // play 3 s, then Next: the grey bar must go straight to empty (no animation back), then only grow; the old download stops
    await page.waitForTimeout(3000);
    log.push((Date.now() % 100000) + ' --- NEXT pressed ---');
    await page.click('.mx-np-ctl button[data-c="next"], .mx-np [aria-label="Next"]').catch(async () => { await page.evaluate(() => Music.next()); });
    const seq = [];
    for (let i = 0; i < 60; i++) {
        seq.push(await page.evaluate(() => { const b = document.querySelector('.mx-np-load'); return { l: +(Music.state().loaded || 0).toFixed(2), bar: b ? b.style.transform.replace(/scaleX\(|\)/g, '').slice(0, 4) : '', anim: b ? b.style.transition || 'smooth' : '', title: Music.state().title }; }));
        await page.waitForTimeout(50);
    }
    let back = 0;
    for (let i = 1; i < seq.length; i++) if (seq[i].l < seq[i - 1].l && seq[i].l > 0) back++;
    const firstDrop = seq.findIndex((x) => x.l === 0);
    console.log('after Next: loaded values ' + seq.map((x) => x.l).join(' '));
    console.log('bar (DOM) ' + seq.map((x) => x.bar + (x.anim === 'none' ? '!' : '')).join(' '));
    console.log('titles ' + [...new Set(seq.map((x) => x.title))].join(' -> '));
    console.log(back ? 'NOT OK: the bar went back ' + back + ' time(s) after it started growing' : 'OK: after Next the bar goes to 0 at once (no animation) and then only grows');
    await page.screenshot({ path: path.join(OUT, 'next-' + MODE + '-' + FORMAT + '.png') });
    console.log(log.filter((l) => /NEXT|STOPPED|big1|big2/.test(l)).slice(-16).join('\n'));
    await browser.close(); app.close(); google.close();
    process.exit(0);
}
for (let i = 0; i < 26; i++) {
    await page.waitForTimeout(400);
    const s = await page.evaluate(() => { const st = Music.state(); return { playing: st.playing && !st.loading, engine: Music.engineName(), pos: +st.pos.toFixed(1), dur: Math.round(st.dur), loaded: +(st.loaded || 0).toFixed(2), err: st.error, grow: Music._grow(), stream: Music._streaming(), src: (Music._engines.HTML._src() || '').slice(0, 40) }; });
    s.t = Date.now() - t0;
    states.push(s);
    // the proof: playing for more than a second while the grey bar is between a quarter and three quarters
    if (!shotAt && s.playing && s.pos > 1 && s.loaded > 0.25 && s.loaded < 0.75) { shotAt = s.t; await page.screenshot({ path: path.join(OUT, MODE + '-' + FORMAT + '.png') }); }
}
console.log(MODE + ' ' + FORMAT + ': ' + (shotAt ? 'PLAYING while half loaded, screenshot at ' + shotAt + ' ms' : 'NOT PROVEN'));
console.log(states.map((s) => JSON.stringify(s)).join('\n'));
console.log(log.slice(0, 30).join('\n'));
await browser.close(); app.close(); google.close();
process.exit(0);
