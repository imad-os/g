// Renders the CSS-drawn theme backgrounds (css/themes.css, classes .wps-<name>) once into wallpapers/<name>.jpg.
// Owner report 2026-11-12 ("Neon night is very laggy on the TV"): a background of 26 gradients was drawn again for every
// part of the screen that changed (each focus move); one picture costs one image draw. Edit the .wps-* CSS, then run:
//   node tools/render-wallpapers.mjs        (CHROMIUM_PATH for the browser)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const css = fs.readFileSync(path.join(root, 'css/themes.css'), 'utf8');
const names = [...css.matchAll(/^\.wps-([a-z0-9]+) \{/gm)].map((m) => m[1]);
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
for (const n of names) {
    await page.setContent('<!doctype html><style>html,body{margin:0}' + css + '</style><div class="wps-' + n + '" style="width:1920px;height:1080px"></div>');
    const file = path.join(root, 'wallpapers', n + '.jpg');
    await page.screenshot({ path: file, type: 'jpeg', quality: 90 });
    console.log(file, fs.statSync(file).size, 'bytes');
}
await browser.close();
