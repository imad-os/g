// Validates "Super Jumper" Tiled maps (generated or hand-edited in Tiled).
//
//   node tools/validate-levels.mjs                     # all files in games/jumper/assets/levels
//   node tools/validate-levels.mjs path/to/w1-1.json   # one file
//
// Checks: map size and layer data, one start, a goal (or a boss in fortresses), a normal
// checkpoint, exactly 3 star coins, warp targets inside the map, objects inside the map, and that
// no gap is wider than a running jump unless a platform bridges it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_GAP = 7;                       // tiles: running jump distance
const SOLID = new Set([1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 15, 16, 17]);
const KNOWN = new Set(['start', 'goal', 'checkpoint', 'starcoin', 'walker', 'shell', 'flyer', 'plant', 'spiky', 'thrower',
    'crusher', 'platform', 'fallplat', 'spring', 'warp', 'boss', 'bossdoor']);

function prop(o, name, def) {
    const p = (o.properties || []).find((q) => q.name === name);
    return p ? p.value : def;
}

export function validate(map) {
    const errs = [];
    const tiles = map.layers.find((l) => l.name === 'tiles');
    const ents = map.layers.find((l) => l.name === 'entities');
    if (!tiles || !ents) return ['missing "tiles" or "entities" layer'];
    const W = map.width, H = map.height;
    if (map.tilewidth !== 16 || map.tileheight !== 16) errs.push('tiles must be 16x16');
    if (!Array.isArray(tiles.data) || tiles.data.length !== W * H) errs.push('tile data length ' + (tiles.data && tiles.data.length) + ' != ' + W * H);
    const objs = ents.objects || [];
    const count = (t) => objs.filter((o) => (o.type || o.class) === t).length;
    const fortress = prop(map, 'fortress', false), water = prop(map, 'water', false);

    for (const o of objs) {
        const t = o.type || o.class;
        if (!KNOWN.has(t)) errs.push('unknown object type "' + t + '" (id ' + o.id + ')');
        if (o.x < 0 || o.y < -64 || o.x > W * 16 || o.y > H * 16) errs.push(t + ' ' + o.id + ' outside the map');
    }
    if (count('start') !== 1) errs.push('needs exactly 1 start, has ' + count('start'));
    if (fortress ? count('boss') !== 1 : count('goal') < 1) errs.push(fortress ? 'fortress needs 1 boss' : 'needs a goal');
    if (objs.filter((o) => o.type === 'checkpoint' && !prop(o, 'assist', false)).length < 1) errs.push('needs a checkpoint');
    if (count('starcoin') !== 3) errs.push('needs exactly 3 star coins, has ' + count('starcoin'));
    for (const w of objs.filter((o) => o.type === 'warp')) {
        const tx = prop(w, 'tx'), ty = prop(w, 'ty');
        if (typeof tx !== 'number' || typeof ty !== 'number' || tx < 0 || tx >= W * 16 || ty < 0 || ty >= H * 16) errs.push('warp ' + w.id + ' has no valid target');
    }

    // gaps in the main area (bridged by platforms or falling platforms)
    if (!water && tiles.data) {
        const areas = JSON.parse(prop(map, 'areas', '[[0,' + W * 16 + ']]'));
        const mainEnd = Math.floor(areas[0][1] / 16);
        const bridged = new Array(W).fill(false);
        for (const o of objs) {
            if (o.type !== 'platform' && o.type !== 'fallplat' && o.type !== 'spring') continue;
            const range = o.type === 'platform' && prop(o, 'axis') === 'x' ? prop(o, 'range', 0) : 0;
            for (let x = Math.floor((o.x - 32) / 16); x <= Math.floor((o.x + o.width + range + 32) / 16); x++) if (x >= 0 && x < W) bridged[x] = true;
        }
        let run = 0;
        for (let x = 0; x < mainEnd; x++) {
            let solid = bridged[x];
            for (let y = 0; y < H && !solid; y++) if (SOLID.has(tiles.data[y * W + x])) solid = true;
            run = solid ? 0 : run + 1;
            if (run > MAX_GAP) { errs.push('gap wider than ' + MAX_GAP + ' tiles ending at column ' + x); run = 0; }
        }
    }
    return errs;
}

function main() {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const files = process.argv.slice(2);
    const dir = path.join(root, 'games/jumper/assets/levels');
    const list = files.length ? files : fs.readdirSync(dir).filter((f) => /^w\d-\d\.json$/.test(f)).map((f) => path.join(dir, f));
    let bad = 0;
    for (const f of list) {
        const errs = validate(JSON.parse(fs.readFileSync(f, 'utf8')));
        console.log(path.basename(f).padEnd(10), errs.length ? 'INVALID\n  ' + errs.join('\n  ') : 'ok');
        if (errs.length) bad++;
    }
    process.exit(bad ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
