/* Music app (owner request 2026-11-05): plays the songs of USB drives / hard disks plugged into the TV, of Google Drive
 * (through the MyDrive app's Google account) and, in a browser, of a folder of the computer.
 *
 * Screens: Home (continue, drives, playlists, recently played), a folder (sub-folders as tiles with their cover, songs as
 * rows with their own cover and details), Playlists, Google Drive, the queue, Settings, and Now playing (full screen,
 * its look follows the profile's theme: css/launcher.css .mx-np + css/themes.css).
 * Hold OK (600 ms), the + button, a long press or a right click on a folder, song or playlist opens its menu: Play all,
 * Shuffle, Play next, Add to queue, Save as playlist, Add to a playlist, Rename, Delete...
 * Keys: Play / Pause key (and P) = play / pause anywhere in My PC (js/launcher/main.js); ⏭ ⏮ ⏩ ⏪ ⏹ too.
 * Channel + / − (LB / RB): a page down / up in lists; next / previous song on Now playing.
 * Playlists, recently played and settings are per profile (Store: music_lists, music_recent, music_prefs); the player is
 * js/core/music.js, the files js/core/music-src.js, the screensaver js/launcher/music-saver.js.
 * Cheap on the TV: lists are drawn 120 items at a time, covers are read only for what is on screen (one file at a time),
 * nothing ticks unless a song plays and its progress is on screen. */
