/* MyVideos (owner request 2026-11-13): the videos phones sent to this TV (Receiver, js/launcher/share-rx.js), played by the TV's
 * own player (Samsung AVPlay: hardware decoding, the picture on the video plane behind the page) straight from the phone, which
 * serves the file with Range (android-controller/.../LanServer.java): nothing is copied to the TV. The same player code as the
 * apps' MyPC.video (js/launcher/app-video.js, AppVideo.attach). Without AVPlay (a browser, a phone) a <video> element plays it.
 *
 * Per profile, key "videos": [{ id, n, u, from, mime, at }] (30 at most). A video plays only while the phone still shares it
 * (My PC open there). Player: OK = play / pause, Left / Right = 10 s, Up / Down = the buttons, Back = the list.
 *
 *   Videos.add({ n, u, from, mime }) -> id      Win.open('videos', id) plays that video */
var Videos = (function () {
    'use strict';

    var KEY = 'videos', MAX = 30;
    var body = null, view = '', cur = null, av = null, vid = null, ui = {}, st = { state: 'idle', t: 0, d: 0 }, hideT = 0, rid = 0, waits = {};

    function t(k) { return I18n.t(k); }
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
    function btn(cls, text, fn) { var b = el('button', cls, text); b.setAttribute('data-focus', ''); b.onclick = fn; return b; }
    function clock(s) { s = Math.max(0, Math.floor(s || 0)); var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x; }

    function list() { var l = Store.get(KEY, []); return Array.isArray(l) ? l : []; }
    function find(id) { var l = list(); for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }
    function add(v) {
        var n = { id: 'v' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36), n: String(v.n || '').slice(0, 120), u: String(v.u || ''), from: String(v.from || '').slice(0, 60), mime: String(v.mime || ''), at: Date.now() };
        var l = list().filter(function (x) { return x.u !== n.u; });
        l.unshift(n);
        Store.set(KEY, l.slice(0, MAX));
        return n.id;
    }
    function removeVid(id) { Store.set(KEY, list().filter(function (x) { return x.id !== id; })); }

    /* ---------------- the player ---------------- */
    function useAv() { return typeof AppVideo !== 'undefined' && AppVideo.supported(); }
    function op(name, args, cb) {
        if (!av) return cb && cb({ code: 'closed' });
        var r = ++rid;
        if (cb) waits[r] = cb;
        av.handle({ rid: r, op: name, args: args || {} });
    }
    function onAv(type, d) {
        if (type !== 'video' || !d) return;
        if (d.rid) { var cb = waits[d.rid]; delete waits[d.rid]; if (cb) cb(d.error || null, d.result); return; }
        if (d.ev === 'state') st.state = d.state;
        else if (d.ev === 'time') { st.t = d.t; if (d.d) st.d = d.d; }
        else if (d.ev === 'error') return failed(d.code);
        draw();
    }
    function closePlayer() {
        clearTimeout(hideT);
        if (av) { try { av.destroy(); } catch (e) {} av = null; }
        if (vid) { vid.onplaying = vid.onpause = vid.onwaiting = vid.ontimeupdate = vid.onended = vid.onerror = null; try { vid.pause(); vid.removeAttribute('src'); vid.load(); } catch (e2) {} if (vid.parentNode) vid.parentNode.removeChild(vid); vid = null; }
        waits = {};
        document.documentElement.classList.remove('vd-playing');
    }
    function failed(code) {
        closePlayer();
        if (!body) return;
        var gone = code === 'not-found' || code === 'network' || code === 'net' || code === 'timeout';
        Notify.show({ id: 'vd', kind: 'err', title: t('videos'), text: gone ? t('vdGone') : t('vdError').replace('%s', code || '?') });
        showList(cur && cur.id);
    }

    function playing() { return st.state === 'playing' || st.state === 'buffering'; }
    function toggle() {
        if (vid) { if (vid.paused) vid.play().catch(function () {}); else vid.pause(); return; }
        op(playing() ? 'pause' : 'play');
    }
    function seekBy(ds) {
        var to = Math.max(0, (st.t || 0) + ds);
        if (st.d) to = Math.min(to, Math.max(0, st.d - 1));
        if (vid) { try { vid.currentTime = to; } catch (e) {} return; }
        st.t = to; draw();
        op('seek', { t: to });
    }
    function peek() {
        if (!ui.bar) return;
        ui.bar.classList.remove('vd-hide');
        clearTimeout(hideT);
        hideT = setTimeout(function () { if (ui.bar && playing()) ui.bar.classList.add('vd-hide'); }, 4000);
    }
    function draw() {
        if (!ui.bar) return;
        ui.play.textContent = playing() ? '❚❚ ' + t('vdPause') : '▶ ' + t('vdPlay');
        ui.time.textContent = clock(st.t) + (st.d ? ' / ' + clock(st.d) : '');
        ui.fill.style.transform = 'scaleX(' + (st.d ? Math.min(1, st.t / st.d) : 0) + ')';
        ui.busy.hidden = st.state !== 'buffering' && st.state !== 'opening';
        if (!playing()) { clearTimeout(hideT); ui.bar.classList.remove('vd-hide'); }
    }

    function play(v) {
        closePlayer();
        cur = v; view = 'play';
        st = { state: 'opening', t: 0, d: 0 };
        body.innerHTML = '';
        Win.setTitle(v.n || t('videos'));
        var box = el('div', 'vd-play');
        ui = {};
        ui.busy = el('div', 'vd-busy', t('vdLoading'));
        box.appendChild(ui.busy);
        var bar = ui.bar = el('div', 'vd-bar');
        ui.title = el('div', 'vd-title', v.n || '');
        bar.appendChild(ui.title);
        var track = el('div', 'vd-track'); ui.fill = el('div', 'vd-fill'); track.appendChild(ui.fill); bar.appendChild(track);
        var row = el('div', 'vd-row');
        row.appendChild(btn('vd-btn', t('vdBack10'), function () { seekBy(-10); }));
        ui.play = btn('vd-btn vd-main', '', toggle);
        row.appendChild(ui.play);
        row.appendChild(btn('vd-btn', t('vdFwd10'), function () { seekBy(10); }));
        ui.time = el('div', 'vd-time', '');
        row.appendChild(ui.time);
        row.appendChild(el('div', 'vd-hint', t('vdHint')));
        bar.appendChild(row);
        box.appendChild(bar);
        body.appendChild(box);
        document.documentElement.classList.add('vd-playing');
        if (useAv()) {
            av = AppVideo.attach({ appId: 'videos', title: v.n, send: onAv, frame: function () { return null; }, state: function () { return 'running'; } });
            op('open', { url: v.u, fit: 'fit' }, function (e, r) {
                if (e) return failed(e.code);
                if (r && r.duration) st.d = r.duration;
                draw(); peek();
            });
        } else {
            vid = document.createElement('video');
            vid.className = 'vd-video';
            vid.autoplay = true; vid.playsInline = true;
            vid.src = v.u;
            vid.onplaying = function () { st.state = 'playing'; draw(); peek(); };
            vid.onpause = function () { st.state = 'paused'; draw(); };
            vid.onwaiting = function () { st.state = 'buffering'; draw(); };
            vid.ontimeupdate = function () { st.t = vid.currentTime; st.d = isFinite(vid.duration) ? vid.duration : 0; draw(); };
            vid.onended = function () { st.state = 'ended'; draw(); };
            vid.onerror = function () { failed(vid && vid.error && vid.error.code === 2 ? 'network' : 'format'); };
            box.insertBefore(vid, box.firstChild);
        }
        draw();
        Focus.focus(ui.play);
    }

    function showList(focusId) {
        closePlayer();
        view = 'list'; ui = {};
        if (!body) return null;
        body.innerHTML = '';
        Win.setTitle(t('videos'));
        var l = list(), box = el('div', 'vd'), first = null;
        if (!l.length) { box.appendChild(el('div', 'ph-empty', t('vdNone'))); body.appendChild(box); return null; }
        var g = el('div', 'vd-list');
        g.setAttribute('role', 'list');
        for (var i = 0; i < l.length; i++) {
            var v = l[i], row = el('div', 'vd-item');
            var b = btn('vd-open', '');
            b.setAttribute('role', 'listitem');
            var ic = el('span', 'vd-ic'); Icons.put(ic, 'videos'); b.appendChild(ic);
            var tx = el('span', 'vd-tx'); tx.appendChild(el('span', 'vd-n', v.n || t('rxVideo')));
            tx.appendChild(el('span', 'vd-s', (v.from ? t('ntFrom').replace('%s', v.from) + ' · ' : '') + Desktop.dateText(new Date(v.at)) + ' ' + Desktop.timeText(new Date(v.at))));
            b.appendChild(tx);
            b.onclick = (function (x) { return function () { play(x); }; })(v);
            row.appendChild(b);
            row.appendChild(btn('vd-rm', t('vdRemove'), (function (x) { return function () { removeVid(x.id); showList(); }; })(v)));
            g.appendChild(row);
            if (!first || v.id === focusId) first = b;
        }
        box.appendChild(g);
        body.appendChild(box);
        Focus.focus(first);
        return first;
    }

    Win.register('videos', {
        icon: 'videos',
        title: function () { return t('videos'); },
        open: function (b, arg) {
            body = b; cur = null;
            var v = typeof arg === 'string' ? find(arg) : null;
            if (v) { play(v); return ui.play; }
            return showList();
        },
        close: function () { closePlayer(); body = null; ui = {}; cur = null; view = ''; },
        action: function (a, repeat) {
            if (view !== 'play') return false;
            peek();
            var f = Focus.current();
            if ((a === 'left' || a === 'right') && f === ui.play) { seekBy((a === 'right' ? 10 : -10) * (document.documentElement.dir === 'rtl' ? -1 : 1)); return true; }
            if (a === 'playPause' || a === 'pause') { if (!repeat) toggle(); return true; }
            if (a === 'mediaFf') { seekBy(30); return true; }
            if (a === 'mediaRew') { seekBy(-30); return true; }
            return false;
        },
        back: function () { if (view === 'play') { showList(cur && cur.id); return true; } return false; }
    });

    return { add: add, list: list, find: find, remove: removeVid };
})();
