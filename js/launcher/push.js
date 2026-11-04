/* Push notifications on My PC (TV, phone, computer): the inbox of the signed-in player account.
 *
 * Apps send them from a service the App Store Manager runs (installer/services.js, sdk/GUIDE.md "Push notifications"):
 * one Firestore document per notification in inbox/<username>/items/<id>. Only player accounts get them (the inbox is
 * keyed by username, the same on every TV or phone), and only from apps the player allowed: subs/<app>/users/<username>.
 *
 *   Push.start()             reads the inbox when it is due: every 2 minutes for the accounts listed in the App Store Manager >
 *                            Settings > Fast push notifications (GlobalSettings.notifyFast), every 30 minutes for the others
 *                            (Firestore free quota, owner decision 2026-11-04); also at start / back to the front once due
 *   Push.check(cb)           one read; new items are saved (last 50 per profile, key notifs) and shown as toasts (Notify)
 *   Push.state(appId)        'granted' | 'denied' | 'default' | 'no-account'
 *   Push.set(appId, on, cb)  allow / block an app (cb(err)); writes / deletes the opt-in document with the player's token
 *   Push.ask(ctx, cb)        the permission question (once per app), cb(state)
 *   Push.list() / unread() / markRead() / clear() / remove(id) / open(item) / onChange(fn)
 * Per profile: notifs (list), notif_seen (newest time read), notif_last (last read), notif_allow ({ app: 1 | 0 }). */
