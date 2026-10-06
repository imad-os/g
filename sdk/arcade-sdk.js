/* Arcade SDK v1: the one small ES5 file every game includes.
 *
 *   Arcade.define(gameApi, { id: 'my-game' });
 *
 * gameApi is the game's entry/exit contract (see docs/game-sdk.md):
 *   init(host)  load, report host.progress(0..1), then host.loaded() (or host.failed(reason))
 *   start() pause() resume() destroy()              lifecycle, driven by the hub
 *   resize(viewport)                                optional, {cssWidth, cssHeight, dpr, safeArea}
 *   menuItems() -> [{ id, label }]                  optional extra pause-menu entries
 *   onMenu(id)  -> 'stay' keeps the pause menu open, anything else resumes
 *   onAction(action, pressed, repeat, dev)          input (left right up down jump run pause back confirm ...)
 *
 * One API, three transports (chosen automatically):
 *   hub      the game runs inside the hub's game.html (first-party games): direct calls
 *   frame    the game is a remote web app in the hub's sandboxed iframe: postMessage, protocol
 *            { v: 1, type, id, data }
 *   alone    the game page was opened by itself (e.g. GitHub Pages): a tiny built-in host with
 *            keyboard input, localStorage saves and a local top 10
 *
 * Hub -> game messages : init start pause resume destroy input menu resize reply
 * Game -> hub messages : hello ready progress loaded failed menuItems submitScore save load
 *                        announce exit requestPause destroyed key pickProfile
 *
 * `destroy` must stop requestAnimationFrame and timers and close AudioContext / GL contexts.
 * ES5 only: runs on Tizen 4.0 (Chromium 56) and newer. */
