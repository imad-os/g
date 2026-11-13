// A stand-in for the My PC Android app's LanServer (android-controller/.../LanServer.java) for the tests: the same paths, the same
// answers, the same rules (a share waits for a TV to be picked, or goes to the remembered TV; files only for that TV, from its
// address; Range). Listens on host:47800 (tests use 127.0.0.x: Linux answers every 127.x address on the loopback).
//   const phone = await lanPhone({ host: '127.0.0.23', name: 'Pixel 8' });
//   phone.addText('hello') / phone.addFile(bytes, 'image/png', 'a.png') -> id;  phone.send('', tvId, remember);  phone.info();  phone.close()
import http from 'node:http';
import crypto from 'node:crypto';

export function lanPhone({ host = '127.0.0.23', port = 47800, name = 'Pixel 8', id = 'phone-test-1' } = {}) {
    const items = [], tvs = new Map(), waiters = new Set();
    let seq = 0, remembered = '';
    const log = [];
    const wake = () => { for (const w of waiters) w(); };
    const alive = (t) => Date.now() - t.at < 40000;
    function add(it) {
        it.seq = ++seq; it.at = Date.now(); it.tv = ''; it.state = 'wait';
        const t = tvs.get(remembered);
        if (remembered && t && alive(t)) { it.tv = remembered; it.state = 'sent'; }
        items.push(it); wake(); return it.id;
    }
    const pub = (it) => ({ id: it.id, seq: it.seq, kind: it.kind, mime: it.mime, name: it.name, size: it.size, text: it.text || '', subject: it.subject || '' });
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges', 'Cache-Control': 'no-store' };
    const json = (res, code, o) => { res.writeHead(code, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    const srv = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://x'), q = (k) => u.searchParams.get(k) || '', ip = req.socket.remoteAddress.replace(/^::ffff:/, '');
        log.push(req.method + ' ' + u.pathname);
        if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': '*' }); return res.end(); }
        if (u.pathname === '/mypc/hello') return json(res, 200, { app: 'mypc', v: 1, name, id, share: 1, db: 1 });
        if (u.pathname === '/mypc/inbox') {
            const tv = q('tv'); if (!tv) return json(res, 400, { error: 'tv' });
            let t = tvs.get(tv); const isNew = !t || !alive(t);
            if (!t) { t = { id: tv }; tvs.set(tv, t); }
            t.name = q('name') || t.name || 'TV'; t.ip = ip; t.at = Date.now();
            if (isNew && tv === remembered) for (const it of items) if (it.state === 'wait') { it.tv = tv; it.state = 'sent'; }
            let timer = 0;
            const since = +q('since') || 0, wait = Math.min(25, +q('wait') || 0) * 1000, end = Date.now() + wait;
            const pick = () => items.filter((it) => it.seq > since && it.tv === tv && it.state === 'sent').map(pub);
            const answer = () => { const l = pick(); if (l.length || Date.now() >= end) { waiters.delete(check); clearTimeout(timer); json(res, 200, { seq, items: l }); return true; } return false; };
            const check = () => { t.at = Date.now(); answer(); };
            if (answer()) return;
            waiters.add(check);
            timer = setTimeout(check, wait + 5);
            req.on('close', () => { waiters.delete(check); clearTimeout(timer); });
            return;
        }
        let m = /^\/mypc\/file\/([0-9a-f]+)$/.exec(u.pathname);
        if (m) {
            const it = items.find((x) => x.id === m[1]), t = tvs.get(q('tv'));
            if (!it || !it.bytes || it.tv !== q('tv') || !t || t.ip !== ip) return json(res, 404, { error: 'not-found' });
            const size = it.bytes.length, r = /^bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
            if (r) {
                const from = r[1] === '' ? Math.max(0, size - +r[2]) : +r[1], to = r[1] !== '' && r[2] !== '' ? Math.min(size - 1, +r[2]) : size - 1;
                res.writeHead(206, { ...cors, 'Content-Type': it.mime, 'Content-Length': to - from + 1, 'Content-Range': `bytes ${from}-${to}/${size}`, 'Accept-Ranges': 'bytes' });
                return res.end(it.bytes.subarray(from, to + 1));
            }
            res.writeHead(200, { ...cors, 'Content-Type': it.mime, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
            return res.end(it.bytes);
        }
        m = /^\/mypc\/ack\/([0-9a-f]+)$/.exec(u.pathname);
        if (m && req.method === 'POST') {
            const it = items.find((x) => x.id === m[1] && x.tv === q('tv'));
            if (it) it.state = q('fail') ? 'failed' : 'taken';
            return json(res, it ? 200 : 404, { ok: !!it });
        }
        json(res, 404, { error: 'not-found' });
    });
    const api = {
        log, items, tvs,
        addText(text, subject = '') { return add({ id: crypto.randomBytes(16).toString('hex'), kind: 'text', mime: 'text/plain', name: '', size: text.length, text, subject }); },
        addFile(bytes, mime, fname) { return add({ id: crypto.randomBytes(16).toString('hex'), kind: 'file', mime, name: fname, size: bytes.length, bytes: Buffer.from(bytes) }); },
        send(itemId, tv, remember) { for (const it of items) if ((!itemId && it.state === 'wait') || it.id === itemId) { it.tv = tv; it.state = 'sent'; } if (remember) remembered = tv; wake(); },
        openTvs() { return [...tvs.values()].filter(alive); },
        state(itemId) { const it = items.find((x) => x.id === itemId); return it && it.state; },
        close() { waiters.clear(); return new Promise((r) => { srv.close(() => r()); srv.closeAllConnections(); }); }
    };
    return new Promise((resolve, reject) => { srv.once('error', reject); srv.listen(port, host, () => resolve(api)); });
}
