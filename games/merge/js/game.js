/* Tile Merge: slide and merge number tiles. Original implementation and music. */
(function () {
    'use strict';

    var N = 4, CELL = 52, GAP = 6, SIZE = N * CELL + (N + 1) * GAP;
    var OX = (480 - SIZE) / 2, OY = (270 - SIZE) / 2 + 12;
    var ANIM = 7;
    // own palette: cool blues to warm pinks (deliberately unlike other number-merging games)
    var COLORS = { 2: '#d7f0ff', 4: '#b5e3fb', 8: '#7fd1f0', 16: '#4fb9e8', 32: '#4c8df2', 64: '#6c63f0', 128: '#9a5cf0',
                   256: '#c158e0', 512: '#e055c0', 1024: '#f25c8f', 2048: '#ffb03a' };
    var MUSIC = {
        bpm: 96,
        tracks: [
            { wave: 'triangle', vol: 0.16, notes: 'E5:4 G5:4 C6:4 B5:4 A5:4 G5:4 E5:8 D5:4 F5:4 A5:4 G5:4 F5:4 D5:4 C5:8' },
            { wave: 'sine', vol: 0.25, notes: 'C3:8 G3:8 A2:8 E3:8 F2:8 C3:8 G2:8 G3:8' }
        ]
    };

    var t, hud, rnd, state, best, score, won;
    var grid = [], tiles = [], animT = 0;   // tile: { v, x, y, fx, fy, merged, born }

    function tileAt(x, y) { return grid[y * N + x]; }

    function addRandom() {
        var free = [];
        for (var i = 0; i < N * N; i++) if (!grid[i]) free.push(i);
        if (!free.length) return;
        var k = free[(rnd() * free.length) | 0];
        var tl = { v: rnd() < 0.9 ? 2 : 4, x: k % N, y: (k / N) | 0, fx: k % N, fy: (k / N) | 0, born: 1, merged: 0 };
        grid[k] = tl; tiles.push(tl);
    }

    function reset() {
        rnd = GK.rng(Date.now());
        grid = []; tiles = [];
        for (var i = 0; i < N * N; i++) grid.push(null);
        score = 0; won = false;
        addRandom(); addRandom();
        animT = ANIM;
        state = 'play';
        GK.banner('');
        t.gk.audio.music(MUSIC);
    }

    function canMove() {
        for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
            var a = tileAt(x, y);
            if (!a) return true;
            if (x < N - 1 && tileAt(x + 1, y) && tileAt(x + 1, y).v === a.v) return true;
            if (y < N - 1 && tileAt(x, y + 1) && tileAt(x, y + 1).v === a.v) return true;
        }
        return false;
    }

    function move(dir) {
        var dx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0, dy = dir === 'up' ? -1 : dir === 'down' ? 1 : 0;
        var moved = false, gained = 0, i;
        // drop tiles merged in the previous move, remember start positions for animation
        var keep = [];
        for (i = 0; i < tiles.length; i++) if (!tiles[i].dead) { tiles[i].fx = tiles[i].x; tiles[i].fy = tiles[i].y; tiles[i].born = 0; tiles[i].merged = 0; keep.push(tiles[i]); }
        tiles = keep;
        var xs = [0, 1, 2, 3], ys = [0, 1, 2, 3];
        if (dx > 0) xs.reverse();
        if (dy > 0) ys.reverse();
        var mergedInto = [];
        for (var a = 0; a < N; a++) for (var b = 0; b < N; b++) {
            var x = xs[dx ? b : a], y = ys[dx ? a : b];
            var tl = tileAt(x, y);
            if (!tl) continue;
            var nx = x, ny = y;
            while (true) {
                var tx = nx + dx, ty = ny + dy;
                if (tx < 0 || ty < 0 || tx >= N || ty >= N) break;
                var o = tileAt(tx, ty);
                if (!o) { nx = tx; ny = ty; continue; }
                if (o.v === tl.v && mergedInto.indexOf(o) < 0) {
                    grid[y * N + x] = null;
                    o.v *= 2; o.merged = 1; mergedInto.push(o);
                    tl.x = tx; tl.y = ty; tl.dead = 1;
                    gained += o.v;
                    moved = true;
                    tl = null;
                }
                break;
            }
            if (tl && (nx !== x || ny !== y)) {
                grid[y * N + x] = null; grid[ny * N + nx] = tl;
                tl.x = nx; tl.y = ny; moved = true;
            }
        }
        if (!moved) return;
        score += gained;
        animT = 0;
        t.gk.audio.sfx(gained ? 'merge' : 'move');
        addRandom();
        for (i = 0; i < mergedInto.length; i++) if (mergedInto[i].v === 2048 && !won) {
            won = true; state = 'won';
            t.gk.audio.sfx('clear');
            GK.banner(t.s('youWin'), t.s('keepGoing'));
            t.gk.announce(t.s('youWin') + ' ' + t.s('keepGoing'));
        }
        if (!canMove()) {
            state = 'over';
            t.gk.submitScore(score);
            var nb = score > best;
            if (nb) { best = score; t.gk.save('best', best); }
            t.gk.audio.music(null);
            t.gk.audio.sfx('over');
            GK.banner(t.s('gameOver'), (nb ? t.s('newBest') + ' ' : '') + t.s('pressOk'));
            t.gk.announce(t.s('gameOver') + '. ' + t.s('score') + ' ' + score + '. ' + t.s('pressOk'));
        }
    }

    var def = {
        id: 'merge',
        minScale: 2,
        start: function (gk) {
            t = { gk: gk, s: GK.tr(MINI_STRINGS, gk.lang) };
            best = gk.load('best', 0);
            hud = GK.hud([['score', t.s('score')], ['best', t.s('best')]]);
            rnd = GK.rng(5); score = 0;
            grid = []; tiles = [];
            for (var i = 0; i < N * N; i++) grid.push(null);
            state = 'ready';
            GK.banner('Tile Merge', t.s('start'));
            gk.announce('Tile Merge. ' + t.s('start'));
        },
        update: function (gk) {
            gk.setText(hud.score, score); gk.setText(hud.best, Math.max(best, score));
            if (animT < ANIM) animT++;
            if (state === 'ready' || state === 'over') {
                if (gk.pressed('confirm') || gk.pressed('jump')) reset();
                return;
            }
            if (state === 'won') {
                if (gk.pressed('confirm') || gk.pressed('jump')) { state = 'play'; GK.banner(''); }
                return;
            }
            var dirs = ['left', 'right', 'up', 'down'];
            for (var i = 0; i < 4; i++) if (gk.pressed(dirs[i])) { move(dirs[i]); break; }
        },
        onAction: function (gk, a, pressed, repeat) {
            // the remote's key auto-repeat is ignored: one press = one move
        },
        render: function (gk, alpha) {
            var c = gk.ctx, x, y, i;
            c.fillStyle = '#121636'; c.fillRect(0, 0, 480, 270);
            c.fillStyle = '#232a63'; GK.roundRect(c, OX, OY, SIZE, SIZE, 6); c.fill();
            c.fillStyle = '#2f377a';
            for (y = 0; y < N; y++) for (x = 0; x < N; x++) { GK.roundRect(c, OX + GAP + x * (CELL + GAP), OY + GAP + y * (CELL + GAP), CELL, CELL, 4); c.fill(); }
            var p = Math.min(1, (animT + alpha) / ANIM);
            for (i = 0; i < tiles.length; i++) {
                var tl = tiles[i];
                if (tl.dead && p >= 1) continue;
                var tx = tl.fx + (tl.x - tl.fx) * p, ty = tl.fy + (tl.y - tl.fy) * p;
                var s = tl.born ? p : tl.merged && p >= 1 ? 1 : tl.merged ? 1 + Math.sin(p * Math.PI) * 0.12 : 1;
                var v = tl.dead ? tl.v : tl.merged && p < 0.6 ? tl.v / 2 : tl.v;
                var cx = OX + GAP + tx * (CELL + GAP) + CELL / 2, cy = OY + GAP + ty * (CELL + GAP) + CELL / 2, h = CELL * s / 2;
                c.fillStyle = COLORS[v] || '#ff7a3a';
                GK.roundRect(c, cx - h, cy - h, h * 2, h * 2, 4); c.fill();
                var fs = v < 100 ? 24 : v < 1000 ? 20 : 15;
                GK.text(c, String(v), cx, cy + 1, fs * s, v <= 8 ? '#14204a' : '#ffffff', 'center');
            }
        },
        menuItems: function () { return [{ id: 'restart', label: t.s('restart') }]; },
        onMenu: function (gk, id) { if (id === 'restart') reset(); }
    };

    GK.create(def);
})();
