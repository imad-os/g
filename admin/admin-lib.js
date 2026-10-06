/* Pure helpers of the admin page (no DOM, no Firebase): validation that mirrors firebase/firestore.rules,
 * manifest prefill and reordering. Loaded by admin/index.html and by tests/admin-lib.test.mjs. */
(function (root) {
    'use strict';

    var ALLOWED = ['title', 'description', 'url', 'cover', 'enabled', 'order', 'minShell', 'sdk', 'build', 'tags', 'bundled', 'updatedAt'];
    var LANGS = ['en', 'fr', 'es', 'ar'];

    function isText(t, required) {
        if (!t || typeof t !== 'object' || Array.isArray(t)) return false;
        for (var k in t) if (LANGS.indexOf(k) < 0) return false;
        if (required && !(typeof t.en === 'string' && t.en.length > 0 && t.en.length <= 80)) return false;
        for (var l in t) if (typeof t[l] !== 'string' || t[l].length > 80) return false;
        return true;
    }
    function isInt(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n; }

    // Same rules as firestore.rules validGame(); returns a list of human readable errors (empty = valid).
    function validate(id, d) {
        var e = [], k;
        if (!/^[a-z0-9-]{2,32}$/.test(id || '')) e.push('Game id: 2 to 32 characters, a-z 0-9 and "-" only.');
        if (!d || typeof d !== 'object') return e.concat('No data.');
        for (k in d) if (ALLOWED.indexOf(k) < 0) e.push('Unknown field "' + k + '".');
        if (!isText(d.title, true)) e.push('Title: an English title (1 to 80 characters) is required; other languages en/fr/es/ar only.');
        if (d.description !== undefined && !isText(d.description, false)) e.push('Description: texts of at most 80 characters, languages en/fr/es/ar only.');
        if (typeof d.url !== 'string' || d.url.length > 300 || !(/^https:\/\/[a-zA-Z0-9.-]+\/.*/.test(d.url) || /^games\/[a-z0-9-]+\/$/.test(d.url))) {
            e.push('URL: must be https://host/path/ (or games/<id>/ for a bundled game), at most 300 characters.');
        }
        if (d.cover !== undefined && !(typeof d.cover === 'string' && d.cover.length <= 300)) e.push('Cover: text of at most 300 characters.');
        if (typeof d.enabled !== 'boolean') e.push('Enabled: true or false.');
        if (!isInt(d.order) || d.order < 0 || d.order >= 1000) e.push('Order: a whole number from 0 to 999.');
        var ints = ['minShell', 'sdk', 'build'];
        for (var i = 0; i < ints.length; i++) if (d[ints[i]] !== undefined && !isInt(d[ints[i]])) e.push(ints[i] + ': whole number.');
        if (d.bundled !== undefined && typeof d.bundled !== 'boolean') e.push('Bundled: true or false.');
        if (d.tags !== undefined && !(Array.isArray(d.tags) && d.tags.length <= 5)) e.push('Tags: a list of at most 5.');
        if (typeof d.url === 'string' && /^games\//.test(d.url) && d.bundled !== true) e.push('A games/<id>/ URL must be marked bundled.');
        return e;
    }

    function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32); }
    function trimSlash(u) { return String(u || '').replace(/[?#].*$/, '').replace(/\/?$/, '/'); }
    function clip(o) {
        var out = {};
        for (var k in o) if (LANGS.indexOf(k) >= 0 && typeof o[k] === 'string') out[k] = o[k].slice(0, 80);
        return out;
    }

    // From a game's own game-manifest.json: the fields of a registry document (the admin edits them before saving).
    function prefill(pageUrl, m) {
        var url = trimSlash(pageUrl), d = { url: url, enabled: true, order: 999 };
        m = m || {};
        d.title = clip(m.title || {}); if (!d.title.en) d.title.en = m.id || '';
        if (m.description) d.description = clip(m.description);
        if (m.cover) { try { d.cover = new URL(m.cover, url).href; } catch (e) { d.cover = m.cover; } }
        if (isInt(m.sdk)) d.sdk = m.sdk; else d.sdk = 1;
        if (isInt(m.minShell)) d.minShell = m.minShell;
        if (isInt(m.build)) d.build = m.build;
        if (Array.isArray(m.tags)) d.tags = m.tags.slice(0, 5);
        return { id: slug(m.id || d.title.en), data: d };
    }

    // list = [{ id, order }] in the desired order -> [{ id, order }] numbered 0, 10, 20 ... (room to insert later)
    function renumber(ids) {
        var out = [];
        for (var i = 0; i < ids.length; i++) out.push({ id: ids[i], order: i * 10 });
        return out;
    }
    function move(ids, from, to) {
        var a = ids.slice(), x = a.splice(from, 1)[0];
        a.splice(Math.max(0, Math.min(a.length, to)), 0, x);
        return a;
    }

    var api = { validate: validate, prefill: prefill, renumber: renumber, move: move, slug: slug, ALLOWED: ALLOWED };
    if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.AdminLib = api;
})(typeof window !== 'undefined' ? window : this);
