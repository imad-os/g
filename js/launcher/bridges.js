/* What installed apps cannot do from their sandboxed iframe, done by My PC for them (sdk/mypc-sdk.js):
 *   'net'  MyPC.net    web requests without CORS limits (js/core/web-proxy.js)
 *   'ai'   MyPC.ai     AI services set up in the App Store Manager (copied at start, Bridges.syncAi), keys never sent to apps (js/core/ai.js)
 *   'mic'  MyPC.mic    the microphone (js/core/mic.js)
 *   'drive' MyPC.drive Google Drive of the profile (js/core/gdrive.js): one sign-in in Control Panel > Google Drive,
 *                      apps never see a token. Allowed once per app and per profile (profile key drive_apps).
 *   'usb'  MyPC.usb    the USB drives of the TV (js/core/usb-fs.js): drives, list, new folder, read. Allowed once per app (arc_dev_perm).
 *   'copy' MyPC.copy   copies between Google Drive and the USB drives, done by My PC (js/core/copy-jobs.js); needs both permissions.
 *                      The app gets { ev: 'job', job } messages (rid 0) once it called watch.
 * The AI services of this TV and the microphone are used only after the user allowed it, once per app (arc_dev_perm,
 * Settings > Privacy & security forgets it). An app that brings its own AI key needs no permission. A red microphone
 * shows while an app listens.
 *
 *   var b = Bridges.attach({ appId, title, config, send(type, data, transfer), hold(), release(paused), state() })
 *   b.handle(type, data) -> true when it was one of ours     b.pause()    b.destroy() */
