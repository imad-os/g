/* Text typed on a phone (Game controller > Text mode) goes into the text field the TV is using right now:
 *   1. the on-screen keyboard (Keyboard: the browser's address bar, names, passwords, notes...), else
 *   2. a text field of My PC itself that has the focus (input, textarea, contenteditable), else
 *   3. the text field of the running installed app (the SDK reports it with { type: 'field' }, game-host.js calls
 *      TextIn.app(field, send); the text goes back to the app as { type: 'text', data: { v, go } }).
 * The phone keeps its own copy of the text and always sends the whole of it ({ t: 'tx', v, go }); Backspace and Enter on
 * the phone's keyboard are editing there, so they never reach the TV as Back (no pause menu while typing).
 *   TextIn.current()        -> null | { id, src: 'kb' | 'dom' | 'app', kind, label, v, max }   (v is '' for a password)
 *   TextIn.put(v, go)       sets the whole text of that field (go: then Enter / OK / submit); false when there is none
 *   TextIn.on(fn(field|null))  called when another field opens or the last one closes (not on every letter)
 *   TextIn.changed()        a field may have opened or closed (Keyboard and the focus events call it)
 *   TextIn.app(f, send)     the running app's field ({ id, kind, label, v, max }) or null; send(v, go) delivers to it */
var TextIn = (function () {
    'use strict';

    var MAX = 2000, KINDS = { text: 1, multi: 1, password: 1, url: 1, email: 1, number: 1, search: 1 };
    var NOT_TEXT = { checkbox: 1, radio: 1, button: 1, submit: 1, reset: 1, range: 1, file: 1, color: 1, image: 1, hidden: 1 };
    var listeners = [], timer = 0, seq = 0, lastKey = null, lastObj = null, app = null, appSend = null;

    function textField(el) {
        if (!el || !el.tagName) return null;
        var tag = el.tagName;
        if (tag === 'TEXTAREA' || el.isContentEditable || (tag === 'INPUT' && !NOT_TEXT[(el.type || '').toLowerCase()])) return el.disabled || el.readOnly ? null : el;
        return null;
    }
    function kindOf(el) {
        if (el.tagName === 'TEXTAREA' || el.isContentEditable) return 'multi';
        var ty = (el.type || '').toLowerCase(), im = (el.inputMode || el.getAttribute('inputmode') || '').toLowerCase();
        if (ty === 'password' || ty === 'url' || ty === 'email' || ty === 'search') return ty;
        if (ty === 'number' || ty === 'tel' || im === 'numeric' || im === 'decimal' || im === 'tel') return 'number';
        return 'text';
    }
    function labelOf(el) {
        var s = el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.title || '';
        if (!s && el.labels && el.labels[0]) s = el.labels[0].textContent;
        return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    }
    // the keyboard's modes as a phone keyboard kind
    function kbKind(m) { return m === 'password' ? 'password' : m === 'url' ? 'url' : m === 'user' || m === 'code' ? 'code' : m === 'name' ? 'name' : 'text'; }

    // what the TV is typing into now; key tells one field from another (a new one gets a new id)
    function find() {
        if (typeof Keyboard !== 'undefined' && Keyboard.isOpen()) {
            var k = Keyboard.info();
            return { key: 'kb' + k.n, obj: null, f: { src: 'kb', kind: kbKind(k.mode), label: String(k.title || '').slice(0, 60), v: k.mode === 'password' ? '' : k.text, max: k.max } };
        }
        var el = textField(document.activeElement);
        if (el) {
            var kind = kindOf(el), v = el.isContentEditable ? el.textContent : el.value;
            return { key: 'dom', obj: el, f: { src: 'dom', kind: kind, label: labelOf(el), v: kind === 'password' ? '' : String(v || '').slice(0, MAX), max: el.maxLength > 0 ? Math.min(el.maxLength, MAX) : MAX } };
        }
        if (app) return { key: 'app' + app.id, obj: appSend, f: { src: 'app', kind: app.kind, label: app.label, v: app.kind === 'password' ? '' : app.v, max: app.max } };
        return null;
    }
    function current() {
        var c = find();
        if (!c) return null;
        if (c.key !== lastKey || c.obj !== lastObj) { lastKey = c.key; lastObj = c.obj; seq++; }
        c.f.id = seq;
        return c.f;
    }
    function notify() {
        timer = 0;
        var before = lastKey, beforeObj = lastObj, f = current();
        if (!f) { if (before === null) return; lastKey = lastObj = null; }
        else if (before === lastKey && beforeObj === lastObj) return;      // the same field: letters are not echoed
        for (var i = 0; i < listeners.length; i++) { try { listeners[i](f); } catch (e) {} }
    }
    // a focus change comes as focusout then focusin: one look a moment later
    function changed() { if (!timer) timer = setTimeout(notify, 40); }

    function setValue(el, v) {
        if (el.isContentEditable) el.textContent = v;
        else { if (el.maxLength > 0) v = v.slice(0, el.maxLength); el.value = v; }
        try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
    }
    // Enter on the field, as a keyboard's Enter would do (the page's own handler, else the form is sent)
    function enter(el) {
        var go = true;
        ['keydown', 'keyup'].forEach(function (type) {
            var e;
            try { e = new KeyboardEvent(type, { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }); Object.defineProperty(e, 'keyCode', { get: function () { return 13; } }); Object.defineProperty(e, 'which', { get: function () { return 13; } }); } catch (x) { return; }
            if (!el.dispatchEvent(e) && type === 'keydown') go = false;
        });
        try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
        if (go && el.form && el.tagName === 'INPUT') { try { if (el.form.requestSubmit) el.form.requestSubmit(); else el.form.submit(); } catch (e) {} }
    }

    function put(v, go) {
        v = String(v == null ? '' : v).slice(0, MAX);
        var c = find();
        if (!c) return false;
        if (c.f.src === 'kb') { Keyboard.setText(v); if (go) Keyboard.submit(); }
        else if (c.f.src === 'dom') { setValue(c.obj, v); if (go) enter(c.obj); }
        else { app.v = v; appSend(v, !!go); }
        return true;
    }

    function clean(f) {
        if (!f || typeof f !== 'object') return null;
        return { id: typeof f.id === 'number' ? f.id : 0, kind: KINDS[f.kind] ? f.kind : 'text', label: String(f.label || '').slice(0, 60),
                 v: typeof f.v === 'string' ? f.v.slice(0, MAX) : '', max: f.max > 0 ? Math.min(MAX, Math.floor(f.max)) : MAX };
    }

    document.addEventListener('focusin', changed, true);
    document.addEventListener('focusout', changed, true);

    return {
        MAX: MAX,
        current: current,
        put: put,
        changed: changed,
        on: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
        off: function (fn) { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
        app: function (f, send) {
            var c = clean(f);
            if (c && typeof send === 'function') { app = c; appSend = send; }
            else if (!send || send === appSend) { app = null; appSend = null; }
            changed();
        }
    };
})();
