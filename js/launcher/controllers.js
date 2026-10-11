/* Phones as game controllers (player 1 / player 2). The phone opens controller/ (its own page, no game on it), types the
 * TV's code and picks P1 or P2; it then sends only button presses. The TV shows the game, as always.
 *   - Signalling: a room (js/core/rooms.js, app 'controller') whose code is kept on this TV, so a phone reconnects by itself
 *     when the page changes (opening a game / quitting loads another page). Only Firestore, no new rules except `app`.
 *   - Link: the same WebRTC data channel as multiplayer (js/core/netlink.js); presses never go through Firebase.
 *   - Player 1 = the 'keys' device (like the remote / keyboard), player 2 = 'keys2': every game already reads both (Input.remote).
 *   - A phone is trusted by a random id. New phones are accepted only for 5 minutes after "Pair a phone" in Settings > Devices.
 * Phone -> TV: { t: 'hi', p: 1|2, cid, name } then { t: 'k', a: action, d: 1|0 }.   TV -> phone: { t: 'ok', p } | { t: 'no', why: 'busy'|'locked' }
 *   Controllers.start()  (every page, does nothing while off)   .on() .setOn(v) .code() .newCode() .pair() .forget()
 *   .players() -> { 1: name|null, 2: name|null }   .pairing() -> seconds left   .onChange(fn) */
