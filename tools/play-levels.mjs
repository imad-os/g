// Plays every "Super Jumper" stage with the game's own physics (games/jumper/js/level.js + actors.js)
// to prove a normal player can finish it: a search tries short button presses (left / right / nothing,
// with or without jump) until the hero reaches the goal (or the boss door in a fortress).
//
//   node tools/play-levels.mjs              # every stage
//   node tools/play-levels.mjs w1-3 w2-1    # some stages
//   node tools/play-levels.mjs --quick      # small hero only, no trap check (used by npm test)
//
// The hero plays on purpose a little worse than a person can: walking only (no run button), a lower
// jump, and inputs held for several frames (no frame-perfect tricks). Enemies are left out (they can be
// stomped or waited for); spikes and lava count as a failure. Moving and falling platforms are simulated.
// Also checks for traps: places the hero can reach (without dying) but can never leave.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEVELS = path.join(ROOT, 'games/jumper/assets/levels');

// the handicap: a person on a TV remote, walking, a bit late on every jump
const HANDICAP = { walk: 1.6, jump: 4.6 };   // jumps 4.7 tiles high instead of 5.1-6
const HOLD = 6;                // frames each input is held
const MAX_NODES = 250000;      // per search

function loadGame() {
    const ctx = vm.createContext({ Math, console, JSON, Uint8Array, Array, Object });
    for (const f of ['level.js', 'actors.js']) {
        const src = fs.readFileSync(path.join(ROOT, 'games/jumper/js', f), 'utf8');
        vm.runInContext(src + '\n;this.Level = Level; this.Actors = typeof Actors !== "undefined" ? Actors : undefined;', ctx, { filename: f });
    }
    return ctx;
}

const G = loadGame();
Object.assign(G.Actors.TUNE, HANDICAP);

const PFIELDS = ['x', 'y', 'vx', 'vy', 'h', 'face', 'onGround', 'hitWall', 'coyote', 'jumpBuf', 'gp', 'gpT', 'crouch', 'skid',
    'wallDir', 'wallLock', 'swim', 'jumping', 'memVx', 'memT', 'inv', 'lastBottom'];
const EFIELDS = ['x', 'y', 't', 'state', 'vy', 'alive', 'active', 'dx', 'dy'];

function prop(map, name, def) {
    const p = (map.properties || []).find((q) => q.name === name);
    return p ? p.value : def;
}

