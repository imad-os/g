/* Main menu (game grid), settings and text pages. */
var Menu = (function () {
    'use strict';

    var games = [];             // [{ id, manifest, base, bundledBase }]
    var grid, onPlay;
    var lastPlayed = Store.get('last_game', null);

    function $(id) { return document.getElementById(id); }

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }

    function badgeFor(g) {
        var seen = Store.get('seen_builds', {});
        if (seen[g.id] === undefined) return 'new';
        if (g.manifest.build > seen[g.id]) return 'upd';
        return '';
    }

    function markSeen(g) {
        var seen = Store.get('seen_builds', {});
        seen[g.id] = g.manifest.build;
        Store.set('seen_builds', seen);
    }

    function render() {
        grid.innerHTML = '';
        for (var i = 0; i < games.length; i++) {
            var g = games[i], m = g.manifest;
            var title = I18n.pick(m.title), desc = I18n.pick(m.description), badge = badgeFor(g);
            var b = el('button', 'tile');
            b.setAttribute('data-focus', '');
            b.setAttribute('data-game', g.id);
            b.setAttribute('role', 'listitem');
            var label = title + '. ' + desc;
            if (badge) label += '. ' + I18n.t(badge === 'new' ? 'badgeNew' : 'badgeUpdated');
            if (g.id === lastPlayed) label += '. ' + I18n.t('lastPlayed');
            b.setAttribute('aria-label', label);
            var imgBox = el('span', 'tile-img');
            var img = document.createElement('img');
            img.alt = '';
            img.setAttribute('data-src', g.base + 'games/' + g.id + '/' + (m.cover || 'cover.png'));
            img.src = img.getAttribute('data-src');
            // hide a broken cover, but not the "error" of releaseImages() clearing it while a game runs
            img.onerror = function () { if (this.getAttribute('src')) this.style.visibility = 'hidden'; };
            img.onload = function () { this.style.visibility = ''; };
            imgBox.appendChild(img);
            b.appendChild(imgBox);
            var tx = el('span', 'tile-text');
            tx.appendChild(el('span', 'tile-title', title));
            tx.appendChild(el('span', 'tile-desc', desc));
            b.appendChild(tx);
            if (badge) b.appendChild(el('span', 'badge' + (badge === 'upd' ? ' badge-upd' : ''), I18n.t(badge === 'new' ? 'badgeNew' : 'badgeUpdated')));
            b.onclick = (function (game) { return function () { play(game); }; })(g);
            grid.appendChild(b);
        }
    }

    function play(g) {
        lastPlayed = g.id;
        Store.set('last_game', g.id);
        markSeen(g);
        onPlay(g);
    }

    // another profile is active: its own last game, "new" badges and scores
    function profileChanged() {
        lastPlayed = Store.get('last_game', null);
        render();
    }

    function tileFor(id) { return grid.querySelector('[data-game="' + id + '"]'); }

    function show() {
        $('menu').hidden = false;
        restoreImages();
        Focus.reset();
        Focus.set($('menu'), tileFor(lastPlayed) || grid.firstChild);
    }

    function hide() { $('menu').hidden = true; }

    // Frees decoded cover images while a game runs (RAM on low-end TVs).
    function releaseImages() {
        var imgs = grid.querySelectorAll('img');
        // removeAttribute, not src = '': an empty src fires "error", which used to hide the cover for good
        for (var i = 0; i < imgs.length; i++) imgs[i].removeAttribute('src');
    }
    function restoreImages() {
        var imgs = grid.querySelectorAll('img');
        for (var i = 0; i < imgs.length; i++) {
            if (imgs[i].getAttribute('src')) continue;
            imgs[i].style.visibility = '';
            imgs[i].src = imgs[i].getAttribute('data-src');
        }
    }

    function confirmFocused() {
        var c = Focus.current();
        if (c) c.click();
    }

    /* ---------------- settings ---------------- */

    var GFX = ['auto', 'low', 'mid', 'high'];
    var GFX_KEYS = { auto: 'gfxAuto', low: 'gfxLow', mid: 'gfxMid', high: 'gfxHigh' };

    function volBar(v) {
        return '<span class="vol" aria-hidden="true"><span class="vol-fill" style="width:' + (v * 10) + '%;display:block"></span></span>' + v;
    }

    function settingsRows() {
        return [
            { id: 'lang', label: I18n.t('language'), value: I18n.NAMES[I18n.lang()], adjust: function (d) {
                var l = I18n.LANGS, i = (l.indexOf(I18n.lang()) + d + l.length) % l.length;
                I18n.setLang(l[i]); render(); App.refresh();
            } },
            { id: 'music', label: I18n.t('musicVol'), html: volBar(AudioPrefs.music()), value: String(AudioPrefs.music()),
              adjust: function (d) { AudioPrefs.setMusic(AudioPrefs.music() + d); } },
            { id: 'sfx', label: I18n.t('sfxVol'), html: volBar(AudioPrefs.sfx()), value: String(AudioPrefs.sfx()),
              adjust: function (d) { AudioPrefs.setSfx(AudioPrefs.sfx() + d); } },
            { id: 'gfx', label: I18n.t('graphics'), value: I18n.t(GFX_KEYS[Perf.setting()]), adjust: function (d) {
                var i = (GFX.indexOf(Perf.setting()) + d + GFX.length) % GFX.length;
                Perf.setSetting(GFX[i]);
            } },
            { id: 'controls', label: I18n.t('controls'), action: function () { showPage('controls'); } },
            { id: 'reset', label: I18n.t('resetProgress'), action: function () {
                App.confirm(I18n.t('resetTitle'), I18n.t('resetText'), function () {
                    Store.clearPrefix('game_');
                    App.toast(I18n.t('resetDone'));
                });
            } },
            { id: 'privacy', label: I18n.t('privacy'), action: function () { showPage('privacy'); } },
            { id: 'about', label: I18n.t('about'), action: function () { showPage('about'); } },
            { id: 'close', label: I18n.t('close'), action: closeSettings }
        ];
    }

    var rows = [];

    function renderSettings(focusId) {
        var list = $('settings-list');
        list.innerHTML = '';
        rows = settingsRows();
        var target = null;
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            var b = el('button', 'row');
            b.setAttribute('data-focus', '');
            b.setAttribute('data-row', r.id);
            var name = el('span', 'row-name', r.label);
            b.appendChild(name);
            if (r.adjust) {
                var v = el('span', 'row-value');
                v.innerHTML = '<span class="arrows">&#9664;</span> ' + (r.html || '') + ' <span class="arrows">&#9654;</span>';
                if (!r.html) v.insertBefore(document.createTextNode(r.value), v.lastChild);
                b.appendChild(v);
                b.setAttribute('aria-label', r.label + ': ' + r.value + '. ' + I18n.t('adjustHint'));
            }
            b.onclick = (function (row) { return function () { if (row.action) row.action(); else adjust(row, 1); }; })(r);
            list.appendChild(b);
            if (r.id === focusId) target = b;
        }
        I18n.apply($('settings'));
        return target;
    }

    function adjust(row, d) {
        row.adjust(d);
        var t = renderSettings(row.id);
        Focus.set($('settings'), t);
        // Re-read the new value: focus did not move so Voice Guide would not repeat it.
        for (var i = 0; i < rows.length; i++) if (rows[i].id === row.id) A11y.announce(rows[i].value);
    }

    function openSettings() {
        $('settings').hidden = false;
        $('menu').hidden = true;
        var first = renderSettings('lang');
        Focus.push($('settings'), first);
    }

    function closeSettings() {
        $('settings').hidden = true;
        $('menu').hidden = false;
        render();
        Focus.pop();
        Focus.set($('menu'), $('btn-settings'));
    }

    // left/right on an adjustable settings row; returns true when consumed
    function settingsAdjust(dir) {
        var c = Focus.current();
        if (!c || !c.getAttribute('data-row')) return false;
        var id = c.getAttribute('data-row');
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].id === id && rows[i].adjust) {
                var d = dir === 'right' ? 1 : -1;
                if (I18n.rtl()) d = -d;
                adjust(rows[i], d);
                return true;
            }
        }
        return false;
    }

    /* ---------------- top scores ---------------- */

    function renderScores() {
        var box = $('scores-grid');
        box.innerHTML = '';
        box.setAttribute('role', 'list');
        var first = null;
        for (var i = 0; i < games.length; i++) {
            var g = games[i], title = I18n.pick(g.manifest.title), list = Scores.list(g.id);
            if (g.manifest.scores === false) continue;       // e.g. Parchís: a winner, no points
            // a focusable div (a <button> would centre the list vertically)
            var col = el('div', 'score-col');
            col.setAttribute('data-focus', '');
            col.setAttribute('tabindex', '0');
            col.setAttribute('role', 'listitem');
            col.appendChild(el('h3', '', title));
            var spoken = [title + ', ' + I18n.t('scores')];
            if (!list.length) { col.appendChild(el('div', 'score-empty', I18n.t('noScores'))); spoken.push(I18n.t('noScores')); }
            for (var k = 0; k < list.length; k++) {
                var row = el('div', 'score-row');
                row.appendChild(el('span', 'r', (k + 1) + '.'));
                row.appendChild(el('span', 'n', list[k].n));
                row.appendChild(el('span', 's', String(list[k].s)));
                col.appendChild(row);
                spoken.push((k + 1) + ': ' + list[k].n + ', ' + list[k].s + ' ' + I18n.t('points'));
            }
            col.setAttribute('aria-label', spoken.join('. '));
            box.appendChild(col);
            if (!first) first = col;
        }
        return first;
    }

    function openScores() {
        $('menu').hidden = true;
        $('scores').hidden = false;
        var first = renderScores();
        I18n.apply($('scores'));
        Focus.push($('scores'), first);
    }

    function closeScores() {
        $('scores').hidden = true;
        $('menu').hidden = false;
        Focus.pop();
        Focus.set($('menu'), $('btn-scores'));
    }

    /* ---------------- text pages ---------------- */

    var pageReturn = null;

    function showPage(kind) {
        var body = $('page-body'), lines, i, title;
        body.innerHTML = '';
        if (kind === 'about') {
            title = I18n.t('about');
            var src = AppBoot.source() === 'remote';
            lines = [
                [I18n.t('version'), AppBoot.version()],
                [I18n.t('build'), String(AppBoot.build())],
                [I18n.t('online'), I18n.t(src ? 'onlineYes' : 'onlineNo')],
                [I18n.t('device'), Perf.describe()]
            ];
            for (i = 0; i < lines.length; i++) {
                var p = el('p');
                p.appendChild(document.createTextNode(lines[i][0] + ': '));
                p.appendChild(el('span', 'kv', lines[i][1]));
                body.appendChild(p);
            }
        } else {
            title = I18n.t(kind === 'controls' ? 'controls' : 'privacy');
            lines = I18n.t(kind === 'controls' ? 'controlsText' : 'privacyText');
            for (i = 0; i < lines.length; i++) body.appendChild(el('p', '', lines[i]));
        }
        $('page-title').textContent = title;
        // The text is part of the dialog label so Voice Guide reads it when the page opens.
        $('page').setAttribute('aria-describedby', 'page-body');
        pageReturn = Focus.current();
        $('page').hidden = false;
        $('settings').hidden = true;
        I18n.apply($('page'));
        Focus.push($('page'), $('page-close'));
    }

    function closePage() {
        $('page').hidden = true;
        $('settings').hidden = false;
        Focus.pop();
        if (pageReturn) Focus.focus(pageReturn);
    }

    function init(list, playCb) {
        games = list;
        onPlay = playCb;
        grid = $('game-grid');
        render();
        $('btn-settings').onclick = openSettings;
        $('btn-scores').onclick = openScores;
        $('scores-close').onclick = closeScores;
        $('page-close').onclick = closePage;
    }

    return {
        init: init, show: show, hide: hide, render: render, releaseImages: releaseImages,
        confirmFocused: confirmFocused, openSettings: openSettings, closeSettings: closeSettings,
        settingsAdjust: settingsAdjust, profileChanged: profileChanged, closePage: closePage, openScores: openScores, closeScores: closeScores, tileFor: tileFor,
        games: function () { return games; }
    };
})();
