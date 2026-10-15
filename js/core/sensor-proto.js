/* Phone controller protocol, version 1 (docs: docs/phone-controller.md). Shared by the phone (Game controller app,
 * js/launcher/apps/gamepad.js), the TV (js/launcher/controllers.js) and the unit tests (tests/unit-tests.mjs).
 * Transport: the WebRTC data channel the phone controller already uses (js/core/netlink.js: JSON, ordered, reliable,
 * 4 KB and 100 messages a second at most each way). The pad mode keeps its short { t: 'k' } messages; the sensor modes add:
 *   phone -> TV  { t: 'hi', p, cid, name, proto: 1, mode, session, caps, now }          once, when the link opens
 *   TV -> phone  { t: 'ok', p, proto: 1, session }                                       then a config at once
 *   TV -> phone  { type: 'config', v: 1, session, sequence, timestamp, moves, define?, profile, metrics, raw }
 *   phone -> TV  { type: 'action', action, timestamp, sequence, confidence? }            only moves the config asked for
 *   TV -> phone  { type: 'ack', sequence, duplicate?, stale? }                           for every action (latency, duplicates)
 *   phone -> TV  { type: 'metrics', gait, cadence, speed_kmh, pace_sec_per_km, distance_m, steps, timestamp, sequence }  only if asked, at metrics.hz
 *   phone -> TV  { type: 'raw', timestamp, sequence, hz, s: [[dt, ax, ay, az, gx, gy, gz, ra, rb, rg], ...] }   sensor-raw mode only
 *   phone -> TV  { t: 'pm', x, y } | { t: 'pc' }      sensor-raw mode while config.pointer: the phone points at the TV (pointer
 *                                                     moved by x, y hundredths of a degree; 'pc' = back to the centre)
 * Every message is checked with the functions below; anything else is dropped. */
