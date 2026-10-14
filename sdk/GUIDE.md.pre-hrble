# My PC SDK v1: build an app or game for My PC

My PC is a Samsung Smart TV app (2024 and newer TVs, Tizen 8+) that looks like a small Windows
PC. It also runs in desktop browsers. Its **App Store** offers extra **apps and games built by anyone**: each one is a normal
static website (for example on GitHub Pages) that includes the My PC SDK.

> **For an AI assistant reading this:** you were probably given this URL and a description of a
> game or app. Build it as a static site that follows **every MUST** below. Put it at the root of
> its own repository, ready for GitHub Pages. Start from the template in section 9, keep the
> checklist in section 11, and finish with the instructions to publish and install it (section 10).

> **Always use the latest version of this guide.** Fetch it again at the start of every task:
> `https://raw.githubusercontent.com/imad-os/g/main/sdk/GUIDE.md` (freshest), or
> `https://imad-os.github.io/g/sdk/GUIDE.md`. Don't work from a saved copy or from memory.

**Starting a new app?** Put the template's `CLAUDE.md` and `.nojekyll` at the root of the new
repository (`https://github.com/imad-os/g/tree/main/sdk/template`): it makes Claude Code fetch
this guide and the SDK fresh before every task.

- SDK: `https://imad-os.github.io/g/sdk/mypc-sdk.js`
- This guide: `https://imad-os.github.io/g/sdk/GUIDE.md`
- Complete example: `https://imad-os.github.io/g/sdk/example/` (source: `sdk/example/` in
  `github.com/imad-os/g`)

---

## 1. How it works

```
 TV remote / gamepad / keyboard
            │
      ┌─────▼──────────────────────────────┐
      │ My PC (the TV app)                 │  owns the remote, the Back key, the pause
      │  ┌──────────────────────────────┐  │  menu, saves, top-10 scores and Voice Guide
      │  │ your app, full screen        │  │
      │  │ <iframe> on YOUR origin      │◄─┼── postMessage (the SDK does this for you)
      │  │ sandbox: scripts + own origin│  │
      │  └──────────────────────────────┘  │
      └────────────────────────────────────┘
```

- My PC opens your `entry` page in a **full-screen sandboxed iframe** on your own site. When the
  player quits, the iframe is **destroyed**, which frees all its memory.
- **My PC owns the input.** Your page never receives focus on the TV. My PC sends you
  **actions** (`left`, `jump`...), not keys. Never read `keydown` yourself; use the SDK.
- **Back is My PC's.** It opens the pause menu (Resume, your own menu items, Quit). You get
  `onPause` / `onResume` / `onDestroy`. On a gamepad, **holding Start** (Switch **+**, Xbox Menu,
  PlayStation Options) does the same. A **short press of Start** opens My PC's menu too, unless your
  app has its own menu: then init with `ownMenu: true` and you receive the `menu` action instead.
- **Standalone mode:** opened directly in a browser (not inside My PC), the SDK acts as the host:
  the keyboard sends actions, Esc or P pauses, and saves go to `localStorage`. You can develop and
  test with any browser, no TV needed.

## 2. Files (at the root of the site)

| File | Required | What |
|---|---|---|
| `mypc-app.json` | **MUST** | the manifest, read by the App Store Manager (section 3) |
| `index.html` | **MUST** | the entry page (or whatever `entry` says) |
| `icon.png` or `icon.svg` | SHOULD | square icon, 256×256 or larger, shown on the desktop and in Start |
| other files | MAY | your JS, CSS, images, audio, all relative paths |

The site **MUST** be served over **https** and must allow other sites to read `mypc-app.json`
(CORS). GitHub Pages does both automatically. Add an empty `.nojekyll` file at the root.

