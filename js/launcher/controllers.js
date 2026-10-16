/* Phones as game controllers (player 1 / player 2). The phone opens controller/ (its own page, no game on it), types the
 * TV's code and picks P1 or P2; it then sends only button presses. The TV shows the game, as always.
 *   - Signalling: a room (js/core/rooms.js, app 'controller') whose code is kept on this TV, so a phone reconnects by itself
 *     when the page changes (opening a game / quitting loads another page). Only Firestore, no new rules except `app`.
 *   - Link: the same WebRTC data channel as multiplayer (js/core/netlink.js); presses never go through Firebase.
 *   - Player 1 = the 'keys' device (like the remote / keyboard), player 2 = 'keys2': every game already reads both (Input.remote).
 *   - A phone is trusted by a random id. New phones are accepted only for 5 minutes after "Pair a phone" in Settings > Devices.
 * Phone -> TV: { t: 'hi', p: 1|2, cid, name, proto, mode, session, caps, now } then { t: 'k', a: action, d: 1|0 } (pad mode).
 * TV -> phone: { t: 'ok', p, proto, session } | { t: 'no', why: 'busy'|'locked' }.
 * Sensor modes ('sensor-actions', 'sensor-raw'; protocol js/core/sensor-proto.js, docs/phone-controller.md): the TV sends the
 * phone a config (the moves the running app wants, the player profile, metrics on/off and rate); the phone sends only those
 * moves ({ type: 'action' }, acknowledged with { type: 'ack' }), metrics when asked, raw samples in sensor-raw mode.
 * Duplicated or stale actions (sequence numbers, timestamps on the TV clock) are dropped. While no app asked for sensor
 * events, moves work the menus and the games: LEFT / RIGHT = left / right, JUMP = OK (jump), DUCK..DUCK_END = down held.
 * Pointer mode ('pointer'): on the My PC screens the config says pointer: true and the phone points at the TV like a magic
 * remote: { t: 'pm', x, y } moves the pointer (js/launcher/pointer.js), { t: 'pc' } centres it; its A button (OK) acts on what
 * the pointer is on, B is back. On a game's page the config says pointer: false and the phone sends nothing.
 * Pad buttons: A = ok, B = 'b' (run + cancel, like a gamepad's B), X = menu, Y = run (Nintendo layout on the phone).
 *   Controllers.start()  (every page, does nothing while off)   .on() .setOn(v) .code() .newCode() .pair() .forget()
 *   .players() -> { 1: name|null, 2: name|null }   .modes() -> { 1: mode|null, 2: mode|null }   .pairing() -> seconds left   .onChange(fn)
 *   .sensorSetup(cfg, listener(player, msg)) | .sensorSetup(null)   (game-host.js, for the running app)   .sensorStats()
 *   .tune() / .setTune(t)   the Motion moves settings of this TV (arc_dev_ctrltune; Settings > Devices > Phone controller >
 *                           Motion moves), sent to every motion phone in its config and used there at once
 *   .monitor(fn(player, msg)) | .monitor(null)   that screen's live test: the moves arrive there and do not press buttons */
