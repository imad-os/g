/* Copies between Google Drive and the USB drives of the TV, both ways, files and whole folders (owner request 2026-11-10).
 * My PC does the copying (installed apps run in a locked iframe and cannot reach USB drives): MyDrive and any other app asks
 * through MyPC.copy (API 16, js/launcher/bridges.js); My PC itself can call CopyJobs.start too.
 *
 * Built for small TVs: one job at a time, one file at a time, 4 MB pieces (a 10 GB film needs no more memory than a photo).
 * Drive -> USB reads Range pieces (GDrive.read) and appends them to the file (UsbFs.writer); USB -> Drive reads pieces of the
 * file (UsbFs.read) into Google's resumable upload (GDrive.upload with source). Google Docs / Sheets / Slides / Drawings are
 * saved as .docx / .xlsx / .pptx / .pdf (Google's export, about 10 MB at most); forms, sites, maps and shortcuts are left out.
 *
 * Jobs are kept on this TV (arc_dev_copy, not in the backup) and go on by themselves after a page change (opening / quitting
 * an app reloads the page), a restart or a network cut: the list is read again, files already there with the same size count
 * as copied, a half-written USB file goes on from its size, an upload asks Google how much it already has.
 * Only the profile (and the Google account) that started a job runs it.
 *
 *   CopyJobs.init()                                 at start, on both pages (main.js)
 *   CopyJobs.start({ dir: 'toUsb' | 'toDrive', items: [Drive ids | USB paths], dest: USB folder path | Drive folder id,
 *                    ifExists: 'skip' | 'replace' | 'keep', app, appTitle }, cb(err, job))
 *   CopyJobs.list(app) -> [job]   pause(id) resume(id) cancel(id) clear(id) -> job | null   (clear: forget an ended job)
 *   CopyJobs.onChange(fn(job)) -> off()     CopyJobs.watch(app, on): that app shows its own progress, no card meanwhile
 * job: { id, app, dir, state: queued scanning copying waiting paused done failed cancelled, dest: { path | id, name }, items,
 *        files, bytes, doneFiles, doneBytes, skipped, failed: [{ name, message }], current: { name, size, done } | null,
 *        error: { code, message } | null, progress (0..1), startedAt, endedAt, ifExists }
 * Errors: bad-request, unsupported (no USB here), gone, perm, signed-out, reauth, noconfig, not-found, busy. */
