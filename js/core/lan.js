/* Lan: the home network, without any server on the internet.
 *
 * A TV web app cannot listen on a port, so on the local network the TV is always the one that asks: the phone (the My PC
 * Android app) runs a small web server on port 47800 (android-controller/.../LanServer.java) and the TV finds it by asking
 * every address of its own network (a /24: 192.168.1.1 .. 192.168.1.254) in small parallel batches.
 *
 *   Lan.ip(cb)              cb(ip | null)  this device's IPv4 on the home network: the TV's own (webapis.network.getIp, Tizen
 *                           systeminfo WIFI / ETHERNET), else WebRTC's host candidate (a browser), else null. The address set
 *                           by hand (Lan.setIp, TV-wide arc_dev_lan_ip) wins: a TV that cannot tell, or tests.
 *   Lan.subnet(ip)          '192.168.1.' (the first three numbers), or '' when ip is not a private IPv4 address
 *   Lan.isPrivate(ip)       10.x, 172.16-31.x, 192.168.x (and 127.x for tests)
 *   Lan.scan(o)             asks every address of the subnet: o = { port, path, match(json, ip) -> bool, timeout (ms, 700),
 *                           parallel (40), first: [ip, ...] (asked first: the addresses found last time), ip (own, else
 *                           Lan.ip), onFound(ip, json), onProgress(done, total), onDone(found[]) }  -> { stop() }
 *   Lan.get(url, ms, cb)    cb(err, json)  one GET (no custom header: no CORS preflight); err 'timeout' / 'http <n>' / 'net'
 *   Lan.post(url, body, ms, cb)   the same with a text/plain body (still no preflight)
 *
 * Light on purpose for small TVs: plain fetch + AbortController, no timer while nothing is asked, a scan stops by itself
 * once every address answered or timed out (a /24 takes ~4-6 s on Wi-Fi). */
