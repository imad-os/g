/* Calendar app: month view, today highlighted, a note list per day (saved per profile). */
(function () {
    'use strict';

    var body, grid, side, title, year, month, sel, MAX_NOTES = 6;

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }
    function t(k) { return I18n.t(k); }
    function two(n) { return (n < 10 ? '0' : '') + n; }
    function key(d) { return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()); }
    function same(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
    // Monday first, except English (Sunday first)
    function firstDow() { return I18n.lang() === 'en' ? 0 : 1; }

    function notes() { return Store.get('cal_notes', {}); }
    function notesFor(d) { return notes()[key(d)] || []; }
    function setNotes(d, list) {
        var all = notes();
        if (list.length) all[key(d)] = list; else delete all[key(d)];
        Store.set('cal_notes', all);
    }

    function fmt(d, o) { return Desktop.dateText(d, o); }

    function header() {
        var bar = el('div', 'cal-head');
        title = el('h3', 'cal-title');
        bar.appendChild(title);
        var prev = el('button', 'icon-btn'), next = el('button', 'icon-btn'), today = el('button', 'pill-btn', t('today'));
        Icons.put(prev, 'back'); Icons.put(next, 'forward');
        prev.setAttribute('aria-label', t('prevMonth')); next.setAttribute('aria-label', t('nextMonth'));
        prev.setAttribute('data-focus', ''); next.setAttribute('data-focus', ''); today.setAttribute('data-focus', '');
        prev.id = 'cal-prev'; next.id = 'cal-next'; today.id = 'cal-today';
        prev.onclick = function () { go(-1); Focus.focus(prev); };
        next.onclick = function () { go(1); Focus.focus(next); };
        today.onclick = function () { var n = new Date(); sel = n; year = n.getFullYear(); month = n.getMonth(); render(); };
        bar.appendChild(today); bar.appendChild(prev); bar.appendChild(next);
        return bar;
    }

    function go(d) {
        month += d;
        if (month < 0) { month = 11; year--; }
        if (month > 11) { month = 0; year++; }
        var last = new Date(year, month + 1, 0).getDate();
        sel = new Date(year, month, Math.min(sel.getDate(), last));
        render(true);
    }

    function render(keepFocus) {
        var first = new Date(year, month, 1), today = new Date(), i, target = null;
        title.textContent = fmt(first, { month: 'long', year: 'numeric' });
        grid.innerHTML = '';
        // weekday names
        var base = new Date(2023, 0, 1 + firstDow());   // 1 Jan 2023 was a Sunday
        for (i = 0; i < 7; i++) grid.appendChild(el('div', 'cal-dow', fmt(new Date(2023, 0, base.getDate() + i), { weekday: 'short' })));
        var off = (first.getDay() - firstDow() + 7) % 7, days = new Date(year, month + 1, 0).getDate(), all = notes();
        for (i = 0; i < off; i++) grid.appendChild(el('div', 'cal-day cal-pad'));
        for (var d = 1; d <= days; d++) {
            var date = new Date(year, month, d), b = el('button', 'cal-day');
            if (same(date, today)) b.className += ' cal-today';
            if (all[key(date)]) b.appendChild(el('span', 'cal-dot'));
            b.insertBefore(document.createTextNode(String(d)), b.firstChild);
            b.setAttribute('data-focus', '');
            b.setAttribute('data-day', d);
            b.setAttribute('aria-label', fmt(date, { weekday: 'long', day: 'numeric', month: 'long' }) + (same(date, today) ? '. ' + t('today') : '') + (all[key(date)] ? '. ' + all[key(date)].length + ' ' + t('notes') : ''));
            b.onclick = (function (dt) { return function () { addNote(dt); }; })(date);
            b.onfocus = (function (dt) { return function () { sel = dt; renderSide(); }; })(date);
            grid.appendChild(b);
            if (same(date, sel)) target = b;
        }
        renderSide();
        if (!keepFocus && target) Focus.focus(target);
        return target;
    }

    function renderSide() {
        side.innerHTML = '';
        side.appendChild(el('div', 'cal-big', String(sel.getDate())));
        side.appendChild(el('div', 'cal-big-sub', fmt(sel, { weekday: 'long' })));
        side.appendChild(el('div', 'cal-big-sub cal-month', fmt(sel, { month: 'long', year: 'numeric' })));
        side.appendChild(el('h4', 'cal-notes-h', t('notes')));
        var list = notesFor(sel);
        if (!list.length) side.appendChild(el('p', 'cal-empty', t('noNotes')));
        for (var i = 0; i < list.length; i++) {
            var n = el('button', 'cal-note');
            n.setAttribute('data-focus', '');
            n.appendChild(el('span', '', list[i]));
            var tr = el('span', 'cal-del'); Icons.put(tr, 'trash'); n.appendChild(tr);
            n.setAttribute('aria-label', list[i] + '. ' + t('deleteNoteHint'));
            n.onclick = (function (idx) { return function () { delNote(idx); }; })(i);
            side.appendChild(n);
        }
        if (list.length < MAX_NOTES) {
            var add = el('button', 'pill-btn cal-add');
            add.setAttribute('data-focus', '');
            var ic = el('span', 'pill-ic'); Icons.put(ic, 'plus');
            add.appendChild(ic); add.appendChild(document.createTextNode(t('addNote')));
            add.onclick = function () { addNote(sel); };
            side.appendChild(add);
        }
    }

    function dayBtn(d) { return grid.querySelector('[data-day="' + d.getDate() + '"]'); }

    function addNote(d) {
        sel = d;
        if (notesFor(d).length >= MAX_NOTES) return;
        Keyboard.open({ title: t('addNote') + ' – ' + fmt(d, { day: 'numeric', month: 'long' }), max: 32, mode: 'text' }, function (txt) {
            var l = notesFor(d); l.push(txt); setNotes(d, l);
            render(true);
            Focus.focus(dayBtn(d));
        });
    }

    function delNote(idx) {
        var d = sel;
        App.confirm(t('deleteNote'), notesFor(d)[idx], function () {
            var l = notesFor(d); l.splice(idx, 1); setNotes(d, l);
            render(true);
            Focus.focus(dayBtn(d));
        });
    }

    Win.register('calendar', {
        icon: 'calendar',
        title: function () { return t('calendar'); },
        open: function (b) {
            body = b;
            var now = new Date();
            year = now.getFullYear(); month = now.getMonth(); sel = now;
            var left = el('div', 'cal-main');
            left.appendChild(header());
            grid = el('div', 'cal-grid');
            left.appendChild(grid);
            side = el('aside', 'cal-side');
            body.appendChild(left); body.appendChild(side);
            return render(true);
        },
        close: function () { body = grid = side = title = null; }
    });
})();
