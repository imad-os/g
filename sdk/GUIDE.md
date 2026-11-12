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
- **My PC's pause menu** (Resume, your own menu items, Quit) opens with **the TV remote's Back pressed twice quickly**
  (or once on your first screen, see "Back" below; with the player's setting "Every button goes to the app" off: once) or by
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
| `services` | optional push notification services, up to 3: `[{ "id": "goals", "file": "services/notify.js", "every": 5, "title": "Goal alerts" }]` (section 16) |
| `widgets` | optional desktop widgets, up to 3: `[{ "id": "stars", "title": "Star Catcher", "file": "widgets/stars.js", "size": "medium", "every": 15 }]` (section 18) |

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
    onVolume:  function (v) {},      // optional: v = { music: 0..1, sfx: 0..1 } changed in the Control Panel
    ownMenu:   false                 // optional: true = gamepad Start (short press) sends you 'menu'
});
```

The lifecycle is always:
`onInit` → (you call `ready()`) → `onStart` → (`onPause` ↔ `onResume`)* → `onDestroy`.
After `onPause` the game **MUST NOT** move or make sound until `onResume`.

**While paused your app gets no input at all (API 15).** From `onPause` to `onResume` My PC's menu (or one of its screens:
multiplayer, permission prompts, Google sign-in) is on top and owns every button. My PC sends no actions and no `MyPC.gamepad`
events, makes your frame `inert` (no focus, mouse or touch), and the SDK also: stops keys pressed inside your frame before your own
listeners, makes `navigator.getGamepads()` return no pads, pauses your playing `<audio>` / `<video>` (played again after `onResume`).
An app **without** an `onPause` handler is held still as a safety net: its `requestAnimationFrame` callbacks wait until resume (like a
hidden browser tab) and its AudioContexts are suspended. Do not rely on that: stop your loop and sound in `onPause` yourself.
Include the SDK **before** your own scripts so it sees every key, pad read and AudioContext.

**My PC in the background pauses the game.** When My PC loses the focus (the TV switches to another app or
source, the PC window is minimized or another window is clicked, the phone goes to another app), My PC pauses the
game (`onPause`) and shows its menu (with a short sound, like every time the menu opens); the player picks **Resume** (`onResume`). Nothing to do in your app.
An app that must keep going in the background (a music player, a timer, a live multiplayer host) asks the owner to set
`"allow_background_running": true` in its config (`MyPC.app_config`, App Store Manager > Config, or the default in
`mypc-app.json` `"config"`): My PC then leaves it alone (no menu, no `onPause` / `onResume`). The browser or TV may
still slow down a hidden page by itself. Standalone, outside My PC, the SDK does not do this.

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

Check `MyPC.apiLevel` before using a newer API (3 multiplayer, 4 pad, 7 bluetooth, 8 sensors, 9 gamepad, 10 net / ai / mic, 11 error reports, 12 notify / launch, 13 text, 14 drive, 15 no input while paused, 16 usb / copy, 17 video / back / keys / keyboard, 18 every button to the app: Back as `cancel`, `onInput` returns `false` = nothing to close, 19 `MyPC.buttons`) and hide the feature
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
- My PC itself reads two keys: `"allow_background_running": true` keeps the app running when My PC loses the focus
  (no menu; see the lifecycle above), and `"orientation": "landscape"` (see section 6: on a phone held upright your app
  then keeps a 16:9 window across the screen's width instead of the whole tall screen).
- Standalone (opened directly in a browser) it is `{}` unless you add `?app_config={"speed":2}`
  to the address, which lets you test different configs.

### Touch controls (phones and tablets)

My PC also runs on phones and tablets. **On a touch device My PC draws a customizable virtual pad above every app and game by
itself, so your app needs no touch code.** The pad is a joystick plus buttons; the player customizes it (gear button: add or hide
buttons, including **+** and **Home**, resize, drag anywhere, Stick or **D-pad**, reset). **It is the same pad as the phone controller**
(My PC's Game controller app, Buttons mode): same buttons, sizes, settings and one saved layout on the device (`vpad:controller2`), so a
change made on either shows on both. With the D-pad nothing takes the left half of the screen, so taps there reach your app. It is never drawn on
a TV, and not while a gamepad is the active input. It is hidden while My PC's own screens are open (pause menu, multiplayer, dialogs)
and the pause menu gets **Touch pad settings** and **Hide touch pad** / **Show touch pad** entries on touch devices (the player may
hide the pad for one app, e.g. to play it by tapping; kept per app on the device). Do not rely on the pad being shown.

What the pad sends (the same actions the TV remote and gamepads send, device `'touch'`):

| Pad control | Action your `onInput` gets |
|---|---|
| stick | `left` `right` `up` `down` (a diagonal sends two) |
| button **A** (right, default) | `run` **and** `cancel` (what A does on a real Nintendo controller) |
| button **B** (bottom, default) | `confirm` **and** `jump` (like the remote's OK; what B does on a real Nintendo controller) |
| button **X** (top, in the catalog) | `run` (like the real X) |
| button **Y** (left, in the catalog) | `run` (like the real Y) |
| **L** / **R** (shoulders, shown) | `pageUp` / `pageDown` (like a real pad's L / R; My PC keeps them, games do not get them) |
| **ZL** **ZR** **−** **Capture** **L3** **R3** (the player can add them) | what the same button of a real pad gives (− = `menu`; the others nothing) |
| **+** button (top centre, movable) | My PC's pause menu |
| **Home** button (shown) | My PC's pause menu (like a pad's Guide / Home button) |
| **microphone** button (hidden at first, the player can add it; top centre under **+**) | the Record key (`record`, for My PC's own apps such as Memo; your app gets nothing). Same button as the phone controller's Buttons mode (shown there) |

**Owner rule: the buttons are always called and placed A B X Y like a Nintendo controller (A right, B bottom, X top, Y left).
Never A B C, never a menu symbol (&#9776;) or the word "Menu" as a button. Pause / menu is the Nintendo-style **+** button.** The phone and the touch pad send exactly what the same button of a real Nintendo controller connected to the TV sends (owner decision 2026-11-11: **A confirms / jumps, B goes back / runs, X and Y run**, like on a Nintendo Switch; My PC follows the letter on every controller, so an Xbox pad's A is OK too), so a game plays the same with either. On the phone controller **+** is
Start (`menu`) and **Home** is the Guide button. Defaults: **A B X Y**, **L R**, **+** and **Home** are shown; the gear adds the rest.

**Change the buttons in `mypc-app.json`** (optional; the App Store Manager stores it with the app; an app that sets `buttons` or
`catalog` gets its own pad with those buttons and a layout saved per app, `vpad:app:<app id>`, instead of the shared one):

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
- Keep a way to play with the default pad: **B** (bottom) is `confirm` + `jump`, **A** (right) is `run` + `cancel`, the stick is the four directions.
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
| `MyPC.fail(reason)` | loading failed: My PC shows Retry / Back (and saves `reason` as an error report, section 15) |
| `MyPC.report(error, data)` | an error you caught yourself: My PC saves it with the device, versions and time for the App Store Manager (section 15); `data` = a small JSON value |
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
- Physical controllers only: the TV remote, the keyboard, the touch pad send actions (a phone in Buttons or Keyboard mode is a real gamepad: `MyPC.gamepad` sees it as a standard pad with 18 buttons like a Switch Pro controller, device `pad101` / `pad102`)
  (`onInput`), so the game must also be playable with `left right up down` + `confirm` (see the rules below).

```js
// every change of every button: index, pressed, value (0..1, analog triggers), dev 'pad0'..'pad3', name
MyPC.gamepad.on('button', function (i, pressed, value, dev, name) {
    if (name === 'X' && pressed) castSpell(dev);
});
// sticks moved: axes[0], axes[1] = left stick x / y, axes[2], axes[3] = right stick x / y (-1..1)
MyPC.gamepad.on('axes', function (axes, dev) {});       // `axes` is the SDK's own array: read it now, don't keep it
MyPC.gamepad.on('pads', function (list) {});            // [{ dev: 'pad0', name: 'Pro Controller', standard: true, buttons: 18, axes: 4,
                                                        //    brand: 'Nintendo', model: 'Switch Pro Controller', layout: 'nintendo', vendor: '057e', product: '2009' }]

