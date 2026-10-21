/* Namespaced, exception-safe localStorage (quota errors and disabled storage never crash the app).
 *
 * Keys are per profile (arc_<profile>_<key>): settings (language, clock, background, volumes,
 * graphics), game saves, last game... Like user accounts on a PC.
 * Only hardware facts are TV-wide (arc_dev_<key>): benchmark, update check, last seen build, and
 * the top-10 record tables (js/core/scores.js). A setting a profile has not changed yet starts from
 * the value this TV had before profiles had their own settings. The profile list is arc_profiles,
 * the active one arc_profile. */
var Store = (function () {
    'use strict';
    var PREFIX = 'arc_';
    var DEVICE = { perf_bench_v1: 1, update_checked: 1, seen_build: 1 };
    var LEGACY = { lang: 1, vol_music: 1, vol_sfx: 1, gfx: 1, wallpaper: 1, clock24: 1, br_native: 1 };   // were TV-wide before

    var hooks = [];
    function raw(k) { try { var v = localStorage.getItem(k); return v === null ? undefined : JSON.parse(v); } catch (e) { return undefined; } }
    function rawSet(k, v) {
        try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return false; }
        for (var i = 0; i < hooks.length; i++) { try { hooks[i](k); } catch (e2) {} }
        return true;
    }

    // a TV that never ran My PC (or was reset): nothing of ours in storage yet (js/core/backup.js may restore it)
    var fresh = true;
    try { for (var n = 0; n < localStorage.length; n++) if (String(localStorage.key(n)).indexOf(PREFIX) === 0) { fresh = false; break; } } catch (e) {}

    var profile = raw(PREFIX + 'profile');
    if (typeof profile !== 'string' || !/^p\d+$/.test(profile)) profile = 'p1';

    // Settings used to live in profile p1: move them to the shared space once (they are the starting
    // values of every profile until it changes them).
    (function migrate() {
        if (raw(PREFIX + 'dev_settings_v2')) return;
        for (var k in LEGACY) {
            var old = raw(PREFIX + 'p1_' + k);
            if (old !== undefined && raw(PREFIX + 'dev_' + k) === undefined) rawSet(PREFIX + 'dev_' + k, old);
        }
        rawSet(PREFIX + 'dev_settings_v2', 1);
    })();

    function key(k) { return PREFIX + (DEVICE[k] ? 'dev' : profile) + '_' + k; }

    function get(k, def) {
        var v = raw(key(k));
        if (v === undefined && LEGACY[k]) v = raw(PREFIX + 'dev_' + k);
        return v === undefined ? def : v;
    }
    function set(k, v) { return rawSet(key(k), v); }
    function remove(k) { try { localStorage.removeItem(key(k)); } catch (e) {} for (var i = 0; i < hooks.length; i++) { try { hooks[i](key(k)); } catch (e2) {} } }

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
        rawGet: raw, rawSet: rawSet,
        fresh: function () { return fresh; },
        onWrite: function (fn) { hooks.push(fn); }       // fn(fullKey) after every write (cloud backup)
    };
})();