var Lan = (function () {
    'use strict';

    var KEY = 'arc_dev_lan_ip';
    var cached = null, cachedAt = 0;

    function isPrivate(ip) {
        var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip || ''));
        if (!m) return false;
        var a = +m[1], b = +m[2];
        return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 127;
    }
    function subnet(ip) { return isPrivate(ip) ? String(ip).replace(/\d+$/, '') : ''; }

    function manual() { try { var v = localStorage.getItem(KEY); return v && isPrivate(v) ? v : ''; } catch (e) { return ''; } }
    function setIp(ip) {
        try { if (ip && isPrivate(ip)) localStorage.setItem(KEY, ip); else localStorage.removeItem(KEY); } catch (e) {}
        cached = null;
    }

    function tvIp() {
        try {
            if (typeof webapis !== 'undefined' && webapis.network && webapis.network.getIp) {
                var v = webapis.network.getIp();
                if (isPrivate(v)) return v;
            }
        } catch (e) {}
        return '';
    }

    function sysinfo(cb) {
        var si = typeof tizen !== 'undefined' && tizen.systeminfo && tizen.systeminfo.getPropertyValue ? tizen.systeminfo : null;
        if (!si) return cb('');
        var props = ['WIFI_NETWORK', 'ETHERNET_NETWORK'], i = 0;
        (function next() {
            if (i >= props.length) return cb('');
            var p = props[i++], done = false;
            var t = setTimeout(function () { if (!done) { done = true; next(); } }, 800);
            try {
                si.getPropertyValue(p, function (v) {
                    if (done) return; done = true; clearTimeout(t);
                    if (v && isPrivate(v.ipAddress)) cb(v.ipAddress); else next();
                }, function () { if (!done) { done = true; clearTimeout(t); next(); } });
            } catch (e) { if (!done) { done = true; clearTimeout(t); next(); } }
        })();
    }

    // a browser: the host candidate of a data channel (Chrome hides it behind a .local name unless a flag says otherwise)
    function rtc(cb) {
        var PC = window.RTCPeerConnection || window.webkitRTCPeerConnection;
        if (!PC) return cb('');
        var pc = null, done = false, t = 0;
        function end(ip) {
            if (done) return; done = true; clearTimeout(t);
            try { pc.close(); } catch (e) {}
            cb(ip || '');
        }
        try {
            pc = new PC({ iceServers: [] });
            pc.createDataChannel('ip');
            pc.onicecandidate = function (e) {
                if (!e.candidate) return end('');
                var m = /(\d{1,3}(?:\.\d{1,3}){3})/.exec(e.candidate.candidate || '');
                if (m && isPrivate(m[1]) && m[1].indexOf('127.') !== 0) end(m[1]);
            };
            pc.createOffer().then(function (o) { return pc.setLocalDescription(o); }).catch(function () { end(''); });
            t = setTimeout(function () { end(''); }, 1500);
        } catch (e) { end(''); }
    }

    function ip(cb) {
        var m = manual();
        if (m) return cb(m);
        if (cached && Date.now() - cachedAt < 60000) return cb(cached);
        function got(v) { if (v) { cached = v; cachedAt = Date.now(); } cb(v || null); }
        var v = tvIp();
        if (v) return got(v);
        sysinfo(function (s) { if (s) return got(s); rtc(got); });
    }

    function request(url, init, ms, cb) {
        var done = false, ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var t = setTimeout(function () { if (done) return; done = true; if (ctl) { try { ctl.abort(); } catch (e) {} } cb('timeout'); }, ms || 3000);
        if (ctl) init.signal = ctl.signal;
        init.cache = 'no-store';
        init.credentials = 'omit';
        fetch(url, init).then(function (r) {
            if (!r.ok) throw new Error('http ' + r.status);
            return r.text();
        }).then(function (txt) {
            if (done) return; done = true; clearTimeout(t);
            var j = null;
            try { j = JSON.parse(txt); } catch (e) { return cb('json'); }
            cb(null, j);
        }).catch(function (e) {
            if (done) return; done = true; clearTimeout(t);
            cb(/^http \d+/.test(e && e.message) ? e.message : 'net');
        });
        return { abort: function () { if (done) return; done = true; clearTimeout(t); if (ctl) { try { ctl.abort(); } catch (e) {} } } };
    }
    function get(url, ms, cb) { return request(url, { method: 'GET' }, ms, cb); }
    function post(url, body, ms, cb) { return request(url, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body || {}), headers: { 'Content-Type': 'text/plain' } }, ms, cb); }

    function scan(o) {
        o = o || {};
        var stopped = false, live = [], found = [], list = [], at = 0, done = 0;
        var port = o.port || 47800, path = o.path || '/', ms = o.timeout || 700, par = o.parallel || 40;
        function finish() {
            if (stopped) return;
            stopped = true;
            if (o.onDone) { try { o.onDone(found.slice()); } catch (e) {} }
        }
        function one() {
            if (stopped) return;
            if (at >= list.length) { if (!live.length) finish(); return; }
            var host = list[at++], req = null;
            req = get('http://' + host + ':' + port + path, ms, function (err, j) {
                var k = live.indexOf(req); if (k >= 0) live.splice(k, 1);
                done++;
                if (!stopped && !err && j && (!o.match || o.match(j, host))) {
                    found.push(host);
                    if (o.onFound) { try { o.onFound(host, j); } catch (e) {} }
                }
                if (!stopped && o.onProgress) { try { o.onProgress(done, list.length); } catch (e2) {} }
                setTimeout(one, 0);
            });
            live.push(req);
        }
        function start(own) {
            if (stopped) return;
            var net = subnet(own), seen = {}, i;
            function add(h) { if (h && !seen[h] && h !== own && isPrivate(h)) { seen[h] = 1; list.push(h); } }
            var first = o.first || [];
            for (i = 0; i < first.length; i++) add(first[i]);
            if (net) for (i = 1; i < 255; i++) add(net + i);
            if (!list.length) return finish();
            for (i = 0; i < par; i++) one();
        }
        if (o.ip) setTimeout(function () { start(o.ip); }, 0);
        else ip(function (v) { start(v || ''); });
        return {
            stop: function () {
                if (stopped) return;
                stopped = true;
                for (var i = 0; i < live.length; i++) { try { live[i].abort(); } catch (e) {} }
                live = [];
            },
            running: function () { return !stopped; }
        };
    }

    return { ip: ip, setIp: setIp, manualIp: manual, subnet: subnet, isPrivate: isPrivate, scan: scan, get: get, post: post };
})();
