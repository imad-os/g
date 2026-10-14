/* Move trainer of the phone controller (Train tab of the Game controller, js/launcher/apps/gamepad.js): the player does each
 * move a few times, and the limits of the detection rules (js/core/motion.js) are set from what this player's moves actually
 * look like, so that each move passes its own limit and the other moves stay clear of it. Pure logic, no DOM
 * (tests/unit-tests.mjs).
 *
 *   MotionTrain.measure(samples, fromT) -> { lateral: [min, max], freefall: [min, max], ... }   one repetition: the samples
 *                     (with a second before the move, so gravity is known) run through a fresh engine; extremes from fromT on
 *   MotionTrain.tune({ LEFT: [measure, ...], JUMP: [...] }) -> { define: { LEFT: rule, ... }, report: [...] }
 *                     define goes to MotionEngine configure() like a game's own rules; report says what was found per move:
 *                     { move, reps, own: [weakest, strongest], others: strongest other move, limit, was, clear, overlaps: [moves] }
 */
var MotionTrain = (function () {
    'use strict';

    var WATCH = ['lateral', 'vertical', 'forward', 'magnitude', 'freefall', 'v_vel', 'v_disp', 'l_vel', 'rot'];
    var MIN_REPS = 3;
    // a trained limit stays within these factors of the built-in one, so one odd recording cannot switch a move off
    var LOW = 0.4, HIGH = 2.5;

    function measure(samples, fromT) {
        var eng = MotionEngine.create({ moves: [] }), out = {}, i, k, s;
        for (k = 0; k < WATCH.length; k++) out[WATCH[k]] = [Infinity, -Infinity];
        for (i = 0; i < samples.length; i++) {
            eng.feed(samples[i]);
            if (samples[i].t < fromT) continue;
            s = eng.signals();
            for (k = 0; k < WATCH.length; k++) {
                var v = s[WATCH[k]];
                if (typeof v !== 'number' || !isFinite(v)) continue;
                if (v < out[WATCH[k]][0]) out[WATCH[k]][0] = v;
                if (v > out[WATCH[k]][1]) out[WATCH[k]][1] = v;
            }
        }
        for (k = 0; k < WATCH.length; k++) if (!isFinite(out[WATCH[k]][0])) out[WATCH[k]] = [0, 0];
        return out;
    }

    function r2(v) { return Math.round(v * 100) / 100; }
    function copy(o) { return JSON.parse(JSON.stringify(o)); }
    // the value of a repetition that matters for a condition: its highest for `above`, its lowest for `below`
    function peak(m, cond) { var e = m[cond.signal] || [0, 0]; return cond.above !== undefined ? e[1] : e[0]; }
    function passes(v, cond, lim) { return cond.above !== undefined ? v > lim : v < lim; }

    // a limit for one condition, from this move's weakest repetition and the strongest of the other moves
    function limit(cond, own, others) {
        var up = cond.above !== undefined, was = up ? cond.above : cond.below;
        var weak = up ? Math.min.apply(null, own) : Math.max.apply(null, own);
        var strong = others.length ? (up ? Math.max.apply(null, others) : Math.min.apply(null, others)) : null;
        var clear = strong === null || (up ? weak > strong : weak < strong);
        // 70 % of the weakest repetition; when the other moves are further away than that, halfway to them, never closer
        var lim = weak * 0.7;
        if (strong !== null && clear) { var mid = (weak + strong) / 2; lim = up ? Math.max(lim, mid) : Math.min(lim, mid); }
        var lo = was * LOW, hi = was * HIGH;                    // same sign as `was`
        if (Math.abs(lim) < Math.abs(lo)) lim = lo;
        if (Math.abs(lim) > Math.abs(hi)) lim = hi;
        if (up !== (was > 0) && was !== 0) lim = was;           // never flip a limit's side of zero
        return { lim: r2(lim), was: was, weak: r2(weak), strong: strong === null ? null : r2(strong), clear: clear };
    }

    function tune(train) {
        var define = {}, report = [], names = Object.keys(train || {}), i, j;
        for (i = 0; i < names.length; i++) {
            var name = names[i], reps = train[name] || [], base = MotionEngine.MOVES[name];
            if (!base || reps.length < MIN_REPS) continue;
            var rule = copy(base), own = [], others = [], overlaps = [];
            for (j = 0; j < reps.length; j++) own.push(peak(reps[j], base));
            // moves of the same group (LEFT / RIGHT: the rebound of a step) already block each other, so they are not compared
            var rivals = names.filter(function (n) { var b = MotionEngine.MOVES[n]; return n !== name && !(b && base.group && b.group === base.group); });
            for (j = 0; j < rivals.length; j++) {
                (train[rivals[j]] || []).forEach(function (m) { others.push(peak(m, base)); });
            }
            var L = limit(base, own, others);
            if (base.above !== undefined) rule.above = L.lim; else rule.below = L.lim;
            for (j = 0; j < rivals.length; j++) {
                if ((train[rivals[j]] || []).some(function (m) { return passes(peak(m, base), base, L.lim); })) overlaps.push(rivals[j]);
            }
            // the second condition (sideways speed of LEFT / RIGHT): only made easier, from 70 % of the weakest repetition
            if (base.also) {
                var also = [];
                for (j = 0; j < reps.length; j++) also.push(peak(reps[j], base.also));
                var A = limit(base.also, also, []), cur = base.also.above !== undefined ? base.also.above : base.also.below;
                if (Math.abs(A.lim) < Math.abs(cur)) { if (base.also.above !== undefined) rule.also.above = A.lim; else rule.also.below = A.lim; }
            }
            define[name] = rule;
            report.push({ move: name, signal: base.signal, reps: reps.length, own: [L.weak, r2(base.above !== undefined ? Math.max.apply(null, own) : Math.min.apply(null, own))],
                          others: L.strong, limit: L.lim, was: L.was, clear: L.clear && !overlaps.length, overlaps: overlaps });
        }
        return { define: define, report: report };
    }

    return { measure: measure, tune: tune, MIN_REPS: MIN_REPS, WATCH: WATCH };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = MotionTrain;
