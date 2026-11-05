/* Settings for every My PC, set by admins in the App Store Manager > Settings (Firestore settings/mypc):
 *   { wallpapers: [{ url, title, thumb }], wallpaper: '<default background>', notifyFast: ['<username>'],
 *     events: [{ date: 'YYYY-MM-DD', end, title, tag, time: 'HH:MM' }], updatedAt, updatedBy }
 * Each My PC copies the document at start (GlobalSettings.sync) into arc_dev_global (TV-wide; not in the backup,
 * it comes back from the cloud) so the desktop has it before the network answers and when offline.
 * Also loaded by the App Store Manager (installer/index.html), which uses clean() and titleFromUrl().
 *
 *   GlobalSettings.wallpapers()         [{ id: 'u:<url>', url, title, thumb }]   (pictures added by admins)
 *   GlobalSettings.defaultWallpaper()   '' or the wallpaper new profiles get (a built-in name or a picture id)
 *   GlobalSettings.events()             [{ date, end, title, tag, time }]   events on every calendar (World Cup, AFCON, big matches; js/core/events.js)
 *   GlobalSettings.notifyFast(user)    true: this player account checks its notifications every 2 minutes (others every 30)
 *   GlobalSettings.sync(cb)             reads settings/mypc again; cb(err, changed) */
