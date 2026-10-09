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
        var a = el('span', cls || 'avatar');
        Avatars.fill(a, p, initial(p));
        a.setAttribute('aria-hidden', 'true');
        return a;
    }

    // the button in the home header
    function renderButton() {
        var p = Profiles.current(), av = $('profile-avatar');
        Avatars.fill(av, p, initial(p));
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
        pickerOpen = false;
        $('profiles-picker').hidden = true; $('profiles-main').hidden = false;
        $('profiles').hidden = true;
        Focus.pop();
        renderButton();
    }

    function changed() { renderButton(); if (onChange) onChange(); }

    function pick(id) {
        close();
        if (id !== Profiles.current().id) Welcome.switchUser(id);
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
            close();
            Welcome.switchUser(p.id);
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
            close();
            Welcome.switchUser(Profiles.current().id, true);     // the deleted one was active: sign in as another
        });
    }

    function openNamer(title, text, cb) {
        Keyboard.open({ title: title, text: text, max: Profiles.NAME_MAX, mode: 'name' }, cb);
    }


    /* ---------------- profile picture: drawn avatars, the initial letter, or a photo ---------------- */

    var pickerOpen = false, pickerOnly = false, pickerErr = 0;

    function picked(pic) {
        var p = Profiles.current();
        Profiles.setPicture(p.id, pic);
        changed();
        A11y.announce(I18n.t('pictureSaved'));
        closePicker();
    }

    // Square 128 px copy of a photo (small enough to be backed up); falls back to keeping the web address
    function toPhoto(src, cb) {
        var img = new Image(), plain = false;
        img.onload = function () {
            try {
                var cv = document.createElement('canvas'), s = Math.min(img.width, img.height) || 1;
                cv.width = cv.height = 128;
                cv.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 128, 128);
                cb(cv.toDataURL('image/jpeg', 0.8));
            } catch (e) { cb(/^https?:/.test(src) ? src : null); }
        };
        img.onerror = function () {
            if (!plain && /^https?:/.test(src)) { plain = true; img.crossOrigin = null; var t = new Image(); t.onload = function () { cb(src); }; t.onerror = function () { cb(null); }; t.src = src; }
            else cb(null);
        };
        if (/^https?:/.test(src)) img.crossOrigin = 'anonymous';
        img.src = src;
    }

    function photoFromAddress() {
        Keyboard.open({ title: I18n.t('pictureAddress'), text: '', max: 240, mode: 'url', placeholder: 'https://' }, function (v) {
            if (!v) return;
            if (!/^https?:\/\//.test(v)) v = 'https://' + v;
            App.toast(I18n.t('pictureLoading'));
            toPhoto(v, function (data) {
                if (!data) return App.toast(I18n.t('pictureBad'));
                picked({ photo: data });
            });
        });
    }

    function photoFromFile() {
        var inp = el('input');
        inp.type = 'file'; inp.accept = 'image/*';
        inp.onchange = function () {
            var f = inp.files && inp.files[0];
            if (!f) return;
            var rd = new FileReader();
            rd.onload = function () { toPhoto(rd.result, function (data) { if (data) picked({ photo: data }); else App.toast(I18n.t('pictureBad')); }); };
            rd.readAsDataURL(f);
        };
        inp.click();
    }

    function renderPicker() {
        var grid = $('pic-grid'), cur = Profiles.current(), target = null, i;
        grid.innerHTML = '';
        function cell(label, pic, on, inner) {
            var b = el('button', 'pic-cell' + (on ? ' on' : ''));
            b.setAttribute('data-focus', '');
            b.setAttribute('aria-label', label + (on ? '. ' + I18n.t('active') : ''));
            b.appendChild(inner);
            b.onclick = function () { picked(pic); };
            grid.appendChild(b);
            if (on || (!target && !cur.av && !cur.photo)) target = target || b;
            return b;
        }
        var letter = el('span', 'avatar pic-av');
        Avatars.fill(letter, { color: cur.color }, initial(cur));
        cell(I18n.t('pictureLetter'), null, !cur.av && !cur.photo, letter);
        for (i = 0; i < Avatars.IDS.length; i++) {
            var a = el('span', 'avatar pic-av');
            Avatars.fill(a, { color: cur.color, av: Avatars.IDS[i] }, '');
            var b = cell(I18n.t('avatarWord') + ' ' + (i + 1), { av: Avatars.IDS[i] }, cur.av === Avatars.IDS[i], a);
            if (cur.av === Avatars.IDS[i]) target = b;
        }
        $('pic-file').hidden = !!window.tizen;
        return target || grid.firstChild;
    }

    function openPicker(only) {
        pickerOnly = !!only;
        if ($('profiles').hidden) { $('profiles').hidden = false; I18n.apply($('profiles')); Focus.push($('profiles'), null); }
        pickerOpen = true;
        $('profiles-main').hidden = true;
        $('profiles-picker').hidden = false;
        Focus.set($('profiles'), renderPicker());
        A11y.announce(I18n.t('profilePicture'));
    }

    function closePicker() {
        pickerOpen = false;
        $('profiles-picker').hidden = true;
        $('profiles-main').hidden = false;
        if (pickerOnly) { pickerOnly = false; close(); return; }
        Focus.set($('profiles'), renderList());
    }

    // router hooks (main.js)
    function screenOpen() { return !$('profiles').hidden; }
    function screenAction(action, repeat) {
        if ((action === 'back' || action === 'cancel') && !repeat) { if (pickerOpen) closePicker(); else close(); }
        else if (action === 'left' || action === 'right' || action === 'up' || action === 'down') Focus.move(action);
        else if (action === 'confirm' && !repeat) { var c = Focus.current(); if (c) c.click(); }
    }

    function init(changeCb) {
        onChange = changeCb;
        $('btn-profile').onclick = open;
        $('profile-new').onclick = create;
        $('profile-rename').onclick = rename;
        $('profile-picture').onclick = function () { openPicker(false); };
        $('pic-web').onclick = photoFromAddress;
        $('pic-file').onclick = photoFromFile;
        $('pic-back').onclick = closePicker;
        $('profile-delete').onclick = del;
        $('profiles-close').onclick = close;
        renderButton();
    }

    return {
        init: init, open: open, openPicker: openPicker, close: close, renderButton: renderButton,
        screenOpen: screenOpen, screenAction: screenAction, nameOf: nameOf, avatar: avatar
    };
})();
