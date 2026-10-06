// Generates the app icon, browser favicons and the Samsung Seller Office images from the game's
// own pixel art (games/jumper/js/art.js), so everything matches the shipped look.
//
//   npx http-server -p 8080 -c-1 .     (in another terminal)
//   NODE_PATH=$(npm root -g) node tools/make-store-assets.mjs http://localhost:8080/
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

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.route('**/imad-os.github.io/**', (r) => r.abort());

// ---------- artwork drawn in the page with the game's sprites ----------
await page.goto(BASE + 'games/jumper/index.html');
await page.waitForFunction(() => window.Art);
const art = await page.evaluate(() => {
    const A = Art.buildSprites();
    function spr(ctx, name, x, y, scale) {
        const f = A.f[name];
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(A.c, f.x, f.y, f.w, f.h, x, y, f.w * scale, f.h * scale);
    }
    function sky(ctx, w, h) {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#2b2f7a'); g.addColorStop(0.55, '#5a3fa0'); g.addColorStop(1, '#f2786a');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        // pixel stars
        let s = 7;
        const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        for (let i = 0; i < 60; i++) { const z = r() < 0.2 ? 3 : 2; ctx.fillRect((r() * w) | 0, (r() * h * 0.6) | 0, z * w / 512, z * w / 512); }
    }
    // the logo: falling blocks + question block + coin + Pip jumping, with the title
    function logo(ctx, cx, cy, u) {   // u = pixel unit (sprite scale)
        const blocks = [['#3ad6e8', -7, 1], ['#3ad6e8', -6, 1], ['#3ad6e8', -5, 1], ['#3ad6e8', -4, 1],
                        ['#f2c94c', 4, 1], ['#f2c94c', 5, 1], ['#f2c94c', 4, 0], ['#f2c94c', 5, 0],
                        ['#b06cf0', -6, 0], ['#4cd97b', 6, 1], ['#f25c5c', -3, 1]];
        const b = u * 8;
        for (const [col, gx, gy] of blocks) {
            const x = cx + gx * b - b / 2, y = cy + gy * b;
            ctx.fillStyle = '#1a1423'; ctx.fillRect(x, y, b, b);
            ctx.fillStyle = col; ctx.fillRect(x + u, y + u, b - 2 * u, b - 2 * u);
            ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x + u, y + u, b - 2 * u, u * 1.5);
        }
        // ground row
        ctx.fillStyle = '#1a1423'; ctx.fillRect(cx - 8 * b, cy + 2 * b, 16 * b, u * 2);
        // big hero mid-jump + coin
        spr(ctx, 'hb_normal_jump_r', cx - 8 * u * 2, cy - 30 * u * 2 + b, u * 2);
        spr(ctx, 'coin0', cx + 12 * u * 2, cy - 30 * u * 2, u * 2);
        spr(ctx, 'blorp1_l', cx + 2.2 * b, cy - b * 0.1 - 16 * u * 0.9, u * 1.4);
    }
    function title(ctx, cx, y, size) {
        ctx.font = '900 ' + size + 'px "Arial Black", Arial, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        ctx.lineJoin = 'round'; ctx.lineWidth = size * 0.16; ctx.strokeStyle = '#1a1423';
        ctx.strokeText('ARCADE', cx, y);
        ctx.fillStyle = '#ffd23f'; ctx.fillText('ARCADE', cx, y);
    }
    const out = {};
    function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

    // 512x423 icon (opaque)
    let c = canvas(512, 423), x = c.getContext('2d');
    sky(x, 512, 423);
    logo(x, 256, 222, 3);
    title(x, 256, 385, 76);
    out.icon = c.toDataURL('image/png');

    // square master for favicons (no text: unreadable at 32 px)
    c = canvas(512, 512); x = c.getContext('2d');
    x.fillStyle = '#2b2f7a'; x.fillRect(0, 0, 512, 512);
    x.fillStyle = '#5a3fa0'; x.fillRect(0, 300, 512, 212);
    spr(x, 'hb_normal_jump_r', 128, 64, 16);
    out.square = c.toDataURL('image/png');

    // Seller Office: 1920x1080 transparent logo (kept inside the centre 1:1 safe area) + background
    c = canvas(1920, 1080); x = c.getContext('2d');
    logo(x, 960, 520, 7);
    title(x, 960, 840, 150);
    out.logo = c.toDataURL('image/png');
    c = canvas(1920, 1080); x = c.getContext('2d');
    sky(x, 1920, 1080);
    out.bg = c.toDataURL('image/jpeg', 0.86);
    return out;
});
const save = (file, dataUrl) => fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
save(path.join(ROOT, 'icon.png'), art.icon);
save(path.join(OUT, 'logo_1920x1080.png'), art.logo);
save(path.join(OUT, 'background_1920x1080.jpg'), art.bg);

