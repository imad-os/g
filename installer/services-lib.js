/* Push notification services: the rules the App Store Manager's Services tab applies (installer/services.js).
 * Pure functions, also used by tests/unit-tests.mjs (Node). Guide for app makers: sdk/GUIDE.md, "Push notifications".
 *
 * An app lists its services in mypc-app.json ("services": [{ id, file, every, title }]). The Manager loads the file,
 * runs its default export in a Web Worker started from a data: address (an opaque origin: the app's code cannot read the
 * admin's Firebase sign-in or the page), checks what it returns and writes one inbox item per row:
 * Firestore inbox/<username>/items/<id>, shown by My PC on every TV or phone that account is signed in to. */
(function (root) {
    'use strict';

    var EVERY = [1, 5, 10, 30];                       // minutes between two runs (the Services tab's choice)
    var LIMITS = { perRun: 100, perHour: 20, title: 60, message: 200, url: 300, state: 10000, runMs: 20000, keepDays: 30 };
    var SVC_ID = /^[a-z0-9-]{1,20}$/;

    function isObject(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
    function str(v) { return typeof v === 'string' ? v.trim() : ''; }
    function https(u) { return /^https:\/\/[^\s"'<>]+$/.test(u) && u.length <= LIMITS.url; }

    // "services" of mypc-app.json -> what goes into the app's store document (throws an Error with a readable message)
    function parseServices(list, base) {
        if (!Array.isArray(list)) throw new Error('"services" must be a list like [{ "id": "goals", "file": "services/notify.js" }].');
        if (list.length > 3) throw new Error('"services" has more than 3 entries.');
        var seen = {};
        return list.map(function (s, i) {
            var at = '"services[' + i + ']"';
            if (!isObject(s)) throw new Error(at + ' must be an object.');
            var id = str(s.id).toLowerCase();
            if (!SVC_ID.test(id) || id === 'updates') throw new Error(at + ' needs an "id" of 1 to 20 characters: a-z, 0-9 and "-" (not "updates").');
            if (seen[id]) throw new Error(at + ': the id "' + id + '" is used twice.');
            seen[id] = 1;
            if (!str(s.file)) throw new Error(at + ' needs a "file" (the address of its .js file).');
            var file;
            try { file = new URL(str(s.file), base).href; } catch (e) { throw new Error(at + ' "file" is not a valid address.'); }
            if (!/^https:\/\//.test(file) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(file)) throw new Error(at + ' "file" must be on https://.');
            var every = s.every === undefined ? 5 : +s.every;
            if (EVERY.indexOf(every) < 0) throw new Error(at + ' "every" must be one of ' + EVERY.join(', ') + ' (minutes).');
            var title = str(s.title).slice(0, 40) || id;
            return { id: id, file: file, every: every, title: title };
        });
    }

    // Is this service's next run due? svc = its Services document (every, lastRun)
    function due(svc, now) {
        var every = EVERY.indexOf(svc && svc.every) >= 0 ? svc.every : 5;
        return !(svc && svc.lastRun) || now - svc.lastRun >= every * 60000 - 5000;      // 5 s early is fine (timer drift)
    }

    // the rows a service returned -> { items: [{ user, title, text, image, link }], dropped, why: { reason: n }, state }
    //   out          what the function returned: { notifications: [...], state } (or the list itself)
    //   subscribers  usernames that allowed notifications from this app
    //   sent         { username: [times sent this last hour] } for this app (updated here)
    function checkRows(out, subscribers, sent, now) {
        var why = {}, items = [], dropped = 0, subs = {}, i;
        function drop(reason) { dropped++; why[reason] = (why[reason] || 0) + 1; }
        (subscribers || []).forEach(function (u) { subs[String(u).toLowerCase()] = 1; });
        var list = Array.isArray(out) ? out : isObject(out) && Array.isArray(out.notifications) ? out.notifications : null;
        var res = { items: items, dropped: 0, why: why, state: undefined, error: '' };
        if (isObject(out) && out.state !== undefined) {
            var js = '';
            try { js = JSON.stringify(out.state); } catch (e) { js = ''; }
            if (js && js.length <= LIMITS.state) res.state = js; else res.error = 'state is not JSON or bigger than ' + LIMITS.state + ' characters (not saved)';
        }
        if (!list) {
            if (out !== null && out !== undefined && !isObject(out)) res.error = 'the function must return { notifications: [...], state }';
            return res;
        }
        sent = sent || {};
        for (i = 0; i < list.length; i++) {
            var r = list[i];
            if (!isObject(r)) { drop('not an object'); continue; }
            var title = str(r.title), text = str(r.message !== undefined ? r.message : r.text);
            if (!title) { drop('no title'); continue; }
            if (title.length > LIMITS.title) title = title.slice(0, LIMITS.title - 1) + '…';
            if (text.length > LIMITS.message) text = text.slice(0, LIMITS.message - 1) + '…';
            var image = str(r.image), link = str(r.link);
            if (image && !https(image)) { drop('image not https'); continue; }
            if (link && !https(link) && !/^app(\?[^\s"'<>]*)?$/.test(link)) { drop('link not https or app?...'); continue; }
            if (link.length > LIMITS.url) { drop('link too long'); continue; }
            var to = str(r.username !== undefined ? r.username : r.to).toLowerCase();
            var users = to === '*' ? Object.keys(subs) : subs[to] ? [to] : [];
            if (!users.length) { drop(to ? 'user did not allow notifications' : 'no username'); continue; }
            for (var k = 0; k < users.length; k++) {
                var u = users[k], times = (sent[u] || []).filter(function (t) { return now - t < 3600000; });
                sent[u] = times;
                if (items.length >= LIMITS.perRun) { drop('more than ' + LIMITS.perRun + ' in one run'); continue; }
                if (times.length >= LIMITS.perHour) { drop('more than ' + LIMITS.perHour + ' an hour for one user'); continue; }
                times.push(now);
                var it = { user: u, title: title, text: text };
                if (image) it.image = image;
                if (link) it.link = link;
                items.push(it);
            }
        }
        res.dropped = dropped;
        return res;
    }

    // one inbox document (Firestore inbox/<user>/items/<id>)
    function inboxItem(it, app, now, exp) {
        var d = { app: app.id, name: String(app.name || app.id).slice(0, 40), title: it.title, text: it.text || '', at: now, exp: exp };
        if (it.image) d.image = it.image;
        if (it.link) d.link = it.link;
        return d;
    }
    function itemId(app, now, i) { return (app + '-' + now.toString(36) + '-' + i).slice(0, 60); }

    // the Worker that runs an app's service (started from a data: address: its own opaque origin)
    var WORKER = [
        'self.onmessage = async function (e) {',
        '  var d = e.data;',
        '  try {',
        '    var m = await import(d.src);',
        '    var f = m && (typeof m.default === "function" ? m.default : m.run);',
        '    if (typeof f !== "function") throw new Error("the file must export a function: export default async function (ctx) { ... }");',
        '    var ctx = Object.freeze({ app: d.app, service: d.service, subscribers: d.subscribers, state: d.state, config: d.config,',
        '      now: d.now, lastRun: d.lastRun, fetch: self.fetch.bind(self) });',
        '    var out = await f(ctx);',
        '    postMessage({ ok: true, out: out === undefined ? null : JSON.parse(JSON.stringify(out)) });',
        '  } catch (err) { postMessage({ ok: false, error: String(err && (err.stack || err.message) || err).slice(0, 600) }); }',
        '};'
    ].join('\n');

    var api = { EVERY: EVERY, LIMITS: LIMITS, parseServices: parseServices, due: due, checkRows: checkRows, inboxItem: inboxItem, itemId: itemId, WORKER: WORKER };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ServicesLib = api;
})(this);