## 3. `mypc-app.json`

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
  "scores": true
}
```

| Field | Rules |
|---|---|
| `mypc` | **MUST** be `1` (SDK version) |
| `id` | **MUST** be 2–32 characters `a-z 0-9 -`, unique, and never change it (saves are keyed by it) |
| `name` | **MUST**, 40 characters at most |
| `description` | short, 120 characters at most |
| `type` | `"game"` or `"app"` (apps go in the Apps folder and have no top-10 table) |
| `entry` | page to open, relative to the manifest (default `index.html`) |
| `icon` | relative path to the icon |
| `version` | your version string, e.g. `"1.2.0"`; bump it when you publish |
| `scores` | games only: `false` if the game has no points (no top-10 table) |
| `config` | optional default settings, a JSON object (see "App config" below); 8000 characters at most |

## 4. The SDK API

Load it with a plain script tag, **before** your own code:

```html
<script src="https://imad-os.github.io/g/sdk/mypc-sdk.js"></script>
```

It defines one global, `MyPC`.

### `MyPC.init(handlers)`: call once, as soon as your script runs

```js
MyPC.init({
    onInit:    function (info) {},   // REQUIRED: set up, load assets, then call MyPC.ready()
    onStart:   function () {},       // REQUIRED: start your game loop / show your UI
    onPause:   function () {},       // REQUIRED: stop the loop (cancelAnimationFrame), stop/mute sound
    onResume:  function () {},       // REQUIRED: restart the loop, sound back on
    onDestroy: function () {},       // REQUIRED: stop everything: loops, timers, AudioContext.close()
    onInput:   function (action, pressed, repeat, dev) {},  // optional: one call per action change
    onMenu:    function (id) {},     // optional: one of your pause-menu items was chosen
    onVolume:  function (v) {},      // optional: v = { music: 0..1, sfx: 0..1 } changed in Settings
    ownMenu:   false                 // optional: true = gamepad Start (short press) sends you 'menu'
});
```

The lifecycle is always:
`onInit` → (you call `ready()`) → `onStart` → (`onPause` ↔ `onResume`)* → `onDestroy`.
After `onPause` the game **MUST NOT** move or make sound until `onResume`.

### `info` (given to `onInit`, also `MyPC.info()`)

```js
{
  standalone: false,               // true when opened directly in a browser
  lang: 'en',                      // 'en' | 'fr' | 'es' | 'ar': show your texts in this language
  rtl: false,                      // true for Arabic: the SDK already sets <html dir="rtl">
  volume: { music: 0.7, sfx: 0.8 },// multiply your music / sound effect gains by these
  profile: { id: 'p1', name: 'Imad' }, // the My PC profile playing
  quality: { tier: 'low' | 'mid' | 'high' }, // the TV's speed: draw fewer effects on 'low'
  app: { id: 'app-star-catcher' }
}
```

### App config: `MyPC.app_config`

Settings that the **owner changes without touching the code**: difficulty, a server address, a
list of levels, feature switches. In the App Store Manager, each app has a **Config** button
that edits a JSON object stored with the app in Firebase. My PC reads it again from Firebase
**before the app opens** (offline, the last saved copy is used) and gives it to the app:

```js
MyPC.app_config            // always an object: {} when nothing is set; read it from onInit on
MyPC.app_config.speed      // e.g. 2
```

- Treat it as **read-only input**. Use your own defaults for missing keys
  (`var speed = +MyPC.app_config.speed || 1;`) and ignore keys you don't know.
- It is **not secret**: every TV downloads it, and the app's site can see it. No passwords or keys.
- Put sensible defaults in `mypc-app.json` as `"config": { ... }`; the App Store Manager uses them
  when the app is added, and updates never overwrite what the owner has set.
- Standalone (opened directly in a browser) it is `{}` unless you add `?app_config={"speed":2}`
  to the address, which lets you test different configs.

### Touch controls (phones and tablets)

My PC also runs on phones and tablets. **On a touch device My PC draws a customizable virtual pad above every app and game by
itself, so your app needs no touch code.** The pad is a joystick plus buttons; the player customizes it (gear button: add or hide
buttons, resize, drag anywhere, reset) and the layout is saved per app on the device (`vpad:app:<app id>`). It is never drawn on
a TV, and not while a gamepad is the active input. It is hidden while My PC's own screens are open (pause menu, multiplayer, dialogs)
and the pause menu gets a **Touch pad settings** entry on touch devices.

What the pad sends (the same actions the TV remote and gamepads send, device `'touch'`):

| Pad control | Action your `onInput` gets |
|---|---|
| stick | `left` `right` `up` `down` (a diagonal sends two) |
| button **A** (default) | `confirm` **and** `jump` (like the remote's OK) |
| button **B** (default) | `run` |
| button **C** (in the catalog) | `cancel` |
| button **&#9776;** (in the catalog) | `menu`: your own menu when you init with `ownMenu: true`, otherwise My PC's pause menu |
| pause button (top) | My PC's pause menu |

Defaults: **A** (ok) and **B** (run) are shown; **C** (cancel) and **&#9776;** (menu) can be added by the player.

**Change the buttons in `mypc-app.json`** (optional; the App Store Manager stores it with the app):

```json
"touch": {
  "buttons": [ { "label": "A", "action": "ok" }, { "label": "B", "action": "run" } ],
  "catalog": [ { "label": "A", "action": "ok" }, { "label": "B", "action": "run" }, { "label": "C", "action": "cancel" }, { "label": "\u2630", "action": "menu" } ],
  "scale": { "stick": 1, "btn": 1 }
}
```
- `buttons` = shown at first, `catalog` = everything the player may add (8 entries at most each), `label` 3 characters at most,
  `action` one of `ok` `run` `cancel` `menu`, `scale` = starting size multipliers (0.5 to 2.5; use about 1.3 for a game that is only played
  with the pad). Invalid entries are ignored (the App Store Manager refuses them when you add the app).
- **`"touch": false`**: your app has its **own touch UI**: My PC draws nothing.
- The same can be said from code: `MyPC.init({ pad: false | { buttons, catalog, scale } })`; it wins over the manifest.
  `pad: true` means "no preference". In a browser outside My PC (standalone) `MyPC.init({ pad: true })` shows the pad on touch devices,
  feeding the SDK input directly (no fake keyboard events), so you can test on a phone.

**A pad of your own: `MyPC.pad`** (API level 4; `undefined` on older SDKs). For example a phone that is only a controller for a game
running on the TV (send the presses with `MyPC.multiplayer`):

```js
MyPC.pad.init({
    force: true,                                            // draw it on this device whatever it is
    id: 'controller',                                       // the saved layout is kept per id
    buttons: [ { label: 'A', action: 'jump' }, { label: 'B', action: 'fire' } ],     // any action names here; or { label, key: 13 }
    catalog: [ ... ],                                       // everything the player may add (default: buttons)
    scale: { stick: 1.3, btn: 1.2 },
    onAction: function (action, down) { peer.send({ a: action, d: down }); }     // stick: left right up down, pause button: pause
    // send: function (keyCode, down) { ... }              // instead, or for buttons that have only a key code
});
MyPC.pad.hide();                                            // give the screen back to My PC's pad
MyPC.pad.openSettings();                                    // open the player's settings from your own menu
MyPC.pad.active();                                          // true while it is shown
```
In My PC the **shell draws** this pad too (right size, above your app, hidden under My PC's menus), and sends the presses back to
`onAction` / `send`. Standalone the SDK draws it itself. Option names and the customization panel are those of the virtual pad
library (`sdk/pad/README.md`: `buttons`, `catalog`, `scale`, `pause`, `customize`, `id`, `onAction`, `send`, `force`).

Rules:
- **Do not build your own pad.** If you do (your own touch UI), set `"touch": false` so My PC does not draw a second one.
- Keep a way to play with the default pad: **A** is `confirm` + `jump`, **B** is `run`, the stick is the four directions.
- Check your app on a phone (landscape and portrait) with My PC's pad, or with your own pad and `"touch": false`.

### Multiplayer: `MyPC.multiplayer` (API level 3)

Games and apps can offer **local multiplayer** (friends on the same Wi-Fi) with **no lobby screen, no server and no
Firebase keys of their own**. **My PC owns the whole flow**, so every game gets the same "Open a room" screen, "Join a
friend" list, "<name> wants to join: Accept / Decline" dialog and the same TV-remote / gamepad / touch navigation, in
English, French, Spanish and Arabic. Your game never sees room ids, offers, answers or Firebase; it only receives
**connected peers** and their messages.

```js
if (!MyPC.multiplayer.supported) { /* an older My PC: hide the multiplayer button */ }

