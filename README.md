# My PC: a Windows-style desktop for Samsung TVs

A Samsung Smart TV (Tizen) web app (formerly "Arcade"): a dark Windows 11 style desktop with apps,
seven built-in games and installable apps/games, playable with the TV remote, a gamepad or a
keyboard. It also runs in any desktop browser.

**Make a new app or game:** give `https://imad-os.github.io/g/sdk/GUIDE.md` and a description of
the game to Claude Code in a new repository. **Install it:** open
`https://imad-os.github.io/g/installer/` on a computer (setup: `firebase/SETUP.md`).

| Game | Type | Notes |
|---|---|---|
| **Super Jumper** | 2D side-scrolling platformer | 3 worlds × (4 stages + fortress), world map, power-ups, 7 enemy types, 3 bosses, star coins, secret exits, swim stages, **2-player co-op** |
| **Block Drop** | falling-block puzzle | 7-bag, ghost piece, wall kicks, levels |
| **Sky Hopper** | endless vertical jumper | moving/breaking/vanishing platforms, springs, flying enemy |
| **Neon Snake** | snake | input queue, speed-up, bonus fruit |
| **Brick Breaker** | breakout | 5 layouts, wide/slow/multi-ball power-ups |
| **Tile Merge** | sliding number puzzle | animated slides and merges |
| **Parchís** | board game, 2 to 4 players | Moroccan rules, turn by turn on one remote, any seat can be a CPU |

All art is drawn by code at load time and all music and sound effects are synthesized with Web Audio.
There are no image or audio files to download or decode, and no third-party libraries. Names,
characters, levels and melodies are original. Nothing uses Nintendo or Tetris names or assets.

**Top scores:** every game keeps a top-10 table on the TV, managed by `js/core/scores.js`. When a game
ends with a score that makes the table, the launcher asks for 3 initials, arcade style: Up/Down
changes the letter, Left/Right moves, OK saves. The last initials are remembered. The **Top scores**
button on the main menu shows the tables (Parchís has a winner, not points, so it has none). Voice Guide reads each table. *Reset progress* clears
them. Games report scores with `host.submitScore(score, { player, players })`.

**Desktop (v2):** the launcher looks like a dark Windows 11 style PC.
- **Desktop:** wallpaper (4 CSS backgrounds, no image files), icons for the games and apps, and a
  taskbar with Start, pinned apps, input device / network / volume icons and a clock. The clock
  ticks once a minute and only while the desktop is on screen.
- **Start menu:** every app and game, a recommended game, the profile button and Exit.
- **Apps** (`js/launcher/apps/`): File Explorer (Home, This PC, Desktop, Games, Apps, Pictures,
  Documents), Browser, Calculator, Calendar (notes per day), Settings (System, Personalization,
  Accounts, Sound, Time & language, Gaming, Privacy & security, About) and Leaderboards.
- **Games on their own page:** opening a game loads `index.html?play=<id>`, so the browser throws the
  whole desktop away (DOM, images, timers, JS heap) and that page builds only the game. Quitting
  loads `index.html?from=<id>`: a fresh desktop focused on the game. It reuses the packaged
  `index.html` and boot loader, so no new TV package is needed.
- **Full screen, one at a time:** `js/launcher/window.js` hides the desktop (releasing the game
  covers and stopping the clock) and destroys the app's content, timers and iframe when it closes.
  Games still run in their own iframe and are freed on exit.
- **Remote:** arrows move, OK opens, Back goes back (up a folder, back a page, then closes the app),
  Back on the desktop asks to exit. A PC keyboard types into the calculator and on-screen keyboard;
  the Windows key opens Start.
- **Browser:** pages load in one sandboxed iframe; Up/Down scroll it. Some websites refuse to be
  shown inside another app (X-Frame-Options) and stay blank.

