/* On-screen keyboard for the remote (a PC keyboard can type too), used for profile names,
 * usernames, passwords, web addresses and calendar notes.
 *   Keyboard.open({ title, text, max, mode, hint, placeholder, ok }, function (value) {...}, onCancel)
 * 'name' capitalises each word, 'url' adds . / : - _ and keeps lower case, 'text' is free text,
 * 'user' is a username (lower case letters, digits, _ and .), 'password' hides what is typed (a Show key,
 * a Shift key for capitals, a few symbols) and Voice Guide says only how many characters there are. */
var Keyboard = (function () {
    'use strict';

    var LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');
    var URL_EXTRA = ['.', '/', ':', '-', '_', '?', '=', '&', '.com'];
    var TEXT_EXTRA = ['.', ',', '!', '?', '-', ':'];
    var USER_EXTRA = ['_', '.'];
    var PASS_EXTRA = ['.', '-', '_', '@', '!', '?', '#', '$', '*'];
    var cb = null, cancelCb = null, text = '', opts = null, isOpen = false, caps = false, shown = false;

    function $(id) { return document.getElementById(id); }

    function draw() {
        var secret = opts.mode === 'password' && !shown, t = text;
        if (secret) t = new Array(text.length + 1).join('•');
        $('namer-text').textContent = t || (opts.placeholder || ' ');
        $('namer-text').className = 'namer-text' + (text ? '' : ' namer-empty') + (opts.mode === 'name' ? '' : ' namer-left');
        if (secret) $('namer-text').removeAttribute('aria-live'); else $('namer-text').setAttribute('aria-live', 'polite');
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

    // letter keys follow the Shift key (password)
    function relabel() {
        var ks = $('namer-keys').querySelectorAll('[data-ch]');
        for (var i = 0; i < ks.length; i++) {
            var c = ks[i].getAttribute('data-ch');
            ks[i].textContent = caps ? c.toUpperCase() : c;
        }
    }

    function open(o, done, onCancel) {
        opts = o || {};
        opts.max = opts.max || 12;
        opts.mode = opts.mode || 'name';
        cb = done;
        cancelCb = onCancel || null;
        text = opts.text || '';
        caps = false; shown = false;
        $('namer-title').textContent = opts.title || '';
        $('namer-hint').textContent = opts.hint || '';
        $('namer-hint').hidden = !opts.hint;
        var box = $('namer-keys'), i, m = opts.mode;
        box.innerHTML = '';
        var lower = m !== 'name';
        for (i = 0; i < LETTERS.length; i++) {
            var c = lower ? LETTERS[i].toLowerCase() : LETTERS[i];
            var b = key(box, c, '', (function (ch) { return function () { type(m === 'password' && caps ? ch.toUpperCase() : ch); }; })(c));
            if (m === 'password' && /[a-z]/.test(c)) b.setAttribute('data-ch', c);
        }
        var extra = m === 'url' ? URL_EXTRA : m === 'text' ? TEXT_EXTRA : m === 'user' ? USER_EXTRA : m === 'password' ? PASS_EXTRA : [];
        for (i = 0; i < extra.length; i++) key(box, extra[i], extra[i].length > 1 ? 'key-mid' : '', (function (ch) { return function () { type(ch); }; })(extra[i]));
        if (m === 'password') {
            key(box, '⇧', 'key-mid', function () { caps = !caps; relabel(); A11y.announce(I18n.t(caps ? 'capsOn' : 'capsOff')); }, I18n.t('capsKey'));
            key(box, I18n.t('showPw'), 'key-wide', function () { shown = !shown; this.textContent = I18n.t(shown ? 'hidePw' : 'showPw'); draw(); if (shown) A11y.announce(text); });
        }
        if (m === 'name' || m === 'text') key(box, I18n.t('space'), 'key-wide', function () { type(' '); });
        key(box, '⌫', 'key-wide', erase, I18n.t('erase'));
        key(box, I18n.t('cancel'), 'key-wide', cancel);
        key(box, opts.ok || I18n.t('save'), 'key-wide btn-primary', submit);
        draw();
        isOpen = true;
        $('namer').hidden = false;
        Focus.push($('namer'), box.firstChild);
        A11y.announce((opts.title || '') + '. ' + (opts.hint ? opts.hint + '. ' : '') + I18n.t('namerHint'));
    }

    function say(c) {
        if (opts.mode === 'password' && !shown) A11y.announce(I18n.t('pwCount').replace('%n', text.length));
        else A11y.announce(c === ' ' ? I18n.t('space') : c);
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
        } else if (opts.mode === 'user') {
            c = c.toLowerCase();
            if (!/^[a-z0-9_.]$/.test(c)) return;
        } else if (opts.mode === 'password') {
            if (c === ' ') return;
        } else if (c === ' ' && (!text || prev === ' ')) return;
        text += c;
        draw();
        say(c);
    }
    function erase() { text = text.slice(0, -1); draw(); if (opts.mode === 'password' && !shown) say(''); else A11y.announce(text || I18n.t('erase')); }

    function submit() {
        var v = opts.mode === 'password' ? text : text.replace(/^\s+|\s+$/g, '');
        if (!v) { A11y.announce(I18n.t('namerHint')); return; }
        var f = cb;
        close(true);
        if (f) f(v);
    }

    function cancel() { var f = cancelCb; close(true); if (f) f(); }

    function close(quiet) {
        if (!isOpen) return;
        isOpen = false;
        $('namer').hidden = true;
        cb = null;
        if (quiet !== true) cancelCb = null;
        text = '';
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
            else type(opts.mode === 'url' || opts.mode === 'user' ? ch.toLowerCase() : ch);
        }
    }

    function action(a, repeat) {
        if (a === 'left' || a === 'right' || a === 'up' || a === 'down') Focus.move(a);
        else if (a === 'confirm' && !repeat) { var c = Focus.current(); if (c) c.click(); }
        else if ((a === 'back' || a === 'cancel') && !repeat) cancel();
    }

    window.addEventListener('keydown', onRawKey, true);
    window.addEventListener('keyup', onRawKey, true);

    return { open: open, close: close, isOpen: function () { return isOpen; }, action: action };
})();