// favicon sizes from the square master
for (const [name, size] of [['icon-32.png', 32], ['icon-192.png', 192], ['apple-touch-icon.png', 180], ['_ico16.png', 16], ['_ico48.png', 48]]) {
    const url = await page.evaluate(async ([src, s]) => {
        const img = new Image(); img.src = src; await img.decode();
        const c = document.createElement('canvas'); c.width = c.height = s;
        const x = c.getContext('2d'); x.imageSmoothingEnabled = s >= 64; x.drawImage(img, 0, 0, s, s);
        return c.toDataURL('image/png');
    }, [art.square, size]);
    save(path.join(ROOT, name), url);
}
// favicon.ico = PNG-compressed ICO with 16, 32 and 48 px images
{
    const imgs = ['_ico16.png', 'icon-32.png', '_ico48.png'].map((f) => fs.readFileSync(path.join(ROOT, f)));
    const sizes = [16, 32, 48];
    const head = Buffer.alloc(6 + 16 * imgs.length);
    head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(imgs.length, 4);
    let off = head.length;
    imgs.forEach((b, i) => {
        const e = 6 + i * 16;
        head.writeUInt8(sizes[i], e); head.writeUInt8(sizes[i], e + 1); head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3);
        head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6); head.writeUInt32LE(b.length, e + 8); head.writeUInt32LE(off, e + 12);
        off += b.length;
    });
    fs.writeFileSync(path.join(ROOT, 'favicon.ico'), Buffer.concat([head, ...imgs]));
    fs.unlinkSync(path.join(ROOT, '_ico16.png')); fs.unlinkSync(path.join(ROOT, '_ico48.png'));
}

// ---------- 4 screenshots of the real app ----------
await page.goto(BASE + 'index.html');
await page.waitForSelector('.tile');
await page.waitForTimeout(800);
const shot = async (n) => {
    const buf = await page.screenshot({ type: 'jpeg', quality: 82 });
    fs.writeFileSync(path.join(OUT, 'screenshot_' + n + '.jpg'), buf);
};
await shot(1);                                                   // launcher
const G = 'document.querySelector("iframe").contentWindow';
await page.focus('[data-game="jumper"]'); await page.keyboard.press('Enter');
await page.waitForFunction(() => window.GameHost.state() === 'running');
await page.evaluate(G + '.JumperCheat.enter("w1-2")');
await page.waitForFunction(G + '.JumperDebug().mode === "play"');
await page.evaluate(G + '.JumperCheat.warpTo(1500, 200)');
await page.keyboard.down('ArrowRight'); await page.waitForTimeout(700);
await page.keyboard.down('Space'); await page.waitForTimeout(250); await page.keyboard.up('ArrowRight'); await page.keyboard.up('Space');
await shot(2);                                                   // Super Jumper gameplay
await page.evaluate(G + '.JumperCheat.enter("w3-1")');
await page.waitForFunction(G + '.JumperDebug().mode === "play"');
await page.evaluate(G + '.JumperCheat.warpTo(900, 200)');
await page.keyboard.down('ArrowRight'); await page.waitForTimeout(900); await page.keyboard.up('ArrowRight');
await shot(3);                                                   // ice world
await page.keyboard.press('Escape');
await page.evaluate(() => { const b = document.querySelectorAll('#pause-items button'); b[b.length - 1].click(); });
await page.waitForFunction(() => window.GameHost.state() === 'idle');
await page.focus('[data-game="blocks"]'); await page.keyboard.press('Enter');
await page.waitForFunction(() => window.GameHost.state() === 'running');
await page.keyboard.press('Enter');
for (let i = 0; i < 16; i++) { await page.keyboard.press(['ArrowLeft', 'ArrowRight', 'Space', 'ArrowUp'][i % 4]); await page.waitForTimeout(90); }
await page.waitForTimeout(700);
await shot(4);                                                   // Block Drop
await browser.close();

for (const f of ['icon.png', 'store/logo_1920x1080.png', 'store/background_1920x1080.jpg', 'store/screenshot_1.jpg', 'store/screenshot_2.jpg', 'store/screenshot_3.jpg', 'store/screenshot_4.jpg', 'favicon.ico', 'icon-192.png']) {
    console.log(f.padEnd(34), (fs.statSync(path.join(ROOT, f)).size / 1024).toFixed(0) + ' KB');
}
