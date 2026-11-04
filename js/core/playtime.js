/* Playtime: how long this profile played, for the Playtime widget (js/launcher/widgets.js).
 * The game page (index.html?play=<id>) counts while the game or app really runs (not paused, not in the background):
 * one cheap check a minute, saved then and when the game closes. Profile key playtime:
 *   { days: { 'YYYY-MM-DD': seconds } (last 14 days), games: { <id>: { s: seconds, t: title, at: last played } } } */
var Playtime = (function () {
    'use strict';

    var TICK = 60000, timer = 0, gameId = null, gameTitle = '', last = 0;

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
        p.games[gameId] = g;
        var keys = Object.keys(p.days).sort();
        while (keys.length > 14) delete p.days[keys.shift()];
        Store.set('playtime', p);
    }
    function check() {
        var t = Date.now(), sec = Math.min((t - last) / 1000, TICK / 1000 + 5);
        last = t;
        if (playing()) add(sec);
    }
    function start(id, title) {
        stop();
        gameId = id; gameTitle = String(title || id).slice(0, 40); last = Date.now();
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
    function length(sec, h, m) {
        sec = Math.max(0, Math.round(sec || 0));
        var hh = Math.floor(sec / 3600), mm = Math.floor(sec % 3600 / 60);
        return hh ? hh + ' ' + h + ' ' + ('0' + mm).slice(-2) + ' ' + m : mm + ' ' + m;
    }

    return { start: start, stop: stop, summary: summary, length: length, day: day, _check: check };
})();
