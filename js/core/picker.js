/* Profile picker: one tile per profile (+ Guest, + "New profile" on the home page) and an optional
 * "Default" checkbox. Used when a game starts (home page) and when player 2 joins (game page).
 * Markup: #picker (see app.html / game-app.html). Input arrives through the page router. */
var Picker = (function () {
    'use strict';
    var cfg = null, defaultOn = false, open = false;

    function $(id) { return document.getElementById(id); }
    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }
    function nameOf(p) { return Profiles.name(p, I18n.t('player'), I18n.t('guest')); }

    function drawCheck() {
        var c = $('picker-default');
        c.setAttribute('aria-checked', defaultOn ? 'true' : 'false');
        c.className = 'btn check' + (defaultOn ? ' check-on' : '');
        $('picker-default-box').textContent = defaultOn ? '✓' : '';
    }

    function tile(p, focusTarget) {
        var b = el('button', 'pcard');
        b.setAttribute('data-focus', '');
        b.setAttribute('role', 'listitem');
        b.setAttribute('data-profile', p.id);
        b.appendChild(Avatars.make(p, 'avatar avatar-big'));
        b.appendChild(el('span', 'pcard-name', nameOf(p)));
        b.setAttribute('aria-label', nameOf(p) + '. ' + I18n.t('pickHint'));
        b.onclick = function () { choose(p.id); };
        return b;
    }

    function render() {
        var box = $('picker-list'), l = Profiles.list(), cur = cfg.preselect || Profiles.current().id, target = null, i, b;
        box.innerHTML = '';
        var all = [];
        if (!cfg.guestLast) all.push(Profiles.GUEST);
        for (i = 0; i < l.length; i++) all.push(l[i]);
        if (cfg.guestLast) all.push(Profiles.GUEST);
        for (i = 0; i < all.length; i++) {
            b = tile(all[i]);
            if (all[i].id === cur) target = b;
            box.appendChild(b);
        }
        if (cfg.onNew && l.length < Profiles.MAX) {
            b = el('button', 'pcard pcard-new');
            b.setAttribute('data-focus', '');
            b.setAttribute('role', 'listitem');
            b.setAttribute('data-new', '1');
            var plus = el('span', 'avatar avatar-big avatar-plus', '+');
            plus.setAttribute('aria-hidden', 'true');
            b.appendChild(plus);
            b.appendChild(el('span', 'pcard-name', I18n.t('newProfile')));
            b.setAttribute('aria-label', I18n.t('newProfile'));
            b.onclick = function () { var f = cfg.onNew; close(true); f(); };
            box.appendChild(b);
        }
        return target || box.firstChild;
    }

    function choose(id) {
        var f = cfg.onPick, d = defaultOn && cfg.showDefault;
        close(true);
        if (d) Profiles.setDefault(id);
        f(id, d);
    }

    // opts: { title, onPick(profileId, madeDefault), onCancel(), onNew(), showDefault, preselect, guestLast }
    function show(opts) {
        cfg = opts;
        defaultOn = false;
        open = true;
        $('picker-title').textContent = opts.title || I18n.t('whoPlays');
        $('picker-default').hidden = !opts.showDefault;
        drawCheck();
        var first = render();
        $('picker').hidden = false;
        I18n.apply($('picker'));
        Focus.push($('picker'), first);
        A11y.announce($('picker-title').textContent);
    }

    function close(silent) {
        if (!open) return;
        open = false;
        $('picker').hidden = true;
        Focus.pop();
        var cb = cfg && cfg.onCancel;
        if (!silent && cb) cb();
    }

    function toggleDefault() {
        defaultOn = !defaultOn;
        drawCheck();
        A11y.announce(I18n.t('makeDefault') + ': ' + I18n.t(defaultOn ? 'on' : 'off'));
    }

    function action(a, repeat) {
        if ((a === 'back' || a === 'cancel') && !repeat) close(false);
        else if (a === 'left' || a === 'right' || a === 'up' || a === 'down') Focus.move(a);
        else if (a === 'confirm' && !repeat) { var c = Focus.current(); if (c) c.click(); }
    }

    function init() { $('picker-default').onclick = toggleDefault; }

    return { init: init, show: show, close: function () { close(false); }, action: action, isOpen: function () { return open; } };
})();
