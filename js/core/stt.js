/* Speech to text for apps and games (MyPC.stt in the SDK, API 24; owner request 2026-11-20).
 *
 * The user turns it on per profile in Control Panel > Speech to text (profile key 'stt' { on, lang, engine }). Then an app asks
 * My PC to listen (MyPC.stt.listen(), e.g. when the player presses A to talk) or the player presses the phone's microphone button
 * (the Record key) while an app listens for speech: My PC listens, shows a "Listening" card, and gives the app the words.
 * Samsung keeps the remote's microphone for Bixby, so the microphone is a phone in the Game controller's Buttons mode.
 *
 * Engines, picked in this order ('auto'):
 *   phone   the phone's own speech recognition (Chrome on the phone has one; the Android app's WebView does not):
 *           TV -> phone { t: 'stt', on: 1, id, lang, max } / { t: 'stt', on: 0, id, x: 1 = drop it }
 *           phone -> TV { t: 'sr', id, v: text, fin: 0 | 1 } | { t: 'sr', id, err } | { t: 'sr', id, end: 1 }   (js/launcher/controllers.js)
 *   device  this computer's own speech recognition (Chrome on a PC; never on the TV, whose engine does not work)
 *   ai      the phone's (or this device's) microphone recorded by Mic (js/core/mic.js, 16 kHz WAV, stops after a silence), then
 *           written down by an AI service of My PC that can (App Store Manager > AI services: Gemini, OpenAI, Groq)
 *   engine 'ai' in the settings = always the AI service.
 *
 *   Stt.prefs() / setPref(k, v) / enabled() / status() -> { on, ready, engine, source, why, lang, phone, service }
 *   Stt.listen(opts, onEvent) -> { stop(), cancel() }   opts { lang, maxSeconds (1-30, 10), silenceMs (1200), hint, force, card }
 *     onEvent(type, data): 'start' { engine, source, lang } | 'level' { v } | 'partial' { text } | 'working' | 'text' { text, lang, engine }
 *                          | 'error' { code, message } | 'end' { reason }    ('end' always comes last, once)
 *     error codes: 'off' (turned off) | 'busy' | 'no-mic' | 'no-service' | 'denied' | 'nothing' (no words heard) | 'network' | 'failed'
 *   Stt.active() / Stt.stop() / Stt.cancel() / Stt.onChange(fn)
 *   Stt.phone(src)   controllers.js: { available(), recognizes(), label(), recognize(lang, max, ev(type, d)) -> { stop(), cancel() } }
 *   Stt.webRec(lang, maxSeconds, ev) the browser's own recognizer (also used by the phone and by the SDK standalone) */
