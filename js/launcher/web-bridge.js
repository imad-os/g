/* Web pages driven by the remote and the controller (the Browser app, owner request 2026-11-13).
 *
 * A web page in a normal frame belongs to its site: My PC can not move the focus in it, click in it, or even see the remote's
 * keys once it has the focus, and many sites (YouTube, Facebook...) refuse frames at all. So My PC reads the page ITSELF and
 * shows that copy, with a small script of its own added (BRIDGE below):
 *  - on the TV My PC is a packaged app (WARP <access origin="*">): its requests have no CORS limit, no server is used;
 *  - in a browser / the phone app a site that allows no CORS answers nothing; only then, and only if the App Store Manager set
 *    one (Settings > Web relay, `settings/mypc.webRelay`), the request goes again through that relay (a Cloudflare Worker,
 *    tools/web-relay-worker.js). No relay: the Browser shows the site in a plain frame as before.
 * The copy runs in a sandboxed frame with NO same-origin (an opaque origin): the site's scripts can never read My PC's storage.
 * The script inside answers postMessage: arrows move a focus ring between links / buttons / fields (scrolling when needed), OK
 * clicks, a text field asks My PC's keyboard, links and forms come back to My PC (history, bookmarks), keys typed while the
 * page has the focus (a mouse click) come back too, so Back always works.
 *
 *   WebBridge.fetch(url, { method, body }, cb)  cb(err, { url, html } | { url, plain: true })   err: 'network' | 'too-big' | 'timeout'
 *   WebBridge.page(html, url)                   -> the srcdoc text (the page + <base> + the script)
 */