// HOST: My PC shows "Open a room" (room name = the player's My PC profile name)
MyPC.multiplayer.host({ max: 1 }).then(function (session) {      // max = friends allowed, 1-7 (default 1)
    session.onPeer(function (peer) {                             // a friend was accepted AND is connected
        peer.onMessage(function (msg) { ... });
        peer.onClose(function () { ... });
        peer.send({ x: 10, y: 4 });                              // any JSON value, 4 KB at most
    });
    // session.peers = the connected peers; session.close() closes the room and disconnects everybody
}, function (e) { /* e.code: 'cancelled' (Back), 'offline', 'denied', 'unavailable' */ });

// GUEST: My PC shows the live list of this game's open rooms, asks the host and waits
MyPC.multiplayer.join().then(function (host) {                   // the host as a peer, once accepted and connected
    host.onMessage(function (msg) { ... });
    host.send('hello');
}, function (e) { /* e.code: 'cancelled' | 'denied' | 'gone' | 'timeout' | 'connect' | 'offline' */ });
```

What My PC does for you:
- **`host()`**: a full-screen "Open a room" screen (Back cancels). After you confirm, the promise resolves. Whenever a friend
  asks to join, My PC shows a small dialog over your game (it **pauses** the game like the pause menu, `onPause` / `onResume`
  are called). Accept connects the friend, Decline refuses. The game draws nothing for this. When `max` friends are in, the room
  **closes by itself**.
- **`join()`**: a full-screen "Join a friend" list (it refreshes every 3 s) of the open rooms **of this app only**, then
  "Waiting for <host> to accept...". It resolves once accepted and connected. On any problem (declined, closed, no answer,
  not on the same Wi-Fi, offline) **My PC already showed the reason**: your game only goes back to its menu. Do not show your
  own error for `cancelled`.
- **Peer** = `{ id, name, send(msg), onMessage(fn), onClose(fn), close() }`. `name` is the other player's My PC profile name.
  `send` returns `false` when the message is refused (closed, over 4 KB, not JSON, or sent too fast).
- Messages are **ordered and reliable**, any JSON value up to **4 KB**, at most **100 per second** per peer each way (more are
  dropped: send state changes, not every frame; 10-30 per second is plenty). A ping every second; a peer silent for 5 s is closed
  (`onClose`).
- **Everything is torn down when the app closes**: rooms, requests, connections and screens.
- One open room per TV and 5 join attempts per minute (`denied`).

Rules for app authors:
- **Do not build your own lobby, codes, signalling or Firebase.** The checklist item below is a MUST.
- **Same network only.** Connections are direct (WebRTC, no relay): both devices must be on the same Wi-Fi / network. If they are not,
  `join()` rejects with `connect` after My PC explained it to the player.
- Messages come from another device: **validate them** and never `eval` them or put them in `innerHTML`. Keep rules and cheating
  checks in the host's game (the host is the authority).
- Room names are public (they list the player's profile name); network addresses are exchanged to connect. Nothing private.
- **Standalone** (the page opened directly in a browser, not in My PC): the same API works with small built-in screens between
  **two tabs of the same browser**, so you can test without a TV. `sdk/example/multiplayer.html` is a two-player "ping" demo:
  open it in two tabs (one picks "Host a game", the other "Join a friend").
- Older My PC versions: `MyPC.multiplayer.supported` is `false` and `host()` / `join()` reject with `unavailable`. `MyPC.apiLevel`
  is 3 (the protocol version stays 1: apps without multiplayer need no change).

### Calls

| Call | What |
|---|---|
| `MyPC.progress(p)` | loading progress 0..1 (My PC shows its own loading bar until `ready()`) |
| `MyPC.ready()` | **MUST** be called once, when the first screen can be shown. Then `onStart` comes. |
| `MyPC.fail(reason)` | loading failed: My PC shows Retry / Back |
| `MyPC.isDown(action)` | `true` while an action is held (read it in your fixed-step update) |
| `MyPC.save(key, value)` | save JSON data (per My PC profile; 64 KB per app in total) |
| `MyPC.load(key, default)` | read saved data (synchronous; available from `onInit`) |
| `MyPC.submitScore(score, {player, players})` | at game over: if it makes the top 10, My PC saves it by itself under the name of the active profile (no typing) |
| `MyPC.announce(text)` | read text aloud with the TV's Voice Guide (game over, level names, menus) |
| `MyPC.setMenu([{id, label}])` | up to 6 extra pause-menu items (e.g. Restart, Level select); `label` already translated |
| `MyPC.pause()` | ask My PC to open the pause menu (e.g. your own on-screen pause button) |
| `MyPC.exit()` | close the app and go back to the desktop |

## 5. Input

Actions: `left right up down` (directions), `jump` and `confirm` (OK / Enter / Space / gamepad A),
`run` (gamepad B/X, Shift, X: also "fire"), `cancel`, `pause`.

- My PC keeps some keys for itself and **never sends them to apps**: Channel Up / Down and PageUp /
  PageDown (`pageUp`, `pageDown`), Guide / F6 (`guide`, which opens the pause menu), Tab.
- On the TV remote, **OK** sends `confirm` **and** `jump`. Use `confirm` in menus, `jump` in play.
- `repeat` is `true` for auto-repeat of a held direction: use it for menus, ignore it in play.
- `dev` is the device: `'keys'` (remote or arrows), `'keys2'` (second keyboard player: W A S D, F, G)
  or `'pad0'`..`'pad3'`. Use it for local multiplayer (one hero per device).
- **Every action MUST be reachable with the TV remote alone:** arrows + OK. Don't rely on
  `run`/`cancel` (the remote has no such buttons), and never require a mouse, touch or text typing.
- Back / Esc always belongs to My PC (pause menu). Never use it for in-game actions.
- `menu`: gamepad Start (or Select), short press. Sent only to apps that init with `ownMenu: true`
  (open your own menu on it, and close it on `menu` or `cancel`); for other apps it opens My PC's
  pause menu. Holding Start for 0.7 s always opens My PC's pause menu, so players can still quit.
  The TV remote has no Start: give your menu another way in too (e.g. an on-screen button with OK).

## 6. Screen

- Fill the whole window: `html, body { margin:0; height:100%; overflow:hidden }`. The window is
  16:9 (1920×1080 on most TVs, but 1280×720 or 3840×2160 happen).
- Draw at a fixed logical size (e.g. 480×270 or 960×540) and scale it to the window, as the example
  does. Listen to `resize`.
- Text: large (at least 3–4% of the screen height), high contrast, nothing important within 5% of
  the edges.
- Focus/selection MUST be obvious from 3 m away (thick bright outline or a scale-up).

## 7. Supported TVs, performance and memory (MUST)

**My PC supports Samsung Smart TVs from 2024 and newer only: Tizen 8.0 and newer** (Tizen 8 =
Chromium 108, Tizen 9 = Chromium 120). It also runs in current desktop browsers. Older TVs
(2018–2023, Tizen 4–7) are **not** supported, so don't spend effort on them.

- **JavaScript:** modern JavaScript up to ES2022 is fine: `let`/`const`, arrow functions,
  classes, template strings, `async`/`await`, `?.` and `??`, ES modules (`<script type="module">`).
  Don't use anything newer than Chrome 108 (for example `Array.prototype.findLast` is OK, but
  `Array.fromAsync`, `Object.groupBy`, or `Set` methods like `union` are not). No build step is
  needed; if you use one, target `chrome108`.
- **CSS:** flexbox, grid, `gap`, `aspect-ratio`, `:has()`, container queries and
  `backdrop-filter` all work. **CSS nesting does not** (Chrome 112+). Keep `backdrop-filter`
  blur small or avoid it on full-screen layers: TV GPUs are slow.
- **One** `requestAnimationFrame` loop with a **fixed 60 Hz update step**; cancel it in
  `onPause` and `onDestroy`. Avoid `setInterval`.
- **No allocation per frame:** pools for bullets, particles and enemies; no `new` and no array or
  object literals inside the loop. TVs have little RAM and garbage-collection pauses show as
  stutter.
- Canvas 2D or WebGL (WebGL 2 is available on Tizen 8+). Keep textures small.
- Audio: one `AudioContext`, created in `onStart` (not before), **closed in `onDestroy`**. Prefer
  short sounds or synthesized sounds (oscillators). Big MP3s are slow to decode on TVs.
- Total download should stay small (aim for < 10 MB); show progress with `MyPC.progress()`.
- No third-party trackers, ads or analytics. Your own fonts/images only (or freely licensed ones).
- Original names and art only. No Nintendo, Tetris or other brands' look-alikes.

## 8. Languages

Use `info.lang` and keep a small table of texts for `en`, `fr`, `es`, `ar` (fall back to `en`).
For Arabic, `info.rtl` is `true`. Keep numbers and the game world left-to-right, mirror menus only.

## 9. Template (copy this)

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>My Game</title>
<style>
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
  canvas { display: block; width: 100vw; height: 100vh; }
</style>
</head>
<body>
<canvas id="c"></canvas>
<script src="https://imad-os.github.io/g/sdk/mypc-sdk.js"></script>
<script>
(function () {
    'use strict';
    var W = 480, H = 270, canvas, ctx, raf = 0, last = 0, acc = 0, STEP = 1000 / 60;

    function resize() {
        var s = Math.min(window.innerWidth / W, window.innerHeight / H) * (window.devicePixelRatio || 1);
        canvas.width = Math.round(W * s); canvas.height = Math.round(H * s);
        ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    }
    function update() { /* fixed 60 Hz: read MyPC.isDown('left') ... */ }
    function draw() { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); }
    function frame(ts) {
        raf = requestAnimationFrame(frame);
        if (!last) last = ts;
        acc += Math.min(250, ts - last); last = ts;
        while (acc >= STEP) { update(); acc -= STEP; }
        draw();
    }
    function startLoop() { if (!raf) { last = 0; acc = 0; raf = requestAnimationFrame(frame); } }
    function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = 0; }

    MyPC.init({
        onInit: function (info) {
            canvas = document.getElementById('c'); ctx = canvas.getContext('2d');
            resize(); window.addEventListener('resize', resize);
            MyPC.setMenu([{ id: 'restart', label: 'Restart' }]);
            MyPC.ready();
        },
        onStart: startLoop,
        onPause: stopLoop,
        onResume: startLoop,
        onDestroy: function () { stopLoop(); window.removeEventListener('resize', resize); },
        onInput: function (action, pressed, repeat) { /* menus, one-shot actions */ },
        onMenu: function (id) { if (id === 'restart') { /* reset */ } }
    });
})();
</script>
</body>
</html>
```

