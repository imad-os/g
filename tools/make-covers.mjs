// Renders each game's menu cover (games/<id>/cover.png, 528x296) from real gameplay frames,
// so covers always match the shipped art.
//
//   npx http-server -p 8080 -c-1 .   (in another terminal)
//   NODE_PATH=$(npm root -g) node tools/make-covers.mjs http://localhost:8080/

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv[2] || 'http://localhost:8080/';
const ONLY = process.argv.slice(3);                 // optional game ids, e.g. "parchis"
const CHROMIUM = process.env.CHROMIUM_PATH || undefined;

// what to do in each game before the screenshot
const SCRIPTS = {
    jumper: async (p, G) => {
        await p.evaluate(G + '.JumperCheat.enter("w1-1")');
        await p.waitForFunction(G + '.JumperDebug().mode === "play"');
        await p.evaluate(G + '.JumperCheat.warpTo(1180, 200)');
        await p.keyboard.down('ArrowRight'); await p.waitForTimeout(500);
        await p.keyboard.down('Space'); await p.waitForTimeout(350); await p.keyboard.up('ArrowRight'); await p.keyboard.up('Space');
    },
    blocks: async (p) => { await p.keyboard.press('Enter'); for (let i = 0; i < 14; i++) { await p.keyboard.press(['ArrowLeft', 'ArrowRight', 'Space', 'ArrowUp'][i % 4]); await p.waitForTimeout(80); } await p.waitForTimeout(600); },
    hopper: async (p) => { await p.keyboard.press('Enter'); await p.keyboard.down('ArrowRight'); await p.waitForTimeout(1600); await p.keyboard.up('ArrowRight'); },
    snake: async (p) => { await p.keyboard.press('Enter'); await p.waitForTimeout(900); await p.keyboard.press('ArrowDown'); await p.waitForTimeout(500); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(400); },
    breaker: async (p) => { await p.keyboard.press('Enter'); await p.keyboard.press('Space'); await p.waitForTimeout(1800); },
    parchis: async (p, G) => {
        // 4 players: Down wraps to the "Players" row, Right twice, Up wraps to "Start game"
        for (const k of ['ArrowDown', 'ArrowRight', 'ArrowRight', 'ArrowUp', 'Enter']) { await p.keyboard.press(k); await p.waitForTimeout(60); }
        await p.evaluate(G + '.ParchisCheat.set(0, 0, 9); ' + G + '.ParchisCheat.set(0, 1, 30); ' + G + '.ParchisCheat.set(2, 0, 20); ' + G + '.ParchisCheat.set(1, 0, 5); ' + G + '.ParchisCheat.set(3, 2, 66)');
        await p.waitForTimeout(400);
    },
    merge: async (p) => { await p.keyboard.press('Enter'); for (let i = 0; i < 24; i++) { await p.keyboard.press(['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowDown'][i % 4]); await p.waitForTimeout(150); } }
};

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.route('**/imad-os.github.io/**', (r) => r.abort());
await page.goto(BASE + 'index.html');
await page.waitForSelector('.dicon');
const G = 'document.querySelector("iframe").contentWindow';
for (const id of Object.keys(SCRIPTS)) {
    if (ONLY.length && ONLY.indexOf(id) < 0) continue;
    await page.focus(`[data-game="${id}"]`);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.GameHost.state() === 'running');
    await SCRIPTS[id](page, G);
    // hide banner/HUD text so the cover is pure artwork
    await page.evaluate(G + `.document.getElementById("banner").hidden = true; ${G}.document.getElementById("hud").hidden = true`);
    const shot = await page.screenshot({ type: 'png' });
    const url = await page.evaluate(async (b64) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + b64;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = 528; c.height = 296;
        const x = c.getContext('2d');
        x.imageSmoothingQuality = 'high';
        x.drawImage(img, 0, 0, 528, 297);
        return c.toDataURL('image/png');
    }, shot.toString('base64'));
    fs.writeFileSync(path.join(ROOT, 'games', id, 'cover.png'), Buffer.from(url.split(',')[1], 'base64'));
    console.log('cover', id);
    await page.keyboard.press('Escape');
    await page.evaluate(() => { const b = document.querySelectorAll('#pause-items button'); b[b.length - 1].click(); });
    await page.waitForFunction(() => window.GameHost.state() === 'idle');
}
await browser.close();
