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

    var LOAD_TIMEOUT_MS = 20000, FILE_TIMEOUT_MS = 10000;

    var state = 'idle';         // idle | loading | running | paused | error
    function setState(s) { state = s; if (typeof TouchPad !== 'undefined') TouchPad.state(s); }
    var game = null, base = '', triedBundled = false;
    var iframe = null, api = null, gameWin = null, loadTimer = 0, onExitCb = null;
    var pauseItems = [], loadSeq = 0;

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
            progress: function (p) { setProgress(p); },
            loaded: onLoaded,
            failed: function (msg) { fail(msg || 'game reported failure'); },
            pause: function () { openPause(); },
            exitToMenu: function () { setTimeout(exit, 0); },
            // Top-10 tables: the game reports a final score; the launcher asks for initials if it qualifies.
            submitScore: function (score, opts) { submitScore(id, score, opts || {}); },
            topScores: function () { return Scores.list(id); }
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

    function showLoading() {
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
        var id = game.id, origin = originOf(game.remote.entry), items = [], win = null, mp = null;
        function send(type, d) { if (win) { try { win.postMessage({ mypc: 1, type: type, data: d === undefined ? null : d }, origin); } catch (e) {} } }
        /* HR BLE bridge v1: this code runs in the top-level Tizen host, not in the app iframe. */
        function createHrBleBridge(send) {
            var adapter = null, device = null, characteristic = null;
            var valueWatchId = null, connectionWatchId = null, scanTimer = 0;
            var pendingRequestId = null, connectedName = '';

            function emit(kind, data) {
                var message = { kind: kind };
                data = data || {};
                Object.keys(data).forEach(function (key) { message[key] = data[key]; });
                send('ble-event', message);
            }
            function reply(id, ok, result, error) {
                if (id === null || id === undefined) return;
                emit('result', { requestId: id, ok: !!ok, result: result || {}, error: error || null });
            }
            function errorMessage(error) {
                if (!error) return 'Unknown Tizen Bluetooth error.';
                return String(error.message || error.name || error).slice(0, 240);
            }
            function uuidKey(value) {
                if (value && typeof value === 'object' && value.uuid !== undefined) value = value.uuid;
                return String(value || '').toLowerCase().replace(/[^0-9a-f]/g, '');
            }
            function uuidMatches(value, shortUuid) {
                var key = uuidKey(value);
                return key === shortUuid || key.indexOf('0000' + shortUuid) === 0;
            }
            function asByteArray(value) {
                if (value && value.value !== undefined && value.value !== value) value = value.value;
                /* Tizen's Bytes type may be a hex DOMString (for example, '0x187b'). */
                if (typeof value === 'string' && window.tizen && window.tizen.bluetooth &&
                    typeof window.tizen.bluetooth.toByteArray === 'function') {
                    try { value = window.tizen.bluetooth.toByteArray(value); } catch (e) {}
                }
                if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) {
                    return Array.prototype.slice.call(new Uint8Array(value));
                }
                if (typeof DataView !== 'undefined' && value instanceof DataView) {
                    return Array.prototype.slice.call(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
                }
                if (value && value.buffer instanceof ArrayBuffer && value.byteLength !== undefined) {
                    return Array.prototype.slice.call(new Uint8Array(value.buffer, value.byteOffset || 0, value.byteLength));
                }
                if (value && typeof value.length === 'number') {
                    var out = [];
                    for (var i = 0; i < value.length; i++) out.push(Number(value[i]) & 255);
                    return out;
                }
                return [];
            }
            function decodeHeartRate(value) {
                var bytes = asByteArray(value);
                if (bytes.length < 2) return null;
                var flags = bytes[0], i = 1, bpm;
                if (flags & 1) {
                    if (bytes.length < 3) return null;
                    bpm = bytes[i] | (bytes[i + 1] << 8); i += 2;
                } else {
                    bpm = bytes[i++];
                }
                var contactBits = (flags >> 1) & 3;
                var contact = contactBits === 3 ? 'Detected' : (contactBits === 2 ? 'Not Detected' : 'Waiting');
                var energy = null, rr = null;
                if (flags & 8) {
                    if (i + 1 >= bytes.length) return null;
                    energy = bytes[i] | (bytes[i + 1] << 8); i += 2;
                }
                if (flags & 16) {
                    while (i + 1 < bytes.length) {
                        var raw = bytes[i] | (bytes[i + 1] << 8);
                        rr = Math.round(raw * 1000 / 1024);
                        i += 2;
                    }
                }
                return { bpm: bpm, contact: contact, energy: energy, rr: rr, deviceName: connectedName };
            }
            function stopScan() {
                if (scanTimer) { clearTimeout(scanTimer); scanTimer = 0; }
                if (adapter && typeof adapter.stopScan === 'function') {
                    try { adapter.stopScan(); } catch (e) {}
                }
            }
            function removeListeners() {
                if (characteristic && valueWatchId !== null && valueWatchId !== undefined) {
                    try { characteristic.removeValueChangeListener(valueWatchId); } catch (e) {}
                }
                valueWatchId = null;
                if (device && connectionWatchId !== null && connectionWatchId !== undefined && typeof device.removeConnectStateChangeListener === 'function') {
                    try { device.removeConnectStateChangeListener(connectionWatchId); } catch (e) {}
                }
                connectionWatchId = null;
                characteristic = null;
            }
            function disconnectCore(announce) {
                stopScan();
                removeListeners();
                var old = device;
                device = null;
                connectedName = '';
                if (old && typeof old.disconnect === 'function') {
                    try { if (!old.isConnected || old.isConnected()) old.disconnect(); } catch (e) {}
                }
                if (announce) emit('status', { status: 'disconnected' });
            }
            function failCurrent(error) {
                var id = pendingRequestId;
                pendingRequestId = null;
                var message = errorMessage(error);
                disconnectCore(false);
                emit('status', { status: 'error', message: message });
                reply(id, false, null, message);
            }
            function matchesHeartRateService(found) {
                var uuids = found && found.uuids;
                if (typeof uuids === 'string') uuids = [uuids];
                if (uuids && typeof uuids.length === 'number') {
                    for (var i = 0; i < uuids.length; i++) if (uuidMatches(uuids[i], '180d')) return true;
                }
                /* Some firmware does not report service UUIDs in scan results. Only use a recognizable sensor name then. */
                return /garmin|fr55|heart.?rate|heart.?monitor|\bhrm\b|polar|wahoo|coospo|h10/i.test(String(found && found.name || ''));
            }
            function finishConnected(found) {
                try {
                    var uuids = found.uuids || [], serviceUuid = '180d';
                    if (typeof uuids === 'string') uuids = [uuids];
                    for (var i = 0; i < uuids.length; i++) {
                        if (uuidMatches(uuids[i], '180d')) { serviceUuid = (uuids[i] && uuids[i].uuid !== undefined) ? uuids[i].uuid : uuids[i]; break; }
                    }
                    var service = found.getService(serviceUuid);
                    if (!service) throw new Error('The sensor does not expose the Heart Rate service (180D).');
                    var chars = service.characteristics || [], measurement = null;
                    for (var j = 0; j < chars.length; j++) {
                        if (uuidMatches(chars[j].uuid, '2a37')) { measurement = chars[j]; break; }
                    }
                    if (!measurement || typeof measurement.addValueChangeListener !== 'function') {
                        throw new Error('The sensor has no readable Heart Rate Measurement characteristic (2A37).');
                    }
                    device = found;
                    connectedName = String(found.name || found.address || 'Heart-rate sensor');
                    characteristic = measurement;
                    valueWatchId = characteristic.addValueChangeListener(function (value) {
                        var reading = decodeHeartRate(value);
                        if (reading && reading.bpm > 0) emit('reading', reading);
                    });
                    if (typeof found.addConnectStateChangeListener === 'function') {
                        try {
                            connectionWatchId = found.addConnectStateChangeListener({
                                onconnected: function () {},
                                ondisconnected: function () {
                                    if (device !== found) return;
                                    removeListeners(); device = null; connectedName = '';
                                    emit('status', { status: 'disconnected' });
                                }
                            });
                        } catch (e) {}
                    }
                    if (scanTimer) { clearTimeout(scanTimer); scanTimer = 0; }
                    var id = pendingRequestId;
                    pendingRequestId = null;
                    emit('status', { status: 'connected', deviceName: connectedName });
                    reply(id, true, { deviceName: connectedName });
                } catch (error) {
                    failCurrent(error);
                }
            }
            function connect(requestId) {
                if (pendingRequestId !== null) {
                    reply(requestId, false, null, 'A Bluetooth connection attempt is already in progress.');
                    return;
                }
                if (device && characteristic && (!device.isConnected || device.isConnected())) {
                    reply(requestId, true, { deviceName: connectedName });
                    return;
                }
                if (!window.tizen || !window.tizen.bluetooth || typeof window.tizen.bluetooth.getLEAdapter !== 'function') {
                    reply(requestId, false, null, 'Tizen BLE is unavailable in this My PC host. Install/run the packaged Tizen app on a TV that supports Bluetooth LE.');
                    emit('status', { status: 'error', message: 'Tizen BLE API is unavailable.' });
                    return;
                }
                pendingRequestId = requestId;
                try { adapter = window.tizen.bluetooth.getLEAdapter(); }
                catch (error) { failCurrent(error); return; }
                if (!adapter) { failCurrent(new Error('No Bluetooth LE adapter is available.')); return; }
                emit('status', { status: 'scanning', message: 'Scanning for a heart-rate sensor…' });
                scanTimer = setTimeout(function () {
                    if (pendingRequestId !== null) failCurrent(new Error('No heart-rate sensor found. Wake the Garmin and enable Broadcast Heart Rate, then try again.'));
                }, 25000);
                function onDeviceFound(found) {
                    if (pendingRequestId === null || device || !matchesHeartRateService(found)) return;
                    stopScan();
                    device = found;
                    connectedName = String(found.name || found.address || 'Heart-rate sensor');
                    scanTimer = setTimeout(function () {
                        if (pendingRequestId !== null) failCurrent(new Error('Timed out connecting to ' + connectedName + '.'));
                    }, 20000);
                    emit('status', { status: 'connecting', deviceName: connectedName, message: 'Connecting to ' + connectedName + '…' });
                    function connected() { finishConnected(found); }
                    function failed(error) { failCurrent(error); }
                    try {
                        if (typeof found.isConnected === 'function' && found.isConnected()) connected();
                        else if (typeof found.connect === 'function') found.connect(connected, failed);
                        else failed(new Error('This TV firmware cannot connect to BLE peripherals.'));
                    } catch (error) { failed(error); }
                }
                try { adapter.startScan(onDeviceFound); }
                catch (error) { failCurrent(error); }
            }
            function disconnect(requestId) {
                if (pendingRequestId !== null) {
                    var previous = pendingRequestId;
                    pendingRequestId = null;
                    reply(previous, false, null, 'Bluetooth connection cancelled.');
                }
                disconnectCore(true);
                reply(requestId, true, {});
            }
            function reject(requestId, message) { reply(requestId, false, null, message || 'Bluetooth bridge rejected the request.'); }
            function destroy() {
                if (pendingRequestId !== null) {
                    reply(pendingRequestId, false, null, 'My PC is closing the app.');
                    pendingRequestId = null;
                }
                disconnectCore(false);
                adapter = null;
            }
            return { connect: connect, disconnect: disconnect, reject: reject, destroy: destroy };
        }
        var ble = createHrBleBridge(send);

        function onMsg(e) {
            if (!iframe || e.source !== iframe.contentWindow) return;     // only our app's frame
            var m = e.data, d;
            if (!m || m.mypc !== 1 || typeof m.type !== 'string') return;
            d = m.data || {};
            switch (m.type) {
                case 'hello':
                    win = e.source;
                    remote.ownMenu = !!d.ownMenu;          // the app has its own menu on gamepad Start
                    if (typeof TouchPad !== 'undefined') { TouchPad.app(d.pad); TouchPad.relay(function (m) { send('pad', m); }); }      // MyPC.init({ pad }); presses of the app's own pad go back to it
                    send('init', {
                        lang: I18n.lang(), rtl: I18n.rtl(), quality: { tier: Perf.profile().tier },
                        volume: { music: AudioPrefs.music() / 10, sfx: AudioPrefs.sfx() / 10 },
                        profile: { id: Profiles.current().id, name: Profiles.name(null, I18n.t('player')) },
                        data: Store.get('game_' + id + '_data', {}), app: { id: id },
                        config: game.remote.config || {},
                        mp: typeof Multiplayer !== 'undefined' && typeof Rooms !== 'undefined' && NetLink.supported() ? 1 : 0   // MyPC.multiplayer is supported
                    });
                    break;
                case 'ble':
                    /* BLE is intentionally restricted to the HR monitor app and its own origin. */
                    if (e.origin !== origin || id !== 'hr-monitor' || typeof d.requestId !== 'number') {
                        if (typeof d.requestId === 'number') ble.reject(d.requestId, 'Bluetooth bridge is not authorized for this app/origin.');
                        break;
                    }
                    if (d.action === 'connect') {
                        if (state !== 'running') ble.reject(d.requestId, 'The app is not running. Resume it before connecting.');
                        else ble.connect(d.requestId);
                    } else if (d.action === 'disconnect') {
                        ble.disconnect(d.requestId);
                    } else {
                        ble.reject(d.requestId, 'Unknown Bluetooth action.');
                    }
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
                case 'pad':                                                    // the app wants a pad of its own (MyPC.pad.init({ force: true, ... })): the shell draws it
                    if (typeof TouchPad === 'undefined') break;
                    if (d.settings) TouchPad.settings(); else TouchPad.own(!!d.own, d.cfg);
                    break;
                case 'progress': if (state === 'loading') setProgress(+d.p || 0); break;
                case 'ready': onLoaded(); break;
                case 'failed': fail('app: ' + d.reason); break;
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
            init: function () {},
            start: function () { send('start'); },
            pause: function () { send('pause'); },
            resume: function () { send('resume'); },
            destroy: function () { ble.destroy(); if (mp) { mp.destroy(); mp = null; } send('destroy'); window.removeEventListener('message', onMsg); AudioPrefs.offChange(volume); win = null; },
            menuItems: function () { return items; },
            onMenu: function (mid) { send('menu', { id: String(mid).slice(4) }); },
            onAction: function (a, pressed, repeat, dev) { send('input', { action: a, pressed: pressed, repeat: repeat, dev: dev }); }
        };
        return remote;
    }

    function loadRemote(token) {
        // optional: the launcher refreshes the app's document first (its config) behind the loading screen
        if (game.remote.prepare) {
            return game.remote.prepare(function (ok) {
                if (state !== 'loading' || token !== loadSeq) return;       // cancelled or superseded
                if (ok === false) return exit();                            // uninstalled meanwhile
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
        // its own origin: it cannot touch My PC's page, storage or navigation
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-pointer-lock');
        iframe.setAttribute('allow', 'autoplay; gamepad; fullscreen');
        iframe.setAttribute('referrerpolicy', 'no-referrer');
        api = remoteApi();
        // the version in the address: a new version published in the App Store never opens from the TV's cache
        var v = game.remote.version, e = String(game.remote.entry).split('#');
        iframe.src = v ? e[0] + (e[0].indexOf('?') < 0 ? '?' : '&') + 'mypc_v=' + encodeURIComponent(v) + (e[1] !== undefined ? '#' + e[1] : '') : e.join('#');
        $('game-frame-box').appendChild(iframe);
        $('game-layer').focus();
    }

    function load() {
        setState('loading');
        showLoading();
        A11y.announce(I18n.t('loading') + ' ' + title());
        var dir = abs(base + 'games/' + game.id + '/');
        var entry = game.manifest.entry || 'index.html';
        var build = game.manifest.build || 0;
        clearTimeout(loadTimer);
        loadTimer = setTimeout(function () { fail('timeout'); }, LOAD_TIMEOUT_MS);
        var token = ++loadSeq;
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
                doc.write(html);
                doc.close();
            } catch (e) { fail('write: ' + e); }
            $('game-layer').focus();
        });
    }

    function onLoaded() {
        if (state !== 'loading') return;
        clearTimeout(loadTimer);
        hideLoading();
        setState('running');
        Input.setExternalPoll(!game.remote);    // an installed app cannot poll: the launcher reads the pads
        screenSaver(false);     // the game polls gamepads at the start of each frame
        screenSaver(false);
        $('game-layer').setAttribute('aria-label', title());
        $('game-layer').focus();
        try { api.start(); } catch (e) { fail('start: ' + e); }
    }

    function fail(reason) {
        if (state !== 'loading') { try { console.warn('[GameHost] ' + reason); } catch (e) {} return; }
        try { console.warn('[GameHost] ' + game.id + ' failed: ' + reason); } catch (e) {}
        clearTimeout(loadTimer);
        teardown();
        // A hosted game that fails falls back to the bundled copy of the same game, if any.
        if (!triedBundled && game.bundledBase && game.bundledBase !== base) {
            triedBundled = true;
            base = game.bundledBase;
            game.manifest = game.bundledManifest || game.manifest;
            return load();
        }
        setState('error');
        hideLoading();
        $('game-error').hidden = false;
        A11y.announce(I18n.t('loadError'));
        Focus.push($('game-error'), $('game-error-retry'));
    }

    /* ---------- pause menu ---------- */

    function renderPause(focusId) {
        var box = $('pause-items');
        box.innerHTML = '';
        pauseItems = [{ id: '_resume', label: I18n.t('resume') }];
        var extra = [];
        try { extra = (api && api.menuItems && api.menuItems()) || []; } catch (e) {}
        pauseItems = pauseItems.concat(extra);
        if (typeof TouchPad !== 'undefined' && TouchPad.available()) pauseItems.push({ id: '_touchpad', label: I18n.t('padSettings') });      // touch devices
        pauseItems.push({ id: '_quit', label: I18n.t('quitToMenu') });
        var target = null;
        for (var i = 0; i < pauseItems.length; i++) {
            var b = document.createElement('button');
            b.className = 'btn' + (i === 0 ? ' btn-primary' : '');
            b.setAttribute('data-focus', '');
            b.textContent = pauseItems[i].label;
            b.onclick = (function (it) { return function () { pauseAction(it.id); }; })(pauseItems[i]);
            box.appendChild(b);
            if (pauseItems[i].id === focusId) target = b;
        }
        return target || box.firstChild;
    }

    function openPause() {
        if (state !== 'running') return;
        setState('paused');
        try { api.pause(); } catch (e) {}
        Input.releaseAll();
        Input.setExternalPoll(false);   // the game loop is stopped: the launcher reads the gamepads
        screenSaver(true);
        var first = renderPause();
        $('pause').hidden = false;
        Focus.push($('pause'), first);
        A11y.announce(I18n.t('paused'));
    }

    // the multiplayer screens pause the game like the pause menu does (without the menu); true when this call paused it
    function hold() {
        if (state !== 'running') return false;
        setState('paused');
        try { api.pause(); } catch (e) {}
        Input.releaseAll();
        Input.setExternalPoll(false);
        screenSaver(true);
        return true;
    }
    function release(didPause) {
        if (!didPause || state !== 'paused' || !$('pause').hidden) return;       // not ours, or the pause menu is open meanwhile
        setState('running');
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
        Input.setExternalPoll(!game.remote);
        screenSaver(false);
        $('game-layer').focus();
        try { api.resume(); } catch (e) {}
    }

    function pauseAction(id) {
        if (id === '_resume') return resume();
        if (id === '_quit') return exit();
        if (id === '_touchpad') return TouchPad.settings();           // the pause menu stays; the pad's own panel opens over it
        var r;
        try { r = api.onMenu(id); } catch (e) {}
        if (r === 'stay') {
            Focus.pop();
            var t = renderPause(id);
            Focus.push($('pause'), t);
            A11y.announce(t.textContent);
        } else resume();
    }

    /* ---------- exit ---------- */

    function removeFrame() {
        if (!iframe) return;
        try { iframe.src = 'about:blank'; } catch (e) {}
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        iframe = null;
    }

    function teardown() {
        if (typeof TouchPad !== 'undefined') TouchPad.end();
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
        loadSeq++;
        clearTimeout(loadTimer);
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
        onExitCb = onExit;
        $('game-layer').hidden = false;
        load();
    }

    function retry() {
        if (state !== 'error') return;
        $('game-error').hidden = true;
        Focus.pop();
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
            if (action === 'guide') { if (pressed && !repeat) openPause(); return; }
            if (action === 'pageUp' || action === 'pageDown' || action === 'tab' || action === 'tabBack') return;
            if (pressed && !repeat && (action === 'back' || action === 'pause')) return openPause();
            // gamepad Start, short press: the game's own menu when it has one, else My PC's menu
            if (action === 'menu') {
                if (!pressed || repeat) return;
                if (!(api && api.ownMenu)) return openPause();
                try { api.onAction('menu', true, false, dev); api.onAction('menu', false, false, dev); } catch (e) {}
                return;
            }
            if (action === 'padLost') { openPause(); A11y.announce(I18n.t('padOff')); return; }
            if (api && api.onAction) { try { api.onAction(action, pressed, repeat, dev); } catch (e) {} }
            return;
        }
        if (!pressed) return;
        if (state === 'paused') {
            if (action === 'back' || action === 'cancel' || action === 'pause' || action === 'menu') { if (!repeat) resume(); }
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
        init: init, launch: launch, exit: exit, onAction: onAction, openPause: openPause, hold: hold, release: release,
        active: function () { return state !== 'idle'; },
        state: function () { return state; },
        frame: function () { return iframe; }
    };
})();
