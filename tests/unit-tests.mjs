// Unit tests without a browser (node tests/unit-tests.mjs):
//   1. HrBle: Heart Rate Measurement decoding (8 / 16 bit, contact, energy, RR), scan / connect / reconnect with a fake
//      Tizen Bluetooth stack that behaves like a Garmin Forerunner 55 broadcasting, a Polar H10, a Garmin HRM and a Decathlon strap
//   2. SensorProto: validation of every phone controller message, sequence numbers (duplicates, stale)
//   3. MotionEngine: synthetic recordings (still, walking, running in place, jump, duck, side steps) -> the right events only,
//      at 60 Hz (browser) and 100 Hz (Android app)
//   4. Android controller app bridge (android-controller/app/src/main/assets/bridge.js)
//   5. app bridges: WebProxy (local network check, base64, .wav) and AI (request shapes for Gemini, OpenAI-compatible, Claude, NVIDIA speech)
//   6. GlobalSettings: titles taken from a picture's address, cleaning of settings/mypc
//   8. Desktop widgets (js/core/widget-lib.js): mypc-app.json "widgets", settings, approvals kept on update, views cleaned, the Worker;
//      Music (placeholder player) and Playtime
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
function check(cond, msg) { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; }
const load = (rel, ctx) => { vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel }); return ctx; };

/* ---------------- 1. HrBle ---------------- */
console.log('1. HrBle (Bluetooth LE heart-rate sensors)');
{
    // a context with fake timers we can advance
    let now = 1000, timers = [], tid = 0;
    const ctx = vm.createContext({
        console, Math, JSON, Date: { now: () => now }, Uint8Array, ArrayBuffer, Array, Object, String, Number, Error, isFinite,
        setTimeout: (f, ms) => { timers.push({ id: ++tid, at: now + ms, f }); return tid; },
        clearTimeout: (id) => { timers = timers.filter((t) => t.id !== id); },
        setInterval: (f, ms) => { const id = ++tid; const rep = () => { timers.push({ id, at: now + ms, f: () => { rep(); f(); } }); }; rep(); return id; },
        clearInterval: (id) => { timers = timers.filter((t) => t.id !== id); },
        localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); } }
    });
    const advance = (ms) => { const end = now + ms; for (;;) { timers.sort((a, b) => a.at - b.at); const t = timers[0]; if (!t || t.at > end) break; timers.shift(); now = t.at; t.f(); } now = end; };
    ctx.window = ctx;
    load('js/core/hr-ble.js', ctx);
    const H = ctx.HrBle;

    const d8 = H.decode([0x06, 72]);
    check(d8.bpm === 72 && d8.format === 8 && d8.contactState === 'detected' && d8.contact === 'Detected' && d8.rr === null, '8-bit heart rate with contact detected');
    const d16 = H.decode([0x01, 0x2c, 0x01]);
    check(d16.bpm === 300 && d16.format === 16 && d16.contactState === 'unsupported', '16-bit heart rate (flag bit 0) is read little-endian');
    const rr = H.decode([0x10 | 0x08 | 0x04 | 0x02, 150, 0x34, 0x12, 0x00, 0x04, 0x00, 0x02]);
    check(rr.bpm === 150 && rr.energy === 0x1234 && rr.rrs.length === 2 && rr.rrs[0] === 1000 && rr.rrs[1] === 500 && rr.rr === 500, 'energy expended and several RR intervals (1/1024 s -> ms)');
    const trunc = H.decode([0x18, 90, 0x10]);
    check(trunc && trunc.bpm === 90 && trunc.energy === null && trunc.rrs.length === 0, 'a truncated packet keeps its heart rate');
    check(H.decode([0x04, 0]).contactState === 'not-detected' && H.decode([0x01, 5]) === null && H.decode([]) === null, 'no contact, and packets too short for their format are refused');
    check(H.decode(new Uint8Array([0, 61]).buffer).bpm === 61 && H.decode({ value: [0, 62] }).bpm === 62, 'ArrayBuffer and { value } payloads');
    check(H.uuidIs('0000180D-0000-1000-8000-00805F9B34FB', '180d') && H.uuidIs('180d', '180d') && H.uuidIs('0x180D', '180d') && !H.uuidIs('0000180f-0000-1000-8000-00805f9b34fb', '180d'), 'short, long and 0x UUIDs');

    // fake Tizen BLE: devices advertise; a device can drop and come back
    const devices = [];
    function mkDevice(o) {
        const d = {
            address: o.address, name: o.name, uuids: o.uuids, rssi: -60, connected: false, listeners: {}, nextL: 1, valueL: null, refuse: 0,
            connect(ok, err) { ctx.setTimeout(() => { if (d.refuse > 0 || !d.present) { d.refuse--; return err(new Error('connect failed')); } d.connected = true; ok(); }, 50); },
            disconnect(ok) { d.connected = false; if (ok) ok(); },
            isConnected() { return d.connected; },
            getServiceAllUuids() { return o.allUuids || o.uuids; },
            getService(u) {
                if (!H.uuidIs(u, '180d') || (o.exact && u !== o.exact)) throw new Error('NotFoundError');
                return { uuid: u, characteristics: [{ uuid: o.noCharUuid ? undefined : '00002a38-0000-1000-8000-00805f9b34fb', isNotify: false }, {
                    uuid: o.noCharUuid ? undefined : '2a37', isNotify: true,
                    addValueChangeListener(f) { d.valueL = f; return 7; }, removeValueChangeListener() { d.valueL = null; } }] };
            },
            addConnectStateChangeListener(l) { const id = d.nextL++; d.listeners[id] = l; return id; },
            removeConnectStateChangeListener(id) { delete d.listeners[id]; },
            present: true,
            drop() { d.connected = false; d.present = false; for (const k in d.listeners) d.listeners[k].ondisconnected(); },
            back() { d.present = true; },
            notify(bytes) { if (d.valueL && d.connected) d.valueL(bytes); }
        };
        return d;
    }
    const fr55 = mkDevice({ address: 'C4:11:22:33:44:55', name: '', uuids: ['0000180d-0000-1000-8000-00805f9b34fb'], exact: '0000180d-0000-1000-8000-00805f9b34fb' });
    const h10 = mkDevice({ address: 'A0:9E:1A:00:00:10', name: 'Polar H10 9A1B2C3D', uuids: ['180D'] });
    const hrm = mkDevice({ address: 'E8:00:00:00:00:01', name: 'HRM-Dual:123456', uuids: [], allUuids: ['0000180d-0000-1000-8000-00805f9b34fb'] });
    const kal = mkDevice({ address: 'D0:00:00:00:00:02', name: 'Decathlon Dual HR', uuids: [], noCharUuid: true });
    const tv = mkDevice({ address: 'F0:00:00:00:00:03', name: 'Living room speaker', uuids: ['110b'] });
    devices.push(fr55, h10, hrm, kal, tv);
    let scanning = null;
    ctx.tizen = { bluetooth: {
        getLEAdapter: () => ({ startScan(cb) { scanning = cb; devices.forEach((d, i) => ctx.setTimeout(() => { if (scanning === cb && d.present) cb(d); }, 100 + i * 50)); ctx.setTimeout(() => { if (scanning === cb && fr55.present) cb(Object.assign(Object.create(fr55), { name: 'Forerunner 55' })); }, 600); }, stopScan() { scanning = null; } }),
        getDefaultAdapter: () => ({ powered: true })
    } };
    const ev = [];
    const b = H.create((kind, m) => ev.push(m));
    const result = (id) => ev.find((e) => e.kind === 'result' && e.requestId === id);
    b.handle('capabilities', 1);
    check(result(1).ok && result(1).result.nativeBleAvailable && result(1).result.reasonCode === 'available', 'capabilities: Bluetooth LE available');
    b.handle('scan', 2, { seconds: 3 });
    advance(3100);
    const devs = result(2).result.devices;
    check(devs.length === 4 && !devs.some((d) => /speaker/.test(d.name)), 'the scan lists the 4 heart-rate sensors and not the speaker (' + devs.map((d) => d.name).join(', ') + ')');
    check(devs.find((d) => d.id === 'c4:11:22:33:44:55').name === 'Forerunner 55' && ev.some((e) => e.kind === 'device-found' && e.updated), 'a watch with no name in its advert gets its name from the scan response');
    // connect the watch: exact long UUID needed by its firmware
    b.handle('connect', 3, { deviceId: 'c4:11:22:33:44:55' });
    advance(100);
    check(result(3) && result(3).ok && b.state() === 'connected', 'connects to the Forerunner 55 (service found with its long UUID)');
    fr55.notify([0x00, 0x8c]); fr55.notify([0x01, 0x90, 0x00]);
    const reads = ev.filter((e) => e.kind === 'reading');
    check(reads.length === 2 && reads[0].bpm === 140 && reads[1].bpm === 144 && reads[1].deviceName === 'Forerunner 55' && reads[0].source === 'ble', 'readings in 8-bit then 16-bit format arrive as events');
    check(JSON.parse(ctx.localStorage.getItem('arc_dev_hrble')).id === 'c4:11:22:33:44:55', 'the sensor is remembered on the TV');
    advance(12000);
    check(ev.some((e) => e.kind === 'status' && e.status === 'stale'), 'a silent connection is reported as stale');
    fr55.notify([0x00, 0x80]);
    check(ev.filter((e) => e.kind === 'status').pop().status === 'connected', 'readings coming back clear the stale state');
    // the watch stops broadcasting, then broadcasts again: reconnects by itself
    fr55.drop();
    check(b.state() === 'reconnecting', 'a dropped sensor goes to reconnecting');
    advance(20000);
    check(b.state() === 'reconnecting' && ev.filter((e) => e.status === 'reconnecting').length >= 3, 'it keeps trying with backoff while the watch is away');
    fr55.back();
    advance(40000);
    check(b.state() === 'connected', 'the watch is back: connected again without the user');
    fr55.notify([0x06, 99]);
    check(ev.filter((e) => e.kind === 'reading').pop().bpm === 99, 'readings flow again after the reconnection');
    b.handle('disconnect', 4);
    check(result(4).ok && b.state() === 'idle' && ev.filter((e) => e.kind === 'status').pop().reason === 'user', 'disconnect by the user stops everything (no reconnection)');
    fr55.drop(); advance(30000);
    check(b.state() === 'idle', 'no reconnection after a user disconnect');
    fr55.back();
    // Decathlon strap whose firmware gives no characteristic UUIDs; Garmin HRM whose 180D is only in getServiceAllUuids
    b.handle('scan', 5, { seconds: 3 }); advance(3100);
    b.handle('connect', 6, { deviceId: 'd0:00:00:00:00:02' }); advance(100);
    check(result(6).ok, 'Decathlon strap without characteristic UUIDs: the notifying characteristic is used');
    kal.notify([0x00, 77]);
    check(ev.filter((e) => e.kind === 'reading').pop().bpm === 77, 'Decathlon readings arrive');
    b.handle('scan', 7, { seconds: 3 });
    check(result(7).ok && result(7).result.alreadyConnected, 'scanning while connected returns the connected sensor');
    b.handle('disconnect', 8);
    b.handle('scan', 9, { seconds: 3 }); advance(3100);
    b.handle('connect', 10, { deviceId: 'e8:00:00:00:00:01' }); advance(100);
    check(result(10).ok, 'Garmin HRM-Dual: 180D found through getServiceAllUuids');
    hrm.notify([0x04, 0]);
    check(ev.filter((e) => e.kind === 'status').pop().status === 'no-contact' && ev.filter((e) => e.kind === 'reading').pop().bpm === 77, 'a strap off the skin (bpm 0) gives a no-contact status, not a reading');
    b.handle('disconnect', 11);
    b.handle('connect', 12, { deviceId: 'f0:00:00:00:00:03' });
    check(result(12).ok === false, 'connecting a device that is not in the scan list is refused');
    // reconnect-last finds the remembered sensor without a picker
    ctx.localStorage.setItem('arc_dev_hrble', JSON.stringify({ id: 'a0:9e:1a:00:00:10', name: 'Polar H10 9A1B2C3D' }));
    b.handle('reconnect-last', 13); advance(2000);
    check(result(13) && result(13).ok && result(13).result.deviceName === 'Polar H10 9A1B2C3D', 'reconnect-last scans for the Polar H10 and connects');
    h10.refuse = 1;
    b.handle('start-test', 14);
    check(result(14).ok && b.state() === 'test' && ev.filter((e) => e.kind === 'reading').pop().source === 'simulation', 'test mode replaces the sensor with simulated readings');
    b.handle('stop-test', 15);
    b.destroy();
    const n = ev.length; advance(5000);
    check(ev.length === n && timers.length === 0, 'destroy frees every timer and sends nothing more');
    // no Tizen: a clear error, no exception
    const ctx2 = vm.createContext({ console, Math, JSON, Date, setTimeout, clearTimeout, setInterval, clearInterval, Array, Object, String, Number, Error, Uint8Array, ArrayBuffer, isFinite });
    ctx2.window = ctx2; load('js/core/hr-ble.js', ctx2);
    const ev2 = []; const b2 = ctx2.HrBle.create((k, m) => ev2.push(m));
    b2.handle('scan', 1); b2.handle('capabilities', 2);
    check(ev2.find((e) => e.requestId === 1).ok === false && ev2.find((e) => e.requestId === 2).result.reasonCode === 'tizen-api-unavailable', 'off the TV: scan fails with a message, capabilities explain why');
    b2.destroy();
}

