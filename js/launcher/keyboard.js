/* On-screen keyboard for the remote (a PC keyboard can type too), used for profile names,
 * web addresses and calendar notes.
 *   Keyboard.open({ title, text, max, mode: 'name' | 'url' | 'text' }, function (value) {...})
 * 'name' capitalises each word, 'url' adds . / : - _ and keeps lower case, 'text' is free text. */
var Keyboard = (function () {
    'use strict';

    var LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');
    var URL_EXTRA = ['.', '/', ':', '-', '_', '?', '=', '&', '.com'];
    var TEXT_EXTRA = ['.', ',', '!', '?', '-', ':'];
    var cb = null, text = '', opts = null, isOpen = false;

    function $(id) { return document.getElementById(id); }

    function draw() {
        $('namer-text').textContent = text || (opts.placeholder || ' ');
        $('namer-text').className = 'namer-text' + (text ? '' : ' namer-empty') + (opts.mode === 'name' ? '' : ' namer-left');
    }

    function key(box, label, cls, fn, aria) {
        var b = document.createElement('button');
        b.className = 'btn key' + (cls ? ' ' + cls : '');
        b.textContent = label;
        b.setAttribute('data-focus', '');
        if (aria) b.setAttribute('aria-label', aria);
        b.onclick = fn;
        box.appendChild(b);
        return b;
    }

    function open(o, done) {
        opts = o || {};
        opts.max = opts.max || 12;
        opts.mode = opts.mode || 'name';
        cb = done;
        text = opts.text || '';
        $('namer-title').textContent = opts.title || '';
        var box = $('namer-keys'), i;
        box.innerHTML = '';
        var lower = opts.mode !== 'name';
        for (i = 0; i < LETTERS.length; i++) {
            var c = lower ? LETTERS[i].toLowerCase() : LETTERS[i];
            key(box, c, '', (function (ch) { return function () { type(ch); }; })(c));
        }
        var extra = opts.mode === 'url' ? URL_EXTRA : opts.mode === 'text' ? TEXT_EXTRA : [];
        for (i = 0; i < extra.length; i++) key(box, extra[i], extra[i].length > 1 ? 'key-mid' : '', (function (ch) { return function () { type(ch); }; })(extra[i]));
        if (opts.mode !== 'url') key(box, I18n.t('space'), 'key-wide', function () { type(' '); });
        key(box, '⌫', 'key-wide', erase, I18n.t('erase'));
        key(box, I18n.t('cancel'), 'key-wide', close);
        key(box, opts.ok || I18n.t('save'), 'key-wide btn-primary', submit);
        draw();
        isOpen = true;
        $('namer').hidden = false;
        Focus.push($('namer'), box.firstChild);
        A11y.announce((opts.title || '') + '. ' + I18n.t('namerHint'));
    }

    function type(c) {
        if (text.length + c.length > opts.max) return;
        var prev = text.charAt(text.length - 1);
        if (opts.mode === 'name') {
            // capitalise like a name: first letter of each word upper, the rest lower
            if (c !== ' ') c = !text || prev === ' ' ? c.toUpperCase() : c.toLowerCase();
            else if (!text || prev === ' ') return;
        } else if (opts.mode === 'text' && c.length === 1 && /[a-z]/i.test(c)) {
            c = !text || /[.!?]\s$/.test(text.slice(-2)) ? c.toUpperCase() : c.toLowerCase();
        } else if (c === ' ' && (!text || prev === ' ')) return;
        text += c;
        draw();
        A11y.announce(c === ' ' ? I18n.t('space') : c);
    }
    function erase() { text = text.slice(0, -1); draw(); A11y.announce(text || I18n.t('erase')); }

    function submit() {
        var v = text.replace(/^\s+|\s+$/g, '');
        if (!v) { A11y.announce(I18n.t('namerHint')); return; }
        var f = cb;
        close();
        if (f) f(v);
    }

    function close() {
        if (!isOpen) return;
        isOpen = false;
        $('namer').hidden = true;
        cb = null;
        Focus.pop();
    }

    // A PC keyboard types directly while the keyboard is open. Window capture phase, so these keys
    // never reach the input mapping (W A S D, Z, X, Backspace = Back...).
    function onRawKey(e) {
        if (!isOpen) return;
        var k = e.keyCode, ch = e.key && e.key.length === 1 ? e.key : '';
        if (k === 8 || (ch && k !== 13)) {
            e.preventDefault();
            e.stopPropagation();
            if (e.type !== 'keydown') return;
            if (k === 8) erase();
            else if (ch === ' ') type(' ');
            else if (opts.mode === 'name' && !/[a-z0-9]/i.test(ch)) return;
            else type(opts.mode === 'url' ? ch.toLowerCase() : ch);
        }
    }

    function action(a, repeat) {
        if (a === 'left' || a === 'right' || a === 'up' || a === 'down') Focus.move(a);
        else if (a === 'confirm' && !repeat) { var c = Focus.current(); if (c) c.click(); }
        else if ((a === 'back' || a === 'cancel') && !repeat) close();
    }

    window.addEventListener('keydown', onRawKey, true);
    window.addEventListener('keyup', onRawKey, true);

    return { open: open, close: close, isOpen: function () { return isOpen; }, action: action };
})();
