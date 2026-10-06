/* Parchís with Moroccan house rules: 2 to 4 players (people or CPU) taking turns on one remote.
 *
 * Rules played here:
 * - One die. A 5 brings a piece out of the nest, and if a piece can come out it must.
 * - A 6 gives another roll. A third 6 in a row sends the last moved piece back to its nest
 *   (unless it is already on its home lane) and the turn passes.
 * - 68 squares around the board, then 7 squares on your own home lane and the centre.
 *   The centre needs the exact number.
 * - Landing on a lone rival piece outside a safe square (circles) captures it: it goes back to its
 *   nest and you move 20 squares with any piece. Bringing a piece home gives 10 squares.
 *   Coming out on your exit square captures a rival standing there, even though it is safe.
 * - Two pieces of the same colour on a square make a wall: nobody can pass or land there.
 * - First player with all 4 pieces in the centre wins.
 *
 * Board: 19 x 19 cells. Track squares are indexed 0..67 counter-clockwise; each player's piece
 * position is a step count from its own exit square: -1 nest, 0..63 track, 64..70 home lane, 71 centre.
 */
(function () {
    'use strict';

    var C = 13.6, BX = 6, BY = 6;                 // cell size and board origin (480 x 270 canvas)
    var TRACK = 68, LANE0 = 64, GOAL = 71, SAFE_ARM = [4, 11, 16];
    var EXIT = [4, 21, 38, 55];                   // exit square of each seat
    var COLORS = ['#ffd23f', '#3d8bfd', '#ff4d5e', '#2bc56b'];
    var DARK = ['#9a7a10', '#1d4e9e', '#a3202e', '#16773e'];
    var SEATS = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };
    var HOP = 7;                                  // frames per square when a piece moves

    var STR = {
        en: { title: 'Parchís', players: 'Players', human: 'Person', cpu: 'CPU', start: 'Start game', colors: ['Yellow', 'Blue', 'Red', 'Green'],
              turn: '%s plays', roll: 'Press OK to roll', rolled: '%s rolled %d', choose: 'Choose a piece: left and right, then OK',
              noMove: 'No move possible', bonus20: 'Capture! Move 20', bonus10: 'Home! Move 10', three6: 'Three sixes! Piece back to the nest',
              again: 'Six: roll again', wins: '%s wins!', newGame: 'New game', pressOk: 'Press OK for a new game',
              setupHelp: 'Up and down: choose. Left and right: change. OK: start.', rules: 'Moroccan rules: 5 to come out, 6 rolls again, capture = 20, home = 10' },
        fr: { title: 'Parchís', players: 'Joueurs', human: 'Personne', cpu: 'Ordinateur', start: 'Commencer', colors: ['Jaune', 'Bleu', 'Rouge', 'Vert'],
              turn: '%s joue', roll: 'Appuyez sur OK pour lancer', rolled: '%s fait %d', choose: 'Choisissez un pion : gauche et droite, puis OK',
              noMove: 'Aucun coup possible', bonus20: 'Prise ! Avancez de 20', bonus10: 'Arrivé ! Avancez de 10', three6: 'Trois six ! Pion renvoyé à la maison',
              again: 'Six : relancez', wins: '%s gagne !', newGame: 'Nouvelle partie', pressOk: 'Appuyez sur OK pour rejouer',
              setupHelp: 'Haut et bas : choisir. Gauche et droite : changer. OK : commencer.', rules: 'Règles marocaines : 5 pour sortir, 6 rejoue, prise = 20, arrivée = 10' },
        es: { title: 'Parchís', players: 'Jugadores', human: 'Persona', cpu: 'CPU', start: 'Empezar', colors: ['Amarillo', 'Azul', 'Rojo', 'Verde'],
              turn: 'Juega %s', roll: 'Pulsa OK para tirar', rolled: '%s saca un %d', choose: 'Elige ficha: izquierda y derecha, luego OK',
              noMove: 'No hay movimiento', bonus20: '¡Te comes una! Cuenta 20', bonus10: '¡A casa! Cuenta 10', three6: '¡Tres seises! La ficha vuelve a casa',
              again: 'Seis: vuelve a tirar', wins: '¡Gana %s!', newGame: 'Nueva partida', pressOk: 'Pulsa OK para otra partida',
              setupHelp: 'Arriba y abajo: elegir. Izquierda y derecha: cambiar. OK: empezar.', rules: 'Reglas marroquíes: 5 para salir, 6 repite, comer = 20, llegar = 10' },
        ar: { title: 'بارتشيس', players: 'اللاعبون', human: 'شخص', cpu: 'الحاسوب', start: 'ابدأ اللعب', colors: ['الأصفر', 'الأزرق', 'الأحمر', 'الأخضر'],
              turn: 'دور %s', roll: 'اضغط OK لرمي النرد', rolled: '%s حصل على %d', choose: 'اختر قطعة: يمين ويسار ثم OK',
              noMove: 'لا توجد حركة ممكنة', bonus20: 'أكلت قطعة! تقدم 20', bonus10: 'وصلت! تقدم 10', three6: 'ثلاث ستات! القطعة تعود إلى البيت',
              again: 'ستة: ارمِ مرة أخرى', wins: '%s فاز!', newGame: 'لعبة جديدة', pressOk: 'اضغط OK للعب مجدداً',
              setupHelp: 'أعلى وأسفل: اختر. يمين ويسار: غيّر. OK: ابدأ.', rules: 'القواعد المغربية: 5 للخروج، 6 يعيد الرمي، الأكل = 20، الوصول = 10' }
    };

    var MUSIC = {
        bpm: 104,
        tracks: [
            { wave: 'triangle', vol: 0.12, notes: 'A4:2 C5:2 E5:2 D5:2 C5:4 A4:4 G4:2 A4:2 C5:2 E5:2 D5:8 E5:2 F5:2 E5:2 D5:2 C5:4 A4:4 G4:2 B4:2 A4:8 .:4' },
            { wave: 'sine', vol: 0.22, notes: 'A2:8 E3:8 D3:8 E3:8 F2:8 C3:8 E2:8 A2:8' }
        ]
    };

    var gk, s, rnd;
    var track = [], lanes = [[], [], [], []], safe = {};
    var pieces = [[-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]];
    var state, seats, cpu = [false, true, true, true], nPlayers = 2, setupRow = 0;
    var turnI, die, dieShow, rollT, sixes, lastMoved, bonus, moveVal, wait;
    var options = [], optSel = 0;               // movable piece indices for the current value
    var anim = null;                            // { p, k, from, to, t, capture: {p,k}|null }
    var msg = '', msgT = 0, winner = -1, nameOf0 = '', forced = 0;

    /* ------------------------------------------------------------------ board geometry */

    function buildGeometry() {
        var r, c, k, p;
        function add(col, row) { track.push([col, row]); }
        for (r = 18; r >= 11; r--) add(10, r);
        for (c = 11; c <= 18; c++) add(c, 10);
        add(18, 9);
        for (c = 18; c >= 11; c--) add(c, 8);
        for (r = 7; r >= 0; r--) add(10, r);
        add(9, 0);
        for (r = 0; r <= 7; r++) add(8, r);
        for (c = 7; c >= 0; c--) add(c, 8);
        add(0, 9);
        for (c = 0; c <= 7; c++) add(c, 10);
        for (r = 11; r <= 18; r++) add(8, r);
        add(9, 18);
        for (k = 0; k < 7; k++) {
            lanes[0].push([9, 17 - k]); lanes[1].push([17 - k, 9]);
            lanes[2].push([9, 1 + k]); lanes[3].push([1 + k, 9]);
        }
        for (p = 0; p < 4; p++) for (k = 0; k < 3; k++) safe[SAFE_ARM[k] + p * 17] = true;
    }

    function trackIdx(p, pos) { return (EXIT[p] + pos) % TRACK; }

    // pieces of other colours / own colour on a track square
    function countAt(idx, out) {
        var n = 0;
        for (var p = 0; p < 4; p++) {
            if (seats.indexOf(p) < 0) continue;
            for (var k = 0; k < 4; k++) {
                var pos = pieces[p][k];
                if (pos >= 0 && pos < LANE0 && trackIdx(p, pos) === idx) { if (out) { out[n * 2] = p; out[n * 2 + 1] = k; } n++; }
            }
        }
        return n;
    }
    var occ = [0, 0, 0, 0, 0, 0, 0, 0];
    function isWall(idx) { return countAt(idx, occ) >= 2 && occ[0] === occ[2]; }

    /* ------------------------------------------------------------------ rules */

    // Returns null when illegal, else { to, capture: [p, k] | null }
    function tryMove(p, k, v) {
        var pos = pieces[p][k], n, i;
        if (pos === GOAL) return null;
        if (pos < 0) {
            if (v !== 5) return null;
            n = countAt(EXIT[p], occ);
            if (n >= 2) {
                // two pieces on the exit: a rival there is captured, two of ours block it
                for (i = n - 1; i >= 0; i--) if (occ[i * 2] !== p) return { to: 0, capture: [occ[i * 2], occ[i * 2 + 1]] };
                return null;
            }
            if (n === 1 && occ[0] !== p) return { to: 0, capture: [occ[0], occ[1]] };
            return { to: 0, capture: null };
        }
        var to = pos + v;
        if (to > GOAL) return null;
        for (i = pos + 1; i <= to && i < LANE0; i++) if (isWall(trackIdx(p, i))) return null;
        if (to < LANE0) {
            var idx = trackIdx(p, to);
            n = countAt(idx, occ);
            if (n >= 2) return null;
            if (n === 1 && occ[0] !== p && !safe[idx]) return { to: to, capture: [occ[0], occ[1]] };
        }
        return { to: to, capture: null };
    }

    function listOptions(p, v) {
        options.length = 0;
        var k, exits = false;
        // a 5 must bring a piece out when one can come out
        if (v === 5) for (k = 0; k < 4; k++) if (pieces[p][k] < 0 && tryMove(p, k, v)) exits = true;
        for (k = 0; k < 4; k++) {
            if (exits && pieces[p][k] >= 0) continue;
            if (tryMove(p, k, v)) {
                // one option per nest (all nest pieces are the same move)
                if (pieces[p][k] < 0) { var dup = false; for (var j = 0; j < options.length; j++) if (pieces[p][options[j]] < 0) dup = true; if (dup) continue; }
                options.push(k);
            }
        }
        return options.length;
    }

    // CPU: capture > home > come out > safety > progress
    function cpuPick(p, v) {
        var best = options[0], bestS = -1e9;
        for (var i = 0; i < options.length; i++) {
            var k = options[i], m = tryMove(p, k, v), pos = pieces[p][k], sc = m.to * 0.2;
            if (m.capture) sc += 100;
            if (m.to === GOAL) sc += 80;
            if (pos < 0) sc += 60;
            if (m.to >= LANE0 && pos < LANE0) sc += 30;
            if (m.to < LANE0) {
                var idx = trackIdx(p, m.to);
                if (safe[idx]) sc += 18;
                else if (threatened(p, idx)) sc -= 30;
            }
            if (pos >= 0 && pos < LANE0 && !safe[trackIdx(p, pos)] && threatened(p, trackIdx(p, pos))) sc += 20;
            if (sc > bestS) { bestS = sc; best = k; }
        }
        return best;
    }

    // a rival piece 1..6 squares behind this square could land on it
    function threatened(p, idx) {
        for (var q = 0; q < 4; q++) {
            if (q === p || seats.indexOf(q) < 0) continue;
            for (var k = 0; k < 4; k++) {
                var pos = pieces[q][k];
                if (pos < 0 || pos >= LANE0) continue;
                var d = (idx - trackIdx(q, pos) + TRACK) % TRACK;
                if (d >= 1 && d <= 6 && pos + d < LANE0) return true;
            }
        }
        return false;
    }

    /* ------------------------------------------------------------------ flow */

    function fmt(t, a, b) { return t.replace('%s', a).replace('%d', b); }
    function cur() { return seats[turnI]; }
    function name(p) {
        if (cpu[p]) return s('cpu') + ' ' + s('colors')[p];
        if (p === seats[0] && nameOf0) return nameOf0;
        return s('colors')[p];
    }
    function say(t, frames) { msg = t; msgT = frames || 120; gk.announce(t); }

    function newGame() {
        seats = SEATS[nPlayers];
        for (var p = 0; p < 4; p++) for (var k = 0; k < 4; k++) pieces[p][k] = -1;
        turnI = 0; winner = -1;
        GK.banner('');
        gk.audio.music(MUSIC);
        beginTurn();
    }

    function beginTurn() {
        sixes = 0; lastMoved = -1; bonus = 0;
        startRoll();
        gk.announce(fmt(s('turn'), name(cur())) + (cpu[cur()] ? '' : '. ' + s('roll')));
    }

    function startRoll() { state = 'roll'; wait = cpu[cur()] ? 40 : 0; }

    function roll() {
        state = 'rolling'; rollT = 26;
        die = forced || 1 + ((rnd() * 6) | 0);
        forced = 0;
        gk.audio.sfx('tick');
    }

    function rolled() {
        var p = cur();
        dieShow = die;
        if (die === 6) sixes++;
        if (sixes === 3) {
            if (lastMoved >= 0 && pieces[p][lastMoved] < LANE0) { pieces[p][lastMoved] = -1; gk.audio.sfx('lose'); }
            say(s('three6'));
            return nextPlayer(50);
        }
        gk.announce(fmt(s('rolled'), name(p), die));
        prepareMove(die);
    }

    function prepareMove(v) {
        var p = cur();
        moveVal = v;
        if (!listOptions(p, v)) {
            say(s('noMove'), 70);
            gk.audio.sfx('bump');
            return afterMove(40);
        }
        state = 'choose';
        optSel = 0;
        // a person only chooses when there is a real choice; a single move plays by itself
        wait = cpu[p] ? 32 : 18;
        if (!cpu[p] && options.length > 1) gk.announce(s('choose'));
    }

    function commit(k) {
        var p = cur(), m = tryMove(p, k, moveVal);
        if (!m) return;
        lastMoved = k;
        var from = pieces[p][k];
        anim = { p: p, k: k, from: from, to: m.to, t: 0, capture: m.capture };
        state = 'moving';
        if (from < 0) { pieces[p][k] = 0; anim.from = -1; anim.t = HOP; gk.audio.sfx('spring'); }
    }

    function stepAnim() {
        var a = anim;
        if (a.from < 0) { if (--a.t <= 0) finishMove(); return; }
        if (++a.t < HOP) return;
        a.t = 0;
        pieces[a.p][a.k]++;
        gk.audio.sfx('move');
        if (pieces[a.p][a.k] >= a.to) finishMove();
    }

    function finishMove() {
        var a = anim, p = a.p;
        anim = null;
        if (a.capture) {
            pieces[a.capture[0]][a.capture[1]] = -1;
            bonus += 20;
            gk.audio.sfx('stomp');
            say(s('bonus20'));
        }
        if (pieces[p][a.k] === GOAL) {
            gk.audio.sfx('clear');
            if (won(p)) return endGame(p);
            bonus += 10;
            say(s('bonus10'));
        }
        afterMove(12);
    }

    function won(p) { for (var k = 0; k < 4; k++) if (pieces[p][k] !== GOAL) return false; return true; }

    // after a move: bonus squares first, then a 6 rolls again, else the next player
    function afterMove(delay) {
        if (bonus) {
            var v = bonus >= 20 ? 20 : 10;
            bonus -= v;
            if (listOptions(cur(), v)) { state = 'pause'; wait = delay + 20; pendingBonus = v; return; }
        }
        bonus = 0;
        if (die === 6 && sixes > 0 && sixes < 3) { state = 'pause'; wait = delay + 20; pendingBonus = 0; say(s('again'), 70); return; }
        nextPlayer(delay + 20);
    }
    var pendingBonus = 0;

    function nextPlayer(delay) {
        state = 'pause'; wait = delay; pendingBonus = -1;
    }

    function endGame(p) {
        state = 'over'; winner = p;
        gk.audio.music(null);
        gk.audio.sfx('goal');
        GK.banner(fmt(s('wins'), name(p)), s('pressOk'));
        gk.announce(fmt(s('wins'), name(p)) + '. ' + s('pressOk'));
    }

    /* ------------------------------------------------------------------ input */

    function ok() { return gk.pressed('confirm') || gk.pressed('jump'); }

    function updateSetup() {
        var rows = 2 + nPlayers;          // players, one row per seat, start
        if (gk.pressed('up')) { setupRow = (setupRow + rows - 1) % rows; gk.audio.sfx('blip'); }
        if (gk.pressed('down')) { setupRow = (setupRow + 1) % rows; gk.audio.sfx('blip'); }
        var d = (gk.pressed('right') ? 1 : 0) - (gk.pressed('left') ? 1 : 0);
        if (gk.host && gk.host.rtl) d = -d;
        var seatList = SEATS[nPlayers];
        if (d) {
            gk.audio.sfx('blip');
            if (setupRow === 0) { nPlayers = Math.max(2, Math.min(4, nPlayers + d)); if (setupRow > nPlayers + 1) setupRow = nPlayers + 1; }
            else if (setupRow <= nPlayers) { var p = SEATS[nPlayers][setupRow - 1]; cpu[p] = !cpu[p]; }
            announceSetup();
        }
        if (ok()) {
            if (setupRow === 0) { nPlayers = nPlayers === 4 ? 2 : nPlayers + 1; announceSetup(); }
            else if (setupRow <= nPlayers) { var q = seatList[setupRow - 1]; cpu[q] = !cpu[q]; announceSetup(); }
            else { gk.save('setup', { n: nPlayers, cpu: cpu }); newGame(); }
        }
        if (gk.pressed('up') || gk.pressed('down')) announceSetup();
    }

    function announceSetup() {
        if (setupRow === 0) gk.announce(s('players') + ': ' + nPlayers);
        else if (setupRow <= nPlayers) { var p = SEATS[nPlayers][setupRow - 1]; gk.announce(s('colors')[p] + ': ' + (cpu[p] ? s('cpu') : s('human'))); }
        else gk.announce(s('start'));
    }

    /* ------------------------------------------------------------------ game definition */

    var def = {
        id: 'parchis',
        minScale: 2,
        start: function (g) {
            gk = g;
            s = GK.tr(STR, g.lang);
            if (!track.length) buildGeometry();
            rnd = GK.rng(Date.now());
            nameOf0 = g.host && g.host.profile ? g.host.profile.name : '';
            var saved = g.load('setup', null);
            if (saved && saved.n >= 2 && saved.n <= 4) { nPlayers = saved.n; for (var i = 0; i < 4; i++) cpu[i] = !!saved.cpu[i]; }
            seats = SEATS[nPlayers];
            state = 'setup'; setupRow = nPlayers + 1;
            GK.hud([]);
            GK.banner('');
            g.announce(s('title') + '. ' + s('rules') + '. ' + s('setupHelp'));
        },
        update: function (g) { for (var i = 0; i < turbo; i++) step(g); },
        render: function (g) { draw(g.ctx, g.frame); },
        menuItems: function () { return [{ id: 'new', label: s('newGame') }]; },
        onMenu: function (g, id) { if (id === 'new') { state = 'setup'; setupRow = nPlayers + 1; anim = null; GK.banner(''); g.audio.music(null); } }
    };
    var turbo = 1;                              // test hook: game steps per frame

    function step(g) {
        if (msgT > 0) msgT--;
        if (state === 'setup') return updateSetup();
        if (state === 'over') { if (ok()) { state = 'setup'; GK.banner(''); } return; }
        var p = cur(), human = !cpu[p];
        if (state === 'roll') {
            if (human ? ok() : --wait <= 0) roll();
        } else if (state === 'rolling') {
            dieShow = 1 + ((rnd() * 6) | 0);
            if (--rollT <= 0) rolled();
        } else if (state === 'choose') {
            if (!human || options.length === 1) {
                if (--wait <= 0) commit(human ? options[0] : cpuPick(p, moveVal));
                return;
            }
            var d = (g.pressed('right') || g.pressed('down') ? 1 : 0) - (g.pressed('left') || g.pressed('up') ? 1 : 0);
            if (d) { optSel = (optSel + d + options.length) % options.length; g.audio.sfx('blip'); }
            if (ok()) commit(options[optSel]);
        } else if (state === 'moving') {
            stepAnim();
        } else if (state === 'pause') {
            if (--wait > 0) return;
            if (pendingBonus > 0) { var v = pendingBonus; pendingBonus = 0; prepareMove(v); }
            else if (pendingBonus === 0) startRoll();
            else { turnI = (turnI + 1) % seats.length; beginTurn(); }
        }
    }

    /* ------------------------------------------------------------------ drawing */

    function cx(col) { return BX + col * C + C / 2; }
    function cy(row) { return BY + row * C + C / 2; }

    function drawBoard(c) {
        var i, p, x, y;
        c.fillStyle = '#f4ead2'; GK.roundRect(c, BX - 3, BY - 3, C * 19 + 6, C * 19 + 6, 6); c.fill();
        // nests
        var nest = [[11, 11], [11, 0], [0, 0], [0, 11]];
        for (p = 0; p < 4; p++) {
            x = BX + nest[p][0] * C; y = BY + nest[p][1] * C;
            c.fillStyle = seats.indexOf(p) >= 0 || state === 'setup' ? COLORS[p] : '#c9c1ad';
            c.fillRect(x + 2, y + 2, C * 8 - 4, C * 8 - 4);
            c.fillStyle = 'rgba(255,255,255,0.55)';
            c.beginPath(); c.arc(x + C * 4, y + C * 4, C * 2.6, 0, 6.2832); c.fill();
        }
        // track squares
        for (i = 0; i < TRACK; i++) {
            x = BX + track[i][0] * C; y = BY + track[i][1] * C;
            var owner = -1;
            for (p = 0; p < 4; p++) if (EXIT[p] === i) owner = p;
            c.fillStyle = owner >= 0 ? COLORS[owner] : '#fffaf0';
            c.fillRect(x + 0.6, y + 0.6, C - 1.2, C - 1.2);
            if (safe[i]) { c.strokeStyle = '#7b6a48'; c.lineWidth = 1; c.beginPath(); c.arc(x + C / 2, y + C / 2, C * 0.32, 0, 6.2832); c.stroke(); }
        }
        // home lanes
        for (p = 0; p < 4; p++) for (i = 0; i < 7; i++) {
            x = BX + lanes[p][i][0] * C; y = BY + lanes[p][i][1] * C;
            c.fillStyle = COLORS[p];
            c.fillRect(x + 0.6, y + 0.6, C - 1.2, C - 1.2);
        }
        // centre: four triangles
        var mx = BX + 9.5 * C, my = BY + 9.5 * C, h = 1.5 * C;
        var tri = [[-1, 1, 1, 1], [1, 1, 1, -1], [1, -1, -1, -1], [-1, -1, -1, 1]];
        for (p = 0; p < 4; p++) {
            c.fillStyle = COLORS[p];
            c.beginPath(); c.moveTo(mx, my); c.lineTo(mx + tri[p][0] * h, my + tri[p][1] * h); c.lineTo(mx + tri[p][2] * h, my + tri[p][3] * h); c.closePath(); c.fill();
        }
        c.strokeStyle = '#2a2414'; c.lineWidth = 1;
        c.strokeRect(BX + 8 * C, BY + 8 * C, 3 * C, 3 * C);
    }

    // where to draw piece k of player p (centre point), spreading pieces that share a square
    var NEST_SLOTS = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    var GOAL_DIR = [[0, 1], [1, 0], [0, -1], [-1, 0]];
    var pt = [0, 0];
    function piecePos(p, k) {
        var pos = pieces[p][k], col, row, j, n = 0, idx = 0;
        if (pos < 0) {
            var nest = [[14.5, 14.5], [14.5, 3.5], [3.5, 3.5], [3.5, 14.5]][p];
            pt[0] = BX + nest[0] * C + NEST_SLOTS[k][0] * C * 1.25; pt[1] = BY + nest[1] * C + NEST_SLOTS[k][1] * C * 1.25;
            return pt;
        }
        if (pos === GOAL) {
            pt[0] = BX + 9.5 * C + GOAL_DIR[p][0] * C * 0.85 + (k - 1.5) * 3.4 * (GOAL_DIR[p][1] ? 1 : 0);
            pt[1] = BY + 9.5 * C + GOAL_DIR[p][1] * C * 0.85 + (k - 1.5) * 3.4 * (GOAL_DIR[p][0] ? 1 : 0);
            return pt;
        }
        if (pos < LANE0) { var t = track[trackIdx(p, pos)]; col = t[0]; row = t[1]; }
        else { col = lanes[p][pos - LANE0][0]; row = lanes[p][pos - LANE0][1]; }
        // share the square with other pieces there
        for (var q = 0; q < 4; q++) {
            if (seats.indexOf(q) < 0) continue;
            for (j = 0; j < 4; j++) {
                var o = pieces[q][j];
                if (o < 0 || o === GOAL) continue;
                var same = o < LANE0 && pos < LANE0 ? trackIdx(q, o) === trackIdx(p, pos) : q === p && o === pos;
                if (!same) continue;
                if (q === p && j === k) idx = n;
                n++;
            }
        }
        var off = n > 1 ? (idx === 0 ? -1 : 1) * C * 0.22 : 0;
        var horiz = row >= 8 && row <= 10;        // squares on the left/right arms are wider than tall
        pt[0] = cx(col) + (horiz ? 0 : off); pt[1] = cy(row) + (horiz ? off : 0);
        return pt;
    }

    function drawPiece(c, x, y, p, hi, frame) {
        var r = C * 0.36;
        if (hi) {
            c.fillStyle = (frame >> 3) & 1 ? '#ffffff' : '#1a1423';
            c.beginPath(); c.arc(x, y, r + 2.4, 0, 6.2832); c.fill();
        }
        c.fillStyle = DARK[p]; c.beginPath(); c.arc(x, y + 0.8, r, 0, 6.2832); c.fill();
        c.fillStyle = COLORS[p]; c.beginPath(); c.arc(x, y, r - 0.6, 0, 6.2832); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.6)'; c.beginPath(); c.arc(x - r * 0.3, y - r * 0.3, r * 0.3, 0, 6.2832); c.fill();
    }

    function drawPieces(c, frame) {
        var sel = state === 'choose' && !cpu[cur()] ? options[optSel] : -1;
        var anyNest = sel >= 0 && pieces[cur()][sel] < 0;
        for (var i = 0; i < seats.length; i++) {
            var p = seats[i];
            for (var k = 0; k < 4; k++) {
                var q = piecePos(p, k), y = q[1];
                if (anim && anim.p === p && anim.k === k && anim.from >= 0) y -= Math.sin(anim.t / HOP * Math.PI) * 4;
                var hi = p === cur() && (k === sel || (anyNest && pieces[p][k] < 0 && k === firstNest(p)));
                drawPiece(c, q[0], y, p, hi, frame);
            }
        }
    }
    function firstNest(p) { for (var k = 0; k < 4; k++) if (pieces[p][k] < 0) return k; return -1; }

    function drawDie(c, x, y, v, col) {
        c.fillStyle = '#1a1423'; GK.roundRect(c, x - 1, y - 1, 38, 38, 7); c.fill();
        c.fillStyle = '#ffffff'; GK.roundRect(c, x, y, 36, 36, 6); c.fill();
        c.fillStyle = col;
        var P = { 1: [[18, 18]], 2: [[9, 9], [27, 27]], 3: [[9, 9], [18, 18], [27, 27]], 4: [[9, 9], [27, 9], [9, 27], [27, 27]],
                  5: [[9, 9], [27, 9], [18, 18], [9, 27], [27, 27]], 6: [[9, 9], [27, 9], [9, 18], [27, 18], [9, 27], [27, 27]] }[v] || [];
        for (var i = 0; i < P.length; i++) { c.beginPath(); c.arc(x + P[i][0], y + P[i][1], 3.6, 0, 6.2832); c.fill(); }
    }

    function drawPanel(c, frame) {
        var x = 278, w = 194, i;
        c.fillStyle = '#1c2150'; GK.roundRect(c, x, 6, w, 258, 8); c.fill();
        if (state === 'setup') {
            GK.text(c, s('title'), x + w / 2, 22, 16, '#ffd23f', 'center');
            var rows = [s('players') + ':  ◀ ' + nPlayers + ' ▶'], seatList = SEATS[nPlayers];
            for (i = 0; i < seatList.length; i++) rows.push(s('colors')[seatList[i]] + ':  ' + (cpu[seatList[i]] ? s('cpu') : s('human')));
            rows.push(s('start'));
            for (i = 0; i < rows.length; i++) {
                var y = 48 + i * 25, on = i === setupRow;
                c.fillStyle = on ? '#3d46a8' : '#262c66'; GK.roundRect(c, x + 8, y - 10, w - 16, 21, 5); c.fill();
                if (on) { c.strokeStyle = '#ffd23f'; c.lineWidth = 1.5; GK.roundRect(c, x + 8, y - 10, w - 16, 21, 5); c.stroke(); }
                if (i > 0 && i <= seatList.length) { c.fillStyle = COLORS[seatList[i - 1]]; c.beginPath(); c.arc(x + 20, y, 4.5, 0, 6.2832); c.fill(); }
                GK.text(c, rows[i], i > 0 && i <= seatList.length ? x + 30 : x + w / 2, y + 1, 10, '#ffffff', i > 0 && i <= seatList.length ? 'left' : 'center');
            }
            wrap(c, s('rules'), x + w / 2, 48 + rows.length * 25 + 8, w - 16, 8.5, '#b9c0ff');
            wrap(c, s('setupHelp'), x + w / 2, 236, w - 16, 8.5, '#8088cc');
            return;
        }
        var p = cur();
        c.fillStyle = COLORS[p]; GK.roundRect(c, x + 8, 14, w - 16, 26, 6); c.fill();
        GK.text(c, fmt(s('turn'), name(p)), x + w / 2, 27.5, 11, '#14183a', 'center');
        drawDie(c, x + w / 2 - 18, 52, state === 'roll' ? 0 : dieShow || 1, DARK[p]);
        if (state === 'roll' && !cpu[p]) { if ((frame >> 4) & 1) wrap(c, s('roll'), x + w / 2, 104, w - 16, 10, '#ffffff'); }
        else if (state === 'choose' && !cpu[p] && options.length > 1) wrap(c, s('choose'), x + w / 2, 104, w - 16, 9, '#ffffff');
        if (state === 'choose' && moveVal > 6) GK.text(c, '+' + moveVal, x + w / 2 + 34, 70, 14, '#ffd23f', 'center');
        if (msgT > 0) wrap(c, msg, x + w / 2, 136, w - 16, 10, '#ffd23f');
        // players and pieces home
        for (i = 0; i < seats.length; i++) {
            var q = seats[i], y = 176 + i * 21, home = 0;
            for (var k = 0; k < 4; k++) if (pieces[q][k] === GOAL) home++;
            c.fillStyle = q === p ? '#3d46a8' : '#262c66'; GK.roundRect(c, x + 8, y - 9, w - 16, 18, 4); c.fill();
            c.fillStyle = COLORS[q]; c.beginPath(); c.arc(x + 18, y, 4.5, 0, 6.2832); c.fill();
            GK.text(c, name(q), x + 28, y + 1, 9, '#ffffff', 'left');
            GK.text(c, home + '/4', x + w - 14, y + 1, 9, '#ffd23f', 'right');
        }
    }

    // centred text wrapped to a width
    function wrap(c, text, x, y, w, size, col) {
        c.font = 'bold ' + size + 'px Arial, sans-serif';
        var words = text.split(' '), line = '', ly = y;
        for (var i = 0; i < words.length; i++) {
            var test = line ? line + ' ' + words[i] : words[i];
            if (c.measureText(test).width > w && line) { GK.text(c, line, x, ly, size, col, 'center'); line = words[i]; ly += size + 3; }
            else line = test;
        }
        if (line) GK.text(c, line, x, ly, size, col, 'center');
    }

    function draw(c, frame) {
        c.fillStyle = '#121636'; c.fillRect(0, 0, 480, 270);
        drawBoard(c);
        drawPieces(c, frame);
        drawPanel(c, frame);
    }

    GK.create(def);

    // test hooks
    window.ParchisDebug = function () {
        return { state: state, turn: seats ? cur() : -1, die: die, options: options.slice(), pieces: pieces.map(function (a) { return a.slice(); }),
                 seats: seats, cpu: cpu.slice(), winner: winner, moveVal: moveVal };
    };
    window.ParchisCheat = {
        set: function (p, k, pos) { pieces[p][k] = pos; },
        die: function (v) { forced = v; },
        turbo: function (n) { turbo = n; },
        tryMove: function (p, k, v) { return tryMove(p, k, v); },
        trackIdx: trackIdx
    };
})();
