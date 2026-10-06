/* Spatial focus navigation with real DOM focus (needed by Voice Guide).
 * Focusable items carry [data-focus]. A scope is the container currently navigable
 * (main menu, settings, a dialog, the pause menu...). */
var Focus = (function () {
    'use strict';
    var scope = null;
    var stack = [];

    function visible(el) {
        return !el.hidden && el.offsetParent !== null && !el.disabled;
    }

    function items() {
        if (!scope) return [];
        var list = scope.querySelectorAll('[data-focus]'), out = [];
        for (var i = 0; i < list.length; i++) if (visible(list[i])) out.push(list[i]);
        return out;
    }

    function focus(el) {
        if (!el) return;
        try { el.focus(); } catch (e) {}
        if (el.scrollIntoView && scope && scope.getAttribute('data-scroll') === 'y') {
            // keep the focused row visible in long lists, without smooth scrolling (cheap)
            var r = el.getBoundingClientRect(), s = scope.getBoundingClientRect();
            if (r.top < s.top || r.bottom > s.bottom) el.scrollIntoView(r.top < s.top);
        }
    }

    function current() {
        var a = document.activeElement;
        return a && scope && scope.contains(a) && a.hasAttribute('data-focus') ? a : null;
    }

    function move(dir) {
        var list = items();
        if (!list.length) return false;
        var cur = current();
        if (!cur) { focus(list[0]); return true; }
        var r = cur.getBoundingClientRect();
        var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        var best = null, bestScore = Infinity;
        for (var i = 0; i < list.length; i++) {
            var el = list[i];
            if (el === cur) continue;
            var o = el.getBoundingClientRect();
            var ox = o.left + o.width / 2, oy = o.top + o.height / 2;
            var dx = ox - cx, dy = oy - cy, main, side;
            if (dir === 'left') { main = -dx; side = Math.abs(dy); }
            else if (dir === 'right') { main = dx; side = Math.abs(dy); }
            else if (dir === 'up') { main = -dy; side = Math.abs(dx); }
            else { main = dy; side = Math.abs(dx); }
            if (main <= 1) continue;
            var score = main + side * 2.2;
            if (score < bestScore) { bestScore = score; best = el; }
        }
        if (best) { focus(best); return true; }
        return false;
    }

    // Opens a new scope and remembers the previous one (dialogs, pause menu).
    function push(el, first) {
        stack.push({ scope: scope, focused: document.activeElement });
        set(el, first);
    }
    function pop() {
        var prev = stack.pop();
        if (!prev) return;
        scope = prev.scope;
        if (prev.focused && scope && scope.contains(prev.focused) && visible(prev.focused)) focus(prev.focused);
        else { var l = items(); if (l.length) focus(l[0]); }
    }
    function set(el, first) {
        scope = el;
        var target = first || items()[0];
        if (target) focus(target);
    }

    return {
        set: set, push: push, pop: pop, move: move, focus: focus, current: current, items: items,
        scope: function () { return scope; },
        reset: function () { stack.length = 0; }
    };
})();