// or read the state in your fixed-step update (no allocation):
MyPC.gamepad.pressed(2, 'pad0');   // X held on the first pad (without dev: on any pad)
MyPC.gamepad.value(7);             // RT, 0..1 (the highest value of all pads)
MyPC.gamepad.axis(2, 'pad0');      // right stick x; apply your own dead zone (about 0.15)
MyPC.gamepad.name(3);              // 'Y' (the standard position name: 3 = top)
MyPC.gamepad.label(1, 'pad0');     // 'A' on a Switch Pro controller, 'B' on an Xbox pad: the name PRINTED on that pad (API 20)
MyPC.gamepad.pads();               // the connected controllers
```

**Show the names printed on the player's controller** (API level 20). In My PC **button 0 is the button labelled A on every
controller** (OK / jump), 1 is B (back / run), 2 is X, 3 is Y (owner decision 2026-11-11). An Xbox or PlayStation pad gives
A / ✕ as 0 by itself; a Nintendo pad (A on the right) is also delivered in letter order: the TV sends it that way and My PC
swaps it where a browser reads it by place, before your app sees it, so never swap anything yourself. For on-screen hints use
`MyPC.gamepad.label(i, dev)`: My PC knows the controller from its USB vendor / product id (Nintendo Switch Pro and Switch 2
Pro, Joy-Con, Xbox 360 / One / Series / Elite, DualShock 3 / 4, DualSense, 8BitDo, Logitech, Stadia, Luna, SHIELD, the
phone controller...) and each pad in `pads()` says `brand`, `model` and `layout` (`'nintendo'`, `'xbox'`, `'playstation'` or
`'other'`). Players see all of it in Control Panel > Gaming (brand, model, USB id, button order, a button test, and
"Swap A ↔ B and X ↔ Y" for a controller that still comes the wrong way).

Button indices follow the W3C **standard** layout (by position, whatever is printed on the pad):

| Index | Name | Xbox | PlayStation | Switch |
|---|---|---|---|---|
| 0 / 1 / 2 / 3 | `A` `B` `X` `Y` | A B X Y | Cross Circle Square Triangle | A B X Y (by letter, see below) |
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

- My PC keeps some keys for itself: Channel Up / Down and PageUp / PageDown (`pageUp`, `pageDown`), the remote's media
  keys, Guide / F6 (`guide`, which opens the pause menu), Tab. An app that pages through long lists or zaps channels asks
  for them with `MyPC.init({ keys: ['channel', 'media'] })` (API level 17, section 21).
- On the TV remote, **OK** sends `confirm` **and** `jump`. Use `confirm` in menus, `jump` in play.
- `repeat` is `true` for auto-repeat of a held direction: use it for menus, ignore it in play.
- `dev` is the device: `'keys'` (remote or arrows), `'keys2'` (second keyboard player: W A S D, F, G)
  or `'pad0'`..`'pad3'`. Use it for local multiplayer (one hero per device).
- **Every action MUST be reachable with the TV remote alone:** arrows + OK. Don't rely on
  `run`/`cancel` (the remote has no such buttons), and never require a mouse, touch or text typing.
- **Text fields are typing, not actions.** While one of your `<input>` / `<textarea>` / contenteditable has the focus,
  its keys stay in it (Backspace deletes, letters are letters: no `cancel`, no pause), on My PC and standalone; Esc and
  the TV's Back still leave. A phone in the Game controller's **Text mode** types into it (section 17).
- **Back (API level 18).** Every button goes to your app, the TV remote's Back too: it reaches you as `cancel`, like a
  keyboard's Esc / Backspace (use it as your own "back": close a sub-menu, leave a screen). My PC's menu opens when the
  player presses **Back twice quickly**, or when your app has nothing left to close: **return `false` from `onInput` for
  `cancel`** on your first screen (or have no `onInput`), or call `MyPC.back(false)` after `MyPC.back(true)` (section 21).
  Any other return value = you used it. Built-in games and apps on players who turned off Control Panel > Gaming > "Every
  button goes to the app" keep the older rule: Back opens My PC's menu unless you called `MyPC.back(true)`. The first time
  an app gets Back, My PC shows a card "Press Back twice quickly to open My PC's menu". The controller's Home button
  always opens My PC's menu.
- **Shortcuts belong to the player.** Each My PC user maps buttons to actions (Control Panel > Shortcuts): any remote or
  keyboard key and any controller button except the arrows / D-pad, OK / B, Back / A (by default only Play / Pause = My
  PC's music and Guide = switch user). A mapped button runs its shortcut and never reaches you (no action, no
  `MyPC.gamepad` report while it is held), but not during an installed app while "Every button goes to the app" is on
  (the default, API 18): then shortcuts wait and the button is yours. Don't build anything that needs the remote's media, colour,
  number or Guide buttons; the controller's buttons are yours unless the player gave one a shortcut.
- `menu`: gamepad Start or Select pressed alone (sent when let go). Sent only to apps that init with
  `ownMenu: true` (open your own menu on it, and close it on `menu` or `cancel`); on a gamepad other
  apps get nothing (the touch pad's + and the phone controller's + open My PC's pause menu for them).
  **Holding Start + Select together for 1 s** always opens My PC's pause menu, so players can still quit.
  The TV remote has no Start: give your menu another way in too (e.g. an on-screen button with OK).

## 6. Screen

- Fill the whole window: `html, body { margin:0; height:100%; overflow:hidden }`. The window is
  16:9 (1920×1080 on most TVs, but 1280×720 or 3840×2160 happen).
- **Phones held upright (portrait):** a phone user can let My PC turn (Control Panel > Display > Screen rotation: Auto,
  Portrait, Landscape (the default) or Manual, with a Rotate button). Upright, your app gets the **whole tall screen**
  (1080 wide and as tall as the phone, about 1080×2340), and it can be turned while your app runs: read the size on every
  `resize`, never assume 16:9. If your app only works sideways, put `"orientation": "landscape"` in its config: My PC then
  keeps it at 1920×1080, shown across the width with black above and below (like the built-in games), and the touch pad
  sits around it.
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
   ones). An **administrator** profile of a TV or phone installs it there (standard users only see it); it
   then appears on the desktop of every user of that device, in Start and in File Explorer, and each user can
   remove the shortcut from their own home screen. Your app does not need to do anything for this.

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
- [ ] no `keydown` listeners of your own (Esc and the remote's Back reach you as `cancel`); `onInput` returns `false` for `cancel` on your first screen
- [ ] fills the window at any 16:9 size, readable text, obvious focus
- [ ] runs on Chromium 108 (Tizen 8, 2024 TVs): no CSS nesting, nothing newer than Chrome 108; no allocation in the game loop
- [ ] saves through `MyPC.save/load`; scores through `MyPC.submitScore` (games with points)
- [ ] playable on a phone with the touch pad (or with your own touch UI and `"touch": false`): no second pad of your own
- [ ] multiplayer uses `MyPC.multiplayer`: no own lobby, no backend, no Firebase keys (hide the feature when `MyPC.multiplayer.supported` is false; handle `cancelled` quietly)
- [ ] any owner-changeable setting comes from `MyPC.app_config` (with defaults in code), not hard-coded
- [ ] texts in `en` (and `fr`, `es`, `ar` if possible), using `info.lang`
- [ ] works standalone: open `index.html` in Chrome, play with the arrows + Enter, Esc pauses
- [ ] requests to other sites through `MyPC.net`, AI through `MyPC.ai`, the microphone through `MyPC.mic` (section 14): no own proxy, AI SDK or `getUserMedia`; each error code handled (`denied`, `no-provider`...)
- [ ] Google Drive only through `MyPC.drive` (section 19): no Google client, OAuth, token, Drive API call or Picker of your own; `signed-out` / `denied` / `noconfig` handled
- [ ] USB drives and copies Drive <-> USB only through `MyPC.usb` / `MyPC.copy` (section 20); hidden when `MyPC.info().bridges.usb` is not 1
- [ ] the SDK `<script>` is the **first** script of the page (so errors of your own scripts are reported, section 15); errors you catch that matter go to `MyPC.report`
- [ ] video through `MyPC.video` on the TV (section 21), with your own `<video>` when `MyPC.video.supported()` is false; screens of your own close with the remote's Back (`MyPC.back`)
- [ ] text the player types: a real `<input>` / `<textarea>` (or `MyPC.text.open` for a field drawn on a canvas), so a phone in Text mode can type into it (section 17); never required to play
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
button of a real Nintendo controller on the TV sends: A = OK / `jump` (button 0), B = `run` + `cancel` (button 1), X = `run` (2), Y = `run` (3), **+** = Start (`menu`), Home = Guide. **L** and **R** are on the pad from the start (shoulder buttons at the top corners: standard buttons 4 and 5, read them with `MyPC.gamepad`); the pad's gear can also add ZL, ZR, −, Capture and the stick clicks (standard buttons 6 to 11 and 17). The phone buzzes on each press at the player's Vibration setting (0 to 3, on the phone); your app does nothing for it.
**Keyboard** mode: a keyboard plugged into the phone (USB or Bluetooth) is a whole Switch Pro style controller: the
player maps each key to a control (every button, the D-pad and both sticks; ZQSD = D-pad, arrows = left stick, numeric
keypad = right stick, I J K L = X Y B A by default) and your app gets **gamepad buttons and axes, never keys**: the same
standard pad as Buttons mode, with the right stick on axes 2 / 3 and Capture as button 17. `players` reports
`'keyboard'` for such a phone. Buttons mode also has a **microphone** button, and that phone is the TV's microphone for
`MyPC.mic` (section 14); there is no separate Microphone mode any more (older phones may still report `'mic'` in `players`:
treat it like `'pad'`). On the phone, Mode, Advanced settings and Leave are in the pad's gear panel (top left), never over the pad. How strong each move must be (per move, harder while running) and the repeat guard (one move,
not two, for a step and its bounce back) are set by the player on the TV (Control Panel > Devices > Phone controller >
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

The store's owner sets the AI services once for every My PC in the **App Store Manager > AI services** (with their API
keys; each TV, phone and computer copies them at start, and Control Panel > AI on the TV only shows them): Google Gemini, OpenAI (ChatGPT), Anthropic Claude,
NVIDIA, OpenRouter, Groq, Mistral, DeepSeek, xAI, Together, Ollama / LM Studio on a computer at home, or any custom
OpenAI-compatible address with any model. **Your app never sees the keys.** The first AI request of an app asks the user
"*<app> wants to use AI*" (Allow / Don't allow); the answer is kept until Control Panel > Privacy & security > *Forget what
apps were allowed*. If no service is set up you get `no-provider` (and the TV says to add one in the App Store Manager).

```js
var res = await MyPC.ai.generate({
    provider: 'gemini',                 // optional: a service id or kind ('gemini' 'openai' 'anthropic' 'nvidia' 'groq' 'ollama'...);
                                        // default: the app config's ai.provider, else the TV's default service
    model: 'gemini-2.5-flash',          // optional: else the app config's ai.model, else the service's model from the App Store Manager
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
var list = await MyPC.ai.providers();                     // [{ id, name, type, preset, model, mode, isDefault, tasks }] (no keys; mode: Ollama only)
// tasks: { chat, image, speech, transcribe, video, embed } true / false: hide a feature no service has
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

**Ollama** uses its own API, not the OpenAI-compatible one, in one of two **modes** (some models only answer one):
- `chat` (default): `POST <address>/api/chat` with `{ model, messages, stream }`, the answer read from `message.content`;
- `completion`: `POST <address>/api/generate` with `{ model, prompt, system, images, stream }`, the answer read from
  `response`. Your request does not change: `prompt`, `system`, `rules`, `context` work the same; earlier turns
  (`messages`, `examples`) are written into the one prompt as `User: ...` / `Assistant: ...` lines.

The mode is set per service in the **App Store Manager > AI services > Ollama > Mode**, so apps need nothing. An app can
override it for one request with `mode: 'completion'` (or `'chat'`), or for the whole app with the app config
`{ "ai": { "provider": "ollama", "mode": "completion" } }`. `MyPC.ai.providers()` gives an Ollama service's `mode`.
Streaming works in both modes. `task: 'embed'` goes to `/api/embed`. The service's address is the server itself (`http://192.168.1.10:11434` or `https://my-ollama.example`;
an address ending in `/v1` or `/api` works too). It takes text and images (`images` on a message), `temperature`, `topP`,
`stop`, `seed`, `maxTokens` (`num_predict`) and `output: 'json'` / `schema` (`format`). An app's own Ollama:
`provider: { type: 'ollama', url: 'https://my-ollama.example', model: 'llama3.1:8b', mode: 'chat' }` (`mode` optional).

**NVIDIA speech (Magpie-Multilingual)**: with the NVIDIA service, `task: 'speech'` goes to NVIDIA's Magpie-Multilingual
text-to-speech (an NVCF function; its id is set in the App Store Manager > AI services > NVIDIA > Voice (Magpie) function, filled in already).
Languages `en-US`, `es-US`, `fr-FR`, `de-DE` (`'en'`, `'es'`, `'fr'`, `'de'` work too; others, Arabic included, give
`unsupported`). `voice` is the speaker (`'Aria'` by default) or a whole voice name like `'Magpie-Multilingual.EN-US.Aria'`.
The answer is a .wav file. One request at a time is best; play it after a user action (OK button), as browsers require.

```js
var res = await MyPC.ai.generate({ provider: 'nvidia', task: 'speech', model: 'magpie-multilingual',
                                   prompt: 'Hola', voice: 'Aria', language: 'es-US' });
var wav = res.parts[0];          // { type: 'audio', mime: 'audio/wav', data: ArrayBuffer }
var ctx = new AudioContext(); ctx.decodeAudioData(wav.data, function (b) { var s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(); });
```

`task: 'transcribe'` with NVIDIA works only when the owner set a speech-to-text function (Parakeet / Riva) with an HTTP
API in the App Store Manager > AI services > NVIDIA > Speech-to-text function (it gets the audio as a multipart `file` at
`/v1/audio/transcriptions`); many NVCF speech-to-text functions only speak gRPC, which My PC cannot call. Check
`providers()` (`tasks.transcribe`) before showing the feature; `Gemini` and `OpenAI` transcribe without any setup.

**Anything else of a service's API** (tools / function calling, a special endpoint): `MyPC.ai.raw({ provider, method,
path: 'models', json, responseType })` calls the service's own API with its key added (only on the service's own site;
for NVIDIA also its own https hosts `*.invocation.api.nvcf.nvidia.com` and `ai.api.nvidia.com`, with `url`, a multipart
`form: { name: value | { data, name, type } }` and `responseType: 'arraybuffer'`), and `extra` adds fields to a
`generate` body (for Magpie: more form fields).

**The app's own key** (an app whose maker pays for the AI): give a provider object instead of a name; no permission
question then, and it also works standalone:

```js
MyPC.ai.generate({ provider: { type: 'openai', url: 'https://integrate.api.nvidia.com/v1', key: MyPC.app_config.aiKey, model: 'meta/llama-3.3-70b-instruct' },
                   prompt: 'Hello' });
