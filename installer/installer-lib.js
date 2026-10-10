/* My PC installer: reads an app's mypc-app.json and turns it into the Firestore "apps" document.
 * Used by installer/index.html (browser) and tests/installer-lib.test.mjs (Node). */
(function (root) {
    'use strict';

    var MANIFEST = 'mypc-app.json';
    var ID_RE = /^[a-z0-9-]{2,32}$/;
    var MAX_CONFIG = 8000;               // characters of JSON per app: it is loaded by every TV before the app opens

    function isObject(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }

    // text typed in the installer -> the config object (empty text = {}); throws a readable Error
    function parseConfig(text) {
        var t = String(text == null ? '' : text).trim();
        if (!t) return {};
        var v;
        try { v = JSON.parse(t); } catch (e) { throw new Error('Not valid JSON: ' + e.message); }
        if (!isObject(v)) throw new Error('The config must be a JSON object, like { "speed": 2 }.');
        var n = JSON.stringify(v).length;
        if (n > MAX_CONFIG) throw new Error('The config is too big (' + n + ' characters, the limit is ' + MAX_CONFIG + ').');
        return v;
    }

    // "someone.github.io/game" -> { base: "https://someone.github.io/game/", manifest: ".../mypc-app.json" }
    function locate(input) {
        var s = String(input || '').trim();
        if (!s) throw new Error('Type the address of the app.');
        if (!/^[a-z]+:\/\//i.test(s)) s = 'https://' + s;
        var u;
        try { u = new URL(s); } catch (e) { throw new Error('This is not a valid web address.'); }
        if (u.protocol !== 'https:' && !(u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname))) throw new Error('The app must be on https:// (GitHub Pages is fine).');
        u.hash = ''; u.search = '';
        var path = u.pathname;
        if (/\/mypc-app\.json$/i.test(path)) return { base: u.href.replace(/[^/]*$/, ''), manifest: u.href };
        if (/\.[a-z0-9]+$/i.test(path)) path = path.replace(/[^/]*$/, '');     // .../index.html -> folder
        if (!/\/$/.test(path)) path += '/';
        u.pathname = path;
        return { base: u.href, manifest: u.href + MANIFEST };
    }

    function abs(rel, base) { return new URL(rel, base).href; }

    // "touch" of mypc-app.json: false (the app has its own touch UI) or { buttons, catalog, scale } (see sdk/GUIDE.md, Touch controls)
    var TOUCH_ACTIONS = ['ok', 'run', 'cancel', 'menu'];
    function parseTouch(t) {
        if (t === false) return false;
        if (t === true) return undefined;                              // the default pad: nothing to store
        if (!isObject(t)) throw new Error('"touch" must be false or an object like { "buttons": [{ "label": "A", "action": "ok" }] }.');
        var out = {};
        ['buttons', 'catalog'].forEach(function (k) {
            if (t[k] === undefined) return;
            if (!Array.isArray(t[k])) throw new Error('"touch.' + k + '" must be a list.');
            if (t[k].length > 8) throw new Error('"touch.' + k + '" has more than 8 entries.');
            out[k] = t[k].map(function (b, i) {
                if (!isObject(b) || typeof b.label !== 'string' || !b.label || b.label.length > 3) throw new Error('"touch.' + k + '[' + i + ']" needs a "label" of 1 to 3 characters.');
                if (TOUCH_ACTIONS.indexOf(b.action) < 0) throw new Error('"touch.' + k + '[' + i + ']" action must be one of: ' + TOUCH_ACTIONS.join(', ') + '.');
                return { label: b.label, action: b.action };
            });
        });
        if (t.scale !== undefined) {
            if (!isObject(t.scale)) throw new Error('"touch.scale" must be like { "stick": 1, "btn": 1 }.');
            out.scale = {};
            ['stick', 'btn'].forEach(function (k) {
                if (t.scale[k] === undefined) return;
                var n = +t.scale[k];
                if (!(n >= 0.5 && n <= 2.5)) throw new Error('"touch.scale.' + k + '" must be between 0.5 and 2.5.');
                out.scale[k] = n;
            });
        }
        return out;
    }

    // manifest JSON -> app document (throws an Error with a readable message)
    function toApp(m, base, order) {
        if (!m || typeof m !== 'object') throw new Error(MANIFEST + ' is not valid JSON.');
        if (m.mypc !== 1) throw new Error(MANIFEST + ' must contain "mypc": 1 (the SDK version).');
        var id = String(m.id || '').toLowerCase();
        if (!ID_RE.test(id)) throw new Error('"id" must be 2 to 32 characters: a-z, 0-9 and "-".');
        var name = typeof m.name === 'string' ? m.name.trim() : '';
        if (!name || name.length > 40) throw new Error('"name" is required (40 characters at most).');
        var type = m.type === 'app' ? 'app' : 'game';
        if (m.type && m.type !== 'app' && m.type !== 'game') throw new Error('"type" must be "game" or "app".');
        var entry = abs(m.entry || 'index.html', base), icon = m.icon ? abs(m.icon, base) : '';
        if (!/^https:\/\//.test(entry) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(entry)) throw new Error('"entry" must be on https://.');
        var app = {
            id: id, name: name, description: String(m.description || '').slice(0, 120), url: base, entry: entry, icon: icon,
            type: type, version: String(m.version || '1.0.0').slice(0, 20), sdk: 1, scores: type === 'game' && m.scores !== false,
            enabled: true, order: order || 0
        };
        // optional default settings shipped by the app (the owner can change them in the installer)
        if (m.config !== undefined) app.config = parseConfig(JSON.stringify(m.config));
        // optional touch controls: false = the app draws its own, or the pad's buttons / catalog / scale
        var touch = m.touch === undefined ? undefined : parseTouch(m.touch);
        if (touch !== undefined) app.touch = touch;
        return app;
    }

    // GitHub repositories of the owner -> the ones that can be My PC apps: name starts with the prefix,
    // GitHub Pages turned on, not archived. -> [{ repo, base, manifest }]
    function catalog(repos, owner, prefix) {
        var out = [], p = String(prefix || '').toLowerCase();
        (repos || []).forEach(function (r) {
            if (!r || typeof r.name !== 'string') return;
            if (p && r.name.toLowerCase().indexOf(p) !== 0) return;
            if (r.archived || r.has_pages === false) return;
            var base = 'https://' + owner.toLowerCase() + '.github.io/' + r.name + '/';
            out.push({ repo: r.name, base: base, manifest: base + MANIFEST, pushed: r.pushed_at || '' });
        });
        out.sort(function (a, b) { return a.repo.localeCompare(b.repo); });
        return out;
    }

    // installed list + a catalog app -> 'new' | 'installed' | 'update' (same id, other version or address)
    function status(installed, app) {
        for (var i = 0; i < (installed || []).length; i++) {
            var a = installed[i];
            if (a.id === app.id || a.url === app.url) return a.version === app.version && a.entry === app.entry && a.name === app.name && a.icon === app.icon ? 'installed' : 'update';
        }
        return 'new';
    }

    var api = { MANIFEST: MANIFEST, MAX_CONFIG: MAX_CONFIG, locate: locate, toApp: toApp, parseConfig: parseConfig, catalog: catalog, status: status };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.InstallerLib = api;
})(this);
