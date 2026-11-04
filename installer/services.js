/* App Store Manager > Services: runs the push notification services of the store apps (installer/services-lib.js).
 *
 * Only while a Manager tab is open: one tab at a time is the runner (lease in Firestore services/_runner, renewed every
 * 30 s, taken over after 90 s). Each service is a .js file on the app's own site, listed in its mypc-app.json; an admin
 * approves its code (SHA-256 of the file) and picks the interval; a changed file waits for a new approval.
 * Each run: the file in a data: Worker (opaque origin, killed after 20 s), the rows checked (opted-in users only,
 * limits), one Firestore inbox/<username>/items/<id> per row. Built in: "App updates" when an app gets a new version.
 * Firestore: services/<app>__<service> (admins), subs/<app>/users/<username> (opt-in, written by players),
 * inbox/<username>/items/<id> (written here, read by the player's My PC: js/core/push.js). */
const SL = window.ServicesLib;

export function initServices(env) {
  const { db, fs, $, esc, toast, fbErr } = env;
  const { collection, getDocs, doc, getDoc, setDoc, deleteDoc } = fs;
  const TAB = Math.random().toString(36).slice(2, 10);
  const LEASE_MS = 90000, SUBS_MS = 10 * 60000;
  let docs = {}, subs = {}, sent = {}, running = {}, leader = false, leaseBy = '', loaded = false, tick = 0, wake = null;
  const now = () => Date.now();
  const key = (app, svc) => app + '__' + svc;
  const apps = () => env.apps().filter((a) => a && a.id);
  const list = () => {
    const out = [];
    apps().forEach((a) => {
      (a.services || []).forEach((s) => out.push({ app: a, s, k: key(a.id, s.id) }));
      out.push({ app: a, s: { id: 'updates', title: 'App updates', builtin: true }, k: key(a.id, 'updates') });
    });
    return out;
  };

  /* ---------- Firestore ---------- */
  async function loadDocs() {
    try {
      const snap = await getDocs(collection(db, 'services'));
      docs = {};
      snap.docs.forEach((d) => { docs[d.id] = d.data(); });
      loaded = true;
      $('sv-msg').textContent = '';
    } catch (e) { $('sv-msg').textContent = fbErr(e); $('sv-msg').className = 'small err'; }
  }
  async function save(k, patch) {
    const d = Object.assign({}, docs[k] || {}, patch);
    docs[k] = d;
    await setDoc(doc(db, 'services', k), d);
    return d;
  }
  async function subscribers(appId, fresh) {
    const c = subs[appId];
    if (!fresh && c && now() - c.at < SUBS_MS) return c.list;
    let l = [];
    try { l = (await getDocs(collection(db, 'subs/' + appId + '/users'))).docs.map((d) => d.id); } catch (e) { l = c ? c.list : []; }
    subs[appId] = { at: now(), list: l };
    return l;
  }

  // one runner at a time: the lease document says which tab runs the services
  async function lease() {
    try {
      const r = await getDoc(doc(db, 'services', '_runner'));
      const l = r.exists() ? r.data() : null;
      if (!l || l.tab === TAB || now() - (l.at || 0) > LEASE_MS) {
        await setDoc(doc(db, 'services', '_runner'), { tab: TAB, by: env.who(), at: now() });
        leader = true; leaseBy = '';
      } else { leader = false; leaseBy = l.by || 'another Manager'; }
    } catch (e) { leader = false; leaseBy = ''; }
    renderHead();
  }

  /* ---------- running one service ---------- */
  async function sha256(text) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  async function fetchCode(s) {
    const r = await fetch(s.file, { cache: 'no-store' });
    if (!r.ok) throw new Error('could not load ' + s.file + ' (HTTP ' + r.status + ')');
    const code = await r.text();
    return { code, hash: await sha256(code) };
  }
  function runCode(code, input) {
    return new Promise((resolve) => {
      let w;
      try { w = new Worker('data:text/javascript;charset=utf-8,' + encodeURIComponent(SL.WORKER)); }
      catch (e) { return resolve({ ok: false, error: 'could not start a worker: ' + e.message }); }
      const t = setTimeout(() => { w.terminate(); resolve({ ok: false, error: 'timeout: no answer in ' + SL.LIMITS.runMs / 1000 + ' s' }); }, SL.LIMITS.runMs);
      w.onmessage = (e) => { clearTimeout(t); w.terminate(); resolve(e.data || { ok: false, error: 'no answer' }); };
      w.onerror = (e) => { clearTimeout(t); w.terminate(); resolve({ ok: false, error: e.message || 'the worker failed' }); e.preventDefault(); };
      w.postMessage(Object.assign({ src: 'data:text/javascript;charset=utf-8,' + encodeURIComponent(code) }, input));
    });
  }
  // test = true: runs it and returns the rows, nothing sent, nothing saved
  async function run(item, test) {
    const { app, s, k } = item;
    if (running[k]) return null;
    running[k] = true; renderList();
    const d = docs[k] || {}, t0 = now();
    let res = null, error = '', items = [], dropped = 0, why = {}, changed = false;
    try {
      const f = await fetchCode(s);
      if (!test && f.hash !== d.hash) {
        await save(k, { newHash: f.hash });
        changed = true;
        throw new Error('the file changed: approve the new code first');
      }
      let state = null;
      try { state = d.state ? JSON.parse(d.state) : null; } catch (e) { state = null; }
      const users = await subscribers(app.id, test);
      res = await runCode(f.code, { app: app.id, service: s.id, subscribers: users, state, config: app.config || {}, now: t0, lastRun: d.lastRun || 0 });
      if (!res.ok) throw new Error(res.error);
      const c = SL.checkRows(res.out, users, test ? {} : (sent[app.id] = sent[app.id] || {}), t0);
      items = c.items; dropped = c.dropped; why = c.why;
      if (c.error) error = c.error;
      if (!test) {
        await deliver(app, items, t0);
        if (c.state !== undefined) d.state = c.state;
      }
    } catch (e) { error = String(e.message || e); }
    running[k] = false;
    const ms = now() - t0;
    if (test) { renderList(); return { items, dropped, why, error, ms }; }
    const failed = !!error && !items.length && !(res && res.ok) && !changed;
    const fails = failed ? (d.fails || 0) + 1 : 0;
    const log = [{ at: t0, sent: items.length, dropped, ms, error: error.slice(0, 300) }].concat(d.log || []).slice(0, 20);
    const patch = { app: app.id, svc: s.id, lastRun: t0, lastSent: items.length, lastDropped: dropped, lastMs: ms, lastError: error.slice(0, 300), fails, log, state: d.state || '' };
    if (fails >= 5) patch.paused = true;
    try { await save(k, patch); } catch (e) { /* shown at the next load */ }
    renderList();
    return { items, dropped, why, error, ms };
  }
  async function deliver(app, items, t0) {
    const exp = new Date(t0 + SL.LIMITS.keepDays * 86400000);
    await Promise.all(items.map((it, i) => setDoc(doc(db, 'inbox/' + it.user + '/items', SL.itemId(app.id, t0, i)), SL.inboxItem(it, app, t0, exp))));
  }

  // the scheduler (every 15 s, this tab only when it holds the lease)
  async function loop() {
    tick++;
    if (tick % 2 === 1) await lease();
    if (!leader || !loaded) return;
    const t = now();
    for (const it of list()) {
      if (it.s.builtin) continue;
      const d = docs[it.k];
      if (!d || !d.enabled || d.paused || !d.hash || (d.newHash && d.newHash !== d.hash) || running[it.k]) continue;
      if (SL.due(d, t)) await run(it, false);
    }
  }

  /* ---------- App updates (built in): a new version of an app in the store ---------- */
  async function appUpdated(old, app) {
    if (!old || !app || old.version === app.version) return 0;
    const d = docs[key(app.id, 'updates')];
    if (d && d.enabled === false) return 0;
    const users = await subscribers(app.id, true);
    if (!users.length) return 0;
    const c = SL.checkRows({ notifications: [{ username: '*', title: app.name + ' was updated', message: 'Version ' + app.version + ' is ready. Open it to see what is new.', image: app.icon || '', link: 'app' }] },
      users, sent[app.id] = sent[app.id] || {}, now());
    try { await deliver(app, c.items, now()); } catch (e) { return 0; }
    return c.items.length;
  }

  /* ---------- the page ---------- */
  const when = (t) => !t ? 'never' : Math.round((now() - t) / 60000) < 1 ? 'just now' : Math.round((now() - t) / 60000) < 60 ? Math.round((now() - t) / 60000) + ' min ago' : new Date(t).toLocaleString();
  function status(it) {
    const d = docs[it.k] || {};
    if (it.s.builtin) return d.enabled === false ? ['off', 'Off'] : ['installed', 'On'];
    if (running[it.k]) return ['cnt', 'Running…'];
    if (!d.hash) return ['update', 'Waiting for approval'];
    if (d.newHash && d.newHash !== d.hash) return ['update', 'Code changed: approve again'];
    if (d.paused) return ['off', 'Paused after errors'];
    if (!d.enabled) return ['off', 'Off'];
    return ['installed', 'On'];
  }
  function renderHead() {
    const el = $('sv-runner');
    if (!el) return;
    el.innerHTML = leader ? '<span class="dot on"></span>Services run in this tab. Keep it open (a computer that stays on is best).'
      : leaseBy ? '<span class="dot"></span>Services run in another Manager tab (' + esc(leaseBy) + '). This one takes over if that tab closes.'
      : '<span class="dot"></span>Starting…';
  }
  function renderList() {
    const box = $('sv-list');
    if (!box) return;
    const rows = list();
    const appsWith = rows.filter((r) => !r.s.builtin).length;
    $('sv-empty').hidden = appsWith > 0;
    box.innerHTML = rows.map((it) => {
      const d = docs[it.k] || {}, [cls, label] = status(it), sub = subs[it.app.id];
      const every = SL.EVERY.map((m) => '<option value="' + m + '"' + ((d.every || it.s.every || 5) === m ? ' selected' : '') + '>every ' + m + ' min</option>').join('');
      const acts = it.s.builtin ? '' :
        '<button class="small" data-act="review">' + (d.hash && (!d.newHash || d.newHash === d.hash) ? 'Code' : 'Review and approve') + '</button>' +
        '<button class="small" data-act="test">Test</button>' +
        '<button class="small" data-act="now"' + (d.hash && !running[it.k] ? '' : ' disabled') + '>Run now</button>' +
        '<button class="small" data-act="log"' + ((d.log || []).length ? '' : ' disabled') + '>Log</button>';
      const last = it.s.builtin ? '<span class="muted small">Sent when you publish a new version of the app</span>'
        : d.lastRun ? esc(when(d.lastRun)) + ' · ' + (d.lastSent || 0) + ' sent' + (d.lastDropped ? ', ' + d.lastDropped + ' dropped' : '') + ' · ' + (d.lastMs || 0) + ' ms' +
          (d.lastError ? '<span class="sub err">' + esc(d.lastError) + '</span>' : '') : '<span class="muted">never</span>';
      return '<tr data-k="' + esc(it.k) + '">' +
        '<td><b>' + esc(it.app.name) + '</b><span class="sub">' + esc(it.s.title || it.s.id) + (it.s.file ? ' · <a href="' + esc(it.s.file) + '" target="_blank" rel="noopener">' + esc(it.s.file.split('/').pop()) + '</a>' : '') + '</span></td>' +
        '<td><label class="row"><input type="checkbox" data-act="on"' + ((it.s.builtin ? d.enabled !== false : d.enabled) ? ' checked' : '') + (it.s.builtin || d.hash ? '' : ' disabled') + ' aria-label="On"><span class="tag ' + cls + '">' + esc(label) + '</span></label></td>' +
        '<td>' + (it.s.builtin ? '–' : '<select data-act="every" aria-label="Interval">' + every + '</select>') + '</td>' +
        '<td class="num">' + (sub ? sub.list.length : '–') + '</td>' +
        '<td>' + last + '</td>' +
        '<td class="row">' + acts + '</td></tr>';
    }).join('');
  }
  const itemOf = (el) => { const tr = el.closest('tr'); return tr && list().find((x) => x.k === tr.dataset.k); };

  function modal(title, html, approve) {
    $('sv-mtitle').textContent = title;
    $('sv-mbody').innerHTML = html;
    $('sv-approve').hidden = !approve;
    $('sv-approve').onclick = approve || null;
    $('sv-modal').hidden = false;
    $('sv-close').focus();
  }
  $('sv-close').onclick = () => { $('sv-modal').hidden = true; };
  $('sv-modal').addEventListener('keydown', (e) => { if (e.key === 'Escape') $('sv-modal').hidden = true; });

  $('sv-list').addEventListener('change', async (e) => {
    const it = itemOf(e.target);
    if (!it) return;
    try {
      if (e.target.dataset.act === 'on') {
        await save(it.k, { app: it.app.id, svc: it.s.id, enabled: e.target.checked, paused: false, fails: 0, every: (docs[it.k] || {}).every || it.s.every || 5 });
        toast(it.s.title + (e.target.checked ? ' is on.' : ' is off.'));
      }
      if (e.target.dataset.act === 'every') { await save(it.k, { app: it.app.id, svc: it.s.id, every: +e.target.value }); toast(it.s.title + ': every ' + e.target.value + ' min.'); }
    } catch (er) { toast(fbErr(er)); }
    renderList();
  });
  $('sv-list').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    const it = b && itemOf(b);
    if (!it) return;
    const act = b.dataset.act;
    if (act === 'review') {
      let f;
      try { f = await fetchCode(it.s); } catch (er) { return modal(it.s.title, '<p class="err">' + esc(er.message) + '</p>'); }
      const d = docs[it.k] || {}, ok = d.hash === f.hash;
      modal(it.app.name + ' · ' + it.s.title,
        '<p class="small muted">' + (ok ? 'This code is approved.' : 'Read it before you approve: it runs in this browser (in a sandbox, without your sign-in) every few minutes and can send notifications to the people who allowed them.') + '</p>' +
        '<pre class="code">' + esc(f.code) + '</pre><p class="small muted">SHA-256 ' + esc(f.hash) + '</p>',
        ok ? null : async () => {
          try { await save(it.k, { app: it.app.id, svc: it.s.id, hash: f.hash, newHash: '', paused: false, fails: 0, every: d.every || it.s.every || 5, enabled: d.hash ? !!d.enabled : true }); toast('Approved: ' + it.s.title + ' runs every ' + ((docs[it.k] || {}).every) + ' min.'); }
          catch (er) { toast(fbErr(er)); }
          $('sv-modal').hidden = true; renderList();
        });
    }
    if (act === 'test') {
      b.disabled = true;
      const r = await run(it, true);
      b.disabled = false;
      if (!r) return;
      modal('Test · ' + it.s.title, '<p class="small">' + r.items.length + ' notification(s) would be sent, ' + r.dropped + ' dropped, in ' + r.ms + ' ms. Nothing was sent.</p>' +
        (r.error ? '<p class="small err">' + esc(r.error) + '</p>' : '') +
        (Object.keys(r.why).length ? '<p class="small muted">Dropped: ' + Object.entries(r.why).map(([w, n]) => esc(w) + ' (' + n + ')').join(', ') + '</p>' : '') +
        (r.items.length ? '<table><thead><tr><th>To</th><th>Title</th><th>Message</th><th>Link</th></tr></thead><tbody>' + r.items.slice(0, 50).map((x) =>
          '<tr><td>' + esc(x.user) + '</td><td>' + esc(x.title) + '</td><td>' + esc(x.text) + '</td><td>' + esc(x.link || '') + '</td></tr>').join('') + '</tbody></table>' : ''));
    }
    if (act === 'now') { b.disabled = true; const r = await run(it, false); if (r) toast(r.error ? it.s.title + ': ' + r.error : it.s.title + ': ' + r.items.length + ' sent.'); }
    if (act === 'log') {
      const l = (docs[it.k] || {}).log || [];
      modal('Log · ' + it.s.title, '<table><thead><tr><th>When</th><th class="num">Sent</th><th class="num">Dropped</th><th class="num">ms</th><th>Error</th></tr></thead><tbody>' +
        l.map((x) => '<tr><td>' + esc(new Date(x.at).toLocaleString()) + '</td><td class="num">' + x.sent + '</td><td class="num">' + x.dropped + '</td><td class="num">' + x.ms + '</td><td class="err">' + esc(x.error || '') + '</td></tr>').join('') + '</tbody></table>');
    }
  });
  $('sv-reload').onclick = async () => { await loadDocs(); await Promise.all(apps().map((a) => subscribers(a.id, true))); renderList(); };

  // keeps the computer awake while this tab runs the services (where the browser allows it)
  async function awake() { try { if (leader && !wake && navigator.wakeLock && document.visibilityState === 'visible') { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (e) { wake = null; } }
  document.addEventListener('visibilitychange', awake);

  let started = false;
  return {
    // after the Manager loaded the apps (and on every reload)
    async refresh() {
      await loadDocs();
      await Promise.all(apps().map((a) => subscribers(a.id)));
      renderList();
      if (!started) { started = true; await loop(); setInterval(loop, 15000); awake(); }
    },
    appUpdated,
    // for tests: the lease state and one scheduler pass
    _state: () => ({ leader, tab: TAB }), _loop: loop
  };
}
