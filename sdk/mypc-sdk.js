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
 *   Every controller button, trigger and stick: MyPC.gamepad (API 9). Game controllers come first: use all of them.
 * Web requests without CORS limits, AI services and the microphone: MyPC.net, MyPC.ai, MyPC.mic (API 10).
 * Errors (uncaught, failed files, MyPC.fail, MyPC.report(error, data)) are saved by My PC for the App Store Manager (API 11).
 *   'menu' = gamepad Start or Select pressed alone; only sent to apps that init with { ownMenu: true }.
 *   Only the TV remote's Back, or holding Start + Select together 1 s, opens My PC's menu; Esc / Backspace are 'cancel'.
 * Written in ES5 so it loads anywhere; My PC itself supports Samsung TVs from 2024 (Tizen 8+).
 */
var MyPC = (function () {
    'use strict';

    var VERSION = 1, API = 11, HELLO_WAIT = 1200;
    var handlers = {}, info = null, data = {}, started = false, destroyed = false, isReady = false;
    var hosted = false, hostWin = null, hostOrigin = '*', helloTimer = 0;
    var down = {};                       // action -> number of keys / buttons holding it
    var menuItems = [];
    var standalonePaused = false, uiBlock = false;

    function call(name) {
        var f = handlers[name];
        if (typeof f !== 'function') return;
        try { return f.apply(null, Array.prototype.slice.call(arguments, 1)); }
        catch (e) { try { console.error('[MyPC] ' + name + ': ' + (e && e.stack || e)); } catch (e2) {} report(e, null, 'handler', name); }
    }

    function post(type, d) {
        if (!hosted || !hostWin) return;
        try { hostWin.postMessage({ mypc: VERSION, type: type, data: d === undefined ? null : d }, hostOrigin); } catch (e) {}
    }

    /* ---------------- error reports (API 11): My PC saves them for the App Store Manager (Errors page) ----------------
     * Uncaught errors, unhandled promise rejections, files that fail to load (script, image, audio...), errors thrown
     * by the handlers given to MyPC.init, MyPC.fail and MyPC.report. Listening starts as soon as this file runs, before
     * MyPC.init: include the SDK first. Each distinct error is sent once; repeats are only counted (every 3 s), at most
     * 20 distinct per page. Standalone (no My PC around) they only go to the console. */
    var errSeen = {}, errKeys = 0, errWait = [], errTimer = 0, ERR_MAX = 20;
    function framed() { try { return window.parent && window.parent !== window; } catch (e) { return true; } }
    function errTarget() {
        if (hosted && hostWin && info && !info.standalone) return hostOrigin;
        try { var a = location.ancestorOrigins; if (a && a.length && !info) return a[0]; } catch (e) {}
        return null;       // not known yet: kept until My PC answers (or dropped if it never does)
    }
    function errPost(m) {
        var to = errTarget();
        if (!to) { if (!info && errWait.length < ERR_MAX) errWait.push(m); return; }
        try { window.parent.postMessage({ mypc: VERSION, type: 'err', data: m }, to); } catch (e) {}
    }
    function errFlushWait() { var l = errWait; errWait = []; for (var i = 0; i < l.length; i++) errPost(l[i]); }
    function errRepeats() {
        errTimer = 0;
        for (var k in errSeen) if (errSeen[k].more) { var m = errSeen[k].m, r = { kind: m.kind, msg: m.msg, src: m.src, stack: '', n: errSeen[k].more, sdk: API }; errSeen[k].more = 0; errPost(r); }
    }
    function sendErr(kind, msg, stack, src) {
        msg = String(msg === undefined || msg === null || msg === '' ? '(no message)' : msg).slice(0, 300);
        src = String(src || '').slice(0, 200);
        if (!framed() || (info && info.standalone)) return;                          // standalone: the console has it
        var key = kind + '|' + msg + '|' + src, s = errSeen[key];
        if (s) { s.more++; if (!errTimer) errTimer = setTimeout(errRepeats, 3000); return; }
        if (errKeys >= ERR_MAX) return;
        errKeys++;
        var m = { kind: kind, msg: msg, stack: String(stack || '').slice(0, 1500), src: src, n: 1, sdk: API };
        errSeen[key] = { m: m, more: 0 };
        errPost(m);
    }
    function short(u) { return String(u || '').replace(/^https?:\/\/[^\/]+/, '').replace(/[?#].*$/, ''); }
    // MyPC.report(error, data): data is any small JSON value (what the app was doing), kept with the report
    function report(e, data, kind, where) {
        var msg = e && e.message !== undefined ? e.message : e, extra = '';
        if (data !== undefined && data !== null) { try { extra = ' | ' + JSON.stringify(data); } catch (x) { extra = ' | ' + String(data); } }
        sendErr(kind || 'report', (where ? where + ': ' : '') + String(msg) + extra.slice(0, 200), e && e.stack, '');
    }
    try {
        window.addEventListener('error', function (e) {
            var t = e.target;
            if (t && t !== window && t.tagName) { sendErr('resource', 'Could not load ' + String(t.tagName).toLowerCase() + ' ' + short(t.src || t.href || t.currentSrc), '', short(t.src || t.href)); return; }
            sendErr('error', e.message || (e.error && e.error.message), e.error && e.error.stack, e.filename ? short(e.filename) + ':' + e.lineno + ':' + e.colno : '');
        }, true);                                                                    // capture: also files that fail to load
        window.addEventListener('unhandledrejection', function (e) {
            var r = e.reason;
            sendErr('rejection', 'Unhandled promise: ' + (r && r.message !== undefined ? r.message : String(r)), r && r.stack, '');
        });
    } catch (e) {}

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
                         profile: d.profile || { id: 'p1', name: '' }, quality: d.quality || { tier: 'mid' }, app: d.app || {}, bridges: d.bridges || null };
                if (info.rtl) document.documentElement.setAttribute('dir', 'rtl');
                document.documentElement.setAttribute('lang', info.lang);
                multiplayer._enable(d.mp === 1 ? 'shell' : 'none');       // false on an older My PC: apps hide the multiplayer feature
                errFlushWait();
                call('onInit', info);
                break;
            case 'start': if (!started) { started = true; call('onStart'); } break;
            case 'pause': releaseAll(); gamepad._release(); call('onPause'); break;
            case 'resume': call('onResume'); break;
            case 'destroy':
                if (destroyed) return;
                destroyed = true; releaseAll(); gamepad._stop(); mic._stop();
                call('onDestroy');
                break;
            case 'input': setInput(d.action, !!d.pressed, d.repeat, d.dev); break;
            case 'menu': call('onMenu', d.id); break;
            case 'volume': if (info) { info.volume = d; call('onVolume', d); } break;
            case 'mp': multiplayer._message(d); break;
            case 'pad': pad._message(d); break;
            case 'ble-event': bluetooth._message(d); break;
            case 'sensors': sensors._message(d); break;
            case 'gp': gamepad._message(d); break;
            case 'net': net._message(d); break;
            case 'ai': ai._message(d); break;
            case 'mic': mic._message(d); break;
        }
    }

    /* ---------------- standalone (opened directly in a browser) ---------------- */

    var KEYS = { 37: ['left'], 38: ['up'], 39: ['right'], 40: ['down'], 13: ['confirm', 'jump'], 32: ['jump', 'confirm'], 90: ['jump'],
                 16: ['run'], 88: ['run'], 27: ['cancel'], 8: ['cancel'], 80: ['pause'] };
    var held = {};

    function standaloneKey(e, isDown) {
        if (uiBlock) return;                 // a multiplayer screen is open (standalone)
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
        if (standalonePaused) { held = {}; releaseAll(); gamepad._release(); call('onPause'); } else call('onResume');
    }

    function goStandalone() {
        if (info) return;
        hosted = false;
        var lang = (navigator.language || 'en').slice(0, 2);
        info = { standalone: true, lang: lang, rtl: lang === 'ar', volume: { music: 0.7, sfx: 0.8 }, profile: { id: 'local', name: '' }, quality: { tier: 'high' }, app: {} };
        errWait = [];
        try { data = JSON.parse(localStorage.getItem('mypc_' + location.pathname) || '{}') || {}; } catch (e) { data = {}; }
        try { var m = /[?&]app_config=([^&#]*)/.exec(location.search); var c = m && JSON.parse(decodeURIComponent(m[1])); pub.app_config = plainObject(c) ? c : {}; } catch (e) { pub.app_config = {}; }
        document.addEventListener('keydown', function (e) { standaloneKey(e, true); });
        document.addEventListener('keyup', function (e) { standaloneKey(e, false); });
        window.addEventListener('blur', function () { held = {}; releaseAll(); });
        multiplayer._enable('local');
        call('onInit', info);
        gamepad._standalone();
        if (handlers.pad) pad.init(plainObject(handlers.pad) ? handlers.pad : {});       // MyPC.init({ pad: true }): the pad on a phone, standalone
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
            post('hello', { sdk: VERSION, sdkApi: API, title: document.title, ownMenu: handlers.ownMenu === true, pad: handlers.pad === undefined ? null : handlers.pad });
            document.addEventListener('keydown', function (e) { forwardKey(e, true); });
            document.addEventListener('keyup', function (e) { forwardKey(e, false); });
            helloTimer = setTimeout(goStandalone, HELLO_WAIT);   // framed by something that is not My PC
        } else goStandalone();
    }

    function forwardKey(e, isDown) {
        if (!hosted || !info) return;
        // typing in the app's own text field: keys stay in the field (Esc / the TV's Back still reach My PC)
        var t = e.target, tag = t && t.tagName;
        if ((tag === 'TEXTAREA' || (t && t.isContentEditable) || (tag === 'INPUT' && !/^(checkbox|radio|button|submit|reset|range|file|color|image)$/i.test(t.type || ''))) && e.keyCode !== 27 && e.keyCode !== 10009) return;
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

    /* ---------------- multiplayer ----------------
     * MyPC.multiplayer.host({ max }) / join(): in My PC the SHELL owns the whole flow (its own screens, the accept dialog,
     * rooms, the connection) and relays peers over postMessage ('mp'). Standalone (the page opened in a browser) the same
     * flow runs here with minimal DOM screens, and two tabs of the same browser find each other (BroadcastChannel +
     * localStorage). The room / offer / answer layer below is internal: apps only ever see peers. */
    /* netlink:begin (identical in js/core/netlink.js and sdk/mypc-sdk.js; tests compare them) */
    var NetLink = (function () {
        'use strict';
        var MAX_MSG = 4096, TX_PER_S = 100, RX_PER_S = 200, CONNECT_MS = 15000, SILENCE_MS = 5000;

        function b64(buf) { var b = new Uint8Array(buf), s = '', i; for (i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192)); return btoa(s); }
        function unb64(str) { var s = atob(str), b = new Uint8Array(s.length), i; for (i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }
        // an SDP -> a short opaque string (deflate + base64 when the browser can; same-LAN host candidates only)
        function pack(desc) {
            var json = JSON.stringify({ t: desc.type, s: desc.sdp });
            if (typeof CompressionStream === 'function') {
                var cs = new CompressionStream('deflate'), w = cs.writable.getWriter();
                w.write(new TextEncoder().encode(json)); w.close();
                return new Response(cs.readable).arrayBuffer().then(function (buf) { return 'z' + b64(buf); });
            }
            return Promise.resolve('r' + btoa(unescape(encodeURIComponent(json))));
        }
        function unpack(str) {
            function parse(json) { var o = JSON.parse(json); return { type: o.t, sdp: o.s }; }
            if (str.charAt(0) === 'z') {
                var ds = new DecompressionStream('deflate'), w = ds.writable.getWriter();
                w.write(unb64(str.slice(1))); w.close();
                return new Response(ds.readable).arrayBuffer().then(function (buf) { return parse(new TextDecoder().decode(buf)); });
            }
            return Promise.resolve(parse(decodeURIComponent(escape(atob(str.slice(1))))));
        }
        function gathered(pc) {                                // complete SDP: wait for every candidate (at most 5 s)
            return new Promise(function (resolve) {
                if (pc.iceGatheringState === 'complete') return resolve();
                var t = setTimeout(done, 5000);
                function chk() { if (pc.iceGatheringState === 'complete') done(); }
                function done() { pc.removeEventListener('icegatheringstatechange', chk); clearTimeout(t); resolve(); }
                pc.addEventListener('icegatheringstatechange', chk);
            });
        }
        var live = [];                                           // the ping of every open link (pump)
        function newPC() { return new RTCPeerConnection({ iceServers: [] }); }

        // { send(msg) -> boolean, onMessage(fn), onClose(fn), close() }. Messages: any JSON value, 4 KB at most, ordered and reliable;
        // at most 100 per second each way (more are dropped). A ping every second; closed after 5 s of silence.
        // NetLink.pump() runs every open link's ping now: a page whose timers are slowed (the Android app, screen off) calls it.
        function makeConn(pc, dc) {
            var msgH = null, closeH = null, buf = [], closed = false, why = '', last = Date.now(), ping = 0, tx = [], rx = [], sentAt = 0;
            function over(list, max) {
                var t = Date.now(), i = 0;
                while (i < list.length && t - list[i] > 1000) i++;
                if (i) list.splice(0, i);
                if (list.length >= max) return true;
                list.push(t); return false;
            }
            function shut(w) {
                if (closed) return;
                closed = true; why = w; clearInterval(ping);
                var k = live.indexOf(beat); if (k >= 0) live.splice(k, 1);
                try { dc.close(); } catch (e) {}
                try { pc.close(); } catch (e2) {}
                if (closeH) { try { closeH(w); } catch (e3) {} }
            }
            var conn = {
                send: function (m) {
                    if (closed || dc.readyState !== 'open') return false;
                    var s; try { s = JSON.stringify({ m: m }); } catch (e) { return false; }
                    if (s === undefined || s.length > MAX_MSG + 8 || over(tx, TX_PER_S)) return false;
                    try { dc.send(s); return true; } catch (e2) { return false; }
                },
                onMessage: function (fn) { msgH = fn; while (buf.length) fn(buf.shift()); },
                onClose: function (fn) { closeH = fn; if (closed) fn(why); },
                close: function () { shut('closed'); }
            };
            dc.onmessage = function (e) {
                last = Date.now();
                if (typeof e.data !== 'string' || e.data.length > MAX_MSG + 8) return;
                var o; try { o = JSON.parse(e.data); } catch (x) { return; }
                if (!o || !('m' in o) || over(rx, RX_PER_S)) return;      // a ping, or too many
                if (msgH) msgH(o.m); else if (buf.length < 200) buf.push(o.m);
            };
            dc.onclose = function () { shut('closed'); };
            pc.onconnectionstatechange = function () { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') shut('closed'); };
            function beat() {
                var t = Date.now();
                if (closed) return;
                if (t - last > SILENCE_MS) return shut('timeout');
                if (t - sentAt < 800) return;
                sentAt = t;
                try { dc.send('{"p":1}'); } catch (e) {}
            }
            ping = setInterval(beat, 1000); live.push(beat);
            return conn;
        }
        // resolves with the connection once the data channel is open (or rejects after 15 s)
        function opened(pc, dc) {
            return new Promise(function (resolve, reject) {
                var t = setTimeout(function () { try { pc.close(); } catch (e) {} reject(new Error('connect')); }, CONNECT_MS);
                function ok() { clearTimeout(t); resolve(makeConn(pc, dc)); }
                if (dc.readyState === 'open') ok(); else { dc.onopen = ok; }
            });
        }

        // GUEST: offer() -> { offer: string, connect(answerString) -> Promise<conn>, cancel() }
        function offer() {
            var pc = newPC(), dc = pc.createDataChannel('mypc');
            return pc.createOffer().then(function (o) { return pc.setLocalDescription(o); })
                .then(function () { return gathered(pc); })
                .then(function () { return pack(pc.localDescription); })
                .then(function (str) {
                    return {
                        offer: str,
                        connect: function (answer) { return unpack(answer).then(function (d) { return pc.setRemoteDescription(d); }).then(function () { return opened(pc, dc); }); },
                        cancel: function () { try { pc.close(); } catch (e) {} }
                    };
                }, function (e) { try { pc.close(); } catch (x) {} throw e; });
        }
        // HOST: answer(offerString) -> { answer: string, connected: Promise<conn>, cancel() }
        function answer(offerStr) {
            var pc = newPC(), dcP = new Promise(function (resolve) { pc.ondatachannel = function (e) { resolve(e.channel); }; });
            return unpack(offerStr).then(function (d) { return pc.setRemoteDescription(d); })
                .then(function () { return pc.createAnswer(); })
                .then(function (a) { return pc.setLocalDescription(a); })
                .then(function () { return gathered(pc); })
                .then(function () { return pack(pc.localDescription); })
                .then(function (str) {
                    return { answer: str, connected: dcP.then(function (dc) { return opened(pc, dc); }), cancel: function () { try { pc.close(); } catch (e) {} } };
                }, function (e) { try { pc.close(); } catch (x) {} throw e; });
        }
        return { offer: offer, answer: answer, MAX_MSG: MAX_MSG, pump: function () { live.slice().forEach(function (b) { b(); }); }, supported: function () { return typeof RTCPeerConnection !== 'undefined'; } };
    })();
    /* netlink:end */

    var multiplayer = (function () {
        var api = { supported: false };
        var mode = 'none', rpcN = 0, waiting = {}, peers = {}, early = {}, sessions = {};
        var MAX_MSG = 4096, NAME = 24;
        var local = null;                                  // standalone signalling

        function err(code) { return { code: code }; }
        function validMsg(m) { var s; try { s = JSON.stringify(m); } catch (e) { return false; } return s !== undefined && s.length <= MAX_MSG; }

        /* ----- what the app gets: peers and sessions (the same in both modes) ----- */
        function makePeer(id, name, io) {
            var msgH = null, closeH = null, buf = [], closed = false;
            var peer = {
                id: id, name: name,
                send: function (m) { return !closed && validMsg(m) && io.send(m) !== false; },
                onMessage: function (fn) { msgH = fn; while (buf.length) fn(buf.shift()); },
                onClose: function (fn) { closeH = fn; if (closed) fn(); },
                close: function () { if (!closed) io.close(); }
            };
            peer._msg = function (m) {
                if (msgH) { try { msgH(m); } catch (e) { try { console.error('[MyPC] multiplayer: ' + (e && e.stack || e)); } catch (e2) {} } }
                else if (buf.length < 200) buf.push(m);
            };
            peer._closed = function () {
                if (closed) return;
                closed = true;
                for (var k in sessions) sessions[k]._drop(peer);
                delete peers[id];
                if (closeH) { try { closeH(); } catch (e) {} }
            };
            return peer;
        }
        function makeSession(id, closeIo) {
            var list = [], handler = null, buf = [], s = {
                peers: list,
                onPeer: function (fn) { handler = fn; while (buf.length) fn(buf.shift()); },
                close: function () { closeIo(); }
            };
            s._add = function (p) { list.push(p); if (handler) { try { handler(p); } catch (e) {} } else buf.push(p); };
            s._drop = function (p) { var i = list.indexOf(p); if (i >= 0) list.splice(i, 1); };
            sessions[id] = s;
            return s;
        }

        /* ----- in My PC: everything goes to the shell ----- */
        function rpc(op, args) {
            return new Promise(function (resolve, reject) {
                var n = ++rpcN;
                waiting[n] = function (c, res) { if (c) reject(err(c)); else resolve(res); };
                post('mp', { rid: n, op: op, args: args || {} });
            });
        }
        function shellPeer(id, name) {
            var p = makePeer(id, name, { send: function (m) { post('mp', { op: 'send', args: { peer: id, msg: m } }); return true; },
                                         close: function () { post('mp', { op: 'closePeer', args: { peer: id } }); } });
            peers[id] = p;
            var q = early[id]; delete early[id];
            while (q && q.length) p._msg(q.shift());
            return p;
        }
        api._message = function (d) {                      // from the shell
            if (typeof d.rid === 'number') { var w = waiting[d.rid]; delete waiting[d.rid]; if (w) w(d.error, d.result); return; }
            var x = d.data || {};
            if (d.ev === 'peer') { var s = sessions[x.session]; if (s) s._add(shellPeer(x.id, x.name)); }
            else if (d.ev === 'msg') { if (peers[x.peer]) peers[x.peer]._msg(x.msg); else (early[x.peer] = early[x.peer] || []).push(x.msg); }
            else if (d.ev === 'close') { if (peers[x.peer]) peers[x.peer]._closed(); }
        };

        /* ----- standalone: minimal screens ----- */
        var TXT = {
            en: { openT: 'Open a room', openB: 'Open room', joinT: 'Join a friend', joinX: 'Open rooms of this game. The list updates by itself.', none: 'No rooms yet.', wait: 'Waiting for %s to accept...', conn: 'Connecting...', wants: '%s wants to join', yes: 'Accept', no: 'Decline', cancel: 'Cancel', pl: '%s player(s)', e_denied: 'The host said no', e_gone: 'The room is closed', e_timeout: 'No answer from the host', e_connect: "Couldn't connect (same Wi-Fi?)", e_offline: 'No connection' },
            fr: { openT: 'Ouvrir une salle', openB: 'Ouvrir la salle', joinT: 'Rejoindre un ami', joinX: 'Salles ouvertes de ce jeu. La liste se met à jour seule.', none: 'Aucune salle.', wait: "En attente de l'accord de %s...", conn: 'Connexion...', wants: '%s veut rejoindre', yes: 'Accepter', no: 'Refuser', cancel: 'Annuler', pl: '%s joueur(s)', e_denied: "L'hôte a refusé", e_gone: 'La salle est fermée', e_timeout: "Pas de réponse de l'hôte", e_connect: 'Connexion impossible (même Wi-Fi ?)', e_offline: 'Pas de connexion' },
            es: { openT: 'Abrir una sala', openB: 'Abrir sala', joinT: 'Unirse a un amigo', joinX: 'Salas abiertas de este juego. La lista se actualiza sola.', none: 'Aún no hay salas.', wait: 'Esperando a que %s acepte...', conn: 'Conectando...', wants: '%s quiere unirse', yes: 'Aceptar', no: 'Rechazar', cancel: 'Cancelar', pl: '%s jugador(es)', e_denied: 'El anfitrión dijo que no', e_gone: 'La sala está cerrada', e_timeout: 'El anfitrión no respondió', e_connect: 'No se pudo conectar (¿mismo Wi-Fi?)', e_offline: 'Sin conexión' },
            ar: { openT: 'فتح غرفة', openB: 'فتح الغرفة', joinT: 'الانضمام إلى صديق', joinX: 'الغرف المفتوحة لهذه اللعبة. تتحدث القائمة تلقائياً.', none: 'لا توجد غرف بعد.', wait: 'بانتظار موافقة %s...', conn: 'جارٍ الاتصال...', wants: '%s يريد الانضمام', yes: 'قبول', no: 'رفض', cancel: 'إلغاء', pl: '%s لاعب', e_denied: 'رفض المضيف', e_gone: 'الغرفة مغلقة', e_timeout: 'لا رد من المضيف', e_connect: 'تعذر الاتصال (نفس الشبكة؟)', e_offline: 'لا يوجد اتصال' }
        };
        function tx(k) { var l = (info && info.lang) || 'en'; return (TXT[l] || TXT.en)[k]; }
        var box = null, keyH = null;
        // { title, text, items: [{ label, sub, run }], buttons: [{ label, run, primary }], cancel }
        function show(o) {
            hide(true);
            box = document.createElement('div');
            box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
            box.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483000;background:rgba(10,15,44,.96);color:#fff;font:600 3.2vh Arial,sans-serif;padding:8vh 8vw;overflow:auto;' + (info && info.rtl ? 'direction:rtl;' : '');
            var h = document.createElement('div'); h.style.cssText = 'font-size:5vh;color:#ffd23f;margin-bottom:2vh'; h.textContent = o.title; box.appendChild(h);
            var t = document.createElement('div'); t.style.cssText = 'margin-bottom:3vh;color:#cfe9ff'; t.textContent = o.text || ''; box.appendChild(t);
            var btns = [];
            function add(label, run, primary, sub) {
                var b = document.createElement('button');
                b.style.cssText = 'display:block;margin:0 0 1.2vh;padding:1.6vh 2vw;border:0;border-radius:1vh;font:inherit;color:' + (primary ? '#000' : '#fff') + ';background:' + (primary ? '#4cc2ff' : '#1a2250') + ';min-width:40vw;text-align:start;cursor:pointer';
                b.textContent = label + (sub ? '  ·  ' + sub : '');
                b.onfocus = function () { b.style.outline = '0.5vh solid #fff'; }; b.onblur = function () { b.style.outline = 'none'; };
                b.onclick = run; box.appendChild(b); btns.push(b);
            }
            (o.items || []).forEach(function (i) { add(i.label, i.run, false, i.sub); });
            if (!(o.items || []).length && o.empty) { var e = document.createElement('div'); e.textContent = o.empty; e.style.margin = '0 0 2vh'; box.appendChild(e); }
            (o.buttons || []).forEach(function (b) { add(b.label, b.run, b.primary); });
            document.body.appendChild(box);
            if (btns[0]) btns[0].focus();
            keyH = function (e) {
                var k = e.key; if (!box) return;
                var i = btns.indexOf(document.activeElement);
                if (k === 'ArrowDown' || k === 'ArrowRight') { btns[Math.min(btns.length - 1, i + 1)].focus(); }
                else if (k === 'ArrowUp' || k === 'ArrowLeft') { btns[Math.max(0, i - 1)].focus(); }
                else if (k === 'Escape' || k === 'Backspace') { if (o.cancel) o.cancel(); }
                else if (k !== 'Enter' && k !== ' ' && k !== 'Tab') return;
                if (k !== 'Tab') { e.preventDefault(); e.stopPropagation(); if ((k === 'Enter' || k === ' ') && document.activeElement && document.activeElement.click) document.activeElement.click(); }
            };
            document.addEventListener('keydown', keyH, true);
            return btns;
        }
        function hide(keepBlock) {
            if (box && box.parentNode) box.parentNode.removeChild(box);
            box = null;
            if (keyH) document.removeEventListener('keydown', keyH, true);
            keyH = null;
            if (!keepBlock) uiBlock = false;
        }
        function standaloneBlock() { uiBlock = true; held = {}; releaseAll(); }
        function note(text, then) { show({ title: '', text: text, buttons: [] }); setTimeout(function () { hide(); if (then) then(); }, 2200); }

        function localEvents() {                           // events of the standalone signalling, by id
            var handlers = {}, buffered = {};
            return {
                deliver: function (ev, d) {
                    var k = ev + ':' + (ev === 'request' || ev === 'closed' ? d.room : d.req);
                    if (handlers[k]) handlers[k](d); else (buffered[k] = buffered[k] || []).push(d);
                },
                on: function (ev, id, fn) { var k = ev + ':' + id, q = buffered[k]; handlers[k] = fn; delete buffered[k]; while (q && q.length) fn(q.shift()); },
                off: function (ev, id) { delete handlers[ev + ':' + id]; delete buffered[ev + ':' + id]; }
            };
        }
        var ev = localEvents();
        function lc(op, args) { return new Promise(function (resolve, reject) { local.call(op, args, function (c, r) { if (c) reject(err(c)); else resolve(r); }); }); }
        function myName() { return (info && info.profile && info.profile.name) || 'Player'; }

        function localHost(max) {
            return new Promise(function (resolve, reject) {
                standaloneBlock();
                function cancel() { hide(); reject(err('cancelled')); }
                show({ title: tx('openT'), text: myName(), buttons: [{ label: tx('openB'), primary: true, run: confirm }, { label: tx('cancel'), run: cancel }], cancel: cancel });
                function confirm() {
                    lc('open', { name: myName(), max: max + 1 }).then(function (r) {
                        hide();
                        var count = 0, pending = 0, queue = [], asking = false, open = true, mine = [];
                        var s = makeSession('local', function () {
                            if (open) { open = false; lc('close', { room: r.id }).catch(function () {}); }
                            ev.off('request', r.id);
                            mine.slice().forEach(function (p) { p.close(); });
                        });
                        function next() {
                            if (asking || !queue.length) return;
                            var q = queue.shift();
                            if (!open || count + pending >= max) { lc('decline', { room: r.id, req: q.id }).catch(function () {}); return next(); }
                            asking = true; standaloneBlock();
                            show({ title: tx('wants').replace('%s', q.name), text: '', buttons: [{ label: tx('yes'), primary: true, run: function () { hide(); asking = false; accept(q); next(); } }, { label: tx('no'), run: function () { hide(); asking = false; lc('decline', { room: r.id, req: q.id }).catch(function () {}); next(); } }],
                                    cancel: function () { hide(); asking = false; lc('decline', { room: r.id, req: q.id }).catch(function () {}); next(); } });
                        }
                        function accept(q) {
                            pending++;
                            NetLink.answer(q.offer).then(function (a) { return lc('accept', { room: r.id, req: q.id, answer: a.answer }).then(function () { return a.connected; }, function (e) { a.cancel(); throw e; }); })
                                .then(function (conn) {
                                    pending--; count++;
                                    var id = 'peer' + Math.random().toString(36).slice(2, 8), p = makePeer(id, q.name, { send: function (m) { return conn.send(m); }, close: function () { conn.close(); } });
                                    peers[id] = p; mine.push(p);
                                    conn.onMessage(function (m) { p._msg(m); });
                                    conn.onClose(function () { mine.splice(mine.indexOf(p), 1); p._closed(); });
                                    s._add(p);
                                    if (count >= max && open) { open = false; lc('close', { room: r.id }).catch(function () {}); }
                                }).catch(function () { pending--; });
                        }
                        ev.on('request', r.id, function (q) { queue.push(q); next(); });
                        resolve(s);
                    }, function (e) { hide(); reject(e); });
                }
            });
        }

        function localJoin() {
            return new Promise(function (resolve, reject) {
                standaloneBlock();
                var done = false, timer = 0, req = null, offer = null;
                function finish(c, res, msg) {
                    if (done) return; done = true; clearInterval(timer);
                    if (offer) offer.cancel();
                    if (req) { lc('cancel', { req: req }).catch(function () {}); ev.off('answer', req); ev.off('denied', req); }
                    if (c) { if (msg) note(msg, function () { reject(err(c)); }); else { hide(); reject(err(c)); } }
                    else { hide(); resolve(res); }
                }
                function cancel() { finish('cancelled'); }
                function refresh() {
                    if (req || done) return;
                    lc('list', {}).then(function (l) {
                        if (req || done) return;
                        show({ title: tx('joinT'), text: tx('joinX'), empty: tx('none'), items: l.map(function (r) { return { label: r.name, sub: tx('pl').replace('%s', r.count), run: function () { pick(r); } }; }),
                               buttons: [{ label: tx('cancel'), run: cancel }], cancel: cancel });
                    }, function (e) { finish(e.code === 'offline' ? 'offline' : 'connect', null, tx('e_offline')); });
                }
                function waitScreen(text) { show({ title: tx('joinT'), text: text, buttons: [{ label: tx('cancel'), run: cancel }], cancel: cancel }); }
                function pick(r) {
                    clearInterval(timer);
                    waitScreen(tx('wait').replace('%s', r.name));
                    NetLink.offer().then(function (o) {
                        if (done) return o.cancel();
                        offer = o;
                        return lc('ask', { room: r.id, name: myName(), offer: o.offer }).then(function (q) {
                            req = q.id;
                            ev.on('denied', req, function (d) { finish(d.why === 'no' ? 'denied' : d.why === 'gone' ? 'gone' : 'timeout', null, tx('e_' + (d.why === 'no' ? 'denied' : d.why === 'gone' ? 'gone' : 'timeout'))); });
                            ev.on('answer', req, function (d) {
                                waitScreen(tx('conn'));
                                o.connect(d.answer).then(function (conn) {
                                    if (done) return conn.close();
                                    var id = 'peer' + Math.random().toString(36).slice(2, 8), p = makePeer(id, r.name, { send: function (m) { return conn.send(m); }, close: function () { conn.close(); } });
                                    peers[id] = p;
                                    conn.onMessage(function (m) { p._msg(m); });
                                    conn.onClose(function () { p._closed(); });
                                    offer = null; req = null;
                                    finish(null, p);
                                }, function () { finish('connect', null, tx('e_connect')); });
                            });
                        });
                    }).catch(function (e) { var c = e && e.code === 'full' ? 'denied' : e && e.code === 'gone' ? 'gone' : e && e.code === 'denied' ? 'denied' : 'connect'; finish(c, null, tx('e_' + c)); });
                }
                refresh(); timer = setInterval(refresh, 3000);
            });
        }

        /* ----- standalone signalling between tabs (BroadcastChannel + localStorage), same limits as the shell ----- */
        function makeLocal() {
            var L = { name: 24, payload: 6000, ttl: 45000, beat: 15000, askTtl: 60000, asksPerMin: 5, opensPerMin: 6, listMax: 20 };
            var KEY = 'mypc_rooms:' + location.pathname, bc;
            try { bc = new BroadcastChannel(KEY); } catch (e) { return null; }
            var mine = null, asks = {}, opens = [], askRate = [];
            function reg() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
            function save(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} }
            function rid(n) { var s = '', a = 'abcdefghjkmnpqrstuvwxyz23456789'; while (n--) s += a.charAt(Math.floor(Math.random() * a.length)); return s; }
            function rate(list, max) {
                var t = Date.now(), i;
                for (i = list.length - 1; i >= 0; i--) if (t - list[i] > 60000) list.splice(i, 1);
                if (list.length >= max) return false;
                list.push(t); return true;
            }
            function clean(s) { return typeof s === 'string' ? s.replace(/\s+/g, ' ').slice(0, L.name) : ''; }
            function refresh() {
                if (!mine) return;
                var o = reg();
                if (!o[mine.id]) { clearInterval(mine.timer); var gone = mine; mine = null; ev.deliver('closed', { room: gone.id }); return; }
                o[mine.id].exp = Date.now() + L.ttl; o[mine.id].n = mine.n; save(o);
            }
            function finish(a, why) { clearTimeout(a.timer); delete asks[a.id]; if (why) ev.deliver('denied', { req: a.id, why: why }); }
            bc.onmessage = function (e) {
                var m = e.data, a;
                if (!m || typeof m.t !== 'string') return;
                if (m.t === 'ask' && mine && mine.id === m.room) ev.deliver('request', { room: m.room, id: m.req, name: m.name, offer: m.offer });
                else if (m.t === 'answer' && (a = asks[m.req])) { finish(a, null); ev.deliver('answer', { req: m.req, answer: m.answer }); }
                else if (m.t === 'no' && (a = asks[m.req])) finish(a, 'no');
                else if (m.t === 'closed') for (var k in asks) if (asks[k].room === m.room) finish(asks[k], 'gone');
            };
            window.addEventListener('beforeunload', function () { if (mine) { var o = reg(); delete o[mine.id]; save(o); bc.postMessage({ t: 'closed', room: mine.id }); } });
            var ops = {
                open: function (a, cb) {
                    if (mine) return cb('denied');
                    if (!rate(opens, L.opensPerMin)) return cb('denied');
                    var max = Math.max(2, Math.min(8, Math.floor(+a.max || 2))), o = reg(), r = { id: rid(8), name: clean(a.name) || 'Player', max: max, n: 1, at: Date.now(), exp: Date.now() + L.ttl };
                    o[r.id] = r; save(o);
                    mine = { id: r.id, n: 1, max: max, timer: setInterval(refresh, L.beat) };
                    cb(null, { id: r.id, name: r.name, max: max });
                },
                list: function (a, cb) {
                    var o = reg(), out = [], k;
                    for (k in o) if (o[k] && o[k].exp > Date.now()) out.push(o[k]);
                    out.sort(function (x, y) { return y.at - x.at; });
                    cb(null, out.slice(0, L.listMax).map(function (r) { return { id: r.id, name: r.name, count: r.n }; }));
                },
                ask: function (a, cb) {
                    if (typeof a.room !== 'string' || typeof a.offer !== 'string' || !a.offer || a.offer.length > L.payload) return cb('invalid');
                    if (!rate(askRate, L.asksPerMin)) return cb('denied');
                    var r = reg()[a.room];
                    if (!r || r.exp < Date.now()) return cb('gone');
                    if (r.n >= r.max) return cb('full');
                    var q = { id: rid(10), room: a.room };
                    q.timer = setTimeout(function () { finish(q, 'timeout'); }, L.askTtl);
                    asks[q.id] = q;
                    bc.postMessage({ t: 'ask', room: a.room, req: q.id, name: clean(a.name) || 'Player', offer: a.offer });
                    cb(null, { id: q.id });
                },
                cancel: function (a, cb) { if (asks[a.req]) finish(asks[a.req], null); cb(null, true); },
                accept: function (a, cb) {
                    if (!mine || mine.id !== a.room) return cb('gone');
                    if (typeof a.answer !== 'string' || !a.answer || a.answer.length > L.payload) return cb('invalid');
                    if (mine.n >= mine.max) { bc.postMessage({ t: 'no', req: a.req }); return cb('full'); }
                    mine.n++; refresh();
                    bc.postMessage({ t: 'answer', req: a.req, answer: a.answer });
                    cb(null, true);
                },
                decline: function (a, cb) { if (!mine || mine.id !== a.room) return cb('gone'); bc.postMessage({ t: 'no', req: a.req }); cb(null, true); },
                close: function (a, cb) {
                    if (mine && mine.id === a.room) {
                        clearInterval(mine.timer);
                        var o = reg(); delete o[mine.id]; save(o);
                        bc.postMessage({ t: 'closed', room: mine.id });
                        mine = null;
                    }
                    cb(null, true);
                }
            };
            return { call: function (op, args, cb) { if (!ops.hasOwnProperty(op)) return cb('invalid'); ops[op](args, cb); } };
        }

        api._enable = function (m) {                       // 'shell' (My PC), 'local' (standalone tabs) or 'none' (an older My PC)
            if (typeof Promise === 'undefined' || m === 'none') return;
            if (m === 'shell') { mode = 'shell'; api.supported = true; return; }
            if (!NetLink.supported()) return;
            local = makeLocal();
            if (local) { mode = 'local'; api.supported = true; }
        };

        /* ----- the public API ----- */
        api.host = function (o) {
            o = o || {};
            if (!api.supported) return Promise.reject(err('unavailable'));
            var max = Math.floor(+o.max || 1);
            if (max < 1 || max > 7) return Promise.reject(err('invalid'));
            if (mode === 'local') return localHost(max);
            return rpc('host', { max: max }).then(function (r) { return makeSession(r.session, function () { post('mp', { op: 'closeSession', args: {} }); }); });
        };
        api.join = function () {
            if (!api.supported) return Promise.reject(err('unavailable'));
            if (mode === 'local') return localJoin();
            return rpc('join', {}).then(function (r) { return shellPeer(r.peer.id, r.peer.name); });
        };
        return api;
    })();

    /* ---------------- touch controls: MyPC.pad ----------------
     * In My PC the SHELL draws the touch pad above the app on touch devices (nothing to do for the app; see "Touch controls" in
     * the guide). This bundles the same library for the cases where the app draws it itself: standalone on a phone
     * (MyPC.init({ pad: true })) or a phone that is only a controller (MyPC.pad.init({ force: true, ... })). */
    /* vpad:begin (generated by tools/sync-pad.mjs from sdk/pad/virtual-pad.js: do not edit here) */
    /* Source: https://github.com/imad-os/g_rpg  pad/virtual-pad.js, version 1.0.0 (copied into My PC; docs: sdk/pad/README.md).
     * Changes made in the My PC copy (the original in g_rpg has none of them yet):
     *   1. option `onSettings(open)`: called with true when the settings panel opens (gear button or openSettings()) and with false
     *      when it closes (Close button). My PC pauses the game while the panel is open.
     *   2. floating stick (option `floating`, on by default): a touch anywhere in the left half of the screen puts the stick
     *      there and drives it, like modern mobile games; it goes back to its place when the finger is lifted.
     *   3. option `storage` ({ get(key), set(key, value) }): where the player's layout is kept (My PC passes its own store so
     *      the layout is saved with the device); localStorage otherwise. Button labels are centred.
     *   4. button option `place` ('right' | 'bottom' | 'top' | 'left'): the four face buttons in a diamond, like a Nintendo
     *      controller (A right, B bottom, X top, Y left); optional `color` for the label. Buttons without it stack as before.
     *   5. option `dpad` (true): a D-pad (four arrows in a cross, eight directions when two are pressed) in place of the stick, at
     *      the stick's place and size; it does not float. It sends the same 'left' 'right' 'up' 'down' as the stick.
     *   6. option `home` (true): a round Home button (⌂, like a Nintendo Switch's) below and left of the face buttons; it sends
     *      the action 'home' (key 36, Home). It can be moved like the other controls.
     *   7. the + and Home buttons are in the settings panel's button list like the others (shown / hidden, moved, sized with the
     *      buttons); + is shown by default (unless `pause: false`), Home only with `home: true`. Option `dpadSwitch` (true): the panel
     *      offers a D-pad in place of the stick (saved with the layout; the D-pad does not take the left half of the screen, so
     *      taps reach the game). Option `onHide` (function): the panel offers "Hide the pad" and calls it (the host shows it again).
     * Do not edit this file in the shell or the SDK: the copies in js/core/virtual-pad.js and inside sdk/mypc-sdk.js are generated
     * from this one with `node tools/sync-pad.mjs` (a test keeps them identical). */
    /* Virtual gamepad for My PC games: a joystick and buttons for phones.
     * Standalone and game-independent: copy this one file into any My PC game.
     *
     *   <script src="virtual-pad.js"></script>          (after the SDK)
     *   VirtualPad.init();                              // joystick + A (OK) + B (run) + pause; shown standalone on touch devices
     *   VirtualPad.init({ id: 'pad', buttons: [{ label: 'A', key: 13 }, { label: 'B', key: 88 }],
     *                     catalog: [{ label: 'A', key: 13 }, { label: 'B', key: 88 }, { label: 'X', key: 77 }, { label: 'Y', key: 90 }] });
     *
     * Customizable by the player: the gear button opens a panel to add or hide buttons (any entry of `catalog`),
     * make the stick and the buttons bigger or smaller, drag everything where it feels right, and reset. The choices
     * are kept on the device (localStorage, per `id`). Options:
     *   buttons  the buttons shown at first          catalog  every button the player may add (default: buttons)
     *   id       name for the saved layout           scale    { stick, btn } starting size multipliers (default 1; use ~1.3 for a pure controller)
     *   pause    false hides the + (pause / menu) button        force    show anywhere (default: standalone on a touch device)
     *   send     function (keyCode, down): route the keys somewhere else (e.g. over the network) instead of pressing them here
     *   dpad     true: a D-pad in place of the stick  home     true: a Home button (action 'home', key 36)
     *   customize false hides the gear button          onAction function (action, down): call the game's own input system for buttons that have an `action`
     *                                                   (e.g. { label: 'A', key: 13, action: 'jump' }); the stick sends 'left' 'right' 'up' 'down'; the pause button 'pause'
     * API: VirtualPad.init(opt), .hide(), .openSettings() (open the settings panel from your own menu), .active(), .version
     * ?pad=1 in the address forces the pad on, ?pad=0 hides it.
     * Without `send` it presses the keys the SDK already reads in standalone mode (arrows, Enter, X, Esc).
     * Key codes: 13 Enter (OK / jump), 32 Space, 88 X (run / fire), 8 Backspace (cancel), 27 Esc (pause menu), 80 P. */
    var VirtualPad = (function () {
        'use strict';
        var DEFAULT = [{ label: 'A', key: 13, place: 'right' }, { label: 'B', key: 88, place: 'bottom' }];     // A B X Y in the Nintendo places, never A B C
        var DIRS = { left: 37, up: 38, right: 39, down: 40 };
        var TXT = {
            en: { opts: 'Pad settings', btns: 'Buttons', stick: 'Stick size', btn: 'Button size', move: 'Move', done: 'Done', reset: 'Reset', close: 'Close', dir: 'Directions', jstick: 'Stick', dpad: 'D-pad', hide: 'Hide the pad', home: 'Home' },
            fr: { opts: 'Réglages de la manette', btns: 'Boutons', stick: 'Taille du joystick', btn: 'Taille des boutons', move: 'Déplacer', done: 'Terminé', reset: 'Réinitialiser', close: 'Fermer', dir: 'Directions', jstick: 'Joystick', dpad: 'Croix', hide: 'Masquer la manette', home: 'Accueil' },
            es: { opts: 'Ajustes del mando', btns: 'Botones', stick: 'Tamaño del joystick', btn: 'Tamaño de los botones', move: 'Mover', done: 'Listo', reset: 'Restablecer', close: 'Cerrar', dir: 'Direcciones', jstick: 'Joystick', dpad: 'Cruceta', hide: 'Ocultar el mando', home: 'Inicio' },
            ar: { opts: 'إعدادات اليد', btns: 'الأزرار', stick: 'حجم العصا', btn: 'حجم الأزرار', move: 'تحريك', done: 'تم', reset: 'إعادة ضبط', close: 'إغلاق', dir: 'الاتجاهات', jstick: 'عصا', dpad: 'أزرار الاتجاه', hide: 'إخفاء اليد', home: 'الرئيسية' }
        };
        var settingsOpen = false, bound = false, root = null, down = {}, downInfo = {}, sendFn = null, o = null, cfg = null, els = {}, panel = null, editing = false, doneBtn = null, lastOpt = null;

        function tx(k) { var l = (document.documentElement.lang || 'en').slice(0, 2); return (TXT[l] || TXT.en)[k]; }
        // one control state change. With `onAction` (and a button that has an `action`) the game's own input system is called;
        // otherwise the key goes to `send`, or is pressed as a keyboard event for the SDK's standalone mode.
        function press(code, on, action) {
            var viaAction = !!(o && o.onAction && action), id = viaAction ? 'a:' + action : code;
            if (!!down[id] === on) return;
            down[id] = on; downInfo[id] = { code: code, action: action };
            if (viaAction) { o.onAction(action, on); return; }
            if (sendFn) { sendFn(code, on); return; }
            var e = new KeyboardEvent(on ? 'keydown' : 'keyup', { bubbles: true, cancelable: true });
            Object.defineProperty(e, 'keyCode', { get: function () { return code; } });
            document.dispatchEvent(e);
        }
        function releaseAll() { for (var k in down) if (down[k]) press(downInfo[k].code, false, downInfo[k].action); }
        function wanted(opt) {
            if (opt.force) return true;
            var m = /[?&]pad=(\d)/.exec(location.search);
            if (m) return m[1] === '1';
            var standalone = !window.MyPC || !MyPC.info || !MyPC.info() || MyPC.info().standalone;
            return standalone && (('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || matchMedia('(pointer:coarse)').matches);
        }
        // My PC change: o.onSettings(open) tells the host when the settings panel opens or closes (My PC pauses the game meanwhile)
        function noteSettings(v) { if (settingsOpen === v) return; settingsOpen = v; if (o && o.onSettings) { try { o.onSettings(v); } catch (e) {} } }
        function showPanel() { releaseAll(); panel.style.display = 'block'; noteSettings(true); }
        function el(tag, css, parent, text) { var e = document.createElement(tag); e.style.cssText = css; if (parent) parent.appendChild(e); if (text) e.textContent = text; return e; }

        /* ---------- the player's layout: which buttons, sizes, positions (fractions of the window) ---------- */
        function storeKey() { return 'vpad:' + (o.id || 'default'); }
        function loadCfg() {
            var c = null;
            try { c = o.storage ? o.storage.get(storeKey()) : JSON.parse(localStorage.getItem(storeKey()) || 'null'); } catch (e) {}
            if (!c || typeof c !== 'object') { try { c = JSON.parse(localStorage.getItem(storeKey()) || 'null'); } catch (e) { c = null; } }
            c = c || {};
            c.on = c.on || {}; c.pos = c.pos || {};
            c.s = +c.s || 1; c.b = +c.b || 1;
            return c;
        }
        function saveCfg() {
            try { localStorage.setItem(storeKey(), JSON.stringify(cfg)); } catch (e) {}
            if (o.storage) { try { o.storage.set(storeKey(), JSON.parse(JSON.stringify(cfg))); } catch (e) {} }
        }
        function isOn(b) { var v = cfg.on[b.key]; return v === undefined ? o.buttons.some(function (d) { return d.key === b.key; }) : !!v; }
        // My PC change 7: the + and Home buttons are shown / hidden like the others ('pause' / 'home' in the layout)
        function extraOn(k) { var v = cfg.on[k]; return k === 'pause' ? o.pause && (v === undefined || !!v) : o.home !== false && (v === undefined ? o.home === true : !!v); }

        /* ---------- drawing and placing ---------- */
        function sizes() {
            var vm = Math.min(window.innerWidth, window.innerHeight) / 100;
            return { vm: vm, stick: Math.min(34 * vm, 200) * (o.scale.stick || 1) * cfg.s, btn: Math.min(17 * vm, 100) * (o.scale.btn || 1) * cfg.b };
        }
        function place(e, cx, cy, size) {
            var W = window.innerWidth, H = window.innerHeight, h = size / 2;
            cx = Math.max(h, Math.min(W - h, cx)); cy = Math.max(h, Math.min(H - h, cy));
            e.style.width = e.style.height = size + 'px'; e.style.left = (cx - h) + 'px'; e.style.top = (cy - h) + 'px';
            if (e.id === 'vp-stick') { var k = els.knob, ks = size * 0.44; k.style.width = k.style.height = ks + 'px'; k.style.left = (size - ks) / 2 + 'px'; k.style.top = (size - ks) / 2 + 'px'; }
            else e.style.fontSize = Math.max(e.id === 'vp-dpad' ? 10 : 14, size * (e.id === 'vp-dpad' ? 0.12 : 0.3)) + 'px';
        }
        function layout() {
            if (!root) return;
            var W = window.innerWidth, H = window.innerHeight, z = sizes(), p;
            p = cfg.pos.stick; place(els.stick, p ? p.x * W : 4 * z.vm + z.stick / 2, p ? p.y * H : H - 4 * z.vm - z.stick / 2, z.stick);
            var i = 0, D = { right: [1, 0], bottom: [0, 1], top: [0, -1], left: [-1, 0] };
            var dd = z.btn * 0.92 + z.vm, dcx = W - 4 * z.vm - z.btn / 2 - dd, dcy = H - 4 * z.vm - z.btn / 2 - dd;    // the diamond's centre
            o.catalog.forEach(function (b) {
                var e = els['b' + b.key]; if (!e) return;
                var on = isOn(b); e.style.display = on ? 'flex' : 'none'; if (!on) return;
                p = cfg.pos['b' + b.key];
                if (D[b.place]) { place(e, p ? p.x * W : dcx + D[b.place][0] * dd, p ? p.y * H : dcy + D[b.place][1] * dd, z.btn); return; }
                var sp = z.btn + 2 * z.vm, col = i % 2, row = i >> 1;
                place(e, p ? p.x * W : W - 4 * z.vm - z.btn / 2 - col * sp, p ? p.y * H : H - 5 * z.vm - z.btn / 2 - row * sp - col * z.btn * 0.53, z.btn);
                i++;
            });
            if (els.home) {                                    // below and left of the diamond, like the Switch's Home button
                var hs = z.btn * 0.62; p = cfg.pos.home;
                els.home.style.display = extraOn('home') ? 'flex' : 'none';
                place(els.home, p ? p.x * W : dcx - dd * 2.1, p ? p.y * H : dcy + dd * 0.55, hs);
            }
            if (els.pause) {                                   // a pill at the top centre, sized with the buttons
                var pw = Math.max(12 * z.vm * cfg.b * (o.scale.btn || 1), 28), ph = pw / 2, px, py; p = cfg.pos.pause;
                px = Math.max(pw / 2, Math.min(W - pw / 2, p ? p.x * W : W / 2)); py = Math.max(ph / 2, Math.min(H - ph / 2, p ? p.y * H : 2 * z.vm + ph / 2));
                var ps = els.pause.style; ps.display = extraOn('pause') ? 'flex' : 'none';
                ps.width = pw + 'px'; ps.height = ph + 'px'; ps.left = (px - pw / 2) + 'px'; ps.top = (py - ph / 2) + 'px'; ps.borderRadius = ph / 2 + 'px'; ps.fontSize = ph * 0.83 + 'px';
            }
            // while moving things around the controls are outlined
            var all = [els.stick, els.home, els.pause].concat(o.catalog.map(function (b) { return els['b' + b.key]; }));
            all.forEach(function (e) { if (e) e.style.outline = editing ? '2px dashed #ffd23f' : 'none'; });
        }
        function drag(e, id) {            // in "move" mode a control follows the finger and its place is remembered
            var pid = null;
            e.addEventListener('pointerdown', function (ev) {
                if (!editing) return; pid = ev.pointerId; e.setPointerCapture(pid); ev.preventDefault(); ev.stopImmediatePropagation();
            }, true);
            e.addEventListener('pointermove', function (ev) {
                if (!editing || ev.pointerId !== pid) return;
                var W = window.innerWidth, H = window.innerHeight; cfg.pos[id] = { x: ev.clientX / W, y: ev.clientY / H }; layout(); ev.stopImmediatePropagation();
            }, true);
            e.addEventListener('pointerup', function (ev) { if (editing && ev.pointerId === pid) { pid = null; saveCfg(); ev.stopImmediatePropagation(); } }, true);
        }
        // My PC change 5: a D-pad in place of the stick, with the buttons' look; a finger can slide from arrow to arrow, and
        // between two arrows both are pressed (diagonals)
        function makeDpad() {
            var base = el('div', 'position:absolute;touch-action:none;pointer-events:auto;box-sizing:border-box', root);
            base.id = 'vp-dpad'; els.stick = base; els.arms = {};
            var ARM = 'position:absolute;background:rgba(255,255,255,0.14);border:2px solid rgba(255,255,255,0.35);box-sizing:border-box;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.75);font:700 1em sans-serif;pointer-events:none';
            var A = { up: ['left:33%;top:0;width:34%;height:38%;border-radius:18% 18% 0 0;border-bottom:0', '▲'],
                      down: ['left:33%;bottom:0;width:34%;height:38%;border-radius:0 0 18% 18%;border-top:0', '▼'],
                      left: ['top:33%;left:0;width:38%;height:34%;border-radius:18% 0 0 18%;border-right:0', '◀'],
                      right: ['top:33%;right:0;width:38%;height:34%;border-radius:0 18% 18% 0;border-left:0', '▶'] };
            el('div', 'position:absolute;left:33%;top:33%;width:34%;height:34%;background:rgba(255,255,255,0.14);pointer-events:none', base);
            for (var k in A) els.arms[k] = el('div', ARM + ';' + A[k][0], base, A[k][1]);
            var id = null;
            function set(dir, on) { press(DIRS[dir], on, dir); els.arms[dir].style.background = on ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.14)'; }
            function move(ev) {
                var r = base.getBoundingClientRect(), R = r.width / 2, dx = ev.clientX - (r.left + R), dy = ev.clientY - (r.top + R), t = R * 0.16;
                var ax = Math.abs(dx), ay = Math.abs(dy), h = ax > t && ax >= ay * 0.414, v = ay > t && ay >= ax * 0.414;
                set('left', h && dx < 0); set('right', h && dx > 0); set('up', v && dy < 0); set('down', v && dy > 0);
            }
            function end(ev) { if (ev.pointerId !== id) return; id = null; for (var k in DIRS) set(k, false); }
            base.addEventListener('pointerdown', function (ev) { if (editing || id !== null) return; id = ev.pointerId; base.setPointerCapture(id); move(ev); ev.preventDefault(); });
            base.addEventListener('pointermove', function (ev) { if (!editing && ev.pointerId === id) move(ev); });
            base.addEventListener('pointerup', end); base.addEventListener('pointercancel', end);
            drag(base, 'stick');
        }
        // My PC change 6: the Home button (like a Nintendo Switch's), action 'home'
        function makeHome() {
            var e = el('div', 'position:absolute;border-radius:50%;background:rgba(255,255,255,0.14);border:2px solid rgba(255,255,255,0.35);color:#fff;display:flex;align-items:center;justify-content:center;touch-action:none;pointer-events:auto;box-sizing:border-box', root);
            e.id = 'vp-home'; e.setAttribute('aria-label', 'Home'); els.home = e;
            e.innerHTML = '<svg viewBox="0 0 24 24" width="58%" height="58%" fill="none" stroke="#fff" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" style="pointer-events:none"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/></svg>';
            function on(v) { return function (ev) { if (editing) return; press(36, v, 'home'); e.style.background = v ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.14)'; ev.preventDefault(); }; }
            e.addEventListener('pointerdown', on(true)); e.addEventListener('pointerup', on(false)); e.addEventListener('pointercancel', on(false)); e.addEventListener('pointerleave', on(false));
            drag(e, 'home');
        }
        function makeStick() {
            var base = el('div', 'position:absolute;border-radius:50%;background:rgba(255,255,255,0.14);border:2px solid rgba(255,255,255,0.35);touch-action:none;pointer-events:auto;box-sizing:border-box', root);
            base.id = 'vp-stick'; els.stick = base;
            els.knob = el('div', 'position:absolute;border-radius:50%;background:rgba(255,255,255,0.5);pointer-events:none', base);
            var id = null, src = null;
            function move(ev) {
                var r = base.getBoundingClientRect(), R = r.width / 2;
                var dx = ev.clientX - (r.left + R), dy = ev.clientY - (r.top + R), d = Math.sqrt(dx * dx + dy * dy) || 1, k = Math.min(1, R * 0.6 / d);
                els.knob.style.transform = 'translate(' + dx * k + 'px,' + dy * k + 'px)';
                var t = R * 0.3;
                press(DIRS.left, dx < -t, 'left'); press(DIRS.right, dx > t, 'right'); press(DIRS.up, dy < -t, 'up'); press(DIRS.down, dy > t, 'down');
            }
            function end(ev) {
                if (ev.pointerId !== id) return;
                id = null; src = null; els.knob.style.transform = '';
                for (var k in DIRS) press(DIRS[k], false, k);
                if (o.floating) layout();                    // back to its place
            }
            base.addEventListener('pointerdown', function (ev) { if (editing || id !== null) return; id = ev.pointerId; base.setPointerCapture(id); move(ev); ev.preventDefault(); });
            base.addEventListener('pointermove', function (ev) { if (!editing && ev.pointerId === id) move(ev); });
            base.addEventListener('pointerup', end); base.addEventListener('pointercancel', end);
            drag(base, 'stick');
            // floating: a touch in the left half (outside the other controls) moves the stick under the finger and drives it
            if (o.floating) {
                var zone = els.zone;
                zone.addEventListener('pointerdown', function (ev) {
                    if (editing || id !== null) return;
                    var size = base.getBoundingClientRect().width;
                    place(base, ev.clientX, ev.clientY, size);
                    id = ev.pointerId; src = zone;
                    try { zone.setPointerCapture(id); } catch (e) {}
                    move(ev); ev.preventDefault();
                });
                zone.addEventListener('pointermove', function (ev) { if (!editing && ev.pointerId === id) move(ev); });
                zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);
            }
        }
        function makeButton(b) {
            var e = el('div', 'position:absolute;border-radius:50%;background:rgba(255,255,255,0.14);border:2px solid rgba(255,255,255,0.35);color:' + (b.color || '#fff') + ';font-family:sans-serif;font-weight:700;display:flex;align-items:center;justify-content:center;touch-action:none;pointer-events:auto;box-sizing:border-box', root, b.label);
            els['b' + b.key] = e;
            function on(v) { return function (ev) { if (editing) return; press(b.key, v, b.action); e.style.background = v ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.14)'; ev.preventDefault(); }; }
            e.addEventListener('pointerdown', on(true)); e.addEventListener('pointerup', on(false)); e.addEventListener('pointercancel', on(false)); e.addEventListener('pointerleave', on(false));
            drag(e, 'b' + b.key);
        }

        /* ---------- the settings panel ---------- */
        var PB = 'font:700 max(15px,3.2vmin) sans-serif;padding:1.2vmin 2.4vmin;border-radius:1.2vmin;border:2px solid rgba(255,255,255,0.5);background:rgba(255,255,255,0.14);color:#fff;cursor:pointer;touch-action:manipulation;user-select:none;-webkit-user-select:none';
        function setEditing(v) {
            editing = v; releaseAll();
            if (doneBtn) { doneBtn.remove(); doneBtn = null; }
            if (v) {
                panel.style.display = 'none';
                doneBtn = el('div', PB + ';position:fixed;top:2vmin;left:50%;transform:translateX(-50%);pointer-events:auto;background:#ffd23f;color:#000', root, tx('done'));
                doneBtn.addEventListener('click', function () { setEditing(false); panel.style.display = 'block'; });
            }
            layout();
        }
        function buildPanel() {
            panel = el('div', 'position:fixed;inset:0;display:none;background:rgba(5,6,12,0.94);color:#fff;font-family:sans-serif;pointer-events:auto;overflow:auto;touch-action:pan-y', root);
            panel.dir = (document.documentElement.dir === 'rtl') ? 'rtl' : 'ltr';
            ['touchmove', 'touchend', 'contextmenu'].forEach(function (t) { panel.addEventListener(t, function (e) { e.stopPropagation(); }); });
            var box = el('div', 'max-width:min(94vw,640px);margin:0 auto;padding:3vmin 0', panel);
            el('div', 'font-size:max(20px,4.4vmin);font-weight:800;color:#ffd76a;margin-bottom:2vmin', box, tx('opts'));
            el('div', 'font-size:max(15px,3vmin);color:#9fb0c8;margin-bottom:1vmin', box, tx('btns'));
            var row = el('div', 'display:flex;flex-wrap:wrap;gap:1.2vmin;margin-bottom:2.4vmin', box), chips = [];
            o.catalog.forEach(function (b) {
                var c = el('div', PB + ';min-width:7vmin;text-align:center', row, b.label); chips.push([c, b]);
                c.addEventListener('click', function () { cfg.on[b.key] = !isOn(b); saveCfg(); sync(); layout(); });
            });
            var extras = [];
            if (els.pause) extras.push(['pause', '+']);
            if (els.home) extras.push(['home', '⌂']);
            extras.forEach(function (x) {
                var c = el('div', PB + ';min-width:7vmin;text-align:center', row, x[1]); c.setAttribute('aria-label', x[0] === 'home' ? tx('home') : '+'); chips.push([c, x[0]]);
                c.addEventListener('click', function () { cfg.on[x[0]] = !extraOn(x[0]); saveCfg(); sync(); layout(); });
            });
            if (o.dpadSwitch) {                                // a D-pad in place of the stick: built again, the panel stays open
                el('div', 'font-size:max(15px,3vmin);color:#9fb0c8;margin-bottom:1vmin', box, tx('dir'));
                var dr = el('div', 'display:flex;flex-wrap:wrap;gap:1.2vmin;margin-bottom:2.4vmin', box);
                [[false, tx('jstick')], [true, tx('dpad')]].forEach(function (d) {
                    var c = el('div', PB + (o.dpad === d[0] ? ';background:#ffd23f;color:#000' : ''), dr, d[1]);
                    c.addEventListener('click', function () { if (o.dpad === d[0]) return; cfg.dp = d[0]; saveCfg(); rebuild(); });
                });
            }
            function stepper(label, get, set) {
                var r = el('div', 'display:flex;align-items:center;gap:1.5vmin;margin-bottom:1.6vmin;font-size:max(15px,3.2vmin)', box);
                el('div', 'flex:1', r, label);
                var m = el('div', PB, r, '−'), v = el('div', 'min-width:6ch;text-align:center', r), p = el('div', PB, r, '+');
                function upd() { v.textContent = Math.round(get() * 100) + '%'; }
                m.addEventListener('click', function () { set(Math.max(0.6, get() - 0.1)); upd(); saveCfg(); layout(); });
                p.addEventListener('click', function () { set(Math.min(2.2, get() + 0.1)); upd(); saveCfg(); layout(); });
                upd(); return upd;
            }
            var u1 = stepper(tx('stick'), function () { return cfg.s; }, function (x) { cfg.s = x; });
            var u2 = stepper(tx('btn'), function () { return cfg.b; }, function (x) { cfg.b = x; });
            var foot = el('div', 'display:flex;gap:1.5vmin;flex-wrap:wrap;margin-top:1vmin', box);
            el('div', PB, foot, tx('move')).addEventListener('click', function () { setEditing(true); });
            el('div', PB, foot, tx('reset')).addEventListener('click', function () { var dp = o.dpad; cfg = { on: {}, pos: {}, s: 1, b: 1 }; saveCfg(); if (o.dpadSwitch && dp !== !!lastOpt.dpad) { rebuild(); return; } sync(); u1(); u2(); layout(); });
            if (o.onHide) el('div', PB, foot, tx('hide')).addEventListener('click', function () { panel.style.display = 'none'; noteSettings(false); try { o.onHide(); } catch (e) {} });
            el('div', PB + ';background:#ffd23f;color:#000', foot, tx('close')).addEventListener('click', function () { panel.style.display = 'none'; noteSettings(false); });
            function sync() { chips.forEach(function (c) { var on = typeof c[1] === 'string' ? extraOn(c[1]) : isOn(c[1]); c[0].style.background = on ? '#ffd23f' : 'rgba(255,255,255,0.14)'; c[0].style.color = on ? '#000' : '#fff'; }); }
            sync();
        }

        function init(opt) {
            opt = opt || {};
            if (root || !wanted(opt)) return;
            lastOpt = opt;
            o = { id: opt.id, onAction: opt.onAction || null, onSettings: opt.onSettings || null, home: opt.home === true ? true : opt.home === false ? false : null, pause: opt.pause !== false,
                  dpadSwitch: !!opt.dpadSwitch, onHide: typeof opt.onHide === 'function' ? opt.onHide : null,
                  storage: opt.storage && typeof opt.storage.get === 'function' && typeof opt.storage.set === 'function' ? opt.storage : null, buttons: opt.buttons || DEFAULT, scale: opt.scale || {}, customize: opt.customize !== false };
            o.catalog = opt.catalog || o.buttons;
            o.buttons.forEach(function (b) { if (!o.catalog.some(function (c) { return c.key === b.key; })) o.catalog = o.catalog.concat([b]); });
            sendFn = opt.send || null; cfg = loadCfg(); editing = false;
            o.dpad = o.dpadSwitch && typeof cfg.dp === 'boolean' ? cfg.dp : !!opt.dpad;          // the player's choice wins where the host offers it
            o.floating = opt.floating !== false && !o.dpad;
            if (!bound) {                                      // like a native app: no pinch zoom, no double-tap zoom, no page scroll or text selection while playing
                bound = true;
                ['touchmove', 'gesturestart', 'gesturechange', 'contextmenu'].forEach(function (t) { document.addEventListener(t, function (e) { e.preventDefault(); }, { passive: false }); });
                var lastTap = 0; document.addEventListener('touchend', function (e) { var n = Date.now(); if (n - lastTap < 350) e.preventDefault(); lastTap = n; }, { passive: false });
                // never leave a key held when the page goes away (phone locked, app switched)
                document.addEventListener('visibilitychange', function () { if (document.hidden) releaseAll(); });
                window.addEventListener('blur', releaseAll);
            }
            root = el('div', 'position:fixed;inset:0;z-index:99999;pointer-events:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none', document.body);
            els = {};
            if (o.floating) els.zone = el('div', 'position:absolute;left:0;top:14vmin;width:50%;bottom:0;pointer-events:auto;touch-action:none', root);   // under every control
            if (o.dpad) makeDpad(); else makeStick();
            o.catalog.forEach(makeButton);
            if (o.home === true || (o.home === null && o.customize)) makeHome();     // offered in the panel even when hidden by default
            window.addEventListener('resize', layout);
            if (o.pause) {
                var p = el('div', 'position:absolute;box-sizing:border-box;background:rgba(255,255,255,0.14);border:2px solid rgba(255,255,255,0.35);color:#fff;font-weight:800;font-family:sans-serif;display:flex;align-items:center;justify-content:center;touch-action:none;pointer-events:auto', root, '+');   // a Nintendo-style + button: pause / menu
                p.id = 'vp-plus'; els.pause = p;
                p.addEventListener('pointerdown', function (ev) { if (editing) return; press(27, true, 'pause'); press(27, false, 'pause'); ev.preventDefault(); });
                drag(p, 'pause');
            }
            if (o.customize) {
                buildPanel();
                var g = el('div', 'position:absolute;left:2vmin;top:2vmin;width:7vmin;height:7vmin;min-width:34px;min-height:34px;border-radius:50%;background:rgba(255,255,255,0.14);border:2px solid rgba(255,255,255,0.35);color:#fff;font:700 4vmin sans-serif;display:flex;align-items:center;justify-content:center;touch-action:manipulation;pointer-events:auto', root, '⚙');
                g.addEventListener('click', showPanel);
            }
            layout();
        }
        // built again with the same options (the D-pad switch); the settings panel stays open and the host is not told it closed
        function rebuild() {
            if (!root) return;
            var wasOpen = settingsOpen;
            releaseAll(); window.removeEventListener('resize', layout); root.remove(); root = null; panel = null; doneBtn = null;
            init(lastOpt);
            if (wasOpen && panel) panel.style.display = 'block';
        }
        function hide() { if (root) { releaseAll(); window.removeEventListener('resize', layout); root.remove(); root = null; panel = null; doneBtn = null; editing = false; sendFn = null; settingsOpen = false; } }
        function openSettings() { if (root && panel) showPanel(); }
        return { init: init, hide: hide, openSettings: openSettings, active: function () { return !!root; }, version: '1.0.0' };
    })();
    /* vpad:end */

    var pad = (function () {
        var api = { version: VirtualPad.version }, mine = null;          // mine: the callbacks of a pad the app asked for in My PC (the shell draws it)
        var ACTIONS = { ok: ['confirm', 'jump'], b: ['run', 'cancel'], run: ['run'], cancel: ['cancel'], menu: ['menu'], left: ['left'], right: ['right'], up: ['up'], down: ['down'] };
        function hash(t) { var h = 7, i; for (i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) % 8999; return 1000 + h; }
        // [{ label (3 characters at most), action?, key? }] -> the library's buttons; a key made from the content keeps saved layouts valid
        function list(a, def) {
            if (!(a instanceof Array)) return def;
            var out = [], seen = {}, i, b, k, act;
            for (i = 0; i < a.length && out.length < 8; i++) {
                b = a[i];
                if (!b || typeof b.label !== 'string' || !b.label || b.label.length > 3) continue;
                act = typeof b.action === 'string' && /^[a-z0-9_-]{1,16}$/i.test(b.action) ? b.action : (typeof b.key === 'number' ? undefined : 'ok');
                k = typeof b.key === 'number' ? b.key : hash(b.label + '|' + act);
                if (seen[k]) continue;
                seen[k] = 1;
                var pl = b.place === 'right' || b.place === 'bottom' || b.place === 'top' || b.place === 'left' ? b.place : undefined, o = act ? { label: b.label, action: act, key: k } : { label: b.label, key: k };
                if (pl) o.place = pl;
                out.push(o);
            }
            return out.length ? out : def;
        }
        // owner rule: A B X Y in the Nintendo places, each one sending what the same button of a real Nintendo pad sends, never A B C or a menu symbol
        var DEFAULT = list([{ label: 'A', action: 'b', place: 'right' }, { label: 'B', action: 'ok', place: 'bottom' }]);
        var CATALOG = list([{ label: 'A', action: 'b', place: 'right' }, { label: 'B', action: 'ok', place: 'bottom' }, { label: 'X', action: 'run', place: 'top' }, { label: 'Y', action: 'run', place: 'left' }]);

        // actions of the pad -> the SDK's own input (no fake keyboard events)
        function onAction(action, down) {
            var acts = ACTIONS[action], i;
            if (action === 'pause' || (action === 'menu' && handlers.ownMenu !== true)) {
                if (!down) return;
                if (hosted && !(info && info.standalone)) post('pause'); else togglePause();
                return;
            }
            if (!acts) return;
            for (i = 0; i < acts.length; i++) setInput(acts[i], down, false, 'touch');
        }
        // events of the pad My PC draws for the app: { action, down } or { key, down }
        api._message = function (m) {
            if (!mine) return;
            try {
                if (m.action !== undefined) (mine.onAction || onAction)(String(m.action), !!m.down);
                else if (m.key !== undefined && mine.send) mine.send(+m.key, !!m.down);
            } catch (e) { try { console.error('[MyPC] pad: ' + (e && e.stack || e)); } catch (e2) {} }
        };
        // opt: { id, onAction | send, buttons, catalog, scale, pause, customize, force }; buttons / catalog: [{ label, action, key? }]
        // In My PC the SHELL draws the pad (right size, above the app, hidden under My PC's menus) and sends the presses back here;
        // standalone this draws it. Without `force`, My PC's own pad is the one shown on phones: nothing to do.
        api.init = function (opt) {
            opt = opt || {};
            var inMyPC = hosted && info && !info.standalone;
            if (inMyPC && !opt.force) return;
            var o = { id: opt.id || 'sdk:' + ((info && info.app && info.app.id) || location.pathname), buttons: list(opt.buttons, DEFAULT), catalog: list(opt.catalog, null), scale: plainObject(opt.scale) ? opt.scale : {},
                      pause: opt.pause, customize: opt.customize, force: !!opt.force, send: opt.send, onAction: opt.onAction };
            if (!o.catalog) o.catalog = opt.buttons ? o.buttons : CATALOG;
            if (inMyPC) {
                mine = { onAction: opt.onAction || null, send: opt.send || null };
                post('pad', { own: true, cfg: { id: opt.id, buttons: o.buttons, catalog: o.catalog, scale: o.scale, pause: opt.pause !== false, customize: opt.customize !== false } });
                return;
            }
            if (!o.onAction && !o.send) o.onAction = onAction;
            VirtualPad.init(o);
        };
        api.hide = function () { if (mine) { mine = null; post('pad', { own: false }); } else VirtualPad.hide(); };
        api.openSettings = function () { if (mine) post('pad', { settings: true }); else VirtualPad.openSettings(); };
        api.active = function () { return mine ? true : VirtualPad.active(); };
        return api;
    })();

    /* MyPC.bluetooth: heart-rate sensors (any Bluetooth LE Heart Rate Service device: chest straps, watches that broadcast).
     * Requests go to My PC (js/core/hr-ble.js on the TV); readings and status changes come back as events. */
    var bluetooth = (function () {
        var nextId = 1, pending = {}, listeners = {};
        function emit(name, payload) {
            var list = (listeners[name] || []).slice();
            for (var i = 0; i < list.length; i++) {
                try { list[i](payload || {}); } catch (e) { try { console.error('[MyPC BLE] ' + e); } catch (x) {} }
            }
        }
        function request(action, extra) {
            if (!hosted || !hostWin || !info || info.standalone) {
                return Promise.reject(new Error('The My PC native Bluetooth bridge is only available inside My PC.'));
            }
            return new Promise(function (resolve, reject) {
                var id = nextId++;
                var timer = setTimeout(function () {
                    if (!pending[id]) return;
                    delete pending[id];
                    reject(new Error('My PC Bluetooth request timed out.'));
                }, 35000);
                pending[id] = { resolve: resolve, reject: reject, timer: timer };
                var payload = { action: action, requestId: id };
                if (extra && typeof extra === 'object') Object.keys(extra).forEach(function (key) { payload[key] = extra[key]; });
                post('ble', payload);
            });
        }
        function receive(d) {
            if (!d || typeof d !== 'object') return;
            if (d.kind === 'result' && d.requestId !== undefined) {
                var p = pending[d.requestId];
                if (!p) return;
                delete pending[d.requestId];
                clearTimeout(p.timer);
                if (d.ok) p.resolve(d.result || {});
                else p.reject(new Error(String(d.error || 'My PC Bluetooth operation failed.')));
                return;
            }
            if (typeof d.kind !== 'string') return;
            emit(d.kind, d);
        }
        return {
            available: function () { return !!(hosted && hostWin && info && !info.standalone); },
            capabilities: function () { return request('capabilities'); },
            status: function () { return request('status'); },                      // { state, device, lastDevice, lastReadingAgoMs, stale }
            // scan({ seconds }) lists heart-rate sensors (3 to 30 s, 10 by default); connect(id) only after the user picked one
            scan: function (opt) { return request('scan', opt && opt.seconds ? { seconds: +opt.seconds } : null); },
            connect: function (deviceId) { return request('connect', { deviceId: deviceId }); },
            reconnectLast: function () { return request('reconnect-last'); },      // the sensor used last on this TV, no picker
            cancelScan: function () { return request('cancel-scan'); },
            disconnect: function () { return request('disconnect'); },
            startTest: function () { return request('start-test'); },
            stopTest: function () { return request('stop-test'); },
            on: function (eventName, callback) {
                if (typeof callback !== 'function' || typeof eventName !== 'string') return function () {};
                if (!listeners[eventName]) listeners[eventName] = [];
                listeners[eventName].push(callback);
                return function () {
                    var list = listeners[eventName] || [], index = list.indexOf(callback);
                    if (index >= 0) list.splice(index, 1);
                };
            },
            _message: receive
        };
    })();

    /* MyPC.sensors: phones used as motion controllers (Game controller app, modes "sensor-actions" and "sensor-raw").
     * setup() tells the phones which moves this app understands and who plays; they then send only those moves.
     *   MyPC.sensors.setup({ moves: ['LEFT', 'RIGHT', 'JUMP', 'DUCK', 'DUCK_END'],
     *                       profile: { age: 30, height: 175, weight: 70, phone_position: 'right hand' },   // cm, kg
     *                       metrics: { hz: 1 },          // optional: { type: 'metrics', gait, cadence, speed_kmh, ... } once a second
     *                       raw: { hz: 30 },             // sensor-raw phones: sample rate
     *                       define: { SPIN: { signal: 'rot', above: 300, cooldown_ms: 800 } } })   // optional: new moves
     *   MyPC.sensors.on('action', function (ev, player) { ev.action === 'JUMP' ... });   // also 'metrics', 'raw', 'players', 'config'
     *   MyPC.sensors.stop()
     * Docs: docs/phone-controller.md in the My PC repository. */
    var sensors = (function () {
        var listeners = {}, cfg = null, players = { 1: null, 2: null };
        function emit(name, payload, player) {
            var list = (listeners[name] || []).slice();
            for (var i = 0; i < list.length; i++) { try { list[i](payload, player); } catch (e) { try { console.error('[MyPC sensors] ' + e); } catch (x) {} } }
        }
        return {
            available: function () { return !!(hosted && hostWin && info && !info.standalone); },
            setup: function (opt) { if (hosted && hostWin) post('sensors', { op: 'setup', cfg: opt || {} }); },
            stop: function () { cfg = null; if (hosted && hostWin) post('sensors', { op: 'stop' }); },
            config: function () { return cfg; },                          // what the phones were sent (moves kept, profile, rates)
            players: function () { return players; },                    // { 1: 'pad' | 'sensor-actions' | 'sensor-raw' | null, 2: ... }
            on: function (name, fn) {
                if (typeof fn !== 'function' || typeof name !== 'string') return function () {};
                (listeners[name] || (listeners[name] = [])).push(fn);
                return function () { var l = listeners[name] || [], i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); };
            },
            _message: function (d) {
                if (!d || typeof d.ev !== 'string') return;
                if (d.ev === 'config') { cfg = d.data || null; if (d.players) players = d.players; emit('config', cfg, 0); return; }
                if (d.ev === 'players') { players = d.data || players; emit('players', players, 0); return; }
                emit(d.ev, d.data, d.player);
            }
        };
    })();

    /* ---------------- MyPC.gamepad: every button and axis of every controller (API level 9) ----------------
     * Game controllers come first in My PC: read ALL their buttons here, not only the mapped actions.
     *   MyPC.gamepad.on('button', function (index, pressed, value, dev, name) {})   // every change of every button (triggers: value 0..1)
     *   MyPC.gamepad.on('axes', function (axes, dev) {})                             // sticks moved (axes: the SDK's own array, read it now, don't keep it)
     *   MyPC.gamepad.on('pads', function (list) {})                                  // [{ dev: 'pad0', name, standard, buttons, axes }] connected / gone
     *   MyPC.gamepad.pressed(i, dev?)  value(i, dev?)  axis(i, dev?)  pads()  name(i, dev?)
     * dev is 'pad0'..'pad3' (the same as onInput's dev); without it: any pad (pressed), the highest value, the last pad used (axis).
     * Inside My PC the shell reads the pads and sends only changes, and nothing while its own menus are open. Standalone the SDK
     * reads navigator.getGamepads() itself (and maps the standard buttons to actions too, like My PC does). */
    var gamepad = (function () {
        var NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Select', 'Start', 'L3', 'R3', 'Up', 'Down', 'Left', 'Right', 'Home'];
        var st = {}, list = [], last = '', listeners = { button: [], axes: [], pads: [] }, raf = 0, startAt = {};
        function pad(dev) {
            return st[dev] || (st[dev] = { v: new Float32Array(32), p: new Uint8Array(32), a: new Float32Array(8), standard: true });
        }
        function emit(name, a, b, c, d, e) {
            var l = listeners[name];
            for (var i = 0; i < l.length; i++) { try { l[i](a, b, c, d, e); } catch (x) { try { console.error('[MyPC gamepad] ' + x); } catch (y) {} } }
        }
        function nameOf(i, dev) { var s = st[dev || last]; return (!s || s.standard) && NAMES[i] ? NAMES[i] : 'Button' + i; }
        function button(dev, i, pressed, v) {
            if (i < 0 || i >= 32) return;
            var s = pad(dev);
            s.p[i] = pressed ? 1 : 0; s.v[i] = v; last = dev;
            emit('button', i, !!pressed, v, dev, nameOf(i, dev));
        }
        function axes(dev, a) {
            var s = pad(dev), n = Math.min(8, a.length);
            for (var i = 0; i < n; i++) s.a[i] = +a[i] || 0;
            last = dev;
            emit('axes', s.a, dev);
        }
        function release() {                                   // My PC's menu opened, the app lost focus: every held button is let go
            for (var dev in st) { var s = st[dev]; for (var i = 0; i < 32; i++) if (s.p[i] || s.v[i]) button(dev, i, false, 0); for (i = 0; i < 8; i++) s.a[i] = 0; }
        }
        function setPads(l) {
            list = []; var keep = {};
            for (var i = 0; l && i < l.length; i++) { var o = l[i]; list.push({ dev: o.d, name: o.name, standard: !!o.standard, buttons: o.buttons, axes: o.axes }); pad(o.d).standard = !!o.standard; keep[o.d] = 1; }
            for (var d in st) if (!keep[d]) delete st[d];
            emit('pads', list.slice());
        }
        // standalone: read the pads ourselves, like My PC's input module (same mapping)
        var MAP = [[0, ['jump', 'confirm']], [1, ['run', 'cancel']], [2, ['run']], [3, ['run']], [12, ['up']], [13, ['down']], [14, ['left']], [15, ['right']]];
        var actNow = {};
        function poll() {
            raf = 0;
            var ps; try { ps = navigator.getGamepads ? navigator.getGamepads() : []; } catch (e) { ps = []; }
            var any = false, i, j, p, dev, s, b, v, pr, moved, now, k, acts, t = Date.now();
            for (i = 0; i < ps.length; i++) {
                p = ps[i]; if (!p || !p.connected) continue;
                any = true; dev = 'pad' + p.index; s = pad(dev); s.standard = p.mapping === 'standard';
                for (j = 0; j < p.buttons.length && j < 32; j++) {
                    b = p.buttons[j]; v = b.value || (b.pressed ? 1 : 0); pr = b.pressed || v > 0.5 ? 1 : 0;
                    if (pr !== s.p[j] || Math.abs(v - s.v[j]) >= 0.05 || (v === 0 && s.v[j] !== 0)) {
                        if (j === 8 || j === 9) {                  // Start / Select: the app's menu (ownMenu), else pause, when let go
                            if (pr) startAt[dev] = t;
                            else if (startAt[dev]) { startAt[dev] = 0; if (handlers.ownMenu && !standalonePaused) { setInput('menu', true, false, dev); setInput('menu', false, false, dev); } else togglePause(); }
                        }
                        if (!standalonePaused || !pr) button(dev, j, pr, v);
                    }
                }
                moved = false;
                for (j = 0; j < p.axes.length && j < 8; j++) { v = p.axes[j] || 0; if (Math.abs(v - s.a[j]) >= 0.02 || (v === 0 && s.a[j] !== 0)) { s.a[j] = v; moved = true; } }
                if (moved && !standalonePaused) emit('axes', s.a, dev);
                now = actNow[dev] || (actNow[dev] = {});
                if (standalonePaused || uiBlock) { for (k in now) if (now[k]) { now[k] = false; setInput(k, false, false, dev); } continue; }
                var want = {};
                for (j = 0; j < MAP.length; j++) { if (s.p[MAP[j][0]]) { acts = MAP[j][1]; for (k = 0; k < acts.length; k++) want[acts[k]] = true; } }
                if (s.a[0] < -0.5) want.left = true; if (s.a[0] > 0.5) want.right = true; if (s.a[1] < -0.5) want.up = true; if (s.a[1] > 0.5) want.down = true;
                for (k in want) if (!now[k]) { now[k] = true; setInput(k, true, false, dev); }
                for (k in now) if (now[k] && !want[k]) { now[k] = false; setInput(k, false, false, dev); }
            }
            if (any && !destroyed) raf = requestAnimationFrame(poll);
        }
        function standalonePads() {
            var ps; try { ps = navigator.getGamepads ? navigator.getGamepads() : []; } catch (e) { ps = []; }
            var l = [];
            for (var i = 0; i < ps.length; i++) if (ps[i] && ps[i].connected) l.push({ d: 'pad' + ps[i].index, name: ps[i].id, standard: ps[i].mapping === 'standard', buttons: ps[i].buttons.length, axes: ps[i].axes.length });
            setPads(l);
            if (!raf && l.length && !destroyed) raf = requestAnimationFrame(poll);
        }
        return {
            supported: true,
            on: function (name, fn) {
                if (typeof fn !== 'function' || !listeners[name]) return function () {};
                listeners[name].push(fn);
                return function () { var l = listeners[name], i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); };
            },
            pressed: function (i, dev) { if (dev) return !!(st[dev] && st[dev].p[i]); for (var d in st) if (st[d].p[i]) return true; return false; },
            value: function (i, dev) { if (dev) return st[dev] ? st[dev].v[i] || 0 : 0; var m = 0; for (var d in st) if (st[d].v[i] > m) m = st[d].v[i]; return m; },
            axis: function (i, dev) { var s = st[dev || last]; return s ? s.a[i] || 0 : 0; },
            pads: function () { return list.slice(); },
            name: nameOf,
            _message: function (d) {
                if (!d) return;
                if (d.e === 'b') button(String(d.d), +d.i, !!d.p, +d.v || 0);
                else if (d.e === 'a' && d.a) axes(String(d.d), d.a);
                else if (d.e === 'pads') setPads(d.list);
                else if (d.e === 'lost') { delete st[d.d]; }
            },
            _release: release,
            _standalone: function () {
                if (!navigator.getGamepads) return;
                window.addEventListener('gamepadconnected', standalonePads);
                window.addEventListener('gamepaddisconnected', standalonePads);
                standalonePads();
            },
            _stop: function () { if (raf) cancelAnimationFrame(raf); raf = 0; }
        };
    })();

    /* MyPC.net, MyPC.ai, MyPC.mic (API 10): what the sandboxed iframe cannot do, My PC does for the app.
     *   MyPC.net.fetch(url, { method, headers, body | json | form, responseType: 'text' | 'json' | 'arraybuffer', timeout, onChunk })
     *       web requests from My PC: on the TV no CORS limit. -> { ok, status, headers, body, text(), json() }
     *   MyPC.ai.generate({ provider, model, system, rules, context, examples, messages, prompt, output, schema, stream, ... }, { onDelta })
     *       any AI service set in the App Store Manager (keys never reach the app) or the app's own { type, url, key }
     *   MyPC.mic.start({ format, sampleRate, chunkMs, silence, maxSeconds }) / stop() / record(); MyPC.mic.on('data' | 'level' | 'end', fn)
     * Standalone (the page opened in a browser) the same calls run in the page itself: the SDK loads My PC's own
     * js/core/web-proxy.js, ai.js and mic.js next to it; there only APIs that allow CORS answer and AI needs the app's own key.
     * Full reference: sdk/GUIDE.md, "Web requests, AI and microphone". */
    var SDK_BASE = (function () {
        try { var s = document.currentScript && document.currentScript.src; if (s && /\/sdk\/[^\/?#]*([?#].*)?$/.test(s)) return s.replace(/sdk\/[^\/]*$/, ''); } catch (e) {}
        return 'https://imad-os.github.io/g/';
    })();
    var libs = {};
    function need(files) {                                     // standalone: My PC's own modules, loaded once
        return Promise.all(files.map(function (f) {
            if (!libs[f]) libs[f] = new Promise(function (resolve, reject) {
                var s = document.createElement('script');
                s.src = SDK_BASE + f;
                s.onload = resolve;
                s.onerror = function () { delete libs[f]; reject(bridgeError({ code: 'network', message: 'Could not load ' + f + ' from ' + SDK_BASE })); };
                (document.head || document.documentElement).appendChild(s);
            });
            return libs[f];
        }));
    }
    function bridgeError(e) { var x = new Error((e && e.message) || 'Failed.'); x.code = (e && e.code) || 'failed'; if (e && e.status) x.status = e.status; return x; }
    function viaShell() { return hosted && hostWin && info && !info.standalone; }
    function bridgeReady() {
        if (!info) return Promise.reject(bridgeError({ code: 'not-ready', message: 'Call MyPC.init() and wait for onInit first.' }));
        if (viaShell() && !(info.bridges)) return Promise.reject(bridgeError({ code: 'unsupported', message: 'This My PC is too old for this. Update My PC (Settings > Update).' }));
        return Promise.resolve();
    }
    function channel(type) {
        var waiting = {}, n = 1;
        return {
            call: function (op, payload, onEvent) {
                var rid = n++, p = new Promise(function (resolve, reject) {
                    waiting[rid] = { resolve: resolve, reject: reject, ev: onEvent };
                    var d = { rid: rid, op: op };
                    for (var k in payload) if (payload.hasOwnProperty(k)) d[k] = payload[k];
                    post(type, d);
                });
                p.rid = rid;
                return p;
            },
            _message: function (d) {
                var w = waiting[d.rid];
                if (!w) return false;
                if (d.ev) { if (w.ev) { try { w.ev(d); } catch (e) { try { console.error('[MyPC ' + type + '] ' + e); } catch (x) {} } } return true; }
                delete waiting[d.rid];
                if (d.error) w.reject(bridgeError(d.error)); else w.resolve(d.result);
                return true;
            }
        };
    }
    function textOf(b) { return typeof b === 'string' ? b : b instanceof ArrayBuffer ? new TextDecoder().decode(b) : b === null || b === undefined ? '' : JSON.stringify(b); }
    function response(r) {
        r.text = function () { return textOf(r.body); };
        r.json = function () { return typeof r.body === 'string' || r.body instanceof ArrayBuffer ? JSON.parse(textOf(r.body)) : r.body; };
        return r;
    }

    var net = (function () {
        var ch = channel('net');
        function request(req) {
            req = req && typeof req === 'object' ? req : {};
            var onChunk = typeof req.onChunk === 'function' ? req.onChunk : null, handle = null, rid = 0, wire = {};
            for (var k in req) if (req.hasOwnProperty(k) && k !== 'onChunk') wire[k] = req[k];
            if (onChunk) wire.stream = true;
            var p = bridgeReady().then(function () {
                if (viaShell()) { var q = ch.call('request', { req: wire }, function (d) { if (d.ev === 'chunk' && onChunk) onChunk(d.text); }); rid = q.rid; return q; }
                return need(['js/core/web-proxy.js']).then(function () {
                    return new Promise(function (resolve, reject) {
                        handle = WebProxy.request(wire, { lan: true }, onChunk, function (e, r) { if (e) reject(bridgeError(e)); else resolve(r); });
                    });
                });
            }).then(response);
            p.abort = function () { if (handle) handle.abort(); else if (rid) post('net', { rid: rid, op: 'abort' }); };
            return p;
        }
        return {
            request: request,
            fetch: function (url, opt) { var r = {}; opt = opt || {}; for (var k in opt) if (opt.hasOwnProperty(k)) r[k] = opt[k]; r.url = url; return request(r); },
            _message: ch._message
        };
    })();

    var ai = (function () {
        var ch = channel('ai');
        function run(op, req, opt) {
            opt = opt || {};
            req = req && typeof req === 'object' ? req : {};
            var job = null, rid = 0, onDelta = typeof opt.onDelta === 'function' ? opt.onDelta : null, onEvent = typeof opt.onEvent === 'function' ? opt.onEvent : null;
            var wire = {};
            for (var k in req) if (req.hasOwnProperty(k)) wire[k] = req[k];
            if (onDelta && wire.stream === undefined) wire.stream = true;
            function ev(d) { if (d.ev === 'delta' && onDelta) onDelta(d.text); if (onEvent) onEvent(d); }
            var p = bridgeReady().then(function () {
                if (viaShell()) { var q = ch.call(op, { req: wire }, ev); rid = q.rid; return q; }
                return need(['js/core/web-proxy.js', 'js/core/ai.js']).then(function () {
                    var prov = AI.resolve(wire.provider, pub.app_config && pub.app_config.ai && pub.app_config.ai.provider);
                    if (!prov) throw bridgeError({ code: 'no-provider', message: 'Standalone, give your own provider: { provider: { type: "openai", url, key, model } }. Inside My PC the TV\'s AI services are used.' });
                    job = op === 'raw' ? AI.raw(wire, prov, { lan: true }) : AI.start(wire, prov, ev, { lan: true });
                    return job.promise.catch(function (e) { throw bridgeError(e); });
                });
            });
            p.cancel = function () { if (job) job.cancel(); else if (rid) post('ai', { rid: rid, op: 'cancel' }); };
            return p;
        }
        return {
            generate: function (req, opt) { return run('generate', req, opt); },
            // MyPC.ai.chat('Hello') or chat({ prompt, system, ... }) -> the answer's text
            chat: function (req, opt) { return run('generate', typeof req === 'string' ? { prompt: req } : req, opt).then(function (r) { return r.text; }); },
            raw: function (req) { return run('raw', req); },
            providers: function () { return bridgeReady().then(function () { return viaShell() ? ch.call('providers', {}) : []; }); },
            _message: ch._message
        };
    })();

    var mic = (function () {
        var ch = channel('mic'), listeners = { data: [], level: [], end: [] }, on = false, ending = null;
        function emit(name, payload) { var l = listeners[name].slice(); for (var i = 0; i < l.length; i++) { try { l[i](payload); } catch (e) { try { console.error('[MyPC mic] ' + e); } catch (x) {} } } }
        function event(name, d) {
            if (name === 'end') { on = false; var e = ending; ending = null; emit('end', d); if (e) e.resolve(d.result); return; }
            emit(name, d);
        }
        function start(opts) {
            if (on) return Promise.reject(bridgeError({ code: 'busy', message: 'The microphone is already recording.' }));
            var wire = {};
            opts = opts && typeof opts === 'object' ? opts : {};
            for (var k in opts) if (opts.hasOwnProperty(k)) wire[k] = opts[k];
            on = true;
            return bridgeReady().then(function () {
                if (viaShell()) return ch.call('start', { opts: wire });
                return need(['js/core/web-proxy.js', 'js/core/mic.js']).then(function () {
                    return new Promise(function (resolve, reject) {
                        Mic.start(wire, function (ev, data) { event(ev, data); }, function (e, inf) { if (e) reject(bridgeError(e)); else resolve(inf); });
                    });
                });
            }).then(function (inf) { return inf; }, function (e) { on = false; throw e; });
        }
        function stop() {
            if (!on) return Promise.resolve(null);
            on = false;
            if (viaShell()) return ch.call('stop', {});
            return new Promise(function (resolve) { Mic.stop(function (e, r) { resolve(r); }); });
        }
        return {
            available: function () { return viaShell() ? !!(info.bridges && info.bridges.mic) : !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); },
            start: start,
            stop: stop,
            cancel: function () { if (!on) return; on = false; if (viaShell()) ch.call('cancel', {}); else Mic.cancel(); },
            // start, then resolve with the recording when it stops by itself (silence, maxSeconds) or when stop() is called
            record: function (opts) {
                return start(opts).then(function () { return new Promise(function (resolve, reject) { ending = { resolve: resolve, reject: reject }; }); });
            },
            active: function () { return on; },
            on: function (name, fn) {
                if (typeof fn !== 'function' || !listeners[name]) return function () {};
                listeners[name].push(fn);
                return function () { var l = listeners[name], i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); };
            },
            _message: function (d) {
                if (d.ev) { event(d.ev, d); return; }
                if (ch._message(d) && d.of !== undefined && ending) { var e = ending; ending = null; e.resolve(d.result); }
            },
            _stop: function () { on = false; ending = null; }
        };
    })();

    var pub = {
        version: VERSION,
        apiLevel: API,                   // 3 added MyPC.multiplayer, 4 MyPC.pad and the pad option of init(), 7 MyPC.bluetooth, 8 MyPC.sensors, 9 MyPC.gamepad, 10 MyPC.net / ai / mic, 11 error reports (MyPC.report) (the protocol version above stays 1: older apps and shells keep working)
        multiplayer: multiplayer,
        pad: pad,
        bluetooth: bluetooth,
        sensors: sensors,
        gamepad: gamepad,
        net: net,
        ai: ai,
        mic: mic,
        // The app's settings object, set in the installer and read before the app opens. Read it in
        // onInit (or later). Always an object ({} when none). Standalone, test it with ?app_config={"a":1}.
        app_config: {},
        init: init,
        ready: ready,
        progress: function (p) { if (hosted) post('progress', { p: Math.max(0, Math.min(1, +p || 0)) }); },
        fail: function (reason) { if (hosted) post('failed', { reason: String(reason || '') }); else try { console.error('[MyPC] ' + reason); } catch (e) {} },
        // an error the app caught itself, saved by My PC with the device, versions and time (App Store Manager > Errors)
        report: function (error, data) { try { console.warn('[MyPC] report: ' + (error && error.stack || error)); } catch (e) {} report(error, data); },
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

/* Native app feel (same guard as js/core/native.js): no pinch / Ctrl+wheel / Ctrl +/- zoom, no selection or context menu. */
(function () {
    'use strict';
    if (typeof document === 'undefined') return;
    var m = document.querySelector('meta[name="viewport"]');
    if (!m && document.head) { m = document.createElement('meta'); m.name = 'viewport'; document.head.appendChild(m); }
    if (m) m.setAttribute('content', 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
    var st = document.documentElement.style;
    st.touchAction = 'pan-x pan-y'; st.overscrollBehavior = 'none'; st.webkitUserSelect = 'none'; st.userSelect = 'none'; st.webkitTouchCallout = 'none';
    function stop(e) { e.preventDefault(); }
    var opt = { passive: false };
    document.addEventListener('wheel', function (e) { if (e.ctrlKey) e.preventDefault(); }, opt);
    document.addEventListener('touchmove', function (e) { if (e.touches && e.touches.length > 1) e.preventDefault(); }, opt);
    ['gesturestart', 'gesturechange', 'gestureend', 'dblclick', 'contextmenu', 'dragstart'].forEach(function (n) { document.addEventListener(n, stop, opt); });
    document.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '0' || e.key === '_')) e.preventDefault();
    }, opt);
})();
