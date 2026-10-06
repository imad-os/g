/* Brick Breaker. Original implementation, art, layouts and music. */
(function () {
    'use strict';

    var BW = 30, BH = 10, COLS = 14, ROWS = 8, OX = (480 - COLS * BW) / 2, OY = 40;
    var MAXB = 4, MAXDROP = 6;
    var COLORS = ['', '#f25c5c', '#f2994a', '#f2c94c', '#4cd97b', '#3ad6e8', '#4c7cf2', '#b06cf0', '#999'];
    // Layouts: digit = brick hit points/color, 8 = two-hit grey, '.' = empty. 14 columns x 8 rows.
    var LAYOUTS = [
        ['..............', '11111111111111', '22222222222222', '33333333333333', '44444444444444', '55555555555555', '..............', '..............'],
        ['......88......', '.....8338.....', '....833338....', '...86666668...', '..8444444448..', '...22222222...', '....111111....', '..............'],
        ['5.5.5.5.5.5.5.', '.4.4.4.4.4.4.4', '3.3.3.3.3.3.3.', '.2.2.2.2.2.2.2', '1.1.1.1.1.1.1.', '88888888888888', '..............', '..............'],
        ['77..77..77..77', '77..77..77..77', '..66..66..66..', '..66..66..66..', '55..55..55..55', '55..55..55..55', '..88..88..88..', '..............'],
        ['88888888888888', '8............8', '8.3333333333.8', '8.3........3.8', '8.3.555555.3.8', '8.3........3.8', '8.3333333333.8', '8............8']
    ];
    var MUSIC = {
        bpm: 128,
        tracks: [
            { wave: 'square', vol: 0.09, notes: 'G4:2 B4:2 D5:2 G5:2 F#5:4 D5:4 E5:2 C5:2 A4:2 C5:2 D5:8 ' +
                                             'G4:2 B4:2 D5:2 G5:2 A5:4 G5:2 F#5:2 E5:2 D5:2 C5:2 B4:2 A4:8' },
            { wave: 'triangle', vol: 0.22, notes: 'G2:4 G3:4 G2:4 G3:4 C3:4 C4:4 D3:4 D4:4 G2:4 G3:4 E2:4 E3:4 C3:4 C4:4 D3:4 D4:4' },
            { drums: 'k:2 h:2 s:2 h:2 k:2 k:2 s:2 h:2', vol: 0.6 }
        ]
    };

    var t, hud, rnd, parts, state, best;
    var bricks = new Uint8Array(COLS * ROWS), left;
    var pad = { x: 210, w: 56, vx: 0, wideT: 0 };
    var bx = new Float32Array(MAXB), by = new Float32Array(MAXB), bvx = new Float32Array(MAXB), bvy = new Float32Array(MAXB), bon = new Uint8Array(MAXB);
    var dx = new Float32Array(MAXDROP), dy = new Float32Array(MAXDROP), dk = new Uint8Array(MAXDROP), don = new Uint8Array(MAXDROP);
    var stuck, score, lives, level, speed, slowT;
    var PY = 250;

    function loadLevel() {
        var L = LAYOUTS[(level - 1) % LAYOUTS.length];
        left = 0;
        for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) {
            var ch = L[r].charAt(c), v = ch === '.' ? 0 : +ch;
            bricks[r * COLS + c] = v === 8 ? 10 : v;   // 10 = two-hit grey, becomes 8 after a hit
            if (v) left++;
        }
        speed = Math.min(4.6, 2.6 + (level - 1) * 0.25);
        serve();
    }

    function serve() {
        for (var i = 0; i < MAXB; i++) bon[i] = 0;
        for (i = 0; i < MAXDROP; i++) don[i] = 0;
        bon[0] = 1; stuck = true;
        pad.w = 56; pad.wideT = 0; slowT = 0;
        bx[0] = pad.x + pad.w / 2; by[0] = PY - 4;
    }

    function launch() {
        stuck = false;
        var a = -Math.PI / 2 + (rnd() - 0.5) * 0.8;
        bvx[0] = Math.cos(a) * speed; bvy[0] = Math.sin(a) * speed;
    }

    function reset() {
        rnd = GK.rng(Date.now());
        score = 0; lives = 3; level = 1;
        pad.x = 240 - 28;
        loadLevel();
        state = 'play';
        GK.banner('');
        t.gk.audio.music(MUSIC);
    }

    function gameOver() {
        state = 'over';
        var nb = score > best;
        if (nb) { best = score; t.gk.save('best', best); }
        t.gk.audio.music(null);
        t.gk.audio.sfx('over');
        GK.banner(t.s('gameOver'), (nb ? t.s('newBest') + ' ' : '') + t.s('pressOk'));
        t.gk.announce(t.s('gameOver') + '. ' + t.s('score') + ' ' + score + '. ' + t.s('pressOk'));
    }

    function hitBrick(i) {
        var v = bricks[i];
        if (v === 10) { bricks[i] = 8; t.gk.audio.sfx('bump'); return; }
        bricks[i] = 0; left--;
        score += 10 * level;
        t.gk.audio.sfx('blip', 0.8 + (i % 7) * 0.08);
        var x = OX + (i % COLS) * BW, y = OY + ((i / COLS) | 0) * BH;
        for (var k = 0; k < 6; k++) parts.add(x + rnd() * BW, y + rnd() * BH, (rnd() - 0.5) * 2, -rnd() * 1.5, 24, COLORS[v], 3);
        if (rnd() < 0.12) drop(x + BW / 2, y);
    }

    function drop(x, y) {
        for (var i = 0; i < MAXDROP; i++) if (!don[i]) { don[i] = 1; dx[i] = x; dy[i] = y; dk[i] = 1 + ((rnd() * 3) | 0); return; }
    }

    function moveBall(i) {
        var steps = 2, sx = bvx[i] / steps, sy = bvy[i] / steps * (slowT > 0 ? 0.7 : 1);
        if (slowT > 0) sx *= 0.7;
        for (var s = 0; s < steps; s++) {
            bx[i] += sx;
            if (bx[i] < 3) { bx[i] = 3; bvx[i] = Math.abs(bvx[i]); sx = Math.abs(sx); }
            if (bx[i] > 477) { bx[i] = 477; bvx[i] = -Math.abs(bvx[i]); sx = -Math.abs(sx); }
            if (collideBricks(i)) { bvx[i] = -bvx[i]; sx = -sx; bx[i] += sx; }
            by[i] += sy;
            if (by[i] < 3) { by[i] = 3; bvy[i] = Math.abs(bvy[i]); sy = Math.abs(sy); }
            if (collideBricks(i)) { bvy[i] = -bvy[i]; sy = -sy; by[i] += sy; }
            // paddle
            if (bvy[i] > 0 && by[i] + 3 >= PY && by[i] + 3 <= PY + 6 && bx[i] >= pad.x - 3 && bx[i] <= pad.x + pad.w + 3) {
                var off = (bx[i] - (pad.x + pad.w / 2)) / (pad.w / 2);   // -1..1 controls the angle
                var a = -Math.PI / 2 + GK.clamp(off, -1, 1) * 1.05;
                var sp = Math.min(6, Math.sqrt(bvx[i] * bvx[i] + bvy[i] * bvy[i]) + 0.04);
                bvx[i] = Math.cos(a) * sp; bvy[i] = Math.sin(a) * sp;
                by[i] = PY - 3;
                t.gk.audio.sfx('bounce');
                return;
            }
        }
    }

    function collideBricks(i) {
        var c = Math.floor((bx[i] - OX) / BW), r = Math.floor((by[i] - OY) / BH);
        if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return false;
        var k = r * COLS + c;
        if (!bricks[k]) return false;
        hitBrick(k);
        return true;
    }

    var def = {
        minScale: 2,
        start: function (gk) {
            t = { gk: gk, s: GK.tr(MINI_STRINGS, gk.lang) };
            best = gk.load('best', 0);
            parts = new GK.Particles(gk.q.particles);
            hud = GK.hud([['score', t.s('score')], ['level', t.s('level')], ['lives', t.s('lives')], ['best', t.s('best')]]);
            rnd = GK.rng(9); level = 1; score = 0; lives = 3;
            loadLevel();
            state = 'ready';
            GK.banner('Brick Breaker', t.s('start'));
            gk.announce('Brick Breaker. ' + t.s('start'));
        },
        update: function (gk) {
            gk.setText(hud.score, score); gk.setText(hud.level, level); gk.setText(hud.lives, lives);
            gk.setText(hud.best, Math.max(best, score));
            parts.update();
            if (state !== 'play') {
                if (gk.pressed('confirm') || gk.pressed('jump')) reset();
                return;
            }
            var acc = gk.isDown('run') ? 1.1 : 0.7, max = gk.isDown('run') ? 7 : 5;
            if (gk.isDown('left')) pad.vx = Math.max(-max, pad.vx - acc);
            else if (gk.isDown('right')) pad.vx = Math.min(max, pad.vx + acc);
            else pad.vx *= 0.7;
            pad.x = GK.clamp(pad.x + pad.vx, 2, 478 - pad.w);
            if (pad.wideT > 0 && --pad.wideT === 0) pad.w = 56;
            if (slowT > 0) slowT--;

            if (stuck) {
                bx[0] = pad.x + pad.w / 2; by[0] = PY - 4;
                if (gk.pressed('jump') || gk.pressed('up')) launch();
            } else {
                var alive = 0;
                for (var i = 0; i < MAXB; i++) {
                    if (!bon[i]) continue;
                    moveBall(i);
                    if (by[i] > 275) bon[i] = 0; else alive++;
                }
                if (!alive) {
                    lives--;
                    gk.audio.sfx('lose');
                    if (lives <= 0) return gameOver();
                    gk.announce(t.s('lives') + ' ' + lives);
                    serve();
                }
            }
            for (var d = 0; d < MAXDROP; d++) {
                if (!don[d]) continue;
                dy[d] += 1.2;
                if (dy[d] > 275) { don[d] = 0; continue; }
                if (dy[d] + 4 >= PY && dy[d] <= PY + 6 && dx[d] >= pad.x - 4 && dx[d] <= pad.x + pad.w + 4) {
                    don[d] = 0;
                    gk.audio.sfx('power');
                    score += 25;
                    if (dk[d] === 1) { pad.w = 84; pad.wideT = 900; pad.x = Math.min(pad.x, 478 - pad.w); }
                    else if (dk[d] === 2) slowT = 600;
                    else split();
                }
            }
            if (left <= 0) {
                level++;
                gk.audio.sfx('clear');
                gk.announce(t.s('levelUp') + ' ' + level);
                loadLevel();
            }
        },
        render: function (gk) {
            var c = gk.ctx, i;
            c.fillStyle = '#0b0d24'; c.fillRect(0, 0, 480, 270);
            c.fillStyle = '#10143a';
            for (i = 0; i < 480; i += 24) c.fillRect(i, 0, 1, 270);
            for (i = 0; i < COLS * ROWS; i++) {
                var v = bricks[i];
                if (!v) continue;
                var x = OX + (i % COLS) * BW, y = OY + ((i / COLS) | 0) * BH;
                c.fillStyle = v === 10 ? '#bbb' : COLORS[v];
                c.fillRect(x + 1, y + 1, BW - 2, BH - 2);
                c.fillStyle = 'rgba(255,255,255,0.3)'; c.fillRect(x + 1, y + 1, BW - 2, 2);
            }
            for (i = 0; i < MAXDROP; i++) {
                if (!don[i]) continue;
                c.fillStyle = dk[i] === 1 ? '#4c7cf2' : dk[i] === 2 ? '#4cd97b' : '#f2c94c';
                c.fillRect(dx[i] - 8, dy[i] - 4, 16, 8);
                GK.text(c, dk[i] === 1 ? 'W' : dk[i] === 2 ? 'S' : '3', dx[i], dy[i], 7, '#000', 'center');
            }
            c.fillStyle = pad.wideT ? '#4c7cf2' : '#e6e9ff';
            GK.roundRect(c, pad.x, PY, pad.w, 6, 3); c.fill();
            c.fillStyle = '#fff';
            for (i = 0; i < MAXB; i++) if (bon[i]) c.fillRect(bx[i] - 3, by[i] - 3, 6, 6);
            parts.draw(c, 0, 0);
        },
        menuItems: function () { return [{ id: 'restart', label: t.s('restart') }]; },
        onMenu: function (gk, id) { if (id === 'restart') reset(); }
    };

    function split() {
        for (var i = 0; i < MAXB; i++) {
            if (!bon[i]) continue;
            for (var j = 0, made = 0; j < MAXB && made < 2; j++) {
                if (bon[j]) continue;
                bon[j] = 1; bx[j] = bx[i]; by[j] = by[i];
                var a = Math.atan2(bvy[i], bvx[i]) + (made ? 0.5 : -0.5), sp = Math.sqrt(bvx[i] * bvx[i] + bvy[i] * bvy[i]);
                bvx[j] = Math.cos(a) * sp; bvy[j] = Math.sin(a) * sp;
                made++;
            }
            return;
        }
    }

    GK.create(def);
})();
