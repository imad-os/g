/* Motion engine of the phone controller's "sensor-actions" mode (js/launcher/apps/gamepad.js): phone sensor samples in,
 * meaningful events out (moves such as LEFT / JUMP / DUCK, steps), plus gait, cadence, speed and distance. Pure logic, no DOM,
 * so the unit tests feed it synthetic recordings (tests/unit-tests.mjs). Docs: docs/phone-controller.md.
 *
 * The player faces the TV with the phone in the right hand (the only position computed for now). Directions come from
 * the phone's own sensor fusion: "up" is the gravity vector, "right" is the screen's right edge flattened onto the floor
 * (the player holds the phone as when playing, screen towards them). Recalibrate (stand still for a second, facing the
 * TV) re-reads gravity in the current grip and clears the drift of the velocity / displacement estimates.
 *
 *   var m = MotionEngine.create({ moves, define, profile, sensitivity, strideScale, onAction(name, info), onStep(step) })
 *   m.feed({ t, ax, ay, az, gx, gy, gz, ra, rb, rg, angle })   t ms; a* = acceleration without gravity (m/s², null when the
 *                     phone has none), g* = with gravity, r* = rotation rate (deg/s), angle = screen orientation angle
 *   m.configure({ moves, define, profile, sensitivity, strideScale })   m.calibrate()   m.reset()
 *   m.metrics() -> { gait, cadence, speed_kmh, pace_sec_per_km, distance_m, steps, confidence }
 *   m.debug()   -> { signals, detectors: [{ name, state, level, confidence, last }], diag, steps, calibrated }
 *
 * A move is a rule on one signal, so new moves need no code (SensorProto.rule, also sent by games in `define`):
 *   { signal, above | below, for_ms, cooldown_ms, group, gait: [..], also: {signal, above|below}, defer_ms,
 *     cancel_if: {signal, above|below}, end: { name, signal, above|below, for_ms, min_ms, max_ms } }
 * Signals: vertical lateral forward (m/s², without gravity), magnitude (m/s², with gravity), v_vel l_vel (m/s), v_disp (m),
 * freefall (ms spent with almost no weight), pitch roll (deg), rot (deg/s). In RUN every threshold is raised (runScale) and
 * `sensitivity` (0.5 to 2) lowers or raises all of them. */