// type: 'openai' (any OpenAI-compatible address) | 'gemini' | 'anthropic'; optional headers: { ... }
```

Keys in an app's config or code can be read by anyone who opens the app's website: prefer the services set in the App Store Manager (never sent to apps).

**App config** (App Store Manager > Config) can pick the service and model for an app: `{ "ai": { "provider": "nvidia", "model": "meta/llama-3.3-70b-instruct" } }` (for Ollama also `"mode": "chat"` or `"completion"`).

### `MyPC.mic`: the microphone

My PC opens the microphone and sends you the sound. The first use asks the user "*<app> wants to use the microphone*";
a red microphone shows on the screen while it listens. Which microphone a TV gives to apps depends on the model (a USB
or Bluetooth microphone or headset, the TV camera's microphone, the remote's microphone on many models; some keep the
remote's for Bixby); on phones and computers it is the device's own. **A phone connected in the Game controller's
Buttons mode is the microphone whenever one is connected** (Samsung TVs keep the remote's mic for Bixby): your app
changes nothing; the sound is then 16-bit PCM at 16 kHz at most (`info.sampleRate` says which; a `webm` request comes
back as `wav`, `info.format` / `res.mime` say so) and `info.label` is the phone's name. The pad's microphone button on
that phone is the Record key of My PC's own apps (Memo), not an event for yours. Needs My PC package 1.5.0 on a TV;
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

## 15. Errors and reports (API level 11)

When something goes wrong on a TV, the App Store Manager (page **Errors**) shows it: which app, what happened, when, on
which device (model, TV code, TV / Android app / browser), the My PC version and build, the app version (`version` of
the store), the SDK level, the profile, the language and the stack. Nothing to set up: **load the SDK first** and it is on.

What is saved, with no code of yours:

| Kind | When |
|---|---|
| `load` | the app never opened: no answer from the SDK (page missing, offline, a script error before `MyPC.init`, `MyPC.init` not called), `MyPC.ready()` not called within 20 s, or the user gave up while it was still loading (after 8 s). The reason says which, with the progress reached |
| `failed` | the app called `MyPC.fail(reason)` |
| `error` | an uncaught error (file, line and column, stack), also before `MyPC.init` |
| `rejection` | a promise rejected with no `catch` |
| `resource` | a script, picture, sound or stylesheet of the page that did not load |
| `handler` | one of your `MyPC.init` handlers (`onInit`, `onStart`, `onInput`...) threw: the SDK catches it so the app keeps going, and reports it |
| `report` | your own `MyPC.report(error, data)` |

Built-in games are covered the same way (their uncaught errors and failed loads), and so is My PC itself (`mypc`).

```js
try { level = JSON.parse(text); }
catch (e) { MyPC.report(e, { level: n }); level = DEFAULT; }   // keep going; the owner sees it with { "level": 3 }
```

Rules, to stay cheap on small TVs (the SDK and My PC enforce them):
- The same error (kind + message + place) is sent **once**; repeats only add to its count (`n`). An error in your game loop
  is one report, not one per frame. Still, **fix errors in the loop**: catching and re-throwing every frame costs time.
- At most 20 different errors per page from the SDK, 8 reports per app per page and 60 per TV per day are saved.
- Reports are batched (one request a few seconds after the first one), queued while offline and expire after 30 days.
- Never put personal data, keys or passwords in a message or in `data` (the stack and message are saved as they are).
- Opened standalone (in a browser, outside My PC) nothing is sent: errors stay in the console.
- Users can turn reports off: Settings > Privacy & security > Send error reports.

Protocol (for reference): app → My PC `{ mypc: 1, type: 'err', data: { kind, msg, stack, src, n, sdk } }`, sent even
before `hello` (to `location.ancestorOrigins[0]`); `hello` carries `sdkApi`. My PC side: `js/core/reports.js` (Firestore
`errors`, rules in `firebase/firestore.rules`), `js/launcher/game-host.js`; dashboard: `installer/index.html#errors`.