var GlobalSettings = (function () {
    'use strict';

    var KEY = 'arc_dev_global', MAX_WP = 40, MAX_URL = 1000, MAX_TITLE = 60, MAX_FAST = 200, MAX_EV = 100;
    var DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
    var USER = /^[a-z0-9][a-z0-9_.]{1,14}[a-z0-9_]$/;
    var data = null, waiting = null;

    function str(v, n) { return typeof v === 'string' ? v.trim().slice(0, n) : ''; }
    function okUrl(u) { return /^https:\/\/[^\s"'()\\]+$/i.test(u); }

    // "https://x.com/pics/blue-lake_2.jpg?w=1920" -> "Blue lake 2"
    function titleFromUrl(url) {
        var s = String(url || '').split('#')[0].split('?')[0].replace(/^[a-z]+:\/\/[^/]*/i, '').replace(/\/+$/, '');
        var name = s.slice(s.lastIndexOf('/') + 1);
        try { name = decodeURIComponent(name); } catch (e) {}
        name = name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[-_.+]+/g, ' ').replace(/\s+/g, ' ').trim();
        if (!name || /^[0-9a-f]{16,}$/i.test(name.replace(/ /g, ''))) {             // no name, or a hash: use the site
            var m = /^[a-z]+:\/\/(?:www\.)?([^/:]+)/i.exec(String(url || ''));
            name = m ? m[1] : 'Picture';
        }
        return (name.charAt(0).toUpperCase() + name.slice(1)).slice(0, MAX_TITLE);
    }

    // anything (the Firestore document) -> a safe settings object
    function clean(d) {
        d = d && typeof d === 'object' ? d : {};
        var out = { wallpapers: [], wallpaper: '' }, seen = {};
        var list = Array.isArray(d.wallpapers) ? d.wallpapers : [];
        for (var i = 0; i < list.length && out.wallpapers.length < MAX_WP; i++) {
            var w = list[i] || {}, url = str(w.url, MAX_URL), thumb = str(w.thumb, MAX_URL);
            if (!okUrl(url) || seen[url]) continue;
            seen[url] = 1;
            var o = { url: url, title: str(w.title, MAX_TITLE) || titleFromUrl(url) };
            if (thumb && okUrl(thumb)) o.thumb = thumb;
            out.wallpapers.push(o);
        }
        out.wallpaper = str(d.wallpaper, MAX_URL + 2);
        // player accounts allowed to check their push notifications every 2 minutes (Firestore cost: the others every 30)
        out.notifyFast = [];
        var fl = Array.isArray(d.notifyFast) ? d.notifyFast : [];
        for (i = 0; i < fl.length && out.notifyFast.length < MAX_FAST; i++) {
            var u = String(fl[i] || '').toLowerCase().replace(/\s+/g, '');
            if (USER.test(u) && u.indexOf('..') < 0 && out.notifyFast.indexOf(u) < 0) out.notifyFast.push(u);
        }
        // events every calendar shows (App Store Manager > Settings > Events)
        out.events = [];
        var el = Array.isArray(d.events) ? d.events : [];
        for (i = 0; i < el.length && out.events.length < MAX_EV; i++) {
            var e = el[i] || {}, date = str(e.date, 10), title = str(e.title, MAX_TITLE);
            if (!DAY.test(date) || !title) continue;
            var ev = { date: date, end: DAY.test(str(e.end, 10)) && str(e.end, 10) >= date ? str(e.end, 10) : date, title: title,
                       tag: /^[a-z0-9-]{1,30}$/.test(str(e.tag, 30)) ? str(e.tag, 30) : 'event' };
            if (/^([01]\d|2[0-3]):[0-5]\d$/.test(str(e.time, 5))) ev.time = str(e.time, 5);
            out.events.push(ev);
        }
        return out;
    }

    // "2027-06-19..2027-07-17 21:00 AFCON 2027 #afcon" (one line of the Manager's list) -> an event, or null
    function parseEventLine(line) {
        var m = /^\s*(\d{4}-\d\d-\d\d)(?:\s*(?:\.\.|→|to)\s*(\d{4}-\d\d-\d\d))?(?:\s+(\d\d:\d\d))?\s+(.+?)\s*$/.exec(String(line || ''));
        if (!m) return null;
        var title = m[4], tag = '', t = /\s+#([a-z0-9-]{1,30})$/i.exec(title);
        if (t) { tag = t[1].toLowerCase(); title = title.slice(0, t.index).trim(); }
        var ev = clean({ events: [{ date: m[1], end: m[2] || m[1], time: m[3] || '', title: title, tag: tag }] }).events[0];
        return ev || null;
    }
    function eventLine(e) { return e.date + (e.end && e.end !== e.date ? '..' + e.end : '') + (e.time ? ' ' + e.time : '') + ' ' + e.title + (e.tag && e.tag !== 'event' ? ' #' + e.tag : ''); }

    function load() {
        if (data) return data;
        var v = null;
        try { v = JSON.parse(localStorage.getItem(KEY)); } catch (e) { v = null; }
        data = clean(v);
        return data;
    }

    function wallpapers() {
        var l = load().wallpapers, out = [];
        for (var i = 0; i < l.length; i++) out.push({ id: 'u:' + l[i].url, url: l[i].url, title: l[i].title, thumb: l[i].thumb || '' });
        return out;
    }
    function defaultWallpaper() { return load().wallpaper; }

    function sync(cb) {
        if (waiting) { if (cb) waiting.push(cb); return; }
        waiting = cb ? [cb] : [];
        function done(e, changed) { var l = waiting; waiting = null; for (var i = 0; i < l.length; i++) try { l[i](e, changed); } catch (x) {} }
        if (typeof Cloud === 'undefined') return done('offline', false);
        Cloud.get('settings/mypc', 4000, function (e, d) {
            if (e && e !== 'notfound') return done(e, false);
            var next = clean(e ? {} : d), before = JSON.stringify(load()), now = JSON.stringify(next);
            data = next;
            try { localStorage.setItem(KEY, now); } catch (x) {}
            done(null, before !== now);
        });
    }

    function notifyFast(user) { return !!user && load().notifyFast.indexOf(String(user).toLowerCase()) >= 0; }

    return { events: function () { return load().events || []; }, parseEventLine: parseEventLine, eventLine: eventLine, wallpapers: wallpapers, defaultWallpaper: defaultWallpaper, notifyFast: notifyFast, sync: sync, clean: clean, titleFromUrl: titleFromUrl,
             _reset: function () { data = null; } };
})();
if (typeof module !== 'undefined') module.exports = GlobalSettings;
