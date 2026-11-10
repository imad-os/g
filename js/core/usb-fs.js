/* USB drives and hard disks plugged into the TV, for copying files (js/core/copy-jobs.js) and for apps (MyPC.usb, API 16).
 * Tizen filesystem API: privileges filesystem.read / filesystem.write / externalstorage (package 1.6.0 and newer).
 * Paths are real paths like /opt/media/USBDriveA1/Photos; only paths inside a plugged drive are accepted (inside()).
 * Reading reuses MyMusic's reader (MusicSrc.read); the drives are MusicSrc.drives (same firmware quirks).
 *
 *   UsbFs.supported()
 *   UsbFs.drives(cb)               cb(err, [{ path, name, free, total }])   bytes; 0 = the TV did not say
 *   UsbFs.list(path, cb)           cb(err, [{ name, path, dir, size }])     folders first, natural order, hidden / system entries left out
 *   UsbFs.stat(path, cb)           cb(err, { exists, dir, size })
 *   UsbFs.mkdir(path, cb)          the folder and any missing parent (already there is fine)
 *   UsbFs.read(path, at, len, cb)  cb(err, Uint8Array)
 *   UsbFs.writer(path, append, cb) cb(err, { write(u8, cb), close(cb) })     append false: a new (or emptied) file
 *   UsbFs.remove(path, cb)         a file
 *   UsbFs.safeName(name)           a name FAT32 / exFAT / NTFS accept
 *   UsbFs.inside(path)             true when the path is inside a drive of the last drives() answer (no "..")
 * Errors { code, message }: perm (no privilege: older package), gone (not there / drive removed), full, too-big (FAT32: 4 GB
 * per file), io, unsupported, bad-request. */
