/* Pictures of the live backgrounds (js/launcher/dynwall.js), drawn once on a canvas whenever what they show changes (every
 * 10 to 30 minutes at most), never per frame. Original art, made of shapes and gradients: nothing to download but the Earth
 * and Moon photos of NASA (public domain, wallpapers/*.jpg), read only while the Earth is drawn and dropped right after.
 *
 *   DynArt.weather(ctx, W, H, s)   s: { k (Weather condition), phase: 'night' | 'dawn' | 'day' | 'dusk', sunT (0..1 through the day),
 *                                       temp (°C), season, clouds (%), moon (age 0..1), wind, seed }
 *   DynArt.event(ctx, W, H, id, s) id: an Events id ('eidadha', 'greenmarch', 'ucl', ...) or 'season'
 *   DynArt.earth(ctx, W, H, day, night, s)   day / night: { w, h, d: Uint8ClampedArray } (equirectangular), s: { lat, lon, at, moon }
 *   DynArt.moonAge(ms), DynArt.sun(ms) -> { lat, lon } (degrees), DynArt.rainTile(kind) -> canvas (the moving layer) */
var DynArt = (function () {
    'use strict';

    var PI = Math.PI, TAU = PI * 2;

    function rng(seed) {
        var a = seed >>> 0;
        return function () {
            a = (a + 0x6D2B79F5) | 0;
            var t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
    function mul(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
    function rgba(c, a) { return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + (a === undefined ? 1 : +a.toFixed(3)) + ')'; }
    function lin(c, x0, y0, x1, y1, stops) {
        var g = c.createLinearGradient(x0, y0, x1, y1);
        for (var i = 0; i < stops.length; i += 2) g.addColorStop(stops[i], typeof stops[i + 1] === 'string' ? stops[i + 1] : rgba(stops[i + 1]));
        return g;
    }
    function glow(c, x, y, r, col, a, inner) {
        var g = c.createRadialGradient(x, y, inner || 0, x, y, r);
        g.addColorStop(0, rgba(col, a)); g.addColorStop(1, rgba(col, 0));
        c.fillStyle = g;
        c.fillRect(x - r, y - r, r * 2, r * 2);
    }
    function disc(c, x, y, r, fill) { c.beginPath(); c.arc(x, y, r, 0, TAU); c.fillStyle = fill; c.fill(); }
    function smooth(a, b, x) { var t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

    /* ---------------- shared pieces ---------------- */

    function stars(c, W, H, n, maxY, R, a) {
        for (var i = 0; i < n; i++) {
            var x = R() * W, y = Math.pow(R(), 1.3) * maxY, r = (R() < 0.08 ? 1.6 : 0.6 + R() * 0.8) * H / 1080;
            disc(c, x, y, r, rgba(R() < 0.15 ? [255, 236, 200] : [225, 235, 255], (0.35 + R() * 0.65) * (a === undefined ? 1 : a)));
        }
    }
    // a cumulus: puffs on a flat base, drawn on its own small canvas, lit from the sun's side (lx, ly), shaded underneath, soft edges.
    // flat > 0 makes a long, low layer (overcast, rain). Drawn once per background, never per frame.
    function cloud(c, x, y, w, col, shade, a, R, lx, ly, flat) {
        var h = w * (flat ? 0.28 : 0.5), pad = Math.ceil(w * 0.1), cw = Math.ceil(w + pad * 2), ch = Math.ceil(h + pad * 2);
        var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
        var g = cv.getContext('2d'), base = pad + h * 0.86, puffs = [], n = (flat ? 10 : 6) + ((R() * 5) | 0), i, r, px, py, t;
        for (i = 0; i < n; i++) {
            t = n > 1 ? i / (n - 1) : 0.5;
            var bulge = Math.sin(PI * (0.08 + 0.84 * t));
            r = w * (flat ? 0.05 + 0.07 * bulge : 0.07 + 0.15 * bulge) * (0.75 + R() * 0.5);
            px = pad + w * (0.08 + 0.84 * t) + (R() - 0.5) * w * 0.04;
            py = base - r * (0.5 + R() * 0.3);
            puffs.push([px, py, r]);
        }
        if (!flat) for (i = 0; i < 2 + ((R() * 3) | 0); i++) {      // the towers on top
            t = 0.3 + R() * 0.4; r = w * (0.08 + R() * 0.07);
            puffs.push([pad + w * t, base - h * (0.42 + R() * 0.22), r]);
        }
        var big = puffs.length;
        for (i = 0; i < big; i++) for (var j = 0; j < 3; j++) {
            var an = -PI * (0.15 + 0.7 * R()), pr = puffs[i][2];
            puffs.push([puffs[i][0] + Math.cos(an) * pr * 0.78, puffs[i][1] + Math.sin(an) * pr * 0.78, pr * (0.28 + R() * 0.22)]);
        }
        g.fillStyle = '#fff';
        for (i = 0; i < puffs.length; i++) { g.beginPath(); g.arc(puffs[i][0], puffs[i][1], puffs[i][2], 0, TAU); g.fill(); }
        g.globalCompositeOperation = 'destination-out';
        g.fillStyle = lin(g, 0, base - h * 0.06, 0, base + h * 0.04, [0, 'rgba(0,0,0,0)', 1, 'rgba(0,0,0,1)']);
        g.fillRect(0, base - h * 0.06, cw, ch);
        // body: lit top, darker belly
        g.globalCompositeOperation = 'source-atop';
        g.fillStyle = lin(g, 0, pad, 0, base, [0, mix(col, shade, 0.08), 0.5, mix(col, shade, 0.32), 1, shade]);
        g.fillRect(0, 0, cw, ch);
        // every puff a little round: light on the sun's side, shadow on the other
        var cx = x, cy = y, dx = (lx === undefined ? cx - w : lx) - cx, dy = (ly === undefined ? cy - w : ly) - cy, dl = Math.sqrt(dx * dx + dy * dy) || 1;
        dx /= dl; dy = Math.min(dy / dl, -0.35);
        for (i = 0; i < puffs.length; i++) {
            px = puffs[i][0]; py = puffs[i][1]; r = puffs[i][2];
            var hl = g.createRadialGradient(px + dx * r * 0.45, py + dy * r * 0.5, r * 0.05, px + dx * r * 0.2, py + dy * r * 0.2, r * 1.05);
            hl.addColorStop(0, rgba(col, i < big ? 0.7 : 0.5)); hl.addColorStop(0.55, rgba(col, 0.22)); hl.addColorStop(1, rgba(col, 0));
            g.fillStyle = hl; g.fillRect(px - r * 1.3, py - r * 1.3, r * 2.6, r * 2.6);
        }
        // the light through the thin edge (silver lining) on the sun's side
        g.globalCompositeOperation = 'source-atop';
        g.fillStyle = lin(g, pad + (dx > 0 ? w : 0), 0, pad + (dx > 0 ? 0 : w), 0, [0, rgba(mix(col, [255, 255, 255], 0.5), 0.35), 0.35, rgba(col, 0)]);
        g.fillRect(0, 0, cw, ch);
        c.save();
        c.globalAlpha = a;
        if ('filter' in c && !PX) c.filter = 'blur(' + Math.max(1, w * (flat ? 0.006 : 0.004)).toFixed(1) + 'px)';
        c.drawImage(cv, x - w / 2 - pad, y - (base - h * 0.5));
        c.restore();
    }
    // the sun: a wide warm bloom, a halo, soft rays and a bright core whose edge is a little darker (like the real one)
    function sunDisc(c, x, y, H, low, a) {
        c.save();
        c.globalCompositeOperation = 'lighter';
        glow(c, x, y, H * (low ? 0.75 : 0.6), low ? [255, 140, 70] : [255, 236, 190], (low ? 0.3 : 0.2) * a);
        glow(c, x, y, H * 0.26, low ? [255, 196, 130] : [255, 248, 222], 0.38 * a);
        var R = rng(7), n = 10;
        for (var i = 0; i < n; i++) {
            var an = (i / n) * TAU + R() * 0.2, len = H * (0.16 + R() * 0.2), wd = 0.012 + R() * 0.014;
            var gr = c.createRadialGradient(x, y, H * 0.03, x, y, len);
            gr.addColorStop(0, rgba([255, 246, 220], 0.09 * a)); gr.addColorStop(1, rgba([255, 246, 220], 0));
            c.fillStyle = gr;
            c.beginPath(); c.moveTo(x, y);
            c.arc(x, y, len, an - wd, an + wd); c.closePath(); c.fill();
        }
        glow(c, x, y, H * 0.085, [255, 252, 240], 0.75 * a);
        c.restore();
        var r = H * 0.042, core = c.createRadialGradient(x - r * 0.15, y - r * 0.15, 0, x, y, r);
        core.addColorStop(0, rgba([255, 255, 252], a)); core.addColorStop(0.7, rgba(low ? [255, 228, 180] : [255, 252, 236], a)); core.addColorStop(1, rgba(low ? [255, 176, 110] : [255, 236, 190], a));
        disc(c, x, y, r, core);
    }
    function ridgePath(c, W, H, y, amp, R, freq, sharp) {
        var p1 = R() * 6, p2 = R() * 6, p3 = R() * 6, f1 = (0.8 + R() * 0.6) * freq, f2 = (2.1 + R()) * freq, f3 = (5 + R() * 2) * freq;
        c.beginPath(); c.moveTo(0, H);
        for (var i = 0; i <= 120; i++) {
            var x = W * i / 120, t = i / 120, v;
            if (sharp) v = 0.65 * (1 - Math.abs(Math.sin(t * f1 * PI + p1))) + 0.25 * (1 - Math.abs(Math.sin(t * f2 * PI + p2))) + 0.1 * Math.sin(t * f3 * TAU + p3);
            else v = 0.6 * Math.sin(t * f1 * TAU + p1) + 0.3 * Math.sin(t * f2 * TAU + p2) + 0.1 * Math.sin(t * f3 * TAU + p3);
            c.lineTo(x, y - amp * v);
        }
        c.lineTo(W, H); c.closePath();
    }
    function ridge(c, W, H, y, amp, top, bot, R, freq, sharp, snow, lit) {
        var s = R(); ridgePath(c, W, H, y, amp, rng(s * 1e9), freq, sharp);
        c.fillStyle = lin(c, 0, y - amp, 0, H, [0, top, 1, bot]);
        c.fill();
        if (lit) {          // { x, col, a }: the side that faces the sun is lighter, the far side a little darker
            c.save(); ridgePath(c, W, H, y, amp, rng(s * 1e9), freq, sharp); c.clip();
            c.fillStyle = lin(c, lit.x - W * 0.7, 0, lit.x + W * 0.7, 0, [0, rgba([0, 0, 0], lit.a * 0.5), 0.5, rgba(lit.col, lit.a), 1, rgba([0, 0, 0], lit.a * 0.5)]);
            c.fillRect(0, y - amp * 1.2, W, H);
            c.fillStyle = lin(c, 0, y - amp, 0, y + amp * 0.6, [0, rgba(lit.col, lit.a * 0.6), 1, rgba(lit.col, 0)]);   // light on the crests
            c.fillRect(0, y - amp * 1.2, W, amp * 1.8);
            c.restore();
        }
        if (snow) {
            c.save(); ridgePath(c, W, H, y, amp, rng(s * 1e9), freq, sharp); c.clip();
            c.fillStyle = lin(c, 0, y - amp, 0, y + amp * 0.1, [0, rgba(snow, 0.95), 0.55, rgba(snow, 0.55), 1, rgba(snow, 0)]);
            c.fillRect(0, y - amp * 1.2, W, amp * 1.4);
            c.restore();
        }
    }
    // the Moon seen from Earth: age 0 = new, 0.5 = full (lit on the right while it grows)
    function moonDisc(c, x, y, r, age, lit, dark) {
        disc(c, x, y, r, rgba(dark));
        var k = Math.cos(age * TAU), wax = age < 0.5;
        c.beginPath();
        if (wax) c.arc(x, y, r, -PI / 2, PI / 2, false); else c.arc(x, y, r, PI / 2, PI * 1.5, false);
        if (wax) c.ellipse(x, y, r * Math.abs(k), r, 0, PI / 2, -PI / 2, k > 0);
        else c.ellipse(x, y, r * Math.abs(k), r, 0, PI * 1.5, PI / 2, k > 0);
        c.fillStyle = rgba(lit); c.fill();
        // a few seas, only on the lit part
        c.save(); c.clip();
        var R = rng(7);
        for (var i = 0; i < 6; i++) disc(c, x + (R() - 0.6) * r * 1.1, y + (R() - 0.5) * r * 1.1, r * (0.12 + R() * 0.18), rgba(mul(lit, 0.82), 0.6));
        c.restore();
    }
    function crescent(c, x, y, r, col, tilt) {
        var cv = document.createElement('canvas'), s = Math.ceil(r * 2.4);
        cv.width = cv.height = s;
        var g = cv.getContext('2d');
        g.fillStyle = lin(g, 0, 0, s, s, [0, rgba(mix(col, [255, 255, 255], 0.35)), 1, rgba(col)]);
        g.beginPath(); g.arc(s / 2, s / 2, r, 0, TAU); g.fill();
        g.globalCompositeOperation = 'destination-out';
        g.beginPath(); g.arc(s / 2 + r * 0.42 * Math.cos(tilt), s / 2 - r * 0.42 * Math.sin(tilt), r * 0.86, 0, TAU); g.fill();
        glow(c, x, y, r * 2.2, col, 0.22);
        c.drawImage(cv, x - s / 2, y - s / 2);
        cv.width = cv.height = 0;
    }
    function starPath(c, x, y, r, n, inner, rot) {
        c.beginPath();
        for (var i = 0; i < n * 2; i++) {
            var a = rot + i * PI / n, rr = i % 2 ? r * inner : r;
            if (i) c.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a)); else c.moveTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
        }
        c.closePath();
    }
    // the eight-pointed star of Moroccan zellige, as a faint repeated pattern
    function zellige(c, W, H, size, col, a) {
        c.save();
        c.strokeStyle = rgba(col, a); c.lineWidth = Math.max(1, size * 0.04);
        for (var y = size / 2; y < H + size; y += size) {
            for (var x = ((y / size) % 2 ? size : size / 2); x < W + size; x += size) {
                c.strokeRect(x - size * 0.25, y - size * 0.25, size * 0.5, size * 0.5);
                c.save(); c.translate(x, y); c.rotate(PI / 4); c.strokeRect(-size * 0.25, -size * 0.25, size * 0.5, size * 0.5); c.restore();
            }
        }
        c.restore();
    }
    function rain(c, W, H, n, wind, col, a, R, top) {
        c.strokeStyle = rgba(col, a); c.lineWidth = Math.max(1, H / 900); c.lineCap = 'round';
        c.beginPath();
        var L = H * 0.035, dx = wind * L;
        for (var i = 0; i < n; i++) { var x = R() * (W + 200) - 100, y = (top || 0) + R() * (H - (top || 0)); c.moveTo(x, y); c.lineTo(x + dx, y + L * (0.6 + R() * 0.6)); }
        c.stroke();
    }
    function snow(c, W, H, n, R, a) {
        for (var i = 0; i < n; i++) { var r = (1 + R() * 3) * H / 1080; disc(c, R() * W, R() * H, r, rgba([255, 255, 255], (0.5 + R() * 0.5) * (a || 1))); }
    }
    function fog(c, W, H, a, R) {
        for (var i = 0; i < 6; i++) {
            var y = H * (0.45 + i * 0.09 + R() * 0.03);
            c.fillStyle = lin(c, 0, y - H * 0.08, 0, y + H * 0.08, [0, 'rgba(220,225,232,0)', 0.5, rgba([220, 225, 232], a), 1, 'rgba(220,225,232,0)']);
            c.fillRect(0, y - H * 0.08, W, H * 0.16);
        }
    }
    function bolt(c, x, y, len, R) {
        var pts = [[x, y]], cx = x, cy = y;
        while (cy < y + len) { cx += (R() - 0.5) * len * 0.18; cy += len * (0.06 + R() * 0.08); pts.push([cx, cy]); }
        c.save();
        c.shadowColor = 'rgba(190,210,255,0.9)'; c.shadowBlur = len * 0.06;
        c.strokeStyle = 'rgba(245,248,255,0.95)'; c.lineWidth = Math.max(2, len * 0.008); c.lineJoin = 'round';
        c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
        for (var i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
        c.stroke();
        c.restore();
    }
    function tree(c, x, y, h, kind, col, trunk) {
        c.fillStyle = rgba(trunk);
        if (kind === 'palm') {
            c.save(); c.strokeStyle = rgba(trunk); c.lineWidth = h * 0.05; c.lineCap = 'round';
            c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + h * 0.12, y - h * 0.5, x + h * 0.05, y - h); c.stroke();
            c.fillStyle = rgba(col);
            for (var i = 0; i < 7; i++) {
                var a = -PI / 2 + (i - 3) * 0.48, tx = x + h * 0.05, ty = y - h;
                c.beginPath(); c.moveTo(tx, ty);
                c.quadraticCurveTo(tx + Math.cos(a - 0.4) * h * 0.4, ty + Math.sin(a - 0.4) * h * 0.4 - h * 0.05, tx + Math.cos(a) * h * 0.5, ty + Math.sin(a) * h * 0.5 + h * 0.12);
                c.quadraticCurveTo(tx + Math.cos(a + 0.2) * h * 0.3, ty + Math.sin(a + 0.2) * h * 0.3, tx, ty);
                c.fill();
            }
            c.restore();
            return;
        }
        c.fillRect(x - h * 0.03, y - h * 0.45, h * 0.06, h * 0.45);
        if (kind === 'pine') {
            c.fillStyle = rgba(col);
            for (var k = 0; k < 3; k++) { c.beginPath(); c.moveTo(x, y - h * (1 - k * 0.2)); c.lineTo(x + h * (0.18 + k * 0.06), y - h * (0.45 - k * 0.12)); c.lineTo(x - h * (0.18 + k * 0.06), y - h * (0.45 - k * 0.12)); c.fill(); }
            return;
        }
        if (kind === 'bare') {
            c.strokeStyle = rgba(trunk); c.lineWidth = h * 0.02;
            c.beginPath();
            for (var b = 0; b < 5; b++) { var by = y - h * (0.45 + b * 0.1); c.moveTo(x, by); c.lineTo(x + (b % 2 ? 1 : -1) * h * 0.2, by - h * 0.15); }
            c.stroke();
            return;
        }
        disc(c, x, y - h * 0.65, h * 0.3, rgba(col));
        disc(c, x - h * 0.15, y - h * 0.55, h * 0.2, rgba(mul(col, 0.9)));
        disc(c, x + h * 0.15, y - h * 0.58, h * 0.22, rgba(mul(col, 1.05)));
    }

    /* ---------------- live weather ---------------- */

    var SEASON = {
        spring: { far: [118, 150, 170], hills: [[110, 168, 92], [84, 146, 72], [62, 120, 60]], tree: 'round', leaf: [70, 140, 64] },
        summer: { far: [150, 140, 150], hills: [[196, 180, 104], [170, 156, 80], [138, 128, 64]], tree: 'palm', leaf: [64, 120, 60] },
        autumn: { far: [140, 120, 130], hills: [[188, 126, 70], [160, 98, 54], [120, 74, 46]], tree: 'round', leaf: [214, 110, 40] },
        winter: { far: [120, 136, 160], hills: [[118, 140, 120], [96, 120, 102], [74, 98, 84]], tree: 'pine', leaf: [44, 86, 66] }
    };
    var OVERCAST = { clear: 0, partly: 0.15, cloudy: 0.7, fog: 0.55, drizzle: 0.65, rain: 0.8, showers: 0.7, snow: 0.7, storm: 0.95 };

    function weather(c, W, H, s) {
        var R = rng(s.seed || 1), o = OVERCAST[s.k] !== undefined ? OVERCAST[s.k] : 0.4, ph = s.phase, night = ph === 'night';
        var top, bot, hor;
        if (ph === 'day') { top = [40, 112, 210]; bot = [150, 204, 255]; hor = [205, 230, 255]; }
        else if (ph === 'dawn') { top = [44, 58, 120]; bot = [236, 150, 128]; hor = [255, 212, 160]; }
        else if (ph === 'dusk') { top = [38, 30, 88]; bot = [220, 98, 104]; hor = [255, 170, 104]; }
        else { top = [4, 9, 28]; bot = [20, 32, 70]; hor = [34, 46, 88]; }
        var grey = night ? [[14, 18, 26], [32, 38, 50]] : s.k === 'storm' ? [[44, 50, 60], [84, 92, 102]] : [[112, 124, 138], [176, 186, 196]];
        top = mix(top, grey[0], o); bot = mix(bot, grey[1], o); hor = mix(hor, grey[1], o);
        if (!night && s.temp >= 30) { bot = mix(bot, [255, 222, 168], 0.35); hor = mix(hor, [255, 230, 180], 0.45); }
        if (!night && s.temp <= 3) { top = mix(top, [150, 180, 214], 0.2); bot = mix(bot, [214, 228, 242], 0.3); }
        c.fillStyle = lin(c, 0, 0, 0, H, [0, mul(top, 0.92), 0.3, mix(top, bot, 0.45), 0.6, bot, 0.76, hor, 1, hor]);
        c.fillRect(0, 0, W, H);
        // where the sun is (also behind thin clouds): the sky around it is lighter, and at dawn / dusk the horizon glows under it
        var t = Math.max(0, Math.min(1, s.sunT === undefined ? 0.5 : s.sunT)), sx = W * (0.12 + 0.76 * t), sy = H * (0.66 - 0.5 * Math.sin(PI * t)), low = ph !== 'day';
        if (!night) {
            c.save(); c.globalCompositeOperation = 'lighter';
            glow(c, sx, sy, H * 1.1, low ? [120, 60, 30] : [60, 70, 70], 0.55 * Math.max(0, 1 - o * 1.2));
            if (low) { c.save(); c.translate(sx, H * 0.62); c.scale(3.2, 1); glow(c, 0, 0, H * 0.28, [255, 120, 60], 0.35 * (1 - o * 0.6)); c.restore(); }
            c.restore();
        }

        if (night && o < 0.6) stars(c, W, H, Math.round(220 * (1 - o * 1.6)), H * 0.62, R, 1 - o);
        // the sun along its arc (sunT 0 = sunrise, 1 = sunset), the moon at night
        if (!night && o < 0.85) {
            sunDisc(c, sx, sy, H, low, 1 - o);
        }
        if (night && o < 0.9) {
            var mx = W * 0.74, my = H * 0.2, mr = H * 0.05;
            glow(c, mx, my, mr * 5, [190, 205, 240], 0.18 * (1 - o));
            c.globalAlpha = 1 - o * 0.8;
            moonDisc(c, mx, my, mr, s.moon === undefined ? 0.5 : s.moon, [236, 236, 226], [40, 46, 64]);
            c.globalAlpha = 1;
        }

        // far mountains (the Atlas), then three hills of the season
        var se = SEASON[s.season] || SEASON.spring, light = night ? 0.28 : ph === 'day' ? 1 : 0.68, tint = night ? [40, 60, 110] : ph === 'day' ? [255, 255, 255] : [255, 170, 140];
        light *= 1 - o * 0.3;
        function shade(col) { return mix(mul(col, light), mul(tint, light), night ? 0.35 : ph === 'day' ? 0 : 0.18); }
        var snowy = s.k === 'snow' || s.temp <= 1, capSnow = s.season === 'winter' || s.temp <= 8 || s.k === 'snow';
        var farCol = mix(shade(se.far), hor, 0.45);
        var lit = night ? null : { x: sx, col: low ? [255, 170, 110] : [255, 248, 230], a: 0.22 * (1 - o * 0.8) };
        var backCol = mix(farCol, hor, 0.45);
        ridge(c, W, H, H * 0.56, H * 0.12, backCol, mix(backCol, hor, 0.5), R, 2.3, true, capSnow ? mix([240, 244, 250], backCol, night ? 0.6 : 0.3) : null, lit);
        ridge(c, W, H, H * 0.6, H * 0.16, farCol, mix(farCol, bot, 0.3), R, 1.6, true, capSnow ? mix([240, 244, 250], farCol, night ? 0.6 : 0.1) : null, lit);
        c.fillStyle = lin(c, 0, H * 0.6, 0, H * 0.74, [0, rgba(hor, 0), 1, rgba(hor, night ? 0.12 : 0.35)]);   // haze at the foot of the mountains
        c.fillRect(0, H * 0.6, W, H * 0.14);
        if (s.k === 'fog' || s.k === 'drizzle' || o > 0.5) { c.fillStyle = lin(c, 0, H * 0.4, 0, H * 0.75, [0, rgba(hor, 0), 1, rgba(hor, 0.35 * o + 0.1)]); c.fillRect(0, H * 0.4, W, H * 0.35); }
        var hl = se.hills, snowCol = [236, 242, 250];
        for (var i = 0; i < 3; i++) {
            var hc = snowy ? mix(mix(snowCol, shade(snowCol), night ? 1 : 0.5), shade(hl[i]), 0.12 + i * 0.05) : shade(hl[i]);
            ridge(c, W, H, H * (0.72 + i * 0.08), H * (0.05 - i * 0.008), mix(hc, mul(tint, light), 0.1), mul(hc, 0.78), R, 1 + i * 0.4, false, null, lit && { x: lit.x, col: lit.col, a: lit.a * 0.6 });
            if (i === 1) {
                // a few trees on the middle hill
                var tc = snowy ? mix(shade(se.leaf), shade(snowCol), 0.5) : shade(se.leaf), tk = shade([70, 52, 40]);
                for (var j = 0; j < 7; j++) { var tx = W * (0.08 + R() * 0.84); tree(c, tx, H * (0.8 + R() * 0.03), H * (0.06 + R() * 0.05), s.season === 'winter' && !snowy && s.temp > 8 ? 'round' : se.tree, tc, tk); }
            }
        }
        if (s.season === 'spring' && !snowy && !night) {
            for (var f = 0; f < 140; f++) disc(c, R() * W, H * (0.9 + R() * 0.1), H * 0.0035, rgba([[255, 214, 230], [255, 236, 120], [255, 255, 255]][f % 3], 0.85 * light));
        }
        if (s.season === 'autumn' && !night && o < 0.5) for (var l = 0; l < 40; l++) { c.save(); c.translate(R() * W, H * (0.3 + R() * 0.6)); c.rotate(R() * TAU); c.fillStyle = rgba(mix([220, 120, 40], [180, 60, 30], R()), 0.8); c.beginPath(); c.ellipse(0, 0, H * 0.008, H * 0.004, 0, 0, TAU); c.fill(); c.restore(); }
        if (!night && s.temp >= 33) { c.fillStyle = lin(c, 0, H * 0.55, 0, H * 0.8, [0, 'rgba(255,220,160,0)', 0.6, 'rgba(255,210,150,0.22)', 1, 'rgba(255,220,160,0)']); c.fillRect(0, H * 0.55, W, H * 0.25); }

        // clouds: how many from the cloud cover, colour from the light
        var n = s.k === 'clear' ? Math.round((s.clouds || 0) / 25) : s.k === 'partly' ? 4 : 7 + Math.round(o * 5);
        var cc, cs, ca = 0.9;
        if (s.k === 'storm') { cc = [92, 98, 110]; cs = [36, 40, 50]; }
        else if (night) { cc = [64, 74, 100]; cs = [18, 24, 40]; ca = 0.75; }
        else if (ph !== 'day') { cc = [255, 196, 180]; cs = [110, 80, 120]; }
        else if (o > 0.5) { cc = [214, 218, 226]; cs = [128, 136, 150]; }
        else { cc = [255, 255, 255]; cs = [176, 192, 214]; }
        var lx = night ? W * 0.74 : sx, ly = night ? H * 0.2 : sy, ys = [];
        if (o > 0.5) {
            var deck = /^(rain|showers|storm|drizzle|snow)$/.test(s.k) ? 0.68 : 0.5;     // rain: the grey comes down to the mountains
            c.fillStyle = lin(c, 0, 0, 0, H * deck, [0, rgba(mix(cs, cc, 0.3), 0.85), 0.6, rgba(mix(cs, cc, 0.5), 0.5), 1, rgba(mix(cs, cc, 0.6), 0)]);
            c.fillRect(0, 0, W, H * deck);
            for (var dk = -0.1; dk < 1.1; dk += 0.16) cloud(c, W * (dk + R() * 0.06), H * (0.04 + R() * 0.14), W * (0.3 + R() * 0.12), mix(cc, cs, 0.2), cs, ca, R, lx, ly, true);
        }
        for (var k = 0; k < n; k++) ys.push(H * (0.06 + R() * (o > 0.5 ? 0.3 : 0.28)));
        ys.sort(function (p, q) { return p - q; });                  // far (high) clouds first, near ones over them
        for (k = 0; k < n; k++) {
            var near = ys[k] / (H * 0.36), cw2 = W * (0.14 + R() * 0.12) * (0.7 + near * 0.6) * (o > 0.5 ? 1.5 : 1);
            cloud(c, W * (R() * 1.1 - 0.05), ys[k], cw2, cc, cs, ca, R, lx, ly, o > 0.5 && k % 2 === 0);
        }
        if (o > 0.6) { c.fillStyle = lin(c, 0, 0, 0, H * 0.4, [0, rgba(cs, 0.55), 1, rgba(cs, 0)]); c.fillRect(0, 0, W, H * 0.4); }

        if (s.k === 'storm') bolt(c, W * (0.3 + R() * 0.4), H * 0.18, H * 0.5, R);
        wet(c, W, H, s, R, PX ? 0.06 : 1, true);
    }
    // what falls on the picture (drawn styles and photos alike): still rain or snow, fog, then the raindrops on the glass
    function wet(c, W, H, s, R, k, withFog) {
        var still = (s.motion ? 0.45 : 1) * k;
        if (s.k === 'rain' || s.k === 'storm') rain(c, W, H, Math.round(1400 * still), s.wind || -0.25, [222, 232, 248], 0.5 * still, R, H * 0.1);
        else if (s.k === 'showers') rain(c, W, H, Math.round(1000 * still), s.wind || -0.2, [222, 232, 248], 0.45 * still, R, H * 0.12);
        else if (s.k === 'drizzle') rain(c, W, H, Math.round(600 * still), -0.1, [226, 232, 244], 0.35 * still, R, H * 0.16);
        else if (s.k === 'snow' && !s.motion) snow(c, W, H, Math.round(420 * k), R);
        if (withFog && s.k === 'fog') fog(c, W, H, 0.4, R);
        if (s.glass && !PX && /^(rain|showers|drizzle|storm)$/.test(s.k)) glass(c, W, H, s.glass, rng((s.seed || 1) + 77));
    }
    /* Realistic and Custom styles: a photo of that weather (js/launcher/dynwall-photos.js picks it), filling the screen (cover), a soft
     * shade at the top and bottom so icons and the caption stay readable, then the same rain / snow / glass as the drawn style
     * (lighter: the photo already shows its weather). */
    function photo(c, W, H, img, s) {
        var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height, sc = Math.max(W / iw, H / ih), dw = iw * sc, dh = ih * sc;
        c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
        c.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
        c.fillStyle = lin(c, 0, 0, 0, H, [0, 'rgba(0,0,0,0.22)', 0.25, 'rgba(0,0,0,0)', 0.8, 'rgba(0,0,0,0)', 1, 'rgba(0,0,0,0.25)']);
        c.fillRect(0, 0, W, H);
        wet(c, W, H, s, rng(s.seed || 1), 0.55, false);
    }
    /* Raindrops on the glass (owner request 2026-11-09): the picture as seen through a wet window. Each drop is a small lens that shows
     * the scene around it upside down (as real drops do), with a dark rim, a bright spot and a few running trails; tiny mist dots
     * between them; on High the scene behind is a little soft. Drawn once with the picture (one copy of the canvas), never per frame. */
    var GLASS = { low: [40, 250, 2, 0], medium: [90, 700, 6, 1.5], high: [170, 1400, 14, 3] };   // drops, mist dots, trails, blur behind
    function glass(c, W, H, level, R) {
        var g = GLASS[level]; if (!g) return;
        var u = H / 1080, src = document.createElement('canvas'), sc, i;
        src.width = W; src.height = H; sc = src.getContext('2d'); sc.drawImage(c.canvas, 0, 0);
        if (g[3] && 'filter' in c) { c.save(); c.filter = 'blur(' + (g[3] * u).toFixed(1) + 'px)'; c.drawImage(src, 0, 0); c.restore(); }
        c.fillStyle = 'rgba(225,232,240,' + (0.04 + g[3] * 0.02).toFixed(2) + ')'; c.fillRect(0, 0, W, H);      // the glass is a little misted
        for (i = 0; i < g[1]; i++) {                                     // mist: tiny dots that catch the light
            var mx = R() * W, my = R() * H, mr = (0.6 + R() * 1.4) * u;
            disc(c, mx, my, mr, 'rgba(255,255,255,' + (0.08 + R() * 0.14).toFixed(2) + ')');
        }
        for (i = 0; i < g[2]; i++) {                                     // running trails: a thin wet line with a drop at its foot
            var tx = R() * W, ty = H * (0.1 + R() * 0.6), tl = H * (0.08 + R() * 0.22);
            c.fillStyle = lin(c, 0, ty, 0, ty + tl, [0, 'rgba(255,255,255,0)', 1, 'rgba(255,255,255,0.22)']);
            c.fillRect(tx - 2.5 * u, ty, 5 * u, tl);
            drop(c, src, tx, ty + tl, (9 + R() * 6) * u, R);
        }
        for (i = 0; i < g[0]; i++) {
            var big = R(), r = (4 + Math.pow(big, 2) * 22) * u;
            drop(c, src, R() * W, R() * H, r, R);
        }
    }
    function drop(c, src, x, y, r, R) {
        var rx = r * (0.85 + R() * 0.2), ry = r * (0.95 + R() * 0.25), k = 4;       // a drop shows a wide, flipped view of the scene
        c.save();
        c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, TAU); c.clip();
        c.translate(x, y); c.scale(1, -1);
        c.drawImage(src, x - rx * k, y - ry * k, rx * k * 2, ry * k * 2, -rx, -ry, rx * 2, ry * 2);
        c.restore();
        var rim = c.createRadialGradient(x, y, Math.min(rx, ry) * 0.55, x, y, Math.max(rx, ry));
        rim.addColorStop(0, 'rgba(0,0,0,0)'); rim.addColorStop(0.7, 'rgba(0,0,0,0.1)'); rim.addColorStop(1, 'rgba(0,0,0,0.45)');
        c.fillStyle = rim; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, TAU); c.fill();
        disc(c, x - rx * 0.32, y - ry * 0.38, Math.max(0.8, r * 0.2), 'rgba(255,255,255,0.75)');               // the light on it
        c.fillStyle = 'rgba(255,255,255,0.22)'; c.beginPath(); c.ellipse(x + rx * 0.15, y + ry * 0.55, rx * 0.45, ry * 0.18, 0, 0, TAU); c.fill();
    }
    // the moving layer (tile of 256 px): rain or snow that slides down with a CSS transform (composited, no repaint)
    // the moving layer (one square tile, slid down by a CSS transform: composited, no repaint): long bright streaks for rain,
    // soft flakes for snow; near drops longer and brighter than far ones (owner report 2026-11-09: the old tile was too faint to see)
    function rainTile(kind, size) {
        var cv = document.createElement('canvas'), c, R = rng(kind === 'snow' ? 11 : 5), i;
        cv.width = cv.height = size;
        c = cv.getContext('2d');
        if (kind === 'snow') {
            for (i = 0; i < 90; i++) {
                var x = R() * size, y = R() * size, r = 1.5 + Math.pow(R(), 2) * 4.5, g = c.createRadialGradient(x, y, 0, x, y, r);
                g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.6, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
                c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
            }
            return cv;
        }
        var n = kind === 'drizzle' ? 70 : kind === 'showers' ? 110 : 150, lmax = kind === 'drizzle' ? 26 : 60, dx = -0.12;
        c.lineCap = 'round';
        for (i = 0; i < n; i++) {
            var near = R(), L = lmax * (0.35 + 0.65 * near), x0 = R() * size, y0 = R() * size, a = 0.25 + 0.55 * near;
            for (var w = 0; w < 2; w++) {              // drawn twice so a drop cut by the tile's edge comes back on the other side
                var yy = y0 - w * size;
                var gr = c.createLinearGradient(x0, yy, x0 + dx * L, yy + L);
                gr.addColorStop(0, 'rgba(220,232,250,0)'); gr.addColorStop(1, 'rgba(235,242,255,' + a.toFixed(2) + ')');
                c.strokeStyle = gr; c.lineWidth = 1 + near * 1.6;
                c.beginPath(); c.moveTo(x0, yy); c.lineTo(x0 + dx * L, yy + L); c.stroke();
            }
        }
        return cv;
    }

    /* ---------------- holidays and events ---------------- */

    // Moroccan skyline: a square minaret with its lantern and three gold balls, domes, lit arches
    function skyline(c, W, H, col, win) {
        var base = H * 0.86, R = rng(3);
        c.fillStyle = rgba(col);
        c.fillRect(0, base, W, H - base);
        // houses and domes
        for (var x = 0; x < W; x += W * 0.07) {
            var w = W * (0.05 + R() * 0.04), h = H * (0.05 + R() * 0.07);
            c.fillRect(x, base - h, w, h + 2);
            if (R() < 0.35) { c.beginPath(); c.arc(x + w / 2, base - h, w * 0.4, PI, 0); c.fill(); }
            if (win) for (var k = 0; k < 2; k++) if (R() < 0.6) { var wx = x + w * (0.2 + k * 0.4), wy = base - h * 0.6; c.fillStyle = rgba(win, 0.85); c.fillRect(wx, wy, w * 0.16, h * 0.3); c.beginPath(); c.arc(wx + w * 0.08, wy, w * 0.08, PI, 0); c.fill(); c.fillStyle = rgba(col); }
        }
        // the minaret
        var mx = W * 0.42, mw = W * 0.04, mh = H * 0.5, my = base - mh;
        c.fillRect(mx - mw / 2, my, mw, mh);
        for (var m = 0; m < 4; m++) c.fillRect(mx - mw / 2 + m * mw / 3.4, my - mw * 0.14, mw * 0.18, mw * 0.16);
        c.fillRect(mx - mw * 0.22, my - mw * 0.75, mw * 0.44, mw * 0.75);
        c.beginPath(); c.arc(mx, my - mw * 0.75, mw * 0.22, PI, 0); c.fill();
        c.fillRect(mx - mw * 0.02, my - mw * 1.25, mw * 0.04, mw * 0.3);
        for (var b = 0; b < 3; b++) disc(c, mx, my - mw * (1.02 + b * 0.12), mw * (0.07 - b * 0.015), rgba([226, 186, 96]));
        if (win) {
            c.fillStyle = rgba(win, 0.75);
            for (var r = 0; r < 3; r++) { var wy2 = my + mh * (0.15 + r * 0.25); c.fillRect(mx - mw * 0.1, wy2, mw * 0.2, mh * 0.08); c.beginPath(); c.arc(mx, wy2, mw * 0.1, PI, 0); c.fill(); }
        }
        // a big dome
        c.fillStyle = rgba(col);
        c.beginPath(); c.arc(W * 0.53, base - H * 0.06, W * 0.06, PI, 0); c.fill();
        c.fillRect(W * 0.47, base - H * 0.06, W * 0.12, H * 0.06);
    }
    function lantern(c, x, y, len, s, warm) {
        c.strokeStyle = 'rgba(220,180,110,0.6)'; c.lineWidth = Math.max(1, s * 0.03);
        c.beginPath(); c.moveTo(x, 0); c.lineTo(x, y - s * 0.6); c.stroke();
        glow(c, x, y, s * 2.2, warm, 0.28);
        c.fillStyle = 'rgba(150,108,48,1)';
        c.beginPath(); c.moveTo(x, y - s * 0.75); c.lineTo(x + s * 0.32, y - s * 0.45); c.lineTo(x - s * 0.32, y - s * 0.45); c.fill();
        c.fillStyle = lin(c, x - s * 0.35, 0, x + s * 0.35, 0, [0, rgba(mix(warm, [120, 60, 20], 0.4)), 0.5, rgba(mix(warm, [255, 255, 220], 0.3)), 1, rgba(mix(warm, [120, 60, 20], 0.4))]);
        c.beginPath(); c.moveTo(x - s * 0.32, y - s * 0.45); c.lineTo(x + s * 0.32, y - s * 0.45); c.lineTo(x + s * 0.25, y + s * 0.35); c.lineTo(x, y + s * 0.6); c.lineTo(x - s * 0.25, y + s * 0.35); c.closePath(); c.fill();
        c.strokeStyle = 'rgba(150,108,48,0.9)'; c.lineWidth = Math.max(1, s * 0.04);
        c.beginPath(); c.moveTo(x, y - s * 0.45); c.lineTo(x, y + s * 0.6); c.moveTo(x - s * 0.3, y); c.lineTo(x + s * 0.3, y); c.stroke();
    }
    var ISLAMIC = {
        eidfitr: { top: [24, 18, 70], bot: [86, 44, 120], gold: [244, 204, 112], lanterns: true },
        eidadha: { top: [6, 40, 40], bot: [18, 96, 82], gold: [240, 206, 120], lanterns: true },
        ramadan: { top: [6, 12, 44], bot: [34, 38, 100], gold: [250, 196, 96], lanterns: true },
        mawlid: { top: [4, 44, 30], bot: [20, 110, 70], gold: [250, 220, 140], rays: true },
        hijri: { top: [8, 30, 54], bot: [24, 84, 110], gold: [236, 214, 160] }
    };
    function islamic(c, W, H, id, R) {
        var p = ISLAMIC[id];
        c.fillStyle = lin(c, 0, 0, 0, H, [0, p.top, 1, p.bot]); c.fillRect(0, 0, W, H);
        zellige(c, W, H, H * 0.16, p.gold, 0.06);
        stars(c, W, H, 140, H * 0.7, R, 0.8);
        if (p.rays) { c.save(); c.globalCompositeOperation = 'lighter'; for (var i = 0; i < 16; i++) { var a = i * TAU / 16; c.fillStyle = 'rgba(250,230,160,0.05)'; c.beginPath(); c.moveTo(W * 0.7, H * 0.3); c.lineTo(W * 0.7 + Math.cos(a) * W, H * 0.3 + Math.sin(a) * W); c.lineTo(W * 0.7 + Math.cos(a + 0.12) * W, H * 0.3 + Math.sin(a + 0.12) * W); c.fill(); } c.restore(); }
        crescent(c, W * 0.7, H * 0.3, H * 0.15, p.gold, PI * 0.15);
        c.fillStyle = rgba(p.gold); starPath(c, W * 0.7 + H * 0.02, H * 0.27, H * 0.035, 5, 0.42, -PI / 2); c.fill();
        if (p.lanterns) { var xs = [0.3, 0.35, 0.56, 0.6], ys = [0.4, 0.3, 0.32, 0.44]; for (var l = 0; l < xs.length; l++) lantern(c, W * xs[l], H * ys[l], 0, H * 0.06, [255, 190, 90]); }
        skyline(c, W, H, mul(p.top, 0.6), [255, 200, 110]);
    }
    function pentagram(c, x, y, r, col, w) {
        c.save(); c.strokeStyle = rgba(col); c.lineWidth = w; c.lineJoin = 'miter';
        c.beginPath();
        for (var i = 0; i <= 5; i++) { var a = -PI / 2 + (i * 2 % 5) * TAU / 5; if (i) c.lineTo(x + r * Math.cos(a), y + r * Math.sin(a)); else c.moveTo(x + r * Math.cos(a), y + r * Math.sin(a)); }
        c.closePath(); c.stroke(); c.restore();
    }
    function national(c, W, H, id, R) {
        // the flag waving: red with soft folds, the green star
        c.fillStyle = '#b8212b'; c.fillRect(0, 0, W, H);
        c.fillStyle = lin(c, 0, 0, W, H * 0.4, [0, 'rgba(0,0,0,0.25)', 0.18, 'rgba(255,255,255,0.06)', 0.34, 'rgba(0,0,0,0.18)', 0.52, 'rgba(255,255,255,0.08)', 0.7, 'rgba(0,0,0,0.2)', 0.86, 'rgba(255,255,255,0.05)', 1, 'rgba(0,0,0,0.3)']);
        c.fillRect(0, 0, W, H);
        var cy = id === 'greenmarch' ? H * 0.4 : H * 0.47, r = H * (id === 'greenmarch' ? 0.2 : 0.26);
        glow(c, W / 2, cy, r * 2, [255, 120, 110], 0.15);
        pentagram(c, W / 2, cy, r, [0, 98, 51], H * 0.03);
        if (id === 'throne') {
            // a gold keyhole arch around the star
            c.save(); c.strokeStyle = 'rgba(236,196,104,0.9)'; c.lineWidth = H * 0.012;
            c.beginPath(); c.moveTo(W / 2 - r * 1.25, H); c.lineTo(W / 2 - r * 1.25, cy); c.arc(W / 2, cy, r * 1.4, PI + 0.45, -0.45); c.lineTo(W / 2 + r * 1.25, H); c.stroke();
            c.restore();
            zellige(c, W, H, H * 0.12, [236, 196, 104], 0.08);
        }
        if (id === 'greenmarch' || id === 'oued' || id === 'unity') {
            // the Sahara: golden dunes
            for (var i = 0; i < 3; i++) ridge(c, W, H, H * (0.74 + i * 0.08), H * 0.05, mix([230, 180, 110], [190, 120, 60], i / 2), mix([200, 140, 80], [140, 80, 40], i / 2), R, 0.8 + i * 0.3, false, null);
        }
        if (id === 'youth' || id === 'independence') {
            for (var k = 0; k < 160; k++) { c.save(); c.translate(R() * W, R() * H); c.rotate(R() * PI); c.fillStyle = rgba([[255, 255, 255], [0, 140, 70], [250, 210, 90]][k % 3], 0.75); c.fillRect(-H * 0.006, -H * 0.003, H * 0.012, H * 0.006); c.restore(); }
        }
    }
    function amazigh(c, W, H) {
        c.fillStyle = '#0a72c4'; c.fillRect(0, 0, W, H / 3 + 1);
        c.fillStyle = '#3aa349'; c.fillRect(0, H / 3, W, H / 3 + 1);
        c.fillStyle = '#f7cd16'; c.fillRect(0, H * 2 / 3, W, H / 3);
        c.fillStyle = lin(c, 0, 0, W, H, [0, 'rgba(0,0,0,0.2)', 0.3, 'rgba(255,255,255,0.06)', 0.6, 'rgba(0,0,0,0.12)', 1, 'rgba(0,0,0,0.25)']); c.fillRect(0, 0, W, H);
        // the Yaz (ⵣ), drawn: a stem, a cup open upwards, a cup open downwards
        var x = W / 2, y = H / 2, a = H * 0.11, b = H * 0.14;
        c.save(); c.strokeStyle = '#e3202a'; c.lineWidth = H * 0.035; c.lineCap = 'round';
        c.beginPath(); c.moveTo(x, y - b * 1.75); c.lineTo(x, y + b * 1.75); c.stroke();
        c.beginPath(); c.arc(x, y - b * 1.25, a, 0.1, PI - 0.1); c.stroke();
        c.beginPath(); c.arc(x, y + b * 1.25, a, PI + 0.1, -0.1); c.stroke();
        c.restore();
    }
    function fireworks(c, W, H, R) {
        c.fillStyle = lin(c, 0, 0, 0, H, [0, [4, 6, 22], 1, [28, 20, 60]]); c.fillRect(0, 0, W, H);
        stars(c, W, H, 120, H * 0.6, R, 0.6);
        c.save(); c.globalCompositeOperation = 'lighter';
        var cols = [[255, 90, 120], [120, 200, 255], [255, 210, 90], [150, 255, 160], [210, 140, 255]];
        for (var b = 0; b < 7; b++) {
            var x = W * (0.3 + R() * 0.45), y = H * (0.25 + R() * 0.3), r = H * (0.08 + R() * 0.12), col = cols[b % cols.length];
            glow(c, x, y, r * 1.3, col, 0.18);
            for (var i = 0; i < 48; i++) {
                var a = i * TAU / 48 + R() * 0.05;
                for (var k = 1; k <= 6; k++) disc(c, x + Math.cos(a) * r * k / 6, y + Math.sin(a) * r * k / 6 + r * 0.08 * (k / 6) * (k / 6), H * 0.003 * (1 + k / 6), rgba(col, 0.25 + k * 0.1));
            }
        }
        c.restore();
        skyline(c, W, H, [8, 8, 18], [255, 214, 140]);
    }
    function festive(c, W, H, R, snowy) {
        c.fillStyle = lin(c, 0, 0, W, H, [0, [30, 20, 70], 0.5, [110, 40, 90], 1, [200, 90, 70]]); c.fillRect(0, 0, W, H);
        c.save(); c.globalCompositeOperation = 'lighter';
        for (var i = 0; i < 40; i++) glow(c, R() * W, R() * H, H * (0.02 + R() * 0.08), [[255, 200, 120], [255, 140, 170], [140, 200, 255]][i % 3], 0.25);
        c.restore();
        if (snowy) snow(c, W, H, 300, R);
    }
    var STADIUM = {
        ucl: { sky: [[4, 8, 40], [16, 30, 90]], crowd: [[200, 210, 255], [90, 110, 200]], star: true },
        uclfinal: { sky: [[4, 8, 40], [30, 40, 110]], crowd: [[255, 230, 160], [140, 150, 230]], star: true, confetti: true },
        worldcup: { sky: [[30, 8, 22], [96, 30, 50]], crowd: [[255, 220, 120], [255, 120, 100]] },
        afcon: { sky: [[6, 30, 16], [24, 80, 40]], crowd: [[250, 210, 60], [230, 60, 50], [40, 170, 80]] },
        uclsemi: { sky: [[4, 8, 40], [22, 34, 100]], crowd: [[220, 228, 255], [110, 130, 220]], star: true },
        cafcl: { sky: [[6, 26, 18], [30, 70, 40]], crowd: [[230, 40, 50], [255, 255, 255], [40, 170, 80], [250, 200, 60]] },
        morocco: { sky: [[40, 6, 10], [110, 20, 30]], crowd: [[230, 40, 50], [20, 140, 70], [255, 255, 255]], confetti: true }
    };
    function stadium(c, W, H, id, R) {
        var p = STADIUM[id] || STADIUM.ucl, i;
        c.fillStyle = lin(c, 0, 0, 0, H * 0.6, [0, p.sky[0], 1, p.sky[1]]); c.fillRect(0, 0, W, H);
        if (p.star) for (i = 0; i < 26; i++) { c.fillStyle = 'rgba(255,255,255,' + (0.05 + R() * 0.12).toFixed(2) + ')'; starPath(c, R() * W, R() * H * 0.35, H * (0.01 + R() * 0.02), 5, 0.45, -PI / 2); c.fill(); }
        // stands with the crowd and their phone lights
        var st = H * 0.3, pt = H * 0.58;
        c.fillStyle = lin(c, 0, st, 0, pt, [0, [10, 12, 24], 1, [24, 26, 40]]);
        c.beginPath(); c.moveTo(0, st + H * 0.06); c.lineTo(W, st + H * 0.06); c.lineTo(W, pt + H * 0.04); c.lineTo(0, pt + H * 0.04); c.fill();
        c.fillStyle = 'rgba(8,10,20,1)'; c.fillRect(0, st, W, H * 0.06);
        for (i = 0; i < 2600; i++) {
            var y = st + H * 0.07 + R() * (pt - st - H * 0.05), col = p.crowd[i % p.crowd.length];
            disc(c, R() * W, y, H * 0.0028, rgba(col, 0.18 + R() * 0.25));
        }
        for (i = 0; i < 160; i++) disc(c, R() * W, st + H * 0.07 + R() * (pt - st - H * 0.06), H * 0.0022, 'rgba(255,255,255,' + (0.5 + R() * 0.5).toFixed(2) + ')');
        // the pitch in perspective, striped
        var tl = W * 0.12, tr = W * 0.88;
        for (i = 0; i < 12; i++) {
            var y0 = pt + (H - pt) * Math.pow(i / 12, 1.5), y1 = pt + (H - pt) * Math.pow((i + 1) / 12, 1.5);
            var f0 = (y0 - pt) / (H - pt), f1 = (y1 - pt) / (H - pt);
            c.fillStyle = i % 2 ? '#2f8c3c' : '#287c34';
            c.beginPath(); c.moveTo(tl - f0 * W * 0.5, y0); c.lineTo(tr + f0 * W * 0.5, y0); c.lineTo(tr + f1 * W * 0.5, y1); c.lineTo(tl - f1 * W * 0.5, y1); c.fill();
        }
        c.strokeStyle = 'rgba(255,255,255,0.75)'; c.lineWidth = H * 0.004;
        c.beginPath(); c.moveTo(tl, pt); c.lineTo(tr, pt); c.moveTo(tl, pt); c.lineTo(tl - W * 0.5, H); c.moveTo(tr, pt); c.lineTo(tr + W * 0.5, H); c.stroke();
        var my = pt + (H - pt) * 0.42;
        c.beginPath(); c.moveTo(0, my); c.lineTo(W, my); c.stroke();
        c.beginPath(); c.ellipse(W / 2, my, W * 0.13, H * 0.05, 0, 0, TAU); c.stroke();
        // floodlights and their beams
        c.save(); c.globalCompositeOperation = 'lighter';
        var lights = [[0.06, 0.1], [0.3, 0.05], [0.7, 0.05], [0.94, 0.1]];
        for (i = 0; i < lights.length; i++) {
            var lx = W * lights[i][0], ly = H * lights[i][1];
            c.fillStyle = lin(c, lx, ly, W / 2, H * 0.85, [0, 'rgba(230,240,255,0.22)', 1, 'rgba(230,240,255,0)']);
            c.beginPath(); c.moveTo(lx, ly); c.lineTo(W * 0.5 - W * 0.35, H); c.lineTo(W * 0.5 + W * 0.35, H); c.fill();
            glow(c, lx, ly, H * 0.12, [240, 246, 255], 0.55);
            c.fillStyle = 'rgba(255,255,255,0.95)'; c.fillRect(lx - H * 0.04, ly - H * 0.012, H * 0.08, H * 0.024);
        }
        c.restore();
        // the ball on the centre spot
        var bx = W / 2, by = my, br = H * 0.03;
        glow(c, bx, by + br, br * 2, [0, 0, 0], 0.35);
        c.fillStyle = c.createRadialGradient(bx - br * 0.3, by - br * 0.35, br * 0.1, bx, by, br); c.fillStyle.addColorStop(0, '#fff'); c.fillStyle.addColorStop(1, '#b8bcc8');
        c.beginPath(); c.arc(bx, by, br, 0, TAU); c.fill();
        c.fillStyle = '#1b1d24'; starPath(c, bx, by, br * 0.38, 5, 0.81, -PI / 2); c.fill();
        for (i = 0; i < 5; i++) { var a = -PI / 2 + i * TAU / 5; c.beginPath(); c.arc(bx + Math.cos(a) * br * 0.95, by + Math.sin(a) * br * 0.95, br * 0.28, 0, TAU); c.save(); c.beginPath(); c.arc(bx, by, br, 0, TAU); c.clip(); c.beginPath(); c.arc(bx + Math.cos(a) * br * 0.95, by + Math.sin(a) * br * 0.95, br * 0.26, 0, TAU); c.fill(); c.restore(); }
        if (p.confetti) for (i = 0; i < 120; i++) { c.save(); c.translate(R() * W, R() * H * 0.6); c.rotate(R() * PI); c.fillStyle = rgba(p.crowd[i % p.crowd.length], 0.8); c.fillRect(-H * 0.006, -H * 0.003, H * 0.012, H * 0.006); c.restore(); }
    }
    function beach(c, W, H, s, R) {
        var night = s.phase === 'night';
        weather(c, W, H, { k: 'clear', phase: s.phase, sunT: s.sunT, temp: 28, season: 'summer', clouds: 10, moon: s.moon, seed: s.seed });
        var sea = night ? [[14, 30, 60], [8, 18, 40]] : [[40, 140, 200], [20, 96, 160]], hz = H * 0.6;
        c.fillStyle = lin(c, 0, hz, 0, H * 0.8, [0, sea[0], 1, sea[1]]); c.fillRect(0, hz, W, H * 0.2);
        c.strokeStyle = night ? 'rgba(200,210,255,0.12)' : 'rgba(255,255,255,0.25)'; c.lineWidth = H * 0.002;
        c.beginPath(); for (var i = 0; i < 60; i++) { var y = hz + Math.pow(R(), 1.5) * H * 0.2, x = R() * W; c.moveTo(x, y); c.lineTo(x + W * (0.01 + R() * 0.04), y); } c.stroke();
        c.fillStyle = lin(c, 0, H * 0.78, 0, H, night ? [0, [70, 60, 60], 1, [40, 34, 36]] : [0, [240, 214, 160], 1, [214, 180, 120]]);
        c.beginPath(); c.moveTo(0, H * 0.82); c.quadraticCurveTo(W * 0.5, H * 0.76, W, H * 0.8); c.lineTo(W, H); c.lineTo(0, H); c.fill();
        var tc = night ? [20, 30, 30] : [40, 90, 50], tk = night ? [20, 18, 18] : [110, 80, 50];
        tree(c, W * 0.1, H * 0.92, H * 0.42, 'palm', tc, tk); tree(c, W * 0.9, H * 0.9, H * 0.36, 'palm', tc, tk);
    }

    function event(c, W, H, id, s) {
        var R = rng(s.seed || 9);
        if (ISLAMIC[id]) return islamic(c, W, H, id, R);
        if (/^(throne|greenmarch|independence|revolution|youth|manifesto|unity|oued)$/.test(id)) return national(c, W, H, id, R);
        if (id === 'yennayer') return amazigh(c, W, H);
        if (id === 'newyear' || id === 'nye') return fireworks(c, W, H, R);
        if (STADIUM[id]) return stadium(c, W, H, id, R);
        if (id === 'labour') return festive(c, W, H, R, false);
        if (id === 'christmas') return festive(c, W, H, R, true);
        if (s.season === 'summer') return beach(c, W, H, s, R);
        return weather(c, W, H, { k: s.season === 'winter' ? 'partly' : 'clear', phase: s.phase, sunT: s.sunT, temp: s.season === 'winter' ? 6 : 20, season: s.season, clouds: 20, moon: s.moon, seed: s.seed });
    }

    /* ---------------- the Earth now ---------------- */

    var RAD = PI / 180;
    // where the Sun is straight overhead (degrees), from the date (accurate to a fraction of a degree)
    function sun(ms) {
        var d = ms / 86400000 - 10957.5, g = (357.529 + 0.98560028 * d) * RAD, q = 280.459 + 0.98564736 * d;
        var L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD, e = (23.439 - 0.00000036 * d) * RAD;
        var ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / RAD, dec = Math.asin(Math.sin(e) * Math.sin(L)) / RAD;
        var gmst = (18.697374558 + 24.06570982441908 * d) % 24;
        var lon = ra - gmst * 15;
        lon = ((lon + 540) % 360) - 180;
        return { lat: dec, lon: lon };
    }
    function moonAge(ms) { var a = ((ms - Date.UTC(2000, 0, 6, 18, 14)) / 86400000) / 29.530588853; return a - Math.floor(a); }

    function earth(c, W, H, day, night, moonTex, s) {
        var R = rng(4), i;
        c.fillStyle = lin(c, 0, 0, W, H, [0, [2, 3, 10], 0.6, [4, 6, 18], 1, [8, 8, 22]]); c.fillRect(0, 0, W, H);
        stars(c, W, H, 420, H, R, 0.85);
        glow(c, W * 0.15, H * 0.2, H * 0.7, [60, 50, 120], 0.08);
        var m = Math.min(W, H), D = Math.round(m * 0.84), r = D / 2, cx = W / 2, cy = H / 2;
        // atmosphere halo
        var hg = c.createRadialGradient(cx, cy, r * 0.98, cx, cy, r * 1.12);
        hg.addColorStop(0, 'rgba(90,160,255,0.45)'); hg.addColorStop(1, 'rgba(90,160,255,0)');
        c.fillStyle = hg; c.fillRect(cx - r * 1.2, cy - r * 1.2, r * 2.4, r * 2.4);

        var lat0 = s.lat * RAD, lon0 = s.lon * RAD, sn = sun(s.at), sLat = sn.lat * RAD, sLon = sn.lon * RAD;
        var ex = Math.cos(sLat) * Math.cos(sLon), ey = Math.cos(sLat) * Math.sin(sLon), ez = Math.sin(sLat);
        var sl0 = Math.sin(lat0), cl0 = Math.cos(lat0), so = Math.sin(lon0), co = Math.cos(lon0);
        var sx = -so * ex + co * ey, sy = -sl0 * co * ex - sl0 * so * ey + cl0 * ez, sz = cl0 * co * ex + cl0 * so * ey + sl0 * ez;
        var img = c.createImageData(D, D), o = img.data, dw = day.w, dh = day.h, nw = night.w, nh = night.h, dd = day.d, nd = night.d;
        for (var py = 0; py < D; py++) {
            var y = (r - py - 0.5) / r;
            for (var px = 0; px < D; px++) {
                var x = (px + 0.5 - r) / r, rr = x * x + y * y;
                if (rr > 1) continue;
                var z = Math.sqrt(1 - rr);
                var la = Math.asin(z * sl0 + y * cl0), lo = lon0 + Math.atan2(x, z * cl0 - y * sl0);
                var u = (lo / TAU + 0.5) % 1; if (u < 0) u += 1;
                var v = 0.5 - la / PI;
                var di = (((v * dh) | 0) * dw + ((u * dw) | 0)) * 4, ni = (((v * nh) | 0) * nw + ((u * nw) | 0)) * 4;
                var dot = x * sx + y * sy + z * sz, t = dot < -0.1 ? 0 : dot > 0.12 ? 1 : (dot + 0.1) / 0.22;
                t = t * t * (3 - 2 * t);
                var lit = 0.16 + 1.1 * Math.pow(Math.max(0, dot), 0.6), rim = (1 - z) * (1 - z) * (1 - z);
                var dr = dd[di] * lit, dg = dd[di + 1] * lit, db = dd[di + 2] * lit;
                // a warm band at the line between day and night
                var dusk = dot > -0.06 && dot < 0.16 ? (1 - Math.abs(dot - 0.05) / 0.11) * 0.22 * t : 0;
                if (dusk > 0) { dr += 90 * dusk; dg += 30 * dusk; db -= 10 * dusk; }
                dr += rim * 110 * t; dg += rim * 160 * t; db += rim * 255 * t;
                var nr = nd[ni] * 1.15 + 4, ng = nd[ni + 1] * 1.05 + 6, nb = nd[ni + 2] * 0.85 + 16;
                nr += rim * 20; ng += rim * 30; nb += rim * 70;
                var k = ((py * D) + px) * 4, edge = rr > 0.994 ? (1 - rr) / 0.006 : 1;
                o[k] = dr * t + nr * (1 - t); o[k + 1] = dg * t + ng * (1 - t); o[k + 2] = db * t + nb * (1 - t); o[k + 3] = 255 * edge;
            }
        }
        var tmp = document.createElement('canvas');
        tmp.width = tmp.height = D;
        tmp.getContext('2d').putImageData(img, 0, 0);
        c.drawImage(tmp, cx - r, cy - r);
        tmp.width = tmp.height = 0;
        // your place
        if (s.here) {
            var hl = s.here.lat * RAD, hlo = s.here.lon * RAD;
            var hx = Math.cos(hl) * Math.cos(hlo), hy = Math.cos(hl) * Math.sin(hlo), hz = Math.sin(hl);
            var vx = -so * hx + co * hy, vy = -sl0 * co * hx - sl0 * so * hy + cl0 * hz, vz = cl0 * co * hx + cl0 * so * hy + sl0 * hz;
            if (vz > 0.1) { var ppx = cx + vx * r, ppy = cy - vy * r; glow(c, ppx, ppy, m * 0.02, [255, 230, 160], 0.5); disc(c, ppx, ppy, m * 0.0045, 'rgba(255,244,214,1)'); }
        }
        // the Moon, in its phase, top right
        if (moonTex) {
            var mr = Math.round(m * 0.07), mx = W - mr * 2.2, my = mr * 2.2, mD = mr * 2, mi = c.createImageData(mD, mD), mo = mi.data;
            var age = moonAge(s.at), pa = age * TAU, msx = Math.sin(pa), msz = -Math.cos(pa);
            for (var qy = 0; qy < mD; qy++) {
                var yy = (mr - qy - 0.5) / mr;
                for (var qx = 0; qx < mD; qx++) {
                    var xx = (qx + 0.5 - mr) / mr, q2 = xx * xx + yy * yy;
                    if (q2 > 1) continue;
                    var zz = Math.sqrt(1 - q2), mla = Math.asin(yy), mlo = Math.atan2(xx, zz);
                    var mu = mlo / TAU + 0.5, mv = 0.5 - mla / PI;
                    var g = moonTex.d[(((mv * moonTex.h) | 0) * moonTex.w + ((mu * moonTex.w) | 0)) * 4];
                    var md = xx * msx + zz * msz, ml = md < -0.04 ? 0.05 : md > 0.04 ? 0.15 + Math.max(0, md) * 1.0 : 0.05 + (md + 0.04) / 0.08 * 0.15;
                    var kk = (qy * mD + qx) * 4, ed = q2 > 0.985 ? (1 - q2) / 0.015 : 1;
                    mo[kk] = g * ml * 1.05; mo[kk + 1] = g * ml * 1.03; mo[kk + 2] = g * ml; mo[kk + 3] = 255 * ed;
                }
            }
            var mt = document.createElement('canvas');
            mt.width = mt.height = mD;
            mt.getContext('2d').putImageData(mi, 0, 0);
            glow(c, mx, my, mr * 2.2, [200, 210, 240], 0.08);
            c.drawImage(mt, mx - mr, my - mr);
            mt.width = mt.height = 0;
        }
    }

    // game style (dynwall.js pixelate): drawn small, so no soft blurs or glass; set only while that small copy is drawn
    var PX = false;
    function pixel(on) { PX = !!on; }
    return { pixel: pixel, photo: photo, weather: weather, event: event, earth: earth, sun: sun, moonAge: moonAge, rainTile: rainTile, _rng: rng };
})();
