/* Top-10 record tables, one per game, shared by every profile on this TV (arc_dev_top_<game>).
 * A record is saved under the name of the profile that played it (no typing), so the Leaderboards
 * app shows everybody's results. Entries: { n: name at the time, s: score, d: date, p: profile id }. */
var Scores = (function () {
    'use strict';
    var MAX = 10, MIGRATED = 'arc_dev_scores_v2';

    function key(id) { return 'arc_dev_top_' + id; }
    function stored(id) { var l = Store.rawGet(key(id)); return l && l.length !== undefined ? l : []; }
    function playerWord() { return typeof I18n !== 'undefined' ? I18n.t('player') : 'Player'; }
    function profileName(pid, fallback) {
        var l = Profiles.list();
        for (var i = 0; i < l.length; i++) if (l[i].id === pid) return Profiles.name(l[i], playerWord());
        return fallback;
    }

    // Records used to be per profile (arc_<profile>_game_<id>_top10): merge them once.
    (function migrate() {
        if (Store.rawGet(MIGRATED)) return;
        try {
            var found = {}, i, m;
            for (i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                m = k && /^arc_(p\d+)_game_(.+)_top10$/.exec(k);
                if (m) (found[m[2]] = found[m[2]] || []).push({ pid: m[1], list: Store.rawGet(k) });
            }
            for (var id in found) {
                var all = stored(id);
                for (i = 0; i < found[id].length; i++) {
                    var src = found[id][i].list || [];
                    for (var j = 0; j < src.length; j++) all.push({ n: profileName(found[id][i].pid, src[j].n), s: src[j].s, d: src[j].d || 0, p: found[id][i].pid });
                }
                all.sort(function (a, b) { return b.s - a.s; });
                if (all.length > MAX) all.length = MAX;
                Store.rawSet(key(id), all);
            }
        } catch (e) {}
        Store.rawSet(MIGRATED, 1);
    })();

    // sorted, best first; the name follows a renamed profile
    function list(id) {
        var l = stored(id), out = [];
        for (var i = 0; i < l.length; i++) out.push({ n: l[i].p ? profileName(l[i].p, l[i].n) : l[i].n, s: l[i].s, d: l[i].d, p: l[i].p || '' });
        return out;
    }
    function qualifies(id, score) {
        if (!(score > 0)) return false;
        var l = stored(id);
        return l.length < MAX || score > l[l.length - 1].s;
    }
    // Inserts and returns the 1-based rank (0 if it did not make the table). pid: the profile, or '' for a guest.
    function add(id, name, score, pid) {
        if (!qualifies(id, score)) return 0;
        var l = stored(id), i = 0;
        while (i < l.length && l[i].s >= score) i++;
        l.splice(i, 0, { n: name, s: score, d: Date.now(), p: pid || '' });
        if (l.length > MAX) l.length = MAX;
        Store.rawSet(key(id), l);
        return i + 1;
    }

    return { MAX: MAX, list: list, qualifies: qualifies, add: add };
})();
