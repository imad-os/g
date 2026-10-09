/* Super Jumper actors: the hero "Pip", enemies, items, platforms and bosses.
 * All actors are plain objects created when a stage loads; nothing is allocated per frame. */
var Actors = (function () {
    'use strict';

    var T = 16, ID = Level.ID;
    // movement (per 60 Hz frame); tools/play-levels.mjs plays every stage with these, a little weaker
    var TUNE = { walk: 1.8, run: 2.6, acc: 0.24, dec: 0.3, turn: 0.45, airAcc: 0.16, airDec: 0.02, airTurn: 0.24, jump: 5.3 };

    /* ------------------------------------------------------------------ tile physics */

    function moveX(a, lv) {
        a.x += a.vx;
        a.hitWall = 0;
        var top = (a.y / T) | 0, bot = ((a.y + a.h - 1) / T) | 0, tx, ty;
        if (a.vx > 0) {
            tx = ((a.x + a.w - 1) / T) | 0;
            for (ty = top; ty <= bot; ty++) if (lv.solid(tx, ty)) { a.x = tx * T - a.w; a.hitWall = 1; break; }
        } else if (a.vx < 0) {
            tx = Math.floor(a.x / T);
            for (ty = top; ty <= bot; ty++) if (lv.solid(tx, ty)) { a.x = (tx + 1) * T; a.hitWall = -1; break; }
        }
    }

    // onHead(tx, ty) is called for the tile hit from below (player only)
    function moveY(a, lv, onHead) {
        var prevBottom = a.y + a.h;
        a.y += a.vy;
        a.onGround = false;
        var l = (a.x / T) | 0, r = ((a.x + a.w - 1) / T) | 0, tx, ty;
        if (a.vy > 0) {
            // Bottom edge minus a hair (not a whole pixel): sinking less than 1 px into the floor
            // must still count as landing, or a standing actor's onGround flickers every frame.
            ty = ((a.y + a.h - 0.001) / T) | 0;
            for (tx = l; tx <= r; tx++) {
                if (lv.solid(tx, ty) || (lv.oneway(tx, ty) && prevBottom <= ty * T + 0.5)) {
                    a.y = ty * T - a.h; a.vy = 0; a.onGround = true; return;
                }
            }
        } else if (a.vy < 0) {
            ty = Math.floor(a.y / T);
            var best = -1, bestD = 99, cx = a.x + a.w / 2;
            for (tx = l; tx <= r; tx++) {
                var id = lv.rawTile(tx, ty);
                var hidden = onHead && (id === ID.HCOIN || id === ID.H1UP) && prevBottom - a.h >= (ty + 1) * T - 1;
                if (lv.solid(tx, ty) || hidden) {
                    var d = Math.abs(tx * T + 8 - cx);
                    if (d < bestD) { bestD = d; best = tx; }
                }
            }
            if (best >= 0) {
                a.y = (ty + 1) * T; a.vy = 0;
                if (onHead) onHead(best, ty);
            }
        }
    }

    function overlap(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }

    /* ------------------------------------------------------------------ the hero */

    // slot 1 or 2 (2-player co-op); each player has its own input device, lives and score
    function Player(slot) {
        this.slot = slot || 1; this.dev = null; this.score = 0; this.lives = 5; this.out = false; this.respawnT = 0;
        this.inp = null;
        this.x = 0; this.y = 0; this.w = 12; this.h = 14; this.vx = 0; this.vy = 0;
        this.power = 0; this.face = 1; this.onGround = false; this.hitWall = 0;
        this.reset();
    }
    Player.prototype.reset = function () {
        this.vx = this.vy = 0; this.dead = false; this.deadT = 0; this.inv = 0; this.star = 0;
        this.coyote = 0; this.jumpBuf = 0; this.gp = 0; this.gpT = 0; this.crouch = false; this.skid = false;
        this.wallDir = 0; this.wallLock = 0; this.swim = false; this.ride = null; this.anim = null; this.animT = 0;
        this.walkT = 0; this.memVx = 0; this.memT = 0; this.growT = 0; this.prevPower = this.power; this.jumping = false;
        this.h = this.power ? 22 : 14;
    };
    Player.prototype.setPower = function (p) {
        var wasBig = this.power > 0;
        this.prevPower = this.power;
        this.power = p;
        var big = p > 0;
        if (big && !wasBig) { this.y -= 8; this.h = 22; }
        else if (!big && wasBig) { this.y += 8; this.h = 14; }
        this.growT = 30;
    };

    // returns sprite frame name
    Player.prototype.frame = function (frameN) {
        var size = this.power > 0 && !(this.growT > 0 && ((this.growT >> 2) & 1)) ? 'hb' : 'hs';
        if (this.growT > 0 && this.prevPower > 0 && this.power === 0) size = (this.growT >> 2) & 1 ? 'hb' : 'hs';
        var form = (this.power === 2 ? 'fire' : 'normal') + (this.slot === 2 ? '2' : '');
        if (this.star > 0 && ((frameN >> 2) & 1)) form = 'star';
        var pose;
        if (this.crouch || this.gp) pose = 'crouch';
        else if (!this.onGround) pose = 'jump';
        else if (this.skid) pose = 'skid';
        else if (Math.abs(this.vx) > 0.2) pose = ((this.walkT >> 3) & 1) ? 'walk1' : 'walk2';
        else pose = 'stand';
        return size + '_' + form + '_' + pose + (this.face > 0 ? '_r' : '_l');
    };

    // W = stage world (game.js), inp = { left, right, run, jump, jumpPressed, down, downPressed, firePressed }
    Player.prototype.update = function (W, inp) {
        var lv = W.lv;
        if (this.inv > 0) this.inv--;
        if (this.star > 0 && --this.star === 0) W.starEnded();
        if (this.growT > 0) { this.growT--; return; }   // short freeze while changing form
        if (this.wallLock > 0) this.wallLock--;

        // ride moving platforms
        if (this.ride) {
            if (this.ride.alive && this.x + this.w > this.ride.x && this.x < this.ride.x + this.ride.w) { this.x += this.ride.dx; this.y = this.ride.y - this.h; }
            this.ride = null;
        }

        var cx = this.x + this.w / 2;
        this.swim = lv.waterAt(cx, this.y + this.h / 2);
        var dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
        if (this.wallLock > 0) dir = 0;
        var slip = lv.slippery && this.onGround;

        // crouch (also makes the big hero small enough to slide under one-tile gaps)
        var wantCrouch = this.onGround && inp.down && !this.swim;
        if (wantCrouch !== this.crouch && this.power > 0) {
            if (wantCrouch) { this.y += 8; this.h = 14; this.crouch = true; }
            else if (!lv.solid((this.x / T) | 0, ((this.y - 8) / T) | 0) && !lv.solid(((this.x + this.w - 1) / T) | 0, ((this.y - 8) / T) | 0)) { this.y -= 8; this.h = 22; this.crouch = false; }
        } else this.crouch = wantCrouch;

        // horizontal: the hero answers at once (a few frames to full speed, stops and turns almost
        // on the spot) and keeps most of its speed in a jump. A TV remote cannot hold an arrow and OK
        // together: the speed of the last few frames before the arrow was let go is kept for a jump.
        var K = TUNE;
        var max = this.swim ? 1.3 : inp.run ? K.run : K.walk;
        var acc, dec, turn;
        if (this.swim) { acc = 0.08; dec = 0.05; turn = 0.12; }
        else if (this.onGround) { acc = K.acc; dec = K.dec; turn = K.turn; }
        else { acc = K.airAcc; dec = K.airDec; turn = K.airTurn; }
        if (slip) { acc *= 0.4; dec = 0.045; turn = 0.12; }
        this.skid = false;
        if (this.gp) dir = 0;
        if (this.memT > 0) this.memT--;
        if (dir && !this.crouch) {
            this.face = dir;
            this.memVx = this.vx; this.memT = 10;
            if (this.vx * dir < 0) {
                this.vx += dir * turn;
                if (this.vx * dir > 0) this.vx = dir * Math.min(this.vx * dir, acc);
                if (this.onGround && Math.abs(this.vx) > 1.4) { this.skid = true; if ((W.frame & 3) === 0) W.dust(this.x + this.w / 2, this.y + this.h); }
            } else if (this.vx * dir < max) {
                this.vx += dir * acc;
                if (this.vx * dir > max) this.vx = dir * max;
            } else this.vx -= dir * Math.min(dec, this.vx * dir - max);
        } else {
            if (this.vx > 0) this.vx = Math.max(0, this.vx - dec); else if (this.vx < 0) this.vx = Math.min(0, this.vx + dec);
        }

        // jump (coyote time + buffer, 6 frames each)
        if (inp.jumpPressed) this.jumpBuf = 6; else if (this.jumpBuf > 0) this.jumpBuf--;
        if (this.onGround) this.coyote = 6; else if (this.coyote > 0) this.coyote--;
        if (this.swim) {
            if (inp.jumpPressed) { this.vy = -2.4; W.sfx('jump', 0.6); this.jumpBuf = 0; }
        } else if (this.jumpBuf > 0 && this.coyote > 0 && !this.gp) {
            if (!dir && this.memT > 0 && Math.abs(this.memVx) > Math.abs(this.vx)) this.vx = this.memVx;   // remote: arrow, then OK
            this.vy = -(K.jump + Math.abs(this.vx) * 0.3);   // standing: 5 tiles high, running: 6+
            this.coyote = 0; this.jumpBuf = 0; this.jumping = true; this.onGround = false;
            if (this.crouch && this.power > 0) { this.y -= 8; this.h = 22; this.crouch = false; }
            W.sfx(this.power ? 'bigjump' : 'jump');
        } else if (this.jumpBuf > 0 && this.wallDir && !this.onGround && !this.gp) {
            this.vy = -5.0; this.vx = -this.wallDir * 2.3; this.face = -this.wallDir;
            this.wallLock = 10; this.jumpBuf = 0; this.wallDir = 0;
            W.sfx('jump', 1.2);
            W.dust(this.x + (this.face < 0 ? this.w : 0), this.y + this.h / 2);
        }

        // ground pound: only from a real jump or fall (never while standing or crouching)
        if (inp.downPressed && !this.onGround && this.coyote === 0 && !this.crouch && !this.swim && !this.gp) { this.gp = 1; this.gpT = 12; this.vx = 0; this.vy = 0; W.sfx('kick', 0.5); }

        // gravity
        if (this.gp === 1) { this.vy = 0; if (--this.gpT <= 0) { this.gp = 2; this.vy = 6; } }
        else if (this.swim) { this.vy = Math.min(1.4, this.vy + 0.07); }
        else {
            this.vy += (inp.jump && this.vy < 0 && this.jumping) ? 0.17 : 0.42;
            if (this.vy >= 0) this.jumping = false;
            var maxFall = this.gp ? 7 : 4.8;
            if (this.wallDir && this.vy > 1.3 && !this.gp) { maxFall = 1.3; if ((W.frame & 7) === 0) W.dust(this.x + (this.wallDir > 0 ? this.w : 0), this.y + this.h); }
            if (this.vy > maxFall) this.vy = maxFall;
        }

        var self = this, wasAir = !this.onGround, gpFall = this.gp === 2;
        moveX(this, lv);
        this.lastBottom = this.y + this.h;
        // area bounds (bonus room / boss arena)
        var area = W.area;
        if (this.x < area[0] + W.leftWall) { this.x = area[0] + W.leftWall; this.vx = 0; }
        if (this.x + this.w > area[1]) { this.x = area[1] - this.w; this.vx = 0; }
        // wall slide when pushing into a wall in the air
        this.wallDir = !this.onGround && this.hitWall && this.hitWall === dir && !this.swim ? dir : 0;
        if (!this.wallDir && !this.onGround && dir && !this.swim) {
            var probe = dir > 0 ? this.x + this.w : this.x - 1;
            if (lv.solid((probe / T) | 0, ((this.y + 2) / T) | 0) && lv.solid((probe / T) | 0, ((this.y + this.h - 2) / T) | 0)) this.wallDir = dir;
        }
        moveY(this, lv, function (tx, ty) { W.hitBlock(tx, ty, self.power > 0, false, self); if (self.jumping) self.jumping = false; });
        W.landOnPlatforms(this);
        if (this.onGround) { this.wallDir = 0; this.jumping = false; }
        if (this.onGround && wasAir && gpFall) {
            this.gp = 0;
            W.groundPound(this);
        } else if (this.onGround) this.gp = 0;
        if (this.onGround && wasAir && !gpFall && this.vy === 0) { /* landed */ }

        if (Math.abs(this.vx) > 0.2) this.walkT += Math.abs(this.vx) * 1.5;

        // hazards
        // spikes hurt only feet that go into their lower part (brushing a tip while jumping over is fine)
        var feet = this.y + this.h - 1;
        if ((feet & 15) >= 6 && (lv.spikeAt(this.x + 3, feet) || lv.spikeAt(this.x + this.w - 3, feet))) W.hurt(this);
        if (lv.lavaAt(this.x + this.w / 2, this.y + this.h - 4)) W.die(this);
        if (this.y > lv.pxH + 24) W.die(this);
        // tile coins
        var l = (this.x / T) | 0, r = ((this.x + this.w - 1) / T) | 0, t = (this.y / T) | 0, b = ((this.y + this.h - 1) / T) | 0;
        for (var ty = t; ty <= b; ty++) for (var tx = l; tx <= r; tx++) if (lv.rawTile(tx, ty) === ID.COIN) { lv.set(tx, ty, lv.waterAt(tx * T + 8, ty * T + 8) || W.water ? 12 : 0); W.collectCoin(tx * T + 8, ty * T + 8, false, this); }

        // fireballs
        if (inp.firePressed && this.power === 2 && !this.crouch) W.fire(this);
    };

    /* ------------------------------------------------------------------ entities */

    // Enemy kinds: walker, snail, shell, flyer, plant, spiky, thrower, crusher, boss
    var ENEMY = { walker: 1, snail: 1, shell: 1, flyer: 1, plant: 1, spiky: 1, thrower: 1, crusher: 1, boss: 1, rock: 1 };

    function Ent(type, x, y, w, h) {
        this.type = type; this.x = x; this.y = y; this.w = w; this.h = h;
        this.vx = 0; this.vy = 0; this.alive = true; this.active = false; this.state = 0; this.t = 0;
        this.face = -1; this.onGround = false; this.hitWall = 0; this.dying = 0; this.dx = 0; this.dy = 0;
        this.enemy = !!ENEMY[type];
    }

    function make(o, lv) {
        var t = o.type || o.class, e, p = function (n, d) { return lv.prop(o, n, d); };
        switch (t) {
            case 'walker': e = new Ent('walker', o.x + 2, o.y + 4, 12, 12); e.vx = -0.5; return e;
            case 'shell': e = new Ent('snail', o.x + 2, o.y + 2, 12, 14); e.vx = -0.45; return e;
            case 'flyer': e = new Ent('flyer', o.x + 2, o.y + 4, 12, 12); e.vx = -0.4; e.baseY = o.y; return e;
            case 'spiky': e = new Ent('spiky', o.x + 2, o.y + 4, 12, 12); e.vx = -0.4; return e;
            case 'thrower': e = new Ent('thrower', o.x + 2, o.y + 2, 12, 14); return e;
            case 'plant': e = new Ent('plant', o.x - 6, o.y - 14, 12, 22); e.top = o.y - 16; e.state = 0; e.t = 60; return e;
            case 'crusher': e = new Ent('crusher', o.x - 8, o.y, 32, 32); e.home = o.y; e.state = 0; e.plat = true; return e;
            case 'platform': e = new Ent('platform', o.x, o.y, 48, 8); e.plat = true; e.axis = p('axis', 'x'); e.range = p('range', 64); e.speed = p('speed', 0.8); e.ox = o.x; e.oy = o.y; return e;
            case 'fallplat': e = new Ent('fallplat', o.x, o.y, 48, 8); e.plat = true; e.ox = o.x; e.oy = o.y; return e;
            case 'spring': e = new Ent('spring', o.x, o.y, 16, 16); return e;
            case 'starcoin': e = new Ent('starcoin', o.x, o.y, 16, 16); return e;
            case 'checkpoint': e = new Ent('checkpoint', o.x, o.y - 16, 16, 32); e.assist = p('assist', false); return e;
            case 'goal': e = new Ent('goal', o.x, o.y, 16, o.height); e.secret = p('secret', false); e.ground = o.y + o.height; return e;
            case 'warp': e = new Ent('warp', o.x, o.y - 2, 32, 4); e.tx = p('tx', 0); e.ty = p('ty', 0); return e;
            case 'boss': e = new Ent('boss', o.x, o.y, 28, 28); e.variant = p('variant', 1); e.hp = 3; e.vx = -1; e.homeX = o.x; return e;
            case 'bossdoor': e = new Ent('bossdoor', o.x, o.y, 16, 32); return e;
        }
        return null;
    }

    // simple walking enemies share this
    function walk(e, lv) {
        e.vy = Math.min(4, e.vy + 0.3);
        moveX(e, lv);
        if (e.hitWall) { e.vx = -e.vx; }
        moveY(e, lv, null);
        e.face = e.vx > 0 ? 1 : -1;
    }

    var UPDATE = {
        walker: function (e, W) { walk(e, W.lv); },
        snail: function (e, W) { walk(e, W.lv); },
        spiky: function (e, W) { walk(e, W.lv); },
        shell: function (e, W) {
            if (e.kickT > 0) e.kickT--;
            e.vy = Math.min(4, e.vy + 0.3);
            moveX(e, W.lv);
            if (e.hitWall) {
                e.vx = -e.vx;
                W.sfx('bump');
                // a moving shell breaks / hits the block it runs into
                var tx = e.vx < 0 ? ((e.x + e.w) / T) | 0 : ((e.x - 1) / T) | 0, ty = ((e.y + e.h / 2) / T) | 0;
                W.hitBlock(tx, ty, true, true);
            }
            moveY(e, W.lv, null);
            if (e.vx) W.shellHits(e);
        },
        flyer: function (e, W) {
            if (W.water) {   // swims in a wave
                e.t++;
                e.x += e.vx;
                e.y = e.baseY + Math.sin(e.t * 0.04) * 24;
                if (W.lv.solid(((e.vx > 0 ? e.x + e.w : e.x) / T) | 0, ((e.y + 6) / T) | 0)) e.vx = -e.vx;
                e.face = e.vx > 0 ? 1 : -1;
                return;
            }
            e.vy = Math.min(4, e.vy + 0.18);
            moveX(e, W.lv);
            if (e.hitWall) e.vx = -e.vx;
            moveY(e, W.lv, null);
            if (e.onGround) { e.vy = -3.6; e.vx = (W.player.x < e.x ? -0.6 : 0.6); }
            e.face = e.vx > 0 ? 1 : -1;
        },
        plant: function (e, W) {
            // 0 hidden in the pipe, 1 rising, 2 out, 3 lowering (never rises when the hero is right next to it)
            var near = W.nearestDist(e.x) < 28, hide = e.top + 2, out = e.top - 22;
            e.t--;
            if (e.state === 0) { e.y = hide; if (e.t <= 0) { if (near) e.t = 20; else { e.state = 1; e.t = 24; } } }
            else if (e.state === 1) { e.y = out + (hide - out) * e.t / 24; if (e.t <= 0) { e.state = 2; e.t = 70; } }
            else if (e.state === 2) { e.y = out; if (e.t <= 0) { e.state = 3; e.t = 24; } }
            else { e.y = hide - (hide - out) * e.t / 24; if (e.t <= 0) { e.state = 0; e.t = 90; } }
        },
        thrower: function (e, W) {
            e.vy = Math.min(4, e.vy + 0.3);
            moveY(e, W.lv, null);
            e.face = W.player.x < e.x ? -1 : 1;
            if (++e.t >= 110) { e.t = 0; W.throwRock(e.x + 4, e.y - 4, e.face * 1.4, -3.6); }
        },
        rock: function (e, W) {
            e.vy += 0.15; e.x += e.vx; e.y += e.vy;
            if (W.lv.solid(((e.x + 4) / T) | 0, ((e.y + 6) / T) | 0) || e.y > W.lv.pxH) e.alive = false;
        },
        crusher: function (e, W) {
            var p = W.player, pr = e.x + e.w;
            e.dx = 0;
            var y0 = e.y;
            if (e.state === 0) { if (p.x + p.w > e.x - 16 && p.x < pr + 16 && p.y > e.y) { e.state = 1; e.vy = 0; } }
            else if (e.state === 1) {
                e.vy = Math.min(7, e.vy + 0.5);
                e.y += e.vy;
                var ty = ((e.y + e.h) / T) | 0;
                if (W.lv.solid(((e.x + 2) / T) | 0, ty) || W.lv.solid(((pr - 3) / T) | 0, ty) || e.y > W.lv.pxH) {
                    e.y = ty * T - e.h; e.state = 2; e.t = 50; W.shake(8); W.sfx('boss');
                }
            } else if (e.state === 2) { if (--e.t <= 0) e.state = 3; }
            else { e.y -= 0.8; if (e.y <= e.home) { e.y = e.home; e.state = 0; } }
            e.dy = e.y - y0;
        },
        platform: function (e, W) {
            var px = e.x, py = e.y;
            e.t += e.speed / Math.max(8, e.range) * 2;
            var o = Math.sin(e.t) * e.range / 2 + e.range / 2;
            if (e.axis === 'x') e.x = e.ox + o; else e.y = e.oy - o;
            e.dx = e.x - px; e.dy = e.y - py;
        },
        fallplat: function (e, W) {
            var py = e.y;
            e.dx = 0;
            if (e.state === 1 && --e.t <= 0) e.state = 2;
            if (e.state === 2) { e.vy = Math.min(4, e.vy + 0.15); e.y += e.vy; if (e.y > W.lv.pxH + 32) { e.alive = false; } }
            e.dy = e.y - py;
        },
        item: function (e, W) {
            if (e.rise > 0) { e.rise--; e.y -= 1; return; }
            if (e.kind === 'bloom') return;
            if (e.kind === 'gem') {
                e.vy = Math.min(4, e.vy + 0.25);
                moveX(e, W.lv); if (e.hitWall) e.vx = -e.vx;
                moveY(e, W.lv, null);
                if (e.onGround) e.vy = -4.2;
                return;
            }
            walk(e, W.lv);
            if (e.y > W.lv.pxH) e.alive = false;
        },
        boss: function (e, W) {
            if (!W.bossOn || e.dying) return;
            var p = W.player;
            e.t++;
            if (e.hurtT > 0) e.hurtT--;
            var speed = 0.9 + (3 - e.hp) * 0.45;
            if (e.variant === 3) {   // hovering owl: drifts, then swoops at the hero
                if (e.state === 0) {
                    e.x += (p.x > e.x ? 1 : -1) * speed * 0.8; e.y += (W.lv.pxH - 140 - e.y) * 0.05;
                    if (e.t % 150 === 0) { e.state = 1; e.vy = 3.5; }
                    if (e.t % 70 === 0) W.throwRock(e.x + 10, e.y + 28, 0, 1);
                } else {
                    e.y += e.vy; e.x += (p.x > e.x ? 1 : -1) * 0.6;
                    var ty = ((e.y + e.h) / T) | 0;
                    if (W.lv.solid(((e.x + 14) / T) | 0, ty)) { e.y = ty * T - e.h; e.state = 0; W.shake(6); W.sfx('boss'); }
                }
                e.face = p.x > e.x ? 1 : -1;
            } else {
                e.vx = (e.vx < 0 ? -1 : 1) * speed;
                e.vy = Math.min(5, e.vy + 0.3);
                moveX(e, W.lv); if (e.hitWall) e.vx = -e.vx;
                var was = e.onGround;
                moveY(e, W.lv, null);
                if (e.onGround && !was && e.t > 10) { W.shake(5); W.sfx('boss'); }
                if (e.onGround && e.t % (e.variant === 1 ? 110 : 160) === 0) { e.vy = -6.5; e.vx = (p.x > e.x ? 1 : -1) * speed; }
                if (e.variant === 2 && e.t % 90 === 0) W.throwRock(e.x + 10, e.y, (p.x > e.x ? 1 : -1) * 1.8, -4);
                e.face = e.vx > 0 ? 1 : -1;
            }
        }
    };

    return { TUNE: TUNE, Player: Player, Ent: Ent, make: make, UPDATE: UPDATE, overlap: overlap, moveX: moveX, moveY: moveY };
})();