function makeWorld(map, big) {
    const theme = prop(map, 'theme', 'grass');
    const lv = new G.Level(map, { theme: { slippery: theme === 'ice' } }, {});
    const objs = map.layers.find((l) => l.name === 'entities').objects;
    const ents = [];
    let start = null, goalX = Infinity;
    for (const o of objs) {
        const t = o.type || o.class;
        if (t === 'start') { start = o; continue; }
        if (t === 'goal' && !G.Level.prototype.prop(o, 'secret', false)) goalX = Math.min(goalX, o.x);
        if (t === 'bossdoor') goalX = Math.min(goalX, o.x + 48);
        if (!['platform', 'fallplat', 'crusher', 'spring'].includes(t)) continue;
        const e = G.Actors.make(o, lv);
        if (e) ents.push(e);
    }
    const plats = ents.filter((e) => e.plat);
    const springs = ents.filter((e) => e.type === 'spring');
    const mainEnd = lv.areas[0][1];
    const p = new G.Actors.Player(1);
    const W = {
        lv, frame: 0, area: lv.areas[0], leftWall: 0, water: !!lv.props.water, player: p, failed: false,
        sfx() {}, dust() {}, starEnded() {}, hitBlock() {}, groundPound() {}, collectCoin() {}, fire() {}, shake() {}, throwRock() {},
        hurt() { W.failed = true; }, die() { W.failed = true; },
        nearestDist() { return 999; },
        landOnPlatforms(a) {   // same as game.js
            if (a.onGround || a.vy < 0) return;
            for (const e of plats) {
                if (!e.alive || !e.active) continue;
                if (a.x + a.w <= e.x || a.x >= e.x + e.w) continue;
                const top = e.y, prevTop = e.y - e.dy;
                if (a.lastBottom <= Math.max(top, prevTop) + 2 && a.y + a.h >= top) {
                    a.y = top - a.h; a.vy = 0; a.onGround = true; a.ride = e;
                    if (e.type === 'fallplat' && e.state === 0) { e.state = 1; e.t = 24; }
                    return;
                }
            }
        }
    };
    if (big) { p.power = 1; p.h = 22; }
    p.x = start.x + 2; p.y = start.y + 16 - p.h; p.face = 1;
    const inp = { left: false, right: false, run: false, jump: false, jumpPressed: false, down: false, downPressed: false, firePressed: false };

    function step() {
        W.frame++;
        // entities wake up when they come into view (the camera sits ~190 px behind the hero)
        for (const e of ents) if (!e.active && e.x < p.x + 350) e.active = true;
        p.update(W, inp);
        for (const e of plats) if (e.active && e.alive && e.type !== 'crusher') G.Actors.UPDATE[e.type](e, W);
        for (const e of springs) {
            if (e.t > 0) e.t--;
            if (e.active && G.Actors.overlap(p, e) && p.vy > 0 && p.lastBottom <= e.y + 8) { p.y = e.y + 6 - p.h; p.vy = inp.jump ? -10 : -7.5; p.jumping = false; e.t = 10; }
        }
    }
    function save() {
        const s = PFIELDS.map((f) => p[f]);
        s.push(p.ride ? plats.indexOf(p.ride) : -1, W.frame);
        for (const e of plats) for (const f of EFIELDS) s.push(e[f]);
        for (const e of springs) s.push(e.active, e.t);
        return s;
    }
    function load(s) {
        let i = 0;
        for (const f of PFIELDS) p[f] = s[i++];
        const r = s[i++]; p.ride = r >= 0 ? plats[r] : null;
        W.frame = s[i++];
        for (const e of plats) for (const f of EFIELDS) e[f] = s[i++];
        for (const e of springs) { e.active = s[i++]; e.t = s[i++]; }
        W.failed = false;
    }
    // a moving platform near the hero makes the time matter
    function timeKey() {
        for (const e of plats) if (e.alive && e.active && (e.type === 'platform' || e.state > 0) && Math.abs(e.x - p.x) < 260) return (W.frame / 10) | 0;
        return 0;
    }
    function key() {
        return [Math.round(p.x / 2), Math.round(p.y / 2), Math.round(p.vx * 3), Math.round(p.vy * 1.5), p.onGround ? 1 : 0, p.jumping ? 1 : 0,
            p.ride ? plats.indexOf(p.ride) : -1, p.wallDir, timeKey(), plats.filter((e) => e.state > 0 || !e.alive).length].join(',');
    }
    return { lv, p, W, inp, step, save, load, key, goalX, mainEnd, start };
}

// actions: [dir, jump] where jump 0 = released, 1 = pressed and held, 2 = tapped (short hop)
const ACTIONS = [];
for (const d of [1, 0, -1]) for (const j of [0, 1, 2]) ACTIONS.push([d, j]);

class Heap {
    constructor() { this.a = []; }
    push(v, k) { const a = this.a; a.push([k, v]); let i = a.length - 1; while (i > 0) { const q = (i - 1) >> 1; if (a[q][0] >= a[i][0]) break; [a[q], a[i]] = [a[i], a[q]]; i = q; } }
    pop() {
        const a = this.a, top = a[0], last = a.pop();
        if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] > a[m][0]) m = l; if (r < a.length && a[r][0] > a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
        return top[1];
    }
    get size() { return this.a.length; }
}

// runs one input for HOLD frames; returns false if the hero got hurt or fell
function apply(w, act, held) {
    const { inp, p, W } = w;
    inp.left = act[0] < 0; inp.right = act[0] > 0;
    for (let f = 0; f < HOLD; f++) {
        const jump = act[1] === 1 || (act[1] === 2 && f < 3);
        inp.jumpPressed = jump && !held && f === 0;
        inp.jump = jump;
        w.step();
        if (W.failed || p.y > w.lv.pxH) return false;
    }
    return true;
}

