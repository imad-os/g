/* Single input module: TV remote, keyboard and W3C gamepads -> actions.
 *
 * Actions: left right up down jump run pause back confirm cancel runToggle
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
        // second keyboard player
        87: ['up'], 65: ['left'], 83: ['down'], 68: ['right'], 70: ['jump', 'confirm'], 71: ['run']
    };
    var KEYS2 = { 87: 1, 65: 1, 83: 1, 68: 1, 70: 1, 71: 1 };
    var DIRS = { left: 1, right: 1, up: 1, down: 1 };
    // Only what is used. Arrows, Enter and Back need no registration.
    var TV_KEYS = ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'ColorF0Red'];

    // W3C "standard" gamepad mapping.
    var PAD_BUTTONS = [
        [0, ['jump', 'confirm']], [1, ['run', 'cancel']], [2, ['run']], [3, ['run']],
        [8, ['pause']], [9, ['pause']],
        [12, ['up']], [13, ['down']], [14, ['left']], [15, ['right']]
    ];
    var REPEAT_DELAY = 380, REPEAT_RATE = 130;

    var handler = null;
    var keyHeld = {};               // keyCode -> true
    var count = {};                 // device -> { action -> number of keys/buttons holding it }
    var padNow = {};                // 'padN' -> { action -> bool }
    var padRepeatAt = {};           // 'padN' -> { action -> time }
    var pads = 0, activePad = -1, lastDev = 'keys';
    var device = window.tizen ? 'remote' : 'keyboard';
    var deviceListeners = [];
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

    function onKey(e, down) {
        var code = e.keyCode, acts = KEYMAP[code], i, dev = KEYS2[code] ? 'keys2' : 'keys';
        if (!acts) return;
        if (e.preventDefault) e.preventDefault();   // also stops the native click on Enter
        if (code >= 400 || code === 19) setDevice('remote');
        else if (!window.tizen) setDevice('keyboard');

        if (down) {
            // a key suppressed by releaseAll() whose keyup was lost (window blur): a real new press
            if (keyHeld[code] === 'sup' && e.repeat === false) keyHeld[code] = false;
            if (keyHeld[code]) {
                // Auto-repeat: only menus care, and only for directions.
                for (i = 0; i < acts.length; i++) if (DIRS[acts[i]]) emit(acts[i], true, true, dev);
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
    }

    function getPads() {
        try { return (navigator.getGamepads || navigator.webkitGetGamepads).call(navigator) || []; } catch (e) { return []; }
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
            for (j = 0; j < PAD_BUTTONS.length; j++) {
                b = p.buttons[PAD_BUTTONS[j][0]];
                if (b && (b.pressed || b.value > 0.5)) {
                    acts = PAD_BUTTONS[j][1];
                    for (var k = 0; k < acts.length; k++) now[acts[k]] = true;
                    any = true;
                }
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
                else if (DIRS[a] && t >= rep[a]) { emit(a, true, true, dev); rep[a] = t + REPEAT_RATE; }
            }
            for (a in prev) if (prev[a] && !now[a]) {
                prev[a] = false;
                if (sup[a]) sup[a] = false; else emit(a, false, false, dev);
            }
        }
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
            delete padNow[d]; delete padSup[d];
            if (+d.slice(3) === activePad || (evt && evt.gamepad && 'pad' + evt.gamepad.index === d)) activePad = -1;
            emit('padLost', true, false, d);
        }
        if (pads > before) { setDevice('pad'); emit('padConnected', true, false, 'pad'); }
        if (!pads) setDevice(window.tizen ? 'remote' : 'keyboard');
        ensureLoop();
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
        if ((count.keys && count.keys[a] > 0) || (count.keys2 && count.keys2[a] > 0)) return true;
        for (var d in padNow) if (padNow[d][a] && !(padSup[d] && padSup[d][a])) return true;
        return false;
    }

    return {
        init: init,
        onKey: onKey,                        // game iframes forward their key events here
        setHandler: function (fn) { handler = fn; },
        isDown: isDown,
        isDownDev: isDownDev,
        lastDevice: function () { return lastDev; },
        poll: poll,
        setExternalPoll: function (on) { externalPoll = on; if (!on) ensureLoop(); },
        releaseAll: releaseAll,
        device: function () { return device; },
        padCount: function () { return pads; },
        onDevice: function (fn) { deviceListeners.push(fn); }
    };
})();
