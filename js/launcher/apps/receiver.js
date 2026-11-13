/* Share to the TV (owner request 2026-11-13), the two screens:
 *   receiver  (the TV) Receiver: starts ShareRx (js/launcher/share-rx.js), shows the TV's address, the phones found, what came,
 *             Look again / Type the phone's address / Stop receiving. Closing the window keeps receiving on the desktop page.
 *   sendtv    (the My PC Android app, MyPCNative 6+) Send to TV: what was shared from Android's share menu, the TVs whose Receiver
 *             is open (they asked this phone, android-controller/.../LanServer.java), Send to <TV> + Always send to this TV,
 *             Send a text or a link. window.ShareOut.changed() / arrived() are called by the app when something changes.
 * Local network only: no Firebase, no internet server. */
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
        tx.appendChild(el('p', 'rx-help', t('rxHelp')));
        head.appendChild(tx);
        box.appendChild(head);

        var st = el('div', 'rx-status' + (s.on ? ' on' : ''));
        var line;
        if (!s.on) line = t('rxOff');
        else if (s.noNet) line = t('rxNoNet');
        else if (s.phones.length) line = s.phones.map(function (p) { return t('rxReady').replace('%s', p.name); }).join(' · ');
        else if (s.scanning) line = t('rxLooking').replace('%n', s.progress);
        else line = t('rxNoPhone');
        st.appendChild(el('span', 'rx-dot'));
        st.appendChild(el('span', 'rx-line', line));
        st.setAttribute('role', 'status');
        box.appendChild(st);
        if (s.on && s.scanning) { var pb = el('div', 'rx-prog'), pf = el('div', 'rx-prog-f'); pf.style.transform = 'scaleX(' + (s.progress / 100) + ')'; pb.appendChild(pf); box.appendChild(pb); }
        if (s.on && s.ip) box.appendChild(el('div', 'rx-addr', t('rxAddr').replace('%s', s.ip)));
        if (s.on) box.appendChild(el('p', 'rx-note', t('rxOn')));

        var bar = el('div', 'rx-bar');
        var b1 = btn('rx-btn rx-main', t(s.on ? 'rxStop' : 'rxStart'), function () { if (ShareRx.on()) ShareRx.stop(); else ShareRx.start(); });
        b1.setAttribute('data-k', 'onoff');
        bar.appendChild(b1);
        if (s.on) {
            var b2 = btn('rx-btn', t('rxScan'), function () { ShareRx.scan(); });
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
        bar.appendChild(b3);
        box.appendChild(bar);

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
    var stBody = null, stTimer = 0, always = true;
    function N() { return window.MyPCNative; }
    function nativeOk() { try { return !!(N() && N().version && N().version() >= 6 && N().shareInfo); } catch (e) { return false; } }
    function info() { try { return JSON.parse(N().shareInfo()); } catch (e) { return { items: [], tvs: [] }; } }
    function tvName(s, id) { for (var i = 0; i < s.tvs.length; i++) if (s.tvs[i].id === id) return s.tvs[i].name; return 'TV'; }

    function stDraw() { if (stBody) keepFocus(stBody, stRender); }
    function stRender() {
        stBody.innerHTML = '';
        var box = el('div', 'st');
        if (!nativeOk()) { box.appendChild(el('p', 'rx-help', t('stOld'))); stBody.appendChild(box); return; }
        var s = info(), open = s.tvs.filter(function (v) { return v.open; }), waiting = s.items.filter(function (x) { return x.state === 'wait'; });
        box.appendChild(el('p', 'rx-help', t('stHelp')));
        box.appendChild(el('div', 'rx-addr', s.ip ? t('stAddr').replace('%s', s.ip + ':' + s.port) : t('stNoWifi')));
        if (!s.listening) box.appendChild(el('div', 'rx-none', t('stOff')));

        box.appendChild(el('h3', 'rx-sub', t('stTvs')));
        var tvs = el('div', 'st-tvs');
        if (!open.length) tvs.appendChild(el('div', 'rx-status', t('stWaitTv')));
        for (var i = 0; i < open.length; i++) {
            var v = open[i], row = el('div', 'st-tv');
            row.appendChild(el('span', 'rx-dot'));
            row.appendChild(el('span', 'st-tv-n', v.name));
            if (s.tv === v.id) {
                row.appendChild(el('span', 'st-auto', t('stAuto').replace('%s', v.name)));
                var f = btn('rx-btn', t('stForget'), function () { N().shareForget(); });
                f.setAttribute('data-k', 'forget'); row.appendChild(f);
            }
            if (waiting.length) {
                var go = btn('rx-btn rx-main', t('stPick').replace('%s', v.name), (function (id) { return function () { N().shareSend('', id, always); }; })(v.id));
                go.setAttribute('data-k', 'go' + v.id);
                row.appendChild(go);
            }
            tvs.appendChild(row);
        }
        box.appendChild(tvs);
        if (open.length && waiting.length && !s.tv) {
            var ch = btn('st-check' + (always ? ' on' : ''), (always ? '☑ ' : '☐ ') + t('stAlways'), function () { always = !always; stDraw(); });
            ch.setAttribute('data-k', 'always');
            box.appendChild(ch);
        }

        box.appendChild(el('h3', 'rx-sub', t('stItems')));
        var list = el('div', 'rx-list');
        if (!s.items.length) list.appendChild(el('div', 'rx-none', t('stNone')));
        for (var k = s.items.length - 1; k >= 0; k--) {
            var it = s.items[k], kind = it.kind === 'text' ? ShareRx.kindOf('text/plain', it.text) : ShareRx.kindOf(it.mime);
            var r = el('div', 'st-item');
            var ic = el('span', 'rx-ic'); Icons.put(ic, { link: 'browser', text: 'notes', photo: 'photos', video: 'videos', song: 'music' }[kind] || 'document'); r.appendChild(ic);
            var w = el('span', 'rx-it');
            w.appendChild(el('span', 'rx-it-n', ShareRx.label(kind) + ': ' + (it.kind === 'text' ? String(it.text).slice(0, 80) : it.name)));
            w.appendChild(el('span', 'rx-it-s st-' + it.state, t('stState_' + it.state) + (it.tv && it.state !== 'wait' ? ' · ' + tvName(s, it.tv) : '')));
            r.appendChild(w);
            var rm = btn('rx-btn', t('stRemove'), (function (id) { return function () { N().shareRemove(id); }; })(it.id));
            rm.setAttribute('data-k', 'rm' + it.id);
            r.appendChild(rm);
            list.appendChild(r);
        }
        box.appendChild(list);
        var bar = el('div', 'rx-bar');
        var tt = btn('rx-btn', t('stTypeText'), function () {
            Keyboard.open({ title: t('stTypeText'), max: 2000, mode: 'title' }, function (v) { if (String(v || '').trim()) N().shareText(String(v)); });
        });
        tt.setAttribute('data-k', 'type');
        bar.appendChild(tt);
        if (s.items.length) { var cl = btn('rx-btn', t('stClear'), function () { N().shareRemove(''); }); cl.setAttribute('data-k', 'clear'); bar.appendChild(cl); }
        box.appendChild(bar);
        box.appendChild(el('p', 'rx-privacy', t('rxPrivacy')));
        stBody.appendChild(box);
    }

    Win.register('sendtv', {
        icon: 'receiver',
        title: function () { return t('sendtv'); },
        open: function (b) {
            stBody = b;
            stRender();
            // the TVs come and go by themselves (a Receiver opened or closed): read again every 2 s while this is open
            clearInterval(stTimer);
            stTimer = setInterval(stDraw, 2000);
            return b.querySelector('.rx-main') || b.querySelector('[data-focus]');
        },
        close: function () { clearInterval(stTimer); stTimer = 0; stBody = null; },
        refresh: function () { stDraw(); }
    });

    // called by the Android app (MainActivity): something changed / a share just arrived from Android's share menu
    window.ShareOut = {
        changed: function () { stDraw(); },
        arrived: function () { if (Win.current() === 'sendtv') stDraw(); else Win.open('sendtv'); },
        pending: function () { try { return nativeOk() && N().sharePending(); } catch (e) { return false; } },
        supported: nativeOk
    };
})();
