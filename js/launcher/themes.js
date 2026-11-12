/* Themes: the look of the desktop, taskbar, Start menu and app windows, chosen per profile (Control Panel >
 * Personalization, or Accounts). Pure CSS (css/themes.css): one class on <html> (th-<id>), no images, no fonts to
 * download, nothing that runs per frame; the default (win11) adds no rule at all. Picking a theme also picks its
 * background, which can be changed after.
 *   Themes.LIST        [{ id, wp, clock, rings, widgets }]: clock = the Weather widget shows the clock beside it (its setting
 *                      "Show the clock" = With the theme), rings = System Monitor draws CPU / RAM / disk rings, widgets = turned on
 *                      when the theme is picked (only turned on, never off; the profile can hide them after)
 *   Themes.current()   the active profile's theme id
 *   Themes.set(id)     saves it for this profile and applies it
 *   Themes.apply()     puts the class on <html> (Desktop.render calls it) */
var Themes = (function () {
    'use strict';

    var LIST = [
        { id: 'win11', wp: 'bloom' },
        { id: 'win7', wp: 'aero' },
        { id: 'xp', wp: 'hills' },
        { id: 'mac', wp: 'dunes' },
        { id: 'android', wp: 'material' },
        { id: 'ios', wp: 'lagoon' },
        // owner request 2026-11-12: glass cards that glow on a night picture, a floating taskbar
        { id: 'neon', wp: 'nightlake', clock: true, rings: true, widgets: ['weather', 'sysmon', 'quick'] },
        // owner request 2026-11-12: an original look taken from game menus (slanted command bar, item slots, button hints)
        { id: 'quest', wp: 'quest', clock: true, rings: true, widgets: ['weather', 'sysmon', 'quick'] }
    ];

    function find(id) { for (var i = 0; i < LIST.length; i++) if (LIST[i].id === id) return LIST[i]; return null; }
    function current() { var id = Store.get('theme', 'win11'); return find(id) ? id : 'win11'; }

    function apply() {
        var html = document.documentElement, cur = current();
        for (var i = 0; i < LIST.length; i++) html.classList.toggle('th-' + LIST[i].id, LIST[i].id === cur);
        // the words a theme draws itself: XP's "start" button, the Mac menu bar title
        var st = document.getElementById('tb-start'), tray = document.querySelector('.tray');
        if (st) st.setAttribute('data-label', I18n.t('startWord'));
        if (tray) tray.setAttribute('data-title', I18n.t('appTitle'));
        if (st) st.setAttribute('data-title', I18n.t('appTitle'));
        // Neon night: the My PC mark beside the desktop's title (shown by that theme only)
        var h = document.getElementById('desk-title');
        if (h && !h.querySelector('.dt-ic') && window.Icons) { var ic = document.createElement('span'); ic.className = 'dt-ic'; ic.setAttribute('aria-hidden', 'true'); ic.innerHTML = Icons.svg('mypc'); h.insertBefore(ic, h.firstChild); }
        // Quest: the button hints on the command bar (A B, the Nintendo letters; drawn by that theme only)
        var tb = document.getElementById('taskbar'), hn = document.getElementById('th-hints');
        if (tb && cur === 'quest') {
            if (!hn) { hn = document.createElement('div'); hn.id = 'th-hints'; hn.className = 'th-hints'; hn.setAttribute('aria-hidden', 'true'); tb.appendChild(hn); }
            hn.innerHTML = '';
            [['A', I18n.t('storeOpen')], ['A', I18n.t('thHoldMore'), 'hold'], ['B', I18n.t('back')]].forEach(function (x) {
                var s = document.createElement('span'), b = document.createElement('b');
                b.textContent = x[0];
                if (x[2]) b.className = x[2];
                s.appendChild(b); s.appendChild(document.createTextNode(x[1]));
                hn.appendChild(s);
            });
        } else if (hn) hn.parentNode.removeChild(hn);
    }

    function set(id) {
        var th = find(id);
        if (!th) return;
        Store.set('theme', id);
        if (window.Desktop) Desktop.setWallpaper(th.wp);
        apply();
        if (window.Widgets) {
            (th.widgets || []).forEach(function (w) { var c = Widgets.conf(w); if (c && !c.show) Widgets.set(w, 'show', true); });
            Widgets.render();                      // the theme draws some widgets its own way (clock, rings)
        }
    }

    return { LIST: LIST, current: current, set: set, apply: apply, find: find };
})();
