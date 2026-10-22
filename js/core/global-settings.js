/* Settings for every My PC, set by admins in the App Store Manager > Settings (Firestore settings/mypc):
 *   { wallpapers: [{ url, title, thumb }], wallpaper: '<default background>', updatedAt, updatedBy }
 * Each My PC copies the document at start (GlobalSettings.sync) into arc_dev_global (TV-wide; not in the backup,
 * it comes back from the cloud) so the desktop has it before the network answers and when offline.
 * Also loaded by the App Store Manager (installer/index.html), which uses clean() and titleFromUrl().
 *
 *   GlobalSettings.wallpapers()         [{ id: 'u:<url>', url, title, thumb }]   (pictures added by admins)
 *   GlobalSettings.defaultWallpaper()   '' or the wallpaper new profiles get (a built-in name or a picture id)
 *   GlobalSettings.sync(cb)             reads settings/mypc again; cb(err, changed) */
var GlobalSettings = (function () {
    'use strict';

    var KEY = 'arc_dev_global', MAX_WP = 40, MAX_URL = 1000, MAX_TITLE = 60;
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
        return out;
    }

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

    return { wallpapers: wallpapers, defaultWallpaper: defaultWallpaper, sync: sync, clean: clean, titleFromUrl: titleFromUrl,
             _reset: function () { data = null; } };
})();
if (typeof module !== 'undefined') module.exports = GlobalSettings;
