/* App Store Manager > Widgets: the desktop widgets of the store apps (js/core/widget-lib.js, sdk/GUIDE.md "Desktop widgets").
 *
 * An app lists its widgets in mypc-app.json; adding or updating the app copies the list into its store document. Nothing
 * runs on a TV until an admin approves the widget here: Review loads the .js file from the app's site, shows it, and
 * Approve copies that exact code into Firestore widgets/<app>__<widget> and its SHA-256 into the app's document
 * (apps/<id>.widgets[i].sha). TVs run only that copy (a later change of the file on the site waits for a new approval).
 * Test runs the file here in the same sandbox the TVs use (a data: Worker) and draws what it returned. */
const WL = window.WidgetLib;

export function initWidgets(env) {
  const { db, fs, $, esc, toast, fbErr } = env;
  const { doc, setDoc, updateDoc, deleteDoc } = fs;
  const key = (app, w) => app + '__' + w;
  const site = {};           // key -> { hash, code } as last loaded from the app's site

  const list = () => {
    const out = [];
    env.apps().forEach((a) => (a.widgets || []).forEach((w) => out.push({ app: a, w, k: key(a.id, w.id) })));
    return out;
  };
  const pick = (v) => (v && typeof v === 'object' ? v.en || Object.values(v)[0] || '' : v || '');

  async function sha256(text) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  async function fetchCode(w) {
    const r = await fetch(w.file, { cache: 'no-store' });
    if (!r.ok) throw new Error('could not load ' + w.file + ' (HTTP ' + r.status + ')');
    const code = await r.text();
    if (code.length > WL.LIMITS.code) throw new Error('the file is bigger than ' + WL.LIMITS.code + ' characters');
    return { code, hash: await sha256(code) };
  }
  // the same sandbox as on the TVs: a Worker started from a data: address, killed after 10 s
  function runCode(code, input) {
    return new Promise((resolve) => {
      let w;
      try { w = new Worker('data:text/javascript;charset=utf-8,' + encodeURIComponent(WL.WORKER)); }
      catch (e) { return resolve({ ok: false, error: 'could not start a worker: ' + e.message }); }
      const t = setTimeout(() => { w.terminate(); resolve({ ok: false, error: 'timeout: no answer in ' + WL.LIMITS.runMs / 1000 + ' s' }); }, WL.LIMITS.runMs);
      w.onmessage = (e) => { clearTimeout(t); w.terminate(); resolve(e.data || { ok: false, error: 'no answer' }); };
      w.onerror = (e) => { clearTimeout(t); w.terminate(); resolve({ ok: false, error: e.message || 'the worker failed' }); e.preventDefault(); };
      w.postMessage(Object.assign({ src: 'data:text/javascript;charset=utf-8,' + encodeURIComponent(code) }, input));
    });
  }

  function status(it) {
    const s = site[it.k];
    if (!it.w.sha) return ['update', 'Waiting for approval'];
    if (s && s.hash !== it.w.sha) return ['update', 'Code changed on the site: approve again'];
    return ['installed', 'Approved'];
  }
  function render() {
    const box = $('wg-list');
    if (!box) return;
    const rows = list();
    $('wg-empty').hidden = rows.length > 0;
    box.innerHTML = rows.map((it) => {
      const [cls, label] = status(it), w = it.w;
      return '<tr data-k="' + esc(it.k) + '">' +
        '<td><b>' + esc(it.app.name) + '</b><span class="sub">' + esc(pick(w.title) || w.id) + ' · <a href="' + esc(w.file) + '" target="_blank" rel="noopener">' + esc(w.file.split('/').pop()) + '</a></span></td>' +
        '<td><span class="tag ' + cls + '">' + esc(label) + '</span>' + (w.approvedAt ? '<span class="sub">' + esc(new Date(w.approvedAt).toLocaleString()) + '</span>' : '') + '</td>' +
        '<td>' + esc(w.size) + ' · every ' + w.every + ' min' + (w.background ? ' · background' : '') + '<span class="sub">' + (w.settings || []).length + ' setting(s)</span></td>' +
        '<td class="row"><button class="small" data-act="review">' + (w.sha ? 'Code' : 'Review and approve') + '</button>' +
        '<button class="small" data-act="test">Test</button>' +
        '<button class="small danger" data-act="revoke"' + (w.sha ? '' : ' disabled') + '>Revoke</button></td></tr>';
    }).join('');
  }
  const itemOf = (el) => { const tr = el.closest('tr'); return tr && list().find((x) => x.k === tr.dataset.k); };

  function modal(title, html, approve) {
    $('wg-mtitle').textContent = title;
    $('wg-mbody').innerHTML = html;
    $('wg-approve').hidden = !approve;
    $('wg-approve').onclick = approve || null;
    $('wg-modal').hidden = false;
    $('wg-close').focus();
  }
  $('wg-close').onclick = () => { $('wg-modal').hidden = true; };
  $('wg-modal').addEventListener('keydown', (e) => { if (e.key === 'Escape') $('wg-modal').hidden = true; });

  // the app's document with this widget's approval changed (the rules check the whole document)
  async function setSha(it, sha) {
    const widgets = (it.app.widgets || []).map((w) => {
      const n = Object.assign({}, w);
      if (w.id === it.w.id) { if (sha) { n.sha = sha; n.approvedAt = Date.now(); } else { delete n.sha; delete n.approvedAt; } }
      return n;
    });
    await updateDoc(doc(db, 'apps', it.app.id), { widgets });
    it.app.widgets = widgets;
  }

  // a preview of the card, drawn like the TV draws it (js/launcher/widgets.js)
  function side(x) { return '<span class="wg-vs-side">' + (/^https:/.test(x || '') ? '<img src="' + esc(x) + '" alt="">' : esc(x || '')) + '</span>'; }
  function preview(v, w) {
    const rows = (v.rows || []).map((r) => '<div class="wg-row"><span>' + esc(r.label) + '</span><b>' + esc(r.value) + '</b></div>').join('');
    const btns = (v.buttons || []).map((b) => '<span class="wg-b">' + esc(b.label) + '</span>').join('');
    const ic = v.icon ? (/^https:/.test(v.icon) ? '<img src="' + esc(v.icon) + '" alt="">' : esc(v.icon)) : '';
    return '<div class="wg-card wg-' + esc(w.size) + '" style="border-top-color:' + esc(v.accent || '#4fc3ff') + '">' +
      '<div class="wg-head"><span class="wg-ic">' + ic + '</span>' + esc(v.title || pick(w.title) || w.id) + '</div>' +
      (v.matches ? v.matches.map((m) => '<div class="wg-vs wg-m"><span class="wg-ic">' + (/^https:/.test(m.icon || '') ? '<img src="' + esc(m.icon) + '" alt="">' : esc(m.icon || '')) + '</span>' + side(m.left) + '<b class="wg-ms">' + esc(m.score || '') + '</b>' + side(m.right) + '<span class="wg-sub" style="margin-left:auto">' + esc(m.info || '') + '</span></div>').join('') : '') +
      (v.matches ? '' : v.versus ? '<div class="wg-vs">' + side(v.versus.left) + '<div class="wg-big">' + esc(v.big || '') + '</div>' + side(v.versus.right) + '</div>'
        : v.big ? '<div class="wg-big">' + esc(v.big) + '</div>' : '') + (v.sub ? '<div class="wg-sub">' + esc(v.sub) + '</div>' : '') +
      (v.text ? '<div class="wg-text">' + esc(v.text) + '</div>' : '') +
      (v.progress !== undefined ? '<div class="wg-bar"><i style="width:' + Math.round(v.progress * 100) + '%;background:' + esc(v.accent || '#4fc3ff') + '"></i></div>' : '') +
      rows + (btns ? '<div class="wg-btns">' + btns + '</div>' : '') + '</div>';
  }

  $('wg-list').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    const it = b && itemOf(b);
    if (!it) return;
    const act = b.dataset.act;
    if (act === 'review') {
      let f;
      try { f = await fetchCode(it.w); } catch (er) { return modal(pick(it.w.title), '<p class="err">' + esc(er.message) + '</p>'); }
      site[it.k] = f;
      render();
      const ok = it.w.sha === f.hash;
      modal(it.app.name + ' · ' + (pick(it.w.title) || it.w.id),
        '<p class="small muted">' + (ok ? 'This code is approved: TVs run this exact copy.' : 'Read it before you approve: every TV that shows this widget will run this code (in a sandbox, without any sign-in or My PC data) at each refresh. TVs keep running the approved copy, even if the file changes later.') + '</p>' +
        '<pre class="code">' + esc(f.code) + '</pre><p class="small muted">SHA-256 ' + esc(f.hash) + (it.w.sha && !ok ? '<br>Approved before: ' + esc(it.w.sha) : '') + '</p>',
        ok ? null : async () => {
          try {
            await setDoc(doc(db, 'widgets', it.k), { app: it.app.id, widget: it.w.id, code: f.code, sha: f.hash, at: Date.now(), by: env.who() });
            await setSha(it, f.hash);
            toast('Approved: ' + (pick(it.w.title) || it.w.id) + '. TVs get it at their next start.');
          } catch (er) { toast(fbErr(er)); }
          $('wg-modal').hidden = true; render();
        });
    }
    if (act === 'test') {
      b.disabled = true;
      let html = '';
      try {
        const f = await fetchCode(it.w);
        site[it.k] = f;
        const settings = WL.settingsOf(it.w.settings || [], {});
        const t0 = Date.now();
        const r = await runCode(f.code, { app: it.app.id, widget: it.w.id, settings, state: null, size: it.w.size, lang: 'en', action: null, now: t0, lastRun: 0, config: it.app.config || {} });
        if (!r.ok) throw new Error(r.error);
        const res = WL.result(r.out);
        html = '<p class="small">Answered in ' + (Date.now() - t0) + ' ms with the default settings ' + esc(JSON.stringify(settings)) + '.</p>' +
          (res.error ? '<p class="small err">' + esc(res.error) + '</p>' : '') + preview(res.view || {}, it.w) +
          '<p class="small muted">What My PC kept of the answer:</p><pre class="code">' + esc(JSON.stringify(res.view, null, 2)) + '</pre>';
      } catch (er) { html = '<p class="err">' + esc(er.message || er) + '</p>'; }
      b.disabled = false;
      render();
      modal('Test · ' + (pick(it.w.title) || it.w.id), html);
    }
    if (act === 'revoke') {
      if (!confirm('Stop this widget on every My PC? It shows "Waiting for approval" until it is approved again.')) return;
      try { await setSha(it, ''); await deleteDoc(doc(db, 'widgets', it.k)); toast('Revoked.'); } catch (er) { toast(fbErr(er)); }
      render();
    }
  });

  return { refresh: render };
}
