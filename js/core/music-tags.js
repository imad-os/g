/* Song details read from the music files themselves, for the Music app (js/launcher/apps/music.js): title, artist,
 * album, track number, length and the cover picture inside the file. No library, no network: a few hundred lines that
 * read the formats people keep on USB drives.
 *   ID3v2.2 / 2.3 / 2.4 (MP3, also in front of some FLAC / AAC / WAV), FLAC (Vorbis comments + PICTURE), Ogg Vorbis / Opus
 *   comments, MP4 / M4A / AAC (iTunes ilst atoms, mvhd length), WAV (RIFF LIST INFO, length from the header).
 *
 *   MusicTags.parse(bytes, size, wantPic)   bytes: Uint8Array of the start of the file; size: the whole file's size (0 = unknown)
 *     -> { title, artist, album, track, year, dur (s), pic: { mime, data: Uint8Array } }
 *        + more: n     (wantPic) the picture is further: read the first n bytes and call again
 *        or { at: offset, len: n }   (MP4) the details are at that offset: read there and call parseMp4(bytes) with them
 *   MusicTags.HEAD   how many bytes to read first
 * Works in the browser and in node (tests/unit-tests.mjs). Nothing here allocates more than the picture it returns. */
var MusicTags = (function () {
    'use strict';

    var HEAD = 128 * 1024, MAX = 6 * 1024 * 1024;

    function u32(b, i) { return ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3]; }
    function u32le(b, i) { return b[i] + (b[i + 1] << 8) + (b[i + 2] << 16) + ((b[i + 3] << 24) >>> 0); }
    function u24(b, i) { return (b[i] << 16) + (b[i + 1] << 8) + b[i + 2]; }
    function safe(b, i) { return ((b[i] & 0x7f) << 21) | ((b[i + 1] & 0x7f) << 14) | ((b[i + 2] & 0x7f) << 7) | (b[i + 3] & 0x7f); }
    function str(b, i, n) { var s = ''; for (var k = 0; k < n && i + k < b.length; k++) s += String.fromCharCode(b[i + k]); return s; }

    var decoders = {};
    function decode(b, enc) {
        if (!b.length) return '';
        try {
            if (typeof TextDecoder !== 'undefined') {
                var d = decoders[enc] || (decoders[enc] = new TextDecoder(enc));
                return d.decode(b);
            }
        } catch (e) {}
        var s = '', i;
        if (enc === 'utf-16le' || enc === 'utf-16be') {
            for (i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode(enc === 'utf-16le' ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]);
            return s;
        }
        for (i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
        if (enc === 'utf-8') { try { s = decodeURIComponent(escape(s)); } catch (e2) {} }
        return s;
    }
    function clean(s) { return String(s || '').replace(/\u0000+$/g, '').replace(/[\u0000-\u001f]/g, ' ').replace(/^\s+|\s+$/g, ''); }

    /* ---------- ID3v2 ---------- */
    // text of an ID3 frame: first byte = encoding
    function id3Text(b) {
        if (!b.length) return '';
        var e = b[0], d = b.subarray(1);
        if (e === 1) {
            if (d.length >= 2 && d[0] === 0xfe && d[1] === 0xff) return clean(decode(d.subarray(2), 'utf-16be'));
            if (d.length >= 2 && d[0] === 0xff && d[1] === 0xfe) return clean(decode(d.subarray(2), 'utf-16le'));
            return clean(decode(d, 'utf-16le'));
        }
        if (e === 2) return clean(decode(d, 'utf-16be'));
        if (e === 3) return clean(decode(d, 'utf-8'));
        return clean(decode(d, 'latin1'));
    }
    // end of a null-terminated string in encoding e (UTF-16 ends on a double 0 at an even place)
    function zEnd(b, i, e) {
        if (e === 1 || e === 2) { for (; i + 1 < b.length; i += 2) if (!b[i] && !b[i + 1]) return i + 2; return b.length; }
        for (; i < b.length; i++) if (!b[i]) return i + 1;
        return b.length;
    }
    function apic(b, v2) {
        if (b.length < 4) return null;
        var e = b[0], i = 1, mime, type;
        if (v2) { mime = str(b, 1, 3).toLowerCase(); mime = mime === 'png' ? 'image/png' : 'image/jpeg'; i = 4; }
        else { var m = zEnd(b, 1, 0); mime = str(b, 1, m - 2).toLowerCase(); i = m; }
        type = b[i]; i = zEnd(b, i + 1, e);
        if (i >= b.length) return null;
        if (!/^image\//.test(mime)) mime = mime === 'png' ? 'image/png' : 'image/jpeg';
        return { mime: mime, type: type, data: b.subarray(i) };
    }
    function unsync(b) {
        var out = new Uint8Array(b.length), n = 0;
        for (var i = 0; i < b.length; i++) { out[n++] = b[i]; if (b[i] === 0xff && b[i + 1] === 0) i++; }
        return out.subarray(0, n);
    }
    function id3(b, out, wantPic) {
        var ver = b[3], flags = b[5], size = safe(b, 6) + 10 + (flags & 0x10 ? 10 : 0);
        // only part of the tag was read: its text comes first in nearly every file, the picture may be further
        var part = b.length < size, tag = b.subarray(10, Math.min(size, b.length)), i = 0;
        if (flags & 0x80 && ver < 4) tag = unsync(tag);
        if (flags & 0x40) i = ver === 3 ? u32(tag, 0) + 4 : safe(tag, 0);
        var pic = null, idLen = ver === 2 ? 3 : 4, head = ver === 2 ? 6 : 10;
        while (i + head <= tag.length) {
            var id = str(tag, i, idLen);
            if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
            var fs = ver === 2 ? u24(tag, i + 3) : ver === 4 ? safe(tag, i + 4) : u32(tag, i + 4);
            // some writers put plain sizes in v2.4: when the synchsafe size does not land on a frame, use the plain one
            if (ver === 4 && i + head + fs + 4 <= tag.length && !/^([A-Z0-9]{4}|\0\0\0\0)$/.test(str(tag, i + head + fs, 4))) {
                var plain = u32(tag, i + 4);
                if (i + head + plain + 4 <= tag.length && /^[A-Z0-9]{4}$/.test(str(tag, i + head + plain, 4))) fs = plain;
            }
            if (fs <= 0 || i + head + fs > tag.length) break;
            var fflags = ver === 4 ? tag[i + 9] : 0, d = tag.subarray(i + head, i + head + fs);
            if (fflags & 0x02) d = unsync(d);
            if (fflags & 0x01) d = d.subarray(4);                 // data length indicator
            if (!(fflags & 0x0c)) {                                // not compressed / encrypted
                switch (id) {
                    case 'TIT2': case 'TT2': out.title = id3Text(d); break;
                    case 'TPE1': case 'TP1': out.artist = id3Text(d); break;
                    case 'TPE2': case 'TP2': if (!out.albumArtist) out.albumArtist = id3Text(d); break;
                    case 'TALB': case 'TAL': out.album = id3Text(d); break;
                    case 'TRCK': case 'TRK': out.track = parseInt(id3Text(d), 10) || 0; break;
                    case 'TYER': case 'TYE': case 'TDRC': out.year = (id3Text(d).match(/\d{4}/) || [''])[0]; break;
                    case 'TLEN': case 'TLE': var ms = parseInt(id3Text(d), 10); if (ms > 0) out.dur = ms / 1000; break;
                    case 'APIC': case 'PIC':
                        var p = apic(d, ver === 2);
                        if (p && p.data.length > 64 && (!pic || (p.type === 3 && pic.type !== 3))) pic = p;
                        break;
                }
            }
            i += head + fs;
        }
        if (pic) out.pic = { mime: pic.mime, data: pic.data };
        else if (part && wantPic && size <= MAX) out.more = size;
        out.audioAt = size;
        return out;
    }

    /* ---------- Vorbis comments (FLAC, Ogg) ---------- */
    function comments(b, i, out) {
        if (i + 8 > b.length) return;
        var vl = u32le(b, i); i += 4 + vl;
        if (i + 4 > b.length) return;
        var n = u32le(b, i); i += 4;
        for (var k = 0; k < n && k < 500 && i + 4 <= b.length; k++) {
            var l = u32le(b, i); i += 4;
            if (i + l > b.length) return;
            var s = decode(b.subarray(i, i + l), 'utf-8'), eq = s.indexOf('=');
            i += l;
            if (eq < 1) continue;
            var key = s.slice(0, eq).toUpperCase(), v = clean(s.slice(eq + 1));
            if (key === 'TITLE') out.title = v;
            else if (key === 'ARTIST' && !out.artist) out.artist = v;
            else if (key === 'ALBUMARTIST') out.albumArtist = v;
            else if (key === 'ALBUM') out.album = v;
            else if (key === 'TRACKNUMBER') out.track = parseInt(v, 10) || 0;
            else if (key === 'DATE' || key === 'YEAR') out.year = (v.match(/\d{4}/) || [''])[0];
        }
    }
    function flacPicture(b) {
        var i = 4, ml = u32(b, i); var mime = str(b, i + 4, ml); i += 4 + ml;
        var dl = u32(b, i); i += 4 + dl + 16;
        var len = u32(b, i); i += 4;
        if (i + len > b.length) return null;
        return { mime: /^image\//.test(mime) ? mime : 'image/jpeg', type: u32(b, 0), data: b.subarray(i, i + len) };
    }
    function flac(b, start, out, wantPic) {
        var i = start + 4, pic = null;
        while (i + 4 <= b.length) {
            var h = b[i], type = h & 0x7f, len = u24(b, i + 1);
            i += 4;
            if (i + len > b.length) { if (wantPic && !pic && (type === 6 || type === 1 || type === 2) && i + len <= MAX) out.more = i + len; break; }
            var d = b.subarray(i, i + len);
            if (type === 0 && len >= 18) {
                var rate = (d[10] << 12) | (d[11] << 4) | (d[12] >> 4);
                var total = (d[13] & 0x0f) * 4294967296 + u32(d, 14);
                if (rate > 0 && total > 0) out.dur = total / rate;
            } else if (type === 4) comments(d, 0, out);
            else if (type === 6) { var p = flacPicture(d); if (p && (!pic || (p.type === 3 && pic.type !== 3))) pic = p; }
            i += len;
            if (h & 0x80) break;
        }
        if (pic) out.pic = { mime: pic.mime, data: pic.data };
        return out;
    }
    function ogg(b, out) {
        // the comment packet follows the first page: look for its signature in the first pages
        var lim = Math.min(b.length, 65536), i;
        for (i = 0; i + 8 < lim; i++) {
            if (b[i] === 0x03 && str(b, i + 1, 6) === 'vorbis') { comments(b, i + 7, out); break; }
            if (b[i] === 0x4f && str(b, i, 8) === 'OpusTags') { comments(b, i + 8, out); break; }
        }
        return out;
    }

    /* ---------- MP4 / M4A ---------- */
    function boxes(b, from, to, fn) {
        var i = from;
        while (i + 8 <= to && i + 8 <= b.length) {
            var size = u32(b, i), type = str(b, i + 4, 4), head = 8;
            if (size === 1 && i + 16 <= to) { size = u32(b, i + 12) + u32(b, i + 8) * 4294967296; head = 16; }
            else if (size === 0) size = to - i;
            if (size < head) return;
            if (fn(type, i + head, Math.min(i + size, to), i, size) === false) return;
            i += size;
        }
    }
    function mp4Data(b, from, to) {
        var r = null;
        boxes(b, from, to, function (t, s, e) { if (t === 'data' && e - s >= 8) { r = { type: u32(b, s) & 0xffffff, d: b.subarray(s + 8, e) }; return false; } });
        return r;
    }
    function parseMp4(b, out) {
        out = out || {};
        var moov = null;
        boxes(b, 0, b.length, function (t, s, e) { if (t === 'moov') { moov = [s, e]; return false; } });
        if (!moov) {
            // the whole window is the inside of moov (read at an offset): walk it as is
            if (str(b, 4, 4) === 'moov') moov = [8, b.length]; else moov = [0, b.length];
        }
        boxes(b, moov[0], moov[1], function (t, s, e) {
            if (t === 'mvhd') {
                var v = b[s];
                var scale = v === 1 ? u32(b, s + 20) : u32(b, s + 12), dur = v === 1 ? u32(b, s + 24) * 4294967296 + u32(b, s + 28) : u32(b, s + 16);
                if (scale > 0 && dur > 0) out.dur = dur / scale;
            } else if (t === 'udta') {
                boxes(b, s, e, function (t2, s2, e2) {
                    if (t2 !== 'meta') return;
                    boxes(b, s2 + 4, e2, function (t3, s3, e3) {
                        if (t3 !== 'ilst') return;
                        boxes(b, s3, e3, function (t4, s4, e4) {
                            var d = mp4Data(b, s4, e4);
                            if (!d) return;
                            if (t4 === '©nam') out.title = clean(decode(d.d, 'utf-8'));
                            else if (t4 === '©ART') out.artist = clean(decode(d.d, 'utf-8'));
                            else if (t4 === 'aART') out.albumArtist = clean(decode(d.d, 'utf-8'));
                            else if (t4 === '©alb') out.album = clean(decode(d.d, 'utf-8'));
                            else if (t4 === '©day') out.year = (decode(d.d, 'utf-8').match(/\d{4}/) || [''])[0];
                            else if (t4 === 'trkn' && d.d.length >= 4) out.track = (d.d[2] << 8) | d.d[3];
                            else if (t4 === 'covr' && !out.pic && d.d.length > 64) out.pic = { mime: d.type === 14 ? 'image/png' : 'image/jpeg', data: d.d };
                        });
                    });
                });
            }
        });
        return out;
    }
    function mp4(b, size, out) {
        var found = null, last = 0;
        boxes(b, 0, size || 1e15, function (t, s, e, at, len) {
            last = at + len;
            if (t === 'moov') { found = { at: at, len: len }; return false; }
            if (at + len > b.length) return false;               // the next box starts after what was read
        });
        if (!found) {
            // moov after the media data: its offset is known once the box before it was walked
            if (last && size && last < size) return { at: last, len: Math.min(MAX, size - last), peek: true };
            return out;
        }
        if (found.at + found.len <= b.length) return parseMp4(b.subarray(found.at, found.at + found.len), out);
        if (found.len > MAX) return out;
        return { at: found.at, len: found.len };
    }

    /* ---------- WAV ---------- */
    function wav(b, size, out) {
        var rate = 0;
        boxesLe(b, 12, function (t, s, e) {
            if (t === 'fmt ' && e - s >= 12) rate = u32le(b, s + 8);
            else if (t === 'data' && rate) { out.dur = ((size || 0) ? Math.min(u32le(b, s - 4), size - s) : u32le(b, s - 4)) / rate; }
            else if (t === 'LIST' && str(b, s, 4) === 'INFO') {
                boxesLe(b, s + 4, function (t2, s2, e2) {
                    var v = clean(decode(b.subarray(s2, e2), 'utf-8'));
                    if (t2 === 'INAM') out.title = v; else if (t2 === 'IART') out.artist = v; else if (t2 === 'IPRD') out.album = v;
                }, e);
            }
        });
        return out;
    }
    function boxesLe(b, i, fn, to) {
        to = to || b.length;
        while (i + 8 <= to) {
            var t = str(b, i, 4), len = u32le(b, i + 4);
            fn(t, i + 8, Math.min(i + 8 + len, b.length));
            if (t === 'data') return;                             // the sound itself: nothing useful after it in the head
            i += 8 + len + (len & 1);
        }
    }

    // wantPic: say how much more to read (out.more) when the picture is further than what was read
    function parse(b, size, wantPic) {
        var out = {};
        if (!b || b.length < 12) return out;
        if (str(b, 0, 3) === 'ID3') {
            id3(b, out, wantPic);
            var a = out.audioAt;
            delete out.audioAt;
            if (!out.more && a + 4 <= b.length && str(b, a, 4) === 'fLaC') return flac(b, a, out, wantPic);
            return out;
        }
        if (str(b, 0, 4) === 'fLaC') return flac(b, 0, out, wantPic);
        if (str(b, 0, 4) === 'OggS') return ogg(b, out);
        if (str(b, 4, 4) === 'ftyp') return mp4(b, size, out);
        if (str(b, 0, 4) === 'RIFF' && str(b, 8, 4) === 'WAVE') return wav(b, size, out);
        return out;
    }

    // "03 - Artist - Title.mp3" -> a title (and artist) from the file name when the file has none
    function fromName(name) {
        var base = String(name || '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_/g, ' ');
        var m = /^\s*(\d{1,3})\s*[-.)_ ]\s*(.+)$/.exec(base), track = 0;
        if (m && +m[1] < 400) { track = +m[1]; base = m[2]; }
        var parts = base.split(/\s+-\s+/);
        if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim(), track: track };
        return { title: base.trim(), track: track };
    }

    return { parse: parse, parseMp4: parseMp4, fromName: fromName, HEAD: HEAD, MAX: MAX };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = MusicTags;
