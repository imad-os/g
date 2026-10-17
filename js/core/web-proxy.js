/* Web requests for installed apps (MyPC.net in the SDK): the app's sandboxed iframe asks, My PC sends the request.
 *
 * On the TV My PC is a packaged app (WARP <access origin="*">): its XHR is not limited by CORS, so an app can reach any
 * public API through here even when that API sends no CORS header. In a browser or the Android app My PC is a web page
 * itself: the request still goes out, but only APIs that allow other sites (CORS) answer.
 *
 *   WebProxy.request({ url, method, headers, body | json | form, responseType, timeout, stream, maxBytes }, opts, onChunk, cb)
 *     body:   string | ArrayBuffer | typed array | Blob     json: any value (sent as JSON)     form: { name: string | Blob | { data, name, type } }
 *     responseType: 'text' (default) | 'json' | 'arraybuffer'
 *     stream: true   onChunk(text) gets each new piece of the answer as it arrives (Server-Sent Events, long answers)
 *     opts.lan: true allows addresses of the local network (the App Store Manager sets "lan": true in the app's config)
 *   cb(err, { ok, status, statusText, url, headers: { 'content-type': ... }, body })
 *   err: { code: 'blocked' | 'bad-request' | 'network' | 'timeout' | 'too-big' | 'cancelled', message }
 *   returns { abort() }
 * Also used by js/core/ai.js, which loads this file on its own in standalone mode (sdk/mypc-sdk.js). */
