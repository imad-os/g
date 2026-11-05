/* Desktop widgets: the rules shared by the TV (js/launcher/widgets.js), the App Store Manager (installer/widgets.js,
 * installer/installer-lib.js) and the tests (tests/unit-tests.mjs, Node). Pure functions, no DOM.
 * Guide for app makers: sdk/GUIDE.md, "Desktop widgets".
 *
 * An app lists its widgets in mypc-app.json ("widgets": [{ id, title, file, size, every, background, settings }]).
 * An admin approves each widget's code in the App Store Manager > Widgets: the approved code is copied into Firestore
 * widgets/<app>__<widget> and its SHA-256 into the app's document. A TV runs only that copy, in a Web Worker started
 * from a data: address (an opaque origin: no My PC storage, no sign-ins, no DOM), once per refresh, killed after 10 s.
 * The widget returns a VIEW (plain data); My PC draws it in its own look, so a widget costs nothing between refreshes. */
(function (root) {
    'use strict';

    var EVERY = [1, 5, 15, 30, 60];                     // minutes between two refreshes of an app widget
    var SIZES = ['small', 'medium', 'large'];
    var TYPES = ['toggle', 'select', 'text'];
    var LIMITS = { widgets: 3, settings: 8, options: 12, code: 60000, state: 4000, runMs: 10000, title: 40, text: 160, big: 24,
                   rows: 5, buttons: 3, label: 24, value: 40, url: 400, link: 300 };
    var ID = /^[a-z0-9-]{1,20}$/;

    function isObject(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
    function str(v) { return typeof v === 'string' ? v.trim() : typeof v === 'number' && isFinite(v) ? String(v) : ''; }
    function cut(s, n) { s = str(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
    function https(u) { return typeof u === 'string' && u.length <= LIMITS.url && /^https:\/\/[^\s"'<>()\\]+$/.test(u); }
    // a label in one language, or { en, fr, es, ar }
    function label(v, n) {
        if (isObject(v)) {
            var o = {}, any = false;
            ['en', 'fr', 'es', 'ar'].forEach(function (l) { if (str(v[l])) { o[l] = cut(v[l], n); any = true; } });
            return any ? o : '';
        }
        return cut(v, n);
    }

    // one widget's own settings: [{ id, label, type: 'toggle' | 'select' | 'text', default, options: [{ value, label }] }]
    function parseSettings(list, at) {
        if (list === undefined) return [];
        if (!Array.isArray(list)) throw new Error(at + ' "settings" must be a list.');
        if (list.length > LIMITS.settings) throw new Error(at + ' "settings" has more than ' + LIMITS.settings + ' entries.');
        var seen = {};
        return list.map(function (s, i) {
            var a = at + ' "settings[' + i + ']"';
            if (!isObject(s)) throw new Error(a + ' must be an object.');
            var id = str(s.id);
            if (!/^[a-zA-Z0-9_]{1,20}$/.test(id) || seen[id]) throw new Error(a + ' needs a unique "id" (letters, digits, _).');
            seen[id] = 1;
            var type = s.type || 'toggle';
            if (TYPES.indexOf(type) < 0) throw new Error(a + ' "type" must be one of ' + TYPES.join(', ') + '.');
            var out = { id: id, label: label(s.label, LIMITS.title) || id, type: type };
            if (type === 'toggle') out['default'] = s['default'] === true;
            else if (type === 'text') out['default'] = cut(s['default'] || '', 60);
            else {
                if (!Array.isArray(s.options) || !s.options.length || s.options.length > LIMITS.options) throw new Error(a + ' needs 1 to ' + LIMITS.options + ' "options": [{ "value": "c", "label": "Celsius" }].');
                out.options = s.options.map(function (o, k) {
                    if (!isObject(o) || !str(o.value)) throw new Error(a + ' "options[' + k + ']" needs a "value".');
                    return { value: cut(o.value, 40), label: label(o.label, LIMITS.label) || cut(o.value, LIMITS.label) };
                });
                var d = str(s['default']);
                out['default'] = out.options.some(function (o) { return o.value === d; }) ? d : out.options[0].value;
            }
            return out;
        });
    }

    // "widgets" of mypc-app.json -> what goes into the app's store document (throws an Error with a readable message)
    function parseWidgets(list, base) {
        if (!Array.isArray(list)) throw new Error('"widgets" must be a list like [{ "id": "score", "file": "widget/score.js" }].');
        if (list.length > LIMITS.widgets) throw new Error('"widgets" has more than ' + LIMITS.widgets + ' entries.');
        var seen = {};
        return list.map(function (w, i) {
            var at = '"widgets[' + i + ']"';
            if (!isObject(w)) throw new Error(at + ' must be an object.');
            var id = str(w.id).toLowerCase();
            if (!ID.test(id)) throw new Error(at + ' needs an "id" of 1 to 20 characters: a-z, 0-9 and "-".');
            if (seen[id]) throw new Error(at + ': the id "' + id + '" is used twice.');
            seen[id] = 1;
            if (!str(w.file)) throw new Error(at + ' needs a "file" (the address of its .js file).');
            var file;
            try { file = new URL(str(w.file), base).href; } catch (e) { throw new Error(at + ' "file" is not a valid address.'); }
            if (!/^https:\/\//.test(file) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(file)) throw new Error(at + ' "file" must be on https://.');
            var every = w.every === undefined ? 15 : +w.every;
            if (EVERY.indexOf(every) < 0) throw new Error(at + ' "every" must be one of ' + EVERY.join(', ') + ' (minutes).');
            var size = w.size === undefined ? 'medium' : w.size;
            if (SIZES.indexOf(size) < 0) throw new Error(at + ' "size" must be one of ' + SIZES.join(', ') + '.');
            var out = { id: id, title: label(w.title, LIMITS.title) || id, file: file, size: size, every: every, background: w.background === true };
            var d = label(w.description, 120);
            if (d) out.description = d;
            var st = parseSettings(w.settings, at);
            if (st.length) out.settings = st;
            return out;
        });
    }

    // an update of the app keeps the approvals of its widgets (the approved copy stays in Firestore until approved again)
    function keepApprovals(list, old) {
        return (list || []).map(function (w) {
            var o = null;
            (old || []).forEach(function (x) { if (x && x.id === w.id) o = x; });
            var n = {}, k;
            for (k in w) n[k] = w[k];
            if (o && o.sha) { n.sha = o.sha; if (o.approvedAt) n.approvedAt = o.approvedAt; }
            return n;
        });
    }

    // a widget's settings (as the user changed them) over its defaults
    function settingsOf(schema, saved) {
        var out = {};
        (schema || []).forEach(function (s) {
            var v = saved && saved[s.id];
            if (s.type === 'toggle') out[s.id] = typeof v === 'boolean' ? v : !!s['default'];
            else if (s.type === 'text') out[s.id] = typeof v === 'string' ? v.slice(0, 60) : s['default'] || '';
            else out[s.id] = (s.options || []).some(function (o) { return o.value === v; }) ? v : s['default'];
        });
        return out;
    }

    // what a widget returned -> the view My PC draws (anything else is dropped). Also used for the built-in widgets.
    //   { title, icon, big, sub, text, image, progress (0..1), rows: [{ label, value }], buttons: [{ id, label, icon }],
    //     accent '#rrggbb', link '<path>' (opens the app there on OK) }
    function cleanView(v, builtIn) {
        if (!isObject(v)) return { text: '' };
        var out = {};
        if (str(v.title)) out.title = cut(v.title, LIMITS.title);
        if (str(v.big)) out.big = cut(v.big, LIMITS.big);
        if (str(v.sub)) out.sub = cut(v.sub, 60);
        if (str(v.text)) out.text = cut(v.text, LIMITS.text);
        var ic = str(v.icon);
        if (ic && (https(ic) || (builtIn && /^i:[a-zA-Z0-9]{1,20}$/.test(ic)) || (!/^(i:|[a-z]+:)/i.test(ic) && ic.length <= 4))) out.icon = ic;
        if (https(v.image)) out.image = v.image;
        var p = +v.progress;
        if (v.progress !== undefined && v.progress !== null && isFinite(p)) out.progress = Math.max(0, Math.min(1, p));
        if (Array.isArray(v.rows)) {
            out.rows = v.rows.filter(isObject).slice(0, LIMITS.rows).map(function (r) { return { label: cut(r.label, LIMITS.label), value: cut(r.value, LIMITS.value) }; })
                .filter(function (r) { return r.label || r.value; });
            if (!out.rows.length) delete out.rows;
        }
        if (Array.isArray(v.buttons)) {
            out.buttons = v.buttons.filter(isObject).slice(0, LIMITS.buttons).map(function (b) {
                var o = { id: cut(b.id, 20), label: cut(b.label, LIMITS.label) };
                if (builtIn && /^[a-zA-Z0-9]{1,20}$/.test(str(b.icon))) o.icon = str(b.icon);
                return o;
            }).filter(function (b) { return b.id && (b.label || b.icon); });
            if (!out.buttons.length) delete out.buttons;
        }
        // built-in widgets only: a big picture beside the big value (Weather), sizes in px, warnings
        if (builtIn) {
            if (/^[a-zA-Z0-9]{1,20}$/.test(str(v.art))) out.art = str(v.art);
            if (+v.bigSize >= 24 && +v.bigSize <= 120) out.bigSize = Math.round(+v.bigSize);
            if (+v.artSize >= 40 && +v.artSize <= 200) out.artSize = Math.round(+v.artSize);
            if (Array.isArray(v.alerts)) out.alerts = v.alerts.filter(isObject).slice(0, 2).map(function (a) { return { level: a.level === 'danger' ? 'danger' : 'warn', text: cut(a.text, 80) }; }).filter(function (a) { return a.text; });
            if (out.alerts && !out.alerts.length) delete out.alerts;
            if (+v.loaded >= 0 && +v.loaded <= 1) out.loaded = +v.loaded;
        }
        if (/^#[0-9a-fA-F]{6}$/.test(str(v.accent))) out.accent = str(v.accent);
        var l = str(v.link);
        if (l && l.length <= LIMITS.link && !/[\s"'<>]/.test(l)) out.link = l;
        return out;
    }

    // { view, state } or the view itself -> { view, state (JSON text or undefined), error }
    function result(out) {
        var res = { view: null, state: undefined, error: '' };
        if (!isObject(out)) { res.error = 'the function must return a view like { "big": "21°", "text": "Sunny" }'; return res; }
        var v = isObject(out.view) ? out.view : out;
        res.view = cleanView(v, false);
        if (isObject(out.view) && out.state !== undefined) {
            var js = '';
            try { js = JSON.stringify(out.state); } catch (e) { js = ''; }
            if (js && js.length <= LIMITS.state) res.state = js; else res.error = 'state is not JSON or bigger than ' + LIMITS.state + ' characters (not saved)';
        }
        return res;
    }

    // the Worker that runs an app's widget (started from a data: address: its own opaque origin)
    var WORKER = [
        'self.onmessage = async function (e) {',
        '  var d = e.data;',
        '  try {',
        '    var m = await import(d.src);',
        '    var f = m && (typeof m.default === "function" ? m.default : m.refresh);',
        '    if (typeof f !== "function") throw new Error("the file must export a function: export default async function (ctx) { return { big: \\"21\\" }; }");',
        '    var ctx = Object.freeze({ app: d.app, widget: d.widget, settings: d.settings, state: d.state, size: d.size, lang: d.lang,',
        '      action: d.action, now: d.now, lastRun: d.lastRun, config: d.config, fetch: self.fetch.bind(self) });',
        '    var out = await f(ctx);',
        '    postMessage({ ok: true, out: out === undefined ? null : JSON.parse(JSON.stringify(out)) });',
        '  } catch (err) { postMessage({ ok: false, error: String(err && (err.message || err) || err).slice(0, 300) }); }',
        '};'
    ].join('\n');

    var api = { EVERY: EVERY, SIZES: SIZES, LIMITS: LIMITS, parseWidgets: parseWidgets, parseSettings: parseSettings, keepApprovals: keepApprovals,
                settingsOf: settingsOf, cleanView: cleanView, result: result, WORKER: WORKER };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.WidgetLib = api;
})(this);
