/* Pointing with the phone, like a TV "magic remote" (phone controller, Pointer mode): the phone turns, the TV pointer
 * (js/launcher/pointer.js) moves by that much. Pure logic, no DOM (tests/unit-tests.mjs feeds it synthetic samples).
 * Docs: docs/phone-controller.md.
 *
 * Steps, for every sensor sample:
 *   1. gyroscope bias: while the phone lies or is held still, the gyroscope's small offset is learnt and removed (no drift)
 *   2. "up": gravity from the accelerometer, kept by the gyroscope (complementary filter). A shake (the accelerometer far
 *      from 1 g) is not used for it, so shaking the phone does not tilt the axes.
 *   3. the pointing axis: the top of the screen's picture when the screen faces up (held like a remote), the back of the
 *      phone when the screen faces the player (held like a camera). Turning around "up" = left / right; turning around the
 *      horizontal axis across it = up / down. A twist of the wrist around the pointing axis is ignored. Moving the phone
 *      without turning it (a shake, walking) does not move the pointer: only rotation counts.
 *   4. steady zone: slow tremor is scaled down smoothly (v² / (v² + steady²)), so a hand held still does not move it and
 *      slow, intended moves still do
 *   5. smoothing that adapts to the speed ("1 euro" filter on the position): strong while slow (precise), light while fast
 *      (little lag on big moves), stronger for a moment while the phone shakes; the pointer always ends where the phone points
 *   6. a click (hold()): the pointer stops where it is shown and the movement is ignored for a moment, so pressing the button
 *      does not move it
 *
 *   var a = Aim.create({ smooth: 1..10, steady: 0..6 (deg/s), swapX, swapY })     a.set({ ... })
 *   a.feed({ t, gx, gy, gz, ra, rb, rg, angle })   t ms, g* = acceleration with gravity (m/s²), r* = rotation rate (deg/s; null:
 *                                                   no gyro), angle = screen orientation angle (0 / 90 / 180 / 270)
 *   a.take(gain) -> [dx, dy] in hundredths of a degree turned since the last take (right / down positive), or null if none
 *   a.hold(ms)   a.reset()   a.turned() -> { x, y } degrees turned in total, before swapping (for calibration)   a.still() */
