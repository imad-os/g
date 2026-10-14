/* QR codes (ISO 18004), no library: byte mode, error correction M, versions 1 to 10 (up to 213 bytes), best of the 8 masks.
 * Used for pairing a phone controller (Settings > Devices > Phone controller shows the TV's pairing link as a QR code).
 *   QR.matrix(text) -> [[true|false, ...], ...] (true = dark), null when the text is too long
 *   QR.svg(text, { quiet: 4, dark: '#000', light: '#fff' }) -> '<svg ...>' */
var QR = (function () {
    'use strict';

    // per version (1..10), level M: [error correction codewords per block, blocks of group 1, data codewords in them, blocks of group 2, data codewords]
    var EC_M = [null, [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0], [16, 4, 27, 0, 0],
                [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44]];
    var ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

    /* ---------- Reed-Solomon over GF(256), polynomial 0x11D ---------- */
    var EXP = new Array(512), LOG = new Array(256);
    (function () { var x = 1; for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11D; } for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
    function mul(a, b) { return a && b ? EXP[LOG[a] + LOG[b]] : 0; }
    function generator(n) {
        var g = [1];
        for (var i = 0; i < n; i++) {
            var next = new Array(g.length + 1);
            for (var j = 0; j < next.length; j++) next[j] = 0;
            for (j = 0; j < g.length; j++) { next[j] ^= g[j]; next[j + 1] ^= mul(g[j], EXP[i]); }
            g = next;
        }
        return g;                                         // highest degree first, g[0] = 1
    }
    function ecc(data, n) {
        var g = generator(n), r = data.slice(), i, j;
        for (i = 0; i < n; i++) r.push(0);
        for (i = 0; i < data.length; i++) { var c = r[i]; if (c) for (j = 1; j < g.length; j++) r[i + j] ^= mul(g[j], c); }
        return r.slice(data.length);
    }

    function utf8(s) { var out = [], e = unescape(encodeURIComponent(s)); for (var i = 0; i < e.length; i++) out.push(e.charCodeAt(i)); return out; }

    function codewords(bytes, ver) {
        var t = EC_M[ver], nData = t[1] * t[2] + t[3] * t[4], bits = [], i;
        function put(v, n) { for (var k = n - 1; k >= 0; k--) bits.push((v >>> k) & 1); }
        put(4, 4); put(bytes.length, ver < 10 ? 8 : 16);
        for (i = 0; i < bytes.length; i++) put(bytes[i], 8);
        for (i = 0; i < 4 && bits.length < nData * 8; i++) bits.push(0);
        while (bits.length % 8) bits.push(0);
        var data = [];
        for (i = 0; i < bits.length; i += 8) { var b = 0; for (var k = 0; k < 8; k++) b = (b << 1) | bits[i + k]; data.push(b); }
        for (i = 0; data.length < nData; i++) data.push(i % 2 ? 0x11 : 0xEC);
        // blocks, then interleave data and error correction
        var blocks = [], eccs = [], pos = 0, g;
        for (g = 0; g < 2; g++) for (i = 0; i < t[1 + g * 2]; i++) { var blk = data.slice(pos, pos + t[2 + g * 2]); pos += blk.length; blocks.push(blk); eccs.push(ecc(blk, t[0])); }
        var out = [], max = Math.max(t[2], t[4]);
        for (i = 0; i < max; i++) for (g = 0; g < blocks.length; g++) if (i < blocks[g].length) out.push(blocks[g][i]);
        for (i = 0; i < t[0]; i++) for (g = 0; g < eccs.length; g++) out.push(eccs[g][i]);
        return out;
    }

    function build(ver, words, mask) {
        var n = ver * 4 + 17, m = [], fn = [], r, c, i, j;
        for (r = 0; r < n; r++) { m.push([]); fn.push([]); for (c = 0; c < n; c++) { m[r].push(false); fn[r].push(false); } }
        function set(row, col, dark) { m[row][col] = !!dark; fn[row][col] = true; }
        // finder patterns with their separators
        function finder(r0, c0) {
            for (var dr = -1; dr <= 7; dr++) for (var dc = -1; dc <= 7; dc++) {
                var rr = r0 + dr, cc = c0 + dc;
                if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
                var d = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
                set(rr, cc, d !== 2 && d !== 4);
            }
        }
        finder(0, 0); finder(0, n - 7); finder(n - 7, 0);
        for (i = 8; i < n - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
        var al = ALIGN[ver];
        for (i = 0; i < al.length; i++) for (j = 0; j < al.length; j++) {
            if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
            for (var dr2 = -2; dr2 <= 2; dr2++) for (var dc2 = -2; dc2 <= 2; dc2++) set(al[i] + dr2, al[j] + dc2, Math.max(Math.abs(dr2), Math.abs(dc2)) !== 1);
        }
        // format (reserved now, drawn below) and version information
        drawFormat(m, fn, n, mask, set);
        if (ver >= 7) {
            var rem = ver; for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
            var vb = (ver << 12) | rem;
            for (i = 0; i < 18; i++) { var bit = (vb >>> i) & 1, a = n - 11 + i % 3, b = Math.floor(i / 3); set(b, a, bit); set(a, b, bit); }
        }
        // data, zigzag from the bottom right, two columns at a time, skipping the timing column
        var bitIdx = 0, total = words.length * 8;
        for (var right = n - 1; right >= 1; right -= 2) {
            if (right === 6) right = 5;
            for (var vert = 0; vert < n; vert++) for (j = 0; j < 2; j++) {
                c = right - j;
                var upward = ((right + 1) & 2) === 0;
                r = upward ? n - 1 - vert : vert;
                if (fn[r][c]) continue;
                var dark = bitIdx < total ? ((words[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1) === 1 : false;
                bitIdx++;
                if (masked(mask, r, c)) dark = !dark;
                m[r][c] = dark;
            }
        }
        return m;
    }
    function masked(k, r, c) {
        switch (k) {
            case 0: return (r + c) % 2 === 0;
            case 1: return r % 2 === 0;
            case 2: return c % 3 === 0;
            case 3: return (r + c) % 3 === 0;
            case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
            case 5: return (r * c) % 2 + (r * c) % 3 === 0;
            case 6: return ((r * c) % 2 + (r * c) % 3) % 2 === 0;
            default: return ((r + c) % 2 + (r * c) % 3) % 2 === 0;
        }
    }
    function drawFormat(m, fn, n, mask, set) {
        var data = (0 << 3) | mask, rem = data, i;              // level M = 00
        for (i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
        var bits = ((data << 10) | rem) ^ 0x5412;
        function b(k) { return (bits >>> k) & 1; }
        for (i = 0; i <= 5; i++) set(i, 8, b(i));
        set(7, 8, b(6)); set(8, 8, b(7)); set(8, 7, b(8));
        for (i = 9; i < 15; i++) set(8, 14 - i, b(i));
        for (i = 0; i < 8; i++) set(8, n - 1 - i, b(i));
        for (i = 8; i < 15; i++) set(n - 15 + i, 8, b(i));
        set(n - 8, 8, 1);                                       // the dark module
    }

    function penalty(m) {
        var n = m.length, p = 0, r, c, run, dark = 0;
        function lines(get) {
            for (var a = 0; a < n; a++) {
                run = 1;
                for (var b = 1; b < n; b++) {
                    if (get(a, b) === get(a, b - 1)) { run++; if (run === 5) p += 3; else if (run > 5) p++; }
                    else run = 1;
                }
                for (b = 0; b + 10 < n; b++) {                 // 1:1:3:1:1 finder-like patterns with 4 light modules on one side
                    var s = ''; for (var k = 0; k < 11; k++) s += get(a, b + k) ? '1' : '0';
                    if (s === '10111010000' || s === '00001011101') p += 40;
                }
            }
        }
        lines(function (a, b) { return m[a][b]; });
        lines(function (a, b) { return m[b][a]; });
        for (r = 0; r < n - 1; r++) for (c = 0; c < n - 1; c++) { var v = m[r][c]; if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) p += 3; }
        for (r = 0; r < n; r++) for (c = 0; c < n; c++) if (m[r][c]) dark++;
        p += Math.max(0, Math.ceil(Math.abs(dark * 20 - n * n * 10) / (n * n)) - 1) * 10;
        return p;
    }

    function matrix(text) {
        var bytes = utf8(String(text)), ver;
        for (ver = 1; ver <= 10; ver++) { var t = EC_M[ver], cap = t[1] * t[2] + t[3] * t[4] - (ver < 10 ? 2 : 3); if (bytes.length <= cap) break; }
        if (ver > 10) return null;
        var words = codewords(bytes, ver), best = null, bestP = Infinity;
        for (var k = 0; k < 8; k++) { var mm = build(ver, words, k), p = penalty(mm); if (p < bestP) { bestP = p; best = mm; } }
        return best;
    }
    function svg(text, opt) {
        opt = opt || {};
        var m = matrix(text); if (!m) return '';
        var q = opt.quiet === undefined ? 4 : opt.quiet, n = m.length, size = n + 2 * q, d = '';
        for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (m[r][c]) d += 'M' + (c + q) + ' ' + (r + q) + 'h1v1h-1z';
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" shape-rendering="crispEdges">' +
               '<rect width="' + size + '" height="' + size + '" fill="' + (opt.light || '#fff') + '"/><path d="' + d + '" fill="' + (opt.dark || '#000') + '"/></svg>';
    }

    return { matrix: matrix, svg: svg };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = QR;