## 16. Push notifications: services, `MyPC.notify`, `MyPC.launch` (API level 12)

Your app can send notifications to its players (a goal in a match, a new level, a reply) even when the app is closed. You
write a small **service**: a JavaScript file on your site that the App Store Manager runs on a schedule (every 1, 5, 10 or
30 minutes). It returns rows; each row becomes a notification on every TV, phone and computer where that player is signed
in. A player who is not signed in gets it at the next sign-in (kept 30 days).

How it fits together:
1. You list the service in `mypc-app.json` and put the file on your site.
2. The owner adds or updates the app in the App Store Manager; its **Services** page shows your service. The owner reads
   the code, approves it and picks the interval. **Any change to the file pauses it until the owner approves it again.**
3. Players allow your app (My PC asks once, or your app calls `MyPC.notify.request()`). Only those players can get your
   notifications: rows for anyone else are dropped.
4. Each run, your function gets the usernames who allowed it and returns the rows to send.

Only **player accounts** get notifications (a profile with a username, see Control Panel > Accounts); a local profile
without an account gets none. Players change their choice in Control Panel > Notifications.

### `mypc-app.json`

```json
"services": [
  { "id": "goals", "file": "services/notify.js", "every": 5, "title": "Goal alerts" }
]
```

| Field | Rules |
|---|---|
| `id` | **MUST**, 1–20 characters `a-z 0-9 -`, unique in the app, never `updates` |
| `file` | **MUST**, the service's file, relative to the manifest (or an `https://` address) |
| `every` | minutes between runs: `1`, `5`, `10` or `30` (default `5`); the owner can change it |
| `title` | what the owner sees in the Services page (40 characters) |

At most 3 services per app. **App updates** are built in: when the owner publishes a new `version` of your app, the
players who allowed it get "<app> was updated" (no code needed).

### The service file

An ES module whose **default export** is a function (it can be `async`). It runs in a Web Worker with no page, no DOM and
no `MyPC` object, and is stopped after **20 seconds**.

```js
// services/notify.js
export default async function (ctx) {
  // ctx.subscribers  ['imad12', 'sara.k']: usernames that allowed notifications from this app (lowercase)
  // ctx.state        what your last run returned as state (null the first time); up to 10 000 characters of JSON
  // ctx.config       the app's config (MyPC.app_config, set in the App Store Manager)
  // ctx.now          this run's time (ms); ctx.lastRun: the previous run (ms) or 0
  // ctx.app / ctx.service   your app id and service id
  // ctx.fetch        the normal fetch (the API must allow CORS: Access-Control-Allow-Origin *)
  const since = (ctx.state && ctx.state.last) || 0;
  const r = await ctx.fetch('https://api.example.com/goals?after=' + since);
  const goals = await r.json();
  return {
    notifications: goals.map((g) => ({
      username: '*',                       // '*' = every subscriber, or one username
      title: 'Goal! ' + g.team,            // MUST, 60 characters (longer is cut)
      message: g.minute + "' " + g.score,  // 200 characters (longer is cut)
      image: g.logo,                       // optional https:// picture (shown in the card)
      link: 'soccer:match/' + g.id         // optional deep link '<app id>:<path>' (opens that app on that path), or an https:// page
    })),
    state: { last: goals.length ? goals[0].id : since }   // given back as ctx.state next time
  };
}
```

Rules (the Services page enforces them; dropped rows are counted in its log):
- Return `{ notifications: [...], state }` (or just the list). Return `{ notifications: [] }` when there is nothing new:
  **use `state` to remember what you already sent**, or players get the same notification every run.
- Rows for usernames that did not allow your app are dropped. `username: '*'` sends to every subscriber.
- At most **100 notifications per run** and **20 per player per hour** for your app; the rest is dropped.
- Title and message are plain text (no HTML). `image` must be `https://`; `link` (300 characters) is one of the forms below.
- No `import` of other files (the service is one file). Keep it small and fast: it shares the owner's computer with every
  other app's service. Never put secret keys in it: anyone can read the file on your site.
- A run that throws or times out is logged; after 5 failed runs in a row the service is paused until the owner turns it
  on again.
- Test it yourself: the owner's **Test** button runs it once and shows the rows without sending anything.

### Deep links: `link`

| `link` | What OK / a tap on the notification does |
|---|---|
| `soccer:match/7` | opens the app `soccer` (its store id) and gives it the path `match/7` in `MyPC.launch.path`. Any installed app's id works, not only yours. The path is yours to design (`match/7`, `team/raja?tab=news`...); spaces and quotes are not allowed |
| `app` or `app?match=7` | the notification's own app; the path is `''` or `?match=7` (older form, still works) |
| `https://...` | opens the page in My PC's Browser |
| none | nothing to open (the notification is only shown and listed) |

If the app is not installed on that My PC, the player is told to find it in the App Store. If the app is already open, it
gets the deep link at once through `onLaunch` (see below) instead of being restarted.

### In the app: `MyPC.notify` and `MyPC.launch`

```js
function route(path) {                       // 'match/7' -> the match screen
  var m = /^match\/(\d+)$/.exec(path || '');
  if (m) openMatch(+m[1]);
}
MyPC.init({
  onInit: function () { if (MyPC.launch) route(MyPC.launch.path); },     // opened from a notification
  onLaunch: function (launch) { route(launch.path); }                     // a notification chosen while the app was open
});
// ask at a good moment (for example after the player follows a team); asks only once
MyPC.notify.request().then(function (s) { /* 'granted' | 'denied' | 'no-account' | 'unavailable' */ });
MyPC.notify.status().then(function (s) { /* the same without asking; 'default' = not asked yet */ });
```

