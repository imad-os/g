/* Touch controls for every app and game: when My PC runs on a touch device (a phone or tablet app, or a touch browser),
 * the SHELL draws a customizable virtual pad above the app and feeds the same input path as the remote and gamepads
 * (Input.touch -> actions, device 'touch'). Apps and games need no touch code. The pad is the virtual-pad library
 * (js/core/virtual-pad.js, source: sdk/pad/virtual-pad.js). Never drawn on a TV, and not while a gamepad is the active input.
 *   Manifest / mypc-app.json:  "touch": false | { "buttons": [{ "label": "A", "action": "ok" }], "catalog": [...], "scale": { "stick": 1, "btn": 1 } }
 *   (false = the app has its own touch UI; labels are 3 characters at most; actions ok run cancel menu; 8 entries at most)
 *   MyPC.init({ pad: false | { ... } }) says the same from the app (it wins over the manifest; true = no preference);
 *   MyPC.pad.init({ force: true, buttons, onAction | send }) inside the app: the app wants a pad of its own (e.g. a phone that is
 *   only a controller). The shell draws THAT one instead (any action names, shown on any device while the app runs) and sends the
 *   presses back to the app (relay), so it has the right size, sits above the app and hides under My PC's menus too.
 * Hidden while My PC's own screens are open (pause menu, multiplayer): it is only shown while the app runs.
 *   TouchPad.begin(id, manifestTouch) / .end()          an app starts / ends
 *   TouchPad.app(padOption) / .own(bool)                from the app (hello, 'pad' message)
 *   TouchPad.state(s)                                   game-host state: shown only while 'running' (or while its settings are open)
 *   TouchPad.available() / .settings()                  pause menu entry "Touch pad settings"
 *   TouchPad.clean(t)                                   validates a "touch" value (also used on what the store delivers) */
