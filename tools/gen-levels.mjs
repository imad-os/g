// Builds the "Super Jumper" stages from tools/level-chunks.mjs and writes Tiled-compatible JSON
// maps to games/jumper/assets/levels/<id>.json (plus index.json). Deterministic (seeded).
//
//   node tools/gen-levels.mjs            # generate + validate
//
// The JSON files are the shipped level data; they can also be opened and edited in Tiled
// (orthogonal map, 16x16 tiles, layers "background" (image layer), "tiles", "entities").
// Edited files are checked by tools/validate-levels.mjs.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHUNKS, STAGES } from './level-chunks.mjs';
import { validate } from './validate-levels.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'games/jumper/assets/levels');
const H = 20, TOP = H - 12;   // chunk row 0 = level row 8

export const TILE_IDS = {
    '#': 1, B: 2, '?': 3, X: 5, '=': 6, '^': 7, '[': 8, ']': 9, '{': 10, '}': 11,
    '~': 12, L: 13, h: 14, P: 15, S: 16, M: 17, o: 18, H: 19
};
const OBJECTS = {
    g: 'walker', k: 'shell', f: 'flyer', p: 'plant', s: 'spiky', t: 'thrower', c: 'crusher',
    m: 'platform', v: 'platform', F: 'fallplat', j: 'spring', '*': 'starcoin', W: 'warp',
    C: 'checkpoint', G: 'goal', '@': 'start', K: 'boss', D: 'bossdoor', Z: 'secretgoal'
};

const STAR_CHUNK = { tags: [], rows: [
    '................',
    '................',
    '................',
    '.......*........',
    '................',
    '......XXX.......',
    '................',
    '...XX...........',
    '................',
    '...........g....',
    '################',
    '################'] };

function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

function pickChunk(r, tag, last, used) {
    const names = Object.keys(CHUNKS).filter((n) => CHUNKS[n].tags.includes(tag) && !CHUNKS[n].tags.includes('warp'));
    let best = null;
    for (let i = 0; i < 8; i++) {
        const n = names[Math.floor(r() * names.length)];
        if (n === last) continue;
        if (!best || (used[n] || 0) < (used[best] || 0)) best = n;
    }
    used[best] = (used[best] || 0) + 1;
    return best;
}

