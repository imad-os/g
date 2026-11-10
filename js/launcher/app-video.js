/* MyPC.video (API 17): the TV's own video player (Samsung AVPlay) for installed apps.
 *
 * An app runs in a sandboxed cross-origin iframe: it cannot reach webapis.avplay, and an http stream inside an https page
 * is blocked. My PC plays the video for it: the picture is drawn by the TV's video chip on its own plane BEHIND the web page,
 * so while a video is open My PC makes its own layers transparent (html.av-video) and the app keeps its page transparent
 * where the picture must show (the whole screen, or a "hole" for a small preview). The app draws its own controls and
 * subtitles over it.
 *
 *   var v = AppVideo.attach({ appId, title, send(type, data), frame() -> iframe, state() -> 'running' | ... })
 *   v.handle(d)  d = { rid, op, args }      v.pause()  v.resume()  v.destroy()  v.active()
 *
 * ops: open { url, start, live, rect, fit, ua } -> { duration, tracks }    play  pause  stop  seek { t } (seconds)
 *      rect { x, y, w, h, vw, vh } | { full: 1 }    fit { mode: 'fit' | 'fill' | 'auto' }    tracks -> tracks
 *      track { kind: 'audio' | 'text', index }    subs { on }    speed { rate }    state -> { state, t, d }
 * events (rid 0): { ev: 'state', state: 'buffering' | 'playing' | 'paused' | 'ended' | 'idle' }  { ev: 'buffer', p }
 *      { ev: 'time', t, d }  (twice a second)  { ev: 'sub', text, dur }  { ev: 'error', code }  { ev: 'info', w, h }
 * Only one video at a time (the TV has one player: My PC's music stops). A USB path (/opt/media/USBDriveA1/...) plays
 * once the app is allowed to use the USB drives (MyPC.usb). Everything is closed when the app closes. */
