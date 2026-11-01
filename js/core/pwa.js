/* Installable web app + the screen rotation chosen on phones (js/core/rotation.js: landscape at first).
   - Chrome installs the site as an app (manifest.webmanifest + sw.js); the manifest asks for landscape.
   - In a normal browser tab the orientation is locked when Chrome allows it (full screen after the first touch);
     where it cannot be locked (iOS, desktop windows resized) a "turn your phone" cover shows when the phone is held the
     other way than a held side (Landscape, Portrait, Manual). Auto never shows it. The Android app turns natively. */
var PWA = (function () {
    'use strict';
    var T = {
        en: 'Turn your phone sideways', fr: 'Tournez votre téléphone sur le côté',
        es: 'Gira el teléfono de lado', ar: 'أدر هاتفك إلى الوضع الأفقي'
    }, U = {
        en: 'Turn your phone upright', fr: 'Tenez votre téléphone droit',
        es: 'Pon el teléfono en vertical', ar: 'أدر هاتفك إلى الوضع العمودي'
    };
    var cover = null;

    function phone() {
        try { return window.matchMedia('(pointer:coarse)').matches && !window.tizen && Math.min(screen.width, screen.height) < 700; }
        catch (e) { return false; }
    }
    function standalone() {
        try { return window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true; }
        catch (e) { return false; }
    }
    function lock() {
        if (window.Rotation) { Rotation.apply(); return; }  // the side chosen in Control Panel > Display (js/core/rotation.js)
        try {
            var o = screen.orientation;
            if (o && o.lock) { var p = o.lock('landscape'); if (p && p.catch) p.catch(function () {}); }
        } catch (e) {}
    }
    function portrait() { return window.innerHeight > window.innerWidth; }

    function lang() {
        var l = 'en';
        try { l = (window.I18n && I18n.lang && I18n.lang()) || (navigator.language || 'en').slice(0, 2); } catch (e) {}
        return T[l] ? l : 'en';
    }
    // w: what js/core/rotation.js wants ('any' | 'landscape' | 'portrait'); it passes it while it is still loading
    function update(w) {
        if (typeof w !== 'string') w = window.Rotation ? Rotation.want() : 'landscape';
        if (!phone() || window.MyPCNative || w === 'any') { if (cover) cover.hidden = true; return; }
        if (!cover) {
            cover = document.createElement('div');
            cover.id = 'turn-cover';
            cover.setAttribute('role', 'alert');
            cover.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:100000;background:#000;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;font:600 18px/1.3 system-ui,sans-serif;text-align:center;padding:24px';
            cover.innerHTML = '<svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="#5fd0ff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2" width="10" height="20" rx="2"><animateTransform attributeName="transform" type="rotate" values="0 12 12;-90 12 12;-90 12 12;0 12 12" keyTimes="0;.4;.8;1" dur="2.4s" repeatCount="indefinite"/></rect></svg><div></div>';
            document.body.appendChild(cover);
            cover.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
        }
        cover.lastChild.textContent = (w === 'portrait' ? U : T)[lang()];
        cover.firstChild.style.transform = w === 'portrait' ? 'rotate(90deg)' : '';
        cover.hidden = portrait() === (w === 'portrait');
    }
    function onFirstTouch() {
        document.removeEventListener('touchend', onFirstTouch, true);
        if (!phone() || standalone()) return;
        try {
            var el = document.documentElement;
            var f = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : null;
            if (f && f.then) f.then(lock, function () {}); else lock();
        } catch (e) {}
    }

    function init() {
        if (!/^https?:$/.test(location.protocol) || window.tizen) return;
        if (!document.querySelector('link[rel=manifest]')) {
            var l = document.createElement('link'); l.rel = 'manifest'; l.href = 'manifest.webmanifest';
            document.head.appendChild(l);
        }
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
        }
        if (phone()) {
            lock();
            document.addEventListener('touchend', onFirstTouch, true);
            window.addEventListener('resize', update);
            window.addEventListener('orientationchange', update);
            update();
        }
    }
    init();
    return { update: update, phone: phone };
}());
