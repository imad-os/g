/* Pointing with the phone, like a TV "magic remote" (phone controller, Motion data mode on the My PC screens): the gyroscope
 * says how far the phone turned, the TV moves its pointer (js/launcher/pointer.js) by that much. Pure logic, no DOM
 * (tests/unit-tests.mjs feeds it synthetic samples). Docs: docs/phone-controller.md.
 *
 * Works in any grip. "Up" is gravity; the phone points with its top edge when the screen faces up (held like a remote), with
 * its back when the screen faces the player (held like a camera or a game). Turning around "up" moves the pointer left /
 * right, tilting the pointing edge up / down moves it up / down.
 *
 *   var a = Aim.create()
 *   a.feed({ t, gx, gy, gz, ra, rb, rg })   t ms, g* = acceleration with gravity (m/s²), r* = rotation rate (deg/s; null: no gyro)
 *   a.take(gain) -> [dx, dy] in hundredths of a degree turned since the last take (right / down positive), or null if none */
var Aim = (function () {
    'use strict';

    var STILL = 0.8;                    // deg/s: below this the hand is holding still (gyro noise, tremor): no movement

    function create() {
        var last = -1, top = true, ax = 0, ay = 0;
        function feed(s) {
            var t = s.t, dt = last >= 0 ? Math.min(100, Math.max(0, t - last)) / 1000 : 0;
            last = t;
            if (s.ra === null || s.ra === undefined || s.gx === null || s.gx === undefined) return false;
            var n = Math.sqrt(s.gx * s.gx + s.gy * s.gy + s.gz * s.gz);
            if (n < 4 || !dt) return false;                      // thrown or falling: gravity is not readable
            var ux = s.gx / n, uy = s.gy / n, uz = s.gz / n;
            var wx = s.rb, wy = s.rg, wz = s.ra;                 // rotation rate around the device x, y, z axes
            var yaw = wx * ux + wy * uy + wz * uz;               // turning around "up" (left is positive)
            // the pointing axis: top edge (+y) when the screen faces up, else the back (-z); a little hysteresis between them
            if (top && Math.abs(uz) < 0.45) top = false; else if (!top && Math.abs(uz) > 0.6) top = true;
            var fx = 0, fy = top ? 1 : 0, fz = top ? 0 : -1, d = fx * ux + fy * uy + fz * uz;
            fx -= d * ux; fy -= d * uy; fz -= d * uz;            // flattened onto the floor
            var fn = Math.sqrt(fx * fx + fy * fy + fz * fz), pitch = 0;
            if (fn > 0.2) {
                fx /= fn; fy /= fn; fz /= fn;
                pitch = wx * (fy * uz - fz * uy) + wy * (fz * ux - fx * uz) + wz * (fx * uy - fy * ux);   // around right = forward x up
            }
            if (yaw * yaw + pitch * pitch < STILL * STILL) return true;
            ax -= yaw * dt; ay -= pitch * dt;
            return true;
        }
        function take(gain) {
            var g = gain > 0 ? gain : 1, x = Math.round(ax * g * 100), y = Math.round(ay * g * 100);
            ax -= x / g / 100; ay -= y / g / 100;
            return x || y ? [x, y] : null;
        }
        return { feed: feed, take: take, reset: function () { last = -1; ax = ay = 0; top = true; } };
    }

    return { create: create, STILL: STILL };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Aim;
