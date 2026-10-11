/* Game controller (system app, for phones): this phone becomes player 1 or 2 of a TV running My PC. It shows no game, only
 * buttons (D-pad, A B C, menu, pause). The TV side is js/launcher/controllers.js (Settings > Devices > Phone controller shows the code).
 * Signalling goes through Firestore (js/core/rooms.js, app 'controller'), the presses through a direct WebRTC channel on the same
 * Wi-Fi (js/core/netlink.js). When the TV changes page (opens a game, quits) the link drops and this app reconnects by itself.
 * Messages: { t: 'hi', p, cid, name } then { t: 'k', a, d } to the TV; { t: 'ok', p } | { t: 'no', why } back.
 * Separate from the touch pad that the shell draws over games. */
(function () {
    'use strict';

    var KEY = 'arc_dev_ctrlphone';
    var root = null, code = '', player = 1, run = false, busy = false, conn = null, linked = false, sess = null, retry = 0, wait = 0, curReq = null, offerObj = null;
    var want = {}, sent = {}, pointers = {}, ui = {}, saved = {}, cid = '', inPad = false, wl = null;

    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
    function t(k) { return I18n.t(k); }
    function name() { return /Android/i.test(navigator.userAgent) ? 'Android' : /iPhone|iPad/i.test(navigator.userAgent) ? 'iPhone' : 'Phone'; }
    function save() { Store.rawSet(KEY, { cid: cid, code: code, p: player }); }
    function state(text, ok) { if (!ui.state) return; ui.state.textContent = text; ui.dot.className = 'gc-dot' + (ok ? ' ok' : ''); }
    function pick(p) { player = p; ui.p1.className = 'btn' + (p === 1 ? ' btn-primary' : ''); ui.p2.className = 'btn' + (p === 2 ? ' btn-primary' : ''); ui.badge.textContent = 'P' + p; }
    function show(pad) {
        inPad = pad; ui.join.hidden = pad; ui.pad.className = 'gc-pad' + (pad ? ' show' : '');
        if (!pad && ui.go) Focus.focus(ui.go);
    }

    /* ---------- link ---------- */
    function fail(why) {
        clearTimeout(wait);
        if (offerObj) { offerObj.cancel(); offerObj = null; }
        if (sess && curReq) sess.call('cancel', { req: curReq }, function () {});
        curReq = null; busy = false;
        if (!run) return;
        state(why === 'offline' ? t('gcOffline') : t('gcNoRoom'), false);
        clearTimeout(retry);
        retry = setTimeout(attempt, 2500);
    }
    function attempt() {
        if (!run || busy || linked) return;
        busy = true; state(t('gcConnecting'), false);
        NetLink.offer().then(function (o) {
            if (!run) { o.cancel(); busy = false; return; }
            offerObj = o;
            sess.call('ask', { room: code, offer: o.offer, name: name() }, function (err, res) {
                if (err === 'full') { stop(); ui.err.textContent = t('gcFull'); return; }
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
            if (m.t === 'ok') { linked = true; save(); pick(m.p === 2 ? 2 : 1); state(t('gcOn'), true); }
            else if (m.t === 'no') { stop(); ui.err.textContent = m.why === 'busy' ? t('gcBusy') : t('gcLocked'); }
        });
        c.onClose(function () {
            if (conn !== c) return;
            conn = null; linked = false; busy = false; release();
            if (run) { state(t('gcConnecting'), false); clearTimeout(retry); retry = setTimeout(attempt, 1200); }
        });
        c.send({ t: 'hi', p: player, cid: cid, name: name() });
    }
    function start() {
        var v = ui.code.value.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (v.length < 6) { ui.err.textContent = t('gcErrCode'); return; }
        if (!NetLink.supported()) { ui.err.textContent = t('gcNoRtc'); return; }
        code = v; ui.err.textContent = ''; save();
        Rooms.LIMITS.asksPerMin = 30;                               // it reconnects by itself every time the TV changes page
        run = true; sess = new Rooms.Session('controller', name(), onEvent);
        show(true); state(t('gcConnecting'), false); lock(); wake();
        attempt();
    }
    function stop() {
        run = false; clearTimeout(retry); clearTimeout(wait); release();
        if (conn) { var c = conn; conn = null; c.close(); }
        if (offerObj) { offerObj.cancel(); offerObj = null; }
        if (sess) { sess.destroy(); sess = null; }
        linked = false; busy = false; curReq = null;
        if (root) show(false);
    }

    /* ---------- buttons ---------- */
    function sync() {
        for (var a in want) if (want[a] !== !!sent[a]) {
            sent[a] = want[a];
            if (conn && linked) conn.send({ t: 'k', a: a, d: want[a] ? 1 : 0 });
            if (want[a] && navigator.vibrate) { try { navigator.vibrate(8); } catch (e) {} }
            var els = root ? root.querySelectorAll('[data-a="' + a + '"]') : [];
            for (var i = 0; i < els.length; i++) els[i].classList[want[a] ? 'add' : 'remove']('on');
        }
    }
    function release() { pointers = {}; for (var a in want) want[a] = false; sync(); }
    // the D-pad is one zone: direction from the touch point (diagonals included); the other buttons are what the finger is on
    function hit(x, y) {
        var out = [], dp = ui.dpad.getBoundingClientRect(), pad = dp.width * 0.25;
        if (x > dp.left - pad && x < dp.right + pad && y > dp.top - pad && y < dp.bottom + pad) {
            var dx = (x - (dp.left + dp.width / 2)) / dp.width, dy = (y - (dp.top + dp.height / 2)) / dp.height;
            if (dx < -0.14) out.push('left'); else if (dx > 0.14) out.push('right');
            if (dy < -0.14) out.push('up'); else if (dy > 0.14) out.push('down');
            return out;
        }
        var e = document.elementFromPoint(x, y), b = e && e.closest ? e.closest('.gc-b,.gc-m') : null;
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
    function onVis() { if (document.hidden) release(); else if (run) wake(); }

    /* ---------- phone: landscape, screen on ---------- */
    function lock() { try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(function () {}); } catch (e) {} }
    function wake() { try { if (navigator.wakeLock) navigator.wakeLock.request('screen').then(function (l) { wl = l; }, function () {}); } catch (e) {} }

    function build(body) {
        root = el('div', 'gc');
        ui.join = el('div', 'gc-join');
        ui.join.appendChild(el('h2', 'gc-title', t('gamepad')));
        ui.join.appendChild(el('p', 'gc-help', t('gcHelp')));
        ui.code = el('input', 'gc-code');
        ui.code.maxLength = 16; ui.code.autocomplete = 'off'; ui.code.setAttribute('autocapitalize', 'characters'); ui.code.spellcheck = false;
        ui.code.placeholder = t('ctrlCode'); ui.code.setAttribute('aria-label', t('ctrlCode')); ui.code.setAttribute('data-focus', '');
        ui.code.value = (saved.code || '').toUpperCase();
        ui.code.onkeydown = function (e) { if (e.key === 'Enter') start(); };
        ui.join.appendChild(ui.code);
        var row = el('div', 'gc-row');
        ui.p1 = el('button', 'btn', 'P1'); ui.p2 = el('button', 'btn', 'P2');
        ui.p1.setAttribute('data-focus', ''); ui.p2.setAttribute('data-focus', '');
        ui.p1.onclick = function () { pick(1); }; ui.p2.onclick = function () { pick(2); };
        row.appendChild(ui.p1); row.appendChild(ui.p2);
        ui.join.appendChild(row);
        ui.go = el('button', 'btn btn-primary', t('gcGo')); ui.go.setAttribute('data-focus', ''); ui.go.onclick = start;
        ui.join.appendChild(ui.go);
        ui.err = el('div', 'gc-err'); ui.err.setAttribute('role', 'alert');
        ui.join.appendChild(ui.err);
        root.appendChild(ui.join);

        ui.pad = el('div', 'gc-pad');
        ui.pad.setAttribute('aria-label', t('gamepad'));
        var bar = el('div', 'gc-bar');
        ui.dot = el('span', 'gc-dot'); ui.badge = el('span', 'gc-badge', 'P1'); ui.state = el('span', 'gc-state');
        bar.appendChild(ui.dot); bar.appendChild(ui.badge); bar.appendChild(ui.state);
        ui.pad.appendChild(bar);
        var leave = el('button', 'btn gc-leave', t('gcLeave')); leave.setAttribute('data-focus', ''); leave.onclick = function () { stop(); };
        leave.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
        ui.pad.appendChild(leave);
        ui.dpad = el('div', 'gc-dpad');
        [['up', '▲'], ['left', '◀'], ['right', '▶'], ['down', '▼']].forEach(function (d) { var b = el('div', 'gc-d gc-d-' + d[0], d[1]); b.setAttribute('data-a', d[0]); ui.dpad.appendChild(b); });
        ui.pad.appendChild(ui.dpad);
        [['cancel', 'C'], ['run', 'B'], ['ok', 'A']].forEach(function (b) { var e = el('div', 'gc-b gc-' + b[0], b[1]); e.setAttribute('data-a', b[0]); ui.pad.appendChild(e); });
        [['menu', '☰'], ['pause', '⏸']].forEach(function (b) { var e = el('div', 'gc-m gc-' + b[0], b[1]); e.setAttribute('data-a', b[0]); ui.pad.appendChild(e); });
        ui.pad.addEventListener('pointerdown', function (e) { pointers[e.pointerId] = hit(e.clientX, e.clientY); recompute(); try { ui.pad.setPointerCapture(e.pointerId); } catch (x) {} e.preventDefault(); });
        ui.pad.addEventListener('pointermove', function (e) { if (pointers[e.pointerId] === undefined) return; pointers[e.pointerId] = hit(e.clientX, e.clientY); recompute(); e.preventDefault(); });
        var end = function (e) { delete pointers[e.pointerId]; recompute(); };
        ui.pad.addEventListener('pointerup', end); ui.pad.addEventListener('pointercancel', end);
        ui.pad.addEventListener('contextmenu', function (e) { e.preventDefault(); });
        root.appendChild(ui.pad);
        body.appendChild(root);
    }

    Win.register('gamepad', {
        icon: 'controller',
        title: function () { return t('gamepad'); },
        open: function (body) {
            saved = Store.rawGet(KEY) || {};
            cid = typeof saved.cid === 'string' && /^[a-z0-9]{6,24}$/.test(saved.cid) ? saved.cid : '';
            if (!cid) for (var i = 0; i < 12; i++) cid += 'abcdefghijklmnopqrstuvwxyz0123456789'.charAt(Math.floor(Math.random() * 36));
            want = {}; sent = {}; pointers = {}; ui = {}; inPad = false;
            build(body);
            pick(saved.p === 2 ? 2 : 1);
            document.addEventListener('visibilitychange', onVis);
            window.GamepadApp = { linked: function () { return linked; }, running: function () { return run; } };
            return ui.code;
        },
        back: function () { if (!inPad) return false; stop(); return true; },
        close: function () {
            stop();
            document.removeEventListener('visibilitychange', onVis);
            try { if (wl) wl.release(); } catch (e) {}
            wl = null; root = null; ui = {};
            delete window.GamepadApp;
        }
    });
})();
