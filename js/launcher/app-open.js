/* MyPC.open (API 25, owner request 2026-11-27: "in MyDrive, a photo opens in MyPhotos, a video in MyVideos, music in MyMusic"):
 * an installed app hands My PC a file of Google Drive or of a USB drive (and the other files of its folder), and My PC shows it
 * in its own app ON TOP of the running app (owner request 2026-11-28: "it unloads MyDrive, goes back to My PC and reloads MyDrive
 * with the loading screen: very bad"). Nothing reloads: the app is held (paused, no input, its frame hidden under the window once
 * it is covered), the window opens with a zoom from the file's tile, and Back / close shrinks it back and the app goes on at
 * once (onResume), on the same screen.
 *
 *   picture -> MyPhotos   (js/launcher/apps/photos.js: a viewer of the folder's pictures, read one at a time, nothing saved)
 *   video   -> MyVideos   (js/launcher/apps/videos.js: USB = the TV's player; Drive = My PC's service worker where there is one,
 *                          else the whole file read first, VIDEO_MAX at most: a bigger one is refused with 'too-big' and the app
 *                          plays it itself)
 *   song    -> MyMusic    (the folder's songs as the queue, Now playing; the music goes on after Back, under the app)
 *
 * The app says which of them it uses: MyPC.init({ uses: ['photos', 'videos', 'music'] }) ('all' = the three). Those are the
 * only ones it may open, and My PC gets them ready as soon as the app runs (the window's layer and MyMusic's library), in idle
 * time, so the first open is as quick as the next ones. An app that declares nothing (MyDrive 1.3.0) may open all three.
 * The app needs the permission of the place: Drive (MyPC.drive) or the USB drives (MyPC.usb).
 *
 *   AppOpen.hello(appId, uses)          game-host.js, the app's hello
 *   AppOpen.request(ctx, args, reply)   the 'open' bridge (js/launcher/bridges.js)
 *   AppOpen.isOpen()                    a built-in app is over the app (main.js routes the keys to Win)
 *   AppOpen.justClosed()                the key that closed it is still being let go (main.js keeps it from the app)
 *   AppOpen.appGone()                   game-host.js teardown
 *   AppOpen.kindOf(item)                'photo' | 'video' | 'song' | '' */
