/* Error reports: what went wrong in an app, a game or My PC itself, saved in Firestore "errors" for the App Store
 * Manager (Errors page). Cheap on a small TV: nothing is sent while things work.
 *   Reports.add(app, r)   r: { kind, msg, stack, src, stage, appv, sdk, n }   app: 'mypc', a game id or 'app-<id>'
 *   Reports.on() / setOn(v)   Settings > Privacy & security > Send error reports (on by default)
 *   Reports.flush()           sends what is waiting now
 * Kinds: 'load' (the app never opened: timeout, page missing, SDK never answered), 'start' (start() threw),
 * 'failed' (MyPC.fail), 'error' / 'rejection' / 'resource' (uncaught in the app), 'handler' (an SDK callback threw),
 * 'report' (MyPC.report), 'shell' (My PC's own code).
 * The same error (app + kind + message + place) is one report with a count `n`: it is held 4 s so repeats add up,
 * then later repeats on this page are only counted. At most 8 reports per app per page, 60 per TV per day.
 * When the page goes away (an app is closed by loading the desktop page) or the TV is offline, up to 20 wait in
 * arc_dev_reports_q and go a few seconds after the next page starts. Each report expires after 30 days (TTL `exp`). */
var Reports = (function () {
    'use strict';

    var OFF = 'arc_dev_reports_off', QUEUE = 'arc_dev_reports_q', DAY = 'arc_dev_reports_day';
    var HOLD_MS = 4000, PER_APP = 8, PER_DAY = 60, KEEP = 20, TTL_DAYS = 30, BATCH = 10;
    var queue = [], seen = {}, perApp = {}, timer = 0, busy = false;
    var KINDS = /^(load|start|failed|error|rejection|resource|handler|report|shell)$/;

    function on() { return !Store.rawGet(OFF); }
    function setOn(v) { Store.rawSet(OFF, !v); if (!v) { queue = []; Store.rawSet(QUEUE, []); clearTimeout(timer); } }

    function str(v, n) { v = v === undefined || v === null ? '' : String(v); return v.length > n ? v.slice(0, n) : v; }

    function today() { return new Date().toISOString().slice(0, 10); }
    function dayCount() { var d = Store.rawGet(DAY); return d && d.d === today() ? d.n | 0 : 0; }
    function addDay(n) { Store.rawSet(DAY, { d: today(), n: dayCount() + n }); }

    // who and where: filled when the report is made (the profile can change later)
    function context() {
        var c = { tv: '', model: '', ver: '', build: 0, lang: '', user: '', ua: str(navigator.userAgent, 160) };
        try { c.tv = Device.id(); c.model = Device.model(); } catch (e) {}
        try { c.ver = String(AppBoot.version()); c.build = AppBoot.build() | 0; } catch (e) {}
        try { c.lang = I18n.lang(); } catch (e) {}
        try { var p = Profiles.current(); c.user = p.user ? '@' + p.user : Profiles.name(p, '') || p.id; } catch (e) {}
        c.where = typeof tizen !== 'undefined' ? 'tv' : typeof MyPCNative !== 'undefined' ? 'apk' : 'web';
        return c;
    }

    function add(app, r) {
        if (!on() || !r) return;
        app = str(app || 'mypc', 40);
        var kind = KINDS.test(r.kind) ? r.kind : 'error', msg = str(r.msg, 300) || '(no message)', src = str(r.src, 200);
        var key = app + '|' + kind + '|' + msg + '|' + src;
        if (seen[key]) { seen[key].n += Math.max(1, r.n | 0); return; }          // held (adds to the count) or sent already (counted only)
        if ((perApp[app] || 0) >= PER_APP) return;
        perApp[app] = (perApp[app] || 0) + 1;
        var c = context(), at = typeof Cloud.now === 'function' ? Cloud.now() : Date.now();
        var rep = { app: app, kind: kind, msg: msg, stack: str(r.stack, 1500), src: src, stage: str(r.stage, 20), appv: str(r.appv, 20), sdk: r.sdk | 0,
                    n: Math.max(1, r.n | 0), at: at, tv: c.tv, model: str(c.model, 60), ver: str(c.ver, 20), build: c.build, lang: str(c.lang, 5),
                    user: str(c.user, 30), where: c.where, ua: c.ua, url: str(r.url, 200) };
        seen[key] = rep;
        queue.push(rep);
        clearTimeout(timer);
        timer = setTimeout(flush, HOLD_MS);
    }

    function id() { var s = '', a = 'abcdefghijklmnopqrstuvwxyz0123456789'; for (var i = 0; i < 20; i++) s += a.charAt(Math.floor(Math.random() * 36)); return s; }

    function write(rep) {
        var d = {}, k;
        for (k in rep) if (rep.hasOwnProperty(k)) d[k] = rep[k];
        d.at = new Date(rep.at);
        d.exp = new Date(rep.at + TTL_DAYS * 86400000);
        return { update: { name: Cloud.docName('errors/' + id()), fields: Cloud.toFields(d) }, currentDocument: { exists: false } };
    }

    function flush() {
        clearTimeout(timer);
        if (!on() || busy) return;
        var list = queue.splice(0, queue.length).concat(Store.rawGet(QUEUE) || []);
        if (!list.length) return;
        var room = Math.max(0, PER_DAY - dayCount());
        if (list.length > room) list.length = room;
        if (!list.length) { Store.rawSet(QUEUE, []); return; }
        var batch = list.slice(0, BATCH), rest = list.slice(BATCH), writes = [];
        for (var i = 0; i < batch.length; i++) writes.push(write(batch[i]));
        Store.rawSet(QUEUE, rest.slice(0, KEEP));
        busy = true;
        Cloud.commit(writes, 8000, function (err) {
            busy = false;
            if (err === 'network') { Store.rawSet(QUEUE, batch.concat(rest).slice(0, KEEP)); return; }     // offline: next start
            addDay(batch.length);
            if (rest.length) timer = setTimeout(flush, 1000);
        });
    }

    // My PC's own uncaught errors (not the apps': those come from their frame, see game-host.js)
    function shellError(e) {
        if (!e) return;
        var er = e.error || e.reason;
        if (e.type === 'unhandledrejection') add('mypc', { kind: 'shell', msg: 'Unhandled promise: ' + str(er && er.message || er, 260), stack: er && er.stack, stage: page() });
        else add('mypc', { kind: 'shell', msg: e.message || String(er), stack: er && er.stack, src: e.filename ? e.filename.replace(/^.*\/(?=[^\/]+\/[^\/]+$)/, '') + ':' + e.lineno + ':' + e.colno : '', stage: page() });
    }
    function page() { return /[?&]play=/.test(location.search) ? 'play' : 'desktop'; }

    try {
        window.addEventListener('error', shellError);
        window.addEventListener('unhandledrejection', shellError);
        // leaving the page: what is still held is saved for the next page (a request now would be cut off)
        window.addEventListener('pagehide', function () { if (on() && queue.length) Store.rawSet(QUEUE, queue.splice(0, queue.length).concat(Store.rawGet(QUEUE) || []).slice(0, KEEP)); });
    } catch (e) {}
    setTimeout(function () { if ((Store.rawGet(QUEUE) || []).length) flush(); }, 5000);      // reports saved by the last page, or while offline

    return { add: add, flush: flush, on: on, setOn: setOn, pending: function () { return queue.length; } };
})();
