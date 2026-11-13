/* MyNotes (owner request 2026-11-13): texts sent from a phone (Receiver, js/launcher/share-rx.js) and notes typed on the TV.
 * Per profile, key "notes" (backed up with the profile like every profile key): [{ id, text, from, title, at }], newest first,
 * 200 at most, 20 000 characters each. List on the left, the note on the right; a note with a web address offers to open it
 * in MyBrowser. Nothing runs while the window is closed.
 *
 *   Notes.add(text, from, title) -> id      Notes.list()      Notes.remove(id)      Win.open('notes', id) opens on that note */
var Notes = (function () {
    'use strict';

    var KEY = 'notes', MAX = 200, LEN = 20000;
    var body = null, cur = null, ui = {}, delArm = 0;

    function t(k) { return I18n.t(k); }
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
    function btn(cls, text, fn) { var b = el('button', cls, text); b.setAttribute('data-focus', ''); b.onclick = fn; return b; }

    function list() { var l = Store.get(KEY, []); return Array.isArray(l) ? l : []; }
    function save(l) { Store.set(KEY, l.slice(0, MAX)); }
    function find(id) { var l = list(); for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }
    function add(text, from, title) {
        var n = { id: 'n' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36), text: String(text || '').slice(0, LEN), from: String(from || '').slice(0, 60), title: String(title || '').slice(0, 120), at: Date.now() };
        var l = list(); l.unshift(n); save(l);
        if (body) { cur = n.id; render(); }
        return n.id;
    }
    function update(id, text) { var l = list(); for (var i = 0; i < l.length; i++) if (l[i].id === id) { l[i].text = String(text).slice(0, LEN); l[i].at = Date.now(); } save(l); }
    function remove(id) { save(list().filter(function (n) { return n.id !== id; })); }
    function firstLine(n) { var s = (n.title || n.text || '').replace(/\s+/g, ' ').trim(); return s.length > 60 ? s.slice(0, 58) + '…' : s || '…'; }
    function when(ms) { var d = new Date(ms); return Desktop.dateText(d) + ' ' + Desktop.timeText(d); }

    function render(focusSel) {
        if (!body) return;
        var l = list();
        if (cur && !find(cur)) cur = null;
        if (!cur && l.length) cur = l[0].id;
        body.innerHTML = '';
        var box = el('div', 'mn'), side = el('div', 'mn-side'), main = el('div', 'mn-main');
        var add1 = btn('mn-new', '+ ' + t('ntNew'), function () {
            Keyboard.open({ title: t('ntNew'), max: 2000, mode: 'title' }, function (s) { if (String(s || '').trim()) { cur = add(s, ''); render('.mn-item.on'); } });
        });
        side.appendChild(add1);
        var items = el('div', 'mn-list');
        items.setAttribute('role', 'list');
        for (var i = 0; i < l.length; i++) {
            var n = l[i], b = btn('mn-item' + (n.id === cur ? ' on' : ''), '');
            b.setAttribute('role', 'listitem');
            b.appendChild(el('span', 'mn-it-t', firstLine(n)));
            b.appendChild(el('span', 'mn-it-s', (n.from ? t('ntFrom').replace('%s', n.from) : t('ntMine')) + ' · ' + when(n.at)));
            b.onclick = (function (id) { return function () { cur = id; delArm = 0; render('.mn-item.on'); }; })(n.id);
            items.appendChild(b);
        }
        side.appendChild(items);
        box.appendChild(side);
        var n0 = cur ? find(cur) : null;
        if (!n0) main.appendChild(el('div', 'mn-empty', t('ntNone')));
        else {
            if (n0.title) main.appendChild(el('div', 'mn-title', n0.title));
            main.appendChild(el('div', 'mn-meta', (n0.from ? t('ntFrom').replace('%s', n0.from) : t('ntMine')) + ' · ' + when(n0.at)));
            var txt = el('div', 'mn-text', n0.text);
            txt.setAttribute('tabindex', '0');
            txt.setAttribute('data-focus', '');
            main.appendChild(txt);
            var bar = el('div', 'mn-bar'), link = ShareRx.linkIn(n0.text) || ((n0.text.match(/https?:\/\/[^\s]+/i) || [])[0] || '');
            if (link) bar.appendChild(btn('mn-btn mn-link', t('ntOpenLink'), function () { Win.open('browser', link); }));
            bar.appendChild(btn('mn-btn', t('ntEdit'), function () {
                Keyboard.open({ title: t('ntEdit'), max: 2000, mode: 'title', text: n0.text.slice(0, 2000) }, function (s) { if (s !== null && s !== undefined) { update(n0.id, s); render('.mn-item.on'); } });
            }));
            var del = btn('mn-btn mn-del', t('ntDelete'), function () {
                if (Date.now() - delArm > 4000) { delArm = Date.now(); del.textContent = t('ntDelSure'); A11y.announce(t('ntDelSure')); return; }
                delArm = 0; remove(n0.id); cur = null; A11y.announce(t('ntDeleted')); render('.mn-item.on');
            });
            bar.appendChild(del);
            main.appendChild(bar);
        }
        box.appendChild(main);
        body.appendChild(box);
        I18n.apply(body);
        var f = focusSel ? body.querySelector(focusSel) : null;
        if (f) Focus.focus(f);
        return f || body.querySelector('.mn-item.on') || add1;
    }

    Win.register('notes', {
        icon: 'notes',
        title: function () { return t('notes'); },
        open: function (b, arg) { body = b; cur = typeof arg === 'string' ? arg : null; delArm = 0; return render(); },
        close: function () { body = null; ui = {}; cur = null; },
        action: function (a, repeat) {
            // the note's text scrolls with Up / Down while it has the focus
            var f = Focus.current();
            if (f && f.classList && f.classList.contains('mn-text') && (a === 'up' || a === 'down')) {
                var before = f.scrollTop;
                f.scrollTop += a === 'down' ? 120 : -120;
                if (f.scrollTop !== before) return true;
            }
            return false;
        },
        refresh: function () { if (body) render(); }
    });

    return { add: add, list: list, remove: remove, find: find };
})();
