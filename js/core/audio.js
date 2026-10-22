/* Launcher side of audio: master volumes (0..10) shared with every game through the host object.
 * The launcher itself creates no AudioContext (its only sound, the menu chime, is a small <audio>) (saves memory and a decoder thread on low-end TVs);
 * each game owns exactly one AudioContext, created on start and closed in destroy(). */
var AudioPrefs = (function () {
    'use strict';
    var music = Store.get('vol_music', 7);
    var sfx = Store.get('vol_sfx', 8);
    var listeners = [];

    function clamp(v) { return Math.max(0, Math.min(10, v | 0)); }
    function emit() { for (var i = 0; i < listeners.length; i++) listeners[i](music / 10, sfx / 10); }

    // My PC's menu sound: sounds/menu.wav (Kenney "Interface Sounds", CC0, 9 KB) in one <audio> element, so there is
    // still no AudioContext in the launcher. Kept soft: a quarter of the effects volume.
    var chimeEl = null, CHIME_VOL = 0.25;
    function chimeAudio() {
        if (!chimeEl) {
            var b = (typeof AppBoot !== 'undefined' && AppBoot.base && AppBoot.base()) || '';
            chimeEl = new Audio(b + 'sounds/menu.wav');
            chimeEl.preload = 'auto';
        }
        return chimeEl;
    }
    function chime() {
        if (!sfx) return;
        try {
            var el = chimeAudio();
            el.volume = CHIME_VOL * sfx / 10;
            el.currentTime = 0;
            var p = el.play();
            if (p && p.catch) p.catch(function () {});        // blocked before any key press, or not loaded: no sound, no error
        } catch (e) {}
    }

    return {
        chime: chime,
        prepareChime: function () { try { chimeAudio(); } catch (e) {} },      // loads it before the first menu
        music: function () { return music; },
        sfx: function () { return sfx; },
        setMusic: function (v) { music = clamp(v); Store.set('vol_music', music); emit(); },
        setSfx: function (v) { sfx = clamp(v); Store.set('vol_sfx', sfx); emit(); },
        onChange: function (fn) { listeners.push(fn); },
        offChange: function (fn) { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }
    };
})();
