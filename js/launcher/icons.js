/* Inline SVG icons for the desktop shell (no image files: nothing to download or decode).
 * Icons.svg(name) returns markup for a 48x48 icon; size it with CSS. Original simple shapes. */
var Icons = (function () {
    'use strict';

    var P = {
        // 4 rounded tiles with a soft blue gradient
        start: '<defs><linearGradient id="gS" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7fd3ff"/><stop offset="1" stop-color="#1f7ae0"/></linearGradient></defs>' +
               '<rect x="6" y="6" width="17" height="17" rx="4" fill="url(#gS)"/><rect x="25" y="6" width="17" height="17" rx="4" fill="url(#gS)"/>' +
               '<rect x="6" y="25" width="17" height="17" rx="4" fill="url(#gS)"/><rect x="25" y="25" width="17" height="17" rx="4" fill="url(#gS)"/>',
        explorer: '<path d="M4 13a4 4 0 0 1 4-4h11l4 4h17a4 4 0 0 1 4 4v20a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="#e8a83a"/>' +
                  '<path d="M4 19a4 4 0 0 1 4-4h32a4 4 0 0 1 4 4v18a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="#ffd36b"/><rect x="10" y="31" width="28" height="4" rx="2" fill="#3d9be9"/>',
        folder: '<path d="M4 13a4 4 0 0 1 4-4h11l4 4h17a4 4 0 0 1 4 4v20a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="#e8a83a"/>' +
                '<path d="M4 19a4 4 0 0 1 4-4h32a4 4 0 0 1 4 4v18a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="#ffd36b"/>',
        browser: '<circle cx="24" cy="24" r="19" fill="#1b9de2"/><path d="M24 5a19 19 0 0 1 0 38" fill="#36c6a3"/>' +
                 '<ellipse cx="24" cy="24" rx="8" ry="19" fill="none" stroke="#e9fbff" stroke-width="2.4"/><path d="M5 24h38M8 14h32M8 34h32" stroke="#e9fbff" stroke-width="2.4" fill="none"/>',
        calculator: '<rect x="9" y="4" width="30" height="40" rx="5" fill="#3b3f4a"/><rect x="13" y="8" width="22" height="9" rx="2" fill="#9ad0ff"/>' +
                    '<g fill="#e6e6e6"><rect x="13" y="21" width="6" height="5" rx="1.5"/><rect x="21" y="21" width="6" height="5" rx="1.5"/><rect x="13" y="29" width="6" height="5" rx="1.5"/><rect x="21" y="29" width="6" height="5" rx="1.5"/><rect x="13" y="37" width="14" height="4" rx="1.5"/></g>' +
                    '<rect x="29" y="21" width="6" height="20" rx="1.5" fill="#4cc2ff"/>',
        calendar: '<rect x="5" y="8" width="38" height="35" rx="5" fill="#f3f3f3"/><path d="M5 13a5 5 0 0 1 5-5h28a5 5 0 0 1 5 5v5H5z" fill="#2f7de1"/>' +
                  '<rect x="13" y="4" width="4" height="8" rx="2" fill="#555"/><rect x="31" y="4" width="4" height="8" rx="2" fill="#555"/>' +
                  '<g fill="#2f7de1"><rect x="11" y="23" width="6" height="5" rx="1"/><rect x="21" y="23" width="6" height="5" rx="1"/><rect x="31" y="23" width="6" height="5" rx="1"/><rect x="11" y="32" width="6" height="5" rx="1"/><rect x="21" y="32" width="6" height="5" rx="1"/></g>',
        settings: '<path d="M24 4l4 5 6-2 1 6 6 2-2 6 5 3-5 3 2 6-6 2-1 6-6-2-4 5-4-5-6 2-1-6-6-2 2-6-5-3 5-3-2-6 6-2 1-6 6 2z" fill="#8a96a8"/>' +
                  '<circle cx="24" cy="24" r="8" fill="#2b2f38"/><circle cx="24" cy="24" r="4" fill="#c9d1dd"/>',
        scores: '<path d="M14 6h20v12a10 10 0 0 1-20 0z" fill="#ffc83d"/><path d="M14 9H7v4a7 7 0 0 0 7 7M34 9h7v4a7 7 0 0 1-7 7" fill="none" stroke="#ffc83d" stroke-width="3"/>' +
                '<rect x="21" y="27" width="6" height="8" fill="#e0a21f"/><rect x="14" y="35" width="20" height="7" rx="2" fill="#a86f12"/>',
        pc: '<rect x="4" y="7" width="40" height="27" rx="3" fill="#2b6fd6"/><rect x="7" y="10" width="34" height="21" rx="1" fill="#7cc4ff"/>' +
            '<rect x="20" y="34" width="8" height="5" fill="#9aa3b0"/><rect x="13" y="39" width="22" height="3" rx="1.5" fill="#c3cad4"/>',
        drive: '<rect x="4" y="14" width="40" height="22" rx="4" fill="#9aa3b0"/><rect x="4" y="27" width="40" height="9" rx="3" fill="#6f7886"/><circle cx="37" cy="31.5" r="2" fill="#4cd97b"/>',
        picture: '<rect x="5" y="8" width="38" height="32" rx="4" fill="#2a8fd8"/><circle cx="16" cy="18" r="4" fill="#ffe27a"/><path d="M5 34l12-12 9 9 6-6 11 11v1a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z" fill="#38c172"/>',
        document: '<path d="M11 4h18l10 10v28a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="#e8eef7"/><path d="M29 4v10h10" fill="#b6c4d8"/>' +
                  '<path d="M14 22h20M14 28h20M14 34h14" stroke="#5b7aa6" stroke-width="2.5"/>',
        desktop: '<rect x="4" y="8" width="40" height="28" rx="3" fill="#0f6cbd"/><path d="M6 33c8-10 14-14 36-12v13H6z" fill="#4cc2ff"/><rect x="16" y="38" width="16" height="3" rx="1.5" fill="#9aa3b0"/>',
        game: '<path d="M14 15h20a10 10 0 0 1 9.6 12.8l-2.2 7.5a5 5 0 0 1-8.6 1.7L29 32H19l-3.8 5a5 5 0 0 1-8.6-1.7l-2.2-7.5A10 10 0 0 1 14 15z" fill="#7a5af8"/>' +
              '<path d="M15 21v8M11 25h8" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="31" cy="23" r="2.3" fill="#ffd23f"/><circle cx="35" cy="27" r="2.3" fill="#4cd97b"/>',
        user: '<circle cx="24" cy="17" r="9" fill="#c3cad4"/><path d="M7 43a17 17 0 0 1 34 0z" fill="#c3cad4"/>',
        power: '<path d="M24 6v17" stroke="#fff" stroke-width="4" stroke-linecap="round"/><path d="M15 12a15 15 0 1 0 18 0" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/>',
        close: '<path d="M13 13l22 22M35 13L13 35" stroke="#fff" stroke-width="3.5" stroke-linecap="round"/>',
        back: '<path d="M30 10L16 24l14 14" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
        forward: '<path d="M18 10l14 14-14 14" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
        up: '<path d="M10 30l14-14 14 14" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
        reload: '<path d="M37 24a13 13 0 1 1-4-9.4" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/><path d="M35 6v10H25" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
        home: '<path d="M8 22L24 8l16 14v18a2 2 0 0 1-2 2h-9V31h-10v11h-9a2 2 0 0 1-2-2z" fill="none" stroke="#fff" stroke-width="3.5" stroke-linejoin="round"/>',
        search: '<circle cx="21" cy="21" r="12" fill="none" stroke="#fff" stroke-width="4"/><path d="M30 30l10 10" stroke="#fff" stroke-width="4" stroke-linecap="round"/>',
        wifi: '<path d="M5 18a27 27 0 0 1 38 0M11 25a18 18 0 0 1 26 0M17 32a9 9 0 0 1 14 0" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/><circle cx="24" cy="38" r="3.5" fill="#fff"/>',
        wifiOff: '<path d="M5 18a27 27 0 0 1 38 0M11 25a18 18 0 0 1 26 0M17 32a9 9 0 0 1 14 0" fill="none" stroke="#777" stroke-width="4" stroke-linecap="round"/><path d="M8 8l32 32" stroke="#ff6b6b" stroke-width="4" stroke-linecap="round"/>',
        volume: '<path d="M6 18h8l11-9v30l-11-9H6z" fill="#fff"/><path d="M31 17a9 9 0 0 1 0 14M36 12a16 16 0 0 1 0 24" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round"/>',
        mute: '<path d="M6 18h8l11-9v30l-11-9H6z" fill="#fff"/><path d="M32 18l10 12M42 18L32 30" stroke="#fff" stroke-width="3.5" stroke-linecap="round"/>',
        remote: '<rect x="15" y="3" width="18" height="42" rx="8" fill="#fff"/><circle cx="24" cy="15" r="5" fill="#202020"/><circle cx="24" cy="29" r="2" fill="#202020"/><circle cx="24" cy="36" r="2" fill="#202020"/>',
        keyboard: '<rect x="3" y="12" width="42" height="24" rx="4" fill="#fff"/><g fill="#202020"><rect x="8" y="17" width="5" height="4"/><rect x="16" y="17" width="5" height="4"/><rect x="24" y="17" width="5" height="4"/><rect x="32" y="17" width="5" height="4"/><rect x="12" y="27" width="24" height="4"/></g>',
        gamepad: '<path d="M14 15h20a10 10 0 0 1 9.6 12.8l-2.2 7.5a5 5 0 0 1-8.6 1.7L29 32H19l-3.8 5a5 5 0 0 1-8.6-1.7l-2.2-7.5A10 10 0 0 1 14 15z" fill="#fff"/>',
        system: '<rect x="4" y="7" width="40" height="27" rx="3" fill="#4cc2ff"/><rect x="20" y="34" width="8" height="5" fill="#9aa3b0"/><rect x="13" y="39" width="22" height="3" rx="1.5" fill="#c3cad4"/>',
        brush: '<path d="M33 5l10 10-17 17-10-10z" fill="#ff8a65"/><path d="M14 24l10 10c-2 7-8 10-18 9 3-3 2-8 3-12 1-4 3-6 5-7z" fill="#4cc2ff"/>',
        accounts: '<circle cx="24" cy="17" r="9" fill="#4cd97b"/><path d="M7 43a17 17 0 0 1 34 0z" fill="#4cd97b"/>',
        sound: '<path d="M6 18h8l11-9v30l-11-9H6z" fill="#4cc2ff"/><path d="M31 17a9 9 0 0 1 0 14M36 12a16 16 0 0 1 0 24" fill="none" stroke="#4cc2ff" stroke-width="3.5" stroke-linecap="round"/>',
        clock: '<circle cx="24" cy="24" r="19" fill="#c06cf0"/><path d="M24 12v13l8 5" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round"/>',
        shield: '<path d="M24 4l17 6v12c0 11-7 18-17 22C14 40 7 33 7 22V10z" fill="#3fb6a8"/><path d="M16 24l6 6 11-12" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>',
        info: '<circle cx="24" cy="24" r="19" fill="#5b8def"/><rect x="21.5" y="20" width="5" height="15" rx="2.5" fill="#fff"/><circle cx="24" cy="13.5" r="3" fill="#fff"/>',
        controller: '<path d="M14 15h20a10 10 0 0 1 9.6 12.8l-2.2 7.5a5 5 0 0 1-8.6 1.7L29 32H19l-3.8 5a5 5 0 0 1-8.6-1.7l-2.2-7.5A10 10 0 0 1 14 15z" fill="#4cd97b"/>',
        plus: '<path d="M24 10v28M10 24h28" stroke="#fff" stroke-width="4" stroke-linecap="round"/>',
        trash: '<path d="M10 12h28M19 12V8h10v4M13 12l2 29h18l2-29" fill="none" stroke="#fff" stroke-width="3.5" stroke-linejoin="round"/>'
    };

    function svg(name) {
        return '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' + (P[name] || P.document) + '</svg>';
    }

    // fills an element with an icon
    function put(el, name) { el.innerHTML = svg(name); return el; }

    return { svg: svg, put: put };
})();
