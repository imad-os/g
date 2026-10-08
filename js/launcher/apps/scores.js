/* Leaderboards app: a Hall of Fame (best players over all games) and the top-10 of every game.
 * Two scopes on top: This TV (every profile of this TV) and World (every My PC, js/core/world.js).
 * Left: the list (Up / Down; the right side follows the focus). Right: podium for 1-3, bars for 4-10.
 * Hall of Fame points: 10 for a #1, 9 for #2 ... 1 for #10 in each game, added up per player. */
(function () {
    'use strict';

    var MEDAL = ['gold', 'silver', 'bronze'];
    var CROWN = '<svg viewBox="0 0 48 40" width="100%" height="100%"><path d="M4 32L8 10l11 11L24 6l5 15 11-11 4 22z" fill="#ffc83d"/><rect x="4" y="33" width="40" height="5" rx="2" fill="#e8a000"/></svg>';

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }
    function t(k) { return I18n.t(k); }

    // best players over every game with points. listOf(gameId) -> entries; the same player is the same
    // profile on this TV, or the same name on the same TV in the world
    function overall(games, listOf, world) {
        var map = {}, order = [], i, k, list, n, r;
        for (i = 0; i < games.length; i++) {
            if (games[i].manifest.scores === false) continue;
            list = listOf(games[i].id);
            for (k = 0; k < list.length; k++) {
                n = world ? 'w:' + list[k].tv + ':' + list[k].n : list[k].p ? 'p:' + list[k].p : 'n:' + list[k].n;
                r = map[n] || (map[n] = { n: list[k].n, s: 0, w: 0, g: 0, seen: {} });
                if (!r.seen[games[i].id]) { r.seen[games[i].id] = 1; r.g++; }
                r.s += 10 - k;
                if (k === 0) r.w++;
                if (order.indexOf(r) < 0) order.push(r);
            }
        }
        order.sort(function (a, b) { return b.s - a.s || b.w - a.w || (a.n < b.n ? -1 : 1); });
        return order.slice(0, 10);
    }

    function podium(rows, unit) {
        var box = el('div', 'lb-podium'), order = [1, 0, 2], i, c, r, col, k;     // 2nd, 1st, 3rd
        for (i = 0; i < order.length; i++) {
            k = order[i]; r = rows[k];
            col = el('div', 'lb-pod lb-' + MEDAL[k] + (r ? '' : ' lb-none'));
            if (k === 0 && r) { c = el('div', 'lb-crown'); c.innerHTML = CROWN; col.appendChild(c); }
            col.appendChild(el('div', 'lb-pod-name', r ? r.n : '-'));
            col.appendChild(el('div', 'lb-pod-score', r ? String(r.s) : ''));
            col.appendChild(el('div', 'lb-block', String(k + 1)));
            box.appendChild(col);
        }
        return box;
    }

    function bars(rows, top, meta) {
        var box = el('div', 'lb-rows'), i, row, bar, fill;
        for (i = 3; i < 10; i++) {
            row = el('div', 'lb-row' + (rows[i] ? '' : ' lb-none'));
            row.appendChild(el('span', 'lb-r', String(i + 1)));
            row.appendChild(el('span', 'lb-n', rows[i] ? rows[i].n : '-'));
            bar = el('span', 'lb-bar'); fill = el('span', 'lb-fill');
            fill.style.width = rows[i] ? Math.max(4, Math.round(rows[i].s * 100 / top)) + '%' : '0';
            bar.appendChild(fill); row.appendChild(bar);
            row.appendChild(el('span', 'lb-s', rows[i] ? String(rows[i].s) : ''));
            if (meta && rows[i]) row.appendChild(el('span', 'lb-meta', rows[i].w + ' ★ · ' + rows[i].g));
            box.appendChild(row);
        }
        return box;
    }

    Win.register('scores', {
        icon: 'scores',
        title: function () { return t('leaderboards'); },
        open: function (body) {
            var games = Desktop.games(), side = el('div', 'lb-side'), pane = el('div', 'lb-pane'), list = el('div', 'lb-list');
            var tabs = [], scope = 'tv', worldData = World.cached(), worldErr = false, loading = false, alive = true;
            var scopeBar = el('div', 'lb-scope'), scopeBtns = {};
            list.setAttribute('role', 'list');
            side.appendChild(scopeBar); side.appendChild(list);
            body.appendChild(side); body.appendChild(pane);
            var ids = [];
            for (var g = 0; g < games.length; g++) if (games[g].manifest.scores !== false) ids.push(games[g].id);

            function listOf(id) {
                if (scope === 'tv') return Scores.list(id);
                return (worldData[id] || []).slice(0, 10);
            }

            function show(tab) {
                pane.innerHTML = '';
                for (var j = 0; j < tabs.length; j++) tabs[j].el.className = 'lb-tab' + (tabs[j] === tab ? ' on' : '') + (tabs[j].hall ? ' lb-hall' : '');
                var head = el('div', 'lb-head');
                head.appendChild(el('h2', '', tab.title));
                head.appendChild(el('span', 'lb-sub', tab.sub));
                pane.appendChild(head);
                if (scope === 'world' && (loading || worldErr)) pane.appendChild(el('p', 'lb-note', t(loading ? 'worldLoading' : 'worldOffline')));
                if (!tab.rows.length) { pane.appendChild(el('div', 'lb-empty', t(scope === 'world' ? 'worldEmpty' : 'noScores'))); return; }
                var top = tab.rows[0].s || 1;
                pane.appendChild(podium(tab.rows));
                pane.appendChild(bars(tab.rows, top, tab.hall));
            }

            function add(title, sub, rows, isHall) {
                var b = el('div', 'lb-tab'), spoken = [title], k, tab = { el: b, title: title, sub: sub, rows: rows, hall: isHall };
                b.setAttribute('data-focus', ''); b.setAttribute('tabindex', '0'); b.setAttribute('role', 'listitem');
                var ic = el('span', 'lb-ic'); if (isHall) ic.innerHTML = CROWN; else ic.textContent = title.charAt(0);
                b.appendChild(ic);
                b.appendChild(el('span', 'lb-t', title));
                b.appendChild(el('span', 'lb-top', rows.length ? String(rows[0].s) : ''));
                if (!rows.length) spoken.push(t(scope === 'world' ? 'worldEmpty' : 'noScores'));
                for (k = 0; k < rows.length; k++) spoken.push((k + 1) + ': ' + rows[k].n + ', ' + rows[k].s + ' ' + t('points'));
                b.setAttribute('aria-label', (scope === 'world' ? t('world') + '. ' : '') + spoken.join('. '));
                b.addEventListener('focus', function () { show(tab); });
                b.addEventListener('mouseenter', function () { show(tab); });
                tabs.push(tab); list.appendChild(b);
            }

            // keeps the tab (by position) that had the focus
            function build(keepIdx) {
                tabs = [];
                list.innerHTML = '';
                add(t('hallOfFame'), t(scope === 'world' ? 'world' : 'hallSub'), overall(games, listOf, scope === 'world'), true);
                for (var i = 0; i < games.length; i++) {
                    if (games[i].manifest.scores === false) continue;       // e.g. Parchís: a winner, no points
                    add(I18n.pick(games[i].manifest.title), t(scope === 'world' ? 'world' : 'scores'), listOf(games[i].id).map(function (e) { return { n: e.n, s: e.s, w: 0, g: 0 }; }), false);
                }
                var at = keepIdx >= 0 && tabs[keepIdx] ? tabs[keepIdx] : tabs[0];
                show(at);
                return at.el;
            }

            function setScope(sc) {
                scope = sc;
                for (var k in scopeBtns) scopeBtns[k].className = 'lb-scope-btn' + (k === sc ? ' on' : '');
                if (sc === 'world') {
                    loading = true; worldErr = false;
                    World.fetch(ids, function (err, data) {
                        if (!alive) return;
                        loading = false; worldErr = !!err; worldData = data || {};
                        if (scope !== 'world') return;
                        var cur = Focus.current(), idx = -1;
                        for (var j = 0; j < tabs.length; j++) if (tabs[j].el === cur) idx = j;
                        var f = build(idx >= 0 ? idx : 0);
                        if (idx >= 0) Focus.focus(f);
                    });
                }
                build(0);
                A11y.announce(t(sc === 'world' ? 'world' : 'thisTv'));
            }

            [['tv', 'thisTv', 'tv'], ['world', 'world', 'globe']].forEach(function (d) {
                var b = el('button', 'lb-scope-btn' + (d[0] === scope ? ' on' : ''));
                b.setAttribute('data-focus', '');
                b.setAttribute('data-scope', d[0]);
                var ic = el('span', 'lb-scope-ic'); Icons.put(ic, d[2]);
                b.appendChild(ic); b.appendChild(el('span', '', t(d[1])));
                b.onclick = function () { if (scope !== d[0]) setScope(d[0]); };
                scopeBtns[d[0]] = b;
                scopeBar.appendChild(b);
            });
            this._stop = function () { alive = false; };
            return build(0);
        },
        close: function () { if (this._stop) this._stop(); }
    });
})();
