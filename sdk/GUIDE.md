# My PC SDK v1: build an app or game for My PC

My PC is a Samsung Smart TV app (2024 and newer TVs, Tizen 8+) that looks like a small Windows
PC. It also runs in desktop browsers. It can install extra **apps and games built by anyone**: each one is a normal
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
  `onPause` / `onResume` / `onDestroy`.
- **Standalone mode:** opened directly in a browser (not inside My PC), the SDK acts as the host:
  the keyboard sends actions, Esc or P pauses, and saves go to `localStorage`. You can develop and
  test with any browser, no TV needed.

## 2. Files (at the root of the site)

| File | Required | What |
|---|---|---|
| `mypc-app.json` | **MUST** | the manifest, read by the installer (section 3) |
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
    onVolume:  function (v) {}       // optional: v = { music: 0..1, sfx: 0..1 } changed in Settings
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
list of levels, feature switches. In the installer, each installed app has a **Config** button
that edits a JSON object stored with the app in Firebase. My PC reads it again from Firebase
**before the app opens** (offline, the last saved copy is used) and gives it to the app:

```js
MyPC.app_config            // always an object: {} when nothing is set; read it from onInit on
MyPC.app_config.speed      // e.g. 2
```

- Treat it as **read-only input**. Use your own defaults for missing keys
  (`var speed = +MyPC.app_config.speed || 1;`) and ignore keys you don't know.
- It is **not secret**: every TV downloads it, and the app's site can see it. No passwords or keys.
- Put sensible defaults in `mypc-app.json` as `"config": { ... }`; the installer uses them on the
  first install, and updates never overwrite what the owner has set.
- Standalone (opened directly in a browser) it is `{}` unless you add `?app_config={"speed":2}`
  to the address, which lets you test different configs.

### Calls

| Call | What |
|---|---|
| `MyPC.progress(p)` | loading progress 0..1 (My PC shows its own loading bar until `ready()`) |
| `MyPC.ready()` | **MUST** be called once, when the first screen can be shown. Then `onStart` comes. |
| `MyPC.fail(reason)` | loading failed: My PC shows Retry / Back |
| `MyPC.isDown(action)` | `true` while an action is held (read it in your fixed-step update) |
| `MyPC.save(key, value)` | save JSON data (per My PC profile; 64 KB per app in total) |
| `MyPC.load(key, default)` | read saved data (synchronous; available from `onInit`) |
| `MyPC.submitScore(score, {player, players})` | at game over: My PC asks for 3 initials if it makes the top 10 |
| `MyPC.announce(text)` | read text aloud with the TV's Voice Guide (game over, level names, menus) |
| `MyPC.setMenu([{id, label}])` | up to 6 extra pause-menu items (e.g. Restart, Level select); `label` already translated |
| `MyPC.pause()` | ask My PC to open the pause menu (e.g. your own on-screen pause button) |
| `MyPC.exit()` | close the app and go back to the desktop |

## 5. Input

Actions: `left right up down` (directions), `jump` and `confirm` (OK / Enter / Space / gamepad A),
`run` (gamepad B/X, Shift, X: also "fire"), `cancel`, `pause`.

- On the TV remote, **OK** sends `confirm` **and** `jump`. Use `confirm` in menus, `jump` in play.
- `repeat` is `true` for auto-repeat of a held direction: use it for menus, ignore it in play.
- `dev` is the device: `'keys'` (remote or arrows), `'keys2'` (second keyboard player: W A S D, F, G)
  or `'pad0'`..`'pad3'`. Use it for local multiplayer (one hero per device).
- **Every action MUST be reachable with the TV remote alone:** arrows + OK. Don't rely on
  `run`/`cancel` (the remote has no such buttons), and never require a mouse, touch or text typing.
- Back / Esc always belongs to My PC (pause menu). Never use it for in-game actions.

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
4. On a computer, open the installer: **`https://imad-os.github.io/g/installer/`**, sign in,
   paste the app address, press **Check**, then **Install**.
5. Every My PC shows it on the desktop, in Start and in File Explorer the next time it starts.

To update an app, push the new version (bump `version`), then press **Check** and **Update** in
the installer if the name, icon or entry changed. Code changes go live without reinstalling.

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
- [ ] any owner-changeable setting comes from `MyPC.app_config` (with defaults in code), not hard-coded
- [ ] texts in `en` (and `fr`, `es`, `ar` if possible), using `info.lang`
- [ ] works standalone: open `index.html` in Chrome, play with the arrows + Enter, Esc pauses
- [ ] served over https with CORS (GitHub Pages)
