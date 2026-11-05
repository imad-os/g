/* My PC Drive streaming worker, for apps (MyPC.drive.stream, sdk/GUIDE.md "Google Drive").
 * <audio> / <video> cannot send Google's Authorization header, and the app never has a token anyway: My PC reads the
 * file for it. So the app's player points at ./__mypc_drive/<token>; this worker answers each Range request the media
 * stack makes with a 206 piece, which the page reads through My PC (MyPC.drive.read). Seeking works, nothing is stored.
 *
 * Use: put a file sw.js next to your index.html that contains only
 *     importScripts('https://imad-os.github.io/g/sdk/drive-sw.js');
 * (your own worker code may follow), then  MyPC.drive.stream(file, { worker: 'sw.js' }).then((s) => video.src = s.url). */
(function () {
    'use strict';
    var PREFIX = '__mypc_drive/', PIECE = 2 * 1024 * 1024;

    self.addEventListener('install', function () { self.skipWaiting(); });
    self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

    self.addEventListener('fetch', function (event) {
        var url = new URL(event.request.url), at = url.pathname.indexOf('/' + PREFIX);
        if (url.origin !== self.location.origin || at < 0) return;
        event.respondWith(serve(event, url.pathname.slice(at + PREFIX.length + 1)));
    });

    function client(event) {
        return (event.clientId ? self.clients.get(event.clientId) : Promise.resolve(null)).then(function (c) {
            return c || self.clients.matchAll({ type: 'window' }).then(function (all) { return all[0] || null; });
        });
    }

    function serve(event, token) {
        var m = /bytes=(\d+)-(\d*)/.exec(event.request.headers.get('range') || '');
        var start = m ? +m[1] : 0, want = m && m[2] ? +m[2] : start + PIECE - 1, end = Math.min(want, start + PIECE - 1);
        return client(event).then(function (c) {
            if (!c) return new Response('No page', { status: 503 });
            return new Promise(function (resolve) {
                var ch = new MessageChannel(), timer = setTimeout(function () { resolve({ error: 'timeout', status: 504 }); }, 65000);
                ch.port1.onmessage = function (e) { clearTimeout(timer); resolve(e.data); };
                c.postMessage({ mypcDrive: 1, token: token, start: start, end: end }, [ch.port2]);
            }).then(function (a) {
                if (a.error) return new Response(a.error, { status: a.status || 502 });
                var n = a.buf.byteLength;
                return new Response(a.buf, { status: 206, headers: {
                    'Content-Type': a.type || 'application/octet-stream', 'Content-Length': String(n),
                    'Content-Range': 'bytes ' + start + '-' + (start + n - 1) + '/' + (a.total || '*'),
                    'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' } });
            });
        });
    }
})();
