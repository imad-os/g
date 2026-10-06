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

    var GUEST = 'guest';
    var profile = raw(PREFIX + 'profile');
    if (typeof profile !== 'string' || !(profile === GUEST || /^p\d+$/.test(profile))) profile = 'p1';

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

    // Runs fn with another profile active (used to credit a score to player 2's profile).
    function withProfile(id, fn) {
        var prev = profile;
        profile = id;
        try { return fn(); } finally { profile = prev; }
    }

    // Removes the data of one game from every profile (the game was deleted from the registry).
    function dropGame(gameId) {
        try {
            var drop = [], i, re = new RegExp('^' + PREFIX + '(p\\d+|' + GUEST + ')_game_' + gameId.replace(/[^a-z0-9-]/g, '') + '_');
            for (i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (k && re.test(k)) drop.push(k);
            }
            for (i = 0; i < drop.length; i++) localStorage.removeItem(drop[i]);
        } catch (e) {}
    }

    // Bytes (UTF-16 units) used by the keys of the active profile that start with a prefix.
    function usage(p) {
        var full = key(p), n = 0;
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (k && k.indexOf(full) === 0) n += k.length + (localStorage.getItem(k) || '').length;
            }
        } catch (e) {}
        return n;
    }

    return {
        GUEST: GUEST,
        get: get, set: set, remove: remove, clearPrefix: clearPrefix, usage: usage,
        profile: function () { return profile; },
        setProfile: function (id) { profile = id; rawSet(PREFIX + 'profile', id); },
        withProfile: withProfile, dropGame: dropGame,
        dropProfile: function (id) { dropPrefix(PREFIX + id + '_'); },
        rawGet: raw, rawSet: rawSet
    };
})();

/* Player profiles on this TV: each one has its own saves, scores and last played game.
 * A profile is { id: 'p<n>', name, color, avatar } (colour and avatar come from fixed sets).
 * "Guest" (id 'guest') is built in: it is not in the list, cannot be deleted and has no name,
 * so a guest enters arcade initials for a top-10 score.
 * arc_default_profile: the profile chosen with the "Default" checkbox. While it is set, the
 * profile picker is skipped when a game starts. */
var Profiles = (function () {
    'use strict';
    var KEY = 'arc_profiles', DEFAULT_KEY = 'arc_default_profile', MAX = 8, NAME_MAX = 12;
    var COLORS = ['#ffd23f', '#4cd97b', '#4fb9e8', '#ff5d73', '#c158e0', '#ff9f43', '#36d6c3', '#f2f4ff'];
    var AVATARS = 8;                 // glyph ids 0..7 (drawn by the UI)
    var GUEST = { id: Store.GUEST, name: '', color: '#8088cc', avatar: 3, guest: true };

    function list() {
        var l = Store.rawGet(KEY);
        if (!l) {                     // very first start: one profile, so existing saves keep working
            l = [{ id: 'p1', name: '', color: COLORS[0], avatar: 0 }];
            Store.rawSet(KEY, l);
        }
        return l;
    }
    function find(id) {
        if (id === GUEST.id) return GUEST;
        var l = list();
        for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
        return null;
    }
    function current() { return find(Store.profile()) || list()[0] || GUEST; }
    function cleanName(n) { return String(n || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '').slice(0, NAME_MAX); }
    function pickIn(v, max, def) { v = parseInt(v, 10); return v >= 0 && v < max ? v : def; }

    function create(name, color, avatar) {
        var l = list();
        if (l.length >= MAX) return null;
        var n = 1;
        while (find('p' + n)) n++;
        var used = {}, i;
        for (i = 0; i < l.length; i++) used[l[i].color] = 1;
        var ci = color === undefined ? -1 : COLORS.indexOf(color);
        if (ci < 0) { ci = 0; for (i = 0; i < COLORS.length; i++) if (!used[COLORS[i]]) { ci = i; break; } }
        var p = { id: 'p' + n, name: cleanName(name), color: COLORS[ci], avatar: pickIn(avatar, AVATARS, l.length % AVATARS) };
        l.push(p);
        Store.rawSet(KEY, l);
        return p;
    }
    function rename(id, name) {
        var l = list();
        for (var i = 0; i < l.length; i++) if (l[i].id === id) l[i].name = cleanName(name);
        Store.rawSet(KEY, l);
    }
    // Deletes a profile and all its data (also its default flag). Returns false for an unknown id.
    function remove(id) {
        var l = list(), out = [];
        for (var i = 0; i < l.length; i++) if (l[i].id !== id) out.push(l[i]);
        if (out.length === l.length) return false;
        Store.rawSet(KEY, out);
        Store.dropProfile(id);
        if (Store.rawGet(DEFAULT_KEY) === id) clearDefault();
        if (Store.profile() === id) Store.setProfile(out.length ? out[0].id : GUEST.id);
        return true;
    }
    function use(id) { if (find(id)) Store.setProfile(id); }
    // Display name: an unnamed profile is "Player <n>", the guest is "Guest"
    function name(p, playerWord, guestWord) {
        p = p || current();
        if (p.guest) return guestWord || 'Guest';
        return p.name || (playerWord || 'Player') + ' ' + p.id.slice(1);
    }

    function defaultId() {
        var d = Store.rawGet(DEFAULT_KEY);
        return typeof d === 'string' && find(d) ? d : null;
    }
    function setDefault(id) { if (find(id)) Store.rawSet(DEFAULT_KEY, id); }
    function clearDefault() { try { localStorage.removeItem(DEFAULT_KEY); } catch (e) {} }

    // make sure the active profile exists
    if (!find(Store.profile())) Store.setProfile(list()[0] ? list()[0].id : GUEST.id);

    return {
        MAX: MAX, NAME_MAX: NAME_MAX, COLORS: COLORS, AVATARS: AVATARS, GUEST: GUEST,
        list: list, find: find, current: current, create: create, rename: rename, remove: remove, use: use, name: name,
        defaultId: defaultId, setDefault: setDefault, clearDefault: clearDefault
    };
})();
