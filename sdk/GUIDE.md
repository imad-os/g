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
- **My PC's pause menu** (Resume, your own menu items, Quit) opens with **the TV remote's Back** or by
  **holding Start + Select together for 1 s** on a gamepad (Switch **+** and **-**, Xbox Menu + View,
  PlayStation Options + Share). You get `onPause` / `onResume` / `onDestroy`. Nothing else opens it
  while your app runs: a keyboard's **Esc / Backspace**, gamepad **B** and the phone controller's buttons
  come to your app, each with what the same button of a real Nintendo pad does (**A** = `run` + `cancel`, **B** = `confirm` + `jump`, **X** and **Y** = `run`; the phone's **+** is Start = `menu`). Start or Select alone is `menu`, sent to apps that init with
  `ownMenu: true` (on a gamepad it does nothing in other apps).
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

**Profiles and player accounts belong to My PC.** It has user profiles and player accounts and syncs them to the cloud
itself. Your app only sees `info.profile` and keeps progress with `MyPC.save` / `MyPC.load`, which are already per
profile and backed up. **Never** build your own login, accounts, cloud saves, name entry for scores, Firebase or backend.

Check `MyPC.apiLevel` before using a newer API (3 multiplayer, 4 pad, 7 bluetooth, 8 sensors, 9 gamepad) and hide the feature
when it is missing.

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
| button **A** (right, default) | `run` **and** `cancel` (what A does on a real Nintendo controller) |
| button **B** (bottom, default) | `confirm` **and** `jump` (like the remote's OK; what B does on a real Nintendo controller) |
| button **X** (top, in the catalog) | `run` (like the real X) |
| button **Y** (left, in the catalog) | `run` (like the real Y) |
| **+** button (top centre) | My PC's pause menu |

**Owner rule: the buttons are always called and placed A B X Y like a Nintendo controller (A right, B bottom, X top, Y left).
Never A B C, never a menu symbol (&#9776;) or the word "Menu" as a button. Pause / menu is the Nintendo-style **+** button.** The phone and the touch pad send exactly what the same button of a real Nintendo controller connected to the TV sends (My PC reads a pad by position:
the bottom button confirms / jumps, the right one runs / goes back), so a game plays the same with either. On the phone controller **+** is
Start (`menu`) and **Home** is the Guide button. Defaults: **A** and **B** are shown; **X** and **Y** can be added by the player.

**Change the buttons in `mypc-app.json`** (optional; the App Store Manager stores it with the app):

```json
"touch": {
  "buttons": [ { "label": "A", "action": "b", "place": "right" }, { "label": "B", "action": "ok", "place": "bottom" } ],
  "catalog": [ { "label": "A", "action": "b", "place": "right" }, { "label": "B", "action": "ok", "place": "bottom" }, { "label": "X", "action": "run", "place": "top" }, { "label": "Y", "action": "run", "place": "left" } ],
  "scale": { "stick": 1, "btn": 1 }
}
```
- `buttons` = shown at first, `catalog` = everything the player may add (8 entries at most each), `label` 3 characters at most,
  `action` one of `ok` `b` (run + cancel) `run` `cancel` `menu`, `place` one of `right` `bottom` `top` `left` (the Nintendo diamond), `scale` = starting size multipliers (0.5 to 2.5; use about 1.3 for a game that is only played
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
| `MyPC.net.fetch(url, opts)` | a web request through My PC, no CORS limit on the TV (section 14) |
| `MyPC.ai.generate(req)` / `MyPC.ai.chat(text)` | AI: Gemini, ChatGPT, Claude, NVIDIA, any OpenAI-compatible service; text, images, audio, video in and out (section 14) |
| `MyPC.mic.start(opts)` / `stop()` / `record(opts)` | the microphone, after the user allows it (section 14) |

## 5. Input

### Game controllers come first (MUST)

Design every game for a **game controller first** (Xbox, PlayStation, Switch Pro, 8BitDo, any Bluetooth or USB pad), then
make sure it still works with the other inputs. Players should never have to fight the button mapping:

- **Read every button with `MyPC.gamepad`** (API level 9), not only the few mapped actions below. All buttons, analog
  triggers and both sticks reach your app, with no limit on the number of buttons. Give every button a sensible job
  (for example A jump, B attack / back, X and Y abilities, LB / RB switch weapon or page, LT / RT analog brake and speed,
  the right stick the camera or aim, Start your own menu), and show the controls on screen with the button names.
- **Support up to 4 controllers** at once: `dev` (`'pad0'`..`'pad3'`) tells them apart, so local multiplayer is one
  hero per `dev`.
- The left stick and the D-pad also arrive as `left right up down`, A as `confirm` + `jump`: menus can stay on `onInput`.
- Reserved for My PC: holding **Start + Select** together for 1 s (its pause menu) and the **Home / Guide** button.
  You still receive their button events, but don't give them an essential job of their own.
- Never call `navigator.getGamepads()` or listen to `gamepadconnected` yourself: on the TV your page has no focus and gets
  nothing. The SDK does it for you (also standalone, where it reads the pads itself, so you can test with a pad on a PC).
- Physical controllers only: the TV remote, the keyboard, the touch pad send actions (a phone in Buttons mode is a real gamepad: `MyPC.gamepad` sees it as a standard pad, device `pad101` / `pad102`)
  (`onInput`), so the game must also be playable with `left right up down` + `confirm` (see the rules below).

```js
// every change of every button: index, pressed, value (0..1, analog triggers), dev 'pad0'..'pad3', name
MyPC.gamepad.on('button', function (i, pressed, value, dev, name) {
    if (name === 'X' && pressed) castSpell(dev);
});
// sticks moved: axes[0], axes[1] = left stick x / y, axes[2], axes[3] = right stick x / y (-1..1)
MyPC.gamepad.on('axes', function (axes, dev) {});       // `axes` is the SDK's own array: read it now, don't keep it
MyPC.gamepad.on('pads', function (list) {});            // [{ dev: 'pad0', name: 'Xbox Wireless Controller', standard: true, buttons: 17, axes: 4 }]

// or read the state in your fixed-step update (no allocation):
MyPC.gamepad.pressed(2, 'pad0');   // X held on the first pad (without dev: on any pad)
MyPC.gamepad.value(7);             // RT, 0..1 (the highest value of all pads)
MyPC.gamepad.axis(2, 'pad0');      // right stick x; apply your own dead zone (about 0.15)
MyPC.gamepad.name(3);              // 'Y'
MyPC.gamepad.pads();               // the connected controllers
```

Button indices follow the W3C **standard** layout (by position, whatever is printed on the pad):

| Index | Name | Xbox | PlayStation | Switch |
|---|---|---|---|---|
| 0 / 1 / 2 / 3 | `A` `B` `X` `Y` | A B X Y | Cross Circle Square Triangle | B A Y X |
| 4 / 5 | `LB` `RB` | LB RB | L1 R1 | L R |
| 6 / 7 | `LT` `RT` (analog) | LT RT | L2 R2 | ZL ZR |
| 8 / 9 | `Select` `Start` | View Menu | Share/Create Options | − + |
| 10 / 11 | `L3` `R3` | stick clicks | L3 R3 | stick clicks |
| 12 / 13 / 14 / 15 | `Up` `Down` `Left` `Right` | D-pad | D-pad | D-pad |
| 16 | `Home` (My PC's) | Xbox | PS | Home |
| 17 and up | `Button17`... | extra buttons (Share, paddles, touchpad click) | | Capture |

A pad that is not in the standard layout (`standard: false`) names every button `Button<i>`: let players see which
button does what, and keep the defaults on the standard indices.

### Actions (`onInput`)

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
- The TV remote's Back always belongs to My PC (pause menu); you never receive it. A keyboard's Esc and
  Backspace reach you as `cancel` (use it as your own "back": close a sub-menu, leave a screen).
- `menu`: gamepad Start or Select pressed alone (sent when let go). Sent only to apps that init with
  `ownMenu: true` (open your own menu on it, and close it on `menu` or `cancel`); on a gamepad other
  apps get nothing (the touch pad's + and the phone controller's + open My PC's pause menu for them).
  **Holding Start + Select together for 1 s** always opens My PC's pause menu, so players can still quit.
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
  Also no closures, string building or `forEach` / `map` / `filter` in update and draw.
- **Low-end TVs come first** (weak CPU and GPU): draw at a fixed logical size on one canvas,
  cache static layers in an offscreen canvas, avoid `shadowBlur`, canvas filters and per-frame
  gradients. On `info.quality.tier === 'low'`: fewer particles, no screen shake, lower internal
  resolution.
- **DOM apps:** few elements, animate only `transform` and `opacity`, no layout reads in loops,
  no DOM writes when nothing changed, no big `box-shadow` on full-screen layers.
- **Free everything in `onDestroy`:** loops, every timer, listeners, audio, WebGL contexts,
  `MyPC.sensors.stop()`, multiplayer sessions.
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
- [ ] **game controller first**: every button, trigger and both sticks used through `MyPC.gamepad`, controls shown on screen, up to 4 pads by `dev`
- [ ] input only through the SDK (`onInput` / `MyPC.isDown` / `MyPC.gamepad`), still playable with arrows + OK only
- [ ] no `keydown` listeners of your own (Esc reaches you as `cancel`; the remote's Back is never yours)
- [ ] fills the window at any 16:9 size, readable text, obvious focus
- [ ] runs on Chromium 108 (Tizen 8, 2024 TVs): no CSS nesting, nothing newer than Chrome 108; no allocation in the game loop
- [ ] saves through `MyPC.save/load`; scores through `MyPC.submitScore` (games with points)
- [ ] playable on a phone with the touch pad (or with your own touch UI and `"touch": false`): no second pad of your own
- [ ] multiplayer uses `MyPC.multiplayer`: no own lobby, no backend, no Firebase keys (hide the feature when `MyPC.multiplayer.supported` is false; handle `cancelled` quietly)
- [ ] any owner-changeable setting comes from `MyPC.app_config` (with defaults in code), not hard-coded
- [ ] texts in `en` (and `fr`, `es`, `ar` if possible), using `info.lang`
- [ ] works standalone: open `index.html` in Chrome, play with the arrows + Enter, Esc pauses
- [ ] requests to other sites through `MyPC.net`, AI through `MyPC.ai`, the microphone through `MyPC.mic` (section 14): no own proxy, AI SDK or `getUserMedia`; each error code handled (`denied`, `no-provider`...)
- [ ] served over https with CORS (GitHub Pages)
- [ ] every own script, stylesheet and asset is loaded with `?v=<version>`, the same as `version` in `mypc-app.json` (bumped for every release)

## 12. Phone controllers with motion: `MyPC.sensors` (API level 8)

The Android app (**My PC for Android**, `android-controller/My-PC.apk`, downloaded from the desktop's **Get the app**)
is **the whole My PC app** on the phone, not a separate controller: your app runs in it like on any device, and the phone
controller is its **Game controller** app. Never build or describe a controller-only APK.

Players can use a phone as a controller (My PC > **Game controller** on the phone). Besides **Buttons** (the virtual pad;
your app just gets the usual actions) the phone has two motion modes: **Motion moves** (the phone, in the player's right
hand, detects moves such as `LEFT` `RIGHT` `JUMP` `DUCK` `DUCK_END` and sends only the ones you ask for, plus running
metrics if you want them) and **Motion data** (raw sensor samples at the rate you ask for). A fourth mode, **Pointer**,
is a magic-remote style pointer for the My PC screens only: your app never sees it (its A / B buttons arrive as the
usual actions), and `players` may report `'pointer'` for such a phone. **Buttons** has A B X Y where a Nintendo
controller has them (A right, B bottom, X top, Y left), a **+** (Start) and a Home (Guide) button that My PC keeps for itself (your app never gets Home); the player may swap the stick for a D-pad (same `left` `right` `up` `down`). Each button sends exactly what the same
button of a real Nintendo controller on the TV sends: A = `run` + `cancel`, B = OK / `jump`, X = `run`, Y = `run`, **+** = Start (`menu`), Home = Guide. How strong each move must be (per move, harder while running) and the repeat guard (one move,
not two, for a step and its bounce back) are set by the player on the TV (Settings > Devices > Phone controller >
Motion moves) and apply to your app too; your own `define` rules still win for the moves they name. Actions may carry
`gait` (`IDLE`, `WALK`, `RUN`).

```js
MyPC.init({ onInit: function () {
    MyPC.sensors.setup({ moves: ['LEFT', 'RIGHT', 'JUMP', 'DUCK', 'DUCK_END'],
                         profile: { age: 30, height: 175, weight: 70, phone_position: 'right hand' },   // optional, cm / kg
                         metrics: { hz: 1 } });                                                         // optional
} });
MyPC.sensors.on('action', function (ev, player) { if (ev.action === 'JUMP') jump(player); });
MyPC.sensors.on('metrics', function (m, player) { showPace(m.pace_sec_per_km, m.cadence, m.gait); });
```

Also `on('raw' | 'players' | 'config')`, `stop()`, `players()`, `config()`, `available()`, and `define` in `setup` for
moves of your own (a rule on a signal, no code on the phone). Without `setup`, motion moves simply press left / right /
OK / down for your app. The full protocol, the rules behind each move, units and limits:
[docs/phone-controller.md](https://github.com/imad-os/g/blob/main/docs/phone-controller.md).

## 13. Heart-rate sensors: `MyPC.bluetooth` (API level 7, TV only)

On a TV, My PC reads heart-rate sensors over Bluetooth LE for your app: anything that speaks the standard **Heart Rate
Service** (`180D`, measurement `2A37`): chest straps (Polar H10 / H9 / H7, Garmin HRM-Dual / HRM-Pro / HRM-Fit, Decathlon
Kalenji / Kiprun, Wahoo TICKR, Coospo…), arm bands (Polar Verity Sense / OH1) and watches that broadcast their heart rate
(Garmin Forerunner 55 and others: on the watch, *Settings > Sensors & Accessories > Wrist Heart Rate > Broadcast Heart
Rate*, or hold UP during an activity). Your app never touches `tizen.bluetooth`: My PC owns it and sends you events.

Only allowed apps get it: the HR Monitor app (`hr-monitor`), or any app whose **config** in the App Store Manager has
`"heartRate": true`. Others get the error "Bluetooth is not allowed for this app." Outside a TV (standalone, phones)
every call fails with a clear message; keep a fallback.

```js
MyPC.bluetooth.on('status', function (e) {
    // e.status: scanning | scan-complete | scan-cancelled | connecting | connected | stale | no-contact
    //           | reconnecting (e.attempt) | disconnected (e.reason: 'user' | 'lost') | error | test | test-stopped
    show(e.status, e.message || '', e.deviceName || '');
});
MyPC.bluetooth.on('reading', function (r) {
    // { bpm, format: 8 | 16, contact: 'Detected' | 'Not Detected' | 'Waiting', contactState: 'detected' | 'not-detected' | 'unsupported',
    //   energy (kJ or null), rr (last RR interval, ms, or null), rrs: [all RR intervals in this packet, ms], deviceName, source: 'ble' | 'simulation', time }
    heart(r.bpm);
});
MyPC.bluetooth.on('device-found', function (e) { addToList(e.device); });   // { id, name, address, rssi, last? }; again with updated: true when its name arrives

var cap = await MyPC.bluetooth.capabilities();   // { nativeBleAvailable, reasonCode, message, powered, lastDevice, state }
var res = await MyPC.bluetooth.scan({ seconds: 10 });   // { devices: [...] } (3 to 30 s); the user picks one
await MyPC.bluetooth.connect(res.devices[0].id);
await MyPC.bluetooth.reconnectLast();            // the sensor used last on this TV, no list (it scans for it)
await MyPC.bluetooth.status();                   // { state, device, lastDevice, lastReadingAgoMs, stale }
await MyPC.bluetooth.disconnect();
await MyPC.bluetooth.startTest();                // simulated readings once a second (no sensor needed); stopTest()
```

What My PC does for you:

- **8- and 16-bit heart rates**, energy expended, any number of RR intervals; a truncated packet keeps its heart rate.
  Readings with bpm 0 (strap off the skin) are not sent; a `no-contact` status is.
- **Finding the sensor**: devices are listed once each (by address), named when the scan response arrives; the Heart Rate
  service and its measurement are found whatever UUID form the TV firmware gives (short, long, upper case, from
  `getServiceAllUuids`), and on firmware without characteristic UUIDs the notifying characteristic is used.
- **Staying connected**: a sensor that drops (watch stops broadcasting, strap out of range) is reconnected by itself:
  `reconnecting` with backoff (1, 2, 4, 8, 15 s…), first with the old handle, then by scanning for it again, for 5
  minutes. A connection with no reading for 10 s is reported as `stale` (and `connected` again when readings come back).
  `disconnect()` stops all of that.
- `reasonCode` of `capabilities()`: `available`, `powered-off` (Bluetooth off in the TV settings), `no-adapter`,
  `unsupported-tv`, `permission-denied` (the installed package lacks the Bluetooth privilege), `adapter-error`,
  `tizen-api-unavailable` (not on a TV).

The native side is `js/core/hr-ble.js` (unit tests in `tests/unit-tests.mjs` with fake Garmin, Polar and Decathlon devices).

## 14. Web requests, AI and the microphone: `MyPC.net`, `MyPC.ai`, `MyPC.mic` (API level 10)

Your app runs in a sandboxed iframe on its own website, so it **cannot** call most APIs directly (CORS errors), use the
TV's own (Tizen) APIs, or open the microphone on a TV. My PC does these things for you over the SDK. **MUST**: use
these calls for any request to another website, any AI call and any microphone use; never put your own proxy, a CORS
workaround, `getUserMedia` or a third-party AI SDK in the app. Check `MyPC.apiLevel >= 10` (an older My PC rejects the
calls with `code: 'unsupported'`).

Every call returns a Promise. Errors are `Error` objects with a `code` (and `status` for HTTP errors):
`denied` (the user said no) · `no-provider` (no AI service set up) · `unsupported` · `bad-request` · `blocked` ·
`http` · `network` · `timeout` · `too-big` · `busy` · `cancelled` · `not-running` · `no-mic` · `safety`.
Show a short message and keep the app usable without the feature.

**Standalone** (your page opened directly in a browser) the same calls work inside the page: the SDK loads My PC's own
modules next to it. There only APIs that send CORS headers answer, AI needs your own provider object with a key (see
below), and the microphone is the browser's (it asks the user).

### `MyPC.net`: web requests without CORS limits

```js
var r = await MyPC.net.fetch('https://api.example.com/items?page=1', {
    method: 'POST',                        // GET (default) POST PUT PATCH DELETE HEAD OPTIONS
    headers: { 'X-Api-Key': '...' },       // the browser's own headers (Cookie, Origin, User-Agent, Referer...) cannot be set
    json: { name: 'x' },                   // or body: string | ArrayBuffer | Uint8Array | Blob, or form: { field: 'text', file: blob }
    responseType: 'json',                  // 'text' (default) | 'json' | 'arraybuffer' (images, audio, any binary)
    timeout: 30000,                        // ms (30 s default, 10 min at most)
    onChunk: function (text) { }           // optional: the answer piece by piece while it arrives (Server-Sent Events, long answers)
});
r.ok; r.status; r.statusText; r.url; r.headers['content-type']; r.body;   // body: string, parsed JSON or ArrayBuffer
r.text(); r.json();
var req = MyPC.net.fetch(url); req.abort();                 // stop a request
```

- On a **TV** the request goes out from My PC itself, which has no CORS limit: any public API works. In a browser or on
  the Android app My PC is a web page too, so there only APIs that allow other sites (CORS) answer; keep a message for that.
- Addresses of the **local network** (192.168.x.x, 10.x, localhost, `*.local`...) are refused (`blocked`) unless the
  owner sets `"lan": true` in the app's config in the App Store Manager. Only `http` and `https` addresses.
- At most 8 requests at once and 32 MB per answer. Requests stop when the app closes.

### `MyPC.ai`: AI for your app (Gemini, ChatGPT, Claude, NVIDIA, any OpenAI-compatible API)

The TV owner adds AI services in **Settings > AI** with their API keys: Google Gemini, OpenAI (ChatGPT), Anthropic Claude,
NVIDIA, OpenRouter, Groq, Mistral, DeepSeek, xAI, Together, Ollama / LM Studio on a computer at home, or any custom
OpenAI-compatible address with any model. **Your app never sees the keys.** The first AI request of an app asks the user
"*<app> wants to use AI*" (Allow / Don't allow); the answer is kept until Settings > Privacy & security > *Forget what
apps were allowed*. If no service is set up you get `no-provider` (and the TV tells the user where to add one).

```js
var res = await MyPC.ai.generate({
    provider: 'gemini',                 // optional: a service id or kind ('gemini' 'openai' 'anthropic' 'nvidia' 'groq' 'ollama'...);
                                        // default: the app config's ai.provider, else the TV's default service
    model: 'gemini-2.5-flash',          // optional: else the app config's ai.model, else the service's model from Settings > AI
    system: 'You are a quiz master for children.',            // string or [lines]
    rules: ['Answer in ' + MyPC.info().lang, 'Never more than 3 sentences'],
    context: { level: 3, score: 1200 },                       // string or any JSON: added to the instructions
    examples: [{ input: 'Easy question about cats', output: '{"q":"How many legs does a cat have?","a":"4"}' }],
    messages: [ { role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello!' } ],   // earlier turns (optional)
    prompt: ['What is in this picture?', { type: 'image', data: arrayBuffer, mime: 'image/jpeg' }],   // the new user turn
    output: 'json',                     // 'text' (default) | 'json' | 'image' | 'audio' | 'video' | ['text', 'image'] ...
    schema: { type: 'object', properties: { q: { type: 'string' }, a: { type: 'string' } }, required: ['q', 'a'] },
    temperature: 0.7, maxTokens: 400, topP: 0.9, stop: ['END'], seed: 1,
    extra: { }                          // optional: fields copied as they are into the service's own request body
}, {
    onDelta: function (text) { }        // optional: streaming, the answer piece by piece (text output)
});
res.text;      // the whole text answer
res.json;      // output 'json': the parsed object (undefined if the model did not answer valid JSON)
res.parts;     // [{ type: 'text', text }, { type: 'image' | 'audio' | 'video', mime, data: ArrayBuffer }]
res.usage;     // { input, output, total } tokens (when the service says), res.model, res.provider, res.finish

var txt = await MyPC.ai.chat('Tell me a joke');           // shortcut: prompt in, text out
var list = await MyPC.ai.providers();                     // [{ id, name, type, preset, model, isDefault }] (no keys)
var job = MyPC.ai.generate(req); job.cancel();            // stop a request
```

**Parts** (in `prompt`, or in `messages[].content` as an array): a string, `{ type: 'text', text }`, or
`{ type: 'image' | 'audio' | 'video' | 'file', data, mime, url, name }` where `data` is an ArrayBuffer, a typed array,
a Blob, base64 or a `data:` URL, or `url` an https address My PC downloads. `file` is for PDF documents.

**Tasks**: `task` is guessed from `output` ('image' → image, 'audio' → speech, 'video' → video) or set it yourself:

| `task` | What | Gemini | OpenAI / compatible | Claude |
|---|---|---|---|---|
| `chat` (default) | text / JSON answer; input text, images, audio, video, PDF | ✓ (all inputs; image / audio output with `output: ['text', 'image']`) | ✓ text, images, audio (`input_audio`), PDF; audio answer with `output: ['text', 'audio']` | ✓ text, images, PDF |
| `image` | make or edit an image (give an image part to edit) | `gemini-2.5-flash-image`, or `imagen-*` | `gpt-image-1` (`size`, `n`, `quality`, `format`) | – |
| `speech` | text to speech (`voice`, `format`) | `gemini-2.5-flash-preview-tts` (`voice: 'Kore'`), comes back as .wav | `gpt-4o-mini-tts` (`voice: 'alloy'`, `format: 'mp3'`) | – |
| `transcribe` | speech to text (an audio part; `language`) | ✓ | `gpt-4o-mini-transcribe` / `whisper-1` | – |
| `video` | make a video (`duration`, `aspectRatio`, `size`; an image part to animate); takes minutes, `onEvent` gets `{ ev: 'status' }` | Veo (`veo-3.0-fast-generate-001`) | Sora (`sora-2`) | – |
| `embed` | vectors for text (`input: ['a', 'b']`) → `res.vectors` | `gemini-embedding-001` | `text-embedding-3-small` | – |

The models in the table are used when neither the request nor the service names one for that task; NVIDIA, Groq,
OpenRouter and the other OpenAI-compatible services take the model names of their own catalog (for example NVIDIA
`meta/llama-3.3-70b-instruct`, `deepseek-ai/deepseek-r1`, `nvidia/llama-3.1-nemotron-70b-instruct`). What a model can do
depends on the service: a service that cannot do something answers with an `http` or `unsupported` error.

**Anything else of a service's API** (tools / function calling, a special endpoint): `MyPC.ai.raw({ provider, method,
path: 'models', json, responseType })` calls the service's own API with its key added (only on the service's own site),
and `extra` adds fields to a `generate` body.

**The app's own key** (an app whose maker pays for the AI): give a provider object instead of a name; no permission
question then, and it also works standalone:

```js
MyPC.ai.generate({ provider: { type: 'openai', url: 'https://integrate.api.nvidia.com/v1', key: MyPC.app_config.aiKey, model: 'meta/llama-3.3-70b-instruct' },
                   prompt: 'Hello' });
// type: 'openai' (any OpenAI-compatible address) | 'gemini' | 'anthropic'; optional headers: { ... }
```

Keys in an app's config or code can be read by anyone who opens the app's website: prefer the TV's own services.

**App config** (App Store Manager > Config) can pick the service and model for an app: `{ "ai": { "provider": "nvidia", "model": "meta/llama-3.3-70b-instruct" } }`.

### `MyPC.mic`: the microphone

My PC opens the microphone and sends you the sound. The first use asks the user "*<app> wants to use the microphone*";
a red microphone shows on the screen while it listens. Which microphone a TV gives to apps depends on the model (a USB
or Bluetooth microphone or headset, the TV camera's microphone, the remote's microphone on many models; some keep the
remote's for Bixby); on phones and computers it is the device's own. Needs My PC package 1.5.0 on a TV;
`MyPC.mic.available()` says whether there is a microphone path.

```js
// simplest: record until the person stops talking (or 10 s), then send it to AI
var rec = await MyPC.mic.record({ maxSeconds: 10, silence: { ms: 1200, threshold: 0.02 } });
var said = await MyPC.ai.generate({ task: 'transcribe', prompt: [{ type: 'audio', data: rec.audio, mime: rec.mime }] });

// live: chunks while it listens (speech recognition services, visualisers)
MyPC.mic.on('data', function (e) { send(e.chunk); });         // e.chunk: ArrayBuffer (16-bit PCM, little endian, mono), e.seq
MyPC.mic.on('level', function (e) { meter(e.v); });          // 0..1, 10 times a second
MyPC.mic.on('end', function (e) { });                        // stopped by itself: e.reason 'silence' | 'max' | 'paused' | 'closed', e.result
var info = await MyPC.mic.start({
    format: 'wav',          // 'wav' (default: PCM chunks, a .wav file at the end) | 'pcm16' | 'float32' | 'webm' (Opus, much smaller)
    sampleRate: 16000,      // 8000..48000 (wav / pcm16 / float32)
    chunkMs: 250,           // chunk length; 0 = no live chunks
    keep: true,             // false: no recording at the end (live chunks only)
    maxSeconds: 60,         // up to 600
    silence: null,          // { ms, threshold }: stop by itself after someone spoke and then was silent
    echoCancellation: true, noiseSuppression: true, autoGainControl: true
});                         // -> { sampleRate, format, mime, label }
var res = await MyPC.mic.stop();       // { audio: ArrayBuffer, mime: 'audio/wav', format, sampleRate, seconds }
MyPC.mic.cancel();                     // stop and drop it
```

My PC stops the microphone when its menu opens or the app closes (`end` with reason `paused` / `closed`); start it
again from your own button. Only while the app runs (not under My PC's menu). One recording at a time.

### Protocol (for reference)

App → My PC: `{ mypc: 1, type: 'net' | 'ai' | 'mic', data: { rid, op, req | opts } }` with `op` `request` / `abort`
(net), `generate` / `raw` / `providers` / `cancel` (ai), `start` / `stop` / `cancel` (mic). My PC → app:
`{ rid, result }` or `{ rid, error: { code, message, status } }`; events `{ rid, ev: 'chunk' | 'delta' | 'status', ... }`
and for the microphone `{ ev: 'data' | 'level' | 'end', of: rid, ... }`. ArrayBuffers are transferred, not copied.
The init message carries `bridges: { net: 1, ai: 1, mic: 0 | 1 }` (`MyPC.info().bridges`).
My PC side: `js/core/web-proxy.js`, `js/core/ai.js`, `js/core/mic.js`, `js/launcher/bridges.js`.
