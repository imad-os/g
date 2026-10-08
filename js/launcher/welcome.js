/* Sign-in style screens, like Windows:
 *   Welcome.switchUser(id)  "Hi, <name>" with the user's avatar and a spinner, then the app restarts as that
 *                           profile (language, clock, background... all load from the profile's own settings)
 *   Welcome.afterBoot()     on the new page: the same welcome screen fades out; after an update the screen
 *                           says that My PC was updated (shown once per new build); after a restore from the
 *                           cloud (reinstalled My PC, reset TV) it says that the data came back
 * Plain transforms and opacity only (cheap on a 1 GB TV). */
var Welcome = (function () {
    'use strict';
    var box = null, timer = 0, blocking = false;

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }

    function spinner() {
        var s = el('div', 'bs-spin');
        for (var i = 0; i < 5; i++) s.appendChild(document.createElement('i'));
        return s;
    }

    function build(kind, p, title, sub) {
        close(true);
        box = el('div', 'welcome welcome-' + kind);
        box.setAttribute('role', 'alert');
        var c = el('div', 'welcome-card');
        if (kind === 'user') c.appendChild(ProfilesUI.avatar(p, 'avatar welcome-avatar'));
        else { var ic = el('div', 'welcome-logo'); ic.innerHTML = Icons.svg('mypc').replace(/gM/g, 'gW'); c.appendChild(ic); /* own gradient id: the one in the hidden loading screen would not resolve */ }
        c.appendChild(el('h1', 'welcome-title', title));
        if (sub) c.appendChild(el('p', 'welcome-sub', sub));
        if (kind !== 'update') c.appendChild(spinner());
        box.appendChild(c);
        document.body.appendChild(box);
        A11y.announce(title + (sub ? '. ' + sub : ''));
    }

    function close(now) {
        clearTimeout(timer);
        blocking = false;
        if (!box) return;
        var b = box;
        box = null;
        if (now) { if (b.parentNode) b.parentNode.removeChild(b); return; }
        b.className += ' bye';
        setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 450);
    }

    // restart as another profile
    function switchUser(id, force) {
        if (id === Profiles.current().id && !force) return;
        Profiles.use(id);
        var p = Profiles.current();
        blocking = true;
        build('user', p, I18n.t('switching'), Profiles.name(p, I18n.t('player')));
        timer = setTimeout(function () {
            var url = location.href.split(/[?#]/)[0];
            location.replace(url + '?user=1');
        }, 1300);
    }

    function updated() {
        var seen = Store.rawGet('arc_dev_seen_build'), now = AppBoot.build();
        if (typeof now !== 'number') return false;
        Store.set('seen_build', now);
        return typeof seen === 'number' && seen < now;
    }

    function afterBoot() {
        var fromSwitch = /[?&]user=1/.test(location.search), up = updated(), p = Profiles.current();
        var restored = /[?&]restored=1/.test(location.search);
        if (restored) {
            blocking = true;
            build('update', p, I18n.t('restoredTitle'), I18n.t('restoredSub'));
            timer = setTimeout(function () { close(); }, 3500);
        } else if (up) {
            blocking = true;
            build('update', p, I18n.t('updatedTitle'), I18n.t('updatedSub').replace('%s', AppBoot.version()));
            timer = setTimeout(function () { close(); }, 2800);
        } else if (fromSwitch) {
            blocking = true;
            build('user', p, I18n.t('hello') + ', ' + Profiles.name(p, I18n.t('player')) + '!', I18n.t('preparing'));
            timer = setTimeout(function () { close(); }, 1100);
        }
        if (fromSwitch || restored) { try { history.replaceState(null, '', location.href.split('?')[0]); } catch (e) {} }
    }

    // the router: while a screen is up, keys do nothing, except OK / Back dismiss the update message
    function action(a, pressed) {
        if (!box) return false;
        if (pressed && box.className.indexOf('welcome-update') >= 0 && (a === 'confirm' || a === 'back' || a === 'cancel')) close();
        return true;
    }

    return { switchUser: switchUser, afterBoot: afterBoot, action: action, open: function () { return !!box && blocking; } };
})();
