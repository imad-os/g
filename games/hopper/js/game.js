/* Sky Hopper: endless vertical bouncing game. Original implementation, art and music. */
(function () {
    'use strict';

    var FW = 240, FX = 120, H = 270;       // play field (portrait strip in the middle of the screen)
    var MAXP = 40;
    var GRAV = 0.2, BOUNCE = -6.2, SPRING = -10.5, MOVE_ACC = 0.35, MOVE_MAX = 3.2;

    var MUSIC = {
        bpm: 150,
        tracks: [
            { wave: 'square', vol: 0.1, notes: 'C5:2 E5:2 G5:2 E5:2 F5:2 A5:2 G5:4 E5:2 G5:2 C6:2 B5:2 A5:2 G5:2 E5:4 ' +
                                             'D5:2 F5:2 A5:2 F5:2 G5:2 B5:2 A5:4 G5:2 E5:2 C5:2 D5:2 E5:4 .:4' },
            { wave: 'triangle', vol: 0.22, notes: 'C3:4 G3:4 F3:4 G3:4 C3:4 G3:4 A3:4 E3:4 D3:4 A3:4 G3:4 D3:4 C3:4 G3:4 C3:4 .:4' },
            { drums: 'k:2 h:2 s:2 h:2', vol: 0.7 }
        ]
    };

    var t, hud, rnd, state, best;
    // platforms: struct-of-arrays pool, no allocation while playing
    var px = new Float32Array(MAXP), py = new Float32Array(MAXP), pw = new Float32Array(MAXP);
    var pkind = new Uint8Array(MAXP), pvx = new Float32Array(MAXP), palive = new Uint8Array(MAXP), pspring = new Uint8Array(MAXP);
    var pl = { x: 0, y: 0, vx: 0, vy: 0, face: 1, squash: 0 };
    var camY, topY, height, enemy = { on: false, x: 0, y: 0, t: 0 }, parts, stars = [];

    // kinds: 0 normal, 1 moving, 2 breaking, 3 vanishing (one bounce)
    function placePlatform(i, y) {
        var diff = Math.min(1, height / 6000);
        var r = rnd();
        pkind[i] = r < 0.12 + diff * 0.25 ? 1 : r < 0.2 + diff * 0.3 ? 2 : r < 0.24 + diff * 0.3 ? 3 : 0;
        pw[i] = 40 - diff * 10;
        px[i] = rnd() * (FW - pw[i]);
        py[i] = y;
        pvx[i] = pkind[i] === 1 ? (rnd() < 0.5 ? -1 : 1) * (0.6 + diff * 1.2) : 0;
        palive[i] = 1;
        pspring[i] = pkind[i] === 0 && rnd() < 0.08 ? 1 : 0;
    }

    function reset() {
        rnd = GK.rng(Date.now());
        height = 0; camY = 0;
        pl.x = FW / 2 - 8; pl.y = H - 40; pl.vx = 0; pl.vy = BOUNCE;
        var y = H - 20;
        for (var i = 0; i < MAXP; i++) {
            placePlatform(i, y);
            if (i === 0) { pkind[0] = 0; px[0] = FW / 2 - 20; pw[0] = 40; pspring[0] = 0; pvx[0] = 0; }
            y -= 26 + rnd() * 18;
        }
        topY = y;
        enemy.on = false;
        state = 'play';
        GK.banner('');
        t.gk.audio.music(MUSIC);
        t.gk.perfGrace(60);
    }

    function gameOver() {
        state = 'over';
        var score = Math.floor(height / 10), nb = score > best;
        if (nb) { best = score; t.gk.save('best', best); }
        t.gk.audio.music(null);
        t.gk.audio.sfx('lose');
        GK.banner(t.s('gameOver'), (nb ? t.s('newBest') + ' ' : '') + t.s('pressOk'));
        t.gk.announce(t.s('gameOver') + '. ' + t.s('score') + ' ' + score + '. ' + t.s('pressOk'));
    }

    var def = {
        minScale: 2,
        start: function (gk) {
            t = { gk: gk, s: GK.tr(MINI_STRINGS, gk.lang) };
            best = gk.load('best', 0);
            parts = new GK.Particles(gk.q.particles);
            hud = GK.hud([['score', t.s('score')], ['best', t.s('best')]]);
            var r = GK.rng(42);
            for (var i = 0; i < 40; i++) stars.push([r() * 480, r() * 270, r() < 0.2 ? 2 : 1]);
            rnd = GK.rng(1);
            height = 0; camY = 0;
            state = 'ready';
            GK.banner('Sky Hopper', t.s('start'));
            gk.announce('Sky Hopper. ' + t.s('start'));
        },
        update: function (gk) {
            var score = Math.floor(height / 10);
            gk.setText(hud.score, score); gk.setText(hud.best, Math.max(best, score));
            parts.update();
            if (state !== 'play') {
                if (gk.pressed('confirm') || gk.pressed('jump')) reset();
                return;
            }
            var l = gk.isDown('left'), r = gk.isDown('right');
            if (l) { pl.vx -= MOVE_ACC; pl.face = -1; }
            else if (r) { pl.vx += MOVE_ACC; pl.face = 1; }
            else pl.vx *= 0.88;
            pl.vx = GK.clamp(pl.vx, -MOVE_MAX, MOVE_MAX);
            pl.x += pl.vx;
            if (pl.x < -8) pl.x += FW; else if (pl.x > FW - 8) pl.x -= FW;   // wrap around
            pl.vy += GRAV;
            var prevBottom = pl.y + 16;
            pl.y += pl.vy;
            if (pl.squash > 0) pl.squash--;

            for (var i = 0; i < MAXP; i++) {
                if (!palive[i]) continue;
                if (pkind[i] === 1) { px[i] += pvx[i]; if (px[i] < 0 || px[i] > FW - pw[i]) pvx[i] = -pvx[i]; }
                if (pl.vy > 0 && prevBottom <= py[i] && pl.y + 16 >= py[i] && pl.x + 13 > px[i] && pl.x + 3 < px[i] + pw[i]) {
                    if (pkind[i] === 2) {   // breaking: no bounce
                        palive[i] = 0;
                        gk.audio.sfx('brk');
                        for (var k = 0; k < 8; k++) parts.add(px[i] + k * 5, py[i], (k - 4) * 0.3, -1 + rnd(), 40, '#a0522d', 3);
                        continue;
                    }
                    pl.y = py[i] - 16;
                    var spring = pspring[i] && pl.x + 8 > px[i] + pw[i] / 2 - 8 && pl.x + 8 < px[i] + pw[i] / 2 + 8;
                    pl.vy = spring ? SPRING : BOUNCE;
                    pl.squash = 6;
                    gk.audio.sfx(spring ? 'spring' : 'bounce');
                    if (pkind[i] === 3) palive[i] = 0;
                    for (var d = 0; d < 4; d++) parts.add(pl.x + 8, pl.y + 16, (d - 1.5) * 0.6, -0.5, 18, '#ffffff', 2, 0.05);
                }
            }
            // camera only goes up
            var target = pl.y - 110;
            if (target < camY) { height += camY - target; camY = target; }
            // recycle platforms that fell below the screen
            for (var j = 0; j < MAXP; j++) {
                if (py[j] - camY > H + 10 || (!palive[j] && py[j] - camY > 0)) {
                    if (py[j] - camY > H + 10 || !palive[j]) {
                        if (py[j] - camY > H + 10) { topY -= 24 + rnd() * (16 + Math.min(30, height / 300)); placePlatform(j, topY); }
                    }
                }
            }
            // flying enemy appears after a while
            if (!enemy.on && height > 1500 && rnd() < 0.004) { enemy.on = true; enemy.x = rnd() * (FW - 20); enemy.y = camY - 30; enemy.t = 0; }
            if (enemy.on) {
                enemy.t++;
                enemy.x += Math.sin(enemy.t * 0.05) * 1.2;
                if (enemy.y - camY > H + 20) enemy.on = false;
                var dx = pl.x + 8 - (enemy.x + 10), dy = pl.y + 8 - (enemy.y + 8);
                if (dx * dx + dy * dy < 160) {
                    if (pl.vy > 0 && pl.y + 10 < enemy.y + 6) {   // stomp
                        enemy.on = false; pl.vy = BOUNCE; gk.audio.sfx('stomp');
                        for (var e = 0; e < 10; e++) parts.add(enemy.x + 10, enemy.y + 8, (rnd() - 0.5) * 3, -rnd() * 2, 30, '#ff5d73', 3);
                    } else { pl.vy = 2; gameOver(); }
                }
            }
            if (pl.y - camY > H + 20) gameOver();
        },
        render: function (gk, a) {
            var c = gk.ctx, i;
            c.fillStyle = '#0d1030'; c.fillRect(0, 0, 480, 270);
            // sky strip with slow parallax stars
            var grad = Math.min(1, height / 20000);
            c.fillStyle = grad < 0.5 ? '#6ec6ff' : '#3a56b0';
            c.fillStyle = 'rgb(' + ((110 - grad * 90) | 0) + ',' + ((198 - grad * 160) | 0) + ',' + ((255 - grad * 150) | 0) + ')';
            c.fillRect(FX, 0, FW, H);
            c.fillStyle = 'rgba(255,255,255,' + (0.3 + grad * 0.7).toFixed(2) + ')';
            for (i = 0; i < stars.length; i++) {
                var sx = stars[i][0], sy = (stars[i][1] - camY * 0.1) % 270;
                if (sy < 0) sy += 270;
                if (sx >= FX && sx < FX + FW) c.fillRect(sx, sy, stars[i][2], stars[i][2]);
            }
            c.save();
            c.beginPath(); c.rect(FX, 0, FW, H); c.clip();
            c.translate(FX, -camY);
            for (i = 0; i < MAXP; i++) {
                if (!palive[i]) continue;
                var y = py[i];
                if (y - camY < -10 || y - camY > H + 10) continue;
                c.fillStyle = pkind[i] === 1 ? '#4c7cf2' : pkind[i] === 2 ? '#a0522d' : pkind[i] === 3 ? '#eeeeee' : '#4cd97b';
                c.fillRect(px[i], y, pw[i], 6);
                c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(px[i], y + 4, pw[i], 2);
                if (pkind[i] === 2) { c.fillStyle = '#5a2d10'; c.fillRect(px[i] + pw[i] / 2 - 1, y, 2, 6); }
                if (pspring[i]) { c.fillStyle = '#ccc'; c.fillRect(px[i] + pw[i] / 2 - 5, y - 5, 10, 5); c.fillStyle = '#f25c5c'; c.fillRect(px[i] + pw[i] / 2 - 6, y - 6, 12, 2); }
            }
            if (enemy.on) {
                c.fillStyle = '#ff5d73'; c.fillRect(enemy.x + 2, enemy.y + 2, 16, 12);
                c.fillStyle = '#fff'; c.fillRect(enemy.x + 5, enemy.y + 5, 3, 3); c.fillRect(enemy.x + 12, enemy.y + 5, 3, 3);
                var wing = (gk.frame >> 3) & 1;
                c.fillStyle = '#ffd1d8'; c.fillRect(enemy.x - 3, enemy.y + (wing ? 0 : 5), 5, 4); c.fillRect(enemy.x + 18, enemy.y + (wing ? 0 : 5), 5, 4);
            }
            if (state === 'play' || state === 'over') drawHero(c, pl.x, pl.y + pl.vy * a, pl.face, pl.squash);
            parts.draw(c, 0, 0);
            c.restore();
            // side panels
            c.fillStyle = '#1c2150'; c.fillRect(FX - 4, 0, 4, H); c.fillRect(FX + FW, 0, 4, H);
        },
        menuItems: function () { return [{ id: 'restart', label: t.s('restart') }]; },
        onMenu: function (gk, id) { if (id === 'restart') reset(); }
    };

    function drawHero(c, x, y, face, squash) {
        var sq = squash > 0 ? 2 : 0;
        x = x | 0; y = y | 0;
        c.fillStyle = '#ffb347'; c.fillRect(x + 2, y + 2 + sq, 12, 12 - sq);        // body
        c.fillStyle = '#ff7f50'; c.fillRect(x + 2, y + 12, 12, 2);
        c.fillStyle = '#fff'; c.fillRect(x + (face > 0 ? 8 : 3), y + 5 + sq, 4, 4);  // eye
        c.fillStyle = '#222'; c.fillRect(x + (face > 0 ? 10 : 3), y + 6 + sq, 2, 2);
        c.fillStyle = '#7a4a1c'; c.fillRect(x + 3, y + 14, 4, 2); c.fillRect(x + 9, y + 14, 4, 2);  // feet
        c.fillStyle = '#4cd97b'; c.fillRect(x + 6, y, 4, 3);                           // leaf on top
    }

    GK.create(def);
})();