var TouchPad = (function () {
    'use strict';

    var ACTIONS = { ok: 1, run: 1, cancel: 1, menu: 1 };
    var MAX_ENTRIES = 8, LABEL_MAX = 3;
    var cur = null, appPad = null, own = false, ownCfg = null, relay = null, gameState = 'idle', settingsOpen = false, fromPause = false, held = false, listening = false;

    function hash(s) { var h = 7, i; for (i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 8999; return 1000 + h; }
    // [{ label, action }] -> the library's buttons { label, key, action }; the key is made from the content so a saved layout stays valid
    function list(a) {
        var out = [], seen = {}, i, b, k;
        if (!(a instanceof Array)) return null;
        for (i = 0; i < a.length && out.length < MAX_ENTRIES; i++) {
            b = a[i];
            if (!b || typeof b.label !== 'string' || !b.label.length || b.label.length > LABEL_MAX || !ACTIONS.hasOwnProperty(b.action)) continue;
            k = hash(b.label + '|' + b.action);
            if (seen[k]) continue;
            seen[k] = 1;
            out.push({ label: b.label, action: b.action, key: k });
        }
        return out.length ? out : null;
    }
    var DEFAULT = list([{ label: 'A', action: 'ok' }, { label: 'B', action: 'run' }]);
    var CATALOG = list([{ label: 'A', action: 'ok' }, { label: 'B', action: 'run' }, { label: 'C', action: 'cancel' }, { label: '☰', action: 'menu' }]);

    // false -> { off: true }; true / nothing / garbage -> defaults; an object -> its valid parts
    function clean(t) {
        var out = {}, b, c, s;
        if (t === false) return { off: true };
        if (!t || typeof t !== 'object' || t instanceof Array) return { buttons: DEFAULT, catalog: CATALOG, scale: {} };
        b = list(t.buttons); c = list(t.catalog);
        out.buttons = b || (c ? c.slice(0, 2) : DEFAULT);
        out.catalog = c || (b ? b : CATALOG);
        out.scale = {};
        if (t.scale && typeof t.scale === 'object') {
            s = +t.scale.stick; if (s >= 0.5 && s <= 2.5) out.scale.stick = s;
            s = +t.scale.btn; if (s >= 0.5 && s <= 2.5) out.scale.btn = s;
        }
        return out;
    }

    // the app's own pad (MyPC.pad.init in the app; untrusted): any action names, key codes optional
    function cleanOwn(c) {
        if (!c || typeof c !== 'object') return null;
        function ownList(a) {
            var out = [], seen = {}, i, b;
            if (!(a instanceof Array)) return null;
            for (i = 0; i < a.length && out.length < MAX_ENTRIES; i++) {
                b = a[i];
                if (!b || typeof b.label !== 'string' || !b.label.length || b.label.length > LABEL_MAX || typeof b.key !== 'number' || b.key < 0 || b.key > 99999 || seen[b.key]) continue;
                seen[b.key] = 1;
                out.push(typeof b.action === 'string' && /^[a-z0-9_-]{1,16}$/i.test(b.action) ? { label: b.label, key: b.key, action: b.action } : { label: b.label, key: b.key });
            }
            return out.length ? out : null;
        }
        var buttons = ownList(c.buttons), catalog = ownList(c.catalog) || buttons;
        if (!buttons) return null;
        var scale = clean({ scale: c.scale }).scale;
        return { id: typeof c.id === 'string' ? c.id.slice(0, 24) : 'own', buttons: buttons, catalog: catalog, scale: scale, pause: c.pause !== false, customize: c.customize !== false };
    }

    function forced() {
        var m = /[?&]pad=(\d)/.exec(location.search);
        if (m) Store.rawSet('arc_dev_touchpad', m[1] === '1' ? 1 : 0);        // a debugging switch that is kept: ?pad=1 / ?pad=0
        return Store.rawGet('arc_dev_touchpad');
    }
    function coarse() { try { return window.matchMedia('(pointer:coarse)').matches; } catch (e) { return false; } }
    // a touch device, not a TV, no gamepad in use (or forced for debugging)
    function deviceWants() {
        var f = forced();
        if (f === 0) return false;
        if (f === 1) return true;
        return coarse() && !window.tizen && Input.device() !== 'pad';
    }

    function want() { return !!(cur && ((own && ownCfg) || (cur.cfg && !cur.cfg.off && !own && deviceWants()))); }

    function onAction(action, down) {
        if (fromPause) return;
        if (own) { if (relay) relay({ action: action, down: down }); }
        else Input.touch(action, down);
    }
    function onKey(code, down) { if (!fromPause && own && relay) relay({ key: code, down: down }); }
    function onSettings(open) {
        settingsOpen = open;
        if (open) held = GameHost.hold();                  // the game waits while the player arranges the pad
        else { GameHost.release(held); held = false; fromPause = false; sync(); }
    }
    function build() {
        var c = own ? ownCfg : cur.cfg;
        VirtualPad.init({ id: 'app:' + cur.id + (own ? ':own' : ''), buttons: c.buttons, catalog: c.catalog, scale: c.scale, force: true, onAction: onAction, onSettings: onSettings,
                          send: own ? onKey : undefined, pause: own ? c.pause : undefined, customize: own ? c.customize : undefined });
    }
    function sync() {
        var show = want() && (gameState === 'running' || settingsOpen || fromPause);
        if (show && !VirtualPad.active()) build();
        else if (!show && VirtualPad.active()) VirtualPad.hide();
    }
    function resolve() { if (cur) cur.cfg = clean(appPad !== null && appPad !== undefined ? appPad : cur.manifest); }

    return {
        clean: clean,
        begin: function (id, manifestTouch) {
            cur = { id: id, manifest: manifestTouch, cfg: null }; appPad = null; own = false; ownCfg = null; settingsOpen = false; fromPause = false;
            resolve();
            if (!listening) { listening = true; Input.onDevice(function () { sync(); }); }
        },
        end: function () { if (VirtualPad.active()) VirtualPad.hide(); cur = null; appPad = null; own = false; ownCfg = null; relay = null; settingsOpen = false; fromPause = false; held = false; },
        app: function (pad) { appPad = pad === undefined || pad === true ? null : pad; resolve(); sync(); },
        relay: function (fn) { relay = fn; },
        // the app draws its own pad (cfg) or gives it back (on = false): rebuilt so the right one is shown
        own: function (on, cfg) {
            if (VirtualPad.active()) VirtualPad.hide();
            own = !!on; ownCfg = on ? cleanOwn(cfg) : null;
            if (own && !ownCfg) own = false;
            sync();
        },
        state: function (s) { gameState = s; sync(); },
        available: function () { return want(); },
        settings: function () { if (!want()) return; fromPause = true; sync(); VirtualPad.openSettings(); }
    };
})();
