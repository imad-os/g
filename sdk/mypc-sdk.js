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
    var standalonePaused = false, uiBlock = false;

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
                multiplayer._enable(d.mp === 1 ? 'shell' : 'none');       // false on an older My PC: apps hide the multiplayer feature
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
            case 'mp': multiplayer._message(d); break;
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
        multiplayer._enable('local');
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
        function newPC() { return new RTCPeerConnection({ iceServers: [] }); }

        // { send(msg) -> boolean, onMessage(fn), onClose(fn), close() }. Messages: any JSON value, 4 KB at most, ordered and reliable;
        // at most 100 per second each way (more are dropped). A ping every second; closed after 5 s of silence.
        function makeConn(pc, dc) {
            var msgH = null, closeH = null, buf = [], closed = false, why = '', last = Date.now(), ping = 0, tx = [], rx = [];
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
            ping = setInterval(function () {
                if (Date.now() - last > SILENCE_MS) return shut('timeout');
                try { dc.send('{"p":1}'); } catch (e) {}
            }, 1000);
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
        return { offer: offer, answer: answer, MAX_MSG: MAX_MSG, supported: function () { return typeof RTCPeerConnection !== 'undefined'; } };
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

    var pub = {
        version: VERSION,
        apiLevel: 3,                     // 3 adds MyPC.multiplayer (the protocol version above stays 1: older apps and shells keep working)
        multiplayer: multiplayer,
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