var Controllers = (function () {
    'use strict';

    var KEY = 'arc_dev_ctrl', TUNE_KEY = 'arc_dev_ctrltune', APP = 'controller', MAX_PHONES = 8, PAIR_MS = 300000, HELLO_MS = 4000;
    var ACTIONS = { left: 1, right: 1, up: 1, down: 1, ok: 1, run: 1, cancel: 1, b: 1, menu: 1, pause: 1, home: 1 };
    var DIRS = { left: 1, right: 1, up: 1, down: 1 };
    var ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';
    var status = { s: 'off', err: '' };
    var sess = null, slots = { 1: null, 2: null }, pairUntil = 0, listeners = [], timer = 0, started = false;
    var appCfg = null, appListener = null, cfgSeq = 0, monitorFn = null;
    var FALLBACK = { LEFT: 'left', RIGHT: 'right', JUMP: 'ok', DUCK: 'down', DUCK_END: 'down' };

    function cfg() {
        var c = Store.rawGet(KEY);
        if (!c || typeof c !== 'object') c = {};
        return { on: c.on === true, code: typeof c.code === 'string' && /^[a-z0-9]{6,16}$/.test(c.code) ? c.code : '', ok: c.ok instanceof Array ? c.ok : [] };
    }
    function save(c) { Store.rawSet(KEY, c); }
    function makeCode() {
        var out = '', b = new Uint8Array(8), i;
        try { (window.crypto || window.msCrypto).getRandomValues(b); } catch (e) { for (i = 0; i < 8; i++) b[i] = Math.floor(Math.random() * 256); }
        for (i = 0; i < 8; i++) out += ALPHA.charAt(b[i] % ALPHA.length);
        return out;
    }
    function changed() { for (var i = 0; i < listeners.length; i++) { try { listeners[i](); } catch (e) {} } }
    function say(text) { if (typeof App !== 'undefined' && App.toast) App.toast(text); }
    function count() { return 1 + (slots[1] ? 1 : 0) + (slots[2] ? 1 : 0); }
    function report() { if (sess) sess.call('count', { room: cfg().code, n: count() }, function () {}); changed(); }

    function drop(p, slot) {
        if (slots[p] !== slot) return;
        slots[p] = null;
        Input.releaseRemote(p);
        if (slot.mode === 'pointer') Pointer.hide();
        say(I18n.t('ctrlGone').replace('%s', slot.name).replace('%n', p));
        report();
    }

    // a connection came up: wait for the phone to say who it is
    function attach(conn) {
        var slot = null, t = setTimeout(function () { if (!slot) conn.close(); }, HELLO_MS);
        conn.onMessage(function (m) {
            if (!m || typeof m !== 'object') return;
            if (!slot) {
                if (m.t !== 'hi') return;
                var p = m.p === 2 ? 2 : 1, cid = typeof m.cid === 'string' && /^[a-z0-9]{6,24}$/.test(m.cid) ? m.cid : '', c = cfg(), name;
                name = typeof m.name === 'string' ? m.name.replace(/\s+/g, ' ').slice(0, 24) : '';
                clearTimeout(t);
                if (!cid) return conn.close();
                if (c.ok.indexOf(cid) < 0) {
                    if (Date.now() > pairUntil) { conn.send({ t: 'no', why: 'locked' }); return setTimeout(function () { conn.close(); }, 300); }
                    c.ok.push(cid); if (c.ok.length > MAX_PHONES) c.ok.shift();
                    save(c);
                }
                if (slots[p] && slots[p].cid !== cid) { conn.send({ t: 'no', why: 'busy' }); return setTimeout(function () { conn.close(); }, 300); }
                if (slots[p]) { var old = slots[p]; slots[p] = null; Input.releaseRemote(p); old.conn.close(); }
                var h = SensorProto.hello(m);
                slot = { conn: conn, cid: cid, p: p, name: name || 'Phone', mode: h.mode, proto: h.proto, session: h.session || SensorProto.session(),
                         offset: h.now ? Date.now() - h.now : null, seen: SensorProto.tracker(), stats: { actions: 0, duplicate: 0, stale: 0, invalid: 0, metrics: 0, raw: 0 } };
                slots[p] = slot;
                conn.send({ t: 'ok', p: p, proto: SensorProto.VERSION, session: slot.session });
                if (slot.mode !== 'pad') sendConfig(slot);
                say(I18n.t('ctrlOn').replace('%s', slot.name).replace('%n', p));
                report();
                return;
            }
            if (m.t === 'k') {
                if (typeof m.a !== 'string' || !ACTIONS.hasOwnProperty(m.a)) return;
                if (m.a === 'home') { if (m.d === 1) home(); return; }
                if (m.d === 1 && Pointer.visible()) {
                    if (m.a === 'ok' && Pointer.press()) return;              // clicked something that is not a focusable item
                    if (DIRS[m.a]) Pointer.hide();                            // arrows: back to the focus ring, like the remote
                }
                Input.remote(slot.p, m.a, m.d === 1);
                return;
            }
            if (m.t === 'pm' || m.t === 'pc') {
                var a = slot.mode === 'pointer' && slot.cfg && slot.cfg.pointer ? SensorProto.aim(m) : null;
                if (!a) slot.stats.invalid++; else if (a.t === 'pc') Pointer.center(); else Pointer.move(a.x, a.y);
                return;
            }
            if (slot.mode !== 'pad') sensorMessage(slot, m);
        });
        conn.onClose(function () { clearTimeout(t); if (slot) drop(slot.p, slot); });
    }

    /* ---------- sensor modes ---------- */
    function currentCfg() { return appCfg || SensorProto.config({ moves: SensorProto.DEFAULT_MOVES, metrics: { enabled: false } }); }
    function sendConfig(slot) {
        var c = JSON.parse(JSON.stringify(currentCfg()));
        c.session = slot.session; c.sequence = ++cfgSeq; c.timestamp = Date.now();
        c.pointer = slot.mode === 'pointer' && Pointer.allowed();          // never on a game's page
        c.tune = tune();
        slot.cfg = c;
        slot.conn.send(c);
    }
    function sensorMessage(slot, m) {
        var st = slot.stats, v;
        if (!m || typeof m !== 'object') return;
        if (m.type === 'action') {
            v = SensorProto.action(m);
            if (!v || slot.cfg.moves.indexOf(v.action) < 0) { st.invalid++; return; }
            var r = slot.seen.check(v.sequence, v.timestamp, slot.offset);
            slot.conn.send({ type: 'ack', sequence: v.sequence, duplicate: r === 'duplicate' || undefined, stale: r === 'stale' || undefined });
            if (r !== 'ok') { st[r]++; changed(); return; }
            st.actions++; slot.last = v.action;
            deliver(slot.p, v);
            changed();
        } else if (m.type === 'metrics') {
            v = SensorProto.metrics(m);
            if (!v || !slot.cfg.metrics.enabled) { st.invalid++; return; }
            st.metrics++; deliver(slot.p, v);
        } else if (m.type === 'raw') {
            v = SensorProto.raw(m);
            if (!v || slot.mode !== 'sensor-raw') { st.invalid++; return; }
            st.raw++; if (appListener) deliver(slot.p, v);
        } else st.invalid++;
    }
    // to the running app when it asked for sensor events; otherwise moves drive the menus and games like buttons
    function deliver(p, msg) {
        if (appCfg && appListener) { try { appListener(p, msg); } catch (e) {} return; }
        if (monitorFn) { try { monitorFn(p, msg); } catch (e) {} return; }     // the Motion moves screen's live test
        if (msg.type !== 'action' || !FALLBACK[msg.action]) return;
        var a = FALLBACK[msg.action];
        if (msg.action === 'DUCK') return Input.remote(p, a, true);
        if (msg.action === 'DUCK_END') return Input.remote(p, a, false);
        Input.remote(p, a, true);
        setTimeout(function () { Input.remote(p, a, false); }, 120);
    }

    function onEvent(ev, d) {
        if (ev === 'closed') { stop(); status = { s: 'opening', err: '' }; changed(); schedule(2000); return; }
        if (ev !== 'request') return;
        NetLink.answer(d.offer).then(function (a) {
            sess.call('accept', { room: d.room, req: d.id, answer: a.answer }, function (err) {
                if (err) { a.cancel(); report(); return; }
                a.connected.then(attach, function () { report(); });
            });
        }, function () {});
    }

    function open() {
        var c = cfg();
        if (!c.on || sess || !NetLink.supported()) return;
        sess = new Rooms.Session(APP, 'TV', onEvent);
        status = { s: 'opening', err: '' }; changed();
        sess.call('open', { id: c.code, max: 3, name: 'TV' }, function (err) {
            if (err) { stop(); status = { s: 'error', err: err }; changed(); schedule(err === 'offline' ? 10000 : 20000); }
            else { status = { s: 'ready', err: '' }; changed(); }
        });
    }
    function stop() {
        clearTimeout(timer);
        if (sess) { var s = sess; sess = null; s.destroy(); }
    }
    function schedule(ms) { clearTimeout(timer); timer = setTimeout(open, ms); }

    function tune() { return SensorProto.tune(Store.rawGet(TUNE_KEY)); }
    function resend() { for (var p = 1; p <= 2; p++) if (slots[p] && slots[p].mode !== 'pad') sendConfig(slots[p]); }

    // the pad's Home button (like a Nintendo Switch's): in a game the pause menu opens on "Quit to menu" (Home again goes back
    // to the game); on the desktop the open app closes. Never while a dialog, the keyboard or the sign-in screen is up.
    function home() {
        if (typeof GameHost !== 'undefined' && GameHost.active()) return GameHost.home();
        if (Welcome.open() || Keyboard.isOpen() || ProfilesUI.screenOpen() || Multiplayer.screenOpen() || App.dialogOpen()) return;
        if (Win.isOpen()) Win.close();
    }
    function closePhones() { for (var p = 1; p <= 2; p++) if (slots[p]) { var s = slots[p]; slots[p] = null; Input.releaseRemote(p); s.conn.close(); } }

    return {
        start: function () { if (started) return; started = true; if (cfg().on) open(); },
        on: function () { return cfg().on; },
        setOn: function (v) {
            var c = cfg();
            c.on = !!v;
            if (c.on && !c.code) c.code = makeCode();
            save(c);
            if (c.on) { started = true; pairUntil = Date.now() + PAIR_MS; open(); } else { closePhones(); stop(); status = { s: 'off', err: '' }; }
            changed();
        },
        code: function () { return cfg().code; },
        // the link in the QR code: the phone's camera opens My PC on the Game controller, which connects by itself
        pairUrl: function () {
            var b = (typeof AppBoot !== 'undefined' && AppBoot.base && AppBoot.base()) || '';
            if (!/^https:/.test(b)) b = /^https:/.test(location.href) && !/localhost|127\.0\.0\.1/.test(location.host) ? location.href.split(/[?#]/)[0].replace(/[^\/]*$/, '') : 'https://imad-os.github.io/g/';
            return b + 'index.html?pair=' + cfg().code;
        },
        status: function () { return status; },
        newCode: function () { var c = cfg(); c.code = makeCode(); c.ok = []; save(c); closePhones(); stop(); if (c.on) { pairUntil = Date.now() + PAIR_MS; open(); } changed(); },
        pair: function (sec) { pairUntil = Date.now() + (sec === undefined ? PAIR_MS : sec * 1000); changed(); },
        pairing: function () { return Math.max(0, Math.ceil((pairUntil - Date.now()) / 1000)); },
        forget: function () { var c = cfg(); c.ok = []; save(c); closePhones(); changed(); },
        phones: function () { return cfg().ok.length; },
        players: function () { return { 1: slots[1] ? slots[1].name : null, 2: slots[2] ? slots[2].name : null }; },
        modes: function () { return { 1: slots[1] ? slots[1].mode : null, 2: slots[2] ? slots[2].mode : null }; },
        // the running app asks for sensor events (MyPC.sensors.setup); null when it closes. Returns the config phones get.
        sensorSetup: function (cfg, listener) {
            appCfg = cfg ? SensorProto.config(cfg, typeof MotionEngine !== 'undefined' ? MotionEngine.MOVES : null) : null;
            appListener = appCfg ? listener || null : null;
            resend();
            return appCfg;
        },
        sensorConfig: function () { return appCfg; },
        tune: tune,
        setTune: function (t) { Store.rawSet(TUNE_KEY, t ? SensorProto.tune(t) : null); resend(); changed(); return tune(); },
        monitor: function (fn) { monitorFn = typeof fn === 'function' ? fn : null; },
        inject: function (p, msg) { deliver(p === 2 ? 2 : 1, msg); },      // diagnostics and tests: as if phone p had sent msg (already validated)
        sensorStats: function () {
            var out = {};
            for (var p = 1; p <= 2; p++) out[p] = slots[p] ? { mode: slots[p].mode, last: slots[p].last || null, stats: JSON.parse(JSON.stringify(slots[p].stats)) } : null;
            return out;
        },
        onChange: function (fn) { listeners.push(fn); },
        offChange: function (fn) { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }
    };
})();
