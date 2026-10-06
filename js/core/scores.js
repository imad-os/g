/* Top-10 score tables, one per game, saved on this TV (key prefix game_ so "Reset progress" clears them). */
var Scores = (function () {
    'use strict';
    var MAX = 10;

    function key(id) { return 'game_' + id + '_top10'; }
    function list(id) { var l = Store.get(key(id), []); return l && l.length !== undefined ? l : []; }
    function qualifies(id, score) {
        if (!(score > 0)) return false;
        var l = list(id);
        return l.length < MAX || score > l[l.length - 1].s;
    }
    // Inserts and returns the 1-based rank (0 if it did not make the table).
    function add(id, name, score) {
        if (!qualifies(id, score)) return 0;
        var l = list(id), i = 0;
        while (i < l.length && l[i].s >= score) i++;
        l.splice(i, 0, { n: name, s: score, d: Date.now() });
        if (l.length > MAX) l.length = MAX;
        Store.set(key(id), l);
        return i + 1;
    }
    function lastName(slot) { return Store.get('last_initials_' + (slot || 1), slot === 2 ? 'PL2' : 'AAA'); }
    function setLastName(slot, n) { Store.set('last_initials_' + (slot || 1), n); }

    return { MAX: MAX, list: list, qualifies: qualifies, add: add, lastName: lastName, setLastName: setLastName };
})();
