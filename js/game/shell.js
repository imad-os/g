/* game.html: runs ONE game and nothing else (the home page, its covers and its code are not loaded).
 *
 *   home -> game.html?id=<gameId>&profile=<profileId>   (location.replace: no history growth)
 *   game -> index.html?from=<gameId>                    ("Quit to menu": this whole document is discarded)
 *
 * First-party games: their files (listed in game-manifest.json) are downloaded with a byte-weighted progress
 * bar and run directly in this page, no iframe. Remote games run in one sandboxed iframe (js/game/remote.js).
 * This page owns Back, the pause menu, the network popup, the initials entry and the profile picker, so a game
 * cannot break the certification rules.
 *
 * Game contract (window.GameAPI, registered with Arcade.define, see sdk/arcade-sdk.js and docs/game-sdk.md):
 *   init(host) start() pause() resume() destroy() resize(vp) menuItems() onMenu(id) onAction(a, pressed, repeat, dev)
 */
var GameShell = (function () {
    'use strict';

    var LOAD_PHASE = 0.8, DECODE_PHASE = 0.85;
    var STALL_MS = 20000, SILENT_MS = 1500;
    try { STALL_MS = +sessionStorage.getItem('arc_stall_ms') || STALL_MS; } catch (e) {}   // tests shorten the 20 s timeout

    var state = 'loading';       // loading | running | paused | entry | picker | error | leaving
    var desc = null, manifest = null, api = null, vp = null, leaving = false;
    var remote = false, remoteItems = [], assets = {}, assetUrls = [], dirUrl = '';
    var loader = null, stallTimer = 0, silentTimer = 0, stage = false, p2 = null, afterPicker = null;
    var pauseItems = [];

    function $(id) { return document.getElementById(id); }
    function abs(u) { var a = document.createElement('a'); a.href = u; return a.href; }
    function query(k) { var m = new RegExp('[?&]' + k + '=([^&]*)').exec(location.search); return m ? decodeURIComponent(m[1]) : ''; }
    function title() { return desc ? I18n.pick(desc.title) || desc.id : ''; }

    // The TV screensaver watches the remote only: it is off while a game runs, back on when paused.
    function screenSaver(on) {
        try {
            var S = webapis.appcommon.AppCommonScreenSaverState;
            webapis.appcommon.setScreenSaver(on ? S.SCREEN_SAVER_ON : S.SCREEN_SAVER_OFF, function () {}, function () {});
        } catch (e) {}
    }

    function profileInfo(p) { return { id: p.id, name: Profiles.name(p, I18n.t('player'), I18n.t('guest')), guest: !!p.guest }; }

    /* ---------- the host object a game gets (also the data of the SDK `init` message) ---------- */

    function makeHost() {
        var id = desc.id;
        return {
            id: id, sdk: 1,
            lang: I18n.lang(),
            rtl: I18n.rtl(),
            profile: profileInfo(Profiles.current()),
            quality: Perf.profile(),
            volume: { music: AudioPrefs.music() / 10, sfx: AudioPrefs.sfx() / 10 },
            viewport: vp,
            device: Input.device(),
            input: { isDown: Input.isDown, isDownDev: Input.isDownDev, poll: Input.poll, device: Input.device, lastDevice: Input.lastDevice },
            forwardKey: function () {},      // this page's own key listeners (Input) already see every key
            announce: function (text) { A11y.announce(text); },
            save: function (k, v) { return GameData.set(id, k, v); },
            load: function (k, def) { return GameData.get(id, k, def); },
            loadAsync: function (k, cb) { var v = GameData.get(id, k, undefined); setTimeout(function () { cb(v); }, 0); },
            progress: gameProgress,
            loaded: onLoaded,
            failed: function (msg) { fail(msg || 'game reported failure'); },
            pause: function () { openPause(); },
            exitToMenu: function () { setTimeout(function () { exit(false); }, 0); },
            submitScore: function (score, o) { submitScore(id, score, o || {}); },
            topScores: function () { return Scores.list(id); },
            pickProfile: pickProfile,
            stageLoading: stageLoading,
            stageLoaded: stageLoaded
        };
    }

    // What first-party game scripts reach through the SDK (Arcade.define / Arcade.url / Arcade.asset / Arcade.root)
    window.ArcadeHost = {
        attach: function (gameApi) {
            if (state !== 'loading' || remote) return;
            api = gameApi;
            if (!api || typeof api.init !== 'function') return fail('no GameAPI');
            LoadBar.set(DECODE_PHASE);
            try { api.init(makeHost()); } catch (e) { fail('init: ' + e); }
        },
        baseUrl: function () { return dirUrl; },
        asset: function (p) { return assets[p]; },
        root: function () { return $('game-root'); }
    };

    /* ---------- progress ---------- */

    function gameProgress(p) {
        if (stage) LoadBar.set(p);
        else if (state === 'loading') LoadBar.phase(remote ? 0 : DECODE_PHASE, 1)(p);
    }

    // Big games load later parts per stage behind the same loading screen.
    function stageLoading(t) {
        if (state !== 'running') return;
        stage = true;
        LoadBar.start(t || title(), true);
    }
    function stageLoaded() {
        if (!stage) return;
        stage = false;
        LoadBar.hide();
    }

    function armStall() {
        clearTimeout(stallTimer);
        stallTimer = setTimeout(function () { fail('timeout'); }, STALL_MS);
    }

    /* ---------- loading: first-party game ---------- */

    function loadDirect() {
        var base = desc.base;
        dirUrl = abs(base + 'games/' + desc.id + '/');
        armStall();
        AppBoot.get(dirUrl + 'game-manifest.json?b=' + AppBoot.build(), 10000, function (err, text) {
            if (state !== 'loading') return;
            var m = null;
            try { m = JSON.parse(text); } catch (e) {}
            if (err || !m || m.id !== desc.id) return fail('manifest ' + err);
            manifest = m;
            var sizes = m.sizes || {}, files = [], entry = m.entry || 'index.html', i;
            function add(path) { files.push({ path: path, size: sizes[path] || 0 }); }
            add(entry);
            for (i = 0; i < (m.styles || []).length; i++) add(m.styles[i]);
            for (i = 0; i < (m.scripts || []).length; i++) add(m.scripts[i]);
            for (i = 0; i < (m.assets || []).length; i++) add(m.assets[i]);
            LoadBar.set(0.01);
            loader = GameLoader.run({ files: files, base: dirUrl, build: m.build || 0, onProgress: function (p) { armStall(); LoadBar.phase(0, LOAD_PHASE)(p); } }, function (err2, results) {
                loader = null;
                if (state !== 'loading') return;
                if (err2) return fail('download ' + err2);
                LoadBar.set(LOAD_PHASE);
                GameLoader.decode(results, files, LoadBar.phase(LOAD_PHASE, DECODE_PHASE), function (decoded, urls) {
                    assets = decoded;
                    assetUrls = urls;
                    if (state !== 'loading') return;
                    runGame(results, entry);
                });
            });
        });
    }

    // DOM of the game's own page into #game-root, then its scripts in order.
    function runGame(results, entry) {
        var doc = document.implementation.createHTMLDocument(''), i, node, s;
        doc.documentElement.innerHTML = results[entry];
        var root = $('game-root'), cls = (doc.body.getAttribute('class') || '').replace(/(^|\s)arc-stage(\s|$)/, ' ');
        root.className = 'arc-stage ' + cls;
        var heads = doc.head.querySelectorAll('style');
        for (i = 0; i < heads.length; i++) document.head.appendChild(document.importNode(heads[i], true));
        for (i = 0; i < (manifest.styles || []).length; i++) {
            s = document.createElement('style');
            s.textContent = results[manifest.styles[i]];
            document.head.appendChild(s);
        }
        for (node = doc.body.firstChild; node; node = node.nextSibling) {
            if (node.nodeType === 1 && node.tagName.toLowerCase() === 'script') continue;
            root.appendChild(document.importNode(node, true));
        }
        Input.setExternalPoll(true);        // the game polls the gamepads at the start of each frame
        window.addEventListener('error', onGameError);
        var scripts = manifest.scripts || [];
        for (i = 0; i < scripts.length && state === 'loading'; i++) {
            s = document.createElement('script');
            s.text = results[scripts[i]] + '\n//# sourceURL=' + abs(dirUrl + scripts[i]);
            document.head.appendChild(s);
            document.head.removeChild(s);
        }
        if (state === 'loading' && !api) fail('no GameAPI');
    }

    function onGameError(e) {
        if (state === 'loading') fail(String(e && e.message));
    }

    /* ---------- loading: remote game ---------- */

    function loadRemote() {
        remote = true;
        Input.setExternalPoll(false);       // the hub reads the gamepads and forwards the actions
        armStall();
        silentTimer = setTimeout(function () { if (state === 'loading' && LoadBar.value() < 0.02) LoadBar.setIndeterminate(true); }, SILENT_MS);
        RemoteGame.open(desc.url, title(), onRemote);
    }

    function onRemote(type, d, id) {
        if (state === 'leaving') return;
        armStall();
        var gid = desc.id;
        switch (type) {
            case 'hello':
                var h = makeHost();
                RemoteGame.send('init', {
                    lang: h.lang, rtl: h.rtl, profile: h.profile, quality: h.quality, volume: h.volume, viewport: vp, device: h.device,
                    saves: GameData.all(gid), topScores: Scores.list(gid)
                });
                break;
            case 'progress': if (state === 'loading' || stage) gameProgress(+d.value || 0); break;
            case 'loaded': onLoaded(); break;
            case 'failed': fail(d.reason || 'game reported failure'); break;
            case 'menuItems':
                remoteItems = d.items || [];
                if (state === 'paused') { var t = renderPause(); Focus.set($('pause'), t); }
                break;
            case 'menuResult':
                if (state === 'paused' && !d.stay) resume();
                break;
            case 'submitScore': submitScore(gid, +d.score || 0, { player: d.player, players: d.players }); break;
            case 'save': GameData.set(gid, String(d.key), d.value); break;
            case 'load': RemoteGame.send('reply', { value: GameData.get(gid, String(d.key), undefined) }, id); break;
            case 'announce': A11y.announce(String(d.text || '')); break;
            case 'exit': setTimeout(function () { exit(false); }, 0); break;
            case 'requestPause': openPause(); break;
            case 'key': Input.onKey({ keyCode: d.keyCode, repeat: !!d.repeat, preventDefault: function () {} }, !!d.down); break;
            case 'pickProfile': pickProfile(d.slot, function (info) { RemoteGame.send('reply', { value: info }, id); }); break;
            case 'stageLoading': stageLoading(d.title); break;
            case 'stageLoaded': stageLoaded(); break;
        }
    }

    /* ---------- loaded / failed ---------- */

    function onLoaded() {
        if (state !== 'loading') return;
        clearTimeout(stallTimer); clearTimeout(silentTimer);
        window.removeEventListener('error', onGameError);
        LoadBar.done();
        state = 'running';
        screenSaver(false);
        $('stage').setAttribute('aria-label', title());
        $('stage').focus();
        if (remote) RemoteGame.send('start'); else { try { api.start(); } catch (e) { fail('start: ' + e); } }
    }

    function fail(reason) {
        if (state !== 'loading') { try { console.warn('[GameShell] ' + reason); } catch (e) {} return; }
        try { console.warn('[GameShell] ' + desc.id + ' failed: ' + reason); } catch (e) {}
        clearTimeout(stallTimer); clearTimeout(silentTimer);
        window.removeEventListener('error', onGameError);
        if (loader) { loader.abort(); loader = null; }
        // A hosted game that fails falls back to the bundled copy of the same game, if there is one.
        if (!remote && desc.bundledBase && desc.bundledBase !== desc.base && !desc.triedBundled) {
            desc.base = desc.bundledBase;
            desc.triedBundled = true;
            try { sessionStorage.setItem('arc_launch', JSON.stringify(desc)); } catch (e2) {}
            return location.reload();           // a clean page: no half-run scripts of the failed copy
        }
        state = 'error';
        if (remote) RemoteGame.close();
        LoadBar.hide();
        $('game-error').hidden = false;
        A11y.announce(I18n.t('loadError'));
        Focus.push($('game-error'), $('game-error-retry'));
    }

    /* ---------- pause menu ---------- */

    function gameItems() {
        if (remote) return remoteItems;
        var extra = [];
        try { extra = (api && api.menuItems && api.menuItems()) || []; } catch (e) {}
        return extra;
    }

    function renderPause(focusId) {
        var box = $('pause-items');
        box.innerHTML = '';
        pauseItems = [{ id: '_resume', label: I18n.t('resume') }].concat(gameItems());
        pauseItems.push({ id: '_switch', label: I18n.t('switchProfileItem') });
        pauseItems.push({ id: '_quit', label: I18n.t('quitToMenu') });
        var target = null;
        for (var i = 0; i < pauseItems.length; i++) {
            var b = document.createElement('button');
            b.className = 'btn' + (i === 0 ? ' btn-primary' : '');
            b.setAttribute('data-focus', '');
            b.textContent = pauseItems[i].label;
            b.onclick = (function (it) { return function () { pauseAction(it.id); }; })(pauseItems[i]);
            box.appendChild(b);
            if (pauseItems[i].id === focusId) target = b;
        }
        return target || box.firstChild;
    }

    function pauseGame() {
        if (remote) RemoteGame.send('pause'); else { try { api.pause(); } catch (e) {} }
        Input.releaseAll();
        Input.setExternalPoll(false);       // the game loop is stopped: the hub reads the gamepads
    }
    function resumeGame() {
        Input.setExternalPoll(!remote);
        if (remote) RemoteGame.send('resume'); else { try { api.resume(); } catch (e) {} }
    }

    function openPause() {
        if (state !== 'running') return;
        state = 'paused';
        pauseGame();
        screenSaver(true);
        var first = renderPause();
        $('pause').hidden = false;
        Focus.push($('pause'), first);
        A11y.announce(I18n.t('paused'));
    }

    function resume() {
        if (state !== 'paused') return;
        $('pause').hidden = true;
        Focus.pop();
        Focus.reset();
        state = 'running';
        screenSaver(false);
        $('stage').focus();
        resumeGame();
    }

    function pauseAction(id) {
        if (id === '_resume') return resume();
        if (id === '_quit') return exit(false);
        if (id === '_switch') { Profiles.clearDefault(); return exit(true); }
        if (remote) { RemoteGame.send('menu', { id: id }); return; }     // answer: menuItems + menuResult
        var r;
        try { r = api.onMenu(id); } catch (e) {}
        if (r === 'stay') {
            Focus.pop();
            var t = renderPause(id);
            Focus.push($('pause'), t);
            A11y.announce(t.textContent);
        } else resume();
    }

    /* ---------- exit: the whole document is discarded by the navigation ---------- */

    function homeUrl(pick) {
        return (AppBoot.localBase() || '') + 'index.html?from=' + encodeURIComponent(desc ? desc.id : '') + (pick ? '&pick=1' : '');
    }

    function exit(pick) {
        if (leaving) return;
        leaving = true;
        var prev = state;
        state = 'leaving';
        clearTimeout(stallTimer); clearTimeout(silentTimer);
        if (loader) { loader.abort(); loader = null; }
        Input.releaseAll();
        screenSaver(true);
        function go() { location.replace(homeUrl(pick)); }
        if (remote) return RemoteGame.close(go);
        if (api && prev !== 'loading') { try { api.destroy(); } catch (e) {} }
        else if (api) { try { api.destroy(); } catch (e2) {} }
        api = null;
        go();
    }

    /* ---------- scores: a named profile is credited directly, a guest enters arcade initials ---------- */

    var CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    var entryQueue = [], entryCur = null, entryLetters = [];

    function profileForSlot(slot) { return slot > 1 ? (p2 || Profiles.GUEST) : Profiles.current(); }

    function submitScore(id, score, o) {
        score = Math.floor(score) || 0;
        var slot = o.player || 1, prof = profileForSlot(slot);
        var ok = Store.withProfile(prof.id, function () { return Scores.qualifies(id, score); });
        if (!ok) return;
        if (!prof.guest) {
            var rank = Store.withProfile(prof.id, function () { return Scores.add(id, Profiles.name(prof, I18n.t('player')), score); });
            Net.toast(Profiles.name(prof, I18n.t('player')) + ' · ' + I18n.t('newHigh') + ' ' + I18n.t('rank') + ' ' + rank);
            return;
        }
        entryQueue.push({ id: id, score: score, slot: slot, multi: (o.players || 1) > 1, profile: prof.id });
        if (state === 'running') nextEntry();
    }

    function nextEntry() {
        entryCur = entryQueue.shift();
        if (!entryCur) return;
        state = 'entry';
        Input.releaseAll();
        var name = Store.withProfile(entryCur.profile, function () { return Scores.lastName(entryCur.slot); }), box = $('entry-letters');
        box.innerHTML = '';
        entryLetters = [];
        for (var i = 0; i < 3; i++) {
            var b = document.createElement('button');
            b.className = 'btn';
            b.setAttribute('data-focus', '');
            b.setAttribute('data-idx', i);
            entryLetters.push(name.charAt(i) || 'A');
            b.onclick = (function (k) { return function () { Focus.focus(k < 2 ? box.childNodes[k + 1] : $('entry-ok')); }; })(i);
            box.appendChild(b);
        }
        drawLetters();
        var who = entryCur.multi || entryCur.slot > 1 ? I18n.t('player') + ' ' + entryCur.slot + ': ' : '';
        $('entry-title').textContent = who + I18n.t('newHigh');
        $('entry-score').textContent = entryCur.score + ' ' + I18n.t('points');
        I18n.apply($('entry'));
        $('entry').hidden = false;
        Focus.push($('entry'), box.firstChild);
        A11y.announce(who + I18n.t('newHigh') + ' ' + entryCur.score + ' ' + I18n.t('points') + '. ' + I18n.t('entryHint'));
    }

    function drawLetters() {
        var box = $('entry-letters');
        for (var i = 0; i < 3; i++) {
            box.childNodes[i].textContent = entryLetters[i];
            box.childNodes[i].setAttribute('aria-label', I18n.t('letter') + ' ' + (i + 1) + ' ' + I18n.t('of') + ' 3: ' + entryLetters[i]);
        }
    }

    function changeLetter(d) {
        var c = Focus.current(), i = c ? +c.getAttribute('data-idx') : NaN;
        if (isNaN(i) || c.getAttribute('data-idx') === null) return;
        var k = (CHARS.indexOf(entryLetters[i]) + d + CHARS.length) % CHARS.length;
        entryLetters[i] = CHARS.charAt(k);
        drawLetters();
        A11y.announce(entryLetters[i]);
    }

    function saveEntry() {
        if (state !== 'entry' || !entryCur) return;
        var name = entryLetters.join(''), cur = entryCur;
        var rank = Store.withProfile(cur.profile, function () { Scores.setLastName(cur.slot, name); return Scores.add(cur.id, name, cur.score); });
        $('entry').hidden = true;
        Focus.pop();
        Focus.reset();
        entryCur = null;
        A11y.announce(I18n.t('rank') + ' ' + rank);
        state = 'running';
        $('stage').focus();
        if (entryQueue.length) nextEntry();
    }

    /* ---------- player 2 chooses a profile ---------- */

    function pickProfile(slot, cb) {
        function done(id) {
            p2 = Profiles.find(id) || Profiles.GUEST;
            if (state === 'picker') { state = 'running'; resumeGame(); $('stage').focus(); }
            cb(profileInfo(p2));
        }
        if (state !== 'running') return cb(profileInfo(Profiles.GUEST));
        state = 'picker';
        pauseGame();
        Picker.show({
            title: I18n.t('player') + ' ' + slot + ': ' + I18n.t('whoPlays'),
            preselect: Store.GUEST, showDefault: false,
            onPick: function (id) { done(id); },
            onCancel: function () { done(Store.GUEST); }
        });
    }

    /* ---------- input routing: the only place that handles Back ---------- */

    function onAction(action, pressed, repeat, dev) {
        if (action === 'padConnected') { Net.toast(I18n.t('padOn')); return; }
        if (state === 'running') {
            if (pressed && !repeat && (action === 'back' || action === 'pause')) return openPause();
            if (action === 'padLost') { openPause(); A11y.announce(I18n.t('padOff')); return; }
            if (remote) RemoteGame.send('input', { action: action, pressed: pressed, repeat: repeat, dev: dev });
            else if (api && api.onAction) { try { api.onAction(action, pressed, repeat, dev); } catch (e) {} }
            return;
        }
        if (!pressed) return;
        if (state === 'picker') return Picker.action(action, repeat);
        if (state === 'paused') {
            if (action === 'back' || action === 'cancel' || action === 'pause') { if (!repeat) resume(); }
            else if (action === 'up' || action === 'down') Focus.move(action);
            else if (action === 'confirm' && !repeat) { var c = Focus.current(); if (c) c.click(); }
        } else if (state === 'entry') {
            if ((action === 'back' || action === 'cancel') && !repeat) saveEntry();
            else if (action === 'up' || action === 'down') changeLetter(action === 'up' ? 1 : -1);
            else if (action === 'left' || action === 'right') Focus.move(action);
            else if (action === 'confirm' && !repeat) { var f = Focus.current(); if (f) f.click(); }
        } else if (state === 'error') {
            if (action === 'back' || action === 'cancel') { if (!repeat) { Focus.pop(); exit(false); } }
            else if (action === 'left' || action === 'right') Focus.move(action);
            else if (action === 'confirm' && !repeat) { var e = Focus.current(); if (e) e.click(); }
        } else if (state === 'loading') {
            if ((action === 'back' || action === 'cancel') && !repeat) exit(false);   // Back never does nothing
        }
    }

    function onResize() {
        vp = Net.fit($('stage'));
        if (state === 'loading' || state === 'leaving') return;
        if (remote) RemoteGame.send('resize', vp);
        else if (api && api.resize) { try { api.resize(vp); } catch (e) {} }
    }

    /* ---------- start ---------- */

    function start() {
        var id = query('id'), prof = query('profile');
        try { desc = JSON.parse(sessionStorage.getItem('arc_launch')); } catch (e) { desc = null; }
        if (!desc || desc.id !== id) {
            // Opened directly (reload, bookmark): the bundled copy of a first-party game
            desc = { id: id, base: AppBoot.base() || AppBoot.localBase(), bundledBase: AppBoot.base() ? AppBoot.localBase() : null, title: { en: id } };
        }
        if (prof && Profiles.find(prof)) Store.setProfile(prof);

        $('stage').setAttribute('tabindex', '-1');
        vp = Net.fit($('stage'));
        I18n.apply();
        A11y.init();
        LoadBar.init();
        Picker.init();
        if (Perf.profile().tier !== 'low') document.documentElement.className += ' hi';
        Input.init();
        Input.setHandler(onAction);
        Net.watch();
        window.addEventListener('resize', onResize);
        $('game-error-retry').onclick = function () { location.reload(); };
        $('game-error-back').onclick = function () { Focus.pop(); exit(false); };
        $('entry-ok').onclick = saveEntry;

        // Multitasking: pause the game (and its audio) when the app goes to the background.
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) {
                Input.releaseAll();
                if (state === 'running') openPause();
            }
        });

        LoadBar.start(title());
        AppBoot.ready();
        if (desc.remote) loadRemote(); else loadDirect();
    }

    return {
        start: start, state: function () { return state; }, exit: exit, openPause: openPause,
        descriptor: function () { return desc; }, isRemote: function () { return remote; },
        api: function () { return api; }
    };
})();

GameShell.start();