**Installed apps (My PC SDK):**
- Each app is a static website with `mypc-app.json` and the SDK (`sdk/mypc-sdk.js`); see
  `sdk/GUIDE.md` and the example in `sdk/example/`.
- `installer/` (desktop browser, Firebase sign-in, admins only) reads the manifest and writes the
  Firestore `apps` collection.
- The TV reads that list at start-up with the Firestore REST API (`js/core/cloud.js`, no sign-in),
  keeps the last good list for offline use, and shows the apps on the desktop, in Start, File
  Explorer and Settings > Apps.
- An app runs full screen in a sandboxed iframe on its own origin. `game-host.js` talks to it with
  `postMessage` (`{ mypc: 1, type, data }`): My PC sends the input actions, pause/resume/destroy and
  its saved data; the app reports progress, ready, saves, scores and announcements. Back is always
  My PC's (pause menu). Quitting removes the iframe.

**Profiles:** the profile button in the Start menu (or Settings > Accounts) opens the Profiles screen. There you
can switch profile, create one (name typed with an on-screen keyboard; a PC keyboard can type too),
rename it or delete it. Each profile has its own saves, top scores and last played game. Language,
volumes and graphics are shared by the whole TV. Storage keys are `arc_<profile>_<key>` and
`arc_dev_<key>` (`js/core/storage.js`).

**Parchís (Moroccan rules):** one die. A 5 brings a piece out, and it must come out if it can. A 6
rolls again, and a third 6 sends the last moved piece back to its nest. Captures happen outside the
safe squares (circles) and give 20 squares to move. Bringing a piece home gives 10. Two pieces of one
colour make a wall that nobody passes. The centre needs the exact number. Set up 2, 3 or 4 players
and make each seat a person or a CPU; people take turns on the same remote (OK rolls, left/right
picks a piece when there is a choice).

**Super Jumper 2-player co-op:**
- **Joining:** open the pause menu and choose *Two players*. Player 2 then presses OK / A on **their
  own controller**, which can be another gamepad, the TV remote, or W A S D + F (jump) + G (run) on
  a PC keyboard.
- **Devices:** `js/core/input.js` tags every action with its device (`keys`, `keys2`, `pad0`…), and
  each hero reads only its own device.
- **Lives and scores:** separate per player; coins and star coins are shared.
- **Falling:** a fallen player respawns above their partner. The stage restarts from the
  checkpoint only when both are down.
- **Screen:** the camera keeps both heroes on screen. Pipes, goals and boss doors take both.
- **Leaving:** choose *Two players: On* in the pause menu again.

## Run it

```sh
npx http-server -p 8080 -c-1 .     # or: npm run serve
# open http://localhost:8080/index.html
```

`file://` does not work in desktop browsers because they block XHR on local files. On the TV the
packaged files load normally.

Keyboard: arrows, Enter/Space/Z (jump/OK), Shift/X (run/fire), Esc/Backspace (back/pause), R (run toggle).
Second player on the same keyboard: W A S D, F (jump), G (run/fire).

## How it adapts to the TV

`js/core/perf.js` picks a quality tier, and every game also adapts while it runs.

| Tier | Canvas | Effects | Picked when |
|---|---|---|---|
| low | 480×270, scaled up by the GPU | 24 particles, 1 parallax layer, no clouds, 2 music voices | Tizen < 5 (2018–19), ≤ 2 cores, ≤ 1 GB, or benchmark < 45 fps |
| mid | 960×540 | 64 particles, 2 layers, 3 voices | Tizen 5–6.x (2020–22), ≤ 4 cores, or benchmark < 57 fps |
| high | 1920×1080 (native, no scaling) | 160 particles, 3 layers, clouds | Tizen 7+ (2023+) with a fast benchmark |

- **Benchmark:** a 0.6 s canvas benchmark runs once per device while the menu is idle. The result
  is cached and refines the tier on the next launch.
