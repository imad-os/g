/* Saved copy of the running My PC build, for starts with a weak or no network (owner request 2026-11-28).
 *
 * The packaged loader (js/boot/loader.js, package 3.1.0+, `AppBoot.cacheInfo`) runs this copy instead of downloading the
 * hosted files again when the hosted build is the same, and instead of the older built-in copy when the server does not
 * answer or its files fail to load. This file only WRITES it (hosted code, so it can improve without a new package):
 *   - in IndexedDB on the TV (`mypc-boot`, key `cur`): always, once per build;
 *   - on a USB drive when one is plugged in: <drive>/MyPC/boot/mypc-<build>.json + current.json { b, f } (written last:
 *     a half-written bundle is never named). It survives a reinstall / cleared app data. Older bundles are removed.
 * Bundle { v, build, shell, at, manifest, html, files: { path: text } } = app.html + every CSS / JS file of the manifest
 * (~2.5 MB). Pictures, sounds and games are not in it: offline they come from the package.
 *
 *   BootCache.supported()        the package can read a saved copy
 *   BootCache.auto(delay)        desktop page: save the running hosted build if it is not saved yet, copy it to USB
 *   BootCache.save(m, base, texts, cb)   Updater.install() hands over the files it just downloaded
 *   BootCache.info(cb)           cb({ build, at, usb: { p, b } | null }) for Control Panel > My PC Update; last() = the last answer
 * ES5 (Chrome 108 TVs). */
