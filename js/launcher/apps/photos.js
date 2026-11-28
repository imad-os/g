/* MyPhotos (owner request 2026-11-13): the pictures phones sent to this TV (Receiver, js/launcher/share-rx.js).
 *
 * Light for small TVs: a picture is shrunk ONCE when it arrives, to the screen (1920x1080 at most, JPEG 0.88) plus a 320x180
 * thumbnail, and kept on the TV in IndexedDB "mypc-photos" (per profile, 200 at most, not in the cloud backup: too big). The grid
 * shows only thumbnails; the viewer decodes one full picture at a time and frees it when it moves on (object URLs revoked).
 * Viewer: Left / Right = other photos, OK = its buttons (Turn, Slideshow 5 s, Delete), Back = the grid.
 *
 *   Photos.addUrl(url, { n, from }, cb(err, id))   download, shrink, save      Photos.add(blob, meta, cb)
 *   Win.open('photos', id)  opens that photo
 *   Win.open('photos', { open: { list, at, title } })  MyPC.open (API 25, js/launcher/app-open.js): the pictures of an app's folder
 *       (Google Drive or a USB drive), read one at a time and shrunk to the screen (the one shown + the next, nothing saved);
 *       It opens over the paused app (js/launcher/app-open.js); Back closes MyPhotos and the app goes on. */
