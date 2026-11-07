/* Weather data for the Weather app (js/launcher/apps/weather.js) and the desktop Weather widget (js/launcher/widgets.js).
 * Open-Meteo (free, no key). The place: the city typed in the widget's / app's settings (one setting for both, saved by
 * Widgets.setSetting('weather', ...)), else found from the internet address (GeoJS) once a day; profile key weather_loc.
 * Cheap on purpose: ONE request gives now + the next 24 hours + 7 days; the answer is kept on the TV (arc_dev_wxfc, not in the
 * backup: public data) and shared, so the widget and the app never ask twice within a few minutes; two callers at the same
 * time share one request. No timer here: callers decide when to ask. Keep the wgPrivacy text (i18n-widgets.js) true. */
var Weather = (function () {
    'use strict';

    var FC = 'arc_dev_wxfc', waiting = {};

    function now() { return Date.now(); }

    // a small GET of JSON, with a timeout; cb(err, json)
    function getJson(url, ms, cb) {
        var x = new XMLHttpRequest(), done = false;
        function end(e, j) { if (!done) { done = true; cb(e, j); } }
        try {
            x.open('GET', url, true);
            x.timeout = ms;
            x.onload = function () { var j = null; try { j = JSON.parse(x.responseText); } catch (e) {} end(x.status >= 200 && x.status < 300 && j ? null : 'http ' + x.status, j); };
            x.onerror = x.ontimeout = function () { end('network'); };
            x.send();
        } catch (e) { end('network'); }
    }

    // WMO weather code -> condition key (strings wx_<k>) and icon (Icons)
    var WMO = [[0, 'clear', 'sun'], [2, 'partly', 'partly'], [3, 'cloudy', 'cloud'], [48, 'fog', 'fog'], [57, 'drizzle', 'rain'],
               [67, 'rain', 'rain'], [77, 'snow', 'snow'], [82, 'showers', 'rain'], [86, 'snow', 'snow'], [99, 'storm', 'storm']];
    function sky(code, day) {
        if (typeof code === 'number') for (var i = 0; i < WMO.length; i++) if (code <= WMO[i][0]) return { k: WMO[i][1], ic: day === false && WMO[i][2] === 'sun' ? 'moon' : day === false && WMO[i][2] === 'partly' ? 'pnight' : WMO[i][2] };   // at night: the moon, never the sun
        return { k: 'cloudy', ic: 'cloud' };
    }

    function settings() {
        var c = typeof Widgets !== 'undefined' && Widgets.conf ? Widgets.conf('weather') : null;
        return c && c.s ? c.s : { place: '', units: 'c' };
    }

    function place(s, cb) {
        var q = String(s.place || '').trim(), loc = Store.get('weather_loc', null);
        if (loc && loc.q === q && loc.lat !== undefined && (q || now() - (loc.at || 0) < 86400000)) return cb(null, loc);
        function keep(l) { l.q = q; l.at = now(); Store.set('weather_loc', l); cb(null, l); }
        if (q) {
            return getJson('https://geocoding-api.open-meteo.com/v1/search?count=1&language=' + I18n.lang() + '&name=' + encodeURIComponent(q), 8000, function (e, j) {
                var r = j && j.results && j.results[0];
                if (e || !r) return cb(e ? 'offline' : 'notfound', loc && loc.q === q ? loc : null);
                keep({ lat: r.latitude, lon: r.longitude, name: r.name, country: r.country || '' });
            });
        }
        getJson('https://get.geojs.io/v1/ip/geo.json', 8000, function (e, j) {
            if (e || !j || !j.latitude) return cb('offline', loc && !loc.q ? loc : null);
            keep({ lat: +j.latitude, lon: +j.longitude, name: j.city || j.region || j.country || '', country: j.country || '' });
        });
    }

    function num(a, i) { var v = a && a[i]; return typeof v === 'number' ? v : null; }
    function hm(s) { return typeof s === 'string' && s.length >= 16 ? s.slice(11, 16) : ''; }

    // Open-Meteo's answer -> { now, hours [24 from now], days [7], byDay { date: [8 points, every 3 h] } } (every field may be null: drawn as "--")
    function parse(j) {
        var c = j.current || {}, h = j.hourly || {}, d = j.daily || {}, out = { now: null, hours: [], days: [], byDay: {} }, i;
        out.now = {
            time: c.time || '', temp: num([c.temperature_2m], 0), feels: num([c.apparent_temperature], 0), hum: num([c.relative_humidity_2m], 0),
            precip: num([c.precipitation], 0), code: num([c.weather_code], 0), day: c.is_day !== 0, clouds: num([c.cloud_cover], 0),
            pressure: num([c.pressure_msl], 0), wind: num([c.wind_speed_10m], 0), dir: num([c.wind_direction_10m], 0), gust: num([c.wind_gusts_10m], 0)
        };
        // the hours from the current one (the answer may start earlier)
        var times = h.time || [], hour = String(c.time || '').slice(0, 13), start = 0;
        if (hour) for (i = 0; i < times.length; i++) if (String(times[i]).slice(0, 13) >= hour) { start = i; break; }
        for (i = start; i < times.length && out.hours.length < 24; i++) {
            out.hours.push({ time: times[i], temp: num(h.temperature_2m, i), pop: num(h.precipitation_probability, i), code: num(h.weather_code, i),
                             day: h.is_day ? h.is_day[i] !== 0 : true });
        }
        // each day's 24 hours as 8 points (00:00, 03:00 ... 21:00); a storm inside a 3 h slot is the point shown (owner request 2026-11-07)
        for (i = 0; i < times.length; i++) {
            var tm = String(times[i]), hr = +tm.slice(11, 13), day = tm.slice(0, 10), slot = Math.floor(hr / 3);
            if (!day || isNaN(hr)) continue;
            var list = out.byDay[day] || (out.byDay[day] = []), pt = { time: times[i], temp: num(h.temperature_2m, i), pop: num(h.precipitation_probability, i),
                                                                       code: num(h.weather_code, i), day: h.is_day ? h.is_day[i] !== 0 : true };
            if (hr % 3 === 0 && !list[slot]) list[slot] = pt;
            else if (list[slot] && kindOf(pt.code) === 'storm' && kindOf(list[slot].code) !== 'storm') list[slot] = pt;
        }
        var dates = d.time || [];
        for (i = 0; i < dates.length && i < 7; i++) {
            out.days.push({ date: dates[i], code: num(d.weather_code, i), hi: num(d.temperature_2m_max, i), lo: num(d.temperature_2m_min, i),
                            rain: num(d.precipitation_sum, i), pop: num(d.precipitation_probability_max, i), wind: num(d.wind_speed_10m_max, i),
                            gust: num(d.wind_gusts_10m_max, i), dir: num(d.wind_direction_10m_dominant, i), uv: num(d.uv_index_max, i),
                            rise: hm(d.sunrise && d.sunrise[i]), set: hm(d.sunset && d.sunset[i]) });
        }
        // an answer with only today's high / low (older shape): still one day
        if (!out.days.length && d.temperature_2m_max) out.days.push({ date: String(c.time || '').slice(0, 10), code: out.now.code, hi: num(d.temperature_2m_max, 0), lo: num(d.temperature_2m_min, 0) });
        return out;
    }

    function url(loc, f) {
        return 'https://api.open-meteo.com/v1/forecast?latitude=' + loc.lat + '&longitude=' + loc.lon +
            '&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m' +
            '&hourly=temperature_2m,precipitation_probability,weather_code,is_day' +
            '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,sunrise,sunset,uv_index_max' +
            '&forecast_days=7&timezone=auto' + (f ? '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch' : '');
    }
    function keyOf(loc, f) { return 'v2,' + (+loc.lat).toFixed(2) + ',' + (+loc.lon).toFixed(2) + ',' + (f ? 'f' : 'c'); }
    function cache() { var c = Store.rawGet(FC); return c && typeof c === 'object' && c.d ? c : null; }

    /* get(settings, maxAge ms, cb(err, data, loc, at)): data younger than maxAge comes from the TV, else one request.
     * err: 'notfound' (the typed place), 'offline' (data is then the last one kept for that place, or null). */
    function get(s, maxAge, cb) {
        s = s || settings();
        var f = s.units === 'f';
        place(s, function (err, loc) {
            if (!loc) return cb(err || 'offline', null, null, 0);
            var k = keyOf(loc, f), c = cache(), have = c && c.k === k ? c : null;
            if (have && now() - have.at < maxAge) return cb(null, have.d, loc, have.at);
            if (waiting[k]) { waiting[k].push(cb); return; }
            waiting[k] = [cb];
            getJson(url(loc, f), 10000, function (e, j) {
                var list = waiting[k], data = null, at = 0;
                delete waiting[k];
                if (!e && j && j.current) {
                    data = parse(j); at = now();
                    Store.rawSet(FC, { k: k, at: at, d: data });
                }
                for (var i = 0; i < list.length; i++) {
                    try { if (data) list[i](null, data, loc, at); else list[i]('offline', have ? have.d : null, loc, have ? have.at : 0); } catch (x) {}
                }
            });
        });
    }

    // what is kept for the place and units now in use (instant first paint), or null
    function peek(s) {
        s = s || settings();
        var loc = Store.get('weather_loc', null), c = cache();
        if (!loc || loc.lat === undefined || loc.q !== String(s.place || '').trim() || !c || c.k !== keyOf(loc, s.units === 'f')) return null;
        return { data: c.d, loc: loc, at: c.at };
    }

    /* Warnings (owner request 2026-11-05): rain / snow coming within `ahead` hours (1, 2, 4, 6, 8 or 24; 0 = off) and a thunderstorm
     * within 24 hours (danger). From the hourly forecast: [{ kind: 'storm' | 'rain' | 'snow', level: 'danger' | 'warn', in (hours from
     * now, 0 = this hour), time ('HH:MM'), pop, key (to tell once) }], the storm first. */
    function kindOf(code) {
        if (typeof code !== 'number') return '';
        if (code >= 95) return 'storm';
        if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
        if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
        return '';
    }
    function alerts(data, ahead) {
        var out = [], hs = data && data.hours ? data.hours : [], seen = {};
        ahead = +ahead || 0;
        if (!ahead) return out;
        for (var i = 0; i < hs.length && i <= 24; i++) {
            var k = kindOf(hs[i].code);
            if (!k || seen[k] || (k !== 'storm' && i > ahead)) continue;
            seen[k] = 1;
            out.push({ kind: k, level: k === 'storm' ? 'danger' : 'warn', 'in': i, time: hm(hs[i].time), pop: hs[i].pop, key: k + '@' + String(hs[i].time).slice(0, 13) });
        }
        out.sort(function (a, b) { return (a.level === 'danger' ? -100 : 0) + a['in'] - ((b.level === 'danger' ? -100 : 0) + b['in']); });
        return out.slice(0, 2);
    }
    // the sentence for a warning (strings wxAl<kind>Now / wxAl<kind>In)
    function alertText(a) {
        var k = a.kind.charAt(0).toUpperCase() + a.kind.slice(1);
        if (a['in'] === 0) return I18n.t('wxAl' + k + 'Now');
        return I18n.t('wxAl' + k + 'In').replace('%n', a['in']).replace('%t', typeof Desktop !== 'undefined' && a.time ? Desktop.timeText(new Date(2000, 0, 1, +a.time.slice(0, 2), +a.time.slice(3, 5))) : a.time);
    }

    /* Animated sky pictures (owner request 2026-11-05): the same drawings as the icons, with parts that move in CSS
     * (css/weather.css .wa-*: transform / opacity only, so the TV's GPU does it; nothing runs while the desktop is hidden). */
    var CLOUD_HI = 'M13 30a9 9 0 0 1 1-18 13 13 0 0 1 25 3 7.5 7.5 0 0 1 0 15z';
    var RAYS = '<g class="wa-rays" stroke="#ffc83d" stroke-width="3.5" stroke-linecap="round"><path d="M24 4v6M24 38v6M4 24h6M38 24h6M9.9 9.9l4.2 4.2M33.9 33.9l4.2 4.2M9.9 38.1l4.2-4.2M33.9 14.1l4.2-4.2"/></g>';
    function drops(cls, shape) {
        var xs = [[15, 0], [24, 0.35], [33, 0.7], [20, 0.55], [29, 0.15]], o = '';
        for (var i = 0; i < xs.length; i++) o += '<g class="' + cls + '" style="animation-delay:-' + xs[i][1] + 's">' + shape(xs[i][0]) + '</g>';
        return o;
    }
    var ART = {
        sun: '<g class="wa-spin">' + RAYS + '</g><circle class="wa-glow" cx="24" cy="24" r="9" fill="#ffc83d"/>',
        moon: '<g class="wa-float"><path d="M30 6a17 17 0 1 0 12 26A14 14 0 0 1 30 6z" fill="#cfd8ff"/></g>' +
              '<circle class="wa-star" cx="8" cy="9" r="1.6" fill="#fff"/><circle class="wa-star wa-d2" cx="41" cy="12" r="1.3" fill="#fff"/><circle class="wa-star wa-d3" cx="38" cy="42" r="1.4" fill="#fff"/>',
        partly: '<g transform="translate(-6 -7) scale(1)"><g class="wa-spin">' + RAYS.replace('stroke-width="3.5"', 'stroke-width="3"') + '</g><circle class="wa-glow" cx="24" cy="24" r="8" fill="#ffc83d"/></g>' +
                '<g class="wa-drift"><path d="M15 40a8 8 0 0 1 1-16 11 11 0 0 1 21 3 7 7 0 0 1 0 13z" fill="#e8f1ff"/></g>',
        pnight: '<g transform="translate(-1 -2) scale(0.56)" style="transform-origin:0 0"><g class="wa-float"><path d="M30 6a17 17 0 1 0 12 26A14 14 0 0 1 30 6z" fill="#cfd8ff"/></g></g>' +
                '<circle class="wa-star" cx="40" cy="7" r="1.4" fill="#fff"/><circle class="wa-star wa-d2" cx="44" cy="20" r="1.2" fill="#fff"/>' +
                '<g class="wa-drift"><path d="M15 40a8 8 0 0 1 1-16 11 11 0 0 1 21 3 7 7 0 0 1 0 13z" fill="#d6deea"/></g>',
        cloud: '<g class="wa-drift2"><path d="M20 26a6 6 0 0 1 1-12 9 9 0 0 1 17 2 5 5 0 0 1 0 10z" fill="#b9c6d8"/></g>' +
               '<g class="wa-drift"><path d="M13 38a9 9 0 0 1 1-18 13 13 0 0 1 25 3 7.5 7.5 0 0 1 0 15z" fill="#dfe7f2"/></g>',
        rain: drops('wa-drop', function (x) { return '<path d="M' + x + ' 33l-2 6" stroke="#4fa8ff" stroke-width="3" stroke-linecap="round"/>'; }) +
              '<g class="wa-bob"><path d="' + CLOUD_HI + '" fill="#c9d4e4"/></g>',
        snow: drops('wa-flake', function (x) { return '<circle cx="' + x + '" cy="35" r="2.2" fill="#fff"/>'; }) +
              '<g class="wa-bob"><path d="' + CLOUD_HI + '" fill="#dfe7f2"/></g>',
        storm: drops('wa-drop', function (x) { return '<path d="M' + x + ' 33l-2 6" stroke="#4fa8ff" stroke-width="3" stroke-linecap="round"/>'; }) +
               '<g class="wa-bob"><path d="' + CLOUD_HI + '" fill="#9aa6b8"/></g><path class="wa-bolt" d="M26 28l-7 10h6l-3 8 9-11h-6l3-7z" fill="#ffd23d"/>',
        fog: '<g stroke="#dfe7f2" stroke-width="4" stroke-linecap="round"><path class="wa-fog" d="M8 16h32"/><path class="wa-fog wa-d2" d="M5 24h38"/><path class="wa-fog" d="M10 32h30"/><path class="wa-fog wa-d2" d="M14 40h20"/></g>'
    };
    // an <svg> string of the animated picture for an icon name (sun, moon, partly, pnight, cloud, rain, snow, storm, fog), or ''
    function art(name) { return ART[name] ? '<svg class="wa" viewBox="0 0 48 48" aria-hidden="true">' + ART[name] + '</svg>' : ''; }

    // compass point of a wind direction (degrees it blows from), 0..7 = N NE E SE S SW W NW
    function point(deg) { return typeof deg === 'number' ? Math.round(((deg % 360) + 360) % 360 / 45) % 8 : -1; }

    return { art: art, alerts: alerts, alertText: alertText, kindOf: kindOf, sky: sky, settings: settings, place: place, get: get, peek: peek, parse: parse, point: point, getJson: getJson };
})();
