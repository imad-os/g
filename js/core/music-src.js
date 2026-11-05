/* Where the Music app finds songs (js/launcher/apps/music.js, player js/core/music.js).
 *
 * Every place is a "source" with the same calls; an entry is a plain object that can be saved (playlists, the queue):
 *   { s: 'usb' | 'gd' | 'loc', p: path or file id, n: name, dir: true for a folder, size, mime, thumb (Drive), root: drive name }
 *
 *   usb   USB drives and hard disks plugged into the TV: Tizen filesystem API (privileges filesystem.read / write and
 *         externalstorage, package 1.6.0). Real paths like /opt/media/USBDriveA1/Music; drives come and go
 *         (onDrives). Files are read in pieces with FileHandle.readDataNonBlocking (song details, covers).
 *   gd    Google Drive through the MyDrive app (store app "mydrive", owner request 2026-11-05): its Google client from the
 *         app's config (config.google.tvClientId / tvClientSecret in Firestore apps/mydrive) and the Google account the
 *         profile linked in MyDrive (its saved data: accounts[] + active, kept per profile like every app's data). Only what
 *         MyDrive may see (scope drive.file: the files added through MyDrive). gdStatus() says exactly what is missing.
 *   loc   a folder of this computer, in a browser that can open one (showDirectoryPicker): PCs only, kept per profile.
 *
 *   MusicSrc.drives(cb)               the USB drives now: [entry]
 *   MusicSrc.list(dir, cb)            cb(err, { dirs: [entry], tracks: [entry], images: [entry] }) sorted by name (natural)
 *   MusicSrc.walk(dir, max, cb, prog) every song under dir (sub-folders too), at most max
 *   MusicSrc.read(entry, at, len, cb) cb(err, Uint8Array)   a piece of a file
 *   MusicSrc.url(entry, cb)           cb(err, { url, path, revoke, blob: fn(progress, cb) })   what the player opens
 *   MusicSrc.rename(entry, name, cb)  cb(err, newEntry)
 *   MusicSrc.info(entry, cb)          song details (MusicTags) from the file, cached: { title, artist, album, dur, track }
 *   MusicSrc.art(entry, cb)           a small cover (256 px JPEG blob URL) + its main colour: cb({ url, color }) or cb(null)
 *   MusicSrc.folderArt(dir, cb)       a folder's cover: cover.jpg / folder.jpg..., else any picture, else its first song's
 * Errors are { code, message }: code 'perm' (no privilege: an older TV package), 'gone' (drive removed), 'noapp' /
 * 'noconfig' / 'nouser' / 'reauth' (Google Drive), 'network', 'unsupported'. */
