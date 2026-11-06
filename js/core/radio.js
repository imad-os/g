/* Online radio for MyMusic (owner request 2026-11-06): stations from Radio Browser (https://www.radio-browser.info, a free,
 * public, community list; no key), Morocco first. The player is js/core/music.js (Samsung's own player AVPlay first on the
 * TV: MP3, AAC, OGG and HLS; the web player in a browser), the screens are in js/launcher/apps/music.js.
 *
 *   Radio.stations(cc, cb, force)   cb(err, [station]) of a country, from the cache on this device (a day old at most; older or
 *                                   force: asked again, the cache shows meanwhile). Radio Browser's own check hides dead ones.
 *   Radio.countries(cb)             cb([{ cc, n, count }]) every country with stations (kept 7 days)
 *   Radio.filter(list, { lang, tag, q })   by language, genre and a search (name or genre, accents ignored)
 *   Radio.langs(list) / tags(list)  the languages / genres of a list, most stations first
 *   Radio.test(st, cb) / testable(st) / status(st)   does the stream answer here (kept 3 days per device): 'ok' | 'bad' | 'no'
 *                                   ('no' = this device cannot play it: HLS without a player for it, http on an https page...)
 *   Radio.played(st)                recently played + Radio Browser's click count (their rule for a client that plays)
 *   favs() / isFav(st) / setFav(st, on) / recent() / custom() / addCustom(name, url) / editCustom(id, name, url) / removeCustom(id)
 *   prefs() / setPref(k, v)         { cc, lang, tag, showBad }
 * A station is a Music track: { s: 'radio', p: Radio Browser's id (or 'c...' for one added by hand), n: name, u: stream address,
 *   i: logo, g: genres, l: languages, cc, br: kbit/s, c: codec, h: 1 = HLS, own: 1 = added by hand }.
 * Saved per profile (Store, so in the profile's backup / account): radio_favs, radio_recent, radio_custom, radio_prefs.
 * On this device only (not user data): the station lists arc_dev_radio_<cc>, the countries, the stream tests. */
