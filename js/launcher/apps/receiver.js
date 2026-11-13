/* Share to the TV (owner request 2026-11-13), the two screens:
 *   receiver  (the TV) Receiver: starts ShareRx (js/launcher/share-rx.js), shows the TV's address, the phones found, what came,
 *             Look again / Type the phone's address / Stop receiving. Closing the window keeps receiving on the desktop page.
 *   sendtv    (the My PC Android app, MyPCNative 6+) Send to TV: what was shared from Android's share menu, the TVs whose Receiver
 *             is open (they asked this phone, android-controller/.../LanServer.java), Send to <TV> + Always send to this TV,
 *             Send a text or a link. window.ShareOut.changed() / arrived() are called by the app when something changes.
 * On this Wi-Fi (the phone's LanServer) or over the internet (Firestore share/<TV code>/items, see js/launcher/share-rx.js);
 * the TV's Receiver picks with "Listen on" (Automatic / This Wi-Fi / Internet). A phone adds a TV for the internet with its code
 * (typed, or the TV's QR code scanned) and keeps them in arc_dev_st_net. In a phone's browser (no My PC app) only the internet
 * part shows: texts, links and photos. */
(function () {
    'use strict';

    function t(k) { return I18n.t(k); }
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
    function btn(cls, text, fn) { var b = el('button', cls, text); b.setAttribute('data-focus', ''); b.onclick = fn; return b; }
    function when(ms) { var d = new Date(ms); return Desktop.timeText(d); }
    function keepFocus(box, fn) {
        var f = Focus.current(), key = f && f.getAttribute && f.getAttribute('data-k');
        fn();
        var again = key ? box.querySelector('[data-k="' + key + '"]') : null;
        if (again) Focus.focus(again);
        else if (f && !document.body.contains(f)) { var any = box.querySelector('[data-focus]'); if (any) Focus.focus(any); }
    }

    /* ================= the TV: Receiver ================= */
    var rxBody = null;
    function rxDraw() {
        if (!rxBody) return;
        keepFocus(rxBody, rxRender);
    }
    function rxRender() {
        var s = ShareRx.state(), box = el('div', 'rx');
        rxBody.innerHTML = '';
        var head = el('div', 'rx-head');
        var art = el('div', 'rx-art'); Icons.put(art, 'receiver'); head.appendChild(art);
        var tx = el('div', 'rx-tx');
        tx.appendChild(el('h2', 'rx-title', t('rxTitle')));
        tx.appendChild(el('p', 'rx-help', t(s.mode === 'cloud' ? 'rxHelpNet' : 'rxHelp')));
        head.appendChild(tx);
        box.appendChild(head);

        var st = el('div', 'rx-status' + (s.on ? ' on' : ''));
        var line;
        if (!s.on) line = t('rxOff');
        else if (s.mode === 'cloud') line = s.netOk ? t('rxNetOn') : s.netErr ? t('rxNetFail') : t('rxNetStart');
        else if (s.noNet) line = t('rxNoNet');
        else if (s.phones.length) line = s.phones.map(function (p) { return t('rxReady').replace('%s', p.name); }).join(' · ');
        else if (s.scanning) line = t('rxLooking').replace('%n', s.progress);
        else line = t('rxNoPhone');
        if (s.mode === 'cloud' && s.on && !s.netOk) st.classList.remove('on');
        st.appendChild(el('span', 'rx-dot'));
        st.appendChild(el('span', 'rx-line', line));
        st.setAttribute('role', 'status');
        box.appendChild(st);
        if (s.on && s.mode === 'lan' && s.scanning) { var pb = el('div', 'rx-prog'), pf = el('div', 'rx-prog-f'); pf.style.transform = 'scaleX(' + (s.progress / 100) + ')'; pb.appendChild(pf); box.appendChild(pb); }
        if (s.on && s.mode === 'lan' && s.ip) box.appendChild(el('div', 'rx-addr', t('rxAddr').replace('%s', s.ip)));
        if (s.on) box.appendChild(el('p', 'rx-note', t('rxOn')));

        var bar = el('div', 'rx-bar');
        var b1 = btn('rx-btn rx-main', t(s.on ? 'rxStop' : 'rxStart'), function () { if (ShareRx.on()) ShareRx.stop(); else ShareRx.start(); });
        b1.setAttribute('data-k', 'onoff');
        bar.appendChild(b1);
        if (s.on) {
            var b2 = btn('rx-btn', t(s.mode === 'cloud' ? 'rxCheck' : 'rxScan'), function () { ShareRx.scan(); });
            b2.setAttribute('data-k', 'scan');
            bar.appendChild(b2);
        }
        var b3 = btn('rx-btn', t('rxManual'), function () {
            Keyboard.open({ title: t('rxManual'), hint: t('rxManualHint'), max: 15, mode: 'url', ok: t('go') }, function (v) {
                v = String(v || '').trim();
                if (!v) return;
                ShareRx.addPhone(v, function (ok) { if (!ok) Notify.show({ id: 'rx', kind: 'warn', title: t('receiver'), text: t('rxBadAddr').replace('%s', v) }); });
            });
        });
        b3.setAttribute('data-k', 'manual');
        if (s.mode === 'lan') bar.appendChild(b3);
        box.appendChild(bar);

        // Listen on: Automatic (internet while it works, else this Wi-Fi) / This Wi-Fi / Internet
        var via = el('div', 'rx-via');
        via.appendChild(el('span', 'rx-via-l', t('rxVia')));
        [['auto', 'rxViaAuto'], ['lan', 'rxViaLan'], ['cloud', 'rxViaNet']].forEach(function (v) {
            var txt = t(v[1]) + (v[0] === 'auto' && s.via === 'auto' && s.on ? ' (' + t(s.mode === 'cloud' ? 'rxViaNet' : 'rxViaLan') + ')' : '');
            var b = btn('rx-btn rx-opt' + (s.via === v[0] ? ' on' : ''), txt, function () { ShareRx.setVia(v[0]); if (!ShareRx.on()) ShareRx.start(); });
            b.setAttribute('data-k', 'via-' + v[0]);
            b.setAttribute('aria-pressed', s.via === v[0] ? 'true' : 'false');
            via.appendChild(b);
        });
        box.appendChild(via);

        // the TV's code for phones (internet): QR code of the link + the code to type
        if (s.on && s.mode === 'cloud') {
            var cb = el('div', 'rx-code'), qr = el('div', 'rx-qr');
            try { qr.innerHTML = QR.svg(ShareRx.link(), { quiet: 2 }); } catch (e) {}
            qr.setAttribute('aria-hidden', 'true');
            cb.appendChild(qr);
            var ct = el('div', 'rx-code-t');
            ct.appendChild(el('div', 'rx-code-l', t('rxCode')));
            var big = el('div', 'rx-code-v', s.code.slice(0, 5) + ' ' + s.code.slice(5));
            big.setAttribute('aria-label', s.code.split('').join(' '));
            ct.appendChild(big);
            ct.appendChild(el('p', 'rx-note', t('rxCodeHelp')));
            if (s.account) ct.appendChild(el('p', 'rx-note rx-mine', t('rxMine').replace('%s', s.account)));
            var nc = btn('rx-btn', t('rxNewCode'), function () { ShareRx.renewCode(); });
            nc.setAttribute('data-k', 'newcode');
            ct.appendChild(nc);
            cb.appendChild(ct);
            box.appendChild(cb);
        }

        var h = ShareRx.history();
        box.appendChild(el('h3', 'rx-sub', t('rxHistory')));
        var list = el('div', 'rx-list');
        list.setAttribute('role', 'list');
        if (!h.length) list.appendChild(el('div', 'rx-none', t('rxNone')));
        for (var i = 0; i < h.length && i < 12; i++) {
            var it = h[i], b = btn('rx-item', '');
            b.setAttribute('role', 'listitem');
            b.setAttribute('data-k', 'h' + it.at);
            var ic = el('span', 'rx-ic'); Icons.put(ic, { link: 'browser', text: 'notes', photo: 'photos', video: 'videos', song: 'music' }[it.k] || 'document'); b.appendChild(ic);
            var w = el('span', 'rx-it'); w.appendChild(el('span', 'rx-it-n', (ShareRx.label(it.k)) + (it.n ? ': ' + it.n : '')));
            w.appendChild(el('span', 'rx-it-s', t('rxGot').replace('%s', it.from || '?') + ' · ' + when(it.at)));
            b.appendChild(w);
            b.onclick = (function (x) { return function () { ShareRx.open(x); }; })(it);
            list.appendChild(b);
        }
        box.appendChild(list);
        box.appendChild(el('p', 'rx-privacy', t('rxPrivacy')));
        rxBody.appendChild(box);
    }

    Win.register('receiver', {
        icon: 'receiver',
        title: function () { return t('receiver'); },
        open: function (b) {
            rxBody = b;
            ShareRx.onChange(rxDraw);
            ShareRx.watch(true);
            ShareRx.start();
            rxRender();
            return b.querySelector('[data-k="onoff"]');
        },
        close: function () { ShareRx.offChange(rxDraw); ShareRx.watch(false); rxBody = null; },
        refresh: function () { rxDraw(); }
    });

    /* ================= the phone: Send to TV ================= */
    var stBody = null, stTimer = 0, netTimer = 0, always = true, pres = {}, busyUp = {}, webItems = [], stArg = null;
    var NETS = 'arc_dev_st_net', UPS = 'arc_dev_st_up', CODE_RE = /^[2-9A-HJ-NP-Z]{10}$/, MAX_B64 = 700000;
    function N() { return window.MyPCNative; }
    function nativeOk() { try { return !!(N() && N().version && N().version() >= 6 && N().shareInfo); } catch (e) { return false; } }
    function info() { try { return JSON.parse(N().shareInfo()); } catch (e) { return { items: [], tvs: [] }; } }
    function nets() { var l = Store.rawGet(NETS); return Array.isArray(l) ? l.filter(function (x) { return x && CODE_RE.test(x.code); }) : []; }
    function netOf(code) { var l = nets(); for (var i = 0; i < l.length; i++) if (l[i].code === code) return l[i]; return null; }
    function tvName(s, id) {
        if (String(id).indexOf('net:') === 0) { var n = netOf(id.slice(4)); return n ? n.name : 'TV'; }
        for (var i = 0; i < s.tvs.length; i++) if (s.tvs[i].id === id) return s.tvs[i].name;
        return 'TV';
    }
    // what this phone sent over the internet: { item id: { c: TV code, st: 'sent' | 'taken' | 'failed', at } }
    function ups() { var m = Store.rawGet(UPS); return m && typeof m === 'object' && !Array.isArray(m) ? m : {}; }
    function setUp(id, v) {
        var m = ups(), keys;
        m[id] = v;
        keys = Object.keys(m).sort(function (a, b) { return (m[b].at || 0) - (m[a].at || 0); });
        for (var i = 60; i < keys.length; i++) delete m[keys[i]];
        Store.rawSet(UPS, m);
    }
    function mark(id, st) { try { if (N() && N().shareMark) N().shareMark(id, st); } catch (e) {} }
    function phoneName(s) {
        if (s && s.name) return String(s.name).slice(0, 60);
        var p = null;
        try { p = Profiles.current(); } catch (e) {}
        return (p && p.name ? p.name : t('stPhone')).slice(0, 60);
    }
    function codeIn(text) {
        text = String(text || '');
        var m = /[?&]sendto=([2-9A-HJ-NP-Z]{10})/i.exec(text);
        if (m) return m[1].toUpperCase();
        var c = text.toUpperCase().replace(/[\s\-.]/g, '');
        return CODE_RE.test(c) ? c : '';
    }
    function rid() { var b = new Uint8Array(16), s = ''; try { crypto.getRandomValues(b); } catch (e) { for (var j = 0; j < 16; j++) b[j] = Math.floor(Math.random() * 256); } for (var i = 0; i < 16; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16); return s; }

    /* ---------- TVs over the internet ---------- */
    function tvOpen(code) { var p = pres[code]; return !!(p && p.open && Cloud.now() - (+p.at || 0) < 360000); }
    function addTv(code, cb) {
        Cloud.get('share/' + code, 6000, function (e, d) {
            if (e === 'notfound' || (!e && !d)) return cb('nocode');
            if (e) return cb('net');
            pres[code] = d;
            var l = nets().filter(function (x) { return x.code !== code; });
            l.unshift({ code: code, name: String(d.name || 'TV').slice(0, 60) });
            Store.rawSet(NETS, l.slice(0, 8));
            cb(null);
        });
    }
    function addTvAsk(code) {
        addTv(code, function (e) {
            if (e) Notify.show({ id: 'st', kind: e === 'nocode' ? 'warn' : 'err', title: t('sendtv'), text: t(e === 'nocode' ? 'stBadCode' : 'stNoNet') });
            else Notify.show({ id: 'st', kind: 'ok', title: t('sendtv'), text: t('stAdded').replace('%s', netOf(code).name) });
            stDraw();
        });
    }
    function forgetTv(code) {
        Store.rawSet(NETS, nets().filter(function (x) { return x.code !== code; }));
        if (nativeOk()) { var s = info(); if (s.tv === 'net:' + code) N().shareForget(); }
        stDraw();
    }
    // the TVs of the same player account (their Receiver wrote players/<uid>/tvs): no code needed
    function myTvs() {
        if (typeof Accounts === 'undefined' || !Accounts.uid) return;
        var pid = Store.profile(), uid = Accounts.uid(pid), own = '';
        if (!uid) return;
        try { own = ShareRx.tvKey(); } catch (e) {}
        Accounts.token(pid, function (e, tok) {
            if (e) return;
            Cloud.query('players/' + uid, { from: [{ collectionId: 'tvs' }], limit: 20 }, 8000, function (e2, docs) {
                if (e2 || !docs) return;
                var l = nets().filter(function (x) { return !x.mine; }), got = [];
                docs.forEach(function (d) {
                    var c = d.data && d.data.code;
                    if (!CODE_RE.test(c || '') || d.id === own) return;
                    l = l.filter(function (x) { return x.code !== c; });
                    got.push({ code: c, name: String(d.data.name || 'TV').slice(0, 60), mine: 1, tv: d.id });
                });
                Store.rawSet(NETS, got.concat(l).slice(0, 12));
                netCheck();
                stDraw();
            }, tok);
        });
    }
    // every 15 s while this screen shows: which TVs listen, and which sent items the TV took (it deletes them)
    function netCheck() {
        var l = nets(), m = ups(), paths = [], id;
        for (var i = 0; i < l.length; i++) paths.push('share/' + l[i].code);
        for (id in m) if (m[id].st === 'sent' && Date.now() - (m[id].at || 0) < 86400000) paths.push('share/' + m[id].c + '/items/' + id);
        if (!paths.length || document.hidden) return;
        Cloud.batchGet(paths.slice(0, 40), 8000, function (e, r) {
            if (e || !r) return;
            for (var k in r) {
                var seg = k.split('/');
                if (seg.length === 2) pres[seg[1]] = r[k] ? r[k].data : null;
                else if (seg.length === 4 && (!r[k] || (r[k].data && r[k].data.no))) {
                    var u = ups()[seg[3]], st = r[k] ? 'failed' : 'taken';
                    if (u && u.st === 'sent') { u.st = st; setUp(seg[3], u); mark(seg[3], st); }
                    if (r[k]) Cloud.remove(k, 6000, function () {});
                }
            }
            stDraw();
        });
    }

    // a picture made small enough for one Firestore document: longest side 1600 (then smaller), JPEG, base64 under 700 000
    function shrinkPhoto(blob, cb) {
        function draw(img, w, h) {
            var sizes = [1600, 1280, 1024, 800], qs = [0.82, 0.7, 0.6];
            for (var a = 0; a < sizes.length; a++) {
                var k = Math.min(1, sizes[a] / Math.max(w, h)), c = document.createElement('canvas');
                c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
                c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                for (var b = 0; b < qs.length; b++) {
                    var d = c.toDataURL('image/jpeg', qs[b]), b64 = d.slice(d.indexOf(',') + 1);
                    if (b64.length <= MAX_B64) { c.width = c.height = 0; return cb(null, b64); }
                }
                c.width = c.height = 0;
            }
            cb('big');
        }
        if (typeof createImageBitmap === 'function') {
            return createImageBitmap(blob).then(function (bm) { draw(bm, bm.width, bm.height); try { bm.close(); } catch (e) {} }, function () { cb('decode'); });
        }
        var img = new Image(), u = URL.createObjectURL(blob);
        img.onload = function () { URL.revokeObjectURL(u); draw(img, img.naturalWidth, img.naturalHeight); };
        img.onerror = function () { URL.revokeObjectURL(u); cb('decode'); };
        img.src = u;
    }
    function write(code, id, doc, cb) {
        doc.at = Cloud.now();
        doc.exp = new Date(Cloud.now() + 86400000);
        Cloud.patch('share/' + code + '/items/' + id, doc, { exists: false }, 20000, function (e) { cb(e && e !== 'conflict' ? e : null); });
    }
    // one item of the phone's share list (My PC app) -> the TV with that code
    function sendItem(s, it, code, cb) {
        var from = phoneName(s);
        var local = 'http://127.0.0.1:' + (s.port || 47800) + '/mypc/file/' + encodeURIComponent(it.id) + '?tv=local';
        var mime = String(it.mime || '').toLowerCase();
        if (it.kind === 'text') return write(code, it.id, { k: 'text', text: String(it.text || '').slice(0, 20000), n: '', from: from }, cb);
        if (mime.indexOf('image/') === 0 && mime.indexOf('svg') < 0) {
            return fetch(local, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('http'); return r.blob(); }).then(function (b) {
                shrinkPhoto(b, function (e, b64) {
                    if (e) return cb(e);
                    write(code, it.id, { k: 'photo', n: String(it.name || '').slice(0, 120), mime: 'image/jpeg', data: b64, from: from }, cb);
                });
            }, function () { cb('read'); });
        }
        if (mime.indexOf('text/') === 0 && +it.size < 300000) {
            return fetch(local, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('http'); return r.text(); }).then(function (txt) {
                write(code, it.id, { k: 'text', text: txt.slice(0, 20000), n: String(it.name || '').slice(0, 120), from: from }, cb);
            }, function () { cb('read'); });
        }
        // too big for the database: the TV gets the phone's address and takes it only on the same Wi-Fi
        if (!s.ip) return cb('nowifi');
        write(code, it.id, { k: 'file', n: String(it.name || 'file').slice(0, 120), mime: mime.slice(0, 100), size: +it.size || 0,
            u: 'http://' + s.ip + ':' + (s.port || 47800) + '/mypc/file/' + encodeURIComponent(it.id) + '?tv=' + encodeURIComponent('net:' + code), from: from }, cb);
    }
    // sends what was handed to a TV over the internet and is not up yet (the My PC app keeps the list)
    function pump(s) {
        var m = ups();
        if (s.tv && s.tv.indexOf('net:') === 0 && netOf(s.tv.slice(4)) && s.items.some(function (x) { return x.state === 'wait'; })) { N().shareSend('', s.tv, true); return; }
        s.items.forEach(function (it) {
            if (it.state !== 'sent' || String(it.tv).indexOf('net:') !== 0 || m[it.id] || busyUp[it.id]) return;
            var code = it.tv.slice(4);
            busyUp[it.id] = 1;
            sendItem(s, it, code, function (e) {
                delete busyUp[it.id];
                setUp(it.id, { c: code, st: e ? 'failed' : 'sent', at: Date.now(), e: e ? String(e) : '' });
                if (e) mark(it.id, 'failed');
                stDraw();
                if (!e) setTimeout(netCheck, 5000);
            });
        });
    }
    // in a phone's browser (no My PC app): texts, links and photos picked here
    function webSend(code, kind, payload, name) {
        var it = { id: rid(), k: kind, n: name || '', st: 'wait', tv: 'net:' + code };
        webItems.unshift(it);
        webItems = webItems.slice(0, 20);
        function end(e) { it.st = e ? 'failed' : 'sent'; if (!e) setUp(it.id, { c: code, st: 'sent', at: Date.now() }); stDraw(); if (!e) setTimeout(netCheck, 5000); }
        stDraw();
        if (kind === 'text') return write(code, it.id, { k: 'text', text: String(payload).slice(0, 20000), n: '', from: phoneName() }, end);
        shrinkPhoto(payload, function (e, b64) { if (e) return end(e); write(code, it.id, { k: 'photo', n: String(name || '').slice(0, 120), mime: 'image/jpeg', data: b64, from: phoneName() }, end); });
    }
    function pickPhotos(code) {
        var inp = document.createElement('input');
        inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
        inp.onchange = function () { for (var i = 0; i < inp.files.length && i < 20; i++) webSend(code, 'photo', inp.files[i], inp.files[i].name); };
        inp.click();
    }

    function stDraw() { if (stBody) keepFocus(stBody, stRender); }
    function stRender() {
        stBody.innerHTML = '';
        var box = el('div', 'st'), nat = nativeOk();
        var s = nat ? info() : { items: [], tvs: [] }, m = ups();
        if (nat) pump(s);
        var open = s.tvs.filter(function (v) { return v.open; }), waiting = s.items.filter(function (x) { return x.state === 'wait'; });
        box.appendChild(el('p', 'rx-help', t(nat ? 'stHelp' : 'stHelpWeb')));
        if (nat) {
            box.appendChild(el('div', 'rx-addr', s.ip ? t('stAddr').replace('%s', s.ip + ':' + s.port) : t('stNoWifi')));
            if (!s.listening) box.appendChild(el('div', 'rx-none', t('stOff')));
        }

        box.appendChild(el('h3', 'rx-sub', t('stTvs')));
        var tvs = el('div', 'st-tvs'), l = nets();
        if (!open.length && !l.length) tvs.appendChild(el('div', 'rx-status', t('stWaitTv')));
        function row(id, name, how, on, extra) {
            var r = el('div', 'st-tv' + (on ? '' : ' st-tv-off'));
            r.appendChild(el('span', 'rx-dot'));
            var w = el('span', 'st-tv-n', name);
            w.appendChild(el('span', 'st-how', how));
            r.appendChild(w);
            if (s.tv === id) {
                r.appendChild(el('span', 'st-auto', t('stAuto').replace('%s', name)));
                var f = btn('rx-btn', t('stForget'), function () { N().shareForget(); });
                f.setAttribute('data-k', 'forget' + id); r.appendChild(f);
            }
            if (nat && waiting.length) {
                var go = btn('rx-btn rx-main', t('stPick').replace('%s', name), function () { N().shareSend('', id, always); });
                go.setAttribute('data-k', 'go' + id);
                r.appendChild(go);
            }
            if (extra) extra(r);
            tvs.appendChild(r);
        }
        for (var i = 0; i < open.length; i++) row(open[i].id, open[i].name, t('stWifi'), true);
        l.forEach(function (n) {
            var on = tvOpen(n.code);
            row('net:' + n.code, n.name, (n.mine ? t('stMine') + ' · ' : '') + t('stNet') + ' · ' + t(on ? 'stNetOn' : pres[n.code] === undefined ? 'stNetAsk' : 'stNetOff'), on, function (r) {
                if (!nat) {
                    var tx = btn('rx-btn rx-main', t('stTypeText'), function () {
                        Keyboard.open({ title: t('stTypeText'), max: 2000, mode: 'title' }, function (v) { if (String(v || '').trim()) webSend(n.code, 'text', String(v)); });
                    });
                    tx.setAttribute('data-k', 'wt' + n.code); r.appendChild(tx);
                    var ph = btn('rx-btn', t('stPhotos'), function () { pickPhotos(n.code); });
                    ph.setAttribute('data-k', 'wp' + n.code); r.appendChild(ph);
                }
                if (n.mine) return;                        // the account's own TVs come back by themselves
                var rm = btn('rx-btn', t('stForgetTv'), function () { forgetTv(n.code); });
                rm.setAttribute('data-k', 'rmtv' + n.code); r.appendChild(rm);
            });
        });
        box.appendChild(tvs);
        var add = el('div', 'rx-bar');
        var ab = btn('rx-btn', t('stAddCode'), function () {
            Keyboard.open({ title: t('stAddCode'), hint: t('stCodeHint'), max: 40, mode: 'title', ok: t('go') }, function (v) {
                if (v === null || v === undefined || !String(v).trim()) return;
                var c = codeIn(v);
                if (!c) return Notify.show({ id: 'st', kind: 'warn', title: t('sendtv'), text: t('stBadCode') });
                addTvAsk(c);
            });
        });
        ab.setAttribute('data-k', 'addcode'); add.appendChild(ab);
        if (nat && N().scanQr) { var sc = btn('rx-btn', t('stScan'), function () { N().scanQr(); }); sc.setAttribute('data-k', 'scan'); add.appendChild(sc); }
        box.appendChild(add);
        if (nat && (open.length || l.length) && waiting.length && !s.tv) {
            var ch = btn('st-check' + (always ? ' on' : ''), (always ? '☑ ' : '☐ ') + t('stAlways'), function () { always = !always; stDraw(); });
            ch.setAttribute('data-k', 'always');
            box.appendChild(ch);
        }

        box.appendChild(el('h3', 'rx-sub', t('stItems')));
        var list = el('div', 'rx-list');
        if (!s.items.length && !webItems.length) list.appendChild(el('div', 'rx-none', t('stNone')));
        for (var k = s.items.length - 1; k >= 0; k--) {
            var it = s.items[k], kind = it.kind === 'text' ? ShareRx.kindOf('text/plain', it.text) : ShareRx.kindOf(it.mime);
            var st = it.state, up = m[it.id];
            if (String(it.tv).indexOf('net:') === 0 && st === 'sent') st = !up ? 'sent' : up.st === 'sent' ? 'up' : up.st;
            var r = el('div', 'st-item');
            var ic = el('span', 'rx-ic'); Icons.put(ic, { link: 'browser', text: 'notes', photo: 'photos', video: 'videos', song: 'music' }[kind] || 'document'); r.appendChild(ic);
            var w = el('span', 'rx-it');
            w.appendChild(el('span', 'rx-it-n', ShareRx.label(kind) + ': ' + (it.kind === 'text' ? String(it.text).slice(0, 80) : it.name)));
            w.appendChild(el('span', 'rx-it-s st-' + st, t('stState_' + st) + (it.tv && st !== 'wait' ? ' · ' + tvName(s, it.tv) : '')));
            r.appendChild(w);
            var rm = btn('rx-btn', t('stRemove'), (function (id) { return function () { N().shareRemove(id); }; })(it.id));
            rm.setAttribute('data-k', 'rm' + it.id);
            r.appendChild(rm);
            list.appendChild(r);
        }
        webItems.forEach(function (x) {
            var st = x.st === 'sent' && m[x.id] ? (m[x.id].st === 'sent' ? 'up' : m[x.id].st) : x.st === 'wait' ? 'sent' : x.st;
            var r = el('div', 'st-item'), ic = el('span', 'rx-ic');
            Icons.put(ic, x.k === 'photo' ? 'photos' : 'notes'); r.appendChild(ic);
            var w = el('span', 'rx-it');
            w.appendChild(el('span', 'rx-it-n', ShareRx.label(x.k === 'photo' ? 'photo' : 'text') + (x.n ? ': ' + x.n : '')));
            w.appendChild(el('span', 'rx-it-s st-' + st, t('stState_' + st) + ' · ' + tvName(s, x.tv)));
            r.appendChild(w);
            list.appendChild(r);
        });
        box.appendChild(list);
        if (nat) {
            var bar = el('div', 'rx-bar');
            var tt = btn('rx-btn', t('stTypeText'), function () {
                Keyboard.open({ title: t('stTypeText'), max: 2000, mode: 'title' }, function (v) { if (String(v || '').trim()) N().shareText(String(v)); });
            });
            tt.setAttribute('data-k', 'type');
            bar.appendChild(tt);
            if (s.items.length) { var cl = btn('rx-btn', t('stClear'), function () { N().shareRemove(''); }); cl.setAttribute('data-k', 'clear'); bar.appendChild(cl); }
            box.appendChild(bar);
        }
        box.appendChild(el('p', 'rx-privacy', t('rxPrivacy')));
        stBody.appendChild(box);
    }

    Win.register('sendtv', {
        icon: 'receiver',
        title: function () { return t('sendtv'); },
        open: function (b, arg) {
            stBody = b;
            stRender();
            // the TVs come and go by themselves (a Receiver opened or closed): read again every 2 s while this is open (the
            // phone's own list, no network); the TVs over the internet every 15 s
            clearInterval(stTimer); clearInterval(netTimer);
            if (nativeOk()) stTimer = setInterval(stDraw, 2000);
            netTimer = setInterval(netCheck, 15000);
            netCheck();
            myTvs();
            var add = arg && typeof arg === 'object' && arg.add ? codeIn(arg.add) : '';
            if (add) addTvAsk(add);
            return b.querySelector('.rx-main') || b.querySelector('[data-focus]');
        },
        close: function () { clearInterval(stTimer); clearInterval(netTimer); stTimer = netTimer = 0; stBody = null; },
        refresh: function () { stDraw(); }
    });

    // called by the Android app (MainActivity): something changed / a share just arrived from Android's share menu
    window.ShareOut = {
        changed: function () { stDraw(); },
        arrived: function () { if (Win.current() === 'sendtv') stDraw(); else Win.open('sendtv'); },
        pending: function () { try { return nativeOk() && N().sharePending(); } catch (e) { return false; } },
        supported: nativeOk,
        // a QR code scanned by the My PC app (MainActivity.pair): a TV's Receiver link -> that TV is added; '' = not one
        scanCode: function (text) { var c = codeIn(text); if (!c || !/sendto=/i.test(String(text))) return ''; if (Win.current() !== 'sendtv') Win.open('sendtv', { add: c }); else addTvAsk(c); return c; }
    };
})();
