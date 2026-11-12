// Theme drawing cost proof (owner report 2026-11-12: "Neon night is very laggy on the TV").
// node tests/theme-perf-proof.mjs [outDir]   (CHROMIUM_PATH for the browser; THROTTLE=6 by default)
// For each theme: the same remote moves on the desktop, in Start, Control Panel and the on-screen keyboard, traced with
// Chrome's timeline; prints the main thread time spent on style / layout / paint and the raster time, per theme.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = process.argv[2] || '';
const THROTTLE = +(process.env.THROTTLE || 6);
const themes = (process.env.THEMES || 'win11,neon,quest').split(',');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wav': 'audio/wav' };
const srv = http.createServer((q, r) => {
    const f = path.join(root, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
    fs.readFile(f, (e, b) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); r.end(b); });
}).listen(0);
const base = 'http://127.0.0.1:' + srv.address().port + '/';
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

const MAIN = { UpdateLayoutTree: 'style', Layout: 'layout', PrePaint: 'paint', Paint: 'paint', PaintImage: 'paint', Layerize: 'paint', UpdateLayer: 'paint', CompositeLayers: 'paint' };
async function run(theme) {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => /open-meteo/.test(r.request().url()) ? r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ current: { temperature_2m: 21, weather_code: 2, is_day: 1, wind_speed_10m: 10, relative_humidity_2m: 60, apparent_temperature: 21 }, daily: { temperature_2m_max: [24], temperature_2m_min: [15], weather_code: [2], sunrise: ['2026-11-12T07:00'], sunset: ['2026-11-12T18:00'] }, hourly: { time: [], temperature_2m: [], weather_code: [], precipitation_probability: [] } }) })
        : /geojs/.test(r.request().url()) ? r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"latitude":"33.59","longitude":"-7.61","city":"Casablanca"}' }) : r.abort());
    const page = await ctx.newPage();
    await page.goto(base + 'index.html');
    await page.waitForSelector('#desk-icons .dicon', { timeout: 20000 });
    await page.evaluate((t) => { Themes.set(t); Widgets.set('sysmon', 'show', true); Widgets.set('quick', 'show', true); Notify.clear(); }, theme);
    if (process.env.INJECT) await page.addStyleTag({ content: process.env.INJECT });
    await page.waitForTimeout(1500);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
    const events = [];
    cdp.on('Tracing.dataCollected', (d) => events.push(...d.value));
    const done = new Promise((ok) => cdp.once('Tracing.tracingComplete', ok));
    await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,cc,viz', transferMode: 'ReportEvents' });
    const t0 = Date.now();
    const key = async (k, n, gap) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(gap || 120); } };
    if (process.env.IDLE) { await page.waitForTimeout(4000); } else {
    // 1. desktop: walk the icons, then the widgets
    await page.evaluate(() => document.querySelector('#desk-icons .dicon').focus());
    await key('ArrowRight', 6); await key('ArrowDown', 3); await key('ArrowLeft', 4);
    await page.evaluate(() => Desktop.tick());
    await page.evaluate(() => console.timeStamp('start'));
    // 2. Start open, walk, close
    await page.evaluate(() => Desktop.openStart()); await page.waitForTimeout(300);
    await key('ArrowRight', 5); await key('ArrowDown', 2);
    await page.evaluate(() => Desktop.closeStart());
    await page.evaluate(() => console.timeStamp('cp'));
    // 3. Control Panel > Widgets, walk the rows
    await page.evaluate(() => Win.open('settings', 'widgets')); await page.waitForTimeout(500);
    await page.evaluate(() => console.timeStamp('rows'));
    await page.evaluate(() => document.querySelector('.set-row').focus());
    await key('ArrowDown', 7);
    await page.evaluate(() => console.timeStamp('kb'));
    // 4. the on-screen keyboard
    await page.evaluate(() => { Win.close(); Keyboard.open({ title: 'Name', mode: 'title', max: 30 }, function () {}); }); await page.waitForTimeout(500);
    await page.evaluate(() => console.timeStamp('keys'));
    await key('ArrowRight', 6); await key('ArrowDown', 2);
    if (out) await page.screenshot({ path: path.join(out, 'perf-' + theme + '-keyboard.png') });
    await page.keyboard.press('Escape');
    }
    const wall = Date.now() - t0;
    await cdp.send('Tracing.end');
    await done;
    const sum = { style: 0, layout: 0, paint: 0, raster: 0 };
    let worst = 0;
    const marks = events.filter((e) => e.name === 'TimeStamp').map((e) => [e.args.data.message, e.ts]);
    const phase = (ts) => { let p = 'desk'; for (const [m, t] of marks) if (ts >= t) p = m; return p; };
    for (const e of events) {
        if (e.ph === 'X' && e.name === 'RasterTask') { const k = 'r_' + phase(e.ts); sum[k] = (sum[k] || 0) + e.dur / 1000; }
        if (e.ph !== 'X' || !e.dur) continue;
        if (MAIN[e.name]) sum[MAIN[e.name]] += e.dur / 1000;
        if (e.name === 'RasterTask') sum.raster += e.dur / 1000;
        if (e.name === 'Paint' && e.dur / 1000 > worst) worst = e.dur / 1000;
    }
    await ctx.close();
    return { theme, wall, ...Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, Math.round(v)])), worstPaint: Math.round(worst) };
}
const rows = [];
for (const t of themes) rows.push(await run(t));
console.log('CPU throttled x' + THROTTLE + ' (ms of work for the same 46 moves)');
console.table(rows);
await browser.close(); srv.close();
