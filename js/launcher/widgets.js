/* Desktop widgets (owner request 2026-11-04): Weather, Playtime, System Monitor, Music Player, plus the widgets that store
 * apps ship (mypc-app.json "widgets", approved in the App Store Manager > Widgets; rules in js/core/widget-lib.js).
 *
 * Cheap on purpose (low-end TVs): one card per widget in #desk-widgets, redrawn only when what it shows changed; one
 * setTimeout per widget at its own refresh rate; nothing runs for a hidden widget. When an app or a game takes the screen
 * (Desktop.hide, the game page, My PC in the background) every widget stops, except the ones whose "Run in the background"
 * is on (Music Player by default): they keep refreshing, so their card is up to date the moment the desktop comes back.
 * An app widget's code runs in a data: Worker (opaque origin), one at a time, killed after 10 s; between two refreshes it
 * costs nothing. Per profile (Control Panel > Widgets): show / hide, refresh rate, background, the widget's own settings,
 * order: profile key widgets = { on, order: [ids], w: { <id>: { show, every (s), bg, s: { settings } } } }.
 * Last views (instant desktop, offline): arc_dev_wcache; approved app widget code by SHA-256: arc_dev_wcode (both not backed up). */
var Widgets = (function () {
    'use strict';

    var WL = window.WidgetLib;
    var CACHE = 'arc_dev_wcache', CODE = 'arc_dev_wcode';
    var box = null, onDesk = false, headless = false, timers = {}, last = {}, views = {}, painted = {}, busy = {}, again = {}, queue = [], working = false;

    function t(k) { return I18n.t(k); }
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
    function now() { return Date.now(); }

    /* ---------------- the built-in widgets ----------------
     * def: { id, icon, title(), size, every (s), choices [s], bg, settings() (WidgetLib schema), refresh(ctx, done(view)),
     *        press(button id), open(), idle() (nothing changes: no timer) } */

    // Weather: the data comes from js/core/weather.js (shared with the Weather app: one request serves both, kept 10 min).
    // Owner request 2026-11-05: the temperature big on the left, a big sky picture beside it (both sizes in its settings), and
    // warnings: rain / snow within the chosen hours, a thunderstorm within 24 h (danger), also told once as a notification.
    var WX_T = { s: 44, m: 56, l: 68, xl: 84 }, WX_I = { s: 72, m: 96, l: 120, xl: 150 };
    function weather(ctx, done) {
        var s = ctx.settings, f = s.units === 'f';
        Weather.get(s, 600000, function (err, data, loc) {
            if (err === 'notfound') return done({ icon: 'i:cloud', big: '--', text: t('wgNoPlace').replace('%s', s.place) });
            if (!data || !data.now || data.now.temp === null) return done(stale(ctx.id, t('wgOffline')));
            var c = data.now, d = data.days[0] || {}, k = Weather.sky(c.code, c.day);
            var v = { icon: 'i:' + k.ic, art: k.ic, anim: s.anim !== false, bigSize: WX_T[s.tsize] || WX_T.l, artSize: WX_I[s.isize] || WX_I.l,
                      big: Math.round(c.temp) + '°', sub: loc.name, text: t('wx_' + k.k), rows: [] };
            var al = Weather.alerts(data, s.warn);
            if (al.length) { v.alerts = al.map(function (a) { return { level: a.level, text: Weather.alertText(a) }; }); tell(al); }
            if (d.hi !== null && d.hi !== undefined) v.rows.push({ label: t('wgHiLo'), value: Math.round(d.hi) + '° / ' + Math.round(d.lo) + '°' });
            if (ctx.size === 'large') {
                if (c.hum !== null) v.rows.push({ label: t('wgHumidity'), value: Math.round(c.hum) + ' %' });
                if (c.wind !== null) v.rows.push({ label: t('wgWind'), value: Math.round(c.wind) + (f ? ' mph' : ' km/h') });
            }
            if (err) v.sub = t('wgOffline');
            done(v);
        });
    }
    // a new warning is told once as a notification (red for a storm), while the desktop is on screen
    function tell(al) {
        if (!onDesk || typeof Notify === 'undefined') return;
        var told = Store.get('wx_told', []);
        told = Array.isArray(told) ? told : [];
        al.forEach(function (a) {
            if (told.indexOf(a.key) >= 0) return;
            told.push(a.key);
            Notify.show({ id: 'wx-' + a.kind, kind: a.level === 'danger' ? 'err' : 'warn', timeout: a.level === 'danger' ? 15000 : 8000, title: t(a.level === 'danger' ? 'wxDanger' : 'wxWarning'), text: Weather.alertText(a),
                          onClick: function () { Win.open('weather'); } });
        });
        Store.set('wx_told', told.slice(-20));
    }
    // the last view, marked as old (offline), or a first "loading" view
    function stale(id, why) {
        var v = views[id] || cached(id), o = {}, k;
        if (!v) return { text: why };
        for (k in v) o[k] = v[k];
        o.sub = why;
        return o;
    }

    function playtime(ctx, done) {
        var p = Playtime.summary(), h = t('wgH'), m = t('wgMin');
        var v = { icon: 'i:hourglass', big: Playtime.length(p.today, h, m), sub: t('wgToday'), rows: [{ label: t('wgWeek'), value: Playtime.length(p.week, h, m) }] };
        if (p.top && ctx.size !== 'small') v.rows.push({ label: t('wgTop'), value: p.top.t + ' · ' + Playtime.length(p.top.s, h, m) });
        if (p.last && ctx.size === 'large') v.rows.push({ label: t('wgLast'), value: p.last.t });
        if (!p.top) v.text = t('wgNoPlay');
        done(v);
    }

    // System Monitor: what the TV tells (Tizen systeminfo: CPU load, memory), else what the browser tells (My PC's memory)
    var stor = { at: 0, kb: 0 };
    function storageKb() {
        if (now() - stor.at < 60000) return stor.kb;                    // walking localStorage once a minute is enough
        var n = 0;
        try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k.indexOf('arc_') === 0) n += (k.length + (localStorage.getItem(k) || '').length) * 2; } } catch (e) {}
        stor = { at: now(), kb: Math.max(1, Math.round(n / 1024)) };
        return stor.kb;
    }
    function mb(b) { return Math.round(b / 1048576) + ' MB'; }
    function sysmon(ctx, done) {
        var v = { icon: 'i:chip', rows: [] }, si = window.tizen && tizen.systeminfo, finished = false;
        function fin(cpu) {
            if (finished) return;
            finished = true;
            if (cpu !== null && cpu !== undefined) { v.big = Math.round(cpu * 100) + ' %'; v.sub = t('wgCpu'); v.progress = cpu; }
            try {
                if (si && si.getTotalMemory) {
                    var tot = si.getTotalMemory(), av = si.getAvailableMemory();
                    v.rows.push({ label: t('wgMemory'), value: mb(tot - av) + ' / ' + mb(tot) });
                    if (v.progress === undefined) { v.big = Math.round((tot - av) * 100 / tot) + ' %'; v.sub = t('wgMemory'); v.progress = (tot - av) / tot; }
                }
            } catch (e) {}
            var pm = window.performance && performance.memory;
            if (pm && pm.usedJSHeapSize) {
                if (v.progress === undefined && pm.jsHeapSizeLimit) { v.big = mb(pm.usedJSHeapSize); v.sub = t('wgHeap'); v.progress = pm.usedJSHeapSize / pm.jsHeapSizeLimit; }
                else v.rows.push({ label: t('wgHeap'), value: mb(pm.usedJSHeapSize) });
            }
            if (ctx.size !== 'small') v.rows.push({ label: t('storage'), value: storageKb() + ' KB' });
            v.rows.push({ label: t('network'), value: t(navigator.onLine === false ? 'netOffShort' : 'netOnShort') });
            if (ctx.size === 'large' && navigator.hardwareConcurrency) v.rows.push({ label: t('wgCores'), value: String(navigator.hardwareConcurrency) });
            if (!v.big) { v.big = Perf.profile().tier; v.sub = t('device'); }
            done(v);
        }
        if (si && si.getPropertyValue) {
            try { si.getPropertyValue('CPU', function (c) { fin(c && typeof c.load === 'number' ? c.load : null); }, function () { fin(null); }); }
            catch (e) { fin(null); }
            setTimeout(function () { fin(null); }, 1500);
        } else fin(null);
    }

    // Calendar: today in the Gregorian and the Moroccan Hijri calendars, then today's and tomorrow's events (holidays, big events,
    // the profile's own), else the next one. No network here (Events.refresh reads the holidays when stale).
    function calendar(ctx, done) {
        var s = ctx.settings, now = new Date(), k = Events.ymd(now), k1 = Events.addDays(k, 1), l = I18n.lang();
        var dt = function (o) { return Desktop.dateText(now, o); };
        var v = { icon: 'i:calendar', page: { top: dt({ month: 'short' }).replace('.', ''), num: String(now.getDate()), bottom: String(now.getFullYear()) },
                  big: dt({ weekday: 'long' }), sub: dt({ day: 'numeric', month: 'long', year: 'numeric' }), events: [] };
        if (s.hijri !== 'no') v.text = Events.hijriText(k, l);
        // tomorrow: only what starts tomorrow (not the second day of today's Eid)
        var today = Events.list(k), tom = Events.list(k1).filter(function (e) { return !(e.first && e.first < k1) && !(e.src.id === 'ramadan' && e.src.day > 1); });
        var max = ctx.size === 'large' ? 4 : 3;
        today.forEach(function (e) { if (v.events.length < max) v.events.push({ when: t('calToday'), text: line(e), kind: e.kind }); });
        tom.forEach(function (e) { if (v.events.length < max) v.events.push({ when: t('calTomorrow'), text: line(e), kind: e.kind }); });
        if (!v.events.length) {
            var nx = null, d2 = Events.addDays(k, 2);
            for (var i = 0; i < 60 && !nx; i++) {
                nx = Events.list(d2).filter(function (e) { return !(e.first && e.first < d2) && e.src.id !== 'ramadan' || e.src.day === 1; })[0] || null;
                if (!nx) d2 = Events.addDays(d2, 1);
            }
            if (nx) v.events.push({ when: t('calNext'), text: nx.title + ' · ' + Desktop.dateText(Events.parseYmd(d2), { day: 'numeric', month: 'short' }), kind: nx.kind });
            else v.events.push({ when: '', text: t('calNothing'), kind: 'observance' });
        }
        if (s.notify !== 'no') told(tom, k1);
        done(v);
        Events.refresh(function (changed) { if (changed) refresh('calendar'); });
    }
    function line(e) { return e.title + (e.time ? ' · ' + Desktop.timeText(new Date(2000, 0, 1, +e.time.slice(0, 2), +e.time.slice(3))) : ''); }
    // tomorrow's holidays and big events, told once as a notification the day before (while the desktop is on screen)
    function told(list, k1) {
        if (!onDesk || typeof Notify === 'undefined') return;
        var seen = Store.get('cal_told', []);
        seen = Array.isArray(seen) ? seen : [];
        list.forEach(function (e) {
            if (e.kind === 'observance' || e.kind === 'mine') return;              // own events have their own reminders
            var id = k1 + ':' + (e.src.id || '') + ':' + e.title;
            if (seen.indexOf(id) >= 0) return;
            seen.push(id);
            Notify.show({ id: 'cal-' + (e.src.id || 'ev'), kind: 'info', timeout: 10000, title: t('wg_calendar'), text: t('calTomorrowIs').replace('%s', e.title),
                          onClick: function () { Win.open('calendar'); } });
        });
        Store.set('cal_told', seen.slice(-30));
    }

    var musicArt = '';
    function music(ctx, done) {
        var s = Music.state();
        if (!s.has) return done({ icon: 'i:music', text: t('muNothing'), sub: t('muWidgetHint'), buttons: [{ id: 'open', icon: 'play', label: t('music') }] });
        // the song's cover once the Music app has read it (asked once here, never read again while it plays)
        var art = typeof MusicSrc !== 'undefined' ? MusicSrc.peekArt(s.track) : null;
        var k = s.track.s + ':' + s.track.p;
        if (!art && typeof MusicSrc !== 'undefined' && musicArt !== k) { musicArt = k; MusicSrc.art(s.track, function (v) { if (v) refresh('music'); }); }
        done({ icon: 'i:music', image: art ? art.url : '', text: s.title, sub: (s.loading ? t('wgLoading') : s.artist ? s.artist + ' · ' : '') + (s.loading ? '' : Music.clock(s.pos) + (s.dur ? ' / ' + Music.clock(s.dur) : '')),
               progress: s.dur ? Math.min(1, s.pos / s.dur) : 0, loaded: s.loaded,
               buttons: [{ id: 'prev', icon: 'prev', label: t('wgPrev') }, { id: 'toggle', icon: s.playing ? 'pause' : 'play', label: t(s.playing ? 'wgPause' : 'wgPlay') },
                         { id: 'next', icon: 'next', label: t('wgNext') }] });
    }

    var BUILT = [
        { id: 'weather', icon: 'weather', title: function () { return t('wg_weather'); }, size: 'medium', every: 1800, choices: [900, 1800, 3600, 10800], bg: false,
          settings: function () {
              var sz = function (id, label) { return { id: id, type: 'select', label: t(label), 'default': 'l', options: ['s', 'm', 'l', 'xl'].map(function (x) { return { value: x, label: t('wxSz_' + x) }; }) }; };
              return [{ id: 'place', type: 'text', label: t('wgPlace'), 'default': '' },
                      { id: 'units', type: 'select', label: t('wgUnits'), 'default': 'c', options: [{ value: 'c', label: t('wgCelsius') }, { value: 'f', label: t('wgFahrenheit') }] },
                      { id: 'warn', type: 'select', label: t('wxWarn'), 'default': '6', options: [{ value: '0', label: t('wxWarnOff') }].concat(['1', '2', '4', '6', '8', '24'].map(function (h) { return { value: h, label: t('wxWarnH').replace('%n', h) }; })) },
                      sz('tsize', 'wxTSize'), sz('isize', 'wxISize'), { id: 'anim', type: 'toggle', label: t('wxAnim'), 'default': true }];
          }, refresh: weather, keep: true, open: function () { Win.open('weather'); } },
        { id: 'calendar', icon: 'calendar', title: function () { return t('wg_calendar'); }, size: 'medium', every: 900, choices: [300, 900, 1800, 3600], bg: false,
          settings: function () {
              var yn = function (id, label) { return { id: id, type: 'select', label: t(label), 'default': 'yes', options: [{ value: 'yes', label: t('calYes') }, { value: 'no', label: t('calNo') }] }; };
              return [yn('hijri', 'calShowHijri'), yn('notify', 'calNotify')];
          }, refresh: calendar, open: function () { Win.open('calendar'); } },
        { id: 'playtime', icon: 'hourglass', title: function () { return t('wg_playtime'); }, size: 'small', every: 300, choices: [60, 300, 900, 1800], bg: false, refresh: playtime,
          open: function () { Win.open('playtime'); } },
        { id: 'sysmon', icon: 'chip', title: function () { return t('wg_sysmon'); }, size: 'medium', every: 5, choices: [2, 5, 10, 30, 60], bg: false, refresh: sysmon },
        { id: 'music', icon: 'music', title: function () { return t('wg_music'); }, size: 'medium', every: 2, choices: [1, 2, 5, 10], bg: true, refresh: music,
          idle: function () { return !Music.state().playing; },
          press: function (b) { if (b === 'toggle') Music.toggle(); else if (b === 'next') Music.next(); else if (b === 'prev') Music.prev(); else if (b === 'open') Win.open('music'); },
          open: function () { Win.open('music'); } }
    ];

    /* ---------------- app widgets (installed store apps) ---------------- */

    function appDefs() {
        var out = [], list = typeof Cloud !== 'undefined' ? Cloud.apps() : [];
        list.forEach(function (a) {
            (Array.isArray(a.widgets) ? a.widgets : []).slice(0, WL.LIMITS.widgets).forEach(function (w) {
                if (!w || !w.id) return;
                out.push({ id: a.id + '__' + w.id, app: a, w: w, icon: 'appsNav', title: function () { return I18n.pick(w.title) || w.id; },
                           size: WL.SIZES.indexOf(w.size) >= 0 ? w.size : 'medium', every: (WL.EVERY.indexOf(+w.every) >= 0 ? +w.every : 15) * 60,
                           choices: WL.EVERY.map(function (m) { return m * 60; }), bg: w.background === true, approved: !!w.sha, keep: true,
                           settings: function () { return (w.settings || []).map(function (s) { var o = {}, k; for (k in s) o[k] = s[k]; o.label = I18n.pick(s.label) || s.id; return o; }); } });
            });
        });
        return out;
    }
    var defs = null;            // built once per render (Cloud.apps() reads storage)
    function all() { return defs || (defs = BUILT.concat(appDefs())); }
    function find(id) { var l = all(); for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }

    // the approved copy of an app widget's code: from this device, else Firestore widgets/<app>__<widget> (checked against the SHA-256)
    function code(d, cb) {
        var c = Store.rawGet(CODE) || {}, have = c[d.id];
        if (have && have.sha === d.w.sha && have.code) return cb(null, have.code);
        Cloud.get('widgets/' + encodeURIComponent(d.id), 8000, function (err, doc) {
            if (err || !doc || !doc.code) return cb(err || 'missing');
            if (doc.sha !== d.w.sha) return cb('pending');
            c = Store.rawGet(CODE) || {};
            for (var k in c) if (!find(k)) delete c[k];                      // uninstalled apps
            c[d.id] = { sha: doc.sha, code: String(doc.code).slice(0, WL.LIMITS.code) };
            Store.rawSet(CODE, c);
            cb(null, c[d.id].code);
        });
    }
    // one Worker at a time for the whole TV
    function runApp(d, ctx, done) {
        queue.push(function () {
            code(d, function (err, src) {
                if (err) { working = false; next(); return done(err === 'pending' ? { text: t('wgPending') } : stale(d.id, t('wgOffline'))); }
                var w, timer = 0, end = function (view) { clearTimeout(timer); try { w.terminate(); } catch (e) {} working = false; done(view); next(); };
                try { w = new Worker('data:text/javascript;charset=utf-8,' + encodeURIComponent(WL.WORKER)); }
                catch (e) { working = false; next(); return done({ text: t('wgFailed') }); }
                timer = setTimeout(function () { end(stale(d.id, t('wgFailed'))); }, WL.LIMITS.runMs);
                var st = null;
                try { st = JSON.parse(Store.get('wstate_' + d.id, 'null')); } catch (e) { st = null; }
                w.onmessage = function (e) {
                    var r = e.data || {};
                    if (!r.ok) { report(d, r.error); return end(stale(d.id, t('wgFailed'))); }
                    var res = WL.result(r.out);
                    if (res.state !== undefined) Store.set('wstate_' + d.id, res.state);
                    if (res.error && !res.view) report(d, res.error);
                    end(res.view || { text: t('wgFailed') });
                };
                w.onerror = function (e) { report(d, e.message || 'worker error'); if (e.preventDefault) e.preventDefault(); end(stale(d.id, t('wgFailed'))); };
                w.postMessage({ src: 'data:text/javascript;charset=utf-8,' + encodeURIComponent(src), app: d.app.id, widget: d.w.id, settings: ctx.settings, state: st,
                                size: ctx.size, lang: I18n.lang(), action: ctx.action || null, now: now(), lastRun: last[d.id] || 0, config: d.app.config || {} });
            });
        });
        next();
    }
    function next() { if (working || !queue.length) return; working = true; queue.shift()(); }
    function report(d, msg) {
        try { if (typeof Reports !== 'undefined') Reports.add('app-' + d.app.id, { kind: 'error', msg: 'widget ' + d.w.id + ': ' + String(msg).slice(0, 200), stage: 'widget', appv: d.app.version || '' }); } catch (e) {}
    }

    /* ---------------- the profile's settings ---------------- */

    function prefs() { var p = Store.get('widgets', null); return p && typeof p === 'object' ? p : {}; }
    function conf(id) {
        var d = find(id), p = prefs(), c = (p.w && p.w[id]) || {};
        if (!d) return null;
        return {
            show: typeof c.show === 'boolean' ? c.show : d.id === 'weather',       // owner decision 2026-11-05: only Weather is on until the user turns one on
            every: d.choices.indexOf(c.every) >= 0 ? c.every : d.every,
            bg: typeof c.bg === 'boolean' ? c.bg : d.bg,
            s: WL.settingsOf(d.settings ? d.settings() : [], c.s)
        };
    }
    function save(id, fn) {
        var p = prefs();
        p.w = p.w && typeof p.w === 'object' ? p.w : {};
        var c = p.w[id] && typeof p.w[id] === 'object' ? p.w[id] : {};
        fn(c, p);
        p.w[id] = c;
        Store.set('widgets', p);
    }
    function on() { return prefs().on !== false; }
    function setOn(v) { var p = prefs(); p.on = !!v; Store.set('widgets', p); render(); }
    function set(id, k, v) {
        save(id, function (c) { c[k] = v; });
        if (k === 'show') { render(); return; }
        if (k === 'every') { delete last[id]; }
        plan(id);
    }
    function setSetting(id, k, v) {
        save(id, function (c) { c.s = c.s && typeof c.s === 'object' ? c.s : {}; c.s[k] = v; });
        if (id === 'weather' && k === 'place') Store.remove('weather_loc');
        refreshNow(id);
    }
    function reset(id) { save(id, function (c) { for (var k in c) delete c[k]; }); render(); }
    // order on the desktop: the profile's list, then the others in their built-in order
    function ordered() {
        var l = all(), o = prefs().order;
        o = Array.isArray(o) ? o : [];
        return l.slice().sort(function (a, b) {
            var x = o.indexOf(a.id), y = o.indexOf(b.id);
            if (x < 0) x = 100 + l.indexOf(a); if (y < 0) y = 100 + l.indexOf(b);
            return x - y;
        });
    }
    function move(id, d) {
        var ids = ordered().map(function (x) { return x.id; }), i = ids.indexOf(id), j = i + d;
        if (i < 0 || j < 0 || j >= ids.length) return false;
        ids.splice(i, 1); ids.splice(j, 0, id);
        var p = prefs(); p.order = ids; Store.set('widgets', p);
        render();
        return true;
    }
    function shown() { return on() ? ordered().filter(function (d) { var c = conf(d.id); return c && c.show; }) : []; }

    /* ---------------- refreshing ---------------- */

    // a widget may refresh now: shown, and the desktop is on screen (or it runs in the background)
    function allowed(id) {
        var c = conf(id);
        if (!c || !c.show || !on()) return false;
        return (onDesk && !document.hidden) || c.bg;
    }
    function plan(id) {
        clearTimeout(timers[id]); timers[id] = 0;
        var d = find(id);
        if (!d || !allowed(id) || (d.idle && d.idle() && views[id])) return;      // nothing changes (music paused): no timer
        var c = conf(id), wait = last[id] ? Math.max(0, last[id] + c.every * 1000 - now()) : 0;
        timers[id] = setTimeout(function () { timers[id] = 0; refresh(id); }, wait);
    }
    function refresh(id, action) {
        var d = find(id), c = conf(id);
        if (!d || !c) return;
        if (busy[id]) { again[id] = action || true; return; }           // a setting changed meanwhile: once more when it ends
        if (d.app && !d.approved) { paint(id, { text: t('wgPending') }); return; }
        busy[id] = true;
        var ctx = { id: id, settings: c.s, size: d.size, action: action };
        var finish = function (v) {
            busy[id] = false;
            last[id] = now();
            v = WL.cleanView(v, !d.app);
            views[id] = v;
            if (d.keep && v.sub !== t('wgOffline') && v.sub !== t('wgFailed') && v.text !== t('wgPending') && v.text !== t('wgFailed')) keepCache(id, v);
            paint(id, v);
            if (again[id]) { var a = again[id]; delete again[id]; return refresh(id, a === true ? undefined : a); }
            plan(id);
        };
        try { if (d.app) runApp(d, ctx, finish); else d.refresh(ctx, finish); }
        catch (e) { finish({ text: t('wgFailed') }); }
    }
    function refreshNow(id) { delete last[id]; if (allowed(id) || onDesk) refresh(id); }
    function cached(id) { var c = Store.rawGet(CACHE) || {}, v = c[Store.profile() + ':' + id]; return v && v.v ? v.v : null; }
    function keepCache(id, v) {
        var c = Store.rawGet(CACHE) || {}, k = Store.profile() + ':' + id;
        if (c[k] && JSON.stringify(c[k].v) === JSON.stringify(v)) return;
        c[k] = { v: v, at: now() };
        Store.rawSet(CACHE, c);
    }
    function stopAll(keepBg) {
        for (var id in timers) {
            if (keepBg) { var c = conf(id); if (c && c.bg) continue; }
            clearTimeout(timers[id]); timers[id] = 0;
        }
    }

    /* ---------------- drawing ---------------- */

    function iconEl(ic, fallback) {
        var s = el('span', 'wdg-ic');
        if (ic && ic.indexOf('i:') === 0) Icons.put(s, ic.slice(2));
        else if (ic && /^https:/.test(ic)) { var im = el('img'); im.alt = ''; im.src = ic; im.onerror = function () { this.remove(); }; s.appendChild(im); }
        else if (ic) s.textContent = ic;
        else Icons.put(s, fallback);
        return s;
    }
    function card(d) {
        var c = el('div', 'wdg wdg-' + d.size);
        c.id = 'wdg-' + d.id;
        c.setAttribute('data-focus', '');
        c.setAttribute('data-widget', d.id);
        c.tabIndex = 0;
        c.onclick = function (e) {
            if (e.target !== c && e.target.closest && e.target.closest('.wdg-btn')) return;
            openWidget(d);
        };
        return c;
    }
    function openWidget(d) {
        if (d.open) return d.open();
        if (d.app) {
            if (!d.approved) return App.toast(t('wgPending'));
            var v = views[d.id] || {}, launch = { link: v.link ? d.app.id + ':' + v.link : '', app: d.app.id, path: v.link || '', from: 'widget' };
            try { sessionStorage.setItem('mypc_launch', JSON.stringify({ id: 'app-' + d.app.id, launch: launch })); } catch (e) {}
            return Desktop.play(Desktop.fromCloud(d.app));
        }
        refreshNow(d.id);
        A11y.announce(label(d, views[d.id] || {}));
    }
    function label(d, v) {
        var p = [d.title()];
        ['big', 'sub', 'text'].forEach(function (k) { if (v[k]) p.push(v[k]); });
        (v.alerts || []).forEach(function (a) { p.push(a.text); });
        (v.events || []).forEach(function (e) { p.push((e.when ? e.when + ': ' : '') + e.text); });
        (v.rows || []).forEach(function (r) { p.push(r.label + ' ' + r.value); });
        return p.join('. ');
    }
    // draws a view into its card, only when it changed
    function paint(id, v) {
        if (!box || headless) return;
        var c = document.getElementById('wdg-' + id), d = find(id);
        if (!c || !d) return;
        var key = JSON.stringify(v) + I18n.lang();
        if (painted[id] === key) return;
        painted[id] = key;
        var had = document.activeElement, focusBtn = had && c.contains(had) && had !== c ? had.getAttribute('data-b') : null;
        c.innerHTML = '';
        c.style.borderTopColor = v.accent || '';
        var head = el('div', 'wdg-head');
        head.appendChild(iconEl(v.icon, d.icon));
        head.appendChild(el('span', 'wdg-title', v.title || d.title()));
        c.appendChild(head);
        if (v.image && d.size !== 'small') { var im = el('img', 'wdg-img'); im.alt = ''; im.src = v.image; im.onerror = function () { this.remove(); }; c.appendChild(im); }
        if (v.page) {
            // the day's names on the left, a tear-off calendar page on the right (Calendar)
            var hero2 = el('div', 'wdg-hero'), col2 = el('div', 'wdg-col'), pg = el('div', 'wdg-page');
            col2.appendChild(el('div', 'wdg-big wdg-day', v.big || ''));
            if (v.sub) col2.appendChild(el('div', 'wdg-sub', v.sub));
            if (v.text) col2.appendChild(el('div', 'wdg-hijri', v.text));
            pg.appendChild(el('span', 'wdg-pg-top', v.page.top));
            pg.appendChild(el('span', 'wdg-pg-num', v.page.num));
            if (v.page.bottom) pg.appendChild(el('span', 'wdg-pg-bot', v.page.bottom));
            hero2.appendChild(col2); hero2.appendChild(pg);
            c.appendChild(hero2);
        } else if (v.art) {
            // big value + its text on the left, a big picture on the right (Weather)
            var hero = el('div', 'wdg-hero'), col = el('div', 'wdg-col'), big = el('div', 'wdg-big', v.big || '');
            if (v.bigSize) big.style.fontSize = v.bigSize + 'px';
            col.appendChild(big);
            if (v.sub) col.appendChild(el('div', 'wdg-sub', v.sub));
            if (v.text) col.appendChild(el('div', 'wdg-text', v.text));
            var art = el('div', 'wdg-art');
            if (v.artSize) { art.style.width = v.artSize + 'px'; art.style.height = v.artSize + 'px'; }
            var moving = v.anim && typeof Weather !== 'undefined' ? Weather.art(v.art) : '';
            if (moving) art.innerHTML = moving; else Icons.put(art, v.art);
            hero.appendChild(col); hero.appendChild(art);
            c.appendChild(hero);
        } else {
            if (v.big) c.appendChild(el('div', 'wdg-big', v.big));
            // no big value: the text leads (a song title, then its artist)
            if (v.sub && v.big) c.appendChild(el('div', 'wdg-sub', v.sub));
            if (v.text) c.appendChild(el('div', 'wdg-text', v.text));
            if (v.sub && !v.big) c.appendChild(el('div', 'wdg-sub', v.sub));
        }
        if (v.alerts) v.alerts.forEach(function (a) { c.appendChild(el('div', 'wdg-alert wdg-' + a.level, a.text)); });
        if (v.events) {
            var evs = el('div', 'wdg-evs');
            v.events.forEach(function (e) {
                var x = el('div', 'wdg-ev wdg-ev-' + e.kind);
                if (e.when) x.appendChild(el('span', 'wdg-ev-w', e.when));
                x.appendChild(el('span', 'wdg-ev-t', e.text));
                evs.appendChild(x);
            });
            c.appendChild(evs);
        }
        if (v.progress !== undefined) {
            var bar = el('div', 'wdg-bar'), fill = el('i');
            fill.style.width = Math.round(v.progress * 100) + '%';
            // a song: how much of it is loaded, light grey under the progress
            if (v.loaded > v.progress) { var ld = el('b', 'wdg-load'); ld.style.width = Math.round(Math.min(1, v.loaded) * 100) + '%'; bar.appendChild(ld); }
            if (v.accent) fill.style.background = v.accent;
            bar.appendChild(fill);
            c.appendChild(bar);
        }
        if (v.rows) {
            var rows = el('div', 'wdg-rows');
            v.rows.forEach(function (r) { var x = el('div', 'wdg-row'); x.appendChild(el('span', '', r.label)); x.appendChild(el('b', '', r.value)); rows.appendChild(x); });
            c.appendChild(rows);
        }
        if (v.buttons) {
            var bs = el('div', 'wdg-btns');
            v.buttons.forEach(function (b) {
                var x = el('button', 'wdg-btn');
                x.setAttribute('data-focus', '');
                x.setAttribute('data-b', b.id);
                x.setAttribute('aria-label', b.label || b.id);
                if (b.icon) Icons.put(x, b.icon); else x.textContent = b.label;
                x.onclick = function (e) { e.stopPropagation(); press(d, b.id); };
                bs.appendChild(x);
            });
            c.appendChild(bs);
        }
        c.setAttribute('role', v.buttons ? 'group' : 'button');
        c.setAttribute('aria-label', label(d, v));
        if (focusBtn) { var nb = c.querySelector('[data-b="' + focusBtn + '"]'); try { (nb || c).focus(); } catch (e) {} }
    }
    function press(d, b) {
        if (d.press) { d.press(b); refresh(d.id); A11y.announce((views[d.id] || {}).text || ''); return; }
        if (d.app) { delete last[d.id]; refresh(d.id, b); }
    }

    // builds the cards of the shown widgets (desktop page); each shows its last view at once, then refreshes when due
    function render() {
        defs = null;
        box = document.getElementById('desk-widgets');
        if (!box || headless) return;
        var list = shown(), keepFocus = document.activeElement && box.contains(document.activeElement) ? (document.activeElement.closest('.wdg') || {}).id : null;
        stopAll(false);
        box.innerHTML = '';
        painted = {};
        list.forEach(function (d) { box.appendChild(card(d)); });
        box.hidden = !list.length;
        var desk = document.getElementById('desktop');
        if (desk) desk.classList.toggle('has-wdg', list.length > 0);
        list.forEach(function (d) {
            var v = views[d.id] || cached(d.id);
            paint(d.id, v || { text: d.app && !d.approved ? t('wgPending') : t('wgLoading') });
            plan(d.id);
        });
        if (keepFocus && document.getElementById(keepFocus)) try { document.getElementById(keepFocus).focus(); } catch (e) {}
    }

    // the desktop is on screen again / an app or a game takes it (Desktop.show / hide)
    function resume() {
        onDesk = true;
        var list = shown();
        for (var i = 0; i < list.length; i++) { if (views[list[i].id]) paint(list[i].id, views[list[i].id]); plan(list[i].id); }
    }
    function pause() { onDesk = false; stopAll(true); }

    // the game page: no desktop, only the widgets that run in the background (no cards, nothing drawn)
    function background() {
        headless = true; onDesk = false; defs = null;
        all().forEach(function (d) { var c = conf(d.id); if (c && c.show && c.bg && on()) plan(d.id); });
    }

    function init() {
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) stopAll(true);
            else if (onDesk) resume();
        });
        if (typeof Music !== 'undefined') Music.onChange(function (what) { if (what === 'loaded') return; if (allowed('music')) { refresh('music'); } else plan('music'); });
    }
    init();

    return {
        render: render, pause: pause, resume: resume, background: background, refreshNow: refreshNow,
        list: function () { return ordered(); }, find: find, conf: conf, set: set, setSetting: setSetting, reset: reset, move: move,
        on: on, setOn: setOn, shown: shown, view: function (id) { return views[id] || cached(id); },
        // for tests
        _timers: function () { var o = []; for (var k in timers) if (timers[k]) o.push(k); return o.sort(); }, _last: function () { return last; }
    };
})();
