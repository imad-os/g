/* Installed apps and games saved on a USB drive, for when the internet fails (owner request 2026-11-19).
 *
 * Saving: an installed (store) app opened while online is remembered; when a USB drive is plugged in, My PC first makes the
 * app's folder <drive>/MyPC/apps/<id>/, then downloads the app into a folder of its own version <id>/<key>/ (key = version +
 * the GitHub tree, so a change published under the same version is noticed), and only when EVERY file is there it writes
 * <id>/saved.json pointing at it and removes the older copy. A half-saved copy is never used. A newer version in the store
 * (desktop start, or the next opening) saves the new copy the same way; the old one stays usable until then.
 *   Which files: the app's GitHub repository (api.github.com tree, one request per version) minus tools / tests / docs...,
 *   or exactly the paths in "offline" of its mypc-app.json (["index.html", "dist/", "assets/"]); "offline": false = never
 *   saved. Not on GitHub Pages: the entry page and what it links. The SDK <script> is pointed at a copy saved with the app.
 *   Big files in 4 MB Range pieces (1 MB with a pause while a game runs), a stopped download goes on from the file's size,
 *   files the older copy already has (same git sha) are copied on the drive instead of downloaded.
 * Opening (game-host.js): ONLINE ALWAYS WINS. The saved copy is used only when the store did not answer AND a live request
 *   to the app's own site failed just now (AppUsb.pick), or when the online page did not answer at all and the same check
 *   fails (GameHost.fail). It opens as file://.../<key>/<entry>?mypc_usb=<depth> in a frame WITHOUT allow-same-origin (on the
 *   TV every file:// page would otherwise share My PC's storage); the SDK (API 23) then serves the app's fetch() from the
 *   drive (MyPC.usb copy bridge 'usbfile') and gives it a memory localStorage.
 *
 *   AppUsb.supported() / on() / setOn(v)            TV-wide switch arc_dev_appusb_on (default on), Control Panel > System
 *   AppUsb.init({ game })                             both pages (one tab runs it: lease)
 *   AppUsb.want({ id, name, url, entry, version })    an app opened online: save / update it when a drive is there
 *   AppUsb.refresh(apps)                              the store list: saved apps with a newer version are updated
 *   AppUsb.pick({ id, entry }, cb(copy|null))         the saved copy, only when the app's own site does not answer now
 *   AppUsb.find(id, cb(copy|null))                    the complete copy on a plugged drive { dir, entry, uri, v, depth, drive }
 *   AppUsb.readFile(copy, rel, cb(err, ArrayBuffer))  a file of a saved copy (the SDK's fetch() from the USB copy)
 *   AppUsb.list() -> [{ id, name, state, v, done, total, err, drive }]; onChange(fn) */