var Stt = (function () {
    'use strict';

    var KEY = 'stt', LANGS = { en: 'en-US', fr: 'fr-FR', es: 'es-ES', ar: 'ar-MA' }, ENGINES = ['auto', 'ai'], LANG_LIST = ['auto', 'en', 'fr', 'es', 'ar'];
    var phoneSrc = null, cur = null, listeners = [];

    function hasStore() { return typeof Store !== 'undefined' && Store.get; }
    function prefs() {
        var p = hasStore() ? Store.get(KEY, null) : null;
        p = p && typeof p === 'object' ? p : {};
        return { on: p.on === true, lang: LANG_LIST.indexOf(p.lang) >= 0 ? p.lang : 'auto', engine: ENGINES.indexOf(p.engine) >= 0 ? p.engine : 'auto' };
    }
    function setPref(k, v) { var p = prefs(); p[k] = v; Store.set(KEY, p); changed(); }
    function changed() { for (var i = 0; i < listeners.length; i++) { try { listeners[i](); } catch (e) {} } }
    function onChange(fn) { listeners.push(fn); return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; }

    function langOf(l) { l = l && l !== 'auto' ? String(l).slice(0, 2).toLowerCase() : (typeof I18n !== 'undefined' ? I18n.lang() : 'en'); return LANGS[l] ? l : 'en'; }
    function webSpeech() { return window.SpeechRecognition || window.webkitSpeechRecognition || null; }
    function onTv() { return typeof tizen !== 'undefined' || typeof webapis !== 'undefined'; }
    // the Android app's WebView has no working recognizer (it says "not allowed" / "network"), nor does the TV
    function deviceRec() { return !onTv() && !window.MyPCNative && !!webSpeech(); }
    function service() {
        if (typeof AI === 'undefined' || !AI.providers) return null;
        var l = AI.providers(), best = null;
        for (var i = 0; i < l.length; i++) if (l[i].tasks && l[i].tasks.transcribe && (!best || l[i].isDefault)) best = l[i];
        return best;
    }
    function hasMic() { return typeof Mic !== 'undefined' && (Mic.phone() || Mic.supported()); }

    // what would listen now: { engine, source } or { why }
    function plan(engine) {
        var ph = !!(phoneSrc && phoneSrc.available()), sv = service();
        if (ph) {
            if (engine !== 'ai' && phoneSrc.recognizes()) return { engine: 'phone', source: 'phone' };
            return sv ? { engine: 'ai', source: 'phone' } : { why: 'no-service' };
        }
        if (engine !== 'ai' && deviceRec()) return { engine: 'device', source: 'device' };
        if (typeof Mic === 'undefined' || !Mic.supported()) return { why: 'no-mic' };
        return sv ? { engine: 'ai', source: 'device' } : { why: 'no-service' };
    }
    function status() {
        var p = prefs(), pl = plan(p.engine), sv = service();
        return { on: p.on, ready: !!pl.engine, engine: pl.engine || '', source: pl.source || '', why: p.on ? pl.why || '' : 'off', lang: langOf(p.lang),
                 phone: phoneSrc && phoneSrc.available() ? phoneSrc.label() : '', service: sv ? sv.name : '', tv: onTv() };
    }

    function E(code, message) { return { code: code, message: message }; }
    var MSG = { off: 'Speech to text is turned off (Control Panel > Speech to text).', busy: 'My PC is already listening.', 'no-mic': 'No microphone: connect a phone in the Game controller\'s Buttons mode.',
                'no-service': 'No AI service of My PC writes speech down (App Store Manager > AI services: Gemini, OpenAI or Groq).', denied: 'The microphone was not allowed.',
                nothing: 'No words were heard.', network: 'The speech service could not be reached.', failed: 'Speech to text failed.', cancelled: 'Stopped.' };
    function errOf(code, msg) { return E(MSG[code] ? code : 'failed', msg || MSG[code] || MSG.failed); }

    /* ---------- the browser's own speech recognition ---------- */
    function webRec(lang, maxS, ev) {
        var R = webSpeech(), r, fin = '', mid = '', code = '', done = false, timer = 0;
        if (!R) { setTimeout(function () { ev('error', errOf('no-mic')); ev('end', { reason: 'error' }); }, 0); return { stop: function () {}, cancel: function () {} }; }
        try { r = new R(); } catch (e) { setTimeout(function () { ev('error', errOf('failed')); ev('end', { reason: 'error' }); }, 0); return { stop: function () {}, cancel: function () {} }; }
        r.lang = LANGS[langOf(lang)]; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
        r.onresult = function (e) {
            fin = ''; mid = '';
            for (var i = 0; i < e.results.length; i++) { var x = e.results[i]; if (x.isFinal) fin += x[0].transcript; else mid += x[0].transcript; }
            ev('partial', { text: (fin + mid).replace(/\s+/g, ' ').trim() });
        };
        r.onerror = function (e) { code = e && e.error || 'failed'; };
        r.onaudiostart = function () { ev('level', { v: 0.3 }); };
        r.onend = function () {
            if (done) return;
            done = true; clearTimeout(timer);
            var text = (fin || mid).replace(/\s+/g, ' ').trim();
            if (code === 'aborted') ev('end', { reason: 'cancel' });
            else if (text) { ev('text', { text: text }); ev('end', { reason: 'done' }); }
            else {
                ev('error', errOf(code === 'not-allowed' || code === 'service-not-allowed' ? 'denied' : code === 'audio-capture' ? 'no-mic' : code === 'network' ? 'network' : !code || code === 'no-speech' ? 'nothing' : 'failed'));
                ev('end', { reason: 'error' });
            }
        };
        try { r.start(); } catch (e2) { done = true; setTimeout(function () { ev('error', errOf('failed', String(e2 && e2.message || e2))); ev('end', { reason: 'error' }); }, 0); }
        timer = setTimeout(function () { try { r.stop(); } catch (e) {} }, maxS * 1000);
        return { stop: function () { try { r.stop(); } catch (e) {} }, cancel: function () { try { r.abort(); } catch (e) {} } };
    }

    /* ---------- the microphone + an AI service ---------- */
    function aiRec(lang, maxS, silenceMs, hint, ev) {
        var sv = service(), spoke = false, dead = false, job = null, quiet = 0, ended = false;
        var WAIT_MS = 7000;                                       // nobody spoke in 7 s: nothing heard
        function end(reason) { if (ended) return; ended = true; clearTimeout(quiet); ev('end', { reason: reason }); }
        function fail(code, msg) { if (ended) return; ev('error', errOf(code, msg)); end('error'); }
        function written(res) {
            if (dead) return;
            if (!res || !res.audio || !spoke || res.seconds < 0.3) return fail('nothing');
            ev('working', {});
            var p = AI.resolve(sv && sv.id);
            if (!p) return fail('no-service');
            job = AI.start({ task: 'transcribe', prompt: [{ type: 'audio', data: res.audio, mime: 'audio/wav' }], language: langOf(lang), timeout: 25000,
                             system: hint ? 'Words that may be said: ' + String(hint).slice(0, 300) : undefined }, p);
            job.promise.then(function (r) {
                if (dead) return;
                var text = String(r && r.text || '').replace(/\s+/g, ' ').trim().replace(/^["'“«]+|["'”»]+$/g, '').trim();
                if (!text || /^\[?(silence|no speech|inaudible)\]?\.?$/i.test(text)) return fail('nothing');
                ev('text', { text: text }); end('done');
            }, function (e) { if (!dead) fail(e && (e.code === 'network' || e.code === 'timeout') ? 'network' : 'failed', e && e.message); });
        }
        Mic.start({ format: 'wav', sampleRate: 16000, chunkMs: 0, keep: true, level: true, maxSeconds: maxS, silence: { ms: silenceMs, threshold: 0.02 } }, function (type, d) {
            if (dead) return;
            if (type === 'level') { if (d.v >= 0.08) spoke = true; ev('level', d); }
            else if (type === 'end') written(d.result);
        }, function (e, info) {
            if (dead) { if (!e) Mic.cancel(); return; }
            if (e) return fail(e.code === 'denied' ? 'denied' : e.code === 'busy' ? 'busy' : 'no-mic', e.message);
            ev('level', { v: 0 });
            quiet = setTimeout(function () { if (!spoke && !dead) { dead = true; Mic.cancel(); fail('nothing'); } }, WAIT_MS);
        });
        return {
            stop: function () { if (dead || job) return; clearTimeout(quiet); Mic.stop(function (e, res) { written(res); }); },
            cancel: function () { if (dead) return; dead = true; if (job) job.cancel(); else Mic.cancel(); end('cancel'); }
        };
    }

    /* ---------- the "Listening" card on the TV ---------- */
    function errText(d) { var k = 'sttErr_' + String(d.code || 'failed').replace(/-/g, ''), v = I18n.t(k); return v === k ? (d.message || I18n.t('sttErr_failed')) : v; }
    function card(type, d, info) {
        if (typeof Notify === 'undefined' || typeof I18n === 'undefined') return;
        var t = I18n.t;
        if (type === 'start') Notify.show({ id: 'stt', kind: 'info', title: t('sttListening'), text: info.source === 'phone' ? t('sttSpeakPhone').replace('%s', info.phone || t('sttPhone')) : t('sttSpeak'), timeout: 0 });
        else if (type === 'partial' && d.text) Notify.show({ id: 'stt', kind: 'info', title: t('sttListening'), text: d.text, timeout: 0, quiet: true });
        else if (type === 'working') Notify.show({ id: 'stt', kind: 'info', title: t('sttWorking'), text: info.lastPartial || t('sttWorkingText'), timeout: 0, quiet: true });
        else if (type === 'text') Notify.show({ id: 'stt', kind: 'ok', title: t('sttHeard'), text: d.text, timeout: 3500 });
        else if (type === 'error' && d.code !== 'off') Notify.show({ id: 'stt', kind: 'warn', title: t('sttTitle'), text: errText(d), timeout: 4000 });
        else if (type === 'end' && d.reason === 'cancel') Notify.hide('stt');
    }

    function listen(opts, onEvent) {
        opts = opts && typeof opts === 'object' ? opts : {};
        onEvent = typeof onEvent === 'function' ? onEvent : function () {};
        var p = prefs(), lang = langOf(opts.lang || p.lang), maxS = Math.max(1, Math.min(30, +opts.maxSeconds || 10)), silenceMs = Math.max(500, Math.min(4000, +opts.silenceMs || 1200));
        var showCard = opts.card !== false, ended = false, info = { lastPartial: '' };
        function ev(type, d) {
            if (ended) return;
            d = d || {};
            if (type === 'text') { d.lang = lang; d.engine = me.engine; }
            if (type === 'partial') info.lastPartial = d.text;
            if (type === 'end') { ended = true; if (cur === me) cur = null; }
            if (showCard) card(type, d, info);
            try { onEvent(type, d); } catch (e) {}
        }
        function early(code) { var h = { stop: function () {}, cancel: function () {} }; setTimeout(function () { ev('error', errOf(code)); ev('end', { reason: 'error' }); }, 0); return h; }
        var me = { engine: '', h: null };
        if (!p.on && !opts.force) return early('off');
        if (cur) return early('busy');
        var pl = plan(p.engine);
        if (!pl.engine) return early(pl.why);
        me.engine = pl.engine; cur = me;
        info.source = pl.source; info.phone = pl.source === 'phone' && phoneSrc ? phoneSrc.label() : '';
        ev('start', { engine: pl.engine, source: pl.source, lang: lang });
        if (pl.engine === 'phone') me.h = phoneSrc.recognize(LANGS[lang], maxS, ev);
        else if (pl.engine === 'device') me.h = webRec(lang, maxS, ev);
        else me.h = aiRec(lang, maxS, silenceMs, opts.hint, ev);
        return { stop: function () { if (!ended && me.h) me.h.stop(); }, cancel: function () { if (!ended && me.h) me.h.cancel(); } };
    }

    return {
        LANGS: LANG_LIST, ENGINES: ENGINES,
        prefs: prefs, setPref: setPref, enabled: function () { return prefs().on; }, status: status, onChange: onChange,
        listen: listen, active: function () { return !!cur; },
        stop: function () { if (cur && cur.h) cur.h.stop(); }, cancel: function () { if (cur && cur.h) cur.h.cancel(); },
        phone: function (src) { phoneSrc = src && typeof src.recognize === 'function' ? src : null; changed(); },
        changed: changed, webRec: webRec, errText: errText, langOf: langOf, tag: function (l) { return LANGS[langOf(l)]; }
    };
})();
