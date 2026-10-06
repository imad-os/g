/* Block Drop: falling-block puzzle. Original implementation, art and music. */
(function () {
    'use strict';

    var COLS = 10, ROWS = 20, CELL = 12;
    var BX = (480 - COLS * CELL) / 2, BY = (270 - ROWS * CELL) / 2;
    var COLORS = ['#000', '#3ad6e8', '#f2c94c', '#b06cf0', '#4cd97b', '#f25c5c', '#4c7cf2', '#f2994a'];
    var SHAPES = [
        null,
        [[0, 1], [1, 1], [2, 1], [3, 1]],  // I
        [[1, 0], [2, 0], [1, 1], [2, 1]],  // O
        [[1, 0], [0, 1], [1, 1], [2, 1]],  // T
        [[1, 0], [2, 0], [0, 1], [1, 1]],  // S
        [[0, 0], [1, 0], [1, 1], [2, 1]],  // Z
        [[0, 0], [0, 1], [1, 1], [2, 1]],  // J
        [[2, 0], [0, 1], [1, 1], [2, 1]]   // L
    ];
    var KICKS = [[0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1]];
    var LINE_SCORE = [0, 100, 300, 500, 800];

    var MUSIC = {
        bpm: 132,
        tracks: [
            { wave: 'square', vol: 0.11, notes: 'A4:4 E5:2 D5:2 C5:4 B4:2 C5:2 D5:4 C5:2 B4:2 A4:4 .:4 ' +
                                              'F4:4 A4:2 C5:2 B4:4 A4:2 G4:2 A4:4 B4:2 C5:2 E5:4 .:4 ' +
                                              'D5:4 F5:2 A5:2 G5:4 F5:2 E5:2 C5:4 E5:2 D5:2 C5:4 .:4 ' +
                                              'B4:4 C5:2 D5:2 E5:4 C5:4 A4:4 .:4 A4:8' },
            { wave: 'triangle', vol: 0.22, notes: 'A2:2 A3:2 A2:2 A3:2 A2:2 A3:2 A2:2 A3:2 F2:2 F3:2 F2:2 F3:2 G2:2 G3:2 G2:2 G3:2 ' +
                                                  'F2:2 F3:2 F2:2 F3:2 G2:2 G3:2 G2:2 G3:2 A2:2 A3:2 A2:2 A3:2 E2:2 E3:2 E2:2 E3:2 ' +
                                                  'D2:2 D3:2 D2:2 D3:2 C2:2 C3:2 C2:2 C3:2 F2:2 F3:2 F2:2 F3:2 G2:2 G3:2 G2:2 G3:2 ' +
                                                  'E2:2 E3:2 E2:2 E3:2 E2:2 E3:2 E2:2 E3:2 A2:2 A3:2 A2:2 A3:2 A2:2 A3:2 A2:2 A3:2' },
            { drums: 'k:2 h:2 s:2 h:2 k:2 k:2 s:2 h:2', vol: 0.8 }
        ]
    };

    var t, hud, board, piece, nextType, bag = [], rnd;
    var state, score, lines, level, best, fall, lockT, lockResets, das, clearRows = [], clearT, dropBonus;

    function newBag() {
        bag = [1, 2, 3, 4, 5, 6, 7];
        for (var i = bag.length - 1; i > 0; i--) { var j = (rnd() * (i + 1)) | 0, x = bag[i]; bag[i] = bag[j]; bag[j] = x; }
    }
    function take() { if (!bag.length) newBag(); return bag.pop(); }

    function cells(type, rot) {
        var s = SHAPES[type], out = [], size = type === 1 ? 4 : type === 2 ? 4 : 3;
        for (var i = 0; i < 4; i++) {
            var x = s[i][0], y = s[i][1];
            for (var r = 0; r < rot; r++) { var nx = size - 1 - y; y = x; x = nx; }
            out.push([x, y]);
        }
        return out;
    }

    function fits(type, rot, px, py) {
        var c = cells(type, rot);
        for (var i = 0; i < 4; i++) {
            var x = px + c[i][0], y = py + c[i][1];
            if (x < 0 || x >= COLS || y >= ROWS) return false;
            if (y >= 0 && board[y * COLS + x]) return false;
        }
        return true;
    }

    function spawn() {
        var type = nextType;
        nextType = take();
        piece = { type: type, rot: 0, x: 3, y: type === 1 ? -1 : 0 };
        lockT = 0; lockResets = 0; fall = 0;
        if (!fits(piece.type, piece.rot, piece.x, piece.y)) gameOver();
    }

    function reset() {
        board = new Uint8Array(COLS * ROWS);
        score = 0; lines = 0; level = 1; dropBonus = 0;
        bag = []; nextType = take();
        spawn();
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

    function tryMove(dx, dy) {
        if (fits(piece.type, piece.rot, piece.x + dx, piece.y + dy)) {
            piece.x += dx; piece.y += dy;
            if (lockT && lockResets < 15) { lockT = 0; lockResets++; }
            return true;
        }
        return false;
    }

    function rotate(dir) {
        if (piece.type === 2) return;
        var r = (piece.rot + dir + 4) % 4;
        for (var i = 0; i < KICKS.length; i++) {
            var kx = KICKS[i][0], ky = KICKS[i][1];
            if (fits(piece.type, r, piece.x + kx, piece.y + ky)) {
                piece.rot = r; piece.x += kx; piece.y += ky;
                if (lockT && lockResets < 15) { lockT = 0; lockResets++; }
                t.gk.audio.sfx('rotate');
                return;
            }
        }
    }

    function lock() {
        var c = cells(piece.type, piece.rot), top = false;
        for (var i = 0; i < 4; i++) {
            var x = piece.x + c[i][0], y = piece.y + c[i][1];
            if (y < 0) top = true; else board[y * COLS + x] = piece.type;
        }
        score += dropBonus; dropBonus = 0;
        if (top) return gameOver();
        clearRows.length = 0;
        for (var y = 0; y < ROWS; y++) {
            var full = true;
            for (var x2 = 0; x2 < COLS; x2++) if (!board[y * COLS + x2]) { full = false; break; }
            if (full) clearRows.push(y);
        }
        if (clearRows.length) {
            state = 'clear'; clearT = 14;
            t.gk.audio.sfx(clearRows.length === 4 ? 'tetra' : 'clear');
        } else {
            t.gk.audio.sfx('drop');
            spawn();
        }
    }

    function finishClear() {
        for (var k = 0; k < clearRows.length; k++) {
            var row = clearRows[k];
            board.copyWithin ? board.copyWithin(COLS, 0, row * COLS) : shiftDown(row);
            for (var x = 0; x < COLS; x++) board[x] = 0;
        }
        var n = clearRows.length;
        lines += n;
        score += LINE_SCORE[n] * level;
        var nl = 1 + Math.floor(lines / 10);
        if (nl > level) { level = nl; t.gk.announce(t.s('levelUp') + ' ' + level); }
        state = 'play';
        spawn();
    }
    function shiftDown(row) { for (var i = row * COLS + COLS - 1; i >= COLS; i--) board[i] = board[i - COLS]; }

    function hardDrop() {
        var n = 0;
        while (fits(piece.type, piece.rot, piece.x, piece.y + 1)) { piece.y++; n++; }
        dropBonus += n * 2;
        lock();
    }

    function ghostY() {
        var y = piece.y;
        while (fits(piece.type, piece.rot, piece.x, y + 1)) y++;
        return y;
    }

    var def = {
        minScale: 2,
        start: function (gk) {
            t = { gk: gk, s: GK.tr(MINI_STRINGS, gk.lang) };
            rnd = GK.rng(Date.now());
            best = gk.load('best', 0);
            hud = GK.hud([['score', t.s('score')], ['level', t.s('level')], ['lines', t.s('lines')], ['best', t.s('best')]]);
            board = new Uint8Array(COLS * ROWS);
            nextType = take();
            state = 'ready';
            GK.banner('Block Drop', t.s('start'));
            gk.announce('Block Drop. ' + t.s('start'));
        },
        update: function (gk) {
            gk.setText(hud.score, score || 0); gk.setText(hud.level, level || 1);
            gk.setText(hud.lines, lines || 0); gk.setText(hud.best, Math.max(best, score || 0));
            if (state === 'ready' || state === 'over') {
                if (gk.pressed('confirm') || gk.pressed('jump')) reset();
                return;
            }
            if (state === 'clear') { if (--clearT <= 0) finishClear(); return; }

            if (gk.pressed('jump')) rotate(1);
            if (gk.pressed('run')) rotate(-1);
            if (gk.pressed('up')) return hardDrop();

            var l = gk.isDown('left'), r = gk.isDown('right');
            if (gk.pressed('left')) { if (tryMove(-1, 0)) gk.audio.sfx('move'); das = 0; }
            else if (gk.pressed('right')) { if (tryMove(1, 0)) gk.audio.sfx('move'); das = 0; }
            else if (l || r) { das++; if (das > 10 && das % 3 === 0) tryMove(l ? -1 : 1, 0); }

            var speed = Math.max(2, 48 - (level - 1) * 4);
            if (gk.isDown('down')) speed = 2;
            if (++fall >= speed) {
                fall = 0;
                if (tryMove(0, 1)) { if (gk.isDown('down')) dropBonus++; }
            }
            if (!fits(piece.type, piece.rot, piece.x, piece.y + 1)) {
                if (++lockT > 30) lock();
            } else lockT = 0;
        },
        render: function (gk) {
            var c = gk.ctx, x, y, v;
            c.fillStyle = '#0d1030'; c.fillRect(0, 0, 480, 270);
            c.fillStyle = '#05061a'; c.fillRect(BX - 3, BY - 3, COLS * CELL + 6, ROWS * CELL + 6);
            c.fillStyle = '#11153d';
            for (x = 1; x < COLS; x++) c.fillRect(BX + x * CELL, BY, 0.5, ROWS * CELL);
            var flash = state === 'clear' && (clearT >> 1) % 2;
            for (y = 0; y < ROWS; y++) {
                var clearing = state === 'clear' && clearRows.indexOf(y) >= 0;
                for (x = 0; x < COLS; x++) {
                    v = board[y * COLS + x];
                    if (v) block(c, BX + x * CELL, BY + y * CELL, clearing && flash ? '#fff' : COLORS[v]);
                }
            }
            if (piece && state === 'play') {
                var cs = cells(piece.type, piece.rot), gy = ghostY(), i;
                c.globalAlpha = 0.25;
                for (i = 0; i < 4; i++) if (gy + cs[i][1] >= 0) block(c, BX + (piece.x + cs[i][0]) * CELL, BY + (gy + cs[i][1]) * CELL, COLORS[piece.type]);
                c.globalAlpha = 1;
                for (i = 0; i < 4; i++) if (piece.y + cs[i][1] >= 0) block(c, BX + (piece.x + cs[i][0]) * CELL, BY + (piece.y + cs[i][1]) * CELL, COLORS[piece.type]);
            }
            // next piece preview
            var nx = BX + COLS * CELL + 24, ny = BY + 20;
            GK.text(c, t.s('next'), nx + 24, ny, 10, '#b9c0ff', 'center');
            c.fillStyle = '#05061a'; c.fillRect(nx - 4, ny + 10, 56, 40);
            if (nextType) {
                var ns = cells(nextType, 0);
                for (var k = 0; k < 4; k++) block(c, nx + 4 + ns[k][0] * 10, ny + 18 + ns[k][1] * 10, COLORS[nextType], 10);
            }
        },
        menuItems: function () { return [{ id: 'restart', label: t.s('restart') }]; },
        onMenu: function (gk, id) { if (id === 'restart') reset(); }
    };

    function block(c, x, y, col, size) {
        var s = size || CELL;
        c.fillStyle = col; c.fillRect(x, y, s - 1, s - 1);
        c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(x, y, s - 1, 2);
        c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(x, y + s - 3, s - 1, 2);
    }

    GK.create(def);
})();
