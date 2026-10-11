/* My PC controller: this phone is player 1 or 2 of the TV. It shows no game, only buttons (D-pad, A B C, menu, pause).
 * The TV's code comes from Settings > Devices > Phone controller (also as controller/?r=CODE). Signalling goes through
 * Firestore (js/core/rooms.js, the same code as multiplayer), the presses through a direct WebRTC channel (js/core/netlink.js)
 * on the same Wi-Fi. When the TV changes page (opens a game, quits) the link drops and this page reconnects by itself.
 * Messages: { t: 'hi', p, cid, name } then { t: 'k', a, d } to the TV; { t: 'ok', p } | { t: 'no', why } back. Separate from the in-game pad. */
(function () {
    'use strict';

    var TXT = {
        en: { title: 'Phone controller', help: 'On the TV open Settings > Devices > Phone controller, press “Pair a phone” and type the code shown.', go: 'Connect', code: 'Code', err: 'Enter the 8 character code.', leave: 'Leave', turn: 'Turn your phone sideways', connecting: 'Connecting…', on: 'Connected', locked: 'Pairing is closed. On the TV press “Pair a phone” and try again.', full: 'Both players are already connected.', busy: 'That player is already taken. Pick the other one.', noroom: 'The TV is not answering yet…', offline: 'No internet connection' },
        fr: { title: 'Téléphone manette', help: 'Sur la TV, ouvrez Paramètres > Périphériques > Téléphone manette, appuyez sur « Associer un téléphone » et tapez le code affiché.', go: 'Connexion', code: 'Code', err: 'Entrez le code de 8 caractères.', leave: 'Quitter', turn: 'Tournez votre téléphone', connecting: 'Connexion…', on: 'Connecté', locked: 'L\'association est fermée. Sur la TV, appuyez sur « Associer un téléphone » et réessayez.', full: 'Les deux joueurs sont déjà connectés.', busy: 'Ce joueur est déjà pris. Choisissez l\'autre.', noroom: 'La TV ne répond pas encore…', offline: 'Pas de connexion internet' },
        es: { title: 'Móvil como mando', help: 'En la TV abre Ajustes > Dispositivos > Móvil como mando, pulsa «Vincular un móvil» y escribe el código.', go: 'Conectar', code: 'Código', err: 'Escribe el código de 8 caracteres.', leave: 'Salir', turn: 'Gira el móvil', connecting: 'Conectando…', on: 'Conectado', locked: 'La vinculación está cerrada. En la TV pulsa «Vincular un móvil» e inténtalo de nuevo.', full: 'Los dos jugadores ya están conectados.', busy: 'Ese jugador ya está ocupado. Elige el otro.', noroom: 'La TV aún no responde…', offline: 'Sin conexión a internet' },
        ar: { title: 'الهاتف كذراع تحكم', help: 'على التلفاز افتح الإعدادات > الأجهزة > الهاتف كذراع تحكم، واضغط «إقران هاتف» ثم اكتب الرمز.', go: 'اتصال', code: 'الرمز', err: 'أدخل الرمز المكوّن من 8 أحرف.', leave: 'خروج', turn: 'أدِر هاتفك أفقياً', connecting: 'جارٍ الاتصال…', on: 'متصل', locked: 'الإقران مغلق. اضغط «إقران هاتف» على التلفاز وحاول مجدداً.', full: 'اللاعبان متصلان بالفعل.', busy: 'هذا اللاعب مستخدم. اختر الآخر.', noroom: 'التلفاز لا يردّ بعد…', offline: 'لا يوجد اتصال بالإنترنت' }
    };
    var lang = (navigator.language || 'en').slice(0, 2);
    var T = TXT[lang] || TXT.en;
    if (lang === 'ar') document.documentElement.dir = 'rtl';
    document.documentElement.lang = TXT[lang] ? lang : 'en';

    var $ = function (id) { return document.getElementById(id); };
    var KEY = 'arc_ctrl_phone';
    var saved = Store.rawGet(KEY) || {};
    var cid = typeof saved.cid === 'string' ? saved.cid : '';
    if (!/^[a-z0-9]{6,24}$/.test(cid)) { cid = ''; for (var i = 0; i < 12; i++) cid += 'abcdefghijklmnopqrstuvwxyz0123456789'.charAt(Math.floor(Math.random() * 36)); }
    var code = '', player = saved.p === 2 ? 2 : 1, run = false, busy = false, conn = null, linked = false, sess = null, retry = 0, wait = 0, curReq = null, offerObj = null;
    var want = {}, sent = {}, pointers = {};

    $('t-title').textContent = T.title; $('t-help').textContent = T.help; $('go').textContent = T.go;
    $('code').placeholder = T.code; $('leave').textContent = T.leave; $('turn').textContent = T.turn;
    var q = /[?&]r=([a-z0-9]{6,16})/i.exec(location.search);
    $('code').value = (q ? q[1] : saved.code || '').toUpperCase();

    function save() { Store.rawSet(KEY, { cid: cid, code: code, p: player }); }
    function pick(p) { player = p; $('p1').className = p === 1 ? 'on' : ''; $('p2').className = p === 2 ? 'on' : ''; $('badge').textContent = 'P' + p; }
    pick(player);
    $('p1').onclick = function () { pick(1); }; $('p2').onclick = function () { pick(2); };

    function state(text, ok) { $('state').textContent = text; $('dot').className = ok ? 'ok' : ''; }
    function show(pad) {
        $('join').hidden = pad; $('pad').className = pad ? 'show' : '';
        document.body.className = pad ? 'playing' : '';
    }

    /* ---------- link ---------- */
    function name() { return (/Android/i.test(navigator.userAgent) ? 'Android' : /iPhone|iPad/i.test(navigator.userAgent) ? 'iPhone' : 'Phone'); }
    function fail(why) {
        clearTimeout(wait);
        if (offerObj) { offerObj.cancel(); offerObj = null; }
        if (sess && curReq) sess.call('cancel', { req: curReq }, function () {});
        curReq = null; busy = false;
        if (!run) return;
        state(why === 'offline' ? T.offline : T.noroom, false);
        clearTimeout(retry);
        retry = setTimeout(attempt, 2500);
    }
    function attempt() {
        if (!run || busy || linked) return;
        busy = true; state(T.connecting, false);
        NetLink.offer().then(function (o) {
            if (!run) { o.cancel(); busy = false; return; }
            offerObj = o;
            sess.call('ask', { room: code, offer: o.offer, name: name() }, function (err, res) {
                if (err === 'full') { stop(); show(false); $('err').textContent = T.full; return; }
                if (err) return fail(err);
                curReq = res.id;
                wait = setTimeout(function () { fail('timeout'); }, 14000);
            });
        }, function () { fail('connect'); });
    }
    function onEvent(ev, d) {
        if (!run || d.req !== curReq) return;
        if (ev === 'denied') { curReq = null; return fail(d.why); }
        if (ev !== 'answer') return;
        clearTimeout(wait); curReq = null;
        var o = offerObj; offerObj = null;
        o.connect(d.answer).then(up, function () { fail('connect'); });
    }
    function up(c) {
        if (!run) return c.close();
        conn = c;
        c.onMessage(function (m) {
            if (!m || typeof m !== 'object') return;
            if (m.t === 'ok') { linked = true; save(); show(true); pick(m.p === 2 ? 2 : 1); state(T.on, true); lock(); }
            else if (m.t === 'no') { stop(); show(false); $('err').textContent = m.why === 'busy' ? T.busy : T.locked; }
        });
        c.onClose(function () {
            if (conn !== c) return;
            conn = null; linked = false; busy = false; release();
            if (run) { state(T.connecting, false); clearTimeout(retry); retry = setTimeout(attempt, 1200); }
        });
        c.send({ t: 'hi', p: player, cid: cid, name: name() });
    }
    function start() {
        var v = $('code').value.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (v.length < 6) { $('err').textContent = T.err; return; }
        code = v; $('err').textContent = ''; save();
        if (!NetLink.supported()) { $('err').textContent = 'WebRTC?'; return; }
        Rooms.LIMITS.asksPerMin = 30;                               // it reconnects by itself every time the TV changes page
        run = true; sess = new Rooms.Session('controller', name(), onEvent);
        show(true); state(T.connecting, false); lock(); wake();
        attempt();
    }
    function stop() {
        run = false; clearTimeout(retry); clearTimeout(wait); release();
        if (conn) { var c = conn; conn = null; c.close(); }
        if (offerObj) { offerObj.cancel(); offerObj = null; }
        if (sess) { sess.destroy(); sess = null; }
        linked = false; busy = false; curReq = null;
    }
    $('go').onclick = start;
    $('code').onkeydown = function (e) { if (e.key === 'Enter') start(); };
    $('leave').onclick = function () { stop(); show(false); };

    /* ---------- buttons ---------- */
    function sync() {
        for (var a in want) if (want[a] !== !!sent[a]) {
            sent[a] = want[a];
            if (conn && linked) conn.send({ t: 'k', a: a, d: want[a] ? 1 : 0 });
            if (want[a] && navigator.vibrate) { try { navigator.vibrate(8); } catch (e) {} }
            var els = document.querySelectorAll('[data-a="' + a + '"]');
            for (var i = 0; i < els.length; i++) els[i].classList[want[a] ? 'add' : 'remove']('on');
        }
    }
    function release() { pointers = {}; for (var a in want) want[a] = false; sync(); }
    // the D-pad is one zone: direction from the touch point (diagonals included); the other buttons are what the finger is on
    function hit(x, y) {
        var out = [], dp = $('dpad').getBoundingClientRect(), pad = dp.width * 0.25;
        if (x > dp.left - pad && x < dp.right + pad && y > dp.top - pad && y < dp.bottom + pad) {
            var dx = (x - (dp.left + dp.width / 2)) / dp.width, dy = (y - (dp.top + dp.height / 2)) / dp.height;
            if (dx < -0.14) out.push('left'); else if (dx > 0.14) out.push('right');
            if (dy < -0.14) out.push('up'); else if (dy > 0.14) out.push('down');
            return out;
        }
        var e = document.elementFromPoint(x, y), b = e && e.closest ? e.closest('.b,.m') : null;
        if (b) out.push(b.getAttribute('data-a'));
        return out;
    }
    function recompute() {
        var a, id, i, now = {};
        for (id in pointers) for (i = 0; i < pointers[id].length; i++) now[pointers[id][i]] = true;
        for (a in want) if (!now[a]) want[a] = false;
        for (a in now) want[a] = true;
        sync();
    }
    function move(e) { if (pointers[e.pointerId] === undefined) return; pointers[e.pointerId] = hit(e.clientX, e.clientY); recompute(); e.preventDefault(); }
    var padEl = $('pad');
    padEl.addEventListener('pointerdown', function (e) { if (e.target.id === 'leave') return; pointers[e.pointerId] = hit(e.clientX, e.clientY); recompute(); try { padEl.setPointerCapture(e.pointerId); } catch (x) {} e.preventDefault(); });
    padEl.addEventListener('pointermove', move);
    function end(e) { delete pointers[e.pointerId]; recompute(); }
    padEl.addEventListener('pointerup', end); padEl.addEventListener('pointercancel', end);
    padEl.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) release(); else if (run) wake(); });

    /* ---------- phone: landscape, screen on ---------- */
    function lock() {
        try {
            var d = document.documentElement;
            var go = function () { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(function () {}); };
            if (d.requestFullscreen && !document.fullscreenElement) d.requestFullscreen().then(go, go); else go();
        } catch (e) {}
    }
    var wl = null;
    function wake() { try { if (navigator.wakeLock) navigator.wakeLock.request('screen').then(function (l) { wl = l; }, function () {}); } catch (e) {} }

    window.__ctrl = { want: want, state: function () { return { linked: linked, run: run, player: player, cid: cid }; } };
})();
