/* Game controller (system app, for phones): this phone becomes player 1 or 2 of a TV running My PC. It shows no game.
 * The TV side is js/launcher/controllers.js (Settings > Devices > Phone controller shows the code). Signalling goes through
 * Firestore (js/core/rooms.js, app 'controller'), everything else through a direct WebRTC channel on the same Wi-Fi
 * (js/core/netlink.js). When the TV changes page (opens a game, quits) the link drops and this app reconnects by itself.
 * Three modes, picked before connecting:
 *   pad             the virtual pad My PC already draws over games (js/core/virtual-pad.js: stick, A B, gear to customize,
 *                   pause), here full screen as a controller: { t: 'k', a, d } per press / release
 *   sensor-actions  the phone in the right hand, the player facing the TV: moves (LEFT RIGHT JUMP DUCK DUCK_END, or what the game
 *                   defines) found by js/core/motion.js; only the moves the TV's config asks for are sent, plus metrics when asked.
 *                   Live screen (gait, pace, speed, cadence, steps, distance, last move, link and sensor state, start / stop,
 *                   recalibrate, settings) and Debug screen (readings, steps, classifier states, events, diagnostics, record / replay)
 *   sensor-raw      the sensor samples themselves, batched at the rate the game asks for; the game does its own detection
 * Protocol: js/core/sensor-proto.js, docs/phone-controller.md. Separate from the touch pad that the shell draws over games. */