/* ---------------- 2. SensorProto ---------------- */
console.log('2. SensorProto (phone controller protocol v1)');
const ctxP = vm.createContext({ console, Math, JSON, Date, Uint8Array, crypto: globalThis.crypto, Object, Array, isFinite, String, Number });
load('js/core/sensor-proto.js', ctxP); load('js/core/motion.js', ctxP);
const P = ctxP.SensorProto, M = ctxP.MotionEngine;
{
    const c = P.config({ moves: ['LEFT', 'JUMP', 'DUCK_END', 'SPIN', 'bad name', 'LEFT'], profile: { age: 30, height: 180, weight: 75, phone_position: 'waist' }, metrics: { hz: 9 }, define: { SPIN: { signal: 'rot', above: 300, cooldown_ms: 800 }, OOPS: { signal: 'nope', above: 1 } } }, M.MOVES);
    check(c && c.v === 1 && JSON.stringify(c.moves) === '["LEFT","JUMP","DUCK_END","SPIN"]', 'config keeps known and defined moves, drops bad names and duplicates (' + JSON.stringify(c.moves) + ')');
    check(c.define.SPIN && !c.define.OOPS && c.metrics.enabled && c.metrics.hz === 1 && c.raw.hz === 30, 'a custom move with a valid rule is kept; bad rules and rates are dropped / defaulted');
    check(c.profile.height === 180 && c.profile.phone_position === 'waist' && P.profile({ height: 9 }).height === 170, 'profile in metric units, out of range values defaulted');
    check(P.config({ moves: ['UNKNOWN'] }, M.MOVES).moves.length === 0 && P.config({ type: 'other' }) === null, 'unknown moves without a rule are not asked for');
    check(P.action({ type: 'action', action: 'LEFT', timestamp: 1791830000000, sequence: 42 }).sequence === 42 && !P.action({ type: 'action', action: 'left', timestamp: 1, sequence: 1 }) && !P.action({ type: 'action', action: 'LEFT', sequence: 'x', timestamp: 1 }), 'action events are validated');
    const m = P.metrics({ type: 'metrics', gait: 'RUN', cadence: 162, speed_kmh: 8.44, pace_sec_per_km: 428, distance_m: 325.63, sequence: 3 });
    check(m && m.speed_kmh === 8.4 && m.distance_m === 325.6 && !P.metrics({ type: 'metrics', gait: 'FLY', sequence: 1 }), 'metrics are validated and rounded');
    check(P.raw({ type: 'raw', sequence: 1, s: [[16, 0, 0, 0, 0, 0, 9.8, 0, 0, 0]] }) && !P.raw({ type: 'raw', sequence: 1, s: [[1, 2]] }) && !P.raw({ type: 'raw', sequence: 1, s: Array(13).fill([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) }), 'raw batches: 10 numbers per sample, 12 samples per message at most');
    check(P.hello({ t: 'hi', proto: 1, mode: 'sensor-actions', session: 'ab12cd34', caps: { motion: true } }).mode === 'sensor-actions' && P.hello({ t: 'hi' }).mode === 'pad', 'hello: mode and protocol version, old phones are pad phones');
    const tr = P.tracker();
    check(tr.check(1) === 'ok' && tr.check(2) === 'ok' && tr.check(2) === 'duplicate' && tr.check(1) === 'duplicate', 'a repeated sequence number is a duplicate');
    for (let i = 3; i < 200; i++) tr.check(i);
    check(tr.check(50) === 'stale', 'a sequence far behind the newest is stale');
    check(tr.check(500, Date.now() - 10000, 0) === 'stale' && tr.check(501, Date.now() - 100, 0) === 'ok', 'an action older than 3 s (on the TV clock) is stale');
}

/* ---------------- 2b. Aim: the phone as a pointer (Pointer mode) ---------------- */
console.log('2b. Aim (pointer: gyroscope + accelerometer, any grip, steady zone, smoothing, calibration)');
load('js/core/aim.js', ctxP);
{
    const A = ctxP.Aim;
    check(P.config({ pointer: true }).pointer === true && P.config({}).pointer === false && P.MODES.indexOf('pointer') >= 0 && P.hello({ t: 'hi', mode: 'pointer' }).mode === 'pointer', 'Pointer is its own mode; config.pointer is only on when the TV says so');
    check(P.hello({ t: 'hi', mode: 'keyboard' }).mode === 'keyboard', 'Keyboard is a mode the TV accepts (a gamepad, like pad)');
    const tu = P.tune({ sensitivity: 9, scales: { JUMP: 1.5, LEFT: 'x', SPIN: 2, bad: 3 }, run_scale: 2, guard_ms: 99999 });
    check(tu.sensitivity === 2 && tu.scales.JUMP === 1.5 && tu.scales.LEFT === 1 && tu.scales.SPIN === 2 && tu.scales.bad === undefined && tu.run_scale === 2 && tu.guard_ms === 1500 && P.config({}).tune.guard_ms === 500,
        'the TV\'s move settings (tune) are validated and always sent, with defaults');
    check(P.action({ type: 'action', action: 'JUMP', timestamp: 1, sequence: 1, gait: 'RUN' }).gait === 'RUN' && P.action({ type: 'action', action: 'JUMP', timestamp: 1, sequence: 1, gait: 'FLY' }).gait === undefined, 'an action may say the gait it came in');
    check(P.aim({ t: 'pm', x: 120.4, y: -30 }).x === 120 && P.aim({ t: 'pc' }).t === 'pc' && !P.aim({ t: 'pm', x: 'a', y: 0 }) && !P.aim({ t: 'pm', x: 20000, y: 0 }), 'pointer messages are validated (whole hundredths of a degree, 90 degrees at most)');
    let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
    // a recording at 100 Hz: segments [ms, gravity [x,y,z], rotation [alpha (z), beta (x), gamma (y)] deg/s, noise?]; 300 ms still first
    const run = (g0, parts, opt = {}, angle = 0, a = A.create(opt)) => {
        let x = 0, y = 0, t = 0;
        const seg = [[300, g0, [0, 0, 0]], ...parts, [700, g0, [0, 0, 0]]];
        for (const [ms, g, w, noise] of seg) for (let k = 0; k < ms; k += 10, t += 10) {
            const n = noise ? [rnd() * noise, rnd() * noise, rnd() * noise] : [0, 0, 0];
            a.feed({ t, gx: g[0], gy: g[1], gz: g[2], ra: w[0] === null ? null : w[0] + n[0], rb: w[1] === null ? null : w[1] + n[1], rg: w[2] === null ? null : w[2] + n[2], angle });
            const d = a.take(1); if (d) { x += d[0]; y += d[1]; }
        }
        return [x / 100, y / 100];
    };
    const near = (v, want, tol = 1) => Math.abs(v - want) < tol;
    const FLAT = [0, 0, 9.81], SIDE = [9.81, 0, 0];
    let d = run(FLAT, [[1000, FLAT, [20, 0, 0]]]);
    check(near(d[0], -20) && near(d[1], 0, 0.3), 'held like a remote (screen up): turning left 20 degrees moves the pointer left 20 degrees, not up or down (' + d + ')');
    d = run(FLAT, [[1000, FLAT, [0, 10, 0]]]);
    check(near(d[0], 0, 0.3) && near(d[1], -10), 'remote grip: tilting the top up moves the pointer up (' + d + ')');
    d = run(FLAT, [[1000, FLAT, [0, 0, -10]]], {}, 90);
    check(near(d[0], 0, 0.3) && near(d[1], -10), 'remote grip with the screen in landscape: the top of the picture points at the TV, tilting it up moves the pointer up (' + d + ')');
    d = run(SIDE, [[1000, SIDE, [0, -15, 0]]], {}, 90);
    check(near(d[0], 15) && near(d[1], 0, 0.3), 'held like a game (screen to the player): turning right moves the pointer right (' + d + ')');
    d = run(FLAT, [[1000, FLAT, [0, 0, 30]]]);
    check(near(d[0], 0, 0.3) && near(d[1], 0, 0.3), 'a twist of the wrist around the pointing axis does not move the pointer (' + d + ')');
    d = run(FLAT, [[2000, FLAT, [0, 0, 0], 2.5]]);
    check(near(d[0], 0, 0.4) && near(d[1], 0, 0.4), 'hand tremor (noise up to 1.25 deg/s) stays in the steady zone (' + d + ')');
    d = run(FLAT, [[1500, FLAT, [4, 0, 0]]]);
    check(d[0] < -4, 'a slow, intended turn (4 deg/s) still moves it (' + d + ')');
    const shake = []; for (let k = 0; k < 60; k++) shake.push([10, [rnd() * 30, rnd() * 30, 9.81 + rnd() * 30], [0, 0, 0]]);
    d = run(FLAT, shake.concat([[1000, FLAT, [20, 0, 0]]]));
    check(near(d[0], -20) && near(d[1], 0, 0.3), 'shaking the phone (accelerometer only) does not move the pointer or tilt its axes (' + d + ')');
    const b = A.create(); run(FLAT, [[6000, FLAT, [0.9, 0, 0]]], {}, 0, b);      // a gyroscope that reads 0.9 deg/s at rest
    d = run(FLAT, [[3000, FLAT, [0.9, 0, 0]]], { steady: 0 }, 0, b);
    check(near(d[0], 0, 0.6), 'the gyroscope offset is learnt while still: no drift afterwards, even with no steady zone (' + d + ')');
    d = run(FLAT, [[1000, FLAT, [20, 0, 0]]], { swapX: true, swapY: true });
    check(near(d[0], 20), 'swap left and right (calibration result) reverses the movement (' + d + ')');
    check(run(FLAT, [[1000, FLAT, [null, null, null]]])[0] === 0, 'no gyroscope: no movement');
    const h = A.create(); run(FLAT, [], {}, 0, h); h.hold(650); d = run(FLAT, [[300, FLAT, [40, 0, 0]]], {}, 0, h);      // run() starts with 300 ms still
    check(Math.abs(d[0]) < 1, 'right after a click the pointer holds still (' + d + ')');
    const c = A.create(); run(FLAT, [[1000, FLAT, [-20, 0, 0]]], { swapX: true }, 0, c);
    check(near(c.turned().x, 20), 'turned() reports the real turn before swapping (calibration reads it): ' + c.turned().x.toFixed(1));
    const sm = (lvl) => { const a = A.create({ smooth: lvl }); let x = 0, t = 0, out = []; for (; t < 300; t += 10) a.feed({ t, gx: 0, gy: 0, gz: 9.81, ra: 0, rb: 0, rg: 0 }); for (let k = 0; k < 10; k++, t += 10) { a.feed({ t, gx: 0, gy: 0, gz: 9.81, ra: -30, rb: 0, rg: 0 }); const d = a.take(1); if (d) x += d[0]; } return x; };
    check(sm(10) < sm(1), 'more smoothness = a softer start (' + sm(1) + ' vs ' + sm(10) + ' hundredths in the first 100 ms)');
    const g2 = A.create(); run(FLAT, [[100, FLAT, [-20, 0, 0]]], {}, 0, g2);
    const g3 = A.create(); let tot2 = 0, tot1 = 0;
    { let t = 0; for (; t < 300; t += 10) g3.feed({ t, gx: 0, gy: 0, gz: 9.81, ra: 0, rb: 0, rg: 0 }); for (; t < 1300; t += 10) g3.feed({ t, gx: 0, gy: 0, gz: 9.81, ra: -20, rb: 0, rg: 0 }); for (; t < 2000; t += 10) g3.feed({ t, gx: 0, gy: 0, gz: 9.81, ra: 0, rb: 0, rg: 0 }); tot2 = g3.take(2)[0]; }
    check(near(tot2 / 100, 40, 2) && g3.take(2) === null, 'the speed setting multiplies the movement and nothing is sent twice (' + tot2 / 100 + ')');
}

/* ---------------- 3. MotionEngine ---------------- */
// 60 Hz: the browser's devicemotion; 100 Hz: the Android app's native sensors (android-controller/)
for (const HZ of [60, 100]) {
    console.log('3. MotionEngine (synthetic recordings, phone in the right hand, landscape, ' + HZ + ' Hz)');
    const DT = 1000 / HZ, UP = [1, 0, 0], RIGHT = [0, -1, 0], FWD = [0, 0, -1];    // landscape, phone turned left (angle 90)
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
    // a recording: list of [ms, vertical, lateral, forward, freefall?] segments -> samples
    function rec(parts) {
        const out = []; let t = 1000;
        for (const p of parts) {
            const n = Math.round(p.ms / DT);
            for (let i = 0; i < n; i++, t += DT) {
                const tt = i * DT / 1000;
                let v = typeof p.v === 'function' ? p.v(tt) : (p.v || 0), l = typeof p.l === 'function' ? p.l(tt) : (p.l || 0), f = typeof p.f === 'function' ? p.f(tt) : (p.f || 0);
                v += rnd() * 0.3; l += rnd() * 0.3; f += rnd() * 0.3;
                let lin = [0, 1, 2].map((k) => UP[k] * v + RIGHT[k] * l + FWD[k] * f);
                if (p.free) lin = UP.map((u) => -u * 9.81 + rnd() * 0.4);
                const G = lin.map((x, k) => x + UP[k] * 9.81);
                out.push({ t, ax: lin[0], ay: lin[1], az: lin[2], gx: G[0], gy: G[1], gz: G[2], ra: 0, rb: 0, rg: 0, angle: 90 });
            }
        }
        return out;
    }
    function run(samples, opts) {
        const acts = [], steps = [];
        const m = M.create(Object.assign({ moves: ['LEFT', 'RIGHT', 'JUMP', 'DUCK', 'DUCK_END'], profile: { height: 175 }, onAction: (n, i) => acts.push([n, Math.round(i.t)]), onStep: (s) => steps.push(s) }, opts || {}));
        for (const s of samples) m.feed(s);
        return { acts: acts.map((a) => a[0]), at: acts, steps, m };
    }
    const still = { ms: 1500 };
    const S = (hz, amp, extra) => (t) => amp * Math.sin(2 * Math.PI * hz * t) + (extra || 0);
    const jump = [{ ms: 160, v: -6 }, { ms: 140, v: 12 }, { ms: 320, free: true }, { ms: 80, v: 22 }, { ms: 150, v: -3 }];
    const duck = [{ ms: 260, v: -5.5 }, { ms: 260, v: 5.5 }, { ms: 900 }, { ms: 260, v: 6 }, { ms: 260, v: -6 }];
    const left = [{ ms: 130, l: -8 }, { ms: 130, l: 8 }];
    const right = [{ ms: 130, l: 8 }, { ms: 130, l: -8 }];

    let r = run(rec([still, still]));
    check(r.acts.length === 0 && r.m.metrics().gait === 'IDLE' && r.m.metrics().steps === 0, 'standing still: no event, IDLE, no steps');
    r = run(rec([still, { ms: 8000, v: S(105 / 60, 2.6) }]));
    let mt = r.m.metrics();
    check(r.acts.length === 0, 'walking in place: no move fires (' + r.acts.join(',') + ')');
    check(mt.gait === 'WALK' && Math.abs(mt.cadence - 105) <= 6 && mt.steps >= 12 && mt.steps <= 15, 'walking in place: WALK, cadence ' + mt.cadence + ' (105), ' + mt.steps + ' steps');
    check(mt.speed_kmh > 3 && mt.speed_kmh < 6 && mt.distance_m > 8, 'walking: ' + mt.speed_kmh + ' km/h, ' + mt.distance_m + ' m');
    r = run(rec([still, { ms: 10000, v: S(165 / 60, 7.5), l: S(165 / 120, 2.2), f: S(165 / 120, 4) }]));
    mt = r.m.metrics();
    check(r.acts.length === 0, 'running in place with arm swing: no false move (' + r.acts.join(',') + ', diag ' + JSON.stringify(r.m.debug().diag) + ')');
    check(mt.gait === 'RUN' && Math.abs(mt.cadence - 165) <= 8 && mt.pace_sec_per_km > 200 && mt.pace_sec_per_km < 600, 'running in place: RUN, cadence ' + mt.cadence + ', ' + mt.speed_kmh + ' km/h, pace ' + mt.pace_sec_per_km + ' s/km');
    r = run(rec([still, ...jump, still]));
    check(r.acts.join() === 'JUMP', 'a jump: exactly JUMP (' + r.acts.join(',') + ')');
    check(r.at[0] && r.at[0][1] - (1000 + 1500 + 300) < 260, 'JUMP fires while still in the air (' + (r.at[0] && r.at[0][1] - 2800) + ' ms after take-off)');
    r = run(rec([still, ...duck, still]));
    check(r.acts.join() === 'DUCK,DUCK_END', 'a duck: DUCK then DUCK_END (' + r.acts.join(',') + ')');
    check(r.at.length === 2 && r.at[1][1] - r.at[0][1] > 900, 'DUCK_END comes when the player stands up, not at the bottom of the squat (' + (r.at[1] && r.at[1][1] - r.at[0][1]) + ' ms)');
    r = run(rec([still, ...left, still, ...right, still]));
    check(r.acts.join() === 'LEFT,RIGHT', 'a step left then a step right: LEFT, RIGHT, no rebound (' + r.acts.join(',') + ')');
    // repeat guard (the TV's Motion moves screen): a step right and a quick step left 600 ms later
    const quick = [still, ...right, { ms: 340 }, ...left, still];
    r = run(rec(quick), { guardMs: 0 });
    const rg = run(rec(quick), { guardMs: 1000 });
    check(r.acts.join() === 'RIGHT,LEFT' && rg.acts.join() === 'RIGHT' && rg.m.debug().diag.guard === 1, 'repeat guard: a move right after another is held back (' + r.acts.join(',') + ' -> ' + rg.acts.join(',') + ')');
    r = run(rec([still, ...left, still, ...right, still]), { guardMs: 1000 });
    check(r.acts.join() === 'LEFT,RIGHT', 'the repeat guard does not hold back moves that are far apart');
    r = run(rec([still, ...left, still]), { scales: { LEFT: 2.5 } });
    const r3 = run(rec([still, ...left, still]), { scales: { RIGHT: 2.5 } });
    check(r.acts.length === 0 && r3.acts.join() === 'LEFT', 'a move\'s limit (scales) makes only that move harder');
    const hopRight = [{ ms: 140, l: 8, v: 10 }, { ms: 300, free: true }, { ms: 120, l: -8, v: 18 }, { ms: 150, v: -3 }];
    r = run(rec([still, ...hopRight, still]));
    check(r.acts.join() === 'RIGHT', 'a hop to the right (airborne too) is RIGHT only, not JUMP (' + r.acts.join(',') + ')');
    r = run(rec([still, ...jump, { ms: 120, l: -7 }, still]));
    check(r.acts.join() === 'JUMP', 'a jump whose landing jolts sideways is JUMP only (' + r.acts.join(',') + ')');
    r = run(rec([still, ...left, still]), { moves: ['RIGHT', 'JUMP'] });
    check(r.acts.length === 0, 'moves the game did not ask for are never sent');
    r = run(rec([still, ...duck, still]), { moves: ['DUCK'] });
    check(r.acts.join() === 'DUCK', 'DUCK_END is only sent when the game asked for it');
    r = run(rec([still, { ms: 6000, v: S(165 / 60, 7.5) }, ...jump, { ms: 4000, v: S(165 / 60, 7.5) }]));
    check(r.acts.join() === 'JUMP', 'a jump while running is still found, nothing else (' + r.acts.join(',') + ')');
    r = run(rec([still, ...jump, still]), { moves: ['SPIN', 'JUMP'], define: { SPIN: { signal: 'magnitude', above: 25, cooldown_ms: 500 } } });
    check(r.acts.join() === 'JUMP,SPIN', 'a custom move defined by the game (impact > 25 m/s²) fires from its rule (' + r.acts.join(',') + ')');
    // recalibration: still -> ok; moving -> refused
    let ok1 = null; r = M.create({}); r.calibrate((ok) => ok1 = ok); for (const s of rec([still])) r.feed(s);
    let ok2 = null; const r2 = M.create({}); r2.calibrate((ok) => ok2 = ok); for (const s of rec([{ ms: 1500, v: S(2, 9) }])) r2.feed(s);
    check(ok1 === true && ok2 === false, 'recalibrate: accepted when still, refused when the phone moves');
    // duplicates: the same jump fed twice (replayed samples) gives one event
    const j = rec([still, ...jump, still]);
    r = run(j.concat(j));
    check(r.acts.join() === 'JUMP', 'samples replayed with old timestamps are ignored (one JUMP)');
    // the move trainer: limits from this player's own moves (a weak side step, a short jump) -> found; the others stay clear
    if (HZ === 100) {
        const T = load('js/core/motion-train.js', ctxP).MotionTrain;
        const weakLeft = [{ ms: 130, l: -3.2 }, { ms: 130, l: 3.2 }], weakRight = [{ ms: 130, l: 3.2 }, { ms: 130, l: -3.2 }];
        const shortJump = [{ ms: 160, v: -6 }, { ms: 140, v: 12 }, { ms: 140, free: true }, { ms: 80, v: 22 }, { ms: 150, v: -3 }];
        const rep = (parts) => { const s = rec([{ ms: 1000 }, ...parts, { ms: 400 }]); return T.measure(s, s[0].t + 1000); };
        r = run(rec([still, ...weakLeft, still, ...shortJump, still]));
        check(r.acts.length === 0, 'before training: a weak side step and a short jump are missed (' + r.acts.join(',') + ')');
        const train = { LEFT: [], RIGHT: [], JUMP: [], DUCK: [] };
        for (let i = 0; i < 4; i++) { train.LEFT.push(rep(weakLeft)); train.RIGHT.push(rep(weakRight)); train.JUMP.push(rep(shortJump)); train.DUCK.push(rep(duck)); }
        const tuned = T.tune(train);
        check(Object.keys(tuned.define).sort().join() === 'DUCK,JUMP,LEFT,RIGHT' && tuned.report.every((x) => x.reps === 4), 'trainer: every move with enough repetitions gets its own rule (' + tuned.report.map((x) => x.move + ' ' + x.was + '->' + x.limit + (x.clear ? '' : ' overlaps ' + x.overlaps)).join('; ') + ')');
        r = run(rec([still, ...weakLeft, still, ...shortJump, still, ...weakRight, still, ...duck, still]), { define: tuned.define });
        check(r.acts.join() === 'LEFT,JUMP,RIGHT,DUCK,DUCK_END', 'after training: this player\'s moves are found, each as itself (' + r.acts.join(',') + ')');
        r = run(rec([still, { ms: 6000, v: S(105 / 120, 2.2) }, still]), { define: tuned.define });
        check(r.acts.length === 0, 'after training: walking in place still fires nothing (' + r.acts.join(',') + ')');
        check(T.tune({ LEFT: train.LEFT.slice(0, 2) }).report.length === 0, 'trainer: fewer than 3 repetitions change nothing');
    }
    const dbg = run(rec([still, ...left, ...left, still])).m.debug();
    check(dbg.diag.fired === 1 && dbg.diag.cooldown >= 1 && dbg.detectors.length === 4, 'a second side step inside the cooldown is counted as a duplicate, not sent (' + JSON.stringify(dbg.diag) + ')');
}

/* ---------------- 4. Android app bridge ---------------- */
console.log('4. Android controller app: native motion samples reach the page as devicemotion');
{
    let now = 5000; const calls = [], other = [];
    const ctx = vm.createContext({ JSON, Math, console, performance: { now: () => now } });
    ctx.window = ctx;
    ctx.addEventListener = (type, fn) => other.push(type);
    ctx.removeEventListener = () => {};
    ctx.MyPCNative = { caps: () => '{"motion":true,"linear":true,"gyro":true}', motion: (on) => calls.push(on) };
    load('android-controller/app/src/main/assets/bridge.js', ctx);
    const got = [], fn = (e) => got.push(e);
    ctx.addEventListener('devicemotion', fn); ctx.addEventListener('devicemotion', fn); ctx.addEventListener('keydown', () => {});
    check(calls.join() === 'true' && other.join() === 'keydown', 'the first devicemotion listener starts the native sensors; other events are untouched');
    const sample = (t) => [t, 0.1, 0.2, 0.3, 9.9, 0.2, 0.3, 10, 20, null];
    ctx.__mypcMotion({ n: 1000, s: [sample(980), sample(990)] });          // arrives 0 ms late: page clock = sensor clock + 4000
    now = 5040; ctx.__mypcMotion({ n: 1010, s: [sample(1000), sample(1010)] });   // arrives 30 ms late: timing kept
    check(got.length === 4 && got.map((e) => e.t).join() === '4980,4990,5000,5010', 'samples keep their sensor timing on the page clock (' + got.map((e) => e.t).join() + ')');
    const e = got[0];
    check(e.acceleration.x === 0.1 && e.accelerationIncludingGravity.x === 9.9 && e.rotationRate.alpha === 10 && e.rotationRate.gamma === null, 'acceleration, with gravity and rotation rate are filled like a devicemotion event');
    ctx.removeEventListener('devicemotion', fn);
    check(calls.join() === 'true,false', 'removing the last listener stops the native sensors');
}

/* ---------------- 5. WebProxy + AI ---------------- */
console.log('5. app bridges: WebProxy and AI request formats');
{
    const store = {};
    const ctx = vm.createContext({ console, Math, JSON, Date, Uint8Array, Int16Array, ArrayBuffer, DataView, Array, Object, String, Number, Error, Promise, Set, URL, TextDecoder,
        btoa: (s) => Buffer.from(s, 'binary').toString('base64'), atob: (s) => Buffer.from(s, 'base64').toString('binary'), setTimeout, clearTimeout,
        localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } }, Blob: class {}, FormData: class { append() {} } });
    ctx.window = ctx;
    load('js/core/web-proxy.js', ctx); load('js/core/ai.js', ctx);
    const W = ctx.WebProxy, A = ctx.AI;
    check(['localhost', '127.0.0.1', '10.1.2.3', '192.168.1.1', '172.20.0.1', '169.254.1.1', 'tv.local', '[::1]', 'fd00::1'].every((h) => W.isPrivateHost(h)) &&
        !['api.openai.com', '8.8.8.8', '172.32.0.1', 'integrate.api.nvidia.com'].some((h) => W.isPrivateHost(h)), 'the local network is told apart from the internet');
    check(W.b64(new Uint8Array([1, 2, 3]).buffer) === 'AQID' && new Uint8Array(W.unb64('data:x;base64,AQID')).join() === '1,2,3', 'base64 both ways (data: URLs too)');
    const wav = new Uint8Array(W.wav(new Int16Array([1, -1]).buffer, 24000, 1));
    check(Buffer.from(wav.slice(0, 4)).toString() === 'RIFF' && wav.length === 48 && new DataView(wav.buffer).getUint32(24, true) === 24000, 'raw PCM becomes a playable .wav (Gemini speech, the microphone)');
    const n = A.normalise({ system: ['A', 'B'], rules: ['r1', 'r2'], context: { x: 1 }, examples: [{ input: 'q', output: { a: 1 } }],
        messages: [{ role: 'system', content: 'S2' }, { role: 'model', content: 'old' }], prompt: ['hi', { type: 'image', data: 'AQID', mime: 'image/png' }], output: 'json', schema: { type: 'object' } });
    check(/^A\nB\n\nRules:\n- r1\n- r2\n\nContext:\n\{"x":1\}\n\nS2\n\nReply with JSON only/.test(n.sys) && n.msgs.map((m) => m.role).join() === 'user,assistant,assistant,user' && n.msgs[1].parts[0].text === '{"a":1}' &&
        n.msgs[3].parts[1].type === 'image' && n.task === 'chat' && n.json, 'a structured prompt (system lines, rules, context, examples, roles, parts) becomes one shape');
    check(A.normalise({ prompt: 'x', output: 'image' }).task === 'image' && A.normalise({ prompt: 'x', output: 'audio' }).task === 'speech' && A.normalise({ prompt: 'x', output: ['text', 'image'] }).task === 'chat' &&
        A.normalise({ prompt: 'x', output: 'video' }).task === 'video', 'the task is guessed from the output');
    check(A.parseJson('```json\n{"a":[1]}\n```').a[0] === 1 && A.parseJson('Sure! {"b":2} hope it helps').b === 2 && A.parseJson('nope') === undefined, 'JSON answers are read even inside code fences or text');
    const nv = A.add({ preset: 'nvidia', key: 'k1' }), g = A.add({ preset: 'gemini', key: 'k2' });
    check(nv.type === 'openai' && nv.url === 'https://integrate.api.nvidia.com/v1' && A.defaultId() === 'nvidia' && A.resolve('gemini').id === 'gemini' && A.resolve('openai').id === 'nvidia' && A.resolve().id === 'nvidia' &&
        A.resolve({ type: 'anthropic', key: 'x' }).url === 'https://api.anthropic.com/v1' && A.resolve({ url: 'ftp://x' }) === null && !JSON.stringify(A.providers()).includes('k1'),
        'providers: presets (NVIDIA is OpenAI-compatible), default, by id / preset / type, an app\'s own; the list for apps has no keys');
    const pv = A.providers(), tn = pv.find((x) => x.id === 'nvidia').tasks, tg = pv.find((x) => x.id === 'gemini').tasks;
    check(tn.chat && tn.speech && !tn.transcribe && !tn.image && tn.embed && tg.speech && tg.transcribe && tg.video &&
        A.nvcfUrl('877104F7-E885-42B9-8DE8-F6E4C6303969', '/v1/audio/synthesize') === 'https://877104f7-e885-42b9-8de8-f6e4c6303969.invocation.api.nvcf.nvidia.com/v1/audio/synthesize' &&
        A.update('nvidia', { transcribeUrl: 'https://x.invocation.api.nvcf.nvidia.com/v1/asr' }).transcribeUrl !== '' && A.tasks(A.find('nvidia')).transcribe &&
        A.update('nvidia', { speechUrl: '' }).speechUrl === '' && !A.tasks(A.find('nvidia')).speech,
        'tasks per service: NVIDIA speaks through its Magpie function (editable, can be cleared), transcribes only once a function is set');
    A.remove('nvidia');
    check(A.defaultId() === 'gemini' && A.list().length === 1, 'removing the default service makes the next one the default');
}

