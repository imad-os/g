/* My PC SDK v1: makes a web game or app run inside My PC (Samsung TV / browser).
 * Guide: https://imad-os.github.io/g/sdk/GUIDE.md
 *
 * Include it, then call MyPC.init() once:
 *
 *   <script src="https://imad-os.github.io/g/sdk/mypc-sdk.js"></script>
 *   MyPC.init({
 *       onInit:    function (info) { ...load assets, MyPC.progress(0..1)...; MyPC.ready(); },
 *       onStart:   function () { ...start the loop... },
 *       onPause:   function () { ...stop the loop, mute... },
 *       onResume:  function () { ...restart the loop... },
 *       onDestroy: function () { ...stop everything, close the AudioContext... },
 *       onInput:   function (action, pressed, repeat, dev) { ... },  // optional
 *       onMenu:    function (id) { ... }                            // optional, see setMenu()
 *   });
 *
 * Inside My PC the app runs in a sandboxed iframe on its own origin. My PC owns the remote: it
 * sends input actions, opens the pause menu on Back and closes the app. Opened directly in a
 * browser ("standalone"), the SDK plays the host itself: keyboard input, localStorage saves,
 * Esc / P = pause, so the app can be developed and tested anywhere.
 *
 * Input actions: left right up down jump run confirm cancel pause menu
 *   'menu' = gamepad Start, short press; only sent to apps that init with { ownMenu: true }
 *   (otherwise it opens My PC's pause menu). Holding Start, or the remote's Back, always opens My PC's menu.
 * Written in ES5 so it loads anywhere; My PC itself supports Samsung TVs from 2024 (Tizen 8+).
 */
