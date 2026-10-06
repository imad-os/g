// Fills the loading information of every first-party game manifest from its index.html:
//   scripts / styles : files of the page, in order (the SDK is loaded by game.html itself)
//   assets           : other files the first screen needs (kept from the manifest, JS/CSS removed)
//   sizes            : bytes of every file (+ the entry page), used for the byte-weighted loading bar
//   sizeBytes/sizeMB : total
// Usage: node tools/make-manifests.mjs   (run after changing a game's files, then bump its build)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAMES = path.join(ROOT, 'games');

for (const id of fs.readdirSync(GAMES)) {
    const dir = path.join(GAMES, id);
    const mp = path.join(dir, 'game-manifest.json');
    if (!fs.existsSync(mp)) continue;
    const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
    const entry = m.entry || 'index.html';
    const html = fs.readFileSync(path.join(dir, entry), 'utf8');
    const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/gi)].map((x) => x[1]).filter((s) => !/arcade-sdk\.js$/.test(s));
    const styles = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"/gi)].map((x) => x[1]);
    const assets = (m.assets || []).filter((a) => typeof a === 'string' && !/\.(js|css)$/.test(a));
    const sizes = {};
    const all = [entry].concat(scripts, styles, assets);
    let total = 0;
    for (const f of all) {
        const p = path.join(dir, f);
        if (!fs.existsSync(p)) throw new Error(id + ': missing file ' + f);
        sizes[f] = fs.statSync(p).size;
        total += sizes[f];
    }
    m.scripts = scripts;
    m.styles = styles;
    m.assets = assets;
    m.sizes = sizes;
    m.sizeBytes = total;
    m.sizeMB = Math.round(total / 1048576 * 100) / 100;
    fs.writeFileSync(mp, JSON.stringify(m, null, 2) + '\n');
    console.log(id + ': ' + scripts.length + ' scripts, ' + styles.length + ' styles, ' + assets.length + ' assets, ' + total + ' bytes');
}
