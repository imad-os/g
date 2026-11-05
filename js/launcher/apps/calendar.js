/* Calendar app: the month with the Moroccan Hijri date of each day, Moroccan holidays, big events and the profile's own events.
 * Data in js/core/events.js (shared with the Calendar widget, the reminders and the dynamic wallpapers).
 * Remote: arrows move between days, OK on a day adds an event on it, Right from the grid reaches the day's events (OK edits one of
 * yours), Channel Up / Down (PageUp / PageDown, L / R) change the month, Back closes the editor, then the app.
 * Light: one month drawn at a time (42 cells), no timer; the holidays are asked only when stale (Events.refresh). */
(function () {
    'use strict';

    var body, grid, side, title, sub, year, month, sel, edit = null, focusKey = null;
    var REMIND = [-1, 0, 15, 60, 1440];

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }
    function t(k) { return I18n.t(k); }
    function key(d) { return Events.ymd(d); }
    function fromKey(k) { return Events.parseYmd(k); }
    function two(n) { return (n < 10 ? '0' : '') + n; }
    function same(a, b) { return key(a) === key(b); }
    // Monday first, except English (Sunday first)
    function firstDow() { return I18n.lang() === 'en' ? 0 : 1; }
    function fmt(d, o) { return Desktop.dateText(d, o); }
    function clock(hhmm) { var p = hhmm.split(':'), d = new Date(2000, 0, 1, +p[0], +p[1]); return Desktop.timeText(d); }
    function button(cls, text, onclick, label) {
        var b = el('button', cls, text);
        b.setAttribute('data-focus', '');
        if (label) b.setAttribute('aria-label', label);
        b.onclick = onclick;
        return b;
    }
    function dayList(k) { return Events.list(k); }
    function kindText(e) { return t({ holiday: 'calHoliday', observance: 'calObservance', event: 'calEvent', mine: 'calMine' }[e.kind] || 'calEvent'); }

    function header() {
        var bar = el('div', 'cal-head'), box = el('div', 'cal-titles');
        title = el('h3', 'cal-title');
        sub = el('div', 'cal-hmonths');
        box.appendChild(title); box.appendChild(sub);
        bar.appendChild(box);
        var prev = button('icon-btn', undefined, function () { go(-1); Focus.focus(prev); }, t('prevMonth'));
        var next = button('icon-btn', undefined, function () { go(1); Focus.focus(next); }, t('nextMonth'));
        var today = button('pill-btn', t('today'), function () { var n = new Date(); sel = n; year = n.getFullYear(); month = n.getMonth(); render(); });
        Icons.put(prev, 'back'); Icons.put(next, 'forward');
        prev.id = 'cal-prev'; next.id = 'cal-next'; today.id = 'cal-today';
        bar.appendChild(today); bar.appendChild(prev); bar.appendChild(next);
        return bar;
    }

    function go(d) {
        month += d;
        if (month < 0) { month = 11; year--; }
        if (month > 11) { month = 0; year++; }
        var last = new Date(year, month + 1, 0).getDate();
        sel = new Date(year, month, Math.min(sel.getDate(), last));
        edit = null;
        render(true);
    }

    // the Hijri months this Gregorian month spans: "Jumada al-Ula – Jumada al-Akhira 1448"
    function hijriMonths(first, last) {
        var a = Events.hijri(first), b = Events.hijri(last), l = I18n.lang();
        if (a.m === b.m) return Events.hijriMonth(a.m, l) + ' ' + a.y;
        return Events.hijriMonth(a.m, l) + (a.y !== b.y ? ' ' + a.y : '') + ' – ' + Events.hijriMonth(b.m, l) + ' ' + b.y;
    }

    function render(keepFocus) {
        var first = new Date(year, month, 1), days = new Date(year, month + 1, 0).getDate(), today = new Date(), i, target = null;
        title.textContent = fmt(first, { month: 'long', year: 'numeric' });
        sub.textContent = hijriMonths(first, new Date(year, month, days));
        grid.innerHTML = '';
        var base = new Date(2023, 0, 1 + firstDow());   // 1 Jan 2023 was a Sunday
        for (i = 0; i < 7; i++) grid.appendChild(el('div', 'cal-dow', fmt(new Date(2023, 0, base.getDate() + i), { weekday: 'short' })));
        var off = (first.getDay() - firstDow() + 7) % 7;
        for (i = 0; i < off; i++) grid.appendChild(el('div', 'cal-day cal-pad'));
        for (var d = 1; d <= days; d++) {
            var date = new Date(year, month, d), k = key(date), list = dayList(k), h = Events.hijri(k), b = el('button', 'cal-day');
            if (same(date, today)) b.className += ' cal-today';
            if (list.some(function (e) { return e.kind === 'holiday'; })) b.className += ' cal-off';
            if (h.m === 9) b.className += ' cal-ramadan';
            var top = el('div', 'cal-dtop');
            top.appendChild(el('span', 'cal-dnum', String(d)));
            top.appendChild(el('span', 'cal-hnum', String(h.d)));
            b.appendChild(top);
            list.slice(0, 2).forEach(function (e) { b.appendChild(el('span', 'cal-chip cal-k-' + e.kind, e.title)); });
            if (list.length > 2) b.appendChild(el('span', 'cal-chip cal-more', t('calMore').replace('%n', list.length - 2)));
            b.setAttribute('data-focus', '');
            b.setAttribute('data-day', d);
            b.setAttribute('aria-label', fmt(date, { weekday: 'long', day: 'numeric', month: 'long' }) + '. ' + Events.hijriText(k) + (same(date, today) ? '. ' + t('today') : '') +
                list.map(function (e) { return '. ' + e.title + ' (' + kindText(e) + ')'; }).join(''));
            b.onclick = (function (dt) { return function () { sel = dt; newEvent(); }; })(date);
            b.onfocus = (function (dt) { return function () { if (key(dt) !== key(sel) || edit) { sel = dt; edit = null; renderSide(); } }; })(date);
            grid.appendChild(b);
            if (same(date, sel)) target = b;
        }
        renderSide();
        if (!keepFocus && target) Focus.focus(target);
        return target;
    }

    /* ---------------- the side: the chosen day, its events ---------------- */

    function renderSide() {
        side.innerHTML = '';
        if (edit) return renderEditor();
        var k = key(sel);
        side.appendChild(el('div', 'cal-big', String(sel.getDate())));
        side.appendChild(el('div', 'cal-big-sub', fmt(sel, { weekday: 'long' })));
        side.appendChild(el('div', 'cal-big-sub', fmt(sel, { month: 'long', year: 'numeric' })));
        side.appendChild(el('div', 'cal-hijri', Events.hijriText(k)));
        side.appendChild(el('h4', 'cal-notes-h', t('calEvents')));
        var list = dayList(k);
        if (!list.length) side.appendChild(el('p', 'cal-empty', t('calNoEvents')));
        var box = el('div', 'cal-evs');
        list.forEach(function (e) {
            var n = button('cal-ev cal-k-' + e.kind, undefined, function () { if (e.kind === 'mine') openEditor(e.src); });
            n.appendChild(el('span', 'cal-ev-t', e.title));
            var meta = kindText(e) + (e.time ? ' · ' + clock(e.time) : '') + (e.est ? ' · ' + t('calExpected') : '') +
                (e.first && e.last && e.first !== e.last ? ' · ' + fmt(fromKey(e.first), { day: 'numeric', month: 'short' }) + ' – ' + fmt(fromKey(e.last), { day: 'numeric', month: 'short' }) : '') +
                (e.teams && e.teams.length ? ' · ' + e.teams.slice(0, 4).join(', ') + (e.teams.length > 4 ? '…' : '') : '');
            n.appendChild(el('span', 'cal-ev-m', meta));
            n.setAttribute('aria-label', e.title + '. ' + meta + (e.kind === 'mine' ? '. ' + t('calOkHint') : ''));
            box.appendChild(n);
        });
        side.appendChild(box);
        var add = button('pill-btn cal-add', undefined, newEvent);
        var ic = el('span', 'pill-ic'); Icons.put(ic, 'plus');
        add.appendChild(ic); add.appendChild(document.createTextNode(t('calAddEvent')));
        add.id = 'cal-add';
        side.appendChild(add);
        // where the holidays come from + the profile's Hijri correction
        var foot = el('div', 'cal-foot'), via = Events.source().holidays;
        foot.appendChild(el('div', 'cal-src', t(/^(site|api|ics)$/.test(via) ? 'calSrcGoogle' : 'calSrcBuilt')));
        var adj = el('div', 'cal-adj'), n0 = Events.hijriAdj();
        adj.appendChild(el('span', 'cal-adj-l', t('calHijriAdj')));
        var minus = button('icon-btn cal-step', '−', function () { setAdj(-1, 'minus'); }, t('calHijriAdj') + ' −1');
        var plus = button('icon-btn cal-step', '+', function () { setAdj(1, 'plus'); }, t('calHijriAdj') + ' +1');
        minus.setAttribute('data-step', 'minus'); plus.setAttribute('data-step', 'plus');
        adj.appendChild(minus); adj.appendChild(el('b', 'cal-adj-v', (n0 > 0 ? '+' : '') + n0)); adj.appendChild(plus);
        foot.appendChild(adj);
        side.appendChild(foot);
        if (focusKey) { var f = side.querySelector(focusKey); focusKey = null; if (f) Focus.focus(f); }
    }
    function setAdj(d, which) {
        Events.setHijriAdj(Events.hijriAdj() + d);
        focusKey = '[data-step="' + which + '"]';
        render(true);
        A11y.announce(Events.hijriText(key(sel)));
    }

    /* ---------------- adding / editing one of the profile's events ---------------- */

    function newEvent() {
        Keyboard.open({ title: t('calNewEvent') + ' – ' + fmt(sel, { day: 'numeric', month: 'long' }), max: 60, mode: 'text' }, function (txt) {
            openEditor({ date: key(sel), time: '', title: txt, remind: -1, yearly: false });
        }, function () { Focus.focus(dayBtn(sel)); });
    }
    function openEditor(e) {
        // e: a new event { date, title... } or a shared entry of kind 'mine' (its uid; a yearly one keeps its first day)
        edit = e.kind === 'mine' ? { id: e.uid, date: e.first || e.d, time: e.time || '', title: e.t, remind: e.remind === undefined ? -1 : e.remind, yearly: !!e.yearly }
                                 : { id: null, date: e.date, time: e.time || '', title: e.title, remind: e.remind === undefined ? -1 : e.remind, yearly: !!e.yearly };
        renderSide();
        Focus.focus(side.querySelector('[data-f="title"]'));
    }
    function row(f, label, value, onclick) {
        var r = button('cal-frow', undefined, onclick);
        r.setAttribute('data-f', f);
        r.appendChild(el('span', 'cal-fl', label));
        r.appendChild(el('b', 'cal-fv', value));
        r.setAttribute('aria-label', label + ': ' + value + '. ' + t('calOkHint'));
        return r;
    }
    function stepRow(f, label, value, onStep) {
        var r = el('div', 'cal-frow cal-fstep');
        r.appendChild(el('span', 'cal-fl', label));
        var minus = button('icon-btn cal-step', '−', function () { onStep(-1); redo('[data-f="' + f + '"] [data-s="-1"]'); }, label + ' − (' + value + ')');
        var plus = button('icon-btn cal-step', '+', function () { onStep(1); redo('[data-f="' + f + '"] [data-s="1"]'); }, label + ' + (' + value + ')');
        minus.setAttribute('data-s', '-1'); plus.setAttribute('data-s', '1');
        r.setAttribute('data-f', f);
        r.appendChild(minus); r.appendChild(el('b', 'cal-fv', value)); r.appendChild(plus);
        return r;
    }
    function redo(sel2) { renderSide(); var f = side.querySelector(sel2); if (f) { Focus.focus(f); A11y.announce(f.parentNode.textContent.replace(/[−+]/g, ' ')); } }
    function remindText(m) { return t('calRemind' + (m < 0 ? 'N' : m)); }
    function renderEditor() {
        var e = edit;
        side.appendChild(el('h4', 'cal-notes-h cal-edit-h', t(e.id ? 'calEditEvent' : 'calNewEvent')));
        side.appendChild(row('title', t('calTitleF'), e.title, function () {
            Keyboard.open({ title: t('calTitleF'), text: e.title, max: 60, mode: 'text' }, function (v) { e.title = v; redo('[data-f="title"]'); },
                          function () { Focus.focus(side.querySelector('[data-f="title"]')); });
        }));
        side.appendChild(stepRow('date', t('calDateF'), fmt(fromKey(e.date), { weekday: 'short', day: 'numeric', month: 'short' }),
            function (d) { e.date = Events.addDays(e.date, d); }));
        side.appendChild(stepRow('time', t('calTime'), e.time ? clock(e.time) : t('calAllDay'), function (d) {
            // All day, then every 15 minutes; + from All day starts at 09:00
            if (!e.time) { e.time = d > 0 ? '09:00' : '23:45'; return; }
            var p = e.time.split(':'), m = +p[0] * 60 + +p[1] + d * 15;
            if (m < 0 || m >= 1440) { e.time = ''; return; }
            e.time = (m < 600 ? '0' : '') + Math.floor(m / 60) + ':' + (m % 60 < 10 ? '0' : '') + m % 60;
        }));
        side.appendChild(row('remind', t('calRemind'), remindText(e.remind), function () { e.remind = REMIND[(REMIND.indexOf(e.remind) + 1) % REMIND.length]; redo('[data-f="remind"]'); }));
        side.appendChild(row('repeat', t('calRepeat'), t(e.yearly ? 'calYearly' : 'calOnce'), function () { e.yearly = !e.yearly; redo('[data-f="repeat"]'); }));
        var acts = el('div', 'cal-acts');
        acts.appendChild(button('pill-btn cal-save', t('calSave'), save));
        if (e.id) acts.appendChild(button('pill-btn cal-del', t('calDelete'), function () {
            App.confirm(t('calDeleteQ'), e.title, function () { Events.remove(e.id); close(); });
        }));
        acts.appendChild(button('pill-btn', t('calCancel'), close));
        side.appendChild(acts);
    }
    function save() {
        var e = edit;
        if (!e.title) return App.toast(t('calNeedTitle'));
        var o = { date: e.date, time: e.time, title: e.title, remind: e.remind, yearly: e.yearly };
        if (e.id) Events.update(e.id, o); else Events.add(o);
        App.toast(t('calSaved'), { kind: 'ok' });
        var d = fromKey(e.date);
        sel = d; year = d.getFullYear(); month = d.getMonth();
        close();
    }
    function close() {
        edit = null;
        render(true);
        Focus.focus(dayBtn(sel));
    }

    function dayBtn(d) { return grid.querySelector('[data-day="' + d.getDate() + '"]'); }

    Win.register('calendar', {
        icon: 'calendar',
        title: function () { return t('calendar'); },
        open: function (b) {
            body = b;
            var now = new Date();
            year = now.getFullYear(); month = now.getMonth(); sel = now; edit = null;
            var left = el('div', 'cal-main');
            left.appendChild(header());
            grid = el('div', 'cal-grid');
            left.appendChild(grid);
            side = el('aside', 'cal-side');
            body.appendChild(left); body.appendChild(side);
            // the holidays file, once a day: redraw when it brought something new
            Events.refresh(function (changed) { if (changed && grid) { var f = Focus.current(), id = f && f.getAttribute && f.getAttribute('data-day'); render(true); if (id && !edit) Focus.focus(grid.querySelector('[data-day="' + id + '"]')); } });
            return render(true);
        },
        // Channel Up / Down, PageUp / PageDown, L / R: the previous / next month
        action: function (a) {
            if (a !== 'pageUp' && a !== 'pageDown') return false;
            go(a === 'pageDown' ? 1 : -1);
            Focus.focus(dayBtn(sel));
            return true;
        },
        back: function () { if (!edit) return false; close(); return true; },
        refresh: function () { if (grid) render(true); },
        close: function () { body = grid = side = title = sub = null; edit = null; }
    });
})();
