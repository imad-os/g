/* Music: the player behind the Music app (js/launcher/apps/music.js), the Music Player widget and the remote's media keys.
 *
 * One queue per profile, played by the TV's own media player when there is one (Samsung AVPlay: hardware decoding, more
 * formats, almost no CPU), else (or when AVPlay cannot open a song) one <audio> element. Songs come from
 * js/core/music-src.js (USB drives, Google Drive through MyDrive, a folder of a PC).
 *
 *   Music.init({ resume })        on the desktop page only (main.js): loads the profile's queue; resume = back from a game:
 *                                 plays on where it was when "Keep playing after a game" is on
 *   Music.playList(tracks, start, { shuffle, from })   a new queue (from: what it is, shown in the app: a folder, a playlist)
 *   Music.enqueue(tracks, next)   adds to the queue (next: right after the current song)
 *   play / pause / toggle / next / prev / stop / seek(s) / seekBy(ds) / pick(queueIndex) / remove(queueIndex)
 *   setShuffle(on) / setRepeat('off' | 'all' | 'one') / cycleRepeat()
 *   state() -> { has, title, artist, album, dur, pos, playing, loading, index, count, track, shuffle, repeat, from, error }
 *   queue() -> { list, order, at }        onChange(fn) / offChange(fn): fn(what) after every change ('time' is not one)
 *   prefs() / setPref(k, v)               the profile's Music settings (music_prefs)
 *
 * Saved per profile: the queue in "music" (backed up with the profile, written only when the queue changes) and where it
 * was in arc_dev_music_pos (per profile inside, NOT in the cloud backup: it changes every few seconds while playing).
 * No timer runs while nothing plays. The app and the widget read state() when they draw. */
