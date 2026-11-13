/* Bug reports: an app or game sends what the player saw (MyPC.bug: a note, a log of what happened, a screenshot), saved in
 * Firestore "bugs" so the developer can read it (the rules let anyone read a bug by its id or list them: never put personal
 * data in one; no TV code, no profile name is saved). Only when the player asks for it (a button in the app).
 *   Bugs.send(app, { note, data, img, appv }, cb)   cb(err, id): err 'busy' | 'limit' | 'big' | 'network' | 'http <n>'
 * At most 10 per page and 50 per TV per day; each expires after 30 days (TTL `exp`). Sizes: note 500, data 300 000 characters
 * (JSON text), img a JPEG data URL of at most 600 000 characters. */
var Bugs = (function () {
    'use strict';

    var DAY = 'arc_dev_bugs_day', PER_PAGE = 10, PER_DAY = 50, TTL_DAYS = 30;
    var sent = 0, busy = false;

    function str(v, n) { v = v === undefined || v === null ? '' : String(v); return v.length > n ? v.slice(0, n) : v; }
    function today() { return new Date().toISOString().slice(0, 10); }
    function dayCount() { var d = Store.rawGet(DAY); return d && d.d === today() ? d.n | 0 : 0; }
    function id() { var s = '', a = 'abcdefghijklmnopqrstuvwxyz0123456789'; for (var i = 0; i < 20; i++) s += a.charAt(Math.floor(Math.random() * 36)); return s; }

    function send(app, r, cb) {
        cb = cb || function () {};
        r = r || {};
        if (busy) { cb('busy'); return; }
        if (sent >= PER_PAGE || dayCount() >= PER_DAY) { cb('limit'); return; }
        var data = typeof r.data === 'string' ? r.data : '', img = typeof r.img === 'string' ? r.img : '';
        if (data.length > 300000 || img.length > 600000) { cb('big'); return; }
        if (img && !/^data:image\/(jpeg|png|webp);base64,/.test(img)) img = '';
        var at = typeof Cloud.now === 'function' ? Cloud.now() : Date.now(), d = {
            app: str(app || 'mypc', 40), appv: str(r.appv, 20), note: str(r.note, 500), data: data, img: img,
            at: new Date(at), exp: new Date(at + TTL_DAYS * 86400000), model: '', ver: '', build: 0, lang: '',
            where: typeof tizen !== 'undefined' ? 'tv' : typeof MyPCNative !== 'undefined' ? 'apk' : 'web'
        };
        try { d.model = str(Device.model(), 60); } catch (e) {}
        try { d.ver = str(AppBoot.version(), 20); d.build = AppBoot.build() | 0; } catch (e) {}
        try { d.lang = str(I18n.lang(), 5); } catch (e) {}
        var key = id();
        busy = true;
        Cloud.commit([{ update: { name: Cloud.docName('bugs/' + key), fields: Cloud.toFields(d) }, currentDocument: { exists: false } }], 30000, function (err) {
            busy = false;
            if (err) { cb(err); return; }
            sent++;
            Store.rawSet(DAY, { d: today(), n: dayCount() + 1 });
            cb(null, key);
        });
    }

    return { send: send };
})();
