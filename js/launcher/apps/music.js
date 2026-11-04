/* Music: a placeholder app (owner request 2026-11-04, the real one comes later). It shows the made-up tracks of
 * js/core/music.js with Previous / Play-Pause / Next; the Music Player widget on the desktop uses the same player.
 * It plays no sound yet. While it is open the screen ticks once a second (only while it plays). */
(function () {
    'use strict';

    var root = null, timer = 0, now = null, bar = null, time = null, list = null, btns = {};

    function t(k) { return I18n.t(k); }
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

    function draw() {
        if (!root) return;
        var s = Music.state();
        now.querySelector('.mu-title').textContent = s.title;
        now.querySelector('.mu-artist').textContent = s.artist;
        bar.style.width = Math.round(s.pos * 100 / s.dur) + '%';
        time.textContent = Music.clock(s.pos) + ' / ' + Music.clock(s.dur);
        Icons.put(btns.toggle, s.playing ? 'pause' : 'play');
        btns.toggle.setAttribute('aria-label', t(s.playing ? 'wgPause' : 'wgPlay'));
        var items = list.children;
        for (var i = 0; i < items.length; i++) items[i].className = 'mu-track' + (i === s.index ? ' on' : '');
        clearTimeout(timer);
        if (s.playing) timer = setTimeout(draw, 1000);
    }

    function button(id, icon, label, fn) {
        var b = el('button', 'mu-btn' + (id === 'toggle' ? ' mu-main' : ''));
        b.setAttribute('data-focus', '');
        b.setAttribute('aria-label', label);
        Icons.put(b, icon);
        b.onclick = function () { fn(); A11y.announce(Music.state().title); };
        btns[id] = b;
        return b;
    }

    Win.register('music', {
        icon: 'music',
        title: function () { return t('music'); },
        open: function (body) {
            root = el('div', 'mu');
            now = el('div', 'mu-now');
            var art = el('div', 'mu-art'); Icons.put(art, 'music');
            now.appendChild(art);
            var info = el('div', 'mu-info');
            info.appendChild(el('div', 'mu-title'));
            info.appendChild(el('div', 'mu-artist'));
            var pb = el('div', 'wdg-bar mu-bar'); bar = el('i'); pb.appendChild(bar);
            info.appendChild(pb);
            time = el('div', 'mu-time');
            info.appendChild(time);
            var ctl = el('div', 'mu-ctl');
            ctl.appendChild(button('prev', 'prev', t('wgPrev'), Music.prev));
            ctl.appendChild(button('toggle', 'play', t('wgPlay'), Music.toggle));
            ctl.appendChild(button('next', 'next', t('wgNext'), Music.next));
            info.appendChild(ctl);
            now.appendChild(info);
            root.appendChild(now);
            root.appendChild(el('p', 'mu-note', t('musicNote')));
            list = el('div', 'mu-list');
            Music.TRACKS.forEach(function (tr, i) {
                var b = el('button', 'mu-track');
                b.setAttribute('data-focus', '');
                b.appendChild(el('span', 'mu-n', String(i + 1)));
                b.appendChild(el('span', 'mu-tt', tr.title));
                b.appendChild(el('span', 'mu-ta', tr.artist));
                b.appendChild(el('span', 'mu-td', Music.clock(tr.dur)));
                b.setAttribute('aria-label', tr.title + ', ' + tr.artist);
                b.onclick = function () { Music.pick(i); };
                list.appendChild(b);
            });
            root.appendChild(list);
            body.appendChild(root);
            Music.onChange(draw);
            draw();
            return btns.toggle;
        },
        close: function () { clearTimeout(timer); timer = 0; Music.offChange(draw); root = now = bar = time = list = null; btns = {}; }
    });
})();
