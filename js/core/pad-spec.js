/* The one touch pad of My PC (owner rule: the phone controller and the pad drawn over games are the SAME pad).
 * The Game controller's Buttons mode (js/launcher/apps/gamepad.js) and the shell's pad over apps and games
 * (js/launcher/touchpad.js) both draw VirtualPad with PadSpec.options(): same buttons, places, sizes, Home and + buttons,
 * Stick / D-pad switch, and ONE saved layout (vpad:controller2), so a change made on either shows on both.
 * A B X Y in the Nintendo places, each sending the gamepad button a real Nintendo pad's same letter gives in My PC (owner decision
 * 2026-11-11: A = OK, as on a Switch): A right = button 0 (OK / jump), B bottom = 1 (Back / run), X top = 2 and Y left = 3 (run), L R = 4 5, ZL ZR = 6 7, − = 8, + = 9 (Start),
 * L3 R3 = 10 11, Home = 16 (Guide), Capture = 17. L and R are shown at first, the gear adds ZL ZR − Capture L3 R3.
 *   PadSpec.options(extra)    VirtualPad.init options of the pad (extra: onAction, onSettings, onHide, ...)
 *   PadSpec.index(action)     the W3C button index of a pad action ('pause' = 9, 'home' = 16), -1 for the stick
 *   PadSpec.dpad() / .setDpad(bool)   D-pad in place of the stick: the pad panel's choice and the Game controller's GamePad setting */
var PadSpec = (function () {
    'use strict';

    var ID = 'controller2', KEY = 'arc_dev_vpad:' + ID;
    var ABXY = [{ label: 'A', key: 13, action: 'g0', place: 'right' }, { label: 'B', key: 88, action: 'g1', place: 'bottom' },
                { label: 'X', key: 77, action: 'g2', place: 'top' }, { label: 'Y', key: 90, action: 'g3', place: 'left' }];
    var EXTRA = [{ label: 'L', key: 76, action: 'l', place: 'l' }, { label: 'R', key: 82, action: 'r', place: 'r' }, { label: 'ZL', key: 75, action: 'zl', place: 'zl' }, { label: 'ZR', key: 84, action: 'zr', place: 'zr' },
                 { label: '−', key: 189, action: 'minus' }, { label: '●', key: 67, action: 'capture' }, { label: 'L3', key: 49, action: 'ls' }, { label: 'R3', key: 50, action: 'rs' }];
    var BUTTONS = ABXY.concat(EXTRA.slice(0, 2)), CATALOG = ABXY.concat(EXTRA);
    var INDEX = { g0: 0, g1: 1, g2: 2, g3: 3, l: 4, r: 5, zl: 6, zr: 7, minus: 8, menu: 9, pause: 9, ls: 10, rs: 11, guide: 16, home: 16, capture: 17 };
    var SCALE = { stick: 1.35, btn: 1.15 };
    // the layout is kept in My PC's store (arc_dev_vpad:<id>), so it is never lost between opens
    var STORE = { get: function (k) { return Store.rawGet('arc_dev_' + k); }, set: function (k, v) { Store.rawSet('arc_dev_' + k, v); } };

    function layout() { var c = Store.rawGet(KEY); return c && typeof c === 'object' ? c : null; }
    function dpad() { var c = layout(); return !!(c && c.dp === true); }
    function setDpad(v) {
        var c = layout() || { on: {}, pos: {}, s: 1, b: 1 };
        c.dp = !!v;
        Store.rawSet(KEY, c);
        try { localStorage.setItem('vpad:' + ID, JSON.stringify(c)); } catch (e) {}
    }
    function options(extra) {
        var o = { storage: STORE, id: ID, force: true, scale: SCALE, buttons: BUTTONS, catalog: CATALOG, home: true, mic: null, dpadSwitch: true, dpad: false }, k;
        for (k in extra) if (extra[k] !== undefined) o[k] = extra[k];
        return o;
    }
    function index(a) { return INDEX.hasOwnProperty(a) ? INDEX[a] : -1; }

    return { ID: ID, BUTTONS: BUTTONS, CATALOG: CATALOG, SCALE: SCALE, STORE: STORE, options: options, index: index, dpad: dpad, setDpad: setDpad };
})();