(function (root) {
    'use strict';

    var PROTOCOL = 1;
    var mode = '', api = null, opts = {}, host = null, gameId = '';
    var inited = false, aloneTimer = 0, seq = 0, pending = {};
    var vp = null;

    function post(type, data, id) {
        try { root.parent.postMessage({ v: PROTOCOL, type: type, id: id || 0, data: data === undefined ? null : data }, '*'); } catch (e) {}
    }

    /* ------------------------------------------------------------------ viewport */

    // The page is laid out at 1920x1080 and scaled to the window (centred). cssWidth/cssHeight are the
    // displayed size of that stage in CSS pixels; multiply by dpr for physical pixels.
    function viewport() {
        var w = root.innerWidth || 1920, h = root.innerHeight || 1080;
        var s = Math.min(w / 1920, h / 1080);
        return { cssWidth: Math.round(1920 * s), cssHeight: Math.round(1080 * s), scale: s, dpr: root.devicePixelRatio || 1,
                 safeArea: { left: 96, top: 54, right: 96, bottom: 54 } };
    }

    /* ------------------------------------------------------------------ input state (frame + alone) */

    var DIRS = { left: 1, right: 1, up: 1, down: 1 };
    var count = {}, lastDev = 'keys';

    function bump(dev, a, n) { var c = count[dev] || (count[dev] = {}); c[a] = Math.max(0, (c[a] || 0) + n); }
    function isDownDev(dev, a) { return !!(count[dev] && count[dev][a] > 0); }
    function isDown(a) {
        for (var d in count) if (count[d][a] > 0) return true;
        return false;
    }
    function resetInput() { count = {}; }

    // an input event from the hub (frame) or from the local key mapping (alone)
    function onInput(action, pressed, repeat, dev) {
        dev = dev || 'keys';
        if (!repeat) bump(dev, action, pressed ? 1 : -1);
        if (pressed) lastDev = dev;
        if (api && api.onAction) { try { api.onAction(action, pressed, repeat, dev); } catch (e) {} }
    }

    /* ------------------------------------------------------------------ host: frame transport */

    function makeFrameHost(init) {
        var data = init.saves || {};
        return {
            id: gameId, lang: init.lang, rtl: !!init.rtl, quality: init.quality, volume: init.volume,
            profile: init.profile, device: init.device, viewport: init.viewport, saves: data, sdk: PROTOCOL,
            input: { isDown: isDown, isDownDev: isDownDev, poll: function () {}, device: function () { return init.device; }, lastDevice: function () { return lastDev; } },
            // keys pressed while this iframe has focus go to the hub, which turns them into actions
            forwardKey: function (e, down) { post('key', { keyCode: e.keyCode, down: down, repeat: !!e.repeat }); },
            announce: function (text) { post('announce', { text: String(text) }); },
            save: function (k, v) { data[k] = v; post('save', { key: k, value: v }); return true; },
            load: function (k, def) { return data.hasOwnProperty(k) ? data[k] : def; },
            // asynchronous variant straight from the hub (always the latest value)
            loadAsync: function (k, cb) { request('load', { key: k }, cb); },
            progress: function (p) { post('progress', { value: Math.max(0, Math.min(1, +p || 0)) }); },
            loaded: function () { post('loaded'); },
            failed: function (reason) { post('failed', { reason: String(reason || 'game reported failure') }); },
            pause: function () { post('requestPause'); },
            exitToMenu: function () { post('exit'); },
            submitScore: function (score, o) { post('submitScore', { score: score, player: (o && o.player) || 1, players: (o && o.players) || 1 }); },
            topScores: function () { return init.topScores || []; },
            // the hub shows its profile picker; cb({ id, name, guest }) (default Guest)
            pickProfile: function (slot, cb) { request('pickProfile', { slot: slot }, cb); },
            stageLoading: function (title) { post('stageLoading', { title: title || '' }); },
            stageLoaded: function () { post('stageLoaded'); }
        };
    }

    function request(type, data, cb) {
        var id = ++seq;
        pending[id] = cb;
        post(type, data, id);
    }

    function sendMenuItems() {
        var items = [];
        try { items = (api && api.menuItems && api.menuItems()) || []; } catch (e) {}
        post('menuItems', { items: items });
    }

    function onMessage(e) {
        var m = e.data;
        if (!m || m.v !== PROTOCOL || typeof m.type !== 'string' || e.source !== root.parent) return;
        var d = m.data || {};
        switch (m.type) {
            case 'init':
                if (mode === 'alone' || inited) return;
                clearTimeout(aloneTimer);
                mode = 'frame';
                inited = true;
                vp = d.viewport || viewport();
                host = makeFrameHost(d);
                post('ready');
                try { api.init(host); } catch (err) { post('failed', { reason: 'init: ' + err }); }
                break;
            case 'start': if (mode === 'frame') { try { api.start(); } catch (e1) { post('failed', { reason: 'start: ' + e1 }); } } break;
            case 'pause':
                resetInput();
                try { api.pause(); } catch (e2) {}
                sendMenuItems();
                break;
            case 'resume': try { api.resume(); } catch (e3) {} break;
            case 'resize': vp = d; if (api && api.resize) { try { api.resize(d); } catch (e4) {} } break;
            case 'input': onInput(d.action, !!d.pressed, !!d.repeat, d.dev); break;
            case 'menu':
                var r;
                try { r = api.onMenu ? api.onMenu(d.id) : undefined; } catch (e5) {}
                sendMenuItems();
                post('menuResult', { id: d.id, stay: r === 'stay' });
                break;
            case 'destroy':
                try { api.destroy(); } catch (e6) {}
                resetInput();
                post('destroyed');
                break;
            case 'reply':
                if (pending[m.id]) { var cb = pending[m.id]; delete pending[m.id]; cb(d.value); }
                break;
        }
    }

    function startFrame() {
        root.addEventListener('message', onMessage, false);
        post('hello', { sdk: PROTOCOL });
        // Nobody answers: the page is embedded by something else, run on its own.
        aloneTimer = setTimeout(function () { if (!inited) startAlone(); }, 1500);
    }

    /* ------------------------------------------------------------------ host: alone (standalone page) */

    var ALONE_KEYS = {
        37: ['left'], 38: ['up'], 39: ['right'], 40: ['down'], 13: ['confirm', 'jump'], 32: ['jump', 'confirm'], 90: ['jump'],
        16: ['run'], 88: ['run'], 27: ['pause'], 80: ['pause'], 87: ['up'], 65: ['left'], 83: ['down'], 68: ['right']
    };
    var aloneHeld = {}, aloneState = 'idle', aloneOverlay = null;

    function aloneKey(e, down) {
        var acts = ALONE_KEYS[e.keyCode], i;
        if (!acts) return;
        if (e.preventDefault) e.preventDefault();
        if (down) {
            if (aloneHeld[e.keyCode]) {
                for (i = 0; i < acts.length; i++) if (DIRS[acts[i]]) onInput(acts[i], true, true, 'keys');
                return;
            }
            aloneHeld[e.keyCode] = true;
            if (aloneState === 'paused') { if (acts.indexOf('pause') >= 0 || acts.indexOf('confirm') >= 0) aloneResume(); return; }
            for (i = 0; i < acts.length; i++) {
                if (acts[i] === 'pause' && aloneState === 'running') { alonePause(); return; }
                onInput(acts[i], true, false, 'keys');
            }
        } else {
            if (!aloneHeld[e.keyCode]) return;
            aloneHeld[e.keyCode] = false;
            if (aloneState !== 'running') return;
            for (i = 0; i < acts.length; i++) if (acts[i] !== 'pause') onInput(acts[i], false, false, 'keys');
        }
    }

    function alonePause() {
        if (aloneState !== 'running') return;
        aloneState = 'paused';
        resetInput();
        try { api.pause(); } catch (e) {}
        if (!aloneOverlay) {
            aloneOverlay = document.createElement('div');
            aloneOverlay.setAttribute('role', 'dialog');
            aloneOverlay.style.cssText = 'position:absolute;left:0;top:0;width:1920px;height:1080px;background:rgba(5,6,18,.72);color:#ffd23f;' +
                'font:800 64px Arial,sans-serif;text-align:center;padding-top:440px;z-index:99';
            aloneOverlay.textContent = 'Paused';
            var s = document.createElement('div');
            s.style.cssText = 'font-size:32px;color:#fff;margin-top:24px;font-weight:600';
            s.textContent = 'Esc / Enter: resume';
            aloneOverlay.appendChild(s);
        }
        document.body.appendChild(aloneOverlay);
    }
    function aloneResume() {
        if (aloneState !== 'paused') return;
        aloneState = 'running';
        if (aloneOverlay && aloneOverlay.parentNode) aloneOverlay.parentNode.removeChild(aloneOverlay);
        try { api.resume(); } catch (e) {}
    }

    function aloneFit() {
        vp = viewport();
        var b = document.body;
        if (!b) return;
        b.style.position = 'absolute';
        b.style.webkitTransformOrigin = b.style.transformOrigin = '0 0';
        var tr = 'scale(' + vp.scale + ')';
        b.style.webkitTransform = b.style.transform = tr;
        b.style.left = Math.max(0, ((root.innerWidth || 1920) - 1920 * vp.scale) / 2) + 'px';
        b.style.top = Math.max(0, ((root.innerHeight || 1080) - 1080 * vp.scale) / 2) + 'px';
        if (api && inited && api.resize) { try { api.resize(vp); } catch (e) {} }
    }

    function ls(k, v) {
        var key = 'arcade_alone_' + gameId + '_' + k;
        try {
            if (v === undefined) { var s = localStorage.getItem(key); return s === null ? undefined : JSON.parse(s); }
            localStorage.setItem(key, JSON.stringify(v));
            return true;
        } catch (e) { return v === undefined ? undefined : false; }
    }

    function makeAloneHost() {
        var lang = (navigator.language || 'en').slice(0, 2).toLowerCase();
        if (['en', 'fr', 'es', 'ar'].indexOf(lang) < 0) lang = 'en';
        var cores = navigator.hardwareConcurrency || 4;
        return {
            id: gameId, lang: lang, rtl: lang === 'ar', sdk: PROTOCOL,
            quality: { tier: 'mid', cap: 1920, scale: 1, particles: 64, parallax: 2, clouds: true, shake: true, musicVoices: 3, smoothUI: true, auto: true },
            volume: { music: 0.7, sfx: 0.8 },
            profile: { id: 'guest', name: 'Guest' }, device: 'keyboard', viewport: vp,
            input: { isDown: isDown, isDownDev: isDownDev, poll: function () {}, device: function () { return 'keyboard'; }, lastDevice: function () { return lastDev; } },
            forwardKey: function () {},     // the page's own key listeners already feed the input state
            announce: function () {},
            save: function (k, v) { return ls('s_' + k, v); },
            load: function (k, def) { var v = ls('s_' + k); return v === undefined ? def : v; },
            loadAsync: function (k, cb) { var v = ls('s_' + k); setTimeout(function () { cb(v); }, 0); },
            progress: function () {},
            loaded: function () { aloneState = 'running'; try { api.start(); } catch (e) { if (root.console) console.error(e); } },
            failed: function (reason) { if (root.console) console.error('[Arcade] game failed: ' + reason); },
            pause: alonePause,
            exitToMenu: function () {},
            submitScore: function (score) {
                var l = ls('top10') || [];
                l.push({ n: 'YOU', s: Math.floor(score) || 0, d: Date.now() });
                l.sort(function (a, b) { return b.s - a.s; });
                if (l.length > 10) l.length = 10;
                ls('top10', l);
            },
            topScores: function () { return ls('top10') || []; },
            pickProfile: function (slot, cb) { cb({ id: 'guest', name: 'Guest', guest: true }); },
            stageLoading: function () {}, stageLoaded: function () {}
        };
    }

    function startAlone() {
        mode = 'alone';
        inited = true;
        root.removeEventListener('message', onMessage, false);
        host = makeAloneHost();
        document.addEventListener('keydown', function (e) { aloneKey(e, true); });
        document.addEventListener('keyup', function (e) { aloneKey(e, false); });
        root.addEventListener('blur', function () { if (aloneState === 'running') alonePause(); });
        root.addEventListener('resize', aloneFit);
        aloneFit();
        host.viewport = vp;
        try { api.init(host); } catch (e) { if (root.console) console.error(e); }
    }

    /* ------------------------------------------------------------------ public API */

    function connect() {
        if (root.ArcadeHost && root.ArcadeHost.attach) {      // hub: game.html loaded this script itself
            mode = 'hub';
            root.ArcadeHost.attach(api);
            return;
        }
        if (root.parent && root.parent !== root) startFrame();
        else {
            // wait for <body> (standalone page, script in <head>) before the first fit
            if (document.body) startAlone();
            else document.addEventListener('DOMContentLoaded', startAlone);
        }
    }

    root.Arcade = {
        version: PROTOCOL,
        define: function (gameApi, o) {
            if (api) return;
            api = gameApi;
            opts = o || {};
            gameId = String(opts.id || '');
            root.GameAPI = gameApi;
            connect();
        },
        mode: function () { return mode; },
        // Resolves a path relative to the game folder. Needed in the hub (the page is game.html), harmless elsewhere.
        url: function (path) {
            var b = root.ArcadeHost && root.ArcadeHost.baseUrl ? root.ArcadeHost.baseUrl() : '';
            return b + path;
        },
        // The element that holds the game's DOM: #game-root in the hub, <body> everywhere else.
        root: function () { return root.ArcadeHost && root.ArcadeHost.root ? root.ArcadeHost.root() : document.body; },
        // A file the hub already downloaded from the game manifest (decoded JSON / blob URL), or undefined.
        asset: function (path) { return root.ArcadeHost && root.ArcadeHost.asset ? root.ArcadeHost.asset(path) : undefined; },
        // for tests and tools
        _onMessage: onMessage
    };
})(window);
