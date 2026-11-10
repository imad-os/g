// Generates the Samsung Seller Office background and screenshots (real captures of the app).
// The icon, favicons and store/logo_1920x1080.png come from tools/make-icons.mjs.
//
//   npx http-server -p 8080 -c-1 .     (in another terminal)
//   CHROMIUM_PATH=/path/to/chrome node tools/make-store-assets.mjs http://localhost:8080/
//
// Output (sizes from Samsung's "App Icons and Screenshots" guide):
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

// a wallpaper like the desktop's "Bloom" (css/launcher.css .wp-bloom)
const bgHtml = `<html><body style="margin:0;width:1920px;height:1080px;background-color:#07122a;
  background-image:radial-gradient(30% 45% at 60% 55%, rgba(125,215,255,.95) 0%, rgba(0,120,212,.65) 40%, rgba(7,18,42,0) 100%),radial-gradient(35% 40% at 45% 68%, rgba(120,90,255,.6) 0%, rgba(7,18,42,0) 100%),radial-gradient(25% 30% at 72% 40%, rgba(0,200,255,.45) 0%, rgba(7,18,42,0) 100%),linear-gradient(160deg,#050c1c 0%,#0c2147 55%,#081430 100%)"></body></html>`;

/* ---------------- render ---------------- */

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.route('**/imad-os.github.io/**', (r) => r.abort());

await page.setViewportSize({ width: 1920, height: 1080 });
await page.setContent(bgHtml);
fs.writeFileSync(path.join(OUT, 'background_1920x1080.jpg'), await page.screenshot({ type: 'jpeg', quality: 86 }));

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

for (const f of ['store/background_1920x1080.jpg', 'store/screenshot_1.jpg', 'store/screenshot_2.jpg', 'store/screenshot_3.jpg', 'store/screenshot_4.jpg']) {
    console.log(f.padEnd(34), (fs.statSync(path.join(ROOT, f)).size / 1024).toFixed(0) + ' KB');
}