var WebBridge = (function () {
    'use strict';

    var TIMEOUT = 20000, MAX = 6 * 1024 * 1024;
    var tv = function () { return !!(window.tizen && window.tizen.application); };

    function relay() {
        var r = typeof GlobalSettings !== 'undefined' && GlobalSettings.webRelay ? GlobalSettings.webRelay() : '';
        return /^https:\/\/[^\s"'<>]+$/.test(r) ? r : '';
    }

    function charsetOf(type, bytes) {
        var m = /charset=["']?([\w-]+)/i.exec(type || '');
        if (m) return m[1];
        var head = '';
        try { head = new TextDecoder('latin1').decode(bytes.subarray(0, 2048)); } catch (e) {}
        m = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head);
        return m ? m[1] : 'utf-8';
    }

    function get(url, opts, viaRelay, cb) {
        var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null, done = false;
        var timer = setTimeout(function () { if (done) return; done = true; if (ctl) ctl.abort(); cb('timeout'); }, TIMEOUT);
        var init = { method: opts.method || 'GET', redirect: 'follow', credentials: !viaRelay && tv() ? 'include' : 'omit' };
        if (opts.body) { init.body = opts.body; init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' }; }
        if (ctl) init.signal = ctl.signal;
        var target = viaRelay ? viaRelay + (viaRelay.indexOf('?') < 0 ? '?' : '&') + 'url=' + encodeURIComponent(url) : url;
        fetch(target, init).then(function (res) {
            var type = res.headers.get('content-type') || '', final = (viaRelay ? res.headers.get('x-final-url') : res.url) || url;
            if (!/html|xml/i.test(type) && type) { done = true; clearTimeout(timer); cb(null, { url: final, plain: true }); return null; }
            if (+(res.headers.get('content-length') || 0) > MAX) throw new Error('too-big');
            return res.arrayBuffer().then(function (buf) {
                if (done) return;
                done = true; clearTimeout(timer);
                if (buf.byteLength > MAX) return cb('too-big');
                var bytes = new Uint8Array(buf), text;
                try { text = new TextDecoder(charsetOf(type, bytes)).decode(bytes); } catch (e) { text = new TextDecoder('utf-8').decode(bytes); }
                cb(null, { url: final, html: text, status: res.status });
            });
        }).catch(function (e) {
            if (done) return;
            done = true; clearTimeout(timer);
            cb(e && e.message === 'too-big' ? 'too-big' : 'network');
        });
    }

    // straight first; a page that answers nothing (CORS in a browser) once more through the relay, if one is set
    function fetchPage(url, opts, cb) {
        opts = opts || {};
        get(url, opts, '', function (err, r) {
            var rl = relay();
            if (err !== 'network' || !rl || tv()) return cb(err, r);
            get(url, opts, rl, function (e2, r2) { if (r2) r2.relay = true; cb(e2, r2); });
        });
    }

    /* ---------------- the script inside the page (runs in the site's copy; ES5, no outside names) ---------------- */
    function BRIDGE() {
        var cur = null, SEL = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[tabindex]:not([tabindex="-1"]),[role=button],[role=link],[role=tab],[role=menuitem],[onclick]';
        var TEXT = /^(text|search|email|url|tel|password|number)$/i;
        function send(o) { o.mypcweb = 1; try { parent.postMessage(o, '*'); } catch (e) {} }
        var st = document.createElement('style');
        st.textContent = '.__mypc_f{outline:4px solid #4cc2ff !important;outline-offset:2px !important;box-shadow:0 0 0 7px rgba(76,194,255,.35) !important;border-radius:4px}';
        (document.head || document.documentElement).appendChild(st);

        function box(e) {
            if (e.disabled || e.closest('[aria-hidden="true"],[inert]')) return null;
            var r = e.getBoundingClientRect();
            if (r.width < 4 || r.height < 4) return null;
            var cs = getComputedStyle(e);
            if (cs.visibility === 'hidden' || cs.opacity === '0') return null;
            return r;
        }
        function all() {
            var l = document.querySelectorAll(SEL), out = [];
            for (var i = 0; i < l.length; i++) {
                var e = l[i];
                if (e.parentElement && e.parentElement.closest('a[href],button')) continue;     // the link, not the picture inside it
                var r = box(e);
                if (r) out.push({ e: e, r: r });
            }
            return out;
        }
        function label(e) { return (e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent || e.value || e.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim().slice(0, 120); }
        function setCur(e, noScroll) {
            if (cur) cur.classList.remove('__mypc_f');
            cur = e;
            if (!e) return;
            e.classList.add('__mypc_f');
            if (!noScroll) {
                var r = e.getBoundingClientRect(), h = innerHeight;
                if (r.top < 40 || r.bottom > h - 40) window.scrollBy(0, Math.round(r.top - h * 0.35));
            }
            send({ t: 'focus', label: label(e) });
        }
        function visibleFirst(dir) {
            var l = all(), best = null, h = innerHeight;
            for (var i = 0; i < l.length; i++) {
                var r = l[i].r;
                if (r.bottom < 0 || r.top > h) continue;
                if (!best || (dir < 0 ? r.top > best.r.top : r.top < best.r.top || (r.top === best.r.top && r.left < best.r.left))) best = l[i];
            }
            return best && best.e;
        }
        function move(d) {
            var h = innerHeight, vert = d === 'up' || d === 'down';
            if (!cur || !document.contains(cur) || !box(cur)) {
                var f = visibleFirst(d === 'up' ? -1 : 1);
                if (f) return setCur(f, true);
                if (vert) window.scrollBy(0, (d === 'down' ? 1 : -1) * Math.round(h * 0.6));
                return;
            }
            var c = cur.getBoundingClientRect(), cx = (c.left + c.right) / 2, cy = (c.top + c.bottom) / 2, l = all(), best = null, bs = 1e12;
            for (var i = 0; i < l.length; i++) {
                var e = l[i].e, r = l[i].r;
                if (e === cur || cur.contains(e) || e.contains(cur)) continue;
                var along, cross;
                if (d === 'down') { if (r.top < c.bottom - 4) continue; along = r.top - c.bottom; cross = Math.max(0, r.left - c.right, c.left - r.right); }
                else if (d === 'up') { if (r.bottom > c.top + 4) continue; along = c.top - r.bottom; cross = Math.max(0, r.left - c.right, c.left - r.right); }
                else if (d === 'right') { if (r.left < c.right - 4) continue; along = r.left - c.right; cross = Math.max(0, r.top - c.bottom, c.top - r.bottom); }
                else { if (r.right > c.left + 4) continue; along = c.left - r.right; cross = Math.max(0, r.top - c.bottom, c.top - r.bottom); }
                if (!vert && cross > 0) continue;                         // left / right stay on the same line
                var s = Math.max(0, along) + cross * (vert ? 3 : 1) + Math.abs(vert ? (r.left + r.right) / 2 - cx : (r.top + r.bottom) / 2 - cy) * 0.05;
                if (s < bs) { bs = s; best = l[i]; }
            }
            if (vert && (!best || bs > h * 0.75)) {                       // nothing near: scroll, the next press picks from what shows
                window.scrollBy(0, (d === 'down' ? 1 : -1) * Math.round(h * 0.6));
                if (cur && box(cur)) { var cr = cur.getBoundingClientRect(); if (cr.bottom < 0 || cr.top > h) setCur(null); }
                return;
            }
            if (best) setCur(best.e);
        }
        function ok() {
            if (!cur || !document.contains(cur)) { var f = visibleFirst(1); if (f) setCur(f, true); return; }
            var tag = cur.tagName;
            if (tag === 'TEXTAREA' || (tag === 'INPUT' && TEXT.test(cur.type || 'text')) || cur.isContentEditable) {
                send({ t: 'text', value: cur.value || '', type: (cur.type || 'text').toLowerCase(), label: cur.getAttribute('placeholder') || cur.getAttribute('aria-label') || cur.name || '', multi: tag === 'TEXTAREA' });
                return;
            }
            if (tag === 'SELECT') {
                var o = [];
                for (var i = 0; i < cur.options.length; i++) o.push(cur.options[i].text);
                send({ t: 'select', options: o, index: cur.selectedIndex, label: label(cur) });
                return;
            }
            cur.click();
        }
        function fire(e, type) { var ev = document.createEvent('HTMLEvents'); ev.initEvent(type, true, true); e.dispatchEvent(ev); }
        window.addEventListener('message', function (ev) {
            var m = ev.data;
            if (ev.source !== parent || !m || m.mypcweb !== 1) return;
            if (m.k === 'up' || m.k === 'down' || m.k === 'left' || m.k === 'right') move(m.k);
            else if (m.k === 'ok') ok();
            else if (m.k === 'pageDown' || m.k === 'pageUp') { window.scrollBy(0, (m.k === 'pageDown' ? 1 : -1) * Math.round(innerHeight * 0.85)); setCur(visibleFirst(1), true); }
            else if (m.set !== undefined && cur) {
                cur.focus();
                if (cur.isContentEditable) cur.textContent = m.set; else cur.value = m.set;
                fire(cur, 'input'); fire(cur, 'change');
                if (m.submit) {
                    if (cur.form) { if (cur.form.requestSubmit) cur.form.requestSubmit(); else fire(cur.form, 'submit'); }
                    else ['keydown', 'keypress', 'keyup'].forEach(function (t) { cur.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })); });
                }
            } else if (m.sel !== undefined && cur && cur.tagName === 'SELECT') { cur.selectedIndex = m.sel; fire(cur, 'input'); fire(cur, 'change'); }
        });
        // links and forms come back to My PC: it reads the next page the same way (history, bookmarks)
        document.addEventListener('click', function (e) {
            if (e.defaultPrevented || e.button) return;
            var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
            if (!a) return;
            var raw = a.getAttribute('href') || '';
            if (/^javascript:/i.test(raw)) return;
            e.preventDefault();
            if (raw.charAt(0) === '#') { var t = raw.length > 1 && document.getElementById(decodeURIComponent(raw.slice(1))); if (t) t.scrollIntoView(); return; }
            if (/^https?:/i.test(a.href)) send({ t: 'nav', url: a.href });
        });
        window.addEventListener('submit', function (e) {             // after the site's own handlers: one that handles it itself wins
            if (e.defaultPrevented) return;
            var f = e.target, s = e.submitter, method = (f.getAttribute('method') || 'get').toLowerCase();
            e.preventDefault();
            var data = new FormData(f), parts = [];
            if (s && s.name) data.append(s.name, s.value || '');
            data.forEach(function (v, k) { if (typeof v === 'string') parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v)); });
            var q = parts.join('&').replace(/%20/g, '+'), action = f.action || document.baseURI;
            if (method === 'post') send({ t: 'post', url: action, body: q });
            else send({ t: 'nav', url: action.split('#')[0].split('?')[0] + '?' + q });
        });
        // keys typed while the page itself has the focus (after a mouse click) go back to My PC, except into a field
        function key(e, down) {
            var a = document.activeElement, typing = a && (a.tagName === 'TEXTAREA' || a.isContentEditable || (a.tagName === 'INPUT' && TEXT.test(a.type || 'text')));
            if (typing && e.keyCode !== 10009 && e.keyCode !== 27) return;
            e.preventDefault();
            send({ t: 'key', code: e.keyCode, down: down, repeat: !!e.repeat });
        }
        document.addEventListener('keydown', function (e) { key(e, true); }, true);
        document.addEventListener('keyup', function (e) { key(e, false); }, true);
        function ready() { send({ t: 'ready', title: document.title || '' }); }
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
    }

    // the copy shown in the frame: <base> so the site's own files load from the site, then My PC's script
    function page(html, url) {
        var inject = '<base href="' + String(url).replace(/"/g, '&quot;') + '"><script>(' + BRIDGE.toString() + ')();<\/script>';
        var m = /<head[^>]*>/i.exec(html);
        if (m) return html.slice(0, m.index + m[0].length) + inject + html.slice(m.index + m[0].length);
        m = /<html[^>]*>/i.exec(html);
        if (m) return html.slice(0, m.index + m[0].length) + '<head>' + inject + '</head>' + html.slice(m.index + m[0].length);
        return '<!doctype html><head>' + inject + '</head>' + html;
    }

    return { fetch: fetchPage, page: page, relay: relay };
})();