var Aim = (function () {
    'use strict';

    var D2R = Math.PI / 180, G = 9.81, MAX = 600;

    function create(opt) {
        var o = { smooth: 5, steady: 1.5, swapX: false, swapY: false };
        var last, top, ax, ay, fx, fy, px2, py2, spd, up, bias, stillMs, avg, holdUntil, holdMs = 0, shakeT, totX, totY;
        function lp(cut, dt) { return 1 / (1 + 1 / (2 * Math.PI * cut * dt)); }      // low-pass weight for a cut-off in Hz
        function set(p) {
            p = p || {};
            if (p.smooth > 0) o.smooth = Math.max(1, Math.min(10, +p.smooth));
            if (p.steady >= 0) o.steady = Math.max(0, Math.min(6, +p.steady));
            if (p.swapX !== undefined) o.swapX = !!p.swapX;
            if (p.swapY !== undefined) o.swapY = !!p.swapY;
        }
        function reset() {
            last = -1; top = true; ax = ay = 0; fx = fy = px2 = py2 = spd = 0; up = null; stillMs = 0; holdUntil = -1; holdMs = 0; shakeT = -1; totX = totY = 0;
            avg = [0, 0, 0];
            if (!bias) bias = [0, 0, 0];
        }
        // the screen picture's "up" in device axes, from the screen orientation angle
        function contentUp(angle) {
            var a = ((Math.round((angle || 0) / 90) % 4) + 4) % 4;
            return a === 1 ? [1, 0, 0] : a === 2 ? [0, -1, 0] : a === 3 ? [-1, 0, 0] : [0, 1, 0];
        }
        function feed(s) {
            var t = s.t, dt = last >= 0 ? Math.min(100, Math.max(0, t - last)) / 1000 : 0;
            last = t;
            if (s.ra === null || s.ra === undefined || s.gx === null || s.gx === undefined) return false;
            var gx = s.gx, gy = s.gy, gz = s.gz, n = Math.sqrt(gx * gx + gy * gy + gz * gz);
            var w = [s.rb, s.rg, s.ra];                                   // rotation rate around the device x, y, z axes (deg/s)
            if (!up) { if (n < 4) return false; up = [gx / n, gy / n, gz / n]; return true; }
            if (!dt) return true;
            var ms = dt * 1000, shake = Math.abs(n - G) > 2.2;
            if (shake) shakeT = t;
            // 1. bias: learnt while still (rotation below 2.5 deg/s, no shake) for half a second, slowly
            var wx = w[0] - bias[0], wy = w[1] - bias[1], wz = w[2] - bias[2], rot = Math.sqrt(wx * wx + wy * wy + wz * wz);
            if (rot < 2.5 && Math.abs(n - G) < 0.6) {
                stillMs += ms;
                for (var i = 0; i < 3; i++) avg[i] += (w[i] - avg[i]) * Math.min(1, dt / 0.3);
                if (stillMs > 500) for (i = 0; i < 3; i++) bias[i] += (avg[i] - bias[i]) * Math.min(1, dt / 3);
            } else stillMs = 0;
            // 2. up: turned with the gyroscope (a world vector seen from the phone turns by -w), pulled towards gravity
            var rx = wx * D2R * dt, ry = wy * D2R * dt, rz = wz * D2R * dt, u = up;
            var ux = u[0] - (ry * u[2] - rz * u[1]), uy = u[1] - (rz * u[0] - rx * u[2]), uz = u[2] - (rx * u[1] - ry * u[0]);
            if (!shake && n > 4) { var k = Math.min(1, dt / 0.5); ux += (gx / n - ux) * k; uy += (gy / n - uy) * k; uz += (gz / n - uz) * k; }
            var un = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
            ux /= un; uy /= un; uz /= un; up = [ux, uy, uz];
            // 3. yaw around up, pitch around the horizontal axis across the pointing axis
            var yaw = wx * ux + wy * uy + wz * uz;
            if (top && Math.abs(uz) < 0.45) top = false; else if (!top && Math.abs(uz) > 0.6) top = true;
            var f = top ? contentUp(s.angle) : [0, 0, -1], fd = f[0] * ux + f[1] * uy + f[2] * uz;
            var px = f[0] - fd * ux, py = f[1] - fd * uy, pz = f[2] - fd * uz, pn = Math.sqrt(px * px + py * py + pz * pz), pitch = 0;
            if (pn > 0.2) { px /= pn; py /= pn; pz /= pn; pitch = wx * (py * uz - pz * uy) + wy * (pz * ux - px * uz) + wz * (px * uy - py * ux); }
            var vx = -yaw, vy = -pitch;
            totX += vx * dt; totY += vy * dt;
            // 4. steady zone, smoothly
            var v2 = vx * vx + vy * vy, st = o.steady * o.steady, sc = v2 + st > 0 ? v2 / (v2 + st) : 1;
            vx *= sc; vy *= sc;
            var v = Math.sqrt(vx * vx + vy * vy);
            if (v > MAX) { vx *= MAX / v; vy *= MAX / v; v = MAX; }
            // 6. right after a click: nothing moves
            if (holdMs) { holdUntil = t + holdMs; holdMs = 0; }             // counted from the first sample after the click
            if (holdUntil >= 0 && t < holdUntil) return true;
            // 5. speed-adaptive smoothing of the position (a "1 euro" filter): the cut-off rises with the (smoothed) speed, lower
            //    for a moment after a shake. The smoothed position always ends where the phone points: nothing is lost or added.
            px2 += (o.swapX ? -vx : vx) * dt; py2 += (o.swapY ? -vy : vy) * dt;
            spd += (v - spd) * lp(1, dt);
            var cut = 6 / o.smooth + 0.08 * spd;
            if (shakeT >= 0 && t - shakeT < 250) cut *= 0.4;
            var al = lp(cut, dt), qx = (px2 - fx) * al, qy = (py2 - fy) * al;
            fx += qx; fy += qy; ax += qx; ay += qy;
            return true;
        }
        function take(gain) {
            var g = gain > 0 ? gain : 1, x = Math.round(ax * g * 100), y = Math.round(ay * g * 100);
            ax -= x / g / 100; ay -= y / g / 100;
            return x || y ? [x, y] : null;
        }
        set(opt); reset();
        return {
            feed: feed, take: take, set: set,
            reset: function () { var b = bias; reset(); bias = b; },
            // a click: the pointer stops where it is shown (the smoothing's remaining catch-up is dropped) and holds still a moment
            hold: function (ms) { holdMs = ms; px2 = fx; py2 = fy; spd = 0; },
            turned: function () { return { x: totX, y: totY }; },
            still: function () { return stillMs > 500; },
            options: function () { return { smooth: o.smooth, steady: o.steady, swapX: o.swapX, swapY: o.swapY }; }
        };
    }

    return { create: create };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Aim;
