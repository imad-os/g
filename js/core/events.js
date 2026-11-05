/* Events: public holidays (Moroccan ones by default, Eid al-Fitr / Eid al-Adha included) and big football days (Champions
 * League nights, World Cup, AFCON, Morocco's matches). Used by the Events wallpaper (js/launcher/dynwall.js) and meant for the
 * Calendar too: one source, one cache.
 *
 * Sources, best first (owner request 2026-11-05: "a very reliable API, Google or another giant, free"):
 *   holidays: Google Calendar's public holiday calendar of the country (`en.<cc>#holiday@group.v.calendar.google.com`, the one
 *             Google Calendar itself shows): through the Calendar API with My PC's Google key (needs "Google Calendar API" turned
 *             on in the Firebase project, firebase/SETUP.md), else its public .ics file (works on the TV: no CORS there), else the
 *             rules built in here (Morocco only: fixed days + the Islamic days from the Umm al-Qura calendar of the browser, Intl).
 *   football: ESPN's public scoreboard (site.api.espn.com, no key, used by espn.com itself): uefa.champions, fifa.world,
 *             caf.nations, and Morocco's other matches (friendlies, qualifiers).
 * Cheap on purpose: holidays asked once every 2 days, football every 6 hours, only when someone asks (Events.refresh); kept on the
 * TV in arc_dev_events (public data, not in the backup). No timer here. Keep the privacy text (evPrivacy) true.
 *
 *   Events.day('2026-11-06') -> [{ d, id, kind: 'holiday' | 'islamic' | 'period' | 'football', title, pub, at?, teams?, lg?, src }]
 *   Events.range(from, to)   -> the same, for every day from..to (YYYY-MM-DD), sorted by day then importance
 *   Events.refresh(cb)       -> asks what is stale; cb(changed)
 *   Events.prefs() / setPrefs({ country, football })   per profile (key events)
 *   Events.title(ev)          -> its name in the user's language (known ids are translated, others keep Google's English name) */
