# Prompt: build a new My PC game or app with an AI

Copy everything between the two lines below into the AI (Claude, ChatGPT, Copilot...) at the start of a new game or
app. Fill in the **WHAT TO BUILD** part first. The prompt points the AI at the live guide and SDK in
`github.com/imad-os/g`, so it stays correct as My PC changes; the rules written in it are the ones that must never be
broken even if the AI cannot open links.

---

You are building a **game or app for My PC**: a Samsung Smart TV app (Tizen, Chromium-based web runtime) that looks
like a small Windows 11 PC and has its own App Store. My PC also runs in desktop browsers and on phones / tablets.
Your result will be opened by My PC in a **full-screen sandboxed iframe** and must follow the My PC SDK contract
exactly. **The top priority is smooth performance on low-resource TVs** (weak CPU and GPU, little RAM): when in doubt,
choose the lighter option.

## WHAT TO BUILD

- Name: `<name, 40 characters max>`
- Id: `<a-z 0-9 -, 2 to 32 characters; never change it later, saves are keyed by it>`
- Type: `<game | app>`
- Idea: `<describe the game or app, its screens, controls and goal>`
- Extras wanted: `<none | scores | local multiplayer | phone motion controls | heart-rate sensor | owner config keys>`
- Repository / GitHub Pages address: `<https://<user>.github.io/<repo>/>`

## 1. Read the sources first (always fresh, never from memory)

