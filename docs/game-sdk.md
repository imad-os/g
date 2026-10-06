# Building a game for the Arcade hub

A game is a normal web app (its own folder or GitHub repo, served over https, e.g. GitHub Pages). It includes
one small ES5 file, `sdk/arcade-sdk.js`, and the hub does the rest: input from the remote, gamepads and
keyboard, the pause menu, Back handling, saves, top-10 scores, profiles and the loading screen.
A complete minimal game is in `sdk/example/` (it also runs standalone in a browser).

## The contract

```js
Arcade.define({
  init: function (host) { /* load, host.progress(0..1), then host.loaded() or host.failed(reason) */ },
  start: function () {},            // after loaded(): begin (start your requestAnimationFrame loop)
  pause: function () {},            // stop the loop, suspend audio
  resume: function () {},
  destroy: function () {},          // stop rAF and timers, close AudioContext and GL contexts
  resize: function (vp) {},         // optional: { cssWidth, cssHeight, dpr, safeArea }
  menuItems: function () { return [{ id: 'sound', label: 'Sound: on' }]; },   // optional extra pause-menu entries
  onMenu: function (id) { return 'stay'; },                                   // 'stay' keeps the menu open
  onAction: function (action, pressed, repeat, dev) {}   // left right up down jump run pause back confirm cancel
}, { id: 'my-game' });
```

`host` has: `id lang rtl profile{id,name,guest} quality{tier,cap,...} volume{music,sfx} viewport device`,
`input{isDown,isDownDev,lastDevice}`, `save(key, value)` / `load(key, default)` / `loadAsync(key, cb)`,
`submitScore(score, {player, players})`, `announce(text)` (Voice Guide), `pause()` (ask for the pause menu),
`exitToMenu()`, `progress(p)`, `loaded()`, `failed(reason)`, `pickProfile(slot, cb)`,
`stageLoading(title)` / `stageLoaded()` (the same loading bar for per-stage loading).

Design for a 1920×1080 stage (the hub scales it to the TV, centred). Keep important UI inside the 5% safe area
(96 px left/right, 54 px top/bottom, `viewport.safeArea`). Size your canvas as
`cssWidth × dpr`, capped by `host.quality.cap` (960 / 1920 / 3840 pixels wide), and recompute it in `resize`.

## Transports (chosen automatically)

| Where the game runs | Transport |
|---|---|
| First-party game inside the hub's `game.html` | direct calls |
| Remote game (another origin) | one sandboxed iframe (`sandbox="allow-scripts allow-same-origin"`) and `postMessage` |
| The game page opened by itself | a tiny built-in host: keyboard, localStorage saves, a local top 10 |

Protocol (versioned): `{ v: 1, type, id, data }`.
- Hub → game: `init {lang, rtl, quality, volume, profile, device, viewport, saves, topScores}`, `start`, `pause`,
  `resume`, `destroy`, `input {action, pressed, repeat, dev}`, `menu {id}`, `resize`, `reply`.
- Game → hub: `hello`, `ready`, `progress {value}`, `loaded`, `failed {reason}`, `menuItems {items}`,
  `submitScore {score, player}`, `save {key, value}`, `load {key}` → `reply`, `announce {text}`, `exit`,
  `requestPause`, `destroyed`, `key {keyCode, down}`, `pickProfile {slot}` → `reply`.
- Saves are per profile and per game, limited to 64 KB per game. `init.saves` carries them so `host.load` is synchronous.
- On `destroy` the hub waits at most 1 s for `destroyed`, then blanks and removes the iframe anyway.
- If a remote game reports no `progress`, the hub shows an indeterminate bar; 20 s without any message is an error.

## First-party games and the loading screen

A game bundled in this repo has a `game-manifest.json` with `scripts`, `styles`, `assets`, `sizes` (bytes) and
`entry` (the standalone page; its `<body>` markup is injected into `game.html`). Run `npm run manifests` to fill
them from `index.html`. The loader downloads them with XHR and shows real bytes / total (download 0–80%,
decode 80–85%, your `host.progress` 85–100%); a failed file is retried once, then Retry / Back to menu. Use
`Arcade.url(path)` for files next to your game, `Arcade.asset(path)` for files already downloaded from the
manifest, and `Arcade.root()` for the element that holds your DOM.

## Registering a game

Publish it, then add its URL in the admin page (`/admin/`): the `game-manifest.json` next to your page prefills
title, description and cover. Only games that use SDK version 1 and need no new privileges are listed.
Original IP only: no third-party names, art or look-alikes.
