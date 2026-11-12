/* Single input module: TV remote, keyboard and W3C gamepads -> actions.
 *
 * Actions: left right up down jump run pause menu back confirm cancel runToggle
 *   Gamepad Start / Select (Switch +/-, Xbox Menu/View, PlayStation Options/Share): pressing one is 'menu'
 *   (the game's own menu); holding both together HOLD_MS is 'pause' (My PC's menu, works in every game).
 *   Back: in a game only the TV remote's Back (tvBack() is true) opens My PC's menu; Esc / Backspace go to the game.
 *   pageUp pageDown guide tab tabBack record mediaNext mediaPrev mediaFf mediaRew mediaStop   (desktop and apps only: games never receive these)
 *   record: the remote's Record key, or its voice / mic key on the rare TVs that give it to apps (the Memo app)
 * Every action carries the device that produced it, so games can tell players apart:
 *   'keys'  TV remote, or arrows + Enter/Space/Z/X/Shift on a keyboard
 *   'keys2' second keyboard player: W A S D + F (jump) + G (run)
 *   'pad0'..'pad3' each gamepad
 * Menus ignore the device; isDown(a) is true when any device holds the action.
 *
 * Every key event of the app (including the ones forwarded from a game iframe) goes through
 * onKey() below, and the router in launcher/main.js is the only place that handles Back.
 * Remote keys are mapped by keyCode: e.key is often "Unidentified" on TVs.
 */