1. Guide, the single source of truth: https://raw.githubusercontent.com/imad-os/g/main/sdk/GUIDE.md
   (fallback: https://imad-os.github.io/g/sdk/GUIDE.md). Follow **every MUST** and finish with its checklist.
2. SDK, load it with this exact tag before your own code, never copy it into the repo:
   `<script src="https://imad-os.github.io/g/sdk/mypc-sdk.js"></script>`
3. Working examples: https://github.com/imad-os/g/tree/main/sdk/example (`index.html` game, `multiplayer.html`).
4. Repo template: put https://github.com/imad-os/g/tree/main/sdk/template `CLAUDE.md` and `.nojekyll` at the root.
5. Only if you use phone motion: https://github.com/imad-os/g/blob/main/docs/phone-controller.md

If anything in this prompt disagrees with the guide, **the guide wins**. If you cannot open the links, follow the rules
below, which are a summary of it.

## 2. Files (static site, root of its own repository, GitHub Pages ready)

- `mypc-app.json` (MUST), `index.html` (MUST), `icon.svg` or `icon.png` (square, 256 px+), `.nojekyll`, your own
  JS / CSS / assets with **relative paths**. No build step needed; if you use one, target `chrome108`.
- Manifest:

```json
{
  "mypc": 1,
  "id": "star-catcher",
  "name": "Star Catcher",
  "description": "Catch the falling stars, dodge the rocks",
  "type": "game",
  "entry": "index.html",
  "icon": "icon.svg",
  "version": "1.0.0",
  "scores": true,
  "config": { "speed": 1 }
}
```

  `description` 120 characters max; `scores: false` for a game without points; `config` = owner-editable defaults
  (8000 characters max). Optional `"touch"` (pad buttons) or `"touch": false` (the app has its own touch UI).
- **Versioning:** every own script, stylesheet and asset is loaded with `?v=<version>` equal to `version` in
  `mypc-app.json` (`game.js?v=1.0.0`, `'sprites.png?v=' + VERSION`). Bump both on every release. Keep the SDK tag as is.

## 3. SDK contract (MUST)

```js
MyPC.init({
    onInit:    function (info) { /* build, load assets (MyPC.progress(p)), then */ MyPC.ready(); },
    onStart:   function () { /* start the one rAF loop, create the AudioContext here */ },
    onPause:   function () { /* cancelAnimationFrame, silence: nothing moves or sounds until onResume */ },
    onResume:  function () { /* restart loop and sound */ },
    onDestroy: function () { /* stop loops, clear timers, remove listeners, AudioContext.close() */ },
    onInput:   function (action, pressed, repeat, dev) { /* menus + one-shot actions */ },
    onMenu:    function (id) { /* your pause-menu items from MyPC.setMenu */ },
    onVolume:  function (v) { /* v.music, v.sfx 0..1 */ }
});
```

- `init` once, `ready` once. Lifecycle: `onInit` → `ready()` → `onStart` → (`onPause` ↔ `onResume`)* → `onDestroy`.
- `info` = `{ standalone, lang: 'en'|'fr'|'es'|'ar', rtl, volume: { music, sfx }, profile: { id, name },
  quality: { tier: 'low'|'mid'|'high' }, app: { id } }`.
- Calls: `MyPC.isDown(action)`, `MyPC.save(key, value)` / `MyPC.load(key, def)` (JSON, per profile, 64 KB per app),
  `MyPC.submitScore(score)` at game over, `MyPC.announce(text)` (Voice Guide), `MyPC.setMenu([{ id, label }])`
  (6 items max, translated), `MyPC.pause()`, `MyPC.exit()`, `MyPC.fail(reason)`, `MyPC.app_config` (read-only object,
  `{}` when unset: always use your own default per key, never put secrets in it).
- **Players / profiles:** My PC has user profiles and player accounts, and it syncs them to the cloud itself. Your app
  only sees `info.profile` (`id`, `name`) and stores progress with `MyPC.save` / `MyPC.load`, which are already per
  profile and backed up. Never build your own login, accounts, cloud saves, name entry for scores, Firebase or backend.

## 4. Input (MUST)

- Input comes **only** from the SDK: `onInput` and `MyPC.isDown`. Never add your own `keydown` / gamepad listeners.
- Actions: `left right up down`, `confirm` + `jump` (both sent by the remote's OK), `run`, `cancel`, `pause`, `menu`
  (only with `init({ ownMenu: true })`). `repeat` = auto-repeat of a held direction (menus yes, gameplay no).
  `dev` = `'keys'`, `'keys2'` (second player / second phone), `'pad0'..'pad3'`, `'touch'`.
- **Everything must work with the TV remote alone: arrows + OK.** Never require `run` / `cancel`, a mouse, touch or
  typing. Back / Esc always belongs to My PC (it opens the pause menu); never use it in the app.
- Touch (phones / tablets): **My PC draws the virtual pad itself.** Do not build a pad. Customize it with `"touch"` in
  the manifest or `MyPC.init({ pad })`; for a pad of your own use `MyPC.pad`; with your own touch UI set
  `"touch": false`.
- **Phone as a controller** (Buttons mode) needs nothing from you: it sends the same actions (player 1 `keys`,
  player 2 `keys2`). Motion modes come through `MyPC.sensors` (API level 8):
  `MyPC.sensors.setup({ moves: ['LEFT','RIGHT','JUMP','DUCK','DUCK_END'], metrics: { hz: 1 }, raw: { hz: 30 }, define: {...} })`,
  then `MyPC.sensors.on('action' | 'metrics' | 'raw' | 'players' | 'config', fn(ev, player))`. Ask only for the moves
  and rates you use. Without `setup`, moves simply press left / right / OK / down. The magic-remote **pointer** is a
  My PC feature of its own screens: your app never receives pointer messages; never draw a cursor that depends on it.
- **Local multiplayer:** only `MyPC.multiplayer.host({ max })` / `MyPC.multiplayer.join()` (API level 3). My PC owns
  the lobby, the accept dialog and the connection; you get peers `{ id, name, send, onMessage, onClose }`. JSON
  messages, 4 KB max, at most 100/s (send state changes, 10 to 30/s), same Wi-Fi only. Validate every message, never
  `eval` or `innerHTML` it, keep the host authoritative, handle `cancelled` silently, hide the feature when
  `MyPC.multiplayer.supported` is false.
- **Heart rate (TV only):** `MyPC.bluetooth` (API level 7): `capabilities()`, `scan({ seconds })`, `connect(id)`,
  `reconnectLast()`, `status()`, `disconnect()`, `startTest()` / `stopTest()`, events `status`, `reading`
  (`{ bpm, rr, rrs, contact, ... }`), `device-found`. Allowed only when the app's store config has
  `"heartRate": true`. Never touch `tizen.*`; keep a fallback for phones, browsers and older TVs.
- Check `MyPC.apiLevel` before using a newer API and degrade gracefully.

## 5. Performance on low-resource TVs (MUST, top priority)

- Target runtime: Chromium 108 (Samsung 2024+ TVs, Tizen 8; Tizen 9 is Chromium 120). ES2022 and modern CSS (grid,
  `gap`, `:has()`, container queries) are fine. **No CSS nesting**, nothing newer than Chrome 108
  (no `Object.groupBy`, `Array.fromAsync`, `Set.prototype.union`...).
- **One** `requestAnimationFrame` loop, **fixed 60 Hz update step** with an accumulator capped at 250 ms; cancel it in
  `onPause` and `onDestroy`. No `setInterval` for game logic; clear every timer you start.
- **Zero allocation per frame:** pre-allocated pools for bullets, particles, enemies; no `new`, no array / object
  literals, no closures, no string building, no `forEach` / `map` / `filter` inside update and draw.
- Draw at a fixed logical resolution (480×270 or 960×540) on one canvas and scale it to the window; redraw only what
  is needed. Batch fills by colour, cache static layers in an offscreen canvas, avoid `shadowBlur`, filters and
  per-frame gradients. Keep textures and sprite sheets small (power-of-two atlases for WebGL).
- DOM apps: few elements, animate only `transform` and `opacity`, no layout reads in loops, no big `box-shadow` or
  `backdrop-filter` on full-screen layers, no per-frame DOM writes when nothing changed.
- Respect `info.quality.tier`: on `'low'` fewer particles, no screen shake, lower internal resolution, fewer layers.
- Audio: a single `AudioContext` created in `onStart`, closed in `onDestroy`; prefer short sounds or synthesized
  oscillators; no large MP3s to decode.
- Small download (aim under 10 MB, ideally much less), lazy-load later levels, report `MyPC.progress()`.
- No third-party trackers, ads, analytics, CDNs or web fonts you do not ship yourself.
- Free everything on `onDestroy`: loops, timers, listeners, audio, WebGL contexts, sensor setups, multiplayer sessions.

## 6. Screen, accessibility, languages

- Fill the window (`html, body { margin: 0; height: 100%; overflow: hidden }`), any 16:9 size (720p to 4K), listen to
  `resize`. Keep important content out of the outer 5%.
- Text at least 3 to 4% of the screen height, high contrast; focus / selection obvious from 3 m (thick bright outline
  or scale-up). Dark theme matching My PC (Windows 11 style) for apps.
- `MyPC.announce()` for game over, level names and menu changes (Voice Guide).
- Strings in **en, fr, es, ar** from `info.lang` (fall back to `en`); for Arabic `info.rtl` is true: mirror menus
  only, keep numbers and the game world left-to-right.
- Original names and art only: no Nintendo, Tetris or other brand look-alikes.

## 7. Done means

- Works **standalone**: open `index.html` in Chrome, play with arrows + Enter, Esc pauses, saves use `localStorage`
  (add `?app_config={...}` to test config). Test on a phone with My PC's pad, and multiplayer in two tabs if used.
- Every item of the guide's section 11 checklist passes; list it in your final answer with a tick per item.
- Commit and push, then tell the owner: enable GitHub Pages (Settings → Pages → Deploy from a branch → `main` / root),
  check `https://<user>.github.io/<repo>/mypc-app.json` opens, then in the App Store Manager
  (https://imad-os.github.io/g/installer/) paste the address, **Check**, **Add to store** (or **Update** for a new
  version after bumping `version` and every `?v=`).

---