var Controllers = (function () {
    'use strict';

    var KEY = 'arc_dev_ctrl', APP = 'controller', MAX_PHONES = 8, PAIR_MS = 300000, HELLO_MS = 4000;
    var ACTIONS = { left: 1, right: 1, up: 1, down: 1, ok: 1, run: 1, cancel: 1, menu: 1, pause: 1 };
    var ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';
    var status = { s: 'off', err: '' };
    var sess = null, slots = { 1: null, 2: null }, pairUntil = 0, listeners = [], timer = 0, started = false;

    function cfg() {
        var c = Store.rawGet(KEY);
        if (!c || typeof c !== 'object') c = {};
        return { on: c.on === true, code: typeof c.code === 'string' && /^[a-z0-9]{6,16}$/.test(c.code) ? c.code : '', ok: c.ok instanceof Array ? c.ok : [] };
    }
    function save(c) { Store.rawSet(KEY, c); }
    function makeCode() {
        var out = '', b = new Uint8Array(8), i;
        try { (window.crypto || window.msCrypto).getRandomValues(b); } catch (e) { for (i = 0; i < 8; i++) b[i] = Math.floor(Math.random() * 256); }
        for (i = 0; i < 8; i++) out += ALPHA.charAt(b[i] % ALPHA.length);
        return out;
    }
    function changed() { for (var i = 0; i < listeners.length; i++) { try { listeners[i](); } catch (e) {} } }
    function say(text) { if (typeof App !== 'undefined' && App.toast) App.toast(text); }
    function count() { return 1 + (slots[1] ? 1 : 0) + (slots[2] ? 1 : 0); }
    function report() { if (sess) sess.call('count', { room: cfg().code, n: count() }, function () {}); changed(); }

    function drop(p, slot) {
        if (slots[p] !== slot) return;
        slots[p] = null;
        Input.releaseRemote(p);
        say(I18n.t('ctrlGone').replace('%s', slot.name).replace('%n', p));
        report();
    }

    // a connection came up: wait for the phone to say who it is
    function attach(conn) {
        var slot = null, t = setTimeout(function () { if (!slot) conn.close(); }, HELLO_MS);
        conn.onMessage(function (m) {
            if (!m || typeof m !== 'object') return;
            if (!slot) {
                if (m.t !== 'hi') return;
                var p = m.p === 2 ? 2 : 1, cid = typeof m.cid === 'string' && /^[a-z0-9]{6,24}$/.test(m.cid) ? m.cid : '', c = cfg(), name;
                name = typeof m.name === 'string' ? m.name.replace(/\s+/g, ' ').slice(0, 24) : '';
                clearTimeout(t);
                if (!cid) return conn.close();
                if (c.ok.indexOf(cid) < 0) {
                    if (Date.now() > pairUntil) { conn.send({ t: 'no', why: 'locked' }); return setTimeout(function () { conn.close(); }, 300); }
                    c.ok.push(cid); if (c.ok.length > MAX_PHONES) c.ok.shift();
                    save(c);
                }
                if (slots[p] && slots[p].cid !== cid) { conn.send({ t: 'no', why: 'busy' }); return setTimeout(function () { conn.close(); }, 300); }
                if (slots[p]) { var old = slots[p]; slots[p] = null; Input.releaseRemote(p); old.conn.close(); }
                slot = { conn: conn, cid: cid, p: p, name: name || 'Phone' };
                slots[p] = slot;
                conn.send({ t: 'ok', p: p });
                say(I18n.t('ctrlOn').replace('%s', slot.name).replace('%n', p));
                report();
                return;
            }
            if (m.t === 'k' && typeof m.a === 'string' && ACTIONS.hasOwnProperty(m.a)) Input.remote(slot.p, m.a, m.d === 1);
        });
        conn.onClose(function () { clearTimeout(t); if (slot) drop(slot.p, slot); });
    }

    function onEvent(ev, d) {
        if (ev === 'closed') { stop(); status = { s: 'opening', err: '' }; changed(); schedule(2000); return; }
        if (ev !== 'request') return;
        NetLink.answer(d.offer).then(function (a) {
            sess.call('accept', { room: d.room, req: d.id, answer: a.answer }, function (err) {
                if (err) { a.cancel(); report(); return; }
                a.connected.then(attach, function () { report(); });
            });
        }, function () {});
    }

    function open() {
        var c = cfg();
        if (!c.on || sess || !NetLink.supported()) return;
        sess = new Rooms.Session(APP, 'TV', onEvent);
        status = { s: 'opening', err: '' }; changed();
        sess.call('open', { id: c.code, max: 3, name: 'TV' }, function (err) {
            if (err) { stop(); status = { s: 'error', err: err }; changed(); schedule(err === 'offline' ? 10000 : 20000); }
            else { status = { s: 'ready', err: '' }; changed(); }
        });
    }
    function stop() {
        clearTimeout(timer);
        if (sess) { var s = sess; sess = null; s.destroy(); }
    }
    function schedule(ms) { clearTimeout(timer); timer = setTimeout(open, ms); }

    function closePhones() { for (var p = 1; p <= 2; p++) if (slots[p]) { var s = slots[p]; slots[p] = null; Input.releaseRemote(p); s.conn.close(); } }

    return {
        start: function () { if (started) return; started = true; if (cfg().on) open(); },
        on: function () { return cfg().on; },
        setOn: function (v) {
            var c = cfg();
            c.on = !!v;
            if (c.on && !c.code) c.code = makeCode();
            save(c);
            if (c.on) { started = true; pairUntil = Date.now() + PAIR_MS; open(); } else { closePhones(); stop(); status = { s: 'off', err: '' }; }
            changed();
        },
        code: function () { return cfg().code; },
        status: function () { return status; },
        newCode: function () { var c = cfg(); c.code = makeCode(); c.ok = []; save(c); closePhones(); stop(); if (c.on) { pairUntil = Date.now() + PAIR_MS; open(); } changed(); },
        pair: function (sec) { pairUntil = Date.now() + (sec === undefined ? PAIR_MS : sec * 1000); changed(); },
        pairing: function () { return Math.max(0, Math.ceil((pairUntil - Date.now()) / 1000)); },
        forget: function () { var c = cfg(); c.ok = []; save(c); closePhones(); changed(); },
        phones: function () { return cfg().ok.length; },
        players: function () { return { 1: slots[1] ? slots[1].name : null, 2: slots[2] ? slots[2].name : null }; },
        onChange: function (fn) { listeners.push(fn); },
        offChange: function (fn) { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }
    };
})();