console.log('6. GlobalSettings (settings of every My PC)');
{
    const G = load('js/core/global-settings.js', vm.createContext({ JSON, Array, String, Object, decodeURIComponent, localStorage: { getItem: () => null, setItem() {} } })).GlobalSettings;
    check(G.titleFromUrl('https://x.com/pics/blue-lake_2.jpg?w=1920') === 'Blue lake 2' && G.titleFromUrl('https://x.com/a/Sunset%20Beach.webp#x') === 'Sunset Beach' &&
        G.titleFromUrl('https://images.example.com/3f9a7c1e2b4d6f8a0c1e') === 'Images.example.com' && G.titleFromUrl('https://www.site.org/') === 'Site.org',
        'a title from the address: the file name without extension and separators, else the site');
    const c = G.clean({ wallpaper: 'u:https://a.b/1.jpg', wallpapers: [{ url: 'https://a.b/1.jpg', title: '' }, { url: 'https://a.b/1.jpg', title: 'Twice' },
        { url: 'http://a.b/2.jpg' }, { url: 'https://a.b/3.jpg', title: '  Lake ', thumb: 'javascript:alert(1)' }, { url: 'https://a.b/x".jpg' }, null] });
    check(c.wallpapers.length === 2 && c.wallpapers[0].title === '1' && c.wallpapers[1].title === 'Lake' && !c.wallpapers[1].thumb && c.wallpaper === 'u:https://a.b/1.jpg',
        'only https pictures are kept, once each, with a safe address; an empty title is filled');
    check(G.clean(null).wallpapers.length === 0 && G.clean({ wallpapers: 'x' }).wallpaper === '', 'a missing or broken document gives empty settings');
    check(JSON.stringify(G.clean({ notifyFast: ['Imad12', 'imad12', 'a', 'x..y', 'sara.k', 5, null] }).notifyFast) === '["imad12","sara.k"]' && G.clean({}).notifyFast.length === 0,
        'fast push notifications: valid usernames only, lower case, once each');
}
console.log('7. Push notification services (installer/services-lib.js)');
{
    const S = load('installer/services-lib.js', vm.createContext({ JSON, Array, String, Object, URL, Error, Math })).ServicesLib;
    const sv = S.parseServices([{ id: 'Goals', file: 'services/notify.js', every: 10, title: 'Goal alerts' }, { id: 'news', file: 'https://cdn.x.com/n.js' }], 'https://me.github.io/soccer/');
    check(sv.length === 2 && sv[0].id === 'goals' && sv[0].file === 'https://me.github.io/soccer/services/notify.js' && sv[0].every === 10 && sv[1].every === 5 && sv[1].title === 'news',
        'services of mypc-app.json: ids lowercased, files made absolute, every 5 min by default');
    const bad = (l) => { try { S.parseServices(l, 'https://me.github.io/a/'); return ''; } catch (e) { return e.message; } };
    check(/every/.test(bad([{ id: 'a', file: 'a.js', every: 3 }])) && /updates/.test(bad([{ id: 'updates', file: 'a.js' }])) && /twice/.test(bad([{ id: 'a', file: 'a.js' }, { id: 'a', file: 'b.js' }])) &&
        /https/.test(bad([{ id: 'a', file: 'http://x.com/a.js' }])) && /more than 3/.test(bad([1, 2, 3, 4].map((i) => ({ id: 'a' + i, file: 'a.js' })))) && /list/.test(bad({})),
        'bad services are refused with a readable reason (interval, reserved id, duplicates, http, too many)');
    check(S.due({}, 1e9) && !S.due({ every: 5, lastRun: 1e9 - 60000 }, 1e9) && S.due({ every: 5, lastRun: 1e9 - 300000 }, 1e9) && S.due({ every: 1, lastRun: 1e9 - 56000 }, 1e9),
        'a run is due when its interval has passed (a few seconds early is fine)');
    const now = 5e12, sent = {};
    const r = S.checkRows({ notifications: [
        { username: '*', title: 'Goal! Raja', message: '1-0', image: 'https://x.com/r.png', link: 'app?match=7' },
        { username: 'Imad12', title: 'Only you', link: 'https://news.x.com/a' },
        { username: 'stranger', title: 'Nope' }, { title: '' }, { username: 'imad12', title: 'Bad picture', image: 'http://x.com/a.png' },
        { username: 'imad12', title: 'Bad link', link: 'javascript:alert(1)' }, 'junk'], state: { last: 7 } }, ['imad12', 'sara.k'], sent, now);
    check(r.items.length === 3 && r.items.filter((x) => x.title === 'Goal! Raja').length === 2 && r.items.some((x) => x.user === 'imad12' && x.title === 'Only you') &&
        r.dropped === 5 && r.why['user did not allow notifications'] === 1 && r.state === '{"last":7}' && !r.error,
        'rows: "*" goes to every subscriber, others only to opted-in users; bad pictures, links and rows are dropped; state kept as JSON');
    check(S.okLink('soccer:match/7') && S.okLink('star-catcher:') && S.okLink('app?x=1') && S.okLink('https://a.b/c') && !S.okLink('http://a.b') && !S.okLink('javascript:alert(1)'.replace('javascript', 'Java Script')) &&
        !S.okLink('soccer:a b') && !S.okLink('x:' + 'a'.repeat(400)), 'links: <app id>:<path> deep links, app?..., https only; no spaces, not too long');
    const many = { notifications: Array.from({ length: 30 }, (_, i) => ({ username: 'imad12', title: 'n' + i })) };
    const r2 = S.checkRows(many, ['imad12'], {}, now), r3 = S.checkRows({ notifications: Array.from({ length: 150 }, (_, i) => ({ username: '*', title: 'x' + i })) }, Array.from({ length: 10 }, (_, i) => 'u' + i), {}, now);
    check(r2.items.length === 20 && r2.dropped === 10 && r3.items.length === 100, 'limits: 20 per player per hour, 100 per run');
    check(S.checkRows({ notifications: [{ username: 'a', title: 'x'.repeat(80), message: 'y'.repeat(300) }] }, ['a'], {}, now).items[0].title.length === 60 &&
        S.checkRows('oops', ['a'], {}, now).error && S.checkRows([{ username: 'a', title: 'list' }], ['a'], {}, now).items.length === 1 &&
        /bigger/.test(S.checkRows({ notifications: [], state: 'x'.repeat(20000) }, [], {}, now).error),
        'long text is cut, a bare list works, a wrong return value or a huge state is reported');
    const it = S.inboxItem(r.items[0], { id: 'soccer', name: 'Soccer Live' }, now, 'EXP');
    check(it.app === 'soccer' && it.name === 'Soccer Live' && it.title === 'Goal! Raja' && it.link === 'app?match=7' && it.at === now && it.exp === 'EXP' && S.itemId('soccer', now, 3).indexOf('soccer-') === 0,
        'an inbox document carries the app, its name, the text, the time and the expiry');
}