/* Player profiles on this TV: each one has its own saves, scores and last played game. */
var Profiles = (function () {
    'use strict';
    var KEY = 'arc_profiles', MAX = 8, NAME_MAX = 16;
    var COLORS = ['#ffd23f', '#4cd97b', '#4fb9e8', '#ff5d73', '#c158e0', '#ff9f43', '#36d6c3', '#f2f4ff'];

    function list() {
        var l = Store.rawGet(KEY);
        if (!l || !l.length) {
            l = [{ id: 'p1', name: '', color: COLORS[0], role: 'admin' }];   // '' = "Player 1" in the current language
            Store.rawSet(KEY, l);
        } else if (!hasAdmin(l)) {
            l[0].role = 'admin';                // older lists (before roles): the first profile is the admin
            Store.rawSet(KEY, l);
        }
        return l;
    }
    function hasAdmin(l) { for (var i = 0; i < l.length; i++) if (l[i].role === 'admin') return true; return false; }
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
        // a user, unless no real admin exists yet (a new TV or phone: only the blank first profile)
        var p = { id: 'p' + n, name: cleanName(name), color: color, role: realAdmin(l) ? 'user' : 'admin' };
        l.push(p);
        Store.rawSet(KEY, l);
        return p;
    }
    function rename(id, name) {
        var l = list();
        for (var i = 0; i < l.length; i++) if (l[i].id === id) l[i].name = cleanName(name);
        Store.rawSet(KEY, l);
    }
    // Profile picture: { av: 'cat' } (a drawn avatar), { photo: 'data:image/jpeg;...' | 'https://...' } or null (the initial letter)
    function setPicture(id, pic) {
        var l = list();
        for (var i = 0; i < l.length; i++) if (l[i].id === id) {
            delete l[i].av; delete l[i].photo;
            if (pic && pic.av) l[i].av = String(pic.av).slice(0, 20);
            else if (pic && pic.photo) l[i].photo = String(pic.photo).slice(0, 30000);
        }
        Store.rawSet(KEY, l);
    }
    function edit(id, fn) {
        var l = list();
        for (var i = 0; i < l.length; i++) if (l[i].id === id) fn(l[i]);
        Store.rawSet(KEY, l);
    }
    // A My PC account (js/core/accounts.js): the username, and whether signing in asks for the password
    function setAccount(id, user) { edit(id, function (p) { if (user) p.user = String(user).slice(0, 16); else { delete p.user; delete p.ask; } }); }
    function setAsk(id, on) { edit(id, function (p) { if (on && p.user) p.ask = true; else delete p.ask; }); }
    // name, colour and picture from the account's cloud copy
    function setMeta(id, d) {
        edit(id, function (p) {
            if (d.name) p.name = cleanName(d.name);
            if (/^#[0-9a-f]{6}$/i.test(d.color || '')) p.color = d.color;
            delete p.av; delete p.photo;
            if (d.av) p.av = String(d.av).slice(0, 20);
            else if (d.photo) p.photo = String(d.photo).slice(0, 30000);
        });
    }
    // Deletes a profile and all its data. The last profile cannot be deleted.
    function remove(id) {
        var l = list(), out = [];
        if (!canRemove(id)) return false;
        for (var i = 0; i < l.length; i++) if (l[i].id !== id) out.push(l[i]);
        Store.rawSet(KEY, out);
        Store.dropProfile(id);
        if (Store.profile() === id) Store.setProfile(out[0].id);
        return true;
    }
    function use(id) { if (find(id)) Store.setProfile(id); }

    // Roles (owner decision): an admin installs and uninstalls apps, adds and removes users, changes roles and the
    // TV-wide settings; a user only uses the apps and changes their own things (theme, background, home screen...).
    // There is always at least one admin. The role is kept on this TV (arc_profiles, in the TV backup), not in the account.
    function realAdmin(l) { for (var i = 0; i < l.length; i++) if (l[i].role === 'admin' && (l[i].user || l[i].name)) return true; return false; }
    function admins() { var l = list(), n = 0; for (var i = 0; i < l.length; i++) if (l[i].role === 'admin') n++; return n; }
    function isAdmin(id) { var p = id ? find(id) : current(); return !!(p && p.role === 'admin'); }
    function setRole(id, role) {
        var p = find(id);
        if (!p || (role !== 'admin' && role !== 'user')) return false;
        if (role === 'user' && p.role === 'admin' && admins() < 2) return false;      // never the last admin
        edit(id, function (x) { x.role = role; });
        return true;
    }
    function canRemove(id) { var p = find(id); return !!p && list().length > 1 && !(p.role === 'admin' && admins() < 2); }
    // Display name: an unnamed profile is "Player <n>"
    function name(p, playerWord) { p = p || current(); return p.name || (playerWord || 'Player') + ' ' + p.id.slice(1); }

    // make sure the active profile exists
    if (!find(Store.profile())) Store.setProfile(list()[0].id);

    return { MAX: MAX, NAME_MAX: NAME_MAX, list: list, find: find, current: current, create: create, rename: rename, setPicture: setPicture,
        setAccount: setAccount, setAsk: setAsk, setMeta: setMeta, remove: remove, use: use, name: name,
        isAdmin: isAdmin, setRole: setRole, admins: admins, canRemove: canRemove };
})();
