/* Namespaced, exception-safe localStorage (quota errors and disabled storage never crash the app).
 *
 * Keys are per profile (arc_<profile>_<key>): game saves, top scores, last game, initials...
 * TV-wide settings (language, volumes, graphics, benchmark) are shared by every profile
 * (arc_dev_<key>). The profile list itself is arc_profiles, the active one arc_profile. */
var Store = (function () {
    'use strict';
    var PREFIX = 'arc_';
    var DEVICE = { lang: 1, vol_music: 1, vol_sfx: 1, gfx: 1, perf_bench_v1: 1 };

    function raw(k) { try { var v = localStorage.getItem(k); return v === null ? undefined : JSON.parse(v); } catch (e) { return undefined; } }
    function rawSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }

    var profile = raw(PREFIX + 'profile');
    if (typeof profile !== 'string' || !/^p\d+$/.test(profile)) profile = 'p1';

    // Settings used to live in profile p1: move them to the shared space once.
    (function migrate() {
        for (var k in DEVICE) {
            var old = raw(PREFIX + 'p1_' + k);
            if (old !== undefined && raw(PREFIX + 'dev_' + k) === undefined) rawSet(PREFIX + 'dev_' + k, old);
        }
    })();

    function key(k) { return PREFIX + (DEVICE[k] ? 'dev' : profile) + '_' + k; }

    function get(k, def) { var v = raw(key(k)); return v === undefined ? def : v; }
    function set(k, v) { return rawSet(key(k), v); }
    function remove(k) { try { localStorage.removeItem(key(k)); } catch (e) {} }

    function dropPrefix(full) {
        try {
            var drop = [], i;
            for (i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (k && k.indexOf(full) === 0) drop.push(k);
            }
            for (i = 0; i < drop.length; i++) localStorage.removeItem(drop[i]);
        } catch (e) {}
    }

    // Removes every key of the active profile that starts with the given (unprefixed) prefix,
    // e.g. 'game_' for all progress.
    function clearPrefix(p) { dropPrefix(key(p)); }

    return {
        get: get, set: set, remove: remove, clearPrefix: clearPrefix,
        profile: function () { return profile; },
        setProfile: function (id) { profile = id; rawSet(PREFIX + 'profile', id); },
        dropProfile: function (id) { dropPrefix(PREFIX + id + '_'); },
        rawGet: raw, rawSet: rawSet
    };
})();

/* Player profiles on this TV: each one has its own saves, scores and last played game. */
var Profiles = (function () {
    'use strict';
    var KEY = 'arc_profiles', MAX = 8, NAME_MAX = 12;
    var COLORS = ['#ffd23f', '#4cd97b', '#4fb9e8', '#ff5d73', '#c158e0', '#ff9f43', '#36d6c3', '#f2f4ff'];

    function list() {
        var l = Store.rawGet(KEY);
        if (!l || !l.length) {
            l = [{ id: 'p1', name: '', color: COLORS[0] }];   // '' = "Player 1" in the current language
            Store.rawSet(KEY, l);
        }
        return l;
    }
    function find(id) { var l = list(); for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }
    function current() { return find(Store.profile()) || list()[0]; }
    function cleanName(n) { return String(n || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '').slice(0, NAME_MAX); }

    function create(name) {
        var l = list();
        if (l.length >= MAX) return null;
        var n = 1;
        while (find('p' + n)) n++;
        var used = {}, color = COLORS[0];
        for (var i = 0; i < l.length; i++) used[l[i].color] = 1;
        for (i = 0; i < COLORS.length; i++) if (!used[COLORS[i]]) { color = COLORS[i]; break; }
        var p = { id: 'p' + n, name: cleanName(name), color: color };
        l.push(p);
        Store.rawSet(KEY, l);
        return p;
    }
    function rename(id, name) {
        var l = list();
        for (var i = 0; i < l.length; i++) if (l[i].id === id) l[i].name = cleanName(name);
        Store.rawSet(KEY, l);
    }
    // Deletes a profile and all its data. The last profile cannot be deleted.
    function remove(id) {
        var l = list(), out = [];
        if (l.length < 2) return false;
        for (var i = 0; i < l.length; i++) if (l[i].id !== id) out.push(l[i]);
        Store.rawSet(KEY, out);
        Store.dropProfile(id);
        if (Store.profile() === id) Store.setProfile(out[0].id);
        return true;
    }
    function use(id) { if (find(id)) Store.setProfile(id); }
    // Display name: an unnamed profile is "Player <n>"
    function name(p, playerWord) { p = p || current(); return p.name || (playerWord || 'Player') + ' ' + p.id.slice(1); }

    // make sure the active profile exists
    if (!find(Store.profile())) Store.setProfile(list()[0].id);

    return { MAX: MAX, NAME_MAX: NAME_MAX, list: list, current: current, create: create, rename: rename, remove: remove, use: use, name: name };
})();
