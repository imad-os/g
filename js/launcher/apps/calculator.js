/* Calculator app: on-screen keys for the remote; a PC keyboard types digits and + - * / = too. */
(function () {
    'use strict';

    var KEYS = [
        ['C', 'clear'], ['⌫', 'erase'], ['%', 'pct'], ['÷', '/'],
        ['7', '7'], ['8', '8'], ['9', '9'], ['×', '*'],
        ['4', '4'], ['5', '5'], ['6', '6'], ['−', '-'],
        ['1', '1'], ['2', '2'], ['3', '3'], ['+', '+'],
        ['±', 'neg'], ['0', '0'], ['.', '.'], ['=', '=']
    ];
    var SYM = { '/': '÷', '*': '×', '-': '−', '+': '+' };
    var disp, expr, cur, acc, op, fresh, err, open = false;

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }

    function fmt(n) {
        if (!isFinite(n)) return I18n.t('calcError');
        var s = String(+n.toPrecision(12));
        return s.length > 16 ? n.toExponential(8) : s;
    }

    function draw() {
        disp.textContent = err ? I18n.t('calcError') : cur;
        expr.textContent = op ? fmt(acc) + ' ' + SYM[op] : '';
        disp.className = 'calc-disp' + (cur.length > 11 ? ' calc-small' : '');
    }

    function reset() { cur = '0'; acc = 0; op = null; fresh = true; err = false; }

    function apply(a, b, o) { return o === '+' ? a + b : o === '-' ? a - b : o === '*' ? a * b : o === '/' ? a / b : b; }

    function press(k) {
        if (err && k !== 'clear') reset();
        if (/^[0-9]$/.test(k)) {
            if (fresh || cur === '0') { cur = k; fresh = false; } else if (cur.length < 15) cur += k;
        } else if (k === '.') {
            if (fresh) { cur = '0.'; fresh = false; } else if (cur.indexOf('.') < 0) cur += '.';
        } else if (k === 'clear') reset();
        else if (k === 'erase') { if (!fresh) { cur = cur.length > 1 ? cur.slice(0, -1) : '0'; if (cur === '-') cur = '0'; } }
        else if (k === 'neg') { if (cur !== '0') cur = cur.charAt(0) === '-' ? cur.slice(1) : '-' + cur; }
        else if (k === 'pct') { cur = fmt(op ? acc * parseFloat(cur) / 100 : parseFloat(cur) / 100); fresh = true; }
        else if (SYM[k]) {
            if (op && !fresh) acc = apply(acc, parseFloat(cur), op); else if (!op) acc = parseFloat(cur);
            op = k; fresh = true; cur = fmt(acc);
            if (!isFinite(acc)) err = true;
        } else if (k === '=') {
            if (op) {
                var r = apply(acc, parseFloat(cur), op);
                op = null; fresh = true;
                if (!isFinite(r)) err = true; else cur = fmt(r);
            }
        }
        draw();
        A11y.announce(err ? I18n.t('calcError') : (SYM[k] || (k === '=' ? '= ' + cur : cur)));
    }

    // PC keyboard: digits and operators (captured before the remote/keyboard input mapping)
    function onRawKey(e) {
        if (!open) return;
        var ch = e.key && e.key.length === 1 ? e.key : '', k = null;
        if (/[0-9.+\-*\/=%]/.test(ch)) k = ch === '%' ? 'pct' : ch;
        else if (e.keyCode === 8) k = 'erase';
        else if (e.keyCode === 46 || ch === 'c' || ch === 'C') k = 'clear';
        if (!k) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'keydown') press(k);
    }

    Win.register('calculator', {
        icon: 'calculator',
        title: function () { return I18n.t('calculator'); },
        open: function (body) {
            reset();
            var box = el('div', 'calc');
            expr = el('div', 'calc-expr');
            disp = el('div', 'calc-disp');
            disp.setAttribute('aria-live', 'polite');
            box.appendChild(expr); box.appendChild(disp);
            var pad = el('div', 'calc-pad'), five = null;
            for (var i = 0; i < KEYS.length; i++) {
                var k = KEYS[i], b = el('button', 'calc-key' + (SYM[k[1]] || k[1] === '=' ? ' calc-op' : '') + (k[1] === '=' ? ' calc-eq' : '') + (/^[0-9.]$|neg/.test(k[1]) ? ' calc-num' : ''), k[0]);
                b.setAttribute('data-focus', '');
                b.onclick = (function (key) { return function () { press(key); }; })(k[1]);
                pad.appendChild(b);
                if (k[1] === '5') five = b;
            }
            box.appendChild(pad);
            body.appendChild(box);
            draw();
            open = true;
            window.addEventListener('keydown', onRawKey, true);
            window.addEventListener('keyup', onRawKey, true);
            return five;
        },
        close: function () {
            open = false;
            window.removeEventListener('keydown', onRawKey, true);
            window.removeEventListener('keyup', onRawKey, true);
            disp = expr = null;
        }
    });
})();
