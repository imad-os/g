/* MyPC.open (API 25, owner request 2026-11-27: "in MyDrive, a photo opens in MyPhotos, a video in MyVideos, music in MyMusic"):
 * an installed app hands My PC a file of Google Drive or of a USB drive (and the other files of its folder), My PC closes the
 * app, opens the file in its own app on the desktop page, and Back there (closing that app) opens the app again, which gets
 * MyPC.launch = { from: 'open', app, path: '' } so it can show the folder it was in.
 *
 *   picture -> MyPhotos   (js/launcher/apps/photos.js: a viewer of the folder's pictures, read one at a time, nothing saved)
 *   video   -> MyVideos   (js/launcher/apps/videos.js: USB = the TV's player; Drive = My PC's service worker where there is one,
 *                          else the whole file read first, VIDEO_MAX at most: a bigger one is refused with 'too-big' BEFORE the app
 *                          closes, and the app plays it itself)
 *   song    -> MyMusic    (the folder's songs as the queue, Now playing)
 *
 * The app needs the permission of the place: Drive (MyPC.drive) or the USB drives (MyPC.usb). What to open waits in the profile
 * key open_next (a minute at most) while the page changes, like a shortcut's sc_next (js/launcher/shortcuts.js).
 *
 *   AppOpen.request(ctx, args, reply)   game page, from the 'open' bridge (js/launcher/bridges.js)
 *   AppOpen.resume()                    desktop page, at start: opens what was asked
 *   AppOpen.kindOf(item)                'photo' | 'video' | 'song' | '' */
var AppOpen = (function () {
    'use strict';

    var KEY = 'open_next', MAX_LIST = 500, VIDEO_MAX = 150 * 1048576;
    var EXT = {
        photo: /\.(jpe?g|png|gif|webp|bmp|avif)$/i,
        video: /\.(mp4|m4v|mkv|webm|mov|avi|ts|m2ts|mts|wmv|flv|3gp|mpe?g)$/i,
        song: /\.(mp3|m4a|aac|flac|wav|ogg|oga|opus|wma)$/i
    };

    function err(code, message) { return { code: code, message: message }; }
    function kindOf(it) {
        if (!it) return '';
        var m = String(it.mime || '');
        if (/^image\//.test(m)) return /heic|heif|tiff|svg/i.test(m) ? '' : 'photo';
        if (/^video\//.test(m)) return 'video';
        if (/^audio\//.test(m)) return 'song';
        var n = String(it.n || it.p || '');
        for (var k in EXT) if (EXT[k].test(n)) return k;
        return '';
    }
    // what the SDK sent -> { s: 'gd' | 'usb', p: Drive id or USB path, n, mime, size }
    function clean(x) {
        if (!x || typeof x !== 'object') return null;
        var s = x.s === 'usb' ? 'usb' : x.s === 'gd' ? 'gd' : '';
        var p = String(s === 'usb' ? x.path || x.p || '' : x.id || x.p || '');
        if (!s || !p || p.length > 1024) return null;
        if (s === 'gd' && !/^[A-Za-z0-9_-]{1,200}$/.test(p)) return null;
        if (s === 'usb' && (typeof UsbFs === 'undefined' || !UsbFs.inside(p))) return null;
        return { s: s, p: p, n: String(x.n || (s === 'usb' ? p.replace(/^.*\//, '') : '')).slice(0, 200), mime: String(x.mime || '').slice(0, 100), size: Math.max(0, +x.size || 0) };
    }
    // Drive videos: can this page stream one (My PC's service worker, the web / phone app), or must it read the whole file first?
    function canStream() {
        try { return /^https?:$/.test(location.protocol) && !!(navigator.serviceWorker && navigator.serviceWorker.controller); } catch (e) { return false; }
    }

    /* ---------------- the game page: the app asks ---------------- */
    function request(ctx, a, reply) {
        var item = clean(a.item);
        if (!item) return reply(err('bad-request', 'Give a Google Drive file (with id and mimeType) or a USB entry (with path) of a plugged drive.'));
        var kind = kindOf(item);
        if (!kind) return reply(err('unsupported', 'My PC has no app for this kind of file (pictures, videos and songs only).'));
        if (item.s === 'gd' && !Bridges.allowed(ctx.appId, 'drive')) return reply(err('denied', 'Use MyPC.drive first (the user must allow the app).'));
        if (item.s === 'usb' && !Bridges.allowed(ctx.appId, 'usb')) return reply(err('denied', 'Use MyPC.usb first (the user must allow the app).'));
        if (item.s === 'gd' && kind === 'video' && item.size > VIDEO_MAX && !canStream()) return reply(err('too-big', 'This video is too big for My PC to open from Google Drive on this device: play it in the app.'));
        var list = [], at = 0, src = Array.isArray(a.list) ? a.list.slice(0, MAX_LIST * 2) : [];
        for (var i = 0; i < src.length && list.length < MAX_LIST; i++) {
            var e = clean(src[i]);
            if (!e || e.s !== item.s || kindOf(e) !== kind) continue;
            if (e.p === item.p) at = list.length;
            list.push(e);
        }
        if (!list.length || list[at].p !== item.p) { list.unshift(item); at = 0; }
        if (kind === 'video') { list = [list[at]]; at = 0; }     // MyVideos plays one: Back returns to the app
        Store.set(KEY, { kind: kind, list: list, at: at, back: ctx.appId, title: String(ctx.title || '').slice(0, 60), folder: String(a.folder || '').slice(0, 120), t: Date.now() });
        reply(null, true);
        setTimeout(function () { GameHost.exit(); }, 60);
    }

    /* ---------------- the desktop page ---------------- */
    function back(plan) {
        return function () {
            var id = plan.back, g = null, l = typeof Desktop !== 'undefined' && Desktop.games ? Desktop.games() : [];
            for (var i = 0; i < l.length; i++) if (l[i].id === id) g = l[i];
            try { sessionStorage.setItem('mypc_launch', JSON.stringify({ id: id, launch: { from: 'open', link: '', app: id.replace(/^app-/, ''), path: '', at: Date.now() } })); } catch (e) {}
            if (g) Desktop.play(g);
            else Desktop.show();
        };
    }
    function resume() {
        var p = Store.get(KEY, null);
        if (!p) return false;
        Store.set(KEY, null);
        if (!p.t || Date.now() - p.t > 60000 || !Array.isArray(p.list) || !p.list.length) return false;
        var opts = { onClose: back(p) };
        setTimeout(function () {
            if (p.kind === 'photo') Win.open('photos', { open: p }, opts);
            else if (p.kind === 'video') Win.open('videos', { open: p.list[0], title: p.title }, opts);
            else if (p.kind === 'song') {
                var tracks = p.list.map(function (e) { return { s: e.s, p: e.p, n: e.n, mime: e.mime, size: e.size }; });
                Music.playList(tracks, p.at, { shuffle: false, from: { n: p.folder || p.title, s: p.list[0].s, p: '' } });
                Win.open('music', 'np', opts);
            }
        }, 300);
        return true;
    }

    return { request: request, resume: resume, kindOf: kindOf, canStream: canStream, VIDEO_MAX: VIDEO_MAX };
})();
