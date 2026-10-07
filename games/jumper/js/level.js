/* Super Jumper level: tile data, collision queries and cached rendering.
 * Static tiles (ground, pipes, hard blocks...) are pre-rendered into 128px-wide column chunks,
 * built lazily when they scroll into view and capped by an LRU (constant memory on any TV).
 * Animated or changing tiles (blocks, coins, water, lava) are drawn each frame on top. */
var Level = (function () {
    'use strict';

    var T = 16, CHUNK_COLS = 8, MAX_CHUNKS = 8;
    // tile ids (see tools/gen-levels.mjs)
    var GROUND = 1, BRICK = 2, QCOIN = 3, USED = 4, HARD = 5, ONEWAY = 6, SPIKE = 7,
        WATER = 12, LAVA = 13, HCOIN = 14, QPOW = 15, QSTAR = 16, MULTI = 17, COIN = 18, H1UP = 19, WATERTOP = 20, LAVATOP = 21;
    var SOLID = [], STATIC = [], DYN = [];
    (function () {
        var s = [1, 2, 3, 4, 5, 8, 9, 10, 11, 15, 16, 17], st = [1, 4, 5, 6, 7, 8, 9, 10, 11], d = [2, 3, 12, 13, 15, 16, 17, 18, 20, 21];
        for (var i = 0; i < 32; i++) { SOLID[i] = s.indexOf(i) >= 0; STATIC[i] = st.indexOf(i) >= 0; DYN[i] = d.indexOf(i) >= 0; }
    })();
    var STATIC_FRAME = { 4: 'used', 5: 'hard', 6: 'oneway', 7: 'spike', 8: 'pipeTL', 9: 'pipeTR', 10: 'pipeL', 11: 'pipeR' };

    function prop(o, name, def) {
        var p = o.properties || [];
        for (var i = 0; i < p.length; i++) if (p[i].name === name) return p[i].value;
        return def;
    }

    function Level(json, tiles, bg) {
        var layer = null, ents = null, i;
        for (i = 0; i < json.layers.length; i++) {
            if (json.layers[i].name === 'tiles') layer = json.layers[i];
            if (json.layers[i].name === 'entities') ents = json.layers[i];
        }
        this.W = json.width; this.H = json.height;
        this.pxW = this.W * T; this.pxH = this.H * T;
        this.data = new Uint8Array(layer.data);
        this.objects = ents ? ents.objects : [];
        this.props = {};
        var ps = json.properties || [];
        for (i = 0; i < ps.length; i++) this.props[ps[i].name] = ps[i].value;
        this.areas = JSON.parse(this.props.areas || '[[0,' + this.pxW + ']]');
        this.tiles = tiles;           // { atlas, theme }
        this.bg = bg;
        this.slippery = !!tiles.theme.slippery;
        this.chunks = {}; this.lru = [];
        this.bumps = [];              // { tx, ty, t }
    }

    Level.prototype.prop = prop;

    // The stages were built with one power-up block each, which players rarely found. Like the
    // classic first stage, the first "?" block of a stage and every third one after it hold a
    // power-up (grow berry, or the fire bloom when the hero is already big) instead of a coin.
    Level.prototype.addPowerUps = function () {
        var n = 0;
        for (var tx = 0; tx < this.W; tx++) for (var ty = 0; ty < this.H; ty++) {
            var i = ty * this.W + tx;
            if (this.data[i] !== QCOIN) continue;
            if (n % 3 === 0) this.data[i] = QPOW;
            n++;
        }
    };

    Level.prototype.tile = function (tx, ty) {
        if (tx < 0 || tx >= this.W || ty >= this.H) return HARD;   // walls left/right and floor of the map edges
        if (ty < 0) return 0;
        return this.data[ty * this.W + tx];
    };
    Level.prototype.rawTile = function (tx, ty) {
        if (tx < 0 || tx >= this.W || ty < 0 || ty >= this.H) return 0;
        return this.data[ty * this.W + tx];
    };
    Level.prototype.solid = function (tx, ty) {
        if (ty >= this.H) return false;                 // pits are open at the bottom
        return SOLID[this.tile(tx, ty)];
    };
    Level.prototype.oneway = function (tx, ty) { return this.rawTile(tx, ty) === ONEWAY; };
    Level.prototype.waterAt = function (px, py) { var t = this.rawTile((px / T) | 0, (py / T) | 0); return t === WATER || t === WATERTOP; };
    Level.prototype.lavaAt = function (px, py) { var t = this.rawTile((px / T) | 0, (py / T) | 0); return t === LAVA || t === LAVATOP; };
    Level.prototype.spikeAt = function (px, py) { return this.rawTile((px / T) | 0, (py / T) | 0) === SPIKE; };

    Level.prototype.set = function (tx, ty, id) {
        if (tx < 0 || tx >= this.W || ty < 0 || ty >= this.H) return;
        var old = this.data[ty * this.W + tx];
        this.data[ty * this.W + tx] = id;
        if (STATIC[old] || STATIC[id]) this.redrawTile(tx, ty);
    };

    Level.prototype.areaAt = function (px) {
        for (var i = 0; i < this.areas.length; i++) if (px >= this.areas[i][0] && px < this.areas[i][1]) return this.areas[i];
        return this.areas[0];
    };

    /* ---------- static chunk cache ---------- */
    Level.prototype.drawStatic = function (c, tx, ty, ox, oy) {
        var id = this.data[ty * this.W + tx], A = this.tiles.atlas, f;
        if (!STATIC[id]) return;
        if (id === GROUND) f = A.f[ty > 0 && this.data[(ty - 1) * this.W + tx] !== GROUND ? 'groundTop' : 'ground'];
        else f = A.f[STATIC_FRAME[id]];
        c.drawImage(A.c, f.x, f.y, T, T, ox, oy, T, T);
    };

    Level.prototype.chunk = function (ci) {
        var ch = this.chunks[ci];
        if (ch) {
            var k = this.lru.indexOf(ci);
            if (k > 0) { this.lru.splice(k, 1); this.lru.unshift(ci); }
            return ch;
        }
        if (this.lru.length >= MAX_CHUNKS) {
            var old = this.lru.pop(), oc = this.chunks[old];
            delete this.chunks[old];
            ch = oc;                                  // reuse the canvas (no new allocation)
            ch.getContext('2d').clearRect(0, 0, ch.width, ch.height);
        } else {
            ch = document.createElement('canvas');
            ch.width = CHUNK_COLS * T; ch.height = this.pxH;
        }
        var c = ch.getContext('2d'), x0 = ci * CHUNK_COLS;
        for (var tx = x0; tx < x0 + CHUNK_COLS && tx < this.W; tx++)
            for (var ty = 0; ty < this.H; ty++) this.drawStatic(c, tx, ty, (tx - x0) * T, ty * T);
        this.chunks[ci] = ch;
        this.lru.unshift(ci);
        return ch;
    };

    Level.prototype.redrawTile = function (tx, ty) {
        var ci = Math.floor(tx / CHUNK_COLS), ch = this.chunks[ci];
        if (!ch) return;
        var c = ch.getContext('2d'), ox = (tx - ci * CHUNK_COLS) * T;
        c.clearRect(ox, ty * T, T, T);
        this.drawStatic(c, tx, ty, ox, ty * T);
        if (ty + 1 < this.H) { c.clearRect(ox, (ty + 1) * T, T, T); this.drawStatic(c, tx, ty + 1, ox, (ty + 1) * T); }   // ground top variant
    };

    Level.prototype.bump = function (tx, ty) { this.bumps.push({ tx: tx, ty: ty, t: 10 }); };
    Level.prototype.update = function () {
        for (var i = this.bumps.length - 1; i >= 0; i--) if (--this.bumps[i].t <= 0) this.bumps.splice(i, 1);
    };
    Level.prototype.bumpOffset = function (tx, ty) {
        for (var i = 0; i < this.bumps.length; i++) { var b = this.bumps[i]; if (b.tx === tx && b.ty === ty) return -Math.sin(b.t / 10 * Math.PI) * 5; }
        return 0;
    };

    /* ---------- rendering ---------- */
    Level.prototype.drawBackground = function (c, camX, camY, q, frame) {
        var bg = this.bg, i;
        if (!bg.grad || q.tier === 'low') {
            c.fillStyle = bg.sky[0];
            if (q.tier !== 'low') { bg.grad = c.createLinearGradient(0, 0, 0, 270); bg.grad.addColorStop(0, bg.sky[0]); bg.grad.addColorStop(1, bg.sky[1]); }
        }
        c.fillStyle = q.tier === 'low' ? bg.sky[0] : bg.grad;
        c.fillRect(0, 0, 480, 270);
        var yOff = Math.max(0, (this.pxH - 270 - camY) * 0.3);
        if (bg.clouds && q.clouds) {
            var cx = -((camX * 0.08 + frame * 0.1) % 512);
            c.drawImage(bg.clouds, cx, 10 + yOff * 0.5); c.drawImage(bg.clouds, cx + 512, 10 + yOff * 0.5);
        }
        var n = Math.min(bg.layers.length, q.parallax);
        for (i = bg.layers.length - n; i < bg.layers.length; i++) {
            var L = bg.layers[i], ox = -((camX * L.speed) % 512) | 0;
            c.drawImage(L.canvas, ox, yOff | 0); c.drawImage(L.canvas, ox + 512, yOff | 0);
        }
    };

    Level.prototype.drawTiles = function (c, camX, camY) {
        var c0 = Math.floor(camX / (CHUNK_COLS * T)), c1 = Math.floor((camX + 480) / (CHUNK_COLS * T));
        for (var ci = c0; ci <= c1; ci++) {
            if (ci < 0 || ci * CHUNK_COLS >= this.W) continue;
            var ch = this.chunk(ci), sx = ci * CHUNK_COLS * T - camX;
            var sy = Math.max(0, camY | 0), h = Math.min(270, this.pxH - sy);
            c.drawImage(ch, 0, sy, ch.width, h, sx, sy - camY, ch.width, h);
        }
    };

    // Dynamic tiles. layer 0: blocks/coins/lava (behind sprites), layer 1: water (in front).
    Level.prototype.drawDynamic = function (c, camX, camY, frame, layer, sprites) {
        var A = this.tiles.atlas, x0 = Math.max(0, (camX / T) | 0), x1 = Math.min(this.W - 1, ((camX + 480) / T) | 0);
        var y0 = Math.max(0, (camY / T) | 0), y1 = Math.min(this.H - 1, ((camY + 270) / T) | 0);
        var qf = A.f['qblock' + ((frame >> 3) & 3)], w2 = (frame >> 4) & 1, cf = sprites.f['coin' + [0, 1, 2, 1][(frame >> 3) & 3]];
        for (var ty = y0; ty <= y1; ty++) {
            var row = ty * this.W;
            for (var tx = x0; tx <= x1; tx++) {
                var id = this.data[row + tx];
                if (!DYN[id]) continue;
                var px = tx * T - camX, py = ty * T - camY, f = null;
                if (layer === 0) {
                    if (id === QCOIN || id === QPOW || id === QSTAR) f = qf;
                    else if (id === BRICK || id === MULTI) f = A.f.brick;
                    else if (id === COIN) { c.drawImage(sprites.c, cf.x, cf.y, cf.w, cf.h, px + (16 - cf.w) / 2, py + 2, cf.w, cf.h); continue; }
                    else if (id === LAVA) f = A.f['lava' + w2];
                    else if (id === LAVATOP) f = A.f['lavaTop' + w2];
                    if (f) {
                        if (id !== LAVA && id !== LAVATOP && this.bumps.length) py += this.bumpOffset(tx, ty);
                        c.drawImage(A.c, f.x, f.y, T, T, px, py, T, T);
                    }
                } else if (id === WATER || id === WATERTOP) {
                    f = A.f[(id === WATER ? 'water' : 'waterTop') + w2];
                    c.drawImage(A.c, f.x, f.y, T, T, px, py, T, T);
                }
            }
        }
    };

    Level.prototype.free = function () {
        for (var k in this.chunks) { this.chunks[k].width = this.chunks[k].height = 0; }
        this.chunks = {}; this.lru = [];
        if (this.tiles) this.tiles.atlas.free();
        if (this.bg) {
            for (var i = 0; i < this.bg.layers.length; i++) this.bg.layers[i].canvas.width = 0;
            if (this.bg.clouds) this.bg.clouds.width = 0;
        }
        this.data = null; this.objects = null; this.tiles = null; this.bg = null;
    };

    Level.T = T;
    Level.ID = { GROUND: GROUND, BRICK: BRICK, QCOIN: QCOIN, USED: USED, HARD: HARD, ONEWAY: ONEWAY, SPIKE: SPIKE, WATER: WATER,
                 LAVA: LAVA, HCOIN: HCOIN, QPOW: QPOW, QSTAR: QSTAR, MULTI: MULTI, COIN: COIN, H1UP: H1UP };
    Level.SOLID = SOLID;
    return Level;
})();
