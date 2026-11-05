/* Weather app (owner request 2026-11-05): now, the next 24 hours and 7 days for one place: temperature, feels like, wind
 * (speed, gusts, direction), precipitation and its chance, humidity, pressure, UV, sunrise / sunset. Data: js/core/weather.js
 * (shared with the desktop widget, same place and units setting). Light on purpose for TVs: the DOM is built once (8 hours,
 * 7 days), drawn from what the TV kept at once, then one request if it is older than 10 minutes; while open one setTimeout
 * every 15 minutes (skipped while My PC is hidden); no animation, no blur, no image. Looks follow the theme (css/themes.css:
 * accent var(--acc), card shapes); the sky behind follows the weather (one CSS gradient class). */
(function () {
    'use strict';

    var AUTO = 15 * 60000, FRESH = 10 * 60000;
    var root = null, ui = null, data = null, loc = null, at = 0, err = null, timer = 0, sel = -1, loading = false;

    function t(k) { return I18n.t(k); }
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
    function units() { return Weather.settings().units === 'f' ? 'f' : 'c'; }
    function deg(v) { return v === null || v === undefined ? '--' : Math.round(v) + '°'; }
    function speed(v) { return v === null || v === undefined ? '--' : Math.round(v) + (units() === 'f' ? ' mph' : ' km/h'); }
    function rain(v) { return v === null || v === undefined ? '--' : (units() === 'f' ? (Math.round(v * 100) / 100) + ' in' : (Math.round(v * 10) / 10) + ' mm'); }
    function pct(v) { return v === null || v === undefined ? '--' : Math.round(v) + ' %'; }
    function dir(d) { var p = Weather.point(d); return p < 0 ? '' : t('wxDirs').split(',')[p] || ''; }
    function uv(v) {
        if (v === null || v === undefined) return '--';
        var l = t('wxUvL').split(','), i = v < 3 ? 0 : v < 6 ? 1 : v < 8 ? 2 : v < 11 ? 3 : 4;
        return Math.round(v) + ' · ' + (l[i] || '');
    }
    // "2026-11-05T15:00" / "2026-11-05" -> a local Date (the place's own clock: timezone=auto)
    function dateOf(s) {
        var m = /^(\d+)-(\d+)-(\d+)(?:T(\d+):(\d+))?/.exec(s || '');
        return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) : new Date();
    }
    function clock(hhmm) { return hhmm ? Desktop.timeText(dateOf('2000-01-01T' + hhmm)) : '--'; }
    function dayName(i) {
        if (!data || !data.days[i]) return '';
        if (i === 0) return t('wxToday');
        return Desktop.dateText(dateOf(data.days[i].date), { weekday: 'long' });
    }

    // small line icons drawn here (the weather pictures themselves come from Icons)
    var GLYPH = {
        pin: '<path d="M24 44s14-14 14-25a14 14 0 0 0-28 0c0 11 14 25 14 25z" fill="none" stroke="currentColor" stroke-width="3.5"/><circle cx="24" cy="19" r="5" fill="currentColor"/>',
        reload: '<path d="M38 24a14 14 0 1 1-4.1-9.9" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M36 6v10H26" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
        wind: '<path d="M6 18h24a6 6 0 1 0-6-6M6 26h32a6 6 0 1 1-6 6M6 34h14" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>',
        gust: '<path d="M6 16h18a5 5 0 1 0-5-5M6 24h30a5 5 0 1 1-5 5M10 32h10M26 38h12" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>',
        drop: '<path d="M24 6C18 16 12 23 12 30a12 12 0 0 0 24 0c0-7-6-14-12-24z" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"/>',
        hum: '<path d="M24 6C18 16 12 23 12 30a12 12 0 0 0 24 0c0-7-6-14-12-24z" fill="none" stroke="currentColor" stroke-width="3.5"/><path d="M19 34l10-10M19 25h.1M29 33h.1" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>',
        gauge: '<path d="M8 32a16 16 0 1 1 32 0" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/><path d="M24 32l8-10" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>',
        uv: '<circle cx="24" cy="24" r="8" fill="none" stroke="currentColor" stroke-width="3.5"/><path d="M24 4v6M24 38v6M4 24h6M38 24h6M10 10l4 4M34 34l4 4M10 38l4-4M34 14l4-4" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>',
        rise: '<path d="M6 36h36M12 36a12 12 0 0 1 24 0M24 8v12M18 14l6-6 6 6" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>',
        set: '<path d="M6 36h36M12 36a12 12 0 0 1 24 0M24 8v12M18 14l6 6 6-6" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>',
        cloud: '<path d="M14 36a8 8 0 0 1 1-16 12 12 0 0 1 23 3 6.5 6.5 0 0 1 0 13z" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"/>',
        therm: '<path d="M20 28V10a4 4 0 0 1 8 0v18a8 8 0 1 1-8 0z" fill="none" stroke="currentColor" stroke-width="3.5"/><circle cx="24" cy="35" r="4" fill="currentColor"/>',
        day: '<circle cx="24" cy="26" r="7" fill="none" stroke="currentColor" stroke-width="3.5"/><path d="M6 40h36M24 8v6M10 14l4 4M38 14l-4 4M6 26h5M37 26h5" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>',
        arrow: '<path d="M24 6l9 30-9-6-9 6z" fill="currentColor"/>'
    };
    function glyph(name, cls) {
        var s = el('span', 'wx-g' + (cls ? ' ' + cls : ''));
        s.innerHTML = '<svg viewBox="0 0 48 48" aria-hidden="true">' + GLYPH[name] + '</svg>';
        return s;
    }
    function button(cls, label) {
        var b = el('button', cls);
        b.setAttribute('data-focus', '');
        if (label) b.setAttribute('aria-label', label);
        return b;
    }

    /* ---------------- build once ---------------- */

    var STATS = [['wind', 'wgWind'], ['gust', 'wxGusts'], ['drop', 'wxPrecip'], ['hum', 'wgHumidity'],
                 ['gauge', 'wxPressure'], ['uv', 'wxUv'], ['rise', 'wxSunrise'], ['set', 'wxSunset']];

    function build(body) {
        root = el('div', 'wx');
        ui = { stats: [], hours: [], days: [] };
        var main = el('div', 'wx-main'), side = el('div', 'wx-side');

        // toolbar: place, units, refresh, when
        var bar = el('div', 'wx-bar');
        ui.place = button('wx-chip wx-place');
        ui.place.appendChild(glyph('pin'));
        ui.placeName = el('span', 'wx-chip-t');
        ui.place.appendChild(ui.placeName);
        ui.place.onclick = changePlace;
        ui.units = button('wx-chip wx-units');
        ui.units.onclick = toggleUnits;
        ui.reload = button('wx-chip wx-reload', t('wxRefresh'));
        ui.reload.appendChild(glyph('reload'));
        ui.reload.onclick = function () { load(true); };
        ui.when = el('span', 'wx-when');
        bar.appendChild(ui.place); bar.appendChild(ui.units); bar.appendChild(ui.reload); bar.appendChild(ui.when);
        main.appendChild(bar);

        // now
        var hero = el('div', 'wx-card wx-hero');
        ui.icon = el('div', 'wx-icon');
        var ht = el('div', 'wx-hero-t');
        ui.temp = el('div', 'wx-temp');
        ui.cond = el('div', 'wx-cond');
        ui.feels = el('div', 'wx-feels');
        ht.appendChild(ui.temp); ht.appendChild(ui.cond); ht.appendChild(ui.feels);
        hero.appendChild(ui.icon); hero.appendChild(ht);
        ui.msg = el('div', 'wx-msg');
        ui.msg.setAttribute('role', 'status');
        hero.appendChild(ui.msg);
        main.appendChild(hero);

        // details (now, or the focused day)
        var det = el('div', 'wx-card wx-det');
        ui.detTitle = el('h3', 'wx-h');
        det.appendChild(ui.detTitle);
        var grid = el('div', 'wx-stats');
        ui.labels = []; ui.glyphs = [];
        STATS.forEach(function (s) {
            var c = el('div', 'wx-stat'), g = glyph(s[0]);
            c.appendChild(g);
            var tx = el('div', 'wx-stat-t'), l = el('div', 'wx-stat-l', t(s[1]));
            tx.appendChild(l);
            var v = el('div', 'wx-stat-v');
            v.setAttribute('dir', 'auto');             // "12 km/h N" left to right, "10 س 41 د" right to left
            tx.appendChild(v);
            c.appendChild(tx);
            grid.appendChild(c);
            ui.stats.push(v); ui.labels.push(l); ui.glyphs.push(g);
        });
        ui.arrow = glyph('arrow', 'wx-arrow');
        ui.stats[0].parentNode.appendChild(ui.arrow);
        det.appendChild(grid);
        main.appendChild(det);

        // next 24 hours, every 3 hours
        var hc = el('div', 'wx-card wx-hours-c');
        hc.appendChild(el('h3', 'wx-h', t('wxHours')));
        var hl = el('div', 'wx-hours');
        for (var i = 0; i < 8; i++) {
            var h = button('wx-hour');
            var o = { b: h, t: el('span', 'wx-hour-t'), ic: el('span', 'wx-hour-ic'), v: el('span', 'wx-hour-v'), p: el('span', 'wx-hour-p') };
            h.appendChild(o.t); h.appendChild(o.ic); h.appendChild(o.v); h.appendChild(o.p);
            h.onfocus = function () { pick(-1); };
            hl.appendChild(h);
            ui.hours.push(o);
        }
        hc.appendChild(hl);
        main.appendChild(hc);

        // 7 days
        side.appendChild(el('h3', 'wx-h', t('wxWeek')));
        var dl = el('div', 'wx-days');
        for (var d = 0; d < 7; d++) {
            var r = button('wx-day');
            var q = { b: r, n: el('span', 'wx-day-n'), ic: el('span', 'wx-day-ic'), p: el('span', 'wx-day-p'), lo: el('span', 'wx-day-lo'),
                      bar: el('span', 'wx-range'), fill: el('i'), hi: el('span', 'wx-day-hi') };
            q.bar.appendChild(q.fill);
            r.appendChild(q.n); r.appendChild(q.ic); r.appendChild(q.p); r.appendChild(q.lo); r.appendChild(q.bar); r.appendChild(q.hi);
            r.onfocus = (function (k) { return function () { pick(k); }; })(d);
            r.onclick = (function (k) { return function () { pick(k === sel ? -1 : k); }; })(d);
            dl.appendChild(r);
            ui.days.push(q);
        }
        side.appendChild(dl);
        side.className = 'wx-card wx-side';

        root.appendChild(main); root.appendChild(side);
        body.appendChild(root);
    }

    /* ---------------- draw (textContent only, no new nodes but the icons) ---------------- */

    function draw() {
        if (!root) return;
        var s = Weather.settings();
        ui.placeName.textContent = loc && loc.name ? loc.name : (s.place || t('wxFinding'));
        ui.place.setAttribute('aria-label', t('wxChangePlace') + ': ' + ui.placeName.textContent + (s.place ? '' : ' (' + t('wxAuto') + ')'));
        ui.units.textContent = units() === 'f' ? '°F' : '°C';
        ui.units.setAttribute('aria-label', t('wgUnits') + ': ' + t(units() === 'f' ? 'wgFahrenheit' : 'wgCelsius'));
        ui.when.textContent = loading ? t('wxRefreshing') : (at ? t('wxUpdated').replace('%s', Desktop.timeText(new Date(at))) + (err === 'offline' ? ' · ' + t('wgOffline') : '') : '');

        var c = data && data.now, k = c ? Weather.sky(c.code, c.day) : null;
        root.className = 'wx' + (k ? ' wx-' + k.k + (c.day ? '' : ' wx-night') : '');
        if (k) Icons.put(ui.icon, k.ic); else ui.icon.innerHTML = '';
        ui.temp.textContent = c ? deg(c.temp) : '--';
        ui.cond.textContent = k ? t('wx_' + k.k) : '';
        var d0 = data && data.days[0];
        ui.feels.textContent = c ? t('wxFeels').replace('%s', deg(c.feels)) + (d0 ? '   ·   ' + t('wxHi') + ' ' + deg(d0.hi) + '   ' + t('wxLo') + ' ' + deg(d0.lo) : '') : '';
        ui.msg.textContent = err === 'notfound' ? t('wxNoPlace').replace('%s', s.place) : !data ? (loading ? t('wgLoading') : t('wxLoadFail')) : '';
        ui.msg.hidden = !ui.msg.textContent;

        drawHours();
        drawDays();
        drawDetails();
    }

    function drawHours() {
        var hs = data ? data.hours : [];
        for (var i = 0; i < 8; i++) {
            var o = ui.hours[i], h = hs[i * 3];
            o.b.hidden = !h;
            if (!h) continue;
            var k = Weather.sky(h.code, h.day), when = i === 0 ? t('wxNow') : Desktop.timeText(dateOf(h.time));
            o.t.textContent = when;
            Icons.put(o.ic, k.ic);
            o.v.textContent = deg(h.temp);
            o.p.textContent = h.pop ? Math.round(h.pop) + '%' : '';
            o.b.setAttribute('aria-label', when + ', ' + deg(h.temp) + ', ' + t('wx_' + k.k) + (h.pop !== null ? ', ' + t('wxPop') + ' ' + pct(h.pop) : ''));
        }
    }

    function drawDays() {
        var ds = data ? data.days : [], min = Infinity, max = -Infinity, i;
        for (i = 0; i < ds.length; i++) { if (ds[i].lo !== null) min = Math.min(min, ds[i].lo); if (ds[i].hi !== null) max = Math.max(max, ds[i].hi); }
        var span = max - min || 1;
        for (i = 0; i < 7; i++) {
            var q = ui.days[i], d = ds[i];
            q.b.hidden = !d;
            if (!d) continue;
            var k = Weather.sky(d.code, true);
            q.n.textContent = dayName(i);
            Icons.put(q.ic, k.ic);
            q.p.textContent = d.pop ? Math.round(d.pop) + '%' : '';
            q.lo.textContent = deg(d.lo);
            q.hi.textContent = deg(d.hi);
            var a = d.lo === null ? 0 : (d.lo - min) / span, b = d.hi === null ? 1 : (d.hi - min) / span;
            q.fill.style.setProperty('inset-inline-start', Math.round(a * 100) + '%');
            q.fill.style.width = Math.max(4, Math.round((b - a) * 100)) + '%';
            q.b.className = 'wx-day' + (i === sel ? ' on' : '');
            q.b.setAttribute('aria-label', dayName(i) + ': ' + t('wx_' + k.k) + ', ' + t('wxHi') + ' ' + deg(d.hi) + ', ' + t('wxLo') + ' ' + deg(d.lo) +
                (d.pop !== null && d.pop !== undefined ? ', ' + t('wxPop') + ' ' + pct(d.pop) : '') + (d.wind !== null && d.wind !== undefined ? ', ' + t('wgWind') + ' ' + speed(d.wind) + ' ' + dir(d.dir) : ''));
        }
    }

    // the details card: now (sel -1, or today's row) or the day picked in the week list
    function drawDetails() {
        var v = ui.stats, c = data && data.now, d = data && data.days[sel < 0 ? 0 : sel], w, wd, nowMode = sel <= 0;
        if (nowMode) {
            ui.detTitle.textContent = t('wxNow');
            w = c ? c.wind : null; wd = c ? c.dir : null;
            v[0].textContent = speed(w) + (dir(wd) ? ' ' + dir(wd) : '');
            v[1].textContent = speed(c ? c.gust : null);
            v[2].textContent = c ? rain(c.precip) + (d && d.pop !== null && d.pop !== undefined ? ' · ' + pct(d.pop) : '') : '--';
            v[3].textContent = pct(c ? c.hum : null);
            v[4].textContent = c && c.pressure !== null ? Math.round(c.pressure) + ' hPa' : '--';
        } else {
            ui.detTitle.textContent = dayName(sel) + (sel ? ' · ' + Desktop.dateText(dateOf(d && d.date), { day: 'numeric', month: 'long' }) : '');
            w = d ? d.wind : null; wd = d ? d.dir : null;
            v[0].textContent = speed(w) + (dir(wd) ? ' ' + dir(wd) : '');
            v[1].textContent = speed(d ? d.gust : null);
            v[2].textContent = d ? rain(d.rain) + (d.pop !== null && d.pop !== undefined ? ' · ' + pct(d.pop) : '') : '--';
            // a day has no humidity / pressure: its high / low and the daylight instead
            v[3].textContent = d ? deg(d.hi) + ' / ' + deg(d.lo) : '--';
            v[4].textContent = d ? daylight(d.rise, d.set) : '--';
        }
        slot(3, nowMode ? 'hum' : 'therm', nowMode ? 'wgHumidity' : 'wgHiLo');
        slot(4, nowMode ? 'gauge' : 'day', nowMode ? 'wxPressure' : 'wxDaylight');
        v[5].textContent = uv(d ? d.uv : null);
        v[6].textContent = clock(d && d.rise);
        v[7].textContent = clock(d && d.set);
        ui.arrow.hidden = wd === null || wd === undefined;
        if (!ui.arrow.hidden) ui.arrow.style.transform = 'rotate(' + Math.round(wd + 180) + 'deg)';    // where the wind goes
    }

    // a details slot that shows something else for a day (label + picture)
    function slot(i, g, label) {
        if (ui.labels[i].getAttribute('data-k') === label) return;
        ui.labels[i].setAttribute('data-k', label);
        ui.labels[i].textContent = t(label);
        ui.glyphs[i].innerHTML = '<svg viewBox="0 0 48 48" aria-hidden="true">' + GLYPH[g] + '</svg>';
    }
    function daylight(a, b) {
        var m = /^(\d+):(\d+)$/.exec(a || ''), n = /^(\d+):(\d+)$/.exec(b || '');
        if (!m || !n) return '--';
        var min = (+n[1] * 60 + +n[2]) - (+m[1] * 60 + +m[2]);
        return min > 0 ? Math.floor(min / 60) + ' ' + t('wgH') + ' ' + (min % 60 < 10 ? '0' : '') + (min % 60) + ' ' + t('wgMin') : '--';
    }

    function pick(i) {
        if (i === sel || !root) return;
        sel = i;
        for (var k = 0; k < 7; k++) ui.days[k].b.className = 'wx-day' + (k === sel ? ' on' : '');
        drawDetails();
    }

    /* ---------------- data ---------------- */

    function load(force) {
        if (!root) return;
        clearTimeout(timer); timer = 0;
        loading = true;
        draw();
        Weather.get(Weather.settings(), force ? 0 : FRESH, function (e, d, l, when) {
            if (!root) return;
            loading = false;
            err = e || null;
            if (d) { data = d; at = when; }
            if (l) loc = l;
            if (e === 'notfound') { data = null; at = 0; }
            draw();
            if (force) A11y.announce(ui.msg.textContent || ui.when.textContent);
            plan();
        });
    }
    // one timer while open; nothing while My PC is in the background
    function plan() {
        clearTimeout(timer);
        timer = setTimeout(function () { timer = 0; if (document.hidden) plan(); else load(false); }, AUTO);
    }

    function changePlace() {
        var s = Weather.settings();
        Keyboard.open({ title: t('wgPlace'), text: s.place || '', max: 60, hint: t('wgPlaceHint') }, function (v) {
            v = String(v || '').trim();
            if (v !== (s.place || '')) { Widgets.setSetting('weather', 'place', v); data = null; loc = null; at = 0; }
            Focus.focus(ui.place);
            load(false);
        }, function () { Focus.focus(ui.place); });
    }
    function toggleUnits() {
        Widgets.setSetting('weather', 'units', units() === 'f' ? 'c' : 'f');
        var p = Weather.peek();
        data = p ? p.data : null; at = p ? p.at : 0;
        load(false);
        A11y.announce(ui.units.getAttribute('aria-label'));
    }

    Win.register('weather', {
        icon: 'weather',
        title: function () { return t('weather'); },
        open: function (body) {
            build(body);
            var p = Weather.peek();
            if (p) { data = p.data; loc = p.loc; at = p.at; }
            sel = -1;
            load(false);
            return ui.days[0].b.hidden ? ui.place : ui.days[0].b;
        },
        refresh: function () { if (root) draw(); },
        close: function () { clearTimeout(timer); timer = 0; root = ui = null; data = loc = null; at = 0; err = null; sel = -1; loading = false; }
    });
})();