(function () {
    'use strict';

    var KEY = 'arc_dev_ctrlphone', REC_MAX = 60 * 120;      // 2 minutes at 60 Hz
    var MODES = ['pad', 'sensor-actions', 'sensor-raw'];
    // the pad layout (buttons, sizes, places) is kept in My PC's store too, so it is never lost between opens
    var PAD_STORE = { get: function (k) { return Store.rawGet('arc_dev_' + k); }, set: function (k, v) { Store.rawSet('arc_dev_' + k, v); } };
    var PAD = { buttons: [{ label: 'A', key: 13, action: 'ok' }, { label: 'B', key: 88, action: 'run' }],
                catalog: [{ label: 'A', key: 13, action: 'ok' }, { label: 'B', key: 88, action: 'run' }, { label: 'C', key: 8, action: 'cancel' }, { label: '☰', key: 77, action: 'menu' }] };
    var root = null, code = '', player = 1, mode = 'pad', run = false, busy = false, conn = null, linked = false, sess = null, retry = 0, wait = 0, curReq = null, offerObj = null;
    var want = {}, sent = {}, ui = {}, saved = {}, cid = '', inPad = false, wl = null, session = '';
    // sensor modes
    var cfg = null, eng = null, sensing = false, perm = 'unknown', lastSample = 0, caps = { motion: false, linear: false, rotation: false }, seq = 0, acks = {}, rtt = 0;
    var log = [], diag = { acked: 0, tvDuplicate: 0, tvStale: 0, unacked: 0 }, lastAction = null, metricsTimer = 0, rawBuf = [], rawLast = 0, rawTimer = 0, rawSent = 0, liveTimer = 0;
    var fromQr = false, triedOther = false, scan = null;
    var tab = 'live', showSettings = false, rec = null, recording = false, replay = null, lastRaw = null, plot = [];

    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
    function t(k) { return I18n.t(k); }
    function btn(cls, text, fn) { var b = el('button', 'btn' + (cls ? ' ' + cls : ''), text); b.setAttribute('data-focus', ''); b.onclick = fn; return b; }
    function name() { return /Android/i.test(navigator.userAgent) ? 'Android' : /iPhone|iPad/i.test(navigator.userAgent) ? 'iPhone' : 'Phone'; }
    function prefs() { var p = saved.prefs || {}; return { profile: SensorProto.profile(p.profile), sensitivity: +p.sensitivity || 1, stride: +p.stride || 1, swap: !!p.swap }; }
    function save() { Store.rawSet(KEY, { cid: cid, code: code, p: player, mode: mode, prefs: saved.prefs || {} }); }
    function setPrefs(fn) { var p = prefs(); fn(p); saved.prefs = { profile: p.profile, sensitivity: p.sensitivity, stride: p.stride, swap: p.swap }; save(); applyCfg(); }
    function state(text, ok) {
        if (ui.state) ui.state.textContent = text;
        if (ui.dot) ui.dot.className = 'gc-dot' + (ok ? ' ok' : '');
        if (ui.sState) ui.sState.textContent = text;
        if (ui.sDot) ui.sDot.className = 'gc-dot' + (ok ? ' ok' : '');
    }
    function pick(p) { player = p; ui.p1.className = 'btn' + (p === 1 ? ' btn-primary' : ''); ui.p2.className = 'btn' + (p === 2 ? ' btn-primary' : ''); if (ui.badge) ui.badge.textContent = 'P' + p; if (ui.sBadge) ui.sBadge.textContent = 'P' + p; }
    function pickMode(m) { mode = MODES.indexOf(m) >= 0 ? m : 'pad'; for (var i = 0; i < MODES.length; i++) ui['m' + i].className = 'btn' + (MODES[i] === mode ? ' btn-primary' : ''); }
    function show(on) {
        inPad = on; ui.join.hidden = on;
        ui.bar.hidden = ui.padBg.hidden = !(on && mode === 'pad');
        ui.sense.hidden = !(on && mode !== 'pad');
        if (on && mode === 'pad') VirtualPad.init({ storage: PAD_STORE, id: 'controller', force: true, scale: { stick: 1.35, btn: 1.25 }, buttons: PAD.buttons, catalog: PAD.catalog, onAction: padAction });
        else if (VirtualPad.active()) VirtualPad.hide();
        if (on && mode !== 'pad') { ui.modeName.textContent = t(mode === 'sensor-raw' ? 'gcModeRaw' : 'gcModeActions'); setTab('live'); }
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
            if (m.t === 'ok') { linked = true; if (typeof m.session === 'string') session = m.session; save(); pick(m.p === 2 ? 2 : 1); state(t('gcOn'), true); }
            else if (m.t === 'no') {
                if (m.why === 'busy' && fromQr && !triedOther) { triedOther = true; stop(); pick(player === 1 ? 2 : 1); start(); return; }   // scanned: take the free player
                stop(); ui.err.textContent = m.why === 'busy' ? t('gcBusy') : t('gcLocked');
            }
            else if (m.type === 'config') { var v = SensorProto.config(m, MotionEngine.MOVES); if (v) { cfg = v; applyCfg(); note('config', v.moves.join(' ') || '—'); } }
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
        show(true); state(t('gcConnecting'), false); lock(); wake();
        if (mode !== 'pad') sensorsOn();                           // the tap on Connect also answers the motion permission prompt (iPhone)
        attempt();
    }
    function stop() {
        run = false; clearTimeout(retry); clearTimeout(wait); release();
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
        eng.configure({ moves: c.moves, define: c.define || {}, profile: c.profile || p.profile, sensitivity: p.sensitivity, strideScale: p.stride });
        clearInterval(metricsTimer); metricsTimer = 0;
        if (mode === 'sensor-actions' && c.metrics.enabled) metricsTimer = setInterval(sendMetrics, Math.round(1000 / c.metrics.hz));
        if (ui.profileFrom) ui.profileFrom.textContent = c.profile ? t('gcProfileGame') : '';
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
        stopRecord(); stopReplay(); paint();
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
        if (recording && rec.length < REC_MAX) rec.push(s); else if (recording) stopRecord();
        if (mode === 'sensor-raw') return rawPush(s, now);
        eng.feed(s);
        if (tab === 'debug') { var sg = eng.debug().signals; plot.push([sg.vertical || 0, sg.lateral || 0]); if (plot.length > 240) plot.shift(); }
    }
    function onMove(name, info) {
        var p = prefs(), c = cfg;
        if (p.swap && (name === 'LEFT' || name === 'RIGHT')) name = name === 'LEFT' ? 'RIGHT' : 'LEFT';
        lastAction = { name: name, at: Date.now(), conf: info.confidence };
        if (!c || c.moves.indexOf(name) < 0) { note('local', name); flash(); return; }     // not asked for by the game: shown, not sent
        var m = { type: 'action', action: name, timestamp: Date.now(), sequence: ++seq, confidence: info.confidence };
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

    /* ---------- pairing by QR code: the TV shows <My PC address>?pair=<code> (Settings > Devices > Phone controller) ---------- */
    function codeFrom(text) {
        var m = /[?&]pair=([a-z0-9]{6,16})/i.exec(String(text || '')) || /^([a-z0-9]{6,16})$/i.exec(String(text || '').trim());
        return m ? m[1].toLowerCase() : '';
    }
    function pairWith(c) { fromQr = true; triedOther = false; ui.code.value = c.toUpperCase(); start(); }
    // the phone's own QR reader (BarcodeDetector, Chrome on Android); elsewhere the camera app opens the link by itself
    function startScan() {
        ui.err.textContent = '';
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
        var box = el('div', 'gc-modepick'), names = ['gcModePad', 'gcModeActions', 'gcModeRaw'], first = null;
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
    }
    function switchMode(m) {
        if (m === mode) return;
        var p = player;
        stop(); pickMode(m); pick(p); save();
        start();
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
        var e = MotionEngine.create({ moves: c.moves, define: c.define || {}, profile: c.profile || p.profile, sensitivity: p.sensitivity, strideScale: p.stride,
                                      onAction: function (n, info) { note('replay', n + ' ' + Math.round(info.confidence * 100) + '% @' + Math.round(info.t - base) + ' ms'); } });
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
        ui.tLive.className = 'btn' + (v === 'live' ? ' btn-primary' : ''); ui.tDebug.className = 'btn' + (v === 'debug' ? ' btn-primary' : '');
        ui.live.hidden = v !== 'live'; ui.debug.hidden = v !== 'debug';
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
                t('gcDiagDup') + ' ' + dg.cooldown + '   ' + t('gcDiagLock') + ' ' + dg.lockout + '   ' + t('gcDiagGait') + ' ' + dg.gait + '   ' + t('gcDiagCancel') + ' ' + dg.cancelled + '\n' +
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
    function settingsPanel() {
        var box = el('div', 'gc-settings'), p = prefs();
        box.hidden = true;
        function row(label, ctl) { var r = el('label', 'gc-srow'); r.appendChild(el('span', '', label)); r.appendChild(ctl); box.appendChild(r); return ctl; }
        function numIn(v, min, max, fn) { var i = el('input', 'gc-num'); i.type = 'number'; i.min = min; i.max = max; i.value = v; i.setAttribute('data-focus', ''); i.onchange = function () { setPrefs(function (q) { fn(q, +i.value); }); }; return i; }
        ui.profileFrom = el('div', 'gc-note'); box.appendChild(ui.profileFrom);
        row(t('gcAge'), numIn(p.profile.age, 4, 110, function (q, v) { q.profile.age = v; }));
        row(t('gcHeight') + ' (cm)', numIn(p.profile.height, 80, 250, function (q, v) { q.profile.height = v; }));
        row(t('gcWeight') + ' (kg)', numIn(p.profile.weight, 15, 300, function (q, v) { q.profile.weight = v; }));
        var sel = el('select', 'gc-num'); sel.setAttribute('data-focus', '');
        SensorProto.POSITIONS.forEach(function (pos) { var o = el('option', '', t('pos_' + pos.replace(' ', '_')) + (SensorProto.READY_POSITIONS.indexOf(pos) < 0 ? ' (' + t('gcSoon') + ')' : '')); o.value = pos; sel.appendChild(o); });
        sel.value = p.profile.phone_position;
        sel.onchange = function () { setPrefs(function (q) { q.profile.phone_position = sel.value; }); };
        row(t('gcPosition'), sel);
        row(t('gcSensitivity') + ' (0.5–2)', numIn(p.sensitivity, 0.5, 2, function (q, v) { q.sensitivity = Math.max(0.5, Math.min(2, v || 1)); })).step = 0.1;
        row(t('gcStride') + ' (0.6–1.6)', numIn(p.stride, 0.6, 1.6, function (q, v) { q.stride = Math.max(0.6, Math.min(1.6, v || 1)); })).step = 0.05;
        var sw = el('input'); sw.type = 'checkbox'; sw.checked = p.swap; sw.setAttribute('data-focus', ''); sw.onchange = function () { setPrefs(function (q) { q.swap = sw.checked; }); };
        row(t('gcSwap'), sw);
        return box;
    }
    function buildSense() {
        var s = el('div', 'gc-sense'), top = el('div', 'gc-stop');
        s.hidden = true;
        ui.sDot = el('span', 'gc-dot'); ui.sBadge = el('span', 'gc-badge', 'P1'); ui.modeName = el('span', 'gc-mode'); ui.sState = el('span', 'gc-state');
        [ui.sDot, ui.sBadge, ui.modeName, ui.sState].forEach(function (x) { top.appendChild(x); });
        var sp = el('span', 'gc-grow'); top.appendChild(sp);
        ui.tLive = btn('', t('gcLive'), function () { setTab('live'); }); ui.tDebug = btn('', t('gcDebug'), function () { setTab('debug'); });
        top.appendChild(ui.tLive); top.appendChild(ui.tDebug); top.appendChild(btn('gc-modebtn', t('gcMode'), openModes)); top.appendChild(btn('gc-leave2', t('gcLeave'), function () { stop(); }));
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
        var setB = btn('', t('gcSettings'), function () { showSettings = !showSettings; ui.settings.hidden = !showSettings; });
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
        return s;
    }

    /* ---------- phone: landscape, screen on ---------- */
    function lock() { try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(function () {}); } catch (e) {} }
    function wake() { try { if (navigator.wakeLock) navigator.wakeLock.request('screen').then(function (l) { wl = l; }, function () {}); } catch (e) {} }

    // My PC draws a 1920x1080 screen scaled to fit; on a phone that makes text tiny. --k scales this app's sizes back up
    // so they read like normal phone text (1 on a TV or a big screen).
    function readable() {
        if (!root) return;
        var st = document.getElementById('stage'), s = st ? st.getBoundingClientRect().width / 1920 : 1;
        root.style.setProperty('--k', Math.max(1, Math.min(4, 0.9 / (s || 1))).toFixed(2));
    }
    function build(body) {
        root = el('div', 'gc');
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
        ['gcModePad', 'gcModeActions', 'gcModeRaw'].forEach(function (k, i) { ui['m' + i] = btn('', t(k), function () { pickMode(MODES[i]); }); mrow.appendChild(ui['m' + i]); });
        ui.join.appendChild(mrow);
        ui.go = btn('btn-primary gc-go', t('gcGo'), start);
        var grow = el('div', 'gc-row');
        ui.scan = btn('gc-scanbtn', t('gcScan'), startScan);
        grow.appendChild(ui.scan); grow.appendChild(ui.go);
        ui.join.appendChild(grow);
        ui.err = el('div', 'gc-err'); ui.err.setAttribute('role', 'alert');
        ui.join.appendChild(ui.err);
        root.appendChild(ui.join);

        // pad mode: the virtual pad covers the screen (over a plain background); this small bar sits above it (top right)
        ui.padBg = el('div', 'gc-padbg'); ui.padBg.hidden = true; root.appendChild(ui.padBg);
        ui.bar = el('div', 'gc-bar');
        ui.dot = el('span', 'gc-dot'); ui.badge = el('span', 'gc-badge', 'P1'); ui.state = el('span', 'gc-state');
        ui.bar.appendChild(ui.dot); ui.bar.appendChild(ui.badge); ui.bar.appendChild(ui.state);
        ui.bar.appendChild(btn('gc-leave gc-modebtn', t('gcMode'), openModes));
        ui.bar.appendChild(btn('gc-leave', t('gcLeave'), function () { stop(); }));
        ui.bar.hidden = true;
        root.appendChild(ui.bar);
        ui.sense = buildSense();
        root.appendChild(ui.sense);
        body.appendChild(root);
    }

    Win.register('gamepad', {
        icon: 'controller',
        title: function () { return t('gamepad'); },
        open: function (body, arg) {
            saved = Store.rawGet(KEY) || {};
            cid = typeof saved.cid === 'string' && /^[a-z0-9]{6,24}$/.test(saved.cid) ? saved.cid : '';
            if (!cid) for (var i = 0; i < 12; i++) cid += 'abcdefghijklmnopqrstuvwxyz0123456789'.charAt(Math.floor(Math.random() * 36));
            want = {}; sent = {}; ui = {}; inPad = false; log = []; plot = []; seq = 0; acks = {}; rtt = 0; lastAction = null; rawSent = 0; rawLast = 0; cfg = null; perm = 'unknown';
            diag = { acked: 0, tvDuplicate: 0, tvStale: 0, unacked: 0 };
            build(body);
            readable(); window.addEventListener('resize', readable); setTimeout(readable, 350);
            newEngine();
            pick(saved.p === 2 ? 2 : 1);
            pickMode(saved.mode);
            document.addEventListener('visibilitychange', onVis);
            fromQr = false; triedOther = false;
            if (arg && typeof arg.pair === 'string' && codeFrom(arg.pair)) setTimeout(function () { if (root) pairWith(codeFrom(arg.pair)); }, 0);
            window.GamepadApp = { scanCode: function (text) { var c = codeFrom(text); if (c) pairWith(c); return c; }, linked: function () { return linked; }, send: function (m) { return send(m); }, running: function () { return run; }, mode: function () { return mode; },
                                  engine: function () { return eng; }, feed: function (s) { onMotion(s); }, config: function () { return cfg; }, log: function () { return log.slice(); } };
            return ui.code;
        },
        back: function () { if (ui.modes) { closeModes(); return true; } if (scan) { stopScan(); return true; } if (!inPad) return false; stop(); return true; },
        close: function () {
            stopScan();
            stop();
            clearInterval(liveTimer); liveTimer = 0;
            if (VirtualPad.active()) VirtualPad.hide();
            document.removeEventListener('visibilitychange', onVis);
            window.removeEventListener('resize', readable);
            try { if (wl) wl.release(); } catch (e) {}
            wl = null; root = null; ui = {}; eng = null;
            delete window.GamepadApp;
        }
    });
})();
