/* ShareRx: the TV takes what phones share (owner request 2026-11-13), over the home network only (no Firebase, no internet).
 *
 * A TV web app cannot listen on a port, so the phone (the My PC Android app, android-controller/.../LanServer.java, port 47800)
 * keeps the shares and the TV asks for them:
 *   1. the Receiver app (js/launcher/apps/receiver.js) starts this: Lan.scan asks every address of the TV's network for
 *      /mypc/hello (the phones found last time first);
 *   2. each phone found gets one long request at a time, /mypc/inbox?tv=<this TV>&since=<n>&wait=20: the phone answers at once
 *      when the user sent something to this TV, else after 20 s (no timer runs on the TV meanwhile, nothing else is asked);
 *   3. what arrives opens in its app: a link -> MyBrowser, a text -> MyNotes, a picture -> MyPhotos (saved on the TV), a video ->
 *      MyVideos (played by the TV's player straight from the phone, with Range), a song -> MyMusic (the same), then /mypc/ack.
 * It keeps running after the Receiver window closes, on the desktop page (a game or an app page stops it; it comes back on the
 * next desktop page of the same session, sessionStorage rx_on). The taskbar shows #tray-share while it runs. A new full scan
 * every 20 s while the Receiver window is open and no phone answers, every 2 min otherwise.
 *
 *   ShareRx.start() / stop() / on()        ShareRx.state() -> { on, ip, scanning, progress, phones: [{ id, name, ip }] }
 *   ShareRx.watch(on)  the Receiver window is open (faster scans)      ShareRx.onChange(fn) / offChange(fn)
 *   ShareRx.addPhone(ip, cb)  an address typed by hand                  ShareRx.history() -> [{ k, n, from, at }]
 *   ShareRx.open(item)  opens a received item again                    ShareRx.kindOf(mime, text) -> link | text | photo | video | song | file */
