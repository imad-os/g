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
 *   Events.title(ev)          -> its name in the user's language (known ids are translated, others keep Google's English name)
 *
 * Added for the Calendar (js/launcher/apps/calendar.js, its widget, js/launcher/cal-remind.js):
 *   - data/events-ma.json on My PC's own site, asked FIRST for Morocco: a GitHub Action (.github/workflows/events.yml,
 *     tools/fetch-events.mjs) copies Google's Moroccan .ics there every week, so the web / phone app (where Google's .ics is
 *     blocked by CORS and the Calendar API needs a key) gets Google's dates too. The same file brings data/big-events.json
 *     (Champions League nights, AFCON...: kind 'event', src 'site', also months ahead, where ESPN only looks 30 days).
 *   - events every My PC shows, set by admins in the App Store Manager > Settings > Events (GlobalSettings.events(), src 'admin').
 *   - the Hijri date as in Morocco: Events.hijri(d) { y, m, d } / hijriText(d) / hijriMonth(m): Umm al-Qura (Intl) moved per Hijri
 *     month by the lag of the nearest official Moroccan Eid / new year / Mawlid (Google's dates, else KNOWN: 2025 = +1 day,
 *     2026 = 0), minus the profile's correction (cal_hijri_adj, -2..2). The built-in Islamic days follow it.
 *   - the profile's own events (key cal_events: [{ id, date, time, title, remind, yearly }], old cal_notes migrated):
 *     Events.mine() / add / update / remove / onChange; Events.day(s, true) / range(from, to, true) include them as
 *     { kind: 'mine', id: 'mine', uid, t, time, remind, yearly } (the wallpaper never sees them). */
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
        var p = (hasStore() && Store.get('events', null)) || {};
        return { country: COUNTRIES.indexOf(p.country) >= 0 ? p.country : 'ma', football: p.football !== false };
    }
    function setPrefs(o) { var p = prefs(); for (var k in o) p[k] = o[k]; Store.set('events', p); }

    function cache() { var c = Store.rawGet(KEY); return c && typeof c === 'object' ? c : {}; }
    function save(c) { Store.rawSet(KEY, c); anchors = null; yearMemo = {}; }

    /* ---------- built-in Moroccan holidays (when Google cannot be reached) ---------- */

    var FIXED = [['01-01', 'newyear'], ['01-11', 'manifesto'], ['01-14', 'yennayer'], ['05-01', 'labour'], ['07-30', 'throne'], ['08-14', 'oued'],
                 ['08-20', 'revolution'], ['08-21', 'youth'], ['10-31', 'unity'], ['11-06', 'greenmarch'], ['11-18', 'independence']];
    // [Islamic month, day, id, days]: 1 Muharram, 12 Rabi al-Awwal, 1 Shawwal (2 days), 10 Dhu al-Hijja (2 days); Ramadan is a period
    var HIJRI = [[1, 1, 'hijri', 1], [3, 12, 'mawlid', 1], [10, 1, 'eidfitr', 2], [12, 10, 'eidadha', 2]];
    var yearMemo = {};
    function hijriOf(d) { var h = hijri(ymd(d)); return { month: h.m, day: h.d }; }

    /* ---------- the Hijri date as in Morocco ---------- */

    var uqFmt, uqOk, uqCache = {}, uqN = 0, anchors = null, DAY_MS = 86400000;
    function dayNum(k) { var p = k.split('-'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / DAY_MS); }
    function umalqura(k) {
        var c = uqCache[k];
        if (c) return c;
        if (++uqN > 4000) { uqCache = {}; uqN = 0; }
        return (uqCache[k] = umalquraNow(k));
    }
    function umalquraNow(k) {
        var p = k.split('-'), t = Date.UTC(+p[0], +p[1] - 1, +p[2], 12);
        if (uqOk === undefined) {
            try {
                uqFmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { timeZone: 'UTC', day: 'numeric', month: 'numeric', year: 'numeric' });
                uqOk = uqFmt.resolvedOptions().calendar === 'islamic-umalqura' && !!uqFmt.formatToParts;
            } catch (e) { uqOk = false; }
        }
        if (uqOk) {
            try {
                var parts = uqFmt.formatToParts(new Date(t)), o = {};
                for (var i = 0; i < parts.length; i++) o[parts[i].type] = parts[i].value;
                var y = parseInt(o.year || o.relatedYear, 10), m = parseInt(o.month, 10), d = parseInt(o.day, 10);
                if (y > 1300 && m >= 1 && m <= 12 && d >= 1 && d <= 30) return { y: y, m: m, d: d };
            } catch (e2) {}
        }
        return civil(Math.floor(t / DAY_MS) + 2440588);
    }
    // the tabular (civil) Islamic calendar: when Intl has no Umm al-Qura
    function civil(jd) {
        var l = jd - 1948440 + 10632, n = Math.floor((l - 1) / 10631);
        l = l - 10631 * n + 354;
        var j = Math.floor((10985 - l) / 5316) * Math.floor((50 * l) / 17719) + Math.floor(l / 5670) * Math.floor((43 * l) / 15238);
        l = l - Math.floor((30 - j) / 15) * Math.floor((17719 * j) / 50) - Math.floor(j / 16) * Math.floor((15238 * j) / 43) + 29;
        var m = Math.floor((24 * l) / 709), d = l - Math.floor((709 * m) / 24), y = 30 * n + j - 30;
        return { y: y, m: m, d: d };
    }
    // official Moroccan days that fix a Hijri date: [month, day]; KNOWN = the Ministry of Habous' dates known when this was written
    var ANCHOR = { hijri: [1, 1], mawlid: [3, 12], eidfitr: [10, 1], eidadha: [12, 10] };
    var KNOWN = [{ d: '2025-03-31', id: 'eidfitr' }, { d: '2025-06-07', id: 'eidadha' }, { d: '2026-03-20', id: 'eidfitr' }, { d: '2026-05-27', id: 'eidadha' }];
    function findAnchors() {
        if (anchors) return anchors;
        anchors = [];
        var c = hasStore() ? cache() : {}, g = c.hol && c.hol.k && c.hol.k.indexOf('ma:') === 0 && c.hol.list ? c.hol.list : [], seen = {};
        var l = g.filter(function (e) { return e.src !== 'mypc'; }).concat(KNOWN);
        for (var i = 0; i < l.length; i++) {
            var a = ANCHOR[l[i].id], yk = l[i].id + l[i].d.slice(0, 4);
            if (!a || seen[yk]) continue;
            seen[yk] = 1;                                        // the first day of a 2-day Eid
            for (var lag = -2; lag <= 3; lag++) {
                var u = umalqura(addDays(l[i].d, -lag));
                if (u.m === a[0] && u.d === a[1]) { anchors.push({ mi: u.y * 12 + u.m - 1, lag: lag }); break; }
            }
        }
        return anchors;
    }
    function hasStore() { return typeof Store !== 'undefined'; }
    function hijriAdj() { return hasStore() ? Math.max(-2, Math.min(2, parseInt(Store.get('cal_hijri_adj', 0), 10) || 0)) : 0; }
    // the lag of one Hijri month (index y * 12 + m - 1): its own anchor, else the nearest one; the same for every day of a month,
    // so a month never shows a day twice or skips one
    function lagOf(mi) {
        var best = null, l = findAnchors();
        for (var i = 0; i < l.length; i++) {
            var dist = Math.abs(l[i].mi - mi), bd = best ? Math.abs(best.mi - mi) : 0;
            if (!best || dist < bd || (dist === bd && l[i].mi < mi)) best = l[i];
        }
        return (best ? best.lag : 0) - hijriAdj();
    }
    function uqStart(k) { var u = umalqura(k); return { k: addDays(k, 1 - u.d), y: u.y, m: u.m }; }
    function hijri(d) {
        var k = typeof d === 'string' ? d : ymd(d), cur = uqStart(k), months = [uqStart(addDays(cur.k, -1)), cur, uqStart(addDays(cur.k, 30))], hit = null;
        for (var i = 0; i < months.length; i++) {
            var mo = months[i], s0 = addDays(mo.k, lagOf(mo.y * 12 + mo.m - 1));
            if (s0 <= k) hit = { y: mo.y, m: mo.m, s: s0 };
        }
        if (!hit) hit = { y: months[0].y, m: months[0].m, s: months[0].k };
        return { y: hit.y, m: hit.m, d: dayNum(k) - dayNum(hit.s) + 1 };
    }
    var HM = {
        en: ['Muharram', 'Safar', 'Rabi al-Awwal', 'Rabi al-Thani', 'Jumada al-Ula', 'Jumada al-Akhira', 'Rajab', 'Shaban', 'Ramadan', 'Shawwal', 'Dhu al-Qadah', 'Dhu al-Hijjah'],
        fr: ['Mouharram', 'Safar', 'Rabia al-awal', 'Rabia ath-thani', 'Joumada al-oula', 'Joumada ath-thania', 'Rajab', 'Chaabane', 'Ramadan', 'Chawwal', 'Dhou al-qi’da', 'Dhou al-hijja'],
        es: ['Muharram', 'Safar', 'Rabi al-Awwal', 'Rabi al-Thani', 'Yumada al-Ula', 'Yumada al-Ajira', 'Rayab', 'Shabán', 'Ramadán', 'Shawwal', 'Dhu al-Qada', 'Dhu al-Hiyya'],
        ar: ['محرم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة', 'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة']
    };
    function lang() { return typeof I18n !== 'undefined' ? I18n.lang() : 'en'; }
    function hijriMonth(m, l) { return (HM[l || lang()] || HM.en)[m - 1] || ''; }
    function hijriText(d, l) {
        l = l || lang();
        var h = hijri(d);
        return h.d + ' ' + hijriMonth(h.m, l) + ' ' + h.y + (l === 'ar' ? ' هـ' : l === 'fr' ? ' H' : ' AH');
    }
    function setHijriAdj(n) { Store.set('cal_hijri_adj', Math.max(-2, Math.min(2, n | 0))); yearMemo = {}; emit(); }
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
    // My PC's own copy of Google's Moroccan calendar (+ the big events): cb(holidays | null, bigEvents | null)
    function base() { try { return (typeof AppBoot !== 'undefined' && AppBoot.base && AppBoot.base()) || ''; } catch (e) { return ''; } }
    function fromSite(txt) {
        var j = null;
        try { j = JSON.parse(txt); } catch (e) {}
        if (!j || typeof j !== 'object') return { hol: null, big: null };
        var ok = function (e) { return e && /^\d{4}-\d\d-\d\d$/.test(e.d) && (!e.e || /^\d{4}-\d\d-\d\d$/.test(e.e)); };
        var hol = Array.isArray(j.holidays) && j.source && j.source !== 'built-in' ? j.holidays.filter(ok).slice(0, 400) : null;
        var big = Array.isArray(j.events) ? j.events.filter(ok).slice(0, 300).map(function (e) {
            return { d: e.d, e: e.e, id: String(e.id || 'event').slice(0, 30), t: typeof e.t === 'string' ? e.t.slice(0, 80) : '', time: /^\d\d:\d\d$/.test(e.time || '') ? e.time : '', kind: 'event', pub: false, src: 'site' };
        }) : null;
        return { hol: hol && hol.length ? hol : null, big: big };
    }
    function fetchHolidays(cc, cb, onBig) {
        if (cc === 'ma') {
            return get(base() + 'data/events-ma.json?d=' + today(), 8000, function (e, t) {
                var r = e ? { hol: null, big: null } : fromSite(t);
                if (r.big && onBig) onBig(r.big);
                if (r.hol) return cb(r.hol, 'site');
                fetchGoogle(cc, cb);
            });
        }
        fetchGoogle(cc, cb);
    }
    function fetchGoogle(cc, cb) {
        var y = new Date().getFullYear(), id = calId(cc), key = typeof Cloud !== 'undefined' && Cloud.key ? Cloud.key : '';
        var api = 'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(id) + '/events?singleEvents=true&maxResults=500&orderBy=startTime' +
                  '&timeMin=' + (y - 1) + '-12-01T00:00:00Z&timeMax=' + (y + 1) + '-12-31T23:59:59Z&key=' + key;
        var ics = 'https://calendar.google.com/calendar/ical/' + encodeURIComponent(id) + '/public/basic.ics';
        function viaIcs() { get(ics, 12000, function (e, t) { var l = e ? null : fromIcs(t); cb(l && l.length ? l : null, 'ics'); }); }
        if (!key) return viaIcs();
        get(api, 10000, function (e, t) { var l = e ? null : fromApi(t); if (l && l.length) cb(l, 'api'); else viaIcs(); });
    }

    /* ---------- football (ESPN) ---------- */

    /* Owner rule 2026-11-09: only the big nights. Champions League: semi-finals and the final only. World Cup, AFCON, qualifiers,
     * friendlies: only Morocco's matches. CAF Champions League: only the matches of a Moroccan club. Nothing else. (Shown on screen
     * as dwFootballRules: keep both in step.) */
    var LEAGUES = [['uefa.champions', 'ucl'], ['caf.champions', 'cafcl'], ['fifa.world', 'worldcup'], ['caf.nations', 'afcon'], ['fifa.friendly', ''], ['fifa.worldq.caf', '']];
    var FB_V = 2;           // the rules above changed: a football list kept by an older version is asked again
    function teamName(c) { var t = c && c.team || {}; return String(t.displayName || t.name || '') + ' ' + String(t.shortDisplayName || ''); }
    function isMorocco(c) { var t = c && c.team || {}; return t.abbreviation === 'MAR' || /^morocco$|^maroc$/i.test(t.displayName || t.name || ''); }
    // the Moroccan clubs that play in Africa (names as ESPN writes them, with the usual other spellings)
    var MA_CLUBS = /wydad|raja|\bfar\b|far rabat|forces arm|berkane|renaissance sportive|\bfus\b|fath union|maghreb|mas f[eè]s|hassania|olympi(c|que) (de )?safi|ittihad (riadi )?tanger|\birt\b|difa[aâ]|jadida|mouloudia (club )?oujda|union touarga|chabab mohammedia|kawkab|codm|moghreb t[eé]touan/i;
    function isMaClub(c) { var t = c && c.team || {}; return MA_CLUBS.test(teamName(c)) || /morocco|maroc/i.test(String(t.location || '')); }
    function bigStage(slug) { return /final/.test(slug) && !/quarter|round|1\/8|eighth/.test(slug); }      // semifinals, final
    function fromEspn(txt, lg) {
        var j = null, out = [];
        try { j = JSON.parse(txt); } catch (e) {}
        if (!j || !j.events) return null;
        for (var i = 0; i < j.events.length; i++) {
            var ev = j.events[i], comp = ev.competitions && ev.competitions[0], cs = comp && comp.competitors || [], at = Date.parse(ev.date);
            if (!at || cs.length < 2) continue;
            var home = cs[0].homeAway === 'away' ? cs[1] : cs[0], away = home === cs[0] ? cs[1] : cs[0], mar = isMorocco(home) || isMorocco(away);
            var slug = String(ev.season && ev.season.slug || (comp.type && comp.type.slug) || '').toLowerCase(), id;
            if (lg[1] === 'ucl') { if (!bigStage(slug)) continue; id = /semi/.test(slug) ? 'uclsemi' : 'uclfinal'; }
            else if (lg[1] === 'cafcl') { if (!isMaClub(home) && !isMaClub(away)) continue; id = 'cafcl'; }
            else { if (!mar) continue; id = 'morocco'; }
            var d = new Date(at);
            out.push({ d: ymd(d), at: at, id: id, kind: 'football', lg: lg[1] || 'friendly', stage: slug, src: 'espn', pub: false,
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
        var needFb = p.football && (!c.fb || c.fb.v !== FB_V || now - (c.fb.at || 0) > FB_AGE || c.fb.day !== today());
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
            }, function (big) { c.big = { at: Date.now(), list: big }; changed = true; });
        }
        if (needFb) {
            left++;
            fetchFootball(function (list) {
                if (list) c.fb = { v: FB_V, at: Date.now(), day: today(), list: list };
                else c.fb = { v: FB_V, at: Date.now() - FB_AGE + 3600000, day: today(), list: c.fb && c.fb.v === FB_V && c.fb.list || [] };
                changed = true;
                done();
            });
        }
    }

    var RANK = { eidadha: 100, eidfitr: 99, morocco: 90, throne: 80, greenmarch: 79, independence: 78, unity: 77, revolution: 76, youth: 75,
                 oued: 74, manifesto: 73, yennayer: 72, newyear: 71, hijri: 70, mawlid: 69, labour: 60, uclfinal: 58, uclsemi: 57, cafcl: 54, worldcup: 56, afcon: 55,
                 christmas: 50, nye: 45, ramadan: 40, ucl: 35 };
    function rank(e) { return e.kind === 'mine' ? 5 : RANK[e.id] || (e.pub ? 30 : 10); }

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
    // big events (the site's list, the Manager's) on a day; one already brought by ESPN that day is left out
    function bigOn(s, fbIds) {
        var c = cache(), out = [], l = (c.big && c.big.list || []).concat(adminEvents());
        for (var i = 0; i < l.length; i++) {
            var e = l[i];
            if (s >= e.d && s <= (e.e || e.d) && !fbIds[e.id]) out.push(e);
        }
        return out;
    }
    function adminEvents() {
        if (typeof GlobalSettings === 'undefined' || !GlobalSettings.events) return [];
        return GlobalSettings.events().map(function (e) { return { d: e.date, e: e.end && e.end !== e.date ? e.end : undefined, id: e.tag || 'event', t: e.title, time: e.time || '', kind: 'event', pub: false, src: 'admin' }; });
    }
    function day(s, withMine) {
        s = s || today();
        var out = holidaysOn(s), c = cache(), i, seen = {}, fbIds = {};
        if (prefs().football && c.fb && c.fb.v === FB_V && c.fb.list) for (i = 0; i < c.fb.list.length; i++) if (c.fb.list[i].d === s) { out.push(c.fb.list[i]); fbIds[c.fb.list[i].id] = 1; }
        out = out.concat(bigOn(s, fbIds));
        if (withMine) out = out.concat(mineOn(s));
        // one entry per id (the second day of Eid stays one entry), the most important first
        out = out.filter(function (e) { var k = e.uid ? 'mine:' + e.uid : e.src === 'admin' ? 'admin:' + e.t : e.id ? e.id + (e.teams ? e.teams.join() : '') : e.t; if (seen[k]) return false; seen[k] = 1; return true; });
        out.sort(function (a, b) { return rank(b) - rank(a) || (a.at || 0) - (b.at || 0) || ((a.time || '') < (b.time || '') ? -1 : (a.time || '') > (b.time || '') ? 1 : 0); });
        return out;
    }
    function range(from, to, withMine) {
        var out = [];
        for (var s = from; s <= to; s = addDays(s, 1)) {
            var l = day(s, withMine);
            for (var i = 0; i < l.length; i++) { var e = {}; for (var k in l[i]) e[k] = l[i][k]; e.on = s; out.push(e); }
        }
        return out;
    }

    /* ---------- the profile's own events (Calendar app) ---------- */

    var listeners = [], MAX_MINE = 500, REMIND = [-1, 0, 15, 60, 1440];
    function okDay(k) { return typeof k === 'string' && /^\d{4}-\d\d-\d\d$/.test(k); }
    function mine() {
        if (!hasStore()) return [];
        var l = Store.get('cal_events', null);
        if (!Array.isArray(l)) {
            l = [];
            // the old day notes (a list of texts per day) become all-day events, once
            var notes = Store.get('cal_notes', null), n = 0;
            if (notes && typeof notes === 'object') {
                for (var k in notes) if (okDay(k) && Array.isArray(notes[k])) notes[k].forEach(function (t) { l.push({ id: 'n' + (n++), date: k, time: '', title: String(t).slice(0, 60), remind: -1, yearly: false }); });
                Store.remove('cal_notes');
            }
            Store.set('cal_events', l);
        }
        return l.filter(function (e) { return e && okDay(e.date) && typeof e.title === 'string'; });
    }
    function cleanMine(ev) {
        return { date: okDay(ev.date) ? ev.date : today(), time: /^([01]\d|2[0-3]):[0-5]\d$/.test(ev.time || '') ? ev.time : '', title: String(ev.title || '').trim().slice(0, 60),
                 remind: REMIND.indexOf(+ev.remind) >= 0 ? +ev.remind : -1, yearly: !!ev.yearly };
    }
    function add(ev) {
        var l = mine(), o = cleanMine(ev);
        if (!o.title || l.length >= MAX_MINE) return null;
        o.id = 'e' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
        l.push(o); Store.set('cal_events', l); emit();
        return o;
    }
    function update(id, ev) {
        var l = mine(), hit = null;
        for (var i = 0; i < l.length; i++) if (l[i].id === id) { var o = cleanMine(ev); o.id = id; l[i] = hit = o; }
        if (hit) { Store.set('cal_events', l); emit(); }
        return hit;
    }
    function remove(id) {
        var l = mine(), n = l.length;
        l = l.filter(function (e) { return e.id !== id; });
        if (l.length !== n) { Store.set('cal_events', l); emit(); }
    }
    function onChange(fn) { listeners.push(fn); }
    function emit() { for (var i = 0; i < listeners.length; i++) try { listeners[i](); } catch (e) {} }
    // the profile's events on a day (a yearly one on its day of every later year; 29 February on the 28th otherwise)
    function mineOn(s) {
        var out = [], md = s.slice(5);
        mine().forEach(function (e) {
            var hit = e.date === s;
            if (!hit && e.yearly && e.date < s) {
                var em = e.date.slice(5);
                hit = em === md || (em === '02-29' && md === '02-28' && new Date(+s.slice(0, 4), 1, 29).getMonth() !== 1);
            }
            if (hit) out.push({ d: s, id: 'mine', uid: e.id, t: e.title, time: e.time, remind: e.remind, yearly: e.yearly, first: e.date, kind: 'mine', pub: false, src: 'mine' });
        });
        return out;
    }
    // the next n entries from day s (own events included), one per entry
    function next(s, n, withMine) {
        var out = [];
        for (var k = s, i = 0; i < 400 && out.length < (n || 5); i++, k = addDays(k, 1)) {
            day(k, withMine).forEach(function (e) { if ((e.d === k || k === s) && e.id !== 'ramadan' && out.length < (n || 5)) { var o = {}; for (var x in e) o[x] = e[x]; o.on = k; out.push(o); } });
        }
        return out;
    }

    /* ---------- the Calendar's view of a day ---------- */

    // kinds as the Calendar colours them: holiday (a day off) | observance | event (football, big events) | mine
    function kindOf(e) {
        if (e.kind === 'mine') return 'mine';
        if (e.kind === 'event' || e.kind === 'football') return 'event';
        return (e.kind === 'holiday' || e.kind === 'islamic') && e.pub ? 'holiday' : 'observance';
    }
    function timeOf(e) { if (e.time) return e.time; if (e.at) { var d = new Date(e.at); return pad(d.getHours()) + ':' + pad(d.getMinutes()); } return ''; }
    // a day's entries: one per thing (a night of 8 Champions League matches is one entry; the matches go in its text)
    function list(k) {
        var out = [], byId = {};
        day(k, true).forEach(function (e) {
            if (e.id === 'ramadan' && e.day > 1) return;                          // Ramadan: only its first day (the cells are tinted)
            if (e.kind === 'football') {
                var g = byId[e.id];
                if (g) { if (e.teams) g.teams.push(e.teams.join(' – ')); return; }
                g = byId[e.id] = { src: e, kind: 'event', title: title(e) || e.teams.join(' – '), time: timeOf(e), teams: e.teams ? [e.teams.join(' – ')] : [] };
                out.push(g); return;
            }
            out.push({ src: e, kind: kindOf(e), title: title(e), time: timeOf(e), est: e.src === 'mypc' && e.kind === 'islamic', first: e.d, last: e.e || e.d });
        });
        return out.filter(function (x) { return x.title; });
    }
    function same(a, b) { return key(a) === key(b); }
    // Monday first, except English (Sunday first)
    function firstDow() { return I18n.lang() === 'en' ? 0 : 1; }
    function fmt(d, o) { return Desktop.dateText(d, o); }
    function clock(hhmm) { var p = hhmm.split(':'), d = new Date(2000, 0, 1, +p[0], +p[1]); return Desktop.timeText(d); }
    function button(cls, text, onclick, label) {
        var b = el('button', cls, text);
        b.setAttribute('data-focus', '');
        if (label) b.setAttribute('aria-label', label);
        b.onclick = onclick;
        return b;
    }
    function title(e) {
        if (!e) return '';
        var k = 'ev_' + e.id;
        if (e.id && typeof I18n !== 'undefined' && I18n.t(k) !== k) return I18n.t(k);
        return e.t || '';
    }

    return { day: day, range: range, refresh: refresh, prefs: prefs, setPrefs: setPrefs, title: title, rank: rank, COUNTRIES: COUNTRIES,
             ymd: ymd, addDays: addDays, today: today, source: function () { var c = cache(); return { holidays: c.hol ? c.hol.via : '', football: c.fb ? !!(c.fb.list && c.fb.list.length) : false }; },
             parseYmd: parseYmd, hijri: hijri, hijriText: hijriText, hijriMonth: hijriMonth, hijriAdj: hijriAdj, setHijriAdj: setHijriAdj,
             list: list, mine: mine, add: add, update: update, remove: remove, onChange: onChange, next: next,
             _builtin: builtin, _fromIcs: fromIcs, _fromApi: fromApi, _fromEspn: fromEspn, _fromSite: fromSite, _idOf: idOf, _umalqura: umalqura, _civil: civil,
             _reset: function () { anchors = null; yearMemo = {}; uqCache = {}; } };
})();
if (typeof module !== 'undefined') module.exports = Events;