var CopyJobs = (function () {
    'use strict';

    var KEY = 'arc_dev_copy', LEASE = 'arc_dev_copy_lease', CHUNK = 4 * 1024 * 1024, MAX_ITEMS = 20000, MAX_PICKED = 1000, KEEP = 10, MAX_FAILED = 30;
    var FOLDER = 'application/vnd.google-apps.folder', GAPPS = 'application/vnd.google-apps.';
    var EXPORT = {
        'application/vnd.google-apps.document': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
        'application/vnd.google-apps.spreadsheet': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
        'application/vnd.google-apps.presentation': ['application/vnd.openxmlformats-officedocument.presentationml.presentation', '.pptx'],
        'application/vnd.google-apps.drawing': ['application/pdf', '.pdf'],
        'application/vnd.google-apps.script': ['application/vnd.google-apps.script+json', '.json']
    };
    var TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', heic: 'image/heic',
        mp4: 'video/mp4', m4v: 'video/mp4', mkv: 'video/x-matroska', webm: 'video/webm', avi: 'video/x-msvideo', mov: 'video/quicktime', ts: 'video/mp2t', wmv: 'video/x-ms-wmv',
        mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/opus', wma: 'audio/x-ms-wma',
        pdf: 'application/pdf', txt: 'text/plain', srt: 'text/plain', csv: 'text/csv', json: 'application/json', html: 'text/html', zip: 'application/zip',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', doc: 'application/msword', xls: 'application/vnd.ms-excel', apk: 'application/vnd.android.package-archive' };
    var STOP = { gone: 1, perm: 1, full: 1, 'drive-full': 1, reauth: 1, 'signed-out': 1, noconfig: 1, 'too-many': 1, unsupported: 1 };
    var WAIT = { network: 1, timeout: 1, quota: 1 };

    var closing = 0;          // USB files of a stopped run still being closed (their last write lands first): the next run waits
    var jobs = null, run = null, fns = [], quiet = {}, started = false, leaseT = 0, wakeT = 0, cardAt = {}, emitAt = {}, emitT = {};
    var tab = (function () {
        var t = '';
        try { t = sessionStorage.getItem('mypc_copy_tab') || ''; } catch (e) {}
        if (!t) { t = Math.random().toString(36).slice(2, 10); try { sessionStorage.setItem('mypc_copy_tab', t); } catch (e2) {} }
        return t;            // the same tab keeps its id across page changes, so its own lease never blocks it
    })();

    function err(code, message) { return { code: code, message: message || code }; }
    function later(fn) { setTimeout(fn, 0); }
    function profile() { return typeof Store !== 'undefined' && Store.profile ? Store.profile() : 'local'; }
    function t(k) { return typeof I18n !== 'undefined' ? I18n.t(k) : k; }

    /* ---------------- saved jobs ---------------- */
    function load() {
        if (jobs) return jobs;
        var l = null;
        try { l = Store.rawGet(KEY); } catch (e) {}
        jobs = (Array.isArray(l) ? l : []).filter(function (j) { return j && j.id && (j.dir === 'toUsb' || j.dir === 'toDrive') && Array.isArray(j.src); });
        return jobs;
    }
    function ended(j) { return j.state === 'done' || j.state === 'failed' || j.state === 'cancelled'; }
    function save() {
        var l = load(), endedJobs = l.filter(ended);
        if (endedJobs.length > KEEP) { var drop = endedJobs.slice(0, endedJobs.length - KEEP); jobs = l.filter(function (j) { return drop.indexOf(j) < 0; }); }
        try { Store.rawSet(KEY, jobs); } catch (e) {}
    }
    function find(id) { var l = load(); for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }
    function pub(j) {
        if (!j) return null;
        var c = j.cur && j.state === 'copying' ? { name: j.cur.name, size: j.cur.size || 0, done: j.cur.at || 0 } : null;
        return { id: j.id, app: j.app || '', dir: j.dir, state: j.state, dest: { path: j.dest.path, id: j.dest.id, name: j.dest.name }, items: j.src.length,
                 files: j.files || 0, bytes: j.bytes || 0, doneFiles: j.doneFiles || 0, doneBytes: j.doneBytes || 0, skipped: j.skipped || 0,
                 failed: (j.failed || []).slice(), current: c, error: j.error || null, ifExists: j.ifExists,
                 progress: j.state === 'done' ? 1 : j.bytes ? Math.min(1, (j.doneBytes || 0) / j.bytes) : j.files ? Math.min(1, (j.doneFiles || 0) / j.files) : 0,
                 startedAt: j.at || 0, endedAt: j.end || 0 };
    }

    /* ---------------- news: the apps that watch, and the card ---------------- */
    function emit(j, now) {
        var id = j.id;
        function go() {
            emitT[id] = 0; emitAt[id] = Date.now();
            var p = pub(j);
            for (var i = 0; i < fns.length; i++) { try { fns[i](p); } catch (e) {} }
            card(j, now);
        }
        if (now) { clearTimeout(emitT[id]); return go(); }
        if (emitT[id]) return;
        var wait = Math.max(0, 400 - (Date.now() - (emitAt[id] || 0)));
        emitT[id] = setTimeout(go, wait);
    }
    function onChange(fn) { fns.push(fn); return function () { var i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; }
    function watch(app, on) { app = String(app || ''); quiet[app] = Math.max(0, (quiet[app] || 0) + (on ? 1 : -1)); var l = load(); for (var i = 0; i < l.length; i++) if (l[i].app === app && l[i].profile === profile()) card(l[i], true); }

    function mb(n) { n = +n || 0; return n >= 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : n >= 1048576 ? Math.round(n / 1048576) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
    function errText(j) {
        var c = j.error && j.error.code;
        if (c === 'gone') return t('cpErrGone');
        if (c === 'full') return j.dir === 'toUsb' ? t('cpErrFull') : t('cpErrDriveFull');
        if (c === 'drive-full') return t('cpErrDriveFull');
        if (c === 'perm') return t('cpErrPerm');
        if (c === 'reauth' || c === 'signed-out' || c === 'noconfig') return t('cpErrSignIn');
        if (c === 'too-many') return t('cpErrTooMany');
        return t('cpErr').replace('%s', (j.error && j.error.message) || '');
    }
    function card(j, now) {
        if (typeof Notify === 'undefined' || j.profile !== profile()) return;
        var id = 'copy-' + j.id;
        if (j.state === 'cancelled' || (quiet[j.app] > 0) || j.toldEnd) { Notify.hide(id); return; }
        if (!now && Date.now() - (cardAt[id] || 0) < 1000) return;
        cardAt[id] = Date.now();
        var dest = j.dest.name || '', title = t(j.dir === 'toUsb' ? 'cpToUsb' : 'cpToDrive').replace('%s', dest), o = { id: id, title: title, timeout: 0, quiet: true };
        if (j.state === 'scanning' || j.state === 'queued') o.text = t('cpScanning');
        else if (j.state === 'copying') o.text = t('cpProgress').replace('%1', Math.min(j.files, (j.doneFiles || 0) + 1)).replace('%2', j.files || 0).replace('%3', Math.floor(pub(j).progress * 100)) + (j.cur && j.cur.name ? ' · ' + j.cur.name : '');
        else if (j.state === 'waiting') o.text = t('cpWaiting');
        else if (j.state === 'paused') o.text = t('cpPaused');
        else if (j.state === 'done') {
            o = { id: id, kind: (j.failed || []).length ? 'warn' : 'ok', title: t('cpDoneTitle'), timeout: 8000,
                  text: t(j.doneFiles === 1 ? 'cpDone1' : 'cpDone').replace('%1', j.doneFiles || 0).replace('%2', dest) + ((j.skipped ? ' ' + t('cpSkipped').replace('%s', j.skipped) : '') + ((j.failed || []).length ? ' ' + t('cpFailedN').replace('%s', j.failed.length) : '')) };
            j.toldEnd = true;
        } else if (j.state === 'failed') { o = { id: id, kind: 'err', title: t('cpStopped'), text: errText(j), timeout: 10000 }; j.toldEnd = true; }
        if (!ended(j)) o.onClick = function () { ask(j.id); };
        Notify.show(o);
    }
    // a click on the card: stop it?
    function ask(id) {
        var j = find(id);
        if (!j || ended(j) || typeof App === 'undefined' || !App.confirm) return;
        App.confirm(t('cpStopQ'), t(j.dir === 'toUsb' ? 'cpToUsb' : 'cpToDrive').replace('%s', j.dest.name || ''), function () { cancel(id); },
                    { yes: t('cpStop'), no: t('cpKeep') });
    }

    /* ---------------- one job runs at a time (and in one tab of a computer) ---------------- */
    function lease() {
        var l = null, now = Date.now();
        try { l = Store.rawGet(LEASE); } catch (e) {}
        if (l && l.t !== tab && now - (+l.at || 0) < 15000) return false;
        try { Store.rawSet(LEASE, { t: tab, at: now }); } catch (e2) {}
        return true;
    }
    function freeLease() { clearInterval(leaseT); leaseT = 0; try { var l = Store.rawGet(LEASE); if (l && l.t === tab) localStorage.removeItem(LEASE); } catch (e) {} }
    function wake(ms) { clearTimeout(wakeT); wakeT = setTimeout(kick, ms); }
    function kick() {
        if (!started || run || closing) return;
        var me = profile(), l = load(), j = null;
        for (var i = 0; i < l.length; i++) if (l[i].profile === me && (l[i].state === 'queued' || l[i].state === 'waiting')) { j = l[i]; break; }
        if (!j) return freeLease();
        if (!lease()) return wake(15000);
        if (!leaseT) leaseT = setInterval(function () { if (run) lease(); }, 5000);
        go(j);
    }
    // after(): once the USB file being written is closed
    function finish(j, state, e, after) {
        var w = null;
        if (run && run.id === j.id) { var h = run.h; w = run.w; run = null; if (h) try { h.abort(); } catch (x) {} }
        if (w) { closing++; w.close(function () { closing--; if (after) after(); later(kick); }); } else if (after) later(after);
        j.state = state;
        j.error = e ? { code: e.code || 'failed', message: String(e.message || e.code || 'Failed.') } : null;
        if (ended(j)) { j.end = Date.now(); j.cur = null; }
        save();
        emit(j, true);
        if (state === 'waiting') wake(20000);
        later(kick);
    }

    /* ---------------- the list of what to copy ---------------- */
    // plan: [{ p: parent index (-1 = the destination), name, dir, size, src: Drive id | USB path, mime }], folders before what is in them
    function scanDrive(j, cb) {
        var plan = [], queue = [], k = 0;
        function add(f, p) {
            if (plan.length >= MAX_ITEMS) return false;
            var dir = f.mimeType === FOLDER;
            plan.push({ p: p, name: f.name || 'file', dir: dir, size: dir ? 0 : (+f.size || 0), src: f.id, mime: f.mimeType || '' });
            if (dir) queue.push(plan.length - 1);
            return true;
        }
        function top() {
            if (!mine(j)) return;
            if (k >= j.src.length) return folders();
            run.h = GDrive.get(j.src[k++], function (e, f) {
                if (!mine(j)) return;
                if (e) { if (STOP[e.code] || WAIT[e.code]) return cb(e); note(j, String(j.src[k - 1]), e); return top(); }
                if (f.trashed) { note(j, f.name, err('not-found', 'In the trash.')); return top(); }
                add(f, -1); top();
            });
        }
        function folders() {
            if (!mine(j)) return;
            if (!queue.length) return cb(null, plan);
            var at = queue.shift(), token = '';
            (function page() {
                run.h = GDrive.list({ folder: plan[at].src, pageSize: 1000, pageToken: token, fields: 'id,name,mimeType,size,trashed' }, function (e, r) {
                    if (!mine(j)) return;
                    if (e) { if (STOP[e.code] || WAIT[e.code]) return cb(e); note(j, plan[at].name, e); return folders(); }
                    for (var i = 0; i < r.files.length; i++) if (!add(r.files[i], at)) return cb(err('too-many', 'More than ' + MAX_ITEMS + ' files and folders.'));
                    token = r.next;
                    if (token) return page();
                    folders();
                });
            })();
        }
        top();
    }
    function scanUsb(j, cb) {
        var plan = [], queue = [], k = 0;
        function top() {
            if (!mine(j)) return;
            if (k >= j.src.length) return folders();
            var path = j.src[k++];
            UsbFs.stat(path, function (e, st) {
                if (!mine(j)) return;
                if (e) return cb(e);
                if (!st.exists) { note(j, UsbFs.base(path), err('not-found', 'Not on the USB drive any more.')); return top(); }
                plan.push({ p: -1, name: UsbFs.base(path), dir: st.dir, size: st.size, src: path });
                if (st.dir) queue.push(plan.length - 1);
                top();
            });
        }
        function folders() {
            if (!mine(j)) return;
            if (!queue.length) return cb(null, plan);
            var at = queue.shift();
            UsbFs.list(plan[at].src, function (e, l) {
                if (!mine(j)) return;
                if (e) { if (STOP[e.code]) return cb(e); note(j, plan[at].name, e); return folders(); }
                for (var i = 0; i < l.length; i++) {
                    if (plan.length >= MAX_ITEMS) return cb(err('too-many', 'More than ' + MAX_ITEMS + ' files and folders.'));
                    plan.push({ p: at, name: l[i].name, dir: l[i].dir, size: l[i].size, src: l[i].path });
                    if (l[i].dir) queue.push(plan.length - 1);
                }
                folders();
            });
        }
        top();
    }

    // true while j is the job object of the run going on (a stopped run's late callbacks hold an older object: they stop)
    function mine(j) { return !!run && run.job === j; }
    function note(j, name, e) {
        j.failed = j.failed || [];
        if (j.failed.length < MAX_FAILED) j.failed.push({ name: String(name || ''), message: String((e && e.message) || (e && e.code) || 'Failed.') });
        else j.failedMore = (j.failedMore || 0) + 1;
    }
    function splitExt(n) { var i = n.lastIndexOf('.'); return i > 0 && n.length - i <= 10 ? [n.slice(0, i), n.slice(i)] : [n, '']; }
    function typeOf(name) { var m = /\.([a-z0-9]+)$/i.exec(name || ''); return (m && TYPES[m[1].toLowerCase()]) || ''; }

    /* ---------------- running a job ---------------- */
    function go(j0) {
        // a fresh object for every run: callbacks of an earlier run of this job (paused, then resumed) see they are not mine()
        var j = JSON.parse(JSON.stringify(j0));
        jobs[jobs.indexOf(j0)] = j;
        run = { id: j.id, job: j, h: null };
        j.state = 'scanning'; j.error = null; j.doneFiles = 0; j.doneBytes = 0; j.skipped = 0; j.failed = []; j.failedMore = 0; j.toldEnd = false;
        save(); emit(j, true);
        GDrive.status(function (st) {
            if (!mine(j)) return;
            if (!st.ok) return finish(j, 'failed', err(st.code === 'noconfig' ? 'noconfig' : st.code === 'reauth' ? 'reauth' : 'signed-out', 'Sign in to Google Drive again.'));
            if (!st.account || st.account.id !== j.acct) return finish(j, 'failed', err('signed-out', 'The Google account that started this copy is not the one in use.'));
            UsbFs.drives(function (e) {
                if (!mine(j)) return;
                if (e) return finish(j, 'failed', e);
                var paths = j.dir === 'toUsb' ? [j.dest.path] : j.src;
                for (var i = 0; i < paths.length; i++) if (!UsbFs.inside(paths[i])) return finish(j, 'failed', err('gone', 'The USB drive is not plugged in.'));
                (j.dir === 'toUsb' ? scanDrive : scanUsb)(j, function (e2, plan) {
                    if (!mine(j)) return;
                    if (e2) return finish(j, WAIT[e2.code] ? 'waiting' : 'failed', e2);
                    j.files = 0; j.bytes = 0;
                    for (var k = 0; k < plan.length; k++) if (!plan[k].dir) { j.files++; j.bytes += plan[k].size || 0; }
                    roomFor(j, function (e3) {
                        if (!mine(j)) return;
                        if (e3) return finish(j, WAIT[e3.code] ? 'waiting' : 'failed', e3);
                        j.state = 'copying'; save(); emit(j, true);
                        copyAll(j, plan);
                    });
                });
            });
        });
    }
    // enough free space? (only when the TV / Google says how much there is)
    function roomFor(j, cb) {
        if (j.dir === 'toUsb') {
            return UsbFs.drives(function (e, l) {
                var d = null;
                for (var i = 0; i < (l || []).length; i++) if (j.dest.path === l[i].path || j.dest.path.indexOf(l[i].path + '/') === 0) d = l[i];
                if (d && d.total && d.free < j.bytes) return cb(err('full', 'Not enough space on ' + d.name + ': ' + mb(j.bytes) + ' needed, ' + mb(d.free) + ' free.'));
                cb(null);
            });
        }
        run.h = GDrive.about(function (e, a) {
            if (e) return cb(WAIT[e.code] ? e : null);
            var q = a && a.storageQuota, lim = q && +q.limit, used = q && +q.usage;
            if (lim && lim - used < j.bytes) return cb(err('drive-full', 'Not enough space in Google Drive: ' + mb(j.bytes) + ' needed, ' + mb(lim - used) + ' free.'));
            cb(null);
        });
    }

    function copyAll(j, plan) {
        var out = [], i = 0, idx = {};
        function next() {
            if (!mine(j)) return;
            if (i >= plan.length) { j.cur = null; return finish(j, 'done'); }
            var at = i++, e = plan[at], dest = e.p < 0 ? (j.dir === 'toUsb' ? j.dest.path : j.dest.id) : out[e.p];
            if (dest === null || dest === undefined) { out[at] = null; if (!e.dir) j.skipped++; return next(); }      // its folder could not be made (said once)
            function done(err2, res) {
                if (!mine(j)) return;
                if (err2) {
                    if (STOP[err2.code]) return finish(j, 'failed', err2);
                    if (WAIT[err2.code]) return finish(j, 'waiting', err2);
                    note(j, e.name, err2);
                    out[at] = null;
                } else out[at] = res;
                emit(j);
                later(next);
            }
            if (e.dir) return j.dir === 'toUsb' ? dirUsb(j, e, dest, done) : dirDrive(j, e, dest, idx, done);
            return j.dir === 'toUsb' ? fileToUsb(j, e, dest, done) : fileToDrive(j, e, dest, idx, done);
        }
        next();
    }
    function counted(j, e, how) {
        if (how === 'skip') j.skipped++; else j.doneFiles++;
        j.doneBytes += e.size || 0;
    }

    /* Drive -> USB */
    function dirUsb(j, e, parent, cb) {
        var path = UsbFs.join(parent, UsbFs.safeName(e.name));
        UsbFs.mkdir(path, function (x) { cb(x && x.code === 'exists' ? err('exists', 'A file has the same name as this folder.') : x, path); });
    }
    function freeUsb(dir, name, size, cb) {
        var pe = splitExt(name), n = 2;
        (function tryN() {
            var p = UsbFs.join(dir, pe[0] + ' (' + n + ')' + pe[1]);
            UsbFs.stat(p, function (e, st) {
                if (e) return cb(e);
                if (!st.exists) return cb(null, p, false);
                if (!st.dir && size > 0 && st.size === size) return cb(null, p, true);
                if (++n > 999) return cb(err('exists', 'Too many copies with this name.'));
                tryN();
            });
        })();
    }
    function fileToUsb(j, e, dir, cb) {
        var exp = EXPORT[e.mime];
        if (e.mime.indexOf(GAPPS) === 0 && !exp) return cb(err('unsupported-file', 'Google cannot download this kind of file (form, site, map or shortcut).'));
        var name = UsbFs.safeName(exp ? splitExt(e.name)[0] + exp[1] : e.name), dst = UsbFs.join(dir, name);
        UsbFs.stat(dst, function (x, st) {
            if (!mine(j)) return;
            if (x) return cb(x);
            if (!st.exists) return write(dst, 0);
            if (!st.dir && !exp && st.size === e.size) { counted(j, e, 'same'); return cb(null, dst); }
            var c = j.cur;
            if (!st.dir && !exp && c && c.src === e.src && c.dst === dst && st.size < e.size) return write(dst, st.size);      // a copy cut short: go on
            if (j.ifExists === 'skip') { counted(j, e, 'skip'); return cb(null, dst); }
            if (j.ifExists === 'replace' && !st.dir) return write(dst, 0);
            freeUsb(dir, name, exp ? 0 : e.size, function (x2, p, same) {
                if (!mine(j)) return;
                if (x2) return cb(x2);
                if (same) { counted(j, e, 'same'); return cb(null, p); }
                write(p, 0);
            });
        });
        function write(path, from) {
            j.cur = { src: e.src, dst: path, name: e.name, size: e.size, at: from };
            j.doneBytes += from;
            save(); emit(j);
            if (exp) {
                run.h = GDrive.exportFile(e.src, exp[0], function (x, r) {
                    if (!mine(j)) return;
                    if (x) return cb(x.code === 'http' || x.code === 'permission' ? err(x.code, x.message + ' (Google exports about 10 MB at most.)') : x);
                    UsbFs.writer(path, false, function (x2, w) {
                        if (!mine(j)) return;
                        if (x2) return cb(x2);
                        run.w = w;
                        w.write(new Uint8Array(r.buf), function (x3) {
                            if (!mine(j)) return;                  // stopped: finish() closes the file
                            run.w = null;
                            w.close(function () {
                                if (!mine(j)) return;
                                if (x3) { UsbFs.remove(path); return cb(x3); }
                                j.doneFiles++; cb(null, path);
                            });
                        });
                    });
                });
                return;
            }
            UsbFs.writer(path, from > 0, function (x, w) {
                if (!mine(j)) return;
                if (x) return cb(x);
                var at = from;
                run.w = w;
                function fail(x2) {
                    run.w = null;
                    w.close(function () {
                        if (STOP[x2.code] || WAIT[x2.code]) return cb(x2);
                        // a write error: is the drive still there? (pulled out = stop the whole copy, keep what was written)
                        UsbFs.stat(dir, function (x3, st) {
                            if (x3 || !st.exists) return cb(err('gone', 'The USB drive was removed.'));
                            UsbFs.remove(path); cb(x2);
                        });
                    });
                }
                (function piece() {
                    if (!mine(j)) return;                      // stopped: finish() closed the file
                    if (at >= e.size) { run.w = null; return w.close(function () { if (!mine(j)) return; j.doneFiles++; cb(null, path); }); }
                    run.h = GDrive.read(e.src, at, Math.min(e.size, at + CHUNK) - 1, function (x2, r) {
                        if (!mine(j)) return;
                        if (x2) return fail(x2);
                        var n = r.buf.byteLength;
                        if (!n) return fail(err('io', 'The file changed in Google Drive while it was being copied.'));
                        w.write(new Uint8Array(r.buf), function (x3) {
                            if (!mine(j)) return;
                            if (x3) return fail(x3);
                            at += n; j.cur.at = at; j.doneBytes += n;
                            save(); emit(j);
                            piece();
                        });
                    });
                })();
            });
        }
    }

    /* USB -> Drive */
    function index(j, idx, folder, cb) {
        if (idx[folder]) return cb(null, idx[folder]);
        var map = {}, token = '';
        (function page() {
            run.h = GDrive.list({ folder: folder, pageSize: 1000, pageToken: token, fields: 'id,name,mimeType,size' }, function (e, r) {
                if (!mine(j)) return;
                if (e) return cb(e);
                for (var i = 0; i < r.files.length; i++) (map[r.files[i].name] = map[r.files[i].name] || []).push(r.files[i]);
                token = r.next;
                if (token) return page();
                idx[folder] = map;
                cb(null, map);
            });
        })();
    }
    function remember(map, f) { if (f && f.name) (map[f.name] = map[f.name] || []).push(f); }
    function dirDrive(j, e, parent, idx, cb) {
        index(j, idx, parent, function (x, map) {
            if (x) return cb(x);
            var have = (map[e.name] || []).filter(function (f) { return f.mimeType === FOLDER; })[0];
            if (have) return cb(null, have.id);
            run.h = GDrive.mkdir(e.name, parent, function (x2, f) {
                if (!mine(j)) return;
                if (x2) return cb(x2);
                remember(map, f); idx[f.id] = {};          // new and empty: no need to list it
                cb(null, f.id);
            });
        });
    }
    function fileToDrive(j, e, parent, idx, cb) {
        index(j, idx, parent, function (x, map) {
            if (!mine(j)) return;
            if (x) return cb(x);
            var same = (map[e.name] || []).filter(function (f) { return f.mimeType !== FOLDER; });
            for (var i = 0; i < same.length; i++) if (+same[i].size === e.size && (e.size > 0 || same[i].size !== undefined)) { counted(j, e, 'same'); return cb(null, same[i].id); }
            var c = j.cur;
            if (c && c.src === e.src && c.parent === parent && c.session) return up({ name: c.dname || e.name, session: c.session, id: c.id });
            if (!same.length) return up({ name: e.name });
            if (j.ifExists === 'skip') { counted(j, e, 'skip'); return cb(null, same[0].id); }
            if (j.ifExists === 'replace') return up({ name: e.name, id: same[0].id });
            var pe = splitExt(e.name), n = 2, nm;
            while (n < 1000) {
                nm = pe[0] + ' (' + n + ')' + pe[1];
                var l = (map[nm] || []).filter(function (f) { return f.mimeType !== FOLDER; });
                if (!l.length) break;
                if (l.some(function (f) { return +f.size === e.size; })) { counted(j, e, 'same'); return cb(null, l[0].id); }
                n++;
            }
            up({ name: nm });
        });
        function up(o) {
            j.cur = { src: e.src, parent: parent, name: e.name, dname: o.name, size: e.size, at: 0, session: o.session || '', id: o.id || '' };
            var base = j.doneBytes;
            save(); emit(j);
            var opts = { name: o.name, parent: parent, type: typeOf(e.name), session: o.session,
                         onSession: function (u) { if (j.cur) { j.cur.session = u; save(); } },
                         source: { size: e.size, read: function (at, len, done) { if (!len) return later(function () { done(null, new Uint8Array(0)); }); UsbFs.read(e.src, at, len, done); } } };
            if (o.id) { opts.id = o.id; delete opts.parent; }
            run.h = GDrive.upload(opts, function (p) {
                if (!mine(j) || !j.cur) return;
                j.cur.at = Math.round(p * e.size); j.doneBytes = base + j.cur.at;
                emit(j);
            }, function (x2, f) {
                if (!mine(j)) return;
                j.doneBytes = base;
                if (x2) return cb(x2);
                j.doneBytes += e.size; j.doneFiles++;
                if (!o.id) remember(idx[parent] || {}, f);
                cb(null, f && f.id);
            });
        }
    }

    /* ---------------- what apps and My PC call ---------------- */
    function start(o, cb) {
        o = o || {};
        var dir = o.dir, items = Array.isArray(o.items) ? o.items.slice(0, MAX_PICKED + 1) : [], how = o.ifExists === 'replace' || o.ifExists === 'keep' ? o.ifExists : 'skip';
        function no(code, m) { later(function () { cb(err(code, m)); }); }
        if (dir !== 'toUsb' && dir !== 'toDrive') return no('bad-request', 'dir must be toUsb or toDrive.');
        if (!items.length || items.length > MAX_PICKED) return no('bad-request', 'Give 1 to ' + MAX_PICKED + ' files or folders.');
        if (!UsbFs.supported()) return no('unsupported', 'This device has no USB drives (only a TV has them).');
        load();
        if (jobs.filter(function (x) { return !ended(x); }).length >= 20) return no('busy', 'Too many copies waiting (20).');
        GDrive.status(function (st) {
            if (!st.ok) return cb(err(st.code === 'noconfig' ? 'noconfig' : st.code === 'reauth' ? 'reauth' : 'signed-out', 'Sign in to Google Drive first.'));
            UsbFs.drives(function (e, drives) {
                if (e) return cb(e);
                var usb = dir === 'toUsb' ? [o.dest] : items;
                for (var i = 0; i < usb.length; i++) if (typeof usb[i] !== 'string' || !UsbFs.inside(usb[i])) return cb(err('bad-request', 'Not a path inside a plugged USB drive: ' + String(usb[i]).slice(0, 200)));
                if (dir === 'toUsb') for (var k = 0; k < items.length; k++) if (typeof items[k] !== 'string' || !/^[\w-]{1,200}$/.test(items[k])) return cb(err('bad-request', 'Not a Drive file id: ' + String(items[k]).slice(0, 80)));
                function make(dest) {
                    var j = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), app: String(o.app || ''), profile: profile(), acct: st.account.id,
                              dir: dir, src: items.map(function (s) { return dir === 'toDrive' ? String(s).replace(/\/+$/, '') : s; }), dest: dest, ifExists: how,
                              state: 'queued', at: Date.now(), files: 0, bytes: 0, doneFiles: 0, doneBytes: 0, skipped: 0, failed: [] };
                    jobs.push(j); save(); emit(j, true);
                    later(kick);
                    cb(null, pub(j));
                }
                if (dir === 'toUsb') {
                    var path = String(o.dest).replace(/\/+$/, ''), dname = '';
                    for (var d = 0; d < drives.length; d++) if (path === drives[d].path || path.indexOf(drives[d].path + '/') === 0) dname = drives[d].name + path.slice(drives[d].path.length);
                    return UsbFs.stat(path, function (e2, s2) {
                        if (e2) return cb(e2);
                        if (!s2.exists || !s2.dir) return cb(err('not-found', 'This folder is not on the USB drive.'));
                        make({ path: path, name: dname || UsbFs.base(path) });
                    });
                }
                var fid = typeof o.dest === 'string' && /^[\w-]{1,200}$/.test(o.dest) ? o.dest : 'root';
                GDrive.get(fid, function (e3, f) {
                    if (e3) return cb(e3);
                    if (f.mimeType !== FOLDER) return cb(err('bad-request', 'The destination is not a Drive folder.'));
                    make({ id: f.id, name: fid === 'root' ? t('cpMyDrive') : f.name });
                });
            });
        });
    }
    function list(app) {
        var me = profile();
        return load().filter(function (j) { return j.profile === me && (app === undefined || app === null || j.app === app); }).map(pub);
    }
    function pause(id) {
        var j = find(id);
        if (!j || ended(j) || j.state === 'paused') return pub(j);
        finish(j, 'paused');
        return pub(j);
    }
    function resume(id) {
        var j = find(id);
        if (!j || j.state !== 'paused' && j.state !== 'failed' && j.state !== 'waiting') return pub(j);
        j.state = 'queued'; j.error = null; j.end = 0; j.toldEnd = false; save(); emit(j, true);
        later(kick);
        return pub(j);
    }
    function cancel(id) {
        var j = find(id);
        if (!j || ended(j)) return pub(j);
        var c = j.cur;
        // a USB file only partly written is removed (an upload Google did not finish leaves nothing behind)
        finish(j, 'cancelled', null, function () { if (j.dir === 'toUsb' && c && c.dst && c.at < c.size) UsbFs.remove(c.dst); });
        return pub(j);
    }
    function clear(id) {
        var j = find(id);
        if (!j || !ended(j)) return null;
        jobs = jobs.filter(function (x) { return x !== j; });
        save();
        if (typeof Notify !== 'undefined') Notify.hide('copy-' + id);
        return pub(j);
    }
    function init() {
        if (started) return;
        started = true;
        var l = load(), changed = false;
        for (var i = 0; i < l.length; i++) if (l[i].state === 'scanning' || l[i].state === 'copying') { l[i].state = 'queued'; changed = true; }    // cut by a page change: go on
        if (changed) save();
        if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('online', function () { if (!run) wake(1500); });
        wake(1500);
    }

    return { init: init, start: start, list: list, pause: pause, resume: resume, cancel: cancel, clear: clear, onChange: onChange, watch: watch,
             _reset: function () { var h = run && run.h; run = null; if (h) try { h.abort(); } catch (e) {} jobs = null; started = false; closing = 0; } };     // _reset: tests, as if the page changed
})();
if (typeof module !== 'undefined') module.exports = CopyJobs;
