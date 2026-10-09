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
                roomsApi._enable(d.rooms === 1 ? 'shell' : 'none');       // false on an older My PC: apps hide the multiplayer feature
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
            case 'rooms': roomsApi._message(d); break;
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
        roomsApi._enable('local');
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

    /* ---------------- rooms (lobbies) ----------------
     * Layer 1: MyPC.rooms.open / list / ask, room.onRequest / accept / decline / close. In My PC the shell does the
     * work (js/core/rooms.js, Firestore); standalone, two tabs of the same browser find each other with
     * BroadcastChannel + localStorage. Layer 2: MyPC.rooms.join and room.onGuest give a direct WebRTC connection. */
    var roomsApi = (function () {
        var api = { supported: false };
        var rpcN = 0, waiting = {}, handlers = {}, buffered = {}, local = null;
        var L = { name: 24, payload: 6000, ttl: 45000, beat: 15000, askTtl: 60000, asksPerMin: 5, opensPerMin: 6, listMax: 20 };

        function err(code, why) { var e = { code: code }; if (why) e.why = why; return e; }

        function rpc(op, args) {
            return new Promise(function (resolve, reject) {
                if (!api.supported) return reject(err('unavailable'));
                if (local) return local.call(op, args || {}, function (c, res) { if (c) reject(err(c)); else resolve(res); });
                var n = ++rpcN, t = setTimeout(function () { delete waiting[n]; reject(err('unavailable')); }, 20000);
                waiting[n] = function (c, res) { clearTimeout(t); if (c) reject(err(c)); else resolve(res); };
                post('rooms', { rid: n, op: op, args: args || {} });
            });
        }

        // events (request / answer / denied / closed) wait for a handler, so none is lost
        function key(ev, d) { return ev === 'request' || ev === 'closed' ? ev + ':' + d.room : ev + ':' + d.req; }
        function deliver(ev, d) {
            var k = key(ev, d);
            if (handlers[k]) { try { handlers[k](ev === 'request' ? { id: d.id, name: d.name, offer: d.offer } : ev === 'answer' ? d.answer : ev === 'denied' ? d.why : undefined); } catch (e) { try { console.error('[MyPC] rooms: ' + (e && e.stack || e)); } catch (e2) {} } }
            else (buffered[k] = buffered[k] || []).push(d);
        }
        function on(ev, id, fn) {
            var k = ev + ':' + id, q = buffered[k];
            handlers[k] = fn;
            delete buffered[k];
            while (q && q.length) deliver(ev, q.shift());
        }
        // from the shell
        api._message = function (d) {
            if (typeof d.rid === 'number') { var w = waiting[d.rid]; delete waiting[d.rid]; if (w) w(d.error, d.result); }
            else if (d.ev && d.data) deliver(d.ev, d.data);
        };
        api._enable = function (mode) {                        // 'shell' (My PC), 'local' (standalone tabs) or 'none' (an older My PC)
            if (typeof Promise === 'undefined' || mode === 'none') return;
            if (mode === 'shell') { api.supported = true; return; }
            local = makeLocal();
            api.supported = !!local;
        };

        /* ----- layer 2: a direct connection (WebRTC data channel, same Wi-Fi, no STUN) ----- */
        function b64(buf) { var b = new Uint8Array(buf), s = '', i; for (i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192)); return btoa(s); }
        function unb64(str) { var s = atob(str), b = new Uint8Array(s.length), i; for (i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }
        function pack(desc) {                                  // SDP -> short opaque string (deflate + base64 when the browser can)
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
        // { send(msg), onMessage(fn), onClose(fn), close() }: ping every 1 s, dropped after 5 s of silence
        function makeConn(pc, dc, peer) {
            var msgH = null, closeH = null, buf = [], closed = false, why = '', last = Date.now(), ping = 0;
            function shut(w) {
                if (closed) return;
                closed = true; why = w; clearInterval(ping);
                try { dc.close(); } catch (e) {}
                try { pc.close(); } catch (e2) {}
                if (closeH) { try { closeH(w); } catch (e3) {} }
            }
            var conn = {
                peer: peer || {},
                send: function (m) { if (closed || dc.readyState !== 'open') return false; try { dc.send(JSON.stringify({ m: m })); return true; } catch (e) { return false; } },
                onMessage: function (fn) { msgH = fn; while (buf.length) fn(buf.shift()); },
                onClose: function (fn) { closeH = fn; if (closed) fn(why); },
                close: function () { shut('closed'); }
            };
            dc.onmessage = function (e) {
                last = Date.now();
                var o; try { o = JSON.parse(e.data); } catch (x) { return; }
                if (!o || !('m' in o)) return;                 // a ping
                if (msgH) msgH(o.m); else if (buf.length < 200) buf.push(o.m);
            };
            dc.onclose = function () { shut('closed'); };
            pc.onconnectionstatechange = function () { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') shut('closed'); };
            ping = setInterval(function () {
                if (Date.now() - last > 5000) return shut('timeout');
                try { dc.send('{"p":1}'); } catch (e) {}
            }, 1000);
            return conn;
        }
        function newPC() { return new RTCPeerConnection({ iceServers: [] }); }

        api.join = function (roomId, opts) {
            opts = opts || {};
            return new Promise(function (resolve, reject) {
                if (typeof RTCPeerConnection === 'undefined') return reject(err('unavailable'));
                var pc = newPC(), dc = pc.createDataChannel('mypc'), done = false, req = null, timer = 0;
                function fail(e) { if (done) return; done = true; clearTimeout(timer); try { pc.close(); } catch (x) {} if (req) req.cancel().catch(function () {}); reject(e); }
                pc.createOffer().then(function (o) { return pc.setLocalDescription(o); })
                    .then(function () { return gathered(pc); })
                    .then(function () { return pack(pc.localDescription); })
                    .then(function (offer) { return api.ask(roomId, { name: opts.name, offer: offer }); })
                    .then(function (r) {
                        req = r;
                        r.onDenied(function (why) { fail(err(why === 'no' ? 'denied' : why === 'gone' ? 'gone' : 'unavailable', why)); });
                        r.onAnswer(function (answer) {
                            timer = setTimeout(function () { fail(err('unavailable', 'connect')); }, 15000);
                            unpack(answer).then(function (d) { return pc.setRemoteDescription(d); }).catch(function () { fail(err('invalid')); });
                        });
                        dc.onopen = function () { if (done) return; done = true; clearTimeout(timer); resolve(makeConn(pc, dc, {})); };
                    })
                    .catch(function (e) { fail(e && e.code ? e : err('unavailable')); });
            });
        };

        function makeRoom(r) {
            var room = {
                id: r.id, name: r.name, max: r.max,
                onRequest: function (fn) { on('request', r.id, fn); },
                onClose: function (fn) { on('closed', r.id, fn); },
                accept: function (reqId, answer) { return rpc('accept', { room: r.id, req: String(reqId), answer: answer }).then(function () {}); },
                decline: function (reqId) { return rpc('decline', { room: r.id, req: String(reqId) }).then(function () {}); },
                close: function () { return rpc('close', { room: r.id }).then(function () {}); },
                // layer 2: every guest that asks gets a direct connection; fn(conn, { name }). Use this OR onRequest.
                onGuest: function (fn) {
                    room.onRequest(function (q) {
                        if (typeof RTCPeerConnection === 'undefined') return room.decline(q.id).catch(function () {});
                        var pc = newPC(), ready = false, t = setTimeout(function () { if (!ready) try { pc.close(); } catch (e) {} }, 20000);
                        pc.ondatachannel = function (e) {
                            var dc = e.channel;
                            function open() { if (ready) return; ready = true; clearTimeout(t); fn(makeConn(pc, dc, { name: q.name }), { name: q.name }); }
                            if (dc.readyState === 'open') open(); else dc.onopen = open;
                        };
                        unpack(q.offer).then(function (d) { return pc.setRemoteDescription(d); })
                            .then(function () { return pc.createAnswer(); })
                            .then(function (a) { return pc.setLocalDescription(a); })
                            .then(function () { return gathered(pc); })
                            .then(function () { return pack(pc.localDescription); })
                            .then(function (answer) { return room.accept(q.id, answer); })
                            .catch(function () { clearTimeout(t); try { pc.close(); } catch (e) {} room.decline(q.id).catch(function () {}); });
                    });
                }
            };
            return room;
        }

        api.open = function (o) {
            o = o || {};
            if (o.name !== undefined && (typeof o.name !== 'string' || o.name.length > L.name)) return Promise.reject(err('invalid'));
            return rpc('open', { name: o.name, max: o.max }).then(makeRoom);
        };
        api.list = function () { return rpc('list', {}); };
        api.ask = function (roomId, o) {
            o = o || {};
            if (typeof roomId !== 'string' || typeof o.offer !== 'string' || o.offer.length === 0 || o.offer.length > L.payload) return Promise.reject(err('invalid'));
            return rpc('ask', { room: roomId, name: o.name, offer: o.offer }).then(function (r) {
                return {
                    id: r.id,
                    onAnswer: function (fn) { on('answer', r.id, fn); },
                    onDenied: function (fn) { on('denied', r.id, fn); },
                    cancel: function () { return rpc('cancel', { req: r.id }).then(function () {}); }
                };
            });
        };

        /* ----- standalone: tabs of the same browser (BroadcastChannel + localStorage), same rules as the shell ----- */
        function makeLocal() {
            var KEY = 'mypc_rooms:' + location.pathname, bc;
            try { bc = new BroadcastChannel(KEY); } catch (e) { return null; }
            var mine = null, asks = {}, opens = [], askRate = [];
            function reg() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
            function save(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} }
            function rid(n) { var s = '', a = 'abcdefghjkmnpqrstuvwxyz23456789'; while (n--) s += a.charAt(Math.floor(Math.random() * a.length)); return s; }
            function rate(list, max) {
                var now = Date.now(), i;
                for (i = list.length - 1; i >= 0; i--) if (now - list[i] > 60000) list.splice(i, 1);
                if (list.length >= max) return false;
                list.push(now); return true;
            }
            function clean(s) { return typeof s === 'string' ? s.replace(/\s+/g, ' ').slice(0, L.name) : ''; }
            function refresh() {
                if (!mine) return;
                var o = reg();
                if (!o[mine.id]) { clearInterval(mine.timer); var gone = mine; mine = null; deliver('closed', { room: gone.id }); return; }
                o[mine.id].exp = Date.now() + L.ttl; o[mine.id].n = mine.n; save(o);
            }
            function finish(a, why) { clearTimeout(a.timer); delete asks[a.id]; if (why) deliver('denied', { req: a.id, why: why }); }
            bc.onmessage = function (e) {
                var m = e.data, a;
                if (!m || typeof m.t !== 'string') return;
                if (m.t === 'ask' && mine && mine.id === m.room) deliver('request', { room: m.room, id: m.req, name: m.name, offer: m.offer });
                else if (m.t === 'answer' && (a = asks[m.req])) { finish(a, null); deliver('answer', { req: m.req, answer: m.answer }); }
                else if (m.t === 'no' && (a = asks[m.req])) finish(a, 'no');
                else if (m.t === 'closed') for (var k in asks) if (asks[k].room === m.room) finish(asks[k], 'gone');
            };
            window.addEventListener('beforeunload', function () { if (mine) { var o = reg(); delete o[mine.id]; save(o); bc.postMessage({ t: 'closed', room: mine.id }); } });
            var ops = {
                open: function (a, cb) {
                    if (mine) return cb('denied');
                    if (!rate(opens, L.opensPerMin)) return cb('denied');
                    var max = Math.max(2, Math.min(8, Math.floor(+a.max || 2))), o = reg(), r = { id: rid(8), name: clean(a.name) || (info && info.profile && info.profile.name) || 'Player', max: max, n: 1, at: Date.now(), exp: Date.now() + L.ttl };
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

        return api;
    })();

    var pub = {
        version: VERSION,
        apiLevel: 2,                     // 2 adds MyPC.rooms (the protocol version above stays 1: older apps and shells keep working)
        rooms: roomsApi,
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