(function () {
    'use strict';

    var LISTS = 'music_lists', RECENT = 'music_recent', HOLD_MS = 600, CHUNK = 120;
    var body = null, ui = {}, view = null, hist = [], items = [], shown = 0, gen = 0;
    var holdTimer = 0, holdEl = null, swallow = false, tick = 0, artTimer = 0, menu = null, npOpen = false;
    var drives = [], locs = [];

    function t(k) { return I18n.t(k); }
    function tf(k, v) { return I18n.t(k).replace('%s', v); }
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
    function btn(cls, text, fn) { var b = el('button', cls, text); b.setAttribute('data-focus', ''); if (fn) b.onclick = fn; return b; }
    function icon(name, cls) { var s = el('span', cls || 'mx-ic'); Icons.put(s, name); return s; }
    function toast(text, kind) { App.toast(text, { id: 'music', kind: kind || 'info', timeout: 3500 }); }
    function same(a, b) { return !!a && !!b && a.s === b.s && a.p === b.p; }
    function title(e) { return e.t || (MusicSrc.peekInfo(e) || {}).title || MusicTags.fromName(e.n).title || e.n; }
    function gdName(e) { return e.p === '*audio' ? t('muGdAll') : e.p === 'root' ? t('muGdMine') : e.n; }
    function dirName(e) { return e.s === 'gd' && e.drive ? gdName(e) : e.n; }

    /* ---------------- playlists and recently played (per profile) ---------------- */
    function lists() { var l = Store.get(LISTS, []); return Array.isArray(l) ? l : []; }
    function saveLists(l) { Store.set(LISTS, l.slice(0, 100)); }
    function listById(id) { var l = lists(); for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }
    function slim(e) { var o = { s: e.s, p: e.p, n: e.n }; if (e.root) o.root = e.root; if (e.mime) o.mime = e.mime; if (e.t) o.t = e.t; if (e.a) o.a = e.a; if (e.drive) o.drive = true; return o; }
    function newList(name, data) {
        var l = lists(), o = { id: 'L' + Date.now().toString(36) + Math.floor(Math.random() * 1000), n: String(name).slice(0, 60), at: Date.now() };
        if (data.dir) o.dir = slim(data.dir); else o.tracks = (data.tracks || []).slice(0, 1000).map(slim);
        l.unshift(o);
        saveLists(l);
        return o;
    }
    function editList(id, fn) { var l = lists(); for (var i = 0; i < l.length; i++) if (l[i].id === id) { if (fn(l[i], l, i) === false) l.splice(i, 1); saveLists(l); return; } }
    function recent() { var r = Store.get(RECENT, []); return Array.isArray(r) ? r : []; }
    function addRecent(o) {
        var r = recent().filter(function (x) { return !(o.list ? x.list === o.list : x.dir && same(x.dir, o.dir)); });
        r.unshift(o.list ? { n: o.n, list: o.list } : { n: o.n, dir: slim(o.dir) });
        Store.set(RECENT, r.slice(0, 8));
    }

    /* ---------------- playing a folder, a playlist, songs ---------------- */
    function busy(on, text) {
        if (!ui.busy) return;
        ui.busy.hidden = !on;
        ui.busy.textContent = text || t('wgLoading');
    }
    function tracksOf(src, cb) {
        if (src.tracks) return cb(null, src.tracks);
        var dir = src.dir, g = ++gen;
        busy(true, t('muFinding'));
        var done = function (e, l) { busy(false); if (g !== gen && !src.force) return; cb(e, l); };
        if (Music.prefs().sub) MusicSrc.walk(dir, 1000, done, function (n) { busy(true, tf('muFound', n)); });
        else MusicSrc.list(dir, function (e, r) { done(e, r ? r.tracks : []); });
    }
    // src: { dir } or { tracks } or { list }; how: 'play' | 'shuffle' | 'next' | 'queue'
    function playFrom(src, how, start) {
        var pl = src.list ? listById(src.list) : null;
        if (pl) src = pl.dir ? { dir: pl.dir, n: pl.n, list: pl.id } : { tracks: pl.tracks, n: pl.n, list: pl.id };
        tracksOf(src, function (e, tracks) {
            if (e) return toast(errText(e), 'err');
            if (!tracks || !tracks.length) return toast(t('muNoSongs'), 'warn');
            if (how === 'next' || how === 'queue') {
                var n = Music.enqueue(tracks, how === 'next');
                return toast(tf(how === 'next' ? 'muAddedNext' : 'muAdded', n), 'ok');
            }
            var name = src.n || (src.dir ? dirName(src.dir) : '');
            Music.playList(tracks, start || 0, { shuffle: how === 'shuffle' ? true : how === 'play' && start === undefined ? false : undefined,
                from: { n: name, s: src.dir ? src.dir.s : '', p: src.dir ? src.dir.p : '', list: src.list || '' } });
            if (src.list) addRecent({ n: name, list: src.list }); else if (src.dir) addRecent({ n: name, dir: src.dir });
            if (how === 'play' || how === 'shuffle') showNp();
        });
    }

    function errText(e) {
        var c = e && e.code;
        if (c === 'perm') return t('muErrPerm');
        if (c === 'gone') return t('muErrGone');
        if (c === 'network' || c === 'timeout') return t('muErrNet');
        if (c === 'unsupported') return t('muErrUnsupported');
        if (c === 'badname') return t('muBadName');
        if (c === 'noapp' || c === 'noconfig' || c === 'nouser' || c === 'reauth') return t('muGd_' + c);
        return t('muErrRead') + (e && e.message ? ' (' + e.message + ')' : '');
    }

    /* ---------------- screen frame ---------------- */
    function build() {
        body.innerHTML = '';
        var root = el('div', 'mx');
        ui.side = el('nav', 'mx-side');
        ui.main = el('div', 'mx-main');
        ui.head = el('div', 'mx-head');
        ui.title = el('h2', 'mx-title');
        ui.sub = el('div', 'mx-sub');
        ui.busy = el('div', 'mx-busy'); ui.busy.hidden = true; ui.busy.setAttribute('aria-live', 'polite');
        ui.head.appendChild(ui.title); ui.head.appendChild(ui.sub); ui.head.appendChild(ui.busy);
        ui.scroll = el('div', 'mx-scroll');
        ui.mini = el('div', 'mx-mini');
        ui.hint = el('div', 'mx-hint', t('muHint'));
        ui.main.appendChild(ui.head); ui.main.appendChild(ui.scroll); ui.main.appendChild(ui.mini); ui.main.appendChild(ui.hint);
        root.appendChild(ui.side); root.appendChild(ui.main);
        ui.np = el('div', 'mx-np'); ui.np.hidden = true;
        ui.menu = el('div', 'mx-menu-wrap'); ui.menu.hidden = true;
        root.appendChild(ui.np); root.appendChild(ui.menu);
        body.appendChild(root);
        ui.root = root;
        ui.scroll.addEventListener('scroll', lazyArt);
        bindHold(root);
    }

    function side() {
        ui.side.innerHTML = '';
        function nav(id, ic, label, fn) {
            var b = btn('mx-nav', '', fn);
            b.setAttribute('data-nav', id);
            b.appendChild(icon(ic));
            b.appendChild(el('span', 'mx-nav-t', label));
            b.setAttribute('aria-label', label);
            ui.side.appendChild(b);
            return b;
        }
        nav('home', 'home', t('home'), function () { go({ v: 'home' }, true); });
        nav('np', 'music', t('muNowPlaying'), function () { showNp(); });
        nav('queue', 'document', t('muQueue'), function () { go({ v: 'queue' }); });
        nav('lists', 'folder', t('muPlaylists'), function () { go({ v: 'lists' }); });
        drives.forEach(function (d) { nav('d:' + d.p, 'drive', d.n, function () { go({ v: 'dir', e: d }); }); });
        nav('gd', 'cloud', 'Google Drive', function () { go({ v: 'gd' }); });
        if (MusicSrc.locOk()) {
            locs.forEach(function (d) { nav('l:' + d.p, 'pc', d.n, function () { go({ v: 'dir', e: d }); }); });
            nav('addloc', 'pc', t('muAddFolder'), addLoc);
        }
        nav('set', 'settings', t('muSettings'), function () { go({ v: 'settings' }); });
        markNav();
    }
    function markNav() {
        var id = !view ? '' : view.v === 'dir' && view.e && view.e.drive ? (view.e.s === 'loc' ? 'l:' : 'd:') + view.e.p : view.v === 'list' ? 'lists' : view.v === 'set' ? 'set' : view.v;
        if (view && view.v === 'dir' && view.e && view.e.s === 'gd') id = 'gd';
        if (view && view.v === 'dir' && view.e && !view.e.drive && view.e.s !== 'gd') {
            for (var i = 0; i < drives.length; i++) if (view.e.p.indexOf(drives[i].p + '/') === 0) id = 'd:' + drives[i].p;
            if (view.e.s === 'loc') id = 'l:' + String(view.e.p).split('/')[0];
        }
        if (view && view.v === 'settings') id = 'set';
        var l = ui.side.querySelectorAll('.mx-nav');
        for (var k = 0; k < l.length; k++) l[k].classList.toggle('on', l[k].getAttribute('data-nav') === id);
    }

    /* ---------------- navigation between screens ---------------- */
    function go(v, reset, back) {
        hideNp();
        var keep = Focus.current();
        if (view && !back) hist.push({ v: view, f: keep && ui.scroll.contains(keep) ? keep.getAttribute('data-k') : '', top: ui.scroll.scrollTop });
        if (reset) hist = [];
        if (hist.length > 40) hist.shift();
        view = v;
        MusicSrc.cancel();
        gen++;
        busy(false);
        render();
    }
    function goBack() {
        if (!hist.length) return false;
        var h = hist.pop();
        view = h.v; gen++;
        MusicSrc.cancel();
        render(h.f, h.top);
        return true;
    }
    function render(focusKey, top) {
        ui.scroll.innerHTML = '';
        ui.scroll.scrollTop = 0;
        items = []; shown = 0;
        ui.sub.textContent = '';
        markNav();
        var v = view.v, first = null;
        if (v === 'home') first = home();
        else if (v === 'dir') first = folder(view.e, focusKey, top);
        else if (v === 'lists') first = playlists();
        else if (v === 'list') first = playlist(view.id, focusKey, top);
        else if (v === 'gd') first = gdHome();
        else if (v === 'queue') first = queue(focusKey);
        else if (v === 'settings') first = settings();
        Win.setTitle(t('music') + (ui.title.textContent && v !== 'home' ? ' – ' + ui.title.textContent : ''));
        drawMini();
        if (focusKey) { var f = ui.scroll.querySelector('[data-k="' + cssEsc(focusKey) + '"]'); if (f) first = f; }
        if (top) ui.scroll.scrollTop = top;
        if (first && !npOpen && !menu) { Focus.focus(first); keepVisible(first); }
        lazyArt();
        A11y.announce(ui.title.textContent + (ui.sub.textContent ? ', ' + ui.sub.textContent : ''));
        return first;
    }
    function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }

    // the focused item stays on screen (no smooth scrolling: cheap on the TV)
    function keepVisible(e) {
        if (!e || !ui.scroll.contains(e)) return;
        var r = e.getBoundingClientRect(), s = ui.scroll.getBoundingClientRect(), k = s.height / ui.scroll.clientHeight || 1, m = 24 * k;
        if (r.top < s.top + m) ui.scroll.scrollTop -= (s.top + m - r.top) / k;
        else if (r.bottom > s.bottom - m) ui.scroll.scrollTop += (r.bottom - s.bottom + m) / k;
        if (e.hasAttribute('data-i') && +e.getAttribute('data-i') > shown - 24) more();
    }

    /* ---------------- tiles and rows ---------------- */
    function tile(e, label, sub, ic, open, kind) {
        var b = btn('mx-tile', '', open);
        var a = el('span', 'mx-art'); a.appendChild(icon(ic, 'mx-art-ic'));
        b.appendChild(a);
        b.appendChild(el('span', 'mx-name', label));
        if (sub) b.appendChild(el('span', 'mx-tsub', sub));
        b.setAttribute('aria-label', label + (sub ? ', ' + sub : ''));
        b.setAttribute('data-hold', kind || 'dir');
        b._e = e;
        return b;
    }
    function row(e, i, open) {
        var b = btn('mx-row', '', open), inf = MusicSrc.peekInfo(e);
        var a = el('span', 'mx-art mx-art-s'); a.appendChild(icon('music', 'mx-art-ic'));
        b.appendChild(el('span', 'mx-num', String(i + 1)));
        b.appendChild(a);
        var tx = el('span', 'mx-rtext');
        tx.appendChild(el('span', 'mx-rt', title(e)));
        tx.appendChild(el('span', 'mx-ra', rowSub(e, inf)));
        b.appendChild(tx);
        b.appendChild(el('span', 'mx-rd', inf && inf.dur ? Music.clock(inf.dur) : e.d ? Music.clock(e.d) : ''));
        b.setAttribute('aria-label', title(e) + (rowSub(e, inf) ? ', ' + rowSub(e, inf) : ''));
        b.setAttribute('data-hold', 'track');
        b._e = e;
        return b;
    }
    function rowSub(e, inf) {
        var a = (inf && inf.artist) || e.a || '', al = (inf && inf.album) || e.b || '';
        return a && al ? a + ' · ' + al : a || al || (/\.([a-z0-9]+)$/i.exec(e.n) || ['', ''])[1].toUpperCase();
    }
    function setArt(b, v) {
        if (!v || !b.parentNode) return;
        var a = b.querySelector('.mx-art');
        if (!a || a.querySelector('img')) return;
        var im = new Image();
        im.alt = ''; im.decoding = 'async';
        im.src = v.url;
        a.innerHTML = '';
        a.appendChild(im);
        a.classList.add('has');
    }
    function fillRow(b, inf) {
        if (!inf || !b.parentNode) return;
        var e = b._e;
        b.querySelector('.mx-rt').textContent = inf.title || title(e);
        b.querySelector('.mx-ra').textContent = rowSub(e, inf);
        if (inf.dur) b.querySelector('.mx-rd').textContent = Music.clock(inf.dur);
        b.setAttribute('aria-label', (inf.title || title(e)) + ', ' + rowSub(e, inf));
    }
    // covers and song details for what is on screen, a moment after the list stops moving
    function lazyArt() {
        clearTimeout(artTimer);
        artTimer = setTimeout(function () {
            if (!ui.scroll) return;
            var s = ui.scroll.getBoundingClientRect(), l = ui.scroll.querySelectorAll('.mx-tile, .mx-row'), g = gen, want = Music.prefs().details;
            for (var i = 0; i < l.length; i++) {
                var b = l[i], r = b.getBoundingClientRect();
                if (r.bottom < s.top - 200 || r.top > s.bottom + 400 || b._asked || !b._e) continue;
                b._asked = true;
                (function (b) {
                    var e = b._e, kind = b.getAttribute('data-hold');
                    var done = function (v) { if (g === gen) setArt(b, v); };
                    if (kind === 'dir') { if (!(e.s === 'gd' && e.drive)) MusicSrc.folderArt(e, done); }
                    else if (kind === 'track') {
                        if (want) MusicSrc.art(e, function (v) { done(v); MusicSrc.info(e, function (inf) { if (g === gen) fillRow(b, inf); }); });
                        else if (e.s !== 'gd') MusicSrc.folderArt({ s: e.s, p: MusicSrc.parent(e.p), n: '', dir: true, root: e.root }, done);
                    } else if (kind === 'list' && b._cover) MusicSrc.folderArt(b._cover, done);
                })(b);
            }
        }, 220);
    }

    /* ---------------- Home ---------------- */
    function section(label) { var s = el('section', 'mx-sec'); s.appendChild(el('h3', 'mx-sec-t', label)); var g = el('div', 'mx-grid'); s.appendChild(g); ui.scroll.appendChild(s); return g; }
    function home() {
        ui.title.textContent = t('music');
        var first = null, st = Music.state();
        if (st.has) {
            var c = el('div', 'mx-cont');
            var cb = btn('mx-cont-btn', '', function () { Music.play(); showNp(); });
            var a = el('span', 'mx-art mx-art-c'); a.appendChild(icon('music', 'mx-art-ic'));
            cb.appendChild(a);
            var tx = el('span', 'mx-cont-text');
            tx.appendChild(el('span', 'mx-cont-k', t(st.playing ? 'muNowPlaying' : 'muContinue')));
            tx.appendChild(el('span', 'mx-cont-t', st.title));
            tx.appendChild(el('span', 'mx-cont-a', (st.artist ? st.artist + ' · ' : '') + (st.pos > 1 ? tf('muAt', Music.clock(st.pos)) : tf('muSongs', st.count))));
            cb.appendChild(tx);
            cb.setAttribute('aria-label', t(st.playing ? 'muNowPlaying' : 'muContinue') + ': ' + st.title);
            c.appendChild(cb);
            ui.scroll.appendChild(c);
            MusicSrc.art(st.track, function (v) { setArt(cb, v); });
            first = cb;
        }
        var g = section(t('muPlaces'));
        if (!drives.length) {
            var none = tile(null, t('muNoDrive'), t('muNoDriveSub'), 'drive', function () { refreshDrives(true); }, 'none');
            none.removeAttribute('data-hold');
            g.appendChild(none);
        }
        drives.forEach(function (d) { g.appendChild(tile(d, d.n, t('muUsb'), 'drive', function () { go({ v: 'dir', e: d }); })); });
        var gdt = tile(null, 'Google Drive', t('muViaMyDrive'), 'cloud', function () { go({ v: 'gd' }); }, 'none');
        gdt.removeAttribute('data-hold');
        g.appendChild(gdt);
        locs.forEach(function (d) { g.appendChild(tile(d, d.n, t('muPcFolder'), 'pc', function () { go({ v: 'dir', e: d }); })); });
        if (!first) first = g.firstChild;
        var pl = lists();
        if (pl.length) {
            var lg = section(t('muPlaylists'));
            pl.slice(0, 6).forEach(function (p) { lg.appendChild(listTile(p)); });
        }
        var rc = recent();
        if (rc.length) {
            var rg = section(t('muRecent'));
            rc.forEach(function (r) {
                if (r.list) { var p = listById(r.list); if (p) rg.appendChild(listTile(p)); }
                else if (r.dir) { var b = tile(r.dir, r.n, r.dir.root || '', r.dir.s === 'gd' ? 'cloud' : 'folder', function () { go({ v: 'dir', e: r.dir }); }); rg.appendChild(b); }
            });
        }
        return first;
    }

    /* ---------------- a folder ---------------- */
    function folder(e, focusKey, top) {
        ui.title.textContent = dirName(e);
        var g = gen;
        var bar = el('div', 'mx-actions');
        var pa = btn('mx-act mx-act-main', '', function () { playFrom({ dir: e }, 'play'); });
        pa.appendChild(icon('play')); pa.appendChild(el('span', '', t('muPlayAll')));
        var sh = btn('mx-act', '', function () { playFrom({ dir: e }, 'shuffle'); });
        sh.appendChild(icon('shuffle')); sh.appendChild(el('span', '', t('muShuffle')));
        var sv = btn('mx-act', '', function () { saveFolder(e); });
        sv.appendChild(icon('plus')); sv.appendChild(el('span', '', t('muSaveList')));
        bar.appendChild(pa); bar.appendChild(sh); bar.appendChild(sv);
        ui.scroll.appendChild(bar);
        var grid = el('div', 'mx-grid'), rows = el('div', 'mx-rows');
        ui.scroll.appendChild(grid); ui.scroll.appendChild(rows);
        var wait = el('p', 'mx-empty', t('wgLoading'));
        ui.scroll.appendChild(wait);
        MusicSrc.list(e, function (err, r) {
            if (g !== gen) return;
            wait.remove();
            if (err) { ui.scroll.appendChild(el('p', 'mx-empty mx-err', errText(err))); if (err.code === 'gone') refreshDrives(); return; }
            ui.sub.textContent = r.dirs.length && r.tracks.length ? tf('muFolders', r.dirs.length) + ' · ' + tf('muSongs', r.tracks.length) : r.tracks.length ? tf('muSongs', r.tracks.length) : tf('muFolders', r.dirs.length);
            if (!r.dirs.length && !r.tracks.length) { ui.scroll.appendChild(el('p', 'mx-empty', t('muEmpty'))); bar.hidden = true; return; }
            items = r.dirs.concat(r.tracks);
            view.tracks = r.tracks;
            view.grid = grid; view.rows = rows; view.nd = r.dirs.length;
            more(focusKey);
            var f = focusKey && ui.scroll.querySelector('[data-k="' + cssEsc(focusKey) + '"]');
            if (top) ui.scroll.scrollTop = top;
            if (!npOpen && !menu && (!Focus.current() || !document.body.contains(Focus.current()) || Focus.current() === pa)) { Focus.focus(f || (r.dirs.length ? grid.firstChild : pa)); keepVisible(Focus.current()); }
            lazyArt();
            A11y.announce(ui.sub.textContent);
        });
        return pa;
    }
    // the next 120 items of a long folder (and up to focusKey when coming back to it)
    function more(focusKey) {
        if (!view || view.v !== 'dir' && view.v !== 'list' || shown >= items.length) return;
        var end = Math.min(items.length, shown + CHUNK);
        if (focusKey) for (var j = shown; j < items.length; j++) if (key(items[j]) === focusKey) end = Math.max(end, Math.min(items.length, j + 20));
        for (var i = shown; i < end; i++) {
            var e = items[i], b;
            if (e.dir) b = tile(e, dirName(e), '', 'folder', (function (d) { return function () { go({ v: 'dir', e: d }); }; })(e));
            else b = row(e, i - (view.nd || 0), (function (k) { return function () { playTrack(k); }; })(i - (view.nd || 0)));
            b.setAttribute('data-i', i);
            b.setAttribute('data-k', key(e));
            (e.dir ? view.grid : view.rows).appendChild(b);
        }
        shown = end;
        lazyArt();
    }
    function key(e) { return e.s + ':' + e.p; }
    function playTrack(i) {
        var v = view;
        if (v.v === 'list') return playFrom({ list: v.id }, 'play', i);
        if (!v.tracks) return;
        Music.playList(v.tracks, i, { shuffle: false, from: { n: dirName(v.e), s: v.e.s, p: v.e.p } });
        addRecent({ n: dirName(v.e), dir: v.e });
        showNp();
    }

    function saveFolder(e, name) {
        var ex = lists().filter(function (l) { return l.dir && same(l.dir, e); })[0];
        if (ex) return toast(tf('muListExists', ex.n), 'info');
        Keyboard.open({ title: t('muListName'), text: name || dirName(e), max: 40, mode: 'title' }, function (v) {
            v = String(v || '').trim();
            if (!v) return;
            newList(v, { dir: e });
            toast(tf('muListSaved', v), 'ok');
            if (view.v === 'home' || view.v === 'lists') render();
        });
    }

    /* ---------------- playlists ---------------- */
    function listTile(p) {
        var b = tile(p, p.n, p.dir ? (p.dir.root || t('muFolderList')) : tf('muSongs', (p.tracks || []).length), 'folder', function () { go({ v: 'list', id: p.id }); }, 'list');
        b.setAttribute('data-k', 'L:' + p.id);
        b._cover = p.dir || (p.tracks && p.tracks[0] && p.tracks[0].s !== 'gd' ? { s: p.tracks[0].s, p: MusicSrc.parent(p.tracks[0].p), n: '', dir: true } : null);
        return b;
    }
    function playlists() {
        ui.title.textContent = t('muPlaylists');
        var l = lists();
        ui.sub.textContent = tf('muNLists', l.length);
        if (!l.length) { ui.scroll.appendChild(el('p', 'mx-empty', t('muNoLists'))); return null; }
        var g = el('div', 'mx-grid');
        l.forEach(function (p) { g.appendChild(listTile(p)); });
        ui.scroll.appendChild(g);
        return g.firstChild;
    }
    function playlist(id, focusKey) {
        var p = listById(id);
        if (!p) { ui.title.textContent = t('muPlaylists'); ui.scroll.appendChild(el('p', 'mx-empty', t('muNoLists'))); return null; }
        if (p.dir) { view = { v: 'dir', e: p.dir, listId: p.id }; var f = folder(p.dir, focusKey); ui.title.textContent = p.n; return f; }
        ui.title.textContent = p.n;
        ui.sub.textContent = tf('muSongs', p.tracks.length);
        var bar = el('div', 'mx-actions');
        var pa = btn('mx-act mx-act-main', '', function () { playFrom({ list: id }, 'play'); });
        pa.appendChild(icon('play')); pa.appendChild(el('span', '', t('muPlayAll')));
        var sh = btn('mx-act', '', function () { playFrom({ list: id }, 'shuffle'); });
        sh.appendChild(icon('shuffle')); sh.appendChild(el('span', '', t('muShuffle')));
        bar.appendChild(pa); bar.appendChild(sh);
        ui.scroll.appendChild(bar);
        var rows = el('div', 'mx-rows');
        ui.scroll.appendChild(rows);
        if (!p.tracks.length) ui.scroll.appendChild(el('p', 'mx-empty', t('muListEmpty')));
        items = p.tracks.slice(); view.tracks = p.tracks; view.rows = rows; view.grid = rows; view.nd = 0;
        more(focusKey);
        return pa;
    }

    /* ---------------- Google Drive ---------------- */
    function gdHome() {
        ui.title.textContent = 'Google Drive';
        var g = gen, wait = el('p', 'mx-empty', t('wgLoading'));
        ui.scroll.appendChild(wait);
        MusicSrc.gdStatus(function (st) {
            if (g !== gen) return;
            wait.remove();
            if (!st.ok) {
                var box = el('div', 'mx-msg');
                box.appendChild(icon('cloud', 'mx-msg-ic'));
                var name = Profiles.name ? Profiles.name(null, t('player')) : '';
                box.appendChild(el('p', 'mx-msg-t', t('muGd_' + st.code).replace('%s', st.code === 'reauth' ? st.email || name : name)));
                var go2 = null;
                if (st.code === 'noapp') go2 = btn('btn btn-primary', t('muOpenStore'), function () { Win.open('store', 'apps'); });
                else if (st.code !== 'noconfig') go2 = btn('btn btn-primary', t('muOpenMyDrive'), openMyDrive);
                if (go2) box.appendChild(go2);
                box.appendChild(btn('btn', t('muTryAgain'), function () { render(); }));
                ui.scroll.appendChild(box);
                A11y.announce(box.textContent);
                if (!npOpen && !menu) Focus.focus(box.querySelector('[data-focus]'));
                return;
            }
            ui.sub.textContent = st.email ? tf('muGdAs', st.email) : '';
            var grid = el('div', 'mx-grid');
            MusicSrc.gdRoots().forEach(function (r) {
                var b = tile(r, gdName(r), '', r.p === '*audio' ? 'music' : 'cloud', function () { go({ v: 'dir', e: r }); });
                if (r.p === '*audio') b.removeAttribute('data-hold');
                grid.appendChild(b);
            });
            ui.scroll.appendChild(grid);
            ui.scroll.appendChild(el('p', 'mx-note', t('muGdNote')));
            if (!npOpen && !menu) Focus.focus(grid.firstChild);
        });
        return null;
    }
    function openMyDrive() {
        var l = Desktop.games(), g = null;
        for (var i = 0; i < l.length; i++) if (l[i].id === 'app-' + MusicSrc.gdApp) g = l[i];
        if (g) Desktop.play(g); else Win.open('store', 'apps');
    }

    /* ---------------- queue ---------------- */
    function queue(focusKey) {
        ui.title.textContent = t('muQueue');
        var qq = Music.queue(), st = Music.state();
        if (!qq.list.length) { ui.scroll.appendChild(el('p', 'mx-empty', t('muQueueEmpty'))); return null; }
        ui.sub.textContent = tf('muSongs', qq.list.length) + (st.from && st.from.n ? ' · ' + tf('muFrom', st.from.n) : '');
        var bar = el('div', 'mx-actions');
        var sv = btn('mx-act', '', function () {
            Keyboard.open({ title: t('muListName'), text: st.from && st.from.n || t('muQueue'), max: 40, mode: 'title' }, function (v) {
                v = String(v || '').trim(); if (!v) return;
                var q2 = Music.queue();
                newList(v, { tracks: q2.order.map(function (k) { return q2.list[k]; }) });
                toast(tf('muListSaved', v), 'ok');
            });
        });
        sv.appendChild(icon('plus')); sv.appendChild(el('span', '', t('muSaveQueue')));
        var cl = btn('mx-act', '', function () { Music.clear(); render(); });
        cl.appendChild(icon('close')); cl.appendChild(el('span', '', t('muClearQueue')));
        bar.appendChild(sv); bar.appendChild(cl);
        ui.scroll.appendChild(bar);
        var rows = el('div', 'mx-rows'), cur = null;
        // from the song playing now, then the rest in play order (the first 300)
        var n = Math.min(qq.order.length, 300);
        for (var k = 0; k < n; k++) {
            var oi = (qq.at + k) % qq.order.length, qi = qq.order[oi], e = qq.list[qi];
            var b = row(e, k, (function (x) { return function () { Music.pick(x); showNp(); }; })(qi));
            b.querySelector('.mx-num').textContent = k ? String(k) : '♪';
            b.setAttribute('data-hold', 'queue');
            b.setAttribute('data-q', qi);
            b.setAttribute('data-k', 'q' + qi);
            if (!k) { b.classList.add('on'); cur = b; }
            rows.appendChild(b);
        }
        ui.scroll.appendChild(rows);
        return cur;
    }

    /* ---------------- settings ---------------- */
    function settings() {
        ui.title.textContent = t('muSettings');
        var p = Music.prefs(), box = el('div', 'mx-set');
        function opt(label, desc, values, cur, fn) {
            var b = btn('mx-set-row', '');
            var tx = el('span', 'mx-set-text');
            tx.appendChild(el('span', 'mx-set-name', label));
            if (desc) tx.appendChild(el('span', 'mx-set-desc', desc));
            var val = el('span', 'mx-set-val');
            b.appendChild(tx); b.appendChild(val);
            var i = 0;
            for (var k = 0; k < values.length; k++) if (values[k][0] === cur) i = k;
            function draw() { val.textContent = '‹  ' + values[i][1] + '  ›'; b.setAttribute('aria-label', label + ': ' + values[i][1]); }
            b._step = function (d) { i = (i + d + values.length) % values.length; draw(); fn(values[i][0]); A11y.announce(values[i][1]); };
            b.onclick = function () { b._step(1); };
            draw();
            box.appendChild(b);
            return b;
        }
        var on = [[true, t('on')], [false, t('off')]];
        var first = opt(t('muSaver'), t('muSaverDesc'), [['bars', t('muSaverBars')], ['waves', t('muSaverWaves')], ['cover', t('muSaverCover')], ['off', t('off')]], p.saver, function (v) { Music.setPref('saver', v); });
        opt(t('muSaverAfter'), '', [[1, '1 min'], [2, '2 min'], [5, '5 min'], [10, '10 min'], [20, '20 min']], p.saverMin, function (v) { Music.setPref('saverMin', v); });
        var test = btn('mx-set-row mx-set-btn', t('muSaverTry'), function () { if (typeof MusicSaver !== 'undefined') MusicSaver.show(true); });
        box.appendChild(test);
        opt(t('muResume'), t('muResumeDesc'), on, p.resume, function (v) { Music.setPref('resume', v); });
        opt(t('muSub'), t('muSubDesc'), on, p.sub, function (v) { Music.setPref('sub', v); });
        opt(t('muDetails'), t('muDetailsDesc'), on, p.details, function (v) { Music.setPref('details', v); });
        if (typeof webapis !== 'undefined' && webapis.avplay) opt(t('muEngine'), t('muEngineDesc'), [['auto', t('muEngineTv')], ['html', t('muEngineWeb')]], p.engine, function (v) { Music.setPref('engine', v); });
        box.appendChild(el('p', 'mx-note', t('muPrivacy')));
        ui.scroll.appendChild(box);
        return first;
    }

    /* ---------------- this computer's folders (browsers that can open one) ---------------- */
    function addLoc() {
        MusicSrc.locAdd(function (e, d) {
            if (e) { if (e.code !== 'cancelled') toast(errText(e), 'err'); return; }
            MusicSrc.locRoots(function (l) { locs = l; side(); go({ v: 'dir', e: d }); });
        });
    }

    /* ---------------- the menu of an item (hold OK, +, long press, right click) ---------------- */
    function openMenu(b) {
        var kind = b.getAttribute('data-hold'), e = b._e;
        if (!kind || kind === 'none') return;
        var opts = [], label = (b.querySelector('.mx-name, .mx-rt') || b).textContent;
        function add(text, fn, cls) { opts.push({ text: text, fn: fn, cls: cls || '' }); }
        if (kind === 'dir') {
            add(t('storeOpen'), function () { b.click(); });
            add(t('muPlayAll'), function () { playFrom({ dir: e }, 'play'); });
            add(t('muShuffle'), function () { playFrom({ dir: e }, 'shuffle'); });
            add(t('muPlayNext'), function () { playFrom({ dir: e }, 'next'); });
            add(t('muAddQueue'), function () { playFrom({ dir: e }, 'queue'); });
            add(t('muSaveList'), function () { saveFolder(e); });
            if (!e.drive) add(t('muRename'), function () { rename(b, e); });
        } else if (kind === 'track' || kind === 'queue') {
            var qi = kind === 'queue' ? +b.getAttribute('data-q') : -1;
            add(t('wgPlay'), function () { b.click(); });
            if (kind === 'track') {
                add(t('muPlayNext'), function () { Music.enqueue([e], true); toast(tf('muAddedNext', 1), 'ok'); });
                add(t('muAddQueue'), function () { Music.enqueue([e], false); toast(tf('muAdded', 1), 'ok'); });
            }
            add(t('muAddToList'), function () { pickList(e); });
            if (view.v === 'list' && view.id) {
                var idx = +b.getAttribute('data-i');
                add(t('muMoveUp'), function () { moveInList(view.id, idx, -1); });
                add(t('muMoveDown'), function () { moveInList(view.id, idx, 1); });
                add(t('muRemoveList'), function () { editList(view.id, function (p) { p.tracks.splice(idx, 1); }); render(); }, 'danger');
            }
            if (kind === 'queue') add(t('muRemoveQueue'), function () { Music.remove(qi); render(); }, 'danger');
            if (e.s !== 'gd' || kind !== 'queue') {
                if (view.v !== 'dir' && e.s !== 'gd') add(t('muGoFolder'), function () { var p = MusicSrc.parent(e.p); go({ v: 'dir', e: { s: e.s, p: p, n: MusicSrc.base(p), dir: true, root: e.root } }); });
            }
            if (kind === 'track' && view.v === 'dir') add(t('muRename'), function () { rename(b, e); });
        } else if (kind === 'list') {
            add(t('storeOpen'), function () { b.click(); });
            add(t('muPlayAll'), function () { playFrom({ list: e.id }, 'play'); });
            add(t('muShuffle'), function () { playFrom({ list: e.id }, 'shuffle'); });
            add(t('muAddQueue'), function () { playFrom({ list: e.id }, 'queue'); });
            add(t('muRename'), function () {
                Keyboard.open({ title: t('muRename'), text: e.n, max: 40, mode: 'title' }, function (v) {
                    v = String(v || '').trim(); if (!v) return;
                    editList(e.id, function (p) { p.n = v; });
                    recentRename(e.id, v);
                    toast(t('muRenamed'), 'ok'); render('L:' + e.id);
                });
            });
            add(t('muDelete'), function () {
                App.confirm(tf('muDeleteSure', e.n), t('muDeleteText'), function () {
                    editList(e.id, function () { return false; });
                    Store.set(RECENT, recent().filter(function (r) { return r.list !== e.id; }));
                    toast(t('muDeleted'), 'ok'); render();
                });
            }, 'danger');
        }
        showMenu(label, opts, b);
    }
    function recentRename(id, n) { Store.set(RECENT, recent().map(function (r) { if (r.list === id) r.n = n; return r; })); }
    function moveInList(id, i, d) {
        editList(id, function (p) { var j = i + d; if (j < 0 || j >= p.tracks.length) return; var x = p.tracks[i]; p.tracks[i] = p.tracks[j]; p.tracks[j] = x; });
        var p = listById(id), e = p && p.tracks[i + d];
        render(e ? key(e) : '');
    }
    function pickList(e) {
        var opts = lists().filter(function (p) { return p.tracks; }).map(function (p) {
            return { text: p.n, fn: function () { editList(p.id, function (x) { if (x.tracks.length < 1000) x.tracks.push(slim(e)); }); toast(tf('muAddedTo', p.n), 'ok'); } };
        });
        opts.unshift({ text: t('muNewList'), fn: function () {
            Keyboard.open({ title: t('muListName'), text: '', max: 40, mode: 'title' }, function (v) {
                v = String(v || '').trim(); if (!v) return;
                newList(v, { tracks: [e] }); toast(tf('muAddedTo', v), 'ok');
            });
        } });
        setTimeout(function () { showMenu(t('muAddToList'), opts, null); }, 0);
    }
    function rename(b, e) {
        var base = e.dir ? e.n : e.n.replace(/\.[a-z0-9]{2,5}$/i, '');
        Keyboard.open({ title: t('muRename'), text: base, max: 80, mode: 'title' }, function (v) {
            v = String(v || '').trim();
            if (!v || v === base) return;
            MusicSrc.rename(e, v, function (err, n) {
                if (err) return toast(errText(err), 'err');
                lists().forEach(function (p) { if (p.dir && same(p.dir, e)) editList(p.id, function (x) { x.dir.p = n.p; x.dir.n = n.n; }); });
                toast(t('muRenamed'), 'ok');
                render(key(n), ui.scroll.scrollTop);
            });
        });
    }
    function showMenu(label, opts, from) {
        closeMenu(true);
        var w = ui.menu, m = el('div', 'mx-menu');
        w.innerHTML = '';
        m.setAttribute('role', 'menu');
        m.setAttribute('aria-label', label);
        m.appendChild(el('div', 'mx-menu-t', label));
        opts.forEach(function (o) {
            var x = btn('mx-menu-i' + (o.cls ? ' ' + o.cls : ''), o.text, function () { closeMenu(); o.fn(); });
            x.setAttribute('role', 'menuitem');
            m.appendChild(x);
        });
        w.appendChild(m);
        w.hidden = false;
        menu = { from: from };
        // beside the item when there is room, else in the middle
        if (from && from.parentNode) {
            var rr = ui.root.getBoundingClientRect(), k = rr.width / ui.root.offsetWidth || 1, r = from.getBoundingClientRect();
            var x0 = (r.right - rr.left) / k + 12, y0 = (r.top - rr.top) / k, mw = m.offsetWidth, mh = m.offsetHeight;
            if (x0 + mw > ui.root.offsetWidth - 20 || document.documentElement.getAttribute('dir') === 'rtl') x0 = (r.left - rr.left) / k - mw - 12;
            if (x0 < 20) x0 = Math.max(20, (ui.root.offsetWidth - mw) / 2);
            y0 = Math.max(20, Math.min(y0, ui.root.offsetHeight - mh - 20));
            m.style.left = Math.round(x0) + 'px'; m.style.top = Math.round(y0) + 'px';
        } else m.classList.add('mid');
        Focus.push(m, m.querySelector('.mx-menu-i'));
        A11y.announce(label);
    }
    function closeMenu(quiet) {
        if (!menu) return false;
        menu = null;
        ui.menu.hidden = true;
        ui.menu.innerHTML = '';
        Focus.pop();
        return true;
    }

    // hold OK on the remote: menu; OK let go before: open (Win gives the app the OK release)
    function holdStart(b) {
        clearTimeout(holdTimer);
        holdEl = b;
        holdTimer = setTimeout(function () { holdTimer = 0; var x = holdEl; holdEl = null; if (x && x.parentNode) openMenu(x); }, HOLD_MS);
    }
    function holdEnd() {
        if (!holdTimer) return;
        clearTimeout(holdTimer); holdTimer = 0;
        var x = holdEl; holdEl = null;
        if (x && x.parentNode) x.click();
    }
    // touch and mouse: a long press or a right click
    function bindHold(root) {
        var pt = 0, px = 0, py = 0;
        function target(n) { while (n && n !== root) { if (n.getAttribute && n.getAttribute('data-hold') && n.getAttribute('data-hold') !== 'none') return n; n = n.parentNode; } return null; }
        root.addEventListener('pointerdown', function (e) {
            var b = e.button ? null : target(e.target);
            clearTimeout(pt); pt = 0;
            if (!b) return;
            px = e.clientX; py = e.clientY;
            pt = setTimeout(function () { pt = 0; swallow = true; openMenu(b); }, HOLD_MS);
        });
        root.addEventListener('pointermove', function (e) { if (pt && Math.abs(e.clientX - px) + Math.abs(e.clientY - py) > 16) { clearTimeout(pt); pt = 0; } });
        function stop() { clearTimeout(pt); pt = 0; }
        root.addEventListener('pointerup', stop);
        root.addEventListener('pointercancel', stop);
        root.addEventListener('click', function (e) { if (swallow) { swallow = false; e.stopPropagation(); e.preventDefault(); } }, true);
        root.addEventListener('contextmenu', function (e) { var b = target(e.target); if (!b) return; e.preventDefault(); stop(); if (!menu) openMenu(b); });
        root.addEventListener('wheel', function () { lazyArt(); }, { passive: true });
    }

    /* ---------------- mini player (under the lists) ---------------- */
    function drawMini() {
        if (!ui.mini) return;
        var s = Music.state();
        ui.mini.hidden = !s.has;
        if (!s.has) { ticking(); return; }
        if (!ui.miniBox) {
            ui.mini.innerHTML = '';
            var open = btn('mx-mini-open', '', showNp);
            var a = el('span', 'mx-art mx-art-m'); a.appendChild(icon('music', 'mx-art-ic'));
            open.appendChild(a);
            var tx = el('span', 'mx-mini-text');
            tx.appendChild(el('span', 'mx-mini-t'));
            tx.appendChild(el('span', 'mx-mini-a'));
            open.appendChild(tx);
            ui.mini.appendChild(open);
            var c = el('div', 'mx-mini-ctl');
            c.appendChild(ctlBtn('prev', t('wgPrev'), Music.prev));
            ui.miniPlay = ctlBtn('play', t('wgPlay'), Music.toggle);
            c.appendChild(ui.miniPlay);
            c.appendChild(ctlBtn('next', t('wgNext'), Music.next));
            ui.mini.appendChild(c);
            var bar = el('div', 'mx-mini-bar'); ui.miniLoad = el('b', 'mx-load'); ui.miniFill = el('i'); bar.appendChild(ui.miniLoad); bar.appendChild(ui.miniFill);
            ui.mini.appendChild(bar);
            ui.miniBox = open;
        }
        ui.miniBox.querySelector('.mx-mini-t').textContent = s.title;
        ui.miniBox.querySelector('.mx-mini-a').textContent = s.loading ? t('wgLoading') : s.error || s.artist;
        ui.miniBox.setAttribute('aria-label', t('muNowPlaying') + ': ' + s.title + (s.artist ? ', ' + s.artist : ''));
        Icons.put(ui.miniPlay, s.playing ? 'pause' : 'play');
        ui.miniPlay.setAttribute('aria-label', t(s.playing ? 'wgPause' : 'wgPlay'));
        progress();
        var k = key(s.track);
        if (ui.miniKey !== k) {
            ui.miniKey = k;
            var art = ui.miniBox.querySelector('.mx-art');
            art.innerHTML = ''; art.classList.remove('has'); art.appendChild(icon('music', 'mx-art-ic'));
            MusicSrc.art(s.track, function (v) { if (ui.miniKey === k) setArt(ui.miniBox, v); });
        }
        ticking();
    }
    function ctlBtn(ic, label, fn) {
        var b = btn('mx-cb', '', function () { fn(); });
        b.setAttribute('aria-label', label);
        b.setAttribute('data-c', ic);
        Icons.put(b, ic);
        return b;
    }
    function progress() {
        var s = Music.state(), f = s.dur ? Math.min(1, s.pos / s.dur) : 0;
        var l = Math.max(f, s.loaded || 0);
        if (ui.miniFill) { ui.miniFill.style.transform = 'scaleX(' + f + ')'; ui.miniLoad.style.transform = 'scaleX(' + l + ')'; }
        if (npOpen && ui.npLoad) {
            // grows smoothly; going back (another song) it jumps: no animation from full to empty
            ui.npLoad.style.transition = l < (ui.npLoadV || 0) ? 'none' : '';
            ui.npLoadV = l;
            ui.npLoad.style.transform = 'scaleX(' + l + ')';
        }
        if (npOpen && ui.npFill) {
            ui.npFill.style.transform = 'scaleX(' + f + ')';
            ui.npKnob.style.left = (f * 100) + '%';
            ui.npPos.textContent = Music.clock(s.pos);
            ui.npDur.textContent = s.dur ? '-' + Music.clock(s.dur - s.pos) : '';
            ui.npSeek.setAttribute('aria-valuenow', Math.floor(s.pos));
            ui.npSeek.setAttribute('aria-valuemax', Math.floor(s.dur));
            ui.npSeek.setAttribute('aria-valuetext', Music.clock(s.pos) + ' / ' + Music.clock(s.dur));
        }
    }
    // one timer, only while a song plays and its progress is on screen
    function ticking() {
        var on = !!body && Music.state().playing && (npOpen || (ui.mini && !ui.mini.hidden));
        if (on && !tick) tick = setInterval(progress, npOpen ? 500 : 1000);
        else if (!on && tick) { clearInterval(tick); tick = 0; }
    }

    /* ---------------- Now playing ---------------- */
    function showNp() {
        if (!Music.state().has) return toast(t('muQueueEmpty'), 'info');
        if (!npOpen) {
            npOpen = true;
            buildNp();
            ui.np.hidden = false;
            Focus.push(ui.np, ui.npBtn.play);
            Win.setTitle(t('music') + ' – ' + t('muNowPlaying'));
        }
        drawNp();
        A11y.announce(t('muNowPlaying') + ': ' + Music.state().title);
    }
    function hideNp() {
        if (!npOpen) return false;
        npOpen = false;
        ui.np.hidden = true;
        ui.np.innerHTML = '';
        ui.npKey = '';
        Focus.pop();
        Win.setTitle(t('music') + (ui.title.textContent && view && view.v !== 'home' ? ' – ' + ui.title.textContent : ''));
        ticking();
        return true;
    }
    function buildNp() {
        var n = ui.np;
        n.innerHTML = '';
        n.appendChild(el('div', 'mx-np-bg'));
        var wrap = el('div', 'mx-np-wrap');
        ui.npArt = el('div', 'mx-np-art'); ui.npArt.appendChild(icon('music', 'mx-art-ic'));
        wrap.appendChild(ui.npArt);
        var info = el('div', 'mx-np-info');
        ui.npFrom = el('div', 'mx-np-from');
        ui.npTitle = el('div', 'mx-np-title');
        ui.npArtist = el('div', 'mx-np-artist');
        ui.npAlbum = el('div', 'mx-np-album');
        info.appendChild(ui.npFrom); info.appendChild(ui.npTitle); info.appendChild(ui.npArtist); info.appendChild(ui.npAlbum);
        ui.npSeek = btn('mx-np-seek', '', function () { Music.toggle(); });
        ui.npSeek.setAttribute('role', 'slider');
        ui.npSeek.setAttribute('aria-label', t('muPosition'));
        var track = el('span', 'mx-np-track'); ui.npLoad = el('i', 'mx-np-load'); ui.npFill = el('i', 'mx-np-fill'); ui.npKnob = el('b', 'mx-np-knob');
        track.appendChild(ui.npLoad); track.appendChild(ui.npFill); track.appendChild(ui.npKnob); ui.npSeek.appendChild(track);
        ui.npSeek.addEventListener('click', function (e) {
            if (!e.clientX) return;                 // a key, not a pointer
            e.stopImmediatePropagation();
            var r = track.getBoundingClientRect(), s = Music.state(), f = (e.clientX - r.left) / r.width;
            if (document.documentElement.getAttribute('dir') === 'rtl') f = 1 - f;
            if (s.dur) Music.seek(Math.max(0, Math.min(1, f)) * s.dur);
        }, true);
        info.appendChild(ui.npSeek);
        var times = el('div', 'mx-np-times'); ui.npPos = el('span', '', '0:00'); ui.npDur = el('span', '', '');
        times.appendChild(ui.npPos); times.appendChild(ui.npDur);
        info.appendChild(times);
        var c = el('div', 'mx-np-ctl');
        ui.npBtn = {
            shuffle: ctlBtn('shuffle', t('muShuffle'), function () { Music.setShuffle(!Music.state().shuffle); A11y.announce(t(Music.state().shuffle ? 'muShuffleOn' : 'muShuffleOff')); }),
            prev: ctlBtn('prev', t('wgPrev'), Music.prev),
            play: ctlBtn('play', t('wgPlay'), Music.toggle),
            next: ctlBtn('next', t('wgNext'), Music.next),
            repeat: ctlBtn('repeat', t('muRepeat'), function () { var r = Music.cycleRepeat(); A11y.announce(t('muRepeat_' + r)); })
        };
        ui.npBtn.play.classList.add('mx-cb-main');
        c.appendChild(ui.npBtn.shuffle); c.appendChild(ui.npBtn.prev); c.appendChild(ui.npBtn.play); c.appendChild(ui.npBtn.next); c.appendChild(ui.npBtn.repeat);
        info.appendChild(c);
        var tools = el('div', 'mx-np-tools');
        var qb = btn('mx-np-tool', '', function () { hideNp(); go({ v: 'queue' }); });
        qb.appendChild(icon('document')); qb.appendChild(el('span', '', t('muQueue')));
        var sv = btn('mx-np-tool', '', function () { if (typeof MusicSaver !== 'undefined') MusicSaver.show(true); });
        sv.appendChild(icon('desktop')); sv.appendChild(el('span', '', t('muSaver')));
        tools.appendChild(qb); tools.appendChild(sv);
        info.appendChild(tools);
        ui.npNext = el('div', 'mx-np-next');
        info.appendChild(ui.npNext);
        wrap.appendChild(info);
        n.appendChild(wrap);
        n.appendChild(el('div', 'mx-hint mx-np-hint', t('muNpHint')));
    }
    function drawNp() {
        if (!npOpen) return;
        var s = Music.state();
        if (!s.has) return hideNp();
        ui.npFrom.textContent = s.from && s.from.n ? tf('muFrom', s.from.n) : '';
        ui.npTitle.textContent = s.title;
        ui.npArtist.textContent = s.loading ? (s.error || t('wgLoading')) : s.error || s.artist;
        ui.npAlbum.textContent = s.album;
        Icons.put(ui.npBtn.play, s.playing ? 'pause' : 'play');
        ui.npBtn.play.setAttribute('aria-label', t(s.playing ? 'wgPause' : 'wgPlay'));
        ui.npBtn.shuffle.classList.toggle('on', s.shuffle);
        ui.npBtn.shuffle.setAttribute('aria-pressed', s.shuffle ? 'true' : 'false');
        ui.npBtn.repeat.classList.toggle('on', s.repeat !== 'off');
        ui.npBtn.repeat.classList.toggle('one', s.repeat === 'one');
        ui.npBtn.repeat.setAttribute('aria-label', t('muRepeat') + ': ' + t('muRepeat_' + s.repeat));
        ui.np.classList.toggle('playing', s.playing);
        var qq = Music.queue(), nx = qq.order[qq.at + 1] !== undefined ? qq.list[qq.order[qq.at + 1]] : s.repeat === 'all' && qq.list.length > 1 ? qq.list[qq.order[0]] : null;
        ui.npNext.textContent = nx ? tf('muUpNext', title(nx) + (nx.a ? ' – ' + nx.a : '')) : '';
        var k = key(s.track);
        if (ui.npKey !== k) {
            ui.npKey = k;
            ui.npArt.innerHTML = ''; ui.npArt.classList.remove('has'); ui.npArt.appendChild(icon('music', 'mx-art-ic'));
            ui.np.style.removeProperty('--mx-tint');
            MusicSrc.art(s.track, function (v) {
                if (!npOpen || ui.npKey !== k || !v) return;
                var im = new Image(); im.alt = ''; im.src = v.url;
                ui.npArt.innerHTML = ''; ui.npArt.appendChild(im); ui.npArt.classList.add('has');
                if (v.color) ui.np.style.setProperty('--mx-tint', v.color);
            });
        }
        progress();
        ticking();
    }

    /* ---------------- drives come and go ---------------- */
    function refreshDrives(say) {
        MusicSrc.drives(function (e, l) {
            var before = drives.map(function (d) { return d.p; }).join('|');
            drives = l || [];
            if (!body) return;
            if (e && say) toast(errText(e), 'err');
            else if (say && !drives.length) toast(t('muNoDrive'), 'info');
            if (before !== drives.map(function (d) { return d.p; }).join('|')) {
                side();
                if (view && view.v === 'home') render();
                // the drive of the open folder was removed
                if (view && view.v === 'dir' && view.e.s === 'usb' && !drives.some(function (d) { return view.e.p.indexOf(d.p) === 0; })) { hist = []; go({ v: 'home' }, true); }
            }
        });
    }
    function onDrive(state) {
        if (!body) return;
        toast(t(state === 'MOUNTED' ? 'muDriveIn' : 'muDriveOut'), state === 'MOUNTED' ? 'ok' : 'info');
        setTimeout(refreshDrives, 600);
    }
    var watched = false;

    function changed(what) {
        if (!body) return;
        if (what === 'time') return;
        if (what === 'loaded') return progress();
        drawMini();
        if (npOpen) drawNp();
        if (view && view.v === 'queue' && (what === 'track' || what === 'queue') && !menu && !npOpen) render();
    }

    /* ---------------- keys ---------------- */
    function action(a, repeat) {
        if (Keyboard.isOpen()) return false;
        var cur = Focus.current();
        if (menu) {
            if (a === 'back' || a === 'cancel' || a === 'menu') { if (!repeat) closeMenu(); return true; }
            return false;
        }
        if (a === 'confirm' && !repeat && cur && cur.getAttribute('data-hold') && cur.getAttribute('data-hold') !== 'none') { holdStart(cur); return true; }
        if (a === 'menu' && !repeat) {
            if (cur && cur.getAttribute('data-hold') && cur.getAttribute('data-hold') !== 'none') openMenu(cur);
            else if (!npOpen) showNp();
            return true;
        }
        if (npOpen) {
            if (a === 'back' || a === 'cancel') { if (!repeat) hideNp(); return true; }
            if (cur === ui.npSeek && (a === 'left' || a === 'right')) {
                var d = (a === 'right') !== (document.documentElement.getAttribute('dir') === 'rtl') ? 1 : -1;
                Music.seekBy(d * (repeat ? 20 : 10));
                progress();
                return true;
            }
            if (a === 'pageUp') { if (!repeat) Music.prev(); return true; }
            if (a === 'pageDown') { if (!repeat) Music.next(); return true; }
            return false;
        }
        if (a === 'pageUp' || a === 'pageDown') {
            for (var i = 0; i < 6; i++) Focus.move(a === 'pageUp' ? 'up' : 'down');
            keepVisible(Focus.current());
            lazyArt();
            return true;
        }
        if (a === 'left' || a === 'right' || a === 'up' || a === 'down') {
            if (cur && cur._step && (a === 'left' || a === 'right')) { cur._step(a === 'right' ? 1 : -1); return true; }
            Focus.move(a);
            keepVisible(Focus.current());
            lazyArt();
            return true;
        }
        return false;
    }
    function release(a) { if (a === 'confirm') holdEnd(); }
    function back() {
        if (closeMenu()) return true;
        if (hideNp()) return true;
        if (view && view.v !== 'home') { if (!goBack()) go({ v: 'home' }, true); return true; }
        return false;
    }

    Win.register('music', {
        icon: 'music',
        title: function () { return t('music'); },
        open: function (b, arg) {
            body = b; ui = {}; hist = []; view = null; menu = null; npOpen = false; swallow = false;
            build();
            drives = [];
            locs = [];
            side();
            view = { v: 'home' };
            var first = render();
            Music.onChange(changed);
            if (!watched) { watched = true; MusicSrc.onDrives(onDrive); }
            refreshDrives();
            if (MusicSrc.locOk()) MusicSrc.locRoots(function (l) { if (!body) return; locs = l; side(); if (view.v === 'home') render(); });
            if (arg === 'np' || (arg === undefined && Music.state().playing)) setTimeout(function () { if (body) showNp(); }, 0);
            return first || ui.side.firstChild;
        },
        close: function () {
            clearTimeout(holdTimer); clearTimeout(artTimer); clearInterval(tick); tick = 0; holdTimer = 0;
            Music.offChange(changed);
            MusicSrc.cancel();
            gen++;
            body = null; ui = {}; view = null; items = []; hist = []; menu = null; npOpen = false;
        },
        action: action,
        release: release,
        back: back
    });
})();
