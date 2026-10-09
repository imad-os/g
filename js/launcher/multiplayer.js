/* Multiplayer for apps and games (the shell side of MyPC.multiplayer in sdk/mypc-sdk.js).
 * My PC owns the whole flow, so every game gets the same screens and the same remote / gamepad / touch navigation:
 *   host:  "Open a room" screen -> room open -> later "<name> wants to join: Accept / Decline" over the game
 *   join:  "Join a friend" list of the open rooms of THIS app -> "Waiting for <host>..." -> connected
 * The game only receives connected peers and their messages (relayed over postMessage). Nothing else reaches it:
 * no room ids, offers, answers or Firebase. Signalling is js/core/rooms.js, the connection js/core/netlink.js.
 *   var c = Multiplayer.attach({ appId, send(type, data), hold(), release(token) });
 *   c.handle(op, args, reply)   ops: host join send closePeer closeSession; reply(errCode | null, result)
 *   c.destroy()                 the app was closed: rooms, connections and screens are removed
 * Errors: host -> cancelled offline denied unavailable; join -> cancelled denied gone timeout connect offline. */
var Multiplayer = (function () {
    'use strict';

    var panelOpen = false, askOpen = false, onCancel = null, onDecline = null, onAccept = null, shown = null;
    var seq = 0;

    function $(id) { return document.getElementById(id); }
    function t(k) { return I18n.t(k); }
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
    function toast(text) { try { App.toast(text); } catch (e) {} }
    function profileName() { return Profiles.name(null, t('player')); }
    function newId(p) { return p + (++seq).toString(36) + Math.floor(Math.random() * 1679616).toString(36); }

    /* ---------------- screens ---------------- */

    // o: { title, text, items: [{ label, sub, run }], empty, buttons: [{ label, primary, run }], cancel }
    function showPanel(o) {
        var list = $('mp-list'), btns = $('mp-buttons'), first = null, i, b;
        $('mp-title').textContent = o.title;
        $('mp-text').textContent = o.text || '';
        list.innerHTML = ''; btns.innerHTML = '';
        for (i = 0; i < (o.items || []).length; i++) {
            b = el('button', 'mp-room');
            b.setAttribute('data-focus', '');
            b.setAttribute('role', 'listitem');
            b.appendChild(el('span', 'mp-room-name', o.items[i].label));
            if (o.items[i].sub) b.appendChild(el('span', 'mp-room-sub', o.items[i].sub));
            b.setAttribute('aria-label', o.items[i].label + (o.items[i].sub ? '. ' + o.items[i].sub : ''));
            b.onclick = o.items[i].run;
            list.appendChild(b);
            if (!first) first = b;
        }
        if (!o.items || !o.items.length) { if (o.empty) list.appendChild(el('p', 'mp-empty', o.empty)); }
        for (i = 0; i < (o.buttons || []).length; i++) {
            b = el('button', 'btn' + (o.buttons[i].primary ? ' btn-primary' : ''), o.buttons[i].label);
            b.setAttribute('data-focus', '');
            b.onclick = o.buttons[i].run;
            btns.appendChild(b);
            if (!first && (o.buttons[i].primary || i === o.buttons.length - 1)) first = b;     // the list first, else the main button
        }
        onCancel = o.cancel || null;
        var wasOpen = panelOpen;
        panelOpen = true;
        $('mp').hidden = false;
        // keep the focus on the same row when the list refreshes
        var keep = o.keepIndex >= 0 && list.children[o.keepIndex] && o.items.length ? list.children[o.keepIndex] : null;
        if (!wasOpen) Focus.push($('mp'), first);
        else Focus.set($('mp'), keep || first);
        A11y.announce(o.title + (o.text ? '. ' + o.text : ''));
    }
    function hidePanel() {
        if (!panelOpen) return;
        panelOpen = false; onCancel = null;
        $('mp').hidden = true;
        Focus.pop();
    }
    function showAsk(name, accept, decline) {
        $('mp-ask-title').textContent = t('mpWants').replace('%s', name);
        onAccept = accept; onDecline = decline;
        askOpen = true;
        $('mp-ask').hidden = false;
        Focus.push($('mp-ask-box'), $('mp-ask-yes'));
        A11y.announce(t('mpWants').replace('%s', name));
    }
    function hideAsk() {
        if (!askOpen) return;
        askOpen = false; onAccept = onDecline = null;
        $('mp-ask').hidden = true;
        Focus.pop();
    }

    function screenOpen() { return panelOpen || askOpen; }
    // router hook (main.js): remote, keyboard, gamepad and mouse all arrive as actions
    function action(a, pressed, repeat) {
        if (!pressed) return;
        if (a === 'left' || a === 'right' || a === 'up' || a === 'down') return Focus.move(a);
        if (a === 'confirm' && !repeat) { var c = Focus.current(); if (c) c.click(); return; }
        if ((a === 'back' || a === 'cancel') && !repeat) {
            if (askOpen) { if (onDecline) onDecline(); }
            else if (onCancel) onCancel();
        }
    }

    function init() {
        $('mp-ask-yes').onclick = function () { var f = onAccept; hideAsk(); if (f) f(); };
        $('mp-ask-no').onclick = function () { var f = onDecline; hideAsk(); if (f) f(); };
    }

    /* ---------------- one controller per running app ---------------- */

    var CODES = { network: 'offline', offline: 'offline', denied: 'denied', full: 'denied', gone: 'gone', invalid: 'connect', unavailable: 'connect' };

    function attach(opts) {
        var rs = null, peers = {}, session = null, queue = [], asking = false, joinState = null, dead = false, held = null, polling = 0, hostBusy = false;

        function emit(ev, data) { if (!dead) opts.send('mp', { ev: ev, data: data }); }
        function holdGame() { if (held === null) held = opts.hold(); }
        function releaseGame() { if (held !== null && !screenOpen()) { var h = held; held = null; opts.release(h); } }
        function ui(f) { holdGame(); f(); }
        function closeUI() { hidePanel(); hideAsk(); releaseGame(); }
        function call(op, args, cb) { rs.call(op, args, cb); }
        function rooms() {
            if (!rs) rs = new Rooms.Session(opts.appId, profileName(), onRoomEvent);
            return rs;
        }

        /* ----- peers (the connected devices) ----- */
        function addPeer(conn, name) {
            var id = newId('p');
            peers[id] = { conn: conn, name: name };
            conn.onMessage(function (m) { emit('msg', { peer: id, msg: m }); });
            conn.onClose(function () { if (peers[id]) { delete peers[id]; emit('close', { peer: id }); } });
            return id;
        }

        /* ----- host ----- */
        function onRoomEvent(ev, d) {
            if (dead) return;
            if (ev === 'request' && session) { queue.push(d); next(); }
            else if (ev === 'closed' && session) session.open = false;
            else if (ev === 'answer' && joinState && joinState.req === d.req) joinState.answered(d.answer);
            else if (ev === 'denied' && joinState && joinState.req === d.req) joinState.fail(d.why === 'no' ? 'denied' : d.why === 'gone' ? 'gone' : 'timeout');
        }
        function next() {
            if (asking || !queue.length || dead) return;
            if (!session || !session.open || session.pending + session.count >= session.max) {      // room full or closed: say no
                while (queue.length) { var d = queue.shift(); if (session) call('decline', { room: session.room, req: d.id }, function () {}); }
                return;
            }
            var q = queue.shift(), room = session.room;
            asking = true;
            ui(function () {
                showAsk(q.name, function () { asking = false; if (session) accept(q); releaseGame(); next(); }, function () {
                    asking = false; call('decline', { room: room, req: q.id }, function () {}); releaseGame(); next();
                });
            });
        }
        function accept(q) {
            session.pending++;
            NetLink.answer(q.offer).then(function (a) {
                return new Promise(function (resolve, reject) {
                    call('accept', { room: session.room, req: q.id, answer: a.answer }, function (err) { if (err) { a.cancel(); reject(err); } else resolve(a); });
                });
            }).then(function (a) { return a.connected; }).then(function (conn) {
                session.pending--;
                if (dead || !session) return conn.close();
                var id = addPeer(conn, q.name);
                session.count++; session.peers.push(id);
                emit('peer', { session: session.id, id: id, name: q.name });
                toast(t('mpJoined').replace('%s', q.name));
                if (session.count >= session.max && session.open) { session.open = false; call('close', { room: session.room }, function () {}); }   // full: the room closes by itself
            }).catch(function () { if (session) session.pending--; });
        }
        function host(args, reply) {
            if ((session && session.open) || hostBusy) return reply('denied');       // one open room at a time
            if (!NetLink.supported()) return reply('unavailable');
            var max = Math.max(1, Math.min(7, Math.floor(+args.max || 1)));
            hostBusy = true;
            ui(function () {
                showPanel({
                    title: t('mpOpenTitle'), text: t('mpOpenText').replace('%s', profileName()).replace('%n', max),
                    buttons: [{ label: t('mpOpen'), primary: true, run: confirmHost }, { label: t('cancel'), run: cancel }], cancel: cancel
                });
            });
            function cancel() { hostBusy = false; closeUI(); reply('cancelled'); }
            function confirmHost() {
                var btn = $('mp-buttons').firstChild; if (btn) btn.disabled = true;
                call('open', { name: profileName(), max: max + 1 }, function (err, r) {
                    hostBusy = false;
                    closeUI();
                    if (dead) return;
                    if (err) { toast(t(err === 'offline' ? 'mpErr_offline' : err === 'denied' ? 'mpErr_rate' : 'mpErr_service')); return reply(err === 'offline' ? 'offline' : err === 'denied' ? 'denied' : 'unavailable'); }
                    queue = [];
                    session = { id: newId('s'), room: r.id, max: max, count: 0, pending: 0, peers: [], open: true };
                    reply(null, { session: session.id, max: max });
                });
            }
        }
        // the host's app closes its room: no more guests; connected peers stay
        function closeSession(args, reply) {
            if (session) {
                var s = session; session = null; queue = [];
                if (s.open) call('close', { room: s.room }, function () {});
                for (var i = 0; i < s.peers.length; i++) if (peers[s.peers[i]]) peers[s.peers[i]].conn.close();
            }
            reply(null, true);
        }

        /* ----- guest ----- */
        function join(args, reply) {
            if (joinState || (session && session.open)) return reply('denied');
            if (!NetLink.supported()) return reply('connect');
            var done = false, shownRooms = [];
            function finish(err, res, say) {
                if (done) return; done = true;
                clearInterval(polling); polling = 0;
                if (err && joinState && joinState.o) joinState.o.cancel();          // a connected peer keeps its connection
                joinState = null;
                closeUI();
                if (err && say) toast(say);
                reply(err, res);
            }
            function refresh() {
                call('list', {}, function (err, l) {
                    if (done || dead || joinState) return;
                    var list = err ? [] : l, idx = -1, cur = Focus.current(), items = [], i;
                    for (i = 0; i < $('mp-list').children.length; i++) if ($('mp-list').children[i] === cur) idx = i;
                    for (i = 0; i < list.length; i++) items.push({ label: list[i].name, sub: t('mpPlayers').replace('%s', list[i].count), run: (function (r) { return function () { pick(r); }; })(list[i]) });
                    shownRooms = list;
                    showPanel({ title: t('mpJoinTitle'), text: err ? t('mpErr_' + (CODES[err] || 'connect')) : t('mpJoinText'), items: items, empty: err ? '' : t('mpNoRooms'),
                                buttons: [{ label: t('cancel'), run: cancelJoin }], cancel: cancelJoin, keepIndex: idx });
                });
            }
            function cancelJoin() {
                if (joinState && joinState.req) call('cancel', { req: joinState.req }, function () {});
                finish('cancelled');
            }
            function waiting(text) {
                showPanel({ title: t('mpWaitTitle'), text: text, buttons: [{ label: t('cancel'), run: cancelJoin }], cancel: cancelJoin });
            }
            function pick(r) {
                clearInterval(polling); polling = 0;
                joinState = { req: null, o: null, fail: function (code, key) { finish(code, null, t('mpErr_' + (key || code))); }, answered: null };
                waiting(t('mpWaiting').replace('%s', r.name));
                NetLink.offer().then(function (o) {
                    if (done || dead) { o.cancel(); return; }
                    joinState.o = o;
                    call('ask', { room: r.id, name: profileName(), offer: o.offer }, function (err, res) {
                        if (done || dead) return;
                        if (err) return joinState.fail(CODES[err] || 'connect', err === 'denied' ? 'rate' : err === 'full' ? 'full' : null);
                        joinState.req = res.id;
                        joinState.answered = function (answer) {
                            waiting(t('mpConnecting'));
                            o.connect(answer).then(function (conn) {
                                if (done || dead) return conn.close();
                                var id = addPeer(conn, r.name);
                                finish(null, { peer: { id: id, name: r.name } });
                            }, function () { joinState && joinState.fail('connect'); });
                        };
                    });
                }, function () { joinState && joinState.fail('connect'); });
            }
            ui(function () { refresh(); });
            polling = setInterval(refresh, 3000);
        }

        /* ----- from the app ----- */
        function handle(op, args, reply) {
            if (dead) return reply('unavailable');
            rooms();
            switch (op) {
                case 'host': return host(args, reply);
                case 'join': return join(args, reply);
                case 'closeSession': return closeSession(args, reply);
                case 'send': { var p = peers[args.peer]; return reply(null, !!(p && p.conn.send(args.msg))); }
                case 'closePeer': { var q = peers[args.peer]; if (q) q.conn.close(); return reply(null, true); }
            }
            reply('invalid');
        }
        function destroy() {
            if (dead) return;
            dead = true;
            clearInterval(polling);
            if (rs) rs.destroy();
            for (var k in peers) peers[k].conn.close();
            peers = {};
            if (joinState && joinState.o) joinState.o.cancel();
            closeUI();
        }
        return { handle: handle, destroy: destroy };
    }

    return { attach: attach, init: init, screenOpen: screenOpen, action: action };
})();
