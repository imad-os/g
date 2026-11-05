/* Remote shortcuts (owner request 2026-11-05): a button of the TV remote runs an action, per profile.
 * Defaults (only these two): Play / Pause = play or pause the music, Guide = the users screen (switch user).
 * Each profile can add, change or remove its own in Control Panel > Shortcuts (Store key 'shortcuts': [{ key, act, arg, name }]).
 *
 * Input.onKey calls the hook below before its own key map: a button with a shortcut does only the shortcut (its built-in
 * use, e.g. Guide = Start, is replaced for that profile). Only the buttons this profile uses are registered on the TV
 * (Samsung gives every other button its normal TV use). While the Memo or Music app is open, their own media keys
 * (Play / Pause, Record...) stay theirs.
 * In a game (the game page has no desktop): music and My PC's menu act at once; an action that opens something asks
 * first, then the game closes and the desktop runs it (profile key sc_next). */
var Shortcuts = (function () {
    'use strict';

    // every remote button that can be mapped: id, Tizen key name, keyCodes (the TV's real code replaces the first one),
    // label key (or a plain label), use: the built-in use that a shortcut replaces
    var BUTTONS = [
        { id: 'playpause', tv: 'MediaPlayPause', codes: [10252, 179], label: 'scb_playpause', use: 'scu_pause' },
        { id: 'play', tv: 'MediaPlay', codes: [415], label: 'scb_play', use: 'scu_pause' },
        { id: 'pause', tv: 'MediaPause', codes: [19], label: 'scb_pause', use: 'scu_pause' },
        { id: 'stop', tv: 'MediaStop', codes: [413, 178], label: 'scb_stop' },
        { id: 'rew', tv: 'MediaRewind', codes: [412], label: 'scb_rew' },
        { id: 'ff', tv: 'MediaFastForward', codes: [417], label: 'scb_ff' },
        { id: 'prev', tv: 'MediaTrackPrevious', codes: [10232, 177], label: 'scb_prev' },
        { id: 'next', tv: 'MediaTrackNext', codes: [10233, 176], label: 'scb_next' },
        { id: 'record', tv: 'MediaRecord', codes: [416], label: 'scb_record', use: 'scu_record' },
        { id: 'guide', tv: 'Guide', codes: [458], label: 'scb_guide', use: 'scu_guide' },
        { id: 'info', tv: 'Info', codes: [457], label: 'scb_info' },
        { id: 'red', tv: 'ColorF0Red', codes: [403], label: 'scb_red', use: 'scu_red' },
        { id: 'green', tv: 'ColorF1Green', codes: [404], label: 'scb_green' },
        { id: 'yellow', tv: 'ColorF2Yellow', codes: [405], label: 'scb_yellow' },
        { id: 'blue', tv: 'ColorF3Blue', codes: [406], label: 'scb_blue' },
        { id: 'chup', tv: 'ChannelUp', codes: [427], label: 'scb_chup', use: 'scu_page' },
        { id: 'chdown', tv: 'ChannelDown', codes: [428], label: 'scb_chdown', use: 'scu_page' },
        { id: 'chlist', tv: 'ChannelList', codes: [10073], label: 'scb_chlist' },
        { id: 'prech', tv: 'PreviousChannel', codes: [10190], label: 'scb_prech' },
        { id: 'tools', tv: 'Tools', codes: [10135], label: 'scb_tools' },
        { id: 'search', tv: 'Search', codes: [10225], label: 'scb_search' },
        { id: 'caption', tv: 'Caption', codes: [10221], label: 'scb_caption' },
        { id: 'emanual', tv: 'E-Manual', codes: [10146], label: 'scb_emanual' }
    ];
    for (var n = 1; n <= 10; n++) BUTTONS.push({ id: 'n' + (n % 10), tv: String(n % 10), codes: [48 + n % 10], num: n % 10 });

    // what a button can do; arg: 'app' (an app or game id) or 'page' (a Control Panel page)
    var ACTIONS = [
        { id: 'music', label: 'sca_music' },
        { id: 'musicNext', label: 'sca_musicNext' },
        { id: 'musicPrev', label: 'sca_musicPrev' },
        { id: 'users', label: 'sca_users', opens: true },
        { id: 'app', label: 'sca_app', arg: 'app', opens: true },
        { id: 'page', label: 'sca_page', arg: 'page', opens: true },
        { id: 'start', label: 'sca_start', opens: true },
        { id: 'home', label: 'sca_home' },
        { id: 'menu', label: 'sca_menu' }
    ];
    var DEFAULTS = [{ key: 'playpause', act: 'music' }, { key: 'guide', act: 'users' }];
    var MAX = 40;
    var OWN_MEDIA = { memo: 1, music: 1 };      // these apps keep their media keys (Play / Pause, Record...)
    var MEDIA_USE = { scu_pause: 1, scu_record: 1 };

    var codeMap = {};               // keyCode -> button id (for this profile's shortcuts)
    var held = {};                  // keyCode -> true while a shortcut key is held (no repeat, its keyup is swallowed)
    var registered = {};            // Tizen key names registered by us
    var pages = [];                 // Control Panel pages ([{ id, label }]), given by apps/settings.js
    var listeners = [];

    function t(k) { return I18n.t(k); }
    function button(id) { for (var i = 0; i < BUTTONS.length; i++) if (BUTTONS[i].id === id) return BUTTONS[i]; return null; }
    function actionDef(id) { for (var i = 0; i < ACTIONS.length; i++) if (ACTIONS[i].id === id) return ACTIONS[i]; return null; }
    function valid(s) { return !!(s && button(s.key) && actionDef(s.act) && (!actionDef(s.act).arg || s.arg)); }

    function list() {
        var l = Store.get('shortcuts', null);
        if (!Array.isArray(l)) return DEFAULTS.map(function (s) { return { key: s.key, act: s.act }; });
        return l.filter(valid);
    }
    function save(l) {
        Store.set('shortcuts', l.filter(valid).slice(0, MAX).map(function (s) {
            var o = { key: s.key, act: s.act };
            if (s.arg) { o.arg = String(s.arg); if (s.name) o.name = String(s.name).slice(0, 60); }
            return o;
        }));
        apply();
        for (var i = 0; i < listeners.length; i++) { try { listeners[i](); } catch (e) {} }
    }
    // one shortcut per button: setting a button that has one already replaces it. i: index to replace (or -1 to add)
    function put(i, s) {
        var l = list();
        if (!valid(s)) return false;
        for (var j = l.length - 1; j >= 0; j--) if (j !== i && l[j].key === s.key) { l.splice(j, 1); if (j < i) i--; }
        if (i >= 0 && i < l.length) l[i] = s; else l.push(s);
        save(l);
        return true;
    }
    function remove(i) { var l = list(); if (i >= 0 && i < l.length) { l.splice(i, 1); save(l); } }
    function reset() { Store.set('shortcuts', null); apply(); for (var i = 0; i < listeners.length; i++) { try { listeners[i](); } catch (e) {} } }
    function forKey(key) { var l = list(); for (var i = 0; i < l.length; i++) if (l[i].key === key) return l[i]; return null; }

    // the TV's real keyCode for a key name (Samsung gives it in getSupportedKeys)
    var tvCodes = null;
    function tvCode(name) {
        if (tvCodes === null) {
            tvCodes = {};
            try { var sup = tizen.tvinputdevice.getSupportedKeys() || []; for (var i = 0; i < sup.length; i++) tvCodes[sup[i].name] = sup[i].code; } catch (e) {}
        }
        return tvCodes[name];
    }

    // this profile's keys: the code map, and on the TV only these keys registered (others keep their TV use)
    function apply() {
        codeMap = {};
        var l = list(), want = {}, i, j, b;
        for (i = 0; i < l.length; i++) {
            b = button(l[i].key);
            var c = tvCode(b.tv);
            if (c) codeMap[c] = b.id;
            for (j = 0; j < b.codes.length; j++) codeMap[b.codes[j]] = b.id;
            want[b.tv] = true;
        }
        var tvi = window.tizen && tizen.tvinputdevice;
        if (!tvi) return;
        for (var k in want) if (!registered[k]) { try { tvi.registerKey(k); registered[k] = true; } catch (e) {} }
        for (var r in registered) if (registered[r] && !want[r] && Input.TV_KEYS.indexOf(r) < 0) { try { tvi.unregisterKey(r); } catch (e2) {} registered[r] = false; }
    }

    // Input's key hook: true = the key was a shortcut (Input does nothing more with it)
    // "press the button": for a few seconds every remote button is registered and the next one pressed is reported
    // (Control Panel > Shortcuts > Button). cb(id) with the button, cb(null, 'cancel') on Back, cb(null, 'timeout').
    var capture = null;
    function codeButton(code) {
        for (var i = 0; i < BUTTONS.length; i++) {
            var b = BUTTONS[i];
            if (b.codes.indexOf(code) >= 0 || (tvCode(b.tv) === code && code)) return b;
        }
        return null;
    }
    function listen(cb, ms) {
        stopListen();
        var tvi = window.tizen && tizen.tvinputdevice;
        if (tvi) for (var i = 0; i < BUTTONS.length; i++) { var k = BUTTONS[i].tv; if (!registered[k]) { try { tvi.registerKey(k); registered[k] = true; } catch (e) {} } }
        capture = { cb: cb, timer: setTimeout(function () { finish(null, 'timeout'); }, ms || 5000), down: {} };
    }
    function finish(id, why) {
        var c = capture;
        if (!c) return;
        clearTimeout(c.timer);
        capture = null;
        apply();                                             // back to only this profile's keys
        try { c.cb(id, why); } catch (e) {}
    }
    function stopListen() { if (capture) { clearTimeout(capture.timer); capture = null; apply(); } }
    function captureKey(code, down) {
        if (!down) { if (!held[code]) return false; held[code] = false; return true; }   // a key pressed before (OK on the row) is let go normally
        held[code] = true;                                   // its keyup is swallowed too
        if (code === 10009 || code === 27 || code === 8) { finish(null, 'cancel'); return true; }
        var b = codeButton(code);
        if (b) finish(b.id);
        else if (window.App) App.toast(t('scCantUse'), { id: 'shortcut', kind: 'warn', timeout: 2000 });
        return true;
    }

    function onKey(code, down, e) {
        if (capture) return captureKey(code, down);          // every key is the listener's while it waits
        if (!down && held[code]) { held[code] = false; return true; }    // the release of a key that was a shortcut or was captured
        var id = codeMap[code];
        if (!id) return false;
        if (!down) return false;
        if (held[code]) return true;                         // held: no repeat
        if (!mayRun(id)) return false;
        held[code] = true;
        var s = forKey(id);
        if (s) setTimeout(function () { run(s); }, 0);       // after the key event (a screen may open)
        return true;
    }
    function mayRun(id) {
        if (window.Welcome && Welcome.open()) return false;
        if (typeof MusicSaver !== 'undefined' && MusicSaver.isOn()) return false;   // the music screensaver: any key only brings My PC back
        var w = window.Win && Win.isOpen && Win.isOpen() ? Win.current() : null, b = button(id);
        if (w && OWN_MEDIA[w] && b && MEDIA_USE[b.use]) return false;   // Memo / Music keep Play / Pause and Record
        return true;
    }

    /* ---------- running an action ---------- */

    function onGamePage() { return /[?&]play=/.test(location.search); }
    function toast(text, kind) { App.toast(text, { id: 'shortcut', kind: kind || 'info', timeout: 2500 }); }

    function music(what) {
        if (typeof Music === 'undefined') return;
        if (typeof Music.has === 'function' && !Music.has()) return toast(t('scNoMusic'));
        if (what === 'next') Music.next(); else if (what === 'prev') Music.prev(); else Music.toggle();
        var st = Music.state ? Music.state() : null;
        if (!st) return;
        // the same card as the Music player's own media keys (main.js mediaKey)
        App.toast(what !== 'toggle' ? '\u266A  ' + st.title : st.playing ? '\u25B6  ' + st.title : '\u275A\u275A  ' + t('scPaused'), { id: 'music', kind: 'info', timeout: 2500 });
    }

    // what a shortcut does, in words (Control Panel, the confirm question)
    function describe(s) {
        var a = actionDef(s.act);
        if (!a) return '';
        if (s.act === 'app') return t('sca_appX').replace('%s', targetName(s.arg) || s.name || s.arg);
        if (s.act === 'page') return t('sca_pageX').replace('%s', pageName(s.arg) || s.name || s.arg);
        return t(a.label);
    }
    function buttonName(id) { var b = button(id); return !b ? id : b.num !== undefined ? t('scb_num').replace('%s', b.num) : t(b.label); }
    function pageName(id) { for (var i = 0; i < pages.length; i++) if (pages[i].id === id) return t(pages[i].label); return ''; }

    // apps and games that a shortcut can open: the built-in apps, then the games and installed apps
    function targets() {
        var out = [], i;
        if (typeof Desktop === 'undefined') return out;
        var apps = Desktop.APPS || [];
        for (i = 0; i < apps.length; i++) out.push({ id: apps[i].id, name: t(apps[i].label), icon: apps[i].icon, app: true });
        var g = Desktop.games ? Desktop.games() : [];
        for (i = 0; i < g.length; i++) out.push({ id: g[i].id, name: I18n.pick(g[i].manifest && g[i].manifest.title) || g[i].id, game: true });
        return out;
    }
    function targetName(id) { var l = targets(); for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i].name; return ''; }

    function run(s) {
        if (!s) return;
        if (s.act === 'music') return music('toggle');
        if (s.act === 'musicNext') return music('next');
        if (s.act === 'musicPrev') return music('prev');
        if (onGamePage()) return inGame(s);
        if (App.dialogOpen() || (window.Keyboard && Keyboard.isOpen())) return;
        if (ProfilesUI.screenOpen()) { if (s.act !== 'users') return; return; }
        desk(s);
    }

    // on the desktop page
    function desk(s) {
        var winOpen = Win.isOpen();
        if (s.act === 'users') { if (Desktop.startOpen()) Desktop.closeStart(true); ProfilesUI.open(); return; }
        if (s.act === 'start') {
            if (winOpen) Win.close();
            if (Desktop.startOpen()) Desktop.closeStart(); else Desktop.openStart();
            return;
        }
        if (s.act === 'home') {
            if (winOpen) Win.close();
            else if (Desktop.startOpen()) Desktop.closeStart();
            return;
        }
        if (s.act === 'menu') { if (!winOpen) { if (Desktop.startOpen()) Desktop.closeStart(); else Desktop.openStart(); } return; }
        if (s.act === 'page') { Win.open('settings', s.arg); return; }
        if (s.act === 'app') return openTarget(s);
    }
    function openTarget(s) {
        if (Desktop.appById && Desktop.appById(s.arg)) { if (Win.current() !== s.arg) Win.open(s.arg); return; }
        var g = Desktop.games(), i;
        for (i = 0; i < g.length; i++) if (g[i].id === s.arg) { if (Win.isOpen()) Win.close(true); Desktop.play(g[i]); return; }
        toast(t('scMissing').replace('%s', s.name || s.arg), 'warn');
    }

    // on the game page: My PC's menu at once; anything that opens something asks, then the game closes
    function inGame(s) {
        if (App.dialogOpen()) return;
        if (s.act === 'menu') {
            if (GameHost.state() === 'running') GameHost.openPause();
            return;
        }
        if (s.act === 'app' && s.arg === GameHost.id()) return;          // already open
        var held2 = GameHost.hold();
        App.confirm(t('scLeaveTitle'), t('scLeaveText').replace('%s', describe(s)), function () {
            if (s.act !== 'home') Store.set('sc_next', { act: s.act, arg: s.arg || null, name: s.name || null, at: Date.now() });
            GameHost.exit();
        }, { yes: t('scLeaveYes'), no: t('cancel'), onNo: function () { GameHost.release(held2); } });
    }

    // the desktop page after a game closed for a shortcut: run what was asked (once, and only if recent)
    function resume() {
        var p = Store.get('sc_next', null);
        if (!p) return;
        Store.set('sc_next', null);
        if (!p.at || Date.now() - p.at > 60000) return;
        setTimeout(function () { desk({ act: p.act, arg: p.arg, name: p.name }); }, 350);
    }

    function init() {
        apply();
        Input.setKeyHook(onKey);
    }

    return {
        BUTTONS: BUTTONS, ACTIONS: ACTIONS, DEFAULTS: DEFAULTS, MAX: MAX,
        init: init, resume: resume, listen: listen, stopListen: stopListen, listening: function () { return !!capture; }, list: list, put: put, remove: remove, reset: reset, forKey: forKey, run: run,
        button: button, action: actionDef, buttonName: buttonName, describe: describe, targets: targets,
        setPages: function (l) { pages = l || []; }, pages: function () { return pages; },
        onChange: function (fn) { if (listeners.indexOf(fn) < 0) listeners.push(fn); },
        offChange: function (fn) { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }
    };
})();
