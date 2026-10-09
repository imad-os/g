/* Direct connections between two My PC devices (WebRTC data channel, same Wi-Fi, no STUN): the transport of
 * MyPC.multiplayer. The signalling (who is in which room) is js/core/rooms.js. The block below is also inside
 * sdk/mypc-sdk.js (standalone mode); tests keep both copies identical. */
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
