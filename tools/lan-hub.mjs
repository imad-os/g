// A My PC room hub for a computer on the home network (same protocol as the Android app's LanDb.java; see js/core/lan-db.js).
// When the internet is missing or limited, multiplayer rooms live on a hub on this Wi-Fi. TVs can not host one (a Samsung
// web app can not listen on a port), so run it on a PC that stays on:   node tools/lan-hub.mjs [port]   (default 47800)
// The tests import createHub() / startHub() too. Nothing is written to disk; everything expires by itself.
import http from 'node:http';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const MAX_DOCS = 400, MAX_DOC = 8192, MAX_BODY = 16384, NO_EXP_TTL = 3600000;
const SEG = /^[A-Za-z0-9_-]{1,64}$/;

export function createHub() {
    const docs = new Map();                                     // path -> { data, w }
    function exp(d) {
        const e = d.data && d.data.exp;
        const t = typeof e === 'string' ? Date.parse(e) : typeof e === 'number' ? e : NaN;
        return isNaN(t) ? d.w + NO_EXP_TTL : t;
    }
    function sweep(now) { for (const [p, d] of docs) if (exp(d) < now) docs.delete(p); }
    function docPath(p) {
        if (typeof p !== 'string') return false;
        const s = p.split('/');
        return s.length % 2 === 0 && s.length <= 6 && s.every(x => SEG.test(x));
    }
    function handle(body) {
        const now = Date.now();
        let q;
        try { q = JSON.parse(body); } catch { return { t: now, err: 'invalid' }; }
        if (!q || typeof q !== 'object') return { t: now, err: 'invalid' };
        sweep(now);
        const out = (o) => Object.assign({ t: now }, o);
        if (q.op === 'list') {
            const parent = q.parent || '';
            if ((parent && !docPath(parent)) || !SEG.test(q.coll || '')) return out({ err: 'invalid' });
            const pre = (parent ? parent + '/' : '') + q.coll + '/';
            const lim = Math.max(1, Math.min(100, q.limit | 0 || 50));
            const list = [];
            for (const [p, d] of docs) if (p.startsWith(pre) && p.indexOf('/', pre.length) < 0) list.push({ id: p.slice(pre.length), data: d.data, w: d.w });
            list.sort((a, b) => b.w - a.w);
            return out({ docs: list.slice(0, lim).map(x => ({ id: x.id, data: x.data })) });
        }
        if (!docPath(q.path)) return out({ err: 'invalid' });
        const cur = docs.get(q.path);
        if (q.op === 'get') return cur ? out({ data: cur.data }) : out({ err: 'notfound' });
        if (q.op === 'del') {
            for (const p of [...docs.keys()]) if (p === q.path || p.startsWith(q.path + '/')) docs.delete(p);
            return out({});
        }
        if (q.op === 'set' || q.op === 'merge') {
            if (!q.data || typeof q.data !== 'object' || Array.isArray(q.data)) return out({ err: 'invalid' });
            if (q.exists === true && !cur) return out({ err: 'notfound' });
            if (q.exists === false && cur) return out({ err: 'conflict' });
            let data;
            if (q.op === 'set' || !cur) data = Object.assign({}, q.data);
            else {
                data = Object.assign({}, cur.data);
                const fields = Array.isArray(q.fields) ? q.fields : Object.keys(q.data);
                for (const f of fields) { if (typeof f !== 'string') continue; if (f in q.data) data[f] = q.data[f]; else delete data[f]; }
            }
            if (JSON.stringify(data).length > MAX_DOC) return out({ err: 'invalid' });
            if (!cur && docs.size >= MAX_DOCS) return out({ err: 'full' });
            docs.set(q.path, { data, w: now });
            return out({});
        }
        return out({ err: 'invalid' });
    }
    return { handle, size: () => docs.size, clear: () => docs.clear() };
}

export function startHub({ port = 47800, host = '0.0.0.0', name = os.hostname() } = {}) {
    const hub = createHub(), id = crypto.randomBytes(6).toString('hex');
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type',
                   'Access-Control-Allow-Private-Network': 'true', 'Cache-Control': 'no-store' };
    const srv = http.createServer((req, res) => {
        const send = (code, obj) => { res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, cors)); res.end(JSON.stringify(obj)); };
        const path = (req.url || '').split('?')[0];
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
        if (req.method === 'GET' && path === '/mypc/hello') return send(200, { app: 'mypc', v: 1, name, id, db: 1 });
        if (req.method === 'POST' && path === '/db') {
            let body = '', big = false;
            req.on('data', (c) => { if (big) return; body += c; if (body.length > MAX_BODY) { big = true; send(413, { t: Date.now(), err: 'invalid' }); req.destroy(); } });
            req.on('end', () => { if (!big) send(200, hub.handle(body)); });
            return;
        }
        send(404, { err: 'notfound' });
    });
    return new Promise((resolve) => srv.listen(port, host, () => resolve({ server: srv, hub, port: srv.address().port, id })));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const port = +process.argv[2] || 47800;
    startHub({ port }).then(({ port: p }) => {
        const ips = Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal).map(a => a.address);
        console.log(`My PC room hub on port ${p}: ${ips.map(ip => 'http://' + ip + ':' + p).join(', ') || 'no network'}`);
        console.log('Leave this window open while you play. Ctrl+C stops it.');
    });
}
