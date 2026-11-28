/* My PC - the page of an app installed on a USB drive (owner report 2026-11-28, build 196).
 *
 * imad's TV (build 194 / 195): Tangier TAXI's installed copy never started. The TV's web engine does not run a page
 * opened straight from the drive (file:///opt/media/USBDrive.../index.html in a frame): no script of it ever ran,
 * so the SDK never said hello. So My PC no longer opens file:// pages: it READS the app's files from the drive itself
 * (AppUsb.readFile, the Tizen filesystem API, which works: the copy was installed with it) and builds the page:
 *   - the entry page, its own <script src> files and stylesheets put inline (url() in a stylesheet and <img src> become
 *     data: addresses), My PC's current SDK in place of the copy's;
 *   - a <base> on an address that does not exist (https://mypc-usb.invalid/...), so the app's relative paths stay paths;
 *   - first of all a small script (PRELUDE below) that serves the app's own files while it runs: fetch(), the src of
 *     <img> / <audio> / <video> / <source> / <script>, new Audio(url) and audioWorklet.addModule, each read
 *     through My PC ('usbfile' messages, answered by game-host.js) and handed to the page as blob: addresses; and a memory
 *     localStorage (the frame has no origin of its own: keep saves in MyPC.save).
 * The frame gets srcdoc with sandbox allow-scripts only (no origin: it can never reach My PC's storage).
 *
 * UsbPage.build(copy, cb(err, html))   copy = AppUsb.find(...) { dir, entry, ... }
 * UsbPage.ROOT                         the made-up address the page's own files live under
 */
