/* Runs one game at a time in a same-origin <iframe> and frees everything on exit.
 *
 * The game page (games/<id>/index.html) is fetched with XHR and written into an about:blank
 * iframe with a <base href> pointing at the game folder. The iframe document therefore has the
 * launcher's origin whether the files come from the package or from the hosted copy, so the
 * launcher can call window.GameAPI inside it and the game can reach the host object.
 *
 * Game contract (window.GameAPI in the iframe):
 *   init(host)  load assets, report host.progress(0..1), then call host.loaded() (or host.failed())
 *   start() pause() resume() destroy()
 *   menuItems() -> [{ id, label }]   optional extra pause-menu entries
 *   onMenu(id)  -> 'stay' keeps the pause menu open (toggles), anything else resumes
 *   onAction(action, pressed, repeat)  input from the launcher's single input module
 */
var GameHost = (function () {
    'use strict';

    var LOAD_TIMEOUT_MS = 20000, FILE_TIMEOUT_MS = 10000;

    var state = 'idle';         // idle | loading | running | paused | entry | error
    var game = null, base = '', triedBundled = false;
    var iframe = null, api = null, gameWin = null, loadTimer = 0, onExitCb = null;
    var pauseItems = [], loadSeq = 0;

    function $(id) { return document.getElementById(id); }

    // The TV screensaver watches the remote only: someone playing with a gamepad would see it
    // kick in. It is off while a game runs and back on when paused or in the menu.
    function screenSaver(on) {
        try {
            var S = webapis.appcommon.AppCommonScreenSaverState;
            webapis.appcommon.setScreenSaver(on ? S.SCREEN_SAVER_ON : S.SCREEN_SAVER_OFF, function () {}, function () {});
        } catch (e) {}
    }

    function abs(u) { var a = document.createElement('a'); a.href = u; return a.href; }

    function title() { return game ? I18n.pick(game.manifest.title) : ''; }

    /* ---------- host object given to the game ---------- */

    function makeHost() {
        var id = game.id;
        return {
            id: id,
            lang: I18n.lang(),
            profile: { id: Profiles.current().id, name: Profiles.name(null, I18n.t('player')) },
            rtl: I18n.rtl(),
            quality: Perf.profile(),
            volume: { music: AudioPrefs.music() / 10, sfx: AudioPrefs.sfx() / 10 },
            input: { isDown: Input.isDown, isDownDev: Input.isDownDev, poll: Input.poll, device: Input.device, lastDevice: Input.lastDevice },
            forwardKey: function (e, down) { Input.onKey(e, down); },
            announce: function (text) { A11y.announce(text); },
            save: function (k, v) { return Store.set('game_' + id + '_' + k, v); },
            load: function (k, def) { return Store.get('game_' + id + '_' + k, def); },
            progress: function (p) { $('game-loading-fill').style.width = Math.round(Math.max(0, Math.min(1, p)) * 100) + '%'; },
            loaded: onLoaded,
            failed: function (msg) { fail(msg || 'game reported failure'); },
            pause: function () { openPause(); },
            exitToMenu: function () { setTimeout(exit, 0); },
            // Top-10 tables: the game reports a final score; the launcher asks for initials if it qualifies.
            submitScore: function (score, opts) { submitScore(id, score, opts || {}); },
            topScores: function () { return Scores.list(id); }
        };
    }

    // Called by games/shared/gamekit.js once the game scripts have run.
    window.ArcadeHost = {
        attach: function (win) {
            if (state !== 'loading' || !iframe || win !== iframe.contentWindow) return;
            gameWin = win;
            api = win.GameAPI;
            if (!api || typeof api.init !== 'function') return fail('no GameAPI');
            try { api.init(makeHost()); } catch (e) { fail('init: ' + e); }
        },
        isLoading: function () { return state === 'loading'; }
    };

    /* ---------- loading ---------- */

    function showLoading() {
        $('game-loading-title').textContent = title();
        $('game-loading-fill').style.width = '0%';
        $('game-loading').hidden = false;
        $('game-error').hidden = true;
        $('pause').hidden = true;
    }

    /* ---------- installed apps (My PC SDK, sandboxed iframe on their own origin) ---------- */

    var SAVE_QUOTA = 64 * 1024;     // saved data per installed app

    function originOf(u) { var a = document.createElement('a'); a.href = u; return a.protocol + '//' + a.host; }

    // GameAPI-shaped proxy that talks to the app's My PC SDK with postMessage
    function remoteApi() {
        var id = game.id, origin = originOf(game.remote.entry), items = [], win = null;
        function send(type, d) { if (win) { try { win.postMessage({ mypc: 1, type: type, data: d === undefined ? null : d }, origin); } catch (e) {} } }
        function onMsg(e) {
            if (!iframe || e.source !== iframe.contentWindow) return;     // only our app's frame
            var m = e.data, d;
            if (!m || m.mypc !== 1 || typeof m.type !== 'string') return;
            d = m.data || {};
            switch (m.type) {
                case 'hello':
                    win = e.source;
                    send('init', {
                        lang: I18n.lang(), rtl: I18n.rtl(), quality: { tier: Perf.profile().tier },
                        volume: { music: AudioPrefs.music() / 10, sfx: AudioPrefs.sfx() / 10 },
                        profile: { id: Profiles.current().id, name: Profiles.name(null, I18n.t('player')) },
                        data: Store.get('game_' + id + '_data', {}), app: { id: id },
                        config: game.remote.config || {}
                    });
                    break;
                case 'progress': if (state === 'loading') $('game-loading-fill').style.width = Math.round(Math.max(0, Math.min(1, +d.p || 0)) * 100) + '%'; break;
                case 'ready': onLoaded(); break;
                case 'failed': fail('app: ' + d.reason); break;
                case 'menu':
                    items = [];
                    for (var i = 0; d.items && i < d.items.length && i < 6; i++) {
                        var it = d.items[i];
                        if (it && /^[a-z0-9_-]{1,24}$/i.test(it.id) && typeof it.label === 'string') items.push({ id: 'app:' + it.id, label: it.label.slice(0, 40) });
                    }
                    break;
                case 'save': {
                    var all = Store.get('game_' + id + '_data', {});
                    all[String(d.key)] = d.value;
                    if (JSON.stringify(all).length <= SAVE_QUOTA) Store.set('game_' + id + '_data', all);
                    break;
                }
                case 'score': if (state === 'running' || state === 'paused') submitScore(id, d.score, { player: d.player, players: d.players }); break;
                case 'announce': A11y.announce(String(d.text || '').slice(0, 200)); break;
                case 'pause': if (state === 'running') openPause(); break;
                case 'exit': setTimeout(exit, 0); break;
                // keys pressed while the frame has focus (mouse click on a PC): routed like our own
                case 'key': Input.onKey({ keyCode: +d.keyCode, repeat: !!d.repeat, preventDefault: function () {} }, !!d.down); break;
            }
        }
        window.addEventListener('message', onMsg);
        var volume = function (m, s2) { send('volume', { music: m, sfx: s2 }); };
        AudioPrefs.onChange(volume);
        return {
            init: function () {},
            start: function () { send('start'); },
            pause: function () { send('pause'); },
            resume: function () { send('resume'); },
            destroy: function () { send('destroy'); window.removeEventListener('message', onMsg); AudioPrefs.offChange(volume); win = null; },
            menuItems: function () { return items; },
            onMenu: function (mid) { send('menu', { id: String(mid).slice(4) }); },
            onAction: function (a, pressed, repeat, dev) { send('input', { action: a, pressed: pressed, repeat: repeat, dev: dev }); }
        };
    }

    function loadRemote(token) {
        // optional: the launcher refreshes the app's document first (its config) behind the loading screen
        if (game.remote.prepare) {
            return game.remote.prepare(function (ok) {
                if (state !== 'loading' || token !== loadSeq) return;       // cancelled or superseded
                if (ok === false) return exit();                            // uninstalled meanwhile
                openRemote();
            });
        }
        openRemote();
    }

    function openRemote() {
        removeFrame();
        iframe = document.createElement('iframe');
        iframe.setAttribute('tabindex', '-1');
        iframe.setAttribute('title', title());
        iframe.setAttribute('aria-hidden', 'true');
        iframe.setAttribute('scrolling', 'no');
        // its own origin: it cannot touch My PC's page, storage or navigation
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-pointer-lock');
        iframe.setAttribute('allow', 'autoplay; gamepad; fullscreen');
        iframe.setAttribute('referrerpolicy', 'no-referrer');
        api = remoteApi();
        iframe.src = game.remote.entry;
        $('game-frame-box').appendChild(iframe);
        $('game-layer').focus();
    }

    function load() {
        state = 'loading';
        showLoading();
        A11y.announce(I18n.t('loading') + ' ' + title());
        var dir = abs(base + 'games/' + game.id + '/');
        var entry = game.manifest.entry || 'index.html';
        var build = game.manifest.build || 0;
        clearTimeout(loadTimer);
        loadTimer = setTimeout(function () { fail('timeout'); }, LOAD_TIMEOUT_MS);
        var token = ++loadSeq;
        if (game.remote) return loadRemote(token);

        AppBoot.get(dir + entry + '?b=' + build, FILE_TIMEOUT_MS, function (err, html) {
            if (state !== 'loading' || token !== loadSeq) return;   // cancelled or superseded
            if (err || !html) return fail(entry + ' ' + err);
            html = html.replace(/<head([^>]*)>/i, '<head$1><base href="' + dir + '">');
            // cache-bust the game's own scripts with its build number
            html = html.replace(/(<script[^>]+src="[^"?]+\.js)"/gi, '$1?b=' + build + '"');
            removeFrame();
            iframe = document.createElement('iframe');
            iframe.setAttribute('tabindex', '-1');
            iframe.setAttribute('title', title());
            iframe.setAttribute('aria-hidden', 'true');     // canvas + HUD; status goes through the live region
            iframe.setAttribute('scrolling', 'no');
            $('game-frame-box').appendChild(iframe);
            try {
                var doc = iframe.contentWindow.document;
                doc.open();
                doc.write(html);
                doc.close();
            } catch (e) { fail('write: ' + e); }
            $('game-layer').focus();
        });
    }

    function onLoaded() {
        if (state !== 'loading') return;
        clearTimeout(loadTimer);
        $('game-loading').hidden = true;
        state = 'running';
        Input.setExternalPoll(!game.remote);    // an installed app cannot poll: the launcher reads the pads
        screenSaver(false);     // the game polls gamepads at the start of each frame
        screenSaver(false);
        $('game-layer').setAttribute('aria-label', title());
        $('game-layer').focus();
        try { api.start(); } catch (e) { fail('start: ' + e); }
    }

    function fail(reason) {
        if (state !== 'loading') { try { console.warn('[GameHost] ' + reason); } catch (e) {} return; }
        try { console.warn('[GameHost] ' + game.id + ' failed: ' + reason); } catch (e) {}
        clearTimeout(loadTimer);
        teardown();
        // A hosted game that fails falls back to the bundled copy of the same game, if any.
        if (!triedBundled && game.bundledBase && game.bundledBase !== base) {
            triedBundled = true;
            base = game.bundledBase;
            game.manifest = game.bundledManifest || game.manifest;
            return load();
        }
        state = 'error';
        $('game-loading').hidden = true;
        $('game-error').hidden = false;
        A11y.announce(I18n.t('loadError'));
        Focus.push($('game-error'), $('game-error-retry'));
    }

    /* ---------- pause menu ---------- */

    function renderPause(focusId) {
        var box = $('pause-items');
        box.innerHTML = '';
        pauseItems = [{ id: '_resume', label: I18n.t('resume') }];
        var extra = [];
        try { extra = (api && api.menuItems && api.menuItems()) || []; } catch (e) {}
        pauseItems = pauseItems.concat(extra);
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

    function openPause() {
        if (state !== 'running') return;
        state = 'paused';
        try { api.pause(); } catch (e) {}
        Input.releaseAll();
        Input.setExternalPoll(false);   // the game loop is stopped: the launcher reads the gamepads
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
        Input.setExternalPoll(!game.remote);
        screenSaver(false);
        $('game-layer').focus();
        try { api.resume(); } catch (e) {}
    }

    function pauseAction(id) {
        if (id === '_resume') return resume();
        if (id === '_quit') return exit();
        var r;
        try { r = api.onMenu(id); } catch (e) {}
        if (r === 'stay') {
            Focus.pop();
            var t = renderPause(id);
            Focus.push($('pause'), t);
            A11y.announce(t.textContent);
        } else resume();
    }

    /* ---------- exit ---------- */

    function removeFrame() {
        if (!iframe) return;
        try { iframe.src = 'about:blank'; } catch (e) {}
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        iframe = null;
    }

    function teardown() {
        if (api) { try { api.destroy(); } catch (e) {} }
        api = null;
        gameWin = null;
        removeFrame();
        Input.setExternalPoll(false);
        Input.releaseAll();
        screenSaver(true);
    }

    function exit() {
        if (state === 'idle') return;
        loadSeq++;
        clearTimeout(loadTimer);
        teardown();
        state = 'idle';
        entryQueue.length = 0; entryCur = null;
        $('entry').hidden = true;
        $('pause').hidden = true;
        $('game-error').hidden = true;
        $('game-loading').hidden = true;
        $('game-layer').hidden = true;
        var id = game && game.id;
        game = null;
        if (onExitCb) onExitCb(id);
    }

    function launch(g, onExit) {
        if (state !== 'idle') return;
        game = { id: g.id, manifest: g.manifest, bundledBase: g.bundledBase, bundledManifest: g.bundledManifest, remote: g.remote || null };
        base = g.base;
        triedBundled = base === g.bundledBase;
        onExitCb = onExit;
        $('game-layer').hidden = false;
        load();
    }

    function retry() {
        if (state !== 'error') return;
        $('game-error').hidden = true;
        Focus.pop();
        load();
    }

    /* ---------- top-10 initials entry ---------- */

    var CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    var entryQueue = [], entryCur = null, entryLetters = [];

    function submitScore(id, score, opts) {
        score = Math.floor(score) || 0;
        if (!Scores.qualifies(id, score)) return;
        entryQueue.push({ id: id, score: score, slot: opts.player || 1, multi: (opts.players || 1) > 1 });
        if (state === 'running') nextEntry();
    }

    function nextEntry() {
        entryCur = entryQueue.shift();
        if (!entryCur) return;
        state = 'entry';
        Input.releaseAll();
        var name = Scores.lastName(entryCur.slot), box = $('entry-letters');
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
        var name = entryLetters.join('');
        Scores.setLastName(entryCur.slot, name);
        var rank = Scores.add(entryCur.id, name, entryCur.score);
        $('entry').hidden = true;
        Focus.pop();
        Focus.reset();
        entryCur = null;
        A11y.announce(I18n.t('rank') + ' ' + rank);
        state = 'running';
        $('game-layer').focus();
        if (entryQueue.length) nextEntry();
    }

    /* ---------- input routing (called by the router in main.js) ---------- */

    function onAction(action, pressed, repeat, dev) {
        if (state === 'running') {
            if (pressed && !repeat && (action === 'back' || action === 'pause')) return openPause();
            if (action === 'padLost') { openPause(); A11y.announce(I18n.t('padOff')); return; }
            if (api && api.onAction) { try { api.onAction(action, pressed, repeat, dev); } catch (e) {} }
            return;
        }
        if (!pressed) return;
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
            if (action === 'back' || action === 'cancel') { if (!repeat) { Focus.pop(); exit(); } }
            else if (action === 'left' || action === 'right') Focus.move(action);
            else if (action === 'confirm' && !repeat) { var e = Focus.current(); if (e) e.click(); }
        } else if (state === 'loading') {
            if ((action === 'back' || action === 'cancel') && !repeat) exit();   // Back never does nothing
        }
    }

    function init() {
        $('game-error-retry').onclick = retry;
        $('game-error-back').onclick = function () { Focus.pop(); exit(); };
        $('entry-ok').onclick = saveEntry;
    }

    return {
        init: init, launch: launch, exit: exit, onAction: onAction, openPause: openPause,
        active: function () { return state !== 'idle'; },
        state: function () { return state; },
        frame: function () { return iframe; }
    };
})();