console.log('8. Desktop widgets (js/core/widget-lib.js), Music, Playtime');
{
    const W = load('js/core/widget-lib.js', vm.createContext({ JSON, Array, String, Object, URL, Error, Math, isFinite })).WidgetLib;
    const base = 'https://imad-os.github.io/g_stars/';
    const l = W.parseWidgets([{ id: 'Stars', title: { en: 'Stars', fr: 'Étoiles' }, file: 'widgets/stars.js', size: 'large', every: 5, background: true,
        settings: [{ id: 'goal', type: 'select', default: '9', options: [{ value: '20' }, { value: '50', label: '50 stars' }] }, { id: 'tips', label: 'Tips', type: 'toggle', default: true }, { id: 'team', type: 'text' }] }], base);
    check(l.length === 1 && l[0].id === 'stars' && l[0].file === base + 'widgets/stars.js' && l[0].size === 'large' && l[0].every === 5 && l[0].background === true &&
        l[0].title.fr === 'Étoiles' && l[0].settings[0]['default'] === '20' && l[0].settings[0].options[0].label === '20' && l[0].settings[1]['default'] === true && l[0].settings[2]['default'] === '',
        'mypc-app.json "widgets": id lowercased, file made absolute, size / every / background, settings with valid defaults');
    const d = W.parseWidgets([{ id: 'x', file: 'x.js' }], base)[0];
    check(d.size === 'medium' && d.every === 15 && d.background === false && !d.settings, 'defaults: medium, every 15 min, not in the background');
    const bad = (w, re) => { try { W.parseWidgets(w, base); return false; } catch (e) { return re.test(e.message); } };
    check(bad({}, /must be a list/) && bad([{ id: 'a b', file: 'x.js' }], /"id"/) && bad([{ id: 'a' }], /"file"/) && bad([{ id: 'a', file: 'http://x.com/a.js' }], /https/) &&
        bad([{ id: 'a', file: 'a.js', every: 7 }], /"every"/) && bad([{ id: 'a', file: 'a.js', size: 'huge' }], /"size"/) && bad([{ id: 'a', file: 'a.js' }, { id: 'a', file: 'b.js' }], /twice/) &&
        bad([1, 2, 3, 4].map((i) => ({ id: 'w' + i, file: 'a.js' })), /more than 3/) && bad([{ id: 'a', file: 'a.js', settings: [{ id: 's', type: 'select' }] }], /options/) &&
        bad([{ id: 'a', file: 'a.js', settings: [{ id: 's', type: 'slider' }] }], /type/),
        'readable errors: not a list, bad id, no file, not https, bad every / size, a repeated id, more than 3, a select without options, an unknown type');
    const kept = W.keepApprovals([{ id: 'stars', file: 'a.js' }, { id: 'new', file: 'b.js' }], [{ id: 'stars', file: 'a.js', sha: 'abc', approvedAt: 5 }]);
    check(kept[0].sha === 'abc' && kept[0].approvedAt === 5 && !kept[1].sha, 'an update of the app keeps the approval of each widget it still has; a new widget waits');
    const st = W.settingsOf(l[0].settings, { goal: '50', tips: 'yes', team: 'Raja' });
    check(st.goal === '50' && st.tips === true && st.team === 'Raja' && W.settingsOf(l[0].settings, { goal: '7' }).goal === '20', 'settings: saved values over the defaults, invalid ones fall back');
    const v = W.cleanView({ big: 21, text: '<b>x</b>'.repeat(40), icon: 'javascript:alert(1)', image: 'http://x/a.png', progress: 3, rows: [{ label: 'a', value: 1 }, 5, {}],
        buttons: [{ id: 'add', label: '+1', icon: 'play' }, { id: 'x' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }], accent: 'red', link: 'level/3', html: '<script>' });
    check(v.big === '21' && v.text.length === 160 && !v.icon && !v.image && v.progress === 1 && v.rows.length === 1 && v.rows[0].value === '1' && v.buttons.length === 2 && !v.buttons[0].icon &&
        !v.accent && v.link === 'level/3' && !v.html, 'views: numbers become text, long text cut, no script / http pictures, progress 0..1, empty rows and buttons dropped, unknown fields dropped');
    check(W.cleanView({ icon: '⭐' }).icon === '⭐' && W.cleanView({ icon: 'https://x.y/i.png' }).icon === 'https://x.y/i.png' && W.cleanView({ icon: 'i:sun' }, true).icon === 'i:sun' && !W.cleanView({ icon: 'i:sun' }).icon,
        'icons: an emoji, an https picture; a built-in icon (i:...) only for My PC\'s own widgets');
    const r = W.result({ view: { big: 'x' }, state: { n: 1 } }), r2 = W.result({ big: 'y' }), r3 = W.result('no'), r4 = W.result({ view: {}, state: 'x'.repeat(5000) });
    check(r.view.big === 'x' && r.state === '{"n":1}' && r2.view.big === 'y' && r2.state === undefined && r3.error && /bigger/.test(r4.error), 'results: { view, state } or the view itself; a huge state is refused');
    check(/import\(d\.src\)/.test(W.WORKER) && /m\.default/.test(W.WORKER) && !/localStorage|document/.test(W.WORKER), 'the Worker imports the approved code and calls its default export (no page, no storage)');
    const IL = load('installer/installer-lib.js', vm.createContext({ JSON, Array, String, Object, URL, Error, Math, isFinite, WidgetLib: W, ServicesLib: { parseServices: () => [] } })).InstallerLib;
    const app = IL.toApp({ mypc: 1, id: 'stars', name: 'Stars', widgets: [{ id: 'stars', file: 'widgets/stars.js' }] }, base, 0);
    check(app.widgets && app.widgets[0].file === base + 'widgets/stars.js' && IL.status([Object.assign({}, app, { widgets: [Object.assign({ sha: 'x' }, app.widgets[0])] })], app) === 'installed' &&
        IL.status([Object.assign({}, app, { widgets: [] })], app) === 'update', 'the App Store Manager reads "widgets"; an approval alone is not an update, a new widget is');
    const ex = JSON.parse(fs.readFileSync(path.join(ROOT, 'sdk/example/mypc-app.json'), 'utf8'));
    check(W.parseWidgets(ex.widgets, base).length === 1, 'the example app\'s widget (sdk/example) is valid');

    // Playtime, with a fake clock and storage
    let now = 1000000, mem = {};
    const store = { get: (k, def) => (k in mem ? JSON.parse(mem[k]) : def), set: (k, v) => { mem[k] = JSON.stringify(v); return true; } };
    const RealDate = Date;
    function FakeDate(...a) { return a.length ? new RealDate(...a) : new RealDate(now); }
    FakeDate.now = () => now;
    let hidden = false, state = 'running', iv = null;
    const doc = { get hidden() { return hidden; } };
    const pc = load('js/core/playtime.js', vm.createContext({ Store: store, Date: FakeDate, Math, JSON, Object, Array, String, document: doc, GameHost: { state: () => state },
        setInterval: (f) => { iv = f; return 1; }, clearInterval: () => { iv = null; }, window: { addEventListener() {}, removeEventListener() {} } }));
    const P = pc.Playtime;
    P.start('blocks', 'Block Drop');
    now += 60000; iv();
    state = 'paused'; now += 60000; iv();
    state = 'running'; hidden = true; now += 60000; iv();
    hidden = false; now += 3600000; iv();               // a TV that slept: at most one minute and a bit
    now += 30000; P.stop();
    const sm = P.summary();
    check(sm.today === 60 + 65 + 30 && sm.top.id === 'blocks' && sm.top.t === 'Block Drop' && sm.week === sm.today && !iv, 'Playtime counts only while the game runs and My PC is on screen, a long gap adds at most one tick');
    check(P.length(3725, 'h', 'min') === '1 h 02 min' && P.length(59, 'h', 'min') === '0 min', 'Playtime text: 1 h 02 min');
    // Playtime app stats: sessions, longest session, 7 / 30 days, streak, the week before
    const g0 = JSON.parse(mem.playtime).games.blocks;
    check(g0.n === 1 && g0.best === 155 && g0.first > 0, 'Playtime counts one session and its length: ' + JSON.stringify(g0));
    P.start('snake', 'Snake'); now += 60000; iv(); P.stop();
    P.start('snake', 'Snake'); now += 60000; iv(); now += 60000; iv(); P.stop();
    const pst = P.stats(7);
    check(pst.games.length === 2 && pst.games[0].id === 'snake' && pst.games[0].n === 2 && pst.games[0].best === 120 && pst.all === 155 + 180 &&
        pst.days.length === 7 && pst.days[6].s === 335 && pst.today === 335 && pst.streak === 1 && pst.played === 1 && pst.best.s === 335,
        'Playtime stats: most played first, sessions, longest, today is the last day: ' + JSON.stringify(pst).slice(0, 300));
    const pd = JSON.parse(mem.playtime), today = new RealDate(now), ago = (n) => { const d = new RealDate(today.getTime()); d.setDate(d.getDate() - n); return P.day(d); };
    pd.days[ago(1)] = 600; pd.days[ago(2)] = 300; pd.days[ago(4)] = 900; pd.days[ago(9)] = 1200; pd.days[ago(200)] = 50;
    mem.playtime = JSON.stringify(pd);
    const s30 = P.stats(30), s7 = P.stats(7);
    check(s7.streak === 3 && s7.week === 335 + 600 + 300 + 900 && s7.prevWeek === 1200 && s30.days.length === 30 && s30.played === 5 && s30.total === s7.week + 1200,
        'Playtime: streak (days in a row), this week against the week before, 30 days');
    P.clear();
    check(P.stats(7).games.length === 0 && P.stats(7).total === 0 && P.summary().today === 0, 'Clear my playtime starts over');
}

