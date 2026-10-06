/* Neon Snake. Original implementation, art and music. */
(function () {
    'use strict';

    var GW = 30, GH = 16, CS = 14, OX = (480 - GW * CS) / 2, OY = 270 - GH * CS - 12;
    var MUSIC = {
        bpm: 120,
        tracks: [
            { wave: 'square', vol: 0.08, notes: 'E5:2 .:2 G5:2 .:2 A5:4 G5:2 E5:2 D5:2 .:2 E5:2 .:2 C5:8 ' +
                                             'E5:2 .:2 G5:2 .:2 B5:4 A5:2 G5:2 A5:2 .:2 G5:2 .:2 E5:8' },
            { wave: 'triangle', vol: 0.22, notes: 'A2:2 A2:2 E3:2 A2:2 A2:2 A2:2 G3:2 A2:2 F2:2 F2:2 C3:2 F2:2 G2:2 G2:2 D3:2 G2:2 ' +
                                                  'A2:2 A2:2 E3:2 A2:2 A2:2 A2:2 G3:2 A2:2 F2:2 F2:2 C3:2 F2:2 E2:2 E2:2 B2:2 E2:2' },
            { drums: 'k:4 h:2 h:2 s:4 h:4', vol: 0.6 }
        ]
    };

    var t, hud, rnd, state, best, parts;
    var MAX = GW * GH;
    var sx = new Int16Array(MAX), sy = new Int16Array(MAX), head, len;   // ring buffer
    var occ = new Uint8Array(MAX);
    var dir, queue = [], food = { x: 0, y: 0 }, bonus = { on: false, x: 0, y: 0, t: 0 };
    var score, tickT, speed, grow, eaten;

    var DX = { left: -1, right: 1, up: 0, down: 0 }, DY = { left: 0, right: 0, up: -1, down: 1 };
    var OPP = { left: 'right', right: 'left', up: 'down', down: 'up' };

    function cellAt(i) { return (head - i + MAX) % MAX; }

    function placeFood(o) {
        for (var tries = 0; tries < 500; tries++) {
            var x = (rnd() * GW) | 0, y = (rnd() * GH) | 0;
            if (!occ[y * GW + x] && !(food.x === x && food.y === y)) { o.x = x; o.y = y; return; }
        }
    }

    function reset() {
        rnd = GK.rng(Date.now());
        occ.fill ? occ.fill(0) : (occ = new Uint8Array(MAX));
        head = 0; len = 4;
        for (var i = 0; i < len; i++) {
            var idx = (MAX - i) % MAX;
            sx[idx] = 8 - i; sy[idx] = 8;
            occ[8 * GW + 8 - i] = 1;
        }
        dir = 'right'; queue.length = 0;
        score = 0; speed = 9; tickT = 0; grow = 0; eaten = 0;
        placeFood(food);
        bonus.on = false;
        state = 'play';
        GK.banner('');
        t.gk.audio.music(MUSIC);
    }

    function gameOver() {
        state = 'over';
        t.gk.submitScore(score);
        var nb = score > best;
        if (nb) { best = score; t.gk.save('best', best); }
        t.gk.audio.music(null);
        t.gk.audio.sfx('lose');
        GK.banner(t.s('gameOver'), (nb ? t.s('newBest') + ' ' : '') + t.s('pressOk'));
        t.gk.announce(t.s('gameOver') + '. ' + t.s('score') + ' ' + score + '. ' + t.s('pressOk'));
    }

    function step() {
        if (queue.length) dir = queue.shift();
        var hx = sx[head] + DX[dir], hy = sy[head] + DY[dir];
        if (hx < 0 || hy < 0 || hx >= GW || hy >= GH) return gameOver();
        // the tail moves away this step unless we are growing
        var tail = cellAt(len - 1);
        if (!grow) occ[sy[tail] * GW + sx[tail]] = 0;
        if (occ[hy * GW + hx]) return gameOver();
        head = (head + 1) % MAX;
        sx[head] = hx; sy[head] = hy;
        occ[hy * GW + hx] = 1;
        if (grow) { len++; grow--; }

        if (hx === food.x && hy === food.y) {
            score += 10; grow += 2; eaten++;
            t.gk.audio.sfx('eat');
            burst(hx, hy, '#4cd97b');
            placeFood(food);
            if (eaten % 4 === 0) speed = Math.max(3, speed - 1);
            if (!bonus.on && eaten % 5 === 0) { bonus.on = true; bonus.t = 300; placeFood(bonus); }
        }
        if (bonus.on && hx === bonus.x && hy === bonus.y) {
            score += 50; grow += 3; bonus.on = false;
            t.gk.audio.sfx('coin');
            burst(hx, hy, '#ffd23f');
        }
    }

    function burst(x, y, col) {
        for (var i = 0; i < 10; i++) parts.add(OX + x * CS + 7, OY + y * CS + 7, (rnd() - 0.5) * 3, (rnd() - 0.5) * 3, 24, col, 2, 0);
    }

    var def = {
        id: 'snake',
        minScale: 2,
        start: function (gk) {
            t = { gk: gk, s: GK.tr(MINI_STRINGS, gk.lang) };
            best = gk.load('best', 0);
            parts = new GK.Particles(gk.q.particles);
            hud = GK.hud([['score', t.s('score')], ['best', t.s('best')]]);
            rnd = GK.rng(3); head = 0; len = 0; score = 0;
            state = 'ready';
            GK.banner('Neon Snake', t.s('start'));
            gk.announce('Neon Snake. ' + t.s('start'));
        },
        update: function (gk) {
            gk.setText(hud.score, score); gk.setText(hud.best, Math.max(best, score));
            parts.update();
            if (state !== 'play') {
                if (gk.pressed('confirm') || gk.pressed('jump')) reset();
                return;
            }
            var dirs = ['left', 'right', 'up', 'down'];
            for (var i = 0; i < 4; i++) {
                if (gk.pressed(dirs[i])) {
                    var last = queue.length ? queue[queue.length - 1] : dir;
                    if (dirs[i] !== last && dirs[i] !== OPP[last] && queue.length < 3) queue.push(dirs[i]);
                }
            }
            if (bonus.on && --bonus.t <= 0) bonus.on = false;
            var sp = gk.isDown('run') ? Math.max(2, speed >> 1) : speed;
            if (++tickT >= sp) { tickT = 0; step(); }
        },
        render: function (gk) {
            var c = gk.ctx, i;
            c.fillStyle = '#070818'; c.fillRect(0, 0, 480, 270);
            c.fillStyle = '#0e1130'; c.fillRect(OX, OY, GW * CS, GH * CS);
            c.fillStyle = '#141a45';
            for (i = 1; i < GW; i++) c.fillRect(OX + i * CS, OY, 0.5, GH * CS);
            for (i = 1; i < GH; i++) c.fillRect(OX, OY + i * CS, GW * CS, 0.5);
            c.strokeStyle = '#3ad6e8'; c.lineWidth = 2; c.strokeRect(OX - 1, OY - 1, GW * CS + 2, GH * CS + 2);
            if (state === 'ready') return;
            var pulse = 1 + Math.sin(gk.frame * 0.15) * 1.2;
            c.fillStyle = '#f25c5c';
            c.fillRect(OX + food.x * CS + 3 - pulse / 2, OY + food.y * CS + 3 - pulse / 2, CS - 6 + pulse, CS - 6 + pulse);
            if (bonus.on && (bonus.t > 90 || (bonus.t >> 3) & 1)) {
                c.fillStyle = '#ffd23f'; c.fillRect(OX + bonus.x * CS + 2, OY + bonus.y * CS + 2, CS - 4, CS - 4);
            }
            for (i = len - 1; i >= 0; i--) {
                var k = cellAt(i), f = 1 - i / (len + 4);
                c.fillStyle = i === 0 ? '#b6ffcf' : 'rgb(' + ((40 + 40 * f) | 0) + ',' + ((140 + 100 * f) | 0) + ',' + ((90 + 60 * f) | 0) + ')';
                c.fillRect(OX + sx[k] * CS + 1, OY + sy[k] * CS + 1, CS - 2, CS - 2);
            }
            var hk = cellAt(0);
            c.fillStyle = '#071';
            c.fillRect(OX + sx[hk] * CS + 4 + DX[dir] * 2, OY + sy[hk] * CS + 4 + DY[dir] * 2, 2, 2);
            c.fillRect(OX + sx[hk] * CS + 8 + DX[dir] * 2, OY + sy[hk] * CS + 8 + DY[dir] * 2, 2, 2);
            parts.draw(c, 0, 0);
        },
        menuItems: function () { return [{ id: 'restart', label: t.s('restart') }]; },
        onMenu: function (gk, id) { if (id === 'restart') reset(); }
    };

    GK.create(def);
})();
