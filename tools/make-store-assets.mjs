// Generates the My PC app icon, browser favicons and the Samsung Seller Office images.
// The icon is an original drawing (a modern monitor with a bloom wallpaper, two windows and a
// taskbar); the screenshots are real captures of the app.
//
//   npx http-server -p 8080 -c-1 .     (in another terminal)
//   CHROMIUM_PATH=/path/to/chrome node tools/make-store-assets.mjs http://localhost:8080/
//
// Output (sizes from Samsung's "App Icons and Screenshots" guide):
//   icon.png                       512x423  24-bit PNG  < 300 KB   (config.xml <icon>, Seller Office 512x423 icon)
//   favicon.ico, icon-32.png, icon-192.png, apple-touch-icon.png   (desktop/mobile browsers)
//   store/logo_1920x1080.png       32-bit PNG with transparency < 300 KB (Seller Office "logo image")
//   store/background_1920x1080.jpg 24-bit JPG < 300 KB                  (Seller Office "background image")
//   store/screenshot_1..4.jpg      1920x1080 JPG < 500 KB               (4 screenshots)

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv[2] || 'http://localhost:8080/';
const OUT = path.join(ROOT, 'store');
fs.mkdirSync(OUT, { recursive: true });

/* ---------------- the artwork ---------------- */

const DEFS = `
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0a1230"/><stop offset="1" stop-color="#0f3f94"/></linearGradient>
  <radialGradient id="glow" cx="0.5" cy="0.45" r="0.6"><stop offset="0" stop-color="#4cc2ff" stop-opacity="0.45"/><stop offset="1" stop-color="#4cc2ff" stop-opacity="0"/></radialGradient>
  <radialGradient id="bloom" cx="0.62" cy="0.55" r="0.75"><stop offset="0" stop-color="#b4f1ff"/><stop offset="0.3" stop-color="#3fa0ff"/><stop offset="0.68" stop-color="#1f55d6"/><stop offset="1" stop-color="#0a1f5c"/></radialGradient>
  <radialGradient id="lobe" cx="0.3" cy="0.75" r="0.45"><stop offset="0" stop-color="#8a6cff" stop-opacity="0.65"/><stop offset="1" stop-color="#8a6cff" stop-opacity="0"/></radialGradient>
  <linearGradient id="base" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c5d2e6"/><stop offset="1" stop-color="#7f90aa"/></linearGradient>
  <linearGradient id="neck" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8d9db7"/><stop offset="0.5" stop-color="#cdd8ea"/><stop offset="1" stop-color="#8d9db7"/></linearGradient>
  <clipPath id="scr"><rect x="12" y="12" width="296" height="176" rx="12"/></clipPath>
</defs>`;

