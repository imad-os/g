/* Heart-rate sensors over Bluetooth LE (native Tizen API, TV only): any device that speaks the standard Heart Rate Service
 * (0x180D) and its Heart Rate Measurement characteristic (0x2A37). That covers chest straps (Polar H10 / H9 / H7, Garmin HRM-Dual /
 * HRM-Pro / HRM-Fit, Decathlon Kalenji / Kiprun / Domyos, Wahoo TICKR, Coospo, ...), arm bands (Polar Verity / OH1) and watches
 * that broadcast their heart rate (Garmin Forerunner 55 and others: Settings > Sensors > Wrist heart rate > Broadcast heart rate).
 *
 * The app frame never touches tizen.bluetooth: game-host.js creates one bridge per open app (only apps allowed to use it) and
 * relays the SDK's requests (MyPC.bluetooth, message 'ble') to it; everything comes back as events (message 'ble-event').
 *   var b = HrBle.create(emit)       emit(kind, data): 'status' | 'reading' | 'device-found' | 'scan-complete' | 'result'
 *   b.handle(action, requestId, args) capabilities | status | scan | cancel-scan | connect | reconnect-last | disconnect | start-test | stop-test
 *   b.destroy()
 *   HrBle.decode(bytes)               Heart Rate Measurement -> { bpm, format, contact, contactState, energy, rr, rrs }
 *
 * Solid on purpose: 8- and 16-bit heart rates, energy and any number of RR intervals (truncated packets keep what they have);
 * devices are deduplicated by address and their name is filled in when the scan response arrives; the service and the
 * characteristic are found even on firmware that gives short UUIDs or no characteristic UUID at all; a sensor that drops
 * (watch stops broadcasting, strap out of range) is reconnected by itself with backoff, re-scanning for it when the old handle
 * is dead, for 5 minutes; a connection that stays silent is reported ('stale'); the last sensor is remembered on the TV
 * (arc_dev_hrble) so the app can offer "Reconnect <name>" without a picker. */