var Music = (function () {
    'use strict';

    var KEY = 'music', POS = 'arc_dev_music_pos', PREFS = 'music_prefs', MAXQ = 1000, SAVE_EVERY = 15000;
    var DEFAULT_PREFS = { saver: 'bars', saverMin: 2, resume: true, engine: 'auto', sub: true, details: true };

    var q = [], order = [], at = 0, shuffle = false, repeat = 'off', from = null;
    var playing = false, loading = false, want = false, lastPos = 0, lastDur = 0, error = '', fails = 0;
    var engine = null, gen = 0, blobUrl = '', saveTimer = 0, inited = false, hiddenPause = false, leaving = false, lite = false;
    var listeners = [];

    function t(k) { return typeof I18n !== 'undefined' ? I18n.t(k) : k; }
    function emit(what) { for (var i = 0; i < listeners.length; i++) { try { listeners[i](what || ''); } catch (e) {} } }

    /* ---------------- settings ---------------- */
    function prefs() {
        var p = Store.get(PREFS, null), o = {}, k;
        for (k in DEFAULT_PREFS) o[k] = DEFAULT_PREFS[k];
        if (p && typeof p === 'object') for (k in p) if (k in DEFAULT_PREFS) o[k] = p[k];
        return o;
    }
    function setPref(k, v) { var p = prefs(); p[k] = v; Store.set(PREFS, p); emit('prefs'); }

    /* ---------------- engines ---------------- */
    // Samsung's own player (webapis.avplay): one per app, file paths and http(s) streams
    var AV = (function () {
        var cur = 0, onEnd = null, onErr = null, obj = null;
        function api() { return typeof webapis !== 'undefined' && webapis.avplay ? webapis.avplay : null; }
        function ensureObj() {
            if (obj || typeof document === 'undefined') return;
            obj = document.createElement('object');
            obj.setAttribute('type', 'application/avplayer');
            obj.id = 'mu-avplayer';
            obj.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
            document.body.appendChild(obj);
        }
        function close() { var a = api(); if (!a) return; try { a.stop(); } catch (e) {} try { a.close(); } catch (e2) {} cur = 0; }
        return {
            name: 'av',
            ok: function () { return !!api(); },
            open: function (url, start, end, fail, ready) {
                var a = api(), done = false;
                close();
                ensureObj();
                onEnd = end; onErr = fail;
                function bad(e) { if (done) return; done = true; close(); fail(e); }
                try {
                    a.open(url);
                    a.setListener({
                        onbufferingstart: function () {}, onbufferingprogress: function () {}, onbufferingcomplete: function () {},
                        oncurrentplaytime: function (ms) { cur = ms; },
                        onstreamcompleted: function () { if (onEnd) onEnd(); },
                        onerror: function (e) { if (!done) return bad(e); if (onErr) onErr(e); },
                        onevent: function () {}, ondrmevent: function () {}, onsubtitlechange: function () {}
                    });
                    try { a.setDisplayRect(0, 0, 1, 1); } catch (e0) {}
                    a.prepareAsync(function () {
                        if (done) return;
                        done = true;
                        try { a.play(); } catch (e1) { return fail(e1); }
                        if (start > 1) { try { a.seekTo(Math.floor(start * 1000), function () {}, function () {}); } catch (e2) {} }
                        cur = start * 1000;
                        ready();
                    }, bad);
                } catch (e) { bad(e); }
            },
            play: function () { try { api().play(); } catch (e) {} },
            pause: function () { try { api().pause(); } catch (e) {} },
            seek: function (s) { try { api().seekTo(Math.max(0, Math.floor(s * 1000)), function () {}, function () {}); cur = s * 1000; } catch (e) {} },
            time: function () { var a = api(); try { var v = a.getCurrentTime(); if (v >= 0) cur = v; } catch (e) {} return cur / 1000; },
            duration: function () { try { var d = api().getDuration(); return d > 0 ? d / 1000 : 0; } catch (e) { return 0; } },
            stop: close
        };
    })();
    // the web player: one <audio>, never in the page
    var HTML = (function () {
        var el = null, onEnd = null, onErr = null;
        function get() {
            if (el) return el;
            el = new Audio();
            el.preload = 'auto';
            el.addEventListener('ended', function () { if (onEnd) onEnd(); });
            el.addEventListener('error', function () { if (onErr) onErr(el.error); });
            el.addEventListener('durationchange', function () { emit('dur'); });
            return el;
        }
        return {
            name: 'html',
            ok: function () { return typeof Audio !== 'undefined'; },
            open: function (url, start, end, fail, ready) {
                var a = get(), done = false;
                onEnd = null;
                onErr = function (e) { done = true; fail(e); };
                a.src = url;
                var seekTo = function () { a.removeEventListener('loadedmetadata', seekTo); if (start > 1 && isFinite(a.duration)) { try { a.currentTime = Math.min(start, a.duration - 1); } catch (x) {} } };
                a.addEventListener('loadedmetadata', seekTo);
                var ok = function (blocked) { if (done) return; done = true; onEnd = end; ready(blocked); };
                var p;
                try { p = a.play(); } catch (e) { return onErr(e); }
                // a browser that wants a click first (autoplay rules): ready, but paused
                if (p && p.then) p.then(function () { ok(false); }, function (e) { if (e && e.name === 'NotAllowedError') ok(true); else if (!done) onErr(e); });
                else ok(false);
            },
            play: function () { var a = get(); try { var p = a.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {} },
            pause: function () { if (el) el.pause(); },
            seek: function (s) { if (el) { try { el.currentTime = Math.max(0, s); } catch (e) {} } },
            time: function () { return el ? el.currentTime || 0 : 0; },
            duration: function () { return el && isFinite(el.duration) ? el.duration : 0; },
            paused: function () { return !el || el.paused; },
            stop: function () { if (!el) return; onEnd = onErr = null; el.pause(); el.removeAttribute('src'); try { el.load(); } catch (e) {} }
        };
    })();

    /* ---------------- saving ---------------- */
    function slim(e) {
        var o = { s: e.s, p: e.p, n: e.n };
        if (e.root) o.root = e.root;
        if (e.mime) o.mime = e.mime;
        if (e.t) o.t = e.t;
        if (e.a) o.a = e.a;
        if (e.b) o.b = e.b;
        if (e.d) o.d = Math.round(e.d);
        return o;
    }
    function trackKey(e) { return e ? e.s + ':' + e.p : ''; }
    function saveQueue() { Store.set(KEY, { v: 2, q: q, ord: order, at: at, sh: shuffle, rp: repeat, from: from }); }
    function posMap() { var m = Store.rawGet(POS); return m && typeof m === 'object' ? m : {}; }
    function savePos(on) {
        var m = posMap(), cur = current();
        if (!cur) { delete m[Store.profile()]; }
        else m[Store.profile()] = { k: trackKey(cur), pos: Math.round(position() * 10) / 10, playing: on === undefined ? want : on, at: Date.now() };
        try { localStorage.setItem(POS, JSON.stringify(m)); } catch (e) {}       // no Store hooks: not a backup change
    }
    function tickSave(on) {
        clearInterval(saveTimer); saveTimer = 0;
        if (on) saveTimer = setInterval(savePos, SAVE_EVERY);
    }
    function load() {
        var s = Store.get(KEY, null);
        q = []; order = []; at = 0; shuffle = false; repeat = 'off'; from = null; lastPos = 0;
        if (!s || typeof s !== 'object' || s.v !== 2 || !Array.isArray(s.q)) return;
        q = s.q.filter(function (e) { return e && e.s && e.p; }).slice(0, MAXQ);
        order = Array.isArray(s.ord) && s.ord.length === q.length ? s.ord : q.map(function (x, i) { return i; });
        at = Math.max(0, Math.min(order.length - 1, +s.at || 0));
        shuffle = !!s.sh; repeat = s.rp === 'all' || s.rp === 'one' ? s.rp : 'off';
        from = s.from && typeof s.from === 'object' ? s.from : null;
        var p = posMap()[Store.profile()];
        if (p && p.k === trackKey(current())) lastPos = +p.pos || 0;
    }

    /* ---------------- queue ---------------- */
    function current() { return q.length ? q[order[at]] : null; }
    function makeOrder(startQ) {
        order = q.map(function (x, i) { return i; });
        if (shuffle) {
            for (var i = order.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), x = order[i]; order[i] = order[j]; order[j] = x; }
            if (startQ >= 0) { var k = order.indexOf(startQ); order.splice(k, 1); order.unshift(startQ); }
            at = 0;
        } else at = Math.max(0, startQ);
    }
    function playList(tracks, start, opts) {
        opts = opts || {};
        tracks = (tracks || []).filter(function (e) { return e && !e.dir; }).slice(0, MAXQ);
        if (!tracks.length) return false;
        q = tracks.map(slim);
        from = opts.from ? { n: String(opts.from.n || ''), s: opts.from.s || '', p: opts.from.p || '', list: opts.from.list || '' } : null;
        if (opts.shuffle !== undefined) shuffle = !!opts.shuffle;
        var st = typeof start === 'number' && start >= 0 && start < q.length ? start : (shuffle ? Math.floor(Math.random() * q.length) : 0);
        makeOrder(st);
        saveQueue();
        fails = 0;
        openCurrent(0, true);
        return true;
    }
    function enqueue(tracks, next) {
        tracks = (tracks || []).filter(function (e) { return e && !e.dir; }).map(slim);
        if (!tracks.length) return 0;
        if (!q.length) { playList(tracks, 0, {}); return tracks.length; }
        var room = MAXQ - q.length;
        tracks = tracks.slice(0, Math.max(0, room));
        var first = q.length;
        for (var i = 0; i < tracks.length; i++) {
            q.push(tracks[i]);
            if (next) order.splice(at + 1 + i, 0, first + i); else order.push(first + i);
        }
        saveQueue();
        emit('queue');
        return tracks.length;
    }
    function remove(qi) {
        if (qi < 0 || qi >= q.length) return;
        var wasCur = order[at] === qi;
        q.splice(qi, 1);
        var oi = order.indexOf(qi);
        order.splice(oi, 1);
        for (var i = 0; i < order.length; i++) if (order[i] > qi) order[i]--;
        if (oi < at) at--;
        if (!q.length) return clear();
        if (at >= order.length) at = 0;
        saveQueue();
        if (wasCur) openCurrent(0, want); else emit('queue');
    }
    function clear() {
        stopEngine();
        q = []; order = []; at = 0; from = null; want = false; playing = false; lastPos = 0; lastDur = 0;
        Store.set(KEY, null);
        savePos();
        tickSave(false);
        emit('queue');
    }

    /* ---------------- playing ---------------- */
    function stopEngine() {
        gen++;
        if (engine) { try { engine.stop(); } catch (e) {} }
        engine = null;
        if (blobUrl) { try { URL.revokeObjectURL(blobUrl); } catch (e2) {} blobUrl = ''; }
        loading = false;
    }
    function position() { return engine && !loading ? engine.time() : lastPos; }
    function duration() {
        var d = engine && !loading ? engine.duration() : 0, c = current();
        if (d > 0) lastDur = d;
        return d > 0 ? d : (lastDur || (c && c.d) || 0);
    }

    // the ways to play a song, best first: Samsung's player, the web player, the web player with the song downloaded
    function plans(src) {
        var out = [], p = prefs().engine;
        if (src.path && AV.ok() && p !== 'html') out.push({ e: AV, url: src.path });
        if (AV.ok() && p !== 'html' && !src.revoke) out.push({ e: AV, url: src.url });
        if (HTML.ok()) out.push({ e: HTML, url: src.url });
        if (src.blob && HTML.ok()) out.push({ e: HTML, blob: src.blob });
        return out;
    }
    function openCurrent(start, autoplay) {
        var cur = current(), my;
        stopEngine();
        my = gen;
        if (!cur) { emit('track'); return; }
        lastPos = start || 0; lastDur = cur.d || 0; error = '';
        want = autoplay !== false;
        if (!want) { playing = false; savePos(); emit('track'); details(cur); return; }
        loading = true; playing = false;
        emit('track');
        details(cur);
        MusicSrc.url(cur, function (e, src) {
            if (my !== gen) { if (src && src.revoke) { try { URL.revokeObjectURL(src.url); } catch (x) {} } return; }
            if (e) return failed(e, my);
            if (src.revoke) blobUrl = src.url;
            var list = plans(src), k = 0;
            function tryNext(lastErr) {
                if (my !== gen) return;
                var pl = list[k++];
                if (!pl) return failed(lastErr || { code: 'format' }, my);
                if (pl.blob) {
                    error = t('muDownloading'); emit('loading');
                    return pl.blob(null, function (x, u) {
                        if (my !== gen) { if (u) URL.revokeObjectURL(u); return; }
                        if (x) return tryNext(x);
                        blobUrl = u;
                        start2(pl.e, u);
                    });
                }
                start2(pl.e, pl.url);
            }
            function start2(eng, url) {
                eng.open(url, lastPos, function () { if (my === gen) ended(); }, function (x) {
                    if (my !== gen) return;
                    if (loading) return tryNext(x);
                    failed(x, my);                   // broke while playing
                }, function (blocked) {
                    if (my !== gen) return;
                    engine = eng; loading = false; playing = true; error = ''; fails = 0;
                    if (blocked) { want = false; playing = false; }
                    else if (!want) { eng.pause(); playing = false; }
                    savePos(); tickSave(playing);
                    mediaSession(cur);
                    emit('play');
                });
            }
            tryNext(null);
        });
    }
    function failed(e, my) {
        if (my !== gen) return;
        loading = false; playing = false;
        var code = e && e.code;
        error = code === 'gone' ? t('muErrGone') : code === 'perm' ? t('muErrPerm') : code === 'reauth' || code === 'nouser' || code === 'noapp' || code === 'noconfig' ? t('muGd_' + code) :
                code === 'network' ? t('muErrNet') : t('muErrPlay');
        emit('error');
        if (typeof App !== 'undefined' && App.toast) App.toast(error + (current() ? ' ' + current().n : ''), { id: 'music', kind: 'err', timeout: 4000 });
        // one bad song: the next one; several in a row (drive removed, offline): stop
        if (++fails < 3 && q.length > 1 && (at < order.length - 1 || repeat === 'all')) {
            setTimeout(function () { if (my === gen && !playing) step(1, true); }, 1200);
        } else { want = false; tickSave(false); savePos(); }
    }
    function ended() {
        if (repeat === 'one') { openCurrent(0, true); return; }
        if (at < order.length - 1 || repeat === 'all') return step(1, true);
        // the end of the queue: back to its first song, stopped
        want = false; playing = false;
        at = 0; lastPos = 0;
        stopEngine();
        saveQueue(); savePos(); tickSave(false);
        emit('end');
    }
    function step(d, auto) {
        if (!q.length) return;
        var n = at + d;
        if (n >= order.length) { if (repeat === 'all' || !auto) n = 0; else return; }
        if (n < 0) n = order.length - 1;
        at = n;
        saveQueue();
        openCurrent(0, auto ? true : want || playing);
    }

    // title / artist / length from the file, kept in the queue (shown after a restart without reading again)
    function details(cur) {
        if (!cur || (cur.t && cur.d) || !prefs().details || lite) return;
        MusicSrc.info(cur, function (inf) {
            if (!inf) return;
            var ch = false;
            if (inf.title && cur.t !== inf.title && !(inf.guessT && cur.t)) { cur.t = inf.title; ch = true; }
            if (inf.artist && cur.a !== inf.artist && !(inf.guessA && cur.a)) { cur.a = inf.artist; ch = true; }
            if (inf.album && cur.b !== inf.album) { cur.b = inf.album; ch = true; }
            if (inf.dur && !cur.d) { cur.d = Math.round(inf.dur); ch = true; }
            if (!cur.t) { cur.t = inf.title || cur.n; ch = true; }
            if (ch) { saveQueue(); emit('info'); if (cur === current()) mediaSession(cur); }
        });
    }

    function play() {
        if (!q.length) return;
        if (engine && !loading) { engine.play(); want = true; playing = true; tickSave(true); savePos(); emit('play'); return; }
        if (loading) { want = true; return; }
        openCurrent(lastPos, true);
    }
    function pause() {
        want = false;
        if (engine && !loading) { lastPos = engine.time(); engine.pause(); }
        playing = false;
        tickSave(false); savePos();
        emit('pause');
    }
    function toggle() { if (playing || (loading && want)) pause(); else play(); }
    function next() { step(1, false); }
    // back to the start of the song, or the one before when it just started
    function prev() {
        if (position() > 4 && engine) { seek(0); return; }
        step(-1, false);
    }
    function pick(qi) {
        var oi = order.indexOf(qi);
        if (oi < 0) return;
        at = oi; fails = 0;
        saveQueue();
        openCurrent(0, true);
    }
    function seek(s) {
        var d = duration();
        s = Math.max(0, d ? Math.min(s, d - 1) : s);
        if (engine && !loading) engine.seek(s);
        lastPos = s;
        savePos();
        emit('seek');
    }
    function seekBy(ds) { seek(position() + ds); }
    function stop() { pause(); if (engine) { stopEngine(); } lastPos = 0; savePos(); emit('stop'); }
    function setShuffle(on) {
        if (!!on === shuffle) return;
        shuffle = !!on;
        var cur = q.length ? order[at] : -1;
        if (q.length) makeOrder(cur);
        saveQueue();
        emit('mode');
    }
    function setRepeat(r) { repeat = r === 'all' || r === 'one' ? r : 'off'; saveQueue(); emit('mode'); }
    function cycleRepeat() { setRepeat(repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off'); return repeat; }

    // phones and PCs: the system's media controls (lock screen, keyboard media keys)
    function mediaSession(cur) {
        try {
            if (!navigator.mediaSession || typeof MediaMetadata === 'undefined' || !cur) return;
            navigator.mediaSession.metadata = new MediaMetadata({ title: cur.t || cur.n, artist: cur.a || '', album: cur.b || '' });
        } catch (e) {}
    }
    function bindSession() {
        try {
            if (!navigator.mediaSession) return;
            var h = { play: play, pause: pause, nexttrack: next, previoustrack: prev, stop: stop };
            for (var k in h) navigator.mediaSession.setActionHandler(k, h[k]);
        } catch (e) {}
    }

    function state() {
        var c = current(), d = duration();
        return {
            has: !!c, track: c, index: c ? order[at] : -1, at: at, count: q.length,
            title: c ? c.t || MusicTagsName(c.n) : t('muNothing'), artist: c ? c.a || '' : '', album: c ? c.b || '' : '',
            pos: Math.min(position(), d || 1e9), dur: d, playing: playing || (loading && want), loading: loading, error: error,
            shuffle: shuffle, repeat: repeat, from: from
        };
    }
    function MusicTagsName(n) { return typeof MusicTags !== 'undefined' ? MusicTags.fromName(n).title || n : String(n || '').replace(/\.[a-z0-9]{2,5}$/i, ''); }
    function clock(s) {
        s = Math.max(0, Math.floor(s || 0));
        var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = ('0' + s % 60).slice(-2);
        return h ? h + ':' + ('0' + m).slice(-2) + ':' + x : m + ':' + x;
    }

    // o.resume: plays on if it played when the last page went away (prefs.resume). o.lite: the game page (main.js startGame):
    // only the player, so the music goes on under a game and its menu can pause it; no tag reading
    function init(o) {
        if (inited) return;
        inited = true;
        lite = !!(o && o.lite);
        load();
        bindSession();
        // My PC hidden (another TV app or source): the music pauses, and plays on when My PC is back
        document.addEventListener('visibilitychange', function () {
            if (leaving) return;
            if (document.hidden) { if (playing || (loading && want)) { hiddenPause = true; pause(); } }
            else if (hiddenPause) { hiddenPause = false; play(); }
        });
        // leaving the page (a game opens, a restart): where it was and whether it played (a page that goes away is
        // hidden first on some browsers: that pause does not count), and the TV's player freed
        window.addEventListener('pagehide', function () {
            if (leaving) return;
            leaving = true;
            var was = want || hiddenPause;
            lastPos = position();
            savePos(was);
            stopEngine();
            playing = false;
            tickSave(false);
        });
        var p = posMap()[Store.profile()];
        if (o && o.resume && prefs().resume && p && p.playing && Date.now() - (p.at || 0) < 12 * 3600 * 1000 && current()) play();
        emit('init');
    }
    // before init (or without it): only shows what was playing
    function peek() { if (!inited && !q.length) load(); }

    return {
        init: init, peek: peek, state: state, playList: playList, enqueue: enqueue, remove: remove, clear: clear,
        play: play, pause: pause, toggle: toggle, next: next, prev: prev, pick: pick, seek: seek, seekBy: seekBy, stop: stop,
        setShuffle: setShuffle, setRepeat: setRepeat, cycleRepeat: cycleRepeat, clock: clock, prefs: prefs, setPref: setPref,
        has: function () { return q.length > 0; },
        queue: function () { return { list: q, order: order, at: at }; },
        engineName: function () { return engine ? engine.name : ''; },
        onChange: function (fn) { if (listeners.indexOf(fn) < 0) listeners.push(fn); },
        offChange: function (fn) { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
        _engines: { AV: AV, HTML: HTML }
    };
})();
