/* Profile pictures: 16 drawn avatars (original art, drawn over the profile's colour) and photos.
 *   Avatars.IDS               ids of the drawn avatars
 *   Avatars.fill(el, profile) shows the profile's picture in el: photo, drawn avatar, or its initial letter
 * A profile keeps either p.av (avatar id) or p.photo (a small data: image, or a web address). */
var Avatars = (function () {
    'use strict';

    var INK = '#1b1f3b', CREAM = '#fff4dc', PINK = '#ff8fab';
    function c(x, y, r, f) { return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + f + '"/>'; }
    function e(x, y, rx, ry, f) { return '<ellipse cx="' + x + '" cy="' + y + '" rx="' + rx + '" ry="' + ry + '" fill="' + f + '"/>'; }
    function p(d, f) { return '<path d="' + d + '" fill="' + f + '"/>'; }
    function r(x, y, w, h, rx, f) { return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + rx + '" fill="' + f + '"/>'; }
    function l(d) { return '<path d="' + d + '" stroke="' + INK + '" stroke-width="2" stroke-linecap="round" fill="none"/>'; }

    var ART = {
        cat: p('M13 28L15 7L29 18Z M51 28L49 7L35 18Z', CREAM) + c(32, 37, 21, CREAM) + c(24, 34, 3, INK) + c(40, 34, 3, INK) + p('M29 41h6l-3 4Z', PINK) + l('M14 40l9 2M14 47l9-2M50 40l-9 2M50 47l-9-2'),
        fox: p('M8 12L26 26H38L56 12L51 43L32 60L13 43Z', '#ff9f43') + p('M20 45L32 60L44 45L32 38Z', '#fff') + c(23, 34, 3, INK) + c(41, 34, 3, INK) + c(32, 52, 3, INK),
        panda: c(15, 15, 8, INK) + c(49, 15, 8, INK) + c(32, 36, 22, '#fff') + e(22, 33, 6, 8, INK) + e(42, 33, 6, 8, INK) + c(23, 33, 2, '#fff') + c(41, 33, 2, '#fff') + e(32, 43, 4, 3, INK),
        owl: p('M12 24L14 8L26 16Z M52 24L50 8L38 16Z', '#a9744f') + e(32, 38, 21, 22, '#a9744f') + c(23, 32, 9, '#fff') + c(41, 32, 9, '#fff') + c(23, 32, 4, INK) + c(41, 32, 4, INK) + p('M28 38h8l-4 8Z', '#ffb21a') + e(32, 52, 10, 5, CREAM),
        robot: l('M32 6v8') + c(32, 6, 3, '#ff5d73') + r(11, 14, 42, 36, 8, '#c8d0e0') + r(17, 24, 12, 10, 3, '#4fe3ff') + r(35, 24, 12, 10, 3, '#4fe3ff') + r(20, 40, 24, 5, 2, INK) + r(6, 26, 5, 12, 2, '#8d96ad') + r(53, 26, 5, 12, 2, '#8d96ad'),
        alien: e(32, 34, 22, 26, '#6fe08a') + p('M12 28Q20 26 28 38Q18 42 12 28Z M52 28Q44 26 36 38Q46 42 52 28Z', INK) + l('M26 50Q32 54 38 50'),
        ghost: p('M12 54V30Q12 8 32 8Q52 8 52 30V54L44 47L38 54L32 47L26 54L20 47Z', '#fff') + c(24, 30, 4, INK) + c(40, 30, 4, INK) + e(32, 41, 4, 5, INK),
        astro: c(32, 33, 25, '#fff') + r(14, 22, 36, 24, 12, INK) + p('M20 28Q24 25 30 26Q22 27 20 34Z', '#6e7bd8') + c(44, 38, 2, '#4fe3ff'),
        bunny: e(22, 16, 6, 15, CREAM) + e(42, 16, 6, 15, CREAM) + e(22, 17, 2.5, 10, PINK) + e(42, 17, 2.5, 10, PINK) + c(32, 40, 19, CREAM) + c(25, 38, 3, INK) + c(39, 38, 3, INK) + p('M29 44h6l-3 3Z', PINK),
        bear: c(15, 16, 8, '#a9744f') + c(49, 16, 8, '#a9744f') + c(32, 36, 22, '#a9744f') + e(32, 44, 10, 8, '#e7c49b') + c(24, 31, 3, INK) + c(40, 31, 3, INK) + e(32, 41, 4, 3, INK),
        penguin: e(32, 36, 22, 25, INK) + e(32, 42, 14, 18, '#fff') + c(24, 26, 4, '#fff') + c(40, 26, 4, '#fff') + c(25, 26, 2, INK) + c(39, 26, 2, INK) + p('M27 32h10l-5 7Z', '#ffb21a'),
        ninja: c(32, 34, 24, INK) + r(10, 26, 44, 14, 6, '#f1c9a0') + c(23, 33, 3, INK) + c(41, 33, 3, INK) + p('M50 22l12-6l-6 12Z', '#ff5d73'),
        pirate: c(32, 38, 21, '#f1c9a0') + p('M9 28Q32 -2 55 28Q32 20 9 28Z', '#ff5d73') + c(40, 36, 6, INK) + c(23, 36, 3, INK) + l('M23 48Q32 53 41 48') + l('M13 34L47 24'),
        king: c(32, 40, 20, '#f1c9a0') + p('M12 24L16 8L24 17L32 6L40 17L48 8L52 24Z', '#e07b00') + c(24, 38, 3, INK) + c(40, 38, 3, INK) + l('M25 48Q32 53 39 48'),
        wizard: p('M32 2L48 30H16Z', '#7a4fd6') + c(32, 14, 2, '#ffd23f') + r(8, 28, 48, 5, 2, '#5b38a8') + c(32, 44, 16, '#f1c9a0') + c(26, 42, 2.5, INK) + c(38, 42, 2.5, INK) + p('M20 50Q32 66 44 50Q32 56 20 50Z', '#fff'),
        frog: c(20, 18, 9, '#4cd97b') + c(44, 18, 9, '#4cd97b') + e(32, 40, 25, 20, '#4cd97b') + c(20, 18, 5, '#fff') + c(44, 18, 5, '#fff') + c(21, 19, 2.5, INK) + c(43, 19, 2.5, INK) + l('M16 44Q32 56 48 44')
    };
    var IDS = [];
    for (var k in ART) IDS.push(k);

    function svg(id) {
        return ART[id] ? '<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">' + ART[id] + '</svg>' : '';
    }

    // the picture of a profile inside a round element (initial letter when it has none)
    function fill(elm, prof, initial) {
        elm.style.backgroundColor = prof.color;
        elm.style.backgroundImage = '';
        elm.innerHTML = '';
        elm.className = elm.className.replace(/\s*\bav-pic\b/g, '');
        if (prof.photo) {
            var img = new Image();
            img.alt = '';
            img.onerror = function () { if (img.parentNode === elm) { elm.removeChild(img); elm.textContent = initial; elm.className = elm.className.replace(/\s*\bav-pic\b/g, ''); } };
            img.src = prof.photo;
            elm.className += ' av-pic';
            elm.appendChild(img);
        } else if (prof.av && ART[prof.av]) {
            elm.className += ' av-pic';
            elm.innerHTML = svg(prof.av);
        } else elm.textContent = initial;
    }

    return { IDS: IDS, svg: svg, fill: fill };
})();
