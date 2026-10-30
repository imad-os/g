/* Phone feel, kept on the phone with the Game controller's settings (arc_dev_ctrlphone.opt):
 *   vib     vibration on button presses, 0 (off) to 3 (strongest); 2 at first. Used by the Game controller (every mode)
 *           and by the touch pad My PC draws over games and apps on a phone. Set in the Game controller's Settings and in
 *           Control Panel > Devices.
 *   rotate  Auto rotate: false (the default) holds the screen on the landscape side it is on, even when the phone is turned
 *           over; true lets it follow the phone between the two landscape sides. `rv: 2` marks a choice made since it became
 *           off by default (an older saved `rotate: true` was only the old default). The Android app (MyPCNative 3+) applies
 *           it natively for the whole app; in a browser the Screen Orientation API holds the side where it can.
 * Web phones and the Android app only: on a TV nothing here does anything. */
var Haptics = (function () {
    'use strict';
    var KEY = 'arc_dev_ctrlphone', MS = [0, 10, 22, 40], VIB_DEF = 2, cache = null;

    function data() { var d = Store.rawGet(KEY); return d && typeof d === 'object' ? d : {}; }
    function opt() { if (!cache) { var o = data().opt; cache = o && typeof o === 'object' ? o : {}; } return cache; }
    function level() { var v = opt().vib; return v === 0 || v === 1 || v === 2 || v === 3 ? v : VIB_DEF; }
    function rotate() { var o = opt(); return o.rv === 2 && o.rotate === true; }
    function nativeV() { try { return window.MyPCNative && typeof MyPCNative.version === 'function' ? +MyPCNative.version() || 0 : 0; } catch (e) { return 0; } }

    // a short buzz for a button press at the chosen strength (the phone's vibrator has one strength: longer feels stronger);
    // ms: a longer cue (pairing, training), scaled the same way
    function buzz(ms) {
        var n = level();
        if (!n || !navigator.vibrate) return;
        try { navigator.vibrate(ms ? Math.round(ms * n / VIB_DEF) : MS[n]); } catch (e) {}
    }
    function set(k, v) {
        var d = data(), o = d.opt && typeof d.opt === 'object' ? d.opt : {};
        if (k === 'vib') o.vib = Math.max(0, Math.min(3, Math.round(+v) || 0));
        else if (k === 'rotate') { o.rotate = !!v; o.rv = 2; }
        else return;
        d.opt = o; Store.rawSet(KEY, d);
        if (k === 'rotate') applyRotate();
        else buzz();                                       // feel the new strength
    }
    Store.onWrite(function (k) { if (k === KEY) cache = null; });     // the Game controller saves the same key itself

    function applyRotate() {
        var r = rotate();
        if (nativeV() >= 3) { try { MyPCNative.settings(JSON.stringify({ rotate: r })); } catch (e) {} return; }
        try {
            var so = screen.orientation;
            if (so && so.lock && window.PWA && PWA.phone()) { var p = so.lock(r || !/^landscape/.test(so.type) ? 'landscape' : so.type); if (p && p.catch) p.catch(function () {}); }
        } catch (e) {}
    }
    // where this can matter: a phone or tablet (a touch screen that is not a TV) or the Android app
    function phone() { return !window.tizen && (!!window.MyPCNative || (window.PWA && PWA.phone())); }

    if (phone()) applyRotate();
    return { level: level, buzz: buzz, rotate: rotate, set: set, apply: applyRotate, phone: phone, MAX: 3 };
}());