- `MyPC.launch` is `{ link, app, path, title, text, at }` when the player opened your app from a notification (`link` is the
  row's `link`, `path` the part after `<app id>:`), else `null`. `onLaunch(launch)` is called when the player picks one of
  your notifications while your app is already open (API 12).
- If your app has a service, My PC asks the player once, a moment after the app starts, when they have not decided yet.
  `request()` asks the same question; after an answer it returns that answer without asking again.
- `'unavailable'`: standalone (outside My PC) or an older My PC (`MyPC.apiLevel < 12`).

### What the player sees

A Windows style card rises in the bottom right corner with your title, the app name and message and your picture (or
your app's icon), and slides down after 6 seconds; also on top of a game, without taking the focus. Control Panel >
Notifications keeps a history of the last 7 days on that TV or phone, by day (new ones marked), and opens a notification's link with OK. A TV checks for new ones every 30 minutes
(at start and when My PC comes back to the front once that time has passed, and at once after a sign-in); accounts the owner
lists in the App Store Manager > Settings > Fast push notifications check every 2 minutes. So a notification can take up to
30 minutes to show: don't use it for things that must arrive within seconds.

Protocol (for reference): app → My PC `{ mypc: 1, type: 'notify', data: { rid, op: 'request' | 'status' } }`, answer
`{ rid, result }`; `init` carries `notify: 1` and `launch`; My PC → app `{ type: 'launch', data: launch }` while it runs. Firestore: `subs/<app>/users/<username>` (the player's
choice), `inbox/<username>/items/<id>` (one notification), `services/<app>__<service>` (owner only). My PC side:
`js/launcher/push.js`, `js/launcher/game-host.js`; runner: `installer/services.js`, `installer/services-lib.js`. A complete small
service: `sdk/example/services/notify.js`.

## 17. Text from a phone: `MyPC.text` (API level 13)

The phone controller has a **Text mode** (Game controller > Mode > Text): the player types with the **phone's own
keyboard** and the text goes into the text field the TV is using right now: My PC's on-screen keyboard (the Browser's
address bar, the App Store search, names, passwords...), a focused field of My PC, or **the focused field of the running
app**. The phone shows which field is open ("Typing into: ...", from the field's `aria-label`, `placeholder`, `title` or
`<label>`) and picks a fitting keyboard (`type="url"`, `email`, `number` / `inputmode="numeric"`, `password`: no
suggestions, `search`, `<textarea>`: Enter makes a new line). **Live** on (default): every change reaches the TV at once;
Live off: only when the player presses **Send** (or Enter). Small arrows and **A** (right, back) / **B** (bottom, OK) on
the phone move to a field. Backspace and Enter on the phone are editing there: they never reach the TV as Back, so no
pause menu while deleting a letter.

**Normal fields need nothing.** The SDK (loaded from the hosted URL, so every app already has it) tells My PC when one
of your `<input>` / `<textarea>` / contenteditable elements gets or loses the focus, and writes the phone's text into it:
the whole text each time with an `input` event (`maxlength` kept); **Send** / Enter then dispatches an Enter
`keydown` / `keyup` on it (`keyCode` 13) and `change`, and sends its `<form>` (`requestSubmit`) unless your keydown
handler called `preventDefault()`. So: give a field the focus when it should be typed in (`input.focus()`), listen to
`input` (or read `.value`), and handle Enter as "done".

**A field drawn on a canvas** (a name entry in a game) asks for the text itself:

```js
if (MyPC.apiLevel >= 13) {
    MyPC.text.open({
        value: hero.name, kind: 'name', label: 'Hero name', max: 12,   // kind: text multi password url email number search name
        onInput: function (v) { hero.name = v; draw(); },              // the whole text, each time it changes (Live)
        onSend: function (v) { MyPC.text.close(); startGame(); }       // Send / Enter on the phone
    });
}
// MyPC.text.close() when the entry screen closes; MyPC.text.active() -> true while open
```

While `MyPC.text.open` is active it wins over any focused element. Typing is never required: a name entry must still
work with the arrows + OK (and the remote alone). On a My PC older than API level 13 nothing happens (the phone says no
text field is open).

Protocol (for reference): app → My PC `{ type: 'field', data: { on: 1, id, kind, label, v, max } }` (v is `''` for a
password) or `{ on: 0 }`; My PC → app `{ type: 'text', data: { v: whole text, go: 1 | 0 } }`, only while the app runs (not
under My PC's menu). Phone ↔ TV: `{ t: 'tf', ... }` / `{ t: 'tx', v, go }` (`docs/phone-controller.md`). My PC side:
`js/launcher/textin.js`, `js/launcher/controllers.js`, `js/launcher/game-host.js`.

## 18. Desktop widgets: `"widgets"` in `mypc-app.json`

My PC's desktop shows **widgets**: small cards on the right (Weather, Playtime, System Monitor, Music Player are built
in). Your app can add its own: today's score, the next match, a daily goal. Each player turns widgets on or off, picks
how often they refresh, whether they run in the background, and their settings in **Control Panel > Widgets** (every
profile has its own).

How it fits together:
1. You list the widget in `mypc-app.json` (what it is, its size, its refresh rate, its settings with their defaults) and
   put its `.js` file on your site.
2. The owner adds or updates the app in the App Store Manager; its **Widgets** page shows your widget. The owner reads the
   code, tests it (it draws the card) and **approves** it: the approved code is copied into the store, so **TVs run that
   copy, never your live file**. A later change of the file reaches TVs only when the owner approves it again.
3. A player who installed your app finds the widget in Control Panel > Widgets and turns it on there (widgets are **off by
   default**; only the built-in Weather is on), then changes its refresh rate and settings.
4. At each refresh My PC runs your function once and draws what it returns. **OK on the card opens your app**; buttons
   on the card run your function again with `ctx.action`.

### `mypc-app.json`

```json
"widgets": [
  { "id": "stars", "title": "Star Catcher", "file": "widgets/stars.js", "size": "medium", "every": 15, "background": false,
    "description": "Your stars of the day",
    "settings": [
      { "id": "goal", "label": "Daily goal", "type": "select", "default": "50",
        "options": [{ "value": "20", "label": "20 stars" }, { "value": "50", "label": "50 stars" }] },
      { "id": "tips", "label": { "en": "Show tips", "fr": "Afficher les astuces" }, "type": "toggle", "default": true },
      { "id": "team", "label": "Team", "type": "text", "default": "" }
    ] }
]
```

| Field | Rules |
|---|---|
| `id` | **MUST**, 1–20 characters `a-z 0-9 -`, unique in the app, never change it (the players' settings are keyed by it) |
| `file` | **MUST**, the widget's file, relative to the manifest (or an `https://` address); 60 000 characters at most |
| `title` | the card's title and its name in Control Panel > Widgets (40 characters); text or `{ "en", "fr", "es", "ar" }` |
| `size` | `small` (180 px tall), `medium` (230 px, default) or `large` (330 px); the card is 400 px wide |
| `every` | default minutes between refreshes: `1`, `5`, `15` (default), `30` or `60`; the player can pick another |
| `background` | default of "Run in the background" (`false`): `true` keeps refreshing while an app or a game is open. Leave it `false` unless the card must be current the moment the player comes back |
| `description` | one line in Control Panel > Widgets (120 characters) |
| `settings` | up to 8: `toggle` (`default` true / false), `select` (`options` `[{ value, label }]`, up to 12, `default` one of the values) or `text` (typed with the on-screen keyboard or a phone, 60 characters). `label` is text or `{ "en", "fr", "es", "ar" }` |

At most 3 widgets per app.

### The widget file

An ES module whose **default export** is a function (it can be `async`). It runs in a **Web Worker started from a
`data:` address** (its own empty origin): no page, no DOM, no `MyPC` object, no access to My PC's storage or sign-ins.
It is started for one refresh and **stopped after 10 seconds**; one widget runs at a time on a TV.

```js
// widgets/stars.js
export default async function (ctx) {
  // ctx.settings  this profile's settings: { goal: '50', tips: true, team: '' } (the defaults until the player changes them)
  // ctx.state     what the last run returned as state (null the first time); 4000 characters of JSON at most, per profile
  // ctx.action    the id of the card button the player pressed, else null (a normal refresh)
  // ctx.size      'small' | 'medium' | 'large'; ctx.lang: 'en' | 'fr' | 'es' | 'ar'
  // ctx.now       this run's time (ms); ctx.lastRun: the previous refresh (ms) or 0
  // ctx.config    the app's config (MyPC.app_config, set in the App Store Manager); ctx.app / ctx.widget: the ids
  // ctx.fetch     the normal fetch (the API must allow CORS: Access-Control-Allow-Origin *)
  const st = ctx.state || { caught: 0 };
  if (ctx.action === 'add') st.caught += 1;
  return {
    view: {
      icon: '⭐',                        // 1-4 characters (an emoji) or an https:// picture
      big: st.caught + ' / ' + ctx.settings.goal,
      sub: 'stars caught today',
      text: 'Catch two in a row for a bonus.',
      progress: st.caught / +ctx.settings.goal,
      buttons: [{ id: 'add', label: '+1' }],
      accent: '#ffc83d',
      link: 'level/3'                       // OK on the card opens your app with MyPC.launch.path = 'level/3'
    },
    state: st
  };
}
```

The **view** (anything else is dropped; text is plain text, never HTML):

| Field | What My PC draws |
|---|---|
| `title` | replaces the card's title (40 characters) |
| `icon` | top left: an emoji or 1–4 characters, or an `https://` picture |
| `big` / `sub` | a big value (24 characters) and a line under it (60); without `big`, `sub` goes under `text` |
| `text` | up to two lines (160 characters) |
| `image` | an `https://` picture on the right (medium and large cards) |
| `progress` | a bar, `0` to `1` |
| `rows` | up to 5 `{ label, value }` lines (24 / 40 characters); a small card has room for about 2 |
| `buttons` | up to 3 `{ id, label }` at the bottom; pressing one refreshes the widget with `ctx.action = id` |
| `accent` | `#rrggbb`, the colour of the card's top edge and of the bar |
| `link` | the path your app gets in `MyPC.launch.path` (with `MyPC.launch.from = 'widget'`) when the player opens the card with OK (section 16) |

Return `{ view, state }`, or just the view. My PC keeps the last view and shows it at once when the desktop opens (and
offline). A run that throws or times out leaves the last view with "Could not refresh" and is sent to the error reports
(App Store Manager > Errors, `app-<id>`).

Rules:
- **Cheap:** nothing of yours runs between two refreshes, and widgets stop while an app or a game is open (unless the player
  turned on Run in the background). Do one small request per refresh; never loop or wait for long.
- No `import` of other files (the widget is one file). Never put secret keys in it: anyone can read the file on your site.
- The card must make sense with the remote alone: OK opens your app, the arrows reach the buttons. Button labels are plain
  words or `+1` style text; for controller hints use A B X Y and **+** (never A B C or "Menu").
- Test it yourself: open the file's address in a browser to check it loads, and ask the owner to press **Test** in the
  Widgets page (it runs it in the same sandbox and draws the card).

Protocol (for reference): My PC → Worker `{ src, app, widget, settings, state, size, lang, action, now, lastRun, config }`,
Worker → My PC `{ ok: true, out }` or `{ ok: false, error }`. Firestore: `apps/<id>.widgets[i].sha` (the approved SHA-256),
`widgets/<app>__<widget>` `{ code, sha }` (read by TVs, written by the owner). My PC side: `js/launcher/widgets.js`,
`js/core/widget-lib.js`; Manager: `installer/widgets.js`. A complete small widget: `sdk/example/widgets/stars.js`.

## 19. Google Drive: `MyPC.drive` (API level 14)

The user signs in to Google Drive **once, in My PC** (Control Panel > Google Drive, one Google account per My PC profile,
on every TV and phone that profile uses). Music and every app then use that sign-in. **MUST**: an app or game that reads
or writes Google Drive does it only through `MyPC.drive`. Never ship a Google client ID or secret, an OAuth / device-code
flow, a token, a Google Picker, `MyPC.net` calls to `googleapis.com`, or Drive code of your own: My PC sends every Drive
request for the app, so the app never has a token. Check `MyPC.apiLevel >= 14` (and `MyPC.info().bridges.drive`) and hide
Drive features when it is missing.

What My PC may see: normally **the whole Drive** (Google scope `drive`): every file and folder of the signed-in account, its
"My Drive" (`folder: 'root'`) and the files shared with it (`q: 'sharedWithMe = true'`). The user signs in with a QR code and
Google's page on the phone. `status().full` says so. On a My PC still set up the old way (`full: false`), Google only allows
`drive.file`: the files My PC and its apps made, plus the ones the user chose with **Add files from your phone**
(`MyPC.drive.addFiles()`; `status().picker` is then true). Write the app so it works both ways: browse with `list()`, and offer
`addFiles()` only when `status().picker` is true.
The first time an app uses Drive, My PC asks the user once: "*&lt;app&gt;* wants to use your Google Drive" (per profile;
Control Panel > Google Drive lists the apps allowed and can take it back). `signIn()` started from the app counts as yes.

```js
if (MyPC.apiLevel >= 14) {
  const st = await MyPC.drive.status();       // { configured, signedIn, needsSignIn, allowed, account, full, picker }
  if (!st.configured) showText('Google Drive is not set up for My PC yet.');
  else if (!st.signedIn) button('Sign in to Google Drive', () => MyPC.drive.signIn().then(load, onError));
  else load();
}
async function load() {
  const { files, next } = await MyPC.drive.list({ place: 'audio', pageSize: 100 });   // Drive v3 file objects
  ...
}
```

Every call returns a Promise (with `.abort()`); files are Google Drive API v3 file objects (`id`, `name`, `mimeType`,
`size` (a string), `modifiedTime`, `parents`, `starred`, `trashed`, `thumbnailLink`, `iconLink`, `capabilities`,
`imageMediaMetadata`, `videoMediaMetadata`, `appProperties`...). A folder's `mimeType` is `MyPC.drive.FOLDER`.

| Call | Result |
|---|---|
| `status()` | `{ configured, signedIn, needsSignIn, allowed, account: { email, name, picture } \| null, full, picker }`. Never asks anything. `account` only once the app is allowed. `full`: the whole Drive is visible; `picker`: `addFiles()` is needed to see more (never with `full`). |
| `signIn()` | My PC's sign-in screen over the app (a QR code + Google's code, the app is paused meanwhile) -> `account`. Already signed in: only the permission question, if not answered yet. |
| `addFiles()` | My PC's "Add files from your phone" screen (a QR code for the Google Picker on the phone). Resolves when closed; then list again. `status().picker` false: not set up. |
| `list({ folder, place, search, q, orderBy, pageSize, pageToken })` | `{ files, next }`. `folder`: a folder id (`'root'` = My Drive). `place`: `all` `starred` `recent` `images` `videos` `audio` `documents` `folders` `trash`. `search`: name contains. `q`: a Drive query, added with *and*. Nothing given = My Drive's top. `pageSize` 1-1000 (100). `next` -> `pageToken`. |
| `listAll(opts, max)` | every page, up to `max` files (1000) |
| `get(id)` | the file |
| `createFolder(name, parentId)` | the new folder (`parentId` default `'root'`) |
| `rename(id, name)` `move(id, folderId)` `copy(id, folderId, name)` | the changed / new file |
| `star(id, on)` `trash(id)` `restore(id)` | the file |
| `remove(id)` | `true`: deleted **for ever** (ask the user first; prefer `trash`) |
| `setInfo(id, { description, appProperties })` | the file (`appProperties`: your own small key / value pairs, searchable with `q: "appProperties has { key='k' and value='v' }"`) |
| `read(id, start, end)` | `{ buf: ArrayBuffer, total, type }`: bytes `start`..`end` (included); `total` = the file's size. Past the end: an empty `buf`. |
| `download(id, { onProgress, max })` | `{ buf, type, size }`, the whole file (read in 4 MB pieces; `max` bytes, 200 MB at most) |
| `readText(id)` / `readJson(id)` | the file as text / parsed JSON |
| `upload({ name, data, type, parent, id, description, appProperties }, { onProgress })` | the new file. `data`: a `Blob` / `File` (from an `<input type=file>`), an `ArrayBuffer`, a typed array or a string. `id`: replace that file's content (and name if given). Sent in 4 MB pieces (resumable), `onProgress(0..1)`. |
| `exportFile(id, mime)` | a Google Doc / Sheet / Slides as `mime` (`application/pdf`...) -> `{ buf, type }` |
| `thumbnail(link, size)` | `{ buf, type }` of a `thumbnailLink` at `size` px. (An `<img src="thumbnailLink">` usually works without it.) |
| `about()` | `{ user, storageQuota }` |
| `appFolder()` | your app's own folder, "My PC/*your app's name*" (made the first time, found again by `appProperties`) |
| `saveJson(name, value)` / `loadJson(name, def)` | a small JSON file in `appFolder()`: cloud saves, settings, exports. `loadJson` gives `def` when it is missing. |
| `stream(fileOrId, { worker, onProgress, max })` | `{ url, mode, close() }` to give an `<audio>` / `<video>` (below). Call `close()` when the player is done. |

**Playing media.** `<audio>` and `<video>` cannot send Google's sign-in header, and your app has no token anyway. Add a
file `sw.js` next to your `index.html` containing only

```js
importScripts('https://imad-os.github.io/g/sdk/drive-sw.js');
```

(your own worker code may follow) and call `MyPC.drive.stream(file, { worker: 'sw.js' })`: `mode` is `'worker'` and
`url` is an address of your own site that the worker answers piece by piece (2 MB Range pieces read through My PC), so
playback starts at once and seeking works. Pass the file object (not only its id) so its size and type are known. Without
the worker (or where service workers are not available) `mode` is `'blob'`: the whole file is downloaded first
(`onProgress`), then played from a `blob:` address. Images: `download()` then `URL.createObjectURL(new Blob([buf]))`.

**Errors** (`err.code`): `noconfig` (no Google client set up for My PC: tell the user an App Store manager must add it),
`signed-out` / `reauth` (call `signIn()`), `denied` (the user said no: stop asking during this run), `not-found`,
`permission` (Drive refused this file), `quota` (Google busy, try later), `too-big`, `bad-request` (a bad name or
argument), `network`, `timeout`, `cancelled` (aborted, or the user closed the sign-in), `busy` (more than 8 calls at once),
`not-running` (`signIn` / `addFiles` while paused), `unsupported` (an older My PC).

**Standalone** (the page opened in a browser): the same calls work. The SDK loads My PC's `js/core/gdrive.js` next to it,
uses the Google client of every My PC (or `app_config.google.tvClientId` / `tvClientSecret` if your test config has them),
shows a plain sign-in box, and keeps the account in this browser's `localStorage` (`mypc_drive`); use a test account.

**Controls in your Drive screens**: A B X Y and **+** as everywhere (B = OK / open, A = back, X / Y = your own actions such as
Rename or Delete, + = your menu); everything also reachable with the remote's arrows + OK.

Protocol (for reference): app -> My PC `drive { rid, op, args }` (`op`: status signIn addFiles list get mkdir rename move
copy star trash untrash remove setInfo read download upload export thumb about appFolder abort); My PC -> app
`drive { rid, result | error }` and `{ rid, ev: 'progress', p }`. My PC side: `js/core/gdrive.js` (Google client from
Firestore `settings/google`, App Store Manager > Google Drive; accounts per profile, key `gdrive`), `js/launcher/bridges.js`,
`js/launcher/drive-ui.js`; the phone's sign-in page `drive-signin.html` and picker page `drive-picker.html`.

## 20. USB drives and copies with Google Drive: `MyPC.usb`, `MyPC.copy` (API level 16, TV only)

The USB drives and hard disks plugged into the TV, and **copies between Google Drive and those drives, done by My PC
itself**: Drive -> USB and USB -> Drive, single files and whole folders (with every sub-folder). An app never reads the
TV's file system or copies bytes itself: it says what to copy and where, and My PC does the rest. **MUST**: apps reach USB
drives only through `MyPC.usb`, and copy between Drive and USB only through `MyPC.copy`. Check `MyPC.apiLevel >= 16` and
`MyPC.info().bridges.usb === 1` (only a TV has USB drives: on a phone or a computer it is `0`) and hide these features
otherwise. A copy also needs Google Drive (section 19): signed in, and the app allowed.

The first time an app uses USB drives My PC asks once: "*&lt;app&gt;* wants to use your USB drives" (per app, on this TV;
Control Panel > Privacy & security forgets it). Paths are the TV's real paths, like `/opt/media/USBDriveA1/Photos`; a path
outside the plugged drives (or with `..`) is refused with `bad-request`.

```js
if (MyPC.apiLevel >= 16 && MyPC.info().bridges.usb) {
  const drives = await MyPC.usb.drives();             // [{ path, name: 'USB A1', free, total }]
  const items = await MyPC.usb.list(drives[0].path);  // [{ name, path, dir, size }], folders first
  // Drive -> USB: files and folders (Drive file objects or ids) into a folder of the drive
  const job = await MyPC.copy.toUsb([file, folder], drives[0].path + '/Backup', { ifExists: 'skip' });
  // USB -> Drive: files and folders (paths or list() items) into a Drive folder ('root' = My Drive)
  await MyPC.copy.toDrive([items[0]], driveFolder.id, { ifExists: 'keep' });
  const off = MyPC.copy.onChange((j) => showProgress(j));   // about twice a second while one runs
}
```

| Call | Result |
|---|---|
| `usb.drives()` | `[{ path, name, free, total }]` the plugged drives (`free` / `total` in bytes, `0` when the TV does not say). Empty: none plugged. |
| `usb.list(path)` | `[{ name, path, dir, size }]`: folders first, natural order, hidden and system entries left out. |
| `usb.stat(path)` | `{ exists, dir, size }` |
| `usb.createFolder(parentPath, name)` | `{ name, path }` (the name is made safe for FAT / exFAT / NTFS; already there is fine) |
| `usb.read(path, start, end)` | `{ buf: ArrayBuffer }` bytes `start`..`end` (included), 16 MB at most per call: pictures, subtitles, a preview |
| `copy.toUsb(driveFilesOrIds, usbFolderPath, { ifExists })` | a `job` (it starts at once, in the background) |
| `copy.toDrive(usbPathsOrItems, driveFolderId, { ifExists })` | a `job` |
| `copy.jobs()` | this app's copies (running, waiting and the last ended ones) |
| `copy.pause(id)` `copy.resume(id)` `copy.cancel(id)` | the `job`. Cancel removes the half-written USB file. `resume` also restarts a `failed` copy. |
| `copy.clear(id)` | forgets an ended copy (`done`, `failed`, `cancelled`) |
| `copy.onChange(fn)` | `fn(job)` at every change of this app's copies; returns `off()`. While an app listens, My PC shows no card of its own over it. |

`job` = `{ id, dir: 'toUsb' | 'toDrive', state, dest: { path | id, name }, items, files, bytes, doneFiles, doneBytes,
skipped, failed: [{ name, message }], current: { name, size, done } | null, error: { code, message } | null, progress (0..1),
ifExists, startedAt, endedAt }`. `state`: `queued` -> `scanning` (listing every file in the folders) -> `copying` ->
`done`; or `waiting` (no internet: it goes on by itself), `paused`, `failed` (`error` says why), `cancelled`.

What My PC does for you:
- **One file at a time, 4 MB at a time**, so a 10 GB film needs no more TV memory than a photo. One copy runs at a time; the
  others wait (`queued`).
- **It goes on by itself** after the app is closed (opening or quitting an app reloads My PC's page), after a restart of
  My PC and after a network cut: a half-written USB file goes on from its size, an upload asks Google how much it already
  has. Meanwhile (and whenever no app listens) My PC shows a progress card bottom right; it says when the copy is done.
- **Files already there with the same size count as copied** (nothing is read again). Another file with the same name:
  `ifExists` `'skip'` (default: left alone, counted in `skipped`), `'replace'` (overwritten) or `'keep'` (keep both: the
  copy is `name (2).ext`). Folders with the same name are merged.
- **Google Docs, Sheets, Slides, Drawings** are saved on the USB drive as `.docx`, `.xlsx`, `.pptx`, `.pdf` (Google
  exports about 10 MB at most); Forms, Sites, Maps and shortcuts cannot be downloaded (listed in `failed`).
- Names Windows / FAT cannot hold (`: * ? " < > |`) get `_`. **FAT32 drives cannot hold a file bigger than 4 GB**: that
  file fails with `too-big` (exFAT and NTFS can; some TVs cannot write to NTFS at all). Free space is checked before
  copying when the TV / Google says it (`full` / `drive-full`).
- Errors (`err.code` of a call, or `job.error.code`): `unsupported` (not a TV, or an older My PC), `denied` (the user said
  no), `signed-out` / `reauth` / `noconfig` (Google Drive, section 19), `bad-request` (a path outside the drives, a bad
  id), `not-found`, `gone` (the USB drive was removed: plug it in and `resume`), `perm` (the TV's My PC package is older
  than 1.6.0), `full` (the USB drive, or Google Drive for `toDrive`), `drive-full`, `too-many` (more than 20,000 files and
  folders in one copy), `busy` (20 copies waiting already), `not-running`.

**Controls in your copy screens**: A B X Y and **+** as everywhere; everything also with the remote's arrows + OK (pick
files with OK, a "Copy to USB" / "Copy to Google Drive" action, a folder picker for the destination, a list of copies with
Pause / Resume / Cancel).

Protocol (for reference): app -> My PC `usb { rid, op, args }` (`op`: drives list stat mkdir read) and `copy { rid, op, args }`
(`op`: start jobs pause resume cancel clear watch); My PC -> app `{ rid, result | error }` and, after `watch`,
`copy { rid: 0, ev: 'job', job }`. My PC side: `js/core/usb-fs.js`, `js/core/copy-jobs.js`, `js/launcher/bridges.js`.

## 21. Video on the TV, Back, channel keys, the on-screen keyboard (API level 17)

For video apps (IPTV, films, a USB film library): the **TV's own player** (Samsung AVPlay, the chip that decodes 4K HEVC,
AC3 / EAC3, MKV, TS...), the remote's **Back** for the app's own screens, **CH + / CH −** and the **media keys**, and
**My PC's on-screen keyboard** so the remote alone can type. Check `MyPC.apiLevel >= 17` and `MyPC.info().bridges`
(`video`, `back`, `keyboard`).