var Push = (function () {
    'use strict';

    var FAST = 120000, SLOW = 30 * 60000, KEEP = 50, timer = 0, busy = false, started = false, listeners = [], asking = false;

    function user() { var p = Profiles.current(); return p && p.user && Accounts.signedIn(p.id) ? p.user : ''; }
    function items() { var l = Store.get('notifs', []); return l && l.length !== undefined ? l : []; }
    function saveItems(l) { Store.set('notifs', l.slice(0, KEEP)); emit(); }
    function emit() { for (var i = 0; i < listeners.length; i++) { try { listeners[i](); } catch (e) {} } }
    function allowMap() { var m = Store.get('notif_allow', {}); return m && typeof m === 'object' ? m : {}; }

    function state(appId) {
        var p = Profiles.current();
        if (!p || !p.user) return 'no-account';
        var v = allowMap()[appId];
        return v === 1 ? 'granted' : v === 0 ? 'denied' : 'default';
    }
    function set(appId, on, cb) {
        cb = cb || function () {};
        var p = Profiles.current(), u = user();
        if (!u) return cb('no-account');
        Accounts.token(p.id, function (err, tok) {
            if (err) return cb(err);
            var path = 'subs/' + encodeURIComponent(appId) + '/users/' + encodeURIComponent(u);
            var done = function (e) {
                if (e && e !== 'notfound') return cb(e);
                var m = allowMap(); m[appId] = on ? 1 : 0; Store.set('notif_allow', m); emit(); cb(null);
            };
            if (on) Cloud.patch(path, { at: Date.now(), app: appId }, null, 8000, function (e) { done(e); }, tok);
            else Cloud.remove(path, 8000, done, tok);
        });
    }

    // "Allow notifications from <app>?" (Allow / Not now): once per app; a player account only
    function ask(ctx, cb) {
        var s = state(ctx.appId);
        if (s !== 'default' || asking) return cb(s);
        if (!user()) return cb('no-account');
        asking = true;
        var paused = ctx.hold ? ctx.hold() : false;
        function done(on) {
            asking = false;
            set(ctx.appId, on, function (e) {
                if (ctx.release && !ctx.dead) ctx.release(paused);
                if (e && on) App.toast(I18n.t('notifFailed'), { kind: 'err' });
                cb(state(ctx.appId));
            });
        }
        App.confirm(I18n.t('notifAskTitle').replace('%s', ctx.title), I18n.t('notifAskText'), function () { done(true); },
                    { yes: I18n.t('permAllow'), no: I18n.t('permDeny'), onNo: function () { done(false); } });
    }

    function appOf(id) { var l = Cloud.catalog(); for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }

    function toast(it) {
        var a = appOf(it.app);
        Notify.show({ id: 'push-' + it.id, kind: 'info', title: it.title, text: (it.name ? it.name + ' · ' : '') + (it.text || ''),
                      image: it.image || (a && a.icon) || '', timeout: 6000, onClick: function () { open(it); } });
    }

    // one read of the inbox: the items newer than the last one seen
    function check(cb) {
        cb = cb || function () {};
        var p = Profiles.current(), u = user();
        if (!u || busy) return cb(null, 0);
        busy = true;
        Accounts.token(p.id, function (err, tok) {
            if (err) { busy = false; return cb(err, 0); }
            var seen = +Store.get('notif_seen', 0) || 0, pid = p.id;
            Cloud.query('inbox/' + encodeURIComponent(u), {
                from: [{ collectionId: 'items' }],
                where: { fieldFilter: { field: { fieldPath: 'at' }, op: 'GREATER_THAN', value: { integerValue: String(seen) } } },
                orderBy: [{ field: { fieldPath: 'at' }, direction: 'DESCENDING' }],
                limit: 20
            }, 8000, function (e, rows) {
                busy = false;
                if (!e) Store.set('notif_last', Date.now());
                if (e || !rows) return cb(e || 'error', 0);
                if (Profiles.current().id !== pid) return cb(null, 0);          // the profile changed meanwhile
                var l = items(), have = {}, fresh = [], max = seen, i;
                for (i = 0; i < l.length; i++) have[l[i].id] = 1;
                for (i = 0; i < rows.length; i++) {
                    var d = rows[i].data || {};
                    if (!d.title || have[rows[i].id]) continue;
                    var it = { id: rows[i].id, app: String(d.app || ''), name: String(d.name || ''), title: String(d.title), text: String(d.text || ''),
                               image: /^https:\/\//.test(d.image || '') ? d.image : '', link: String(d.link || ''), at: +d.at || Date.now(), read: false };
                    fresh.push(it);
                    if (it.at > max) max = it.at;
                }
                if (max > seen) Store.set('notif_seen', max);
                if (!fresh.length) return cb(null, 0);
                saveItems(fresh.concat(l));
                // newest at the bottom: the 3 newest as cards; more than 3: 2 cards + "N more in Notifications"
                var shown = fresh.length > 3 ? fresh.slice(0, 2) : fresh;
                for (i = shown.length - 1; i >= 0; i--) toast(shown[i]);
                if (fresh.length > 3) Notify.show({ id: 'push-more', kind: 'info', title: I18n.t('notifs'), text: I18n.t('notifMore').replace('%s', fresh.length - 2), timeout: 6000,
                                                    onClick: function () { openPanel(); } });
                cb(null, fresh.length);
            }, tok);
        });
    }

    function openPanel() { if (typeof Win !== 'undefined' && !GameHost.active()) Win.open('settings', 'notifications'); }

    // a notification's link: https -> the Browser; 'app' or 'app?…' -> opens that app (MyPC.launch tells it which notification)
    function open(it) {
        markRead(it.id);
        var link = it.link || '';
        if (/^https:\/\//.test(link)) { if (typeof Win !== 'undefined' && !GameHost.active()) Win.open('browser', link); return; }
        var a = appOf(it.app);
        if (!a || !Cloud.isInstalled(a.id) || GameHost.active()) return;
        try { sessionStorage.setItem('mypc_launch', JSON.stringify({ id: 'app-' + a.id, launch: { link: link, title: it.title, text: it.text, at: it.at } })); } catch (e) {}
        Desktop.play(Desktop.fromCloud(a));
    }
    // read by game-host.js when the app says hello: the notification that opened this app, once
    function takeLaunch(gameId) {
        try {
            var v = JSON.parse(sessionStorage.getItem('mypc_launch') || 'null');
            sessionStorage.removeItem('mypc_launch');
            return v && v.id === gameId ? v.launch : null;
        } catch (e) { return null; }
    }

    function markRead(id) {
        var l = items(), ch = false;
        for (var i = 0; i < l.length; i++) if ((id === undefined || l[i].id === id) && !l[i].read) { l[i].read = true; ch = true; }
        if (ch) saveItems(l);
    }
    function unread() { var l = items(), n = 0; for (var i = 0; i < l.length; i++) if (!l[i].read) n++; return n; }
    function remove(id) { saveItems(items().filter(function (x) { return x.id !== id; })); }
    function clear() { saveItems([]); }

    // how often this account reads its inbox; the time left before the next read
    function every() { return GlobalSettings.notifyFast(user()) ? FAST : SLOW; }
    function wait() {
        var last = +Store.get('notif_last', 0) || 0, left = last + every() - Date.now();
        return last > Date.now() ? 0 : Math.max(0, left);      // a clock set back: read now
    }
    function checkIfDue() { if (user() && !document.hidden && wait() === 0) check(); }
    function schedule() {
        clearTimeout(timer);
        timer = setTimeout(function () { checkIfDue(); schedule(); }, Math.max(wait(), 15000));
    }
    function start() {
        if (started) return;
        started = true;
        setTimeout(checkIfDue, 1500);                             // a new sign-in has no notif_last yet: read at once
        schedule();
        document.addEventListener('visibilitychange', function () { if (!document.hidden) { checkIfDue(); schedule(); } });
    }

    return {
        start: start, check: check, every: every, state: state, set: set, ask: ask, list: items, unread: unread, markRead: markRead,
        remove: remove, clear: clear, open: open, takeLaunch: takeLaunch, onChange: function (fn) { listeners.push(fn); }
    };
})();