var Events = (function () {
    'use strict';

    var KEY = 'arc_dev_events', HOL_AGE = 2 * 86400000, FB_AGE = 6 * 3600000, busy = false, waiters = [];
    var COUNTRIES = ['ma', 'dz', 'tn', 'eg', 'sa', 'ae', 'fr', 'es', 'be', 'gb', 'us'];

    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
    function parseYmd(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12); }
    function addDays(s, n) { var d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
    function today() { return ymd(new Date()); }

    function prefs() {
        var p = Store.get('events', null) || {};
        return { country: COUNTRIES.indexOf(p.country) >= 0 ? p.country : 'ma', football: p.football !== false };
    }
    function setPrefs(o) { var p = prefs(); for (var k in o) p[k] = o[k]; Store.set('events', p); }

    function cache() { var c = Store.rawGet(KEY); return c && typeof c === 'object' ? c : {}; }
    function save(c) { Store.rawSet(KEY, c); }

    /* ---------- built-in Moroccan holidays (when Google cannot be reached) ---------- */

    var FIXED = [['01-01', 'newyear'], ['01-11', 'manifesto'], ['01-14', 'yennayer'], ['05-01', 'labour'], ['07-30', 'throne'], ['08-14', 'oued'],
                 ['08-20', 'revolution'], ['08-21', 'youth'], ['10-31', 'unity'], ['11-06', 'greenmarch'], ['11-18', 'independence']];
    // [Islamic month, day, id, days]: 1 Muharram, 12 Rabi al-Awwal, 1 Shawwal (2 days), 10 Dhu al-Hijja (2 days); Ramadan is a period
    var HIJRI = [[1, 1, 'hijri', 1], [3, 12, 'mawlid', 1], [10, 1, 'eidfitr', 2], [12, 10, 'eidadha', 2]];
    var hijriFmt = null, yearMemo = {};
    function hijriOf(d) {
        if (hijriFmt === null) {
            try { hijriFmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { day: 'numeric', month: 'numeric', year: 'numeric' }); if (!hijriFmt.formatToParts) hijriFmt = false; } catch (e) { hijriFmt = false; }
        }
        if (!hijriFmt) return null;
        var p = hijriFmt.formatToParts(d), o = {};
        for (var i = 0; i < p.length; i++) if (p[i].type === 'day' || p[i].type === 'month') o[p[i].type] = parseInt(p[i].value, 10);
        return o.month ? o : null;
    }
    function builtin(year) {
        if (yearMemo[year]) return yearMemo[year];
        var out = [], i, d, h, prev = null;
        for (i = 0; i < FIXED.length; i++) out.push({ d: year + '-' + FIXED[i][0], id: FIXED[i][1], kind: 'holiday', pub: true, src: 'mypc' });
        out.push({ d: year + '-12-31', id: 'nye', kind: 'holiday', pub: false, src: 'mypc' });
        // walk the year once (Intl, ~365 calls, a few ms; kept for the page's life)
        for (d = new Date(year, 0, 1, 12); d.getFullYear() === year; d.setDate(d.getDate() + 1)) {
            h = hijriOf(d);
            if (!h) break;
            for (i = 0; i < HIJRI.length; i++) {
                if (h.month === HIJRI[i][0] && h.day === HIJRI[i][1]) {
                    for (var k = 0; k < HIJRI[i][3]; k++) {
                        var dk = new Date(d.getTime()); dk.setDate(dk.getDate() + k);
                        if (dk.getFullYear() === year) out.push({ d: ymd(dk), id: HIJRI[i][2], kind: 'islamic', pub: true, src: 'mypc', day: k + 1 });
                    }
                }
            }
            if (h.month === 9 && !(prev && prev.month === 9)) out.push({ d: ymd(d), id: 'ramadan', kind: 'period', pub: false, src: 'mypc', len: 29 });
            prev = h;
        }
        yearMemo[year] = out;
        return out;
    }

    /* ---------- Google's holiday calendar ---------- */

    // Google's English names -> our ids (the wallpaper's picture and the translated name)
    var NAMES = [[/eid al[- ]?fitr|eid-ul-fitr|end of ramadan/i, 'eidfitr'], [/eid al[- ]?adha|feast of the sacrifice|eid-ul-adha/i, 'eidadha'],
                 [/ramadan/i, 'ramadan'], [/hijr|islamic new year|muharram/i, 'hijri'], [/prophet|mawlid|milad/i, 'mawlid'],
                 [/new year'?s eve/i, 'nye'], [/amazigh|yennayer|berber/i, 'yennayer'], [/new year/i, 'newyear'], [/manifesto/i, 'manifesto'],
                 [/labou?r|may day/i, 'labour'], [/throne/i, 'throne'], [/oued|dahab/i, 'oued'], [/revolution of the king/i, 'revolution'],
                 [/youth/i, 'youth'], [/green march/i, 'greenmarch'], [/unity/i, 'unity'], [/independence day/i, 'independence'],
                 [/christmas/i, 'christmas']];
    function idOf(name) { for (var i = 0; i < NAMES.length; i++) if (NAMES[i][0].test(name)) return NAMES[i][1]; return ''; }
    function calId(cc) { return 'en.' + cc + '#holiday@group.v.calendar.google.com'; }

    function get(url, ms, cb) {
        var x = new XMLHttpRequest(), done = false;
        function end(e, t) { if (!done) { done = true; cb(e, t); } }
        try {
            x.open('GET', url, true);
            x.timeout = ms;
            x.onload = function () { end(x.status >= 200 && x.status < 300 ? null : 'http ' + x.status, x.responseText); };
            x.onerror = x.ontimeout = function () { end('network'); };
            x.send();
        } catch (e) { end('network'); }
    }
    function holItem(name, start, end, desc) {
        var id = idOf(name), pub = !/observance|season/i.test(desc || '');
        if (/holiday \(|day off|bridge/i.test(name) && !id) return null;
        return { d: start, e: end && end > addDays(start, 1) ? addDays(end, -1) : undefined, id: id, t: name, kind: /eidfitr|eidadha|hijri|mawlid/.test(id) ? 'islamic' : id === 'ramadan' ? 'period' : 'holiday', pub: pub, src: 'google' };
    }
    function fromApi(txt) {
        var j = null, out = [];
        try { j = JSON.parse(txt); } catch (e) {}
        if (!j || !j.items) return null;
        for (var i = 0; i < j.items.length; i++) {
            var it = j.items[i], s = it.start && it.start.date;
            if (!s || !it.summary) continue;
            var x = holItem(it.summary, s, it.end && it.end.date, it.description);
            if (x) out.push(x);
        }
        return out;
    }
    function fromIcs(txt) {
        if (!/BEGIN:VCALENDAR/.test(txt || '')) return null;
        var out = [], ev = null, lines = String(txt).replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
        for (var i = 0; i < lines.length; i++) {
            var l = lines[i], c = l.indexOf(':');
            if (l === 'BEGIN:VEVENT') { ev = {}; continue; }
            if (l === 'END:VEVENT') {
                if (ev && ev.s && ev.n) { var x = holItem(ev.n, ev.s, ev.e, ev.desc); if (x) out.push(x); }
                ev = null; continue;
            }
            if (!ev || c < 0) continue;
            var k = l.slice(0, c).split(';')[0], v = l.slice(c + 1);
            if (k === 'DTSTART' || k === 'DTEND') { var m = /^(\d{4})(\d{2})(\d{2})/.exec(v); if (m) ev[k === 'DTSTART' ? 's' : 'e'] = m[1] + '-' + m[2] + '-' + m[3]; }
            else if (k === 'SUMMARY') ev.n = v.replace(/\\,/g, ',').replace(/\\;/g, ';');
            else if (k === 'DESCRIPTION') ev.desc = v;
        }
        return out;
    }
    function fetchHolidays(cc, cb) {
        var y = new Date().getFullYear(), id = calId(cc), key = typeof Cloud !== 'undefined' && Cloud.key ? Cloud.key : '';
        var api = 'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(id) + '/events?singleEvents=true&maxResults=500&orderBy=startTime' +
                  '&timeMin=' + (y - 1) + '-12-01T00:00:00Z&timeMax=' + (y + 1) + '-12-31T23:59:59Z&key=' + key;
        var ics = 'https://calendar.google.com/calendar/ical/' + encodeURIComponent(id) + '/public/basic.ics';
        function viaIcs() { get(ics, 12000, function (e, t) { var l = e ? null : fromIcs(t); cb(l && l.length ? l : null, 'ics'); }); }
        if (!key) return viaIcs();
        get(api, 10000, function (e, t) { var l = e ? null : fromApi(t); if (l && l.length) cb(l, 'api'); else viaIcs(); });
    }

    /* ---------- football (ESPN) ---------- */

    var LEAGUES = [['uefa.champions', 'ucl'], ['fifa.world', 'worldcup'], ['caf.nations', 'afcon'], ['fifa.friendly', ''], ['fifa.worldq.caf', '']];
    function isMorocco(c) { var t = c && c.team || {}; return t.abbreviation === 'MAR' || /^morocco$|^maroc$/i.test(t.displayName || t.name || ''); }
    function fromEspn(txt, lg) {
        var j = null, out = [];
        try { j = JSON.parse(txt); } catch (e) {}
        if (!j || !j.events) return null;
        for (var i = 0; i < j.events.length; i++) {
            var ev = j.events[i], comp = ev.competitions && ev.competitions[0], cs = comp && comp.competitors || [], at = Date.parse(ev.date);
            if (!at || cs.length < 2) continue;
            var home = cs[0].homeAway === 'away' ? cs[1] : cs[0], away = home === cs[0] ? cs[1] : cs[0], mar = isMorocco(home) || isMorocco(away);
            if (!lg[1] && !mar) continue;           // friendlies and qualifiers: only Morocco's
            var slug = String(ev.season && ev.season.slug || (comp.type && comp.type.slug) || ''), d = new Date(at);
            out.push({ d: ymd(d), at: at, id: mar ? 'morocco' : lg[1] === 'ucl' && /final/.test(slug) && !/semi|quarter/.test(slug) ? 'uclfinal' : lg[1], kind: 'football',
                       lg: lg[1] || 'friendly', stage: slug, src: 'espn', pub: false,
                       teams: [String(home.team && (home.team.shortDisplayName || home.team.displayName) || ''), String(away.team && (away.team.shortDisplayName || away.team.displayName) || '')] });
        }
        return out;
    }
    function fetchFootball(cb) {
        var from = addDays(today(), -1).replace(/-/g, ''), to = addDays(today(), 30).replace(/-/g, ''), left = LEAGUES.length, all = [], ok = 0;
        LEAGUES.forEach(function (lg) {
            get('https://site.api.espn.com/apis/site/v2/sports/soccer/' + lg[0] + '/scoreboard?limit=300&dates=' + from + '-' + to, 10000, function (e, t) {
                var l = e ? null : fromEspn(t, lg);
                if (l) { ok++; all = all.concat(l); }
                if (--left === 0) cb(ok ? all : null);
            });
        });
    }

    /* ---------- refresh / read ---------- */

    function refresh(cb) {
        if (cb) waiters.push(cb);
        if (busy) return;
        var p = prefs(), c = cache(), now = Date.now(), left = 0, changed = false;
        var hk = p.country + ':' + new Date().getFullYear(), needHol = !c.hol || c.hol.k !== hk || now - (c.hol.at || 0) > HOL_AGE;
        var needFb = p.football && (!c.fb || now - (c.fb.at || 0) > FB_AGE || c.fb.day !== today());
        function done() {
            if (--left > 0) return;
            busy = false;
            if (changed) save(c);
            var w = waiters; waiters = [];
            for (var i = 0; i < w.length; i++) { try { w[i](changed); } catch (e) {} }
        }
        if (!needHol && !needFb) { left = 1; busy = true; return done(); }
        busy = true;
        if (needHol) {
            left++;
            fetchHolidays(p.country, function (list, via) {
                // a failed try is remembered too (asked again in 6 hours, not at every look)
                if (list) { c.hol = { k: hk, at: Date.now(), via: via, list: list }; changed = true; }
                else if (!c.hol || c.hol.k !== hk) { c.hol = { k: hk, at: Date.now() - HOL_AGE + 6 * 3600000, via: 'none', list: [] }; changed = true; }
                else { c.hol.at = Date.now() - HOL_AGE + 6 * 3600000; changed = true; }
                done();
            });
        }
        if (needFb) {
            left++;
            fetchFootball(function (list) {
                if (list) c.fb = { at: Date.now(), day: today(), list: list };
                else c.fb = { at: Date.now() - FB_AGE + 3600000, day: today(), list: c.fb && c.fb.list || [] };
                changed = true;
                done();
            });
        }
    }

    var RANK = { eidadha: 100, eidfitr: 99, morocco: 90, throne: 80, greenmarch: 79, independence: 78, unity: 77, revolution: 76, youth: 75,
                 oued: 74, manifesto: 73, yennayer: 72, newyear: 71, hijri: 70, mawlid: 69, labour: 60, uclfinal: 58, worldcup: 56, afcon: 55,
                 christmas: 50, nye: 45, ramadan: 40, ucl: 35 };
    function rank(e) { return RANK[e.id] || (e.pub ? 30 : 10); }

    // the holidays of a day: Google's when we have them for this country, else the built-in Moroccan ones
    function holidaysOn(s) {
        var p = prefs(), c = cache(), out = [], i, l;
        var g = c.hol && c.hol.k === p.country + ':' + s.slice(0, 4) && c.hol.list && c.hol.list.length ? c.hol.list : null;
        if (!g && c.hol && c.hol.k && c.hol.k.split(':')[0] === p.country && c.hol.list && c.hol.list.length) g = c.hol.list;   // other year: still Google's
        l = g || (p.country === 'ma' ? builtin(+s.slice(0, 4)) : []);
        for (i = 0; i < l.length; i++) {
            var e = l[i], end = e.e || (e.len ? addDays(e.d, e.len - 1) : e.d);
            if (s >= e.d && s <= end) out.push(e);
        }
        // Ramadan is a month, not a day: Google's first day starts it, else the built-in month (Intl) in Muslim countries
        out = out.filter(function (x) { return x.id !== 'ramadan'; });
        var starts = [];
        for (i = 0; i < l.length; i++) if (l[i].id === 'ramadan') starts.push(l[i]);
        if (!starts.length && /^(ma|dz|tn|eg|sa|ae)$/.test(p.country)) starts = builtin(+s.slice(0, 4)).filter(function (x) { return x.id === 'ramadan'; });
        for (i = 0; i < starts.length; i++) if (s >= starts[i].d && s <= addDays(starts[i].d, 28)) { out.push({ d: starts[i].d, id: 'ramadan', kind: 'period', pub: false, src: starts[i].src, day: 1 + Math.round((parseYmd(s) - parseYmd(starts[i].d)) / 86400000) }); break; }
        return out;
    }
    function day(s) {
        s = s || today();
        var out = holidaysOn(s), c = cache(), i, seen = {};
        if (prefs().football && c.fb && c.fb.list) for (i = 0; i < c.fb.list.length; i++) if (c.fb.list[i].d === s) out.push(c.fb.list[i]);
        // one entry per id (the second day of Eid stays one entry), the most important first
        out = out.filter(function (e) { var k = e.id ? e.id + (e.teams ? e.teams.join() : '') : e.t; if (seen[k]) return false; seen[k] = 1; return true; });
        out.sort(function (a, b) { return rank(b) - rank(a) || (a.at || 0) - (b.at || 0); });
        return out;
    }
    function range(from, to) {
        var out = [];
        for (var s = from; s <= to; s = addDays(s, 1)) {
            var l = day(s);
            for (var i = 0; i < l.length; i++) { var e = {}; for (var k in l[i]) e[k] = l[i][k]; e.on = s; out.push(e); }
        }
        return out;
    }

    function title(e) {
        if (!e) return '';
        var k = 'ev_' + e.id;
        if (e.id && typeof I18n !== 'undefined' && I18n.t(k) !== k) return I18n.t(k);
        return e.t || '';
    }

    return { day: day, range: range, refresh: refresh, prefs: prefs, setPrefs: setPrefs, title: title, rank: rank, COUNTRIES: COUNTRIES,
             ymd: ymd, addDays: addDays, today: today, source: function () { var c = cache(); return { holidays: c.hol ? c.hol.via : '', football: c.fb ? !!(c.fb.list && c.fb.list.length) : false }; },
             _builtin: builtin, _fromIcs: fromIcs, _fromApi: fromApi, _fromEspn: fromEspn, _idOf: idOf };
})();