The full example (`sdk/example/index.html`) adds texts in 4 languages, a pool, saves, scores and
Voice Guide announcements.

## 10. Publish and install

1. Push the site to a GitHub repository with the files at the root (plus `.nojekyll`).
2. Repository → **Settings → Pages** → *Deploy from a branch* → `main` / root. Wait for
   `https://<user>.github.io/<repo>/` to show the app.
3. Check `https://<user>.github.io/<repo>/mypc-app.json` opens in the browser.
4. On a computer, open the **App Store Manager**: **`https://imad-os.github.io/g/installer/`**, sign
   in, paste the app address, press **Check**, then **Add to store** (or tick it under **Apps from
   imad-os** if the repository is named `g_…`).
5. It is in the **App Store** of every My PC right away (Home shows the newest apps and the popular
   ones). People install it there; it then appears on their desktop, in Start and in File Explorer.

**To update an app** (TVs get it the next time the app is opened, no need to restart My PC):
1. Bump `version` in `mypc-app.json` (e.g. `1.2.0` -> `1.3.0`), and put that same version on every
   file `index.html` loads from your own site: `<script src="game.js?v=1.3.0">`,
   `<link rel="stylesheet" href="style.css?v=1.3.0">`, and images or sounds loaded from code
   (`'sprites.png?v=' + VERSION`). Keep the SDK `<script>` as it is.