var ShareRx = (function () {
    'use strict';

    var PORT = 47800, KNOWN = 'arc_dev_rx_phones', HIST = 'rx_hist', WAIT = 20, MAXH = 30;
    var on = false, watching = 0, ip = null, scanner = null, scanT = 0, progress = 0, phones = {}, listeners = [], noNet = false;

    function t(k) { return I18n.t(k); }
    function emit() { for (var i = 0; i < listeners.length; i++) { try { listeners[i](); } catch (e) {} } }
    function tvId() { try { return Device.id() || 'tv'; } catch (e) { return 'tv'; } }
    function tvName() {
        var m = '';
        try { m = Device.model() || ''; } catch (e) {}
        if (!m) { try { m = webapis.productinfo.getModel(); } catch (e2) {} }
        return 'My PC' + (m ? ' (' + String(m).slice(0, 30) + ')' : '');
    }
    function known() { var l = Store.rawGet(KNOWN); return Array.isArray(l) ? l : []; }
    function remember(p) {
        var l = known().filter(function (x) { return x && x.id !== p.id && x.ip !== p.ip; });
        l.unshift({ id: p.id, ip: p.ip, name: p.name });
        Store.rawSet(KNOWN, l.slice(0, 8));
    }

    /* ---------------- the taskbar mark ---------------- */
    function tray() {
        var el = document.getElementById('tray-share');
        if (!el) {
            var clock = document.getElementById('tray-clock');
            if (!clock || !clock.parentNode) return;
            el = document.createElement('span');
            el.id = 'tray-share';
            el.className = 'tray-share';
            el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M12 7v7M9 11l3 3 3-3M10.5 18.5h3"/></svg>';
            clock.parentNode.insertBefore(el, clock);
        }
        el.hidden = !on;
        el.title = t('rxTray');
        el.classList.toggle('on', on && Object.keys(phones).length > 0);
    }

    /* ---------------- finding phones ---------------- */
    function scanSoon() {
        clearTimeout(scanT);
        if (!on) return;
        var none = !Object.keys(phones).length;
        scanT = setTimeout(scan, watching && none ? 20000 : 120000);
    }
    function scan() {
        clearTimeout(scanT);
        if (!on || scanner) return;
        progress = 0;
        Lan.ip(function (v) {
            if (!on || scanner) return;
            ip = v; noNet = !v;
            if (!v) { emit(); return scanSoon(); }
            var first = known().map(function (x) { return x.ip; });
            scanner = Lan.scan({
                port: PORT, path: '/mypc/hello', ip: v, first: first,
                match: function (j) { return j && j.app === 'mypc' && j.share && j.id; },
                onFound: function (host, j) { found(host, j); },
                onProgress: function (d, n) { var p = Math.round(d * 100 / n); if (p !== progress) { progress = p; if (p % 5 === 0) emit(); } },
                onDone: function () { scanner = null; progress = 100; emit(); scanSoon(); }
            });
            emit();
        });
    }
    function found(host, j) {
        var id = String(j.id).slice(0, 40), p = phones[id];
        if (p) { p.ip = host; p.name = String(j.name || p.name).slice(0, 60); return; }
        p = phones[id] = { id: id, ip: host, name: String(j.name || 'Android').slice(0, 60), since: 0, req: null, fails: 0, t: 0 };
        remember(p);
        poll(p);
        tray(); emit();
    }
    function addPhone(host, cb) {
        host = String(host || '').trim();
        if (!Lan.isPrivate(host)) return cb(false);
        Lan.get('http://' + host + ':' + PORT + '/mypc/hello', 3000, function (e, j) {
            if (e || !j || j.app !== 'mypc' || !j.id) return cb(false);
            if (!on) start();
            found(host, j);
            cb(true);
        });
    }
    function drop(p) {
        if (phones[p.id] !== p) return;
        if (p.req) { try { p.req.abort(); } catch (e) {} }
        clearTimeout(p.t);
        delete phones[p.id];
        tray(); emit(); scanSoon();
    }

    /* ---------------- taking what they send ---------------- */
    function base(p) { return 'http://' + p.ip + ':' + PORT; }
    function poll(p) {
        if (!on || phones[p.id] !== p) return;
        var u = base(p) + '/mypc/inbox?tv=' + encodeURIComponent(tvId()) + '&name=' + encodeURIComponent(tvName()) + '&since=' + p.since + '&wait=' + WAIT;
        p.req = Lan.get(u, (WAIT + 8) * 1000, function (e, r) {
            p.req = null;
            if (!on || phones[p.id] !== p) return;
            if (e) {
                if (++p.fails >= 3) { drop(p); return; }
                p.t = setTimeout(function () { poll(p); }, 3000);
                return;
            }
            p.fails = 0;
            var items = r && Array.isArray(r.items) ? r.items : [];
            for (var i = 0; i < items.length; i++) {
                var it = items[i];
                if (!it || !it.id || +it.seq <= p.since) continue;
                p.since = Math.max(p.since, +it.seq || 0);
                take(p, it);
            }
            if (r && +r.seq > p.since && !items.length) p.since = +r.seq;
            p.t = setTimeout(function () { poll(p); }, 0);
        });
    }
    function ack(p, it, fail) {
        Lan.post(base(p) + '/mypc/ack/' + encodeURIComponent(it.id) + '?tv=' + encodeURIComponent(tvId()) + (fail ? '&fail=1' : ''), '', 4000, function () {});
    }

    function isLink(s) { return /^https?:\/\/[^\s]+$/i.test(s); }
    // a shared page is often "Title https://..." (YouTube, news apps): one address in a short text counts as a link
    function linkIn(s) {
        s = String(s || '').trim();
        if (isLink(s)) return s;
        var m = s.match(/https?:\/\/[^\s]+/gi);
        return m && m.length === 1 && s.length < 400 ? m[0].replace(/[).,;]+$/, '') : '';
    }
    function kindOf(mime, text) {
        mime = String(mime || '').toLowerCase();
        if (text !== undefined && text !== null && (!mime || mime.indexOf('text/plain') === 0) && text !== '') return linkIn(text) ? 'link' : 'text';
        if (mime.indexOf('image/') === 0) return 'photo';
        if (mime.indexOf('video/') === 0) return 'video';
        if (mime.indexOf('audio/') === 0 || /\/(ogg|flac)$/.test(mime)) return 'song';
        if (mime.indexOf('text/') === 0) return 'textfile';
        return 'file';
    }
    function label(k) { return t({ link: 'rxLink', text: 'rxText', textfile: 'rxText', photo: 'rxPhoto', video: 'rxVideo', song: 'rxSong' }[k] || 'rxFile'); }

    function history() { var l = Store.get(HIST, []); return Array.isArray(l) ? l : []; }
    function addHistory(h) {
        var l = history();
        l.unshift(h);
        Store.set(HIST, l.slice(0, MAXH));
    }

    function take(p, it) {
        var kind = it.kind === 'text' ? kindOf('text/plain', String(it.text || '')) : kindOf(it.mime);
        var url = base(p) + '/mypc/file/' + encodeURIComponent(it.id) + '?tv=' + encodeURIComponent(tvId());
        var name = String(it.name || it.subject || '').slice(0, 120);
        var item = { k: kind, n: kind === 'link' ? linkIn(it.text) : kind === 'text' ? String(it.text).slice(0, 80) : name, from: p.name, at: Date.now(), u: url, mime: it.mime || '', size: +it.size || 0 };
        Notify.show({ id: 'rx', kind: 'info', title: t('rxGot').replace('%s', p.name), text: label(kind) + (item.n ? ': ' + item.n : '') });
        function done(ok, ref) {
            ack(p, it, !ok);
            if (ref) item.ref = ref;
            if (ok) addHistory(item);
            emit();
        }
        if (kind === 'link') { done(true); return open(item); }
        if (kind === 'text') {
            var nid = Notes.add(String(it.text), p.name, it.subject);
            done(true, nid);
            return open({ k: 'text', ref: nid });
        }
        if (kind === 'textfile' && item.size < 300000) {
            fetch(url, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.text(); }).then(function (s) {
                var nid2 = Notes.add(s, p.name, name);
                item.k = 'text'; done(true, nid2); open({ k: 'text', ref: nid2 });
            }).catch(function () { fail(item); done(false); });
            return;
        }
        if (kind === 'photo') {
            return Photos.addUrl(url, { n: name, from: p.name }, function (e, pid) {
                if (e) { fail(item, 'phNoSave'); return done(false); }
                done(true, pid); open({ k: 'photo', ref: pid });
            });
        }
        if (kind === 'video') { var vid = Videos.add({ n: name, u: url, from: p.name, mime: it.mime }); done(true, vid); return open({ k: 'video', ref: vid }); }
        if (kind === 'song') { done(true); return open(item); }
        Notify.show({ id: 'rx', kind: 'warn', title: t('rxGot').replace('%s', p.name), text: t('rxCant').replace('%s', name || it.mime || '?') });
        done(false);
    }
    function fail(item, k) { Notify.show({ id: 'rx', kind: 'err', title: item.from, text: t(k || 'rxFail') }); }

    // opens what arrived in its app (the Receiver window, if open, gives way: one app at a time)
    function open(item) {
        if (!item) return false;
        if (typeof App !== 'undefined' && App.dialogOpen && App.dialogOpen()) return false;
        if (item.k === 'link') { Win.open('browser', item.n); return true; }
        if (item.k === 'text') { Win.open('notes', item.ref); return true; }
        if (item.k === 'photo') { Win.open('photos', item.ref); return true; }
        if (item.k === 'video') { Win.open('videos', item.ref); return true; }
        if (item.k === 'song') {
            Music.playList([{ s: 'lan', p: item.u, n: item.n || 'song', mime: item.mime }], 0, { shuffle: false, from: { n: item.from || '', s: 'lan', p: '' } });
            Win.open('music', 'np');
            return true;
        }
        return false;
    }

    /* ---------------- on / off ---------------- */
    function start() {
        if (on) return;
        on = true;
        try { sessionStorage.setItem('rx_on', '1'); } catch (e) {}
        tray(); emit();
        scan();
    }
    function stop() {
        on = false;
        try { sessionStorage.removeItem('rx_on'); } catch (e) {}
        clearTimeout(scanT);
        if (scanner) { scanner.stop(); scanner = null; }
        for (var id in phones) { var p = phones[id]; if (p.req) { try { p.req.abort(); } catch (e2) {} } clearTimeout(p.t); }
        phones = {};
        tray(); emit();
    }
    // the desktop page of the same session: it was on before a game / app opened
    function resume() { var v = null; try { v = sessionStorage.getItem('rx_on'); } catch (e) {} if (v === '1') start(); }

    function state() {
        var l = [];
        for (var id in phones) l.push({ id: id, name: phones[id].name, ip: phones[id].ip });
        return { on: on, ip: ip, noNet: noNet, scanning: !!scanner, progress: progress, phones: l };
    }

    // a song sent from a phone: MyMusic plays it straight from the phone (Range), its tags read in pieces the same way
    if (typeof MusicSrc !== 'undefined') MusicSrc.add('lan', {
        url: function (e, cb) { cb(null, { url: e.p }); },
        read: function (e, at, len, cb) {
            at = at || 0;
            fetch(e.p, { headers: { Range: 'bytes=' + at + '-' + (at + len - 1) }, cache: 'no-store' }).then(function (r) {
                if (!r.ok) throw new Error('http ' + r.status);
                var cr = r.headers.get('Content-Range'), m = cr && /\/(\d+)$/.exec(cr);
                if (m) e.size = +m[1];
                return r.arrayBuffer();
            }).then(function (b) { cb(null, new Uint8Array(b), e.size); }, function () { cb({ code: 'io' }); });
        }
    });

    return {
        start: start, stop: stop, resume: resume, on: function () { return on; }, state: state, scan: function () { if (on) scan(); },
        watch: function (v) { watching = Math.max(0, watching + (v ? 1 : -1)); if (v && on && !scanner && !Object.keys(phones).length) scan(); },
        onChange: function (fn) { listeners.push(fn); }, offChange: function (fn) { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
        addPhone: addPhone, history: history, open: open, kindOf: kindOf, label: label, linkIn: linkIn, tvId: tvId, tvName: tvName
    };
})();