var AppOpen = (function () {
    'use strict';

    var MAX_LIST = 500, VIDEO_MAX = 150 * 1048576, ANIM = 240;
    var APPS = { photo: 'photos', video: 'videos', song: 'music' };
    var EXT = {
        photo: /\.(jpe?g|png|gif|webp|bmp|avif)$/i,
        video: /\.(mp4|m4v|mkv|webm|mov|avi|ts|m2ts|mts|wmv|flv|3gp|mpe?g)$/i,
        song: /\.(mp3|m4a|aac|flac|wav|ogg|oga|opus|wma)$/i
    };
    var uses = {}, cur = null, closedAt = 0;          // uses: appId -> { photos, videos, music } | null (= all); cur: the open one { held, appId }

    function $(id) { return document.getElementById(id); }
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
    function smooth() {
        try { if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return false; } catch (e) {}
        return typeof Perf === 'undefined' || Perf.profile().tier !== 'low';
    }

    /* ---------------- the app says what it uses ---------------- */
    function hello(appId, list) {
        var u = null;
        if (Array.isArray(list) && list.length) {
            u = {};
            for (var i = 0; i < list.length && i < 8; i++) {
                var n = String(list[i]).toLowerCase();
                if (n === 'all') { u = null; break; }
                if (n === 'photos' || n === 'myphotos') u.photos = 1;
                else if (n === 'videos' || n === 'myvideos') u.videos = 1;
                else if (n === 'music' || n === 'mymusic') u.music = 1;
            }
        }
        uses[appId] = u;
        if (Array.isArray(list) && list.length) warm(u);
    }
    // ready before the first open, in idle time once the app has started: the window on its own layer, MyMusic's library read
    function warm(u) {
        var later = window.requestIdleCallback || function (fn) { return setTimeout(fn, 1500); };
        later(function () {
            var w = $('window');
            if (w) w.classList.add('win-warm');
            if ((!u || u.music) && typeof Music !== 'undefined' && Music.init) { try { Music.init({ lite: true }); } catch (e) {} }
        }, { timeout: 4000 });
    }

    /* ---------------- the zoom from the file's tile ---------------- */
    // from = { x, y, w, h, vw, vh } in the app's own CSS pixels -> a transform of the window (origin top left) that puts it there
    function fromTransform(from) {
        var w = $('window'), f = $('game-frame-box') && $('game-frame-box').querySelector('iframe');
        if (!w || !f || !from || !(from.vw > 0 && from.vh > 0 && from.w > 0 && from.h > 0)) return '';
        var fr = f.getBoundingClientRect(), wr = w.getBoundingClientRect();
        if (!wr.width || !wr.height || !w.offsetWidth) return '';
        var kx = fr.width / from.vw, ky = fr.height / from.vh, unit = wr.width / w.offsetWidth;
        var left = fr.left + from.x * kx, top = fr.top + from.y * ky, sw = from.w * kx, sh = from.h * ky;
        var sx = sw / wr.width, sy = sh / wr.height;
        if (!(sx > 0 && sy > 0 && sx < 1.01 && sy < 1.01)) return '';
        return 'translate(' + ((left - wr.left) / unit).toFixed(1) + 'px,' + ((top - wr.top) / unit).toFixed(1) + 'px) scale(' + sx.toFixed(4) + ',' + sy.toFixed(4) + ')';
    }
    function animate(el, from, opening, done) {
        if (!el.animate || !smooth()) { if (done) done(); return; }
        var tf = from || 'scale(0.92)';
        var a = { transform: tf, opacity: from ? 0.35 : 0, borderRadius: '24px' }, b = { transform: 'none', opacity: 1, borderRadius: '0px' };
        var an;
        try { an = el.animate(opening ? [a, b] : [b, a], { duration: opening ? ANIM : ANIM - 60, easing: opening ? 'cubic-bezier(.2,.8,.2,1)' : 'cubic-bezier(.4,0,1,1)', fill: 'none' }); }
        catch (e) { if (done) done(); return; }
        var fin = false, end = function () { if (fin) return; fin = true; if (done) done(); };
        an.onfinish = end; an.oncancel = end;
        setTimeout(end, ANIM + 200);           // a TV that drops the event
    }

    /* ---------------- open over the app ---------------- */
    function request(ctx, a, reply) {
        var item = clean(a.item);
        if (!item) return reply(err('bad-request', 'Give a Google Drive file (with id and mimeType) or a USB entry (with path) of a plugged drive.'));
        var kind = kindOf(item);
        if (!kind) return reply(err('unsupported', 'My PC has no app for this kind of file (pictures, videos and songs only).'));
        var u = uses[ctx.appId];
        if (u && !u[APPS[kind]]) return reply(err('unsupported', 'Add \'' + APPS[kind] + '\' to MyPC.init({ uses: [...] }) to open ' + kind + 's.'));
        if (item.s === 'gd' && !Bridges.allowed(ctx.appId, 'drive')) return reply(err('denied', 'Use MyPC.drive first (the user must allow the app).'));
        if (item.s === 'usb' && !Bridges.allowed(ctx.appId, 'usb')) return reply(err('denied', 'Use MyPC.usb first (the user must allow the app).'));
        if (item.s === 'gd' && kind === 'video' && item.size > VIDEO_MAX && !canStream()) return reply(err('too-big', 'This video is too big for My PC to open from Google Drive on this device: play it in the app.'));
        if (cur || (typeof Win !== 'undefined' && Win.isOpen())) return reply(err('busy', 'A file is already open.'));
        if (GameHost.state() !== 'running') return reply(err('not-running', 'The app is not running.'));
        var list = [], at = 0, src = Array.isArray(a.list) ? a.list.slice(0, MAX_LIST * 2) : [];
        for (var i = 0; i < src.length && list.length < MAX_LIST; i++) {
            var e = clean(src[i]);
            if (!e || e.s !== item.s || kindOf(e) !== kind) continue;
            if (e.p === item.p) at = list.length;
            list.push(e);
        }
        if (!list.length || list[at].p !== item.p) { list.unshift(item); at = 0; }
        if (kind === 'video') { list = [list[at]]; at = 0; }     // MyVideos plays one: Back returns to the app
        var plan = { kind: kind, list: list, at: at, title: String(ctx.title || '').slice(0, 60), folder: String(a.folder || '').slice(0, 120) };
        var from = a.from && typeof a.from === 'object' ? { x: +a.from.x || 0, y: +a.from.y || 0, w: +a.from.w || 0, h: +a.from.h || 0, vw: +a.from.vw || 0, vh: +a.from.vh || 0 } : null;
        show(ctx, plan, from);
        reply(null, true);
    }

    function show(ctx, p, from) {
        var held = GameHost.hold();
        var me = cur = { held: held, appId: ctx.appId };
        var w = $('window');
        document.documentElement.classList.add('win-over-app');
        var opts = { onBeforeClose: function () { snap(me); }, onClose: function () { close(me); } };
        if (p.kind === 'photo') Win.open('photos', { open: p }, opts);
        else if (p.kind === 'video') Win.open('videos', { open: p.list[0], title: p.title }, opts);
        else {
            var tracks = p.list.map(function (e) { return { s: e.s, p: e.p, n: e.n, mime: e.mime, size: e.size }; });
            Music.playList(tracks, p.at, { shuffle: false, from: { n: p.folder || p.title, s: p.list[0].s, p: '' } });
            Win.open('music', { np: 1, back: p.title }, opts);
        }
        // once the window covers it, the app's frame is not drawn at all (and the TV's video plane shows MyVideos, not the app)
        me.tf = fromTransform(from);
        animate(w, me.tf, true, function () { if (cur === me) document.documentElement.classList.add('win-covers-app'); });
    }
    // Win is about to close it (Back on its first screen, or its close button): a copy of its screen for the closing zoom
    function snap(me) {
        var w = $('window');
        if (cur !== me || !w || !w.animate || !smooth()) return;
        var g = w.cloneNode(true);
        g.removeAttribute('id');
        g.removeAttribute('role');
        g.setAttribute('aria-hidden', 'true');
        g.classList.add('win-ghost');
        var drop = g.querySelectorAll('video, audio, iframe, [id]');        // no second player, no duplicate ids
        for (var i = 0; i < drop.length; i++) {
            if (/^(VIDEO|AUDIO|IFRAME)$/.test(drop[i].tagName)) drop[i].parentNode.removeChild(drop[i]);
            else drop[i].removeAttribute('id');
        }
        me.ghost = g;
    }
    // Win closed it: shrink back to the tile, the app goes on at once
    function close(me) {
        if (cur !== me) return;
        var w = $('window'), ghost = me.ghost;
        me.ghost = null;
        document.documentElement.classList.remove('win-covers-app');
        if (ghost && w && w.parentNode) w.parentNode.insertBefore(ghost, w.nextSibling);
        cur = null; closedAt = Date.now();
        try { Focus.reset(); } catch (e) {}
        GameHost.release(me.held);
        if (!ghost) { document.documentElement.classList.remove('win-over-app'); return; }
        animate(ghost, me.tf, false, function () {
            if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
            if (!cur) document.documentElement.classList.remove('win-over-app');
        });
    }
    // the app went away under it (quit from My PC's menu, a crash): the window goes too
    function appGone() { if (cur && typeof Win !== 'undefined' && Win.isOpen()) Win.close(true); cur = null; document.documentElement.classList.remove('win-over-app', 'win-covers-app'); }

    return { hello: hello, request: request, appGone: appGone, isOpen: function () { return !!cur; }, justClosed: function () { return Date.now() - closedAt < 400; }, kindOf: kindOf, canStream: canStream, VIDEO_MAX: VIDEO_MAX };
})();