var Bridges = (function () {
    'use strict';

    var PERM = 'arc_dev_perm', DRIVE_PERM = 'drive_apps', NET_MAX = 8, AI_MAX = 4, DRIVE_MAX = 8;
    var queue = [], asking = false, micDot = null;

    function perms() { var p = Store.rawGet(PERM); return p && typeof p === 'object' ? p : {}; }
    // Drive is the profile's own data: allowed per profile; the microphone and AI are the TV's: allowed per TV
    function drivePerms() { var d = Store.get(DRIVE_PERM, null); return d && typeof d === 'object' ? d : {}; }
    function sid(app) { return String(app).replace(/^app-/, ''); }                 // the store id ('app-mydrive' -> 'mydrive')
    function allowed(app, kind) { if (kind === 'drive') return !!drivePerms()[sid(app)]; var p = perms()[app]; return !!(p && p[kind]); }
    function grant(app, kind) {
        if (kind === 'drive') { var d = drivePerms(); d[sid(app)] = 1; Store.set(DRIVE_PERM, d); return; }
        var p = perms(); p[app] = p[app] || {}; p[app][kind] = 1; Store.rawSet(PERM, p);
    }
    function forget(app, kind) { if (kind === 'drive') { var d = drivePerms(); delete d[sid(app)]; Store.set(DRIVE_PERM, d); } }
    function reset() { try { localStorage.removeItem(PERM); } catch (e) {} try { Store.remove(DRIVE_PERM); } catch (e2) {} }

    // one question at a time (an app may ask for the microphone and AI together)
    function ask(ctx, kind, text, cb) {
        if (allowed(ctx.appId, kind)) return cb(true);
        if (ctx.refused[kind]) return cb(false);         // asked during this run already: no nagging
        queue.push({ ctx: ctx, kind: kind, text: text, cb: cb });
        next();
    }
    function next() {
        if (asking || !queue.length) return;
        var q = queue.shift(), ctx = q.ctx;
        if (ctx.dead) return next();
        if (allowed(ctx.appId, q.kind)) { q.cb(true); return next(); }
        if (ctx.refused[q.kind]) { q.cb(false); return next(); }
        asking = true;
        var paused = ctx.hold();
        function done(ok) {
            asking = false;
            if (ok) grant(ctx.appId, q.kind); else ctx.refused[q.kind] = true;
            if (!ctx.dead) ctx.release(paused);
            q.cb(ok);
            next();
        }
        App.confirm(I18n.t(q.kind === 'mic' ? 'permMicTitle' : q.kind === 'drive' ? 'permDriveTitle' : q.kind === 'usb' ? 'permUsbTitle' : 'permAiTitle').replace('%s', ctx.title), q.text, function () { done(true); },
                    { yes: I18n.t('permAllow'), no: I18n.t('permDeny'), onNo: function () { done(false); } });
    }

    function micShown(on) {
        if (on && !micDot) {
            micDot = document.createElement('div');
            micDot.className = 'mic-on';
            micDot.setAttribute('role', 'status');
            micDot.setAttribute('aria-label', I18n.t('micOn'));
            micDot.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="#fff"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4M8 21h8" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';
            (document.getElementById('stage') || document.body).appendChild(micDot);
            A11y.announce(I18n.t('micOn'));
        } else if (!on && micDot) { if (micDot.parentNode) micDot.parentNode.removeChild(micDot); micDot = null; }
    }

    // the AI services of every My PC, set in the App Store Manager (Firestore settings/ai); cb(err) once the copy is saved
    var aiWait = null;
    function syncAi(cb) {
        if (aiWait) { if (cb) aiWait.push(cb); return; }
        aiWait = cb ? [cb] : [];
        if (typeof Cloud === 'undefined') return aiDone('offline');
        Cloud.get('settings/ai', 4000, function (e, data) {
            if (!e) AI.setManaged(data);
            else if (e === 'notfound') AI.setManaged({});          // none set any more
            aiDone(e === 'notfound' ? null : e);
        });
    }
    function aiDone(e) { var l = aiWait || []; aiWait = null; l.forEach(function (f) { try { f(e); } catch (x) {} }); }

    function errOf(e) { return { code: (e && e.code) || 'failed', message: String((e && e.message) || e || 'Failed.'), status: e && e.status || undefined }; }
    // ArrayBuffers in a result are moved to the app, not copied
    function buffers(o, out) {
        out = out || [];
        if (o instanceof ArrayBuffer) { if (out.indexOf(o) < 0) out.push(o); }
        else if (o && typeof o === 'object') for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) buffers(o[k], out);
        return out;
    }

    function attach(o) {
        var cfg = o.config && typeof o.config === 'object' ? o.config : {}, aiCfg = cfg.ai && typeof cfg.ai === 'object' ? cfg.ai : {};
        var ctx = { appId: o.appId, title: o.title || o.appId, refused: {}, dead: false, hold: o.hold, release: o.release };
        var nets = {}, nNet = 0, ais = {}, nAi = 0, mic = null, toldNoAi = false;
        var lan = cfg.lan === true;

        function send(type, d) { if (!ctx.dead) o.send(type, d, buffers(d)); }
        function alive() { var s = o.state(); return s === 'running' || s === 'paused' || s === 'loading'; }

        function net(d) {
            if (d.op === 'abort') { if (nets[d.rid]) nets[d.rid].abort(); return; }
            if (!alive()) return send('net', { rid: d.rid, error: { code: 'not-running', message: 'The app is not running.' } });
            if (nNet >= NET_MAX) return send('net', { rid: d.rid, error: { code: 'busy', message: 'Too many requests at once (' + NET_MAX + ').' } });
            nNet++;
            var req = d.req && typeof d.req === 'object' ? d.req : {};
            nets[d.rid] = WebProxy.request(req, { lan: lan }, function (piece) { send('net', { rid: d.rid, ev: 'chunk', text: piece }); }, function (e, r) {
                delete nets[d.rid]; nNet--;
                send('net', e ? { rid: d.rid, error: e } : { rid: d.rid, result: r });
            });
        }

        function aiRun(d) {
            var req = d.req && typeof d.req === 'object' ? d.req : {};
            if (d.op === 'cancel') { if (ais[d.rid]) ais[d.rid].cancel(); return; }
            if (d.op === 'providers') return send('ai', { rid: d.rid, result: AI.providers() });
            if (!alive()) return send('ai', { rid: d.rid, error: { code: 'not-running', message: 'The app is not running.' } });
            if (nAi >= AI_MAX) return send('ai', { rid: d.rid, error: { code: 'busy', message: 'Too many AI requests at once (' + AI_MAX + ').' } });
            var p = AI.resolve(req.provider, aiCfg.provider), own = req.provider && typeof req.provider === 'object';
            if (!own && Date.now() - AI.managedAt() > 1800000) {          // the copy is old (or none): get the App Store Manager's again
                if (!p && !d.synced) { d.synced = true; return syncAi(function () { aiRun(d); }); }
                syncAi();
            }
            if (!p) {
                if (!toldNoAi && !(req.provider && typeof req.provider === 'object')) { toldNoAi = true; App.toast(I18n.t('aiNone')); }
                return send('ai', { rid: d.rid, error: { code: 'no-provider', message: req.provider && typeof req.provider === 'object' ? 'The provider needs an https address.' :
                    'No AI service' + (req.provider ? ' "' + req.provider + '"' : '') + ' is set up for My PC. Add one in the App Store Manager (AI services).' } });
            }
            if (!req.mode && aiCfg.mode) req.mode = aiCfg.mode;          // Ollama: 'chat' | 'completion' for this app
            if (!p.own && !req.model && aiCfg.model && (!aiCfg.provider || aiCfg.provider === p.id || aiCfg.provider === p.preset || aiCfg.provider === p.type)) req.model = aiCfg.model;
            nAi++;
            ais[d.rid] = { cancel: function () { ais[d.rid].cancelled = true; } };       // until the question is answered
            function go(ok) {
                if (!ok || ais[d.rid].cancelled || ctx.dead) {
                    delete ais[d.rid]; nAi--;
                    return send('ai', { rid: d.rid, error: ok ? { code: 'cancelled', message: 'Cancelled.' } : { code: 'denied', message: 'The user did not allow this app to use AI.' } });
                }
                var job = d.op === 'raw' ? AI.raw(req, p, { lan: lan }) : AI.start(req, p, function (ev) { send('ai', Object.assign({ rid: d.rid }, ev)); }, { lan: lan });
                ais[d.rid] = job;
                job.promise.then(function (r) { delete ais[d.rid]; nAi--; send('ai', { rid: d.rid, result: r }); },
                                 function (e) { delete ais[d.rid]; nAi--; send('ai', { rid: d.rid, error: errOf(e) }); });
            }
            if (p.own) go(true);
            else ask(ctx, 'ai', I18n.t('permAiText').replace('%s', p.name), go);
        }

        function micEnd() { mic = null; micShown(false); }
        function micRun(d) {
            if (d.op === 'stop' || d.op === 'cancel') {
                if (!mic) return send('mic', { rid: d.rid, result: null });
                var r0 = mic.rid;
                if (d.op === 'cancel') { Mic.cancel(); micEnd(); return send('mic', { rid: d.rid, result: null }); }
                Mic.stop(function (e, res) { send('mic', { rid: d.rid, result: res, of: r0 }); });
                micEnd();
                return;
            }
            if (d.op !== 'start') return;
            if (o.state() !== 'running') return send('mic', { rid: d.rid, error: { code: 'not-running', message: 'The app is not running. Resume it first.' } });
            if (mic) return send('mic', { rid: d.rid, error: { code: 'busy', message: 'The microphone is already recording.' } });
            if (!Mic.supported() && !Mic.phone()) return send('mic', { rid: d.rid, error: { code: 'no-mic', message: 'This device gives no microphone to apps.' } });
            mic = { rid: d.rid, starting: true };
            ask(ctx, 'mic', I18n.t('permMicText'), function (ok) {
                if (!ok || ctx.dead || o.state() !== 'running') { mic = null; return send('mic', { rid: d.rid, error: ok ? { code: 'not-running', message: 'The app is not running.' } : { code: 'denied', message: 'The user did not allow this app to use the microphone.' } }); }
                var mine = mic;
                Mic.start(d.opts, function (ev, data) {
                    if (ev === 'end') { if (mic === mine) micEnd(); }
                    send('mic', Object.assign({ ev: ev, of: d.rid }, data));
                }, function (e, info) {
                    if (e) { if (mic === mine) mic = null; return send('mic', { rid: d.rid, error: e }); }
                    if (mic !== mine) { Mic.cancel(); return; }
                    mine.starting = false;
                    micShown(true);
                    send('mic', { rid: d.rid, result: info });
                });
            });
        }


        /* ----- MyPC.drive: the profile's Google Drive, every request sent by My PC (js/core/gdrive.js) ----- */
        var drives = {}, nDrive = 0;
        function dErr(e) { return { code: (e && e.code) || 'failed', message: String((e && e.message) || 'Failed.'), status: (e && e.status) || undefined }; }
        function driveAsk(cb) {
            var acc = GDrive.active();
            ask(ctx, 'drive', I18n.t(acc && acc.full ? 'permDriveTextFull' : 'permDriveText').replace('%s', acc ? acc.email : ''), cb);
        }
        function hold2(fn) { var paused = ctx.hold(); fn(function () { if (!ctx.dead) ctx.release(paused); }); }
        function driveRun(d) {
            var a = d.args && typeof d.args === 'object' ? d.args : {}, op = d.op;
            if (op === 'abort') { if (drives[d.rid]) drives[d.rid].abort(); return; }
            function reply(e, r) { delete drives[d.rid]; if (counted) nDrive--; counted = false; send('drive', e ? { rid: d.rid, error: dErr(e) } : { rid: d.rid, result: r === undefined ? null : r }); }
            var counted = false;
            if (op === 'status') {
                return GDrive.status(function (st) {
                    var ok = allowed(ctx.appId, 'drive'), acc = st.account;
                    send('drive', { rid: d.rid, result: { configured: st.code !== 'noconfig', signedIn: !!st.ok, needsSignIn: !st.ok && st.code !== 'noconfig', allowed: ok,
                        account: ok && acc ? { email: acc.email, name: acc.name, picture: acc.picture } : null, full: !!(acc && acc.full), picker: !!GDrive.pickerUrl() && !(acc && acc.full) } });
                });
            }
            if (!alive()) return send('drive', { rid: d.rid, error: { code: 'not-running', message: 'The app is not running.' } });
            if (op === 'signIn') {
                if (o.state() !== 'running') return send('drive', { rid: d.rid, error: { code: 'not-running', message: 'The app is not running. Resume it first.' } });
                return GDrive.status(function (st) {
                    if (st.ok) return driveAsk(function (ok) { send('drive', ok ? { rid: d.rid, result: { email: st.account.email, name: st.account.name, picture: st.account.picture } } : { rid: d.rid, error: { code: 'denied', message: 'The user did not allow this app to use Google Drive.' } }); });
                    hold2(function (release) {
                        DriveUI.signIn(function (e, acc) {
                            release();
                            if (e) return send('drive', { rid: d.rid, error: dErr(e) });
                            grant(ctx.appId, 'drive');            // signed in for this app, from this app: that is the user's yes
                            send('drive', { rid: d.rid, result: { email: acc.email, name: acc.name, picture: acc.picture } });
                        });
                    });
                });
            }
            if (op === 'addFiles') {
                if (o.state() !== 'running') return send('drive', { rid: d.rid, error: { code: 'not-running', message: 'The app is not running. Resume it first.' } });
                return hold2(function (release) { DriveUI.addFiles(function () { release(); send('drive', { rid: d.rid, result: true }); }); });
            }
            if (nDrive >= DRIVE_MAX) return send('drive', { rid: d.rid, error: { code: 'busy', message: 'Too many Drive requests at once (' + DRIVE_MAX + ').' } });
            nDrive++; counted = true;
            drives[d.rid] = { abort: function () { this.cancelled = true; } };
            GDrive.status(function (st) {
                if (ctx.dead || !drives[d.rid] || drives[d.rid].cancelled) return reply({ code: 'cancelled', message: 'Cancelled.' });
                if (!st.ok) return reply(st.code === 'noconfig' ? { code: 'noconfig', message: 'Google Drive is not set up for My PC yet (App Store Manager > Google Drive).' }
                    : st.code === 'reauth' ? { code: 'reauth', message: 'Google asks to sign in again. Call MyPC.drive.signIn().' } : { code: 'signed-out', message: 'No Google account on this profile. Call MyPC.drive.signIn().' });
                driveAsk(function (ok) {
                    if (!ok) return reply({ code: 'denied', message: 'The user did not allow this app to use Google Drive.' });
                    if (ctx.dead || !drives[d.rid] || drives[d.rid].cancelled) return reply({ code: 'cancelled', message: 'Cancelled.' });
                    function prog(p) { send('drive', { rid: d.rid, ev: 'progress', p: Math.round(p * 1000) / 1000 }); }
                    var h, id = String(a.id || '');
                    switch (op) {
                        case 'list': h = GDrive.list(a, reply); break;
                        case 'get': h = GDrive.get(id, reply); break;
                        case 'mkdir': h = GDrive.mkdir(a.name, a.parent, reply); break;
                        case 'rename': h = GDrive.rename(id, a.name, reply); break;
                        case 'move': h = GDrive.move(id, a.to, reply); break;
                        case 'copy': h = GDrive.copy(id, a.to, a.name, reply); break;
                        case 'star': h = GDrive.star(id, a.on !== false, reply); break;
                        case 'trash': h = GDrive.trash(id, reply); break;
                        case 'untrash': h = GDrive.untrash(id, reply); break;
                        case 'remove': h = GDrive.remove(id, reply); break;
                        case 'setInfo': h = GDrive.setInfo(id, a, reply); break;
                        case 'read': h = GDrive.read(id, a.start, a.end, reply); break;
                        case 'download': h = GDrive.download(id, { max: a.max, onProgress: a.progress ? prog : null }, reply); break;
                        case 'upload': h = GDrive.upload(a, a.progress ? prog : null, reply); break;
                        case 'export': h = GDrive.exportFile(id, a.mime, reply); break;
                        case 'thumb': h = GDrive.thumb(a.link, a.size, reply); break;
                        case 'about': h = GDrive.about(reply); break;
                        case 'appFolder': h = GDrive.appFolder(sid(ctx.appId), ctx.title, reply); break;
                        default: return reply({ code: 'bad-request', message: 'Unknown Drive operation ' + op + '.' });
                    }
                    if (drives[d.rid]) drives[d.rid] = h;
                });
            });
        }

        /* ----- MyPC.usb and MyPC.copy (API 16): the TV's USB drives, and copies Drive <-> USB done by My PC ----- */
        var unwatch = null;
        function usbAsk(cb) { ask(ctx, 'usb', I18n.t('permUsbText'), cb); }
        function usbRun(d) {
            var a = d.args && typeof d.args === 'object' ? d.args : {};
            function reply(e, r) { send('usb', e ? { rid: d.rid, error: dErr(e) } : { rid: d.rid, result: r === undefined ? null : r }); }
            if (!alive()) return reply({ code: 'not-running', message: 'The app is not running.' });
            if (!UsbFs.supported()) return reply({ code: 'unsupported', message: 'This device has no USB drives (only a TV has them).' });
            usbAsk(function (ok) {
                if (!ok) return reply({ code: 'denied', message: 'The user did not allow this app to use the USB drives.' });
                if (ctx.dead) return;
                UsbFs.drives(function (e, list) {
                    if (e) return reply(e);
                    if (d.op === 'drives') return reply(null, list);
                    var p = String(a.path || '');
                    if (!UsbFs.inside(p)) return reply({ code: 'bad-request', message: 'Not a path inside a plugged USB drive.' });
                    switch (d.op) {
                        case 'list': return UsbFs.list(p, reply);
                        case 'stat': return UsbFs.stat(p, reply);
                        case 'mkdir':
                            var q = UsbFs.join(p, UsbFs.safeName(a.name));
                            return UsbFs.mkdir(q, function (x) { reply(x, x ? null : { name: UsbFs.base(q), path: q, dir: true, size: 0 }); });
                        case 'read':
                            var at = Math.max(0, Math.floor(+a.start || 0)), end = a.end === undefined || a.end === null ? at + 4194303 : Math.floor(+a.end);
                            if (!(end >= at) || end - at >= 16777216) return reply({ code: 'bad-request', message: 'Read 16 MB at most at a time.' });
                            return UsbFs.read(p, at, end - at + 1, function (x, u8) {
                                if (x) return reply(x);
                                var buf = u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength ? u8.buffer : u8.slice().buffer;
                                reply(null, { buf: buf });
                            });
                    }
                    reply({ code: 'bad-request', message: 'Unknown USB operation ' + d.op + '.' });
                });
            });
        }
        function copyRun(d) {
            var a = d.args && typeof d.args === 'object' ? d.args : {}, app = sid(ctx.appId);
            function reply(e, r) { send('copy', e ? { rid: d.rid, error: dErr(e) } : { rid: d.rid, result: r === undefined ? null : r }); }
            function own(id) { var l = CopyJobs.list(app); for (var i = 0; i < l.length; i++) if (l[i].id === id) return true; return false; }
            if (d.op === 'jobs') return reply(null, CopyJobs.list(app));
            if (d.op === 'watch') {
                if (!unwatch) {
                    CopyJobs.watch(app, true);
                    unwatch = CopyJobs.onChange(function (job) { if (job.app === app && !ctx.dead) send('copy', { rid: 0, ev: 'job', job: job }); });
                }
                return reply(null, true);
            }
            if (d.op === 'pause' || d.op === 'resume' || d.op === 'cancel' || d.op === 'clear') {
                var id = String(a.id || '');
                if (!own(id)) return reply({ code: 'not-found', message: 'No copy of this app has this id.' });
                return reply(null, CopyJobs[d.op](id));
            }
            if (d.op !== 'start') return reply({ code: 'bad-request', message: 'Unknown copy operation ' + d.op + '.' });
            if (!alive()) return reply({ code: 'not-running', message: 'The app is not running.' });
            if (!UsbFs.supported()) return reply({ code: 'unsupported', message: 'This device has no USB drives (only a TV has them).' });
            GDrive.status(function (st) {
                if (!st.ok) return reply(st.code === 'noconfig' ? { code: 'noconfig', message: 'Google Drive is not set up for My PC yet (App Store Manager > Google Drive).' }
                    : st.code === 'reauth' ? { code: 'reauth', message: 'Google asks to sign in again. Call MyPC.drive.signIn().' } : { code: 'signed-out', message: 'No Google account on this profile. Call MyPC.drive.signIn().' });
                driveAsk(function (ok) {
                    if (!ok) return reply({ code: 'denied', message: 'The user did not allow this app to use Google Drive.' });
                    usbAsk(function (ok2) {
                        if (!ok2) return reply({ code: 'denied', message: 'The user did not allow this app to use the USB drives.' });
                        if (ctx.dead) return;
                        CopyJobs.start({ dir: a.dir, items: a.items, dest: a.dest, ifExists: a.ifExists, app: app, appTitle: ctx.title }, reply);
                    });
                });
            });
        }

        return {
            handle: function (type, d) {
                if (type !== 'net' && type !== 'ai' && type !== 'mic' && type !== 'drive' && type !== 'usb' && type !== 'copy') return false;
                if (!d || typeof d !== 'object' || typeof d.rid !== 'number') return true;
                if (type === 'net') net(d); else if (type === 'ai') aiRun(d); else if (type === 'drive') driveRun(d); else if (type === 'usb') usbRun(d); else if (type === 'copy') copyRun(d); else micRun(d);
                return true;
            },
            // My PC's menu or another screen covers the app: it stops listening (the app gets 'end' with reason 'paused')
            pause: function () { if (mic && !mic.starting) { Mic.end('paused'); micEnd(); } },
            destroy: function () {
                ctx.dead = true;
                Object.keys(nets).forEach(function (k) { try { nets[k].abort(); } catch (e) {} });
                Object.keys(ais).forEach(function (k) { try { ais[k].cancel(); } catch (e) {} });
                Object.keys(drives).forEach(function (k) { try { drives[k].abort(); } catch (e) {} });
                nets = {}; ais = {}; drives = {};
                if (unwatch) { unwatch(); unwatch = null; CopyJobs.watch(sid(ctx.appId), false); }
                if (DriveUI.screenOpen()) DriveUI.close();
                if (mic) { Mic.cancel(); micEnd(); }
                queue = queue.filter(function (q) { return q.ctx !== ctx; });
            }
        };
    }

    return { attach: attach, allowed: allowed, forget: forget, reset: reset, syncAi: syncAi };
})();
