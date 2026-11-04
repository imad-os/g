/* Music: a placeholder player for the Music Player widget and the Music app (owner request 2026-11-04: "use a dummy app
 * for now, I'll build it later"). It plays nothing yet: a short list of made-up tracks whose position follows the clock,
 * so it "keeps playing" while an app or a game is open and after the page changes (state in the profile key music).
 * No timer here: the position is worked out when someone asks (the widget refreshes, the app draws).
 * The real Music app replaces the TRACKS and plugs real audio behind the same calls: state / play / pause / toggle / next / prev / onChange. */
var Music = (function () {
    'use strict';

    var TRACKS = [
        { title: 'Morning Pixels', artist: 'My PC Band', dur: 154 },
        { title: 'Neon Avenue', artist: 'The Couch Players', dur: 201 },
        { title: 'Level Two', artist: 'Bit Garden', dur: 176 },
        { title: 'Slow Clouds', artist: 'Remote Control', dur: 228 },
        { title: 'Last Life', artist: 'Arcade Hearts', dur: 189 }
    ];
    var listeners = [];

    function saved() {
        var s = Store.get('music', null);
        if (!s || typeof s !== 'object') s = { i: 0, pos: 0, playing: false, at: 0 };
        if (!(s.i >= 0 && s.i < TRACKS.length)) s.i = 0;
        return s;
    }
    // where the music is now (moves on to the next tracks while it plays)
    function now() {
        var s = saved(), pos = +s.pos || 0, i = s.i;
        if (s.playing && s.at) {
            pos += Math.max(0, (Date.now() - s.at) / 1000);
            var guard = 0;
            while (pos >= TRACKS[i].dur && guard++ < 200) { pos -= TRACKS[i].dur; i = (i + 1) % TRACKS.length; }
        }
        return { i: i, pos: pos, playing: !!s.playing };
    }
    function save(i, pos, playing) {
        Store.set('music', { i: i, pos: Math.round(pos * 10) / 10, playing: !!playing, at: playing ? Date.now() : 0 });
        for (var k = 0; k < listeners.length; k++) { try { listeners[k](); } catch (e) {} }
    }

    function state() {
        var n = now(), t = TRACKS[n.i];
        return { index: n.i, title: t.title, artist: t.artist, dur: t.dur, pos: Math.floor(n.pos), playing: n.playing, count: TRACKS.length };
    }
    function play() { var n = now(); save(n.i, n.pos, true); }
    function pause() { var n = now(); save(n.i, n.pos, false); }
    function toggle() { if (now().playing) pause(); else play(); }
    function next() { var n = now(); save((n.i + 1) % TRACKS.length, 0, n.playing); }
    // back to the start of the track, or to the one before when it just started
    function prev() { var n = now(); save(n.pos > 3 ? n.i : (n.i + TRACKS.length - 1) % TRACKS.length, 0, n.playing); }
    function pick(i) { if (i >= 0 && i < TRACKS.length) save(i, 0, true); }
    function clock(s) { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); }

    return {
        TRACKS: TRACKS, state: state, play: play, pause: pause, toggle: toggle, next: next, prev: prev, pick: pick, clock: clock,
        onChange: function (fn) { if (listeners.indexOf(fn) < 0) listeners.push(fn); },
        offChange: function (fn) { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }
    };
})();
