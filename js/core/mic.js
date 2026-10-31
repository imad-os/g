/* Microphone for installed apps (MyPC.mic in the SDK): My PC records, the app gets the sound.
 *
 * On the TV the app's iframe cannot open the microphone (no Tizen APIs there): My PC opens it with getUserMedia
 * (privilege mediacapture, package 1.5.0+) and sends the audio over. Which microphones a TV gives to apps depends on
 * the model: a USB or Bluetooth microphone or headset, the camera's microphone, and on many models the remote's own
 * microphone (others keep it for Bixby). On phones and computers it is the device's microphone.
 *
 *   Mic.start(opts, onEvent, cb)   cb(err, { sampleRate, format, mime, label })
 *     opts: { format: 'wav' (default: 16-bit PCM chunks, a .wav at the end) | 'pcm16' | 'float32' | 'webm' (Opus, small),
 *             sampleRate: 16000 (8000-48000; wav / pcm16 / float32), chunkMs: 250 (0 = no live chunks, only the recording),
 *             keep: true (the whole recording comes back at the end), maxSeconds: 60 (up to 600), level: true,
 *             silence: { ms: 1500, threshold: 0.02 } stops by itself once someone spoke and then is silent,
 *             echoCancellation, noiseSuppression, autoGainControl (true by default) }
 *     onEvent('data', { chunk: ArrayBuffer, seq })   onEvent('level', { v: 0..1 })   onEvent('end', { reason, result })
 *   Mic.stop(cb)    cb(err, { audio: ArrayBuffer, mime, format, sampleRate, seconds })   (audio null when keep is false)
 *   Mic.cancel()    stops and drops the recording       Mic.active()
 * Errors: { code: 'no-mic' | 'denied' | 'busy' | 'cancelled', message }
 *
 * A phone in the Game controller's Microphone mode is a microphone for this device (Samsung keeps the remote's mic for
 * Bixby): while one is connected, Mic.start records from it instead of getUserMedia (js/launcher/controllers.js gives the
 * source with Mic.source(src)). The phone sends 16-bit PCM over the controller link; 'webm' is then recorded as 'wav'
 * (the result's format / mime say so), and the rate is the phone's (16000 asked, at most 16000).
 *   src: { available() -> boolean, open(rate, onPcm(Int16Array), onEnd(), cb(errCode, { rate, label })) -> { close() } }
 *   (cb once: an error code 'denied' | 'no-mic', or started; onEnd only after it started) */
