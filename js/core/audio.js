/* Launcher side of audio: master volumes (0..10) shared with every game through the host object.
 * The launcher itself creates no AudioContext (its only sound, the menu chime, is a tiny <audio>) (saves memory and a decoder thread on low-end TVs);
 * each game owns exactly one AudioContext, created on start and closed in destroy(). */
var AudioPrefs = (function () {
    'use strict';
    var music = Store.get('vol_music', 7);
    var sfx = Store.get('vol_sfx', 8);
    var listeners = [];

    function clamp(v) { return Math.max(0, Math.min(10, v | 0)); }
    function emit() { for (var i = 0; i < listeners.length; i++) listeners[i](music / 10, sfx / 10); }

    // My PC's menu chime: a 0.2 s two-note sound made once as a tiny WAV (8 kHz, 8 bit, ~1.6 KB) and played by one
    // <audio> element, so there is still no AudioContext in the launcher. Follows the effects volume.
    var chimeEl = null;
    function chimeUrl() {
        var rate = 8000, n = 1600, b = new Uint8Array(44 + n), v = new DataView(b.buffer), i;
        function str(o, t) { for (var k = 0; k < t.length; k++) b[o + k] = t.charCodeAt(k); }
        str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
        v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true);
        v.setUint16(34, 8, true); str(36, 'data'); v.setUint32(40, n, true);
        for (i = 0; i < n; i++) {
            var t = i / rate, second = i >= n / 2, local = second ? t - 0.1 : t;
            var env = Math.min(1, local * 400) * Math.exp(-local * 22);
            b[44 + i] = 128 + Math.round(70 * env * Math.sin(2 * Math.PI * (second ? 1046.5 : 784) * t));
        }
        return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
    }
    function chime() {
        if (!sfx) return;
        try {
            if (!chimeEl) { chimeEl = new Audio(chimeUrl()); chimeEl.preload = 'auto'; }
            chimeEl.volume = sfx / 10;
            chimeEl.currentTime = 0;
            var p = chimeEl.play();
            if (p && p.catch) p.catch(function () {});        // blocked before any key press: no sound, no error
        } catch (e) {}
    }

    return {
        chime: chime,
        music: function () { return music; },
        sfx: function () { return sfx; },
        setMusic: function (v) { music = clamp(v); Store.set('vol_music', music); emit(); },
        setSfx: function (v) { sfx = clamp(v); Store.set('vol_sfx', sfx); emit(); },
        onChange: function (fn) { listeners.push(fn); },
        offChange: function (fn) { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }
    };
})();
