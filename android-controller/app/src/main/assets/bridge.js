/* My PC Controller (Android app): runs before My PC's own scripts. The Game controller page listens for devicemotion
 * (js/launcher/apps/gamepad.js); here those listeners get the app's native samples instead of the browser's, and the native
 * sensors run only while someone listens. Samples carry `t` on the page clock (performance.now), which the motion engine
 * uses in place of the arrival time. */
(function () {
    'use strict';
    var N = window.MyPCNative;
    if (!N || window.__mypcBridge) return;
    window.__mypcBridge = 1;
    var L = [], add = window.addEventListener, rm = window.removeEventListener, off = null;
    var caps = {}; try { caps = JSON.parse(N.caps()); } catch (e) {}
    if (!caps.motion) return;                                         // no accelerometer: leave the browser's events alone

    window.addEventListener = function (type, fn, o) {
        if (type !== 'devicemotion' || typeof fn !== 'function') return add.apply(this, arguments);
        if (L.indexOf(fn) < 0) { L.push(fn); if (L.length === 1) { off = null; N.motion(true); } }
    };
    window.removeEventListener = function (type, fn, o) {
        if (type !== 'devicemotion') return rm.apply(this, arguments);
        var i = L.indexOf(fn);
        if (i >= 0) { L.splice(i, 1); if (!L.length) N.motion(false); }
    };
    // b = { n: sent at, s: [[t, ax, ay, az, gx, gy, gz, alpha, beta, gamma], ...] }, times in ms on the sensor clock.
    // The page clock is the sensor clock + off; off is the smallest delay seen (both clocks are monotonic and tick at the
    // same rate), so a batch that arrives late keeps its timing.
    window.__mypcMotion = function (b) {
        var now = performance.now(), d = now - b.n, s = b.s, i, j, x, e;
        if (off === null || d < off) off = d;
        for (i = 0; i < s.length; i++) {
            x = s[i];
            e = { type: 'devicemotion', native: true, t: x[0] + off, interval: 10,
                  acceleration: { x: x[1], y: x[2], z: x[3] }, accelerationIncludingGravity: { x: x[4], y: x[5], z: x[6] },
                  rotationRate: { alpha: x[7], beta: x[8], gamma: x[9] } };
            for (j = 0; j < L.length; j++) { try { L[j].call(window, e); } catch (err) { if (window.console) console.error(err); } }
        }
    };
})();