var HrBle = (function () {
    'use strict';

    var HR_SERVICE = '180d', HR_MEASUREMENT = '2a37', FULL_SUFFIX = '-0000-1000-8000-00805f9b34fb';
    var KEY = 'arc_dev_hrble';
    var SCAN_MS = 10000, CONNECT_MS = 20000, STALE_MS = 10000, DEAD_MS = 30000, RETRY_FOR_MS = 300000;
    var BACKOFF = [1000, 2000, 4000, 8000, 15000];
    var TEST_NAME = 'My PC Test Sensor';
    // Names of heart-rate sensors that may not list 180D in their advertising packet (it then comes in the scan response)
    var NAMES = /garmin|forerunner|fenix|f[eē]nix|venu|vivo|vívo|instinct|epix|enduro|approach|\bhrm\b|hrm[-_ ]?(dual|pro|run|tri|fit|swim)|polar|\bh(7|9|10)\b|\boh1\b|verity|wahoo|tickr|coospo|magene|decathlon|kalenji|kiprun|geonaute|domyos|suunto|coros|amazfit|zepp|scosche|rhythm|moofit|xoss|igpsport|sigma|beurer|bryton|zwift|heart.?rate|heart.?monitor|\bhr\b|cardio|pulse/i;

    function clean(s, max) { return String(s === undefined || s === null ? '' : s).replace(/[\u0000-\u001f]/g, '').trim().slice(0, max || 64); }
    function uuidKey(v) {
        if (v && typeof v === 'object' && v.uuid !== undefined) v = v.uuid;
        return String(v || '').toLowerCase().replace(/^0x/, '').replace(/[^0-9a-f]/g, '');
    }
    // '180d', '0x180D', '0000180d', '0000180d-0000-1000-8000-00805f9b34fb' all match the short uuid '180d'
    function uuidIs(v, short) {
        var k = uuidKey(v);
        return k === short || k === '0000' + short || k === '0000' + short + '00001000800000805f9b34fb' || (k.length === 32 && k.slice(4, 8) === short && k.slice(8) === '00001000800000805f9b34fb');
    }
    function listOf(v) { if (!v) return []; if (typeof v === 'string') return [v]; var out = []; for (var i = 0; i < (v.length || 0); i++) out.push(v[i]); return out; }

    function bytesOf(value) {
        if (value && typeof value === 'object' && value.value !== undefined && value.value !== value) value = value.value;
        if (typeof value === 'string') {
            try { if (window.tizen && tizen.bluetooth && typeof tizen.bluetooth.toByteArray === 'function') value = tizen.bluetooth.toByteArray(value); } catch (e) {}
            if (typeof value === 'string') { var s = []; for (var c = 0; c < value.length; c++) s.push(value.charCodeAt(c) & 255); return s; }
        }
        if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) return Array.prototype.slice.call(new Uint8Array(value));
        if (value && typeof ArrayBuffer !== 'undefined' && value.buffer instanceof ArrayBuffer && value.byteLength !== undefined) {
            return Array.prototype.slice.call(new Uint8Array(value.buffer, value.byteOffset || 0, value.byteLength));
        }
        var out = [];
        if (value && typeof value.length === 'number') for (var i = 0; i < value.length; i++) out.push(Number(value[i]) & 255);
        return out;
    }

    /* Heart Rate Measurement (Bluetooth SIG, characteristic 0x2A37):
     *   byte 0 flags: bit0 = heart rate is UINT16 (else UINT8), bit1 = contact detected, bit2 = contact status supported,
     *                 bit3 = energy expended present (UINT16, kJ), bit4 = RR intervals present (UINT16 each, 1/1024 s)
     * Returns null when there is no heart rate in it. contact keeps the strings of the first version of the bridge. */
    function decode(value) {
        var b = bytesOf(value), flags, i = 1, bpm, r = {};
        if (b.length < 2) return null;
        flags = b[0];
        if (flags & 1) { if (b.length < 3) return null; bpm = b[1] | (b[2] << 8); i = 3; r.format = 16; }
        else { bpm = b[1]; i = 2; r.format = 8; }
        r.bpm = bpm;
        r.contactState = (flags & 4) ? ((flags & 2) ? 'detected' : 'not-detected') : 'unsupported';
        r.contact = r.contactState === 'detected' ? 'Detected' : r.contactState === 'not-detected' ? 'Not Detected' : 'Waiting';
        r.energy = null;
        if (flags & 8) { if (i + 1 < b.length) r.energy = b[i] | (b[i + 1] << 8); i += 2; }
        r.rrs = [];
        if (flags & 16) for (; i + 1 < b.length; i += 2) r.rrs.push(Math.round((b[i] | (b[i + 1] << 8)) * 1000 / 1024));
        r.rr = r.rrs.length ? r.rrs[r.rrs.length - 1] : null;
        return r;
    }

    function errText(e) { return e ? clean(e.message || e.name || e, 240) || 'Unknown Bluetooth error.' : 'Unknown Bluetooth error.'; }
    function addressOf(d) {
        var a = d && d.address;
        if (a && typeof a === 'object') a = a.address !== undefined && a.address !== null ? a.address : a.value !== undefined && a.value !== null ? a.value : (String(a) !== '[object Object]' ? String(a) : '');
        return clean(a, 40);
    }
    function looksLikeHr(d) {
        var u = listOf(d && d.uuids);
        for (var i = 0; i < u.length; i++) if (uuidIs(u[i], HR_SERVICE)) return true;
        return NAMES.test(clean(d && d.name));
    }
    function remembered() {
        var v = null;
        try { v = typeof Store !== 'undefined' ? Store.rawGet(KEY) : JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
        return v && typeof v === 'object' && typeof v.id === 'string' ? { id: v.id, name: clean(v.name) || 'Heart-rate sensor', address: clean(v.address, 40) } : null;
    }
    function remember(info) {
        var v = { id: info.id, name: info.name, address: info.address };
        try { if (typeof Store !== 'undefined') Store.rawSet(KEY, v); else localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {}
    }

    function create(emitFn) {
        var api = null;                    // the LE adapter
        var st = 'idle';                   // idle | scanning | connecting | connected | reconnecting | test
        var pending = null;                // { id, op }: one operation at a time
        var found = {}, list = [], anon = 0;
        var dev = null, info = null, chr = null, valueWatch = null, connWatch = null;
        var scanTimer = 0, opTimer = 0, retryTimer = 0, watchTimer = 0, testTimer = 0;
        var lastReading = 0, stale = false, retryStart = 0, attempt = 0, noContact = false, scanCb = null;
        var testBpm = 96, testEnergy = 12, dead = false;

        function emit(kind, data) { if (dead) return; var m = { kind: kind }; for (var k in data) if (data.hasOwnProperty(k)) m[k] = data[k]; try { emitFn(kind, m); } catch (e) {} }
        function status(s, extra) {
            var d = { status: s };
            if (info) d.deviceName = info.name;
            for (var k in extra) if (extra.hasOwnProperty(k)) d[k] = extra[k];
            emit('status', d);
        }
        function reply(id, ok, result, error) { if (id !== null && id !== undefined) emit('result', { requestId: id, ok: !!ok, result: result || {}, error: error || null }); }
        function finish(ok, result, error) { var p = pending; pending = null; clearTimeout(opTimer); opTimer = 0; if (p) reply(p.id, ok, result, error); }

        function adapter() {
            if (!window.tizen || !tizen.bluetooth || typeof tizen.bluetooth.getLEAdapter !== 'function') throw new Error('Bluetooth LE is not available here: open My PC on a Samsung TV (2024 or newer) that supports Bluetooth.');
            if (!api) api = tizen.bluetooth.getLEAdapter();
            if (!api) throw new Error('No Bluetooth LE adapter is available on this TV.');
            return api;
        }
        function powered() {
            try { var a = tizen.bluetooth.getDefaultAdapter(); return a && a.powered === false ? false : true; } catch (e) { return true; }
        }
        function infoOf(d) {
            var addr = addressOf(d), name = clean(d && d.name), id = addr ? addr.toLowerCase() : name ? 'name:' + name.toLowerCase() : 'unknown:' + (++anon);
            return { id: id, name: name || 'Heart-rate sensor', address: addr, rssi: typeof (d && d.rssi) === 'number' ? d.rssi : null, type: 'heart-rate-sensor' };
        }

        /* ---------- scanning ---------- */
        function stopScan() {
            clearTimeout(scanTimer); scanTimer = 0; scanCb = null;
            if (api) { try { api.stopScan(); } catch (e) {} }
        }
        // cb(device, info) for each heart-rate sensor seen (once per address, again when its name shows up); onErr(error)
        function startScan(ms, cb, onEnd, onErr) {
            stopScan();
            var a = adapter(), seen = {};
            scanCb = cb;
            scanTimer = setTimeout(function () { stopScan(); onEnd(); }, ms);
            a.startScan(function (d) {
                if (!scanCb || !d || !looksLikeHr(d)) return;
                var i = infoOf(d), old = found[i.id], better = false;
                if (old) {                                 // known: keep the newest handle; its name may arrive in the scan response
                    old.dev = d; if (i.rssi !== null) old.info.rssi = i.rssi;
                    if (old.info.name === 'Heart-rate sensor' && i.name !== 'Heart-rate sensor') { old.info.name = i.name; better = true; }
                } else { found[i.id] = { dev: d, info: i }; list.push(i); }
                if (!seen[i.id]) { seen[i.id] = 1; scanCb(d, found[i.id].info, false); }
                else if (better) scanCb(d, found[i.id].info, true);
            }, function (e) { stopScan(); onErr(e); });
        }

        function scan(id, args) {
            if (pending) return reply(id, false, null, 'Another Bluetooth operation is already in progress.');
            if (st === 'connected' && dev) return reply(id, true, { devices: [info], alreadyConnected: true });
            stopTest(false);
            try { adapter(); } catch (e) { status('error', { message: errText(e) }); return reply(id, false, null, errText(e)); }
            if (!powered()) { var off = 'Bluetooth is turned off on this TV. Turn it on in the TV settings (Connection > Bluetooth).'; status('error', { message: off, reasonCode: 'powered-off' }); return reply(id, false, null, off); }
            if (st === 'reconnecting') { cancelRetry(); stopScan(); info = null; }
            var ms = Math.max(3, Math.min(30, +(args && args.seconds) || SCAN_MS / 1000)) * 1000, last = remembered();
            found = {}; list = []; pending = { id: id, op: 'scan' }; st = 'scanning';
            status('scanning', { message: 'Searching for nearby heart-rate sensors…' });
            try {
                startScan(ms, function (d, i, updated) {
                    if (last && last.id === i.id) i.last = true;
                    emit('device-found', { device: i, updated: updated });
                }, function () {
                    if (st === 'scanning') st = 'idle';
                    var devs = list.slice();
                    status('scan-complete', { count: devs.length });
                    emit('scan-complete', { devices: devs, count: devs.length });
                    finish(true, { devices: devs });
                }, function (e) {
                    st = 'idle'; status('error', { message: errText(e) }); finish(false, null, errText(e));
                });
            } catch (e) { st = 'idle'; stopScan(); status('error', { message: errText(e) }); finish(false, null, errText(e)); }
        }
        function cancelScan(id) {
            if (pending && pending.op === 'scan') { stopScan(); st = 'idle'; status('scan-cancelled'); finish(false, null, 'Bluetooth scan cancelled by user.'); }
            reply(id, true, {});
        }

        /* ---------- connecting ---------- */
        function serviceOf(d) {
            var cands = [], u = [], i, s = null;
            try { if (typeof d.getServiceAllUuids === 'function') u = listOf(d.getServiceAllUuids()); } catch (e) {}
            u = u.concat(listOf(d.uuids));
            for (i = 0; i < u.length; i++) if (uuidIs(u[i], HR_SERVICE)) cands.push(u[i] && u[i].uuid !== undefined ? u[i].uuid : u[i]);
            cands.push('0000180d' + FULL_SUFFIX, '180d', '180D', '0000180D' + FULL_SUFFIX.toUpperCase());
            for (i = 0; i < cands.length && !s; i++) { try { s = d.getService(String(cands[i])); } catch (e) { s = null; } }
            return s;
        }
        function measurementOf(svc) {
            var cs = listOf(svc.characteristics), i, any = null;
            for (i = 0; i < cs.length; i++) {
                if (!cs[i]) continue;
                if (cs[i].uuid !== undefined && cs[i].uuid !== null && cs[i].uuid !== '') { if (uuidIs(cs[i].uuid, HR_MEASUREMENT)) return cs[i]; }
                else if (!any && cs[i].isNotify) any = cs[i];         // firmware without characteristic UUIDs: the one that notifies
            }
            return any;
        }
        function unwatch() {
            clearInterval(watchTimer); watchTimer = 0;
            if (chr && valueWatch !== null) { try { chr.removeValueChangeListener(valueWatch); } catch (e) {} }
            if (dev && connWatch !== null && typeof dev.removeConnectStateChangeListener === 'function') { try { dev.removeConnectStateChangeListener(connWatch); } catch (e) {} }
            chr = null; valueWatch = null; connWatch = null;
        }
        function hangUp() {
            unwatch();
            var d = dev; dev = null;
            if (d && typeof d.disconnect === 'function') { try { if (typeof d.isConnected !== 'function' || d.isConnected()) d.disconnect(function () {}, function () {}); } catch (e) {} }
        }
        function onValue(v) {
            var r = decode(v);
            if (!r) return;
            lastReading = Date.now();
            if (stale) { stale = false; status('connected', { message: 'Heart rate is back.' }); }
            if (r.bpm <= 0 || r.bpm > 250) {
                if (r.contactState === 'not-detected' && !noContact) { noContact = true; status('no-contact', { message: 'The sensor does not touch the skin.' }); }
                return;
            }
            noContact = false;
            r.deviceName = info ? info.name : ''; r.source = 'ble'; r.time = lastReading;
            emit('reading', r);
        }
        // attach to a connected device; throws when it is not a heart-rate sensor
        function attach(d) {
            var svc = serviceOf(d);
            if (!svc) throw new Error('This device does not offer the Heart Rate service (180D). On a Garmin watch turn on Broadcast heart rate first.');
            var c = measurementOf(svc);
            if (!c || typeof c.addValueChangeListener !== 'function') throw new Error('This device has no Heart Rate Measurement (2A37).');
            unwatch();
            dev = d; chr = c;
            valueWatch = c.addValueChangeListener(onValue);
            if (typeof d.addConnectStateChangeListener === 'function') {
                try { connWatch = d.addConnectStateChangeListener({ onconnected: function () {}, ondisconnected: function () { if (dev === d) lost('disconnected'); } }); } catch (e) {}
            }
            lastReading = Date.now(); stale = false; noContact = false;
            watchTimer = setInterval(function () {
                var quiet = Date.now() - lastReading;
                if (!dev) return;
                if (quiet > DEAD_MS) { var alive = true; try { alive = typeof dev.isConnected !== 'function' || dev.isConnected(); } catch (e) { alive = false; } if (!alive) return lost('silent'); }
                if (quiet > STALE_MS && !stale) { stale = true; status('stale', { message: 'Connected, but no heart rate for a while. Is the watch still broadcasting?' }); }
            }, 2000);
        }
        // connect a device object; done(err) once
        function link(d, done) {
            var over = false;
            function end(e) { if (over) return; over = true; clearTimeout(opTimer); opTimer = 0; done(e || null); }
            clearTimeout(opTimer);
            opTimer = setTimeout(function () { end(new Error('Timed out connecting to ' + (info ? info.name : 'the sensor') + '.')); }, CONNECT_MS);
            function ok() { if (over) return; try { attach(d); end(null); } catch (e) { try { d.disconnect(function () {}, function () {}); } catch (x) {} end(e); } }
            try {
                if (typeof d.isConnected === 'function' && d.isConnected()) ok();
                else if (typeof d.connect === 'function') d.connect(ok, function (e) { end(e || new Error('Connection refused.')); });
                else end(new Error('This TV firmware cannot connect to Bluetooth LE devices.'));
            } catch (e) { end(e); }
        }
        function connected() {
            st = 'connected'; attempt = 0; retryStart = 0;
            remember(info);
            status('connected');
        }
        function connect(id, deviceId) {
            if (pending && pending.op === 'scan') { stopScan(); finish(false, null, 'Scan cancelled because a device was selected.'); }
            else if (pending) return reply(id, false, null, 'Another Bluetooth connection attempt is already in progress.');
            if (st === 'connected' && dev && info && (!deviceId || info.id === String(deviceId))) return reply(id, true, { deviceName: info.name, device: info });
            var f = deviceId !== undefined && deviceId !== null ? found[String(deviceId)] : null;
            if (!f) return reply(id, false, null, 'Select a heart-rate sensor from the list. Scan again if the list is old.');
            stopTest(false); cancelRetry(); hangUp();
            info = f.info; pending = { id: id, op: 'connect' }; st = 'connecting';
            status('connecting', { message: 'Connecting to ' + info.name + '…' });
            link(f.dev, function (e) {
                if (!pending || pending.id !== id) return;
                if (e) { st = 'idle'; var i0 = info; info = null; hangUp(); status('error', { message: errText(e), deviceName: i0.name }); return finish(false, null, errText(e)); }
                connected();
                finish(true, { deviceName: info.name, device: info });
            });
        }
        // the remembered sensor: scan until it shows up, then connect
        function reconnectLast(id) {
            var last = remembered();
            if (!last) return reply(id, false, null, 'No heart-rate sensor was used on this TV yet.');
            if (st === 'connected' && info && info.id === last.id) return reply(id, true, { deviceName: info.name, device: info });
            if (pending) return reply(id, false, null, 'Another Bluetooth operation is already in progress.');
            stopTest(false); cancelRetry(); hangUp();
            try { adapter(); } catch (e) { return reply(id, false, null, errText(e)); }
            if (!powered()) return reply(id, false, null, 'Bluetooth is turned off on this TV.');
            info = last; pending = { id: id, op: 'connect' }; st = 'connecting'; found = {}; list = [];
            status('connecting', { message: 'Looking for ' + last.name + '…' });
            var miss = function () { if (!pending || pending.id !== id) return; st = 'idle'; info = null; var m = last.name + ' was not found. Is it on (or is the watch broadcasting)?'; status('error', { message: m }); finish(false, null, m); };
            try {
                startScan(15000, function (d, i) {
                    if (i.id !== last.id) return;
                    stopScan(); info = i;
                    link(d, function (e) {
                        if (!pending || pending.id !== id) return;
                        if (e) { st = 'idle'; info = null; hangUp(); status('error', { message: errText(e) }); return finish(false, null, errText(e)); }
                        connected(); finish(true, { deviceName: info.name, device: info });
                    });
                }, miss, function (e) { miss(); });
            } catch (e) { miss(); }
        }

        /* ---------- dropped: reconnect by itself ---------- */
        function cancelRetry() { clearTimeout(retryTimer); retryTimer = 0; attempt = 0; retryStart = 0; if (scanCb && !pending) stopScan(); }
        function lost(why) {
            if (st !== 'connected') return;
            unwatch();
            var d = dev; dev = null;
            st = 'reconnecting'; retryStart = Date.now(); attempt = 0;
            status('reconnecting', { attempt: 0, reason: why, message: 'Connection lost. Reconnecting to ' + info.name + '…' });
            retry(d);
        }
        function retry(d) {
            if (st !== 'reconnecting') return;
            if (Date.now() - retryStart > RETRY_FOR_MS) { st = 'idle'; status('disconnected', { reason: 'lost', message: info.name + ' did not come back.' }); info = null; return; }
            var wait = BACKOFF[Math.min(attempt, BACKOFF.length - 1)];
            attempt++;
            retryTimer = setTimeout(function () {
                if (st !== 'reconnecting') return;
                status('reconnecting', { attempt: attempt, message: 'Reconnecting to ' + info.name + ' (try ' + attempt + ')…' });
                function after(e) {
                    if (st !== 'reconnecting') return;
                    if (!e) { connected(); return; }
                    retry(d);
                }
                // the old handle first; after 2 misses, look for the sensor again (a fresh handle after it re-advertises)
                if (attempt <= 2 && d) return link(d, after);
                var seen = false;
                try {
                    startScan(8000, function (nd, i) { if (i.id !== info.id || seen) return; seen = true; stopScan(); d = nd; link(nd, after); }, function () { if (!seen) retry(d); }, function () { if (!seen) retry(d); });
                } catch (e) { retry(d); }
            }, wait);
        }
        function disconnect(id) {
            if (pending) { if (pending.op === 'scan') stopScan(); finish(false, null, 'Bluetooth operation cancelled.'); }
            stopTest(true); cancelRetry(); stopScan(); hangUp();
            var was = st !== 'idle'; st = 'idle'; info = null;
            if (was) status('disconnected', { reason: 'user' });
            reply(id, true, {});
        }

        /* ---------- simulated readings (works anywhere, also off the TV) ---------- */
        function stopTest(announce) {
            if (!testTimer) return;
            clearInterval(testTimer); testTimer = 0;
            if (st === 'test') st = 'idle';
            if (announce) emit('status', { status: 'test-stopped', message: 'Simulated heart-rate data stopped.' });
        }
        function startTest(id) {
            if (pending) { if (pending.op === 'scan') stopScan(); finish(false, null, 'Cancelled: test data mode was started.'); }
            cancelRetry(); stopScan(); hangUp(); info = null; stopTest(false);
            st = 'test'; testBpm = 96; testEnergy = 12;
            function sample() {
                testBpm = Math.max(65, Math.min(165, testBpm + Math.floor(Math.random() * 9) - 4));
                if (Math.random() < 0.2) testEnergy += 1;
                var rr = Math.max(360, Math.min(1000, Math.round(60000 / testBpm + (Math.random() * 30 - 15))));
                emit('reading', { bpm: testBpm, format: 8, contact: 'Detected', contactState: 'detected', energy: testEnergy, rr: rr, rrs: [rr], deviceName: TEST_NAME, source: 'simulation', time: Date.now() });
            }
            emit('status', { status: 'test', deviceName: TEST_NAME, source: 'simulation', message: 'My PC is generating simulated heart-rate readings.' });
            sample();
            testTimer = setInterval(sample, 1000);
            reply(id, true, { deviceName: TEST_NAME, simulated: true });
        }

        function capabilities(id) {
            var r = { hosted: true, platform: 'unknown', tizenApiAvailable: false, nativeBleAvailable: false, adapterAvailable: false, powered: null,
                      reasonCode: 'tizen-api-unavailable', message: 'Native Tizen Bluetooth is not available in this My PC runtime.', lastDevice: remembered(), state: st };
            if (window.tizen && tizen.bluetooth && typeof tizen.bluetooth.getLEAdapter === 'function') {
                r.platform = 'tizen'; r.tizenApiAvailable = true;
                try {
                    if (!adapter()) throw new Error('no adapter');
                    r.adapterAvailable = true; r.powered = powered();
                    if (r.powered) { r.nativeBleAvailable = true; r.reasonCode = 'available'; r.message = 'Bluetooth LE is available. A scan will find the sensors nearby.'; }
                    else { r.reasonCode = 'powered-off'; r.message = 'Bluetooth is turned off on this TV.'; }
                } catch (e) {
                    var t = errText(e);
                    if (/no adapter|no bluetooth le adapter/i.test(t)) { r.reasonCode = 'no-adapter'; r.message = 'This TV has no Bluetooth LE adapter.'; }
                    else if (/not.?supported|unsupported|not implemented/i.test(t)) { r.reasonCode = 'unsupported-tv'; r.message = 'This TV firmware does not support Tizen Bluetooth LE.'; }
                    else if (/permission|privilege|security|denied|not allowed|access/i.test(t)) { r.reasonCode = 'permission-denied'; r.message = 'My PC cannot use Bluetooth: the installed package may lack the Bluetooth privilege.'; }
                    else { r.reasonCode = 'adapter-error'; r.message = 'Bluetooth is present but could not start: ' + t; }
                }
            }
            reply(id, true, r);
        }
        function current(id) { reply(id, true, { state: st, device: info, lastDevice: remembered(), lastReadingAgoMs: lastReading ? Date.now() - lastReading : null, stale: stale }); }

        return {
            handle: function (action, id, args) {
                args = args || {};
                switch (action) {
                    case 'capabilities': return capabilities(id);
                    case 'status': return current(id);
                    case 'scan': return scan(id, args);
                    case 'cancel-scan': return cancelScan(id);
                    case 'connect': return connect(id, args.deviceId);
                    case 'reconnect-last': return reconnectLast(id);
                    case 'disconnect': return disconnect(id);
                    case 'start-test': return startTest(id);
                    case 'stop-test': stopTest(true); return reply(id, true, {});
                    default: return reply(id, false, null, 'Unknown Bluetooth action.');
                }
            },
            reject: function (id, msg) { reply(id, false, null, msg || 'The Bluetooth bridge refused the request.'); },
            state: function () { return st; },
            destroy: function () {
                if (pending) finish(false, null, 'My PC is closing the app.');
                stopTest(false); cancelRetry(); stopScan(); hangUp();
                st = 'idle'; info = null; api = null; dead = true;
            }
        };
    }

    return { create: create, decode: decode, looksLikeHr: looksLikeHr, uuidIs: uuidIs, remembered: remembered };
})();
