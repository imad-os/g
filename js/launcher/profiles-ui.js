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
            if (p.user) b.appendChild(el('span', 'pcard-user', '@' + p.user + (p.ask ? '  •  ' + I18n.t('pwLocked') : '')));
            b.setAttribute('aria-label', nameOf(p) + (p.user ? '. ' + I18n.t('acctOf').replace('%s', p.user) : '') + (p.ask ? '. ' + I18n.t('pwLocked') : '') +
                (p.id === cur.id ? '. ' + I18n.t('active') : '. ' + I18n.t('switchHint')));
            b.onclick = (function (id) { return function () { pick(id); }; })(p.id);
            box.appendChild(b);
            if (p.id === cur.id) target = b;
        }
        $('profile-new').hidden = $('profile-signin').hidden = l.length >= Profiles.MAX;
        $('profile-delete').hidden = l.length < 2;
        // locked (the start asks for the password): only choosing a profile, or signing in
        $('profile-picture').hidden = $('profile-rename').hidden = locked;
        if (locked) $('profile-delete').hidden = true;
        return target;
    }

    // an overlay over the desktop or the Settings app; closing it returns focus where it was
    function open() {
        $('profiles').hidden = false;
        I18n.apply($('profiles'));
        Focus.push($('profiles'), renderList());
    }

    function close() {
        if (locked) return gate();
        pickerOpen = false;
        $('profiles-picker').hidden = true; $('profiles-main').hidden = false;
        $('profiles').hidden = true;
        Focus.pop();
        renderButton();
    }

    function changed() { renderButton(); if (onChange) onChange(); }

    function pick(id) {
        if (Accounts.asks(id) && !(id === Profiles.current().id && !locked)) {
            return askPassword(id, function () {
                if (id === Profiles.current().id) { locked = false; close(); return; }
                locked = false; close(); Welcome.switchUser(id);
            });
        }
        locked = false;
        close();
        if (id !== Profiles.current().id) { Accounts.unlock(id); Welcome.switchUser(id); }
    }

    function refocus(id) {
        var t = renderList();
        if (id) t = $(id).hidden ? t : $(id);
        Focus.set($('profiles'), t);
    }

    /* ---------------- accounts: new, sign in, password (js/core/accounts.js) ---------------- */

    function t(k) { return I18n.t(k); }
    function errText(err) {
        return t({ taken: 'userTaken', wrong: 'wrongLogin', weak: 'pwWeak', invalid: 'userBad', many: 'tooMany', offline: 'needNet', full: 'profilesFull' }[err] || 'acctFail');
    }

    function askUser(title, text, cb, onCancel) {
        Keyboard.open({ title: title, text: text || '', max: 16, mode: 'user', hint: t('userHint'), ok: t('next') }, function (u) {
            u = Accounts.clean(u);
            if (!Accounts.validName(u)) { App.toast(t('userBad')); return askUser(title, u, cb, onCancel); }
            cb(u);
        }, onCancel);
    }
    function askPw(title, hint, cb, onCancel, ok) {
        Keyboard.open({ title: title, text: '', max: 40, mode: 'password', hint: hint, ok: ok || t('next') }, cb, onCancel);
    }
    // a new password, typed twice
    function newPw(title, cb, onCancel) {
        askPw(title, t('pwHint'), function (pw) {
            if (pw.length < 6) { App.toast(t('pwWeak')); return newPw(title, cb, onCancel); }
            askPw(t('pwAgain'), t('pwAgainHint'), function (pw2) {
                if (pw2 !== pw) { App.toast(t('pwMismatch')); return newPw(title, cb, onCancel); }
                cb(pw);
            }, onCancel, t('save'));
        }, onCancel);
    }

    // A new account. pid null: a new profile (it becomes active); pid: this local profile becomes the account.
    function newAccount(pid, done) {
        var title = pid ? t('makeAccount') : t('newProfile');
        function back() { if (done) done(false); }
        askUser(title + ': ' + t('username'), '', function (user) {
            newPw(t('password'), function (pw) { send(user, pw); }, back);
        }, back);
        function send(user, pw) {
            App.toast(t('acctWorking'));
            Accounts.signUp(user, pw, pid, function (err, id) {
                if (err === 'taken') {
                    App.toast(t('userTaken'));
                    // the password is kept: only the username is typed again
                    return askUser(title + ': ' + t('username'), user, function (u2) { send(u2, pw); }, back);
                }
                if (err) { App.toast(errText(err)); return back(); }
                Accounts.unlock(id);
                if (pid) { App.toast(t('acctCreated')); if (done) done(true); return; }
                locked = false;
                close();
                Welcome.switchUser(id);
            });
        }
    }

    // an account made on another TV or phone: it is added here with its progress
    function signIn(prefill) {
        askUser(t('signInAcct') + ': ' + t('username'), prefill || '', function (user) {
            (function tryPw() {
                askPw(t('password') + ' (' + user + ')', '', function (pw) {
                    App.toast(t('acctWorking'));
                    Accounts.signIn(user, pw, function (err, id) {
                        if (err === 'wrong') { App.toast(t('wrongLogin')); return tryPw(); }
                        if (err) return App.toast(errText(err));
                        Accounts.unlock(id);
                        locked = false;
                        close();
                        Welcome.switchUser(id, true);
                    });
                }, null, t('signInAcct'));
            })();
        });
    }

    // the password of a profile before it is used. cb() when it is right
    function askPassword(id, cb, onCancel) {
        var p = Profiles.find(id);
        askPw(t('password') + ' (' + nameOf(p) + ')', '', function (pw) {
            Accounts.check(id, pw, function (ok, err) {
                if (!ok) {
                    App.toast(err && err !== 'wrong' ? errText(err) : t('wrongPw'));
                    return askPassword(id, cb, onCancel);
                }
                Accounts.unlock(id);
                cb();
            });
        }, onCancel, t('signInAcct'));
    }

    function changePassword(id, done) {
        askPw(t('pwOld'), '', function (old) {
            newPw(t('pwNew'), function (pw) {
                App.toast(t('acctWorking'));
                Accounts.changePassword(id, old, pw, function (err) {
                    App.toast(err ? (err === 'wrong' ? t('wrongPw') : errText(err)) : t('pwChanged'));
                    if (done) done(!err);
                });
            });
        });
    }

    // My PC starts on a profile that asks for its password: nothing else until it is typed (Back: other profiles)
    var locked = false;
    function gate() {
        var cur = Profiles.current();
        if (!Accounts.asks(cur.id) || Accounts.unlocked(cur.id)) { locked = false; return false; }
        locked = true;
        if ($('profiles').hidden) open();
        else Focus.set($('profiles'), renderList());
        askPassword(cur.id, function () { locked = false; close(); }, function () { Focus.set($('profiles'), renderList()); });
        return true;
    }

    function create() { newAccount(null); }

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
        App.confirm(I18n.t('deleteTitle'), I18n.t('deleteText').replace('%s', nameOf(p)) + (p.user ? ' ' + I18n.t('deleteAcctText') : ''), function () {
            Accounts.forget(p.id);
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
        $('profile-signin').onclick = function () { signIn(''); };
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
        screenOpen: screenOpen, screenAction: screenAction, nameOf: nameOf, avatar: avatar,
        gate: gate, newAccount: newAccount, signIn: function (u) { if ($('profiles').hidden) open(); signIn(u); },
        askPassword: askPassword, changePassword: changePassword
    };
})();
