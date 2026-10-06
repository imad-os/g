/* Super Jumper: original 2D side-scrolling platformer (world map, 3 worlds x 5 stages).
 * Engine pieces: art.js (atlases), music.js (songs), level.js (tiles), actors.js (hero/enemies). */
(function () {
    'use strict';

    var T = 16, ID = Level.ID;
    var STR = {
        en: { twoP: 'Two players', p2Join: 'Player 2: press OK or A on your own controller', p2Joined: 'Player 2 joined', p2Left: 'Player 2 left', p2Back: 'is back',
              world: 'World', lives: 'Lives', coins: 'Coins', time: 'Time', score: 'Score', restartStage: 'Restart stage', worldMap: 'World map',
              assist: 'Assist mode', autoRun: 'Auto-run', contrast: 'High contrast HUD', on: 'On', off: 'Off', clear: 'Stage clear!',
              gameOver: 'Game over', checkpoint: 'Checkpoint', hurry: 'Hurry up!', secret: 'Secret exit found!', locked: 'Locked',
              cleared: 'cleared', starCoins: 'star coins', of: 'of', pressOk: 'Press OK to play', loadFail: 'Could not load the stage',
              runOn: 'Run on', runOff: 'Run off', fortress: 'Fortress', mapHelp: 'Left and right: choose a stage. Up and down: change world. OK: play.',
              worlds: ['Grassland', 'Desert and Beach', 'Ice Caves'], bossHit: 'Hit!', allClear: 'All worlds cleared!' },
        fr: { twoP: 'Deux joueurs', p2Join: 'Joueur 2 : appuyez sur OK ou A sur votre manette', p2Joined: 'Le joueur 2 a rejoint la partie', p2Left: 'Le joueur 2 est parti', p2Back: 'revient',
              world: 'Monde', lives: 'Vies', coins: 'Pièces', time: 'Temps', score: 'Score', restartStage: 'Recommencer le niveau', worldMap: 'Carte du monde',
              assist: 'Mode assistance', autoRun: 'Course auto', contrast: 'Affichage contrasté', on: 'Oui', off: 'Non', clear: 'Niveau terminé !',
              gameOver: 'Partie terminée', checkpoint: 'Point de contrôle', hurry: 'Dépêchez-vous !', secret: 'Sortie secrète trouvée !', locked: 'Verrouillé',
              cleared: 'terminé', starCoins: 'pièces étoile', of: 'sur', pressOk: 'Appuyez sur OK pour jouer', loadFail: 'Impossible de charger le niveau',
              runOn: 'Course activée', runOff: 'Course désactivée', fortress: 'Forteresse', mapHelp: 'Gauche et droite : choisir un niveau. Haut et bas : changer de monde. OK : jouer.',
              worlds: ['Prairie', 'Désert et plage', 'Grottes de glace'], bossHit: 'Touché !', allClear: 'Tous les mondes terminés !' },
        es: { twoP: 'Dos jugadores', p2Join: 'Jugador 2: pulsa OK o A en tu propio mando', p2Joined: 'Se unió el jugador 2', p2Left: 'El jugador 2 salió', p2Back: 'vuelve',
              world: 'Mundo', lives: 'Vidas', coins: 'Monedas', time: 'Tiempo', score: 'Puntos', restartStage: 'Reiniciar nivel', worldMap: 'Mapa del mundo',
              assist: 'Modo asistido', autoRun: 'Correr siempre', contrast: 'Marcador de alto contraste', on: 'Sí', off: 'No', clear: '¡Nivel superado!',
              gameOver: 'Fin del juego', checkpoint: 'Punto de control', hurry: '¡Date prisa!', secret: '¡Salida secreta encontrada!', locked: 'Bloqueado',
              cleared: 'superado', starCoins: 'monedas estrella', of: 'de', pressOk: 'Pulsa OK para jugar', loadFail: 'No se pudo cargar el nivel',
              runOn: 'Correr activado', runOff: 'Correr desactivado', fortress: 'Fortaleza', mapHelp: 'Izquierda y derecha: elegir nivel. Arriba y abajo: cambiar de mundo. OK: jugar.',
              worlds: ['Pradera', 'Desierto y playa', 'Cuevas de hielo'], bossHit: '¡Golpe!', allClear: '¡Todos los mundos superados!' },
        ar: { twoP: 'لاعبان', p2Join: 'اللاعب 2: اضغط OK أو A على وحدة التحكم الخاصة بك', p2Joined: 'انضم اللاعب 2', p2Left: 'غادر اللاعب 2', p2Back: 'عاد',
              world: 'العالم', lives: 'المحاولات', coins: 'العملات', time: 'الوقت', score: 'النقاط', restartStage: 'إعادة المرحلة', worldMap: 'خريطة العالم',
              assist: 'وضع المساعدة', autoRun: 'ركض تلقائي', contrast: 'واجهة عالية التباين', on: 'تشغيل', off: 'إيقاف', clear: 'اكتملت المرحلة!',
              gameOver: 'انتهت اللعبة', checkpoint: 'نقطة حفظ', hurry: 'أسرع!', secret: 'تم العثور على المخرج السري!', locked: 'مقفل',
              cleared: 'مكتملة', starCoins: 'عملات النجمة', of: 'من', pressOk: 'اضغط OK للعب', loadFail: 'تعذّر تحميل المرحلة',
              runOn: 'الركض مفعّل', runOff: 'الركض متوقف', fortress: 'القلعة', mapHelp: 'يسار ويمين: اختر مرحلة. أعلى وأسفل: غيّر العالم. OK: العب.',
              worlds: ['المروج', 'الصحراء والشاطئ', 'كهوف الجليد'], bossHit: 'إصابة!', allClear: 'اكتملت كل العوالم!' }
    };
    var COMBO = [100, 200, 400, 800, 1000, 2000, 4000, 8000];
    var WORLD_COLORS = [['#7ccf6a', '#4c9f4a'], ['#f0c46a', '#d0973a'], ['#bfe3f7', '#86bfe6']];

    var gk, s, sprites, stages = [], save, hud, mapInfo;
    var mode = 'load', modeT = 0;
    var lv = null, levelJson = null, stage = null, player, ents = [], parts;
    var cam = { x: 0, y: 0, look: 0 }, shakeT = 0, shakeAmp = 0, hitstop = 0;
    var time, timeTick, coins, combo, cp = null, starGot = [0, 0, 0], secretFound = false;
    var bossOn = false, leftWall = 0, goalEnt = null, goalFlagY = 0, tally = 0, pipeT = 0, pipeTarget = null;
    var fireballs = [], rocks = [], items = [], pops = [], popups = [];
    var mapW = 0, mapN = 0, banner = '', loadReq = 0;
    var musicNow = null;
    // players[0] is always P1; players[1] exists in 2-player mode. `player` points at the player being
    // processed (update, interactions, goal); `target` is who enemies aim at.
    var players = [], twoP = false, joinWait = 0, p1Dev = null, target = null;
    var NAMES = ['', 'P1', 'P2'];

    /* ------------------------------------------------------------------ save data */

    function defaultSave() {
        return { unlocked: { 'w1-1': true }, cleared: {}, stars: {}, secrets: {}, lives: 5, score: 0, coins: 0,
                 assist: false, autoRun: false, hc: false, lastStage: 'w1-1' };
    }
    function persist() { gk.save('progress', save); }

    /* ------------------------------------------------------------------ helpers */

    function music(song) { musicNow = song; gk.audio.music(song); }
    function sfx(n, p) { gk.audio.sfx(n, p); }
    function stageById(id) { for (var i = 0; i < stages.length; i++) if (stages[i].id === id) return stages[i]; return null; }
    function stageLabel(st) { return s.world + ' ' + st.world + '-' + (st.fortress ? s.fortress : st.n); }
    function worldUnlocked(w) { return !!save.unlocked['w' + w + '-1']; }

    function setBanner(text, sub) { GK.banner(text, sub); banner = text || ''; }

    function popup(x, y, text) {
        for (var i = 0; i < popups.length; i++) if (popups[i].t <= 0) { var p = popups[i]; p.x = x; p.y = y; p.text = text; p.t = 50; return; }
    }
    function addScore(n, x, y) { (player || players[0]).score += n; if (x !== undefined) popup(x, y, String(n)); }
    function oneUp(x, y) { (player || players[0]).lives++; sfx('oneup'); popup(x, y, '1UP'); }
    function firstAlive() { for (var i = 0; i < players.length; i++) if (!players[i].dead && !players[i].out) return players[i]; return players[0]; }
    function anyAlive(except) { for (var i = 0; i < players.length; i++) { var q = players[i]; if (q !== except && !q.dead && !q.out) return q; } return null; }
    function inGame(q) { return !q.out; }

    function comboScore(x, y) {
        if (combo >= COMBO.length) oneUp(x, y);
        else addScore(COMBO[combo], x, y);
        combo++;
    }

    /* ------------------------------------------------------------------ world context used by actors */

    var W = {
        get lv() { return lv; },
        get player() { return target || player; },
        get frame() { return gk.frame; },
        get water() { return !!(lv && lv.props.water); },
        get area() { return lv.areaAt(player.x); },
        get leftWall() { return leftWall; },
        get bossOn() { return bossOn; },
        sfx: sfx,
        nearestDist: function (x) {
            var d = 1e9;
            for (var i = 0; i < players.length; i++) if (!players[i].dead && !players[i].out) d = Math.min(d, Math.abs(players[i].x - x));
            return d;
        },
        shake: function (n) { if (gk.q.shake) { shakeT = Math.max(shakeT, n); shakeAmp = Math.min(3, n / 3); } },
        dust: function (x, y) { if (parts.n < parts.max - 4) parts.add(x, y - 2, (Math.random() - 0.5) * 0.6, -0.4, 16, '#ffffff', 2, 0.02); },

        collectCoin: function (x, y, pop, p) {
            if (p) player = p;
            coins++; addScore(200);
            sfx('coin');
            if (coins >= 100) { coins -= 100; oneUp(x, y - 8); }
            if (pop) for (var i = 0; i < pops.length; i++) if (pops[i].t <= 0) { pops[i].x = x - 6; pops[i].y = y; pops[i].vy = -4; pops[i].t = 26; break; }
        },

        hitBlock: function (tx, ty, big, byShell, p) {
            var id = lv.rawTile(tx, ty), cx = tx * T + 8, cy = ty * T;
            if (id === ID.QCOIN || id === ID.HCOIN) { lv.set(tx, ty, ID.USED); lv.bump(tx, ty); W.collectCoin(cx, cy - 4, true); }
            else if (id === ID.QPOW) { lv.set(tx, ty, ID.USED); lv.bump(tx, ty); spawnItem(p && p.power > 0 ? 'bloom' : 'berry', tx, ty); }
            else if (id === ID.QSTAR) { lv.set(tx, ty, ID.USED); lv.bump(tx, ty); spawnItem('gem', tx, ty); }
            else if (id === ID.H1UP) { lv.set(tx, ty, ID.USED); lv.bump(tx, ty); spawnItem('leaf', tx, ty); }
            else if (id === ID.MULTI) {
                var key = ty * lv.W + tx;
                if (!lv.multi) lv.multi = {};
                if (lv.multi[key] === undefined) lv.multi[key] = 8;
                lv.bump(tx, ty); W.collectCoin(cx, cy - 4, true);
                if (--lv.multi[key] <= 0) lv.set(tx, ty, ID.USED);
            } else if (id === ID.BRICK) {
                if (big) {
                    lv.set(tx, ty, W.water ? ID.WATER : 0);
                    sfx('brk'); addScore(50);
                    var col = lv.tiles.theme.brick;
                    for (var i = 0; i < 4; i++) parts.add(tx * T + 4 + (i & 1) * 8, ty * T + 4 + (i >> 1) * 8, (i & 1 ? 1.2 : -1.2), -3 - (i >> 1), 60, col, 4, 0.25);
                } else { lv.bump(tx, ty); sfx('bump'); }
            } else if (!byShell) sfx('bump');
            // enemies standing on a bumped block are knocked out
            for (var k = 0; k < ents.length; k++) {
                var e = ents[k];
                if (!e.alive || !e.enemy || e.dying || e.type === 'boss' || e.type === 'crusher' || e.type === 'plant') continue;
                if (Math.abs(e.y + e.h - cy) < 3 && e.x + e.w > tx * T && e.x < tx * T + T) { killFlip(e); comboScore(e.x, e.y); }
            }
            // items on top bounce
            for (k = 0; k < items.length; k++) if (items[k].alive && Math.abs(items[k].y + 16 - cy) < 3 && items[k].x + 16 > tx * T && items[k].x < tx * T + T) { items[k].vy = -3; items[k].vx = -items[k].vx; }
        },

        landOnPlatforms: function (a) {
            if (a.onGround || a.vy < 0) return;
            for (var i = 0; i < ents.length; i++) {
                var e = ents[i];
                if (!e.plat || !e.alive || !e.active) continue;
                if (a.x + a.w <= e.x || a.x >= e.x + e.w) continue;
                var top = e.y, prevTop = e.y - e.dy;
                if (a.lastBottom <= Math.max(top, prevTop) + 2 && a.y + a.h >= top) {
                    a.y = top - a.h; a.vy = 0; a.onGround = true; a.ride = e;
                    if (e.type === 'fallplat' && e.state === 0) { e.state = 1; e.t = 24; }
                    return;
                }
            }
        },

        groundPound: function (p) {
            W.shake(6); sfx('stomp', 0.7);
            var ty = ((p.y + p.h + 1) / T) | 0, l = (p.x / T) | 0, r = ((p.x + p.w - 1) / T) | 0;
            for (var tx = l; tx <= r; tx++) {
                var id = lv.rawTile(tx, ty);
                if (id === ID.BRICK && p.power > 0) W.hitBlock(tx, ty, true);
                else if (id === ID.QCOIN || id === ID.QPOW || id === ID.QSTAR || id === ID.MULTI) W.hitBlock(tx, ty, p.power > 0);
            }
            for (var i = 0; i < ents.length; i++) {
                var e = ents[i];
                if (e.alive && e.enemy && !e.dying && e.type !== 'boss' && e.type !== 'crusher' && e.type !== 'spiky' && e.onGround && Math.abs(e.x - p.x) < 40 && Math.abs(e.y + e.h - (p.y + p.h)) < 4) { killFlip(e); comboScore(e.x, e.y); }
            }
        },

        fire: function (p) {
            for (var i = 0; i < fireballs.length; i++) {
                var f = fireballs[i];
                if (f.alive) continue;
                f.alive = true; f.active = true; f.t = 0;
                f.x = p.x + (p.face > 0 ? p.w : -8); f.y = p.y + 4; f.vx = p.face * 3.6; f.vy = 1;
                sfx('fire');
                return;
            }
        },

        throwRock: function (x, y, vx, vy) {
            for (var i = 0; i < rocks.length; i++) {
                var r = rocks[i];
                if (r.alive) continue;
                r.alive = true; r.active = true; r.x = x; r.y = y; r.vx = vx; r.vy = vy;
                return;
            }
        },

        shellHits: function (sh) {
            for (var i = 0; i < ents.length; i++) {
                var e = ents[i];
                if (e === sh || !e.alive || !e.enemy || e.dying || !e.active || e.type === 'boss' || e.type === 'crusher' || e.type === 'rock') continue;
                if (Actors.overlap(sh, e)) { killFlip(e); comboScore(e.x, e.y); sfx('kick'); }
            }
        },

        hurt: function (p) {
            p = p || player;
            if (p.dead || p.inv > 0 || p.star > 0 || mode !== 'play') return;
            if (p.power > 0) {
                p.setPower(p.power === 2 ? 1 : 0);
                p.inv = 120;
                sfx('hurt');
            } else W.die(p);
        },

        // One life lost. With a partner still standing, the fallen player respawns above them;
        // when nobody is left, the stage restarts from the checkpoint (or it is game over).
        die: function (p) {
            p = p || player;
            if (p.dead || p.out || mode !== 'play') return;
            p.dead = true; p.vy = -5; p.vx = 0; p.star = 0; p.deadT = 0; p.gp = 0;
            p.lives--;
            sfx('die');
            if (anyAlive(p)) { p.respawnT = 150; return; }
            mode = 'dying'; modeT = 0;
            music(null);
        },

        starEnded: function () {
            for (var i = 0; i < players.length; i++) if (players[i].star > 0) return;
            music(SONGS[bossOn ? 'boss' : stage.music]);
        }
    };

    function spawnItem(kind, tx, ty) {
        sfx(kind === 'gem' || kind === 'leaf' ? 'sprout' : 'sprout');
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            if (it.alive) continue;
            it.alive = true; it.active = true; it.kind = kind; it.x = tx * T; it.y = ty * T; it.w = 16; it.h = 16;
            it.vx = kind === 'bloom' ? 0 : kind === 'gem' ? 1.2 : 0.9; it.vy = 0; it.rise = 16; it.onGround = false;
            if (player.x + 6 > tx * T + 8) it.vx = -it.vx;
            return;
        }
    }

    function killFlip(e) { e.dying = 1; e.vy = -3; e.vx = player.x < e.x ? 1 : -1; addScore(0); }

    /* ------------------------------------------------------------------ stage lifecycle */

    function freeLevel(keepArt) {
        if (!lv) return;
        if (keepArt) { var t = lv.tiles, b = lv.bg; lv.tiles = { atlas: { free: function () {} }, theme: t.theme }; lv.bg = null; lv.free(); return { tiles: t, bg: b }; }
        lv.free();
        lv = null;
        return null;
    }

    function enterStage(id) {
        stage = stageById(id);
        if (!stage) return;
        save.lastStage = id;
        cp = null;
        starGot = (save.stars[id] || [0, 0, 0]).slice();
        secretFound = false;
        mode = 'intro'; modeT = 0;
        music(null);
        if (mapInfo) mapInfo.hidden = true;
        setBanner(stageLabel(stage), stage.name);
        gk.announce(stageLabel(stage) + '. ' + stage.name);
        freeLevel(false);
        levelJson = null;
        var req = ++loadReq;
        var xhr = new XMLHttpRequest();
        xhr.open('GET', 'assets/levels/' + id + '.json', true);
        xhr.timeout = 10000;
        xhr.onload = function () {
            if (req !== loadReq) return;
            try { levelJson = JSON.parse(xhr.responseText); } catch (e) { levelJson = null; }
            if (!levelJson) return loadFailed();
        };
        xhr.onerror = xhr.ontimeout = function () { if (req === loadReq) loadFailed(); };
        xhr.send();
    }

    function loadFailed() {
        mode = 'loadfail'; modeT = 0;
        setBanner(s.loadFail, '');
        gk.announce(s.loadFail);
    }

    // (Re)builds the level from the stage JSON. keep = reuse the theme atlas (restart after death)
    function buildLevel(keep) {
        var art = keep ? freeLevel(true) : null;
        if (!art) {
            var theme = levelJson.properties.filter(function (p) { return p.name === 'theme'; })[0].value;
            art = { tiles: Art.buildTiles(theme), bg: Art.buildBackground(theme, Math.max(1, gk.q.parallax), gk.q.clouds) };
        }
        lv = new Level(levelJson, art.tiles, art.bg);
        ents = []; bossOn = false; leftWall = 0; goalEnt = null; combo = 0;
        var start = null;
        for (var i = 0; i < lv.objects.length; i++) {
            var o = lv.objects[i], t = o.type || o.class;
            if (t === 'start') { start = o; continue; }
            if (t === 'checkpoint' && lv.prop(o, 'assist', false) && !save.assist) continue;
            var e = Actors.make(o, lv);
            if (!e) continue;
            if (e.type === 'starcoin') {
                // star coins are numbered left to right
                e.idx = 0;
                for (var j = 0; j < lv.objects.length; j++) if ((lv.objects[j].type === 'starcoin') && lv.objects[j].x < o.x) e.idx++;
                e.had = !!(save.stars[stage.id] || [])[e.idx];
                if (starGot[e.idx] && !e.had) e.alive = false;   // collected before the checkpoint
            }
            if (e.type === 'checkpoint' && cp && cp.x === e.x) e.state = 1;
            ents.push(e);
        }
        var sx = cp ? cp.x : start.x, sy = cp ? cp.y + 16 : start.y + 16;
        for (i = 0; i < players.length; i++) {
            var pl = players[i];
            if (pl.out) continue;
            pl.reset();
            pl.h = pl.power ? 22 : 14;
            pl.x = sx + 2 + i * 18; pl.y = sy - pl.h;
            pl.face = 1;
        }
        player = firstAlive();
        time = lv.props.time || 300; timeTick = 0;
        for (i = 0; i < fireballs.length; i++) fireballs[i].alive = false;
        for (i = 0; i < rocks.length; i++) rocks[i].alive = false;
        for (i = 0; i < items.length; i++) items[i].alive = false;
        for (i = 0; i < pops.length; i++) pops[i].t = 0;
        for (i = 0; i < popups.length; i++) popups[i].t = 0;
        parts.clear();
        var area = lv.areaAt(player.x);
        cam.x = Math.max(area[0], Math.min(area[1] - 480, player.x - 180)); cam.look = 0;
        cam.y = lv.pxH - 270;
        mode = 'play'; modeT = 0;
        setBanner('');
        music(SONGS[stage.music]);
        gk.perfGrace(90);
    }

    function stageClear(secret) {
        mode = 'clear'; modeT = 0; tally = 0;
        music(SONGS.clear);
        setBanner(secret ? s.secret : s.clear, '');
        gk.announce(secret ? s.secret : s.clear);
        var id = stage.id;
        save.cleared[id] = true;
        var st = save.stars[id] || [0, 0, 0];
        for (var i = 0; i < 3; i++) st[i] = st[i] || starGot[i];
        save.stars[id] = st;
        var idx = stages.indexOf(stage), next = stages[idx + 1];
        if (next && (next.world === stage.world || stage.fortress)) save.unlocked[next.id] = true;
        if (secret) { save.secrets[id] = true; save.unlocked['w' + stage.world + '-5'] = true; }
        save.lastStage = next && save.unlocked[next.id] && next.world === stage.world ? next.id : id;
        if (stage.fortress && next) save.lastStage = next.id;
        for (i = 0; i < players.length; i++) if (players[i].out || players[i].lives < 1) { players[i].out = false; players[i].lives = Math.max(1, players[i].lives); }
        if (!next) submitScores(false);   // last fortress: the run is complete
    }

    // Top-10 tables (the launcher asks for initials). reset = after a game over.
    function submitScores(reset) {
        for (var i = 0; i < players.length; i++) {
            var q = players[i];
            gk.submitScore(q.score, { player: q.slot, players: players.length });
            if (reset) { q.score = 0; q.lives = 5; q.out = false; }
        }
        if (reset) coins = 0;
    }

    function toMap(focusId) {
        freeLevel(false);
        levelJson = null;
        loadReq++;
        saveP1();
        var st = stageById(focusId || save.lastStage) || stages[0];
        mapW = st.world; mapN = st.n;
        mode = 'map'; modeT = 0;
        for (var i = 0; i < players.length; i++) { players[i].reset(); players[i].out = false; players[i].lives = Math.max(1, players[i].lives); }
        player = players[0];
        setBanner('');
        music(SONGS.map);
        announceNode(true);
        updateHud(true);
    }

    function saveP1() {
        if (!save || !players[0]) return;
        save.lives = players[0].lives; save.score = players[0].score; save.coins = coins;
        persist();
    }

    /* ------------------------------------------------------------------ 2-player co-op */

    // Turned on from the pause menu by P1 (whose device becomes P1's); P2 joins by pressing
    // OK / A on any other device: TV remote, WASD keys, or another gamepad.
    function askJoin() {
        p1Dev = gk.lastDevice();
        joinWait = 900;
        setBanner(s.twoP, s.p2Join);
        gk.announce(s.p2Join);
    }
    function checkJoin() {
        if (!joinWait) return;
        if (--joinWait <= 0) { setBanner(''); return; }
        var devs = gk.edgeDevices('jump').concat(gk.edgeDevices('confirm'));
        for (var i = 0; i < devs.length; i++) if (devs[i] !== p1Dev) return join(devs[i]);
    }
    function join(dev) {
        joinWait = 0;
        var p2 = new Actors.Player(2);
        p2.dev = dev; players[0].dev = p1Dev;
        players[1] = p2; twoP = true;
        if (lv && (mode === 'play' || mode === 'pipe')) respawn(p2);
        else p2.dead = false;
        setBanner('');
        sfx('oneup');
        gk.announce(s.p2Joined);
    }
    function leave() {
        players.length = 1; twoP = false; joinWait = 0;
        players[0].dev = null;
        player = players[0];
        gk.announce(s.p2Left);
    }
    // a fallen player comes back above the partner
    function respawn(p) {
        var mate = anyAlive(p) || players[0];
        p.reset(); p.power = 0; p.h = 14;
        p.x = mate.x; p.y = Math.max(cam.y + 8, mate.y - 40); p.vy = 0;
        p.inv = 150;
        sfx('sprout');
    }

    /* ------------------------------------------------------------------ world map */

    function nodeId(w, n) { return 'w' + w + '-' + n; }
    function nodeText(st) {
        var t = stageLabel(st) + ', ' + st.name;
        if (!save.unlocked[st.id]) return t + ', ' + s.locked;
        var stars = save.stars[st.id] || [0, 0, 0], n = stars[0] + stars[1] + stars[2];
        if (save.cleared[st.id]) t += ', ' + s.cleared;
        return t + ', ' + n + ' ' + s.of + ' 3 ' + s.starCoins;
    }
    function announceNode(withHelp) {
        var st = stageById(nodeId(mapW, mapN));
        var text = s.world + ' ' + mapW + ': ' + s.worlds[mapW - 1] + '. ' + nodeText(st);
        mapInfo.innerHTML = '';
        var h = document.createElement('div'); h.className = 'map-title'; h.textContent = s.world + ' ' + mapW + ' · ' + s.worlds[mapW - 1];
        var d = document.createElement('div'); d.className = 'map-stage'; d.textContent = stageLabel(st) + '  ' + st.name;
        var stars = save.stars[st.id] || [0, 0, 0];
        var sc = document.createElement('div'); sc.className = 'map-stars';
        sc.textContent = save.unlocked[st.id] ? (stars[0] ? '★' : '☆') + (stars[1] ? '★' : '☆') + (stars[2] ? '★' : '☆') : s.locked;
        var hp = document.createElement('div'); hp.className = 'map-help'; hp.textContent = s.mapHelp;
        mapInfo.appendChild(h); mapInfo.appendChild(d); mapInfo.appendChild(sc); mapInfo.appendChild(hp);
        mapInfo.hidden = false;
        gk.announce(withHelp ? text + '. ' + s.mapHelp : text);
    }

    function updateMap() {
        var moved = false;
        if (joinWait) return;
        if (gk.pressed('right') && mapN < 5 && save.unlocked[nodeId(mapW, mapN + 1)]) { mapN++; moved = true; }
        else if (gk.pressed('left') && mapN > 1) { mapN--; moved = true; }
        else if (gk.pressed('down') && mapW < 3 && worldUnlocked(mapW + 1)) { mapW++; mapN = 1; moved = true; }
        else if (gk.pressed('up') && mapW > 1) { mapW--; mapN = 1; moved = true; }
        else if (gk.pressed('runToggle')) toggleRun();
        if (moved) { sfx('blip'); announceNode(false); }
        if ((gk.pressed('confirm') || gk.pressed('jump')) && save.unlocked[nodeId(mapW, mapN)]) {
            sfx('pipe');
            mapInfo.hidden = true;
            enterStage(nodeId(mapW, mapN));
        }
    }

    function mapNodePos(n) { return { x: 50 + (n - 1) * 95, y: 175 + (n % 2 ? 0 : -26) }; }

    function drawMap(c) {
        var col = WORLD_COLORS[mapW - 1], i, p, q;
        c.fillStyle = col[0]; c.fillRect(0, 0, 480, 270);
        c.fillStyle = col[1];
        for (i = 0; i < 12; i++) c.fillRect((i * 53 + 20) % 480, 120 + (i * 37) % 140, 18, 8);
        // path
        for (i = 1; i < 5; i++) {
            p = mapNodePos(i); q = mapNodePos(i + 1);
            var open = save.unlocked[nodeId(mapW, i + 1)];
            c.fillStyle = open ? '#f6e7b0' : 'rgba(0,0,0,0.25)';
            for (var k = 0; k <= 10; k++) c.fillRect(p.x + (q.x - p.x) * k / 10 - 2, p.y + (q.y - p.y) * k / 10 - 2, 5, 5);
        }
        for (i = 1; i <= 5; i++) {
            var id = nodeId(mapW, i), st = stageById(id);
            p = mapNodePos(i);
            var unlocked = save.unlocked[id], done = save.cleared[id];
            c.fillStyle = '#1a1423'; c.fillRect(p.x - 11, p.y - 9, 22, 18);
            c.fillStyle = !unlocked ? '#8a8a9a' : done ? '#4cd97b' : '#ffd23f';
            c.fillRect(p.x - 10, p.y - 8, 20, 16);
            if (st.fortress) {   // small keep
                c.fillStyle = '#1a1423'; c.fillRect(p.x - 9, p.y - 26, 18, 18);
                c.fillStyle = '#8d93a6'; c.fillRect(p.x - 8, p.y - 25, 16, 17);
                c.fillStyle = '#1a1423'; c.fillRect(p.x - 2, p.y - 15, 4, 7); c.fillRect(p.x - 8, p.y - 29, 4, 4); c.fillRect(p.x - 2, p.y - 29, 4, 4); c.fillRect(p.x + 4, p.y - 29, 4, 4);
            }
            var stars = save.stars[id] || [0, 0, 0];
            for (var j = 0; j < 3; j++) { c.fillStyle = stars[j] ? '#ffd23f' : 'rgba(0,0,0,0.3)'; c.fillRect(p.x - 9 + j * 7, p.y + 12, 5, 5); }
            if (save.secrets[id]) { c.fillStyle = '#ff5d73'; c.fillRect(p.x + 8, p.y - 12, 5, 5); }
        }
        p = mapNodePos(mapN);
        var f = sprites.f['hs_normal_stand_r'], bob = (gk.frame >> 4) & 1;
        c.drawImage(sprites.c, f.x, f.y, 16, 16, p.x - (twoP ? 14 : 8), p.y - 24 - bob, 16, 16);
        if (twoP) { f = sprites.f['hs_normal2_stand_l']; c.drawImage(sprites.c, f.x, f.y, 16, 16, p.x - 2, p.y - 24 - (1 - bob), 16, 16); }
    }

    /* ------------------------------------------------------------------ main update */

    // 1 player: any device drives the hero. 2 players: each hero reads only its own device.
    function inputs(p) {
        var autoRun = save.autoRun, d = twoP ? p.dev : null;
        var down = d ? function (a) { return gk.isDownBy(d, a); } : gk.isDown;
        var hit = d ? function (a) { return gk.pressedBy(d, a); } : gk.pressed;
        var o = p.inp || (p.inp = {});
        o.left = down('left'); o.right = down('right'); o.down = down('down');
        o.run = down('run') || autoRun; o.jump = down('jump'); o.jumpPressed = hit('jump');
        o.downPressed = hit('down'); o.firePressed = hit('run') || hit('up');
        return o;
    }

    function toggleRun() {
        save.autoRun = !save.autoRun; persist();
        gk.announce(save.autoRun ? s.runOn : s.runOff);
    }

    function stomping(p, e) { return p.vy > 0 && p.lastBottom <= e.y + 6; }

    function stompBounce() { var j = player.inp && player.inp.jump; player.vy = j ? -5.6 : -3.8; player.jumping = !!j; hitstop = 3; W.shake(2); }

    function interact() {
        var p = player;
        for (var i = 0; i < ents.length; i++) {
            var e = ents[i];
            if (!e.alive || !e.active || e.dying) continue;
            if (!Actors.overlap(p, e)) continue;
            switch (e.type) {
                case 'walker': case 'snail': case 'flyer': case 'thrower':
                    if (p.star > 0) { killFlip(e); comboScore(e.x, e.y); sfx('kick'); }
                    else if (stomping(p, e) || p.gp) {
                        sfx('stomp'); comboScore(e.x, e.y); stompBounce();
                        if (e.type === 'walker') { e.dying = 30; e.flat = true; }
                        else if (e.type === 'snail') { e.type = 'shell'; e.vx = 0; e.y += 2; e.h = 12; e.kickT = 0; }
                        else if (e.type === 'flyer') { e.type = 'walker'; e.vx = -0.5; e.vy = 0; }
                        else killFlip(e);
                        for (var k = 0; k < 6; k++) parts.add(e.x + 6, e.y + 4, (k - 2.5) * 0.5, -1 - (k & 1), 18, '#ffffff', 2, 0.1);
                    } else W.hurt(p);
                    break;
                case 'spiky': case 'plant': case 'rock':
                    if (e.type === 'plant' && e.state === 0) break;
                    if (p.star > 0) { killFlip(e); comboScore(e.x, e.y); } else W.hurt(p);
                    break;
                case 'shell':
                    if (e.vx === 0) {
                        e.vx = (p.x + p.w / 2 < e.x + e.w / 2 ? 1 : -1) * 4; e.kickT = 14;
                        sfx('kick'); addScore(400, e.x, e.y);
                        if (stomping(p, e)) stompBounce();
                    } else if (stomping(p, e)) { e.vx = 0; sfx('stomp'); stompBounce(); }
                    else if (p.star > 0) { killFlip(e); comboScore(e.x, e.y); }
                    else if (!(e.kickT > 0)) W.hurt(p);
                    break;
                case 'crusher':
                    if (p.lastBottom > e.y + 4 && e.state === 1) W.hurt(p);
                    break;
                case 'boss':
                    if (e.hurtT > 0) break;
                    if (stomping(p, e) || p.gp) {
                        e.hp--; e.hurtT = 70; sfx('boss'); W.shake(10); hitstop = 6;
                        player.vy = -6; player.gp = 0;
                        gk.announce(s.bossHit);
                        if (e.hp <= 0) { e.dying = 1; e.vy = -4; music(null); addScore(5000, e.x, e.y); }
                    } else W.hurt(p);
                    break;
                case 'starcoin':
                    e.alive = false; starGot[e.idx] = 1;
                    sfx('oneup'); addScore(1000, e.x, e.y);
                    for (k = 0; k < 10; k++) parts.add(e.x + 8, e.y + 8, Math.cos(k) * 2, Math.sin(k) * 2, 30, '#ffd23f', 3, 0);
                    break;
                case 'checkpoint':
                    if (e.state === 0) {
                        e.state = 1; cp = { x: e.x, y: e.y + 16 };
                        sfx('check'); gk.announce(s.checkpoint);
                        if (p.power === 0) p.setPower(1);
                    }
                    break;
                case 'spring':
                    if (p.vy > 0 && p.lastBottom <= e.y + 8) { p.y = e.y + 6 - p.h; p.vy = p.inp && p.inp.jump ? -10 : -7.5; p.jumping = false; e.t = 10; sfx('spring'); }
                    break;
            }
            if (player.dead) return;
        }
        for (i = 0; i < items.length; i++) {
            var it = items[i];
            if (!it.alive || it.rise > 0 || !Actors.overlap(p, it)) continue;
            it.alive = false;
            addScore(1000, it.x, it.y);
            if (it.kind === 'berry') { sfx('power'); if (p.power === 0) p.setPower(1); }
            else if (it.kind === 'bloom') { sfx('power'); p.setPower(2); }
            else if (it.kind === 'gem') { p.star = 600; music(SONGS.star); sfx('power'); }
            else if (it.kind === 'leaf') oneUp(it.x, it.y);
        }
        for (i = 0; i < rocks.length; i++) {
            var r = rocks[i];
            if (r.alive && Actors.overlap(p, r)) { if (p.star) r.alive = false; else W.hurt(p); }
        }
    }

    function updateFireballs() {
        for (var i = 0; i < fireballs.length; i++) {
            var f = fireballs[i];
            if (!f.alive) continue;
            f.vy = Math.min(4, f.vy + 0.35);
            Actors.moveX(f, lv);
            if (f.hitWall || ++f.t > 150 || f.x < cam.x - 16 || f.x > cam.x + 496) { f.alive = false; puff(f.x, f.y); continue; }
            Actors.moveY(f, lv, null);
            if (f.onGround) f.vy = -3.2;
            if (lv.waterAt(f.x + 4, f.y + 4)) { f.alive = false; continue; }
            for (var k = 0; k < ents.length; k++) {
                var e = ents[k];
                if (!e.alive || !e.enemy || e.dying || !e.active || e.type === 'crusher' || e.type === 'boss') continue;
                if (e.type === 'plant' && e.state === 0) continue;
                if (Actors.overlap(f, e)) { killFlip(e); addScore(200, e.x, e.y); f.alive = false; puff(f.x, f.y); sfx('kick'); break; }
            }
        }
    }
    function puff(x, y) { for (var k = 0; k < 4; k++) parts.add(x + 4, y + 4, (k - 1.5) * 0.6, -0.6, 12, '#ffb21a', 2, 0); }

    function updateEnts() {
        var lo = cam.x - 96, hi = cam.x + 480 + 64;
        for (var i = 0; i < ents.length; i++) {
            var e = ents[i];
            if (!e.alive) continue;
            var inView = e.x + e.w > lo && e.x < hi;
            if (!e.active) { if (inView || e.type === 'goal' || e.type === 'bossdoor') e.active = true; else continue; }
            if (!inView && e.enemy && e.type !== 'boss') continue;    // frozen off-screen (saves CPU)
            if (e.dying) {
                if (e.flat) { if (--e.dying <= 0) e.alive = false; }
                else { e.vy += 0.3; e.y += e.vy; e.x += e.vx; if (e.y > lv.pxH + 32) { e.alive = false; if (e.type === 'boss') stageClear(false); } }
                continue;
            }
            if (e.type === 'spring') { if (e.t > 0) e.t--; continue; }
            var fn = Actors.UPDATE[e.type];
            if (fn) fn(e, W);
            if (e.enemy && e.y > lv.pxH + 32) e.alive = false;
        }
        for (i = 0; i < rocks.length; i++) if (rocks[i].alive) Actors.UPDATE.rock(rocks[i], W);
        for (i = 0; i < items.length; i++) if (items[i].alive) Actors.UPDATE.item(items[i], W);
    }

    // Follows the hero (or the middle of both heroes). In 2-player mode nobody can leave the screen:
    // the camera stays between both, and the screen edges act as walls.
    function updateCamera() {
        var n = 0, sx = 0, sy = 0, vx = 0, ground = false, lo = 1e9, hi = -1e9, i, p;
        for (i = 0; i < players.length; i++) {
            p = players[i];
            if (p.out || (p.dead && players.length > 1)) continue;
            n++; sx += p.x + p.w / 2; sy += p.y; vx += p.vx; ground = ground || p.onGround;
            lo = Math.min(lo, p.x); hi = Math.max(hi, p.x + p.w);
        }
        if (!n) return;
        sx /= n; sy /= n; vx /= n;
        var area = lv.areaAt(sx);
        var lookTarget = Math.abs(vx) > 0.5 ? (vx > 0 ? 50 : -30) : cam.look * 0.98;
        cam.look += (lookTarget - cam.look) * 0.03;
        var tx = sx - 240 + (n > 1 ? 0 : cam.look);
        cam.x += (tx - cam.x) * 0.12;
        if (n > 1) { cam.x = Math.max(cam.x, hi - 480 + 24); cam.x = Math.min(cam.x, lo - 24); }
        var minX = area[0] + leftWall, maxX = area[1] - 480;
        if (bossOn) minX = Math.max(minX, area[1] - 480);
        if (cam.x < minX) cam.x = minX;
        if (cam.x > maxX) cam.x = Math.max(minX, maxX);
        if (n > 1) for (i = 0; i < players.length; i++) {
            p = players[i];
            if (p.out || p.dead) continue;
            if (p.x < cam.x) { p.x = cam.x; if (p.vx < 0) p.vx = 0; }
            if (p.x + p.w > cam.x + 480) { p.x = cam.x + 480 - p.w; if (p.vx > 0) p.vx = 0; }
        }
        // vertical: stay at the bottom unless the heroes climb high or swim
        var bottom = lv.pxH - 270, ty = Math.min(bottom, sy - 90);
        if (ground || ty < cam.y - 20 || ty > cam.y) cam.y += (ty - cam.y) * 0.08;
        if (cam.y < 0) cam.y = 0;
        if (cam.y > bottom) cam.y = bottom;
    }

    function checkGoalAndWarps(p) {
        player = p;
        for (var i = 0; i < ents.length; i++) {
            var e = ents[i];
            if (!e.alive) continue;
            if (e.type === 'goal' && p.x + p.w > e.x + 5 && p.x < e.x + 11 && p.y < e.ground) {
                goalEnt = e;
                var frac = Math.max(0, Math.min(1, (e.ground - (p.y + p.h)) / e.h));
                var bonus = frac > 0.9 ? 5000 : frac > 0.65 ? 2000 : frac > 0.4 ? 800 : frac > 0.15 ? 400 : 100;
                addScore(bonus, e.x, p.y);
                goalFlagY = e.y + 4;
                p.x = e.x + 2; p.vx = 0; p.vy = 0; p.star = 0;
                mode = 'goal'; modeT = 0;
                music(null); sfx('goal');
                if (e.secret) secretFound = true;
                return;
            }
            if (e.type === 'warp' && p.onGround && p.inp && p.inp.down && p.x >= e.x - 2 && p.x + p.w <= e.x + e.w + 2 && Math.abs(p.y + p.h - (e.y + 2)) < 3) {
                mode = 'pipe'; modeT = 0; pipeTarget = e; sfx('pipe');
                return;
            }
            if (e.type === 'bossdoor' && !bossOn && p.x > e.x + 40) {
                bossOn = true; leftWall = e.x + 16 - lv.areaAt(p.x)[0];
                music(SONGS.boss);
                for (var k = 0; k < ents.length; k++) if (ents[k].type === 'boss') ents[k].active = true;
            }
        }
    }

    function updatePlay() {
        if (hitstop > 0) { hitstop--; return; }
        if (gk.pressed('runToggle')) toggleRun();
        var i, p, grounded = true;
        for (i = 0; i < players.length; i++) {
            p = players[i];
            if (p.out) continue;
            if (p.dead) { fallen(p); continue; }
            player = p;
            p.update(W, inputs(p));
            if (mode !== 'play') return;
        }
        target = firstAlive();
        updateEnts();
        updateFireballs();
        for (i = 0; i < players.length; i++) {
            p = players[i];
            if (p.out || p.dead) continue;
            player = p;
            interact();
            if (mode !== 'play') return;
            if (!p.onGround || p.gp) grounded = false;
        }
        if (grounded) combo = 0;
        for (i = 0; i < players.length && mode === 'play'; i++) if (!players[i].out && !players[i].dead) checkGoalAndWarps(players[i]);
        if (mode !== 'play') return;
        player = firstAlive();
        updateCamera();
        // timer (assist mode: slower)
        if (++timeTick >= (save.assist ? 64 : 40)) {
            timeTick = 0; time--;
            if (time === 100) { sfx('check'); gk.announce(s.hurry); }
            if (time <= 0) { time = 0; for (i = 0; i < players.length; i++) W.die(players[i]); }
        }
    }

    // a fallen player in 2-player mode: falls off the screen, then respawns (or sits out)
    function fallen(p) {
        p.deadT++;
        if (p.deadT > 30) { p.vy += 0.25; p.y += p.vy; }
        if (p.respawnT > 0 && --p.respawnT === 0) {
            if (p.lives > 0 && anyAlive(p)) { respawn(p); gk.announce(NAMES[p.slot] + ' ' + s.p2Back); }
            else p.out = true;
        }
    }

    function common() {
        if (lv) lv.update();
        parts.update();
        for (var i = 0; i < pops.length; i++) if (pops[i].t > 0) { pops[i].t--; pops[i].y += pops[i].vy; pops[i].vy += 0.3; }
        for (i = 0; i < popups.length; i++) if (popups[i].t > 0) { popups[i].t--; popups[i].y -= 0.5; }
        if (shakeT > 0) shakeT--;
    }

    var def = {
        pixelArt: true,
        load: function (g, progress, done, fail) {
            gk = g;
            s = STR[g.lang] || STR.en;
            document.body.className = 'pixel';
            progress(0.1);
            var xhr = new XMLHttpRequest();
            xhr.open('GET', 'assets/levels/index.json', true);
            xhr.timeout = 10000;
            xhr.onload = function () {
                try { stages = JSON.parse(xhr.responseText).stages; } catch (e) { return fail('index.json'); }
                progress(0.4);
                sprites = Art.buildSprites();
                progress(0.8);
                save = g.load('progress', null) || defaultSave();
                var d = defaultSave();
                for (var k in d) if (save[k] === undefined) save[k] = d[k];
                done();
            };
            xhr.onerror = xhr.ontimeout = function () { fail('index.json'); };
            xhr.send();
        },
        start: function (g) {
            players = [new Actors.Player(1)];
            player = target = players[0];
            parts = new GK.Particles(g.q.particles);
            var i;
            for (i = 0; i < 2; i++) { var f = new Actors.Ent('fireball', 0, 0, 8, 8); f.alive = false; fireballs.push(f); }
            for (i = 0; i < 6; i++) { var r = new Actors.Ent('rock', 0, 0, 8, 8); r.alive = false; r.enemy = true; rocks.push(r); }
            for (i = 0; i < 6; i++) { var it = new Actors.Ent('item', 0, 0, 16, 16); it.alive = false; items.push(it); }
            for (i = 0; i < 8; i++) pops.push({ x: 0, y: 0, vy: 0, t: 0 });
            for (i = 0; i < 8; i++) popups.push({ x: 0, y: 0, text: '', t: 0 });
            players[0].lives = save.lives > 0 ? save.lives : 5; players[0].score = save.score || 0; coins = save.coins || 0;
            hud = GK.hud([['world', ''], ['lives', s.lives], ['coins', s.coins], ['stars', ''], ['score', s.score], ['time', s.time]]);
            mapInfo = document.getElementById('mapinfo');
            document.body.className = 'pixel' + (save.hc ? ' hc' : '');
            toMap();
        },
        update: function (g) {
            modeT++;
            common();
            if (joinWait && mode !== 'intro' && mode !== 'load') checkJoin();
            switch (mode) {
                case 'map': updateMap(); break;
                case 'intro':
                    if (modeT >= 70 && levelJson) buildLevel(false);
                    break;
                case 'loadfail': if (modeT > 150) toMap(stage.id); break;
                case 'play': updatePlay(); break;
                case 'pipe':
                    player.y += 0.8;
                    if (modeT === 30) {
                        var tg = pipeTarget;
                        // everybody goes through the pipe together
                        for (var q = 0; q < players.length; q++) {
                            var pq = players[q];
                            if (pq.out) continue;
                            if (pq.dead) respawn(pq);
                            pq.x = tg.tx + 2 + q * 14; pq.y = tg.ty + 16 - pq.h; pq.vx = pq.vy = 0;
                        }
                        var area = lv.areaAt(player.x);
                        cam.x = Math.max(area[0], Math.min(area[1] - 480, player.x - 200));
                        mode = 'play'; modeT = 0;
                    }
                    break;
                case 'dying':
                    for (var dq = 0; dq < players.length; dq++) {
                        var dp = players[dq];
                        if (dp.dead && !dp.out) { dp.deadT++; if (dp.deadT > 30) { dp.vy += 0.25; dp.y += dp.vy; } }
                    }
                    if (modeT === 150) {
                        var left = 0;
                        for (dq = 0; dq < players.length; dq++) {
                            players[dq].out = players[dq].lives <= 0;
                            if (!players[dq].out) { left++; players[dq].power = 0; }
                        }
                        if (!left) {
                            mode = 'gameover'; modeT = 0;
                            setBanner(s.gameOver, ''); gk.announce(s.gameOver);
                            music(SONGS.gameover);
                            submitScores(true);
                        } else buildLevel(true);
                    }
                    break;
                case 'gameover':
                    if (modeT > 260 || (modeT > 60 && (g.pressed('confirm') || g.pressed('jump')))) toMap(stage.id);
                    break;
                case 'goal':
                    if (player.y + player.h < goalEnt.ground) player.y = Math.min(goalEnt.ground - player.h, player.y + 2);
                    if (goalFlagY < goalEnt.ground - 16) goalFlagY += 2;
                    if (modeT > 70) {
                        player.face = 1; player.vx = 1.1; player.walkT += 1.6;
                        Actors.moveX(player, lv); player.vy = Math.min(4, player.vy + 0.4); Actors.moveY(player, lv, null);
                    }
                    updateCamera();
                    if (modeT > 150) stageClear(secretFound);
                    break;
                case 'clear':
                    if (modeT > 60 && time > 0) { var n = Math.min(time, 3); time -= n; addScore(n * 50); if ((modeT & 3) === 0) sfx('tick'); }
                    if (modeT > 60 && time <= 0) { if (!tally) tally = modeT; if (modeT - tally > 90) toMap(); }
                    break;
            }
            updateHud(false);
        },
        render: function (g) {
            var c = g.ctx;
            if (mode === 'map' || !lv) {
                drawMap(c);
                if (mode !== 'map') { c.fillStyle = 'rgba(10,10,30,0.85)'; c.fillRect(0, 0, 480, 270); }
                return;
            }
            var sc = g.scale, ox = 0, oy = 0;
            if (shakeT > 0) { ox = (Math.random() - 0.5) * shakeAmp * 2; oy = (Math.random() - 0.5) * shakeAmp * 2; }
            var cx = Math.round((cam.x + ox) * sc) / sc, cy = Math.round((cam.y + oy) * sc) / sc;
            lv.drawBackground(c, cx, cy, g.q, g.frame);
            if (mode === 'pipe') drawPlayers(c, cx, cy, g.frame);
            lv.drawTiles(c, cx, cy);
            lv.drawDynamic(c, cx, cy, g.frame, 0, sprites);
            drawEnts(c, cx, cy, g.frame);
            if (mode !== 'pipe') drawPlayers(c, cx, cy, g.frame);
            drawFx(c, cx, cy);
            lv.drawDynamic(c, cx, cy, g.frame, 1, sprites);
        },
        menuItems: function () {
            var items = [];
            if (mode !== 'map') { items.push({ id: 'restart', label: s.restartStage }); items.push({ id: 'map', label: s.worldMap }); }
            items.push({ id: '2p', label: s.twoP + ': ' + (twoP ? s.on : s.off) });
            items.push({ id: 'assist', label: s.assist + ': ' + (save.assist ? s.on : s.off) });
            items.push({ id: 'run', label: s.autoRun + ': ' + (save.autoRun ? s.on : s.off) });
            items.push({ id: 'hc', label: s.contrast + ': ' + (save.hc ? s.on : s.off) });
            return items;
        },
        onMenu: function (g, id) {
            if (id === 'restart') {
                if (mode === 'play' || mode === 'pipe' || mode === 'goal') { cp = null; starGot = (save.stars[stage.id] || [0, 0, 0]).slice(); enterStage(stage.id); }
                return;
            }
            if (id === 'map') { mapInfo.hidden = true; toMap(stage && stage.id); return; }
            if (id === '2p') {
                if (twoP || joinWait) { joinWait = 0; setBanner(''); if (twoP) leave(); return 'stay'; }
                askJoin();
                return;    // close the menu so player 2 can press OK / A
            }
            if (id === 'assist') save.assist = !save.assist;
            if (id === 'run') save.autoRun = !save.autoRun;
            if (id === 'hc') { save.hc = !save.hc; document.body.className = 'pixel' + (save.hc ? ' hc' : ''); }
            persist();
            return 'stay';
        },
        onQuality: function (g, level) {
            if (lv && lv.bg && level >= 1 && lv.bg.layers.length > g.q.parallax) { /* fewer layers drawn from now on */ }
        },
        pause: function () { saveP1(); },
        destroy: function () {
            saveP1();
            loadReq++;
            freeLevel(false);
            if (sprites) sprites.free();
            sprites = null; ents = []; levelJson = null; stages = [];
        }
    };

    /* ------------------------------------------------------------------ drawing */

    function spr(c, name, x, y) {
        var f = sprites.f[name];
        if (f) c.drawImage(sprites.c, f.x, f.y, f.w, f.h, x | 0, y | 0, f.w, f.h);
    }

    function drawPlayers(c, cx, cy, frame) {
        for (var i = players.length - 1; i >= 0; i--) if (!players[i].out) drawPlayer(c, cx, cy, frame, players[i]);
    }

    function drawPlayer(c, cx, cy, frame, p) {
        if (p.dead) { spr(c, 'hero_die', p.x - 2 - cx, p.y - cy); return; }
        if (p.inv > 0 && (frame >> 1) & 1) return;
        var big = p.h > 14 || (p.growT > 0 && p.power > 0 && !p.crouch);
        var name = p.frame(frame);
        var h = name.charAt(1) === 'b' ? 24 : 16;
        spr(c, name, p.x - 2 - cx, p.y + p.h - h - cy);
        if (p.star > 0 && (frame & 3) === 0 && parts.n < parts.max - 2) parts.add(p.x + Math.random() * 12, p.y + Math.random() * p.h, 0, -0.3, 14, '#fff6a0', 2, 0);
        return big;
    }

    function drawEnts(c, cx, cy, frame) {
        var i, e, a = (frame >> 3) & 1;
        for (i = 0; i < ents.length; i++) {
            e = ents[i];
            if (!e.alive) continue;
            var x = e.x - cx, y = e.y - cy;
            if (x < -64 || x > 500) continue;
            switch (e.type) {
                case 'walker': spr(c, e.flat ? 'flat' : (a ? 'blorp1' : 'blorp2') + (e.face > 0 ? '_r' : '_l'), x - 2, y - 4); break;
                case 'flyer':
                    spr(c, 'blorp1' + (e.face > 0 ? '_r' : '_l'), x - 2, y - 4);
                    spr(c, a ? 'wing1' : 'wing2', x - 6, y - 2); spr(c, a ? 'wing1' : 'wing2', x + 10, y - 2);
                    break;
                case 'snail': spr(c, (a ? 'snail1' : 'snail2') + (e.face > 0 ? '_r' : '_l'), x - 2, y - 2); break;
                case 'shell': spr(c, 'shell', x - 2, y - 4); break;
                case 'spiky': spr(c, (a ? 'spiky1' : 'spiky2') + (e.face > 0 ? '_r' : '_l'), x - 2, y - 4); break;
                case 'thrower': spr(c, 'thrower' + (e.face > 0 ? '_r' : '_l'), x - 2, y - 2); break;
                case 'plant':
                    if (e.state !== 0) {
                        // drawn behind the pipe: clip to above the pipe mouth
                        c.save(); c.beginPath(); c.rect(x - 4, e.top - 40 - cy, 24, 40); c.clip();
                        spr(c, a ? 'plant1' : 'plant2', x - 2, y);
                        c.restore();
                    }
                    break;
                case 'crusher': spr(c, 'crusher', x, y); break;
                case 'platform': spr(c, 'platform', x, y); break;
                case 'fallplat': spr(c, 'fallplat', x + (e.state === 1 ? ((frame & 2) - 1) : 0), y); break;
                case 'spring': spr(c, e.t > 0 ? 'spring1' : 'spring0', x, y); break;
                case 'starcoin':
                    if (e.had) c.globalAlpha = 0.45;
                    spr(c, 'star', x, y + Math.sin(frame * 0.08) * 2);
                    c.globalAlpha = 1;
                    break;
                case 'checkpoint': spr(c, e.state ? 'cpflag1' : 'cpflag0', x, y); break;
                case 'bossdoor': spr(c, 'door', x, y); break;
                case 'goal':
                    c.fillStyle = '#1a1423'; c.fillRect(x + 6, y, 4, e.ground - e.y);
                    c.fillStyle = e.secret ? '#ff5d73' : '#e6e9ff'; c.fillRect(x + 7, y, 2, e.ground - e.y);
                    c.fillStyle = '#ffd23f'; c.fillRect(x + 4, y - 6, 8, 8);
                    spr(c, 'flag', x - 8, (goalEnt === e ? goalFlagY : e.y + 4) - cy);
                    c.fillStyle = '#1a1423'; c.fillRect(x + 2, e.ground - cy - 6, 12, 6);
                    break;
                case 'boss':
                    if (!e.dying && e.hurtT > 0 && (frame >> 2) & 1) spr(c, 'boss' + e.variant + '_hurt', x - 2, y - 4);
                    else spr(c, 'boss' + e.variant + '_' + a + (e.face > 0 ? '_r' : '_l'), x - 2, y - 4);
                    break;
            }
        }
        for (i = 0; i < items.length; i++) {
            e = items[i];
            if (!e.alive) continue;
            if (e.rise > 0) {   // emerging from the block
                c.save(); c.beginPath(); c.rect(e.x - cx, e.y - cy - 16, 16, 16 + (16 - e.rise)); c.clip();
                spr(c, e.kind, e.x - cx, e.y - cy); c.restore();
            } else spr(c, e.kind, e.x - cx, e.y - cy);
        }
        for (i = 0; i < rocks.length; i++) if (rocks[i].alive) spr(c, 'rock', rocks[i].x - cx, rocks[i].y - cy);
        for (i = 0; i < fireballs.length; i++) if (fireballs[i].alive) spr(c, 'fireball', fireballs[i].x - cx, fireballs[i].y - cy);
    }

    function drawFx(c, cx, cy) {
        var i;
        for (i = 0; i < pops.length; i++) if (pops[i].t > 0) {
            var f = sprites.f['coin' + [0, 1, 2, 1][(pops[i].t >> 2) & 3]];
            c.drawImage(sprites.c, f.x, f.y, f.w, f.h, (pops[i].x - cx) | 0, (pops[i].y - cy) | 0, f.w, f.h);
        }
        parts.draw(c, cx, cy);
        for (i = 0; i < popups.length; i++) if (popups[i].t > 0) {
            GK.text(c, popups[i].text, popups[i].x - cx + 1, popups[i].y - cy + 1, 7, '#1a1423', 'left');
            GK.text(c, popups[i].text, popups[i].x - cx, popups[i].y - cy, 7, '#ffffff', 'left');
        }
    }

    /* ------------------------------------------------------------------ HUD */

    function updateHud(force) {
        var inStage = mode !== 'map' && stage;
        gk.setText(hud.world, inStage ? stageLabel(stage) : s.world + ' ' + mapW);
        var a = players[0], b = players[1];
        gk.setText(hud.lives, b ? 'P1 ' + a.lives + '  P2 ' + b.lives : a.lives);
        gk.setText(hud.coins, coins);
        gk.setText(hud.score, b ? a.score + ' / ' + b.score : a.score);
        gk.setText(hud.stars, inStage ? (starGot[0] ? '★' : '☆') + (starGot[1] ? '★' : '☆') + (starGot[2] ? '★' : '☆') : '');
        gk.setText(hud.time, inStage ? time : '');
        hud.timeBox.style.visibility = inStage ? 'visible' : 'hidden';
        hud.starsBox.style.visibility = inStage ? 'visible' : 'hidden';
        hud.timeBox.style.color = inStage && time <= 100 ? '#ff5d73' : '';
    }

    // read-only state for automated tests (tests/*.spec.js)
    window.JumperDebug = function () {
        var a = players[0], b = players[1];
        return { mode: mode, stage: stage && stage.id, x: a && a.x, y: a && a.y, power: a && a.power,
                 lives: a && a.lives, time: time, coins: coins, score: a && a.score, ents: ents.length, camX: cam.x, camY: cam.y, h: a && a.h,
                 twoP: twoP, joinWait: joinWait, p1Dev: a && a.dev,
                 p2: b ? { x: b.x, y: b.y, lives: b.lives, score: b.score, dead: b.dead, out: b.out, dev: b.dev } : null };
    };
    window.JumperCheat = {
        enter: function (id) { enterStage(id); },
        power: function (p) { players[0].setPower(p); },
        warpTo: function (x, y) { for (var i = 0; i < players.length; i++) { var q = players[i]; q.x = x + i * 14; if (y !== undefined) q.y = y; q.vy = 0; } },
        kill: function (slot) { W.die(players[(slot || 1) - 1]); },
        setScore: function (slot, n) { players[slot - 1].score = n; },
        setLives: function (slot, n) { players[slot - 1].lives = n; },
        goal: function () { for (var i = 0; i < ents.length; i++) if (ents[i].type === 'goal' && !ents[i].secret) return { x: ents[i].x, y: ents[i].y, ground: ents[i].ground }; return null; },
        door: function () { for (var i = 0; i < ents.length; i++) if (ents[i].type === 'bossdoor') return ents[i].x; return null; },
        bossHits: function () { for (var i = 0; i < ents.length; i++) if (ents[i].type === 'boss') { ents[i].hp = 1; return { x: ents[i].x, y: ents[i].y, on: bossOn }; } return null; },
        save: function () { return save; }
    };

    GK.create(def);
})();
