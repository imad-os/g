/* Playtime app: basic play time stats of the current profile (data: js/core/playtime.js, the same as the Playtime widget).
 * Light on purpose: drawn once when it opens (and again for 7 / 30 days or after Clear), no timer, no canvas, bars are plain
 * CSS heights. Follows the theme through --acc (css/playtime.css). Remote: arrows between the cards, the range buttons,
 * the chart and the games; OK on a game plays it. Every card is focusable so Voice Guide reads it. */
(function () {
    'use strict';

    var root = null, range = 7, parts = {}, rangeBtns = {};

    function t(k) { return I18n.t(k); }
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
    function len(s) { return Playtime.length(s, t('wgH'), t('wgMin')); }
    // short text under a bar: 1h05 / 25m (empty for nothing)
    function shortLen(s) {
        s = Math.round(s || 0);
        if (s < 60) return '';
        var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
        return h ? h + t('wgH') + ('0' + m).slice(-2) : m + t('ptM');
    }
    function nText(key, n) { return t(key).replace('%n', n); }
    function date(d, opts) { return Desktop.dateText(d, opts); }
    function fromKey(k) { var p = k.split('-'); return new Date(+p[0], p[1] - 1, +p[2]); }
    function when(at) {
        if (!at) return '';
        var d = new Date(at), k = Playtime.day(d), y = new Date();
        if (k === Playtime.day(y)) return t('ptToday');
        y.setDate(y.getDate() - 1);
        if (k === Playtime.day(y)) return t('ptYesterday');
        return date(d, { day: 'numeric', month: 'short' });
    }
    function gameOf(id) { var l = Desktop.games(); for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }

    function card(cls, label, big, sub) {
        var c = el('button', 'pt-card ' + cls);
        c.setAttribute('data-focus', '');
        c.appendChild(el('span', 'pt-card-label', label));
        c.appendChild(el('span', 'pt-card-big', big));
        c.appendChild(el('span', 'pt-card-sub', sub || ''));
        c.setAttribute('aria-label', label + ': ' + big + (sub ? '. ' + sub : ''));
        return c;
    }

    function drawCards(st) {
        var box = parts.cards, diff = st.week - st.prevWeek, cmp;
        box.innerHTML = '';
        if (Math.abs(diff) < 60) cmp = st.week || st.prevWeek ? t('ptSame') : '';
        else cmp = t(diff > 0 ? 'ptMore' : 'ptLess').replace('%s', len(Math.abs(diff)));
        box.appendChild(card('pt-c-today', t('ptToday'), len(st.today), st.today ? '' : t('ptNoneToday')));
        var w = card('pt-c-week' + (diff >= 60 ? ' up' : diff <= -60 ? ' down' : ''), t('wgWeek'), len(st.week), cmp);
        box.appendChild(w);
        box.appendChild(card('pt-c-avg', t('ptAvg'), len(st.total / range),
            t('ptPlayedDays').replace('%a', st.played).replace('%b', range)));
        box.appendChild(card('pt-c-streak', t('ptStreak'), st.streak === 1 ? t('ptDay1') : nText('ptDays', st.streak),
            st.best ? t('ptBestDay').replace('%s', date(fromKey(st.best.day), { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + len(st.best.s)) : ''));
    }

    function drawChart(st) {
        var chart = parts.chart, top = Math.max(st.max, 1800), i, d, col, bar, said = [];     // the scale is at least 30 min
        chart.innerHTML = '';
        chart.className = 'pt-chart pt-r' + range;
        parts.chartTitle.textContent = t(range === 7 ? 'ptLast7' : 'ptLast30');
        for (i = 0; i < st.days.length; i++) {
            d = st.days[i];
            col = el('span', 'pt-col' + (i === st.days.length - 1 ? ' pt-now' : '') + (d.s ? '' : ' pt-zero'));
            var track = el('span', 'pt-track');                  // the bar's height is a share of the track (the value sits on its top padding)
            if (range === 7) track.appendChild(el('span', 'pt-val', shortLen(d.s)));
            bar = el('span', 'pt-bar');
            bar.style.height = (d.s ? Math.max(2, Math.round(d.s * 100 / top)) : 0) + '%';
            track.appendChild(bar);
            col.appendChild(track);
            var lab = range === 7 ? date(d.date, { weekday: 'short' }) : ((st.days.length - 1 - i) % 5 === 0 ? String(d.date.getDate()) : '');
            col.appendChild(el('span', 'pt-day', lab));
            chart.appendChild(col);
            if (range === 7 || d.s) said.push(date(d.date, { weekday: 'long', day: 'numeric' }) + ' ' + len(d.s));
        }
        chart.setAttribute('aria-label', t(range === 7 ? 'ptLast7' : 'ptLast30') + ': ' + (said.length ? said.join(', ') : t('ptNothing')));
    }

    function gameRow(g, top) {
        var game = gameOf(g.id), b = el('button', 'pt-game' + (game ? '' : ' pt-gone'));
        b.setAttribute('data-focus', '');
        var ic = el('span', 'pt-gic'), src = game ? Desktop.coverUrl(game) : '';
        if (src) { var im = document.createElement('img'); im.alt = ''; im.decoding = 'async'; im.src = src; ic.appendChild(im); }
        else ic.textContent = (g.t || '?').charAt(0).toUpperCase();
        b.appendChild(ic);
        var tx = el('span', 'pt-gtx'), name = game ? I18n.pick(game.manifest.title) : g.t;
        tx.appendChild(el('span', 'pt-gname', name));
        var meta = [g.n === 1 ? t('ptSession1') : nText('ptSessions', g.n)];
        if (g.best) meta.push(t('ptLongest').replace('%s', len(g.best)));
        if (g.at) meta.push(t('ptLastOn').replace('%s', when(g.at)));
        if (!game) meta.push(t('ptGone'));
        tx.appendChild(el('span', 'pt-gmeta', meta.join(' · ')));
        var gb = el('span', 'pt-gbar'), fill = el('i');
        fill.style.width = Math.max(2, Math.round(g.s * 100 / top)) + '%';
        gb.appendChild(fill); tx.appendChild(gb);
        b.appendChild(tx);
        b.appendChild(el('span', 'pt-gtime', len(g.s)));
        b.setAttribute('aria-label', name + ': ' + len(g.s) + '. ' + meta.join(', ') + (game ? '. ' + t('ptOkPlay') : ''));
        if (game) b.onclick = function () { Desktop.play(game); };
        return b;
    }

    function drawGames(st) {
        var box = parts.games;
        box.innerHTML = '';
        parts.all.textContent = st.games.length ? t('ptAllTime').replace('%s', len(st.all)) : '';
        if (!st.games.length) {
            var e = el('button', 'pt-empty', t('ptEmpty'));
            e.setAttribute('data-focus', '');
            box.appendChild(e);
            parts.clear.hidden = true;
            return;
        }
        parts.clear.hidden = false;
        for (var i = 0; i < st.games.length; i++) box.appendChild(gameRow(st.games[i], st.games[0].s));
    }

    function draw() {
        if (!root) return;
        var st = Playtime.stats(range);
        drawCards(st); drawChart(st); drawGames(st);
        for (var r in rangeBtns) {
            rangeBtns[r].className = 'pt-range-btn' + (+r === range ? ' on' : '');
            rangeBtns[r].setAttribute('aria-pressed', +r === range ? 'true' : 'false');
        }
    }

    function rangeBtn(n, key) {
        var b = el('button', 'pt-range-btn', t(key));
        b.setAttribute('data-focus', '');
        b.onclick = function () { if (range !== n) { range = n; Store.set('playtime_range', n); draw(); } A11y.announce(parts.chart.getAttribute('aria-label')); };
        rangeBtns[n] = b;
        return b;
    }

    function build(body) {
        root = el('div', 'pt');
        parts.cards = el('div', 'pt-cards');
        root.appendChild(parts.cards);

        var box = el('section', 'pt-panel pt-chart-box'), head = el('div', 'pt-head');
        parts.chartTitle = el('h2', 'pt-h');
        head.appendChild(parts.chartTitle);
        var rb = el('div', 'pt-range');
        rb.appendChild(rangeBtn(7, 'pt7')); rb.appendChild(rangeBtn(30, 'pt30'));
        head.appendChild(rb);
        box.appendChild(head);
        parts.chart = el('button', 'pt-chart');
        parts.chart.setAttribute('data-focus', '');
        box.appendChild(parts.chart);
        root.appendChild(box);

        var gbox = el('section', 'pt-panel'), ghead = el('div', 'pt-head');
        ghead.appendChild(el('h2', 'pt-h', t('ptGames')));
        parts.all = el('span', 'pt-all');
        ghead.appendChild(parts.all);
        gbox.appendChild(ghead);
        parts.games = el('div', 'pt-games');
        parts.games.setAttribute('role', 'list');
        gbox.appendChild(parts.games);
        root.appendChild(gbox);

        var foot = el('div', 'pt-foot');
        foot.appendChild(el('p', 'pt-note', t('ptNote')));
        parts.clear = el('button', 'pt-clear', t('ptClear'));
        parts.clear.setAttribute('data-focus', '');
        parts.clear.onclick = function () {
            App.confirm(t('ptClear'), t('ptClearText'), function () {
                Playtime.clear(); draw();
                App.toast(t('ptCleared'), { kind: 'ok' });
            });
        };
        foot.appendChild(parts.clear);
        root.appendChild(foot);
        body.appendChild(root);
        draw();
    }

    Win.register('playtime', {
        icon: 'hourglass',
        title: function () { return t('playtime'); },
        open: function (body) {
            range = Store.get('playtime_range', 7) === 30 ? 30 : 7;
            build(body);
            return parts.cards.firstChild;
        },
        // language or profile changed while open
        refresh: function () {
            var body = root && root.parentNode;
            if (!body) return;
            body.removeChild(root);
            parts = {}; rangeBtns = {};
            build(body);
            Focus.set(document.getElementById('window'), parts.cards.firstChild);
        },
        close: function () { root = null; parts = {}; rangeBtns = {}; }
    });
})();
