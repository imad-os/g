/* ShareRx: the TV takes what phones share (owner request 2026-11-13), over the home network or over the internet.
 *
 * Listen on (TV-wide arc_dev_rx_via, owner request 2026-11-13 (2)): 'auto' (default) = over the internet while NetMode says
 * 'online' (internet + Firestore reached), on this Wi-Fi otherwise ('offline' / 'local'); 'lan' = this Wi-Fi only; 'cloud' =
 * the internet only.
 *
 * Over the internet (Firestore, no sign-in): the TV has a random code (10 characters, arc_dev_rx_code, shown with a QR code on
 * the Receiver; "New code" makes another). The phone adds the TV by that code once and writes share/<code>/items/<id>
 * { k: 'text' | 'photo' | 'file', text, n, mime, data (a photo shrunk on the phone, base64 JPEG), u (a bigger file: the phone's
 * own address, so only the same Wi-Fi can take it), size, from, at, exp (1 day, TTL) }. The TV lists them (limit 10), opens
 * each and deletes it (= taken). share/<code> { name, at, open } tells phones the TV listens (written at start, every 5 min,
 * open: false at stop). Asked every 3 s for a minute after the window opens or something arrives, every 8 s while the window
 * is open, 30 s while closed (60 s after 10 quiet minutes), never while My PC is hidden (Firestore cost rule).
 *
 * On this Wi-Fi (no Firebase, no internet):
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
    var VIA = 'arc_dev_rx_via', CODE = 'arc_dev_rx_code', ABC = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ', ITEM_ID = /^[a-z0-9]{16,40}$/;
    var mode = null, net = { t: 0, busy: false, err: '', ok: false, fastTo: 0, quietAt: 0, seen: {}, presAt: 0 };

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
        el.classList.toggle('on', on && (mode === 'cloud' ? net.ok : Object.keys(phones).length > 0));
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
        if (!on || mode !== 'lan' || scanner) return;
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
        p.url = function (it) { return base(p) + '/mypc/file/' + encodeURIComponent(it.id) + '?tv=' + encodeURIComponent(tvId()); };
        p.ack = function (it, fail) { ack(p, it, fail); };
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
            if (mode !== 'lan') { setVia('lan'); }
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
        var url = it.data ? '' : p.url(it);
        var name = String(it.name || it.subject || '').slice(0, 120);
        var item = { k: kind, n: kind === 'link' ? linkIn(it.text) : kind === 'text' ? String(it.text).slice(0, 80) : name, from: p.name, at: Date.now(), u: url, mime: it.mime || '', size: +it.size || 0 };
        Notify.show({ id: 'rx', kind: 'info', title: t('rxGot').replace('%s', p.name), text: label(kind) + (item.n ? ': ' + item.n : '') });
        function done(ok, ref) {
            p.ack(it, !ok);
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
        if (kind === 'photo' && it.data) {
            var blob = null;
            try { var bin = atob(String(it.data)), a = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); blob = new Blob([a], { type: it.mime || 'image/jpeg' }); } catch (e) { blob = null; }
            if (!blob) { fail(item, 'phNoSave'); return done(false); }
            return Photos.add(blob, { n: name, from: p.name }, function (e, pid) {
                if (e) { fail(item, 'phNoSave'); return done(false); }
                done(true, pid); open({ k: 'photo', ref: pid });
            });
        }
        // a file that came over the internet with only the phone's address: it plays only when the TV reaches that phone
        if (p.cloud && (kind === 'video' || kind === 'song' || kind === 'photo' || kind === 'textfile') && !p.checked) {
            return reachable(url, function (ok) {
                if (!ok) { Notify.show({ id: 'rx', kind: 'warn', title: t('rxGot').replace('%s', p.name), text: t('rxNeedWifi').replace('%s', name || label(kind)) }); return done(false); }
                p.checked = true; take(p, it);
            });
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
    function reachable(u, cb) {
        var end = false, ctl = typeof AbortController === 'function' ? new AbortController() : null;
        var tm = setTimeout(function () { fin(false); }, 4000);
        function fin(ok) { if (end) return; end = true; clearTimeout(tm); try { if (!ok && ctl) ctl.abort(); } catch (e) {} cb(ok); }
        try { fetch(u, { headers: { Range: 'bytes=0-0' }, cache: 'no-store', signal: ctl ? ctl.signal : undefined }).then(function (r) { fin(r.ok); try { ctl && ctl.abort(); } catch (e) {} }, function () { fin(false); }); }
        catch (e) { fin(false); }
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
    /* ---------------- over the internet (Firestore) ---------------- */
    function newCode() { var s = '', b = new Uint8Array(10); try { crypto.getRandomValues(b); } catch (e) { for (var j = 0; j < 10; j++) b[j] = Math.floor(Math.random() * 256); } for (var i = 0; i < 10; i++) s += ABC[b[i] % 32]; return s; }
    function code() {
        var c = Store.rawGet(CODE);
        if (typeof c !== 'string' || !/^[2-9A-HJ-NP-Z]{10}$/.test(c)) { c = newCode(); Store.rawSet(CODE, c); }
        return c;
    }
    function renewCode() {
        var old = code();
        Store.rawSet(CODE, newCode());
        if (on && mode === 'cloud') { Cloud.remove('share/' + old, 5000, function () {}); net.presAt = 0; net.seen = {}; netFast(); }
        emit();
    }
    function presence(open) {
        net.presAt = Date.now();
        Cloud.patch('share/' + code(), { name: tvName().slice(0, 60), at: Cloud.now(), open: !!open }, null, 6000, function () {});
    }
    function netDelay() {
        var now = Date.now();
        if (now < net.fastTo) return 3000;
        if (watching) return 8000;
        return now - net.quietAt > 600000 ? 60000 : 30000;
    }
    function netNext(ms) { clearTimeout(net.t); if (on && mode === 'cloud') net.t = setTimeout(netPoll, ms === undefined ? netDelay() : ms); }
    function netFast() { net.fastTo = Date.now() + 60000; net.quietAt = Date.now(); netNext(0); }
    function netPoll() {
        if (!on || mode !== 'cloud' || net.busy) return;
        if (typeof document !== 'undefined' && document.hidden) return netNext(30000);       // nothing asked while My PC is hidden
        if (!net.presAt || Date.now() - net.presAt > 300000) presence(true);
        net.busy = true;
        var c = code();
        Cloud.query('share/' + c, { from: [{ collectionId: 'items' }], limit: 10 }, 8000, function (e, docs) {
            net.busy = false;
            if (!on || mode !== 'cloud' || c !== code()) return netNext();
            var was = net.ok;
            net.ok = !e; net.err = e ? String(e) : '';
            if (was !== net.ok) { tray(); emit(); }
            // Automatic: Firestore stopped answering, maybe the internet is gone: NetMode looks again (at most every 2 min)
            if (e && viaPref() === 'auto' && typeof NetMode !== 'undefined' && Date.now() - (net.chkAt || 0) > 120000) { net.chkAt = Date.now(); NetMode.check(true); }
            var got = false;
            for (var i = 0; !e && docs && i < docs.length; i++) {
                var d = docs[i], id = d.id;
                if (!ITEM_ID.test(id) || net.seen[id]) continue;
                net.seen[id] = 1; got = true;
                takeNet(c, id, d.data || {});
            }
            if (got) { net.fastTo = Date.now() + 60000; net.quietAt = Date.now(); }
            netNext();
        });
    }
    function takeNet(c, id, d) {
        var from = String(d.from || 'Android').slice(0, 60), path = 'share/' + c + '/items/' + id;
        var src = { name: from, cloud: true, url: function () { return String(d.u || ''); }, ack: function (x, fail) {
            // taken = deleted; could not open = marked `no` (the phone reads it, says so and deletes it)
            if (fail) Cloud.patchMask(path, { no: true }, ['no'], { exists: true }, 6000, function (e) { if (e) Cloud.remove(path, 6000, function () {}); });
            else Cloud.remove(path, 6000, function () {});
        } };
        var k = d.k === 'text' ? 'text' : 'file';
        var it = { id: id, kind: k, text: k === 'text' ? String(d.text || '') : '', mime: String(d.mime || (k === 'text' ? 'text/plain' : '')), name: String(d.n || ''), size: +d.size || 0, subject: k === 'text' ? String(d.n || '') : '', data: d.data || '' };
        if (k === 'file' && !it.data && !/^http:\/\//.test(src.url())) { src.ack(); return; }
        take(src, it);
    }
    function netStart() { net.ok = false; net.err = ''; net.seen = {}; net.presAt = 0; net.quietAt = Date.now(); net.fastTo = watching ? Date.now() + 60000 : 0; netNext(0); }
    function netStop() { clearTimeout(net.t); if (net.presAt) presence(false); net.presAt = 0; net.ok = false; }
    function lanStop() {
        clearTimeout(scanT);
        if (scanner) { scanner.stop(); scanner = null; }
        for (var id in phones) { var p = phones[id]; if (p.req) { try { p.req.abort(); } catch (e2) {} } clearTimeout(p.t); }
        phones = {};
    }

    /* ---------------- which way ---------------- */
    function viaPref() { var v = Store.rawGet(VIA); return v === 'lan' || v === 'cloud' ? v : 'auto'; }
    function viaNow() {
        var p = viaPref();
        if (p !== 'auto') return p;
        return typeof NetMode !== 'undefined' && NetMode.mode() === 'online' ? 'cloud' : 'lan';
    }
    function apply() {
        var m = on ? viaNow() : null;
        if (m === mode) return;
        if (mode === 'cloud') netStop();
        if (mode === 'lan') lanStop();
        mode = m;
        if (mode === 'cloud') netStart();
        if (mode === 'lan') scan();
        tray(); emit();
    }
    function setVia(v) { Store.rawSet(VIA, v === 'lan' || v === 'cloud' ? v : 'auto'); apply(); emit(); }
    if (typeof NetMode !== 'undefined') NetMode.onChange(function () { if (on && viaPref() === 'auto') apply(); else emit(); });
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', function () { if (!document.hidden && on && mode === 'cloud') netNext(500); });

    function start() {
        if (on) return;
        on = true;
        try { sessionStorage.setItem('rx_on', '1'); } catch (e) {}
        tray(); emit();
        apply();
    }
    function stop() {
        on = false;
        try { sessionStorage.removeItem('rx_on'); } catch (e) {}
        apply();
        tray(); emit();
    }
    // the desktop page of the same session: it was on before a game / app opened
    function resume() { var v = null; try { v = sessionStorage.getItem('rx_on'); } catch (e) {} if (v === '1') start(); }

    function state() {
        var l = [];
        for (var id in phones) l.push({ id: id, name: phones[id].name, ip: phones[id].ip });
        return { on: on, ip: ip, noNet: noNet, scanning: !!scanner, progress: progress, phones: l, via: viaPref(), mode: mode || viaNow(), code: code(), netOk: net.ok, netErr: net.err, online: typeof NetMode === 'undefined' || NetMode.mode() === 'online' };
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
        start: start, stop: stop, resume: resume, on: function () { return on; }, state: state, scan: function () { if (on && mode === 'cloud') netFast(); else if (on) scan(); },
        watch: function (v) {
            watching = Math.max(0, watching + (v ? 1 : -1));
            if (v && on && mode === 'lan' && !scanner && !Object.keys(phones).length) scan();
            if (v && on && mode === 'cloud') netFast();
        },
        setVia: setVia, via: viaPref, code: code, renewCode: renewCode, link: function () { return 'https://pc.geekspro.us/?sendto=' + code(); },
        onChange: function (fn) { listeners.push(fn); }, offChange: function (fn) { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
        addPhone: addPhone, history: history, open: open, kindOf: kindOf, label: label, linkIn: linkIn, tvId: tvId, tvName: tvName
    };
})();