var MotionEngine = (function () {
    'use strict';

    var MOVES = {
        LEFT:  { signal: 'lateral', below: -4.0, for_ms: 30, cooldown_ms: 450, group: 'side', also: { signal: 'l_vel', below: -0.3 } },
        RIGHT: { signal: 'lateral', above: 4.0, for_ms: 30, cooldown_ms: 450, group: 'side', also: { signal: 'l_vel', above: 0.3 } },
        JUMP:  { signal: 'freefall', above: 160, cooldown_ms: 700, group: 'vert' },
        DUCK:  { signal: 'v_disp', below: -0.16, for_ms: 60, cooldown_ms: 900, group: 'vert', also: { signal: 'freefall', below: 60 },
                 defer_ms: 220, cancel_if: { signal: 'v_vel', above: 0.9 },
                 end: { name: 'DUCK_END', signal: 'v_vel', above: 0.45, for_ms: 60, min_ms: 350, max_ms: 2500 } }
    };
    var FREEFALL = 3.5, RUN_SCALE = 1.3, STEP_MIN_MS = 250, IDLE_MS = 2000;

    function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
    function len(a) { return Math.sqrt(dot(a, a)); }
    function scale(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
    function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
    function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
    function norm(a) { var l = len(a); return l > 1e-6 ? scale(a, 1 / l) : null; }
    function screenRight(angle) {               // the screen's right edge in the phone's axes
        angle = ((+angle || 0) % 360 + 360) % 360;
        return angle === 90 ? [0, -1, 0] : angle === 270 ? [0, 1, 0] : angle === 180 ? [-1, 0, 0] : [1, 0, 0];   // 90: phone turned to the left (its top on the left)
    }
    function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

    function create(opt) {
        opt = opt || {};
        var o = {}, rules = {}, order = [], det = {}, groups = {};
        var g = null, right = null, rightH = null, calib = null, lastT = 0;
        var sig = {}, hist = { v: [], l: [], f: [] }, ffSince = 0;
        var vv = 0, vd = 0, lv = 0;
        var steps = [], stepArm = false, stepPeak = 0, avgPeak = 2.5, lastStep = 0, totalSteps = 0, dist = 0, gait = 'IDLE', cadence = 0, gaitConf = 0;
        var diag = { fired: 0, cooldown: 0, lockout: 0, gait: 0, cancelled: 0, ended: 0, timeouts: 0 };

        function configure(c) {
            c = c || {};
            if (c.profile) o.profile = c.profile;
            if (!o.profile) o.profile = { height: 170, phone_position: 'right hand' };
            if (c.sensitivity !== undefined) o.sens = Math.max(0.5, Math.min(2, +c.sensitivity || 1));
            if (o.sens === undefined) o.sens = 1;
            if (c.strideScale !== undefined) o.stride = Math.max(0.6, Math.min(1.6, +c.strideScale || 1));
            if (o.stride === undefined) o.stride = 1;
            if (c.onAction) o.onAction = c.onAction;
            if (c.onStep) o.onStep = c.onStep;
            if (c.moves || c.define || !order.length) {
                var all = {}, k, moves = c.moves || o.moves || ['LEFT', 'RIGHT', 'JUMP', 'DUCK', 'DUCK_END'];
                for (k in MOVES) all[k] = MOVES[k];
                for (k in (c.define || {})) if (c.define.hasOwnProperty(k)) all[k] = c.define[k];
                o.moves = moves.slice();
                rules = {}; order = []; det = {};
                for (var i = 0; i < moves.length; i++) {
                    var r = all[moves[i]];
                    if (!r) continue;                                      // an end event (DUCK_END) or a move this phone cannot detect
                    var want = { start: true, end: !!(r.end && moves.indexOf(r.end.name) >= 0) };
                    rules[moves[i]] = { r: r, want: want };
                    order.push(moves[i]);
                    det[moves[i]] = { state: 'idle', since: 0, peak: 0, fired: 0, until: 0, edge: false, level: 0, conf: 0, last: 0, endSince: 0, deferAt: 0, deferConf: 0 };
                }
            }
        }
        configure(opt);

        function factor(r) { return (gait === 'RUN' ? RUN_SCALE : 1) / o.sens; }
        function test(r, f) {               // is the rule's condition true now? also returns how far along (0..1+)
            var v = sig[r.signal];
            if (v === undefined || v === null) return { on: false, level: 0 };
            if (r.above !== undefined) { var a = r.above * (r.above > 0 ? f : 1 / f); return { on: v > a, level: a ? v / a : 0 }; }
            var b = r.below * (r.below < 0 ? f : 1 / f);
            return { on: v < b, level: b ? v / b : 0 };
        }
        function emit(name, t, conf, extra) {
            diag.fired++;
            if (o.onAction) { var info = { t: t, confidence: Math.round(conf * 100) / 100 }; for (var k in extra) info[k] = extra[k]; try { o.onAction(name, info); } catch (e) {} }
        }

        function detect(t) {
            for (var i = 0; i < order.length; i++) {
                var name = order[i], R = rules[name], r = R.r, d = det[name], f = factor(r), c;
                // a move that is held (DUCK) waits for its end
                if (d.state === 'active') {
                    var e = r.end, ce = test(e, f);
                    if (t - d.fired >= e.max_ms) { d.state = 'cooldown'; diag.timeouts++; if (R.want.end) emit(e.name, t, 0.5, { reason: 'timeout' }); diag.ended++; continue; }
                    if (t - d.fired >= e.min_ms && ce.on) { if (!d.endSince) d.endSince = t; if (t - d.endSince >= (e.for_ms || 0)) { d.state = 'cooldown'; diag.ended++; if (R.want.end) emit(e.name, t, Math.min(1, 0.5 + 0.5 * (ce.level - 1)), {}); } }
                    else d.endSince = 0;
                    d.level = ce.level;
                    continue;
                }
                if (d.state === 'defer') {
                    if (r.cancel_if && test(r.cancel_if, 1).on || sig.freefall > 0) { d.state = 'idle'; d.since = 0; diag.cancelled++; continue; }
                    if (t >= d.deferAt) fire(name, R, d, t, d.deferConf);
                    continue;
                }
                if (d.state === 'cooldown' && t >= d.until) d.state = 'idle';
                c = test(r, f);
                d.level = c.level;
                if (!c.on) { d.since = 0; d.edge = false; d.peak = 0; continue; }
                if (!d.since) { d.since = t; d.peak = 0; }
                if (c.level > d.peak) d.peak = c.level;
                if (t - d.since < (r.for_ms || 0) || d.edge) continue;
                d.edge = true;                                   // one decision per rising edge
                if (r.also && !test(r.also, 1).on) { d.edge = false; continue; }
                if (d.state === 'cooldown') { diag.cooldown++; continue; }
                if (r.group && groups[r.group] && t < groups[r.group].until && groups[r.group].by !== name) { diag.lockout++; continue; }
                if (r.gait && r.gait.indexOf(gait) < 0) { diag.gait++; continue; }
                var conf = Math.max(0.3, Math.min(1, 0.5 + 0.5 * (d.peak - 1)));
                if (r.defer_ms) { d.state = 'defer'; d.deferAt = t + r.defer_ms; d.deferConf = conf; continue; }
                fire(name, R, d, t, conf);
            }
        }
        function fire(name, R, d, t, conf) {
            var r = R.r;
            d.fired = t; d.last = t; d.conf = conf; d.endSince = 0;
            d.until = t + (r.cooldown_ms || 0);
            d.state = r.end ? 'active' : 'cooldown';
            if (r.group) groups[r.group] = { until: t + (r.cooldown_ms || 0), by: name };
            emit(name, t, conf, {});
        }

        function stepDetect(t) {
            var v = sig.vertical, thr = Math.max(1.0, 0.45 * avgPeak);
            if (!stepArm) { if (v > thr) { stepArm = true; stepPeak = v; } }
            else if (v > stepPeak) stepPeak = v;
            else if (v < 0) {
                stepArm = false;
                if (t - lastStep >= STEP_MIN_MS && sig.freefall === 0) {
                    var interval = lastStep ? Math.round(t - lastStep) : 0;
                    lastStep = t; totalSteps++;
                    avgPeak = avgPeak * 0.8 + Math.min(stepPeak, 20) * 0.2;
                    steps.push({ t: t, peak: Math.round(stepPeak * 10) / 10, interval: interval });
                    if (steps.length > 24) steps.shift();
                    gaitUpdate(t);
                    dist += stepLength();
                    if (o.onStep) { try { o.onStep({ t: t, n: totalSteps, peak: stepPeak, interval: interval, gait: gait }); } catch (e) {} }
                }
            }
            if (lastStep && t - lastStep > IDLE_MS && gait !== 'IDLE') { gait = 'IDLE'; cadence = 0; gaitConf = 1; }
        }
        function gaitUpdate(t) {
            var iv = [], i;
            for (i = steps.length - 1; i > 0 && t - steps[i].t < 4000; i--) if (steps[i].interval) iv.push(steps[i].interval);
            if (iv.length < 2) { gait = 'WALK'; cadence = iv.length ? Math.round(60000 / iv[0]) : 0; gaitConf = 0.3; return; }
            iv.sort(function (a, b) { return a - b; });
            cadence = Math.round(60000 / iv[iv.length >> 1]);
            var run = (cadence >= 140 && avgPeak >= 3) || cadence >= 165;
            gait = run ? 'RUN' : 'WALK';
            var margin = Math.min(1, Math.abs(cadence - 140) / 25);
            gaitConf = Math.round(Math.min(1, iv.length / 6) * (0.5 + 0.5 * margin) * 100) / 100;
        }
        function stepLength() {
            var h = (o.profile && o.profile.height || 170) / 100, k = gait === 'RUN' ? Math.max(0.45, Math.min(0.85, 0.45 + 0.004 * (cadence - 140))) : 0.415;
            return h * k * o.stride;
        }

        function feed(s) {
            var t = +s.t, dt;
            if (!isFinite(t)) return;
            dt = lastT ? Math.max(0.001, Math.min(0.1, (t - lastT) / 1000)) : 0.016;
            if (lastT && t <= lastT) return;                      // replayed or duplicated sample
            lastT = t;
            var G = [num(s.gx) || 0, num(s.gy) || 0, num(s.gz) || 0], lin;
            var hasLin = num(s.ax) !== null && num(s.ay) !== null && num(s.az) !== null;
            if (hasLin) {
                var gNow = sub(G, [s.ax, s.ay, s.az]);
                g = g ? [g[0] + (gNow[0] - g[0]) * 0.3, g[1] + (gNow[1] - g[1]) * 0.3, g[2] + (gNow[2] - g[2]) * 0.3] : gNow;
                lin = [s.ax, s.ay, s.az];
            } else {
                var k = dt / (0.4 + dt);
                g = g ? [g[0] + (G[0] - g[0]) * k, g[1] + (G[1] - g[1]) * k, g[2] + (G[2] - g[2]) * k] : G.slice();
                lin = sub(G, g);
            }
            var up = norm(g) || [0, 0, 1];
            if (!right) right = screenRight(s.angle);
            var rh = norm(sub(right, scale(up, dot(right, up))));
            if (rh && len(sub(right, scale(up, dot(right, up)))) > 0.3) rightH = rh;
            if (!rightH) rightH = rh || [1, 0, 0];
            var fwd = cross(up, rightH);
            function avg3(h, v) { h.push(v); if (h.length > 3) h.shift(); return (h[0] + (h[1] === undefined ? h[0] : h[1]) + (h[2] === undefined ? h[0] : h[2])) / 3; }
            sig.vertical = avg3(hist.v, dot(lin, up));
            sig.lateral = avg3(hist.l, dot(lin, rightH));
            sig.forward = avg3(hist.f, dot(lin, fwd));
            sig.magnitude = len(G);
            if (sig.magnitude < FREEFALL) { if (!ffSince) ffSince = t; sig.freefall = t - ffSince; } else { ffSince = 0; sig.freefall = 0; }
            vv = (vv + sig.vertical * dt) * Math.exp(-dt / 0.6); vd = (vd + vv * dt) * Math.exp(-dt / 1.0);
            lv = (lv + sig.lateral * dt) * Math.exp(-dt / 0.6);
            sig.v_vel = vv; sig.v_disp = vd; sig.l_vel = lv;
            sig.pitch = Math.atan2(up[1], up[2]) * 180 / Math.PI; sig.roll = Math.atan2(up[0], up[2]) * 180 / Math.PI;
            sig.rot = Math.sqrt(Math.pow(num(s.ra) || 0, 2) + Math.pow(num(s.rb) || 0, 2) + Math.pow(num(s.rg) || 0, 2));
            if (calib) {                                          // still and facing the TV: this grip is the reference
                if (!calib.t0) calib.t0 = t;
                calib.n++; calib.sum = [calib.sum[0] + g[0], calib.sum[1] + g[1], calib.sum[2] + g[2]];
                if (sig.rot > 40 || Math.abs(sig.magnitude - 9.81) > 1.5) calib.moved++;
                if (t - calib.t0 >= 1200) {
                    var ok = calib.moved < calib.n * 0.2, cb = calib.cb;
                    if (ok) { right = screenRight(s.angle); rightH = null; g = scale(calib.sum, 1 / calib.n); vv = vd = lv = 0; hist = { v: [], l: [], f: [] }; }
                    calib = null; cb(ok);
                }
                return;
            }
            stepDetect(t);
            detect(t);
        }

        function metrics() {
            var speed = gait === 'IDLE' ? 0 : stepLength() * cadence / 60;    // m/s
            return { gait: gait, cadence: cadence, speed_kmh: Math.round(speed * 36) / 10, pace_sec_per_km: speed > 0.3 ? Math.round(1000 / speed) : 0,
                     distance_m: Math.round(dist * 10) / 10, steps: totalSteps, confidence: gaitConf };
        }
        function debug() {
            var out = [], i, s = {}, k;
            for (k in sig) s[k] = Math.round(sig[k] * 100) / 100;
            for (i = 0; i < order.length; i++) { var d = det[order[i]]; out.push({ name: order[i], state: d.state, level: Math.round(Math.max(0, d.level) * 100) / 100, confidence: d.conf, last: d.last }); }
            return { signals: s, detectors: out, diag: JSON.parse(JSON.stringify(diag)), steps: steps.slice(-8), calibrated: !!calibOk, gait: gait };
        }
        var calibOk = false;
        return {
            feed: feed,
            configure: configure,
            calibrate: function (cb) { calib = { t0: 0, n: 0, moved: 0, sum: [0, 0, 0], cb: function (ok) { calibOk = ok; if (cb) cb(ok); } }; },
            calibrating: function () { return !!calib; },
            reset: function () {
                steps = []; totalSteps = 0; dist = 0; gait = 'IDLE'; cadence = 0; lastStep = 0; vv = vd = lv = 0; groups = {};
                for (var k in diag) diag[k] = 0;
                for (k in det) det[k] = { state: 'idle', since: 0, peak: 0, fired: 0, until: 0, edge: false, level: 0, conf: 0, last: 0, endSince: 0, deferAt: 0, deferConf: 0 };
            },
            metrics: metrics,
            debug: debug,
            moves: function () { return order.slice(); }
        };
    }

    return { create: create, MOVES: MOVES };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = MotionEngine;
