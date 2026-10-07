/* Leaderboards app: the top-10 table of every game for the active profile. */
(function () {
    'use strict';

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }

    Win.register('scores', {
        icon: 'scores',
        title: function () { return I18n.t('leaderboards'); },
        open: function (body) {
            var box = el('div', 'scores-grid'), games = Desktop.games(), first = null;
            box.id = 'scores-grid';
            box.setAttribute('role', 'list');
            for (var i = 0; i < games.length; i++) {
                var g = games[i];
                if (g.manifest.scores === false) continue;       // e.g. Parchís: a winner, no points
                var title = I18n.pick(g.manifest.title), list = Scores.list(g.id);
                // a focusable div (a <button> would centre the list vertically)
                var col = el('div', 'score-col');
                col.setAttribute('data-focus', '');
                col.setAttribute('tabindex', '0');
                col.setAttribute('role', 'listitem');
                col.appendChild(el('h3', '', title));
                var spoken = [title + ', ' + I18n.t('scores')];
                if (!list.length) { col.appendChild(el('div', 'score-empty', I18n.t('noScores'))); spoken.push(I18n.t('noScores')); }
                for (var k = 0; k < list.length; k++) {
                    var row = el('div', 'score-row');
                    row.appendChild(el('span', 'r', (k + 1) + '.'));
                    row.appendChild(el('span', 'n', list[k].n));
                    row.appendChild(el('span', 's', String(list[k].s)));
                    col.appendChild(row);
                    spoken.push((k + 1) + ': ' + list[k].n + ', ' + list[k].s + ' ' + I18n.t('points'));
                }
                col.setAttribute('aria-label', spoken.join('. '));
                box.appendChild(col);
                if (!first) first = col;
            }
            body.appendChild(box);
            return first;
        }
    });
})();