var UsbFs = (function () {
    'use strict';

    var SKIP = /^(\.|\$recycle\.bin$|system volume information$|lost\+found$|found\.\d+$)/i;
    var FAT_MAX = 4294967295;
    var known = [];          // the drive paths of the last drives() answer

    function err(code, message) { return { code: code, message: message || code }; }
    function tz() { return typeof tizen !== 'undefined' && tizen.filesystem ? tizen.filesystem : null; }
    function later(fn) { setTimeout(fn, 0); }
    function tzErr(e) {
        var n = (e && (e.name || e.type)) || '', m = (e && e.message) || String(e || '');
        if (/Security/i.test(n)) return err('perm', 'This TV package cannot use USB drives (it needs My PC 1.6.0 or newer).');
        if (/NotFound/i.test(n)) return err('gone', 'Not found: the USB drive may have been removed.');
        if (/Quota|no space|ENOSPC|full/i.test(n + ' ' + m)) return err('full', 'The USB drive is full.');
        return err('io', m || 'The USB drive could not be used.');
    }
    function base(p) { var i = String(p).lastIndexOf('/'); return i >= 0 ? p.slice(i + 1) : p; }
    function parent(p) { var i = String(p).lastIndexOf('/'); return i > 0 ? p.slice(0, i) : p; }
    function join(a, b) { return a.charAt(a.length - 1) === '/' ? a + b : a + '/' + b; }
    function supported() { return !!tz(); }

    var collator = null;
    try { collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }); } catch (e) {}
    function byName(a, b) {
        if (a.dir !== b.dir) return a.dir ? -1 : 1;
        return collator ? collator.compare(a.name, b.name) : (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1);
    }

    function clean(p) {
        p = String(p || '').replace(/\/+$/, '');
        if (!p || p.charAt(0) !== '/' || /(^|\/)\.\.?(\/|$)/.test(p) || /[\u0000]/.test(p)) return '';
        return p.replace(/\/{2,}/g, '/');
    }
    function inside(p) {
        p = clean(p);
        if (!p) return false;
        for (var i = 0; i < known.length; i++) if (p === known[i] || p.indexOf(known[i] + '/') === 0) return true;
        return false;
    }

    // FAT32 / exFAT / NTFS: no \ / : * ? " < > | or control characters, no dot / space at the end, no DOS device names
    function safeName(n) {
        n = String(n || '').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_').replace(/[. ]+$/, '').trim();
        if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(n)) n = '_' + n;
        if (n.length > 200) {
            var dot = n.lastIndexOf('.'), ext = dot > 0 && n.length - dot <= 10 ? n.slice(dot) : '';
            n = n.slice(0, 200 - ext.length) + ext;
        }
        return n || '_';
    }

    // how much is free: the TV says it per storage unit (systeminfo STORAGE); matched only when there is one USB unit
    function space(cb) {
        try {
            tizen.systeminfo.getPropertyValueArray('STORAGE', function (units) {
                var usb = (units || []).filter(function (u) { return u && /USB|MMC|EXTERNAL/i.test(u.type || '') || (u && u.isRemovable); });
                cb(usb.length === 1 ? { free: +usb[0].availableCapacity || 0, total: +usb[0].capacity || 0 } : null);
            }, function () { cb(null); });
        } catch (e) { cb(null); }
    }
    function drives(cb) {
        if (!tz() || typeof MusicSrc === 'undefined') { known = []; return later(function () { cb(null, []); }); }
        MusicSrc.drives(function (e, list) {
            list = list || [];
            known = list.map(function (d) { return clean(d.p); }).filter(Boolean);
            if (!list.length) return cb(e && e.code === 'perm' ? e : null, []);
            space(function (sp) {
                cb(null, list.map(function (d) { return { path: clean(d.p), name: d.n, free: sp && list.length === 1 ? sp.free : 0, total: sp && list.length === 1 ? sp.total : 0 }; }));
            });
        });
    }

    function sizeOf(fs, p) {
        var fh = null;
        try { fh = fs.openFile(p, 'r'); var n = fh.seek(0, 'END'); try { fh.close(); } catch (x) {} return n >= 0 ? n : 0; }
        catch (e) { try { if (fh) fh.close(); } catch (x2) {} return -1; }
    }
    function list(path, cb) {
        var fs = tz(), p = clean(path);
        if (!fs) return later(function () { cb(err('unsupported', 'No USB drives here.')); });
        if (!p) return later(function () { cb(err('bad-request', 'Not a folder of a USB drive.')); });
        function old(e0) {
            if (!fs.resolve) return cb(e0 || err('unsupported'));
            try {
                fs.resolve(p, function (d) {
                    d.listFiles(function (files) {
                        var out = [];
                        for (var i = 0; i < files.length; i++) if (!SKIP.test(files[i].name)) out.push({ name: files[i].name, path: join(p, files[i].name), dir: !!files[i].isDirectory, size: files[i].isDirectory ? 0 : (+files[i].fileSize || 0) });
                        cb(null, out.sort(byName));
                    }, function (e) { cb(tzErr(e)); });
                }, function (e) { cb(e0 || tzErr(e)); }, 'r');
            } catch (e) { cb(e0 || tzErr(e)); }
        }
        if (!fs.listDirectory) return old();
        try {
            fs.listDirectory(p, function (names) {
                var out = [];
                for (var i = 0; i < names.length; i++) {
                    if (SKIP.test(names[i])) continue;
                    var q = join(p, names[i]), dir = false;
                    try { dir = fs.isDirectory(q); } catch (x) { continue; }
                    out.push({ name: names[i], path: q, dir: dir, size: dir ? 0 : Math.max(0, sizeOf(fs, q)) });
                }
                cb(null, out.sort(byName));
            }, function (e) { old(tzErr(e)); });
        } catch (e) { old(tzErr(e)); }
    }
    function stat(path, cb) {
        var fs = tz(), p = clean(path);
        if (!fs) return later(function () { cb(err('unsupported', 'No USB drives here.')); });
        if (!p) return later(function () { cb(err('bad-request', 'Not a path of a USB drive.')); });
        if (fs.isDirectory) {
            var dir;
            try { dir = fs.isDirectory(p); } catch (e) { return later(function () { cb(null, { exists: false, dir: false, size: 0 }); }); }
            var n = dir ? 0 : sizeOf(fs, p);
            return later(function () { cb(null, { exists: true, dir: !!dir, size: Math.max(0, n) }); });
        }
        try {
            fs.resolve(p, function (f) { cb(null, { exists: true, dir: !!f.isDirectory, size: f.isDirectory ? 0 : (+f.fileSize || 0) }); },
                       function (e) { var x = tzErr(e); if (x.code === 'gone') cb(null, { exists: false, dir: false, size: 0 }); else cb(x); }, 'r');
        } catch (e) { var x = tzErr(e); later(function () { if (x.code === 'gone') cb(null, { exists: false, dir: false, size: 0 }); else cb(x); }); }
    }
    function mkdir(path, cb) {
        var fs = tz(), p = clean(path);
        if (!fs) return later(function () { cb(err('unsupported', 'No USB drives here.')); });
        if (!p) return later(function () { cb(err('bad-request', 'Not a path of a USB drive.')); });
        stat(p, function (e, st) {
            if (e) return cb(e);
            if (st.exists) return cb(st.dir ? null : err('exists', 'A file has this name: ' + base(p)));
            if (fs.createDirectory) {
                try { return fs.createDirectory(p, true, function () { cb(null); }, function (x) { cb(tzErr(x)); }); } catch (x) { if (!fs.resolve) return cb(tzErr(x)); }
            }
            // the older File API: one level at a time
            mkdir(parent(p), function (e2) {
                if (e2) return cb(e2);
                try {
                    fs.resolve(parent(p), function (d) {
                        try { d.createDirectory(base(p)); cb(null); } catch (x) { cb(tzErr(x)); }
                    }, function (x) { cb(tzErr(x)); }, 'rw');
                } catch (x) { cb(tzErr(x)); }
            });
        });
    }
    function read(path, at, len, cb) {
        var p = clean(path);
        if (!p || typeof MusicSrc === 'undefined') return later(function () { cb(err('bad-request', 'Not a file of a USB drive.')); });
        MusicSrc.read({ s: 'usb', p: p, n: base(p) }, at, len, function (e, d) { cb(e, e ? null : (d instanceof Uint8Array ? d : new Uint8Array(d || 0))); });
    }

    function b64(u8) {
        var s = '';
        for (var i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768));
        return btoa(s);
    }
    function writer(path, append, cb) {
        var fs = tz(), p = clean(path);
        if (!fs) return later(function () { cb(err('unsupported', 'No USB drives here.')); });
        if (!p) return later(function () { cb(err('bad-request', 'Not a path of a USB drive.')); });
        var written = append && fs.openFile ? Math.max(0, sizeOf(fs, p)) : 0;
        // FAT32 refuses a file past 4 GB: say so instead of a plain write error
        function wErr(x, n) { var e = tzErr(x); if (e.code !== 'gone' && e.code !== 'perm' && written + (n || 0) > FAT_MAX) e = err('too-big', 'This USB drive (FAT32) cannot hold a file bigger than 4 GB. Format it as exFAT to copy it.'); return e; }
        if (fs.openFile) {
            var fh = null;
            try { fh = fs.openFile(p, append ? 'a' : 'w'); } catch (x) { if (!fs.resolve) return later(function () { cb(tzErr(x)); }); fh = null; }
            if (fh) {
                // a write still running when the copy is paused / stopped lands anyway: close() waits for it, so the next run
                // (which goes on from the file's real size) never sees a size that grows behind its back
                var busy = 0, onIdle = null;
                var settled = function () { busy--; if (!busy && onIdle) { var f = onIdle; onIdle = null; f(); } };
                var closeNow = function (done) {
                    try {
                        if (fh.closeNonBlocking) return fh.closeNonBlocking(function () { if (done) done(null); }, function (x) { if (done) done(tzErr(x)); });
                        fh.close();
                    } catch (x) {}
                    if (done) later(function () { done(null); });
                };
                return later(function () {
                    cb(null, {
                        write: function (u8, done) {
                            try {
                                if (fh.writeDataNonBlocking) { busy++; fh.writeDataNonBlocking(u8, function () { written += u8.length; settled(); done(null); }, function (x) { settled(); done(wErr(x, u8.length)); }); }
                                else { fh.writeData(u8); written += u8.length; later(function () { done(null); }); }
                            } catch (x) { if (busy) settled(); var e = wErr(x, u8.length); later(function () { done(e); }); }
                        },
                        close: function (done) {
                            if (!busy) return closeNow(done);
                            // a write that never answers (drive pulled out) must not hold the copies forever
                            var t = setTimeout(function () { if (onIdle) { onIdle = null; closeNow(done); } }, 20000);
                            onIdle = function () { clearTimeout(t); closeNow(done); };
                        }
                    });
                });
            }
        }
        // the older File API: a FileStream (bytes as base64, much faster than a plain array)
        function open(f) {
            f.openStream(append ? 'a' : 'w', function (st) {
                cb(null, {
                    write: function (u8, done) {
                        try { st.writeBase64(b64(u8)); written += u8.length; later(function () { done(null); }); }
                        catch (x) { var e = wErr(x, u8.length); later(function () { done(e); }); }
                    },
                    close: function (done) { try { st.close(); } catch (x) {} if (done) later(function () { done(null); }); }
                });
            }, function (x) { cb(tzErr(x)); });
        }
        try {
            fs.resolve(parent(p), function (d) {
                var f = null;
                try { f = d.resolve(base(p)); } catch (x) { f = null; }
                if (!f) { try { f = d.createFile(base(p)); } catch (x2) { return cb(tzErr(x2)); } }
                open(f);
            }, function (x) { cb(tzErr(x)); }, 'rw');
        } catch (x) { later(function () { cb(tzErr(x)); }); }
    }
    function remove(path, cb) {
        var fs = tz(), p = clean(path);
        cb = cb || function () {};
        if (!fs || !p) return later(function () { cb(err('bad-request')); });
        try {
            if (fs.deleteFile) return fs.deleteFile(p, function () { cb(null); }, function (x) { cb(tzErr(x)); });
            fs.resolve(parent(p), function (d) { d.deleteFile(p, function () { cb(null); }, function (x) { cb(tzErr(x)); }); }, function (x) { cb(tzErr(x)); }, 'rw');
        } catch (x) { later(function () { cb(tzErr(x)); }); }
    }

    return { supported: supported, drives: drives, list: list, stat: stat, mkdir: mkdir, read: read, writer: writer, remove: remove,
             safeName: safeName, inside: inside, join: join, base: base, parent: parent, FAT_MAX: FAT_MAX };
})();
if (typeof module !== 'undefined') module.exports = UsbFs;
