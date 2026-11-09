/* Live backgrounds: desktop backgrounds that follow the world.
 *   dyn_horizon  Horizon (owner request 2026-11-09: Live weather and Holidays and events merged into one): on a day with an event,
 *                its picture (Moroccan holidays: Eid al-Fitr, Eid al-Adha, Throne Day, Green March, ...; big football nights, see
 *                js/core/events.js for the rules); on other days the sky of your place now (sunny, cloudy, rain, snow, fog, storm,
 *                day / dawn / dusk / night, season, temperature) from js/core/weather.js (shared with the Weather widget and app: no
 *                extra request when either asked in the last 15 min), or, with Live weather off, a picture of the season.
 *   dyn_astro    Earth now: the globe over your place with the real day and night line, city lights on the night side and the
 *                Moon in its phase (NASA pictures, wallpapers/*.jpg).
 * Light on purpose (low-end TVs): the picture is drawn ONCE on a canvas, again only when what it shows changed (checked every 10 min,
 * at the stage size times 1 / 0.75 / 0.5 by the graphics tier). Nothing runs while an app or game is open (Desktop.hide), on the
 * game page (no desktop there) or when My PC is in the background. The only thing that can move is the optional rain / snow layer
 * (profile setting, off by default): one tile slid by a CSS transform, composited, paused with the desktop. While it asks the internet
 * for new data, a small icon turns beside the clock (#tray-wp, owner request 2026-11-09).
 * Per profile (key dynwall: { motion, caption, weather }); the events' country and football switch are Events.prefs(). */
