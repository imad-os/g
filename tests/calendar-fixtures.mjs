// Google Calendar "Holidays in Morocco" answers (basic.ics) for the tests: the shape Google sends (CRLF, folded lines,
// all-day DTSTART / DTEND, "Public holiday" / "Observance" descriptions, the same UID in every language).
// Morocco's Eid al-Adha 2027 is put one day after Umm al-Qura on purpose: the Hijri date must follow it.
const EV = [
    // [start, end (exclusive), uid, en, fr, ar, es, public]
    ['20261106', '20261107', '20261106_gm', 'Green March', 'Marche verte', 'ذكرى المسيرة الخضراء', 'Marcha Verde', true],
    ['20261118', '20261119', '20261118_ind', 'Independence Day', 'Fête de l\'Indépendance', 'عيد الاستقلال', 'Día de la Independencia', true],
    ['20261231', '20270101', '20261231_nye', 'New Year\'s Eve', 'Saint-Sylvestre', 'ليلة رأس السنة', 'Nochevieja', false],
    ['20270101', '20270102', '20270101_ny', 'New Year\'s Day', 'Jour de l\'an', 'رأس السنة الميلادية', 'Año Nuevo', true],
    ['20270517', '20270518', '20270517_adha', 'Eid al-Adha', 'Aïd el-Kébir', 'عيد الأضحى', 'Fiesta del Sacrificio', true],
    ['20270518', '20270519', '20270518_adha2', 'Eid al-Adha Holiday', 'Aïd el-Kébir (2e jour)', 'عطلة عيد الأضحى', 'Fiesta del Sacrificio (2.º día)', true]
];
export function ics(lang) {
    const col = { en: 3, fr: 4, ar: 5, es: 6 }[lang];
    const out = ['BEGIN:VCALENDAR', 'PRODID:-//Google Inc//Google Calendar 70.9054//EN', 'VERSION:2.0', 'X-WR-CALNAME:Holidays in Morocco'];
    for (const e of EV) {
        out.push('BEGIN:VEVENT', 'DTSTART;VALUE=DATE:' + e[0], 'DTEND;VALUE=DATE:' + e[1], 'DTSTAMP:20261105T120000Z', 'UID:' + e[2] + '@google.com', 'CLASS:PUBLIC',
            ...(e[7] ? ['DESCRIPTION:Public holiday'] : ['DESCRIPTION:Observance\\nTo hide observances\\, go to Google Calendar Settings > Holidays in Mo', ' rocco']),
            'SUMMARY:' + e[col], 'TRANSP:TRANSPARENT', 'END:VEVENT');
    }
    out.push('END:VCALENDAR');
    // Google folds long lines: a long summary, cut in two
    return out.join('\r\n').replace('SUMMARY:Independence Day', 'SUMMARY:Independence\r\n  Day');
}