function buildStage(st) {
    const r = rng(st.seed * 7919);
    const seq = ['start'];
    const used = {};
    let last = '';
    for (let i = 0; i < st.len; i++) {
        const third = Math.min(st.pools.length - 1, Math.floor(i * st.pools.length / st.len));
        const n = pickChunk(r, st.pools[third], last, used);
        seq.push(n);
        last = n;
    }
    seq.splice(Math.floor(seq.length / 2), 0, 'checkpoint');
    const hasWarp = st.secret || (!st.water && !st.fortress && st.n % 2 === 1);
    if (hasWarp) seq.splice(Math.floor(seq.length / 3), 0, 'm_warp');
    seq.push(st.fortress ? 'boss' : 'goal');

    // star coins: exactly one per third of the stage
    const chunks = seq.map((n) => ({ name: n, rows: CHUNKS[n].rows.slice() }));
    const third = (i) => Math.min(2, Math.floor(i * 3 / chunks.length));
    for (let t = 0; t < 3; t++) {
        const cands = [];
        chunks.forEach((c, i) => { if (third(i) === t && c.rows.some((row) => row.includes('*'))) cands.push(i); });
        if (cands.length) {
            const keep = cands[Math.floor(r() * cands.length)];
            cands.forEach((i) => { if (i !== keep) chunks[i].rows = chunks[i].rows.map((row) => row.replace(/\*/g, 'o')); });
            // keep only the first star in the chosen chunk
            let seen = false;
            chunks[keep].rows = chunks[keep].rows.map((row) => row.replace(/\*/g, () => (seen ? 'o' : ((seen = true), '*'))));
        } else {
            let at = chunks.findIndex((c, i) => third(i) === t);
            if (at <= 0) at = 1;
            chunks.splice(at + 1, 0, { name: 'star', rows: STAR_CHUNK.rows.slice() });
        }
    }

    // Variety: most land chunks are mirrored at random and lifted 0-2 rows (hills; a step is never
    // more than 2 tiles, a standing jump clears 5). Start, checkpoint, goal, warp, tunnels and
    // swim / fortress stages stay flat.
    const MIRROR = { '[': ']', ']': '[', '{': '}', '}': '{' };
    // Objects wider than a tile are placed by their left column, so a mirrored one moves back to stay
    // over the same tiles: platforms are 3 wide (2 back) and a moving one also travels 5 tiles to the
    // right (7 back, so it still crosses the same gap).
    const SHIFT = { m: 7, v: 2, F: 2 };
    const flip = (rows) => rows.map((row) => {
        const out = row.split('').reverse().map((ch) => MIRROR[ch] || ch);
        for (let x = 0; x < out.length; x++) {
            const ch = out[x];
            if (!SHIFT[ch] || x - SHIFT[ch] < 0) continue;
            out[x] = '.'; out[x - SHIFT[ch]] = ch;
        }
        return out.join('');
    });
    const canVary = (c) => !/^(start|checkpoint|goal|boss|star|m_warp)$/.test(c.name) && !c.rows.some((row) => /[pWGZCKD@]/.test(row)) && c.rows[0][0] !== 'X';
    const canLift = (c) => canVary(c) && !st.water && !st.fortress && !c.rows.some((row) => /[L~]/.test(row));
    let lift = 0;
    const lifts = chunks.map((c) => {
        if (canVary(c) && r() < 0.5) c.rows = flip(c.rows);
        if (!canLift(c)) { lift = 0; return 0; }
        const d = r();
        lift = Math.max(0, Math.min(2, lift + (d < 0.35 ? -1 : d < 0.7 ? 1 : 0)));
        return lift;
    });

    // stitch the main area
    let cols = [];
    const colChunk = [];
    chunks.forEach((c, ci) => {
        const w = c.rows[0].length, up = lifts[ci];
        for (let x = 0; x < w; x++) {
            const col = new Array(H).fill('.');
            const ceiling = c.rows[0][x] === 'X';
            for (let y = 0; y < TOP; y++) col[y] = ceiling ? 'X' : '.';
            for (let y = 0; y < 12; y++) col[TOP - up + y] = c.rows[y][x] || '.';
            for (let y = TOP - up + 12; y < H; y++) col[y] = c.rows[11][x] || '.';   // the hill's body
            cols.push(col);
            colChunk.push(ci);
        }
    });
    const mainEnd = cols.length;
    // separator wall + bonus room
    const bonusName = st.secret ? 'bonus_secret' : 'bonus';
    let bonusStart = -1;
    if (hasWarp) {
        for (let i = 0; i < 4; i++) cols.push(new Array(H).fill('X'));
        bonusStart = cols.length;
        const b = CHUNKS[bonusName].rows;
        for (let x = 0; x < b[0].length; x++) {
            const col = new Array(H).fill('X');
            for (let y = 0; y < 12; y++) col[TOP + y] = b[y][x];
            cols.push(col);
        }
    }
    const W = cols.length;

    // tiles + objects
    const data = new Array(W * H).fill(0);
    const objects = [];
    let oid = 1;
    const prop = (name, value) => ({ name, type: typeof value === 'number' ? (Number.isInteger(value) ? 'int' : 'float') : typeof value === 'boolean' ? 'bool' : 'string', value });
    const add = (type, x, y, w = 16, h = 16, props = []) => {
        const o = { id: oid++, name: type, type, class: type, x, y, width: w, height: h, rotation: 0, visible: true };
        if (props.length) o.properties = props;
        objects.push(o);
        return o;
    };
    const solidAt = (x, y) => { const ch = cols[x] && cols[x][y]; return ch && '#BX?[]{}PSM='.includes(ch); };
    const groundBelow = (x, y) => { for (let yy = y; yy < H; yy++) if (solidAt(x, yy)) return yy; return H; };

    const warps = [];
    // pass 1: objects (their cell becomes air)
    for (let x = 0; x < W; x++) {
        for (let y = 0; y < H; y++) {
            const ch = cols[x][y], obj = OBJECTS[ch];
            if (!obj) continue;
            const px = x * 16, py = y * 16;
            cols[x][y] = '.';
            if (ch === 'm') add('platform', px, py, 48, 8, [prop('axis', 'x'), prop('range', 80), prop('speed', 0.8)]);
            else if (ch === 'v') add('platform', px, py, 48, 8, [prop('axis', 'y'), prop('range', 72), prop('speed', 0.7)]);
            else if (ch === 'F') add('fallplat', px, py, 48, 8);
            else if (ch === 'p') add('plant', px + 32, py + 16, 16, 24);
            else if (ch === 'W') warps.push(add('warp', px + 16, py, 32, 16, [prop('kind', 'pipe')]));
            else if (ch === 'G') add('goal', px, py, 16, (groundBelow(x, y) - y) * 16, [prop('secret', false)]);
            else if (ch === 'Z') add('goal', px, py, 16, (groundBelow(x, y) - y) * 16, [prop('secret', true)]);
            else if (ch === 'K') add('boss', px, py - 16, 32, 32, [prop('variant', st.boss || 1)]);
            else if (ch === 'D') add('bossdoor', px, py - 16, 16, 32);
            else if (ch === '@' && x >= mainEnd) cols[x][y] = '@';   // bonus room arrival point (read below)
            else add(obj, px, py);
        }
    }
    // pass 2: water fills the air of swim stages
    if (st.water) for (let x = 0; x < mainEnd; x++) for (let y = TOP - 1; y < H; y++) if (cols[x][y] === '.') cols[x][y] = '~';
    // pass 3: tile ids (surface variants for water and lava)
    for (let x = 0; x < W; x++) {
        for (let y = 0; y < H; y++) {
            const ch = cols[x][y];
            let id = TILE_IDS[ch] || 0;
            if (ch === '~' && (y === 0 || cols[x][y - 1] !== '~')) id = 20;
            if (ch === 'L' && (y === 0 || cols[x][y - 1] !== 'L')) id = 21;
            data[y * W + x] = id;
        }
    }

    // warp links: main pipe -> bonus room arrival, bonus exit pipe -> just after the main pipe
    if (warps.length) {
        const w = warps[0];
        let ax = bonusStart + 2, ay = (TOP + 9) * 16;
        for (let x = bonusStart; x < W; x++) for (let y = 0; y < H; y++) if (cols[x][y] === '@') { ax = x; ay = y; }
        w.properties.push(prop('tx', ax * 16), prop('ty', ay * 16), prop('dir', 'down'));
        // return pipe in the normal bonus room
        for (let x = bonusStart; x < W - 1; x++) {
            for (let y = 0; y < H; y++) {
                if (cols[x][y] === '[' && cols[x + 1][y] === ']') {
                    const backX = w.x / 16 + 3;
                    const gy = groundBelow(backX, TOP);
                    add('warp', x * 16, (y) * 16, 32, 16, [prop('kind', 'pipe'), prop('tx', backX * 16), prop('ty', (gy - 1) * 16), prop('dir', 'down')]);
                }
            }
        }
    }

    // extra checkpoints used only in assist mode (1/4 and 3/4 of the stage)
    for (const f of [0.25, 0.75]) {
        let x = Math.floor(mainEnd * f);
        for (let k = 0; k < 40 && x < mainEnd - 1; k++, x++) {
            const gy = groundBelow(x, 0);
            if (gy < H && cols[x][gy] === '#' && cols[x][gy - 1] !== '^') {
                add('checkpoint', x * 16, (gy - 1) * 16, 16, 16, [prop('assist', true)]);
                break;
            }
        }
    }

    const areas = [[0, mainEnd * 16]];
    if (bonusStart >= 0) areas.push([bonusStart * 16, W * 16]);

    return {
        type: 'map', version: '1.10', tiledversion: '1.10.2', orientation: 'orthogonal', renderorder: 'right-down',
        width: W, height: H, tilewidth: 16, tileheight: 16, infinite: false,
        nextlayerid: 4, nextobjectid: oid,
        properties: [
            prop('id', st.id), prop('name', st.name), prop('world', st.world), prop('stage', st.n),
            prop('theme', st.theme), prop('music', st.music), prop('time', st.time),
            prop('water', !!st.water), prop('fortress', !!st.fortress), prop('secret', !!st.secret),
            prop('areas', JSON.stringify(areas))
        ],
        tilesets: [{ firstgid: 1, source: '../tiles.tsj' }],
        layers: [
            { id: 1, name: 'background', type: 'imagelayer', image: '', parallaxx: 0.3, parallaxy: 1, x: 0, y: 0, opacity: 1, visible: true,
              properties: [prop('theme', st.theme)] },
            { id: 2, name: 'tiles', type: 'tilelayer', width: W, height: H, x: 0, y: 0, opacity: 1, visible: true, data },
            { id: 3, name: 'entities', type: 'objectgroup', draworder: 'topdown', x: 0, y: 0, opacity: 1, visible: true, objects }
        ]
    };
}

function main() {
    fs.mkdirSync(OUT, { recursive: true });
    const index = [];
    let failed = 0;
    for (const st of STAGES) {
        const map = buildStage(st);
        const errs = validate(map);
        if (errs.length) { failed++; console.error(st.id + ':\n  ' + errs.join('\n  ')); }
        fs.writeFileSync(path.join(OUT, st.id + '.json'), JSON.stringify(map));
        index.push({ id: st.id, world: st.world, n: st.n, name: st.name, fortress: !!st.fortress, secret: !!st.secret, water: !!st.water });
        console.log(st.id.padEnd(5), String(map.width).padStart(4) + ' cols', map.layers[2].objects.length + ' objects', errs.length ? 'INVALID' : 'ok');
    }
    fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ stages: index }, null, 1));
    if (failed) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