var Input = (function () {
    'use strict';

    var KEYMAP = {
        37: ['left'], 38: ['up'], 39: ['right'], 40: ['down'],
        13: ['confirm', 'jump'],                   // OK / Enter
        10009: ['back'], 27: ['back'], 8: ['back'],// Back (TV), Esc, Backspace
        32: ['jump', 'confirm'], 90: ['jump'],     // Space, Z
        16: ['run'], 88: ['run'],                  // Shift, X
        415: ['pause'], 19: ['pause'], 10252: ['pause'], 80: ['pause'], // Play, Pause, PlayPause, P
        403: ['runToggle'], 82: ['runToggle'],     // Red key, R
        427: ['pageUp'], 428: ['pageDown'],        // TV remote Channel Up / Down: scroll a page
        33: ['pageUp'], 34: ['pageDown'],          // PageUp / PageDown on a keyboard
        458: ['guide'], 117: ['guide'],            // TV remote Guide, F6 on a keyboard: to the toolbar / Start
        416: ['record'],                           // TV remote Record (voice / mic keys are added by registerTvKeys when the TV has them)
        10233: ['mediaNext'], 10232: ['mediaPrev'], 417: ['mediaFf'], 412: ['mediaRew'], 413: ['mediaStop'],   // ⏭ ⏮ ⏩ ⏪ ⏹ (the Music player)
        176: ['mediaNext'], 177: ['mediaPrev'], 178: ['mediaStop'], 179: ['pause'],                        // a PC keyboard's media keys
        9: ['tab'],                                // Tab (Shift+Tab is tabBack)
        // second keyboard player
        87: ['up'], 65: ['left'], 83: ['down'], 68: ['right'], 70: ['jump', 'confirm'], 71: ['run']
    };
    var KEYS2 = { 87: 1, 65: 1, 83: 1, 68: 1, 70: 1, 71: 1 };
    var DIRS = { left: 1, right: 1, up: 1, down: 1 };
    var REPEAT = { left: 1, right: 1, up: 1, down: 1, pageUp: 1, pageDown: 1, tab: 1, tabBack: 1, mediaFf: 1, mediaRew: 1 };    // held keys that repeat
    // Only what is used. Arrows, Enter and Back need no registration.
    var TV_KEYS = ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaRecord', 'ColorF0Red', 'ChannelUp', 'ChannelDown', 'Guide',
                   'MediaTrackNext', 'MediaTrackPrevious', 'MediaFastForward', 'MediaRewind', 'MediaStop'];
    // Samsung keeps the Smart Remote's mic button for Bixby / the voice assistant (it is not in the keys apps can register);
    // a TV that does list a voice or mic key gets it registered as 'record'.
    var VOICE_KEY = /voice|mic|bixby/i;

    // W3C "standard" gamepad mapping.
    var PAD_BUTTONS = [
        [0, ['jump', 'confirm']], [1, ['run', 'cancel']], [2, ['run']], [3, ['run']],
        [4, ['pageUp']], [5, ['pageDown']], [16, ['guide']],        // LB / RB scroll, the Guide / Home button
        // 8 / 9 (Select / Start): short press = 'menu', hold = 'pause' (see poll)
        [12, ['up']], [13, ['down']], [14, ['left']], [15, ['right']]
    ];
    var REPEAT_DELAY = 380, REPEAT_RATE = 130, HOLD_MS = 1000;
    var startBtn = {};              // 'padN' -> { at: first pressed, both: both held since, combo: both were held, fired: hold sent, sup: released by releaseAll }
    var backTv = false;             // the last Back came from the TV remote (keyCode 10009), not from a keyboard

    var handler = null, keyHook = null, rawHook = null, rawHeld = {};
    // every remote / keyboard button an app can map itself (MyPC.buttons, API 19): keyCode -> name. Back (10009, Esc, Backspace),
    // Guide / F6 and Tab are never given away (My PC's menu, the desktop).
    var BUTTONS = { 37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'ok', 32: 'space', 427: 'chUp', 428: 'chDown', 33: 'pageUp', 34: 'pageDown',
        415: 'play', 19: 'pause', 10252: 'playPause', 417: 'ff', 412: 'rew', 10233: 'next', 10232: 'prev', 413: 'stop', 416: 'record',
        403: 'red', 404: 'green', 405: 'yellow', 406: 'blue', 457: 'info', 10073: 'chList', 10135: 'tools', 10190: 'prevCh', 10221: 'caption',
        458: 'guide', 10195: 'mts', 10200: 'teletext', 10140: 'pictureSize', 10253: 'extra', 189: 'minus', 176: 'next', 177: 'prev', 178: 'stop', 179: 'playPause' };
    for (var dg = 0; dg <= 9; dg++) BUTTONS[48 + dg] = String(dg);
    var BUTTON_LABELS = {};         // name -> the TV's own name for a key My PC has no name for ('k<code>')
    // the TV keys apps' buttons need registered (only once an app asks for them)
    var EXTRA_TV_KEYS = ['ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue', 'Info', 'ChannelList', 'Tools', 'PreviousChannel', 'Caption', 'MTS',
        'Teletext', 'PictureSize', 'Extra', 'Minus', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    var extraDone = false;
    function registerExtraKeys() {
        if (extraDone) return;
        extraDone = true;
        var tvi = window.tizen && tizen.tvinputdevice;
        if (!tvi) return;
        for (var i = 0; i < EXTRA_TV_KEYS.length; i++) { try { tvi.registerKey(EXTRA_TV_KEYS[i]); } catch (e) {} }
        // and every other key this TV's remote has (owner request 2026-11-12: "not all my remote's buttons"), by 'k<code>' when
        // My PC has no name for it; never the volume, power, source or exit keys (the TV's own)
        try {
            var sup = tvi.getSupportedKeys() || [];
            for (var j = 0; j < sup.length; j++) {
                var k = sup[j];
                if (!k || /^(Volume|Mute|Power|Source|Exit|Home)/i.test(k.name) || KEYMAP[k.code] && !BUTTONS[k.code]) continue;
                if (!BUTTONS[k.code]) { BUTTONS[k.code] = 'k' + k.code; BUTTON_LABELS['k' + k.code] = String(k.name); }
                try { tvi.registerKey(k.name); } catch (e2) {}
            }
        } catch (e3) {}
    }
    var keyHeld = {};               // keyCode -> true
    var count = {};                 // device -> { action -> number of keys/buttons holding it }
    var padNow = {};                // 'padN' -> { action -> bool }
    var padRepeatAt = {};           // 'padN' -> { action -> time }
    var pads = 0, activePad = -1, lastDev = 'keys';
    var device = window.tizen ? 'remote' : 'keyboard';
    var deviceListeners = [], padListeners = [];
    var seen = { keyboard: false, mouse: false };        // devices that have been used (Settings > Devices lists them)
    var externalPoll = false, rafId = 0;
    var supportsPads = !!(navigator.getGamepads || navigator.webkitGetGamepads);

    function emit(action, pressed, repeat, dev) {
        if (pressed) lastDev = dev;
        if (handler) handler(action, pressed, !!repeat, dev);
    }

    function setDevice(d) {
        if (d === device) return;
        device = d;
        for (var i = 0; i < deviceListeners.length; i++) deviceListeners[i](d);
    }

    function bump(dev, a, n) {
        var c = count[dev] || (count[dev] = {});
        c[a] = Math.max(0, (c[a] || 0) + n);
    }

    // keys only a keyboard has (the TV remote sends 10009 for Back and 4xx for its special keys)
    function isKeyboardKey(code) { return (code >= 65 && code <= 90) || code === 9 || code === 8 || code === 27 || code === 32 || code === 33 || code === 34 || code === 117; }

    function used(what) {
        if (seen[what]) return;
        seen[what] = true;
        for (var i = 0; i < padListeners.length; i++) padListeners[i]();
    }

    // A text field being typed in (the phone's own keyboard, or a PC keyboard): its keys are typing, not actions
    // (B, Backspace = Back, W A S D...). Enter, Esc or the TV's Back leave the field; then keys are actions again.
    var NOT_TEXT = { checkbox: 1, radio: 1, button: 1, submit: 1, reset: 1, range: 1, file: 1, color: 1, image: 1 };
    function textField(el) {
        if (!el || !el.tagName) return null;
        var tag = el.tagName;
        if (tag === 'TEXTAREA' || el.isContentEditable || (tag === 'INPUT' && !NOT_TEXT[(el.type || '').toLowerCase()])) return el.disabled || el.readOnly ? null : el;
        return null;
    }
    function typing(e, down) {
        var f = textField(e.target);
        if (!f || f !== document.activeElement) return false;
        var code = e.keyCode;
        if (!down) return !keyHeld[code];             // a key held from before the field took focus still gets its release
        if (code === 13 || code === 27 || code === 10009) {
            if (code !== 13 && e.preventDefault) e.preventDefault();
            setTimeout(function () { if (document.activeElement === f) f.blur(); }, 0);     // after the field's own Enter handler
        }
        return true;
    }

    function onKey(e, down) {
        var code = e.keyCode, acts = KEYMAP[code], i, dev = KEYS2[code] ? 'keys2' : 'keys';
        if (typing(e, down)) return;
        // the profile's remote shortcuts (js/launcher/shortcuts.js) go first: a mapped button does only its shortcut
        if (keyHook && keyHook(code, down, e)) { if (code >= 400 || code === 19) setDevice('remote'); if (e.preventDefault) e.preventDefault(); return; }
        // an app that maps the buttons itself (MyPC.buttons): its keys go only to it, by name (a release follows its own press)
        if (rawHook && BUTTONS[code] && (down ? rawHook(BUTTONS[code], true, !!rawHeld[code]) : rawHeld[code])) {
            if (down) rawHeld[code] = true; else { rawHeld[code] = false; rawHook(BUTTONS[code], false, false); }
            if (code >= 400 || code === 19) setDevice('remote');
            if (e.preventDefault) e.preventDefault();
            return;
        }
        if (down && isKeyboardKey(code)) { used('keyboard'); setDevice('keyboard'); }
        if (!acts) return;
        if (code === 9 && e.shiftKey) acts = ['tabBack'];
        if (down && acts[0] === 'back') backTv = code === 10009;
        if (e.preventDefault) e.preventDefault();   // also stops the native click on Enter
        if (code >= 400 || code === 19) setDevice('remote');
        else if (!window.tizen) setDevice('keyboard');
        else if (device === 'mouse' || device === 'pad') setDevice(seen.keyboard ? 'keyboard' : 'remote');     // arrows and OK: remote or keyboard

        if (down) {
            // a key suppressed by releaseAll() whose keyup was lost (window blur): a real new press
            if (keyHeld[code] === 'sup' && e.repeat === false) keyHeld[code] = false;
            if (keyHeld[code]) {
                // Auto-repeat: only menus care, and only for directions.
                for (i = 0; i < acts.length; i++) if (REPEAT[acts[i]]) emit(acts[i], true, true, dev);
                return;
            }
            keyHeld[code] = true;
            for (i = 0; i < acts.length; i++) { bump(dev, acts[i], 1); emit(acts[i], true, false, dev); }
        } else {
            if (!keyHeld[code]) return;
            var wasSuppressed = keyHeld[code] === 'sup';
            keyHeld[code] = false;
            if (wasSuppressed) return;          // already released by releaseAll()
            for (i = 0; i < acts.length; i++) { bump(dev, acts[i], -1); emit(acts[i], false, false, dev); }
        }
    }

    // Touch controls (js/launcher/touchpad.js): the pad's actions as a device of its own, 'touch'.
    // 'ok' is confirm + jump like the remote's OK; 'menu' and 'pause' are taps (the Start button).
    var TOUCH = { left: ['left'], right: ['right'], up: ['up'], down: ['down'], ok: ['confirm', 'jump'], run: ['run'], cancel: ['cancel'], b: ['run', 'cancel'] };   // b: like a gamepad's B
    var touchHeld = {};             // pad action -> true
    // 'btn<N>': button N of the standard gamepad layout (js/core/pad-spec.js, the pad shared with the phone controller):
    // exactly what that button of a real pad gives (PAD_BUTTONS; − and + = 'menu', Home = 'guide')
    function padActs(action) {
        var n = /^btn(\d+)$/.exec(action), j;
        if (!n) return null;
        for (j = 0; j < PAD_BUTTONS.length; j++) if (PAD_BUTTONS[j][0] === +n[1]) return PAD_BUTTONS[j][1];
        return null;
    }
    function touch(action, down) {
        if (action === 'btn8' || action === 'btn9') action = 'menu';
        else if (action === 'btn16') action = 'guide';
        var acts = TOUCH[action] || padActs(action), i;
        if (action === 'menu' || action === 'pause' || action === 'guide' || action === 'record') {
            if (down) { emit(action, true, false, 'touch'); emit(action, false, false, 'touch'); }
            return;
        }
        if (!acts || !!touchHeld[action] === down) return;
        touchHeld[action] = down;
        for (i = 0; i < acts.length; i++) { bump('touch', acts[i], down ? 1 : -1); emit(acts[i], down, false, 'touch'); }
    }
    function releaseTouch() { for (var a in touchHeld) if (touchHeld[a]) touch(a, false); }

    // Phones used as controllers (js/launcher/controllers.js): player 1 is the 'keys' device (like the remote and the
    // keyboard), player 2 is 'keys2' (the second keyboard player). Every game that supports two players already reads them.
    var remoteHeld = { 1: {}, 2: {} };
    function remote(player, action, down) {
        var dev = player === 2 ? 'keys2' : 'keys', held = remoteHeld[player === 2 ? 2 : 1], acts, i;
        if (action === 'menu' || action === 'pause' || action === 'record') {     // record: a pad's microphone button (the Record key)
            if (down) { emit(action, true, false, dev); emit(action, false, false, dev); }
            return;
        }
        if (action === 'guide') {              // the Home button: like a pad's Guide button
            if (down) { emit('guide', true, false, dev); emit('guide', false, false, dev); }
            return;
        }
        acts = TOUCH[action];
        if (!acts || !!held[action] === down) return;
        held[action] = down;
        for (i = 0; i < acts.length; i++) { bump(dev, acts[i], down ? 1 : -1); emit(acts[i], down, false, dev); }
    }
    // the phone's own Back button (the Android app, android-controller/): the same as the TV remote's Back, without
    // switching the input device (the touch pad stays); a text field being typed in is left first
    function systemBack() {
        var f = textField(document.activeElement);
        if (f) { f.blur(); return; }
        backTv = true;
        emit('back', true, false, 'touch'); emit('back', false, false, 'touch');
    }
    function releaseRemote(player) { var h = remoteHeld[player === 2 ? 2 : 1]; for (var a in h) if (h[a]) remote(player, a, false); }

    // Pad buttons released by releaseAll() while still held stay "suppressed" until the player lets
    // go, so a held button never turns into a new press (e.g. Start reopening/closing the pause menu).
    var padSup = {};                // 'padN' -> { action -> true }

    function releasePad(dev, suppress) {
        var now = padNow[dev];
        if (!now) return;
        for (var a in now) if (now[a]) {
            emit(a, false, false, dev);
            if (suppress) { (padSup[dev] || (padSup[dev] = {}))[a] = true; }
            else now[a] = false;
        }
    }

    // Releases everything for the receiver (pause menu opens, window loses focus) without letting a
    // key or button that is still physically held count as a new press afterwards.
    function releaseAll() {
        for (var rc in rawHeld) if (rawHeld[rc]) { rawHeld[rc] = false; if (rawHook) rawHook(BUTTONS[rc], false, false); }
        for (var c in keyHeld) {
            if (keyHeld[c] !== true) continue;
            var acts = KEYMAP[c], dev = KEYS2[c] ? 'keys2' : 'keys';
            keyHeld[c] = 'sup';
            for (var i = 0; i < acts.length; i++) { bump(dev, acts[i], -1); emit(acts[i], false, false, dev); }
        }
        for (var d in padNow) releasePad(d, true);
        releaseTouch();
        releaseRemote(1); releaseRemote(2);
        for (var s in startBtn) if (startBtn[s].at) startBtn[s].sup = true;      // no 'menu' when it is let go
    }

    function getPads() {
        var real = [];
        try { real = (navigator.getGamepads || navigator.webkitGetGamepads).call(navigator) || []; } catch (e) {}
        if (!vpadN) return real;
        var out = Array.prototype.slice.call(real);
        for (var k in vpads) out.push(vpads[k]);
        return out;
    }

    // A phone controller in pad mode is a virtual standard gamepad (index 100 + player): the phone sends raw button bits and
    // stick axes, and everything downstream (actions, Start / Select, MyPC.gamepad, padN devices) treats it like a real pad.
    // 18 buttons like a Switch Pro controller in Chrome (17 = Capture); rx, ry = right stick (axes 2 / 3, keyboard mode).
    var vpads = {}, vpadN = 0, VP_BUTTONS = 18;
    function axis(v) { v = +v || 0; return v > 1 ? 1 : v < -1 ? -1 : v; }
    function virtualPad(player, mask, x, y, name, rx, ry) {
        var p = vpads[player], j;
        if (mask === null) {
            if (!p) return;
            delete vpads[player]; vpadN--;
            refreshPads();
            return;
        }
        if (!p) {
            p = vpads[player] = { index: 100 + player, id: (name || 'Phone') + ' (STANDARD GAMEPAD Vendor: 0000 Product: 0000)', connected: true, mapping: 'standard', buttons: [], axes: [0, 0, 0, 0] };
            for (j = 0; j < VP_BUTTONS; j++) p.buttons.push({ pressed: false, value: 0 });
            vpadN++;
            refreshPads();
        }
        for (j = 0; j < VP_BUTTONS; j++) { var on = (mask >> j) & 1; p.buttons[j].pressed = !!on; p.buttons[j].value = on; }
        p.axes[0] = axis(x); p.axes[1] = axis(y); p.axes[2] = axis(rx); p.axes[3] = axis(ry);
        poll();
    }

    // Reads all connected pads. Called once per frame by the running game (lowest latency),
    // or by our own rAF loop while the launcher is on screen and a pad is connected.
    function poll() {
        if (!pads) return;
        var list = getPads(), i, j, b, p, acts, a, t = Date.now();
        for (i = 0; i < list.length; i++) {
            p = list[i];
            if (!p || !p.connected) continue;
            var dev = 'pad' + p.index, now = {}, any = false;
            var prev = padNow[dev] || (padNow[dev] = {}), rep = padRepeatAt[dev] || (padRepeatAt[dev] = {});
            if (capFn && p.index < 100) { capture(dev, p); continue; }      // the mapper is listening: raw presses only, no action
            if (capHold && p.index < 100) { if (anyHeld(p)) continue; capHold = false; }
            var mp = faceMap(p);
            var taken = padHook ? padEdges(dev, p, mp) : null;
            if (rawFn) rawPad(dev, p, taken, mp);
            for (j = 0; j < PAD_BUTTONS.length; j++) {
                b = p.buttons[mp ? mp[PAD_BUTTONS[j][0]] : PAD_BUTTONS[j][0]];
                if (b && (b.pressed || b.value > 0.5) && !(taken && taken[PAD_BUTTONS[j][0]])) {
                    acts = PAD_BUTTONS[j][1];
                    for (var k = 0; k < acts.length; k++) now[acts[k]] = true;
                    any = true;
                }
            }
            // Start / Select: one of them = the game's menu (sent when let go); both held HOLD_MS = My PC's menu
            var sb = p.buttons[9], sl = p.buttons[8], st = startBtn[dev] || (startBtn[dev] = { at: 0, both: 0, combo: false, fired: false, sup: false });
            var sDown = !!(sb && (sb.pressed || sb.value > 0.5)) && !(taken && taken[9]), lDown = !!(sl && (sl.pressed || sl.value > 0.5)) && !(taken && taken[8]);
            if (sDown || lDown) {
                any = true;
                if (!st.at) { st.at = t; st.both = 0; st.combo = false; st.fired = false; st.sup = false; }
                if (sDown && lDown) {
                    st.combo = true;
                    if (!st.both) st.both = t;
                    else if (!st.fired && !st.sup && t - st.both >= HOLD_MS) { st.fired = true; emit('pause', true, false, dev); emit('pause', false, false, dev); }
                } else st.both = 0;
            } else if (st.at) {
                if (!st.combo && !st.sup) { emit('menu', true, false, dev); emit('menu', false, false, dev); }
                st.at = 0;
            }
            var ax = p.axes[0] || 0, ay = p.axes[1] || 0;
            if (ax < -0.5) { now.left = true; any = true; }
            if (ax > 0.5) { now.right = true; any = true; }
            if (ay < -0.5) { now.up = true; any = true; }
            if (ay > 0.5) { now.down = true; any = true; }
            if (any) { activePad = p.index; setDevice('pad'); }
            var sup = padSup[dev] || (padSup[dev] = {});
            for (a in now) {
                if (sup[a]) continue;                      // still held since releaseAll()
                if (!prev[a]) { prev[a] = true; emit(a, true, false, dev); rep[a] = t + REPEAT_DELAY; }
                else if (REPEAT[a] && t >= rep[a]) { emit(a, true, true, dev); rep[a] = t + REPEAT_RATE; }
            }
            for (a in prev) if (prev[a] && !now[a]) {
                prev[a] = false;
                if (sup[a]) sup[a] = false; else emit(a, false, false, dev);
            }
        }
    }

    // A on every controller is OK and B is Back (owner decision 2026-11-11, imad's Switch Pro: "my real A must do OK and B Back, like before").
    // My PC's button 0 = OK / jump, 1 = Back / run, 2 / 3 = run. Xbox / PlayStation pads already give A / ✕ as 0. A Nintendo pad on the TV
    // (and Android) comes in LETTER order (A = 0, B = 1, X = 2, Y = 3): nothing to do. Only Chrome on a computer reads a Switch Pro by
    // PLACE (B = 0, A = 1, Y = 2, X = 3): faceMap(p) -> [1, 0, 3, 2, 4, 5...] puts it in letter order (My PC reads p.buttons[map[i]] for its
    // button i) before actions, shortcuts, the button test and apps (MyPC.gamepad). Per controller model the player can force it in
    // Control Panel > Gaming (TV-wide arc_dev_padorder { 'vendor:product': 'swap' | 'keep' }). Phone pads (index 100+) never change.
    var SWAP = new Uint8Array(32), faceCache = {}, padOrder = null;
    (function () { for (var i = 0; i < 32; i++) SWAP[i] = i; SWAP[0] = 1; SWAP[1] = 0; SWAP[2] = 3; SWAP[3] = 2; })();
    var DESKTOP_CHROME = !window.tizen && !/Android|Tizen|Web0S|SMART-TV|SmartTV/i.test(navigator.userAgent || '');
    function orders() {
        if (padOrder) return padOrder;
        try { padOrder = JSON.parse(localStorage.getItem('arc_dev_padorder') || '{}') || {}; } catch (e) { padOrder = {}; }
        return padOrder;
    }
    function padKey(inf) { return inf.vendor ? inf.vendor + ':' + inf.product : 'name:' + inf.name; }
    // The controller mapper (Control Panel > Gaming > Map the buttons, owner request 2026-11-12): per controller model, TV-wide,
    // arc_dev_padmap { 'vendor:product': [real button for My PC's button 0, 1, ... 17] }. A custom map wins over the swap setting.
    var padMaps = null;
    function maps() {
        if (padMaps) return padMaps;
        try { padMaps = JSON.parse(localStorage.getItem('arc_dev_padmap') || '{}') || {}; } catch (e) { padMaps = {}; }
        return padMaps;
    }
    function faceInfo(p) {
        var c = faceCache['pad' + p.index];
        if (c && c.id === p.id) return c;
        var inf = window.PadInfo ? PadInfo.detect(p.id, p.mapping) : null;
        var auto = !!inf && p.index < 100 && inf.vendor !== '0000' && inf.layout === 'nintendo' && DESKTOP_CHROME;
        var key = inf ? padKey(inf) : '', set = key && orders()[key], cm = key && maps()[key], custom = null, i;
        if (cm && cm.length) {
            custom = new Uint8Array(32);
            for (i = 0; i < 32; i++) custom[i] = i < cm.length && cm[i] >= 0 && cm[i] < 32 ? cm[i] : i;
        }
        c = faceCache['pad' + p.index] = { id: p.id, key: key, auto: auto, set: custom ? 'custom' : set || 'auto', swap: !custom && (set === 'swap' || (set !== 'keep' && auto)), custom: custom };
        return c;
    }
    function faceMap(p) { if (p.index >= 100) return null; var f = faceInfo(p); return f.custom || (f.swap ? SWAP : null); }
    function padsChanged() {
        faceCache = {};
        releaseAll();
        for (var i = 0; i < padListeners.length; i++) padListeners[i]();
    }
    function setPadOrder(key, v) {
        var o = orders();
        if (v === 'swap' || v === 'keep') o[key] = v; else delete o[key];
        try { localStorage.setItem('arc_dev_padorder', JSON.stringify(o)); } catch (e) {}
        if (v !== 'custom') setPadMap(key, null, true);       // picking a swap setting drops the custom map
        padsChanged();
    }
    // (key, [18 real button indices] | null): saved by the mapper; null = back to the swap setting
    function setPadMap(key, arr, quiet) {
        var m = maps();
        if (arr && arr.length) { var a = []; for (var i = 0; i < arr.length && i < 32; i++) a.push(+arr[i] | 0); m[key] = a; } else delete m[key];
        try { if (Object.keys(m).length) localStorage.setItem('arc_dev_padmap', JSON.stringify(m)); else localStorage.removeItem('arc_dev_padmap'); } catch (e) {}
        if (!quiet) padsChanged();
    }
    // the mapper listens: fn(padIndex, realButton) for each real button pressed (raw, before any map); no action meanwhile
    var capFn = null, capPrev = {}, capHold = false;
    function anyHeld(p) { for (var j = 0; j < p.buttons.length; j++) { var b = p.buttons[j]; if (b && (b.pressed || b.value > 0.5)) return true; } return false; }
    function capture(dev, p) {
        var pv = capPrev[dev], j, b, on;
        if (!pv) { pv = capPrev[dev] = new Uint8Array(32); for (j = 0; j < p.buttons.length && j < 32; j++) { b = p.buttons[j]; pv[j] = b && (b.pressed || b.value > 0.5) ? 1 : 0; } return; }
        for (j = 0; j < p.buttons.length && j < 32; j++) {
            b = p.buttons[j]; on = b && (b.pressed || b.value > 0.5) ? 1 : 0;
            if (on === pv[j]) continue;
            pv[j] = on;
            if (on && capFn) capFn(p.index, j);
        }
    }
    function capturePad(fn) {
        if (fn && !capFn) releaseAll();
        var was = !!capFn;
        capFn = fn || null; capPrev = {};
        if (!fn && was) { padPrev = {}; padTaken = {}; capHold = true; }      // the last press must not become an action: wait until every button is let go
        ensureLoop();
    }

    // The profile's shortcuts on controller buttons (js/launcher/shortcuts.js): padHook(index, down, dev) is told of every
    // button press / release; a button it takes (true on press) gives no action and no raw report until it is let go.
    var padHook = null, padPrev = {}, padTaken = {};       // 'padN' -> Uint8Array
    function padEdges(dev, p, mp) {
        var nb = p.buttons.length, pv = padPrev[dev], tk = padTaken[dev], j, b, on;
        if (!pv || pv.length < nb) { pv = padPrev[dev] = new Uint8Array(Math.max(nb, 18)); tk = padTaken[dev] = new Uint8Array(Math.max(nb, 18)); }
        for (j = 0; j < nb; j++) {
            b = p.buttons[mp ? mp[j] : j];
            on = b && (b.pressed || b.value > 0.5) ? 1 : 0;
            if (on === pv[j]) continue;
            pv[j] = on;
            if (on) { if (padHook(j, true, dev)) tk[j] = 1; }
            else if (tk[j]) { tk[j] = 0; padHook(j, false, dev); }
        }
        return tk;
    }

    // Every button and axis of every pad, unmapped, for installed apps (MyPC.gamepad): only changes are reported.
    // rawFn('b', dev, index, pressed, value) | rawFn('a', dev, axes) | rawFn('lost', dev). No allocation once a pad is known.
    var rawFn = null, rawPrev = {};         // 'padN' -> { v: Float32Array (button values), p: Uint8Array (pressed), a: Float32Array (axes) }
    function rawPad(dev, p, taken, mp) {
        var nb = p.buttons.length, na = p.axes.length, r = rawPrev[dev], j, b, v, pr, moved = false;
        if (!r || r.v.length < nb || r.a.length < na) r = rawPrev[dev] = { v: new Float32Array(Math.max(nb, 17)), p: new Uint8Array(Math.max(nb, 17)), a: new Float32Array(Math.max(na, 4)) };
        for (j = 0; j < nb; j++) {
            b = p.buttons[mp ? mp[j] : j];
            if (!b) continue;
            v = b.value || (b.pressed ? 1 : 0); pr = b.pressed || v > 0.5 ? 1 : 0;
            if (taken && taken[j]) { v = 0; pr = 0; }       // a shortcut's button: the app does not see it
            if (pr !== r.p[j] || Math.abs(v - r.v[j]) >= 0.05 || (v === 0 && r.v[j] !== 0)) { r.p[j] = pr; r.v[j] = v; rawFn('b', dev, j, !!pr, v); }
        }
        for (j = 0; j < na; j++) {
            v = p.axes[j] || 0;
            if (Math.abs(v - r.a[j]) >= 0.02 || (v === 0 && r.a[j] !== 0)) { r.a[j] = v; moved = true; }
        }
        if (moved) rawFn('a', dev, p.axes);
    }

    function selfLoop() {
        rafId = 0;
        if (externalPoll || !pads) return;
        poll();
        rafId = requestAnimationFrame(selfLoop);
    }
    function ensureLoop() { if (!rafId && !externalPoll && pads) rafId = requestAnimationFrame(selfLoop); }

    function connected() {
        var list = getPads(), out = {};
        for (var i = 0; i < list.length; i++) if (list[i] && list[i].connected) out['pad' + list[i].index] = true;
        return out;
    }
    function countPads() { var n = 0, c = connected(); for (var k in c) n++; return n; }

    function refreshPads(evt) {
        var before = pads, live = connected();
        pads = countPads();
        // release and report every pad that went away
        for (var d in padNow) {
            if (live[d]) continue;
            releasePad(d, false);
            delete padNow[d]; delete padSup[d]; delete startBtn[d];
            if (rawPrev[d]) { delete rawPrev[d]; if (rawFn) rawFn('lost', d); }
            if (+d.slice(3) === activePad || (evt && evt.gamepad && 'pad' + evt.gamepad.index === d)) activePad = -1;
            emit('padLost', true, false, d);
        }
        if (pads > before) { setDevice('pad'); emit('padConnected', true, false, 'pad'); }
        if (!pads && device === 'pad') setDevice(window.tizen ? 'remote' : 'keyboard');
        ensureLoop();
        for (var i = 0; i < padListeners.length; i++) padListeners[i]();
    }

    // "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 02fd)" -> "Xbox Wireless Controller"
    function padName(id) {
        var n = String(id || '').replace(/^[0-9a-f]{4}-[0-9a-f]{4}-/i, '').replace(/\s*\([^()]*(?:vendor|product|standard gamepad|xinput)[^()]*\)\s*/ig, ' ').replace(/\s+/g, ' ').trim();
        return n || 'Gamepad';
    }
    // connected controllers, for Settings > Devices
    function padList() {
        var list = getPads(), out = [];
        for (var i = 0; i < list.length; i++) {
            var p = list[i];
            if (!p || !p.connected) continue;
            // brand, model and button layout (js/core/pad-info.js): the labels printed on THIS controller (a Switch Pro's A is button 1)
            var inf = window.PadInfo ? PadInfo.detect(p.id, p.mapping) : { brand: '', model: padName(p.id), layout: 'other', vendor: '', product: '', known: false, standard: p.mapping === 'standard' };
            out.push({ index: p.index, name: padName(p.id), id: p.id, standard: p.mapping === 'standard', buttons: p.buttons ? p.buttons.length : 0, axes: p.axes ? p.axes.length : 0,
                       brand: inf.brand, model: inf.model, layout: inf.layout, vendor: inf.vendor, product: inf.product, known: inf.known, info: inf, active: p.index === activePad,
                       order: p.index < 100 ? faceInfo(p) : null });   // { key, auto, set: 'auto' | 'swap' | 'keep' | 'custom', swap, custom }: A B X Y read by letter -> put back in place
        }
        return out;
    }

    function registerTvKeys() {
        try {
            var tvi = window.tizen && tizen.tvinputdevice;
            if (!tvi) return;
            if (tvi.registerKeyBatch) tvi.registerKeyBatch(TV_KEYS);
            else for (var i = 0; i < TV_KEYS.length; i++) tvi.registerKey(TV_KEYS[i]);
        } catch (e) {
            for (var j = 0; j < TV_KEYS.length; j++) { try { tizen.tvinputdevice.registerKey(TV_KEYS[j]); } catch (e2) {} }
        }
        try {
            var sup = tizen.tvinputdevice.getSupportedKeys() || [];
            for (var k = 0; k < sup.length; k++) {
                if (!VOICE_KEY.test(sup[k].name) || KEYMAP[sup[k].code]) continue;
                try { tizen.tvinputdevice.registerKey(sup[k].name); KEYMAP[sup[k].code] = ['record']; } catch (e3) {}
            }
        } catch (e4) {}
    }

    function init() {
        registerTvKeys();
        // Back is handled only through keydown (no tizenhwkey listener): no "double back".
        document.addEventListener('keydown', function (e) { onKey(e, true); });
        document.addEventListener('keyup', function (e) { onKey(e, false); });
        window.addEventListener('blur', releaseAll);
        // the phone's keyboard closed (its hide key, Android Back) without leaving the field: leave it, so B and Back act again
        var vv = window.visualViewport, vw = vv ? vv.width : 0, vh = vv ? vv.height : 0;
        if (vv) vv.addEventListener('resize', function () {
            var a = textField(document.activeElement);
            if (a && Math.abs(vv.width - vw) < 2 && vv.height - vh > 120) a.blur();
            vw = vv.width; vh = vv.height;
        });
        // mouse / Magic Remote pointer: a real movement or click counts as "mouse used"
        document.addEventListener('mousemove', function (e) { if (e.movementX || e.movementY) { used('mouse'); setDevice('mouse'); } });
        document.addEventListener('mousedown', function () { used('mouse'); setDevice('mouse'); });
        // wheel: up / down in menus and lists (not while a game runs: it does not use the wheel)
        var wheelAt = 0;
        document.addEventListener('wheel', function (e) {
            if (externalPoll || !e.deltaY) return;
            var now = Date.now();
            if (now - wheelAt < 90) return;
            wheelAt = now;
            used('mouse'); setDevice('mouse');
            emit(e.deltaY > 0 ? 'down' : 'up', true, true, 'mouse');
        }, { passive: true });
        if (supportsPads) {
            window.addEventListener('gamepadconnected', refreshPads);
            window.addEventListener('gamepaddisconnected', refreshPads);
            // Some engines only report pads after a button press and miss the events.
            setInterval(function () { if (countPads() !== pads) refreshPads(null); }, 1500);
        }
    }

    function isDownDev(dev, a) {
        if (dev.charAt(0) === 'p') return !!(padNow[dev] && padNow[dev][a] && !(padSup[dev] && padSup[dev][a]));
        return !!(count[dev] && count[dev][a] > 0);
    }

    function isDown(a) {
        if ((count.keys && count.keys[a] > 0) || (count.keys2 && count.keys2[a] > 0) || (count.touch && count.touch[a] > 0)) return true;
        for (var d in padNow) if (padNow[d][a] && !(padSup[d] && padSup[d][a])) return true;
        return false;
    }

    return {
        init: init,
        onKey: onKey,                        // game iframes forward their key events here
        virtualPad: virtualPad,              // a phone controller as a real gamepad: virtualPad(player, buttonBits, x, y, name, rx, ry); (player, null) removes it
        remote: remote,                      // a phone controller's actions: remote(player 1|2, action, down)
        releaseRemote: releaseRemote,
        touch: touch,                        // the touch pad's actions (left right up down ok run cancel menu pause)
        systemBack: systemBack,              // the phone's Back button in the Android app: like the TV remote's Back
        setHandler: function (fn) { handler = fn; },
        setKeyHook: function (fn) { keyHook = fn || null; },
        setRawHook: function (fn) { rawHook = fn || null; },   // fn(name, down, repeat) -> true when the app takes the button (MyPC.buttons)
        registerExtraKeys: registerExtraKeys, BUTTONS: BUTTONS, buttonLabel: function (n) { return BUTTON_LABELS[n] || ''; },     // fn(keyCode, down, event) -> true when it used the key
        setPadHook: function (fn) { padHook = fn || null; },     // fn(buttonIndex, down, dev) -> true when it takes the button
        TV_KEYS: TV_KEYS,
        isDown: isDown,
        isDownDev: isDownDev,
        lastDevice: function () { return lastDev; },
        tvBack: function () { return backTv; },          // the last Back pressed was the TV remote's (not Esc / Backspace)
        poll: poll,
        setExternalPoll: function (on) { externalPoll = on; if (!on) ensureLoop(); },
        releaseAll: releaseAll,
        device: function () { return device; },
        padCount: function () { return pads; },
        pads: padList,                       // [{ index, name, id, standard, buttons, axes, brand, model, layout, vendor, product, known, info, active }]
        activePad: function () { return activePad; },
        padMap: function (index) { var p = this.pad(index); return p ? faceMap(p) : null; },   // null or the standard -> real button index map
        setPadOrder: setPadOrder,            // (key, 'auto' | 'swap' | 'keep'): Control Panel > Gaming
        setPadMap: function (key, arr) { setPadMap(key, arr); },     // (key, [real button for My PC's 0..17] | null): the mapper
        padMapOf: function (key) { var m = maps()[key]; return m ? m.slice() : null; },
        capturePad: capturePad,              // fn(padIndex, realButton) | null: the mapper hears raw presses, no actions meanwhile
        pad: function (index) { var l = getPads(); for (var i = 0; i < l.length; i++) if (l[i] && l[i].index === index) return l[i]; return null; },   // its live state (the test page)     // the index of the last pad used (-1: none yet)
        onPadRaw: function (fn) { rawFn = fn || null; rawPrev = {}; },      // every button / axis change (installed apps' MyPC.gamepad)
        seen: function () { return { remote: !!window.tizen, keyboard: seen.keyboard, mouse: seen.mouse }; },
        onDevice: function (fn) { deviceListeners.push(fn); },
        onDevices: function (fn) { padListeners.push(fn); },        // a controller came or went, or a keyboard / mouse was used
        offDevices: function (fn) { var i = padListeners.indexOf(fn); if (i >= 0) padListeners.splice(i, 1); }
    };
})();
