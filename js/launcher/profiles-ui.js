/* Profiles screen (switch, create, rename, delete) and the on-screen keyboard used to type a name.
 * Opened from the profile button on the home screen. Input arrives through the router in main.js. */
var ProfilesUI = (function () {
    'use strict';

    var KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');
    var namerCb = null, namerCancel = null, namerText = '', onChange = null;

    function $(id) { return document.getElementById(id); }
    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }
    function nameOf(p) { return Profiles.name(p, I18n.t('player'), I18n.t('guest')); }

    function avatar(p, cls) { return Avatars.make(p, cls); }

    // the button in the home header
    function renderButton() {
        var p = Profiles.current(), av = $('profile-avatar');
        Avatars.fill(av, p);
        $('profile-name').textContent = nameOf(p);
        $('btn-profile').setAttribute('aria-label', I18n.t('profile') + ': ' + nameOf(p) + '. ' + I18n.t('switchProfile'));
    }

    /* ---------------- profiles screen ---------------- */

    function renderList() {
        var box = $('profiles-list'), l = Profiles.list().concat([Profiles.GUEST]), cur = Profiles.current(), target = null;
        box.innerHTML = '';
        for (var i = 0; i < l.length; i++) {
            var p = l[i], b = el('button', 'pcard' + (p.id === cur.id ? ' pcard-on' : ''));
            b.setAttribute('data-focus', '');
            b.setAttribute('data-profile', p.id);
            b.setAttribute('role', 'listitem');
            b.appendChild(avatar(p, 'avatar avatar-big'));
            b.appendChild(el('span', 'pcard-name', nameOf(p)));
            if (p.id === cur.id) b.appendChild(el('span', 'pcard-tag', I18n.t('active')));
            b.setAttribute('aria-label', nameOf(p) + (p.id === cur.id ? '. ' + I18n.t('active') : '. ' + I18n.t('switchHint')));
            b.onclick = (function (id) { return function () { pick(id); }; })(p.id);
            box.appendChild(b);
            if (p.id === cur.id) target = b;
        }
        $('profile-new').hidden = Profiles.list().length >= Profiles.MAX;
        $('profile-delete').hidden = !!cur.guest;
        $('profile-rename').hidden = !!cur.guest;
        return target;
    }

    function open() {
        $('menu').hidden = true;
        $('profiles').hidden = false;
        I18n.apply($('profiles'));
        Focus.push($('profiles'), renderList());
    }

    function close() {
        $('profiles').hidden = true;
        $('menu').hidden = false;
        Focus.pop();
        renderButton();
        Focus.set($('menu'), $('btn-profile'));
    }

    function changed() { renderButton(); if (onChange) onChange(); }

    function pick(id) {
        if (id !== Profiles.current().id) {
            Profiles.use(id);
            changed();
            App.toast(I18n.t('hello') + ', ' + nameOf(Profiles.current()) + '!');
        }
        close();
    }

    function refocus(id) {
        var t = renderList();
        if (id) t = $(id).hidden ? t : $(id);
        Focus.set($('profiles'), t);
    }

    // New profile: name (on-screen keyboard), then avatar and colour. done(profile | null) is called when finished
    // (the profile picker passes it to come back); without it the Profiles screen is refreshed.
    function create(done) {
        if (typeof done !== 'function') done = null;
        openNamer(I18n.t('newProfile'), '', function (name) {
            openStyler(function (colorIdx, avatarIdx) {
                var p = Profiles.create(name, Profiles.COLORS[colorIdx], avatarIdx);
                if (!p) { if (done) done(null); return; }
                Profiles.use(p.id);
                changed();
                App.toast(I18n.t('hello') + ', ' + nameOf(p) + '!');
                if (done) done(p); else refocus();
            }, function () { if (done) done(null); });
        }, function () { if (done) done(null); });
    }

    /* ---------------- avatar and colour ---------------- */

    var styleCb = null, styleCancel = null, styleColor = 0, styleAvatar = 0;

    function drawStyler() {
        var av = $('styler-avatars'), co = $('styler-colors'), i, b;
        av.innerHTML = ''; co.innerHTML = '';
        var tmp = { color: Profiles.COLORS[styleColor] };
        for (i = 0; i < Profiles.AVATARS; i++) {
            b = el('button', 'btn opt' + (i === styleAvatar ? ' opt-on' : ''));
            b.setAttribute('data-focus', '');
            b.setAttribute('data-avatar', i);
            b.setAttribute('role', 'radio');
            b.setAttribute('aria-checked', i === styleAvatar ? 'true' : 'false');
            b.setAttribute('aria-label', I18n.t('avatar') + ' ' + (i + 1));
            b.appendChild(Avatars.make({ color: tmp.color, avatar: i }));
            b.onclick = (function (k) { return function () { styleAvatar = k; drawStyler(); Focus.set($('styler'), $('styler-avatars').childNodes[k]); }; })(i);
            av.appendChild(b);
        }
        for (i = 0; i < Profiles.COLORS.length; i++) {
            b = el('button', 'btn opt' + (i === styleColor ? ' opt-on' : ''));
            b.setAttribute('data-focus', '');
            b.setAttribute('data-color', i);
            b.setAttribute('role', 'radio');
            b.setAttribute('aria-checked', i === styleColor ? 'true' : 'false');
            b.setAttribute('aria-label', I18n.t('colour') + ' ' + (i + 1));
            var dot = el('span', 'opt-color');
            dot.style.backgroundColor = Profiles.COLORS[i];
            dot.setAttribute('aria-hidden', 'true');
            b.appendChild(dot);
            b.onclick = (function (k) { return function () { styleColor = k; drawStyler(); Focus.set($('styler'), $('styler-colors').childNodes[k]); }; })(i);
            co.appendChild(b);
        }
    }

    function openStyler(cb, cancelCb) {
        styleCb = cb; styleCancel = cancelCb;
        styleColor = 0; styleAvatar = Profiles.list().length % Profiles.AVATARS;
        var used = {}, l = Profiles.list(), i;
        for (i = 0; i < l.length; i++) used[l[i].color] = 1;
        for (i = 0; i < Profiles.COLORS.length; i++) if (!used[Profiles.COLORS[i]]) { styleColor = i; break; }
        drawStyler();
        I18n.apply($('styler'));
        $('styler').hidden = false;
        Focus.push($('styler'), $('styler-avatars').childNodes[styleAvatar]);
        A11y.announce(I18n.t('chooseLook'));
    }
    function closeStyler(ok) {
        var cb = ok ? styleCb : styleCancel, c = styleColor, a = styleAvatar;
        $('styler').hidden = true;
        styleCb = styleCancel = null;
        Focus.pop();
        if (cb) cb(c, a);
    }
    function stylerOpen() { return !$('styler').hidden; }
    function stylerAction(action, repeat) {
        if (action === 'left' || action === 'right' || action === 'up' || action === 'down') Focus.move(action);
        else if (action === 'confirm' && !repeat) { var c = Focus.current(); if (c) c.click(); }
        else if ((action === 'back' || action === 'cancel') && !repeat) closeStyler(false);
    }

    function rename() {
        var p = Profiles.current();
        openNamer(I18n.t('renameProfile'), p.name, function (name) {
            Profiles.rename(p.id, name);
            changed();
            refocus();
        });
    }

    function del() {
        var p = Profiles.current();
        if (p.guest) return;
        App.confirm(I18n.t('deleteTitle'), I18n.t('deleteText').replace('%s', nameOf(p)), function () {
            Profiles.remove(p.id);
            changed();
            App.toast(I18n.t('hello') + ', ' + nameOf(Profiles.current()) + '!');
            refocus();
        });
    }

    /* ---------------- on-screen keyboard ---------------- */

    function drawNamer() {
        $('namer-text').textContent = namerText || ' ';
        $('namer-text').className = 'namer-text' + (namerText ? '' : ' namer-empty');
    }

    function openNamer(title, text, cb, cancelCb) {
        namerCb = cb;
        namerCancel = cancelCb || null;
        namerText = text || '';
        $('namer-title').textContent = title;
        var box = $('namer-keys');
        box.innerHTML = '';
        function key(label, cls, fn, aria) {
            var b = el('button', 'btn key' + (cls ? ' ' + cls : ''), label);
            b.setAttribute('data-focus', '');
            if (aria) b.setAttribute('aria-label', aria);
            b.onclick = fn;
            box.appendChild(b);
            return b;
        }
        for (var i = 0; i < KEYS.length; i++) key(KEYS[i], '', (function (c) { return function () { type(c); }; })(KEYS[i]));
        key(I18n.t('space'), 'key-wide', function () { type(' '); });
        key('⌫', 'key-wide', erase, I18n.t('erase'));
        key(I18n.t('cancel'), 'key-wide', function () { closeNamer(true); });
        key(I18n.t('save'), 'key-wide btn-primary', submit);
        drawNamer();
        $('namer').hidden = false;
        Focus.push($('namer'), box.firstChild);
        A11y.announce(title + '. ' + I18n.t('namerHint'));
    }

    function type(c) {
        if (namerText.length >= Profiles.NAME_MAX) return;
        // Capitalise like a name: first letter of each word upper, the rest lower.
        var prev = namerText.charAt(namerText.length - 1);
        if (c !== ' ') c = !namerText || prev === ' ' ? c.toUpperCase() : c.toLowerCase();
        else if (!namerText || prev === ' ') return;
        namerText += c;
        drawNamer();
        A11y.announce(c === ' ' ? I18n.t('space') : c);
    }
    function erase() { namerText = namerText.slice(0, -1); drawNamer(); A11y.announce(namerText || I18n.t('erase')); }

    function submit() {
        var name = namerText.replace(/^\s+|\s+$/g, '');
        if (!name) { A11y.announce(I18n.t('namerHint')); return; }
        var cb = namerCb;
        closeNamer();
        if (cb) cb(name);
    }

    function closeNamer(cancelled) {
        var c = cancelled === true ? namerCancel : null;
        $('namer').hidden = true;
        namerCb = null; namerCancel = null;
        Focus.pop();
        if (c) c();
    }

    // A PC keyboard types directly (letters/digits/space/backspace/enter) while the keyboard is open.
    // Window capture phase, so these keys never reach the menu input mapping (W A S D, Z, X...).
    function onRawKey(e) {
        if ($('namer').hidden) return;
        var k = e.keyCode;
        if ((k >= 65 && k <= 90) || (k >= 48 && k <= 57) || k === 32 || k === 8) {
            e.preventDefault();
            e.stopPropagation();
            if (e.type !== 'keydown') return;
            if (k === 8) erase();
            else if (k === 32) type(' ');
            else type(String.fromCharCode(k));
        }
    }

    // router hooks (main.js)
    function namerOpen() { return !$('namer').hidden; }
    function screenOpen() { return !$('profiles').hidden; }
    function namerAction(action, repeat) {
        if (action === 'left' || action === 'right' || action === 'up' || action === 'down') Focus.move(action);
        else if (action === 'confirm' && !repeat) { var c = Focus.current(); if (c) c.click(); }
        else if ((action === 'back' || action === 'cancel') && !repeat) closeNamer(true);
    }
    function screenAction(action, repeat) {
        if ((action === 'back' || action === 'cancel') && !repeat) close();
        else if (action === 'left' || action === 'right' || action === 'up' || action === 'down') Focus.move(action);
        else if (action === 'confirm' && !repeat) { var c = Focus.current(); if (c) c.click(); }
    }

    function init(changeCb) {
        onChange = changeCb;
        $('btn-profile').onclick = open;
        $('profile-new').onclick = function () { create(); };
        $('profile-rename').onclick = rename;
        $('profile-delete').onclick = del;
        $('profiles-close').onclick = close;
        $('styler-ok').onclick = function () { closeStyler(true); };
        $('styler-cancel').onclick = function () { closeStyler(false); };
        window.addEventListener('keydown', onRawKey, true);
        window.addEventListener('keyup', onRawKey, true);
        renderButton();
    }

    return {
        init: init, open: open, close: close, renderButton: renderButton, create: create, stylerOpen: stylerOpen, stylerAction: stylerAction,
        namerOpen: namerOpen, screenOpen: screenOpen, namerAction: namerAction, screenAction: screenAction
    };
})();
