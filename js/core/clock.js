/* Clock: makes every local time in My PC (taskbar clock, widgets, Calendar, Weather, Playtime days...) show the
 * TV's own time when the web engine's time zone data is wrong.
 *
 * Why: the browser engine ships its own copy of the world's time zones, often years old. Morocco moved to plain
 * UTC (GMT+0) for good on 2026-09-20, but Chromium (TV and PC alike) still puts Africa/Casablanca at GMT+1, so the
 * engine showed 19:15 while the TV said 18:15. The moment itself (Date.now()) is right: only the local fields are off.
 *
 * Where the right offset comes from, first that answers:
 *   1. Control Panel > Date and time > Time correction set by hand (TV-wide `arc_dev_clock_adj`: minutes ahead of UTC; none = automatic)
 *   2. the TV's own clock: tizen.time.getCurrentDateTime() (system time zone, Samsung keeps it current)
 *   3. known changes the engine may not know yet (RULES below; per date, so old and future dates stay right)
 * When none differs from the engine, nothing is patched at all. Otherwise Date's local getters / setters, the
 * constructor with local fields, Date.parse of zone-less date-times and toLocale*String (without their own
 * timeZone) follow the corrected offset (Intl.DateTimeFormat objects do not: pass timeZone 'UTC' and a shifted Date if needed). getTime / Date.now / toISOString never change (Firestore, timers stay true).
 * Must load first (app-manifest.json js[0]) so no Date is read before. */