var BootCache = (function () {
    'use strict';

    var PARALLEL = 3, FILE_TIMEOUT = 20000;
    var busy = false;

    function ci() { return typeof AppBoot !== 'undefined' && AppBoot.cacheInfo ? AppBoot.cacheInfo : null; }
    function web() { var o = null; try { o = localStorage.getItem('boot_remote_base'); } catch (e) {} return location.protocol === 'https:' && !o; }
    function supported() { return !!ci() && !web() && typeof indexedDB !== 'undefined'; }
    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
    function log(m) { try { console.log('[BootCache] ' + m); } catch (e) {} }

    function db(cb) {
        var c = ci();
        try {
            var rq = indexedDB.open(c.db, 1);
            rq.onupgradeneeded = function () { try { rq.result.createObjectStore(c.store); } catch (e) {} };
            rq.onsuccess = function () { cb(null, rq.result); };
            rq.onerror = function () { cb(rq.error || 'idb'); };
            rq.onblocked = function () { cb('blocked'); };
        } catch (e) { cb(e); }
    }
    function readSaved(cb) {
        if (!supported()) return cb(null);
        db(function (e, d) {
            if (e) return cb(null);
            try {
                var g = d.transaction(ci().store, 'readonly').objectStore(ci().store).get(ci().key);
                g.onsuccess = function () { d.close(); cb(g.result || null); };
                g.onerror = function () { d.close(); cb(null); };
            } catch (x) { try { d.close(); } catch (y) {} cb(null); }
        });
    }
    function writeSaved(bundle, cb) {
        db(function (e, d) {
            if (e) return cb(e);
            try {
                var tx = d.transaction(ci().store, 'readwrite');
                tx.objectStore(ci().store).put(bundle, ci().key);
                tx.oncomplete = function () { d.close(); cb(null); };
                tx.onerror = tx.onabort = function () { d.close(); cb(tx.error || 'idb'); };
            } catch (x) { try { d.close(); } catch (y) {} cb(x); }
        });
    }

    function files(m) { return m.css.concat(m.js); }
    function complete(m, texts) {
        if (typeof texts['app.html'] !== 'string') return false;
        var l = files(m);
        for (var i = 0; i < l.length; i++) if (typeof texts[l[i]] !== 'string') return false;
        return true;
    }

    /* ---------------- USB drive ---------------- */
    function usbKnown() { try { return JSON.parse(lsGet(ci().usbKey)); } catch (e) { return null; } }
    function toUsb(bundle, cb) {
        cb = cb || function () {};
        if (typeof UsbFs === 'undefined' || !UsbFs.supported() || typeof TextEncoder === 'undefined') return cb('nousb');
        UsbFs.drives(function (e, list) {
            if (e || !list || !list.length) return cb('nousb');
            var dir = list[0].path + ci().usbDir.replace(/\/$/, ''), name = 'mypc-' + bundle.build + '.json', p = dir + '/' + name;
            UsbFs.mkdir(dir, function (e1) {
                if (e1) return cb(e1);
                write(p, JSON.stringify(bundle), function (e2) {
                    if (e2) { UsbFs.remove(p); return cb(e2); }
                    write(dir + '/current.json', JSON.stringify({ b: bundle.build, f: name, at: Date.now() }), function (e3) {
                        if (e3) return cb(e3);
                        lsSet(ci().usbKey, JSON.stringify({ p: p, b: bundle.build }));
                        log('saved build ' + bundle.build + ' on ' + dir);
                        // older bundles go
                        UsbFs.list(dir, function (e4, entries) {
                            (entries || []).forEach(function (en) { if (!en.dir && /^mypc-\d+\.json$/.test(en.name) && en.name !== name) UsbFs.remove(en.path); });
                            cb(null);
                        });
                    });
                });
            });
        });
    }
    function write(p, text, cb) {
        UsbFs.writer(p, false, function (e, w) {
            if (e) return cb(e);
            w.write(new TextEncoder().encode(text), function (e2) { w.close(function () { cb(e2 || null); }); });
        });
    }

    /* ---------------- save ---------------- */
    function save(m, base, texts, cb) {
        cb = cb || function () {};
        if (!supported() || !m || !complete(m, texts)) return cb('incomplete');
        var f = {}, l = files(m);
        for (var i = 0; i < l.length; i++) f[l[i]] = texts[l[i]];
        var bundle = { v: ci().v, build: m.build, shell: m.shell, at: Date.now(), base: base, manifest: m, html: texts['app.html'], files: f };
        writeSaved(bundle, function (e) {
            if (e) { log('could not save build ' + m.build + ': ' + e); return cb(e); }
            if (lsGet(ci().badKey) === String(m.build)) { try { localStorage.removeItem(ci().badKey); } catch (x) {} }
            log('saved build ' + m.build + ' on this TV');
            lastInfo = null;
            toUsb(bundle, function () { lastInfo = null; cb(null); });
        });
    }

    // download every file of the running hosted build (the same addresses as the loader: the TV's cache answers most)
    function download(m, base, cb) {
        var list = files(m).concat(['app.html']), texts = {}, next = 0, active = 0, failed = false, done = 0;
        function get(i, tries) {
            AppBoot.get(base + list[i] + '?b=' + m.build, FILE_TIMEOUT, function (err, text) {
                if ((err || !text) && tries < 3) return setTimeout(function () { get(i, tries + 1); }, 2000);
                active--;
                if (err || !text) { failed = true; if (!active) cb('download'); return; }
                texts[list[i]] = text; done++;
                pump();
            });
        }
        function pump() {
            if (failed) return;
            while (active < PARALLEL && next < list.length) { active++; get(next++, 1); }
            if (!active && done === list.length) cb(null, texts);
        }
        pump();
    }

    function auto(delay) {
        if (!supported() || busy) return false;
        setTimeout(function () {
            if (busy) return;
            busy = true;
            readSaved(function (saved) {
                var src = AppBoot.source(), build = AppBoot.build(), m = AppBoot.manifest(), base = AppBoot.base();
                function end() { busy = false; }
                // running a newer hosted build that is not saved yet: save it (once per build)
                if (src === 'remote' && !AppBoot.cached() && base && m && (!saved || saved.build !== build)) {
                    return download(m, base, function (e, texts) {
                        if (e) { log('download failed, tried again at the next start'); return end(); }
                        save(m, base, texts, end);
                    });
                }
                // saved already: put it on a USB drive plugged in since (or a new drive)
                var u = usbKnown();
                if (saved && saved.build === build) {
                    return checkUsb(saved, u, end);
                }
                end();
            });
        }, delay === undefined ? 20000 : delay);
        return true;
    }
    // copy to the USB drive when the known copy is missing / older / on a drive that is gone
    function checkUsb(saved, u, cb) {
        if (typeof UsbFs === 'undefined' || !UsbFs.supported()) return cb();
        UsbFs.drives(function (e, list) {
            if (e || !list || !list.length) return cb();
            if (u && u.b === saved.build) {
                for (var i = 0; i < list.length; i++) if (u.p.indexOf(list[i].path + '/') === 0) return UsbFs.stat(u.p, function (e2, st) { if (!e2 && st && st.exists) return cb(); toUsb(saved, function () { cb(); }); });
            }
            toUsb(saved, function () { cb(); });
        });
    }

    var lastInfo = null;
    function info(cb) {
        readSaved(function (s) { lastInfo = { build: s ? s.build : 0, at: s ? s.at : 0, usb: usbKnown() }; if (cb) cb(lastInfo); });
    }

    return { supported: supported, auto: auto, save: save, info: info, last: function () { return lastInfo; } };
})();