var AppUsb = (function () {
    'use strict';

    var KEY = 'arc_dev_appusb', ON = 'arc_dev_appusb_on', LEASE = 'arc_dev_appusb_lease';
    var ROOT = 'MyPC/apps', SAVED = 'saved.json', SDK_DIR = '__mypc';
    var PIECE = 4 * 1024 * 1024, PIECE_GAME = 1024 * 1024, MAX_BYTES = 1024 * 1024 * 1024, MAX_FILES = 4000;
    var RECHECK = 24 * 3600000, PROBE_MS = 4000, GET_MS = 30000, RETRY = 10 * 60000;
    // never saved unless "offline" lists them: tools, tests, docs, sources of data, dot files, notes
    var SKIP = /^(node_modules|tests?|tools|docs|scripts|raw|bot_log|android[^/]*|\.github)\/|(^|\/)\.[^/]*$|(^|\/)\.[^/]*\/|\.(md|ps1|sh|bat|mjs)$|^(package(-lock)?\.json|LICENSE[^/]*|Makefile)$/i;
    var SDK_RE = /(<script[^>]+src=["'])(?:https?:)?\/\/(?:imad-os\.github\.io\/g|pc\.geekspro\.us)\/sdk\/mypc-sdk\.js[^"']*(["'])/gi;

    var st = null, fns = [], started = false, gamePage = false, run = null, wakeT = 0, leaseT = 0, found = {};
    var tab = (function () {
        var t = '';
        try { t = sessionStorage.getItem('mypc_au_tab') || ''; } catch (e) {}
        if (!t) { t = Math.random().toString(36).slice(2, 10); try { sessionStorage.setItem('mypc_au_tab', t); } catch (e2) {} }
        return t;
    })();

    function err(code, message) { return { code: code, message: message || code }; }
    function later(fn) { setTimeout(fn, 0); }
    function lsGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
    function load() { if (!st) { st = lsGet(KEY); if (!st || typeof st !== 'object' || !st.apps) st = { apps: {} }; } return st; }
    function save() { lsSet(KEY, load()); for (var i = 0; i < fns.length; i++) { try { fns[i](); } catch (e) {} } }

    function supported() { return typeof UsbFs !== 'undefined' && UsbFs.supported(); }
    function on() { var v = lsGet(ON); return v !== false; }
    function setOn(v) { lsSet(ON, !!v); if (v) kick(2000); else stop(); save(); }
    function online() { return typeof NetMode === 'undefined' || NetMode.mode() === 'online'; }
    function safeId(id) { return UsbFs.safeName(String(id).replace(/^app-/, '')); }
    function safePath(p) { return String(p).split('/').filter(Boolean).map(UsbFs.safeName).join('/'); }
    function enc(s) { return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s) : new Uint8Array(unescape(encodeURIComponent(s)).split('').map(function (c) { return c.charCodeAt(0); })); }
    function dec(u8) { try { return new TextDecoder('utf-8').decode(u8); } catch (e) { var s = ''; for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); try { return decodeURIComponent(escape(s)); } catch (x) { return s; } } }

    /* ---------------- web requests (no CORS on the TV; GitHub Pages and api.github.com allow it in a browser) ---------------- */
    // cb(err, data, status): type 'text' | 'json' | 'arraybuffer'; range [from, to] or null
    function get(url, type, range, cb) {
        var x = new XMLHttpRequest(), done = false;
        function end(e, d, s) { if (done) return; done = true; cb(e, d, s); }
        try {
            x.open('GET', url, true);
            x.responseType = type === 'arraybuffer' ? 'arraybuffer' : 'text';
            x.timeout = GET_MS;
            if (range) x.setRequestHeader('Range', 'bytes=' + range[0] + '-' + range[1]);
            x.onload = function () {
                var s = x.status;
                if (s === 0 && !/^file:/.test(url)) return end(err('network'));
                if (s && (s < 200 || s >= 300)) return end(err(s === 404 ? 'missing' : s === 403 || s === 429 ? 'limit' : 'http', 'HTTP ' + s + ' ' + url));
                if (type === 'json') { try { return end(null, JSON.parse(x.responseText), s); } catch (e) { return end(err('bad', 'Not JSON: ' + url)); } }
                end(null, type === 'arraybuffer' ? x.response : x.responseText, s);
            };
            x.onerror = function () { end(err('network', 'No answer: ' + url)); };
            x.ontimeout = function () { end(err('network', 'Too slow: ' + url)); };
            x.send();
        } catch (e) { later(function () { end(err('network', String(e && e.message || e))); }); }
    }
    // the app's own site answers right now (opaque answers count; a refused / failed / timed out request does not)
    function probe(url, cb) {
        var done = false, ctl = null, t;
        function end(ok) { if (done) return; done = true; clearTimeout(t); try { if (ctl && !ok) ctl.abort(); } catch (e) {} cb(ok); }
        t = setTimeout(function () { end(false); }, PROBE_MS);
        try {
            ctl = typeof AbortController === 'function' ? new AbortController() : null;
            fetch(url + (url.indexOf('?') < 0 ? '?' : '&') + 'mypc_probe=' + Date.now(), { mode: 'no-cors', cache: 'no-store', credentials: 'omit', signal: ctl ? ctl.signal : undefined })
                .then(function () { end(true); }, function () { end(false); });
        } catch (e) { end(false); }
    }

    /* ---------------- USB helpers ---------------- */
    function readAll(p, cb) {
        UsbFs.stat(p, function (e, s) {
            if (e || !s.exists || s.dir) return cb(e || err('gone'));
            if (!s.size) return cb(null, new Uint8Array(0));
            UsbFs.read(p, 0, s.size, cb);
        });
    }
    function writeAll(p, u8, cb) {
        UsbFs.writer(p, false, function (e, w) {
            if (e) return cb(e);
            w.write(u8, function (e2) { w.close(function () { cb(e2 || null); }); });
        });
    }
    function rmdir(p, cb) {
        var fs = typeof tizen !== 'undefined' && tizen.filesystem;
        cb = cb || function () {};
        if (!UsbFs.inside(p) || p.split('/').length < 8) return later(function () { cb(err('bad-request')); });     // only <drive>/MyPC/apps/<id>/<key>
        try {
            if (fs.deleteDirectory) return fs.deleteDirectory(p, true, function () { cb(null); }, function (x) { cb(err('io', String(x && x.message || x))); });
            fs.resolve(UsbFs.parent(p), function (d) { d.deleteDirectory(p, true, function () { cb(null); }, function (x) { cb(err('io', String(x && x.message || x))); }); }, function () { cb(err('gone')); }, 'rw');
        } catch (x) { later(function () { cb(err('io', String(x && x.message || x))); }); }
    }
    function copyOnDrive(a, b, cb) {
        var fs = typeof tizen !== 'undefined' && tizen.filesystem;
        if (!fs || !fs.copyFile) return later(function () { cb(err('unsupported')); });
        try { fs.copyFile(a, b, true, function () { cb(null); }, function (x) { cb(err('io', String(x && x.message || x))); }); }
        catch (x) { later(function () { cb(err('io', String(x && x.message || x))); }); }
    }
    function mkdirs(p, cb) { UsbFs.mkdir(p, cb); }
    function uri(p) {
        try { var fs = tizen.filesystem; if (fs && fs.toURI) return fs.toURI(p); } catch (e) {}
        return 'file://' + encodeURI(p);
    }

    /* ---------------- the saved copy on a plugged drive ---------------- */
    function readSaved(appDir, cb) {
        readAll(appDir + '/' + SAVED, function (e, u8) {
            if (e) return cb(null);
            var s = null;
            try { s = JSON.parse(dec(u8)); } catch (x) {}
            cb(s && s.mypc === 1 && s.key && s.entry ? s : null);
        });
    }
    function find(id, cb) {
        var f = found[id];
        if (f && Date.now() - f.at < 5000) return later(function () { cb(f.copy); });
        if (!supported()) return later(function () { cb(null); });
        UsbFs.drives(function (e, ds) {
            ds = ds || [];
            var i = 0;
            (function next() {
                if (i >= ds.length) { found[id] = { at: Date.now(), copy: null }; return cb(null); }
                var d = ds[i++], appDir = d.path + '/' + ROOT + '/' + safeId(id);
                readSaved(appDir, function (s) {
                    if (!s) return next();
                    var dir = appDir + '/' + s.key, entry = safePath(s.entry);
                    UsbFs.stat(dir + '/' + entry, function (e2, x) {
                        if (e2 || !x.exists) return next();
                        var copy = { id: id, dir: dir, entry: entry, depth: entry.split('/').length - 1, uri: uri(dir + '/' + entry), v: s.v || '', name: s.name || '', drive: d.name, drivePath: d.path, at: s.at || 0, bytes: +s.bytes || 0 };
                        found[id] = { at: Date.now(), copy: copy };
                        cb(copy);
                    });
                });
            })();
        });
    }
    // ONLINE ALWAYS WINS: a saved copy is given only when the app's own site does not answer right now
    function pick(app, cb) {
        if (!on() || !supported()) return later(function () { cb(null); });
        find(app.id, function (copy) {
            if (!copy) return cb(null);
            probe(app.entry, function (ok) { cb(ok ? null : copy); });
        });
    }
    function readFile(copy, rel, cb) {
        rel = String(rel || '').replace(/^\/+/, '').replace(/[?#].*$/, '');
        if (!copy || !rel || /(^|\/)\.\.?(\/|$)/.test(rel) || rel.length > 400) return later(function () { cb(err('bad-request')); });
        var p = copy.dir + '/' + safePath(rel);
        readAll(p, function (e, u8) {
            if (e) return cb(e.code === 'gone' ? err('missing') : e);
            cb(null, u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength ? u8.buffer : u8.slice().buffer);
        });
    }

    /* ---------------- the list of the app's files ---------------- */
    function wanted(paths, p) {
        for (var i = 0; i < paths.length; i++) {
            var w = String(paths[i] || '').replace(/^\.?\//, '');
            if (!w) continue;
            if (w.charAt(w.length - 1) === '/' ? p.indexOf(w) === 0 : p === w) return true;
        }
        return false;
    }
    // the files linked by an HTML page (not on GitHub Pages): scripts, styles, pictures, the icon
    function crawl(html) {
        var out = [], re = /(?:src|href)\s*=\s*["']([^"'#?]+)/gi, m;
        while ((m = re.exec(html))) {
            var u = m[1];
            if (/^([a-z]+:|\/\/|\/)/i.test(u) || /\.\.\//.test(u)) continue;
            out.push(u.replace(/^\.\//, ''));
        }
        return out;
    }
    // cb(err, { key, files: [{ p, size, sha }], entry }) for app rec { url, entry, v }
    function fileList(rec, cb) {
        var base = rec.url, entry = rec.entry.indexOf(base) === 0 ? rec.entry.slice(base.length).replace(/[?#].*$/, '') : 'index.html';
        get(base + 'mypc-app.json?mypc_v=' + encodeURIComponent(rec.v || ''), 'json', null, function (e, m) {
            if (e && e.code !== 'missing') return cb(e);
            m = m || {};
            if (m.offline === false) return cb(err('off', 'The app does not want to be saved ("offline": false).'));
            var only = Array.isArray(m.offline) ? m.offline : null;
            var gh = /^https:\/\/([a-z0-9-]+)\.github\.io\/([^/?#]*)/i.exec(base);
            function finish(files, key) {
                var seen = {}, list = [], bytes = 0;
                [entry, 'mypc-app.json'].concat(m.icon ? [String(m.icon)] : []).forEach(function (p) { if (!files.some(function (f) { return f.p === p; })) files.push({ p: p, size: -1, sha: '' }); });
                files.forEach(function (f) { if (!seen[f.p]) { seen[f.p] = 1; list.push(f); bytes += Math.max(0, f.size); } });
                if (list.length > MAX_FILES || bytes > MAX_BYTES) return cb(err('too-big', list.length + ' files, ' + Math.round(bytes / 1048576) + ' MB'));
                cb(null, { key: key, files: list, entry: entry, bytes: bytes });
            }
            var ver = 'v' + UsbFs.safeName(rec.v || '0').replace(/[^A-Za-z0-9._-]/g, '_');
            if (gh) {
                var repo = gh[2] || gh[1] + '.github.io';
                return get('https://api.github.com/repos/' + gh[1] + '/' + repo + '/git/trees/HEAD?recursive=1', 'json', null, function (e2, tree) {
                    if (e2 || !tree || !Array.isArray(tree.tree)) return cb(e2 || err('bad', 'No file list from GitHub.'));
                    var files = [];
                    tree.tree.forEach(function (t) {
                        if (t.type !== 'blob' || typeof t.path !== 'string') return;
                        if (only ? !wanted(only, t.path) : SKIP.test(t.path)) return;
                        files.push({ p: t.path, size: +t.size || 0, sha: t.sha || '' });
                    });
                    finish(files, ver + '-' + String(tree.sha || '').slice(0, 7));
                });
            }
            get(base + entry + '?mypc_v=' + encodeURIComponent(rec.v || ''), 'text', null, function (e3, html) {
                if (e3) return cb(e3);
                var paths = crawl(html).concat(only ? only.filter(function (p) { return p && p.charAt(p.length - 1) !== '/'; }) : []);
                finish(paths.map(function (p) { return { p: p, size: -1, sha: '' }; }), ver);
            });
        });
    }

    /* ---------------- saving (one app at a time, one file at a time) ---------------- */
    function rec(id) { return load().apps[id]; }
    function has(id) { return !!load().apps[id]; }
    function size(id) { var r = load().apps[id]; return r && r.state === 'saved' ? +r.total || 0 : 0; }
    function set(id, o) { var r = load().apps[id] = load().apps[id] || {}; for (var k in o) r[k] = o[k]; save(); return r; }
    function list() {
        var a = load().apps, out = [];
        for (var id in a) out.push({ id: id, name: a[id].name || id, state: a[id].state || 'wait', v: a[id].sv || '', want: a[id].v || '', done: a[id].done || 0, total: a[id].total || 0, err: a[id].err || '', drive: a[id].drive || '' });
        out.sort(function (x, y) { return x.name < y.name ? -1 : 1; });
        return out;
    }
    function nm(n) { return typeof n === 'string' ? n : n && typeof n === 'object' ? String(n.en || '') : ''; }
    function want(a) {
        if (a && !a.url && a.entry) a.url = String(a.entry).replace(/[?#].*$/, '').replace(/[^/]*$/, '');
        if (!a || !a.id || !a.url || !a.entry || !on() || !supported()) return;
        a.name = nm(a.name);
        var r = rec(a.id) || {};
        // App updates "Ask me" (owner 2026-11-28, js/core/app-live.js): an installed version is replaced only when the person says
        // Update (install()); a newer version is only noted (nv) until then
        if (!a.force && r.state === 'saved' && r.sv && a.version && a.version !== r.sv && typeof AppLive !== 'undefined' && AppLive.updMode() === 'ask') {
            if (r.nv !== a.version) set(a.id, { nv: a.version });
            return;
        }
        var due = r.sv !== (a.version || '') || r.state !== 'saved' || Date.now() - (r.checked || 0) > RECHECK;
        set(a.id, { name: a.name || r.name || a.id, url: a.url, entry: a.entry, v: a.version || '', q: due ? 1 : 0 });
        if (due) kick(gamePage ? 20000 : 1500);
    }
    function refresh(apps) {
        if (!on() || !supported()) return;
        var a = load().apps, by = {}, i;
        for (i = 0; i < (apps || []).length; i++) by[apps[i].id] = apps[i];
        for (var id in a) {
            var s = by[id];
            if (s && s.version && s.version !== a[id].sv) want({ id: id, name: s.name, url: s.url || a[id].url, entry: s.entry || a[id].entry, version: s.version });
        }
    }

    function lease() {
        var l = lsGet(LEASE), now = Date.now();
        if (l && l.t !== tab && now - (+l.at || 0) < 15000) return false;
        lsSet(LEASE, { t: tab, at: now });
        return true;
    }
    function freeLease() { clearInterval(leaseT); leaseT = 0; var l = lsGet(LEASE); if (l && l.t === tab) { try { localStorage.removeItem(LEASE); } catch (e) {} } }
    function kick(ms) { clearTimeout(wakeT); wakeT = setTimeout(next, ms || 0); }
    function stop() { if (run) run.stop = true; }
    function next() {
        if (!started || run || !on() || !supported()) return;
        var a = load().apps, id = null;
        if (fastId && a[fastId] && a[fastId].q) id = fastId;
        else for (var k in a) if (a[k].q) { id = k; break; }
        if (!id) return freeLease();
        if (!online()) { set(id, { state: 'wait', err: 'offline' }); return kick(RETRY); }
        if (!lease()) return kick(15000);
        if (!leaseT) leaseT = setInterval(function () { if (run) lease(); }, 5000);
        go(id);
    }
    // an install the person is waiting for (the update screen): full speed even on the game page
    function slow() { return gamePage && !(run && run.fast); }
    function piece() { return slow() ? PIECE_GAME : PIECE; }
    function gap(fn) { setTimeout(fn, slow() ? 150 : 10); }

    function go(id) {
        var r = rec(id), job = run = { id: id, stop: false, fast: fastId === id };
        function end(e) {
            run = null;
            if (e) {
                var waitCodes = { network: 1, limit: 1, nousb: 1, gone: 1, offline: 1 };
                set(id, { state: waitCodes[e.code] ? 'wait' : 'error', err: e.code, msg: e.message || '', q: waitCodes[e.code] ? 1 : 0 });
                try { console.warn('[AppUsb] ' + id + ': ' + (e.message || e.code)); } catch (x) {}
                if (waitCodes[e.code]) return kick(e.code === 'nousb' ? 120000 : RETRY);
            }
            kick(1000);
        }
        set(id, { state: 'saving', err: '', done: 0, total: 0 });
        UsbFs.drives(function (e0, ds) {
            if (job.stop) return end(err('stopped'));
            if (!ds || !ds.length) return end(err('nousb'));
            // the drive that already has this app, else the one with the most room
            var i = 0, drive = null, old = null;
            (function look() {
                if (i >= ds.length) { if (!drive) drive = ds.slice().sort(function (x, y) { return (y.free || 0) - (x.free || 0); })[0]; return start(); }
                var d = ds[i++];
                readSaved(d.path + '/' + ROOT + '/' + safeId(id), function (s) { if (s) { drive = d; old = s; return start(); } look(); });
            })();
            function start() {
                var appDir = drive.path + '/' + ROOT + '/' + safeId(id);
                // the app's own folder first (owner: "make sure it creates the app folder first")
                mkdirs(appDir, function (e1) {
                    if (e1) return end(e1);
                    if (job.stop) return end(err('stopped'));
                    fileList({ url: r.url, entry: r.entry, v: r.v }, function (e2, fl) {
                        if (e2) return end(e2);
                        if (old && old.key === fl.key) { set(id, { state: 'saved', sv: r.v, q: 0, checked: Date.now(), drive: drive.name, done: fl.bytes, total: fl.bytes }); return end(null); }
                        if (drive.free && fl.bytes + 20 * 1048576 > drive.free) return end(err('full'));
                        saveCopy(job, id, drive, appDir, fl, old, function (e3) {
                            if (e3) return end(e3);
                            var s = { mypc: 1, id: id, name: r.name, v: r.v, key: fl.key, entry: fl.entry, url: r.url, at: Date.now(), n: fl.files.length, bytes: fl.bytes, sha: {} };
                            if (old && old.key !== fl.key) { s.prev = old.key; s.pv = old.v || ''; }
                            fl.files.forEach(function (f) { if (f.sha) s.sha[f.p] = f.sha; });
                            // switched to the new copy only now, when every file of it is on the drive
                            writeAll(appDir + '/' + SAVED, enc(JSON.stringify(s)), function (e4) {
                                if (e4) return end(e4);
                                delete found[id];
                                // the version before stays as the way back (rollback); the one before that goes
                                if (old && old.prev && old.prev !== fl.key && old.prev !== old.key) rmdir(appDir + '/' + old.prev);
                                set(id, { state: 'saved', sv: r.v, nv: '', q: 0, checked: Date.now(), drive: drive.name, done: fl.bytes, total: fl.bytes, err: '', pv: s.pv || '' });
                                if (typeof Notify !== 'undefined' && !job.fast) Notify.show({ id: 'appusb', kind: 'ok', silent: gamePage, text: t('auDone').replace('%s', r.name || id).replace('%d', drive.name) });
                                end(null);
                            });
                        });
                    });
                });
            }
        });
    }
    function t(k) { return typeof I18n !== 'undefined' ? I18n.t(k) : k; }

    function saveCopy(job, id, drive, appDir, fl, old, cb) {
        var dir = appDir + '/' + fl.key, files = fl.files, html = [], i = 0, done = 0;
        function progress(n) { done += n; set(id, { done: done, total: fl.bytes }); }
        mkdirs(dir + '/' + SDK_DIR, function (e0) {
            if (e0) return cb(e0);
            (function nextFile() {
                if (job.stop) return cb(err('stopped'));
                if (!online()) return cb(err('offline'));
                if (i >= files.length) return pages();
                var f = files[i++];
                if (/\.html?$/i.test(f.p)) { html.push(f); return nextFile(); }
                saveFile(job, rec(id).url, dir, f, old ? { dir: appDir + '/' + old.key, sha: old.sha || {} } : null, progress, function (e) {
                    if (e) return cb(e);
                    gap(nextFile);
                });
            })();
            // the pages last: the SDK <script> pointed at the copy saved here, scripts / styles from other sites saved too
            function pages() {
                get(sdkUrl(), 'text', null, function (e, sdk) {
                    if (e) return cb(e);
                    writeAll(dir + '/' + SDK_DIR + '/mypc-sdk.js', enc(sdk), function (e1) {
                        if (e1) return cb(e1);
                        var k = 0, ext = 0;
                        (function nextPage() {
                            if (job.stop) return cb(err('stopped'));
                            if (k >= html.length) return cb(null);
                            var f = html[k++], up = new Array(f.p.split('/').length).join('../');
                            get(rec(id).url + f.p + '?mypc_v=' + encodeURIComponent(rec(id).v || ''), 'text', null, function (e2, text) {
                                if (e2) return cb(e2);
                                text = text.replace(SDK_RE, '$1' + up + SDK_DIR + '/mypc-sdk.js$2');
                                var outside = [], re = /<(script|link)\b[^>]*>/gi, m, u0;
                                while ((m = re.exec(text))) {
                                    u0 = /\b(?:src|href)\s*=\s*["']((?:https?:)?\/\/[^"']+)["']/i.exec(m[0]);
                                    if (u0 && !/mypc-sdk\.js/.test(u0[1]) && (m[1].toLowerCase() === 'script' || /\brel\s*=\s*["']?stylesheet/i.test(m[0])) && outside.indexOf(u0[1]) < 0) outside.push(u0[1]);
                                }
                                var j = 0;
                                (function nextExt() {
                                    if (j >= outside.length) {
                                        var u8 = enc(text);
                                        return mkdirs(UsbFs.parent(dir + '/' + safePath(f.p)), function () {
                                            writeAll(dir + '/' + safePath(f.p), u8, function (e3) { if (e3) return cb(e3); progress(Math.max(0, f.size)); gap(nextPage); });
                                        });
                                    }
                                    var u = outside[j++], name = 'ext' + (++ext) + (/\.css(\?|$)/i.test(u) ? '.css' : '.js');
                                    get(/^\/\//.test(u) ? 'https:' + u : u, 'text', null, function (e4, body) {
                                        if (e4) return nextExt();          // that site does not answer now: left as it was
                                        writeAll(dir + '/' + SDK_DIR + '/' + name, enc(body), function (e5) {
                                            if (!e5) text = text.split(u).join(up + SDK_DIR + '/' + name);
                                            nextExt();
                                        });
                                    });
                                })();
                            });
                        })();
                    });
                });
            }
        });
    }
    function sdkUrl() {
        var b = typeof AppBoot !== 'undefined' && AppBoot.base ? AppBoot.base() : '';
        return (b || '') + 'sdk/mypc-sdk.js?au=' + (typeof AppBoot !== 'undefined' && AppBoot.build ? AppBoot.build() : 0);
    }

    // one file: already there (same size) = kept; the older copy has it (same git sha) = copied on the drive; else downloaded
    // (whole when small, else Range pieces appended, going on from what is already written)
    function saveFile(job, base, dir, f, old, progress, cb) {
        var dest = dir + '/' + safePath(f.p), url = base + f.p.split('/').map(encodeURIComponent).join('/');
        UsbFs.stat(dest, function (e, s) {
            if (e) return cb(e);
            if (s.exists && !s.dir && f.size >= 0 && s.size === f.size) { progress(f.size); return cb(null); }
            mkdirs(UsbFs.parent(dest), function (e1) {
                if (e1) return cb(e1);
                if (old && f.sha && old.sha[f.p] === f.sha) {
                    return copyOnDrive(old.dir + '/' + safePath(f.p), dest, function (e2) {
                        if (!e2) return UsbFs.stat(dest, function (e3, s3) { if (!e3 && s3.size === f.size) { progress(f.size); return cb(null); } download(0); });
                        download(0);
                    });
                }
                download(s.exists && !s.dir && f.size > piece() && s.size < f.size ? s.size : 0);
            });
        });
        function download(at) {
            if (f.size < 0 || f.size <= piece()) {
                return get(url, 'arraybuffer', null, function (e, buf) {
                    if (e) return cb(e);
                    var u8 = new Uint8Array(buf);
                    if (f.size >= 0 && u8.length !== f.size) return cb(err('network', 'Wrong size: ' + f.p));
                    writeAll(dest, u8, function (e2) { if (e2) return cb(e2); progress(u8.length); cb(null); });
                });
            }
            UsbFs.writer(dest, at > 0, function (e, w) {
                if (e) return cb(e);
                if (at) progress(at);
                function close(e2) { w.close(function () { cb(e2 || null); }); }
                (function nextPiece() {
                    if (job.stop) return close(err('stopped'));
                    if (at >= f.size) return close(null);
                    var to = Math.min(f.size, at + piece()) - 1;
                    get(url, 'arraybuffer', [at, to], function (e3, buf, status) {
                        if (e3) return close(e3);
                        if (status !== 206 && at > 0) return close(err('network', 'No Range answer: ' + f.p));
                        var u8 = new Uint8Array(buf);
                        if (status !== 206) { if (u8.length !== f.size) return close(err('network', 'Wrong size: ' + f.p)); }
                        else if (u8.length !== to - at + 1) return close(err('network', 'Short piece: ' + f.p));
                        w.write(u8, function (e4) {
                            if (e4) return close(e4);
                            at += u8.length; progress(u8.length);
                            gap(nextPiece);
                        });
                    });
                })();
            });
        }
    }

    /* ---------------- install now (the "Update available" screen) ---------------- */
    var fastId = null;
    // the installed version on a USB drive: { v, drive, nv (a newer one noted) } or null
    function installed(id) {
        var r = rec(id);
        return r && r.sv && r.state !== 'saving' && r.state !== 'queued' ? { v: r.sv, drive: r.drive || '', nv: r.nv || '' } : null;
    }
    // a: { id, name, url, entry, version }; prog(0..1); cb(err | null). Without a USB drive cb('nousb') at once.
    function install(a, prog, cb) {
        if (!a || !a.id || !supported() || !on()) return later(function () { cb(err('nousb')); });
        UsbFs.drives(function (e0, ds) {
            if (!ds || !ds.length) return cb(err('nousb'));
            if (run && run.id !== a.id) run.stop = true;                 // the person waits for this one
            fastId = a.id;
            a.force = true;
            if (!a.url && a.entry) a.url = String(a.entry).replace(/[?#].*$/, '').replace(/[^/]*$/, '');
            set(a.id, { name: nm(a.name) || a.id, url: a.url, entry: a.entry, v: a.version || '', q: 1, state: 'queued', err: '', done: 0, total: 0 });
            var finished = false;
            function watch() {
                var r = rec(a.id);
                if (finished || !r) return;
                if (r.total) prog(Math.min(0.99, r.done / r.total));
                if (r.state === 'saved' && r.sv === (a.version || '')) { finished = true; fastId = null; fns = fns.filter(function (f) { return f !== watch; }); prog(1); cb(null); }
                else if (r.state === 'error' || r.state === 'wait') { finished = true; fastId = null; fns = fns.filter(function (f) { return f !== watch; }); cb(err(r.err || 'error')); }
            }
            fns.push(watch);
            (function waitFree() { if (run && run.id !== a.id) return setTimeout(waitFree, 200); kick(0); })();
        });
    }

    function init(o) {
        gamePage = !!(o && o.game);
        if (started) return;
        started = true;
        if (!supported()) return;
        try { tizen.filesystem.addStorageStateChangeListener(function () { found = {}; kick(3000); }); } catch (e) {}
        if (typeof NetMode !== 'undefined' && NetMode.onChange) NetMode.onChange(function (i) { if (i.mode === 'online') kick(5000); else stop(); });
        // the game page: not while the app is still loading
        kick(gamePage ? 30000 : 8000);
    }
    function remove(id, cb) {
        cb = cb || function () {};
        find(id, function (copy) {
            delete load().apps[id]; save(); delete found[id];
            if (!copy) return cb(null);
            UsbFs.remove(UsbFs.parent(copy.dir) + '/' + SAVED, function () { rmdir(copy.dir, cb); });
        });
    }

    return { supported: supported, on: on, setOn: setOn, init: init, want: want, refresh: refresh, has: has, size: size, installed: installed, install: install, pick: pick, find: find, readFile: readFile,
             list: list, remove: remove, onChange: function (fn) { fns.push(fn); }, offChange: function (fn) { fns = fns.filter(function (f) { return f !== fn; }); },
             probe: probe, now: function () { kick(0); }, _state: function () { return { run: run && run.id, st: load() }; } };
})();
if (typeof module !== 'undefined') module.exports = AppUsb;