- **At run time:** `games/shared/gamekit.js` measures fps in 1 s windows. After 2 slow windows
  (< 50 fps) it steps down: fewer effects → 30 fps rendering (gameplay stays at a fixed 60 Hz) →
  half canvas resolution. This was measured under 6× and 12× CPU throttling in Chromium.
- **Override:** Settings → Graphics quality: Auto / Low / Medium / High. A fixed choice only allows
  the 30 fps fallback.

Memory and CPU rules followed everywhere:
- One game at a time, in an iframe that is destroyed on exit. The launcher hides its DOM, releases
  the cover images and starts no timers while a game runs.
- No `setTimeout`/`setInterval` in games: one rAF loop. Fixed-size pools are used for particles,
  fireballs, rocks, items and popups, so nothing is allocated per frame.
- Platformer tiles are pre-rendered into 128 px chunks that are built lazily and LRU-capped at 8
  (about 1.3 MB). Only animated tiles are drawn each frame. Off-screen enemies are frozen.
- The HUD is DOM text that is only touched when a value changes, so it stays crisp at any canvas
  resolution.
- The launcher creates no AudioContext. Each game creates one in `start()` and closes it in
  `destroy()`.
- The JS is ES5 and the CSS is plain (no nesting, `@layer`, `:has()`, `oklch()` or flex `gap`), so it
  runs on Tizen 4.0 (Chromium 56) and newer.

## Project structure

```
config.xml               Tizen config (privileges: internet, tv.inputdevice)
index.html               shell: webapis.js + splash + js/boot/loader.js
app.html                 launcher markup (injected by the loader)
app-manifest.json        { build, version, shell, css[], js[], games[] }
js/boot/loader.js        hosted vs bundled selection, blacklist, AppBoot.ready()
js/core/                 storage, i18n (en/fr/es/ar), a11y, audio prefs, perf, input, focus
js/launcher/             menu.js (grid, settings, pages), game-host.js (iframe lifecycle, pause menu), main.js (router)
games/shared/            gamekit.js (loop, adaptive quality, synth, pools), game.css, strings.js
games/<id>/              game-manifest.json, index.html, js/, cover.png
games/jumper/assets/levels/  Tiled-compatible JSON stages + index.json
tools/                   gen-levels.mjs, level-chunks.mjs, validate-levels.mjs, make-covers.mjs, build-wgt.sh
tests/run-tests.mjs      Playwright acceptance tests
docs/certification.md    certification walk-through
```

## Online updates (hosted files)

This works the same way as Speedy IPTV. The `.wgt` contains the full launcher and every game, so it
works with no server. At launch `js/boot/loader.js` fetches
`https://imad-os.github.io/g/app-manifest.json` with a 2.5 s timeout. It runs the hosted copy only
when all of these hold:
- `shell` equals `SHELL` in the loader;
- `build` is newer than the bundled build;
- that build is not blacklisted on this TV.

The hosted files are loaded into the packaged document, so Tizen APIs keep working. A hosted build
that fails to load, throws during start-up, or does not call `AppBoot.ready()` within 20 s is
blacklisted and the bundled copy restarts.

**Per-game manifests.** `games/<id>/game-manifest.json` holds `id`, `build`, `minShell`, `entry`,
`assets`, `sizeMB`, `title`, `description` and `cover`. Games resolve against the same base as the
app. If a hosted game fails to load, the launcher falls back to the bundled copy of that game. A game
needing a newer shell (`minShell`) is hidden.

**Publish an update:**
1. Change the code or levels.
2. Bump `build` in `games/<id>/game-manifest.json` for each changed game.
3. Bump `build` in `app-manifest.json`.
4. Push to the branch GitHub Pages serves (Settings → Pages → `main`, root).

TVs pick up the update on their next launch. Changed games show an "Updated" badge.

**Add a new game online:** add `games/<new>/`, list it in `app-manifest.json` `games`, then bump
`build`. It must only use what the shell already allows.