var MusicSrc = (function () {
    'use strict';

    var AUDIO = /\.(mp3|m4a|m4b|aac|flac|wav|wave|ogg|oga|opus|wma|aif|aiff|alac|mka|weba|mp2|mpga|ac3|ape|amr|3ga)$/i;
    var IMAGE = /\.(jpe?g|png|webp|bmp|gif)$/i;
    var COVER = /^(cover|folder|front|albumart(small|large)?|album|artwork|art)\.(jpe?g|png|webp|bmp)$/i;
    var SKIP = /^(\.|\$recycle\.bin$|system volume information$|lost\+found$|found\.\d+$)/i;
    var FOLDER = 'application/vnd.google-apps.folder';
    var DRIVE_API = 'https://www.googleapis.com/drive/v3/files';

    function err(code, message) { return { code: code, message: message || code }; }
    function tz() { return typeof tizen !== 'undefined' && tizen.filesystem ? tizen.filesystem : null; }
    function tzErr(e) {
        var n = e && (e.name || e.type) || '';
        if (/Security/i.test(n)) return err('perm', 'This TV package cannot read USB drives yet.');
        if (/NotFound/i.test(n)) return err('gone', 'Not found: the drive may have been removed.');
        return err('io', (e && e.message) || String(e));
    }
    function base(p) { var i = String(p).lastIndexOf('/'); return i >= 0 ? p.slice(i + 1) : p; }
    function parent(p) { var i = String(p).lastIndexOf('/'); return i > 0 ? p.slice(0, i) : p; }
    function join(a, b) { return a.charAt(a.length - 1) === '/' ? a + b : a + '/' + b; }

    // natural order: "2 Song" before "10 Song"
    var collator = null;
    try { collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }); } catch (e) {}
    function byName(a, b) { return collator ? collator.compare(a.n, b.n) : (a.n.toLowerCase() < b.n.toLowerCase() ? -1 : 1); }
    function sorted(list) {
        var out = { dirs: [], tracks: [], images: [] };
        for (var i = 0; i < list.length; i++) {
            var e = list[i];
            if (!e || !e.n || SKIP.test(e.n)) continue;
            if (e.dir) out.dirs.push(e);
            else if (AUDIO.test(e.n) || /^audio\//.test(e.mime || '')) out.tracks.push(e);
            else if (IMAGE.test(e.n) || /^image\//.test(e.mime || '')) out.images.push(e);
        }
        out.dirs.sort(byName); out.tracks.sort(byName); out.images.sort(byName);
        return out;
    }
    function isAudio(e) { return !!e && !e.dir && (AUDIO.test(e.n || '') || /^audio\//.test(e.mime || '')); }

    /* ================= USB drives (Tizen) ================= */
    // "USBDriveA1" -> "USB drive A1"; labels like "removable_sda1" -> "USB drive sda1"
    function driveName(path, label) {
        var b = base(path) || label || '';
        var m = /^USBDrive(\w+)$/i.exec(b) || /^removable_?(\w+)$/i.exec(b);
        return m ? 'USB ' + m[1] : b;
    }
    function uriPath(uri) {
        var p = String(uri || '').replace(/^file:\/\//, '');
        try { p = decodeURI(p); } catch (e) {}
        return p.replace(/\/+$/, '');
    }
    function usbDrives(cb) {
        var fs = tz();
        if (!fs) return cb(null, []);
        var out = [], seen = {}, tasks = 0, first = null;
        function add(path, label) {
            if (!path || seen[path]) return;
            seen[path] = 1;
            out.push({ s: 'usb', p: path, n: driveName(path, label), dir: true, drive: true, root: driveName(path, label) });
        }
        function start() { tasks++; }
        function end() { if (--tasks === 0) { out.sort(byName); cb(out.length ? null : first, out); } }
        // the usual Samsung mount folder too (some firmwares list no storage, or cannot resolve its label)
        function media() {
            if (!fs.listDirectory) return;
            start();
            try {
                fs.listDirectory('/opt/media', function (names) {
                    for (var i = 0; i < names.length; i++) {
                        var p = '/opt/media/' + names[i];
                        try { if (/^USBDrive/i.test(names[i]) && fs.isDirectory(p)) add(p, names[i]); } catch (x) {}
                    }
                    end();
                }, function (e) { if (!first) first = tzErr(e); end(); });
            } catch (e) { if (!first) first = tzErr(e); end(); }
        }
        start();
        try {
            fs.listStorages(function (list) {
                for (var i = 0; i < (list || []).length; i++) {
                    var st = list[i];
                    if (st.type !== 'EXTERNAL' || st.state === 'REMOVED' || st.state === 'UNMOUNTABLE') continue;
                    start();
                    (function (label) {
                        try {
                            fs.resolve(label, function (dir) {
                                var p = '';
                                try { p = uriPath(dir.toURI()); } catch (x) {}
                                if (!p && dir.fullPath && dir.fullPath.charAt(0) === '/') p = dir.fullPath;
                                add(p, label);
                                end();
                            }, function (e) { if (!first) first = tzErr(e); end(); }, 'r');
                        } catch (e) { if (!first) first = tzErr(e); end(); }
                    })(st.label);
                }
                media();
                end();
            }, function (e) { first = tzErr(e); media(); end(); });
        } catch (e) { first = tzErr(e); media(); end(); }
    }
    function usbList(dir, cb) {
        var fs = tz();
        if (!fs) return cb(err('unsupported'));
        var root = dir.root;
        function entry(name, isDir, size) {
            return { s: 'usb', p: join(dir.p, name), n: name, dir: !!isDir, size: size || 0, root: root };
        }
        function old(e0) {
            try {
                fs.resolve(dir.p, function (d) {
                    d.listFiles(function (files) {
                        var l = [];
                        for (var i = 0; i < files.length; i++) l.push(entry(files[i].name, files[i].isDirectory, files[i].fileSize));
                        cb(null, sorted(l));
                    }, function (e) { cb(tzErr(e)); });
                }, function (e) { cb(e0 || tzErr(e)); }, 'r');
            } catch (e) { cb(e0 || tzErr(e)); }
        }
        if (!fs.listDirectory) return old();
        try {
            fs.listDirectory(dir.p, function (names) {
                var l = [];
                for (var i = 0; i < names.length; i++) {
                    if (SKIP.test(names[i])) continue;
                    var isDir = false;
                    // only names that look like folders are asked (one call per entry): "Song.mp3" is a file
                    if (!AUDIO.test(names[i]) && !IMAGE.test(names[i])) { try { isDir = fs.isDirectory(join(dir.p, names[i])); } catch (x) {} if (!isDir) continue; }
                    l.push(entry(names[i], isDir, 0));
                }
                cb(null, sorted(l));
            }, function (e) { old(tzErr(e)); });
        } catch (e) { old(tzErr(e)); }
    }
    function usbRead(e, at, len, cb) {
        var fs = tz(), done = false;
        function finish(x, d) { if (done) return; done = true; cb(x, d); }
        if (!fs) return finish(err('unsupported'));
        if (fs.openFile) {
            var fh = null;
            try {
                fh = fs.openFile(e.p, 'r');
                var size = 0;
                try { size = fh.seek(0, 'END'); fh.seek(at || 0, 'BEGIN'); } catch (x) { size = 0; }
                if (size && at >= size) { try { fh.close(); } catch (x2) {} return finish(null, new Uint8Array(0), size); }
                var n = size ? Math.min(len, size - (at || 0)) : len;
                var close = function () { try { if (fh.closeNonBlocking) fh.closeNonBlocking(); else fh.close(); } catch (x3) {} };
                if (fh.readDataNonBlocking) {
                    fh.readDataNonBlocking(function (data) { close(); e.size = size || e.size; finish(null, data); }, function (x) { close(); finish(tzErr(x)); }, n);
                } else { var d = fh.readData(n); close(); e.size = size || e.size; finish(null, d); }
                return;
            } catch (x4) { try { fh && fh.close(); } catch (x5) {} if (!fs.resolve) return finish(tzErr(x4)); }
        }
        // the older File API
        try {
            fs.resolve(e.p, function (f) {
                f.openStream('r', function (st) {
                    try { st.position = at || 0; var a = st.readBytes(len); st.close(); e.size = f.fileSize || e.size; finish(null, new Uint8Array(a)); }
                    catch (x) { try { st.close(); } catch (y) {} finish(tzErr(x)); }
                }, function (x) { finish(tzErr(x)); });
            }, function (x) { finish(tzErr(x)); }, 'r');
        } catch (x) { finish(tzErr(x)); }
    }
    function usbUrl(e, cb) {
        var uri = 'file://' + encodeURI(e.p);
        try { var fs = tz(); if (fs && fs.toURI) uri = fs.toURI(e.p); } catch (x) {}
        cb(null, { url: uri, path: e.p });
    }
    function usbRename(e, name, cb) {
        var fs = tz(), to = join(parent(e.p), name);
        function done() { var n = {}; for (var k in e) n[k] = e[k]; n.p = to; n.n = name; cb(null, n); }
        if (!fs) return cb(err('unsupported'));
        try {
            if (fs.rename) return fs.rename(e.p, name, done, function (x) { cb(tzErr(x)); });
        } catch (x) { if (!fs.resolve) return cb(tzErr(x)); }
        try {
            fs.resolve(parent(e.p), function (d) {
                d.moveTo(e.p, to, false, done, function (x) { cb(tzErr(x)); });
            }, function (x) { cb(tzErr(x)); }, 'rw');
        } catch (x) { cb(tzErr(x)); }
    }
    var driveFns = [], watching = false;
    function onDrives(fn) {
        driveFns.push(fn);
        var fs = tz();
        if (watching || !fs || !fs.addStorageStateChangeListener) return;
        watching = true;
        try {
            fs.addStorageStateChangeListener(function (st) {
                for (var i = 0; i < driveFns.length; i++) { try { driveFns[i](st && st.state); } catch (x) {} }
            });
        } catch (e) {}
    }

    /* ================= Google Drive, through MyDrive ================= */
    var GD_APP = 'mydrive', GD_DATA = 'game_app-mydrive_data';
    var token = null, tokenFor = '', tokenAt = 0, tokenWait = null;
    function gdApp() {
        var list = typeof Cloud !== 'undefined' ? Cloud.apps() : [];
        for (var i = 0; i < list.length; i++) if (list[i].id === GD_APP) return list[i];
        return null;
    }
    function gdAccount() {
        var d = Store.get(GD_DATA, {}) || {}, l = Array.isArray(d.accounts) ? d.accounts : [], a = null;
        for (var i = 0; i < l.length; i++) if (l[i] && l[i].id === d.active) a = l[i];
        return a || l[0] || null;
    }
    function gdCfg(app) { var g = app && app.config && app.config.google; return g && g.tvClientId && g.tvClientSecret ? g : null; }
    // what stands between this profile and its Google Drive: cb({ ok, code, email, name })
    function gdStatus(cb) {
        var installed = typeof Cloud !== 'undefined' && Cloud.isInstalled(GD_APP), app = gdApp();
        if (!installed || !app) return cb({ code: 'noapp' });
        function rest(a) {
            if (!gdCfg(a)) return cb({ code: 'noconfig' });
            var acc = gdAccount();
            if (!acc) return cb({ code: 'nouser' });
            if (!acc.refreshToken || acc.needsReauth) return cb({ code: 'reauth', email: acc.email || '', name: acc.name || '' });
            cb({ ok: true, email: acc.email || '', name: acc.name || acc.email || '' });
        }
        if (gdCfg(app)) return rest(app);
        // the saved catalog may be older than the Manager's last change: ask once
        Cloud.fetchApp(GD_APP, function (e, fresh) { rest(!e && fresh ? fresh : app); });
    }
    function proxy(req, cb) {
        if (typeof WebProxy === 'undefined') return cb(err('unsupported'));
        WebProxy.request(req, {}, null, function (e, r) {
            if (e) return cb(err(e.code === 'timeout' || e.code === 'network' ? 'network' : e.code, e.message));
            cb(null, r);
        });
    }
    function gdToken(cb, fresh) {
        var acc = gdAccount(), app = gdApp(), g = gdCfg(app);
        if (!acc || !g) return cb(err(!app ? 'noapp' : !g ? 'noconfig' : 'nouser'));
        if (!acc.refreshToken || acc.needsReauth) return cb(err('reauth'));
        if (!fresh && token && tokenFor === acc.id && Date.now() < tokenAt) return cb(null, token);
        if (tokenWait) return tokenWait.push(cb);
        tokenWait = [cb];
        var body = 'client_id=' + encodeURIComponent(g.tvClientId) + '&client_secret=' + encodeURIComponent(g.tvClientSecret) +
                   '&refresh_token=' + encodeURIComponent(acc.refreshToken) + '&grant_type=refresh_token';
        proxy({ url: 'https://oauth2.googleapis.com/token', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body, responseType: 'json', timeout: 15000 }, function (e, r) {
            var x = null;
            if (e) x = e;
            else if (!r.ok || !r.body || !r.body.access_token) {
                var code = r.body && r.body.error || '';
                x = /invalid_grant|unauthorized_client|invalid_client/.test(code) ? err('reauth', code) : err('http', 'Google: ' + (code || r.status));
            } else if (r.body.scope && String(r.body.scope).indexOf('/auth/drive') < 0) x = err('reauth', 'no Drive access');
            else { token = r.body.access_token; tokenFor = acc.id; tokenAt = Date.now() + ((+r.body.expires_in || 3600) - 120) * 1000; }
            var w = tokenWait; tokenWait = null;
            for (var i = 0; i < w.length; i++) w[i](x, x ? null : token);
        });
    }
    // an authorized Drive request; a 401 gets a new token once
    function gd(req, cb, retried) {
        gdToken(function (e, tok) {
            if (e) return cb(e);
            var h = {}, k;
            for (k in req.headers || {}) h[k] = req.headers[k];
            h.Authorization = 'Bearer ' + tok;
            var r2 = {}; for (k in req) r2[k] = req[k];
            r2.headers = h;
            proxy(r2, function (e2, r) {
                if (e2) return cb(e2);
                if (r.status === 401 && !retried) { token = null; return gd(req, cb, true); }
                if (r.status === 401 || (r.status === 403 && /insufficient|scope/i.test(JSON.stringify(r.body || '')))) return cb(err('reauth'));
                if (r.status === 404) return cb(err('gone'));
                if (r.status < 200 || r.status >= 300) return cb(err('http', 'Google Drive: HTTP ' + r.status));
                cb(null, r);
            });
        }, retried);
    }
    function gdEntry(f) {
        return { s: 'gd', p: f.id, n: f.name || '', dir: f.mimeType === FOLDER, size: +f.size || 0, mime: f.mimeType || '', thumb: f.thumbnailLink || '', root: 'Google Drive' };
    }
    function gdRoots() {
        return [{ s: 'gd', p: 'root', n: 'My Drive', dir: true, drive: true, root: 'Google Drive' },
                { s: 'gd', p: '*audio', n: '*audio', dir: true, drive: true, root: 'Google Drive' }];
    }
    function gdList(dir, cb) {
        var q = dir.p === '*audio' ? "mimeType contains 'audio/' and trashed = false" : "'" + String(dir.p).replace(/'/g, "\\'") + "' in parents and trashed = false";
        var all = [], pages = 0;
        function page(tok) {
            var url = DRIVE_API + '?pageSize=200&spaces=drive&orderBy=folder,name_natural&q=' + encodeURIComponent(q) +
                      '&fields=' + encodeURIComponent('nextPageToken,files(id,name,mimeType,size,thumbnailLink)') + (tok ? '&pageToken=' + encodeURIComponent(tok) : '');
            gd({ url: url, responseType: 'json', timeout: 20000 }, function (e, r) {
                if (e) return cb(e);
                var f = (r.body && r.body.files) || [];
                for (var i = 0; i < f.length; i++) all.push(gdEntry(f[i]));
                if (r.body && r.body.nextPageToken && ++pages < 10) return page(r.body.nextPageToken);
                cb(null, sorted(all));
            });
        }
        page('');
    }
    function gdRead(e, at, len, cb) {
        gd({ url: DRIVE_API + '/' + encodeURIComponent(e.p) + '?alt=media', headers: { Range: 'bytes=' + (at || 0) + '-' + ((at || 0) + len - 1) }, responseType: 'arraybuffer', timeout: 30000 }, function (x, r) {
            if (x) return cb(x);
            var m = /\/(\d+)\s*$/.exec((r.headers && r.headers['content-range']) || '');
            if (m) e.size = +m[1];
            cb(null, new Uint8Array(r.body || new ArrayBuffer(0)));
        });
    }
    function gdUrl(e, cb) {
        gdToken(function (x, tok) {
            if (x) return cb(x);
            cb(null, {
                url: DRIVE_API + '/' + encodeURIComponent(e.p) + '?alt=media&access_token=' + encodeURIComponent(tok),
                // when the player cannot stream it: the whole song downloaded into memory (one at a time)
                blob: function (progress, done) {
                    gd({ url: DRIVE_API + '/' + encodeURIComponent(e.p) + '?alt=media', responseType: 'arraybuffer', timeout: 180000, maxBytes: 80 * 1024 * 1024 }, function (x2, r) {
                        if (x2) return done(x2);
                        var b = new Blob([r.body], { type: (r.headers && r.headers['content-type']) || e.mime || 'audio/mpeg' });
                        done(null, URL.createObjectURL(b));
                    });
                }
            });
        });
    }
    function gdRename(e, name, cb) {
        gd({ url: DRIVE_API + '/' + encodeURIComponent(e.p) + '?fields=id,name', method: 'PATCH', json: { name: name }, responseType: 'json' }, function (x) {
            if (x) return cb(x);
            var n = {}; for (var k in e) n[k] = e[k]; n.n = name; cb(null, n);
        });
    }

    /* ================= a folder of this computer (browsers that can open one) ================= */
    var locRoots = null, locHandles = {};
    function locOk() { return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function' && typeof tizen === 'undefined' && typeof indexedDB !== 'undefined'; }
    function idb(cb) {
        try {
            var rq = indexedDB.open('mypc-music', 1);
            rq.onupgradeneeded = function () { rq.result.createObjectStore('roots'); };
            rq.onsuccess = function () { cb(null, rq.result); };
            rq.onerror = function () { cb(err('io')); };
        } catch (e) { cb(err('io')); }
    }
    function locLoad(cb) {
        if (locRoots) return cb(locRoots);
        if (!locOk()) return cb([]);
        idb(function (e, db) {
            if (e) return cb(locRoots = []);
            var rq = db.transaction('roots').objectStore('roots').get(Store.profile());
            rq.onsuccess = function () { locRoots = Array.isArray(rq.result) ? rq.result : []; cb(locRoots); };
            rq.onerror = function () { cb(locRoots = []); };
        });
    }
    function locSave() {
        idb(function (e, db) { if (!e) { try { db.transaction('roots', 'readwrite').objectStore('roots').put(locRoots, Store.profile()); } catch (x) {} } });
    }
    function locEntries(cb) {
        locLoad(function (l) {
            cb(l.map(function (r) { return { s: 'loc', p: r.id, n: r.name, dir: true, drive: true, root: r.name }; }));
        });
    }
    function locAdd(cb) {
        if (!locOk()) return cb(err('unsupported'));
        window.showDirectoryPicker({ mode: 'read' }).then(function (h) {
            locLoad(function (l) {
                var id = 'L' + Date.now().toString(36);
                l.push({ id: id, name: h.name, handle: h });
                locSave();
                cb(null, { s: 'loc', p: id, n: h.name, dir: true, drive: true, root: h.name });
            });
        }, function (e) { cb(err(e && e.name === 'AbortError' ? 'cancelled' : 'io', e && e.message)); });
    }
    function locForget(id) { locLoad(function (l) { locRoots = l.filter(function (r) { return r.id !== id; }); locSave(); }); }
    // the handle of a path "<root id>/<names...>"
    function locHandle(path, file, cb) {
        if (locHandles[path]) return cb(null, locHandles[path]);
        var parts = String(path).split('/'), id = parts.shift();
        locLoad(function (l) {
            var r = null;
            for (var i = 0; i < l.length; i++) if (l[i].id === id) r = l[i];
            if (!r) return cb(err('gone'));
            var h = r.handle;
            var perm = h.queryPermission ? h.queryPermission({ mode: 'read' }) : Promise.resolve('granted');
            perm.then(function (p) { return p === 'granted' ? p : h.requestPermission({ mode: 'read' }); }).then(function (p) {
                if (p !== 'granted') throw err('perm', 'not allowed');
                var step = function (cur, k) {
                    if (k >= parts.length) return Promise.resolve(cur);
                    var last = k === parts.length - 1;
                    return (last && file ? cur.getFileHandle(parts[k]) : cur.getDirectoryHandle(parts[k])).then(function (n) { return step(n, k + 1); });
                };
                return step(h, 0);
            }).then(function (x) { locHandles[path] = x; cb(null, x); }, function (e) { cb(e && e.code ? e : err('gone', e && e.message)); });
        });
    }
    function locList(dir, cb) {
        locHandle(dir.p, false, function (e, h) {
            if (e) return cb(e);
            var out = [], it = h.values();
            function next() {
                it.next().then(function (r) {
                    if (r.done || out.length > 5000) return cb(null, sorted(out));
                    var v = r.value;
                    out.push({ s: 'loc', p: dir.p + '/' + v.name, n: v.name, dir: v.kind === 'directory', root: dir.root });
                    next();
                }, function (x) { cb(err('io', x && x.message)); });
            }
            next();
        });
    }
    function locFile(e, cb) { locHandle(e.p, true, function (x, h) { if (x) return cb(x); h.getFile().then(function (f) { cb(null, f); }, function (y) { cb(err('io', y && y.message)); }); }); }
    function locRead(e, at, len, cb) {
        locFile(e, function (x, f) {
            if (x) return cb(x);
            e.size = f.size;
            f.slice(at || 0, (at || 0) + len).arrayBuffer().then(function (b) { cb(null, new Uint8Array(b)); }, function (y) { cb(err('io', y && y.message)); });
        });
    }
    function locUrl(e, cb) {
        locFile(e, function (x, f) { if (x) return cb(x); cb(null, { url: URL.createObjectURL(f), revoke: true }); });
    }

    /* ================= one door for all of them ================= */
    var SRC = {
        usb: { list: usbList, read: usbRead, url: usbUrl, rename: usbRename },
        gd: { list: gdList, read: gdRead, url: gdUrl, rename: gdRename },
        loc: { list: locList, read: locRead, url: locUrl, rename: function (e, n, cb) { cb(err('unsupported')); } }
    };
    // tests and future sources (a network share...): MusicSrc.add('id', { list, read, url, rename })
    function add(id, impl) { SRC[id] = impl; }
    function src(e) { return e && SRC[e.s]; }
    function call(name, e, args) {
        var s = src(e), cb = args[args.length - 1];
        if (!s || !s[name]) return cb(err('unsupported'));
        try { s[name].apply(null, args); } catch (x) { cb(err('io', x && x.message)); }
    }
    function list(dir, cb) { call('list', dir, [dir, cb]); }
    function read(e, at, len, cb) { call('read', e, [e, at, len, cb]); }
    function url(e, cb) { call('url', e, [e, cb]); }
    function rename(e, name, cb) {
        name = String(name || '').replace(/[\/\\:*?"<>|\u0000-\u001f]/g, '').replace(/^\s+|\s+$/g, '');
        if (!name || name === '.' || name === '..') return cb(err('badname'));
        if (!e.dir) { var ext = /\.[a-z0-9]{2,5}$/i.exec(e.n); if (ext && !/\.[a-z0-9]{2,5}$/i.test(name)) name += ext[0]; }
        call('rename', e, [e, name, function (x, n) { if (!x) { forget(e); forget(n); } cb(x, n); }]);
    }

    // every song under a folder, folders in name order, at most max (a few sub-folder levels)
    function walk(dir, max, cb, prog) {
        var out = [], queue = [{ d: dir, depth: 0 }], seen = 0;
        function step() {
            if (!queue.length || out.length >= max) return cb(null, out.slice(0, max));
            var q = queue.shift();
            list(q.d, function (e, r) {
                if (e) { if (q.d === dir) return cb(e); return step(); }
                for (var i = 0; i < r.tracks.length && out.length < max; i++) out.push(r.tracks[i]);
                if (q.depth < 6) for (var j = r.dirs.length - 1; j >= 0; j--) queue.unshift({ d: r.dirs[j], depth: q.depth + 1 });
                if (prog && ++seen % 5 === 0) prog(out.length);
                setTimeout(step, 0);               // let the remote keep answering between folders
            });
        }
        step();
    }

    /* ================= song details and covers (small caches, one file read at a time) ================= */
    var info = {}, infoKeys = [], art = {}, artKeys = [], INFO_MAX = 600, ART_MAX = 160;
    var jobs = [], busy = false;
    function key(e) { return e.s + ':' + e.p; }
    function remember(map, keys, k, v, max, drop) {
        if (!(k in map)) keys.push(k);
        map[k] = v;
        while (keys.length > max) { var old = keys.shift(); if (drop) drop(map[old]); delete map[old]; }
    }
    function forget(e) { if (!e) return; var k = key(e); delete info[k]; delete art[k]; }
    // one job at a time; jobs asked for again move to the front (what is on screen now comes first)
    function job(k, fn, cb) {
        for (var i = 0; i < jobs.length; i++) if (jobs[i].k === k) { jobs[i].cbs.push(cb); jobs.unshift(jobs.splice(i, 1)[0]); return; }
        jobs.unshift({ k: k, fn: fn, cbs: [cb] });
        if (jobs.length > 80) { var gone = jobs.pop(); for (var g = 0; g < gone.cbs.length; g++) gone.cbs[g](null); }
        run();
    }
    function run() {
        if (busy || !jobs.length) return;
        busy = true;
        var j = jobs.shift(), finished = false;
        var t = setTimeout(function () { end(null); }, 20000);
        function end(v) {
            if (finished) return;
            finished = true; clearTimeout(t);
            for (var i = 0; i < j.cbs.length; i++) { try { j.cbs[i](v); } catch (x) {} }
            busy = false;
            setTimeout(run, 0);
        }
        try { j.fn(end); } catch (x) { end(null); }
    }
    function cancelJobs() { var l = jobs; jobs = []; for (var i = 0; i < l.length; i++) for (var k = 0; k < l[i].cbs.length; k++) { try { l[i].cbs[k](null); } catch (x) {} } }

    // reads the head of the file (more when the picture is further), MP4 details at their offset
    function tags(e, wantPic, cb) {
        if (typeof MusicTags === 'undefined') return cb({});
        read(e, 0, MusicTags.HEAD, function (x, b) {
            if (x || !b) return cb({});
            var r = MusicTags.parse(b, e.size || 0, wantPic);
            if (r.more && r.more > b.length) {
                return read(e, 0, r.more, function (x2, b2) { cb(x2 || !b2 ? r : MusicTags.parse(b2, e.size || 0, wantPic)); });
            }
            if (r.at !== undefined && r.len) {
                return read(e, r.at, r.len, function (x3, b3) { cb(x3 || !b3 ? {} : MusicTags.parseMp4(b3, {})); });
            }
            cb(r);
        });
    }
    function plain(r, e) {
        var n = MusicTags.fromName(e.n);
        return { title: r.title || n.title, artist: r.artist || r.albumArtist || n.artist || '', album: r.album || '', track: r.track || n.track || 0, dur: r.dur || 0, year: r.year || '',
                 guessT: !r.title, guessA: !(r.artist || r.albumArtist) };     // guessed from the file name: never over a title we already have
    }
    function getInfo(e, cb) {
        var k = key(e);
        if (info[k]) return cb(info[k]);
        if (typeof MusicTags === 'undefined') return cb({ title: e.n });
        job('i' + k, function (done) {
            tags(e, false, function (r) { var p = plain(r || {}, e); remember(info, infoKeys, k, p, INFO_MAX); done(p); });
        }, function (v) { cb(v || plain({}, e)); });
    }

    // a picture (bytes or a Blob) -> 256 px square JPEG + its main colour, without decoding big pictures at full size
    function shrink(blob, cb) {
        var S = 256;
        if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return cb({ url: URL.createObjectURL(blob), color: '' });
        createImageBitmap(blob, { resizeWidth: S, resizeQuality: 'medium' }).then(function (bmp) {
            var c = document.createElement('canvas'), h = Math.max(1, Math.round(bmp.height)), side = Math.min(bmp.width, h);
            c.width = c.height = S;
            var g = c.getContext('2d');
            g.drawImage(bmp, (bmp.width - side) / 2, (h - side) / 2, side, side, 0, 0, S, S);
            try { bmp.close(); } catch (x) {}
            var color = '';
            try {
                var t = document.createElement('canvas'); t.width = t.height = 4;
                var tg = t.getContext('2d'); tg.drawImage(c, 0, 0, 4, 4);
                var d = tg.getImageData(0, 0, 4, 4).data, r = 0, gg = 0, b = 0;
                for (var i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
                color = 'rgb(' + Math.round(r / 16) + ',' + Math.round(gg / 16) + ',' + Math.round(b / 16) + ')';
            } catch (x2) {}
            c.toBlob(function (out) { c.width = c.height = 0; cb(out ? { url: URL.createObjectURL(out), color: color } : null); }, 'image/jpeg', 0.85);
        }, function () { cb(null); });
    }
    function dropArt(v) { if (v && v.url) { try { URL.revokeObjectURL(v.url); } catch (x) {} } }
    function keepArt(k, v) { remember(art, artKeys, k, v || false, ART_MAX, dropArt); }
    function trackArt(e, cb) {
        var k = key(e);
        if (k in art) return cb(art[k] || null);
        job('a' + k, function (done) {
            tags(e, true, function (r) {
                if (!info[k] && r) remember(info, infoKeys, k, plain(r, e), INFO_MAX);
                if (!r || !r.pic) { keepArt(k, false); return done(null); }
                shrink(new Blob([r.pic.data], { type: r.pic.mime }), function (v) { keepArt(k, v); done(v); });
            });
        }, cb);
    }
    // a picture file (cover.jpg...) -> small cover
    function imageArt(e, cb) {
        var k = key(e);
        if (k in art) return cb(art[k] || null);
        job('a' + k, function (done) {
            function fromBytes(x, b) {
                if (x || !b || !b.length) { keepArt(k, false); return done(null); }
                shrink(new Blob([b], { type: /png$/i.test(e.n) ? 'image/png' : 'image/jpeg' }), function (v) { keepArt(k, v); done(v); });
            }
            if (e.s === 'gd' && e.thumb) {
                return gd({ url: e.thumb.replace(/=s\d+$/, '') + '=s320', responseType: 'arraybuffer', timeout: 20000 }, function (x, r) { fromBytes(x, r && new Uint8Array(r.body)); });
            }
            read(e, 0, 8 * 1024 * 1024, fromBytes);
        }, cb);
    }
    function folderArt(dir, cb) {
        var k = key(dir);
        if (k in art) return cb(art[k] || null);
        list(dir, function (x, r) {
            if (x) { keepArt(k, false); return cb(null); }
            var pic = null, i;
            for (i = 0; i < r.images.length; i++) if (COVER.test(r.images[i].n)) { pic = r.images[i]; break; }
            if (!pic && r.images.length) pic = r.images[0];
            var done = function (v) { keepArt(k, v || false); cb(v || null); };
            if (pic) return imageArt(pic, done);
            if (r.tracks.length) return trackArt(r.tracks[0], done);
            if (r.dirs.length === 1) return folderArt(r.dirs[0], done);      // "Album/CD1"
            done(null);
        });
    }
    // a song's cover: its own picture, else its folder's
    function songArt(e, cb) {
        trackArt(e, function (v) {
            if (v) return cb(v);
            if (e.s === 'gd' || !e.p || e.p.indexOf('/') < 0) return cb(null);
            folderArt({ s: e.s, p: parent(e.p), n: base(parent(e.p)), dir: true, root: e.root }, cb);
        });
    }
    function peekArt(e) { var v = art[key(e)]; return v || null; }
    function peekInfo(e) { return info[key(e)] || null; }

    return {
        AUDIO: AUDIO, isAudio: isAudio, add: add, sorted: sorted, base: base, parent: parent,
        drives: usbDrives, onDrives: onDrives, list: list, walk: walk, read: read, url: url, rename: rename,
        info: getInfo, art: songArt, trackArt: trackArt, folderArt: folderArt, imageArt: imageArt, peekArt: peekArt, peekInfo: peekInfo,
        cancel: cancelJobs, forget: forget,
        gdStatus: gdStatus, gdRoots: gdRoots, gdApp: GD_APP,
        locOk: locOk, locRoots: locEntries, locAdd: locAdd, locForget: locForget,
        _reset: function () { info = {}; infoKeys = []; for (var k in art) dropArt(art[k]); art = {}; artKeys = []; token = null; locRoots = null; locHandles = {}; }
    };
})();
