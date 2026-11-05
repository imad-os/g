// Small music files built in memory for the Music tests (tests/unit-tests.mjs, tests/run-tests.mjs): ID3v2.3 / 2.4 MP3
// heads, FLAC, M4A (moov after the sound), WAV, and a real PNG cover. Nothing here is a real song: the bytes only carry
// the details the Music app reads (js/core/music-tags.js). wav() is a real, playable 16 kHz WAV.
import zlib from 'node:zlib';

const enc = new TextEncoder();
const cat = (...parts) => { const n = parts.reduce((a, p) => a + p.length, 0), o = new Uint8Array(n); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };
const u32 = (v) => new Uint8Array([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]);
const u32le = (v) => new Uint8Array([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]);
const u24 = (v) => new Uint8Array([(v >>> 16) & 255, (v >>> 8) & 255, v & 255]);
const safe = (v) => new Uint8Array([(v >>> 21) & 127, (v >>> 14) & 127, (v >>> 7) & 127, v & 127]);
const ascii = (s) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

// a w x h PNG of one colour
export function png(w = 16, h = 16, rgb = [220, 40, 60]) {
    const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
    const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunk = (t, d) => cat(u32(d.length), ascii(t), d, u32(crc(cat(ascii(t), d))));
    const raw = new Uint8Array(h * (1 + w * 3));
    for (let y = 0; y < h; y++) { raw[y * (1 + w * 3)] = 0; for (let x = 0; x < w; x++) raw.set(rgb, y * (1 + w * 3) + 1 + x * 3); }
    const ihdr = cat(u32(w), u32(h), new Uint8Array([8, 2, 0, 0, 0]));
    return cat(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', new Uint8Array(zlib.deflateSync(raw))), chunk('IEND', new Uint8Array(0)));
}

// ID3v2.3 (or 2.4: synchsafe frame sizes, UTF-8 text) + some fake MP3 bytes; pad: extra bytes inside the tag (a big tag)
export function mp3({ title, artist, album, track, pic, v4 = false, pad = 0, utf16 = false } = {}) {
    const frames = [];
    const text = (id, s) => {
        let body;
        if (v4) body = cat(new Uint8Array([3]), enc.encode(s));
        else if (utf16) { const b = new Uint8Array(2 + s.length * 2); b[0] = 0xff; b[1] = 0xfe; for (let i = 0; i < s.length; i++) { b[2 + i * 2] = s.charCodeAt(i) & 255; b[3 + i * 2] = s.charCodeAt(i) >> 8; } body = cat(new Uint8Array([1]), b); }
        else body = cat(new Uint8Array([0]), ascii(s));
        frames.push(cat(ascii(id), v4 ? safe(body.length) : u32(body.length), new Uint8Array([0, 0]), body));
    };
    if (title) text('TIT2', title);
    if (artist) text('TPE1', artist);
    if (album) text('TALB', album);
    if (track) text('TRCK', String(track));
    if (pic) {
        const body = cat(new Uint8Array([0]), ascii('image/png'), new Uint8Array([0, 3]), ascii('cover'), new Uint8Array([0]), pic);
        frames.push(cat(ascii('APIC'), v4 ? safe(body.length) : u32(body.length), new Uint8Array([0, 0]), body));
    }
    const all = cat(...frames, new Uint8Array(pad));
    const head = cat(ascii('ID3'), new Uint8Array([v4 ? 4 : 3, 0, 0]), safe(all.length));
    const audio = new Uint8Array(4096); for (let i = 0; i < audio.length; i += 418) { audio[i] = 0xff; audio[i + 1] = 0xfb; audio[i + 2] = 0x90; }
    return cat(head, all, audio);
}

export function flac({ title, artist, album, seconds = 200, pic } = {}) {
    const rate = 44100, total = rate * seconds;
    const si = new Uint8Array(34);
    si[10] = (rate >> 12) & 255; si[11] = (rate >> 4) & 255; si[12] = ((rate & 15) << 4) | (1 << 1);
    si[13] = (15 << 4) | Math.floor(total / 4294967296); si.set(u32(total >>> 0), 14);
    const vendor = enc.encode('test'), cm = [];
    for (const [k, v] of [['TITLE', title], ['ARTIST', artist], ['ALBUM', album]]) if (v) cm.push(enc.encode(k + '=' + v));
    const vc = cat(u32le(vendor.length), vendor, u32le(cm.length), ...cm.map((c) => cat(u32le(c.length), c)));
    const blocks = [[0, si], [4, vc]];
    if (pic) blocks.push([6, cat(u32(3), u32(9), ascii('image/png'), u32(0), u32(16), u32(16), u32(24), u32(0), u32(pic.length), pic)]);
    const out = [ascii('fLaC')];
    blocks.forEach(([t, d], i) => out.push(cat(new Uint8Array([(i === blocks.length - 1 ? 128 : 0) | t]), u24(d.length), d)));
    out.push(new Uint8Array(2048));
    return cat(...out);
}

// moovLast: the moov box after the sound (as many encoders do): the app must read it at its offset
export function m4a({ title, artist, album, seconds = 185, pic, moovLast = true } = {}) {
    const box = (t, ...d) => { const b = cat(...d); return cat(u32(b.length + 8), ascii(t), b); };
    const data = (type, b) => box('data', u32(type), u32(0), b);
    const items = [];
    if (title) items.push(box('©nam', data(1, enc.encode(title))));
    if (artist) items.push(box('©ART', data(1, enc.encode(artist))));
    if (album) items.push(box('©alb', data(1, enc.encode(album))));
    if (pic) items.push(box('covr', data(14, pic)));
    const mvhd = box('mvhd', new Uint8Array([0, 0, 0, 0]), u32(0), u32(0), u32(1000), u32(seconds * 1000), new Uint8Array(80));
    const moov = box('moov', mvhd, box('udta', box('meta', new Uint8Array(4), box('hdlr', new Uint8Array(25)), box('ilst', ...items))));
    const ftyp = box('ftyp', ascii('M4A '), u32(0), ascii('M4A mp42isom'));
    const mdat = box('mdat', new Uint8Array(200000));
    return moovLast ? cat(ftyp, mdat, moov) : cat(ftyp, moov, mdat);
}

// a real WAV (16 kHz mono 16-bit, a soft tone) with LIST INFO title / artist
export function wav({ title, artist, seconds = 2 } = {}) {
    const rate = 16000, n = rate * seconds, pcm = new Uint8Array(n * 2);
    for (let i = 0; i < n; i++) { const v = Math.round(Math.sin(i / rate * 2 * Math.PI * 440) * 3000); pcm[i * 2] = v & 255; pcm[i * 2 + 1] = (v >> 8) & 255; }
    const fmt = cat(ascii('fmt '), u32le(16), new Uint8Array([1, 0, 1, 0]), u32le(rate), u32le(rate * 2), new Uint8Array([2, 0, 16, 0]));
    const sub = (id, s) => { let b = enc.encode(s + '\0'); if (b.length & 1) b = cat(b, new Uint8Array([0])); return cat(ascii(id), u32le(b.length), b); };
    const info = cat(ascii('INFO'), title ? sub('INAM', title) : new Uint8Array(0), artist ? sub('IART', artist) : new Uint8Array(0));
    const list = cat(ascii('LIST'), u32le(info.length), info);
    const data = cat(ascii('data'), u32le(pcm.length), pcm);
    const body = cat(ascii('WAVE'), fmt, list, data);
    return cat(ascii('RIFF'), u32le(body.length), body);
}