**Bump `shell`** in both the loader and `app-manifest.json`, and submit a new `.wgt`, whenever
`config.xml`, privileges, `index.html` or `js/boot/loader.js` change. A hosted build can never add
privileges. New input types, payments, accounts or ads need a normal Seller Office update. When
you submit a new `.wgt`, its `build` must be at least the hosted one.

`.nojekyll` makes GitHub Pages serve every file. GitHub Pages content is public, even for a private
repository.

## Store assets and Samsung rules

`node tools/make-store-assets.mjs http://localhost:8080/` regenerates these from the game art:
- the 512×423 app icon (`icon.png`);
- the browser favicons (`favicon.ico`, `icon-32.png`, `icon-192.png`, `apple-touch-icon.png`);
- the Seller Office logo, background and 4 screenshots in `store/`.

`privacy.html` is the privacy policy URL to give Seller Office.
**Read `docs/samsung-store-guide.md` before submitting.** It has the full checklist, the usual
rejection reasons mapped to how the app handles them, and the App UI Description content.

## Packaging and signing (.wgt)

1. Install Tizen Studio with the TV extensions.
2. In Certificate Manager, create a **Samsung** certificate profile (author + distributor). You
   need it to run on retail TVs and to submit.
3. Put your Seller Office application id and package id into `config.xml`
   (`XXXXXXXXXX.arcade`), plus a unique widget `id`.
4. `TIZEN_PROFILE=<profile> sh tools/build-wgt.sh` validates the levels, copies only runtime
   files to `build/wgt/` and runs `tizen package -t wgt`.
5. Test on a TV:

   ```sh
   sdb connect <tv-ip>
   tizen install -n build/wgt/Arcade.wgt -t <device>
   ```

6. Upload to Seller Office. Declare TTS (Voice Guide) support, set the age rating, and use the
   privacy policy text from Settings → Privacy policy (no personal data is collected).

Check every `config.xml` value against the current Samsung docs. `required_version="4.0"` targets
2018+ TVs, since the code is ES5. Raise it if you only certify newer model years.

## Super Jumper levels

Stages are built from hand-made chunks (`tools/level-chunks.mjs`) and exported as Tiled-compatible
maps with 16×16 tiles and the layers `background`, `tiles` and `entities`:

```sh
node tools/gen-levels.mjs        # regenerate all 15 stages (deterministic)
node tools/validate-levels.mjs   # check start/goal/checkpoint, 3 star coins, warps, max gap width
```

You can also edit a stage JSON in Tiled and run the validator on it.

The stage loader reads each stage on demand and builds its theme atlas, freeing the previous
stage's.

Super Jumper names: the hero is Pip. Power-ups are the Berry (big), the Blaze Bloom (fire), the
Glow Gem (invincibility) and the Life Leaf (1-up). Enemies are Blorp, Snailby, winged Blorp,
Snapvine, Bristle, Pebbler and Slab, plus three bosses: King Blorp, Sand Crab and Frost Owl.

## Tests

```sh
npm i -D playwright http-server
npm test        # node tests/run-tests.mjs
```

The tests run headless Chromium with mocked `tizen` and `webapis` and cover these cases:
- a hosted newer build runs;
- offline falls back to the bundled copy;
- a broken hosted build is blacklisted and the bundled copy runs (a game is playable after each);
- a hosted build for another shell is ignored;
- 20 launch/exit cycles leave no iframe, close every AudioContext, stop every loop, and do not grow
  the JS heap by more than 10%;
- Back opens the exit dialog on the menu and the pause menu in a game;
- every Super Jumper stage loads and can be finished, including the bosses;
- top-10 tables: initials entry, sorting, the 10-entry cap and the Scores screen (Voice Guide label
  and Back);
- 2-player co-op with arrows + WASD and with two (mocked) gamepads: joining, each device moving only
  its own hero, respawn, both players entering initials at game over, and unplug → pause.

`npm run covers` regenerates the menu covers from real gameplay frames.
