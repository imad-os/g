/* Screen rotation on phones and tablets: Control Panel > Display (and the Game controller's phone settings, the same
 * setting). Kept on the phone with its other settings, arc_dev_ctrlphone.opt:
 *   orient  'landscape' (the default: landscape only, held on the side it is on, the sensors never turn it),
 *           'portrait'  (portrait only, held), 'auto' (follows the phone: portrait and landscape), or
 *           'manual'    (held where it is; the Rotate button turns it: taskbar, the game menu, Control Panel > Display)
 *   side    manual mode: the side it was last turned to, 'landscape' | 'portrait'
 * An old saved Auto rotate (rotate: true, rv: 2: both landscape sides) reads as 'auto'.
 * In portrait My PC lays its screen out 1080 wide and as tall as the phone (js/launcher/main.js fit()), and apps and games
 * get a tall screen.
 * Android app: MyPCNative 5+ applies { orient: 'any' | 'landscape' | 'portrait' } natively; older apps only know
 * landscape ({ rotate }: true = both landscape sides), so portrait needs the new app. Browser: the Screen Orientation API
 * (full screen or the installed app); where it cannot hold a side, js/core/pwa.js asks to turn the phone.
 * hold('landscape') lets a screen that only works sideways (the Game controller) keep landscape while it is open.
 * On a TV nothing here does anything. */
var Rotation = (function () {
    'use strict';
    var KEY = 'arc_dev_ctrlphone', MODES = ['auto', 'portrait', 'landscape', 'manual'], held = null, subs = [];

    function data() { var d = Store.rawGet(KEY); return d && typeof d === 'object' ? d : {}; }
    function opt() { var o = data().opt; return o && typeof o === 'object' ? o : {}; }
    function nativeV() { try { return window.MyPCNative && typeof MyPCNative.version === 'function' ? +MyPCNative.version() || 0 : 0; } catch (e) { return 0; } }
    // where this can matter: a phone or tablet (a touch screen that is not a TV) or the Android app
    function phone() { return !window.tizen && (!!window.MyPCNative || !!(window.PWA && PWA.phone())); }
    // the Android app before 2.4.0 (MyPCNative 4 and older) cannot turn upright
    function canPortrait() { return !window.MyPCNative || nativeV() >= 5; }

    function mode() {
        var o = opt();
        if (MODES.indexOf(o.orient) >= 0) return o.orient;
        return o.rv === 2 && o.rotate === true ? 'auto' : 'landscape';
    }
    function side() { return opt().side === 'portrait' ? 'portrait' : 'landscape'; }
    function current() { return window.innerHeight > window.innerWidth ? 'portrait' : 'landscape'; }
    // what the screen should do now: 'any' (follow the phone), 'landscape' or 'portrait'
    function want() {
        if (held) return held;
        var m = mode(), w = m === 'auto' ? 'any' : m === 'manual' ? side() : m;
        return w === 'portrait' && !canPortrait() ? 'landscape' : w;
    }

    function save(o) { var d = data(); d.opt = o; Store.rawSet(KEY, d); }
    function changed() { apply(); for (var i = 0; i < subs.length; i++) try { subs[i](); } catch (e) {} }
    function set(m) {
        if (MODES.indexOf(m) < 0) return;
        var o = opt();
        o.orient = m;
        if (m === 'manual') o.side = current();            // manual starts where the screen is now
        save(o);
        changed();
    }
    // manual mode: turn to the other side
    function turn() {
        var o = opt();
        o.orient = 'manual';
        o.side = (held || current()) === 'portrait' ? 'landscape' : 'portrait';
        if (o.side === 'portrait' && !canPortrait()) return false;
        save(o);
        changed();
        return true;
    }
    function hold(o) { held = o === 'landscape' || o === 'portrait' ? o : null; apply(); }
    function onChange(fn) { subs.push(fn); }

    function apply() {
        if (!phone()) return;
        var w = want();
        if (nativeV() >= 3) {
            try { MyPCNative.settings(JSON.stringify({ orient: w, rotate: w === 'any' })); } catch (e) {}
            return;
        }
        try {
            var so = screen.orientation, p = null;
            if (so && so.lock) {
                // a held side stays on the side it is on (landscape-secondary is not turned over)
                p = so.lock(w === 'any' ? 'any' : so.type && so.type.indexOf(w) === 0 ? so.type : w);
                if (p && p.catch) p.catch(function () {});
            }
        } catch (e) {}
        if (window.PWA && PWA.update) PWA.update(w);
    }

    if (phone()) apply();
    return { mode: mode, set: set, side: side, turn: turn, want: want, hold: hold, apply: apply, onChange: onChange,
             phone: phone, canPortrait: canPortrait, current: current, MODES: MODES };
}());
