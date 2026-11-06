/* My PC's Google Drive screens (js/core/gdrive.js), over the desktop, an app or a game:
 *   DriveUI.signIn(cb)     a QR code for drive-signin.html (phone sign-in, whole Drive) or, without it, Google's device flow
 *                          (a QR code for google.com/device and the code to type), and the wait.
 *                          cb(err, account) once signed in (err.code 'cancelled' when the user leaves).
 *   DriveUI.addFiles(cb)   a QR code for drive-picker.html: the phone picks existing Drive files My PC may then open
 *                          (scope drive.file). cb() when closed.
 *   DriveUI.screenOpen() / DriveUI.action(a, pressed, repeat)   the router (main.js) sends it every key while open.
 * Used by Control Panel > Google Drive, the Music app and MyPC.drive.signIn() / addFiles() (js/launcher/bridges.js). */
var DriveUI = (function () {
    'use strict';

    var box = null, flow = null, done = null, onBack = null;

    function t(k) { return I18n.t(k); }
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
    function btn(label, primary, run) {
        var b = el('button', 'btn' + (primary ? ' btn-primary' : ''), label);
        b.setAttribute('data-focus', '');
        b.onclick = run;
        return b;
    }

    function open() {
        if (box) return box;
        box = el('div', 'backdrop gdui-back');
        box.id = 'gdui';
        var card = el('div', 'dialog gdui');
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-modal', 'true');
        card.setAttribute('aria-labelledby', 'gdui-title');
        box.appendChild(card);
        (document.getElementById('stage') || document.body).appendChild(box);
        Focus.push(card, null);
        return box;
    }
    function close() {
        if (flow) { var f = flow; flow = null; f.cancel(); }
        if (!box) return;
        if (box.parentNode) box.parentNode.removeChild(box);
        box = null; onBack = null;
        Focus.pop();
    }
    function finish(e, r) { var cb = done; done = null; close(); if (cb) cb(e, r); }

    // o: { title, text, qr, code, codeLabel, status, buttons: [[label, primary, run]] }
    function paint(o) {
        open();
        var card = box.firstChild, first = null, firstMain = false;
        card.innerHTML = '';
        var h = el('h2', 'dialog-title', o.title); h.id = 'gdui-title';
        card.appendChild(h);
        var row = el('div', 'gdui-row');
        if (o.qr) { var q = el('div', 'set-qr-img gdui-qr'); q.innerHTML = QR.svg(o.qr, { quiet: 3 }); row.appendChild(q); }
        var txt = el('div', 'gdui-txt');
        (o.lines || []).forEach(function (l) { txt.appendChild(el('p', 'gdui-line', l)); });
        if (o.code) txt.appendChild(el('div', 'gdui-code', o.code));
        if (o.status) { var s = el('p', 'gdui-status' + (o.error ? ' err' : ''), o.status); s.setAttribute('role', o.error ? 'alert' : 'status'); txt.appendChild(s); }
        row.appendChild(txt);
        card.appendChild(row);
        var bs = el('div', 'dialog-buttons');
        (o.buttons || []).forEach(function (b) { var x = btn(b[0], b[1], b[2]); bs.appendChild(x); if (!first || (b[1] && !firstMain)) { first = x; firstMain = !!b[1]; } });
        card.appendChild(bs);
        Focus.set(card, first);
        A11y.announce(o.title + '. ' + (o.lines || []).join(' ') + (o.code ? ' ' + o.code.split('').join(' ') : '') + (o.status ? '. ' + o.status : ''));
    }

    function errText(e) {
        var c = e && e.code;
        if (c === 'noconfig') return t('gdNoConfig');
        if (c === 'denied') return t('gdDenied');
        if (c === 'expired') return t('gdExpired');
        if (c === 'network' || c === 'timeout') return t('gdOffline');
        return t('gdFailed') + ' (' + ((e && e.message) || c || '?') + ')';
    }

    function signIn(cb) {
        if (done) { var old = done; done = null; old({ code: 'cancelled', message: 'Cancelled.' }); }
        done = cb || null;
        if (flow) { var f0 = flow; flow = null; f0.cancel(); }
        onBack = function () { finish({ code: 'cancelled', message: 'Cancelled.' }); };
        paint({ title: t('gdSignInTitle'), lines: [t('gdAsking')], buttons: [[t('cancel'), false, onBack]] });
        function start() {
            if (!GDrive.config()) {
                return paint({ title: t('gdSignInTitle'), lines: [t('gdNoConfig')], error: true, buttons: [[t('gdClose'), true, onBack]] });
            }
            var mine = flow = GDrive.signIn(function (c) {
                if (flow !== mine || !box) return;
                if (c.phone) {      // full Drive: the phone signs in on Google's page, the TV goes on by itself
                    return paint({ title: t('gdSignInTitle'), qr: c.url, lines: [t('gdPhone1'), t('gdPhone2')], status: t('gdPhoneWait'), buttons: [[t('cancel'), false, onBack]] });
                }
                var url = c.url, short = url.replace(/^https?:\/\/(www\.)?/, '');
                paint({ title: t('gdSignInTitle'), qr: url, lines: [t('gdStep1').replace('%s', short), t('gdStep2')], code: c.userCode,
                        status: t('gdWaiting'), buttons: [[t('cancel'), false, onBack]] });
            }, function (e, acc) {
                if (flow !== mine) return;
                flow = null;
                if (!e) { App.toast(t('gdSignedIn').replace('%s', acc.email || acc.name), { kind: 'ok', id: 'gdrive' }); return finish(null, acc); }
                if (e.code === 'cancelled') return;
                paint({ title: t('gdSignInTitle'), lines: [errText(e)], error: true, buttons: [[t('gdTryAgain'), true, start], [t('gdClose'), false, onBack]] });
            });
        }
        if (GDrive.config()) start(); else GDrive.syncConfig(function () { if (box && done === cb) start(); });
    }

    function addFiles(cb) {
        if (done) { var old = done; done = null; old({ code: 'cancelled', message: 'Cancelled.' }); }
        done = function () { if (cb) cb(); };
        onBack = function () { finish(null); };
        var url = GDrive.pickerUrl(), acc = GDrive.active();
        if (!url) return paint({ title: t('gdAddTitle'), lines: [t('gdNoPicker')], buttons: [[t('gdClose'), true, onBack]] });
        paint({ title: t('gdAddTitle'), qr: url, lines: [t('gdAddText').replace('%s', acc ? acc.email : ''), t('gdAddAfter')], buttons: [[t('gdDone'), true, onBack]] });
    }

    function screenOpen() { return !!box; }
    function action(a, pressed, repeat) {
        if (!pressed) return;
        if (a === 'left' || a === 'right' || a === 'up' || a === 'down') return Focus.move(a);
        if (a === 'confirm' && !repeat) { var c = Focus.current(); if (c) c.click(); return; }
        if ((a === 'back' || a === 'cancel') && !repeat && onBack) onBack();
    }

    return { signIn: signIn, addFiles: addFiles, screenOpen: screenOpen, action: action, close: function () { finish({ code: 'cancelled', message: 'Cancelled.' }); } };
})();