var UsbPage = (function () {
    'use strict';

    var ROOT = 'https://mypc-usb.invalid/';
    var SDK_MS = 3000, sdkText = '';

    function err(code, message) { return { code: code, message: message || code }; }
    function dec(buf) { try { return new TextDecoder('utf-8').decode(new Uint8Array(buf)); } catch (e) { return ''; } }
    function b64(buf) {
        var u8 = new Uint8Array(buf), s = '', i;
        for (i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768));
        return btoa(s);
    }
    var MIME = { js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
                 webp: 'image/webp', ico: 'image/x-icon', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav' };
    function mimeOf(p) { return MIME[(/\.([a-z0-9]+)$/i.exec(p) || [0, ''])[1].toLowerCase()] || 'application/octet-stream'; }
    // a path of the page (relative to the folder of `from`) -> the path inside the copy; null = not one of the app's own files
    function resolve(from, ref) {
        ref = String(ref || '').trim();
        if (!ref || /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref)) return null;
        ref = ref.replace(/[?#].*$/, '');
        try { ref = decodeURIComponent(ref); } catch (e) {}
        var parts = ref.charAt(0) === '/' ? [] : String(from).split('/').slice(0, -1), segs = ref.split('/'), i;
        for (i = 0; i < segs.length; i++) {
            if (!segs[i] || segs[i] === '.') continue;
            if (segs[i] === '..') { if (!parts.length) return null; parts.pop(); } else parts.push(segs[i]);
        }
        return parts.join('/') || null;
    }
    function attr(tag, name) {
        var m = new RegExp('\\s' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i').exec(tag);
        return m ? (m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]) : null;
    }

    /* the script that runs first in the page (turned into text with toString: ES5, nothing from outside) */
    function PRELUDE(ROOT, BASE) {
        var W = window, reqs = {}, rid = 0, cache = {};
        function memStorage() {
            var d = {};
            return { getItem: function (k) { k = String(k); return Object.prototype.hasOwnProperty.call(d, k) ? d[k] : null; }, setItem: function (k, v) { d[String(k)] = String(v); },
                     removeItem: function (k) { delete d[String(k)]; }, clear: function () { d = {}; }, key: function (i) { return Object.keys(d)[i] || null; },
                     get length() { return Object.keys(d).length; } };
        }
        ['localStorage', 'sessionStorage'].forEach(function (n) {
            try { W[n].getItem('mypc'); } catch (e) { try { Object.defineProperty(W, n, { value: memStorage(), configurable: true }); } catch (x) {} }
        });
        W.MYPC_USB = { root: ROOT, base: BASE, shim: 1 };
        W.addEventListener('message', function (e) {
            var m = e.data, d = m && m.data;
            if (!m || m.mypc !== 1 || m.type !== 'usbfile' || !d || !reqs['p' + d.rid]) return;
            var f = reqs['p' + d.rid]; delete reqs['p' + d.rid]; f(d);
        });
        // the app's own file -> { b: ArrayBuffer, s: 200 | 404 } read by My PC from the drive
        function read(rel) {
            return new Promise(function (ok, no) {
                var id = 1e6 + (++rid), t = setTimeout(function () { delete reqs['p' + id]; no(new TypeError('Failed to fetch')); }, 30000);
                reqs['p' + id] = function (d) { clearTimeout(t); if (d.b) ok({ b: d.b, s: 200 }); else if (d.error === 'missing') ok({ b: null, s: 404 }); else no(new TypeError('Failed to fetch')); };
                try { W.parent.postMessage({ mypc: 1, type: 'usbfile', data: { rid: id, p: rel } }, '*'); } catch (e) { no(e); }
            });
        }
        function relOf(url) {
            var abs = '';
            try { abs = new URL(String(url), document.baseURI || BASE).href; } catch (e) { return null; }
            if (abs.indexOf(ROOT) !== 0) return null;
            var rel = abs.slice(ROOT.length).replace(/[?#].*$/, '');
            try { rel = decodeURIComponent(rel); } catch (e2) {}
            return rel;
        }
        var TYPES = { js: 'text/javascript', mjs: 'text/javascript', json: 'application/json', css: 'text/css', html: 'text/html', svg: 'image/svg+xml', png: 'image/png',
                      jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4',
                      mp4: 'video/mp4', webm: 'video/webm', wasm: 'application/wasm', glb: 'model/gltf-binary', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf' };
        function typeOf(rel) { return TYPES[(/\.([a-z0-9]+)$/i.exec(rel) || [0, ''])[1].toLowerCase()] || 'application/octet-stream'; }
        // the app's own file as a blob: address of this page (kept: the same file is read once)
        function blobUrl(rel) {
            if (!cache[rel]) cache[rel] = read(rel).then(function (r) {
                if (!r.b) throw new Error('missing ' + rel);
                return URL.createObjectURL(new Blob([r.b], { type: typeOf(rel) }));
            });
            return cache[rel];
        }
        var nativeFetch = W.fetch;
        if (typeof nativeFetch === 'function') {
            W.fetch = function (input, init) {
                var url = typeof input === 'string' ? input : input && input.url, rel = relOf(url);
                if (rel === null || (init && init.method && !/^(GET|HEAD)$/i.test(init.method))) return nativeFetch.apply(W, arguments);
                return read(rel).then(function (r) {
                    return new Response(r.b, { status: r.s, statusText: r.s === 200 ? 'OK' : 'Not Found', headers: { 'Content-Type': typeOf(rel) } });
                });
            };
        }
        // src / href of elements: the app's own files become blob: addresses
        function hook(proto, prop) {
            var d = proto && Object.getOwnPropertyDescriptor(proto, prop);
            if (!d || !d.set) return;
            Object.defineProperty(proto, prop, { configurable: true, enumerable: d.enumerable, get: d.get, set: function (v) {
                var el = this, rel = relOf(v);
                if (rel === null) return d.set.call(el, v);
                el.__mypcSrc = v;
                blobUrl(rel).then(function (u) { if (el.__mypcSrc === v) d.set.call(el, u); }, function () { if (el.__mypcSrc === v) { try { el.dispatchEvent(new Event('error')); } catch (e) {} } });
            } });
        }
        hook(W.HTMLImageElement && HTMLImageElement.prototype, 'src');
        hook(W.HTMLMediaElement && HTMLMediaElement.prototype, 'src');
        hook(W.HTMLSourceElement && HTMLSourceElement.prototype, 'src');
        hook(W.HTMLScriptElement && HTMLScriptElement.prototype, 'src');
        hook(W.HTMLLinkElement && HTMLLinkElement.prototype, 'href');
        var setAttr = Element.prototype.setAttribute;
        Element.prototype.setAttribute = function (n, v) {
            var k = String(n).toLowerCase();
            if ((k === 'src' && /^(IMG|AUDIO|VIDEO|SOURCE|SCRIPT)$/.test(this.tagName)) || (k === 'href' && this.tagName === 'LINK')) {
                if (relOf(v) !== null) { this[k] = v; return; }
            }
            return setAttr.apply(this, arguments);
        };
        if (W.Audio) {
            var A = W.Audio;
            W.Audio = function (src) { var a = new A(); if (src !== undefined) a.src = src; return a; };
            W.Audio.prototype = A.prototype;
        }
        if (W.AudioWorklet && AudioWorklet.prototype.addModule) {
            var add = AudioWorklet.prototype.addModule;
            AudioWorklet.prototype.addModule = function (url, o) {
                var self = this, rel = relOf(url);
                if (rel === null) return add.call(self, url, o);
                return blobUrl(rel).then(function (u) { return add.call(self, u, o); });
            };
        }
    }

    // My PC's current SDK (the copy's own may be older); none = the copy's
    function sdk(cb) {
        if (sdkText) return cb(sdkText);
        var b = typeof AppBoot !== 'undefined' && AppBoot.base ? AppBoot.base() : '';
        var x = new XMLHttpRequest(), done = false;
        function end(t) { if (done) return; done = true; if (t && /var MyPC = /.test(t)) sdkText = t; cb(sdkText); }
        try {
            x.open('GET', (b || '') + 'sdk/mypc-sdk.js?au=' + (typeof AppBoot !== 'undefined' && AppBoot.build ? AppBoot.build() : 0), true);
            x.timeout = SDK_MS;
            x.onload = function () { end(x.status >= 200 && x.status < 300 || x.status === 0 ? x.responseText : ''); };
            x.onerror = x.ontimeout = function () { end(''); };
            x.send();
        } catch (e) { end(''); }
    }

    function build(copy, cb) {
        var entry = String(copy.entry || 'index.html');
        AppUsb.readFile(copy, entry, function (e, buf) {
            if (e) return cb(err(e.code || 'missing', 'entry ' + entry + ': ' + (e.message || e.code)));
            var html = dec(buf);
            if (!html) return cb(err('bad', 'entry ' + entry + ' is empty'));
            sdk(function (own) {
                var jobs = [], re = /<script\b[^>]*\bsrc\s*=[^>]*>\s*<\/script\s*>|<link\b[^>]*>|<img\b[^>]*>/gi, m;
                while ((m = re.exec(html))) jobs.push({ at: m.index, len: m[0].length, tag: m[0] });
                var out = [], k = 0, read = 0, made = 0;
                function file(rel, then) { AppUsb.readFile(copy, rel, function (e2, b) { if (!e2) { read++; made += b.byteLength; } then(e2 ? null : b); }); }
                // url(...) of a stylesheet -> data: (fonts, pictures), relative to the stylesheet's own folder
                function css(text, from, then) {
                    var refs = [], r = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, u;
                    while ((u = r.exec(text))) refs.push(u[2]);
                    var i = 0;
                    (function next() {
                        if (i >= refs.length) return then(text);
                        var ref = refs[i++], rel = resolve(from, ref);
                        if (rel === null) return next();
                        file(rel, function (b) {
                            if (b) text = text.split(ref).join('data:' + mimeOf(rel) + ';base64,' + b64(b));
                            next();
                        });
                    })();
                }
                (function next() {
                    if (k >= jobs.length) return finish();
                    var j = jobs[k++], tag = j.tag, low = tag.slice(0, 7).toLowerCase();
                    function put(s) { out.push({ at: j.at, len: j.len, s: s }); next(); }
                    if (low === '<script') {
                        var src = attr(tag, 'src'), rel = resolve(entry, src), type = attr(tag, 'type');
                        if (rel === null) return next();
                        if (/(^|\/)mypc-sdk\.js$/i.test(rel) && own) return put('<script>' + own.replace(/<\/script/gi, '<\\/script') + '\n//# sourceURL=mypc-sdk.js\n</script>');
                        return file(rel, function (b) {
                            if (!b) return next();
                            put('<script' + (type ? ' type="' + type + '"' : '') + '>' + dec(b).replace(/<\/script/gi, '<\\/script') + '\n//# sourceURL=' + rel + '\n</script>');
                        });
                    }
                    if (low.indexOf('<link') === 0) {
                        var href = attr(tag, 'href'), relL = resolve(entry, href), relA = String(attr(tag, 'rel') || '').toLowerCase();
                        if (relL === null || !/stylesheet/.test(relA)) return next();
                        return file(relL, function (b) {
                            if (!b) return next();
                            css(dec(b), relL, function (t) { put('<style>' + t.replace(/<\/style/gi, '<\\/style') + '</style>'); });
                        });
                    }
                    var s = attr(tag, 'src'), relI = resolve(entry, s);
                    if (relI === null) return next();
                    file(relI, function (b) { if (!b) return next(); put(tag.replace(s, 'data:' + mimeOf(relI) + ';base64,' + b64(b))); });
                })();
                function finish() {
                    for (var i = out.length - 1; i >= 0; i--) html = html.slice(0, out[i].at) + out[i].s + html.slice(out[i].at + out[i].len);
                    // <base> on the made-up address + the prelude, before anything else of the page
                    var dir = entry.split('/').slice(0, -1).join('/'), base = ROOT + (dir ? dir.split('/').map(encodeURIComponent).join('/') + '/' : '');
                    var head = '<base href="' + base + '"><script>(' + PRELUDE.toString() + ')(' + JSON.stringify(ROOT) + ',' + JSON.stringify(base) + ');\n//# sourceURL=mypc-usb-prelude.js\n</script>';
                    html = html.replace(/<base\b[^>]*>/gi, '');
                    if (/<head\b[^>]*>/i.test(html)) html = html.replace(/<head\b[^>]*>/i, function (h) { return h + head; });
                    else if (/<html\b[^>]*>/i.test(html)) html = html.replace(/<html\b[^>]*>/i, function (h) { return h + '<head>' + head + '</head>'; });
                    else html = head + html;
                    cb(null, html, { files: read, bytes: made, sdk: own ? 'mypc' : 'copy' });
                }
            });
        });
    }

    return { build: build, ROOT: ROOT, _resolve: resolve };
})();
