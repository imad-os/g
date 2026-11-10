// Draws the My PC icon (a classic PC monitor, original art) in every size the app needs:
//   web app: favicon.ico (16/32/48), icon-32.png, icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png
//   Tizen .wgt: icon.png 512x423 24-bit PNG < 300 KB (config.xml <icon>, Seller Office icon)
//   Seller Office: store/logo_1920x1080.png (transparent)
//   Android APK: res/mipmap-*/ic_launcher_foreground.png (adaptive icon layer; background = drawable/ic_launcher_bg.xml)
//   node tools/make-icons.mjs        (Playwright's Chromium; CHROMIUM_PATH=... to use another one)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RES = path.join(ROOT, 'android-controller/app/src/main/res');

const DEFS = `<defs>
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b2a4e"/><stop offset="1" stop-color="#0b1226"/></linearGradient>
<radialGradient id="scr" cx=".65" cy=".7" r=".9"><stop offset="0" stop-color="#9ee7ff"/><stop offset=".35" stop-color="#2f8cff"/><stop offset=".8" stop-color="#1a3fb8"/><stop offset="1" stop-color="#14267a"/></radialGradient></defs>`;
// the monitor in a 384 x 324 box
const PC = `<rect x="142" y="248" width="100" height="62" fill="#aab6cc"/>
<rect x="86" y="294" width="212" height="30" rx="15" fill="#dbe3f0"/>
<rect x="0" y="0" width="384" height="264" rx="34" fill="#e9eef7"/>
<rect x="22" y="22" width="340" height="208" rx="14" fill="url(#scr)"/>
<path d="M22 36a14 14 0 0 1 14-14h150l-98 208H36a14 14 0 0 1-14-14Z" fill="#fff" opacity=".12"/>`;
// monitor `fill` of the shorter side wide, centred
const mon = (w, h, fill) => { const s = (Math.min(w, h) * fill) / 384; return `<g transform="translate(${(w - 384 * s) / 2} ${(h - 324 * s) / 2}) scale(${s})">${PC}</g>`; };
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${DEFS}${body}</svg>`;
const tile = (s, round, fill = 0.75) => svg(s, s, `<rect width="${s}" height="${s}" rx="${round}" fill="url(#bg)"/>${mon(s, s, fill)}`);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
async function render(html, w, h, transparent = true) {
    await page.setViewportSize({ width: w, height: h });
    await page.setContent('<html><body style="margin:0;background:transparent">' + html + '</body></html>');
    return page.screenshot({ type: 'png', omitBackground: transparent });
}
const put = (f, b) => { fs.mkdirSync(path.dirname(path.join(ROOT, f)), { recursive: true }); fs.writeFileSync(path.join(ROOT, f), b); };

// Samsung asks for a 24-bit icon: Chromium writes an opaque screenshot as RGB (PNG colour type 2)
const toRgb = (png) => { if (png[25] !== 2) throw new Error('expected a 24-bit PNG'); return png; };

// Tizen / Seller Office icon: full bleed, the TV draws its own frame
put('icon.png', toRgb(await render(svg(512, 423, `<rect width="512" height="423" fill="url(#bg)"/>${mon(512, 423, 0.86)}`), 512, 423, false)));
// browsers and the installed web app
put('icon-32.png', await render(tile(32, 7, 0.86), 32, 32));
put('icon-192.png', await render(tile(192, 42), 192, 192));
put('icon-512.png', await render(tile(512, 112), 512, 512));
put('icon-maskable-512.png', toRgb(await render(tile(512, 0, 0.6), 512, 512, false)));      // safe zone: the central 80 %
put('apple-touch-icon.png', toRgb(await render(tile(180, 0, 0.72), 180, 180, false)));      // iOS rounds it itself
{   // favicon.ico = PNG-compressed ICO with 16, 32 and 48 px images
    const imgs = [];
    for (const s of [16, 32, 48]) imgs.push([s, await render(tile(s, Math.round(s * 0.22), 0.86), s, s)]);
    const head = Buffer.alloc(6 + 16 * imgs.length);
    head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(imgs.length, 4);
    let off = head.length;
    imgs.forEach(([size, b], i) => {
        const e = 6 + i * 16;
        head.writeUInt8(size, e); head.writeUInt8(size, e + 1); head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
        head.writeUInt32LE(b.length, e + 8); head.writeUInt32LE(off, e + 12); off += b.length;
    });
    put('favicon.ico', Buffer.concat([head, ...imgs.map((x) => x[1])]));
}
// Seller Office logo: the monitor and the name on transparency
put('store/logo_1920x1080.png', await render(svg(1920, 1080, `<g transform="translate(${(1920 - 384 * 1.4) / 2} 200) scale(1.4)">${PC}</g>
  <text x="960" y="860" text-anchor="middle" font-family="'Segoe UI Variable','Segoe UI',Inter,Roboto,Arial,sans-serif" font-weight="700" font-size="170" fill="#ffffff">My PC</text>`), 1920, 1080));
// Android adaptive icon foreground: 108 dp canvas, the monitor inside the central 66 dp
for (const [d, s] of [['mdpi', 108], ['hdpi', 162], ['xhdpi', 216], ['xxhdpi', 324], ['xxxhdpi', 432]]) {
    fs.mkdirSync(path.join(RES, 'mipmap-' + d), { recursive: true });
    fs.writeFileSync(path.join(RES, 'mipmap-' + d, 'ic_launcher_foreground.png'), await render(svg(s, s, mon(s, s, 0.56)), s, s));
}
await browser.close();
for (const f of ['icon.png', 'icon-32.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'favicon.ico', 'store/logo_1920x1080.png'])
    console.log(f.padEnd(28), (fs.statSync(path.join(ROOT, f)).size / 1024).toFixed(1) + ' KB');
