/* Single input module: TV remote, keyboard and W3C gamepads -> actions.
 *
 * Actions: left right up down jump run pause menu back confirm cancel runToggle
 *   Gamepad Start / Select (Switch +/-, Xbox Menu/View, PlayStation Options/Share): pressing one is 'menu'
 *   (the game's own menu); holding both together HOLD_MS is 'pause' (My PC's menu, works in every game).
 *   Back: in a game only the TV remote's Back (tvBack() is true) opens My PC's menu; Esc / Backspace go to the game.
 *   pageUp pageDown guide tab tabBack   (desktop and apps only: games never receive these)
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
        9: ['tab'],                                // Tab (Shift+Tab is tabBack)
        // second keyboard player
        87: ['up'], 65: ['left'], 83: ['down'], 68: ['right'], 70: ['jump', 'confirm'], 71: ['run']
    };
    var KEYS2 = { 87: 1, 65: 1, 83: 1, 68: 1, 70: 1, 71: 1 };
    var DIRS = { left: 1, right: 1, up: 1, down: 1 };
    var REPEAT = { left: 1, right: 1, up: 1, down: 1, pageUp: 1, pageDown: 1, tab: 1, tabBack: 1 };    // held keys that repeat
    // Only what is used. Arrows, Enter and Back need no registration.
    var TV_KEYS = ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'ColorF0Red', 'ChannelUp', 'ChannelDown', 'Guide'];

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

    var handler = null;
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
    function touch(action, down) {
        var acts = TOUCH[action], i;
        if (action === 'menu' || action === 'pause') {
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
        if (action === 'menu' || action === 'pause') {
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
    var vpads = {}, vpadN = 0;
    function virtualPad(player, mask, x, y, name) {
        var p = vpads[player], j;
        if (mask === null) {
            if (!p) return;
            delete vpads[player]; vpadN--;
            refreshPads();
            return;
        }
        if (!p) {
            p = vpads[player] = { index: 100 + player, id: (name || 'Phone') + ' (STANDARD GAMEPAD Vendor: 0000 Product: 0000)', connected: true, mapping: 'standard', buttons: [], axes: [0, 0, 0, 0] };
            for (j = 0; j < 17; j++) p.buttons.push({ pressed: false, value: 0 });
            vpadN++;
            refreshPads();
        }
        for (j = 0; j < 17; j++) { var on = (mask >> j) & 1; p.buttons[j].pressed = !!on; p.buttons[j].value = on; }
        p.axes[0] = +x || 0; p.axes[1] = +y || 0;
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
            if (rawFn) rawPad(dev, p);
            for (j = 0; j < PAD_BUTTONS.length; j++) {
                b = p.buttons[PAD_BUTTONS[j][0]];
                if (b && (b.pressed || b.value > 0.5)) {
                    acts = PAD_BUTTONS[j][1];
                    for (var k = 0; k < acts.length; k++) now[acts[k]] = true;
                    any = true;
                }
            }
            // Start / Select: one of them = the game's menu (sent when let go); both held HOLD_MS = My PC's menu
            var sb = p.buttons[9], sl = p.buttons[8], st = startBtn[dev] || (startBtn[dev] = { at: 0, both: 0, combo: false, fired: false, sup: false });
            var sDown = !!(sb && (sb.pressed || sb.value > 0.5)), lDown = !!(sl && (sl.pressed || sl.value > 0.5));
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

    // Every button and axis of every pad, unmapped, for installed apps (MyPC.gamepad): only changes are reported.
    // rawFn('b', dev, index, pressed, value) | rawFn('a', dev, axes) | rawFn('lost', dev). No allocation once a pad is known.
    var rawFn = null, rawPrev = {};         // 'padN' -> { v: Float32Array (button values), p: Uint8Array (pressed), a: Float32Array (axes) }
    function rawPad(dev, p) {
        var nb = p.buttons.length, na = p.axes.length, r = rawPrev[dev], j, b, v, pr, moved = false;
        if (!r || r.v.length < nb || r.a.length < na) r = rawPrev[dev] = { v: new Float32Array(Math.max(nb, 17)), p: new Uint8Array(Math.max(nb, 17)), a: new Float32Array(Math.max(na, 4)) };
        for (j = 0; j < nb; j++) {
            b = p.buttons[j];
            if (!b) continue;
            v = b.value || (b.pressed ? 1 : 0); pr = b.pressed || v > 0.5 ? 1 : 0;
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
            if (p && p.connected) out.push({ index: p.index, name: padName(p.id), id: p.id, standard: p.mapping === 'standard', buttons: p.buttons ? p.buttons.length : 0, axes: p.axes ? p.axes.length : 0 });
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
        virtualPad: virtualPad,              // a phone controller as a real gamepad: virtualPad(player, buttonBits, x, y, name); (player, null) removes it
        remote: remote,                      // a phone controller's actions: remote(player 1|2, action, down)
        releaseRemote: releaseRemote,
        touch: touch,                        // the touch pad's actions (left right up down ok run cancel menu pause)
        systemBack: systemBack,              // the phone's Back button in the Android app: like the TV remote's Back
        setHandler: function (fn) { handler = fn; },
        isDown: isDown,
        isDownDev: isDownDev,
        lastDevice: function () { return lastDev; },
        tvBack: function () { return backTv; },          // the last Back pressed was the TV remote's (not Esc / Backspace)
        poll: poll,
        setExternalPoll: function (on) { externalPoll = on; if (!on) ensureLoop(); },
        releaseAll: releaseAll,
        device: function () { return device; },
        padCount: function () { return pads; },
        pads: padList,
        onPadRaw: function (fn) { rawFn = fn || null; rawPrev = {}; },      // every button / axis change (installed apps' MyPC.gamepad)
        seen: function () { return { remote: !!window.tizen, keyboard: seen.keyboard, mouse: seen.mouse }; },
        onDevice: function (fn) { deviceListeners.push(fn); },
        onDevices: function (fn) { padListeners.push(fn); },        // a controller came or went, or a keyboard / mouse was used
        offDevices: function (fn) { var i = padListeners.indexOf(fn); if (i >= 0) padListeners.splice(i, 1); }
    };
})();
