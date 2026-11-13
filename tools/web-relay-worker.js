/* My PC web relay (optional): a Cloudflare Worker for the Browser app, used ONLY in a web browser or the phone app when a site
 * refuses other sites (CORS error). The TV never uses it (a TV app has no CORS limit). See js/launcher/web-bridge.js.
 *
 * Deploy: Cloudflare dashboard > Workers > Create > paste this file > Deploy, then paste its https://….workers.dev address in
 * App Store Manager > Settings > Web relay for the Browser.
 *
 *   GET  /?url=https://site/page          -> the page, with CORS for My PC's pages and x-final-url (after redirects)
 *   POST /?url=https://site/form  (form)  -> same, the form body is passed on
 * Only http(s) to public hosts, 6 MB at most, no cookies kept or passed on (signed-in sites do not work through it). */
const ORIGINS = ['https://pc.geekspro.us', 'https://imad-os.github.io'];
const MAX = 6 * 1024 * 1024;

function privateHost(h) {
    h = h.toLowerCase().replace(/^\[|\]$/g, '');
    if (h === 'localhost' || /\.(local|localhost|internal|lan|home|arpa)$/.test(h)) return true;
    const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
    if (m) { const a = +m[1], b = +m[2]; return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127); }
    return h.includes(':');
}

export default {
    async fetch(req) {
        const origin = req.headers.get('Origin') || '';
        const cors = {
            'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
            'Access-Control-Expose-Headers': 'x-final-url',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            Vary: 'Origin'
        };
        if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        let target;
        try { target = new URL(new URL(req.url).searchParams.get('url') || ''); } catch (e) { return new Response('bad url', { status: 400, headers: cors }); }
        if (!/^https?:$/.test(target.protocol) || privateHost(target.hostname)) return new Response('blocked', { status: 403, headers: cors });
        const init = { method: req.method === 'POST' ? 'POST' : 'GET', redirect: 'follow',
            headers: { 'User-Agent': 'Mozilla/5.0 (SMART-TV; Linux; Tizen 8.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0 TV Safari/537.36', Accept: 'text/html,*/*' } };
        if (init.method === 'POST') { init.body = await req.text(); init.headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
        let res;
        try { res = await fetch(target.toString(), init); } catch (e) { return new Response('network', { status: 502, headers: cors }); }
        if (+(res.headers.get('content-length') || 0) > MAX) return new Response('too big', { status: 413, headers: cors });
        const body = await res.arrayBuffer();
        if (body.byteLength > MAX) return new Response('too big', { status: 413, headers: cors });
        return new Response(body, { status: res.status, headers: Object.assign({ 'Content-Type': res.headers.get('content-type') || 'text/html', 'x-final-url': res.url, 'Cache-Control': 'no-store' }, cors) });
    }
};
