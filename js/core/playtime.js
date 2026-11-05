/* Playtime: how long this profile played, for the Playtime widget (js/launcher/widgets.js) and the Playtime app
 * (js/launcher/apps/playtime.js). The game page (index.html?play=<id>) counts while the game or app really runs (not paused,
 * not in the background): one cheap check a minute, saved then and when the game closes. Profile key playtime:
 *   { days: { 'YYYY-MM-DD': seconds } (last 120 days),
 *     games: { <id>: { s: seconds, t: title, at: last played, n: sessions, best: longest session (s), first: first played } } }
 * Old entries (before sessions were counted) have no n / best / first: shown as 1 session. */
var Playtime = (function () {
    'use strict';

    var TICK = 60000, KEEP = 120, timer = 0, gameId = null, gameTitle = '', last = 0, sess = 0;

    function day(d) { d = d || new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
    function data() {
        var p = Store.get('playtime', null);
        if (!p || typeof p !== 'object') p = {};
        if (!p.days || typeof p.days !== 'object') p.days = {};
        if (!p.games || typeof p.games !== 'object') p.games = {};
        return p;
    }
    function playing() {
        return typeof GameHost !== 'undefined' && GameHost.state() === 'running' && !document.hidden;
    }
    // adds the time since the last check (only while it really runs; at most one tick, a sleeping TV adds nothing)
    function add(sec) {
        if (!gameId || sec < 1) return;
        var p = data(), today = day(), g = p.games[gameId] || { s: 0 };
        p.days[today] = Math.round((p.days[today] || 0) + sec);
        g.s = Math.round((g.s || 0) + sec); g.t = gameTitle; g.at = Date.now();
        if (!sess) { g.n = (g.n || 0) + 1; if (!g.first) g.first = g.at; }
        sess += sec;
        if (Math.round(sess) > (g.best || 0)) g.best = Math.round(sess);
        p.games[gameId] = g;
        var keys = Object.keys(p.days).sort();
        while (keys.length > KEEP) delete p.days[keys.shift()];
        Store.set('playtime', p);
    }
    function check() {
        var t = Date.now(), sec = Math.min((t - last) / 1000, TICK / 1000 + 5);
        last = t;
        if (playing()) add(sec);
    }
    function start(id, title) {
        stop();
        gameId = id; gameTitle = String(title || id).slice(0, 40); last = Date.now(); sess = 0;
        timer = setInterval(check, TICK);
        window.addEventListener('pagehide', stop);
    }
    function stop() {
        if (!gameId) return;
        clearInterval(timer); timer = 0;
        check();
        gameId = null;
        window.removeEventListener('pagehide', stop);
    }

    // the numbers the widget shows
    function summary() {
        var p = data(), today = day(), week = 0, d = new Date(), i, top = null;
        for (i = 0; i < 7; i++) { week += p.days[day(d)] || 0; d.setDate(d.getDate() - 1); }
        for (var id in p.games) if (!top || p.games[id].s > top.s) top = { id: id, s: p.games[id].s, t: p.games[id].t || id };
        var lastG = null;
        for (id in p.games) if (!lastG || (p.games[id].at || 0) > (lastG.at || 0)) lastG = { id: id, at: p.games[id].at, t: p.games[id].t || id };
        return { today: p.days[today] || 0, week: week, top: top, last: lastG };
    }
    /* everything the Playtime app shows, for the last `range` days (7 or 30):
     *   { days: [{ day, date, s }] oldest first, total, prev (the `range` days before), max, played (days with time),
     *     week, prevWeek, today, streak (days in a row up to today, or up to yesterday before playing today),
     *     best: { day, s } | null (best day kept), games: [{ id, t, s, n, best, at, first }] most played first, all } */
    function stats(range) {
        range = range > 0 ? Math.min(range, KEEP) : 7;
        var p = data(), d = new Date(), out = { days: [], total: 0, prev: 0, max: 0, played: 0, week: 0, prevWeek: 0, streak: 0, best: null, games: [], all: 0 };
        var i, k, s;
        for (i = 0; i < Math.max(range * 2, 14); i++) {
            k = day(d); s = p.days[k] || 0;
            if (i < range) {
                out.days.unshift({ day: k, date: new Date(d.getTime()), s: s });
                out.total += s; if (s) out.played++; if (s > out.max) out.max = s;
            } else if (i < range * 2) out.prev += s;
            if (i < 7) out.week += s; else if (i < 14) out.prevWeek += s;
            d.setDate(d.getDate() - 1);
        }
        out.today = p.days[day()] || 0;
        d = new Date();
        if (!out.today) d.setDate(d.getDate() - 1);
        while (out.streak < KEEP && p.days[day(d)] > 0) { out.streak++; d.setDate(d.getDate() - 1); }
        for (k in p.days) if (p.days[k] > 0 && (!out.best || p.days[k] > out.best.s)) out.best = { day: k, s: p.days[k] };
        for (k in p.games) {
            var g = p.games[k];
            if (!g || !(g.s > 0)) continue;
            out.games.push({ id: k, t: g.t || k, s: g.s, n: g.n || 1, best: g.best || 0, at: g.at || 0, first: g.first || 0 });
            out.all += g.s;
        }
        out.games.sort(function (a, b) { return b.s - a.s || b.at - a.at; });
        return out;
    }
    // the profile starts over (Playtime app > Clear my playtime)
    function clear() { Store.set('playtime', { days: {}, games: {} }); sess = 0; }

    function length(sec, h, m) {
        sec = Math.max(0, Math.round(sec || 0));
        var hh = Math.floor(sec / 3600), mm = Math.floor(sec % 3600 / 60);
        return hh ? hh + ' ' + h + ' ' + ('0' + mm).slice(-2) + ' ' + m : mm + ' ' + m;
    }

    return { start: start, stop: stop, summary: summary, stats: stats, clear: clear, length: length, day: day, _check: check };
})();