// the monitor, drawn in a 320 x 246 box
const PC = `
<g>
  <ellipse cx="160" cy="246" rx="92" ry="8" fill="#000" opacity="0.3"/>
  <rect x="140" y="196" width="40" height="42" fill="url(#neck)"/>
  <rect x="92" y="230" width="136" height="14" rx="7" fill="url(#base)"/>
  <rect x="0" y="0" width="320" height="212" rx="24" fill="#0b0f19"/>
  <rect x="1.5" y="1.5" width="317" height="209" rx="22.5" fill="none" stroke="#6f80a0" stroke-opacity="0.6" stroke-width="3"/>
  <rect x="12" y="12" width="296" height="176" rx="12" fill="url(#bloom)"/>
  <g clip-path="url(#scr)">
    <rect x="12" y="12" width="296" height="176" fill="url(#lobe)"/>
    <path d="M12 12H150L62 188H12Z" fill="#fff" opacity="0.07"/>
    <rect x="44" y="38" width="128" height="92" rx="10" fill="#f4f8ff" opacity="0.96"/>
    <path d="M54 38H162a10 10 0 0 1 10 10v12H44V48a10 10 0 0 1 10-10Z" fill="#d8e4f6"/>
    <circle cx="57" cy="49" r="3.2" fill="#ff6b6b"/><circle cx="68" cy="49" r="3.2" fill="#ffd23f"/><circle cx="79" cy="49" r="3.2" fill="#4cd97b"/>
    <rect x="58" y="74" width="72" height="7" rx="3.5" fill="#b4c6e3"/><rect x="58" y="89" width="98" height="7" rx="3.5" fill="#b4c6e3"/><rect x="58" y="104" width="54" height="7" rx="3.5" fill="#b4c6e3"/>
    <rect x="126" y="82" width="152" height="86" rx="10" fill="#131a2d" opacity="0.94"/>
    <rect x="126.5" y="82.5" width="151" height="85" rx="9.5" fill="none" stroke="#fff" stroke-opacity="0.2"/>
    <path d="M136 82H268a10 10 0 0 1 10 10v10H126V92a10 10 0 0 1 10-10Z" fill="#1f2a47"/>
    <circle cx="150" cy="130" r="17" fill="#4cc2ff"/>
    <rect x="176" y="118" width="84" height="8" rx="4" fill="#7189b8"/><rect x="176" y="133" width="58" height="8" rx="4" fill="#7189b8"/>
    <rect x="176" y="148" width="46" height="13" rx="6.5" fill="#4cc2ff"/>
    <rect x="24" y="162" width="272" height="20" rx="10" fill="#0a0f1f" opacity="0.86"/>
    <rect x="119" y="169" width="6" height="6" rx="1.6" fill="#4cc2ff"/><rect x="127" y="169" width="6" height="6" rx="1.6" fill="#4cc2ff"/>
    <rect x="119" y="177" width="6" height="0" rx="1.6" fill="#4cc2ff"/>
    <circle cx="146" cy="172" r="4.6" fill="#7cd992"/><circle cx="162" cy="172" r="4.6" fill="#ffd23f"/><circle cx="178" cy="172" r="4.6" fill="#ff8a65"/><circle cx="194" cy="172" r="4.6" fill="#fff" opacity="0.9"/>
  </g>
</g>`;

// transform that centres the monitor in a w x h canvas, using `fill` of the canvas width
const place = (w, h, fill) => { const s = (w * fill) / 320; return `translate(${(w - 320 * s) / 2} ${(h - 246 * s) / 2 + 2}) scale(${s})`; };

