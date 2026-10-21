/* Themes: the look of the desktop, taskbar, Start menu and app windows, chosen per profile (Control Panel >
 * Personalization, or Accounts). Pure CSS (css/themes.css): one class on <html> (th-<id>), no images, no fonts to
 * download, nothing that runs per frame; the default (win11) adds no rule at all. Picking a theme also picks its
 * background, which can be changed after.
 *   Themes.LIST        [{ id, wp }]
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
        { id: 'ios', wp: 'lagoon' }
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
    }

    function set(id) {
        var th = find(id);
        if (!th) return;
        Store.set('theme', id);
        if (window.Desktop) Desktop.setWallpaper(th.wp);
        apply();
    }

    return { LIST: LIST, current: current, set: set, apply: apply, find: find };
})();
