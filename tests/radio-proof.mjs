// MyMusic's online radio in a real browser, with screenshots (owner request 2026-11-06). Never reaches the internet: Radio
// Browser is answered here with its own JSON fields, and the "stations" are a song sent again and again from this computer.
//   CHROMIUM_PATH=... node tests/radio-proof.mjs <folder with groove.mp3> <live|file>
// live: a browser (the web player); file: a Samsung TV (AVPlay, mocked: it only keeps the time and the address it opened).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [DIR = '/tmp/saver', MODE = 'live', SONG = 'groove.mp3'] = process.argv.slice(2);
let streams = 0;
const OUT = path.join(DIR, 'shots'); fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.webmanifest': 'application/manifest+json' };
const app = http.createServer((q, r) => {
    const u = decodeURIComponent(q.url.split('?')[0]);
    // a fake live station: the song sent again and again, no length (like Icecast); /__radio/dead: the connection drops
    if (u.startsWith('/__radio/live/')) {
        streams++;
        r.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-cache', 'icy-name': 'test' });
        const buf = fs.readFileSync(path.join(DIR, SONG));
        let n = 0; const send = () => { if (r.destroyed || n++ > 6) return r.end(); r.write(buf, send); };
        return send();
    }
    if (u.startsWith('/__radio/dead')) return q.socket.destroy();
    if (u.startsWith('/__radio/logo/')) {
        const c = u.split('/').pop().replace('.svg', '');
        r.writeHead(200, { 'Content-Type': 'image/svg+xml' });
        return r.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#' + c + '"/><circle cx="32" cy="32" r="14" fill="#fff" opacity=".85"/></svg>');
    }
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



// Radio Browser, answered here (this test never reaches the internet): the same fields as the real service
const ST = [
    ['Hit Radio', 'pop,hits,music', 'arabic,french', 128, 'MP3', 'e53935'], ['Medi 1 Radio', 'news,talk,music', 'arabic,french', 64, 'AAC+', '1e88e5'],
    ['Radio Mars', 'sports,football', 'arabic', 128, 'MP3', 'fb8c00'], ['Chada FM', 'pop,chaabi,music', 'arabic', 128, 'MP3', '8e24aa'],
    ['Luxe Radio', 'jazz,lounge', 'french', 128, 'MP3', '6d4c41'], ['MFM Radio', 'pop,hits', 'arabic,french', 96, 'AAC', '00897b'],
    ['Aswat', 'news,pop', 'arabic', 128, 'MP3', '3949ab'], ['Radio 2M', 'pop,talk', 'arabic,french', 128, 'MP3', 'c0ca33'],
    ['SNRT Chaine Inter', 'news,talk', 'french,english', 64, 'AAC', '546e7a'], ['Radio Coran', 'religious,quran', 'arabic', 64, 'MP3', '43a047'],
    ['Old Dead Stream', 'pop', 'arabic', 128, 'MP3', '9e9e9e'], ['Atlas Amazigh FM', 'amazigh,folk', 'tamazight,arabic', 128, 'MP3', 'd81b60']
];
const rb = (cc) => ST.map((s, i) => ({ stationuuid: cc + '-uuid-' + i, name: s[0] + (cc === 'MA' ? '' : ' ' + cc), url: base + (s[0].startsWith('Old') ? '__radio/dead/' : '__radio/live/') + i,
    url_resolved: base + (s[0].startsWith('Old') ? '__radio/dead/' : '__radio/live/') + i, favicon: i % 5 === 4 ? 'http://logos.invalid/x.png' : base + '__radio/logo/' + s[5] + '.svg',
    tags: s[1], countrycode: cc, country: cc === 'MA' ? 'Morocco' : 'France', language: s[2], codec: s[4], bitrate: s[3], hls: 0, lastcheckok: 1, clickcount: 1000 - i }));
let clicks = 0, searches = 0;
await ctx.route(/api\.radio-browser\.info/, (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/json/stations/search') { searches++; return route.fulfill({ json: rb(u.searchParams.get('countrycode')) }); }
    if (u.pathname === '/json/countries') return route.fulfill({ json: [{ name: 'Morocco', iso_3166_1: 'MA', stationcount: 412 }, { name: 'France', iso_3166_1: 'FR', stationcount: 3800 }, { name: 'Algeria', iso_3166_1: 'DZ', stationcount: 210 }] });
    if (u.pathname.startsWith('/json/url/')) { clicks++; return route.fulfill({ json: { ok: true } }); }
    route.fulfill({ status: 404, body: '' });
});
const ok = []; const check = (c, m) => { ok.push(!!c); console.log((c ? '  ok   ' : '  FAIL ') + m); };
const press = async (k) => { await page.keyboard.press(k); await page.waitForTimeout(160); };
const name = (x) => 'radio-' + MODE + '-' + x;
const snap = (x) => page.screenshot({ path: path.join(OUT, name(x) + '.png') });

await page.evaluate(() => Win.open('music'));
await page.waitForSelector('.mx-nav[data-nav="radio"]');
check(await page.evaluate(() => document.querySelector('.mx-title').textContent === 'MyMusic' && I18n.t('music') === 'MyMusic'), 'the app is called MyMusic');
await page.waitForTimeout(900);
await snap('1-home');
await page.evaluate(() => document.querySelector('.mx-nav[data-nav="radio"]').click());
await page.waitForSelector('.mx-st', { timeout: 10000 });
await page.waitForTimeout(2500);                                       // the stream tests on screen
const list1 = await page.evaluate(() => [...document.querySelectorAll('.mx-st')].map((b) => b._e.n));
check(list1.length === 11 && list1.indexOf('Old Dead Stream') < 0, 'Moroccan stations imported; the dead stream was tested and hidden (' + list1.length + ' shown)');
check(await page.evaluate(() => /1/.test([...document.querySelectorAll('.mx-st-foot .mx-act')].map((b) => b.textContent).join())), 'the footer offers to show the 1 hidden station');
const logos = await page.evaluate(() => document.querySelectorAll('.mx-st .mx-art img').length);
check(logos >= 8, 'logos shown (' + logos + '), names and bitrate: ' + await page.evaluate(() => document.querySelector('.mx-st .mx-ra').textContent));
await snap('2-stations');
// the arrows only move the focus (owner request 2026-11-07): from the Language filter, Right goes to Genre, Down reaches the stations
await page.evaluate(() => { const b = [...document.querySelectorAll('.mx-step')][0]; Focus.focus(b); });
const lang0 = await page.evaluate(() => document.querySelectorAll('.mx-step')[0].textContent);
await press('ArrowRight');
const nav1 = await page.evaluate(() => ({ onGenre: Focus.current() === document.querySelectorAll('.mx-step')[1], lang: document.querySelectorAll('.mx-step')[0].textContent }));
await press('ArrowDown');
const nav2 = await page.evaluate(() => !!Focus.current() && Focus.current().classList.contains('mx-st') || (Focus.current() && Focus.current().className + ':' + Focus.current().textContent.slice(0, 30)));
check(nav1.onGenre && nav1.lang === lang0 && nav2 === true, 'arrows move between the filters and down to the stations, never change a filter ' + JSON.stringify(nav1) + ' station focused: ' + nav2);
// genre filter: OK on the Genre filter twice
await page.evaluate(() => { const b = [...document.querySelectorAll('.mx-step')][1]; Focus.focus(b); });
await press('Enter'); await press('Enter');
await page.waitForTimeout(1200);
const g = await page.evaluate(() => ({ step: [...document.querySelectorAll('.mx-step')][1].textContent, n: document.querySelectorAll('.mx-st').length, names: [...document.querySelectorAll('.mx-st')].map((b) => b._e.n) }));
check(g.n > 0 && g.n < 11, 'genre filter: ' + g.step.replace(/\s+/g, ' ') + ' -> ' + g.names.join(', '));
await snap('3-genre');
// hold OK on a filter: every choice in a list
await page.evaluate(() => { const b = [...document.querySelectorAll('.mx-step')][1]; Focus.focus(b); });
await page.keyboard.down('Enter'); await page.waitForTimeout(800); await page.keyboard.up('Enter'); await page.waitForTimeout(200);
const mopts = await page.evaluate(() => [...document.querySelectorAll('.mx-menu-i')].map((x) => x.textContent));
check(mopts.length > 5 && mopts.some((x) => /^✓/.test(x)), 'hold OK on a filter lists every choice (' + mopts.length + ')');
await snap('3b-filter-list');
await page.evaluate(() => [...document.querySelectorAll('.mx-menu-i')].find((x) => /Jazz/.test(x.textContent)).click());
await page.waitForTimeout(600);
const jz = await page.evaluate(() => [...document.querySelectorAll('.mx-st')].map((b) => b._e.n));
check(jz.join() === 'Luxe Radio', 'picking Jazz from the list: ' + jz.join(', '));
await page.evaluate(() => Radio.setPref('tag', ''));
await page.evaluate(() => { Radio.setPref('tag', ''); Radio.setPref('lang', 'french'); });
await page.evaluate(() => document.querySelector('.mx-nav[data-nav="radio"]').click());
await page.waitForTimeout(800);
const lg = await page.evaluate(() => [...document.querySelectorAll('.mx-st')].map((b) => b._e.n));
check(lg.length > 0 && lg.indexOf('Radio Mars') < 0, 'language filter (French): ' + lg.join(', '));
await page.evaluate(() => Radio.setPref('lang', ''));
// search by name, then by genre
await page.evaluate(() => document.querySelector('.mx-nav[data-nav="radio"]').click());
await page.waitForTimeout(500);
await page.evaluate(() => document.querySelector('.mx-actions .mx-act-main').click());
await page.evaluate(() => { Keyboard.setText('mars'); Keyboard.submit(); });
await page.waitForTimeout(600);
const sr = await page.evaluate(() => [...document.querySelectorAll('.mx-st')].map((b) => b._e.n));
check(sr.join() === 'Radio Mars', 'search by name "mars": ' + sr.join(', '));
await page.evaluate(() => document.querySelector('.mx-actions .mx-act-main').click());
await page.evaluate(() => { Keyboard.setText('jazz'); Keyboard.submit(); });
await page.waitForTimeout(600);
const sg = await page.evaluate(() => [...document.querySelectorAll('.mx-st')].map((b) => b._e.n));
check(sg.join() === 'Luxe Radio', 'search by genre "jazz": ' + sg.join(', '));
await snap('4-search');
// a custom stream address
await page.evaluate(() => [...document.querySelectorAll('.mx-actions .mx-act')].find((b) => /Clear|Search:/.test(b.getAttribute('aria-label') || b.textContent)).click());
await page.waitForTimeout(300);
await page.evaluate(() => [...document.querySelectorAll('.mx-actions .mx-act')].find((b) => /Add a station/.test(b.textContent)).click());
await page.evaluate(() => { Keyboard.setText('My Own FM'); Keyboard.submit(); });
await page.waitForTimeout(200);
await page.evaluate((b) => { Keyboard.setText(b + '__radio/live/99'); Keyboard.submit(); }, base);
await page.waitForTimeout(700);
check(await page.evaluate(() => Radio.custom().length === 1 && [...document.querySelectorAll('.mx-st')].some((b) => b._e.n === 'My Own FM')), 'a station added by hand (its own stream address) is listed under My stations');
// play a station: Samsung's player on the TV, the web player in a browser
await page.evaluate(() => [...document.querySelectorAll('.mx-st')].find((b) => b._e.n === 'Hit Radio').click());
await page.waitForFunction(() => Music.state().playing && !Music.state().loading, null, { timeout: 15000 });
await page.waitForTimeout(2500);
const p1 = await page.evaluate(() => ({ eng: Music.engineName(), live: Music.state().live, t: Music.time(), title: Music.state().title, av: window.__av ? window.__av.url : '', np: document.querySelector('.mx-np-times').textContent }));
check(p1.live && (MODE === 'file' ? p1.eng === 'av' && /__radio\/live\/0/.test(p1.av) : p1.eng === 'html' && p1.t > 1), 'plays live with ' + (p1.eng === 'av' ? "Samsung's own player (AVPlay)" : 'the web player') + ': ' + JSON.stringify(p1));
check(clicks === 1, 'Radio Browser was told about the play (their click count) ' + clicks);
await snap('5-now-playing');
// favorites and recently played, saved for this user only
await page.evaluate(() => document.querySelector('.mx-np') && Win.back ? 0 : 0);
await press('Escape');
await page.waitForTimeout(400);
await page.evaluate(() => { const b = [...document.querySelectorAll('.mx-st')].find((x) => x._e.n === 'Radio Mars'); Focus.focus(b); });
await press('Equal');      // + = the item's menu? (fallback below)
let menuOpen = await page.evaluate(() => !!document.querySelector('.mx-menu'));
if (!menuOpen) { await page.evaluate(() => { const b = [...document.querySelectorAll('.mx-st')].find((x) => x._e.n === 'Radio Mars'); b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })); }); await page.waitForTimeout(200); }
await page.evaluate(() => [...document.querySelectorAll('.mx-menu-i')].find((b) => /favorites/.test(b.textContent)).click());
await page.waitForTimeout(500);
const per = await page.evaluate(() => ({ favs: Radio.favs().map((s) => s.n), recent: Radio.recent().map((s) => s.n), keys: Object.keys(localStorage).filter((k) => /radio_(favs|recent|custom)/.test(k)), profile: Store.profile() }));
check(per.favs.join() === 'Radio Mars' && per.recent[0] === 'Hit Radio' && per.keys.every((k) => k.indexOf('arc_' + per.profile + '_') === 0), 'favorites / recently played / own stations saved in this user\'s profile: ' + JSON.stringify(per));
await page.evaluate(() => document.querySelector('.mx-nav[data-nav="radio"]').click());
await page.waitForTimeout(800);
await snap('6-favorites');
// another country
await page.evaluate(() => [...document.querySelectorAll('.mx-actions .mx-act')].find((b) => /Country/.test(b.textContent)).click());
await page.waitForSelector('.mx-row.on');
await snap('7-countries');
await page.evaluate(() => [...document.querySelectorAll('.mx-row')].find((b) => /FR/.test(b.textContent)).click());
await page.waitForTimeout(1500);
const fr = await page.evaluate(() => ({ sub: document.querySelector('.mx-sub').textContent, n: [...document.querySelectorAll('.mx-st')].filter((b) => / FR$/.test(b._e.n)).length }));
check(fr.n > 0, 'country filter: France -> ' + fr.sub);
await page.evaluate(() => Radio.setPref('cc', 'MA'));
// cached: a second open does not ask Radio Browser again
const before = searches;
await page.evaluate(() => { Win.close(); Win.open('music'); });
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('.mx-nav[data-nav="radio"]').click());
await page.waitForTimeout(800);
check(searches === before && await page.evaluate(() => document.querySelectorAll('.mx-st').length > 5), 'the station list comes from the cache on the device (no new request), refreshed after a day');
// the music goes on: another app, then a page change (like a game opening and closing)
await page.evaluate(() => { Win.close(); Win.open('settings'); });
await page.waitForTimeout(1500);
check(await page.evaluate(() => Music.state().playing && Music.state().live), 'still playing with another app open');
await page.goto(base + 'index.html?from=test');
await page.waitForSelector('#desk-icons .dicon', { timeout: 30000 });
if (MODE === 'file') await page.waitForTimeout(500);
await page.waitForFunction(() => Music.state().playing && !Music.state().loading, null, { timeout: 15000 }).catch(() => {});
const p2 = await page.evaluate(() => ({ playing: Music.state().playing, title: Music.state().title, eng: Music.engineName() }));
check(p2.playing && p2.title === 'Hit Radio', 'after a page change (as after a game) the station plays on: ' + JSON.stringify(p2));
console.log(errors.length ? 'PAGE ERRORS ' + errors.join(' | ') : 'no page errors');
await browser.close(); app.close();
console.log(ok.every(Boolean) && !errors.length ? 'ALL OK' : 'SOME FAILED');
process.exit(ok.every(Boolean) && !errors.length ? 0 : 1);