var WebProxy = (function () {
    'use strict';

    var TIMEOUT = 30000, TIMEOUT_MAX = 600000, MAX_BYTES = 32 * 1024 * 1024;
    // headers the browser sets itself (setting them only logs an error)
    var FORBIDDEN = /^(host|origin|referer|cookie|cookie2|user-agent|content-length|connection|keep-alive|transfer-encoding|upgrade|te|trailer|date|expect|via|dnt|accept-encoding|accept-charset|access-control-request-.*|proxy-.*|sec-.*)$/i;

    function err(code, message, extra) { var e = { code: code, message: message }; if (extra) for (var k in extra) e[k] = extra[k]; return e; }

    // local network, loopback and link-local addresses (the TV's router, other devices at home)
    function isPrivateHost(h) {
        h = String(h || '').toLowerCase().replace(/^\[|\]$/g, '');
        if (!h || h === 'localhost' || /\.(local|localhost|internal|lan|home|arpa)$/.test(h)) return true;
        var m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
        if (m) {
            var a = +m[1], b = +m[2];
            return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
        }
        if (h.indexOf(':') >= 0) return h === '::1' || h === '::' || /^(fc|fd|fe80)/.test(h) || /^::ffff:/.test(h);
        return false;
    }

    function parseUrl(u) { try { return new URL(String(u)); } catch (e) { return null; } }

    function check(url, opts) {
        var p = parseUrl(url);
        if (!p || (p.protocol !== 'https:' && p.protocol !== 'http:')) return err('bad-request', 'Only http and https addresses can be requested.');
        if (p.username || p.password) return err('bad-request', 'Put credentials in a header, not in the address.');
        if (!(opts && opts.lan) && isPrivateHost(p.hostname)) return err('blocked', 'Addresses of the local network are not allowed for this app.');
        return null;
    }

    function headerObj(xhr) {
        var out = {}, lines = String(xhr.getAllResponseHeaders() || '').split(/\r?\n/);
        for (var i = 0; i < lines.length; i++) {
            var j = lines[i].indexOf(':');
            if (j > 0) { var k = lines[i].slice(0, j).trim().toLowerCase(), v = lines[i].slice(j + 1).trim(); out[k] = out[k] ? out[k] + ', ' + v : v; }
        }
        return out;
    }

    function toBody(req) {
        if (req.form && typeof req.form === 'object') {
            var fd = new FormData();
            Object.keys(req.form).forEach(function (k) {
                var v = req.form[k];
                if (v && typeof v === 'object' && !(v instanceof Blob) && 'data' in v) fd.append(k, v.data instanceof Blob ? v.data : new Blob([v.data], { type: v.type || '' }), v.name || 'file');
                else if (v instanceof Blob) fd.append(k, v, v.name || 'file');
                else if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) fd.append(k, new Blob([v]), 'file');
                else fd.append(k, String(v));
            });
            return { body: fd };
        }
        if (req.json !== undefined) return { body: JSON.stringify(req.json), type: 'application/json' };
        var b = req.body;
        if (b === undefined || b === null) return { body: null };
        if (typeof b === 'string' || b instanceof Blob || b instanceof ArrayBuffer || ArrayBuffer.isView(b)) return { body: b };
        return { body: JSON.stringify(b), type: 'application/json' };
    }

    function request(req, opts, onChunk, cb) {
        var done = false, xhr = null, timer = 0, seen = 0;
        function finish(e, r) { if (done) return; done = true; clearTimeout(timer); cb(e, r); }
        var handle = { abort: function () { if (done) return; try { xhr && xhr.abort(); } catch (x) {} finish(err('cancelled', 'Cancelled.')); } };
        req = req && typeof req === 'object' ? req : {};
        var bad = check(req.url, opts);
        if (bad) { setTimeout(function () { finish(bad); }, 0); return handle; }
        var method = String(req.method || 'GET').toUpperCase();
        if (!/^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(method)) { setTimeout(function () { finish(err('bad-request', 'Unknown method ' + method + '.')); }, 0); return handle; }
        var rt = req.responseType === 'arraybuffer' || req.responseType === 'json' ? req.responseType : 'text';
        var max = Math.min(+req.maxBytes || MAX_BYTES, MAX_BYTES);
        var timeout = Math.max(1000, Math.min(+req.timeout || TIMEOUT, TIMEOUT_MAX));
        var stream = !!req.stream && rt !== 'arraybuffer' && typeof onChunk === 'function';
        var b;
        try { b = toBody(req); } catch (e) { setTimeout(function () { finish(err('bad-request', 'The body could not be sent: ' + e)); }, 0); return handle; }
        try {
            xhr = new XMLHttpRequest();
            xhr.open(method, String(req.url), true);
            xhr.responseType = rt === 'arraybuffer' ? 'arraybuffer' : 'text';
            var hs = req.headers && typeof req.headers === 'object' ? req.headers : {}, hasType = false;
            Object.keys(hs).forEach(function (k) {
                if (FORBIDDEN.test(k) || hs[k] === undefined || hs[k] === null) return;
                if (/^content-type$/i.test(k)) hasType = true;
                xhr.setRequestHeader(k, String(hs[k]));
            });
            if (b.type && !hasType) xhr.setRequestHeader('Content-Type', b.type);
            xhr.onprogress = function (ev) {
                if (ev.loaded > max) { try { xhr.abort(); } catch (x) {} return finish(err('too-big', 'The answer is bigger than ' + Math.round(max / 1048576) + ' MB.')); }
                if (stream) { var t = xhr.responseText || ''; if (t.length > seen) { var piece = t.slice(seen); seen = t.length; try { onChunk(piece); } catch (x) {} } }
            };
            xhr.onload = function () {
                if (stream) { var t = xhr.responseText || ''; if (t.length > seen) { try { onChunk(t.slice(seen)); } catch (x) {} seen = t.length; } }
                var body = rt === 'arraybuffer' ? xhr.response : xhr.responseText;
                if (rt === 'json') { try { body = body ? JSON.parse(body) : null; } catch (x) { /* not JSON: the text stays */ } }
                finish(null, { ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, statusText: xhr.statusText || '', url: xhr.responseURL || String(req.url), headers: headerObj(xhr), body: body });
            };
            xhr.onerror = function () { finish(err('network', 'The request did not reach ' + (parseUrl(req.url) || {}).host + ' (no network, or the site refused it).')); };
            xhr.onabort = function () { finish(err('cancelled', 'Cancelled.')); };
            timer = setTimeout(function () { try { xhr.abort(); } catch (x) {} finish(err('timeout', 'No answer after ' + Math.round(timeout / 1000) + ' s.')); }, timeout);
            xhr.send(b.body);
        } catch (e) { setTimeout(function () { finish(err('bad-request', String(e && e.message || e))); }, 0); }
        return handle;
    }

    /* ---------- base64 (JSON APIs carry media as base64) ---------- */
    function b64(buf) {
        var u = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), s = '', i;
        for (i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
        return btoa(s);
    }
    function unb64(str) {
        var s = atob(String(str).replace(/^data:[^,]*,/, '').replace(/\s+/g, '')), u = new Uint8Array(s.length);
        for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
        return u.buffer;
    }

    // PCM 16-bit little endian -> a .wav file (microphone recordings, Gemini speech)
    function wav(pcm, rate, channels) {
        channels = channels || 1;
        var data = pcm instanceof ArrayBuffer ? new Uint8Array(pcm) : new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
        var out = new ArrayBuffer(44 + data.length), v = new DataView(out), i;
        function str(o, t) { for (i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); }
        str(0, 'RIFF'); v.setUint32(4, 36 + data.length, true); str(8, 'WAVE'); str(12, 'fmt ');
        v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels, true); v.setUint32(24, rate, true);
        v.setUint32(28, rate * channels * 2, true); v.setUint16(32, channels * 2, true); v.setUint16(34, 16, true);
        str(36, 'data'); v.setUint32(40, data.length, true);
        new Uint8Array(out, 44).set(data);
        return out;
    }

    return { request: request, wav: wav, isPrivateHost: isPrivateHost, check: check, b64: b64, unb64: unb64, FORBIDDEN: FORBIDDEN };
})();