var Mic = (function () {
    'use strict';

    var cur = null, source = null;

    function err(code, message) { return { code: code, message: message }; }
    function supported() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }

    function f32to16(f) {
        var out = new Int16Array(f.length);
        for (var i = 0; i < f.length; i++) { var s = f[i] < -1 ? -1 : f[i] > 1 ? 1 : f[i]; out[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
        return out;
    }
    function concat(list, total, Type) { var out = new Type(total), o = 0; for (var i = 0; i < list.length; i++) { out.set(list[i], o); o += list[i].length; } return out; }

    // one block of sound (local microphone or phone): level, the recording, live chunks
    function frame(c, f, opts, per) {
        level(c, f, opts.level !== false);
        if (c.format === 'webm') return;
        if (c.keep) { c.parts.push(f); c.total += f.length; }
        if (c.chunkMs) {
            c.pending.push(f); c.pendingN += f.length;
            if (c.pendingN >= per) flush(c);
        }
    }

    // the phone's microphone (Microphone mode): same events and result as a local one
    function startRemote(c, opts, cb) {
        if (c.format === 'webm') c.format = 'wav';
        var per = 0;
        c.startCb = cb;
        c.remote = source.open(Math.min(16000, c.rate), function (pcm) {
            if (c.stopped) return;
            var f = new Float32Array(pcm.length);
            for (var i = 0; i < pcm.length; i++) f[i] = pcm[i] / 0x8000;
            frame(c, f, opts, per);
        }, function () {
            if (!c.stopped) finish(c, 'closed', null);                     // the phone went away or stopped by itself
        }, function (e, info) {
            if (c.stopped) return;
            if (e) { c.stopped = true; c.remote = null; if (cur === c) cur = null; return cb(err(e === 'denied' ? 'denied' : 'no-mic', e === 'denied' ? 'The phone did not allow its microphone.' : 'The phone\'s microphone did not start.')); }
            c.started = true; c.rate = info.rate; c.t0 = Date.now();
            per = Math.round(c.rate * (c.chunkMs || 250) / 1000);
            c.maxTimer = setTimeout(function () { finish(c, 'max', null); }, c.maxS * 1000);
            cb(null, { sampleRate: c.rate, format: c.format, mime: mimeOf(c), label: info.label || 'Phone' });
        });
    }

    function start(opts, onEvent, cb) {
        opts = opts && typeof opts === 'object' ? opts : {};
        onEvent = typeof onEvent === 'function' ? onEvent : function () {};
        if (cur) return cb(err('busy', 'The microphone is already recording.'));
        var phone = !!(source && source.available());
        if (!phone && !supported()) return cb(err('no-mic', 'This device gives no microphone to apps.'));
        var format = /^(wav|pcm16|float32|webm)$/.test(opts.format) ? opts.format : 'wav';
        var rate = Math.max(8000, Math.min(48000, +opts.sampleRate || 16000));
        var chunkMs = opts.chunkMs === 0 ? 0 : Math.max(50, Math.min(2000, +opts.chunkMs || 250));
        var keep = opts.keep !== false, maxS = Math.max(1, Math.min(600, +opts.maxSeconds || 60));
        var sil = opts.silence && typeof opts.silence === 'object' ? { ms: Math.max(300, +opts.silence.ms || 1500), th: Math.max(0.001, +opts.silence.threshold || 0.02) } : null;
        var c = cur = { stopped: false, stream: null, ctx: null, rec: null, onEvent: onEvent, format: format, keep: keep, rate: rate, parts: [], total: 0,
                        pending: [], pendingN: 0, seq: 0, t0: Date.now(), maxTimer: 0, levelAt: 0, spoke: false, quietSince: 0, mime: '', stopCbs: [],
                        chunkMs: chunkMs, maxS: maxS, sil: sil };
        if (phone) return startRemote(c, opts, cb);
        var a = { echoCancellation: opts.echoCancellation !== false, noiseSuppression: opts.noiseSuppression !== false, autoGainControl: opts.autoGainControl !== false, channelCount: 1 };
        navigator.mediaDevices.getUserMedia({ audio: a, video: false }).then(function (stream) {
            if (c.stopped) { stream.getTracks().forEach(function (t) { t.stop(); }); return cb(err('cancelled', 'Stopped before it started.')); }
            c.stream = stream;
            var track = stream.getAudioTracks()[0], label = (track && track.label) || '';
            try {
                var AC = window.AudioContext || window.webkitAudioContext, ctx;
                try { ctx = new AC({ sampleRate: format === 'webm' ? undefined : rate }); } catch (e) { ctx = new AC(); }
                c.ctx = ctx;
                c.rate = ctx.sampleRate;               // the browser resamples the microphone to the rate asked for (when it can)
                var src = ctx.createMediaStreamSource(stream), node = ctx.createScriptProcessor(2048, 1, 1), per = Math.round(c.rate * chunkMs / 1000);
                node.onaudioprocess = function (e) {
                    if (c.stopped) return;
                    frame(c, new Float32Array(e.inputBuffer.getChannelData(0)), opts, per);
                };
                src.connect(node);
                node.connect(ctx.destination);           // a ScriptProcessor only runs when connected (it outputs silence)
                c.node = node; c.src = src;
                if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
                if (format === 'webm') {
                    var mt = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].filter(function (m) { return window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m); })[0];
                    if (!mt) throw new Error('no MediaRecorder');
                    c.mime = mt.split(';')[0];
                    c.rec = new MediaRecorder(stream, { mimeType: mt });
                    c.blobs = [];
                    c.rec.ondataavailable = function (ev) {
                        if (!ev.data || !ev.data.size) return;
                        if (keep) c.blobs.push(ev.data);
                        if (chunkMs) ev.data.arrayBuffer().then(function (b) { if (!c.dropped) c.onEvent('data', { chunk: b, seq: c.seq++, mime: c.mime }); });
                    };
                    c.rec.start(chunkMs || 1000);
                }
            } catch (e) {
                release(c);
                if (cur === c) cur = null;
                return cb(err('no-mic', 'The microphone could not start: ' + (e && e.message || e)));
            }
            c.maxTimer = setTimeout(function () { finish(c, 'max', null); }, maxS * 1000);
            cb(null, { sampleRate: c.rate, format: format, mime: mimeOf(c), label: label });
        }, function (e) {
            if (cur === c) cur = null;
            if (c.stopped) return cb(err('cancelled', 'Stopped before it started.'));
            var name = e && e.name;
            cb(name === 'NotAllowedError' || name === 'SecurityError' ? err('denied', 'The device did not allow the microphone.') : err('no-mic', 'No microphone found' + (e && e.message ? ': ' + e.message : '.')));
        });
    }

    function mimeOf(c) { return c.format === 'webm' ? c.mime : c.format === 'wav' ? 'audio/wav' : c.format === 'pcm16' ? 'audio/L16;rate=' + c.rate : 'audio/float32;rate=' + c.rate; }

    function level(c, f, send) {
        var sum = 0;
        for (var i = 0; i < f.length; i += 4) sum += f[i] * f[i];
        var rms = Math.sqrt(sum / Math.ceil(f.length / 4)), now = Date.now();
        if (send && now - c.levelAt >= 100) { c.levelAt = now; c.onEvent('level', { v: Math.min(1, Math.round(rms * 400) / 100) }); }
        if (!c.sil) return;
        if (rms >= c.sil.th) { c.spoke = true; c.quietSince = 0; }
        else if (c.spoke) { if (!c.quietSince) c.quietSince = now; else if (now - c.quietSince >= c.sil.ms) setTimeout(function () { finish(c, 'silence', null); }, 0); }
    }

    function flush(c) {
        if (!c.pendingN) return;
        var f = concat(c.pending, c.pendingN, Float32Array);
        c.pending = []; c.pendingN = 0;
        c.onEvent('data', { chunk: c.format === 'float32' ? f.buffer : f32to16(f).buffer, seq: c.seq++ });
    }

    function release(c) {
        clearTimeout(c.maxTimer);
        if (c.remote) { try { c.remote.close(); } catch (e) {} c.remote = null; }
        try { if (c.node) { c.node.onaudioprocess = null; c.node.disconnect(); } if (c.src) c.src.disconnect(); } catch (e) {}
        if (c.stream) c.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
        if (c.ctx && c.ctx.close) { try { c.ctx.close(); } catch (e) {} }
        c.node = c.src = c.stream = c.ctx = null;
    }

    // stop: the last chunk, then the whole recording; reason: 'stop' | 'max' | 'silence' | 'cancel' | 'closed'
    function finish(c, reason, cb) {
        if (cb) c.stopCbs.push(cb);
        if (c.stopped) return;
        c.stopped = true;
        if (cur === c) cur = null;
        var seconds = Math.round((Date.now() - c.t0) / 100) / 10;
        function done(audio) {
            release(c);
            var res = { audio: audio, mime: mimeOf(c), format: c.format, sampleRate: c.rate, seconds: seconds };
            if (reason !== 'stop' && reason !== 'cancel') c.onEvent('end', { reason: reason, result: res });
            c.stopCbs.forEach(function (f) { try { f(null, res); } catch (e) {} });
        }
        if (c.remote && !c.started) {                                   // the phone had not started yet: nothing was recorded
            reason = 'cancel';
            setTimeout(function () { c.startCb(err('cancelled', 'Stopped before it started.')); }, 0);
        }
        if (reason === 'cancel') { c.dropped = true; if (c.rec && c.rec.state !== 'inactive') { try { c.rec.stop(); } catch (e) {} } return done(null); }
        if (c.format === 'webm') {
            if (!c.rec || c.rec.state === 'inactive') return done(null);
            c.rec.onstop = function () {
                if (!c.keep || !c.blobs.length) return done(null);
                new Blob(c.blobs, { type: c.mime }).arrayBuffer().then(done, function () { done(null); });
            };
            try { c.rec.stop(); } catch (e) { done(null); }
            return;
        }
        flush(c);
        if (!c.keep) return done(null);
        var f = concat(c.parts, c.total, Float32Array);
        c.parts = [];
        if (c.format === 'float32') return done(f.buffer);
        var pcm = f32to16(f).buffer;
        done(c.format === 'wav' ? WebProxy.wav(pcm, c.rate, 1) : pcm);
    }

    return {
        supported: supported,
        start: start,
        stop: function (cb) { if (!cur) return cb && cb(null, null); finish(cur, 'stop', cb || null); },
        end: function (reason) { if (cur) finish(cur, reason || 'closed', null); },     // the shell stops it (the app paused or closed)
        cancel: function () { if (cur) finish(cur, 'cancel', null); },
        active: function () { return !!cur; },
        source: function (src) { source = src && typeof src.open === 'function' ? src : null; },
        phone: function () { return !!(source && source.available()); }      // a phone in Microphone mode is connected
    };
})();