var DynWall = (function () {
    'use strict';

    var IDS = ['dyn_horizon', 'dyn_astro'], OLD = { dyn_weather: 'dyn_horizon', dyn_events: 'dyn_horizon' };   // ids before 2026-11-09
    var box = null, cv = null, cap = null, fx = null, fxKind = '', cur = '', on = false, timer = 0, key = '', capText = '', painted = 0;

    function t(k) { return I18n.t(k); }
    function is(id) { return IDS.indexOf(id) >= 0; }
    function el(tag, cls) { var e = document.createElement(tag); e.className = cls; return e; }
    function prefs() { var p = Store.get('dynwall', null) || {}; return { motion: !!p.motion, caption: p.caption !== false, weather: p.weather !== false, glass: GLASS_LV.indexOf(p.glass) >= 0 ? p.glass : 'medium' }; }
    var GLASS_LV = ['off', 'low', 'medium', 'high'];        // raindrops on the glass, when it rains (owner request 2026-11-09)
    function setPref(k, v) { var p = prefs(); p[k] = v; Store.set('dynwall', p); refresh(); }
    function base() { return (typeof AppBoot !== 'undefined' && AppBoot.base && AppBoot.base()) || ''; }
    function stageSize() { return window.App && App.screenSize ? App.screenSize() : { w: 1920, h: 1080 }; }
    function scale() {
        var p = typeof Perf !== 'undefined' ? Perf.profile() : { tier: 'mid' };
        return p.tier === 'high' ? 1 : p.tier === 'mid' ? 0.75 : 0.5;
    }
    // the icon beside the clock while new data is asked (shown at least 1 s so it can be seen)
    var busyN = 0, busyAt = 0, busyT = 0;
    function busy(more) {
        var e = document.getElementById('tray-wp');
        busyN = Math.max(0, busyN + (more ? 1 : -1));
        clearTimeout(busyT);
        if (!e) return;
        if (busyN) { if (e.hidden) { busyAt = Date.now(); e.hidden = false; e.setAttribute('title', t('dwUpdating')); } return; }
        busyT = setTimeout(function () { if (!busyN) e.hidden = true; }, Math.max(0, 1000 - (Date.now() - busyAt)));
    }
    function desktopShown() { var d = document.getElementById('desktop'); return !!d && !d.hidden && !document.hidden; }

    /* ---------------- life cycle (Desktop.paintWallpaper / show / hide) ---------------- */

    /* The last picture is kept on this device (owner request 2026-11-09: My PC opened on a default sunny sky, then changed a few
     * seconds later). At start it shows at once under the canvas, with its caption; its state key is taken over, so nothing is drawn
     * again until what it shows changes. One JPEG of the canvas size, saved 2 s after a paint; TV-wide key, not in the backup. */
    var LAST = 'arc_dev_dwlast', saveT = 0, capT = '', capS = '';
    function who() { var p = null; try { p = JSON.parse(localStorage.getItem('arc_profile')); } catch (e) {} return typeof p === 'string' && /^p\d+$/.test(p) ? p : 'p1'; }   // as Store
    function loadLast(id) {
        try { var l = JSON.parse(localStorage.getItem(LAST) || 'null'); return l && l.id === id && l.p === who() && /^data:image\//.test(l.img) ? l : null; } catch (e) { return null; }
    }
    function saveLast() {
        clearTimeout(saveT);
        saveT = setTimeout(function () {
            saveT = 0;
            if (!cv || !key || !cv.width) return;
            var rec = { id: cur, p: who(), k: key, t: capT, s: capS, at: Date.now(), img: '' };
            try { rec.img = cv.toDataURL('image/jpeg', 0.85); } catch (e) { return; }
            try { localStorage.setItem(LAST, JSON.stringify(rec)); } catch (e2) { try { localStorage.removeItem(LAST); } catch (e3) {} }   // full: no copy rather than an old one
        }, 2000);
    }
    function start(id, wp) {
        if (cur === id && cv && box === wp) { relabel(); return; }
        stop();
        box = wp; cur = id;
        cv = el('canvas', 'dw-cv'); cv.setAttribute('aria-hidden', 'true');
        cap = el('div', 'dw-cap'); cap.hidden = true;
        var last = loadLast(id);
        if (last) {
            var ss = stageSize(), k = scale();
            cv.width = Math.round(ss.w * k); cv.height = Math.round(ss.h * k);
            cv.style.backgroundImage = 'url(' + last.img + ')';           // shown under the (still empty) canvas at once
            cv.style.backgroundSize = '100% 100%';
            cv.className = 'dw-cv dw-last';
            if (/\|(\d+)x(\d+)$/.test(last.k) && last.k.slice(-(cv.width + 'x' + cv.height).length) === cv.width + 'x' + cv.height) key = last.k;
        }
        box.appendChild(cv); box.appendChild(cap);
        if (last) setCaption(last.t, last.s);
        on = desktopShown();
        schedule(30);
    }
    function stop() {
        clearTimeout(timer); timer = 0;
        if (cv) { cv.width = cv.height = 0; if (cv.parentNode) cv.parentNode.removeChild(cv); }
        if (cap && cap.parentNode) cap.parentNode.removeChild(cap);
        setFx('');
        clearTimeout(saveT); saveT = 0;
        cv = cap = null; cur = ''; key = ''; capText = ''; capT = capS = ''; on = false;
    }
    function pause() { on = false; clearTimeout(timer); timer = 0; if (fx) fx.style.animationPlayState = 'paused'; }
    function resume() {
        if (!cur || !desktopShown()) return;
        on = true;
        if (fx) fx.style.animationPlayState = '';
        // back from an app: check again soon (the picture may be out of date), but let the desktop draw first
        schedule(Date.now() - painted > 60000 ? 600 : 60000);
    }
    function refresh() { key = ''; if (cur && desktopShown()) { on = true; schedule(30); } }
    function schedule(ms) { clearTimeout(timer); timer = 0; if (on && cur) timer = setTimeout(tick, ms); }
    function tick() {
        timer = 0;
        if (!on || !cur || !desktopShown()) return;
        var id = cur;
        (id === 'dyn_astro' ? tickAstro : tickHorizon)(function (next) { if (cur === id) schedule(next); });
    }
    document.addEventListener('visibilitychange', function () { if (document.hidden) pause(); else resume(); });

    // a new canvas size only when the stage changed; returns the 2D context
    function canvas() {
        var ss = stageSize(), k = scale(), W = Math.round(ss.w * k), H = Math.round(ss.h * k);
        if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
        return cv.getContext('2d');
    }
    function paint(k, draw) {
        if (!cv || k === key) return false;
        var c = canvas();
        k += '|' + cv.width + 'x' + cv.height;
        if (k === key) return false;
        key = k;
        if (cv.style.backgroundImage) { cv.style.backgroundImage = ''; cv.className = 'dw-cv'; }
        saveLast();
        try { draw(c, cv.width, cv.height); } catch (e) { try { Reports.add('mypc', { kind: 'error', msg: 'background ' + cur + ': ' + String(e && e.message || e).slice(0, 200), stage: 'wallpaper' }); } catch (x) {} }
        painted = Date.now();
        return true;
    }
    function setCaption(title, sub) {
        if (!cap) return;
        capT = title || ''; capS = sub || '';
        var txt = prefs().caption && title ? title + '\n' + (sub || '') : '';
        if (txt === capText) return;
        capText = txt;
        cap.textContent = '';
        cap.hidden = !txt;
        if (!txt) return;
        var a = el('div', 'dw-cap-t'); a.textContent = title; cap.appendChild(a);
        if (sub) { var b = el('div', 'dw-cap-s'); b.textContent = sub; cap.appendChild(b); }
    }
    function relabel() { capText = '~'; key = ''; if (on) schedule(30); }

    // the moving rain / snow layer (only with the profile's setting)
    function setFx(kind) {
        if (kind === fxKind) return;
        fxKind = kind;
        if (fx) { if (fx.parentNode) fx.parentNode.removeChild(fx); fx = null; }
        if (!kind || !box) return;
        var tile = DynArt.rainTile(kind, 512);
        fx = el('div', 'dw-fx dw-fx-' + (kind === 'snow' ? 'snow' : 'rain'));
        fx.style.backgroundImage = 'url(' + tile.toDataURL('image/png') + ')';
        tile.width = tile.height = 0;
        if (!on) fx.style.animationPlayState = 'paused';
        box.insertBefore(fx, cap);
    }

    /* ---------------- time of day, season ---------------- */

    function mins(hm) { return typeof hm === 'string' && hm.length >= 5 ? +hm.slice(0, 2) * 60 + +hm.slice(3, 5) : null; }
    // sunrise / sunset in minutes: the forecast's, else from the place (or 07:00 / 18:30)
    function sunTimes(data, loc) {
        var d = data && data.days && data.days[0], r = d && mins(d.rise), s = d && mins(d.set);
        if (r !== null && s !== null && r !== undefined && s !== undefined) return [r, s];
        if (loc && typeof loc.lat === 'number') {
            var now = new Date(), doy = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
            var dec = -23.44 * Math.cos(2 * Math.PI * (doy + 10) / 365) * Math.PI / 180, la = loc.lat * Math.PI / 180;
            var cosH = -Math.tan(la) * Math.tan(dec), h = Math.acos(Math.max(-1, Math.min(1, cosH))) * 180 / Math.PI;
            var noon = 720 - 4 * (loc.lon || 0) - now.getTimezoneOffset();
            return [Math.round(noon - h * 4), Math.round(noon + h * 4)];
        }
        return [420, 1110];
    }
    function dayPhase(rise, set) {
        var n = new Date(), m = n.getHours() * 60 + n.getMinutes();
        var ph = m < rise - 35 || m > set + 35 ? 'night' : m < rise + 45 ? 'dawn' : m > set - 45 ? 'dusk' : 'day';
        return { phase: ph, sunT: Math.max(0, Math.min(1, (m - rise) / Math.max(1, set - rise))) };
    }
    function season(lat) {
        var m = new Date().getMonth(), s = m >= 2 && m <= 4 ? 'spring' : m >= 5 && m <= 7 ? 'summer' : m >= 8 && m <= 10 ? 'autumn' : 'winter';
        if (typeof lat === 'number' && lat < -5) s = { spring: 'autumn', summer: 'winter', autumn: 'spring', winter: 'summer' }[s];
        return s;
    }
    function place() {
        var l = Store.get('weather_loc', null);
        if (l && typeof l.lat === 'number') return l;
        return { lat: 30, lon: -new Date().getTimezoneOffset() / 4 };       // no place yet: the time zone's longitude
    }
    function day(ms) { return Math.floor(ms / 86400000); }

    /* ---------------- Horizon: the day's event, else the live weather ---------------- */

    function toMidnight() { var n = new Date(); return (24 * 60 - n.getHours() * 60 - n.getMinutes()) * 60000 + 5000; }
    function tickHorizon(done) {
        var hasEv = typeof Events !== 'undefined', wx = typeof Weather !== 'undefined';
        // at once from what is kept (no waiting on the network), then once the data is fresh
        if (!key) draw(hasEv ? pick() : { ev: null }, true);
        if (!hasEv) return go();
        busy(true);
        Events.refresh(function () { busy(false); go(); });
        function go() {
            var p = hasEv ? pick() : { ev: null };
            if (p.ev || !prefs().weather || !wx) { draw(p, false); return done(Math.min(p.ev ? 30 * 60000 : 10 * 60000, toMidnight())); }
            busy(true);
            Weather.get(null, 15 * 60000, function (err, data, loc) {
                busy(false);
                var first = Weather.peek();
                drawWeather(data, loc || (first && first.loc) || null, p);
                done(Math.min(10 * 60000, toMidnight()));
            });
        }
    }
    function draw(p, quick) {
        if (p.ev || !prefs().weather || typeof Weather === 'undefined') return drawEvents(p);
        var first = Weather.peek();
        if (first) drawWeather(first.data, first.loc, p);
        else if (!quick) drawEvents(p);
    }
    function drawWeather(data, loc, p) {
        var n = data && data.now, st = Weather.settings(), f = st.units === 'f';
        var k = n ? Weather.sky(n.code, n.day).k : 'clear';
        var temp = n && typeof n.temp === 'number' ? (f ? (n.temp - 32) * 5 / 9 : n.temp) : 18;
        var st2 = sunTimes(data, loc || place()), dp = dayPhase(st2[0], st2[1]);
        if (n && n.day === false && dp.phase === 'day') dp.phase = 'night';
        var se = season(loc ? loc.lat : place().lat), moon = DynArt.moonAge(Date.now());
        var wind = n && typeof n.dir === 'number' && typeof n.wind === 'number' ? Math.max(-0.6, Math.min(0.6, -Math.sin(n.dir * Math.PI / 180) * n.wind / (f ? 25 : 40))) : -0.2;
        var motion = prefs().motion && /^(rain|showers|drizzle|storm|snow)$/.test(k);
        var s = { k: k, phase: dp.phase, sunT: dp.sunT, temp: temp, season: se, clouds: n ? n.clouds : 20, moon: moon, wind: wind, motion: motion,
                  glass: prefs().glass === 'off' ? '' : prefs().glass, seed: day(Date.now()) };
        paint(['w', k, s.phase, Math.round(s.sunT * 10), Math.round(temp / 4), se, Math.round((s.clouds || 0) / 20), Math.round(moon * 8), motion, s.glass].join(','),
              function (c, W, H) { DynArt.weather(c, W, H, s); });
        setFx(motion ? (k === 'snow' ? 'snow' : k === 'storm' ? 'rain' : k) : '');
        setCaption(p && p.soon ? t('dwTomorrow').replace('%s', Events.title(p.soon)) : '', '');
    }

    /* ---------------- Earth now ---------------- */

    var texMemo = {};
    function texture(name, w, cb) {
        var im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = function () {
            var h = Math.round(w / 2), tc = document.createElement('canvas'), out = null;
            tc.width = w; tc.height = h;
            try { var g = tc.getContext('2d'); g.drawImage(im, 0, 0, w, h); out = { w: w, h: h, d: g.getImageData(0, 0, w, h).data }; } catch (e) {}
            tc.width = tc.height = 0;
            cb(out);
        };
        im.onerror = function () { cb(null); };
        im.src = base() + 'wallpapers/' + name;
    }
    function flat(rgb) { return { w: 1, h: 1, d: new Uint8ClampedArray([rgb[0], rgb[1], rgb[2], 255]) }; }
    function tickAstro(done) {
        var now = Date.now(), slot = Math.floor(now / 600000), loc = place();
        var k = ['a', slot, Math.round(loc.lat), Math.round(loc.lon)].join(',');
        var mp = Math.round(DynArt.moonAge(now) * 8) % 8, names = String(t('mp')).split(',');
        setCaption(t('dwEarth'), t('dwMoon').replace('%s', names[mp] || ''));
        var ss = stageSize();
        if (key.indexOf(k + '|') === 0 && key === k + '|' + Math.round(ss.w * scale()) + 'x' + Math.round(ss.h * scale())) return done(600000 - now % 600000 + 1000);
        // the photos are read for this one drawing only, then dropped (8 MB of pixels at 2048 px)
        var tw = scale() === 1 ? 2048 : scale() === 0.75 ? 1536 : 1024, got = {}, left = 3;
        function one(n, w, name) { texture(name, w, function (tx) { got[n] = tx; if (--left === 0) { busy(false); draw(); } }); }
        function draw() {
            if (cur !== 'dyn_astro') return;
            var dayT = got.day || flat([24, 60, 120]), nightT = got.night || flat([4, 6, 14]);
            paint(k, function (c, W, H) {
                DynArt.earth(c, W, H, dayT, nightT, got.moon, { lat: Math.max(-40, Math.min(40, loc.lat * 0.6)), lon: loc.lon, at: now, here: Store.get('weather_loc', null) ? loc : null });
            });
            got = null;
            done(600000 - Date.now() % 600000 + 1000);
        }
        busy(true);
        one('day', tw, 'earth-day.jpg'); one('night', tw, 'earth-night.jpg'); one('moon', 512, 'moon.jpg');
    }

    /* ---------------- Holidays and events ---------------- */

    function clock(ms) { return typeof Desktop !== 'undefined' && Desktop.timeText ? Desktop.timeText(new Date(ms)) : new Date(ms).toTimeString().slice(0, 5); }
    // what may change the background (owner rule 2026-11-09): every holiday; football only the big nights Events keeps (Champions League
    // semi-finals and final, Morocco's matches, Moroccan clubs in the CAF Champions League), and only with Football nights on; the
    // site's tournament periods (AFCON, World Cup, ...) never do; events added by the admins do
    var FB = { uclsemi: 1, uclfinal: 1, morocco: 1, cafcl: 1 };
    function counts(e) {
        if (e.kind === 'football' || (e.kind === 'event' && e.src !== 'admin')) return !!FB[e.id] && Events.prefs().football;
        return e.kind !== 'mine';
    }
    function pick() {
        var td = Events.today(), list = Events.day(td).filter(counts), hr = new Date().getHours(), ev = list[0] || null, when = 'today', soon = null;
        var tm = Events.day(Events.addDays(td, 1)).filter(function (e) { return e.pub || e.kind === 'islamic' || e.id === 'ramadan' || e.id === 'nye'; })[0] || null;
        // the evening before a holiday already shows it
        if (tm && ev && tm.id === ev.id) tm = null;          // the second day of Eid, the rest of Ramadan
        if (tm && hr >= 18 && (!ev || Events.rank(tm) > Events.rank(ev) && ev.kind !== 'football' && ev.id !== 'nye')) { ev = tm; when = 'tomorrow'; }
        else if (tm && (!ev || ev.id === 'ramadan')) soon = tm;
        return { ev: ev, when: when, soon: soon, list: list };
    }
    function drawEvents(p) {
        var ev = p.ev, id = ev ? ev.id : 'season', loc = place(), st = sunTimes(null, loc), dp = dayPhase(st[0], st[1]), se = season(loc.lat);
        if (ev && !/^(eidfitr|eidadha|ramadan|mawlid|hijri|throne|greenmarch|independence|revolution|youth|manifesto|unity|oued|yennayer|newyear|nye|labour|christmas|uclsemi|uclfinal|cafcl|morocco)$/.test(id)) id = ev.pub ? 'labour' : 'season';
        var s = { phase: dp.phase, sunT: dp.sunT, season: se, moon: DynArt.moonAge(Date.now()), seed: day(Date.now()) };
        paint(['e', id, id === 'season' ? se + dp.phase + Math.round(dp.sunT * 6) : ''].join(','), function (c, W, H) { DynArt.event(c, W, H, id, s); });
        setFx('');
        // the caption: its name (+ the matches, the Eid day, the greeting), or what comes tomorrow
        var title = '', sub = '';
        if (ev) {
            title = Events.title(ev);
            if (p.when === 'tomorrow') title = t('dwTomorrow').replace('%s', title);
            if (ev.kind === 'football') {
                sub = p.list.filter(function (e) { return e.kind === 'football' && e.id === ev.id && e.teams; }).slice(0, 3)
                    .map(function (e) { return e.teams.join(' – ') + '  ' + clock(e.at); }).join('   ·   ');
            } else if (ev.kind === 'event' && ev.time) sub = ev.time;
            else if (id === 'eidfitr' || id === 'eidadha') sub = t('evg_eid') + (ev.day > 1 && p.when === 'today' ? '  ·  ' + t('dwDay').replace('%n', ev.day) : '');
            else if (id === 'ramadan') sub = t('evg_ramadan') + (ev.day && p.when === 'today' ? '  ·  ' + t('dwDay').replace('%n', ev.day) : '');
            else if (id === 'newyear' || id === 'nye') sub = t('evg_newyear');
        }
        if (p.soon) { if (title) sub = (sub ? sub + '   ·   ' : '') + t('dwTomorrow').replace('%s', Events.title(p.soon)); else title = t('dwTomorrow').replace('%s', Events.title(p.soon)); }
        setCaption(title, sub);
    }

    return { IDS: IDS, OLD: OLD, GLASS_LV: GLASS_LV, is: is, start: start, stop: stop, pause: pause, resume: resume, refresh: refresh, prefs: prefs, setPref: setPref,
             current: function () { return cur; }, _key: function () { return key; }, _timer: function () { return timer; }, _pick: pick };
})();