var Photos = (function () {
    'use strict';

    var DB = 'mypc-photos', ST = 'p', MAX = 200, FULL_W = 1920, FULL_H = 1080, TH_W = 320, TH_H = 180;
    var body = null, items = [], urls = [], view = null, at = 0, slide = 0, rot = 0, delArm = 0, gen = 0;
    var album = null, cache = {}, loading = {}, PIC_MAX = 40 * 1048576;     // MyPC.open: { list, at, title }; index -> shrunk Blob

    function t(k) { return I18n.t(k); }
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
    function btn(cls, text, fn) { var b = el('button', cls, text); b.setAttribute('data-focus', ''); b.onclick = fn; return b; }

    /* ---------------- storage ---------------- */
    function db(cb) {
        if (typeof indexedDB === 'undefined') return cb(null);
        var r;
        try { r = indexedDB.open(DB, 1); } catch (e) { return cb(null); }
        r.onupgradeneeded = function () { var s = r.result.createObjectStore(ST, { keyPath: 'id' }); s.createIndex('prof', 'prof'); };
        r.onsuccess = function () { cb(r.result); };
        r.onerror = function () { cb(null); };
    }
    function tx(mode, fn, done) {
        db(function (d) {
            if (!d) return done && done('nodb');
            var x;
            try { x = d.transaction(ST, mode); } catch (e) { d.close(); return done && done('nodb'); }
            var res = fn(x.objectStore(ST));
            x.oncomplete = function () { d.close(); if (done) done(null, res && res.result !== undefined ? res.result : res); };
            x.onerror = x.onabort = function () { d.close(); if (done) done('io'); };
        });
    }
    // the profile's photos, newest first, without the full pictures (only the thumbnails are read for the grid)
    function all(cb) {
        tx('readonly', function (s) { return s.index('prof').getAll(Store.profile()); }, function (e, l) {
            l = e || !l ? [] : l;
            l.sort(function (a, b) { return b.at - a.at; });
            cb(l);
        });
    }
    function getFull(id, cb) { tx('readonly', function (s) { return s.get(id); }, function (e, r) { cb(r || null); }); }
    function remove(id, cb) { tx('readwrite', function (s) { s.delete(id); }, function () { if (cb) cb(); }); }

    // shrinks a picture into a canvas box (contain), JPEG
    function shrink(bmp, w, h, cover, q, cb) {
        var k = cover ? Math.max(w / bmp.width, h / bmp.height) : Math.min(1, w / bmp.width, h / bmp.height);
        var cw = cover ? w : Math.max(1, Math.round(bmp.width * k)), ch = cover ? h : Math.max(1, Math.round(bmp.height * k));
        var c = document.createElement('canvas');
        c.width = cw; c.height = ch;
        var g = c.getContext('2d');
        var dw = bmp.width * k, dh = bmp.height * k;
        g.drawImage(bmp, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
        c.toBlob(function (b) { c.width = c.height = 0; cb(b, cw, ch); }, 'image/jpeg', q);
    }
    function decode(blob, cb) {
        if (typeof createImageBitmap === 'function') return createImageBitmap(blob).then(function (b) { cb(b); }, function () { cb(null); });
        var img = new Image(), u = URL.createObjectURL(blob);
        img.onload = function () { URL.revokeObjectURL(u); cb(img); };
        img.onerror = function () { URL.revokeObjectURL(u); cb(null); };
        img.src = u;
    }
    function add(blob, meta, cb) {
        decode(blob, function (bmp) {
            if (!bmp || !bmp.width) return cb('decode');
            shrink(bmp, FULL_W, FULL_H, false, 0.88, function (full, w, h) {
                shrink(bmp, TH_W, TH_H, true, 0.75, function (thumb) {
                    try { if (bmp.close) bmp.close(); } catch (e) {}
                    if (!full || !thumb) return cb('encode');
                    var rec = { id: 'ph' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36), prof: Store.profile(), n: String(meta.n || '').slice(0, 120),
                                from: String(meta.from || '').slice(0, 60), at: Date.now(), w: w, h: h, full: full, thumb: thumb };
                    tx('readwrite', function (s) { s.put(rec); }, function (e) {
                        if (e) return cb(e);
                        all(function (l) { for (var i = MAX; i < l.length; i++) remove(l[i].id); });
                        cb(null, rec.id);
                    });
                });
            });
        });
    }
    function addUrl(url, meta, cb) {
        fetch(url, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.blob(); })
            .then(function (b) { add(b, meta, cb); }, function () { cb('net'); });
    }

    /* ---------------- screens ---------------- */
    function freeUrls() { for (var i = 0; i < urls.length; i++) { try { URL.revokeObjectURL(urls[i]); } catch (e) {} } urls = []; }
    function objUrl(b) { var u = URL.createObjectURL(b); urls.push(u); return u; }
    function stopSlide() { clearInterval(slide); slide = 0; }

    function grid(focusId) {
        stopSlide();
        view = 'grid';
        var my = ++gen;
        all(function (l) {
            if (!body || my !== gen) return;
            freeUrls();
            items = l;
            body.innerHTML = '';
            Win.setTitle(t('photos'));
            var box = el('div', 'ph');
            if (!l.length) { box.appendChild(el('div', 'ph-empty', t('phNone'))); body.appendChild(box); return; }
            box.appendChild(el('div', 'ph-count', t('phCount').replace('%n', l.length)));
            var g = el('div', 'ph-grid'), first = null;
            g.setAttribute('role', 'list');
            for (var i = 0; i < l.length; i++) {
                var p = l[i], b = btn('ph-tile', '');
                b.setAttribute('role', 'listitem');
                b.setAttribute('aria-label', (p.n || t('rxPhoto')) + (p.from ? ', ' + t('ntFrom').replace('%s', p.from) : ''));
                var img = document.createElement('img');
                img.alt = ''; img.decoding = 'async';
                img.src = objUrl(p.thumb);
                b.appendChild(img);
                b.onclick = (function (k) { return function () { show(k); }; })(i);
                g.appendChild(b);
                if (p.id === focusId || (!first && !focusId)) first = b;
            }
            box.appendChild(g);
            body.appendChild(box);
            Focus.focus(first || g.firstChild);
        });
    }

    function show(i) {
        if (!items.length) return grid();
        at = (i + items.length) % items.length;
        view = 'one'; rot = 0; delArm = 0;
        var p = items[at], my = ++gen;
        getFull(p.id, function (r) {
            if (!body || my !== gen) return;
            freeUrls();
            body.innerHTML = '';
            Win.setTitle(t('photos') + ' · ' + (at + 1) + ' / ' + items.length);
            var box = el('div', 'ph-one'), stage = btn('ph-stage', '', function () { Focus.focus(bar.querySelector('.ph-btn:nth-child(2)')); }), img = document.createElement('img');
            img.className = 'ph-full'; img.alt = p.n || ''; img.decoding = 'async';
            stage.setAttribute('aria-label', (p.n || t('rxPhoto')) + ', ' + (at + 1) + ' / ' + items.length);
            if (r && r.full) img.src = objUrl(r.full);
            stage.appendChild(img);
            box.appendChild(stage);
            var cap = el('div', 'ph-cap', (p.n ? p.n + ' · ' : '') + (p.from ? t('ntFrom').replace('%s', p.from) + ' · ' : '') + Desktop.dateText(new Date(p.at)));
            box.appendChild(cap);
            var bar = el('div', 'ph-bar');
            bar.appendChild(btn('ph-btn', '‹ ' + t('phPrev'), function () { show(at - 1); }));
            bar.appendChild(btn('ph-btn', t('phTurn'), function () { rot = (rot + 90) % 360; img.style.transform = 'rotate(' + rot + 'deg)' + (rot % 180 ? ' scale(' + Math.min(1, 1080 / Math.max(1, p.w), 1920 / Math.max(1, p.h)) + ')' : ''); }));
            var sl = btn('ph-btn', t('phSlide'), function () {
                if (slide) { stopSlide(); sl.classList.remove('on'); return; }
                sl.classList.add('on');
                slide = setInterval(function () { show(at + 1); setTimeout(function () { var s2 = body && body.querySelector('.ph-bar .ph-btn:nth-child(3)'); if (s2 && slide) s2.classList.add('on'); }, 50); }, 5000);
            });
            if (slide) sl.classList.add('on');
            bar.appendChild(sl);
            var del = btn('ph-btn ph-del', t('phDelete'), function () {
                if (Date.now() - delArm > 4000) { delArm = Date.now(); del.textContent = t('phDelSure'); A11y.announce(t('phDelSure')); return; }
                stopSlide();
                remove(p.id, function () { A11y.announce(t('phDeleted')); items.splice(at, 1); if (items.length) show(at); else grid(); });
            });
            bar.appendChild(del);
            bar.appendChild(btn('ph-btn', t('phNext') + ' ›', function () { show(at + 1); }));
            box.appendChild(bar);
            box.appendChild(el('div', 'ph-hint', t('phHint')));
            body.appendChild(box);
            I18n.apply(body);
            Focus.focus(stage);
            A11y.announce((at + 1) + ' / ' + items.length);
        });
    }

    /* ---------------- MyPC.open: an app's folder of pictures (Drive or USB) ---------------- */
    function readEntry(e, cb) {
        if (e.s === 'gd') {
            if (typeof GDrive === 'undefined') return cb(null);
            return GDrive.download(e.p, { max: PIC_MAX }, function (x, r) { cb(x || !r ? null : new Blob([r.buf], { type: r.type || e.mime || 'image/jpeg' })); });
        }
        if (e.s !== 'usb' || typeof UsbFs === 'undefined') return cb(null);
        function rd(n) {
            if (!n || n > PIC_MAX) return cb(null);
            UsbFs.read(e.p, 0, n, function (x, u8) { cb(x || !u8 ? null : new Blob([u8], { type: e.mime || 'image/jpeg' })); });
        }
        if (e.size) return rd(e.size);
        UsbFs.stat(e.p, function (x, st) { rd(!x && st && st.exists ? st.size : 0); });
    }
    // the picture shrunk to the screen (a 12 MP photo decoded whole would cost ~50 MB): cb(blob | null)
    function albumPic(i, cb) {
        if (cache[i] !== undefined) return cb(cache[i]);
        if (loading[i]) { loading[i].push(cb); return; }
        loading[i] = [cb];
        var e = album.list[i], my = album;
        readEntry(e, function (b) {
            function done(r) {
                if (album !== my) return;
                cache[i] = r;
                var w = loading[i] || []; delete loading[i];
                // keep the one shown and its two neighbours only
                Object.keys(cache).forEach(function (k) { var d = Math.abs(+k - at); if (d > 1 && d < album.list.length - 1) delete cache[k]; });
                for (var j = 0; j < w.length; j++) w[j](r);
            }
            if (!b) return done(null);
            decode(b, function (bmp) {
                if (!bmp || !bmp.width) return done(null);
                shrink(bmp, FULL_W, FULL_H, false, 0.9, function (full, w, h) { try { if (bmp.close) bmp.close(); } catch (x) {} if (full) { full.w = w; full.h = h; } done(full || null); });
            });
        });
    }
    function showAlbum(i) {
        var n = album.list.length;
        at = (i + n) % n;
        view = 'one'; rot = 0;
        var e = album.list[at], my = ++gen;
        freeUrls();
        body.innerHTML = '';
        Win.setTitle(t('photos') + ' · ' + (at + 1) + ' / ' + n);
        var box = el('div', 'ph-one'), stage = btn('ph-stage', '', function () { Focus.focus(bar.querySelector('.ph-btn:nth-child(2)')); }), img = document.createElement('img');
        img.className = 'ph-full'; img.alt = e.n || ''; img.decoding = 'async';
        stage.setAttribute('aria-label', (e.n || t('rxPhoto')) + ', ' + (at + 1) + ' / ' + n);
        var wait = el('div', 'ph-empty', t('opLoad'));
        stage.appendChild(wait);
        box.appendChild(stage);
        box.appendChild(el('div', 'ph-cap', e.n || ''));
        var pw = 0, ph = 0;
        var bar = el('div', 'ph-bar');
        bar.appendChild(btn('ph-btn', '‹ ' + t('phPrev'), function () { showAlbum(at - 1); }));
        bar.appendChild(btn('ph-btn', t('phTurn'), function () { rot = (rot + 90) % 360; img.style.transform = 'rotate(' + rot + 'deg)' + (rot % 180 ? ' scale(' + Math.min(1, 1080 / Math.max(1, pw), 1920 / Math.max(1, ph)) + ')' : ''); }));
        var sl = btn('ph-btn', t('phSlide'), function () {
            if (slide) { stopSlide(); sl.classList.remove('on'); return; }
            sl.classList.add('on');
            slide = setInterval(function () { if (view === 'one' && album) { showAlbum(at + 1); var s2 = body && body.querySelector('.ph-bar .ph-btn:nth-child(3)'); if (s2) s2.classList.add('on'); } }, 5000);
        });
        if (slide) sl.classList.add('on');
        bar.appendChild(sl);
        bar.appendChild(btn('ph-btn', t('phNext') + ' ›', function () { showAlbum(at + 1); }));
        box.appendChild(bar);
        box.appendChild(el('div', 'ph-hint', t('opHint').replace('%s', album.title || t('back'))));
        body.appendChild(box);
        I18n.apply(body);
        Focus.focus(stage);
        A11y.announce((at + 1) + ' / ' + n);
        albumPic(at, function (b) {
            if (!body || my !== gen) return;
            if (!b) { wait.textContent = t('opNoPic'); return; }
            pw = b.w || 0; ph = b.h || 0;
            img.src = objUrl(b);
            stage.replaceChild(img, wait);
            if (n > 1) albumPic((at + 1) % n, function () {});          // the next one is ready when Right is pressed
        });
    }

    Win.register('photos', {
        icon: 'photos',
        title: function () { return t('photos'); },
        open: function (b, arg) {
            body = b; items = []; view = null; album = null; cache = {}; loading = {};
            if (arg && typeof arg === 'object' && arg.open && Array.isArray(arg.open.list) && arg.open.list.length) {
                album = arg.open;
                showAlbum(Math.max(0, Math.min(album.list.length - 1, +album.at || 0)));
                return body.querySelector('.ph-stage');          // Left / Right work at once
            }
            if (typeof arg === 'string') {
                var my = ++gen;
                all(function (l) { if (!body || my !== gen) return; items = l; var k = 0; for (var i = 0; i < l.length; i++) if (l[i].id === arg) k = i; if (l.length) show(k); else grid(); });
            } else grid();
            return null;
        },
        close: function () { stopSlide(); gen++; freeUrls(); body = null; items = []; view = null; album = null; cache = {}; loading = {}; },
        action: function (a, repeat) {
            if (view !== 'one') return false;
            // Left / Right on the picture: other photos (Down = its buttons, where the arrows move between them)
            var f = Focus.current();
            if ((a === 'left' || a === 'right') && f && f.classList.contains('ph-stage')) {
                if (repeat) return true;
                stopSlide();
                (album ? showAlbum : show)(at + (a === 'right' ? 1 : -1) * (document.documentElement.dir === 'rtl' ? -1 : 1));
                return true;
            }
            return false;
        },
        back: function () { if (album) return false; if (view === 'one') { var id = items[at] && items[at].id; grid(id); return true; } return false; }
    });

    return { add: add, addUrl: addUrl, all: all, remove: remove };
})();
