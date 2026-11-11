/* PadInfo: which controller a gamepad is (brand, model, button layout), from the id the browser gives it.
 *
 * Chrome:  "Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)"     Firefox: "57e-2009-Pro Controller"
 * The W3C "standard" mapping numbers buttons by POSITION (0 = bottom face button, 1 = right, 2 = left, 3 = top), never by
 * what is printed on them: a Switch Pro controller's A (right) is button 1, an Xbox pad's A (bottom) is button 0. So the
 * label of a button depends on the controller: PadInfo.label(info, i) gives the one printed on THIS controller.
 * My PC's actions stay by position (bottom = OK / jump, right = Back / run), whatever the controller.
 *
 *   PadInfo.detect(id, mapping) -> { vendor: '057e', product: '2009', brand: 'Nintendo', model: 'Switch Pro Controller',
 *                                     layout: 'nintendo' | 'xbox' | 'playstation' | 'other', known: true, standard: true }
 *   PadInfo.label(info | layout, index) -> 'A'      PadInfo.labels(info | layout) -> the 18 labels
 *
 * The same detect / label code is inside sdk/mypc-sdk.js (standalone apps); tests/unit-tests.mjs keeps both identical.
 */
var PadInfo = (function () {
    'use strict';
    /* PADINFO-BEGIN (copied as is into sdk/mypc-sdk.js) */
    // labels by standard index: 4 face buttons, shoulders, triggers, the two small middle buttons, stick clicks, D-pad, home, extra
    var LABELS = {
        nintendo: ['B', 'A', 'Y', 'X', 'L', 'R', 'ZL', 'ZR', '−', '+', 'L3', 'R3', '▲', '▼', '◀', '▶', 'Home', 'Capture'],
        xbox: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', '▲', '▼', '◀', '▶', 'Xbox', 'Share'],
        playstation: ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'Share', 'Options', 'L3', 'R3', '▲', '▼', '◀', '▶', 'PS', 'Touchpad'],
        // a controller we do not know: My PC's own names (A B X Y in the Nintendo places, the + for the menu)
        other: ['B', 'A', 'Y', 'X', 'L', 'R', 'ZL', 'ZR', '−', '+', 'L3', 'R3', '▲', '▼', '◀', '▶', 'Home', 'Capture']
    };
    // a Nintendo pad the browser does not map ("standard: false"): its own HID order (DirectInput), the D-pad is an axis
    var NINTENDO_RAW = ['B', 'A', 'Y', 'X', 'L', 'R', 'ZL', 'ZR', '−', '+', 'L3', 'R3', 'Home', 'Capture'];
    var BRANDS = {      // USB vendor id -> [brand, layout when the model is not known ('' = from the name)]
        '057e': ['Nintendo', 'nintendo'], '045e': ['Microsoft', 'xbox'], '054c': ['Sony', 'playstation'], '046d': ['Logitech', 'xbox'],
        '0f0d': ['Hori', ''], '20d6': ['PowerA', ''], '24c6': ['PowerA', 'xbox'], '0e6f': ['PDP', ''], '2dc8': ['8BitDo', 'nintendo'],
        '1532': ['Razer', 'xbox'], '0738': ['Mad Catz', 'xbox'], '18d1': ['Google', 'xbox'], '1949': ['Amazon', 'xbox'],
        '0955': ['NVIDIA', 'xbox'], '1038': ['SteelSeries', 'xbox'], '04e8': ['Samsung', 'xbox'], '0079': ['DragonRise', ''], '2563': ['ShanWan', '']
    };
    var MODELS = {      // 'vendor:product' -> [model, layout, label overrides { index: label }]
        '057e:2009': ['Switch Pro Controller', 'nintendo'], '057e:2069': ['Switch 2 Pro Controller', 'nintendo'],
        '057e:2006': ['Joy-Con (L)', 'nintendo'], '057e:2007': ['Joy-Con (R)', 'nintendo'], '057e:200e': ['Joy-Con pair', 'nintendo'],
        '057e:2017': ['SNES Controller', 'nintendo'], '057e:2019': ['N64 Controller', 'nintendo'],
        '045e:028e': ['Xbox 360 Controller', 'xbox'], '045e:028f': ['Xbox 360 Wireless Controller', 'xbox'], '045e:0719': ['Xbox 360 Wireless Controller', 'xbox'],
        '045e:02d1': ['Xbox One Controller', 'xbox'], '045e:02dd': ['Xbox One Controller', 'xbox'], '045e:02e3': ['Xbox One Elite Controller', 'xbox'],
        '045e:02ea': ['Xbox One S Controller', 'xbox'], '045e:02e0': ['Xbox One S Controller', 'xbox'], '045e:02fd': ['Xbox One S Controller', 'xbox'],
        '045e:0b00': ['Xbox Elite Series 2', 'xbox'], '045e:0b05': ['Xbox Elite Series 2', 'xbox'], '045e:0b22': ['Xbox Elite Series 2', 'xbox'],
        '045e:0b12': ['Xbox Series X|S Controller', 'xbox'], '045e:0b13': ['Xbox Series X|S Controller', 'xbox'], '045e:0b20': ['Xbox Wireless Controller', 'xbox'],
        '054c:0268': ['DualShock 3', 'playstation', { 8: 'Select', 9: 'Start' }], '054c:05c4': ['DualShock 4', 'playstation'],
        '054c:09cc': ['DualShock 4', 'playstation'], '054c:0ba0': ['DualShock 4', 'playstation'],
        '054c:0ce6': ['DualSense', 'playstation', { 8: 'Create' }], '054c:0df2': ['DualSense Edge', 'playstation', { 8: 'Create' }],
        '046d:c21d': ['Gamepad F310', 'xbox'], '046d:c21e': ['Gamepad F510', 'xbox'], '046d:c21f': ['Gamepad F710', 'xbox'],
        '18d1:9400': ['Stadia Controller', 'xbox', { 8: 'Options', 9: 'Menu', 16: 'Stadia', 17: 'Capture' }],
        '1949:0419': ['Luna Controller', 'xbox', { 16: 'Luna', 17: 'Mic' }], '0955:7214': ['SHIELD Controller', 'xbox', { 16: 'NVIDIA' }],
        '0000:0000': ['Phone controller', 'nintendo']       // My PC's own: a phone in Buttons / Keyboard mode (Input.virtualPad)
    };
    function hex4(s) { s = String(s || '').toLowerCase(); while (s.length < 4) s = '0' + s; return s.slice(-4); }
    // "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 02fd)" -> "Xbox Wireless Controller"
    function cleanName(id) {
        var n = String(id || '').replace(/^[0-9a-f]{1,4}-[0-9a-f]{1,4}-/i, '').replace(/\s*\([^()]*(?:vendor|product|standard gamepad|xinput)[^()]*\)\s*/ig, ' ').replace(/\s+/g, ' ').trim();
        return n || 'Gamepad';
    }
    function layoutFromName(n) {
        if (/pro controller|joy-?con|nintendo|switch|8bitdo|snes|n64/i.test(n)) return 'nintendo';
        if (/dualsense|dualshock|playstation|\bps[345]\b|sony/i.test(n)) return 'playstation';
        if (/xbox|x-box|xinput|microsoft/i.test(n)) return 'xbox';
        return '';
    }
    function detect(id, mapping) {
        id = String(id || '');
        var m = /vendor:\s*([0-9a-f]{1,4})\s*product:\s*([0-9a-f]{1,4})/i.exec(id) || /^([0-9a-f]{1,4})-([0-9a-f]{1,4})-/i.exec(id);
        var vendor = m ? hex4(m[1]) : '', product = m ? hex4(m[2]) : '', name = cleanName(id);
        var mod = m && MODELS[vendor + ':' + product], br = vendor && BRANDS[vendor];
        var layout = mod ? mod[1] : (br && br[1]) || layoutFromName(name) || 'other';
        if (/\bxinput\b/i.test(id) && !mod) layout = 'xbox';
        return {
            vendor: vendor, product: product,
            brand: vendor === '0000' ? 'My PC' : br ? br[0] : '',
            model: mod ? mod[0] : name, name: name, layout: layout, known: !!mod,
            standard: mapping === undefined ? true : mapping === 'standard', fix: mod && mod[2] || null
        };
    }
    function label(info, i) {
        var lay = typeof info === 'string' ? info : info && info.layout;
        if (info && typeof info === 'object') {
            if (info.fix && info.fix[i]) return info.fix[i];
            if (info.standard === false) return lay === 'nintendo' && NINTENDO_RAW[i] ? NINTENDO_RAW[i] : '#' + i;
        }
        var l = LABELS[lay] || LABELS.other;
        return l[i] || '#' + i;
    }
    /* PADINFO-END */
    function labels(info) { var out = []; for (var i = 0; i < 18; i++) out.push(label(info, i)); return out; }
    return { detect: detect, label: label, labels: labels, name: cleanName, LAYOUTS: ['nintendo', 'xbox', 'playstation', 'other'] };
})();
