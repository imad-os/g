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

    var state = 'idle';         // idle | loading | running | paused | error
    var game = null, base = '', triedBundled = false;
    var iframe = null, api = null, gameWin = null, loadTimer = 0, onExitCb = null;
    var pauseItems = [];

    function $(id) { return document.getElementById(id); }

    function abs(u) { var a = document.createElement('a'); a.href = u; return a.href; }

    function title() { return game ? I18n.pick(game.manifest.title) : ''; }

    /* ---------- host object given to the game ---------- */

    function makeHost() {
        var id = game.id;
        return {
            id: id,
            lang: I18n.lang(),
            rtl: I18n.rtl(),
            quality: Perf.profile(),
            volume: { music: AudioPrefs.music() / 10, sfx: AudioPrefs.sfx() / 10 },
            input: { isDown: Input.isDown, poll: Input.poll, device: Input.device },
            forwardKey: function (e, down) { Input.onKey(e, down); },
            announce: function (text) { A11y.announce(text); },
            save: function (k, v) { return Store.set('game_' + id + '_' + k, v); },
            load: function (k, def) { return Store.get('game_' + id + '_' + k, def); },
            progress: function (p) { $('game-loading-fill').style.width = Math.round(Math.max(0, Math.min(1, p)) * 100) + '%'; },
            loaded: onLoaded,
            failed: function (msg) { fail(msg || 'game reported failure'); },
            pause: function () { openPause(); },
            exitToMenu: function () { setTimeout(exit, 0); }
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

    function load() {
        state = 'loading';
        showLoading();
        A11y.announce(I18n.t('loading') + ' ' + title());
        var dir = abs(base + 'games/' + game.id + '/');
        var entry = game.manifest.entry || 'index.html';
        var build = game.manifest.build || 0;
        clearTimeout(loadTimer);
        loadTimer = setTimeout(function () { fail('timeout'); }, LOAD_TIMEOUT_MS);

        AppBoot.get(dir + entry + '?b=' + build, FILE_TIMEOUT_MS, function (err, html) {
            if (state !== 'loading') return;
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
        Input.setExternalPoll(true);     // the game polls gamepads at the start of each frame
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
    }

    function exit() {
        if (state === 'idle') return;
        clearTimeout(loadTimer);
        teardown();
        state = 'idle';
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
        game = { id: g.id, manifest: g.manifest, bundledBase: g.bundledBase, bundledManifest: g.bundledManifest };
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

    /* ---------- input routing (called by the router in main.js) ---------- */

    function onAction(action, pressed, repeat) {
        if (state === 'running') {
            if (pressed && !repeat && (action === 'back' || action === 'pause')) return openPause();
            if (action === 'padLost') { openPause(); A11y.announce(I18n.t('padOff')); return; }
            if (api && api.onAction) { try { api.onAction(action, pressed, repeat); } catch (e) {} }
            return;
        }
        if (!pressed) return;
        if (state === 'paused') {
            if (action === 'back' || action === 'cancel' || action === 'pause') { if (!repeat) resume(); }
            else if (action === 'up' || action === 'down') Focus.move(action);
            else if (action === 'confirm' && !repeat) { var c = Focus.current(); if (c) c.click(); }
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
    }

    return {
        init: init, launch: launch, exit: exit, onAction: onAction, openPause: openPause,
        active: function () { return state !== 'idle'; },
        state: function () { return state; },
        frame: function () { return iframe; }
    };
})();
