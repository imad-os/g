/* My PC service worker: lets Chrome install the site as an app. Network first, so hosted updates are never stale;
   the last good copy of a file answers when the phone is offline. */
var CACHE = 'mypc-pwa-1';
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
    e.waitUntil(caches.keys().then(function (ks) {
        return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
    var r = e.request;
    if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
    // the Music app's Google Drive songs (js/core/music-src.js): Google wants the token as a header, which <audio> cannot send.
    // This answers __music/gd/<file id>?t=<token> with the song from Drive, the player's Range passed on: it plays at once and seeks.
    var u = new URL(r.url), m = /\/__music\/gd\/([^/?]+)$/.exec(u.pathname);
    if (m) {
        var h = { Authorization: 'Bearer ' + (u.searchParams.get('t') || '') }, rg = r.headers.get('range');
        if (rg) h.Range = rg;
        e.respondWith(fetch('https://www.googleapis.com/drive/v3/files/' + m[1] + '?alt=media', { headers: h }));
        return;
    }
    e.respondWith(fetch(r).then(function (res) {
        if (res && res.ok) { var c = res.clone(); caches.open(CACHE).then(function (ch) { ch.put(r, c); }); }
        return res;
    }).catch(function () { return caches.match(r).then(function (m) { return m || caches.match('index.html'); }); }));
});