// search from a saved state to x >= goal; returns { ok, best, nodes, seen }
function search(w, from, goal, opts = {}) {
    const heap = new Heap(), seen = new Set();
    w.load(from);
    heap.push({ s: from, held: false, path: null }, 0);
    seen.add(w.key());
    let best = w.p.x, nodes = 0, bestNode = null;
    const ground = opts.collect ? new Map() : null;
    while (heap.size && nodes < (opts.max || MAX_NODES)) {
        const n = heap.pop();
        nodes++;
        for (const act of ACTIONS) {
            w.load(n.s);
            if (!apply(w, act, n.held && act[1] === 1)) continue;
            if (w.p.x >= goal) return { ok: true, best: w.p.x, nodes, path: { act, prev: n.path }, ground };
            const k = w.key();
            if (seen.has(k)) continue;
            seen.add(k);
            const s = w.save();
            if (w.p.x > best) { best = w.p.x; bestNode = n; }
            if (ground && w.p.onGround && !w.p.ride) { const gk = ((w.p.x + 6) >> 4) + ',' + ((w.p.y + w.p.h) >> 4); if (!ground.has(gk)) ground.set(gk, s); }
            heap.push({ s, held: act[1] === 1, path: opts.keepPath ? { act, prev: n.path } : null }, w.p.x - w.W.frame * 0.4 + (w.p.onGround ? 4 : 0));
        }
    }
    return { ok: false, best, nodes, ground, bestNode };
}

// big: the hero after a power-up (taller: must fit under low ceilings, crouching if needed)
function check(id, big, quick) {
    const map = JSON.parse(fs.readFileSync(path.join(LEVELS, id + '.json'), 'utf8'));
    const w = makeWorld(map, big);
    const s0 = w.save();
    const t0 = Date.now();
    const r = search(w, s0, w.goalX, { collect: true });
    const out = { id, ok: r.ok, col: (r.best / 16) | 0, goalCol: (w.goalX / 16) | 0, nodes: r.nodes, ms: Date.now() - t0, traps: [] };
    // traps: from every ground tile reached on the way, the hero must still be able to move on
    // (to the goal, or at least 12 tiles further right than the trap)
    if (r.ok && r.ground && !quick) {
        const spots = [...r.ground.entries()].sort((a, b) => a[1][0] - b[1][0]);
        for (const [k, s] of spots) {
            w.load(s);
            const x0 = w.p.x;
            const q = search(w, s, Math.min(w.goalX, x0 + 12 * 16), { max: 50000 });
            if (!q.ok) out.traps.push(k.split(',').map(Number));
        }
    }
    return out;
}

function main() {
    const ids = process.argv.slice(2).filter((a) => /^w\d-\d$/.test(a)), quick = process.argv.includes('--quick');
    const list = ids.length ? ids : JSON.parse(fs.readFileSync(path.join(LEVELS, 'index.json'), 'utf8')).stages.map((s) => s.id);
    let bad = 0;
    for (const id of list) {
      for (const big of quick ? [false] : [false, true]) {
        const r = check(id, big, quick);
        const trapTxt = r.traps.length ? ' traps at ' + r.traps.slice(0, 8).map((t) => 'col ' + t[0] + ' row ' + t[1]).join('; ') + (r.traps.length > 8 ? ' (+' + (r.traps.length - 8) + ')' : '') : '';
        console.log(id.padEnd(5), (big ? 'big' : 'small').padEnd(6), r.ok ? 'finished' : 'STUCK at column ' + r.col + ' of ' + r.goalCol, (r.nodes + ' tries').padStart(14), (r.ms + ' ms').padStart(9), trapTxt);
        if (!r.ok || r.traps.length) bad++;
      }
    }
    process.exit(bad ? 1 : 0);
}

export { check, makeWorld, search };
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
