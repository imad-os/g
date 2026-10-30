/* Memo: voice memos of up to 15 seconds per recording, saved per profile (js/core/memo-store.js).
 *
 * List screen: the saved memos (newest first) and New memo. The record key starts a new memo.
 * Memo screen: recording stops by itself after 15 s, or with Stop / the record key; then Play is focused. The record key on
 * this screen records more into the same memo (a new part, played after the others).
 * Record key = the remote's red button or Record key (or its voice key when a TV gives it to apps; Samsung keeps the
 * Smart Remote's mic button for Bixby), X or Y on a controller, R on a keyboard. Play key (▶ / ⏯, Start's short press is
 * the + menu and is not used) plays or stops.
 * The sound: Opus in WebM when the TV has MediaRecorder (about 30 KB per 15 s), else 16 kHz WAV. One <audio>, freed on close. */
(function () {
    'use strict';

    var MAX_S = 15;
    var S = {
        en: { memo: 'Memo', memoNew: 'New memo', memoNone: 'No memos yet. Press the red button to record one.',
              memoHint: 'Record: red button, Record key, X or Y   ·   Play: ▶ key   ·   Back: A', memoRec: 'Record', memoMore: 'Record more',
              memoStop: 'Stop', memoPlay: 'Play', memoDel: 'Delete', memoDelSure: 'OK again to delete', memoRecording: 'Recording',
              memoSaved: 'Memo saved', memoDeleted: 'Memo deleted', memoParts: '{n} parts',
              memoNoMic: 'No microphone for apps on this device. On a TV, plug in a USB or Bluetooth microphone (or a camera with one); on many Samsung TVs the remote\'s mic stays with Bixby.',
              memoDenied: 'The microphone was not allowed.', memoNoSave: 'The memo could not be saved.' },
        fr: { memo: 'Mémo', memoNew: 'Nouveau mémo', memoNone: 'Aucun mémo. Appuyez sur le bouton rouge pour en enregistrer un.',
              memoHint: 'Enregistrer : bouton rouge, touche Enregistrer, X ou Y   ·   Lire : touche ▶   ·   Retour : A', memoRec: 'Enregistrer', memoMore: 'Continuer',
              memoStop: 'Arrêter', memoPlay: 'Lire', memoDel: 'Supprimer', memoDelSure: 'OK encore pour supprimer', memoRecording: 'Enregistrement',
              memoSaved: 'Mémo enregistré', memoDeleted: 'Mémo supprimé', memoParts: '{n} parties',
              memoNoMic: 'Aucun micro pour les applis sur cet appareil. Sur un téléviseur, branchez un micro USB ou Bluetooth (ou une caméra avec micro) ; sur beaucoup de TV Samsung le micro de la télécommande reste à Bixby.',
              memoDenied: 'Le micro n\'a pas été autorisé.', memoNoSave: 'Le mémo n\'a pas pu être enregistré.' },
        es: { memo: 'Memo', memoNew: 'Nueva nota de voz', memoNone: 'Aún no hay notas. Pulsa el botón rojo para grabar una.',
              memoHint: 'Grabar: botón rojo, tecla Grabar, X o Y   ·   Reproducir: tecla ▶   ·   Atrás: A', memoRec: 'Grabar', memoMore: 'Seguir grabando',
              memoStop: 'Parar', memoPlay: 'Reproducir', memoDel: 'Borrar', memoDelSure: 'OK otra vez para borrar', memoRecording: 'Grabando',
              memoSaved: 'Nota guardada', memoDeleted: 'Nota borrada', memoParts: '{n} partes',
              memoNoMic: 'Este dispositivo no da micrófono a las apps. En un televisor, conecta un micrófono USB o Bluetooth (o una cámara con micrófono); en muchos Samsung el micrófono del mando es solo para Bixby.',
              memoDenied: 'No se permitió el micrófono.', memoNoSave: 'No se pudo guardar la nota.' },
        ar: { memo: 'مذكرة', memoNew: 'مذكرة جديدة', memoNone: 'لا توجد مذكرات بعد. اضغط الزر الأحمر لتسجيل واحدة.',
              memoHint: 'تسجيل: الزر الأحمر أو زر التسجيل أو X أو Y   ·   تشغيل: زر ▶   ·   رجوع: A', memoRec: 'تسجيل', memoMore: 'متابعة التسجيل',
              memoStop: 'إيقاف', memoPlay: 'تشغيل', memoDel: 'حذف', memoDelSure: 'اضغط OK مرة أخرى للحذف', memoRecording: 'جارٍ التسجيل',
              memoSaved: 'تم حفظ المذكرة', memoDeleted: 'تم حذف المذكرة', memoParts: '{n} أجزاء',
              memoNoMic: 'لا يوجد ميكروفون للتطبيقات على هذا الجهاز. على التلفاز، صِل ميكروفون USB أو بلوتوث (أو كاميرا بميكروفون)؛ في كثير من تلفزيونات سامسونج يبقى ميكروفون جهاز التحكم لـ Bixby.',
              memoDenied: 'لم يُسمح بالميكروفون.', memoNoSave: 'تعذر حفظ المذكرة.' }
    };
    I18n.add(S);

    var body = null, view = '', memo = null, rec = null, player = null, timer = 0, delArm = 0, gen = 0;
    var ui = {};

    function t(k) { return I18n.t(k); }
    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }
    function btn(cls, text, fn) { var b = el('button', cls, text); b.setAttribute('data-focus', ''); b.onclick = fn; return b; }
    function clock(s) { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60); }
    function when(ms) { var d = new Date(ms); return Desktop.dateText(d) + ' ' + Desktop.timeText(d); }
    function toast(k) { A11y.announce(t(k)); }

    function format() {
        var ok = window.MediaRecorder && MediaRecorder.isTypeSupported && (MediaRecorder.isTypeSupported('audio/webm;codecs=opus') || MediaRecorder.isTypeSupported('audio/webm'));
        return ok ? { format: 'webm' } : { format: 'wav', sampleRate: 16000 };
    }

    /* ---------- list screen ---------- */
    function showList(focusId) {
        stopAll();
        view = 'list'; memo = null;
        var g = ++gen;
        body.innerHTML = '';
        Win.setTitle(t('memo'));
        var box = el('div', 'memo'), top = el('div', 'memo-top');
        var add = btn('memo-new', '', function () { startNew(); });
        add.id = 'memo-new';
        var ic = el('span', 'memo-new-ic'); Icons.put(ic, 'memo');
        add.appendChild(ic); add.appendChild(el('span', '', t('memoNew')));
        top.appendChild(add);
        top.appendChild(el('div', 'memo-hint', t('memoHint')));
        box.appendChild(top);
        var list = el('div', 'memo-list');
        box.appendChild(list);
        body.appendChild(box);
        Focus.focus(add);
        MemoStore.list(function (err, memos) {
            if (g !== gen) return;
            if (!memos.length) { list.appendChild(el('div', 'memo-empty', t('memoNone'))); return; }
            var target = null;
            for (var i = 0; i < memos.length; i++) {
                var m = memos[i], b = btn('memo-item', '', (function (id) { return function () { openMemo(id); }; })(m.id));
                b.setAttribute('data-memo', m.id);
                b.appendChild(el('span', 'memo-when', when(m.created)));
                var info = clock(m.seconds) + (m.parts.length > 1 ? '   ' + t('memoParts').replace('{n}', m.parts.length) : '');
                b.appendChild(el('span', 'memo-len', info));
                b.setAttribute('aria-label', when(m.created) + ', ' + info);
                list.appendChild(b);
                if (m.id === focusId) target = b;
            }
            if (target) Focus.focus(target);
        });
    }

    /* ---------- memo screen ---------- */
    function buildMemo() {
        view = 'memo';
        gen++;
        body.innerHTML = '';
        var box = el('div', 'memo memo-one');
        ui.title = el('h3', 'memo-title', memo.created ? when(memo.created) : t('memoNew'));
        ui.mic = el('div', 'memo-mic'); Icons.put(ui.mic, 'memo');
        ui.time = el('div', 'memo-time');
        ui.time.setAttribute('aria-live', 'polite');
        ui.bar = el('div', 'memo-bar'); ui.fill = el('div', 'memo-fill'); ui.bar.appendChild(ui.fill);
        ui.msg = el('div', 'memo-msg');
        var row = el('div', 'memo-btns');
        ui.rec = btn('btn btn-primary memo-rec', t('memoRec'), function () { record(); });
        ui.play = btn('btn memo-play', t('memoPlay'), function () { togglePlay(); });
        ui.del = btn('btn memo-del', t('memoDel'), function () { del(); });
        ui.rec.id = 'memo-rec'; ui.play.id = 'memo-play'; ui.del.id = 'memo-del';
        row.appendChild(ui.rec); row.appendChild(ui.play); row.appendChild(ui.del);
        box.appendChild(ui.title); box.appendChild(ui.mic); box.appendChild(ui.time); box.appendChild(ui.bar);
        box.appendChild(ui.msg); box.appendChild(row);
        box.appendChild(el('div', 'memo-hint', t('memoHint')));
        body.appendChild(box);
        draw();
    }

    function draw() {
        if (view !== 'memo') return;
        var has = memo.parts.length > 0, total = memo.seconds || 0;
        ui.rec.textContent = rec ? t('memoStop') : has ? t('memoMore') : t('memoRec');
        ui.play.textContent = player ? t('memoStop') : t('memoPlay');
        ui.play.disabled = !has || !!rec;
        ui.del.disabled = !has || !!rec;
        ui.del.textContent = delArm ? t('memoDelSure') : t('memoDel');
        ui.mic.className = 'memo-mic' + (rec ? ' memo-on' : '');
        var s, of;
        if (rec) { s = (Date.now() - rec.t0) / 1000; of = MAX_S; ui.fill.style.width = Math.min(100, s / MAX_S * 100) + '%'; }
        else if (player) { s = player.at + (player.audio.currentTime || 0); of = total; ui.fill.style.width = (of ? Math.min(100, s / of * 100) : 0) + '%'; }
        else { s = total; of = 0; ui.fill.style.width = '0%'; }
        ui.time.textContent = clock(s) + (of ? ' / ' + clock(of) : '');
    }

    function tick(on) {
        clearInterval(timer); timer = 0;
        if (on) timer = setInterval(draw, 250);
    }

    function openMemo(id) {
        var g = ++gen;
        MemoStore.get(id, function (err, m) {
            if (g !== gen || !m) return;
            memo = m;
            buildMemo();
            Focus.focus(ui.play);
        });
    }

    function startNew() {
        stopAll();
        memo = { parts: [] };
        buildMemo();
        Focus.focus(ui.rec);
        record();
    }

    function record() {
        if (view !== 'memo') return;
        if (rec) return stopRec();
        stopPlay();
        delArm = 0;
        ui.msg.textContent = '';
        var r = rec = { t0: Date.now(), starting: true, memo: memo };
        var opts = format();
        opts.chunkMs = 0; opts.maxSeconds = MAX_S; opts.keep = true; opts.level = true;
        draw();
        Mic.start(opts, function (type, d) {
            if (rec !== r) return;
            if (type === 'level') ui.mic.style.boxShadow = '0 0 0 ' + Math.round(d.v * 40) + 'px rgba(255, 80, 80, 0.35)';
            else if (type === 'end') saved(r, d.result);
        }, function (err) {
            if (rec !== r) { if (!err) Mic.cancel(); return; }
            if (err) {
                rec = null;
                ui.msg.textContent = t(err.code === 'denied' ? 'memoDenied' : 'memoNoMic');
                A11y.announce(ui.msg.textContent);
                draw();
                return;
            }
            r.starting = false;
            r.t0 = Date.now();
            tick(true);
            A11y.announce(t('memoRecording'));
            Focus.focus(ui.rec);
        });
    }

    function stopRec() {
        var r = rec;
        if (!r) return;
        if (r.starting) { rec = null; Mic.cancel(); draw(); return; }
        Mic.stop(function (err, res) { saved(r, res); });
    }

    // a recording ended (Stop, the record key, 15 s, Back or closing): add it to the memo as a new part
    function saved(r, res) {
        if (r.done) return;
        r.done = true;
        if (rec === r) rec = null;
        tick(false);
        var m = r.memo;
        if (ui.mic) ui.mic.style.boxShadow = '';
        if (!res || !res.audio || !res.audio.byteLength) return draw();
        m.parts.push({ audio: new Blob([res.audio], { type: res.mime }), mime: res.mime, seconds: Math.min(MAX_S, res.seconds) });
        MemoStore.save(m, function (err) {
            if (err) { if (ui.msg && memo === m) ui.msg.textContent = t('memoNoSave'); return; }
            if (view === 'list') return showList(m.id);          // Back while it was being saved: the list shows it
            if (memo !== m || view !== 'memo') return;
            ui.title.textContent = when(m.created);
            draw();
            toast('memoSaved');
            Focus.focus(ui.play);
        });
        if (memo === m && view === 'memo') draw();
    }

    /* ---------- playback: the parts one after the other ---------- */
    function togglePlay() {
        if (view !== 'memo' || rec) return;
        if (player) return stopPlay();
        if (!memo.parts.length) return;
        delArm = 0;
        var a = new Audio();
        player = { audio: a, i: 0, at: 0, url: '' };
        a.volume = Math.max(0, Math.min(1, (window.AudioPrefs && AudioPrefs.sfx ? AudioPrefs.sfx() : 10) / 10));
        a.onended = next;
        a.onerror = next;
        playPart();
        tick(true);
        draw();
    }
    function playPart() {
        var p = player, part = memo.parts[p.i];
        if (p.url) URL.revokeObjectURL(p.url);
        p.url = URL.createObjectURL(part.audio);
        p.audio.src = p.url;
        var pr = p.audio.play();
        if (pr && pr.catch) pr.catch(function () {});
    }
    function next() {
        var p = player;
        if (!p) return;
        p.at += +memo.parts[p.i].seconds || 0;
        p.i++;
        if (p.i < memo.parts.length) return playPart();
        stopPlay();
        Focus.focus(ui.play);
    }
    function stopPlay() {
        var p = player;
        if (!p) return;
        player = null;
        tick(false);
        try { p.audio.onended = p.audio.onerror = null; p.audio.pause(); p.audio.removeAttribute('src'); p.audio.load(); } catch (e) {}
        if (p.url) URL.revokeObjectURL(p.url);
        draw();
    }

    function del() {
        if (!memo || !memo.id || rec) return;
        if (!delArm) { delArm = setTimeout(function () { delArm = 0; draw(); }, 3000); draw(); A11y.announce(t('memoDelSure')); return; }
        clearTimeout(delArm); delArm = 0;
        stopPlay();
        MemoStore.remove(memo.id, function () { toast('memoDeleted'); if (view === 'memo') showList(); });
    }

    function stopAll() {
        stopPlay();
        if (rec) stopRec();
        tick(false);
        if (delArm) { clearTimeout(delArm); delArm = 0; }
    }

    // My PC lost the screen (other TV app or source, phone app switched): stop and keep what was recorded
    function onHidden() { if (document.hidden) { stopPlay(); if (rec) stopRec(); } }

    Win.register('memo', {
        icon: 'memo',
        title: function () { return t('memo'); },
        open: function (b) {
            body = b;
            document.addEventListener('visibilitychange', onHidden);
            showList();
            return document.getElementById('memo-new');
        },
        action: function (a, repeat) {
            if (repeat) return a === 'record' || a === 'runToggle' || a === 'run' || a === 'pause';
            if (a === 'record' || a === 'runToggle' || a === 'run') {
                if (view === 'memo') record(); else startNew();
                return true;
            }
            if (a === 'pause') { if (view === 'memo') { if (rec) stopRec(); else togglePlay(); } return true; }
            return false;
        },
        back: function () {
            if (view !== 'memo') return false;
            var id = memo && memo.id;
            showList(id);
            return true;
        },
        close: function () {
            stopAll();
            document.removeEventListener('visibilitychange', onHidden);
            gen++;
            body = null; memo = null; view = ''; ui = {};
        },
        refresh: function () { if (view === 'list') showList(); }
    });
})();