var Clock = (function () {
    'use strict';
    var OrigDate = Date, P = OrigDate.prototype, KEY = 'arc_dev_clock_adj';
    var oGetTime = P.getTime, oSetTime = P.setTime, oOff = P.getTimezoneOffset, oNow = OrigDate.now, oParse = OrigDate.parse;
    // the engine's zone can be wrong after these dates: [zone, from (UTC ms), right offset in getTimezoneOffset minutes]
    var RULES = [
        ['Africa/Casablanca', OrigDate.UTC(2026, 8, 20, 2), 0],       // Morocco: plain UTC from 2026-09-20 03:00
        ['Africa/El_Aaiun', OrigDate.UTC(2026, 8, 20, 2), 0]
    ];
    var zone = '', tvZone = '', manual = null, tvShift = 0, checked = -1e15, installed = false, scratch = new OrigDate(0);

    function engineZone() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; } }
    function readManual() {
        var v = null;
        try { v = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
        return typeof v === 'number' && isFinite(v) && Math.abs(v) <= 14 * 60 ? v : null;
    }
    // the TV's wall clock vs the engine's, in whole minutes (0 when the same or not a TV)
    function readTv() {
        var tt = window.tizen && tizen.time;
        if (!tt || !tt.getCurrentDateTime) return 0;
        try {
            var tz = tt.getCurrentDateTime(), now = oNow();
            try { tvZone = String(tt.getLocalTimezone() || ''); } catch (e1) {}
            var c = OrigDate.UTC(tz.getFullYear(), tz.getMonth(), tz.getDate(), tz.getHours(), tz.getMinutes(), tz.getSeconds(), tz.getMilliseconds());
            oSetTime.call(scratch, now);
            var e = now - oOff.call(scratch) * 60000, d = Math.round((c - e) / 60000) * 60000;
            return Math.abs(d) <= 26 * 3600000 ? d : 0;
        } catch (e2) { return 0; }
    }
    function rule(z) { for (var i = 0; i < RULES.length; i++) if (RULES[i][0] === z) return RULES[i]; return null; }
    function refresh() {
        checked = oNow();
        zone = engineZone();
        manual = readManual();
        tvShift = readTv();
        if (!installed && (manual !== null || tvShift || needsRule())) install();
    }
    function needsRule() {
        var r = rule(zone) || rule(tvZone);
        if (!r) return false;
        oSetTime.call(scratch, oNow());
        return oOff.call(scratch) !== r[2];
    }

    // ms to add to the engine's local fields at moment t
    function shiftAt(t) {
        if (oNow() - checked > 600000) refresh();             // looked again every 10 min (no timer)
        if (manual !== null) { oSetTime.call(scratch, t); return (oOff.call(scratch) + manual) * 60000; }
        return autoShift(t);
    }
    function autoShift(t) {
        if (tvShift) return tvShift;
        var r = rule(zone) || rule(tvZone);
        if (!r || !(t >= r[1])) return 0;
        oSetTime.call(scratch, t);
        return (oOff.call(scratch) - r[2]) * 60000;
    }
    // the engine's local fields of a moment, moved by the shift (on the shared scratch Date: no allocation)
    function shifted(d) {
        var t = oGetTime.call(d);
        if (t !== t) return null;
        oSetTime.call(scratch, t + shiftAt(t));
        return scratch;
    }
    // engine-local moment r (fields as the engine reads them) -> the real moment whose corrected fields they are
    function unshift(r) { return r !== r ? r : r - shiftAt(r - shiftAt(r)); }

    function install() {
        if (installed) return;
        installed = true;
        ['getFullYear', 'getMonth', 'getDate', 'getDay', 'getHours', 'getMinutes'].forEach(function (n) {
            var o = P[n];
            P[n] = function () { var s = shifted(this); return s ? o.call(s) : NaN; };
        });
        P.getTimezoneOffset = function () {
            var t = oGetTime.call(this);
            return t !== t ? NaN : oOff.call(this) - shiftAt(t) / 60000;
        };
        ['setFullYear', 'setMonth', 'setDate', 'setHours', 'setMinutes'].forEach(function (n) {
            var o = P[n];
            P[n] = function () {
                var t = oGetTime.call(this);
                if (t !== t) return o.apply(this, arguments);     // invalid date: the engine's own rules
                var w = new OrigDate(t + shiftAt(t));
                o.apply(w, arguments);
                return oSetTime.call(this, unshift(oGetTime.call(w)));
            };
        });
        ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'].forEach(function (n) {
            var o = P[n];
            P[n] = function (loc, opts) {
                var t = oGetTime.call(this);
                if (t !== t || (opts && opts.timeZone)) return o.apply(this, arguments);
                var s = shiftAt(t);
                if (!s) return o.apply(this, arguments);
                var c = {}, k;
                if (opts) for (k in opts) c[k] = opts[k];
                c.timeZone = 'UTC';
                // the corrected wall clock read as UTC
                return o.call(new OrigDate(t - oOff.call(this) * 60000 + s), loc, c);
            };
        });
        // zone-less date-times ('2026-11-07T18:15', 'Nov 7 2026 18:15') are local: local means the corrected clock
        function localString(s) {
            s = String(s);
            if (/^\s*\d{4}-\d\d-\d\d\s*$/.test(s)) return false;          // ISO date only = UTC
            return !/(Z|[+-]\d\d:?\d\d|GMT|UTC)\s*$/i.test(s) && !/(GMT|UTC)[+-]/i.test(s);
        }
        function parse(s) { var r = oParse(s); return localString(s) ? unshift(r) : r; }
        function D(a, b, c, d, e, f, g) {
            if (!(this instanceof D)) return new OrigDate(oNow()).toString();
            var n = arguments.length, x;
            if (n === 0) x = new OrigDate();
            else if (n === 1) x = typeof a === 'string' ? new OrigDate(parse(a)) : new OrigDate(a);
            else {
                x = new OrigDate(a, b, n > 2 ? c : 1, n > 3 ? d : 0, n > 4 ? e : 0, n > 5 ? f : 0, n > 6 ? g : 0);
                oSetTime.call(x, unshift(oGetTime.call(x)));
            }
            Object.setPrototypeOf(x, Object.getPrototypeOf(this));          // keeps subclasses working
            return x;
        }
        D.prototype = P;
        P.constructor = D;
        D.now = OrigDate.now; D.UTC = OrigDate.UTC; D.parse = parse;
        try { Object.defineProperty(D, 'name', { value: 'Date' }); } catch (e) {}
        window.Date = D;
    }

    refresh();
    try {
        document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
    } catch (e) {}

    return {
        // minutes the clock is moved now (0 = the engine's own time), and why: 'manual' | 'tv' | 'rule' | ''
        info: function () {
            var t = oNow(), s = shiftAt(t);
            return { shift: s / 60000, source: manual !== null ? 'manual' : tvShift ? 'tv' : s ? 'rule' : '', zone: zone, tvZone: tvZone };
        },
        // minutes ahead of UTC that the automatic choice gives now (the TV's clock, a known change, or the engine)
        auto: function () { var t = oNow(); oSetTime.call(scratch, t); return -oOff.call(scratch) + autoShift(t) / 60000; },
        manual: function () { return manual; },                  // minutes ahead of UTC, null = automatic
        setManual: function (min) {                               // minutes ahead of UTC (like +60), or null = automatic
            try { if (min === null || min === undefined) localStorage.removeItem(KEY); else localStorage.setItem(KEY, JSON.stringify(min)); } catch (e) {}
            refresh();
        },
        refresh: refresh
    };
})();
