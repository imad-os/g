/* What installed apps cannot do from their sandboxed iframe, done by My PC for them (sdk/mypc-sdk.js):
 *   'net'  MyPC.net    web requests without CORS limits (js/core/web-proxy.js)
 *   'ai'   MyPC.ai     AI services set up in the App Store Manager (copied at start, Bridges.syncAi), keys never sent to apps (js/core/ai.js)
 *   'mic'  MyPC.mic    the microphone (js/core/mic.js)
 * The AI services of this TV and the microphone are used only after the user allowed it, once per app (arc_dev_perm,
 * Settings > Privacy & security forgets it). An app that brings its own AI key needs no permission. A red microphone
 * shows while an app listens.
 *
 *   var b = Bridges.attach({ appId, title, config, send(type, data, transfer), hold(), release(paused), state() })
 *   b.handle(type, data) -> true when it was one of ours     b.pause()    b.destroy() */
var Bridges = (function () {
    'use strict';

    var PERM = 'arc_dev_perm', NET_MAX = 8, AI_MAX = 4;
    var queue = [], asking = false, micDot = null;

    function perms() { var p = Store.rawGet(PERM); return p && typeof p === 'object' ? p : {}; }
    function allowed(app, kind) { var p = perms()[app]; return !!(p && p[kind]); }
    function grant(app, kind) { var p = perms(); p[app] = p[app] || {}; p[app][kind] = 1; Store.rawSet(PERM, p); }
    function reset() { try { localStorage.removeItem(PERM); } catch (e) {} }

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
        App.confirm(I18n.t(q.kind === 'mic' ? 'permMicTitle' : 'permAiTitle').replace('%s', ctx.title), q.text, function () { done(true); },
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
            if (!Mic.supported()) return send('mic', { rid: d.rid, error: { code: 'no-mic', message: 'This device gives no microphone to apps.' } });
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

        return {
            handle: function (type, d) {
                if (type !== 'net' && type !== 'ai' && type !== 'mic') return false;
                if (!d || typeof d !== 'object' || typeof d.rid !== 'number') return true;
                if (type === 'net') net(d); else if (type === 'ai') aiRun(d); else micRun(d);
                return true;
            },
            // My PC's menu or another screen covers the app: it stops listening (the app gets 'end' with reason 'paused')
            pause: function () { if (mic && !mic.starting) { Mic.end('paused'); micEnd(); } },
            destroy: function () {
                ctx.dead = true;
                Object.keys(nets).forEach(function (k) { try { nets[k].abort(); } catch (e) {} });
                Object.keys(ais).forEach(function (k) { try { ais[k].cancel(); } catch (e) {} });
                nets = {}; ais = {};
                if (mic) { Mic.cancel(); micEnd(); }
                queue = queue.filter(function (q) { return q.ctx !== ctx; });
            }
        };
    }

    return { attach: attach, allowed: allowed, reset: reset, syncAi: syncAi };
})();
