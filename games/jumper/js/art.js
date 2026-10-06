/* Super Jumper art: every sprite and tile is original pixel art drawn at load time into small
 * atlas canvases (no image files to download or decode). Sprites are pre-flipped so the game only
 * calls drawImage. The tile atlas is rebuilt per stage theme and the previous one is released. */
var Art = (function () {
    'use strict';

    /* ---------- tiny atlas with a shelf packer ---------- */
    function Atlas(w, h) {
        this.c = document.createElement('canvas');
        this.c.width = w; this.c.height = h;
        this.x = this.c.getContext('2d');
        this.f = {};
        this.px = 0; this.py = 0; this.rowH = 0; this.w = w;
    }
    Atlas.prototype.add = function (name, w, h, draw) {
        if (this.px + w > this.w) { this.px = 0; this.py += this.rowH + 1; this.rowH = 0; }
        var fr = { x: this.px, y: this.py, w: w, h: h };
        this.x.save(); this.x.translate(fr.x, fr.y); draw(this.x, w, h); this.x.restore();
        this.f[name] = fr;
        this.px += w + 1;
        if (h > this.rowH) this.rowH = h;
        return fr;
    };
    // name_r (as drawn) and name_l (mirrored)
    Atlas.prototype.add2 = function (name, w, h, draw) {
        this.add(name + '_r', w, h, draw);
        this.add(name + '_l', w, h, function (c) { c.translate(w, 0); c.scale(-1, 1); draw(c, w, h); });
    };
    Atlas.prototype.free = function () { this.c.width = this.c.height = 0; this.c = this.x = null; };

    // Draws rows of palette characters ('.' = transparent), one fillRect per horizontal run.
    function pix(c, rows, pal, ox, oy) {
        ox = ox || 0; oy = oy || 0;
        for (var y = 0; y < rows.length; y++) {
            var r = rows[y], x = 0;
            while (x < r.length) {
                var ch = r.charAt(x), s = x;
                while (x < r.length && r.charAt(x) === ch) x++;
                if (ch !== '.' && pal[ch]) { c.fillStyle = pal[ch]; c.fillRect(ox + s, oy + y, x - s, 1); }
            }
        }
    }

    /* ---------- hero "Pip" ---------- */
    var HEAD = [
        '.....kkkkkk.....',
        '....kcccccck....',
        '...kccccwccck...',
        '...kkkkkkkkkkkk.',
        '....ksssswesk...',
        '....ksssswesk...',
        '.....ksssssk....',
        '......kkkkk.....'];
    var TORSO = ['.....koooook....', '....koooyoook...', '....ksoooooks...', '....kkooooook...', '.....kooooook...'];
    var TORSO_BIG = ['.....koooook....', '....koooyoook...', '...kooooooooook.', '...ksoooooooosk.', '...ksoooooooosk.',
                     '....kooooooook..', '....kyyyyyyyyk..', '....koooooook...', '....koook.kook..', '....koook.kook..'];
    var LEGS = {
        stand: ['.....kbk.kbk....', '....kbbk.kbbk...', '....kkk...kkk...'],
        walk1: ['....kbk....kbk..', '...kbbk....kbbk.', '...kkk......kkk.'],
        walk2: ['......kbkbk.....', '......kbbbk.....', '......kkkkk.....'],
        jump:  ['....kbbk.kbk....', '....kkk..kbbk...', '..........kkk...'],
        skid:  ['...kbk...kbk....', '..kbbk...kbbk...', '..kkk....kkk....']
    };
    var HERO_PAL = {
        normal: { k: '#1a1423', c: '#20b2a0', w: '#ffffff', s: '#ffd0a8', e: '#1a1423', o: '#f28c28', y: '#ffd23f', b: '#6b3a1f' },
        fire:   { k: '#1a1423', c: '#ffffff', w: '#ff5d3a', s: '#ffd0a8', e: '#1a1423', o: '#e8402a', y: '#ffffff', b: '#6b3a1f' },
        star:   { k: '#ffffff', c: '#ffd23f', w: '#ffffff', s: '#fff2c0', e: '#1a1423', o: '#ff79c6', y: '#ffffff', b: '#ffd23f' }
    };

    function heroRows(big, legs) {
        if (!big) return HEAD.concat(TORSO, LEGS[legs]);
        var l = LEGS[legs], ll = [];
        for (var i = 0; i < l.length; i++) { ll.push(l[i]); ll.push(l[i]); }
        return HEAD.concat(TORSO_BIG, ll);
    }
    function crouchRows(big) {
        var rows = HEAD.concat(['....kooooook....', '...kooooooook...', '...kbbk..kbbk...', '...kkkk..kkkk...']);
        return big ? ['', '', ''].concat(rows) : rows;
    }

    /* ---------- enemies & items ---------- */
    var S = {
        blorp1: ['................', '................', '.....kkkkkk.....', '...kkppppppkk...', '..kppppppppppk..', '..kppwwppwwppk..',
                 '.kpppwkppwkpppk.', '.kpppwkppwkpppk.', '.kppppppppppppk.', '.kpppkkkkkkpppk.', '..kppppppppppk..', '...kkkkkkkkkk...',
                 '...kffk..kffk...', '..kfffk..kfffk..', '..kkkk....kkkk..', '................'],
        blorp2: ['................', '................', '................', '.....kkkkkk.....', '...kkppppppkk...', '..kppppppppppk..',
                 '..kppwwppwwppk..', '.kpppwkppwkpppk.', '.kpppwkppwkpppk.', '.kppppppppppppk.', '.kpppkkkkkkpppk.', '..kppppppppppk..',
                 '...kkkkkkkkkk...', '....kffkkffk....', '...kfffkkfffk...', '...kkkk..kkkk...'],
        flat:   ['................', '................', '................', '................', '................', '................',
                 '................', '................', '................', '................', '................', '..kkkkkkkkkkkk..',
                 '.kppwwppppwwppk.', '.kppkkppppkkppk.', '.kppppppppppppk.', '..kkkkkkkkkkkk..'],
        snail1: ['................', '......kkkkk.....', '.....kyyyyyk....', '....kyyrrryyk...', '...kyyrkkkryyk..', '...kyrkyyykryk..',
                 '...kyrkyrkkryk..', '...kyyrkkkryyk..', 'kk..kyyyrrryyk..', 'kgk..kyyyyyyk...', 'kwgkkkkkkkkkkk..', 'kegggggggggggk..',
                 '.kgggggggggggk..', '..kgggggggggggk.', '...kkkkkkkkkkkk.', '................'],
        snail2: ['................', '................', '......kkkkk.....', '.....kyyyyyk....', '....kyyrrryyk...', '...kyyrkkkryyk..',
                 '...kyrkyyykryk..', '...kyrkyrkkryk..', 'kk.kyyrkkkryyk..', 'kgk.kyyyrrryyk..', 'kwgkkkkkkkkkkkk.', 'kegggggggggggggk',
                 '.kgggggggggggggk', '..kgggggggggggk.', '...kkkkkkkkkkk..', '................'],
        shell:  ['................', '................', '................', '................', '.....kkkkkk.....', '...kkyyyyyykk...',
                 '..kyyrrrrrryyk..', '.kyyrkkkkkkryyk.', '.kyrkyyyyyykryk.', '.kyrkyrrrrkkryk.', '.kyrkkkkkkkkryk.', '.kyyrrrrrrrryyk.',
                 '..kyyyyyyyyyyk..', '...kkkkkkkkkk...', '................', '................'],
        wing1:  ['..kkk...', '.kwwwk..', 'kwwwwwk.', 'kwwwwk..', '.kkkk...'],
        wing2:  ['........', '........', 'kkkkk...', 'kwwwwwk.', '.kkkkk..'],
        spiky1: ['................', '..k..k..k..k....', '.krk.krk.krk.k..', '.krrkrrrkrrrkrk.', 'krrrrrrrrrrrrrk.', 'krrrrrrrrrrrwwrk',
                 'krrrrrrrrrrrwkrk', 'krrrrrrrrrrrrrrk', '.kttttttttrrrrk.', '.kttttttttttttk.', '..kttttttttttk..', '...kkkkkkkkkk...',
                 '...kbbk..kbbk...', '..kbbbk..kbbbk..', '..kkkk....kkkk..', '................'],
        spiky2: ['................', '................', '..k..k..k..k....', '.krk.krk.krk.k..', '.krrkrrrkrrrkrk.', 'krrrrrrrrrrrrrk.',
                 'krrrrrrrrrrrwwrk', 'krrrrrrrrrrrwkrk', 'krrrrrrrrrrrrrrk', '.kttttttttrrrrk.', '.kttttttttttttk.', '..kttttttttttk..',
                 '...kkkkkkkkkk...', '....kbbkkbbk....', '...kbbbkkbbbk...', '...kkkk..kkkk...'],
        thrower: ['.....kkkkk......', '....kggggggk....', '...kggggggggk...', '...kgwwggwwgk...', '...kgwkggwkgk...', '...kggggggggk...',
                  '....kgkkkkgk....', '.....kggggk.....', '...kkhhhhhhkk...', '..khhhhhhhhhhk..', '..khhkhhhhkhhk..', '..kkkhhhhhhkkk..',
                  '....khhhhhhk....', '....kbbk.kbbk...', '...kbbbk.kbbbk..', '...kkkk...kkkk..'],
        rock:   ['..kkkk..', '.kssssk.', 'kssssssk', 'ksswsssk', 'kssssssk', 'kssssssk', '.kssssk.', '..kkkk..'],
        plant1: ['....kkkkkkkk....', '...krrwrrrwrk...', '..krrrrrrrrrrk..', '..kwwwwwwwwwwk..', '..kkkkkkkkkkkk..', '..kwwwwwwwwwwk..',
                 '..krrrrrrrrrrk..', '...krrwrrrwrk...', '....kkkkkkkk....', '.......kk.......', '...kk..kk..kk...', '..kllk.kk.kllk..',
                 '..klllkkkklllk..', '...kllllllllk...', '.......kk.......', '.......kk.......', '.......kk.......', '.......kk.......',
                 '.......kk.......', '.......kk.......', '.......kk.......', '.......kk.......', '.......kk.......', '.......kk.......'],
        plant2: ['....kkkkkkkk....', '...krrwrrrwrk...', '..krrrrrrrrrrk..', '..krrrrrrrrrrk..', '..kwwwwwwwwwwk..', '..kkkkkkkkkkkk..',
                 '..kwwwwwwwwwwk..', '..krrrrrrrrrrk..', '...krrwrrrwrk...', '....kkkkkkkk....', '...kk..kk..kk...', '..kllk.kk.kllk..',
                 '..klllkkkklllk..', '...kllllllllk...', '.......kk.......', '.......kk.......', '.......kk.......', '.......kk.......',
                 '.......kk.......', '.......kk.......', '.......kk.......', '.......kk.......', '.......kk.......', '.......kk.......'],
        berry:  ['................', '.......kk.......', '......klk.......', '....kkkllkk.....', '...krrrkkrrk....', '..krrwrrrrrrk...',
                 '..krwwrrrrrrrk..', '.krrwrrrrrrrrk..', '.krrrrrrrrrrrk..', '.krrrrrrrrrrrk..', '.krrrrrrrrrrrk..', '..krrrrrrrrrk...',
                 '..krrrrrrrrrk...', '...krrrrrrrk....', '....kkkkkkk.....', '................'],
        bloom:  ['................', '.....kkkkkk.....', '...kkyyyyyykk...', '..kyyrrrrrryyk..', '..kyrrwwwwrryk..', '..kyrwwkkwwryk..',
                 '..kyrrwwwwrryk..', '..kyyrrrrrryyk..', '...kkyyyyyykk...', '.....kkkkkk.....', '.......kk.......', '..kkk..kk..kkk..',
                 '..klllkkkklllk..', '...kllllllllk...', '.......kk.......', '.......kk.......'],
        gem:    ['................', '.......kk.......', '......kwyk......', '.....kwyyyk.....', '....kwyyyyyk....', 'kkkkwyyyyyyykkkk',
                 'kyyyyyykkyyyyyyk', '.kyyyyykkyyyyyk.', '..kyyyyyyyyyyk..', '...kyyyyyyyyk...', '...kyyyyyyyyk...', '..kyyyykkyyyyk..',
                 '..kyyyk..kyyyk..', '.kyyk......kyyk.', '.kkk........kkk.', '................'],
        leaf:   ['................', '.........kkk....', '.......kkgggk...', '.....kkgggggk...', '....kggwggggk...', '...kggwgggggk...',
                 '..kggwggggggk...', '..kgwggggggk....', '.kgwggggggk.....', '.kgwgggggk......', '.kgggggkk.......', '..kgggk.........',
                 '..kkkk..........', '..k.............', '.k..............', '................'],
        coin0:  ['....kkkk', '...kyyyyk', '..kyywwyyk', '..kywyyyyk', '..kywyyyyk', '..kywyyyyk', '..kywyyyyk', '..kywyyyyk', '..kywyyyyk', '..kyyyyyyk', '...kyyyyk', '....kkkk'],
        coin1:  ['....kkk', '...kyyyk', '...kywyk', '...kywyk', '...kywyk', '...kywyk', '...kywyk', '...kywyk', '...kywyk', '...kywyk', '...kyyyk', '....kkk'],
        coin2:  ['.....kk', '....kyk', '....kwk', '....kwk', '....kwk', '....kwk', '....kwk', '....kwk', '....kwk', '....kwk', '....kyk', '.....kk'],
        star:   ['................', '.....kkkkkk.....', '...kkyyyyyykk...', '..kyyyyyyyyyyk..', '.kyyyyykkyyyyyk.', '.kyyyykwwkyyyyk.',
                 'kyykkkwwwwkkkyyk', 'kyykwwwwwwwwkyyk', 'kyyykwwwwwwkyyyk', 'kyyyykwwwwkyyyyk', 'kyyyykwkkwkyyyyk', '.kyyykkyykkyyyk.',
                 '.kyyyyyyyyyyyyk.', '..kyyyyyyyyyyk..', '...kkyyyyyykk...', '.....kkkkkk.....'],
        fireball: ['..kkkk..', '.kyyyrk.', 'kyywyyrk', 'kywwyyrk', 'kyyyyyrk', 'krryyrrk', '.krrrrk.', '..kkkk..'],
        spring0: ['................', '................', '................', '................', '................', '................',
                  '................', '.kkkkkkkkkkkkkk.', '.krrrrrrrrrrrrk.', '.kkkkkkkkkkkkkk.', '...kwk....kwk...', '....kwk..kwk....',
                  '...kwk....kwk...', '.kkkkkkkkkkkkkk.', '.kwwwwwwwwwwwwk.', '.kkkkkkkkkkkkkk.'],
        spring1: ['................', '................', '................', '................', '................', '................',
                  '................', '................', '................', '................', '.kkkkkkkkkkkkkk.', '.krrrrrrrrrrrrk.',
                  '.kkkkkkkkkkkkkk.', '.kkkkkkkkkkkkkk.', '.kwwwwwwwwwwwwk.', '.kkkkkkkkkkkkkk.']
    };
    var PAL = {
        k: '#1a1423', w: '#ffffff', p: '#9b59d0', f: '#5a2d82', y: '#ffd23f', r: '#e8402a', g: '#7bd36b', e: '#1a1423',
        s: '#9a8f86', t: '#f2c08a', b: '#6b3a1f', h: '#3d8b4f', l: '#2e9b46'
    };
    var BOSS_PAL = [null,
        { k: '#1a1423', w: '#ffffff', p: '#8e44ad', f: '#4a235a', y: '#ffd23f', r: '#e8402a' },
        { k: '#1a1423', w: '#ffffff', p: '#e67e22', f: '#a04000', y: '#ffd23f', r: '#c0392b' },
        { k: '#1a1423', w: '#ffffff', p: '#7fc8f8', f: '#2e6f9e', y: '#ffd23f', r: '#5dade2' }];

    // Bosses are the walker shape scaled 2x with a crown (variant colours / shapes).
    function drawBoss(c, v, frame, hurt) {
        var pal = BOSS_PAL[v], rows = frame ? S.blorp2 : S.blorp1;
        c.save(); c.scale(2, 2);
        pix(c, rows, hurt ? { k: '#fff', w: '#fff', p: '#fff', f: '#fff' } : pal, 0, 0);
        c.restore();
        // crown / claws / ears
        c.fillStyle = '#1a1423'; c.fillRect(8, 0, 16, 7);
        c.fillStyle = pal.y; c.fillRect(9, 1, 14, 5);
        c.fillStyle = '#1a1423'; c.fillRect(12, 1, 2, 2); c.fillRect(18, 1, 2, 2);
        if (v === 2) { c.fillStyle = pal.r; c.fillRect(0, 12, 5, 6); c.fillRect(27, 12, 5, 6); }
        if (v === 3) { c.fillStyle = pal.f; c.fillRect(2, 2, 5, 8); c.fillRect(25, 2, 5, 8); }
    }

    function buildSprites() {
        var A = new Atlas(512, 256), k;
        var forms = ['normal', 'fire', 'star'];
        for (var fi = 0; fi < forms.length; fi++) {
            var pal = HERO_PAL[forms[fi]];
            for (k in LEGS) {
                (function (rows) { A.add2('hs_' + forms[fi] + '_' + k, 16, 16, function (c) { pix(c, rows, pal); }); })(heroRows(false, k));
                (function (rows) { A.add2('hb_' + forms[fi] + '_' + k, 16, 24, function (c) { pix(c, rows, pal); }); })(heroRows(true, k));
            }
            (function (p) {
                A.add2('hs_' + forms[fi] + '_crouch', 16, 16, function (c) { pix(c, crouchRows(false), p, 0, 4); });
                A.add2('hb_' + forms[fi] + '_crouch', 16, 24, function (c) { pix(c, crouchRows(false), p, 0, 12); });
            })(pal);
        }
        A.add('hero_die', 16, 16, function (c) { pix(c, heroRows(false, 'jump'), HERO_PAL.normal); });
        var names = ['blorp1', 'blorp2', 'snail1', 'snail2', 'spiky1', 'spiky2', 'thrower'];
        for (var i = 0; i < names.length; i++) (function (n) { A.add2(n, 16, 16, function (c) { pix(c, S[n], PAL); }); })(names[i]);
        var single = ['flat', 'shell', 'berry', 'bloom', 'gem', 'leaf', 'star', 'spring0', 'spring1'];
        for (i = 0; i < single.length; i++) (function (n) { A.add(n, 16, 16, function (c) { pix(c, S[n], PAL); }); })(single[i]);
        A.add('rock', 8, 8, function (c) { pix(c, S.rock, PAL); });
        A.add('fireball', 8, 8, function (c) { pix(c, S.fireball, PAL); });
        A.add('wing1', 8, 5, function (c) { pix(c, S.wing1, PAL); });
        A.add('wing2', 8, 5, function (c) { pix(c, S.wing2, PAL); });
        A.add('plant1', 16, 24, function (c) { pix(c, S.plant1, PAL); });
        A.add('plant2', 16, 24, function (c) { pix(c, S.plant2, PAL); });
        for (i = 0; i < 3; i++) (function (n) { A.add('coin' + n, 12, 12, function (c) { pix(c, S['coin' + n], PAL); }); })(i);
        // big crusher "Slab"
        A.add('crusher', 32, 32, function (c) {
            c.fillStyle = '#1a1423'; c.fillRect(0, 0, 32, 32);
            c.fillStyle = '#8d93a6'; c.fillRect(1, 1, 30, 30);
            c.fillStyle = '#6b7186'; for (var y = 4; y < 30; y += 8) c.fillRect(2, y, 28, 1);
            c.fillStyle = '#1a1423'; c.fillRect(7, 10, 6, 6); c.fillRect(19, 10, 6, 6); c.fillRect(8, 22, 16, 3);
            c.fillStyle = '#e8402a'; c.fillRect(9, 12, 2, 2); c.fillRect(21, 12, 2, 2);
            c.fillStyle = '#c9cede'; c.fillRect(0, 0, 3, 3); c.fillRect(29, 0, 3, 3); c.fillRect(0, 29, 3, 3); c.fillRect(29, 29, 3, 3);
        });
        for (var v = 1; v <= 3; v++) {
            for (var fr = 0; fr < 2; fr++) (function (vv, f) {
                A.add2('boss' + vv + '_' + f, 32, 32, function (c) { drawBoss(c, vv, f, false); });
            })(v, fr);
            (function (vv) { A.add('boss' + vv + '_hurt', 32, 32, function (c) { drawBoss(c, vv, 0, true); }); })(v);
        }
        A.add('flag', 16, 12, function (c) {
            c.fillStyle = '#1a1423'; c.fillRect(0, 0, 14, 12);
            c.fillStyle = '#4cd97b'; c.fillRect(1, 1, 12, 10);
            c.fillStyle = '#ffffff'; c.fillRect(4, 3, 6, 6);
            c.fillStyle = '#4cd97b'; c.fillRect(6, 5, 2, 2);
        });
        A.add('cpflag0', 16, 32, function (c) {
            c.fillStyle = '#5a5a6e'; c.fillRect(7, 2, 2, 30);
            c.fillStyle = '#1a1423'; c.fillRect(9, 20, 8, 7); c.fillStyle = '#9aa0b5'; c.fillRect(9, 21, 6, 5);
        });
        A.add('cpflag1', 16, 32, function (c) {
            c.fillStyle = '#5a5a6e'; c.fillRect(7, 2, 2, 30);
            c.fillStyle = '#1a1423'; c.fillRect(9, 2, 8, 9); c.fillStyle = '#ffd23f'; c.fillRect(9, 3, 7, 7);
        });
        A.add('door', 16, 32, function (c) {
            c.fillStyle = '#1a1423'; c.fillRect(0, 0, 16, 32);
            c.fillStyle = '#7a4a2a'; c.fillRect(2, 2, 12, 30);
            c.fillStyle = '#5a3420'; c.fillRect(7, 2, 2, 30);
            c.fillStyle = '#ffd23f'; c.fillRect(11, 16, 2, 2);
        });
        A.add('platform', 48, 8, function (c) {
            c.fillStyle = '#1a1423'; c.fillRect(0, 0, 48, 8);
            c.fillStyle = '#c98a3c'; c.fillRect(1, 1, 46, 6);
            c.fillStyle = '#e8b062'; c.fillRect(1, 1, 46, 2);
            c.fillStyle = '#8a5a24'; for (var x = 8; x < 48; x += 10) c.fillRect(x, 3, 2, 4);
        });
        A.add('fallplat', 48, 8, function (c) {
            c.fillStyle = '#1a1423'; c.fillRect(0, 0, 48, 8);
            c.fillStyle = '#9b59d0'; c.fillRect(1, 1, 46, 6);
            c.fillStyle = '#c39be8'; c.fillRect(1, 1, 46, 2);
        });
        A.add('dust', 4, 4, function (c) { c.fillStyle = '#fff'; c.fillRect(1, 0, 2, 4); c.fillRect(0, 1, 4, 2); });
        return A;
    }

    /* ---------- themed tiles ---------- */
    var THEMES = {
        grass:    { sky: ['#6ec6ff', '#bfe9ff'], top: '#4cc35a', topHi: '#8ee07a', dirt: '#b06b35', dirtDk: '#8a4f24', dirtHi: '#c98a50', brick: '#c0612b', brickDk: '#7a3a18', hard: '#a46a3c', hill: ['#5fbf6a', '#3f9f50', '#2f7f3e'], deco: 'hills' },
        desert:   { sky: ['#ffc56e', '#ffe9b8'], top: '#f0d07a', topHi: '#fff0a8', dirt: '#d9a54a', dirtDk: '#b07e30', dirtHi: '#ecc06a', brick: '#c77a3a', brickDk: '#844b1e', hard: '#b98846', hill: ['#e9b85c', '#d49a40', '#b9802e'], deco: 'dunes' },
        beach:    { sky: ['#3fa9d6', '#1f6f9c'], top: '#f0d07a', topHi: '#fff0a8', dirt: '#d9b46a', dirtDk: '#b08e40', dirtHi: '#ecca8a', brick: '#c77a3a', brickDk: '#844b1e', hard: '#d08a60', hill: ['#2f8fbf', '#22779f', '#165f80'], deco: 'reef' },
        ice:      { sky: ['#9ad2f0', '#e2f4ff'], top: '#ffffff', topHi: '#ffffff', dirt: '#8fc7ea', dirtDk: '#5d9ccc', dirtHi: '#c4e6fa', brick: '#6a8fd0', brickDk: '#3d5c99', hard: '#7aa7cf', hill: ['#c9e6f8', '#a5d1ef', '#7fb7e0'], deco: 'peaks', slippery: true },
        icewater: { sky: ['#2f6fa8', '#174a78'], top: '#ffffff', topHi: '#ffffff', dirt: '#8fc7ea', dirtDk: '#5d9ccc', dirtHi: '#c4e6fa', brick: '#6a8fd0', brickDk: '#3d5c99', hard: '#7aa7cf', hill: ['#2a5f90', '#1f4f7c', '#163f66'], deco: 'reef' },
        fort:     { sky: ['#241a2e', '#3a2a40'], top: '#8d93a6', topHi: '#b3b8c9', dirt: '#6b7186', dirtDk: '#4b5066', dirtHi: '#8d93a6', brick: '#7d6f86', brickDk: '#4e4458', hard: '#6b7186', hill: ['#3a2e48', '#2e2438', '#221a2a'], deco: 'castle' }
    };

    function noise(c, x, y, w, h, col, n, seed) {
        c.fillStyle = col;
        var s = seed;
        for (var i = 0; i < n; i++) { s = (s * 16807) % 2147483647; var px = s % w; s = (s * 16807) % 2147483647; var py = s % h; c.fillRect(x + px, y + py, 1, 1); }
    }

    // Tile frames: index = tile id (see tools/gen-levels.mjs). Extra frames for animation.
    function buildTiles(themeName) {
        var T = THEMES[themeName] || THEMES.grass;
        var A = new Atlas(256, 64);
        function q(name, fn) { A.add(name, 16, 16, fn); }
        q('ground', function (c) { c.fillStyle = T.dirt; c.fillRect(0, 0, 16, 16); noise(c, 0, 0, 16, 16, T.dirtDk, 14, 3); noise(c, 0, 0, 16, 16, T.dirtHi, 6, 9); });
        q('groundTop', function (c) {
            c.fillStyle = T.dirt; c.fillRect(0, 0, 16, 16); noise(c, 0, 5, 16, 11, T.dirtDk, 10, 5); noise(c, 0, 5, 16, 11, T.dirtHi, 5, 7);
            c.fillStyle = T.top; c.fillRect(0, 0, 16, 5); c.fillStyle = T.topHi; c.fillRect(0, 0, 16, 2);
            c.fillStyle = T.top; c.fillRect(2, 5, 3, 1); c.fillRect(9, 5, 4, 2);
        });
        q('brick', function (c) {
            c.fillStyle = T.brickDk; c.fillRect(0, 0, 16, 16);
            c.fillStyle = T.brick;
            c.fillRect(0, 1, 7, 6); c.fillRect(8, 1, 8, 6); c.fillRect(0, 9, 3, 6); c.fillRect(4, 9, 8, 6); c.fillRect(13, 9, 3, 6);
            c.fillStyle = 'rgba(255,255,255,0.25)'; c.fillRect(0, 1, 16, 1); c.fillRect(0, 9, 16, 1);
        });
        for (var f = 0; f < 4; f++) (function (f) {
            q('qblock' + f, function (c) {
                c.fillStyle = '#1a1423'; c.fillRect(0, 0, 16, 16);
                c.fillStyle = ['#f5b800', '#ffcf3a', '#ffe27a', '#ffcf3a'][f]; c.fillRect(1, 1, 14, 14);
                c.fillStyle = '#b07800'; c.fillRect(1, 14, 14, 1); c.fillRect(14, 1, 1, 14);
                c.fillStyle = '#fff6c8'; c.fillRect(1, 1, 14, 1);
                c.fillStyle = '#1a1423'; c.fillRect(2, 2, 1, 1); c.fillRect(13, 2, 1, 1); c.fillRect(2, 13, 1, 1); c.fillRect(13, 13, 1, 1);
                // original glyph: a little diamond
                c.fillStyle = '#8a4f00'; c.fillRect(7, 4, 2, 2); c.fillRect(6, 6, 4, 2); c.fillRect(5, 8, 6, 1); c.fillRect(6, 9, 4, 2); c.fillRect(7, 11, 2, 1);
                c.fillStyle = '#fff'; c.fillRect(7, 6, 1, 2);
            });
        })(f);
        q('used', function (c) {
            c.fillStyle = '#1a1423'; c.fillRect(0, 0, 16, 16);
            c.fillStyle = '#8a6a4a'; c.fillRect(1, 1, 14, 14);
            c.fillStyle = '#6a4a2a'; c.fillRect(1, 14, 14, 1); c.fillRect(14, 1, 1, 14);
            c.fillStyle = '#1a1423'; c.fillRect(3, 3, 1, 1); c.fillRect(12, 3, 1, 1); c.fillRect(3, 12, 1, 1); c.fillRect(12, 12, 1, 1);
        });
        q('hard', function (c) {
            c.fillStyle = '#1a1423'; c.fillRect(0, 0, 16, 16);
            c.fillStyle = T.hard; c.fillRect(1, 1, 14, 14);
            c.fillStyle = 'rgba(255,255,255,0.3)'; c.fillRect(1, 1, 14, 2); c.fillRect(1, 1, 2, 14);
            c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(1, 13, 14, 2); c.fillRect(13, 1, 2, 14);
        });
        q('oneway', function (c) {
            c.fillStyle = '#1a1423'; c.fillRect(0, 0, 16, 6);
            c.fillStyle = T.top; c.fillRect(0, 1, 16, 4); c.fillStyle = T.topHi; c.fillRect(0, 1, 16, 1);
            c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(3, 5, 2, 4); c.fillRect(11, 5, 2, 4);
        });
        q('spike', function (c) {
            c.fillStyle = '#5a5a6e'; c.fillRect(0, 12, 16, 4);
            for (var i = 0; i < 4; i++) {
                c.fillStyle = '#1a1423'; c.beginPath(); c.moveTo(i * 4, 13); c.lineTo(i * 4 + 2, 2); c.lineTo(i * 4 + 4, 13); c.fill();
                c.fillStyle = '#d8dce8'; c.beginPath(); c.moveTo(i * 4 + 1, 12); c.lineTo(i * 4 + 2, 5); c.lineTo(i * 4 + 3, 12); c.fill();
            }
        });
        var pipeG = themeName === 'fort' ? ['#5c6b8a', '#8090b0', '#3d4a66'] : themeName === 'ice' || themeName === 'icewater' ? ['#3d7fd0', '#7fb8f0', '#25599c'] : ['#2fb34a', '#7fe08a', '#1c7a30'];
        function pipe(c, x0, w, top) {
            c.fillStyle = '#1a1423'; c.fillRect(x0, 0, w, 16);
            c.fillStyle = pipeG[0]; c.fillRect(x0 + (x0 ? 0 : 1), top ? 1 : 0, w - 1, top ? 14 : 16);
            c.fillStyle = pipeG[1]; c.fillRect(x0 ? x0 : 3, top ? 2 : 0, 2, top ? 12 : 16);
            c.fillStyle = pipeG[2]; c.fillRect(x0 ? 12 : 13, top ? 2 : 0, 2, top ? 12 : 16);
        }
        q('pipeTL', function (c) { pipe(c, 0, 16, true); c.fillStyle = '#1a1423'; c.fillRect(0, 15, 16, 1); });
        q('pipeTR', function (c) { c.save(); c.translate(16, 0); c.scale(-1, 1); pipe(c, 0, 16, true); c.fillStyle = '#1a1423'; c.fillRect(0, 15, 16, 1); c.restore(); });
        q('pipeL', function (c) { c.fillStyle = '#1a1423'; c.fillRect(1, 0, 15, 16); c.fillStyle = pipeG[0]; c.fillRect(2, 0, 14, 16); c.fillStyle = pipeG[1]; c.fillRect(4, 0, 2, 16); });
        q('pipeR', function (c) { c.fillStyle = '#1a1423'; c.fillRect(0, 0, 15, 16); c.fillStyle = pipeG[0]; c.fillRect(0, 0, 14, 16); c.fillStyle = pipeG[2]; c.fillRect(10, 0, 2, 16); });
        for (f = 0; f < 2; f++) (function (f) {
            q('water' + f, function (c) {
                c.fillStyle = 'rgba(40,120,220,0.45)'; c.fillRect(0, 0, 16, 16);
                c.fillStyle = 'rgba(255,255,255,0.12)'; c.fillRect(f * 8, 6, 6, 1); c.fillRect(8 - f * 8, 12, 5, 1);
            });
            q('waterTop' + f, function (c) {
                c.fillStyle = 'rgba(40,120,220,0.45)'; c.fillRect(0, 3, 16, 13);
                c.fillStyle = 'rgba(200,235,255,0.8)';
                for (var x = 0; x < 16; x += 4) c.fillRect(x, 2 + (((x >> 2) + f) & 1), 3, 1);
            });
            q('lava' + f, function (c) {
                c.fillStyle = '#d9361a'; c.fillRect(0, 0, 16, 16);
                c.fillStyle = '#ff7a1a'; c.fillRect(f * 6, 4, 6, 3); c.fillRect(10 - f * 6, 10, 5, 3);
            });
            q('lavaTop' + f, function (c) {
                c.fillStyle = '#d9361a'; c.fillRect(0, 4, 16, 12);
                c.fillStyle = '#ffb21a';
                for (var x = 0; x < 16; x += 4) c.fillRect(x, 3 + (((x >> 2) + f) & 1), 3, 2);
                c.fillStyle = '#ff7a1a'; c.fillRect(f * 7, 9, 5, 2);
            });
        })(f);
        return { atlas: A, theme: T };
    }

    /* ---------- parallax backgrounds (one 512px strip per layer, repeated) ---------- */
    function buildBackground(themeName, layers, clouds) {
        var T = THEMES[themeName] || THEMES.grass, out = [], seed = 1;
        function r() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
        for (var L = 0; L < layers; L++) {
            var c = document.createElement('canvas');
            c.width = 512; c.height = 270;
            var x = c.getContext('2d'), base = 170 + L * 30, col = T.hill[Math.min(2, layers - 1 - L + (3 - layers))];
            x.fillStyle = col;
            if (T.deco === 'hills' || T.deco === 'dunes' || T.deco === 'reef') {
                for (var i = 0; i < 5; i++) {
                    var cx = i * 110 + r() * 40, rad = 50 + r() * 50 - L * 10;
                    x.beginPath(); x.arc(cx, base + 20, rad, Math.PI, 0); x.fill();
                    if (cx - rad < 0) { x.beginPath(); x.arc(cx + 512, base + 20, rad, Math.PI, 0); x.fill(); }
                    if (cx + rad > 512) { x.beginPath(); x.arc(cx - 512, base + 20, rad, Math.PI, 0); x.fill(); }
                }
                x.fillRect(0, base + 20, 512, 270);
            } else if (T.deco === 'peaks') {
                x.beginPath(); x.moveTo(0, 270);
                for (var px = 0; px <= 512; px += 64) x.lineTo(px, base - (px % 128 ? 70 - L * 15 : 10));
                x.lineTo(512, 270); x.fill();
                x.fillStyle = 'rgba(255,255,255,0.6)';
                for (px = 64; px < 512; px += 128) { x.beginPath(); x.moveTo(px - 14, base - 50 + L * 15); x.lineTo(px, base - 70 + L * 15); x.lineTo(px + 14, base - 50 + L * 15); x.fill(); }
            } else {   // castle walls
                x.fillRect(0, base, 512, 270);
                for (px = 0; px < 512; px += 32) x.fillRect(px, base - 12, 16, 12);
                x.fillStyle = 'rgba(0,0,0,0.25)';
                for (var y = base; y < 270; y += 12) for (px = (y / 12 & 1) * 12; px < 512; px += 24) x.fillRect(px, y, 1, 12);
                if (L === layers - 1) { x.fillStyle = '#ffb21a'; for (px = 40; px < 512; px += 128) x.fillRect(px, base + 24, 6, 10); }
            }
            out.push({ canvas: c, speed: 0.15 + L * 0.2 });
        }
        var cl = null;
        if (clouds && T.deco !== 'castle' && T.deco !== 'reef') {
            cl = document.createElement('canvas');
            cl.width = 512; cl.height = 120;
            var cx2 = cl.getContext('2d');
            cx2.fillStyle = 'rgba(255,255,255,0.9)';
            for (var k = 0; k < 5; k++) {
                var ox = k * 100 + r() * 50, oy = 20 + r() * 70;
                cx2.fillRect(ox, oy, 40, 10); cx2.fillRect(ox + 8, oy - 6, 22, 8); cx2.fillRect(ox + 4, oy + 8, 32, 4);
            }
        }
        return { layers: out, clouds: cl, sky: T.sky };
    }

    return { buildSprites: buildSprites, buildTiles: buildTiles, buildBackground: buildBackground, THEMES: THEMES };
})();
