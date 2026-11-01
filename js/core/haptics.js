/* Phone feel, kept on the phone with the Game controller's settings (arc_dev_ctrlphone.opt):
 *   vib     vibration on button presses, 0 (off) to 3 (strongest); 2 at first. Used by the Game controller (every mode)
 *           and by the touch pad My PC draws over games and apps on a phone. Set in the Game controller's Settings and in
 *           Control Panel > Devices.
 *   orient  screen rotation (Auto / Portrait / Landscape / Manual): js/core/rotation.js, which replaced Auto rotate.
 * Web phones and the Android app only: on a TV nothing here does anything. */
var Haptics = (function () {
    'use strict';
    var KEY = 'arc_dev_ctrlphone', MS = [0, 10, 22, 40], VIB_DEF = 2, cache = null;

    function data() { var d = Store.rawGet(KEY); return d && typeof d === 'object' ? d : {}; }
    function opt() { if (!cache) { var o = data().opt; cache = o && typeof o === 'object' ? o : {}; } return cache; }
    function level() { var v = opt().vib; return v === 0 || v === 1 || v === 2 || v === 3 ? v : VIB_DEF; }

    // a short buzz for a button press at the chosen strength (the phone's vibrator has one strength: longer feels stronger);
    // ms: a longer cue (pairing, training), scaled the same way
    function buzz(ms) {
        var n = level();
        if (!n || !navigator.vibrate) return;
        try { navigator.vibrate(ms ? Math.round(ms * n / VIB_DEF) : MS[n]); } catch (e) {}
    }
    function set(k, v) {
        var d = data(), o = d.opt && typeof d.opt === 'object' ? d.opt : {};
        if (k !== 'vib') return;
        o.vib = Math.max(0, Math.min(3, Math.round(+v) || 0));
        d.opt = o; Store.rawSet(KEY, d);
        buzz();                                            // feel the new strength
    }
    Store.onWrite(function (k) { if (k === KEY) cache = null; });     // the Game controller saves the same key itself

    // where this can matter: a phone or tablet (a touch screen that is not a TV) or the Android app
    function phone() { return !window.tizen && (!!window.MyPCNative || (window.PWA && PWA.phone())); }

    return { level: level, buzz: buzz, set: set, phone: phone, MAX: 3 };
}());