var MyPC = (function () {
    'use strict';

    var VERSION = 1, HELLO_WAIT = 1200;
    var handlers = {}, info = null, data = {}, started = false, destroyed = false, isReady = false;
    var hosted = false, hostWin = null, hostOrigin = '*', helloTimer = 0;
    var down = {};                       // action -> number of keys / buttons holding it
    var menuItems = [];
    var standalonePaused = false;

    function call(name) {
        var f = handlers[name];
        if (typeof f !== 'function') return;
        try { return f.apply(null, Array.prototype.slice.call(arguments, 1)); }
        catch (e) { try { console.error('[MyPC] ' + name + ': ' + (e && e.stack || e)); } catch (e2) {} }
    }

    function post(type, d) {
        if (!hosted || !hostWin) return;
        try { hostWin.postMessage({ mypc: VERSION, type: type, data: d === undefined ? null : d }, hostOrigin); } catch (e) {}
    }

    /* ---------------- input state ---------------- */

    function setInput(action, pressed, repeat, dev) {
        if (!repeat) down[action] = Math.max(0, (down[action] || 0) + (pressed ? 1 : -1));
        call('onInput', action, pressed, !!repeat, dev || 'keys');
    }
    function releaseAll() { for (var a in down) if (down[a] > 0) { down[a] = 0; call('onInput', a, false, false, 'keys'); } }

    /* ---------------- messages from My PC ---------------- */

    function onMessage(e) {
        var m = e.data;
        if (!m || m.mypc !== VERSION || typeof m.type !== 'string') return;
        if (hosted && e.source !== hostWin) return;
        var d = m.data || {};
        switch (m.type) {
            case 'init':
                if (info) return;
                clearTimeout(helloTimer);
                hosted = true; hostWin = e.source; hostOrigin = e.origin && e.origin !== 'null' ? e.origin : '*';
                data = d.data || {};
                pub.app_config = plainObject(d.config) ? d.config : {};
                info = { standalone: false, lang: d.lang || 'en', rtl: !!d.rtl, volume: d.volume || { music: 0.7, sfx: 0.8 },
                         profile: d.profile || { id: 'p1', name: '' }, quality: d.quality || { tier: 'mid' }, app: d.app || {} };
                if (info.rtl) document.documentElement.setAttribute('dir', 'rtl');
                document.documentElement.setAttribute('lang', info.lang);
                call('onInit', info);
                break;
            case 'start': if (!started) { started = true; call('onStart'); } break;
            case 'pause': releaseAll(); call('onPause'); break;
            case 'resume': call('onResume'); break;
            case 'destroy':
                if (destroyed) return;
                destroyed = true; releaseAll();
                call('onDestroy');
                break;
            case 'input': setInput(d.action, !!d.pressed, d.repeat, d.dev); break;
            case 'menu': call('onMenu', d.id); break;
            case 'volume': if (info) { info.volume = d; call('onVolume', d); } break;
        }
    }

    /* ---------------- standalone (opened directly in a browser) ---------------- */

    var KEYS = { 37: ['left'], 38: ['up'], 39: ['right'], 40: ['down'], 13: ['confirm', 'jump'], 32: ['jump', 'confirm'], 90: ['jump'],
                 16: ['run'], 88: ['run'], 27: ['cancel'], 8: ['cancel'], 80: ['pause'] };
    var held = {};

    function standaloneKey(e, isDown) {
        var acts = KEYS[e.keyCode];
        if (!acts) return;
        e.preventDefault();
        if (isDown && (e.keyCode === 27 || e.keyCode === 80) && !e.repeat) { togglePause(); return; }
        if (standalonePaused) return;
        if (isDown && held[e.keyCode]) { for (var i = 0; i < acts.length; i++) if (/left|right|up|down/.test(acts[i])) setInput(acts[i], true, true, 'keys'); return; }
        if (!isDown && !held[e.keyCode]) return;
        held[e.keyCode] = isDown;
        for (var j = 0; j < acts.length; j++) setInput(acts[j], isDown, false, 'keys');
    }
    function togglePause() {
        if (!started) return;
        standalonePaused = !standalonePaused;
        if (standalonePaused) { held = {}; releaseAll(); call('onPause'); } else call('onResume');
    }

    function goStandalone() {
        if (info) return;
        hosted = false;
        var lang = (navigator.language || 'en').slice(0, 2);
        info = { standalone: true, lang: lang, rtl: lang === 'ar', volume: { music: 0.7, sfx: 0.8 }, profile: { id: 'local', name: '' }, quality: { tier: 'high' }, app: {} };
        try { data = JSON.parse(localStorage.getItem('mypc_' + location.pathname) || '{}') || {}; } catch (e) { data = {}; }
        try { var m = /[?&]app_config=([^&#]*)/.exec(location.search); var c = m && JSON.parse(decodeURIComponent(m[1])); pub.app_config = plainObject(c) ? c : {}; } catch (e) { pub.app_config = {}; }
        document.addEventListener('keydown', function (e) { standaloneKey(e, true); });
        document.addEventListener('keyup', function (e) { standaloneKey(e, false); });
        window.addEventListener('blur', function () { held = {}; releaseAll(); });
        call('onInit', info);
    }

    /* ---------------- API ---------------- */

    function init(h) {
        if (handlers.__init) return;
        handlers = h || {};
        handlers.__init = true;
        window.addEventListener('message', onMessage);
        if (window.parent && window.parent !== window) {
            // in a frame: say hello to My PC (it answers with "init"); keys pressed while the frame
            // has focus (mouse click on a PC) are forwarded so the host still gets Back, arrows...
            hosted = true; hostWin = window.parent;
            post('hello', { sdk: VERSION, title: document.title, ownMenu: handlers.ownMenu === true });
            document.addEventListener('keydown', function (e) { forwardKey(e, true); });
            document.addEventListener('keyup', function (e) { forwardKey(e, false); });
            helloTimer = setTimeout(goStandalone, HELLO_WAIT);   // framed by something that is not My PC
        } else goStandalone();
    }

    function forwardKey(e, isDown) {
        if (!hosted || !info) return;
        if (KEYS[e.keyCode] || e.keyCode === 10009 || e.keyCode >= 400) { e.preventDefault(); post('key', { keyCode: e.keyCode, down: isDown, repeat: !!e.repeat }); }
    }

    function ready() {
        if (isReady) return;
        isReady = true;
        if (hosted) { post('progress', { p: 1 }); post('ready'); }
        else if (!started) { started = true; call('onStart'); }
    }

    function save(key, value) {
        data[key] = value;
        if (hosted) post('save', { key: String(key), value: value });
        else try { localStorage.setItem('mypc_' + location.pathname, JSON.stringify(data)); } catch (e) {}
    }

    var pub = {
        version: VERSION,
        // The app's settings object, set in the installer and read before the app opens. Read it in
        // onInit (or later). Always an object ({} when none). Standalone, test it with ?app_config={"a":1}.
        app_config: {},
        init: init,
        ready: ready,
        progress: function (p) { if (hosted) post('progress', { p: Math.max(0, Math.min(1, +p || 0)) }); },
        fail: function (reason) { if (hosted) post('failed', { reason: String(reason || '') }); else try { console.error('[MyPC] ' + reason); } catch (e) {} },
        info: function () { return info; },
        isDown: function (action) { return (down[action] || 0) > 0; },
        save: save,
        load: function (key, def) { return data.hasOwnProperty(key) ? data[key] : def; },
        submitScore: function (score, opts) { opts = opts || {}; if (hosted) post('score', { score: Math.floor(+score || 0), player: opts.player || 1, players: opts.players || 1 }); },
        announce: function (text) { if (hosted) post('announce', { text: String(text) }); },
        // extra pause-menu entries: [{ id: 'restart', label: 'Restart' }]; My PC calls onMenu(id)
        setMenu: function (items) { menuItems = items || []; if (hosted) post('menu', { items: menuItems }); },
        pause: function () { if (hosted) post('pause'); else if (!standalonePaused) togglePause(); },
        exit: function () { if (hosted) post('exit'); else { call('onDestroy'); destroyed = true; } },
        isHosted: function () { return hosted && !!info && !info.standalone; }
    };

    function plainObject(o) { return !!o && typeof o === 'object' && !(o instanceof Array); }

    return pub;
})();
