/* Profiles screen (switch, create, rename, delete) and the on-screen keyboard used to type a name.
 * Opened from the profile button on the home screen. Input arrives through the router in main.js. */
var ProfilesUI = (function () {
    'use strict';

    var onChange = null;

    function $(id) { return document.getElementById(id); }
    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }
    function nameOf(p) { return Profiles.name(p, I18n.t('player')); }
    function initial(p) { return nameOf(p).charAt(0).toUpperCase(); }

    function avatar(p, cls) {
        var a = el('span', cls || 'avatar', initial(p));
        a.style.backgroundColor = p.color;
        a.setAttribute('aria-hidden', 'true');
        return a;
    }

    // the button in the home header
    function renderButton() {
        var p = Profiles.current(), av = $('profile-avatar');
        av.textContent = initial(p);
        av.style.backgroundColor = p.color;
        $('profile-name').textContent = nameOf(p);
        $('btn-profile').setAttribute('aria-label', I18n.t('profile') + ': ' + nameOf(p) + '. ' + I18n.t('switchProfile'));
    }

    /* ---------------- profiles screen ---------------- */

    function renderList() {
        var box = $('profiles-list'), l = Profiles.list(), cur = Profiles.current(), target = null;
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
        $('profile-new').hidden = l.length >= Profiles.MAX;
        $('profile-delete').hidden = l.length < 2;
        return target;
    }

    // an overlay over the desktop or the Settings app; closing it returns focus where it was
    function open() {
        $('profiles').hidden = false;
        I18n.apply($('profiles'));
        Focus.push($('profiles'), renderList());
    }

    function close() {
        $('profiles').hidden = true;
        Focus.pop();
        renderButton();
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

    function create() {
        openNamer(I18n.t('newProfile'), '', function (name) {
            var p = Profiles.create(name);
            if (!p) return;
            Profiles.use(p.id);
            changed();
            App.toast(I18n.t('hello') + ', ' + nameOf(p) + '!');
            refocus();
        });
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
        if (Profiles.list().length < 2) return;
        App.confirm(I18n.t('deleteTitle'), I18n.t('deleteText').replace('%s', nameOf(p)), function () {
            Profiles.remove(p.id);
            changed();
            App.toast(I18n.t('hello') + ', ' + nameOf(Profiles.current()) + '!');
            refocus();
        });
    }

    function openNamer(title, text, cb) {
        Keyboard.open({ title: title, text: text, max: Profiles.NAME_MAX, mode: 'name' }, cb);
    }

    // router hooks (main.js)
    function screenOpen() { return !$('profiles').hidden; }
    function screenAction(action, repeat) {
        if ((action === 'back' || action === 'cancel') && !repeat) close();
        else if (action === 'left' || action === 'right' || action === 'up' || action === 'down') Focus.move(action);
        else if (action === 'confirm' && !repeat) { var c = Focus.current(); if (c) c.click(); }
    }

    function init(changeCb) {
        onChange = changeCb;
        $('btn-profile').onclick = open;
        $('profile-new').onclick = create;
        $('profile-rename').onclick = rename;
        $('profile-delete').onclick = del;
        $('profiles-close').onclick = close;
        renderButton();
    }

    return {
        init: init, open: open, close: close, renderButton: renderButton,
        screenOpen: screenOpen, screenAction: screenAction, nameOf: nameOf, avatar: avatar
    };
})();
