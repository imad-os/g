/* Full-screen app window. One app at a time: the desktop is hidden (covers released, clock
 * stopped) while an app runs, and the app's DOM, timers and iframes are destroyed when it closes.
 *
 * App definition, registered with Win.register(id, def):
 *   title()            window title (translated)
 *   icon               Icons name
 *   open(body, arg)    builds the app into body; returns the element to focus first
 *   close()            frees everything (timers, iframes, listeners)
 *   action(a, repeat)  optional: return true when the app used the key itself
 *   back()             optional: return true when Back was used inside the app (e.g. go up a folder)
 */
var Win = (function () {
    'use strict';

    var apps = {}, cur = null, curId = null;

    function $(id) { return document.getElementById(id); }

    function register(id, def) { apps[id] = def; }

    function open(id, arg) {
        var def = apps[id];
        if (!def) return;
        if (cur) close(true);
        Desktop.hide();
        Desktop.releaseImages();
        cur = def; curId = id;
        Icons.put($('win-icon'), def.icon);
        $('win-title').textContent = def.title();
        Icons.put($('win-close'), 'close');
        var body = $('win-body');
        body.innerHTML = '';
        body.className = 'win-body app-' + id;
        $('window').hidden = false;
        var first = null;
        try { first = def.open(body, arg); } catch (e) { try { console.warn('[Win] ' + id + ': ' + e); } catch (e2) {} }
        I18n.apply($('window'));
        Focus.reset();
        Focus.set($('window'), first || $('win-close'));
        A11y.announce(def.title());
    }

    // quiet = something else takes the screen next (a game, another app)
    function close(quiet) {
        if (!cur) return;
        var id = curId;
        try { if (cur.close) cur.close(); } catch (e) {}
        cur = null; curId = null;
        $('win-body').innerHTML = '';
        $('window').hidden = true;
        if (!quiet) Desktop.show(Desktop.iconForApp(id));
    }

    // settings that change other parts (profile, language) ask the open app to redraw
    function refresh() { if (cur && cur.refresh) { try { cur.refresh(); } catch (e) {} } }

    function setTitle(t) { $('win-title').textContent = t; }

    // router (main.js)
    function action(a, repeat, dev) {
        if (!cur) return;
        if (cur.action && cur.action(a, repeat, dev)) return;
        if (a === 'back' || a === 'cancel') {
            if (repeat) return;
            if (cur.back && cur.back()) return;
            return close();
        }
        if (a === 'left' || a === 'right' || a === 'up' || a === 'down') Focus.move(a);
        else if (a === 'confirm' && !repeat) { var c = Focus.current(); if (c) c.click(); }
    }

    function init() { $('win-close').onclick = function () { close(); }; }

    return {
        init: init, register: register, open: open, close: close, action: action, setTitle: setTitle, refresh: refresh,
        isOpen: function () { return !!cur; }, current: function () { return curId; }
    };
})();
