/* Save data of games, in the active profile: arc_<profile>_game_<gameId>_<key>.
 * Every game has a quota so one game cannot fill the TV storage. Shared by games running
 * inside game.html and by remote games (through the SDK `save` message). */
var GameData = (function () {
    'use strict';
    var QUOTA = 64 * 1024;           // characters of keys + JSON values per game and profile

    function prefix(id) { return 'game_' + id + '_'; }

    function get(id, key, def) { return Store.get(prefix(id) + key, def); }

    // Returns false when the quota would be exceeded (the old value is kept) or storage failed.
    function set(id, key, value) {
        var full = prefix(id) + key, old = Store.get(full, undefined), size, oldSize = 0;
        try { size = JSON.stringify(value).length + full.length; } catch (e) { return false; }
        if (old !== undefined) oldSize = JSON.stringify(old).length + full.length;
        if (Store.usage(prefix(id)) - oldSize + size > QUOTA) return false;
        return Store.set(full, value);
    }

    // Every key of one game (profile prefix and game prefix removed): sent to remote games at init
    // so their load() can stay synchronous.
    function all(id) {
        var out = {}, pre = 'arc_' + Store.profile() + '_' + prefix(id);
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (k && k.indexOf(pre) === 0) { var v = localStorage.getItem(k); out[k.slice(pre.length)] = JSON.parse(v); }
            }
        } catch (e) {}
        return out;
    }

    function reset(id) { Store.clearPrefix(prefix(id)); }

    return { QUOTA: QUOTA, get: get, set: set, all: all, reset: reset };
})();