var SensorProto = (function () {
    'use strict';

    var VERSION = 1;
    var MODES = ['pad', 'sensor-actions', 'sensor-raw'];
    var POSITIONS = ['waist', 'left arm', 'right arm', 'left hand', 'right hand'];
    var READY_POSITIONS = ['right hand'];                 // the others are accepted and fall back to right hand for now
    var GAITS = ['IDLE', 'WALK', 'RUN'];
    var DEFAULT_MOVES = ['LEFT', 'RIGHT', 'JUMP', 'DUCK', 'DUCK_END'];
    var NAME = /^[A-Z][A-Z0-9_]{0,23}$/;
    var SIGNALS = ['vertical', 'lateral', 'forward', 'magnitude', 'v_vel', 'v_disp', 'l_vel', 'freefall', 'pitch', 'roll', 'rot'];
    var MAX_MOVES = 16, RAW_MAX = 12, SEQ_WINDOW = 64, STALE_MS = 3000;

    function isNum(v) { return typeof v === 'number' && isFinite(v); }
    function num(v, lo, hi, def) { v = +v; return isFinite(v) && v >= lo && v <= hi ? v : def; }
    function session() {
        var s = '', b = new Uint8Array(8), i;
        try { crypto.getRandomValues(b); } catch (e) { for (i = 0; i < 8; i++) b[i] = Math.floor(Math.random() * 256); }
        for (i = 0; i < 8; i++) s += ('0' + b[i].toString(16)).slice(-2);
        return s;
    }
    function isSession(s) { return typeof s === 'string' && /^[a-z0-9]{4,32}$/.test(s); }

    // one detection rule (see MotionEngine.MOVES for the built-in ones); null when it is not usable
    function rule(r, depth) {
        if (!r || typeof r !== 'object' || SIGNALS.indexOf(r.signal) < 0) return null;
        var o = { signal: r.signal };
        if (isNum(r.above)) o.above = r.above; else if (isNum(r.below)) o.below = r.below; else return null;
        o.for_ms = num(r.for_ms, 0, 2000, 0);
        o.cooldown_ms = num(r.cooldown_ms, 0, 5000, 500);
        if (typeof r.group === 'string' && /^[a-z0-9_]{1,16}$/.test(r.group)) o.group = r.group;
        if (r.gait instanceof Array) { o.gait = r.gait.filter(function (g) { return GAITS.indexOf(g) >= 0; }); if (!o.gait.length) delete o.gait; }
        if (r.also && !depth) { o.also = rule({ signal: r.also.signal, above: r.also.above, below: r.also.below }, 1); if (!o.also) delete o.also; }
        if (r.unless && !depth && typeof r.unless === 'object') {
            var u = { moves: (r.unless.moves instanceof Array ? r.unless.moves : []).filter(function (m) { return NAME.test(m); }).slice(0, 8),
                      within_ms: num(r.unless.within_ms, 0, 5000, 0), landed_ms: num(r.unless.landed_ms, 0, 2000, 0) };
            if (u.moves.length || u.landed_ms) o.unless = u;
        }
        if (r.end && !depth && typeof r.end === 'object' && NAME.test(r.end.name || '')) {
            var e = rule(r.end, 1);
            if (e) { e.name = r.end.name; e.min_ms = num(r.end.min_ms, 0, 5000, 0); e.max_ms = num(r.end.max_ms, 0, 10000, 3000); o.end = e; }
        }
        return o;
    }

    function profile(p) {
        p = p && typeof p === 'object' ? p : {};
        var pos = POSITIONS.indexOf(p.phone_position) >= 0 ? p.phone_position : 'right hand';
        return { age: Math.round(num(p.age, 4, 110, 30)), height: num(p.height, 80, 250, 170), weight: num(p.weight, 15, 300, 70), phone_position: pos };
    }

    // TV -> phone. Unknown moves are kept only when `define` says how to detect them.
    function config(c, builtins) {
        if (!c || typeof c !== 'object' || (c.type !== undefined && c.type !== 'config')) return null;
        var out = { type: 'config', v: VERSION, session: isSession(c.session) ? c.session : '', sequence: Math.max(0, Math.floor(num(c.sequence, 0, 1e12, 0))), timestamp: num(c.timestamp, 0, 1e15, 0) || Date.now() };
        var def = {}, moves = [], i, n;
        if (c.define && typeof c.define === 'object') for (n in c.define) if (c.define.hasOwnProperty(n) && NAME.test(n)) { var r = rule(c.define[n]); if (r) def[n] = r; }
        var want = c.moves instanceof Array ? c.moves : DEFAULT_MOVES;
        for (i = 0; i < want.length && moves.length < MAX_MOVES; i++) {
            n = want[i];
            if (typeof n !== 'string' || !NAME.test(n) || moves.indexOf(n) >= 0) continue;
            if (def[n] || !builtins || builtins[n] || isEndOf(n, def, builtins)) moves.push(n);
        }
        out.moves = moves;
        if (Object.keys(def).length) out.define = def;
        out.profile = c.profile && typeof c.profile === 'object' ? profile(c.profile) : null;      // null: the phone uses its own settings
        var m = c.metrics && typeof c.metrics === 'object' ? c.metrics : null;
        out.metrics = { enabled: !!(m && m.enabled !== false), hz: num(m && m.hz, 0.2, 5, 1) };
        var raw = c.raw && typeof c.raw === 'object' ? c.raw : null;
        out.raw = { hz: Math.round(num(raw && raw.hz, 5, 100, 30)) };
        out.pointer = c.pointer === true;           // set by the TV only (no app asked for sensors): Motion data phones point
        return out;
    }
    function isEndOf(n, def, builtins) {
        var k, all = [def, builtins || {}], j;
        for (j = 0; j < all.length; j++) for (k in all[j]) if (all[j].hasOwnProperty(k) && all[j][k] && all[j][k].end && all[j][k].end.name === n) return true;
        return false;
    }

    function hello(m) {
        if (!m || m.t !== 'hi') return null;
        return { proto: m.proto === VERSION ? VERSION : 0, now: isNum(m.now) ? m.now : 0, mode: MODES.indexOf(m.mode) >= 0 ? m.mode : 'pad', session: isSession(m.session) ? m.session : '',
                 caps: { motion: !!(m.caps && m.caps.motion), orientation: !!(m.caps && m.caps.orientation) } };
    }
    // phone -> TV, the sensor messages
    function action(m) {
        if (!m || m.type !== 'action' || typeof m.action !== 'string' || !NAME.test(m.action) || !isNum(m.sequence) || m.sequence < 0 || !isNum(m.timestamp)) return null;
        var o = { type: 'action', action: m.action, timestamp: m.timestamp, sequence: Math.floor(m.sequence) };
        if (isNum(m.confidence)) o.confidence = Math.max(0, Math.min(1, m.confidence));
        return o;
    }
    function metrics(m) {
        if (!m || m.type !== 'metrics' || GAITS.indexOf(m.gait) < 0 || !isNum(m.sequence)) return null;
        return { type: 'metrics', gait: m.gait, cadence: Math.round(num(m.cadence, 0, 300, 0)), speed_kmh: +num(m.speed_kmh, 0, 45, 0).toFixed(1),
                 pace_sec_per_km: Math.round(num(m.pace_sec_per_km, 0, 3600, 0)), distance_m: +num(m.distance_m, 0, 1e6, 0).toFixed(1),
                 steps: Math.round(num(m.steps, 0, 1e7, 0)), timestamp: num(m.timestamp, 0, 1e15, 0), sequence: Math.floor(m.sequence) };
    }
    function raw(m) {
        if (!m || m.type !== 'raw' || !isNum(m.sequence) || !(m.s instanceof Array) || !m.s.length || m.s.length > RAW_MAX) return null;
        for (var i = 0; i < m.s.length; i++) {
            var r = m.s[i];
            if (!(r instanceof Array) || r.length !== 10) return null;
            for (var j = 0; j < 10; j++) if (r[j] !== null && !isNum(r[j])) return null;
        }
        return { type: 'raw', timestamp: num(m.timestamp, 0, 1e15, 0), sequence: Math.floor(m.sequence), hz: Math.round(num(m.hz, 1, 100, 30)), s: m.s };
    }
    // the pointer: how far the phone turned since its last message (hundredths of a degree, 90 degrees at most)
    function aim(m) {
        if (!m) return null;
        if (m.t === 'pc') return { t: 'pc' };
        if (m.t !== 'pm' || !isNum(m.x) || !isNum(m.y) || Math.abs(m.x) > 9000 || Math.abs(m.y) > 9000) return null;
        return { t: 'pm', x: Math.round(m.x), y: Math.round(m.y) };
    }
    function ack(m) { return m && m.type === 'ack' && isNum(m.sequence) ? { type: 'ack', sequence: m.sequence, duplicate: !!m.duplicate, stale: !!m.stale } : null; }

    // sequence numbers per stream: 'ok' | 'duplicate' (seen already) | 'stale' (older than the window or too old a timestamp)
    function tracker() {
        var seen = {}, order = [], top = -1;
        return {
            // offset = TV clock - phone clock (from the hello), so a phone timestamp can be read on the TV's clock
            check: function (seq, ts, offset) {
                if (seen[seq]) return 'duplicate';
                if (seq < top - SEQ_WINDOW) return 'stale';
                if (isNum(ts) && ts > 0 && isNum(offset) && Date.now() - (ts + offset) > STALE_MS) return 'stale';
                seen[seq] = 1; order.push(seq); if (order.length > SEQ_WINDOW * 2) delete seen[order.shift()];
                if (seq > top) top = seq;
                return 'ok';
            },
            reset: function () { seen = {}; order = []; top = -1; }
        };
    }

    var api = { VERSION: VERSION, MODES: MODES, POSITIONS: POSITIONS, READY_POSITIONS: READY_POSITIONS, GAITS: GAITS, DEFAULT_MOVES: DEFAULT_MOVES, SIGNALS: SIGNALS, STALE_MS: STALE_MS,
                session: session, rule: rule, profile: profile, config: config, hello: hello, action: action, metrics: metrics, raw: raw, aim: aim, ack: ack, tracker: tracker };
    return api;
})();
if (typeof module !== 'undefined' && module.exports) module.exports = SensorProto;