console.log('Music: song details read from the files (js/core/music-tags.js)');
{
    const F = await import('./music-fixtures.mjs');
    const T = load('js/core/music-tags.js', vm.createContext({ TextDecoder, Uint8Array, String, Math, parseInt, Object, escape, decodeURIComponent })).MusicTags;
    const pic = F.png(8, 8);
    const same = (a, b) => a && a.length === b.length && a.every((x, i) => x === b[i]);
    let r = T.parse(F.mp3({ title: 'Morning Rain', artist: 'Lina K', album: 'Blue Hours', track: 3, pic }), 0, true);
    check(r.title === 'Morning Rain' && r.artist === 'Lina K' && r.album === 'Blue Hours' && r.track === 3 && r.pic && r.pic.mime === 'image/png' && same(r.pic.data, pic),
        'ID3v2.3: title, artist, album, track number and the cover picture');
    r = T.parse(F.mp3({ title: 'Été à Fès', artist: 'Café', v4: true, pic }), 0, true);
    check(r.title === 'Été à Fès' && r.artist === 'Café' && same(r.pic.data, pic), 'ID3v2.4: synchsafe sizes and UTF-8 text');
    r = T.parse(F.mp3({ title: 'Wide', utf16: true }), 0, false);
    check(r.title === 'Wide', 'ID3v2.3 UTF-16 text');
    const bigPic = new Uint8Array(300000); bigPic.set(pic);
    const big = F.mp3({ title: 'Long Tag', artist: 'X', pic: bigPic, pad: 2000 });
    r = T.parse(big.subarray(0, T.HEAD), big.length, true);
    check(r.title === 'Long Tag' && !r.pic && r.more === big.length - 4096, 'only the head read: the text is there, more: says how much to read for the picture (' + r.more + ')');
    check(T.parse(big.subarray(0, T.HEAD), big.length, false).more === undefined, 'no picture wanted: nothing more to read');
    r = T.parse(F.flac({ title: 'Sand', artist: 'Dunes', album: 'Desert', seconds: 200, pic }), 0, true);
    check(r.title === 'Sand' && r.artist === 'Dunes' && r.album === 'Desert' && Math.round(r.dur) === 200 && same(r.pic.data, pic), 'FLAC: Vorbis comments, length from STREAMINFO, PICTURE block');
    const m = F.m4a({ title: 'Harbor', artist: 'Gulls', album: 'Coast', seconds: 185, pic });
    r = T.parse(m.subarray(0, T.HEAD), m.length, true);
    check(r.at > 200000 && r.len > 0 && !r.title, 'M4A with moov after the sound: tells where to read (' + r.at + ')');
    const r2 = T.parseMp4(m.subarray(r.at, r.at + r.len), {});
    check(r2.title === 'Harbor' && r2.artist === 'Gulls' && r2.album === 'Coast' && Math.round(r2.dur) === 185 && same(r2.pic.data, pic), 'M4A: ilst atoms, length from mvhd, covr picture');
    r = T.parse(F.m4a({ title: 'Early', moovLast: false }), 0, false);
    check(r.title === 'Early', 'M4A with moov first: read at once');
    const w = F.wav({ title: 'Tone', artist: 'Lab', seconds: 2 });
    r = T.parse(w, w.length, false);
    check(r.title === 'Tone' && r.artist === 'Lab' && Math.round(r.dur) === 2, 'WAV: LIST INFO and the length');
    check(T.parse(new Uint8Array(40), 0, true).title === undefined, 'unknown bytes: no details, no error');
    const n1 = T.fromName('03 - Nass El Ghiwane - Mahmouma.mp3'), n2 = T.fromName('track_07.flac');
    check(n1.track === 3 && n1.artist === 'Nass El Ghiwane' && n1.title === 'Mahmouma' && n2.title === 'track 07', 'a title and an artist from the file name when the file has none');
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall unit checks passed');
process.exit(failures ? 1 : 0);
