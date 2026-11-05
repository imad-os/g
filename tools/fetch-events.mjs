// Builds data/events-ma.json: My PC's own copy of Google Calendar's public "Holidays in Morocco" + data/big-events.json, read first
// by every My PC (js/core/events.js), because the web / phone app cannot read Google's .ics itself (no CORS header).
//   node tools/fetch-events.mjs            Google's .ics (en; names are translated on the TV by the ev_<id> strings)
//   node tools/fetch-events.mjs --offline  no network: keeps the holidays already in the file (or "built-in" = none, TVs then ask Google)
// Run every week by .github/workflows/events.yml (it commits the file when it changed). A failed or empty answer never replaces
// good data.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const Events = require(path.join(root, 'js/core/events.js'));
const OUT = path.join(root, 'data/events-ma.json');
const ICS = 'https://calendar.google.com/calendar/ical/en.ma%23holiday%40group.v.calendar.google.com/public/basic.ics';
const offline = process.argv.includes('--offline');

const events = JSON.parse(fs.readFileSync(path.join(root, 'data/big-events.json'), 'utf8')).events || [];
let old = null;
try { old = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) {}

let holidays = null;
if (!offline) {
    try {
        const r = await fetch(ICS, { headers: { 'user-agent': 'MyPC-calendar/1.0' } });
        const t = await r.text();
        holidays = r.ok ? Events._fromIcs(t) : null;
        if (!r.ok) console.warn('Google: HTTP ' + r.status);
    } catch (e) { console.warn('Google: ' + e.message); }
}
let source = 'Google Calendar: Holidays in Morocco';
if (!holidays || !holidays.length) {
    holidays = old && old.source !== 'built-in' && Array.isArray(old.holidays) ? old.holidays : [];
    source = holidays.length ? old.source : 'built-in';
    console.log(holidays.length ? 'Google not read: kept the holidays already in the file' : 'no holidays yet: TVs use Google / the built-in dates');
}
// one entry per line: small, readable diffs in the Action's commits
function pretty(o) {
    const list = (l) => '[' + (l.length ? '\n' + l.map((e) => '  ' + JSON.stringify(e)).join(',\n') + '\n ' : '') + ']';
    return '{\n' + Object.keys(o).map((k) => ' ' + JSON.stringify(k) + ': ' + (Array.isArray(o[k]) ? list(o[k]) : JSON.stringify(o[k]))).join(',\n') + '\n}\n';
}
const same = old && JSON.stringify([old.holidays, old.events, old.source]) === JSON.stringify([holidays, events, source]);
fs.writeFileSync(OUT, pretty({ v: 2, updated: same ? old.updated : new Date().toISOString(), source, holidays, events }));
console.log(`${source}: ${holidays.length} holidays, ${events.length} big events${same ? ' (unchanged)' : ''}`);