var AppVideo = (function () {
    'use strict';

    var obj = null;

    function api() { return typeof webapis !== 'undefined' && webapis.avplay ? webapis.avplay : null; }
    function supported() { return !!api(); }

    function ensureObj() {
        if (obj) return;
        obj = document.createElement('object');
        obj.setAttribute('type', 'application/avplayer');
        obj.id = 'app-avplayer';
        obj.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;z-index:-1;pointer-events:none';
        document.body.appendChild(obj);
    }
    function freeObj() { if (obj && obj.parentNode) obj.parentNode.removeChild(obj); obj = null; }
    function transparent(on) { document.documentElement.classList.toggle('av-video', !!on); }

    function err(code, message) { return { code: code, message: message || code }; }
    function avCode(e) {
        var s = String(e && (e.name || e.message || e) || 'error');
        if (/CONNECTION_FAILED|NETWORK/i.test(s)) return 'network';
        if (/NOT_SUPPORTED_FORMAT|NOT_SUPPORTED_FILE|UNSUPPORTED|CODEC/i.test(s)) return 'format';
        if (/INVALID_URI|NOT_FOUND|404/i.test(s)) return 'not-found';
        if (/DRM/i.test(s)) return 'drm';
        return 'player';
    }

    function attach(ctx) {
        var a = api(), open = false, playing = false, wasPlaying = false, suspended = false, live = false;
        var dur = 0, lastTimeAt = 0, lastBuf = -1, seq = 0, rect = null, fit = 'fit', prepTimer = 0;

        function ev(d) { d.rid = 0; ctx.send('video', d); }
        function alive() { return ctx.state() === 'running' || ctx.state() === 'paused'; }

        // the app's rectangle (its own CSS pixels and window size) -> the TV's 1920x1080 video plane
        function place() {
            if (!a || !open) return;
            var f = ctx.frame(), b = f ? f.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
            var x = b.left, y = b.top, w = b.width, h = b.height;
            if (rect && rect.vw > 0 && rect.vh > 0) {
                x = b.left + rect.x / rect.vw * b.width; y = b.top + rect.y / rect.vh * b.height;
                w = rect.w / rect.vw * b.width; h = rect.h / rect.vh * b.height;
            }
            var k = 1920 / (window.innerWidth || 1920);
            try { a.setDisplayRect(Math.round(x * k), Math.round(y * k), Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))); } catch (e) {}
        }
        function method() {
            var m = fit === 'fill' ? 'PLAYER_DISPLAY_MODE_FULL_SCREEN' : fit === 'auto' ? 'PLAYER_DISPLAY_MODE_AUTO_ASPECT_RATIO' : 'PLAYER_DISPLAY_MODE_LETTER_BOX';
            try { a.setDisplayMethod(m); } catch (e) {}
        }
        function duration() { try { var d = a.getDuration(); return d > 0 ? d / 1000 : 0; } catch (e) { return 0; } }
        function now() { try { var t = a.getCurrentTime(); return t >= 0 ? t / 1000 : 0; } catch (e) { return 0; } }
        function tracks() {
            var out = { audio: [], text: [], video: {}, cur: { audio: -1, text: -1 } }, i, all = [], cur = [];
            try { all = a.getTotalTrackInfo() || []; } catch (e) {}
            for (i = 0; i < all.length; i++) {
                var t = all[i], x = {};
                try { x = JSON.parse(t.extra_info || '{}') || {}; } catch (e2) {}
                var lang = String(x.language || x.lang || x.track_lang || '');
                if (t.type === 'AUDIO') out.audio.push({ index: t.index, lang: lang, codec: String(x.fourCC || ''), channels: +x.channels || 0 });
                else if (t.type === 'TEXT') out.text.push({ index: t.index, lang: lang, kind: String(x.subtitle_type || '') });
                else if (t.type === 'VIDEO') out.video = { w: +x.Width || 0, h: +x.Height || 0, fps: +x.fps || 0, bitrate: +x.Bit_rate || 0, codec: String(x.fourCC || '') };
            }
            try { cur = a.getCurrentStreamInfo() || []; } catch (e3) {}
            for (i = 0; i < cur.length; i++) {
                if (cur[i].type === 'AUDIO') out.cur.audio = cur[i].index;
                else if (cur[i].type === 'TEXT') out.cur.text = cur[i].index;
            }
            return out;
        }
        function close() {
            clearTimeout(prepTimer);
            seq++;
            if (!a) return;
            if (open) {
                try { a.stop(); } catch (e) {}
                try { a.setDisplayRect(0, 0, 0, 0); } catch (e1) {}
                try { a.close(); } catch (e2) {}
            }
            open = playing = wasPlaying = suspended = false;
            transparent(false);
        }
        function onVis() {
            if (!open || !a) return;
            if (document.hidden) { try { a.suspend(); suspended = true; } catch (e) { try { a.pause(); } catch (e2) {} } playing = false; }
            else if (suspended) {
                suspended = false;
                try { a.restore(); } catch (e) { ev({ ev: 'error', code: 'restore' }); }
                try { a.pause(); } catch (e3) {}         // My PC's menu is open (the app was paused): it plays again on Resume
                ev({ ev: 'state', state: 'paused' });
            }
        }
        document.addEventListener('visibilitychange', onVis);

        function doOpen(o, reply) {
            if (!a) return reply(err('unsupported', 'This device has no TV player (only a TV has one): use a <video> element.'));
            var url = String(o.url || '');
            if (/^\/opt\/media\//.test(url)) {
                if (typeof UsbFs === 'undefined' || !UsbFs.inside(url)) return reply(err('bad-request', 'Not a path inside a plugged USB drive.'));
                if (!Bridges.allowed(ctx.appId, 'usb')) return reply(err('denied', 'Ask for the USB drives first (MyPC.usb).'));
                try { var fsys = tizen.filesystem; url = fsys && fsys.toURI ? fsys.toURI(url) : 'file://' + encodeURI(url); } catch (x) { url = 'file://' + encodeURI(url); }
            } else if (!/^https?:\/\/[^\s]+$/i.test(url) && !/^(rtsp|rtmp|udp|rtp):\/\/[^\s]+$/i.test(url)) return reply(err('bad-request', 'The address must start with http(s)://, rtsp://, rtmp://, udp:// or be a USB path.'));
            close();
            // the TV has one player: My PC's own music gives way
            try { if (typeof Music !== 'undefined' && Music.state && Music.state().playing) Music.stop(); } catch (x2) {}
            ensureObj();
            transparent(true);
            var my = ++seq, done = false;
            live = !!o.live; dur = 0; lastBuf = -1; lastTimeAt = 0;
            rect = o.rect && typeof o.rect === 'object' ? o.rect : null;
            fit = /^(fit|fill|auto)$/.test(o.fit) ? o.fit : 'fit';
            function fail(e) {
                if (done || my !== seq) return;
                done = true; clearTimeout(prepTimer);
                close();
                reply(err(e === 'timeout' ? 'timeout' : avCode(e), String(e && (e.name || e.message) || e)));
            }
            try {
                a.open(url);
                open = true;
                a.setListener({
                    onbufferingstart: function () { if (my === seq) ev({ ev: 'state', state: 'buffering' }); },
                    onbufferingprogress: function (p) { p = Math.round(+p || 0); if (my === seq && Math.abs(p - lastBuf) >= 5) { lastBuf = p; ev({ ev: 'buffer', p: p }); } },
                    onbufferingcomplete: function () { lastBuf = -1; if (my === seq) ev({ ev: 'state', state: playing ? 'playing' : 'paused' }); },
                    oncurrentplaytime: function (ms) {
                        if (my !== seq) return;
                        var t = Date.now();
                        if (t - lastTimeAt < 500) return;
                        lastTimeAt = t;
                        if (!dur) dur = duration();
                        ev({ ev: 'time', t: (+ms || 0) / 1000, d: dur });
                    },
                    onstreamcompleted: function () { if (my !== seq) return; playing = false; ev({ ev: 'state', state: 'ended' }); },
                    onerror: function (e) { if (!done) return fail(e); if (my === seq) { playing = false; ev({ ev: 'error', code: avCode(e), message: String(e) }); } },
                    onevent: function (type, data) {
                        if (my !== seq) return;
                        if (/RESOLUTION_CHANGED|BITRATE_CHANGE|STREAM_INFO_READY/.test(String(type))) { var tr = tracks(); ev({ ev: 'info', w: tr.video.w || 0, h: tr.video.h || 0, data: String(data || '').slice(0, 200) }); }
                    },
                    onsubtitlechange: function (d, text) { if (my === seq) ev({ ev: 'sub', text: String(text || '').slice(0, 2000), dur: +d || 0 }); },
                    ondrmevent: function () {}
                });
                if (typeof o.ua === 'string' && o.ua) { try { a.setStreamingProperty('USER_AGENT', o.ua.slice(0, 300)); } catch (x3) {} }
                place();
                method();
                prepTimer = setTimeout(function () { fail('timeout'); }, 30000);
                a.prepareAsync(function () {
                    if (done || my !== seq) return;
                    done = true; clearTimeout(prepTimer);
                    place();
                    dur = duration();
                    var start = +o.start || 0;
                    function go() {
                        if (my !== seq) return;
                        // My PC's menu opened meanwhile: stays paused until Resume
                        if (ctx.state() === 'paused') { wasPlaying = true; playing = false; }
                        else { try { a.play(); playing = true; } catch (e5) {} }
                        reply(null, { duration: dur, live: live, tracks: tracks() });
                        ev({ ev: 'state', state: playing ? 'playing' : 'paused' });
                    }
                    if (start > 1 && !live) { try { a.seekTo(Math.floor(start * 1000), go, go); } catch (e4) { go(); } }
                    else go();
                }, fail);
            } catch (e) { fail(e); }
        }

        function handle(d) {
            var o = d.args && typeof d.args === 'object' ? d.args : {};
            function reply(e, r) { ctx.send('video', e ? { rid: d.rid, error: e } : { rid: d.rid, result: r === undefined ? null : r }); }
            if (d.op === 'open') {
                if (!alive()) return reply(err('not-running', 'The app is not running.'));
                return doOpen(o, reply);
            }
            if (!a) return reply(err('unsupported', 'This device has no TV player.'));
            if (d.op === 'stop') { close(); ev({ ev: 'state', state: 'idle' }); return reply(null, true); }
            if (!open) return reply(err('not-open', 'No video is open.'));
            switch (d.op) {
                case 'play':
                    if (ctx.state() !== 'running') { wasPlaying = true; return reply(null, false); }
                    try { a.play(); playing = true; } catch (e) { return reply(err('player', String(e))); }
                    ev({ ev: 'state', state: 'playing' });
                    return reply(null, true);
                case 'pause':
                    try { a.pause(); } catch (e1) {}
                    playing = false; wasPlaying = false;
                    ev({ ev: 'state', state: 'paused' });
                    return reply(null, true);
                case 'seek':
                    if (live) return reply(err('live', 'A live stream cannot be moved in time.'));
                    var ms = Math.max(0, Math.floor((+o.t || 0) * 1000));
                    if (dur > 0) ms = Math.min(ms, Math.max(0, dur * 1000 - 1000));
                    try { a.seekTo(ms, function () { reply(null, ms / 1000); }, function (e2) { reply(err('player', String(e2))); }); } catch (e3) { reply(err('player', String(e3))); }
                    return;
                case 'rect':
                    rect = o.full ? null : o;
                    place();
                    return reply(null, true);
                case 'fit':
                    fit = /^(fit|fill|auto)$/.test(o.mode) ? o.mode : 'fit';
                    method(); place();
                    return reply(null, fit);
                case 'tracks': return reply(null, tracks());
                case 'track':
                    try { a.setSelectTrack(o.kind === 'text' ? 'TEXT' : 'AUDIO', Math.floor(+o.index || 0)); } catch (e4) { return reply(err('player', String(e4))); }
                    return reply(null, tracks());
                case 'subs':
                    try { a.setSilentSubtitle(!o.on); } catch (e5) {}
                    return reply(null, !!o.on);
                case 'speed':
                    if (live) return reply(err('live', 'A live stream cannot change speed.'));
                    var r = Math.max(-16, Math.min(16, Math.round(+o.rate || 1)));
                    try { a.setSpeed(r || 1); } catch (e6) { return reply(err('player', String(e6))); }
                    return reply(null, r || 1);
                case 'state':
                    var st = '';
                    try { st = String(a.getState()).toLowerCase(); } catch (e7) {}
                    return reply(null, { state: st, t: now(), d: dur || duration() });
            }
            reply(err('bad-request', 'Unknown video operation ' + d.op + '.'));
        }

        return {
            handle: handle,
            active: function () { return open; },
            // My PC's menu (or another of its screens) covers the app: the video waits under it
            pause: function () {
                if (!open || !a) return;
                if (playing) { wasPlaying = true; try { a.pause(); } catch (e) {} playing = false; ev({ ev: 'state', state: 'paused' }); }
            },
            resume: function () {
                if (!open || !a || !wasPlaying) return;
                wasPlaying = false;
                if (suspended) { suspended = false; try { a.restore(); } catch (e0) {} }
                try { a.play(); playing = true; } catch (e) {}
                ev({ ev: 'state', state: 'playing' });
            },
            destroy: function () { document.removeEventListener('visibilitychange', onVis); close(); freeObj(); }
        };
    }

    return { attach: attach, supported: supported };
})();
