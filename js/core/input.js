/* Single input module: TV remote, keyboard and W3C gamepads -> actions.
 *
 * Actions: left right up down jump run pause back confirm cancel runToggle
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
        403: ['runToggle'], 82: ['runToggle']      // Red key, R
    };
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
    var keyCount = {};              // action -> number of keys holding it
    var padNow = {}, padPrev = {};  // action -> bool
    var padRepeatAt = {};
    var pads = 0, activePad = -1;
    var device = window.tizen ? 'remote' : 'keyboard';
    var deviceListeners = [];
    var externalPoll = false, rafId = 0;
    var supportsPads = !!(navigator.getGamepads || navigator.webkitGetGamepads);

    function emit(action, pressed, repeat) {
        if (handler) handler(action, pressed, !!repeat);
    }

    function setDevice(d) {
        if (d === device) return;
        device = d;
        for (var i = 0; i < deviceListeners.length; i++) deviceListeners[i](d);
    }

    function onKey(e, down) {
        var code = e.keyCode, acts = KEYMAP[code], i;
        if (!acts) return;
        if (e.preventDefault) e.preventDefault();   // also stops the native click on Enter
        if (code >= 400 || code === 19) setDevice('remote');
        else if (!window.tizen) setDevice('keyboard');

        if (down) {
            if (keyHeld[code]) {
                // Auto-repeat: only menus care, and only for directions.
                for (i = 0; i < acts.length; i++) if (DIRS[acts[i]]) emit(acts[i], true, true);
                return;
            }
            keyHeld[code] = true;
            for (i = 0; i < acts.length; i++) {
                keyCount[acts[i]] = (keyCount[acts[i]] || 0) + 1;
                emit(acts[i], true, false);
            }
        } else {
            if (!keyHeld[code]) return;
            keyHeld[code] = false;
            for (i = 0; i < acts.length; i++) {
                keyCount[acts[i]] = Math.max(0, (keyCount[acts[i]] || 0) - 1);
                emit(acts[i], false, false);
            }
        }
    }

    function releaseAll() {
        var a;
        for (var c in keyHeld) if (keyHeld[c]) onKey({ keyCode: +c }, false);
        for (a in padNow) if (padNow[a]) { padNow[a] = false; emit(a, false, false); }
        padPrev = {};
    }

    function getPads() {
        try { return (navigator.getGamepads || navigator.webkitGetGamepads).call(navigator) || []; } catch (e) { return []; }
    }

    // Reads all connected pads. Called once per frame by the running game (lowest latency),
    // or by our own rAF loop while the launcher is on screen and a pad is connected.
    function poll() {
        if (!pads) return;
        var list = getPads(), now = {}, i, j, b, p, acts, a, t = Date.now();
        for (i = 0; i < list.length; i++) {
            p = list[i];
            if (!p || !p.connected) continue;
            var any = false;
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
        }
        for (a in now) {
            if (!padNow[a]) { padNow[a] = true; emit(a, true, false); padRepeatAt[a] = t + REPEAT_DELAY; }
            else if (DIRS[a] && t >= padRepeatAt[a]) { emit(a, true, true); padRepeatAt[a] = t + REPEAT_RATE; }
        }
        for (a in padNow) if (padNow[a] && !now[a]) { padNow[a] = false; emit(a, false, false); }
    }

    function selfLoop() {
        rafId = 0;
        if (externalPoll || !pads) return;
        poll();
        rafId = requestAnimationFrame(selfLoop);
    }
    function ensureLoop() { if (!rafId && !externalPoll && pads) rafId = requestAnimationFrame(selfLoop); }

    function countPads() {
        var list = getPads(), n = 0;
        for (var i = 0; i < list.length; i++) if (list[i] && list[i].connected) n++;
        return n;
    }

    function refreshPads(evt) {
        var before = pads;
        pads = countPads();
        if (pads > before) { setDevice('pad'); emit('padConnected', true, false); }
        if (pads < before) {
            var lost = evt && evt.gamepad ? evt.gamepad.index === activePad : true;
            releaseAll();
            if (lost || !pads) { activePad = -1; emit('padLost', true, false); }
            if (!pads) setDevice(window.tizen ? 'remote' : 'keyboard');
        }
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

    return {
        init: init,
        onKey: onKey,                        // game iframes forward their key events here
        setHandler: function (fn) { handler = fn; },
        isDown: function (a) { return (keyCount[a] || 0) > 0 || !!padNow[a]; },
        poll: poll,
        setExternalPoll: function (on) { externalPoll = on; if (!on) ensureLoop(); },
        releaseAll: releaseAll,
        device: function () { return device; },
        padCount: function () { return pads; },
        onDevice: function (fn) { deviceListeners.push(fn); }
    };
})();