2. Push, and wait until GitHub Pages has published it (repository → Actions: green tick).
3. In the App Store Manager press **Update** next to the app (or paste the address, **Check**, **Update**).

Right before an app opens, My PC reads its document in the store again and loads
`index.html?mypc_v=<version>`. A new version number therefore always skips the TV's cache (and
GitHub's 10-minute cache) for `index.html`, and the `?v=` on your files does the same for them.
If the version is not bumped, TVs may keep showing the old files for a while.
Scores sent with `MyPC.submitScore` go to the TV's Leaderboards and, when they are good enough, to
the World records.

## 11. Checklist (all MUST pass)

- [ ] `mypc-app.json` valid: `mypc: 1`, `id`, `name`, `type`, `entry`, `icon`
- [ ] `MyPC.init()` called once; `MyPC.ready()` called once after loading
- [ ] `onPause` stops the loop and sound; `onResume` restarts them; `onDestroy` stops everything
      and closes the `AudioContext`
- [ ] input only through the SDK (`onInput` / `MyPC.isDown`), playable with arrows + OK only
- [ ] no `keydown` listeners of your own, no use of Back/Esc
- [ ] fills the window at any 16:9 size, readable text, obvious focus
- [ ] runs on Chromium 108 (Tizen 8, 2024 TVs): no CSS nesting, nothing newer than Chrome 108; no allocation in the game loop
- [ ] saves through `MyPC.save/load`; scores through `MyPC.submitScore` (games with points)
- [ ] playable on a phone with the touch pad (or with your own touch UI and `"touch": false`): no second pad of your own
- [ ] multiplayer uses `MyPC.multiplayer`: no own lobby, no backend, no Firebase keys (hide the feature when `MyPC.multiplayer.supported` is false; handle `cancelled` quietly)
- [ ] any owner-changeable setting comes from `MyPC.app_config` (with defaults in code), not hard-coded
- [ ] texts in `en` (and `fr`, `es`, `ar` if possible), using `info.lang`
- [ ] works standalone: open `index.html` in Chrome, play with the arrows + Enter, Esc pauses
- [ ] served over https with CORS (GitHub Pages)
- [ ] every own script, stylesheet and asset is loaded with `?v=<version>`, the same as `version` in `mypc-app.json` (bumped for every release)