const svgIcon = (w, h, { round = 0, fill = 0.74 } = {}) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${DEFS}
  <rect width="${w}" height="${h}" rx="${round}" fill="url(#bg)"/><rect width="${w}" height="${h}" rx="${round}" fill="url(#glow)"/>
  <g transform="${place(w, h, fill)}">${PC}</g></svg>`;

const svgLogo = () => `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">${DEFS}
  <g transform="translate(${(1920 - 320 * 1.55) / 2} 250) scale(1.55)">${PC}</g>
  <text x="960" y="840" text-anchor="middle" font-family="'Segoe UI Variable','Segoe UI',Inter,Roboto,Arial,sans-serif" font-weight="700" font-size="170" fill="#ffffff">My PC</text></svg>`;

// a wallpaper like the desktop's "Bloom" (css/launcher.css .wp-bloom)
const bgHtml = `<html><body style="margin:0;width:1920px;height:1080px;background-color:#07122a;
  background-image:radial-gradient(30% 45% at 60% 55%, rgba(125,215,255,.95) 0%, rgba(0,120,212,.65) 40%, rgba(7,18,42,0) 100%),radial-gradient(35% 40% at 45% 68%, rgba(120,90,255,.6) 0%, rgba(7,18,42,0) 100%),radial-gradient(25% 30% at 72% 40%, rgba(0,200,255,.45) 0%, rgba(7,18,42,0) 100%),linear-gradient(160deg,#050c1c 0%,#0c2147 55%,#081430 100%)"></body></html>`;

/* ---------------- render ---------------- */

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.route('**/imad-os.github.io/**', (r) => r.abort());

async function render(html, w, h, opts = {}) {
    await page.setViewportSize({ width: w, height: h });
    await page.setContent('<html><body style="margin:0;background:transparent">' + html + '</body></html>');
    return page.screenshot({ type: opts.jpeg ? 'jpeg' : 'png', quality: opts.jpeg ? 88 : undefined, omitBackground: !!opts.transparent });
}

fs.writeFileSync(path.join(ROOT, 'icon.png'), await render(svgIcon(512, 423, { fill: 0.7 }), 512, 423));
fs.writeFileSync(path.join(OUT, 'logo_1920x1080.png'), await render(svgLogo(), 1920, 1080, { transparent: true }));
await page.setViewportSize({ width: 1920, height: 1080 });
await page.setContent(bgHtml);
fs.writeFileSync(path.join(OUT, 'background_1920x1080.jpg'), await page.screenshot({ type: 'jpeg', quality: 86 }));

// favicons: the monitor on a rounded square (apple-touch-icon is full bleed: iOS rounds it)
const sq = (size, round) => render(svgIcon(size, size, { round, fill: 0.84 }), size, size, { transparent: true });
fs.writeFileSync(path.join(ROOT, 'icon-32.png'), await sq(32, 7));
fs.writeFileSync(path.join(ROOT, 'icon-192.png'), await sq(192, 42));
fs.writeFileSync(path.join(ROOT, 'apple-touch-icon.png'), await render(svgIcon(180, 180, { round: 0, fill: 0.84 }), 180, 180));
const ico = [[16, await sq(16, 4)], [32, fs.readFileSync(path.join(ROOT, 'icon-32.png'))], [48, await sq(48, 11)]];
{   // favicon.ico = PNG-compressed ICO with 16, 32 and 48 px images
    const head = Buffer.alloc(6 + 16 * ico.length);
    head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(ico.length, 4);
    let off = head.length;
    ico.forEach(([size, b], i) => {
        const e = 6 + i * 16;
        head.writeUInt8(size, e); head.writeUInt8(size, e + 1); head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3);
        head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6); head.writeUInt32LE(b.length, e + 8); head.writeUInt32LE(off, e + 12);
        off += b.length;
    });
    fs.writeFileSync(path.join(ROOT, 'favicon.ico'), Buffer.concat([head, ...ico.map((x) => x[1])]));
}

/* ---------------- 4 screenshots of the real app ---------------- */

await page.setViewportSize({ width: 1920, height: 1080 });
await page.goto(BASE + 'index.html');
await page.waitForSelector('.dicon');
await page.waitForTimeout(900);
const shot = async (n) => fs.writeFileSync(path.join(OUT, 'screenshot_' + n + '.jpg'), await page.screenshot({ type: 'jpeg', quality: 82 }));
await page.mouse.move(1800, 40);
await shot(1);                                                                      // the desktop
await page.focus('#tb-start'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
await shot(2);                                                                      // Start menu
await page.keyboard.press('Escape');
await page.evaluate(() => Win.open('settings', 'personal'));
await page.keyboard.press('ArrowRight'); await page.waitForTimeout(300);
await shot(3);                                                                      // Settings
await page.evaluate(() => Win.close());
await page.goto(BASE + 'index.html?play=jumper');                                   // a game, on its own page
await page.waitForFunction(() => window.GameHost && window.GameHost.state() === 'running', null, { timeout: 15000 });
const G = 'document.querySelector("iframe").contentWindow';
await page.evaluate(G + '.JumperCheat.enter("w1-2")');
await page.waitForFunction(G + '.JumperDebug().mode === "play"');
await page.evaluate(G + '.JumperCheat.warpTo(1500, 200)');
await page.keyboard.down('ArrowRight'); await page.waitForTimeout(700);
await page.keyboard.down('Space'); await page.waitForTimeout(250); await page.keyboard.up('ArrowRight'); await page.keyboard.up('Space');
await shot(4);                                                                      // Super Jumper
await browser.close();

for (const f of ['icon.png', 'store/logo_1920x1080.png', 'store/background_1920x1080.jpg', 'store/screenshot_1.jpg', 'store/screenshot_2.jpg', 'store/screenshot_3.jpg', 'store/screenshot_4.jpg', 'favicon.ico', 'icon-192.png']) {
    console.log(f.padEnd(34), (fs.statSync(path.join(ROOT, f)).size / 1024).toFixed(0) + ' KB');
}