### `MyPC.video`: the TV's player

An app is a sandboxed page: it cannot reach `webapis.avplay`, and an `http://` stream is blocked in an https page. My PC
plays the video for the app. **The picture is drawn behind the web page**, on the TV's video plane: keep your page
**transparent** wherever it must show (`html, body { background: transparent }` while playing; a "hole" for a small
preview, everything else of the page drawn as usual). Your controls and subtitles are your own HTML over it.

```js
if (MyPC.video.supported()) {                                  // a TV (else: your own <video>, hls.js for .m3u8)
  const info = await MyPC.video.open('http://server/movie/u/p/1.mkv', { start: 754, rect: null, fit: 'fit' });
  // info = { duration (s, 0 when live), live, tracks }  (a USB file: no tracks, see below)
  MyPC.video.on('time', (e) => bar(e.t, e.d));                 // twice a second
  MyPC.video.on('state', (e) => show(e.state));                // buffering playing paused ended idle
                                                               // (a "buffering" the TV never ends is followed by "playing" once the time moves;
                                                               //  hide your loader on "playing", and your controls a few seconds after it)
  MyPC.video.on('error', (e) => retry(e.code));                // network format not-found drm player restore
  MyPC.video.on('sub', (e) => showSub(e.text));                // subtitles inside the file: off (silent) after every open until
                                                               //  you call MyPC.video.subtitles(true) (build 152)
  await MyPC.video.rect(previewBox);                           // an element (or { x, y, w, h } in your CSS pixels); null = whole screen
}
```