var Radio = (function () {
    'use strict';

    var HOSTS = ['https://de1.api.radio-browser.info', 'https://fi1.api.radio-browser.info', 'https://de2.api.radio-browser.info'];
    var DAY = 24 * 3600 * 1000, MAXLIST = 1000, FAVS = 'radio_favs', RECENT = 'radio_recent', CUSTOM = 'radio_custom', PREFS = 'radio_prefs';
    var TESTS = 'arc_dev_radio_tests', COUNTRIES = 'arc_dev_radio_countries';
    var DEF = { cc: 'MA', lang: '', tag: '', showBad: false };
    var host = 0, mem = {};

    function dev(k) { return Store.rawGet(k); }
    function devSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }   // not a backup change
    function arr(v) { return Array.isArray(v) ? v : []; }

    /* ---------------- Radio Browser ---------------- */
    // one GET, trying the next server when one does not answer (8 s each)
    function api(path, cb) {
        var tries = 0;
        (function next() {
            var h = HOSTS[(host + tries) % HOSTS.length], done = false, ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
            var to = setTimeout(function () { if (ctl) ctl.abort(); fail(); }, 8000);
            function fail() { if (done) return; done = true; clearTimeout(to); if (++tries < HOSTS.length) return next(); cb({ code: 'network' }); }
            fetch(h + path, ctl ? { signal: ctl.signal } : undefined).then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); }).then(function (j) {
                if (done) return; done = true; clearTimeout(to);
                host = (host + tries) % HOSTS.length;
                cb(null, j);
            }, fail);
        })();
    }
    function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
    function words(s, max) {
        var out = [], seen = {};
        String(s || '').split(',').forEach(function (w) { w = clean(w).toLowerCase(); if (w && w.length < 30 && !seen[w]) { seen[w] = 1; out.push(w); } });
        return out.slice(0, max).join(', ');
    }
    function station(r) {
        var u = clean(r.url_resolved || r.url);
        if (!/^https?:\/\//i.test(u) || !r.stationuuid) return null;
        var o = { s: 'radio', p: String(r.stationuuid), n: clean(r.name).slice(0, 80) || u, u: u };
        if (/^https?:\/\//i.test(r.favicon || '')) o.i = clean(r.favicon);
        var g = words(r.tags, 4), l = words(r.language, 3);
        if (g) o.g = g;
        if (l) o.l = l;
        if (r.countrycode) o.cc = String(r.countrycode).toUpperCase();
        if (+r.bitrate > 0) o.br = +r.bitrate;
        if (r.codec && r.codec !== 'UNKNOWN') o.c = String(r.codec).toUpperCase().slice(0, 12);
        if (+r.hls === 1 || /\.m3u8(\?|$)/i.test(u)) o.h = 1;
        return o;
    }
    function listKey(cc) { return 'arc_dev_radio_' + String(cc || 'MA').toLowerCase(); }
    function stations(cc, cb, force) {
        cc = String(cc || 'MA').toUpperCase();
        var c = mem[cc] || dev(listKey(cc)), fresh = c && c.list && Date.now() - (c.at || 0) < DAY;
        if (c && c.list) { mem[cc] = c; cb(null, c.list, { at: c.at, cached: true }); if (fresh && !force) return; }
        api('/json/stations/search?countrycode=' + encodeURIComponent(cc) + '&hidebroken=true&order=clickcount&reverse=true&limit=' + MAXLIST, function (e, j) {
            if (e) { if (!(c && c.list)) cb(e); return; }
            var list = arr(j).map(station).filter(Boolean), seen = {};
            // the same stream listed twice: the first (most played) only
            list = list.filter(function (s) { var k = s.u.replace(/^https?:\/\//i, '').replace(/\/$/, ''); if (seen[k]) return false; seen[k] = 1; return true; });
            var v = { at: Date.now(), list: list };
            mem[cc] = v;
            keepLists(cc);
            devSet(listKey(cc), v);
            cb(null, list, { at: v.at, cached: false });
        });
    }
    // at most 3 countries kept on the device (Morocco always)
    function keepLists(cc) {
        try {
            var keys = [];
            for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (/^arc_dev_radio_[a-z]{2}$/.test(k) && k !== listKey('MA') && k !== listKey(cc)) keys.push(k); }
            keys.sort(function (a, b) { return ((dev(a) || {}).at || 0) - ((dev(b) || {}).at || 0); });
            while (keys.length > 1) localStorage.removeItem(keys.shift());
        } catch (x) {}
    }
    function countries(cb) {
        var c = dev(COUNTRIES);
        if (c && c.list && Date.now() - (c.at || 0) < 7 * DAY) return cb(c.list);
        api('/json/countries?hidebroken=true', function (e, j) {
            if (e) return cb(c && c.list || [{ cc: 'MA', n: 'Morocco', count: 0 }]);
            var by = {};
            arr(j).forEach(function (r) {
                var cc = String(r.iso_3166_1 || '').toUpperCase();
                if (!/^[A-Z]{2}$/.test(cc) || !(+r.stationcount > 0)) return;
                if (!by[cc]) by[cc] = { cc: cc, n: clean(r.name), count: 0 };
                by[cc].count += +r.stationcount;
            });
            var list = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.count - a.count; });
            devSet(COUNTRIES, { at: Date.now(), list: list });
            cb(list);
        });
    }
    function countryName(cc) {
        try { if (typeof Intl !== 'undefined' && Intl.DisplayNames) return new Intl.DisplayNames([I18n.lang ? I18n.lang() : 'en'], { type: 'region' }).of(cc) || cc; } catch (x) {}
        var c = dev(COUNTRIES), l = c && c.list || [];
        for (var i = 0; i < l.length; i++) if (l[i].cc === cc) return l[i].n;
        return cc;
    }

    /* ---------------- filters and search ---------------- */
    function fold(s) { s = String(s || '').toLowerCase(); try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (x) {} return s; }
    function has(list, w) { return (', ' + (list || '') + ',').indexOf(', ' + w + ',') >= 0; }
    function filter(list, f) {
        f = f || {};
        var q = fold(clean(f.q));
        return list.filter(function (s) {
            if (f.lang && !has(s.l, f.lang)) return false;
            if (f.tag && !has(s.g, f.tag)) return false;
            if (q && fold(s.n).indexOf(q) < 0 && fold(s.g).indexOf(q) < 0) return false;
            return true;
        });
    }
    function count(list, field, max) {
        var n = {};
        list.forEach(function (s) { String(s[field] || '').split(', ').forEach(function (w) { if (w) n[w] = (n[w] || 0) + 1; }); });
        return Object.keys(n).sort(function (a, b) { return n[b] - n[a] || (a < b ? -1 : 1); }).slice(0, max).map(function (w) { return { v: w, n: n[w] }; });
    }

    /* ---------------- does a stream play here ---------------- */
    var TV = typeof webapis !== 'undefined' && !!webapis.avplay;
    function hlsOk() { if (TV) return true; try { return !!new Audio().canPlayType('application/vnd.apple.mpegurl'); } catch (x) { return false; } }
    // the web player on an https page cannot play an http stream (the browser blocks it): try its https address
    function webUrl(u) { return !TV && typeof location !== 'undefined' && location.protocol === 'https:' && /^http:/i.test(u) ? 'https:' + u.slice(5) : u; }
    function testable(st) {
        if (st.h && !hlsOk()) return false;
        if (!TV && st.c && /WMA|ASF/.test(st.c)) return false;
        return true;
    }
    function tests() { var t = dev(TESTS); return t && typeof t === 'object' ? t : {}; }
    function status(st) {
        if (!testable(st)) return 'no';
        var r = tests()[st.u];
        return r && Date.now() - r[1] < 3 * DAY ? (r[0] ? 'ok' : 'bad') : '';
    }
    function mark(st, ok) {
        var t = tests(), keys = Object.keys(t);
        if (keys.length > 3000) keys.sort(function (a, b) { return t[a][1] - t[b][1]; }).slice(0, 1000).forEach(function (k) { delete t[k]; });
        t[st.u] = [ok ? 1 : 0, Date.now()];
        devSet(TESTS, t);
    }
    // the stream answers (its first bytes, then it is cut): a fetch that needs no CORS, 7 s at most
    function test(st, cb) {
        if (!testable(st)) return cb('no');
        var done = false, ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        function end(ok) { if (done) return; done = true; clearTimeout(to); if (ctl) { try { ctl.abort(); } catch (x) {} } mark(st, ok); cb(ok ? 'ok' : 'bad'); }
        var to = setTimeout(function () { end(false); }, 7000);
        try {
            fetch(webUrl(st.u), { mode: 'no-cors', cache: 'no-store', signal: ctl ? ctl.signal : undefined }).then(function (r) {
                // no-cors hides the answer (type opaque): it came, so the server is there; a readable one must be a 2xx
                end(r.type === 'opaque' || r.ok);
            }, function () { end(false); });
        } catch (x) { end(false); }
    }

    /* ---------------- the profile's stations ---------------- */
    function prefs() { var p = Store.get(PREFS, null), o = {}, k; for (k in DEF) o[k] = DEF[k]; if (p && typeof p === 'object') for (k in p) if (k in DEF) o[k] = p[k]; return o; }
    function setPref(k, v) { var p = prefs(); p[k] = v; Store.set(PREFS, p); }
    function slim(st) { var o = {}; ['s', 'p', 'n', 'u', 'i', 'g', 'l', 'cc', 'br', 'c', 'h', 'own'].forEach(function (k) { if (st[k] !== undefined && st[k] !== '') o[k] = st[k]; }); return o; }
    function favs() { return arr(Store.get(FAVS, [])); }
    function isFav(st) { return favs().some(function (x) { return x.p === st.p; }); }
    function setFav(st, on) {
        var l = favs().filter(function (x) { return x.p !== st.p; });
        if (on) l.unshift(slim(st));
        Store.set(FAVS, l.slice(0, 200));
    }
    function recent() { return arr(Store.get(RECENT, [])); }
    function played(st) {
        var l = recent().filter(function (x) { return x.p !== st.p; });
        l.unshift(slim(st));
        Store.set(RECENT, l.slice(0, 12));
        if (st.s === 'radio' && !st.own) api('/json/url/' + encodeURIComponent(st.p), function () {});
    }
    function custom() { return arr(Store.get(CUSTOM, [])); }
    function fixUrl(u) {
        u = clean(u);
        if (u && !/^[a-z]+:\/\//i.test(u)) u = 'http://' + u;
        return /^https?:\/\/[^\s/?#]+(\/\S*)?$/i.test(u) ? u : '';
    }
    function own(id, name, u) {
        var o = { s: 'radio', p: id, n: clean(name).slice(0, 80) || u.replace(/^https?:\/\//i, '').slice(0, 40), u: u, own: 1 };
        if (/\.m3u8(\?|$)/i.test(u)) o.h = 1;
        var x = (/\.([a-z0-9]{2,4})(\?|$)/i.exec(u.replace(/^https?:\/\/[^/]+/i, '')) || [])[1];
        if (x && /^(mp3|aac|ogg|opus)$/i.test(x)) o.c = x.toUpperCase();
        return o;
    }
    // a station added by hand: cb(err, station); a .pls / .m3u playlist address is opened to find its stream
    function addCustom(name, url, cb, id) {
        var u = fixUrl(url);
        if (!u) return cb({ code: 'badurl' });
        resolveList(u, function (u2) {
            var st = own(id || 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1000), name, u2), l = custom().filter(function (x) { return x.p !== st.p; });
            if (!id) l.unshift(st); else { var k = custom().map(function (x) { return x.p; }).indexOf(id); l.splice(Math.max(0, k), 0, st); }
            Store.set(CUSTOM, l.slice(0, 100));
            // the same station in the favorites / recently played follows the change
            if (id) { [FAVS, RECENT].forEach(function (key) { Store.set(key, arr(Store.get(key, [])).map(function (x) { return x.p === id ? slim(st) : x; })); }); }
            cb(null, st);
        });
    }
    function editCustom(id, name, url, cb) { addCustom(name, url, cb, id); }
    function removeCustom(id) {
        Store.set(CUSTOM, custom().filter(function (x) { return x.p !== id; }));
        [FAVS, RECENT].forEach(function (key) { Store.set(key, arr(Store.get(key, [])).filter(function (x) { return x.p !== id; })); });
    }
    function resolveList(u, cb) {
        if (!/\.(pls|m3u)(\?|$)/i.test(u)) return cb(u);
        var done = false, to = setTimeout(function () { if (!done) { done = true; cb(u); } }, 5000);
        fetch(u).then(function (r) { return r.text(); }).then(function (txt) {
            if (done) return; done = true; clearTimeout(to);
            var m = /(?:^|\n)\s*(?:File\d+=)?(https?:\/\/[^\s]+)/i.exec(txt || '');
            cb(m ? m[1] : u);
        }, function () { if (!done) { done = true; clearTimeout(to); cb(u); } });
    }

    /* ---------------- the Music source 'radio' ---------------- */
    if (typeof MusicSrc !== 'undefined') MusicSrc.add('radio', {
        url: function (e, cb) { if (!e.u) return cb({ code: 'gone' }); cb(null, { url: webUrl(e.u), live: true }); }
    });

    return {
        stations: stations, countries: countries, countryName: countryName, filter: filter, fold: fold,
        langs: function (l) { return count(l, 'l', 30); }, tags: function (l) { return count(l, 'g', 40); },
        test: test, testable: testable, status: status, mark: mark, hlsOk: hlsOk, played: played,
        favs: favs, isFav: isFav, setFav: setFav, recent: recent, custom: custom, addCustom: addCustom, editCustom: editCustom, removeCustom: removeCustom,
        prefs: prefs, setPref: setPref, slim: slim, fixUrl: fixUrl,
        _hosts: HOSTS, _mem: mem
    };
})();
