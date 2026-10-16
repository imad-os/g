/* Game controller (system app, for phones): this phone becomes player 1 or 2 of a TV running My PC. It shows no game.
 * The TV side is js/launcher/controllers.js (Settings > Devices > Phone controller shows the code). Signalling goes through
 * Firestore (js/core/rooms.js, app 'controller'), everything else through a direct WebRTC channel on the same Wi-Fi
 * (js/core/netlink.js). When the TV changes page (opens a game, quits) the link drops and this app reconnects by itself.
 * Four modes, picked before connecting:
 *   pad             the virtual pad My PC already draws over games (js/core/virtual-pad.js: stick, A B X Y in the Nintendo
 *                   diamond, gear to customize, pause), here full screen as a controller: { t: 'k', a, d } per press / release
 *   sensor-actions  the phone in the right hand, the player facing the TV: moves (LEFT RIGHT JUMP DUCK DUCK_END, or what the game
 *                   defines) found by js/core/motion.js; only the moves the TV's config asks for are sent, plus metrics when asked.
 *                   Live screen (gait, pace, speed, cadence, steps, distance, last move, link and sensor state, start / stop,
 *                   recalibrate, settings) and Debug screen (readings, steps, classifier states, events, diagnostics, record / replay)
 *   sensor-raw      the sensor samples themselves, batched at the rate the game asks for; the game does its own detection
 *   pointer         like a TV "magic remote" on the My PC screens: the phone turns, the TV pointer moves (js/core/aim.js fuses
 *                   gyroscope and accelerometer and smooths -> { t: 'pm', x, y }). Its screen has no stick: big A (OK on what
 *                   the pointer is on) and B (back), Center ({ t: 'pc' }), Calibrate (fixes reversed directions) and the
 *                   tuning settings (smoothness, speed, steady zone, swap left / right, swap up / down), kept on the phone
 * Phone settings (Settings button on every screen, kept on the phone in arc_dev_ctrlphone.opt): Auto rotate, Stay awake,
 * Background (the Android app keeps the link with the screen off) and GamePad (a D-pad in place of the stick). The Android
 * app (MyPCNative 3+) applies the first three natively; in a browser Auto rotate and Stay awake use the Screen Orientation
 * and Wake Lock APIs where the browser has them, and the settings it cannot do are not shown.
 * Protocol: js/core/sensor-proto.js, docs/phone-controller.md. Separate from the touch pad that the shell draws over games. */
