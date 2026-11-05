/* Reminders of the profile's own calendar events (Calendar app > an event > Reminder): a notification card (js/launcher/notify.js)
 * at the time chosen (at the time, 15 minutes, 1 hour or 1 day before; an all-day event counts from 09:00). On the desktop page and
 * on the game page (a small card over the game, no focus taken). Cheap: ONE setTimeout to the next reminder (at most 6 h ahead,
 * then it looks again), nothing else. A reminder missed while the TV was off is still shown within 30 minutes. Told ones: profile key
 * cal_fired (the last 50). */
var CalRemind = (function () {
    'use strict';

    var timer = 0, started = false, LATE = 30 * 60000, AHEAD = 6 * 3600000;

    function t(k) { return I18n.t(k); }
    function at(e) {
        var d = Events.parseYmd(e.d), hm = (e.time || '09:00').split(':');
        d.setHours(+hm[0], +hm[1], 0, 0);
        return d.getTime() - e.remind * 60000;
    }
    // the profile's events with a reminder around now (yesterday .. in 2 days)
    function due() {
        var k = Events.ymd(new Date()), out = [];
        for (var i = -1; i <= 2; i++) Events.day(Events.addDays(k, i), true).forEach(function (e) { if (e.kind === 'mine' && e.remind >= 0) out.push({ e: e, at: at(e), id: e.uid + '@' + e.d }); });
        return out;
    }
    function check() {
        clearTimeout(timer); timer = 0;
        var now = Date.now(), list = due(), fired = Store.get('cal_fired', []), next = now + AHEAD;
        fired = Array.isArray(fired) ? fired : [];
        list.forEach(function (r) {
            if (fired.indexOf(r.id) >= 0) return;
            if (r.at <= now) {
                fired.push(r.id);
                if (now - r.at > LATE) return;                               // long gone (the TV was off): never a pile of old cards
                var time = r.e.time ? Desktop.timeText(new Date(2000, 0, 1, +r.e.time.slice(0, 2), +r.e.time.slice(3))) : t('calAllDay');
                var when = r.e.d === Events.ymd(new Date()) ? t('calToday') : t('calTomorrow');
                Notify.show({ id: 'calr-' + r.e.uid, kind: 'info', timeout: 20000, title: t('calReminder'), text: r.e.t + ' · ' + when + ', ' + time,
                              onClick: typeof Win !== 'undefined' && !GameHost.active() ? function () { Win.open('calendar'); } : null });
            } else if (r.at < next) next = r.at;
        });
        Store.set('cal_fired', fired.slice(-50));
        timer = setTimeout(check, Math.max(1000, next - now));
    }
    function start() {
        if (started) return;
        started = true;
        Events.onChange(check);                                              // an event added, changed or removed
        check();
    }
    function stop() { clearTimeout(timer); timer = 0; }

    return { start: start, stop: stop, check: check, _due: due };
})();
