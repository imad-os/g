/* Runs one game at a time in a same-origin <iframe> and frees everything on exit.
 *
 * The game page (games/<id>/index.html) is fetched with XHR and written into an about:blank
 * iframe with a <base href> pointing at the game folder. The iframe document therefore has the
 * launcher's origin whether the files come from the package or from the hosted copy, so the
 * launcher can call window.GameAPI inside it and the game can reach the host object.
 *
 * Game contract (window.GameAPI in the iframe):
 *   init(host)  load assets, report host.progress(0..1), then call host.loaded() (or host.failed())
 *   start() pause() resume() destroy()
 *   menuItems() -> [{ id, label }]   optional extra pause-menu entries
 *   onMenu(id)  -> 'stay' keeps the pause menu open (toggles), anything else resumes
 *   onAction(action, pressed, repeat)  input from the launcher's single input module
 */
var GameHost = (function () {
    'use strict';

    var LOAD_TIMEOUT_MS = 20000, LOAD_MAX_MS = 15 * 60000, FILE_TIMEOUT_MS = 10000, USB_SILENT_MS = +(window.MYPC_USB_SILENT_MS || 10000);   // USB_SILENT_MS: the installed USB copy's page said nothing = online

    var state = 'idle';         // idle | loading | running | paused | error
    function setState(s) { state = s; if (typeof TouchPad !== 'undefined') TouchPad.state(s); }
    var game = null, base = '', triedBundled = false, triedUsb = false;
    var iframe = null, api = null, gameWin = null, loadTimer = 0, loadMax = 0, onExitCb = null;
    var pauseItems = [], loadSeq = 0;
    var said = { hello: 0, progress: 0, at: 0, sdk: 0, any: 0 };      // how far the app got (error reports when it does not open)

    function $(id) { return document.getElementById(id); }

    // The TV screensaver watches the remote only: someone playing with a gamepad would see it
    // kick in. It is off while a game runs and back on when paused or in the menu.
    function screenSaver(on) {
        try {
            var S = webapis.appcommon.AppCommonScreenSaverState;
            webapis.appcommon.setScreenSaver(on ? S.SCREEN_SAVER_ON : S.SCREEN_SAVER_OFF, function () {}, function () {});
        } catch (e) {}
    }

    function abs(u) { var a = document.createElement('a'); a.href = u; return a.href; }

    function title() { return game ? I18n.pick(game.manifest.title) : ''; }

    /* ---------- error reports (js/core/reports.js -> App Store Manager > Errors) ---------- */

    function appVersion() { return game ? String(game.remote ? game.remote.version || '' : (game.manifest && game.manifest.build) || '') : ''; }
    function report(r) {
        if (!game || typeof Reports === 'undefined') return;
        r.stage = r.stage || state;
        r.appv = appVersion();
        r.sdk = said.sdk;
        if (!r.url) r.url = game.remote ? game.remote.entry : base + 'games/' + game.id + '/';
        Reports.add(game.id, r);
    }
    // why an app did not open, in words the App Store Manager shows
    function loadReason(reason) {
        var secs = Math.round((Date.now() - said.at) / 100) / 10;
        if (reason !== 'timeout') return reason + ' (after ' + secs + ' s)';
        if (!game.remote) return 'timeout: the game did not report loaded in ' + secs + ' s (progress ' + Math.round(said.progress * 100) + '%)';
        if (!said.hello) return 'timeout: the SDK never answered in ' + secs + ' s (page missing or offline, a script error before MyPC.init, or MyPC.init not called)';
        return 'timeout: MyPC.ready() was not called in ' + secs + ' s (progress ' + Math.round(said.progress * 100) + '%)';
    }
    // same-origin built-in games: their own uncaught errors
    function watchFrame(win) {
        function onErr(e) { var er = e.error; report({ kind: 'error', msg: e.message || String(er), stack: er && er.stack, src: e.filename ? String(e.filename).replace(/^.*\/games\//, 'games/') + ':' + e.lineno + ':' + e.colno : '' }); }
        function onRej(e) { var er = e.reason; report({ kind: 'rejection', msg: 'Unhandled promise: ' + (er && er.message || String(er)), stack: er && er.stack }); }
        try { win.addEventListener('error', onErr); win.addEventListener('unhandledrejection', onRej); } catch (e) {}
    }

    /* ---------- phone sensors (Controllers, sensor modes): the running app's moves, metrics and raw samples ---------- */
    var sensorsOn = false, sensorsWatch = null;
    // cfg: { moves, define, profile, metrics, raw } (js/core/sensor-proto.js); fn(type, player, msg) gets 'action' 'metrics' 'raw' 'players'
    function sensorsSetup(cfg, fn) {
        if (typeof Controllers === 'undefined') return null;
        sensorsOff();
        var c = Controllers.sensorSetup(cfg && typeof cfg === 'object' ? cfg : {}, function (p, msg) { fn(msg.type, p, msg); });
        if (!c) return null;
        sensorsOn = true;
        sensorsWatch = function () { fn('players', 0, Controllers.modes()); };
        Controllers.onChange(sensorsWatch);
        return c;
    }
    function sensorsOff() {
        if (!sensorsOn) return;
        sensorsOn = false;
        if (sensorsWatch) { Controllers.offChange(sensorsWatch); sensorsWatch = null; }
        Controllers.sensorSetup(null);
    }

    /* ---------- host object given to the game ---------- */

    function makeHost() {
        var id = game.id;
        return {
            id: id,
            lang: I18n.lang(),
            profile: { id: Profiles.current().id, name: Profiles.name(null, I18n.t('player')) },
            rtl: I18n.rtl(),
            quality: Perf.profile(),
            volume: { music: AudioPrefs.music() / 10, sfx: AudioPrefs.sfx() / 10 },
            input: { isDown: Input.isDown, isDownDev: Input.isDownDev, poll: Input.poll, device: Input.device, lastDevice: Input.lastDevice },
            forwardKey: function (e, down) { Input.onKey(e, down); },
            announce: function (text) { A11y.announce(text); },
            save: function (k, v) { return Store.set('game_' + id + '_' + k, v); },
            load: function (k, def) { return Store.get('game_' + id + '_' + k, def); },
            progress: function (p) { said.progress = +p || 0; setProgress(p); if (state === 'loading') kickLoad(); },
            loaded: onLoaded,
            failed: function (msg) { fail(msg || 'game reported failure'); },
            pause: function () { openPause(); },
            exitToMenu: function () { setTimeout(exit, 0); },
            // Top-10 tables: the game reports a final score; the launcher asks for initials if it qualifies.
            submitScore: function (score, opts) { submitScore(id, score, opts || {}); },
            topScores: function () { return Scores.list(id); },
            // phones in a sensor mode: host.sensors.setup({ moves: ['LEFT', 'JUMP'], metrics: { hz: 1 } }, function (type, player, msg) {})
            sensors: { setup: sensorsSetup, stop: sensorsOff, players: function () { return typeof Controllers !== 'undefined' ? Controllers.modes() : { 1: null, 2: null }; } }
        };
    }

    // Called by games/shared/gamekit.js once the game scripts have run.
    window.ArcadeHost = {
        attach: function (win) {
            if (state !== 'loading' || !iframe || win !== iframe.contentWindow) return;
            gameWin = win;
            api = win.GameAPI;
            if (!api || typeof api.init !== 'function') return fail('no GameAPI');
            try { api.init(makeHost()); } catch (e) { fail('init: ' + e); }
        },
        isLoading: function () { return state === 'loading'; }
    };

    /* ---------- loading ---------- */

    function setProgress(p) {
        var pct = Math.round(Math.max(0, Math.min(1, p)) * 100);
        $('game-loading-fill').style.width = pct + '%';
        $('game-loading-bar').setAttribute('aria-valuenow', String(pct));
    }

    // the app's icon on the start screen (a game's cover or an installed app's icon); freed once it is open
    function showIcon() {
        var box = $('game-loading-icon');
        box.innerHTML = '';
        if (game.icon) {
            var img = document.createElement('img');
            img.alt = '';
            img.onerror = function () { box.innerHTML = Icons.svg('game'); };
            img.src = game.icon;
            box.appendChild(img);
        } else box.innerHTML = Icons.svg('game');
    }
    function hideLoading() {
        $('game-loading').hidden = true;
        $('game-loading-icon').innerHTML = '';
    }

    // the start screen's info row: version, "Updated" (from which), size when known, where it opens from. Only what is known.
    function showInfo() {
        var box = $('game-loading-info');
        if (!box || !game) return;
        var t = I18n.t, chips = [], r = game.remote, v = '';
        if (r) v = String(r.usb ? r.usb.v || r.version || '' : r.version || '');
        else if (game.manifest) v = String(game.manifest.version || '');
        if (v) chips.push({ text: t('glVersion').replace('%v', v) });
        if (r && r.prev && v && r.prev !== v) chips.push({ text: t('glUpdated').replace('%v', r.prev), cls: 'gl-chip-new' });
        var bytes = r ? (r.usb && r.usb.bytes) || r.bytes || 0 : 0;
        if (bytes > 0) chips.push({ text: bytes >= 1048576 ? (Math.round(bytes / 104857.6) / 10) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB' });
        if (r && r.later) chips.push({ text: t('glAvailable').replace('%v', r.later), cls: 'gl-chip-new' });
        if (!r || r.usb || r.run || !r.prepare) chips.push(r ? (r.usb ? (r.usb.chosen ? { text: t('glInstalled').replace('%d', r.usb.drive || 'USB'), cls: 'gl-chip-run' } : { text: t('glUsb').replace('%d', r.usb.drive || 'USB'), cls: 'gl-chip-warn' }) : { text: t(r.run === 'usb' ? 'glOnlineNow' : 'glOnline'), cls: 'gl-chip-run' }) : { text: t('glBuiltIn') });
        box.innerHTML = '';
        for (var i = 0; i < chips.length; i++) {
            var c = document.createElement('span');
            c.className = 'gl-chip' + (chips[i].cls ? ' ' + chips[i].cls : '');
            c.textContent = chips[i].text;
            box.appendChild(c);
        }
    }

    // the start screen's status line + bar while My PC installs an app's update (main.js); ok = the green "Installed" look
    function loadingStatus(text, p, ok) {
        var s = document.querySelector('#game-loading .gl-status span:last-child'), box = document.querySelector('#game-loading .gl-status');
        if (s) { s.removeAttribute('data-i18n'); s.textContent = text; }
        if (box) box.className = 'gl-status' + (ok ? ' gl-ok' : '');
        if (p !== undefined) setProgress(p);
        if (state === 'loading') kickLoad();
    }
    function resetStatus() {
        var s = document.querySelector('#game-loading .gl-status span:last-child'), box = document.querySelector('#game-loading .gl-status');
        if (s) { s.setAttribute('data-i18n', 'loadingStatus'); s.textContent = I18n.t('loadingStatus'); }
        if (box) box.className = 'gl-status';
    }

    function showLoading() {
        resetStatus();
        showInfo();
        $('game-loading-title').textContent = title();
        setProgress(0);
        showIcon();
        $('game-loading').hidden = false;
        $('game-error').hidden = true;
        $('pause').hidden = true;
    }

    /* ---------- installed apps (My PC SDK, sandboxed iframe on their own origin) ---------- */

    var SAVE_QUOTA = 64 * 1024;     // saved data per installed app

    function originOf(u) { var a = document.createElement('a'); a.href = u; return a.protocol + '//' + a.host; }

    // GameAPI-shaped proxy that talks to the app's My PC SDK with postMessage
    function remoteApi() {
        // the copy saved on a USB drive (js/core/app-usb.js) is a file:// page with no origin of its own: '*' and 'null' / 'file://'
        var usb = game.remote.usb || null, origin = originOf(usb ? usb.uri : game.remote.entry), to = usb ? '*' : origin;
        var id = game.id, items = [], win = null, mp = null;
        function send(type, d, transfer) {
            if (!win) return;
            try { win.postMessage({ mypc: 1, type: type, data: d === undefined ? null : d }, to, transfer && transfer.length ? transfer : undefined); }
            catch (e) { if (transfer && transfer.length) { try { win.postMessage({ mypc: 1, type: type, data: d === undefined ? null : d }, to); } catch (e2) {} } }
        }
        function mine(e) { return e.origin === origin || (!!usb && (e.origin === 'null' || e.origin === 'file://')); }
        // MyPC.net / MyPC.ai / MyPC.mic (js/launcher/bridges.js): web requests, AI services and the microphone, done by My PC
        var storeId = id.replace(/^app-/, '');
        var pushCtx = { appId: storeId, title: title(), hold: hold, release: release };
        var br = Bridges.attach({ appId: id, title: title(), config: game.remote.config || {}, send: send, hold: hold, release: release, state: function () { return state; } });
        // MyPC.video (API 17): the TV's own player (AVPlay) behind the app's transparent page (js/launcher/app-video.js)
        var vid = AppVideo.attach({ appId: id, title: title(), send: send, frame: function () { return iframe; }, state: function () { return state; } });
        // MyPC.text.keyboard (API 17): My PC's on-screen keyboard over the app, for typing with the remote alone
        var kbRid = 0;
        function keyboard(d) {
            if (typeof Keyboard === 'undefined' || Keyboard.isOpen() || state !== 'running') { send('kb', { rid: d.rid, error: { code: 'busy', message: 'The keyboard cannot open now.' } }); return; }
            var kinds = { password: 'password', url: 'url', email: 'code', number: 'code', user: 'user', name: 'name' };
            var paused = hold(), rid = d.rid;
            kbRid = rid;
            function done(v) { if (kbRid !== rid) return; kbRid = 0; release(paused); send('kb', { rid: rid, result: v }); }
            Keyboard.open({ title: String(d.label || '').slice(0, 60), text: String(d.value || '').slice(0, 500), max: Math.max(1, Math.min(500, +d.max || 200)),
                            mode: kinds[d.kind] || 'title', placeholder: String(d.placeholder || '').slice(0, 60), ok: d.ok ? String(d.ok).slice(0, 20) : undefined },
                          function (v) { done(String(v)); }, function () { done(null); });
        }
        function bleAllowed() { return id === 'hr-monitor' || !!(game.remote.config && game.remote.config.heartRate === true); }
        // heart-rate sensors over Bluetooth LE (js/core/hr-ble.js), only for apps allowed to use them (bleAllowed)
        var ble = HrBle.create(function (kind, m) { send('ble-event', m); });
        // MyPC.gamepad: every button and axis of every controller, unmapped (only while the app runs, not under My PC's menus)
        var padsSent = '';
        function rawPad(kind, dev, i, pressed, v) {
            if (kind === 'lost') { send('gp', { e: 'lost', d: dev }); return; }
            if (state !== 'running') return;
            if (kind === 'b') send('gp', { e: 'b', d: dev, i: i, p: pressed, v: Math.round(v * 1000) / 1000 });
            else send('gp', { e: 'a', d: dev, a: Array.prototype.slice.call(i) });
        }
        // the mapper's / swap's order for this pad (null = as the browser gives it): the SDK applies it to navigator.getGamepads()
        function padMapArr(p) { var m = p.index < 100 ? Input.padMap(p.index) : null; return m ? Array.prototype.slice.call(m, 0, Math.max(18, p.buttons || 0)) : null; }
        function sendPrefs() { send('gp', { e: 'direct', on: directOk(id) ? 1 : 0 }); }
        function padsChanged() {
            var list = Input.pads(), out = [], k;
            for (k = 0; k < list.length; k++) out.push({ d: 'pad' + list[k].index, name: list[k].name, standard: list[k].standard, buttons: list[k].buttons, axes: list[k].axes,
                                                     brand: list[k].brand, model: list[k].model, layout: list[k].layout, vendor: list[k].vendor, product: list[k].product,
                                                     i: list[k].index, map: padMapArr(list[k]) });
            var j = JSON.stringify(out);
            if (j !== padsSent) { padsSent = j; send('gp', { e: 'pads', list: out }); }
        }

        // the app's focused text field (the SDK tells): a phone in Text mode types into it (js/launcher/textin.js)
        function textSend(v, go) { if (state === 'running') send('text', { v: v, go: go ? 1 : 0 }); }

        function onMsg(e) {
            if (!iframe || e.source !== iframe.contentWindow) return;     // only our app's frame
            var m = e.data, d;
            if (!m || m.mypc !== 1 || typeof m.type !== 'string') return;
            d = m.data || {};
            if (!said.any) said.any = Date.now();                           // the page runs (the USB copy check below)
            // the USB copy's own files for its fetch() (the SDK asks, API 23); the answer goes straight back to that frame
            if (m.type === 'usbfile') {
                if (usb && typeof d.rid === 'number' && typeof AppUsb !== 'undefined') {
                    var src = e.source, rid = d.rid;
                    AppUsb.readFile(usb, String(d.p || ''), function (er, buf) {
                        try { if (er) src.postMessage({ mypc: 1, type: 'usbfile', data: { rid: rid, error: er.code } }, '*'); else src.postMessage({ mypc: 1, type: 'usbfile', data: { rid: rid, b: buf } }, '*', [buf]); } catch (x) {}
                    });
                }
                return;
            }
            if (mine(e) && br.handle(m.type, d)) return;
            if (m.type === 'video') { if (mine(e) && typeof d.rid === 'number') vid.handle(d); return; }
            if (m.type === 'kb') { if (mine(e) && typeof d.rid === 'number') keyboard(d); return; }
            if (m.type === 'back') { remote.ownBack = !!d.on; remote.backSaid = true; return; }
            if (m.type === 'unhandled') { if (d.action === 'cancel') backUnhandled(); return; }
            switch (m.type) {
                case 'hello':
                    win = e.source;
                    said.hello = Date.now(); said.sdk = +d.sdkApi || +d.sdk || 0; if (state === 'loading') kickLoad();
                    remote.ownMenu = !!d.ownMenu;          // the app has its own menu on gamepad Start
                    // MyPC.init({ keys: ['channel', 'media'] }) (API 17): CH + / CH - (and L / R) and the remote's media keys go to the app
                    remote.keys = { channel: !!(d.keys && d.keys.indexOf && d.keys.indexOf('channel') >= 0), media: !!(d.keys && d.keys.indexOf && d.keys.indexOf('media') >= 0), buttons: !!(d.keys && d.keys.indexOf && d.keys.indexOf('buttons') >= 0) };
                    // MyPC.init({ keys: ['buttons'] }) (API 19): every remote button by name, the app maps them itself
                    if (remote.keys.buttons) Input.registerExtraKeys();
                    // MyPC.init({ uses: ['photos', 'videos', 'music'] }) (API 26): the built-in apps it opens files in, got ready now (js/launcher/app-open.js)
                    if (typeof AppOpen !== 'undefined') AppOpen.hello(id, d.uses);
                    if (typeof TouchPad !== 'undefined') { TouchPad.app(d.pad); TouchPad.relay(function (m) { send('pad', m); }); }      // MyPC.init({ pad }); presses of the app's own pad go back to it
                    send('init', {
                        lang: I18n.lang(), rtl: I18n.rtl(), quality: { tier: Perf.profile().tier },
                        volume: { music: AudioPrefs.music() / 10, sfx: AudioPrefs.sfx() / 10 },
                        profile: { id: Profiles.current().id, name: Profiles.name(null, I18n.t('player')) },
                        data: Store.get('game_' + id + '_data', {}), app: { id: id },
                        config: game.remote.config || {},
                        mp: typeof Multiplayer !== 'undefined' && typeof Rooms !== 'undefined' && NetLink.supported() ? 1 : 0,   // MyPC.multiplayer is supported
                        bridges: { net: 1, ai: 1, mic: Mic.supported() || Mic.phone() ? 1 : 0, drive: 1, usb: UsbFs.supported() ? 1 : 0, copy: UsbFs.supported() ? 1 : 0, video: AppVideo.supported() ? 1 : 0, keyboard: 1, back: 1, stt: typeof Stt !== 'undefined' ? 1 : 0, open: typeof AppOpen !== 'undefined' ? 1 : 0 },     // MyPC.net / ai / mic (API 10), MyPC.drive (API 14), MyPC.usb / copy (API 16, TV only) go through My PC
                        notify: 1, launch: Push.takeLaunch(id),       // MyPC.notify, MyPC.launch: push notifications (API 12, js/launcher/push.js)
                        usb: usb ? { v: usb.v, at: usb.at } : null,   // MyPC.offline (API 23): this is the copy saved on a USB drive
                        stt: br.sttStatus()                           // MyPC.stt (API 24): speech to text on / ready
                    });
                    padsSent = ''; sendPrefs(); padsChanged();
                    Input.onPadRaw(rawPad); Input.offDevices(padsChanged); Input.onDevices(padsChanged);
                    break;
                case 'ble':
                    // MyPC.bluetooth: the HR Monitor app, or an app the App Store Manager allowed ("heartRate": true in its config)
                    if (typeof d.requestId !== 'number') break;
                    if (!mine(e) || !bleAllowed()) { ble.reject(d.requestId, 'Bluetooth is not allowed for this app.'); break; }
                    if (state !== 'running' && /^(scan|connect|reconnect-last|start-test)$/.test(d.action)) { ble.reject(d.requestId, 'The app is not running. Resume it first.'); break; }
                    ble.handle(String(d.action), d.requestId, { deviceId: d.deviceId, seconds: d.seconds });
                    break;
                case 'mp': {
                    // multiplayer (js/launcher/multiplayer.js): { rid, op, args } -> { rid, error | result }; peers' events go back as { ev, data }
                    if (typeof Multiplayer === 'undefined' || typeof d.op !== 'string' || (d.rid !== undefined && typeof d.rid !== 'number')) break;
                    if (state !== 'running' && state !== 'paused') break;
                    if (!mp) mp = Multiplayer.attach({ appId: id, send: send, hold: hold, release: release });
                    mp.handle(d.op, d.args && typeof d.args === 'object' ? d.args : {}, function (err, res) {
                        if (d.rid !== undefined) send('mp', { rid: d.rid, error: err || undefined, result: res === undefined ? null : res });
                    });
                    break;
                }
                case 'sensors':                                                // MyPC.sensors: { op: 'setup', cfg } | { op: 'stop' }
                    if (d.op === 'stop') { sensorsOff(); break; }
                    if (d.op !== 'setup' || (state !== 'running' && state !== 'paused' && state !== 'loading')) break;
                    var sc = sensorsSetup(d.cfg, function (type, p, msg) { send('sensors', { ev: type, player: p, data: msg }); });
                    send('sensors', { ev: 'config', data: sc, players: typeof Controllers !== 'undefined' ? Controllers.modes() : null });
                    break;
                case 'pad':                                                    // the app wants a pad of its own (MyPC.pad.init({ force: true, ... })): the shell draws it
                    if (typeof TouchPad === 'undefined') break;
                    if (d.settings) TouchPad.settings(); else TouchPad.own(!!d.own, d.cfg);
                    break;
                case 'progress': if (state === 'loading') { said.progress = +d.p || 0; setProgress(+d.p || 0); kickLoad(); } break;
                case 'ready':
                    onLoaded();
                    // an app with a push notification service: asks the player once (an account only), a moment after it starts
                    if (game.remote.services && Push.state(storeId) === 'default') setTimeout(function () { if (win && state === 'running') Push.ask(pushCtx, function () {}); }, 1500);
                    break;
                case 'notify':
                    // MyPC.notify.request() / status(): { rid, op } -> { rid, result: 'granted' | 'denied' | 'default' | 'no-account' }
                    if (!mine(e) || typeof d.rid !== 'number') break;
                    if (d.op === 'request') Push.ask(pushCtx, function (s) { send('notify', { rid: d.rid, result: s }); });
                    else send('notify', { rid: d.rid, result: Push.state(storeId) });
                    break;
                case 'field':                                                  // { on, id, kind, label, v, max } (API 13)
                    if (!mine(e) || typeof TextIn === 'undefined') break;
                    TextIn.app(d.on ? d : null, textSend);
                    break;
                case 'failed': fail('app: ' + d.reason); break;
                case 'err':                                                    // MyPC.report and the app's uncaught errors (sent by the SDK, even before MyPC.init)
                    if (!mine(e)) break;
                    if (!said.sdk && +d.sdk) said.sdk = +d.sdk;
                    report({ kind: String(d.kind || 'error'), msg: String(d.msg || ''), stack: String(d.stack || ''), src: String(d.src || ''), n: +d.n || 1 });
                    break;
                case 'bug':                                                    // MyPC.bug(note, data, image): what the player saw, for the app's developer (js/core/bugs.js)
                    if (!mine(e) || typeof d.rid !== 'number' || typeof Bugs === 'undefined') break;
                    Bugs.send(game.id, { note: d.note, data: d.data, img: d.img, appv: appVersion() }, function (err, bid) { send('bug', { rid: d.rid, error: err || undefined, result: bid || null }); });
                    break;
                case 'menu':
                    items = [];
                    for (var i = 0; d.items && i < d.items.length && i < 6; i++) {
                        var it = d.items[i];
                        if (it && /^[a-z0-9_-]{1,24}$/i.test(it.id) && typeof it.label === 'string') items.push({ id: 'app:' + it.id, label: it.label.slice(0, 40) });
                    }
                    break;
                case 'save': {
                    var all = Store.get('game_' + id + '_data', {});
                    all[String(d.key)] = d.value;
                    if (JSON.stringify(all).length <= SAVE_QUOTA) Store.set('game_' + id + '_data', all);
                    break;
                }
                case 'score': if (state === 'running' || state === 'paused') submitScore(id, d.score, { player: d.player, players: d.players }); break;
                case 'announce': A11y.announce(String(d.text || '').slice(0, 200)); break;
                case 'pause': if (state === 'running') openPause(); break;
                case 'exit': setTimeout(exit, 0); break;
                // keys pressed while the frame has focus (mouse click on a PC): routed like our own
                case 'key': Input.onKey({ keyCode: +d.keyCode, repeat: !!d.repeat, preventDefault: function () {} }, !!d.down); break;
            }
        }
        window.addEventListener('message', onMsg);
        var volume = function (m, s2) { send('volume', { music: m, sfx: s2 }); };
        AudioPrefs.onChange(volume);
        var remote = {
            ownMenu: false,
            sdk: true,               // an installed app (SDK): with "every button to the app" the remote's Back is its 'cancel'
            ownBack: false,          // MyPC.back(true): the remote's Back goes to the app as 'cancel' (it has a screen to close)
            backSaid: false,         // the app has called MyPC.back(): ownBack false then means "nothing to close" (My PC's menu at once)
            keys: { channel: false, media: false },
            video: function () { return vid.active(); },
            init: function () {},
            start: function () { send('start'); },
            pause: function () { br.pause(); vid.pause(); send('pause'); },
            resume: function () { send('resume'); vid.resume(); },
            // a push notification's deep link for this app while it runs (MyPC.init({ onLaunch }))
            launch: function (d) { send('launch', d); },
            destroy: function () { pushCtx.dead = true; br.destroy(); vid.destroy(); if (kbRid) { kbRid = 0; if (Keyboard.isOpen()) Keyboard.close(); } if (typeof TextIn !== 'undefined') TextIn.app(null, textSend); Input.onPadRaw(null); Input.offDevices(padsChanged); ble.destroy(); if (mp) { mp.destroy(); mp = null; } send('destroy'); window.removeEventListener('message', onMsg); AudioPrefs.offChange(volume); win = null; },
            menuItems: function () { return items; },
            onMenu: function (mid) { send('menu', { id: String(mid).slice(4) }); },
            onAction: function (a, pressed, repeat, dev) { send('input', { action: a, pressed: pressed, repeat: repeat, dev: dev }); },
            sttButton: function () { return br.sttButton(); },          // MyPC.stt (API 24): the phone's microphone button
            prefs: function () { sendPrefs(); },
            button: function (n, down, repeat) { send('btn', { n: n, d: down ? 1 : 0, r: repeat ? 1 : 0, l: Input.buttonLabel(n) }); }
        };
        return remote;
    }

    function loadRemote(token) {
        // optional: the launcher refreshes the app's document first (its config) behind the loading screen
        if (game.remote.prepare && !game.remote.usb && !game.remote.noUsb) {
            return game.remote.prepare(function (ok) {
                if (state !== 'loading' || token !== loadSeq) return;       // cancelled or superseded
                if (ok === false) return exit();                            // uninstalled meanwhile
                showInfo();                                                 // the version read just now (store / the app's site)
                kickLoad();
                openRemote();
            });
        }
        openRemote();
    }

    function openRemote() {
        removeFrame();
        iframe = document.createElement('iframe');
        iframe.setAttribute('tabindex', '-1');
        iframe.setAttribute('title', title());
        iframe.setAttribute('aria-hidden', 'true');
        iframe.setAttribute('scrolling', 'no');
        // its own origin: it cannot touch My PC's page, storage or navigation. The USB copy is a file:// page: on the TV every file://
        // page could share My PC's own storage, so it gets no origin at all (the SDK serves its fetch() and a memory localStorage)
        var usb = game.remote.usb;
        iframe.setAttribute('sandbox', usb ? 'allow-scripts allow-pointer-lock' : 'allow-scripts allow-same-origin allow-pointer-lock');
        iframe.setAttribute('allow', directOk(game.id) ? 'autoplay; gamepad; fullscreen' : 'autoplay; fullscreen');     // App settings > Read the controllers directly: no = the browser hides them too
        iframe.setAttribute('referrerpolicy', 'no-referrer');
        api = remoteApi();
        // the version in the address: a new version published in the App Store never opens from the TV's cache
        var v = game.remote.version, e = String(game.remote.entry).split('#');
        if (usb) {
            // the TV runs no file:// page in a frame (imad's TV, build 194 / 195): My PC reads the copy's files and builds its page (srcdoc)
            var tb = loadSeq, gb = game, fr = iframe;
            if (typeof UsbPage !== 'undefined') UsbPage.build(usb, function (e, html, st) {
                if (tb !== loadSeq || game !== gb || iframe !== fr || state !== 'loading') return;
                if (e) return fail('usb: ' + (e.message || e.code));
                usb.page = st;
                fr.srcdoc = html;
                if (usb.chosen) armSilent();
            });
            else iframe.src = usb.uri + '?mypc_usb=' + (usb.depth + 1);
            if (typeof Notify !== 'undefined' && !usb.chosen) Notify.show({ id: 'appusb', kind: 'warn', text: I18n.t('auOpened').replace('%s', title()).replace('%d', usb.drive).replace('%v', usb.v) });
            // the installed copy says nothing at all within USB_SILENT_MS (its page or My PC's SDK in it never ran: imad's TV, build 194,
            // Tangier TAXI stayed on "Getting things ready" and then failed): the online version opens instead, right away
            if (usb.chosen && typeof UsbPage === 'undefined') armSilent();
        } else iframe.src = v ? e[0] + (e[0].indexOf('?') < 0 ? '?' : '&') + 'mypc_v=' + encodeURIComponent(v) + (e[1] !== undefined ? '#' + e[1] : '') : e.join('#');
        $('game-frame-box').appendChild(iframe);
        $('game-layer').focus();
        // the online page says nothing after 6 s: when the app's own site does not answer either and a copy is saved on a USB
        // drive, that copy opens now instead of after the 20 s timeout
        if (!usb && typeof AppUsb !== 'undefined') {
            var tk = loadSeq, g0 = game;
            setTimeout(function () {
                if (tk !== loadSeq || game !== g0 || state !== 'loading' || said.hello || triedUsb) return;
                AppUsb.pick({ id: game.id.replace(/^app-/, ''), entry: game.remote.entry }, function (copy) {
                    if (!copy || tk !== loadSeq || game !== g0 || state !== 'loading' || said.hello || triedUsb) return;
                    triedUsb = true;
                    report({ kind: 'load', msg: 'no answer from the app\'s site in ' + Math.round((Date.now() - said.at) / 1000) + ' s: opening the copy saved on USB ' + copy.v, stage: 'loading' });
                    clearTimeout(loadTimer); clearTimeout(loadMax);
                    teardown();
                    game.remote.usb = copy;
                    load();
                });
            }, 6000);
        }
    }

    function kickLoad() {
        clearTimeout(loadTimer);
        loadTimer = setTimeout(function () { fail('timeout'); }, LOAD_TIMEOUT_MS);
    }
    // a question on the start screen (Update available): no limit while the person decides; the next progress starts it again
    function loadingWait() { clearTimeout(loadTimer); }
    function armSilent() {
        var tu = loadSeq, gu = game;
        setTimeout(function () {
            if (tu !== loadSeq || game !== gu || state !== 'loading' || said.any || said.hello) return;
            usbToOnline('silent');
        }, USB_SILENT_MS);
    }

    function load() {
        setState('loading');
        showLoading();
        A11y.announce(I18n.t('loading') + ' ' + title());
        var dir = abs(base + 'games/' + game.id + '/');
        var entry = game.manifest.entry || 'index.html';
        var build = game.manifest.build || 0;
        // two limits (owner 2026-11-28: "it was progressing, then it said timeout"): LOAD_TIMEOUT_MS with NO progress at all (every
        // progress of the app, of an install or of the start screen starts it again: kickLoad), and LOAD_MAX_MS for the whole start
        kickLoad();
        clearTimeout(loadMax);
        loadMax = setTimeout(function () { if (state === 'loading') fail('timeout: over ' + Math.round(LOAD_MAX_MS / 60000) + ' min in all'); }, LOAD_MAX_MS);
        said = { hello: 0, progress: 0, at: Date.now(), sdk: 0, any: 0 };
        var token = ++loadSeq;
        $('game-frame-box').classList.toggle('wide', wideOnly());
        if (game.remote) return loadRemote(token);

        AppBoot.get(dir + entry + '?b=' + build, FILE_TIMEOUT_MS, function (err, html) {
            if (state !== 'loading' || token !== loadSeq) return;   // cancelled or superseded
            if (err || !html) return fail(entry + ' ' + err);
            html = html.replace(/<head([^>]*)>/i, '<head$1><base href="' + dir + '">');
            // cache-bust the game's own scripts with its build number
            html = html.replace(/(<script[^>]+src="[^"?]+\.js)"/gi, '$1?b=' + build + '"');
            removeFrame();
            iframe = document.createElement('iframe');
            iframe.setAttribute('tabindex', '-1');
            iframe.setAttribute('title', title());
            iframe.setAttribute('aria-hidden', 'true');     // canvas + HUD; status goes through the live region
            iframe.setAttribute('scrolling', 'no');
            $('game-frame-box').appendChild(iframe);
            try {
                var doc = iframe.contentWindow.document;
                doc.open();
                watchFrame(iframe.contentWindow);       // after open(): it clears the window's listeners
                doc.write(html);
                doc.close();
            } catch (e) { fail('write: ' + e); }
            $('game-layer').focus();
        });
    }

    function onLoaded() {
        if (state !== 'loading') return;
        clearTimeout(loadTimer); clearTimeout(loadMax);
        hideLoading();
        setState('running');
        Input.setExternalPoll(!game.remote);    // an installed app cannot poll: the launcher reads the pads
        AudioPrefs.prepareChime();
        screenSaver(false);     // the game polls gamepads at the start of each frame
        screenSaver(false);
        $('game-layer').setAttribute('aria-label', title());
        $('game-layer').focus();
        try { api.start(); } catch (e) { report({ kind: 'start', msg: 'start() threw: ' + (e && e.message || e), stack: e && e.stack, stage: 'loading' }); fail('start: ' + e); }
    }

    function fail(reason) {
        if (state !== 'loading') {
            try { console.warn('[GameHost] ' + reason); } catch (e) {}
            if (/^app: /.test(reason) && game) report({ kind: 'failed', msg: reason.slice(5) || 'MyPC.fail()' });
            return;
        }
        try { console.warn('[GameHost] ' + game.id + ' failed: ' + reason); } catch (e) {}
        var fallback = !triedBundled && game.bundledBase && game.bundledBase !== base;
        // an installed app whose page never answered: its copy saved on a USB drive, only if its own site does not answer now either
        // the installed USB copy did not open: the online version, once (owner 2026-11-28)
        if (game.remote && game.remote.usb && game.remote.usb.chosen && !game.remote.noUsb && !/^app: /.test(reason)) return usbToOnline(reason);
        var tryUsb = game.remote && !game.remote.usb && !triedUsb && !said.hello && typeof AppUsb !== 'undefined' && /^timeout/.test(reason);
        if (!/^start: /.test(reason)) report({ kind: /^app: /.test(reason) ? 'failed' : 'load', msg: loadReason(reason) + (fallback ? ' [hosted copy; trying the built-in one]' : '') + (game.remote && game.remote.usb ? ' [copy saved on USB ' + game.remote.usb.v + ']' : ''), stage: 'loading' });
        clearTimeout(loadTimer); clearTimeout(loadMax);
        teardown();
        if (tryUsb) {
            triedUsb = true;
            var token = loadSeq, g0 = game;
            return AppUsb.pick({ id: game.id.replace(/^app-/, ''), entry: game.remote.entry }, function (copy) {
                if (game !== g0 || token !== loadSeq || state !== 'loading') return;
                if (copy) { game.remote.usb = copy; return load(); }
                showError();
            });
        }
        // A hosted game that fails falls back to the bundled copy of the same game, if any.
        if (fallback) {
            triedBundled = true;
            base = game.bundledBase;
            game.manifest = game.bundledManifest || game.manifest;
            return load();
        }
        showError();
    }
    // the installed copy on the USB drive did not start: noted for this version (AppUsb.setFailed: the next opens go online until a
    // newer version is installed or the person picks "Opens from: USB" again), reported, and the online version opens now
    function usbToOnline(why) {
        var copy = game.remote.usb, id = game.id.replace(/^app-/, '');
        var msg = 'the copy installed on USB ' + (copy.drive || '') + ' (' + copy.v + ') did not start (' + (why === 'silent' ? 'no word from its page in ' + Math.round(USB_SILENT_MS / 1000) + ' s' : loadReason(why)) + ', SDK ' + (said.any ? 'ran' : 'silent') + (copy.page ? ', page built from ' + copy.page.files + ' files ' + Math.round(copy.page.bytes / 1024) + ' KB, SDK of ' + copy.page.sdk : '') + ', ' + copy.uri + '): opening online';
        try { console.warn('[GameHost] ' + msg); } catch (e) {}
        report({ kind: 'load', msg: msg, stage: 'loading' });
        if (typeof AppUsb !== 'undefined' && AppUsb.setFailed) AppUsb.setFailed(id, copy.v, said.any ? 'app' : 'silent');
        if (typeof Notify !== 'undefined') Notify.show({ id: 'appusb', kind: 'warn', text: I18n.t('auUsbFailed').replace('%s', title()).replace('%d', copy.drive || 'USB') });
        clearTimeout(loadTimer); clearTimeout(loadMax);
        teardown();
        triedUsb = true;
        game.remote.usb = null;
        game.remote.noUsb = true;
        game.remote.run = 'online';
        if (game.remote.later) game.remote.version = game.remote.later;     // "Later" kept the installed one: online = the newest
        load();
    }
    function showError() {
        setState('error');
        hideLoading();
        $('game-error').hidden = false;
        A11y.announce(I18n.t('loadError'));
        Focus.push($('game-error'), $('game-error-retry'));
    }

    /* ---------- pause menu ---------- */

    var pauseSub = null;            // 'app': the App settings page of the menu
    function onOff(v) { return I18n.t(v ? 'on' : 'off'); }
    function appSetItems() {
        var id = game.id, it = [];
        it.push({ id: '_s_bg', label: I18n.t('asBg') + ': ' + onOff(runsInBackground()), desc: I18n.t('asBgDesc') });
        if (game.remote) {
            it.push({ id: '_s_direct', label: I18n.t('asDirect') + ': ' + I18n.t(directOk(id) ? 'asAllowed' : 'asBlocked'), desc: I18n.t('asDirectDesc') });
            it.push({ id: '_s_keys', label: I18n.t('allKeys') + ': ' + onOff(allKeys()), desc: I18n.t('allKeysDesc') });
        }
        it.push({ id: '_s_quiet', label: I18n.t('asNotif') + ': ' + I18n.t(pref(id, 'quiet') ? 'asHidden' : 'asShown'), desc: I18n.t('asNotifDesc') });
        if (game.remote && typeof AppUsb !== 'undefined' && AppUsb.supported()) it.push({ id: '_s_run', label: I18n.t('asRun') + ': ' + I18n.t(runMode(id) === 'online' ? 'asRunOnline' : 'asRunUsb'), desc: I18n.t('asRunDesc') });
        if (prefs()[id]) it.push({ id: '_s_reset', label: I18n.t('asReset') });
        it.push({ id: '_s_back', label: I18n.t('back') });
        return it;
    }
    function renderPause(focusId) {
        var box = $('pause-items');
        box.innerHTML = '';
        $('pause-title').textContent = I18n.t(pauseSub ? 'asTitle' : 'paused');
        var bgOn = runsInBackground(), tag = $('pause-bg');
        tag.className = 'pause-bg' + (bgOn ? ' on' : '');
        tag.textContent = I18n.t(bgOn ? 'bgOn' : 'bgOff');
        if (pauseSub === 'app') {
            pauseItems = appSetItems();
            var who = document.createElement('p');
            who.className = 'pause-desc';
            who.textContent = I18n.t('asFor').replace('%a', title()).replace('%u', Profiles.name(null, I18n.t('player')));
            box.appendChild(who);
            var f = pauseButtons(box, focusId), hint = document.createElement('p');
            hint.className = 'pause-hint'; hint.setAttribute('aria-hidden', 'true');
            box.appendChild(hint);
            var bs = box.querySelectorAll('button');
            for (var k = 0; k < bs.length; k++) bs[k].addEventListener('focus', function () { hint.textContent = this.title || ''; });
            hint.textContent = f && f.title || '';
            return f;
        }
        pauseItems = [{ id: '_resume', label: I18n.t('resume') }];
        var extra = [];
        try { extra = (api && api.menuItems && api.menuItems()) || []; } catch (e) {}
        pauseItems = pauseItems.concat(extra);
        if (typeof TouchPad !== 'undefined' && TouchPad.canShow()) {          // touch devices
            if (TouchPad.available()) pauseItems.push({ id: '_touchpad', label: I18n.t('padSettings') });
            pauseItems.push({ id: '_padshow', label: I18n.t(TouchPad.hidden() ? 'padShow' : 'padHide') });
        }
        if (window.Rotation && Rotation.phone() && Rotation.mode() === 'manual') pauseItems.push({ id: '_rotate', label: I18n.t('rotNow') });
        // the music that plays on under the game (js/core/music.js): play or pause it from here
        if (typeof Music !== 'undefined') pauseItems.push({ id: '_music', label: I18n.t(musicOn() ? 'gmMusicPause' : 'gmMusicPlay') });
        pauseItems.push({ id: '_appset', label: I18n.t('asTitle') });
        pauseItems.push({ id: '_quit', label: I18n.t('quit') });
        return pauseButtons(box, focusId);
    }
    function pauseButtons(box, focusId) {
        var target = null, first = null;
        for (var i = 0; i < pauseItems.length; i++) {
            var b = document.createElement('button');
            b.className = 'btn' + (i === 0 && !pauseSub ? ' btn-primary' : '');
            b.setAttribute('data-focus', '');
            b.setAttribute('data-id', pauseItems[i].id);
            b.textContent = pauseItems[i].label;
            if (pauseItems[i].desc) { b.title = pauseItems[i].desc; b.setAttribute('aria-description', pauseItems[i].desc); }
            b.onclick = (function (it) { return function () { pauseAction(it.id); }; })(pauseItems[i]);
            box.appendChild(b);
            if (!first) first = b;
            if (pauseItems[i].id === focusId) target = b;
        }
        return target || first;
    }

    function musicOn() { try { return !!Music.state().playing; } catch (e) { return false; } }

    // on a phone held upright (html.tall) an app gets the whole tall screen; the built-in games and apps with
    // "orientation": "landscape" in their config are made for 16:9: they keep 1920x1080, shown across the screen's width
    function wideOnly() {
        if (!game.remote) return true;
        var c = game.remote.config, v = c && c.orientation;
        return v === 'landscape';
    }

    // the app may keep running while My PC is in the background: "allow_background_running": true in its config
    // (App Store Manager > Config, or a built-in game's game-manifest.json)
    function bgDefault() {
        var c = game && (game.remote ? game.remote.config : game.manifest), v = c && c.allow_background_running;
        return v === true || v === 'true' || v === 1;       // a JSON typed by hand may give "true"
    }
    function runsInBackground() { var v = pref(game && game.id, 'bg'); return v === undefined ? bgDefault() : !!v; }

    /* ---------- the app's settings, per user (My PC's menu > App settings, owner request 2026-11-12) ----------
     * Profile key app_prefs { <app id>: { bg, direct, keys, quiet } }; a missing value = the default:
     *   bg      run in the background (default: the app's config allow_background_running, App Store Manager)
     *   direct  the app may read the controllers itself (navigator.getGamepads; default NO, owner 2026-11-13). No: only through My PC
     *           (onInput, MyPC.gamepad), even if the app then cannot be played
     *   keys    every button goes to the app (default: Control Panel > Gaming's "Every button goes to the app")
     *   quiet   no notification cards over it (errors and controllers still show)                                      */
    function prefs() { var o = Store.get('app_prefs', {}); return o && typeof o === 'object' ? o : {}; }
    function pref(id, k) { var o = id && prefs()[id]; return o ? o[k] : undefined; }
    function setPref(id, k, v) {
        if (!id) return;
        var all = prefs(), o = all[id] || {};
        if (v === undefined || v === null) delete o[k]; else o[k] = k === 'run' ? (v === 'online' ? 'online' : 'usb') : !!v;
        if (Object.keys(o).length) all[id] = o; else delete all[id];
        Store.set('app_prefs', all);
        if (game && game.id === id && api && api.prefs) api.prefs();       // the running app follows at once
    }
    function directOk(id) { return pref(id, 'direct') === true; }     // owner decision 2026-11-13: off by default, each user allows it per app
    // where an installed app opens from: 'usb' (the installed copy, default) | 'online' (its mypc-app.json "run": "online", or the person's choice)
    function runMode(id) {
        var v = pref(id, 'run');
        if (v === 'usb' || v === 'online') return v;
        return typeof AppLive !== 'undefined' ? AppLive.runDefault(String(id).replace(/^app-/, '')) : 'usb';
    }
    function quiet() { return state !== 'idle' && !!game && pref(game.id, 'quiet') === true; }

    // My PC lost the focus (TV: another app or source; PC: window minimized or another window; phone: app switched):
    // the game pauses and My PC's menu shows to resume it; an app allowed to run in the background is left alone
    function background() {
        if (state === 'running' && !runsInBackground()) openPause();
    }

    // While My PC's menu (or any of its screens) is over the app, the app's frame gets no input at all: inert takes it out of
    // the focus order and the mouse / touch, and the focus leaves it so keys come to My PC. (The SDK also freezes the app's
    // own key listeners, gamepad reads and sound: sdk/mypc-sdk.js freeze.) Owner rule 2026-11-09: a paused app sees no button.
    function frameInput(on) {
        if (!iframe) return;
        if (on) iframe.removeAttribute('inert'); else iframe.setAttribute('inert', '');
        if (!on && document.activeElement === iframe) { try { iframe.blur(); } catch (e) {} $('game-layer').focus(); }
    }

    // "Every button goes to the app" (Control Panel > Gaming, per profile, on by default): installed apps get every key and
    // button; My PC's menu = Back twice quickly, Back on the app's first screen, or the controller's Home button
    var DOUBLE_BACK = 450, lastBack = 0, pausedAt = 0;
    function allKeys() { var v = pref(game && game.id, 'keys'); return v === undefined ? Store.get('app_keys', true) !== false : !!v; }
    function ownsKeys() { return !!(api && api.sdk && allKeys()); }
    function backUnhandled() { if (state === 'running' && lastBack && Date.now() - lastBack < 1500) { lastBack = 0; pausedAt = Date.now(); openPause(); } }
    // the first time an app gets Back: how to reach My PC's menu (once per app per profile)
    function backHint() {
        var id = game && game.id, seen = Store.get('back_hint', []);
        if (!id || seen.indexOf(id) >= 0) return;
        setTimeout(function () {
            if (state !== 'running') return;
            seen = Store.get('back_hint', []);
            if (seen.indexOf(id) >= 0) return;
            seen.push(id); if (seen.length > 200) seen.shift();
            Store.set('back_hint', seen);
            App.toast(I18n.t('backTwice'), { kind: 'info', id: 'backhint' });
        }, 700);
    }

    function openPause(focusId) {
        if (state !== 'running') return;
        setState('paused');
        frameInput(false);
        try { api.pause(); } catch (e) {}
        Input.releaseAll();
        Input.setExternalPoll(false);   // the game loop is stopped: the launcher reads the gamepads
        screenSaver(true);
        pauseSub = null;
        var first = renderPause(typeof focusId === 'string' ? focusId : undefined);
        $('pause').hidden = false;
        Focus.push($('pause'), first);
        AudioPrefs.chime();
        A11y.announce(I18n.t('paused'));
    }

    // the multiplayer screens pause the game like the pause menu does (without the menu); true when this call paused it
    function hold() {
        if (state !== 'running') return false;
        setState('paused');
        frameInput(false);
        try { api.pause(); } catch (e) {}
        Input.releaseAll();
        Input.setExternalPoll(false);
        screenSaver(true);
        return true;
    }
    function release(didPause) {
        if (!didPause || state !== 'paused' || !$('pause').hidden) return;       // not ours, or the pause menu is open meanwhile
        setState('running');
        frameInput(true);
        Input.setExternalPoll(!game.remote);
        screenSaver(false);
        $('game-layer').focus();
        try { api.resume(); } catch (e) {}
    }

    function resume() {
        if (state !== 'paused') return;
        $('pause').hidden = true;
        Focus.pop();
        Focus.reset();
        setState('running');
        frameInput(true);
        Input.setExternalPoll(!game.remote);
        screenSaver(false);
        $('game-layer').focus();
        try { api.resume(); } catch (e) {}
    }

    function pauseAction(id) {
        if (id === '_resume') return resume();
        if (id === '_appset' || id === '_s_back') { pauseSub = id === '_appset' ? 'app' : null; return pauseRedraw(id === '_appset' ? '_s_bg' : '_appset'); }
        if (id.slice(0, 3) === '_s_') {
            var gid = game.id;
            var nv;     // a value equal to the default is not kept: the app follows the default again (config / Control Panel)
            if (id === '_s_bg') { nv = !runsInBackground(); setPref(gid, 'bg', nv === bgDefault() ? null : nv); }
            else if (id === '_s_direct') setPref(gid, 'direct', directOk(gid) ? null : true);
            else if (id === '_s_keys') { nv = !allKeys(); setPref(gid, 'keys', nv === (Store.get('app_keys', true) !== false) ? null : nv); }
            else if (id === '_s_quiet') setPref(gid, 'quiet', pref(gid, 'quiet') ? null : true);
            else if (id === '_s_run') {
                // opens from the installed copy / online: the app opens again now the new way (the same page, prepare() decides)
                nv = runMode(gid) === 'online' ? 'usb' : 'online';
                if (nv === 'usb' && typeof AppUsb !== 'undefined' && AppUsb.clearFailed) AppUsb.clearFailed();   // try the USB copies again
                setPref(gid, 'run', nv === (typeof AppLive !== 'undefined' ? AppLive.runDefault(gid.replace(/^app-/, '')) : 'usb') ? null : nv);
                pauseRedraw(id);
                setTimeout(function () { location.reload(); }, 350);
                return;
            }
            else if (id === '_s_reset') { var all = prefs(); delete all[gid]; Store.set('app_prefs', all); if (api && api.prefs) api.prefs(); return pauseRedraw('_s_bg'); }
            return pauseRedraw(id);
        }
        if (id === '_quit') return exit();
        if (id === '_touchpad') return TouchPad.settings();           // the pause menu stays; the pad's own panel opens over it
        var r;
        if (id === '_padshow') { TouchPad.setHidden(!TouchPad.hidden()); r = 'stay'; }
        else if (id === '_music') {
            if (typeof Music.has === 'function' && !Music.has()) App.toast(I18n.t('scNoMusic'), { id: 'shortcut' });
            else Music.toggle();
            r = 'stay';
        }
        else if (id === '_rotate') { if (!Rotation.turn()) App.toast(I18n.t('rotUpdate')); r = 'stay'; }   // Manual screen rotation
        else try { r = api.onMenu(id); } catch (e) {}
        if (r === 'stay') pauseRedraw(id);
        else resume();
    }
    function pauseRedraw(focusId) {
        Focus.pop();
        var t = renderPause(focusId);
        Focus.push($('pause'), t);
        A11y.announce(t.textContent);
    }

    /* ---------- exit ---------- */

    function removeFrame() {
        if (!iframe) return;
        try { iframe.src = 'about:blank'; } catch (e) {}
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        iframe = null;
    }

    function teardown() {
        if (typeof AppOpen !== 'undefined') AppOpen.appGone();      // a MyPhotos / MyVideos / MyMusic window over the app goes with it
        if (typeof TouchPad !== 'undefined') TouchPad.end();
        sensorsOff();
        if (api) { try { api.destroy(); } catch (e) {} }
        api = null;
        gameWin = null;
        removeFrame();
        Input.setExternalPoll(false);
        Input.releaseAll();
        screenSaver(true);
    }

    function exit() {
        if (state === 'idle') return;
        // given up while it was still loading (slow, or stuck): worth a report too
        if (state === 'loading' && game && Date.now() - said.at > 8000) report({ kind: 'load', msg: 'closed while still loading: ' + loadReason('timeout').slice(9), stage: 'loading' });
        loadSeq++;
        clearTimeout(loadTimer); clearTimeout(loadMax);
        teardown();
        setState('idle');
        $('pause').hidden = true;
        $('game-error').hidden = true;
        hideLoading();
        $('game-layer').hidden = true;
        var id = game && game.id;
        game = null;
        if (onExitCb) onExitCb(id);
    }

    function launch(g, onExit) {
        if (state !== 'idle') return;
        game = { id: g.id, manifest: g.manifest, bundledBase: g.bundledBase, bundledManifest: g.bundledManifest, remote: g.remote || null,
                 icon: g.iconUrl || (g.manifest ? (g.base || '') + 'games/' + g.id + '/' + (g.manifest.cover || 'cover.png') : '') };
        base = g.base;
        if (typeof TouchPad !== 'undefined') TouchPad.begin(g.id, g.remote ? g.remote.touch : g.manifest && g.manifest.touch);
        triedBundled = base === g.bundledBase;
        triedUsb = false;
        onExitCb = onExit;
        $('game-layer').hidden = false;
        load();
    }

    function retry() {
        if (state !== 'error') return;
        $('game-error').hidden = true;
        Focus.pop();
        if (game.remote) { game.remote.usb = null; triedUsb = false; }     // online first again
        load();
    }

    /* ---------- records: saved automatically under the profile's name ---------- */

    function submitScore(id, score, opts) {
        score = Math.floor(score) || 0;
        if (!Scores.qualifies(id, score)) return;
        var slot = opts.player || 1, multi = (opts.players || 1) > 1, p = Profiles.current();
        var name = slot > 1 ? I18n.t('player') + ' ' + slot : Profiles.name(p, I18n.t('player'));
        var rank = Scores.add(id, name, score, slot > 1 ? '' : p.id);
        if (!rank) return;
        World.submit(id, name, score);                      // world records (sent now, or later when offline)
        App.toast((multi || slot > 1 ? name + ': ' : '') + I18n.t('newHigh') + ' ' + I18n.t('rank') + ' ' + rank);
    }

    /* ---------- input routing (called by the router in main.js) ---------- */

    function onAction(action, pressed, repeat, dev) {
        if (state === 'running') {
            // Guide = the Start key of this PC: opens the pause menu. Page keys and Tab belong to the desktop, not to games.
            // Owner rule (2026-11-11): only the remote's Back and the controller's Home open My PC's menu over an app or game. A pad's Home
            // (and the touch pad's / phone's Home) = 'guide' from a pad / touch device; the remote's Guide key (458, the button between
            // CH + and CH − on a Samsung remote) and F6 do nothing here.
            if (action === 'guide') { if (pressed && !repeat && /^(pad|touch)/.test(String(dev))) openPause(); return; }
            var k = api && api.keys;
            // apps that asked for them (API 17): CH + / CH - (and a pad's L / R) and the remote's media keys
            if ((action === 'pageUp' || action === 'pageDown') && k && k.channel) { if (api.onAction) { try { api.onAction(action, pressed, repeat, dev); } catch (e0) {} } return; }
            if (/^media/.test(action) && k && k.media) { if (api.onAction) { try { api.onAction(action, pressed, repeat, dev); } catch (e1) {} } return; }
            if (action === 'pause' && k && k.media && String(dev).slice(0, 3) !== 'pad') { if (api.onAction) { try { api.onAction('playPause', pressed, repeat, dev); } catch (e2) {} } return; }
            // the phone's microphone button (the Record key): speech to text for an app that listens for it (MyPC.stt, API 24)
            if (action === 'record') { if (pressed && !repeat && api && api.sttButton) api.sttButton(); return; }
            if (action === 'pageUp' || action === 'pageDown' || action === 'tab' || action === 'tabBack' || action === 'record' || /^media/.test(action)) return;
            var own = ownsKeys();
            if (action === 'pause' && !own) { if (pressed && !repeat) openPause(); return; }
            // The TV remote's Back. Built-in games, and every app when "Every button goes to the app" is off: My PC's menu, unless the
            // app said it has a screen to close (MyPC.back(true), API 17). Installed apps with it on (default, API 18): the app's 'cancel';
            // two quick presses, an app that said it has nothing to close, or an app that answers "not handled" = My PC's menu.
            // A keyboard's Esc / Backspace always go to the game as its Back ('cancel').
            if (action === 'back') {
                if (Input.tvBack()) {
                    if (!own) { if (!(api && api.ownBack)) { if (pressed && !repeat) openPause(); return; } }
                    else if (pressed && !repeat) {
                        var now = Date.now(), dbl = now - lastBack < DOUBLE_BACK;
                        lastBack = dbl ? 0 : now;
                        if (dbl || (api.backSaid && !api.ownBack)) { lastBack = 0; pausedAt = Date.now(); openPause(); return; }
                        backHint();
                    }
                }
                action = 'cancel';
            }
            // gamepad Start or Select: the game's own menu when it has one, else nothing (holding both opens My PC's
            // menu); the touch pad's and a phone controller's menu button still open My PC's menu (no other way there).
            else if (action === 'menu') {
                if (!pressed || repeat) return;
                if (!(api && api.ownMenu)) { if (String(dev).slice(0, 3) !== 'pad') openPause(); return; }
                try { api.onAction('menu', true, false, dev); api.onAction('menu', false, false, dev); } catch (e) {}
                return;
            }
            if (action === 'padLost') { openPause(); A11y.announce(I18n.t('padOff')); return; }
            if (api && api.onAction) { try { api.onAction(action, pressed, repeat, dev); } catch (e) {} }
            return;
        }
        if (!pressed) return;
        if (state === 'paused') {
            // the second of two quick Backs (or a Back the app passed back to us) must not close the menu Back just opened
            if (action === 'back' || action === 'cancel' || action === 'pause' || action === 'menu') {
                if (repeat || ((action === 'back' || action === 'cancel') && Date.now() - pausedAt < 600)) return;
                if (pauseSub && (action === 'back' || action === 'cancel')) pauseAction('_s_back');       // App settings > Back: the menu
                else resume();
            }
            else if (action === 'up' || action === 'down') Focus.move(action);
            else if (action === 'confirm' && !repeat) { var c = Focus.current(); if (c) c.click(); }
        } else if (state === 'error') {
            if (action === 'back' || action === 'cancel') { if (!repeat) { Focus.pop(); exit(); } }
            else if (action === 'left' || action === 'right') Focus.move(action);
            else if (action === 'confirm' && !repeat) { var e = Focus.current(); if (e) e.click(); }
        } else if (state === 'loading') {
            if ((action === 'back' || action === 'cancel') && !repeat) exit();   // Back never does nothing
        }
    }

    function init() {
        Icons.put($('game-loading-logo'), 'mypc');
        $('game-error-retry').onclick = retry;
        $('game-error-back').onclick = function () { Focus.pop(); exit(); };
    }

    return {
        loadingStatus: loadingStatus,
        loadingWait: loadingWait,       // a question on the start screen: the no-progress limit waits
        loadingInfo: showInfo,
        runMode: runMode,
        quiet: quiet,                    // App settings > Notifications: hidden over this app (js/launcher/notify.js)
        appPrefs: function (id) { var o = prefs()[id]; return o ? JSON.parse(JSON.stringify(o)) : {}; },
        setAppPref: setPref,             // (app id, 'bg' | 'direct' | 'keys' | 'quiet' | 'run' ('usb' | 'online'), value | null)
        resetAppPrefs: function (id) { var all = prefs(); delete all[id]; Store.set('app_prefs', all); },
        init: init, launch: launch, exit: exit, onAction: onAction, ownsKeys: function () { return state === 'running' && ownsKeys(); }, openPause: openPause, background: background, hold: hold, release: release,
        active: function () { return state !== 'idle'; },
        // a notification for the app that is open: its deep link goes to it (MyPC.launch + onLaunch); true when delivered
        // the running app asked for the remote's media keys (MyPC.init({ keys: ['media'] })): shortcuts leave them to it
        // MyPC.buttons (API 19): a remote button for the running app that asked for them (keys: ['buttons']), by name
        rawButton: function (n, down, repeat) {
            if (!(state === 'running' && api && api.keys && api.keys.buttons && api.button && ownsKeys())) return false;
            api.button(n, down, repeat);
            return true;
        },
        wantsMedia: function () { return state === 'running' && !!(api && api.keys && api.keys.media); },
        deepLink: function (gameId, launch) { if (!game || game.id !== gameId || !api || !api.launch) return false; api.launch(launch); return true; },
        state: function () { return state; },
        id: function () { return game ? game.id : null; },
        frame: function () { return iframe; }
    };
})();