(function () {
    'use strict';

    var KEY = 'arc_dev_ctrlphone', REC_MAX = 60 * 120;      // 2 minutes at 60 Hz
    var MODES = ['pad', 'sensor-actions', 'sensor-raw', 'pointer'], MODE_NAMES = ['gcModePad', 'gcModeActions', 'gcModeRaw', 'gcModePointer'];
    // the pad layout (buttons, sizes, places) is kept in My PC's store too, so it is never lost between opens
    var PAD_STORE = { get: function (k) { return Store.rawGet('arc_dev_' + k); }, set: function (k, v) { Store.rawSet('arc_dev_' + k, v); } };
    // A B X Y where a Nintendo controller has them: A right (OK / jump), B bottom (back / run, like a gamepad's B), X top (the
    // game's menu), Y left (run)
    var ABXY = [{ label: 'A', key: 13, action: 'ok', place: 'right' }, { label: 'B', key: 88, action: 'b', place: 'bottom' },
                { label: 'X', key: 77, action: 'menu', place: 'top' }, { label: 'Y', key: 90, action: 'run', place: 'left' }];
    var PAD = { buttons: ABXY, catalog: ABXY };
    var root = null, code = '', player = 1, mode = 'pad', run = false, busy = false, conn = null, linked = false, sess = null, retry = 0, wait = 0, curReq = null, offerObj = null;
    var want = {}, sent = {}, ui = {}, saved = {}, cid = '', inPad = false, wl = null, session = '';
    // sensor modes
    var cfg = null, eng = null, sensing = false, perm = 'unknown', lastSample = 0, caps = { motion: false, linear: false, rotation: false }, seq = 0, acks = {}, rtt = 0;
    var log = [], diag = { acked: 0, tvDuplicate: 0, tvStale: 0, unacked: 0 }, lastAction = null, metricsTimer = 0, rawBuf = [], rawLast = 0, rawTimer = 0, rawSent = 0, liveTimer = 0;
    var fromQr = false, triedOther = false, scan = null;
    var tab = 'live', showSettings = false, rec = null, recording = false, replay = null, lastRaw = null, plot = [];
    // Train tab (js/core/motion-train.js): each move done TRAIN_REPS times; this player's limits are kept on the phone
    var TRAIN_KEY = 'arc_dev_ctrltrain', TRAIN_MOVES = ['LEFT', 'RIGHT', 'JUMP', 'DUCK'], TRAIN_REPS = 5;
    var trained = null, trainer = null, trainBuf = [];
    // pointer mode (js/core/aim.js): settings kept on the phone; calibration steps
    var PTR_DEF = { smooth: 5, speed: 1, steady: 1.5, swapX: false, swapY: false };
    var aim = null, aimLast = 0, calib = null;
    // phone settings (all on except GamePad)
    var OPT_DEF = { rotate: true, awake: true, bg: true, dpad: false }, OPT_NAMES = [['rotate', 'gcRotate'], ['awake', 'gcAwake'], ['bg', 'gcBackground'], ['dpad', 'gcDpad']];

    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
    function t(k) { return I18n.t(k); }
    function btn(cls, text, fn) { var b = el('button', 'btn' + (cls ? ' ' + cls : ''), text); b.setAttribute('data-focus', ''); b.onclick = fn; return b; }
    // the Android app (android-controller/) adds window.MyPCNative: native sensors, QR scanner, link kept with the screen off
    function native(fn, v) { try { if (window.MyPCNative && typeof window.MyPCNative[fn] === 'function') { window.MyPCNative[fn](v); return true; } } catch (e) {} return false; }
    function name() { return /Android/i.test(navigator.userAgent) ? 'Android' : /iPhone|iPad/i.test(navigator.userAgent) ? 'iPhone' : 'Phone'; }
    function prefs() { var p = saved.prefs || {}; return { profile: SensorProto.profile(p.profile), sensitivity: +p.sensitivity || 1, stride: +p.stride || 1, swap: !!p.swap }; }
    function save() { Store.rawSet(KEY, { cid: cid, code: code, p: player, mode: mode, prefs: saved.prefs || {}, ptr: saved.ptr || {}, opt: saved.opt || {}, paired: !!saved.paired }); }
    function opts() { var o = saved.opt || {}, r = {}; for (var k in OPT_DEF) r[k] = typeof o[k] === 'boolean' ? o[k] : OPT_DEF[k]; return r; }
    function nativeV() { try { return window.MyPCNative && typeof MyPCNative.version === 'function' ? +MyPCNative.version() || 0 : 0; } catch (e) { return 0; } }
    // which settings this phone can honour: the app (3+) all of them; an older app none but GamePad (it keeps the screen on,
    // turns with the phone and stays connected anyway); a browser rotation and screen on when it has the APIs
    function canOpt(k) {
        var v = nativeV();
        if (k === 'dpad' || v >= 3) return true;
        if (v) return false;
        if (k === 'rotate') return !!(screen.orientation && screen.orientation.lock);
        if (k === 'awake') return !!navigator.wakeLock;
        return false;
    }
    function setOpt(k, v) {
        var o = opts(); o[k] = !!v; saved.opt = o; save();
        applyOpts();
        if (k === 'dpad' && VirtualPad.active()) VirtualPad.hide();            // drawn again with or without the D-pad on close
    }
    function applyOpts() {
        var o = opts();
        native('settings', JSON.stringify({ rotate: o.rotate, awake: o.awake, bg: o.bg }));
        lock();
        if (run && o.awake) wake(); else unwake();
    }
    function ptrPrefs() {
        var p = saved.ptr || {}, n = function (v, lo, hi, d) { v = +v; return isFinite(v) && v >= lo && v <= hi ? v : d; };
        return { smooth: n(p.smooth, 1, 10, PTR_DEF.smooth), speed: n(p.speed, 0.3, 3, PTR_DEF.speed), steady: n(p.steady, 0, 6, PTR_DEF.steady), swapX: !!p.swapX, swapY: !!p.swapY };
    }
    function setPtr(fn) { var p = ptrPrefs(); if (fn) fn(p); saved.ptr = p; save(); if (aim) aim.set(p); paintPtr(); }
    function setPrefs(fn) { var p = prefs(); fn(p); saved.prefs = { profile: p.profile, sensitivity: p.sensitivity, stride: p.stride, swap: p.swap }; save(); applyCfg(); }
    function state(text, ok) {
        if (ui.state) ui.state.textContent = text;
        if (ui.dot) ui.dot.className = 'gc-dot' + (ok ? ' ok' : '');
        if (ui.sState) ui.sState.textContent = text;
        if (ui.sDot) ui.sDot.className = 'gc-dot' + (ok ? ' ok' : '');
        if (ui.pState) ui.pState.textContent = text;
        if (ui.pDot) ui.pDot.className = 'gc-dot' + (ok ? ' ok' : '');
    }
    function pick(p) { player = p; ui.p1.className = 'btn' + (p === 1 ? ' btn-primary' : ''); ui.p2.className = 'btn' + (p === 2 ? ' btn-primary' : ''); if (ui.badge) ui.badge.textContent = 'P' + p; if (ui.sBadge) ui.sBadge.textContent = 'P' + p; if (ui.pBadge) ui.pBadge.textContent = 'P' + p; }
    function pickMode(m) { mode = MODES.indexOf(m) >= 0 ? m : 'pad'; for (var i = 0; i < MODES.length; i++) ui['m' + i].className = 'btn' + (MODES[i] === mode ? ' btn-primary' : ''); }
    function pointing() { return mode === 'pointer' && !!(cfg && cfg.pointer); }
    function show(on) {
        inPad = on; ui.join.hidden = on;
        var padUi = on && mode === 'pad', ptrUi = on && mode === 'pointer';
        ui.bar.hidden = ui.padBg.hidden = ui.setBtn.hidden = !padUi;
        ui.ptr.hidden = !ptrUi;
        ui.sense.hidden = !(on && !padUi && !ptrUi);
        if (padUi) VirtualPad.init({ storage: PAD_STORE, id: 'controller', force: true, scale: { stick: 1.35, btn: 1.15 }, buttons: PAD.buttons, catalog: PAD.catalog, onAction: padAction, dpad: opts().dpad, home: true });
        else if (VirtualPad.active()) VirtualPad.hide();
        if (ptrUi) paintPtr();
        if (on && !padUi && !ptrUi) { ui.modeName.textContent = t(mode === 'sensor-raw' ? 'gcModeRaw' : 'gcModeActions'); setTab('live'); }
        if (!on && ui.go) Focus.focus(ui.go);
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
            if (m.t === 'ok') { linked = true; saved.paired = true; if (typeof m.session === 'string') session = m.session; save(); pick(m.p === 2 ? 2 : 1); state(t('gcOn'), true); }
            else if (m.t === 'no') {
                if (m.why === 'busy' && fromQr && !triedOther) { triedOther = true; stop(); pick(player === 1 ? 2 : 1); start(); return; }   // scanned: take the free player
                stop(); ui.err.textContent = m.why === 'busy' ? t('gcBusy') : t('gcLocked');
            }
            else if (m.type === 'config') {
                var v = SensorProto.config(m, MotionEngine.MOVES);
                if (v) { cfg = v; applyCfg(); note('config', (v.pointer ? 'pointer ' : '') + (v.moves.join(' ') || '—')); paintPtr(); }
            }
            else if (m.type === 'ack') onAck(SensorProto.ack(m));
        });
        c.onClose(function () {
            if (conn !== c) return;
            conn = null; linked = false; busy = false; release();
            if (run) { state(t('gcConnecting'), false); clearTimeout(retry); retry = setTimeout(attempt, 1200); }
        });
        c.send({ t: 'hi', p: player, cid: cid, name: name(), proto: SensorProto.VERSION, mode: mode, session: session || SensorProto.session(), caps: { motion: caps.motion, orientation: 'DeviceOrientationEvent' in window }, now: Date.now() });
    }
    function start() {
        var v = ui.code.value.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (v.length < 6) { ui.err.textContent = t('gcErrCode'); return; }
        if (!NetLink.supported()) { ui.err.textContent = t('gcNoRtc'); return; }
        code = v; ui.err.textContent = ''; save();
        Rooms.LIMITS.asksPerMin = 30;                               // it reconnects by itself every time the TV changes page
        run = true; session = SensorProto.session(); cfg = null;
        sess = new Rooms.Session('controller', name(), onEvent);
        show(true); state(t('gcConnecting'), false); lock(); wake(); native('active', true);
        if (mode !== 'pad') sensorsOn();                           // the tap on Connect also answers the motion permission prompt (iPhone)
        attempt();
    }
    function stop() {
        run = false; clearTimeout(retry); clearTimeout(wait); release(); native('active', false); unwake();
        sensorsOff();
        if (conn) { var c = conn; conn = null; c.close(); }
        if (offerObj) { offerObj.cancel(); offerObj = null; }
        if (sess) { sess.destroy(); sess = null; }
        linked = false; busy = false; curReq = null;
        if (root) show(false);
    }
    function send(m) { return !!(conn && linked && conn.send(m)); }

    /* ---------- pad mode: the existing virtual pad ---------- */
    function padAction(a, down) { want[a] = down; sync(); }
    function sync() {
        for (var a in want) if (want[a] !== !!sent[a]) {
            sent[a] = want[a];
            send({ t: 'k', a: a, d: want[a] ? 1 : 0 });
            if (want[a] && navigator.vibrate) { try { navigator.vibrate(8); } catch (e) {} }
        }
    }
    function release() { for (var a in want) want[a] = false; sync(); }
    function onVis() { if (document.hidden) release(); else if (run) wake(); }

    /* ---------- sensor modes ---------- */
    function applyCfg() {
        if (!eng) return;
        var p = prefs(), c = cfg || SensorProto.config({ moves: SensorProto.DEFAULT_MOVES }, MotionEngine.MOVES);
        eng.configure(tuned(c, p, { moves: c.moves, define: defines(c), profile: c.profile || p.profile, strideScale: p.stride }));
        clearInterval(metricsTimer); metricsTimer = 0;
        if (mode === 'sensor-actions' && c.metrics.enabled) metricsTimer = setInterval(sendMetrics, Math.round(1000 / c.metrics.hz));
        if (ui.profileFrom) ui.profileFrom.textContent = c.profile ? t('gcProfileGame') : '';
    }
    // the TV's Motion moves settings (config.tune: limits per move, harder while running, repeat guard); this phone's own
    // Sensitivity multiplies the TV's
    function tuned(c, p, o) {
        var tu = c.tune || SensorProto.tune(null);
        o.sensitivity = p.sensitivity * tu.sensitivity; o.scales = tu.scales; o.runScale = tu.run_scale; o.guardMs = tu.guard_ms;
        return o;
    }
    // this player's trained limits for the built-in moves, then the game's own rules (a game's rule for the same move wins)
    function defines(c) {
        var d = {}, k, tr = trained && trained.define || {};
        for (k in tr) if (tr.hasOwnProperty(k)) d[k] = tr[k];
        for (k in (c.define || {})) if (c.define.hasOwnProperty(k)) d[k] = c.define[k];
        return d;
    }
    function sensorsOn() {
        if (sensing) return;
        if (!('DeviceMotionEvent' in window)) { perm = 'missing'; paint(); return; }
        function go() { perm = perm === 'unknown' ? 'granted' : perm; window.addEventListener('devicemotion', onMotion); sensing = true; paint(); }
        if (typeof DeviceMotionEvent.requestPermission === 'function') {           // iPhone: must come from a tap
            try { DeviceMotionEvent.requestPermission().then(function (r) { perm = r === 'granted' ? 'granted' : 'denied'; if (perm === 'granted') go(); else paint(); }, function () { perm = 'denied'; paint(); }); }
            catch (e) { perm = 'denied'; paint(); }
        } else go();
    }
    function sensorsOff() {
        if (sensing) window.removeEventListener('devicemotion', onMotion);
        sensing = false; clearInterval(metricsTimer); metricsTimer = 0; clearInterval(rawTimer); rawTimer = 0; rawBuf = [];
        stopTrain(); stopRecord(); stopReplay(); paint();
    }
    function newEngine() {
        eng = MotionEngine.create({ onAction: onMove, onStep: function (s) { note('step', '#' + s.n + ' ' + s.gait + ' ' + s.peak.toFixed(1) + ' m/s²'); } });
        applyCfg();
    }
    function onMotion(e) {
        var a = e.acceleration || {}, g = e.accelerationIncludingGravity || {}, r = e.rotationRate || {}, now = typeof e.t === 'number' ? e.t : performance.now();   // t: replayed / test samples
        if (g.x === null || g.x === undefined) return;
        caps.motion = true; caps.linear = a.x !== null && a.x !== undefined; caps.rotation = r.alpha !== null && r.alpha !== undefined;
        var s = { t: now, ax: caps.linear ? a.x : null, ay: caps.linear ? a.y : null, az: caps.linear ? a.z : null, gx: g.x, gy: g.y, gz: g.z,
                  ra: caps.rotation ? r.alpha : null, rb: caps.rotation ? r.beta : null, rg: caps.rotation ? r.gamma : null,
                  angle: screen.orientation ? screen.orientation.angle : (window.orientation || 0) };
        lastSample = now; lastRaw = s;
        if (trainer) { trainBuf.push(s); if (trainBuf.length > 400) trainBuf.shift(); }      // the move trainer's last seconds
        if (recording && rec.length < REC_MAX) rec.push(s); else if (recording) stopRecord();
        if (mode === 'pointer') return aimPush(s, now);
        if (mode === 'sensor-raw') return rawPush(s, now);
        eng.feed(s);
        if (tab === 'debug') { var sg = eng.debug().signals; plot.push([sg.vertical || 0, sg.lateral || 0]); if (plot.length > 240) plot.shift(); }
    }
    function onMove(name, info) {
        var p = prefs(), c = cfg;
        if (p.swap && (name === 'LEFT' || name === 'RIGHT')) name = name === 'LEFT' ? 'RIGHT' : 'LEFT';
        lastAction = { name: name, at: Date.now(), conf: info.confidence };
        if (trainer) { note('train', name); flash(); return; }                      // training: shown, never sent
        if (!c || c.moves.indexOf(name) < 0) { note('local', name); flash(); return; }     // not asked for by the game: shown, not sent
        var m = { type: 'action', action: name, timestamp: Date.now(), sequence: ++seq, confidence: info.confidence, gait: info.gait };
        if (send(m)) { acks[m.sequence] = performance.now(); note('sent', name + ' #' + m.sequence + ' ' + Math.round(info.confidence * 100) + '%'); }
        else note('offline', name);
        if (navigator.vibrate) { try { navigator.vibrate(15); } catch (e) {} }
        flash();
    }
    function onAck(a) {
        if (!a || acks[a.sequence] === undefined) return;
        rtt = Math.round(performance.now() - acks[a.sequence]); delete acks[a.sequence];
        diag.acked++;
        if (a.duplicate) diag.tvDuplicate++;
        if (a.stale) diag.tvStale++;
    }
    function sendMetrics() {
        if (!eng || !linked) return;
        var m = eng.metrics();
        send({ type: 'metrics', gait: m.gait, cadence: m.cadence, speed_kmh: m.speed_kmh, pace_sec_per_km: m.pace_sec_per_km, distance_m: m.distance_m, steps: m.steps, timestamp: Date.now(), sequence: ++seq });
    }
    // sensor-raw: samples at the game's rate, sent in small batches (20 messages a second at most)
    function rawPush(s, now) {
        var hz = cfg ? cfg.raw.hz : 30;
        if (now - rawLast < 1000 / hz - 2) return;
        var dt = rawLast ? Math.round(now - rawLast) : 0; rawLast = now;
        function r2(v) { return v === null || v === undefined ? null : Math.round(v * 100) / 100; }
        rawBuf.push([dt, r2(s.ax), r2(s.ay), r2(s.az), r2(s.gx), r2(s.gy), r2(s.gz), r2(s.ra), r2(s.rb), r2(s.rg)]);
        if (rawBuf.length >= 12) flushRaw();
        if (!rawTimer) rawTimer = setInterval(flushRaw, 50);
    }
    function flushRaw() {
        if (!rawBuf.length) return;
        var b = rawBuf; rawBuf = [];
        if (send({ type: 'raw', timestamp: Date.now(), sequence: ++seq, hz: cfg ? cfg.raw.hz : 30, s: b })) rawSent += b.length;
    }

    /* ---------- pointer mode: how far the phone turned, at most 50 small messages a second and only while it moves ---------- */
    function aimPush(s, now) {
        if (s.ra === null) { caps.rotation = false; if (ui.pNote && ui.pNote.textContent !== t('gcNoGyro')) ui.pNote.textContent = t('gcNoGyro'); return; }
        aim.feed(s);
        if (now - aimLast < 20) return;
        aimLast = now;
        var d = aim.take(ptrPrefs().speed);
        if (d && pointing()) send({ t: 'pm', x: Math.max(-9000, Math.min(9000, d[0])), y: Math.max(-9000, Math.min(9000, d[1])) });
    }
    function center() { if (aim) aim.reset(); send({ t: 'pc' }); }
    // A and B of the pointer screen; a click holds the pointer still for a moment (pressing must not move it)
    function ptrButton(label, action, cls) {
        var b = el('button', 'gc-pbtn ' + cls, label);
        function on(v) { return function (ev) { if (v && action === 'ok' && aim) aim.hold(250); padAction(action, v); b.classList.toggle('on', v); if (v) buzz(10); ev.preventDefault(); }; }
        b.addEventListener('pointerdown', on(true)); b.addEventListener('pointerup', on(false)); b.addEventListener('pointercancel', on(false)); b.addEventListener('pointerleave', on(false));
        return b;
    }
    // Calibrate: hold still (the gyroscope's offset is learnt, the pointer goes to the middle), turn right, tilt up; a direction
    // that comes out reversed is swapped. Kept on the phone with the other pointer settings.
    function cue(text, kind) { if (!ui.pCue) return; ui.pCue.textContent = text; ui.pCue.className = 'gc-tcue' + (kind ? ' ' + kind : ''); }
    function calibrate() {
        if (calib) return endCalib('', '');
        if (!sensing) sensorsOn();
        calib = { step: 'still', at: performance.now(), timer: 0 };
        cue(t('gcPtrCalStill'));
        calibTick();
        paintPtr();
    }
    function calibTick() {
        var C = calib;
        if (!C) return;
        var ms = performance.now() - C.at, tt = aim.turned();
        if (C.step === 'still') {
            if (aim.still()) { center(); buzz(40); C.step = 'right'; C.at = performance.now(); C.x0 = tt.x; cue(t('gcPtrCalRight'), 'go'); }
            else if (ms > 6000) return endCalib(t('gcCalibFail'), 'warn');
        } else if (C.step === 'right' && ms > 2200) {
            var dx = tt.x - C.x0;
            if (Math.abs(dx) < 4) return endCalib(t('gcPtrCalMore'), 'warn');
            setPtr(function (p) { p.swapX = dx < 0; });
            center(); buzz(40); C.step = 'up'; C.at = performance.now(); C.y0 = aim.turned().y; cue(t('gcPtrCalUp'), 'go');
        } else if (C.step === 'up' && ms > 2200) {
            var dy = tt.y - C.y0;
            if (Math.abs(dy) < 4) return endCalib(t('gcPtrCalMore'), 'warn');
            setPtr(function (p) { p.swapY = dy > 0; });
            center(); buzz(60);
            return endCalib(t('gcCalibrated'), 'go');
        }
        C.timer = setTimeout(calibTick, 100);
    }
    function endCalib(text, kind) {
        if (calib) clearTimeout(calib.timer);
        calib = null;
        cue(text || '', kind);
        if (text) note('calib', text);
        paintPtr();
    }
    function paintPtr() {
        if (!ui.ptr || ui.ptr.hidden) return;
        var p = ptrPrefs();
        ui.vSmooth.textContent = String(p.smooth); ui.vSpeed2.textContent = Math.round(p.speed * 100) + '%'; ui.vSteady.textContent = p.steady.toFixed(1);
        ui.swX.checked = p.swapX; ui.swY.checked = p.swapY;
        ui.calBtn.textContent = calib ? t('gcTrainStop') : t('gcPtrCalib');
        ui.pNote.textContent = caps.motion && !caps.rotation ? t('gcNoGyro') : cfg && !cfg.pointer ? t('gcPtrOnlyMenus') : perm === 'denied' ? t('gcPerm') + ': ' + t('gcPermDenied') : '';
    }
    function buildPointer() {
        var s = el('div', 'gc-ptr'), top = el('div', 'gc-stop');
        s.hidden = true;
        ui.pDot = el('span', 'gc-dot'); ui.pBadge = el('span', 'gc-badge', 'P1'); ui.pState = el('span', 'gc-state');
        [ui.pDot, ui.pBadge, el('span', 'gc-mode', t('gcModePointer')), ui.pState, el('span', 'gc-grow')].forEach(function (x) { top.appendChild(x); });
        top.appendChild(btn('gc-modebtn', t('gcMode'), openModes)); top.appendChild(btn('gc-modebtn', t('gcSettings'), openPhone)); top.appendChild(btn('gc-leave2', t('gcLeave'), function () { stop(); }));
        s.appendChild(top);
        var body = el('div', 'gc-pbody'), set = el('div', 'gc-pset');
        set.appendChild(el('div', 'gc-line', t('gcPtrHelp')));
        ui.pNote = el('div', 'gc-note'); set.appendChild(ui.pNote);
        ui.pCue = el('div', 'gc-tcue'); ui.pCue.setAttribute('role', 'status'); ui.pCue.setAttribute('aria-live', 'assertive'); set.appendChild(ui.pCue);
        function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, Math.round(v * 100) / 100)); }
        function stepper(label, fn) {
            var r = el('div', 'gc-srow'), v = el('span', 'gc-pval');
            r.appendChild(el('span', 'gc-grow', label));
            r.appendChild(btn('gc-step', '−', function () { setPtr(function (p) { fn(p, -1); }); }));
            r.appendChild(v);
            r.appendChild(btn('gc-step', '+', function () { setPtr(function (p) { fn(p, 1); }); }));
            set.appendChild(r);
            return v;
        }
        ui.vSmooth = stepper(t('gcPtrSmooth'), function (p, d) { p.smooth = clamp(p.smooth + d, 1, 10); });
        ui.vSpeed2 = stepper(t('gcPtrSpeed'), function (p, d) { p.speed = clamp(p.speed + d * 0.1, 0.3, 3); });
        ui.vSteady = stepper(t('gcPtrSteady'), function (p, d) { p.steady = clamp(p.steady + d * 0.5, 0, 6); });
        function check(label, key) {
            var r = el('label', 'gc-srow'), c = el('input');
            c.type = 'checkbox'; c.setAttribute('data-focus', '');
            c.onchange = function () { setPtr(function (p) { p[key] = c.checked; }); };
            r.appendChild(el('span', 'gc-grow', label)); r.appendChild(c); set.appendChild(r);
            return c;
        }
        ui.swX = check(t('gcPtrSwapX'), 'swapX'); ui.swY = check(t('gcPtrSwapY'), 'swapY');
        var acts = el('div', 'gc-row gc-acts');
        ui.calBtn = btn('btn-primary gc-pcal', t('gcPtrCalib'), calibrate);
        acts.appendChild(ui.calBtn);
        acts.appendChild(btn('gc-pcenter', t('gcCenter'), center));
        acts.appendChild(btn('', t('gcPtrReset'), function () { endCalib(); saved.ptr = {}; setPtr(); }));
        set.appendChild(acts);
        body.appendChild(set);
        var pads = el('div', 'gc-pbtns');                         // Nintendo places: A on the right, B below it to the left
        pads.appendChild(ptrButton('A', 'ok', 'gc-pa')); pads.appendChild(ptrButton('B', 'b', 'gc-pb'));
        body.appendChild(pads);
        s.appendChild(body);
        return s;
    }

    /* ---------- pairing by QR code: the TV shows <My PC address>?pair=<code> (Settings > Devices > Phone controller) ---------- */
    function codeFrom(text) {
        var m = /[?&]pair=([a-z0-9]{6,16})/i.exec(String(text || '')) || /^([a-z0-9]{6,16})$/i.exec(String(text || '').trim());
        return m ? m[1].toLowerCase() : '';
    }
    function pairWith(c) { fromQr = true; triedOther = false; ui.code.value = c.toUpperCase(); start(); }
    // the phone's own QR reader (BarcodeDetector, Chrome on Android); elsewhere the camera app opens the link by itself
    function startScan() {
        ui.err.textContent = '';
        if (native('scanQr')) return;                               // the app's own scanner answers with GamepadApp.scanCode()
        if (!('BarcodeDetector' in window) || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { ui.err.textContent = t('gcScanCamera'); return; }
        var det; try { det = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { ui.err.textContent = t('gcScanCamera'); return; }
        var box = el('div', 'gc-scanner'), video = el('video', 'gc-video'), close = btn('gc-scanclose', t('cancel'), stopScan);
        video.setAttribute('playsinline', ''); video.muted = true;
        box.appendChild(video); box.appendChild(el('div', 'gc-scanhint', t('gcScanHint'))); box.appendChild(close);
        root.appendChild(box);
        scan = { box: box, video: video, stream: null, timer: 0 };
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(function (s) {
            if (!scan) { s.getTracks().forEach(function (k) { k.stop(); }); return; }
            scan.stream = s; video.srcObject = s; video.play().catch(function () {});
            scan.timer = setInterval(function () {
                if (!scan || video.readyState < 2) return;
                det.detect(video).then(function (codes) {
                    for (var i = 0; i < codes.length; i++) { var c = codeFrom(codes[i].rawValue); if (c) { stopScan(); if (navigator.vibrate) { try { navigator.vibrate(30); } catch (e) {} } pairWith(c); return; } }
                }, function () {});
            }, 250);
        }, function () { stopScan(); ui.err.textContent = t('gcScanDenied'); });
        Focus.focus(close);
    }
    function stopScan() {
        if (!scan) return;
        clearInterval(scan.timer);
        if (scan.stream) scan.stream.getTracks().forEach(function (k) { k.stop(); });
        if (scan.box.parentNode) scan.box.parentNode.removeChild(scan.box);
        scan = null;
    }

    /* ---------- switching mode while connected: reconnects at once with the same code and player ---------- */
    function openModes() {
        if (ui.modes) return;
        if (VirtualPad.active()) VirtualPad.hide();                // the pad sits above the app: out of the way while choosing
        var box = el('div', 'gc-modepick'), names = MODE_NAMES, first = null;
        box.appendChild(el('div', 'gc-title', t('gcMode')));
        names.forEach(function (k, i) {
            var b = btn(MODES[i] === mode ? 'btn-primary' : '', t(k), function () { closeModes(); switchMode(MODES[i]); });
            box.appendChild(b); if (MODES[i] === mode) first = b;
        });
        box.appendChild(btn('', t('cancel'), closeModes));
        root.appendChild(box); ui.modes = box;
        Focus.focus(first);
    }
    function closeModes() {
        if (ui.modes && ui.modes.parentNode) ui.modes.parentNode.removeChild(ui.modes);
        ui.modes = null;
        if (inPad && mode === 'pad' && !VirtualPad.active()) show(true);
        else if (!inPad && ui.go) Focus.focus(ui.go);
    }
    // the phone settings, over everything like the mode list (Back closes it); the pad is drawn again on close
    function openPhone() {
        if (ui.modes) return;
        if (VirtualPad.active()) VirtualPad.hide();
        var box = el('div', 'gc-modepick gc-phoneset'), o = opts(), first = null;
        box.appendChild(el('div', 'gc-title', t('gcPhone')));
        OPT_NAMES.forEach(function (n) {
            if (!canOpt(n[0])) return;
            var r = el('label', 'gc-srow gc-check'), c = el('input');
            c.type = 'checkbox'; c.checked = o[n[0]]; c.setAttribute('data-focus', ''); c.setAttribute('data-opt', n[0]);
            c.onchange = function () { setOpt(n[0], c.checked); };
            r.appendChild(el('span', 'gc-grow', t(n[1]))); r.appendChild(c); box.appendChild(r);
            if (!first) first = c;
        });
        box.appendChild(el('div', 'gc-line', t('gcPhoneSaved')));
        // the TV this phone connects to by itself: Disconnect (for now) and Forget TV (no more connecting by itself)
        var tvRow = el('div', 'gc-row');
        if (run) tvRow.appendChild(btn('gc-disc', t('gcDisconnect'), function () { closeModes(); stop(); }));
        if (saved.paired || code) tvRow.appendChild(btn('gc-forget', t('gcForget') + (code ? ' ' + code.toUpperCase() : ''), forget));
        if (tvRow.firstChild) box.appendChild(tvRow);
        var cl = btn('btn-primary', t('close'), closeModes);
        box.appendChild(cl);
        root.appendChild(box); ui.modes = box;
        Focus.focus(first || cl);
    }
    function forget() {
        closeModes(); stop();
        saved.paired = false; code = ''; session = ''; ui.code.value = ''; save();
        if (typeof App !== 'undefined' && App.toast) App.toast(t('gcForgotten'));
        Focus.focus(ui.code);
    }
    function switchMode(m) {
        if (m === mode) return;
        var p = player;
        stop(); pickMode(m); pick(p); save();
        start();
    }

    /* ---------- Train: each move a few times, limits from this player's own moves (js/core/motion-train.js) ---------- */
    function loadTrained() {
        var d = Store.rawGet(TRAIN_KEY);
        trained = d && typeof d === 'object' && d.reps && typeof d.reps === 'object' ? d : { reps: {}, define: {}, report: [] };
    }
    function saveTrained() {
        var t = MotionTrain.tune(trained.reps);
        trained.define = t.define; trained.report = t.report;
        try { Store.rawSet(TRAIN_KEY, trained); } catch (e) {}
        applyCfg();
    }
    function buzz(ms) { if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) {} } }
    // one move, TRAIN_REPS times: "get ready" (1.2 s), "go" (1.6 s recorded, with the second before it), a short pause
    function trainMove(move) {
        if (trainer) return stopTrain();
        if (!sensing) sensorsOn();
        trained.reps[move] = [];
        trainer = { move: move, n: 0, phase: 'ready', goT: 0, timer: 0 };
        trainBuf = [];
        note('train', move);
        trainStep();
    }
    function trainStep() {
        var T = trainer;
        if (!T) return;
        if (T.phase === 'ready') {
            T.cue = t('gcTrainReady') + ' ' + (T.n + 1) + '/' + TRAIN_REPS;
            T.phase = 'go'; T.timer = setTimeout(trainStep, 1200);
        } else if (T.phase === 'go') {
            buzz(60); T.goT = performance.now(); T.cue = t('gcTrainGo') + ' ' + T.move;
            T.phase = 'end'; T.timer = setTimeout(trainStep, 1600);
        } else {
            buzz(20);
            var from = T.goT - 1000, s = trainBuf.filter(function (x) { return x.t >= from; });
            if (s.length > 20) { trained.reps[T.move].push(MotionTrain.measure(s, T.goT)); T.n++; }
            if (T.n >= TRAIN_REPS || !sensing) return stopTrain();
            T.phase = 'ready'; T.cue = ''; T.timer = setTimeout(trainStep, 700);
        }
        paint();
    }
    function stopTrain() {
        if (!trainer) return;
        clearTimeout(trainer.timer);
        note('train', trainer.move + ' ' + trainer.n + '/' + TRAIN_REPS);
        trainer = null; trainBuf = [];
        saveTrained();
        paint();
    }
    function paintTrain() {
        ui.tCue.textContent = trainer ? trainer.cue || '' : '';
        ui.tCue.className = 'gc-tcue' + (trainer && trainer.phase === 'end' ? ' go' : '');
        TRAIN_MOVES.forEach(function (m) {
            var row = ui.tRows[m], reps = (trained.reps[m] || []).length, r = null;
            (trained.report || []).forEach(function (x) { if (x.move === m) r = x; });
            row.btn.textContent = trainer && trainer.move === m ? t('gcTrainStop') : t('gcTrainDo');
            row.btn.disabled = !!trainer && trainer.move !== m;
            var info = reps + '/' + TRAIN_REPS + ' ' + t('gcTrainReps');
            if (r) info += '\n' + t('gcTrainLimit') + ' ' + r.limit + ' (' + t('gcTrainWas') + ' ' + r.was + ')\n' + (r.clear ? t('gcTrainClearOk') : t('gcTrainOverlap') + ' ' + r.overlaps.join(', '));
            else if (reps) info += '\n' + t('gcTrainNeed');
            else info += '\n' + t('gcTrainNone');
            row.info.textContent = info;
            row.info.className = 'gc-tinfo' + (r && !r.clear ? ' warn' : '');
        });
    }
    function buildTrain() {
        var box = el('div', 'gc-train');
        box.hidden = true;
        box.appendChild(el('div', 'gc-line', t('gcTrainHelp')));
        ui.tCue = el('div', 'gc-tcue'); ui.tCue.setAttribute('role', 'status'); ui.tCue.setAttribute('aria-live', 'assertive');
        box.appendChild(ui.tCue);
        var grid = el('div', 'gc-tgrid');
        ui.tRows = {};
        TRAIN_MOVES.forEach(function (m) {
            var c = el('div', 'gc-tmove'), info = el('div', 'gc-tinfo');
            c.appendChild(el('div', 'gc-tname', m));
            var b = btn('btn-primary', t('gcTrainDo'), function () { if (trainer && trainer.move === m) stopTrain(); else trainMove(m); });
            c.appendChild(b); c.appendChild(info);
            grid.appendChild(c);
            ui.tRows[m] = { btn: b, info: info };
        });
        box.appendChild(grid);
        var acts = el('div', 'gc-row gc-acts');
        acts.appendChild(btn('', t('gcTrainClear'), function () { stopTrain(); trained = { reps: {}, define: {}, report: [] }; saveTrained(); paint(); }));
        box.appendChild(acts);
        return box;
    }

    /* ---------- record and replay (Debug) ---------- */
    function startRecord() { stopReplay(); rec = []; recording = true; note('rec', t('gcRecording')); paint(); }
    function stopRecord() { if (!recording) return; recording = false; note('rec', rec.length + ' ' + t('gcSamples')); try { Store.rawSet('arc_dev_ctrlrec', rec.slice(0, REC_MAX)); } catch (e) {} paint(); }
    // the recording goes through a separate engine with the same settings: its moves are listed, never sent to the TV
    function startReplay() {
        var r = rec && rec.length ? rec : Store.rawGet('arc_dev_ctrlrec');
        if (!(r instanceof Array) || !r.length) return;
        stopRecord(); stopReplay();
        var p = prefs(), c = cfg || SensorProto.config({}, MotionEngine.MOVES), i = 0, t0 = performance.now(), base = r[0].t;
        var e = MotionEngine.create(tuned(c, p, { moves: c.moves, define: defines(c), profile: c.profile || p.profile, strideScale: p.stride,
                                      onAction: function (n, info) { note('replay', n + ' ' + Math.round(info.confidence * 100) + '% @' + Math.round(info.t - base) + ' ms'); } }));
        replay = { timer: setInterval(function () {
            var now = performance.now() - t0;
            while (i < r.length && r[i].t - base <= now) e.feed(r[i++]);
            if (i >= r.length) { note('replay', t('gcReplayDone') + ' ' + JSON.stringify(e.debug().diag)); stopReplay(); }
        }, 30) };
        note('replay', r.length + ' ' + t('gcSamples')); paint();
    }
    function stopReplay() { if (replay) { clearInterval(replay.timer); replay = null; paint(); } }

    /* ---------- screens ---------- */
    function note(kind, text) {
        var d = new Date(), ts = ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2) + '.' + ('00' + d.getMilliseconds()).slice(-3);
        log.unshift(ts + '  ' + kind + '  ' + text);
        if (log.length > 40) log.pop();
    }
    function flash() { if (!ui.last) return; ui.last.classList.remove('gc-flash'); void ui.last.offsetWidth; ui.last.classList.add('gc-flash'); }
    function tile(parent, label) { var b = el('div', 'gc-tile'), v = el('div', 'gc-tv', '—'); b.appendChild(el('div', 'gc-tl', label)); b.appendChild(v); parent.appendChild(b); return v; }
    function pace(sec) { if (!sec) return '—'; return Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2) + ' /km'; }
    function ind(ok, label) { return (ok === true ? '● ' : ok === false ? '○ ' : '◌ ') + label; }
    function setTab(v) {
        tab = v;
        ui.tLive.className = 'btn' + (v === 'live' ? ' btn-primary' : ''); ui.tDebug.className = 'btn' + (v === 'debug' ? ' btn-primary' : ''); ui.tTrain.className = 'btn' + (v === 'train' ? ' btn-primary' : '');
        ui.live.hidden = v !== 'live'; ui.debug.hidden = v !== 'debug'; ui.train.hidden = v !== 'train';
        clearInterval(liveTimer); liveTimer = setInterval(paint, v === 'debug' ? 150 : 250);
        paint();
    }
    function paint() {
        if (!root || !ui.live || ui.sense.hidden) return;
        var m = eng ? eng.metrics() : null, raw = mode === 'sensor-raw', flowing = sensing && performance.now() - lastSample < 1000;
        ui.startBtn.textContent = sensing ? t('gcStop') : t('gcStart');
        ui.sensors.textContent = [ind(perm === 'missing' ? false : perm === 'denied' ? false : perm === 'granted' ? true : null, t('gcPerm') + ': ' + t(perm === 'granted' ? 'gcPermOk' : perm === 'denied' ? 'gcPermDenied' : perm === 'missing' ? 'gcPermMissing' : 'gcPermAsk')),
                                  ind(flowing, t('gcMotion')), ind(caps.rotation, t('gcGyro')), ind(caps.linear, t('gcLinear'))].join('   ');
        ui.link.textContent = (linked ? t('gcOn') : t('gcConnecting')) + (linked && rtt ? ' · ' + rtt + ' ms' : '');
        if (raw) {
            ui.vGait.textContent = cfg ? cfg.raw.hz + ' Hz' : '—'; ui.vPace.textContent = String(rawSent); ui.vSpeed.textContent = lastRaw ? [lastRaw.gx, lastRaw.gy, lastRaw.gz].map(f1).join(' ') : '—';
            ui.vCad.textContent = lastRaw && lastRaw.ra !== null ? [lastRaw.ra, lastRaw.rb, lastRaw.rg].map(f0).join(' ') : '—'; ui.vSteps.textContent = '—'; ui.vDist.textContent = '—';
            ui.last.textContent = '—';
        } else if (m) {
            ui.vGait.textContent = t('gait' + m.gait) + (m.gait !== 'IDLE' ? ' · ' + Math.round(m.confidence * 100) + '%' : '');
            ui.vPace.textContent = pace(m.pace_sec_per_km); ui.vSpeed.textContent = m.speed_kmh.toFixed(1) + ' km/h'; ui.vCad.textContent = m.cadence + ' /min';
            ui.vSteps.textContent = String(m.steps); ui.vDist.textContent = m.distance_m.toFixed(0) + ' m';
            ui.last.textContent = lastAction ? lastAction.name + '  ' + Math.round(lastAction.conf * 100) + '%' : '—';
        }
        ui.calib.disabled = raw || !sensing;
        if (tab === 'debug') paintDebug();
        if (tab === 'train') paintTrain();
    }
    function f1(v) { return v === null || v === undefined ? '—' : v.toFixed(1); }
    function f0(v) { return v === null || v === undefined ? '—' : String(Math.round(v)); }
    function paintDebug() {
        var s = lastRaw, d = eng ? eng.debug() : null, lines = [];
        lines.push('acc   ' + (s ? [s.ax, s.ay, s.az].map(f1).join('  ') : '—') + '   (m/s², no gravity)');
        lines.push('acc+g ' + (s ? [s.gx, s.gy, s.gz].map(f1).join('  ') : '—'));
        lines.push('rot   ' + (s ? [s.ra, s.rb, s.rg].map(f0).join('  ') : '—') + '   (deg/s)');
        if (d) {
            var g = d.signals;
            lines.push('vert ' + f1(g.vertical) + '  lat ' + f1(g.lateral) + '  fwd ' + f1(g.forward) + '  |g| ' + f1(g.magnitude) + '  free ' + f0(g.freefall) + ' ms');
            lines.push('v_vel ' + f1(g.v_vel) + '  v_disp ' + (g.v_disp !== undefined ? g.v_disp.toFixed(2) : '—') + '  l_vel ' + f1(g.l_vel) + '  ' + (d.calibrated ? t('gcCalibrated') : t('gcNotCalibrated')));
        }
        ui.dReadings.textContent = lines.join('\n');
        if (d) {
            ui.dClass.textContent = d.detectors.map(function (x) {
                var bar = new Array(Math.min(10, Math.round(x.level * 10)) + 1).join('█') + new Array(11 - Math.min(10, Math.round(x.level * 10))).join('·');
                return (x.name + '        ').slice(0, 9) + (x.state + '         ').slice(0, 9) + bar + '  conf ' + Math.round(x.confidence * 100) + '%' + (x.last ? '  @' + Math.round(x.last) : '');
            }).join('\n') + '\n' + t('gcGait') + ': ' + d.gait;
            ui.dSteps.textContent = d.steps.slice().reverse().map(function (x) { return '@' + Math.round(x.t) + '  ' + x.peak + ' m/s²  ' + (x.interval ? x.interval + ' ms' : ''); }).join('\n') || '—';
            var dg = d.diag, pending = 0, now = performance.now();
            for (var k in acks) if (now - acks[k] > 2000) pending++;
            ui.dDiag.textContent = t('gcDiagSent') + ' ' + dg.fired + '   ' + t('gcDiagAck') + ' ' + diag.acked + '   ' + t('gcDiagRtt') + ' ' + (rtt || '—') + ' ms\n' +
                t('gcDiagDup') + ' ' + dg.cooldown + '   ' + t('gcDiagLock') + ' ' + dg.lockout + '   ' + t('gcDiagGuard') + ' ' + (dg.guard || 0) + '   ' + t('gcDiagGait') + ' ' + dg.gait + '   ' + t('gcDiagCancel') + ' ' + dg.cancelled + '\n' +
                t('gcDiagTvDup') + ' ' + diag.tvDuplicate + '   ' + t('gcDiagTvStale') + ' ' + diag.tvStale + '   ' + t('gcDiagLost') + ' ' + pending + '   ' + t('gcDiagTimeout') + ' ' + dg.timeouts;
        }
        ui.dLog.textContent = log.slice(0, 18).join('\n') || '—';
        ui.rec.textContent = recording ? t('gcRecStop') + ' (' + rec.length + ')' : t('gcRec');
        ui.replay.textContent = replay ? t('gcReplayStop') : t('gcReplay');
        drawPlot();
    }
    function drawPlot() {
        var c = ui.plot, x = c.getContext('2d'), w = c.width, h = c.height, i;
        x.clearRect(0, 0, w, h);
        x.strokeStyle = 'rgba(255,255,255,.2)'; x.beginPath(); x.moveTo(0, h / 2); x.lineTo(w, h / 2); x.stroke();
        [['#ffd23f', 0], ['#5bd1ff', 1]].forEach(function (k) {
            x.strokeStyle = k[0]; x.beginPath();
            for (i = 0; i < plot.length; i++) { var y = h / 2 - Math.max(-15, Math.min(15, plot[i][k[1]])) * h / 32; if (i) x.lineTo(i * w / 240, y); else x.moveTo(0, y); }
            x.stroke();
        });
    }
    // every value has − and + buttons (no number fields: the phone keyboard and scrolling fought with them)
    function settingsPanel() {
        var box = el('div', 'gc-settings');
        box.hidden = true;
        function clamp(v, lo, hi, r) { return Math.max(lo, Math.min(hi, Math.round(v / r) * r)); }
        function stepper(label, show, fn) {
            var r = el('div', 'gc-srow'), v = el('span', 'gc-pval');
            r.appendChild(el('span', 'gc-grow', label));
            r.appendChild(btn('gc-step', '−', function () { setPrefs(function (q) { fn(q, -1); }); paintSettings(); }));
            r.appendChild(v);
            r.appendChild(btn('gc-step', '+', function () { setPrefs(function (q) { fn(q, 1); }); paintSettings(); }));
            box.appendChild(r);
            ui.sVals.push(function () { v.textContent = show(prefs()); });
        }
        ui.sVals = [];
        ui.profileFrom = el('div', 'gc-note'); box.appendChild(ui.profileFrom);
        box.appendChild(el('div', 'gc-note gc-tvnote', t('gcTvTune')));
        stepper(t('gcAge'), function (p) { return p.profile.age; }, function (q, d) { q.profile.age = clamp(q.profile.age + d, 4, 110, 1); });
        stepper(t('gcHeight') + ' (cm)', function (p) { return Math.round(p.profile.height); }, function (q, d) { q.profile.height = clamp(q.profile.height + d * 5, 80, 250, 1); });
        stepper(t('gcWeight') + ' (kg)', function (p) { return Math.round(p.profile.weight); }, function (q, d) { q.profile.weight = clamp(q.profile.weight + d * 5, 15, 300, 1); });
        stepper(t('gcPosition'), function (p) { var pos = p.profile.phone_position; return t('pos_' + pos.replace(' ', '_')) + (SensorProto.READY_POSITIONS.indexOf(pos) < 0 ? ' (' + t('gcSoon') + ')' : ''); },
                function (q, d) { var L = SensorProto.POSITIONS, i = L.indexOf(q.profile.phone_position); q.profile.phone_position = L[(i + d + L.length) % L.length]; });
        stepper(t('gcSensitivity'), function (p) { return p.sensitivity.toFixed(1) + '×'; }, function (q, d) { q.sensitivity = clamp(q.sensitivity + d * 0.1, 0.5, 2, 0.1); });
        stepper(t('gcStride'), function (p) { return p.stride.toFixed(2) + '×'; }, function (q, d) { q.stride = clamp(q.stride + d * 0.05, 0.6, 1.6, 0.05); });
        var sw = el('input'); sw.type = 'checkbox'; sw.checked = prefs().swap; sw.setAttribute('data-focus', ''); sw.onchange = function () { setPrefs(function (q) { q.swap = sw.checked; }); };
        var r = el('label', 'gc-srow'); r.appendChild(el('span', 'gc-grow', t('gcSwap'))); r.appendChild(sw); box.appendChild(r);
        return box;
    }
    function paintSettings() { (ui.sVals || []).forEach(function (f) { f(); }); }
    function buildSense() {
        var s = el('div', 'gc-sense'), top = el('div', 'gc-stop');
        s.hidden = true;
        ui.sDot = el('span', 'gc-dot'); ui.sBadge = el('span', 'gc-badge', 'P1'); ui.modeName = el('span', 'gc-mode'); ui.sState = el('span', 'gc-state');
        [ui.sDot, ui.sBadge, ui.modeName, ui.sState].forEach(function (x) { top.appendChild(x); });
        var sp = el('span', 'gc-grow'); top.appendChild(sp);
        ui.tLive = btn('', t('gcLive'), function () { setTab('live'); }); ui.tDebug = btn('', t('gcDebug'), function () { setTab('debug'); });
        ui.tTrain = btn('', t('gcTrain'), function () { setTab('train'); });
        top.appendChild(ui.tLive); top.appendChild(ui.tDebug); top.appendChild(ui.tTrain); top.appendChild(btn('gc-modebtn', t('gcMode'), openModes)); top.appendChild(btn('gc-modebtn', t('gcSettings'), openPhone)); top.appendChild(btn('gc-leave2', t('gcLeave'), function () { stop(); }));
        s.appendChild(top);

        ui.live = el('div', 'gc-live');
        var grid = el('div', 'gc-grid');
        ui.vGait = tile(grid, t('gcGait')); ui.vPace = tile(grid, t('gcPace')); ui.vSpeed = tile(grid, t('gcSpeed'));
        ui.vCad = tile(grid, t('gcCadence')); ui.vSteps = tile(grid, t('gcSteps')); ui.vDist = tile(grid, t('gcDistance'));
        ui.live.appendChild(grid);
        var lastBox = el('div', 'gc-lastbox'); lastBox.appendChild(el('div', 'gc-tl', t('gcLastMove'))); ui.last = el('div', 'gc-last', '—'); lastBox.appendChild(ui.last);
        ui.live.appendChild(lastBox);
        ui.link = el('div', 'gc-line'); ui.sensors = el('div', 'gc-line');
        ui.live.appendChild(ui.link); ui.live.appendChild(ui.sensors);
        var acts = el('div', 'gc-row gc-acts');
        ui.startBtn = btn('btn-primary', t('gcStart'), function () { if (sensing) sensorsOff(); else sensorsOn(); });
        ui.calib = btn('', t('gcRecal'), function () {
            if (!eng) return;
            note('calib', t('gcHoldStill')); ui.calib.textContent = t('gcHoldStill');
            eng.calibrate(function (ok) { ui.calib.textContent = t('gcRecal'); note('calib', ok ? t('gcCalibrated') : t('gcCalibFail')); if (typeof App !== 'undefined' && App.toast) App.toast(ok ? t('gcCalibrated') : t('gcCalibFail')); });
        });
        var setB = btn('', t('gcSettings'), function () { showSettings = !showSettings; ui.settings.hidden = !showSettings; paintSettings(); if (showSettings) ui.settings.scrollIntoView({ block: 'nearest' }); });
        acts.appendChild(ui.startBtn); acts.appendChild(ui.calib); acts.appendChild(setB);
        ui.live.appendChild(acts);
        ui.settings = settingsPanel(); ui.live.appendChild(ui.settings);
        s.appendChild(ui.live);

        ui.debug = el('div', 'gc-debug');
        function sec(title) { var b = el('div', 'gc-dsec'); b.appendChild(el('div', 'gc-tl', title)); var pre = el('pre', 'gc-pre'); b.appendChild(pre); ui.debug.appendChild(b); return pre; }
        ui.dReadings = sec(t('gcReadings'));
        ui.plot = el('canvas', 'gc-plot'); ui.plot.width = 480; ui.plot.height = 90; ui.dReadings.parentNode.appendChild(ui.plot);
        ui.dClass = sec(t('gcClassifier')); ui.dSteps = sec(t('gcStepEvents')); ui.dDiag = sec(t('gcDiag')); ui.dLog = sec(t('gcEvents'));
        var rr = el('div', 'gc-row gc-acts');
        ui.rec = btn('', t('gcRec'), function () { if (recording) stopRecord(); else startRecord(); });
        ui.replay = btn('', t('gcReplay'), function () { if (replay) stopReplay(); else startReplay(); });
        rr.appendChild(ui.rec); rr.appendChild(ui.replay);
        rr.appendChild(btn('', t('gcClear'), function () { rec = null; log = []; plot = []; Store.rawSet('arc_dev_ctrlrec', null); if (eng) eng.reset(); diag = { acked: 0, tvDuplicate: 0, tvStale: 0, unacked: 0 }; paint(); }));
        ui.debug.appendChild(rr);
        s.appendChild(ui.debug);
        ui.train = buildTrain(); s.appendChild(ui.train);
        return s;
    }

    /* ---------- phone: landscape, screen on ---------- */
    // Auto rotate off: held in the landscape side it is in now (the Android app does this natively)
    function lock() {
        if (nativeV() >= 3) return;
        try {
            var so = screen.orientation;
            if (so && so.lock) so.lock(opts().rotate || !/^landscape/.test(so.type) ? 'landscape' : so.type).catch(function () {});
        } catch (e) {}
    }
    function wake() { if (!opts().awake || wl) return; try { if (navigator.wakeLock) navigator.wakeLock.request('screen').then(function (l) { if (!run || !opts().awake) { l.release(); return; } wl = l; l.addEventListener('release', function () { if (wl === l) wl = null; }); }, function () {}); } catch (e) {} }
    function unwake() { var l = wl; wl = null; try { if (l) l.release(); } catch (e) {} }

    // My PC draws a 1920x1080 screen scaled to fit; on a phone that makes text tiny. --k scales this app's sizes back up
    // so they read like normal phone text (1 on a TV or a big screen).
    function readable() {
        if (!root) return;
        var st = document.getElementById('stage'), s = st ? st.getBoundingClientRect().width / 1920 : 1;
        root.style.setProperty('--k', Math.max(1, Math.min(4, 0.9 / (s || 1))).toFixed(2));
    }
    function build(body) {
        root = el('div', 'gc');
        // lists and settings scroll with a finger: the virtual pad (Buttons mode, or the shell's touch pad) cancels every
        // touchmove that reaches the document, so they stop here
        root.addEventListener('touchmove', function (e) { e.stopPropagation(); }, { passive: true });
        ui.join = el('div', 'gc-join');
        ui.join.appendChild(el('h2', 'gc-title', t('gamepad')));
        ui.join.appendChild(el('p', 'gc-help', t('gcHelpQr')));
        ui.code = el('input', 'gc-code');
        ui.code.maxLength = 16; ui.code.autocomplete = 'off'; ui.code.setAttribute('autocapitalize', 'characters'); ui.code.spellcheck = false;
        ui.code.placeholder = t('ctrlCode'); ui.code.setAttribute('aria-label', t('ctrlCode')); ui.code.setAttribute('data-focus', '');
        ui.code.value = (saved.code || '').toUpperCase();
        ui.code.onkeydown = function (e) { if (e.key === 'Enter') start(); };
        ui.join.appendChild(ui.code);
        var row = el('div', 'gc-row');
        ui.p1 = btn('', 'P1', function () { pick(1); }); ui.p2 = btn('', 'P2', function () { pick(2); });
        row.appendChild(ui.p1); row.appendChild(ui.p2);
        ui.join.appendChild(row);
        var mrow = el('div', 'gc-row gc-modes');
        MODE_NAMES.forEach(function (k, i) { ui['m' + i] = btn('', t(k), function () { pickMode(MODES[i]); }); mrow.appendChild(ui['m' + i]); });
        ui.join.appendChild(mrow);
        ui.go = btn('btn-primary gc-go', t('gcGo'), start);
        var grow = el('div', 'gc-row');
        ui.scan = btn('gc-scanbtn', t('gcScan'), startScan);
        grow.appendChild(ui.scan); grow.appendChild(btn('gc-phonebtn', t('gcSettings'), openPhone)); grow.appendChild(ui.go);
        ui.join.appendChild(grow);
        ui.err = el('div', 'gc-err'); ui.err.setAttribute('role', 'alert');
        ui.join.appendChild(ui.err);
        root.appendChild(ui.join);

        // pad mode: the virtual pad covers the screen (over a plain background); this small bar sits above it (bottom centre;
        // its buttons stay right of the middle: the left half is the pad's floating stick zone)
        ui.padBg = el('div', 'gc-padbg'); ui.padBg.hidden = true; root.appendChild(ui.padBg);
        ui.bar = el('div', 'gc-bar');
        ui.dot = el('span', 'gc-dot'); ui.badge = el('span', 'gc-badge', 'P1'); ui.state = el('span', 'gc-state');
        ui.bar.appendChild(ui.dot); ui.bar.appendChild(ui.badge); ui.bar.appendChild(ui.state);
        ui.bar.appendChild(btn('gc-leave gc-modebtn', t('gcMode'), openModes));
        ui.bar.appendChild(btn('gc-leave', t('gcLeave'), function () { stop(); }));
        ui.bar.hidden = true;
        root.appendChild(ui.bar);
        // the phone settings: top right, out of the stick zone (left half) and away from the face buttons
        ui.setBtn = btn('gc-leave gc-setbtn', t('gcSettings'), openPhone); ui.setBtn.hidden = true;
        root.appendChild(ui.setBtn);
        ui.sense = buildSense();
        root.appendChild(ui.sense);
        ui.ptr = buildPointer();
        root.appendChild(ui.ptr);
        body.appendChild(root);
    }

    Win.register('gamepad', {
        icon: 'controller',
        title: function () { return t('gamepad'); },
        open: function (body, arg) {
            saved = Store.rawGet(KEY) || {};
            cid = typeof saved.cid === 'string' && /^[a-z0-9]{6,24}$/.test(saved.cid) ? saved.cid : '';
            if (!cid) for (var i = 0; i < 12; i++) cid += 'abcdefghijklmnopqrstuvwxyz0123456789'.charAt(Math.floor(Math.random() * 36));
            want = {}; sent = {}; ui = {}; inPad = false; aimLast = 0; calib = null; log = []; plot = []; seq = 0; acks = {}; rtt = 0; lastAction = null; rawSent = 0; rawLast = 0; cfg = null; perm = 'unknown';
            diag = { acked: 0, tvDuplicate: 0, tvStale: 0, unacked: 0 };
            build(body);
            readable(); window.addEventListener('resize', readable); setTimeout(readable, 350);
            loadTrained(); trainer = null; trainBuf = [];
            newEngine();
            aim = Aim.create(ptrPrefs());
            pick(saved.p === 2 ? 2 : 1);
            pickMode(saved.mode);
            applyOpts();
            document.addEventListener('visibilitychange', onVis);
            fromQr = false; triedOther = false;
            if (arg && typeof arg.pair === 'string' && codeFrom(arg.pair)) setTimeout(function () { if (root) pairWith(codeFrom(arg.pair)); }, 0);
            else if (saved.paired && codeFrom(saved.code || '')) setTimeout(function () { if (root && !run) start(); }, 0);   // the TV it was paired with: connects by itself
            window.GamepadApp = { scanCode: function (text) { var c = codeFrom(text); if (c) pairWith(c); return c; }, linked: function () { return linked; }, send: function (m) { return send(m); }, running: function () { return run; }, mode: function () { return mode; }, pointing: pointing, aim: function () { return aim; }, calibrate: calibrate,
                                  engine: function () { return eng; }, feed: function (s) { onMotion(s); }, config: function () { return cfg; }, log: function () { return log.slice(); } };
            return ui.go;                                          // Connect, not the code box (no phone keyboard popping up)
        },
        back: function () { if (ui.modes) { closeModes(); return true; } if (scan) { stopScan(); return true; } if (!inPad) return false; stop(); return true; },
        close: function () {
            stopScan();
            stop();
            stopTrain(); endCalib();
            clearInterval(liveTimer); liveTimer = 0;
            if (VirtualPad.active()) VirtualPad.hide();
            document.removeEventListener('visibilitychange', onVis);
            window.removeEventListener('resize', readable);
            unwake(); root = null; ui = {}; eng = null;
            delete window.GamepadApp;
        }
    });
})();