| Call | Result |
|---|---|
| `open(url, { start, live, rect, fit, ua })` | `{ duration, live, tracks }`. `start` in seconds; `live` for a channel (no seek); `ua` a User-Agent some IPTV servers want. Opening another video closes the first (one player on the TV; My PC's music stops). |
| `play()` `pause()` `stop()` | |
| `seek(seconds)` | refused for a live stream (`live`) |
| `rect(el \| {x,y,w,h} \| null)` | where the picture is (null = whole screen) |
| `fit('fit' \| 'fill' \| 'auto')` | letterbox / fill the box / the file's own |
| `tracks()` | `{ audio: [{ index, lang, codec, channels }], text: [{ index, lang }], video: { w, h }, cur: { audio, text } }` |
| `track('audio' \| 'text', index)` `subtitles(on)` `speed(rate)` | |
| `state()` | `{ state, t, d }` |
| `on(name, fn)` | `state`, `time`, `buffer` (`{ p }` 0..100), `sub` (`{ text, dur }`), `error` (`{ code }`), `info` (`{ w, h }`); returns `off()` |

- **USB files**: a path from `MyPC.usb` (`/opt/media/USBDriveA1/Films/a.mkv`) plays once the app may use the USB drives
  (section 20); subtitle files next to it are read with `MyPC.usb.read` and drawn by the app.
  **The tracks of a USB file are never read** (build 154): the TV's player hangs on some MKV files when asked and the TV
  closes My PC. `tracks()` answers empty lists with `file: true`, `track()` answers `unsupported`; the file plays its default
  audio. Offer the subtitle files next to it (and online subtitles) instead.
- **Under My PC's menu** (Back on the first screen, Guide) the video pauses and plays again on Resume; leaving My PC
  (another TV app) stops it and opens it again where it was. Quitting the app closes it.
- Errors: `unsupported` (not a TV: use a `<video>`), `bad-request` (no url, not an http(s) / rtsp / rtmp / udp address
  or a USB path), `denied` (USB not allowed), `live` (seek / speed on a live stream), `not-open`, `network`, `format`,
  `not-found`, `drm`, `player`, `timeout` (no answer in 30 s). `speed` takes whole rates (1, 2, 4... and -2, -4...).

### `MyPC.back(on)`: the remote's Back for your screens

`MyPC.back(true)` while your app has a screen, menu or dialog of its own to close: the TV remote's Back then reaches you
as `cancel`. Call `MyPC.back(false)` when you are back on your first screen: Back opens My PC's menu again (Quit). Since API
level 18 Back reaches every installed app anyway (see "Back" in the input rules): `MyPC.back` still tells My PC at once that
you have nothing to close, and it is what counts for players who turned "Every button goes to the app" off. The simplest
way for every app: `onInput` returns `false` for `cancel` when nothing was closed. Standalone, Esc behaves the same way.

### `MyPC.init({ keys })`: CH + / CH − and the media keys

`keys: ['channel']`: CH + / CH − (and PageUp / PageDown, a pad's L / R are yours already through `MyPC.gamepad`) reach
your `onInput` as `pageUp` / `pageDown` (page a long list, zap channels). `keys: ['media']`: the remote's media keys reach
you as `playPause`, `mediaFf`, `mediaRew`, `mediaNext`, `mediaPrev`, `mediaStop` (the player's own shortcuts on those
buttons wait meanwhile). Ask only for what you use.

### `MyPC.buttons` (API 19): every remote button by name, for apps that let the player map them

`MyPC.init({ keys: ['buttons'] })`, then `MyPC.buttons.on((name, pressed, repeat) => ...)` (returns `off()`). My PC registers the
remote's other keys too (colour keys, digits, Info, Channel list, Tools...), and while your app runs those buttons reach **only** this
listener, not `onInput` (`MyPC.buttons.on((name, pressed, repeat, label) => ...)`): `ok up down left right red green yellow blue 0`..`9 chUp chDown info chList tools prevCh caption mts teletext
pictureSize extra minus play pause playPause ff rew next prev stop record guide` (`guide` = the remote's Guide key, the button between
CH + and CH − on many Samsung remotes), and `k<code>` for any other key the TV's remote has (the listener's 4th argument `label` is the
TV's own name for it, e.g. `k10225` / `"Search"`) (a keyboard adds `space pageUp pageDown`). So your app maps
every one of them itself, OK and the arrows included (keep OK = OK and the arrows = moving: a remote has nothing else for them).
Back stays `cancel` in `onInput` (with My PC's double Back), a keyboard's F6 and Tab stay My PC's; controllers still come through `onInput` /
`MyPC.gamepad`. Under My PC's own screens (menu, keyboard, a question) nothing is sent; a press always gets its release. The player can
turn it off with Control Panel > Gaming > "Every button goes to the app": then the remote's keys come as plain actions again, so
keep `onInput` working. Standalone nothing is sent (read your own keys). Samsung's Smart Remote shows the colour keys and digits
on screen with its 123 / colour button.

### `MyPC.text.keyboard(opts)`: My PC's on-screen keyboard

```js
const q = await MyPC.text.keyboard({ value: '', kind: 'search', label: 'Search films', ok: 'Search' });
if (q !== null) search(q);          // null: the player went Back
```

`kind`: `text search url password email number user name`; `label`, `placeholder`, `ok` (the OK key's label), `max`.
Your app waits under it (no input). A phone in Text mode types into it too (section 17). Standalone: the browser's
`prompt()`. Use it for every text the remote must be able to type (an address, a user name, a search).

Protocol (for reference): app -> My PC `video { rid, op, args }` (`op`: open play pause stop seek rect fit tracks track
subs speed state), `kb { rid, value, kind, label, placeholder, ok, max }`, `back { on }`, `hello { keys }`; My PC -> app
`{ rid, result | error }` and `video { rid: 0, ev, ... }`. My PC side: `js/launcher/app-video.js`, `js/launcher/game-host.js`.
