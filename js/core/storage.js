/* Namespaced, exception-safe localStorage (quota errors and disabled storage never crash the app). */
var Store = (function () {
    'use strict';
    var PREFIX = 'arc_';
    var profile = 'p1';   // single local profile for now; keys are already per-profile

    function key(k) { return PREFIX + profile + '_' + k; }

    function get(k, def) {
        try {
            var v = localStorage.getItem(key(k));
            return v === null ? def : JSON.parse(v);
        } catch (e) { return def; }
    }
    function set(k, v) {
        try { localStorage.setItem(key(k), JSON.stringify(v)); return true; } catch (e) { return false; }
    }
    function remove(k) { try { localStorage.removeItem(key(k)); } catch (e) {} }

    // Removes every key that starts with the given (unprefixed) prefix, e.g. 'game_' for all progress.
    function clearPrefix(p) {
        try {
            var full = key(p), drop = [], i;
            for (i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (k && k.indexOf(full) === 0) drop.push(k);
            }
            for (i = 0; i < drop.length; i++) localStorage.removeItem(drop[i]);
        } catch (e) {}
    }

    return { get: get, set: set, remove: remove, clearPrefix: clearPrefix };
})();
