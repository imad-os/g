/* Launcher side of audio: master volumes (0..10) shared with every game through the host object.
 * The launcher itself creates no AudioContext (saves memory and a decoder thread on low-end TVs);
 * each game owns exactly one AudioContext, created on start and closed in destroy(). */
var AudioPrefs = (function () {
    'use strict';
    var music = Store.get('vol_music', 7);
    var sfx = Store.get('vol_sfx', 8);
    var listeners = [];

    function clamp(v) { return Math.max(0, Math.min(10, v | 0)); }
    function emit() { for (var i = 0; i < listeners.length; i++) listeners[i](music / 10, sfx / 10); }

    return {
        music: function () { return music; },
        sfx: function () { return sfx; },
        setMusic: function (v) { music = clamp(v); Store.set('vol_music', music); emit(); },
        setSfx: function (v) { sfx = clamp(v); Store.set('vol_sfx', sfx); emit(); },
        onChange: function (fn) { listeners.push(fn); },
        offChange: function (fn) { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }
    };
})();
