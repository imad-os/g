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
        normal2:{ k: '#1a1423', c: '#8e5bd8', w: '#ffffff', s: '#e8b48a', e: '#1a1423', o: '#3fbf6f', y: '#ffffff', b: '#3a2a6b' },
        fire2:  { k: '#1a1423', c: '#ffffff', w: '#8e5bd8', s: '#e8b48a', e: '#1a1423', o: '#8e5bd8', y: '#ffd23f', b: '#3a2a6b' },
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
        var A = new Atlas(512, 320), k;
        var forms = ['normal', 'fire', 'star', 'normal2', 'fire2'];
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

    /* ---------- parallax backgrounds (one 512px strip per layer, repeated; built once per stage) ---------- */
    function mix(a, b, t) {
        function p(h, i) { return parseInt(h.substr(1 + i * 2, 2), 16); }
        var o = '#';
        for (var i = 0; i < 3; i++) { var v = Math.round(p(a, i) + (p(b, i) - p(a, i)) * t); o += (v < 16 ? '0' : '') + v.toString(16); }
        return o;
    }

    // Everything wraps at 512 px, so a shape is drawn three times (-512, 0, +512): the strip repeats without a seam.
    function wrap(x, fn) { for (var dx = -512; dx <= 512; dx += 512) { x.save(); x.translate(dx, 0); fn(); x.restore(); } }

    // rolling ground line: a sum of sines with whole periods over 512 px (seamless), sampled every 8 px
    function makeProfile(base, amps, seed) {
        var ys = [], i, k, ph = [];
        for (k = 0; k < amps.length; k++) ph[k] = seed * (k + 1) * 2.399;
        for (i = 0; i <= 64; i++) {
            var y = base;
            for (k = 0; k < amps.length; k++) y -= amps[k] * Math.sin(Math.PI * 2 * (k + 1 + (k > 1 ? k : 0)) * i / 64 + ph[k]);
            ys.push(y);
        }
        return ys;
    }
    function yAt(ys, px) { px = ((px % 512) + 512) % 512; var i = px / 8 | 0, f = px / 8 - i; return ys[i] + (ys[i + 1] - ys[i]) * f; }
    function fillProfile(x, ys, col) {
        wrap(x, function () { x.fillStyle = col; x.beginPath(); x.moveTo(0, 270); for (var i = 0; i <= 64; i++) x.lineTo(i * 8, ys[i]); x.lineTo(512, 270); x.fill(); });
    }
    // jagged peaks (mountains), the last point equals the first one
    function peaks(x, base, hMin, hMax, col, snow, r) {
        var pts = [], n = 8, i;
        for (i = 0; i < n; i++) pts.push(hMin + r() * (hMax - hMin));
        wrap(x, function () {
            x.fillStyle = col; x.beginPath(); x.moveTo(0, 270);
            var px = 0, step = 512 / n;
            for (i = 0; i < n; i++) { x.lineTo(px, base); x.lineTo(px + step / 2, base - pts[i]); px += step; }
            x.lineTo(512, base); x.lineTo(512, 270); x.fill();
            if (snow) {
                x.fillStyle = snow;
                for (i = 0; i < n; i++) { var cx = i * step + step / 2, h = pts[i]; if (h < (hMin + hMax) / 2) continue;
                    x.beginPath(); x.moveTo(cx, base - h); x.lineTo(cx - h * 0.22, base - h * 0.72); x.lineTo(cx - h * 0.08, base - h * 0.78); x.lineTo(cx, base - h * 0.68); x.lineTo(cx + h * 0.1, base - h * 0.78); x.lineTo(cx + h * 0.22, base - h * 0.72); x.fill(); }
            }
        });
    }
    function roundTree(x, px, py, s, leaf, trunk) {
        x.fillStyle = trunk; x.fillRect(px - 2 * s, py - 14 * s, 4 * s, 15 * s);
        x.fillStyle = leaf; x.beginPath(); x.arc(px, py - 20 * s, 11 * s, 0, 7); x.arc(px - 8 * s, py - 14 * s, 7 * s, 0, 7); x.arc(px + 8 * s, py - 14 * s, 7 * s, 0, 7); x.fill();
        x.fillStyle = 'rgba(255,255,255,0.14)'; x.beginPath(); x.arc(px - 3 * s, py - 24 * s, 5 * s, 0, 7); x.fill();
    }
    function pine(x, px, py, s, leaf, snow) {
        x.fillStyle = '#4a3322'; x.fillRect(px - 1.5 * s, py - 6 * s, 3 * s, 7 * s);
        for (var i = 0; i < 3; i++) {
            var w = (13 - i * 3) * s, y0 = py - (6 + i * 9) * s;
            x.fillStyle = leaf; x.beginPath(); x.moveTo(px, y0 - 14 * s); x.lineTo(px - w, y0); x.lineTo(px + w, y0); x.fill();
            if (snow) { x.fillStyle = snow; x.beginPath(); x.moveTo(px, y0 - 14 * s); x.lineTo(px - w * 0.55, y0 - 6 * s); x.lineTo(px + w * 0.55, y0 - 6 * s); x.fill(); }
        }
    }
    function cactus(x, px, py, s, col) {
        x.fillStyle = col; x.fillRect(px - 3 * s, py - 24 * s, 6 * s, 25 * s);
        x.fillRect(px - 10 * s, py - 16 * s, 4 * s, 3 * s); x.fillRect(px - 10 * s, py - 22 * s, 3 * s, 9 * s);
        x.fillRect(px + 6 * s, py - 12 * s, 4 * s, 3 * s); x.fillRect(px + 7 * s, py - 18 * s, 3 * s, 9 * s);
    }
    function palm(x, px, py, s, leaf) {
        x.strokeStyle = '#7a5a30'; x.lineWidth = 3 * s; x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(px + 6 * s, py - 18 * s, px + 2 * s, py - 34 * s); x.stroke();
        x.strokeStyle = leaf; x.lineWidth = 2.5 * s;
        for (var i = -2; i <= 2; i++) { x.beginPath(); x.moveTo(px + 2 * s, py - 34 * s); x.quadraticCurveTo(px + 2 * s + i * 9 * s, py - 44 * s + Math.abs(i) * 3 * s, px + 2 * s + i * 14 * s, py - 30 * s + Math.abs(i) * 6 * s); x.stroke(); }
    }
    function coral(x, px, py, s, col) {
        x.strokeStyle = col; x.lineWidth = 3 * s; x.lineCap = 'round';
        for (var i = -1; i <= 1; i++) { x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(px + i * 6 * s, py - 12 * s, px + i * 12 * s, py - (22 - Math.abs(i) * 6) * s); x.stroke();
            x.beginPath(); x.arc(px + i * 12 * s, py - (22 - Math.abs(i) * 6) * s, 2.2 * s, 0, 7); x.fillStyle = col; x.fill(); }
    }
    function crystal(x, px, py, s, col, hi) {
        for (var i = -1; i <= 1; i++) {
            var h = (i ? 14 : 22) * s, w = 4 * s, bx = px + i * 7 * s;
            x.fillStyle = col; x.beginPath(); x.moveTo(bx - w, py); x.lineTo(bx, py - h); x.lineTo(bx + w, py); x.fill();
            x.fillStyle = hi; x.beginPath(); x.moveTo(bx, py - h); x.lineTo(bx + w, py); x.lineTo(bx + w * 0.2, py); x.fill();
        }
    }
    function tower(x, px, base, w, h, col, flag, lit, r) {
        x.fillStyle = col; x.fillRect(px, base - h, w, h + 1);
        for (var i = 0; i < w; i += 8) x.fillRect(px + i, base - h - 6, 5, 6);
        x.fillStyle = lit;
        for (var wy = base - h + 12; wy < base - 10; wy += 22) { if (r() < 0.75) x.fillRect(px + w / 2 - 2, wy, 4, 8); }
        if (flag) { x.fillStyle = col; x.fillRect(px + w / 2, base - h - 22, 1.5, 16); x.fillStyle = flag; x.beginPath(); x.moveTo(px + w / 2 + 1.5, base - h - 22); x.lineTo(px + w / 2 + 12, base - h - 18); x.lineTo(px + w / 2 + 1.5, base - h - 14); x.fill(); }
    }
    function glow(x, px, py, rad, col) {
        var g = x.createRadialGradient(px, py, 0, px, py, rad);
        g.addColorStop(0, col); g.addColorStop(1, 'rgba(255,160,40,0)');
        x.fillStyle = g; x.fillRect(px - rad, py - rad, rad * 2, rad * 2);
    }

    // One drawing function per theme family and depth (0 far, 1 middle, 2 near)
    var DRAW = {
        hills: [
            function (x, T, r, sky) {
                peaks(x, 205, 70, 130, mix(T.hill[0], sky, 0.62), 'rgba(255,255,255,0.8)', r);
                peaks(x, 215, 40, 90, mix(T.hill[0], sky, 0.45), null, r);
            },
            function (x, T, r, sky) {
                var ys = makeProfile(215, [14, 8, 4], 1.3); fillProfile(x, ys, mix(T.hill[1], sky, 0.18));
                wrap(x, function () { for (var i = 0; i < 9; i++) { var px = i * 57 + r() * 25, py = yAt(ys, px) + 3; if (r() < 0.6) roundTree(x, px, py, 0.8 + r() * 0.5, mix(T.hill[1], '#1d5a2a', 0.3), '#6b4a2a'); else pine(x, px, py, 0.8 + r() * 0.4, mix(T.hill[1], '#12452a', 0.4), null); } });
            },
            function (x, T, r) {
                var ys = makeProfile(240, [9, 5, 3], 2.1); fillProfile(x, ys, T.hill[2]);
                wrap(x, function () {
                    for (var i = 0; i < 22; i++) { var px = i * 24 + r() * 14, py = yAt(ys, px) + 4; x.fillStyle = mix(T.hill[2], '#0c3a1c', 0.35); x.beginPath(); x.arc(px, py + 2, 5 + r() * 4, Math.PI, 0); x.fill(); }
                    for (i = 0; i < 26; i++) { px = r() * 512; py = yAt(ys, px) + 12 + r() * 12; x.fillStyle = ['#ffe36b', '#ff8fb1', '#ffffff'][i % 3]; x.fillRect(px, py, 2, 2); }
                });
            }
        ],
        dunes: [
            function (x, T, r, sky) {
                wrap(x, function () { for (var i = 0; i < 3; i++) { var px = 40 + i * 190 + r() * 40, w = 50 + r() * 30, py = 214;
                    x.fillStyle = mix(T.hill[0], sky, 0.55); x.beginPath(); x.moveTo(px - w, py); x.lineTo(px, py - w * 0.9); x.lineTo(px + w, py); x.fill();
                    x.fillStyle = 'rgba(0,0,0,0.12)'; x.beginPath(); x.moveTo(px, py - w * 0.9); x.lineTo(px + w, py); x.lineTo(px + w * 0.1, py); x.fill(); } });
                fillProfile(x, makeProfile(220, [10, 5], 0.7), mix(T.hill[0], sky, 0.4));
            },
            function (x, T, r, sky) {
                var ys = makeProfile(220, [18, 7, 3], 2.7); fillProfile(x, ys, mix(T.hill[1], sky, 0.1));
                wrap(x, function () { for (var i = 0; i < 6; i++) { var px = i * 88 + r() * 40, py = yAt(ys, px) + 2; if (i % 2) palm(x, px, py, 0.8 + r() * 0.3, '#3f8f4a'); else cactus(x, px, py, 0.8 + r() * 0.4, '#3f8f4a'); } });
            },
            function (x, T, r) {
                var ys = makeProfile(244, [8, 4, 2], 1.9); fillProfile(x, ys, T.hill[2]);
                wrap(x, function () { for (var i = 0; i < 12; i++) { var px = r() * 512, py = yAt(ys, px) + 3; x.fillStyle = mix(T.hill[2], '#5a3a14', 0.4); x.beginPath(); x.arc(px, py + 3, 3 + r() * 5, Math.PI, 0); x.fill(); } });
            }
        ],
        reef: [
            function (x, T, r, sky) {
                wrap(x, function () { for (var i = 0; i < 5; i++) { var px = i * 110 + r() * 40; var g = x.createLinearGradient(px, 0, px + 60, 270); g.addColorStop(0, 'rgba(255,255,255,0.20)'); g.addColorStop(1, 'rgba(255,255,255,0)');
                    x.fillStyle = g; x.beginPath(); x.moveTo(px, 0); x.lineTo(px + 26, 0); x.lineTo(px + 100, 270); x.lineTo(px + 40, 270); x.fill(); } });
                peaks(x, 230, 40, 100, mix(T.hill[0], sky, 0.4), null, r);
            },
            function (x, T, r, sky) {
                var ys = makeProfile(232, [10, 6, 3], 3.1); fillProfile(x, ys, mix(T.hill[1], sky, 0.15));
                var cols = T.slippery || T.sky[0] === '#2f6fa8' ? ['#8fd6ff', '#c4e6fa', '#6fb0e8'] : ['#ff7a9a', '#ffb347', '#c46bd9'];
                wrap(x, function () { for (var i = 0; i < 9; i++) { var px = i * 58 + r() * 30, py = yAt(ys, px) + 2; if (cols[0] === '#8fd6ff') crystal(x, px, py, 0.8 + r() * 0.5, cols[i % 3], 'rgba(255,255,255,0.5)'); else coral(x, px, py, 0.8 + r() * 0.5, cols[i % 3]); } });
            },
            function (x, T, r) {
                var ys = makeProfile(250, [6, 4], 0.9); fillProfile(x, ys, T.hill[2]);
                wrap(x, function () {
                    for (var i = 0; i < 12; i++) { var px = r() * 512, h = 14 + r() * 22; x.strokeStyle = mix(T.hill[2], '#3fbf6a', 0.45); x.lineWidth = 3; x.beginPath(); x.moveTo(px, 262); x.quadraticCurveTo(px + 6, 262 - h / 2, px, 262 - h); x.stroke(); }
                    for (i = 0; i < 16; i++) { x.strokeStyle = 'rgba(255,255,255,0.35)'; x.lineWidth = 1; x.beginPath(); x.arc(r() * 512, 40 + r() * 190, 2 + r() * 3, 0, 7); x.stroke(); }
                });
            }
        ],
        peaks: [
            function (x, T, r, sky) {
                peaks(x, 210, 90, 150, mix(T.hill[0], sky, 0.5), '#ffffff', r);
                peaks(x, 220, 50, 100, mix(T.hill[1], sky, 0.35), 'rgba(255,255,255,0.7)', r);
            },
            function (x, T, r, sky) {
                var ys = makeProfile(222, [12, 6, 3], 0.5); fillProfile(x, ys, mix('#dff1fb', T.hill[1], 0.35));
                wrap(x, function () { for (var i = 0; i < 9; i++) { var px = i * 57 + r() * 25; pine(x, px, yAt(ys, px) + 3, 0.8 + r() * 0.5, '#2f6f58', '#ffffff'); } });
            },
            function (x, T, r) {
                var ys = makeProfile(244, [7, 4, 2], 2.2); fillProfile(x, ys, '#f4fbff');
                wrap(x, function () { for (var i = 0; i < 5; i++) { var px = r() * 512; crystal(x, px, yAt(ys, px) + 3, 0.7 + r() * 0.5, '#8fd6ff', 'rgba(255,255,255,0.7)'); } });
            }
        ],
        castle: [
            function (x, T, r, sky) {
                var col = mix(T.hill[0], sky, 0.25), lit = '#ffb21a';
                wrap(x, function () {
                    x.fillStyle = col; x.fillRect(0, 190, 512, 80);
                    for (var i = 0; i < 4; i++) tower(x, 20 + i * 130 + r() * 30, 215, 26 + r() * 14, 40 + r() * 70, col, i % 2 ? '#c0392b' : null, lit, r);
                });
            },
            function (x, T, r) {
                var brick = T.hill[1];
                wrap(x, function () {
                    x.fillStyle = brick; x.fillRect(0, 170, 512, 100);
                    for (var i = 0; i < 512; i += 32) x.fillRect(i, 158, 18, 12);
                    x.fillStyle = 'rgba(0,0,0,0.22)';
                    for (var y = 170; y < 270; y += 14) for (var px = (y / 14 & 1) * 14; px < 512; px += 28) x.fillRect(px, y, 1, 14);
                    for (i = 0; i < 4; i++) { var ax = 40 + i * 128; x.fillStyle = '#120c1a'; x.beginPath(); x.moveTo(ax, 270); x.lineTo(ax, 215); x.arc(ax + 18, 215, 18, Math.PI, 0); x.lineTo(ax + 36, 270); x.fill(); }
                });
            },
            function (x, T, r) {
                wrap(x, function () {
                    for (var i = 0; i < 4; i++) { var px = 20 + i * 128;
                        x.fillStyle = T.hill[2]; x.fillRect(px, 100, 20, 170); x.fillStyle = 'rgba(255,255,255,0.08)'; x.fillRect(px, 100, 5, 170);
                        x.fillStyle = mix(T.hill[2], '#000000', 0.25); x.fillRect(px - 4, 96, 28, 8); x.fillRect(px - 4, 264, 28, 8);
                        glow(x, px + 64, 150, 34, 'rgba(255,170,50,0.55)'); x.fillStyle = '#ffd35a'; x.beginPath(); x.arc(px + 64, 150, 3, 0, 7); x.fill(); x.fillStyle = '#5a3420'; x.fillRect(px + 62, 153, 4, 14); }
                });
            }
        ]
    };

    // Sky decoration drawn once per frame, not scrolling: sun, moon, stars, aurora, soft haze.
    function buildSky(T, themeName, r) {
        var c = document.createElement('canvas'); c.width = 480; c.height = 270;
        var x = c.getContext('2d'), i;
        function disc(px, py, rad, col, haloCol) {
            glow2(px, py, rad * 3, haloCol); x.fillStyle = col; x.beginPath(); x.arc(px, py, rad, 0, 7); x.fill();
        }
        function glow2(px, py, rad, col) { var g = x.createRadialGradient(px, py, 0, px, py, rad); g.addColorStop(0, col); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(px - rad, py - rad, rad * 2, rad * 2); }
        if (themeName === 'grass') disc(380, 60, 22, '#fff6c8', 'rgba(255,246,200,0.55)');
        else if (themeName === 'desert') { disc(110, 90, 34, '#fff1b0', 'rgba(255,200,90,0.6)'); }
        else if (themeName === 'ice') { disc(360, 70, 18, '#ffffff', 'rgba(255,255,255,0.5)');
            for (i = 0; i < 3; i++) { var g = x.createLinearGradient(0, 20 + i * 18, 0, 90 + i * 18); g.addColorStop(0, 'rgba(120,255,200,0)'); g.addColorStop(0.5, 'rgba(120,255,200,0.28)'); g.addColorStop(1, 'rgba(160,120,255,0)'); x.fillStyle = g; x.beginPath(); x.moveTo(0, 60 + i * 14); x.bezierCurveTo(120, 10 + i * 10, 300, 110 + i * 10, 480, 40 + i * 14); x.lineTo(480, 100 + i * 14); x.bezierCurveTo(300, 150 + i * 10, 120, 50 + i * 10, 0, 100 + i * 14); x.fill(); } }
        else if (themeName === 'fort' || themeName === 'icewater') {
            x.fillStyle = '#ffffff';
            for (i = 0; i < 46; i++) { x.globalAlpha = 0.3 + r() * 0.6; x.fillRect(r() * 480, r() * 170, r() < 0.15 ? 2 : 1, r() < 0.15 ? 2 : 1); }
            x.globalAlpha = 1;
            if (themeName === 'fort') { disc(380, 56, 20, '#f4f1e6', 'rgba(200,210,255,0.35)'); x.fillStyle = '#3a2a40'; x.beginPath(); x.arc(388, 52, 17, 0, 7); x.fill(); }
        } else if (themeName === 'beach') { glow2(240, -10, 200, 'rgba(255,255,255,0.35)'); }
        return c;
    }

    function buildBackground(themeName, layers, clouds) {
        var T = THEMES[themeName] || THEMES.grass, out = [], seed = 7;
        function r() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
        var set = DRAW[T.deco === 'hills' ? 'hills' : T.deco === 'dunes' ? 'dunes' : T.deco === 'reef' ? 'reef' : T.deco === 'peaks' ? 'peaks' : 'castle'];
        var roles = layers >= 3 ? [0, 1, 2] : layers === 2 ? [0, 1] : [1];
        for (var L = 0; L < roles.length; L++) {
            var c = document.createElement('canvas');
            c.width = 512; c.height = 270;
            set[roles[L]](c.getContext('2d'), T, r, T.sky[1]);
            out.push({ canvas: c, speed: [0.12, 0.3, 0.55][roles[L]] });
        }
        var cl = null;
        if (clouds && T.deco !== 'castle' && T.deco !== 'reef') {
            cl = document.createElement('canvas');
            cl.width = 512; cl.height = 120;
            var x = cl.getContext('2d'), snowy = T.deco === 'peaks';
            for (var k = 0; k < 5; k++) {
                var ox = k * 102 + r() * 40, oy = 22 + r() * 60, s = 0.8 + r() * 0.7;
                for (var dx = -512; dx <= 512; dx += 512) {
                    x.fillStyle = 'rgba(255,255,255,0.35)'; x.beginPath(); x.arc(ox + dx, oy + 4, 14 * s, 0, 7); x.arc(ox + dx + 16 * s, oy - 2, 11 * s, 0, 7); x.arc(ox + dx - 16 * s, oy + 2, 10 * s, 0, 7); x.arc(ox + dx + 30 * s, oy + 6, 8 * s, 0, 7); x.fill();
                    x.fillStyle = snowy ? 'rgba(240,250,255,0.92)' : 'rgba(255,255,255,0.93)'; x.beginPath(); x.arc(ox + dx, oy, 13 * s, 0, 7); x.arc(ox + dx + 15 * s, oy - 5 * s, 10 * s, 0, 7); x.arc(ox + dx - 15 * s, oy, 9 * s, 0, 7); x.arc(ox + dx + 28 * s, oy + 3, 7 * s, 0, 7); x.fill();
                }
            }
        }
        var sky = layers > 1 ? buildSky(T, themeName, r) : null;
        return { layers: out, clouds: cl, sky: T.sky, fixed: sky };
    }

    return { buildSprites: buildSprites, buildTiles: buildTiles, buildBackground: buildBackground, THEMES: THEMES };
})();
