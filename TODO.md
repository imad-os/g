# TODO: next updates (prompt)

> When the owner says **"do the todo list"** (or names a task, e.g. "do TODO 2"), treat this file
> as the task description. Work through the tasks **in the order below**. Each task must meet its
> acceptance criteria, pass `npm test`, and add tests for its new behaviour. Then tick it here, bump
> the builds and commit. Ask before deciding anything listed under "Open decisions" if no default
> is given. Otherwise use the stated default and mention it.

## Context (read first)

- The repo is the Samsung TV (Tizen) game hub "Arcade". Read `README.md`,
  `docs/samsung-store-guide.md` and `docs/certification.md` first.
- **Current architecture:**
  - `js/boot/loader.js` handles bundled vs hosted copies.
  - `js/launcher/*` is the hub UI.
  - `js/launcher/game-host.js` runs one game at a time in a **same-origin** iframe
    (`document.write` of the fetched page).
  - `games/shared/gamekit.js` is the in-game runtime.
  - `js/core/input.js` provides per-device actions.
  - `js/core/scores.js` holds the top-10 tables.
  - `js/core/perf.js` picks the quality tier.
- **Rules that always apply:**
  - Samsung certification rules from the store guide: Back handling, network popup, Voice Guide,
    multitasking, launch < 10 s, no CDN at start-up, ES5 / Chromium 56 compatible code, and only
    the privileges that are used.
  - Max optimisation: no leaks, nothing allocated per frame, a game's memory is fully freed on
    exit (heap test ±10%), and the hub must not bloat.
  - Original IP only: no "Asphalt", "Mario", "Tetris" names, art or look-alikes.

---

## TODO 1: Standalone games and the hub as a game platform

**Goal:** games are separate web apps, each in its own folder or public GitHub repo and served by
its own GitHub Pages URL. The hub only lists them, launches them, and gives them shared services
(input, scores, storage, profiles). Adding a game = adding its URL.

0. **Two pages (decided by the owner): home and game, never both in memory.**
   - `index.html` = **home**: the game list with covers, profiles and settings.
   - **Launching:** home navigates to `game.html?id=<gameId>&profile=<id>` with
     `location.replace` (no history growth). The browser then discards the whole home document:
     covers, DOM, JS heap.
   - **Exiting:** "Quit to menu" navigates back to `index.html?from=<gameId>`. The game document
     is discarded and home refocuses that tile.
   - **`game.html`** is a small packaged shell:
     - it has the static `$WEBAPIS/webapis/webapis.js` tag, a loading bar, the pause menu, the
       initials entry and the network popup;
     - it uses the same core modules (input, a11y, i18n, storage, scores) and the same Back /
       multitasking rules, and loads **no home code and no covers**.
   - **First-party games** (bundled under `games/`): their scripts load **directly into
     `game.html`** (no iframe at all = least memory).
   - **Remote games** (another GitHub Pages origin): loaded in **one** sandboxed iframe inside
     `game.html`, talking to it through the SDK. The TV top-level page stays packaged, so Back,
     Tizen APIs and certification behaviour are kept. Navigating the top level to an outside URL
     would need `tizen:allow-navigation`, which switches the app to a strict CSP and loses the
     Back handling.
   - **Hosted vs bundled:** the loader decision (`js/boot/loader.js`) is made once per app start,
     then cached in `sessionStorage`, so page switches do not re-check the network. `game.html`
     uses the same source (hosted or bundled) as home.
   - **Speed:** page switch → first frame of the loading bar in < 300 ms; back to home with the
     focused tile in < 1 s. Covers must load lazily, only the visible ones.
   - **Multitasking:** `visibilitychange` works the same on both pages. Back on `game.html` never
     exits the app (pause → quit to home).
0b. **Loading screen with a real progress bar (every game, first-party or remote).**
   - **Instant screen:** `game.html` shows its loading screen on the very first frame, before any
     game code is fetched: game title, cover (only if already in the HTTP cache), progress bar and
     percentage text.
   - **Manifest-driven loading:** the game's `game-manifest.json` lists everything to load:
     `scripts` (JS, in order), `styles`, `assets` (images, audio, level/JSON files) and
     `sizeBytes` per file (or a total `sizeMB`).
   - **Byte-weighted progress:** the loader fetches them with XHR, measuring
     `onprogress`/`loaded` bytes. The bar shows the **real downloaded bytes / total**, not a fake
     animation. Files without a known size count by file.
   - **Phases:** scripts are injected in order after download (`async=false`), assets are decoded
     (`Image.decode()`, `AudioContext.decodeAudioData`), then the game reports its own init
     progress through the SDK (`progress 0..1`). Split the bar into phases, e.g. download 0–80%,
     decode/init 80–100%. The bar never moves backwards.
   - **Remote games (iframe):** the SDK reports the iframe's own download/init progress with
     `progress` messages. If a remote game sends nothing, show a steady indeterminate animation,
     and never a frozen screen.
   - **Load on demand:** load what the first screen needs. Big games (e.g. Super Jumper levels,
     racing track data) load later parts per stage with the same progress-bar component (stage
     loading screen).
   - **Errors:**
     - A failed file is retried once.
     - Then show Retry / Back to menu.
     - Timeout: 20 s without any progress.
     - Hosted file fails → fall back to the bundled copy of that game if there is one.
   - **Accessibility:** Voice Guide announces "Loading <game>", then every 25% at most (not every
     tick), then "Ready". The bar has `role="progressbar"` with `aria-valuenow`.
   - **Low-end TVs:** the bar only touches one element's `width` (or `transform: scaleX`), at
     most about 10 updates per second. No CSS animations running while bytes download.
   - **Tests:**
     - The bar reaches 100% only after all listed files have loaded.
     - Progress values are non-decreasing.
     - A missing asset shows the error dialog.
     - A throttled network (Playwright route delay) shows intermediate values.

1. **Game SDK (standard entry and exit points).** Create `sdk/arcade-sdk.js`: one small ES5 file
   that every game includes.
   - **Transport:** direct calls when the game runs in `game.html` itself, `postMessage` when it
     is a remote iframe. Same API either way. Versioned protocol: `{ v: 1, type, id, data }`.
   - **Hub → game:** `init {lang, quality, volume, profile, device, viewport}`, `start`, `pause`,
     `resume`, `destroy`, `input {action, pressed, repeat, dev}`, `menu {id}`, `resize`.
   - **Game → hub:** `ready`, `progress {0..1}`, `loaded`, `failed {reason}`,
     `menuItems [...]`, `submitScore {score, player}`, `save {key, value}`, `load {key}` → reply,
     `announce {text}`, `exit`, `requestPause`.
   - **Shutdown:** the game must stop rAF and timers and close its AudioContext / GL context on
     `destroy` (even though the page navigation frees everything, this keeps remote iframes
     clean).
   - Write `docs/game-sdk.md`, a guide to building a game for the hub, with a minimal example
     game in `sdk/example/` that runs standalone on GitHub Pages.
   - `games/shared/gamekit.js` becomes an optional helper on top of the SDK.
2. **The game page stays in control.** Back, pause menu, network popup, initials entry and
   profiles belong to `game.html`, so a game cannot break certification rules.
   - Input is captured by `game.html` and forwarded. The SDK forwards keys pressed while a remote
     iframe has focus.
   - Remote iframes: `sandbox="allow-scripts allow-same-origin"` (they are on another origin, so
     they cannot touch the hub's DOM or storage).
3. **Storage and scores for any game.**
   - `save`/`load` go through the hub, namespaced as `game_<id>_<profile>_<key>`.
   - `submitScore` uses `js/core/scores.js`, with tables per game, and stores the profile name.
   - Per-game quota (e.g. 64 KB) so one game cannot fill the TV storage.
   - **Reset progress** and deleting a game clear its data.
4. **Game registry in Firebase (Firestore): project `tvgames-f984d`.** Config:
   `firebase/firebase-config.js`. Rules: `firebase/firestore.rules`. Setup steps for the owner:
   `firebase/SETUP.md`. Collection `games`, document id = game id; fields as described in
   `SETUP.md` (`title`, `description`, `url`, `cover`, `enabled`, `order`, `minShell`, `sdk`,
   `build`, `bundled`, `tags`, `updatedAt`).
   - **TV reads:** the **Firestore REST API** with plain XHR, no Firebase SDK, nothing from a CDN
     (`GET https://firestore.googleapis.com/v1/projects/tvgames-f984d/databases/(default)/documents/games?key=...`).
     3 s timeout. Show only `enabled` games, sorted by `order`.
   - **Caching and fallback:**
     - Cache the last good list in localStorage.
     - Offline or on error: use the cache, then the bundled `app-manifest.json` games. Never an
       empty or black home.
     - Bundled games (`bundled: true`, url `games/<id>/`) always run from the package.
   - **Admin page:** `admin/index.html` on GitHub Pages, desktop browser only, never in the `.wgt`.
     - It may use the Firebase JS SDK v12 modules from gstatic. That is fine because it is not
       the TV app.
     - Google sign-in. Writes are allowed only for UIDs listed in `/admins` (see rules).
     - Features: list, **add** (paste a URL → fetch its `game-manifest.json` → prefill title,
       description, cover → validate), **enable/disable**, **delete** (with confirmation),
       **reorder** (up/down + drag), **preview** (open the game URL), and show the rule
       validation errors clearly.
   - **Seeding:** the admin page has a one-click "import bundled games" that writes the 6
     first-party games with `bundled: true`.
5. **Migrate the 6 current games** to the SDK. Keep them in this repo under `games/` (as
   "first-party standalone" games, each one runnable alone at its own URL), listed in Firestore.
   - Bundled copies of these 6 stay in the `.wgt`, so the app works with no network and passes
     certification.
   - Remote games are only listed when online (or cached and reachable).
6. **Loading and memory rules.**
   - **Lifecycle:** one game iframe at a time. On exit: `destroy` → wait ≤ 1 s for `destroyed`
     → `src = 'about:blank'` → remove the iframe.
   - **Failures:** load timeout 20 s → error with Retry / Back. A game with a broken URL never
     freezes the hub.
   - **Tests:** extend `tests/run-tests.mjs`:
     - a cross-origin game served from a second local server port;
     - add/disable/reorder via a mocked registry;
     - offline falls back to the cache;
     - 20 launch/exit cycles of a remote game, heap within +10%;
     - a game that ignores `destroy` is still removed.

**Open decisions (defaults in brackets):**
- **Remote code and Samsung:** remote games change what the certified app does. [Default: only
  list games that use the same SDK version and need no new privileges. Mark this clearly in the
  App UI Description. Bigger changes go through a new Seller Office submission.]
- Firebase: done. The owner provided the config (`firebase/firebase-config.js`). The owner must
  follow `firebase/SETUP.md` (create Firestore, publish rules, enable Google sign-in, add their UID
  to `/admins`) before the admin page can write.

---

## TODO 2: Full screen on every TV resolution

**Goal:** every screen of the hub and every game fills the screen correctly on any TV, at any
web resolution and pixel ratio. Never cropped, never tiny, and sharp on 4K.

- **Facts:**
  - Tizen TV web apps usually get a 1920×1080 CSS viewport. Some older or low-end models use
    1280×720.
  - 4K panels report `devicePixelRatio` 2 (3840×2160 physical pixels).
  - Ultrawide signage can be 21:9 or 32:9 (`base_screen_resolution` metadata).
- **Hub:** keep the 1920×1080 design and scale it to the real viewport. Re-check it with
  viewports 1280×720, 1920×1080, 3840×2160 at dpr 1, and 1920×1080 at dpr 2. Ultrawide: centred
  with background fill (no black screen, no left-alignment).
- **Games:**
  - Canvas backing size = displayed CSS size × `devicePixelRatio` × quality scale (from
    `perf.js`), capped by the tier (low: 960×540, mid: 1920×1080, high: up to 3840×2160 only if
    the benchmark allows).
  - Recompute on `resize`.
  - The HUD and text are scaled to the real viewport.
  - The SDK passes `{cssWidth, cssHeight, dpr, safeArea}` with `init` and on `resize`.
- **Safe area:** keep important UI inside a 5% margin (overscan on some TVs).
- **Tests:** automated screenshots at the viewports above. Check the stage fills the window, that
  nothing overflows (`scrollWidth`), and that canvas size = CSS size × dpr × scale.

---

## TODO 3: Player profiles

**Goal:** several people use the same TV. Each has their own progress, settings and scores.

- **Main page:** a "Profiles" area to **create** a profile (name via an on-screen keyboard that
  works with the remote; avatar and colour chosen from a fixed set) and **delete** one (with a
  confirmation dialog). Max 8 profiles. Rename is optional.
- **Starting a game:** choosing a game opens a **profile picker** (one tile per profile + "New
  profile"), with a **"Default" checkbox**.
  - If "Default" is checked, the chosen profile is saved in localStorage
    (`arc_default_profile`). The picker is skipped from then on, including after a restart.
  - A "Switch profile" item in Settings (and the pause menu) clears the default and shows the
    picker again.
- **Storage per profile:** `js/core/storage.js` already prefixes keys with a profile id. Make it
  real: switch profile = switch prefix.
  - Game saves, Super Jumper progress, settings (language/volumes?) [default: language and
    volumes stay global; game data per profile].
  - Score tables show the profile name instead of initials when a profile is active. The initials
    entry is only shown for the guest profile.
- **2-player mode in Super Jumper:** player 2 chooses a profile when joining [default: "Guest"].
- **Accessibility and checks:**
  - Voice Guide labels on every element, Back closes the picker, focus restored, all 4 languages.
  - Deleting a profile deletes all its data.
  - Tests for create/delete/default/skip-picker/restart.

---

## TODO 4: Experimental 3D racing game (1 stage)

**Goal:** a 3D arcade street-racing game, visually in the spirit of modern mobile racers. Speed,
neon city, motion blur feel, nitro, drifting. One track, marked **Experimental** in the hub.

- **Name and IP:** original name [default: "Neon Rush"]. Original car models, track and music.
  Never "Asphalt" or real car brands/logos.
- **Delivery:** a standalone first-party game using the SDK from TODO 1. It runs directly in
  `game.html` and is also runnable alone. If TODO 1 is not done yet, use the current GameKit
  contract.
- **Rendering:**
  - Tech: **WebGL 1** (TVs from 2018 support it) with a small custom renderer (preferred: no
    library, keep it < 60 KB). Bundled three.js only if really needed: no CDN, and look at its
    size and memory cost first.
  - **Low-poly look:** vertex-coloured meshes, a fog gradient sky, emissive neon strips, a cheap
    bloom imitation (additive sprites), speed lines at high speed.
  - **Fallback:** without WebGL, or below 20 fps after quality reduction, switch to a pseudo-3D
    (classic road-sprite) canvas renderer of the same track, so it still runs on low-end TVs.
- **Gameplay:**
  - 1 track (closed loop, about 60–90 s per lap, 3 laps), 5 AI opponents on a racing line with
    rubber-banding.
  - Accelerate automatically (remote friendly) or with a button; steer left/right.
  - OK = nitro (bar refilled by drifting/near misses); Down = brake/drift.
  - Collisions with walls/cars slow you down; there is no car damage.
  - HUD: position, lap, time, speed, nitro bar. Countdown start and a results screen.
  - Best lap time and position go to the score table (score = time-based points).
- **Performance:**
  - Target 60 fps on the 2022 TV, 30 fps fallback, draw calls < 100.
  - Geometry built once at load; no per-frame allocation.
  - Textures ≤ 1024², total GPU memory < 64 MB.
  - Release all GL buffers, textures and programs, then lose the context
    (`WEBGL_lose_context`), in `destroy`.
- **Audio:** synthesized engine sound (pitch follows speed), nitro whoosh, crash; music loop.
- **Tests:**
  - It loads, 30 s of auto-drive with no errors, and a lap is completed (cheat hook).
  - destroy frees the GL context.
  - The pseudo-3D fallback works when WebGL is disabled.
  - 10 launch/exit cycles stay within +10% heap.

---

## Definition of done (for every task)

- [ ] `npm test` passes (old and new checks), ES5 lint clean (`eslint` with `ecmaVersion: 5`).
- [ ] Back on every new screen, Voice Guide labels in en/fr/es/ar, real DOM focus.
- [ ] No leaks: launch/exit heap test, no timers left, AudioContext/GL contexts closed.
- [ ] `app-manifest.json` build bumped, changed games' builds bumped. `SHELL` bumped only if
      `config.xml`, `index.html` or the loader changed (then a new `.wgt` is needed).
- [ ] README, `docs/certification.md` and `docs/samsung-store-guide.md` updated.
- [ ] Committed and pushed; merge into `main` when the owner asks.

## Progress

- [ ] TODO 1: standalone games + Firebase hub
- [ ] TODO 2: full screen on every resolution
- [ ] TODO 3: profiles
- [ ] TODO 4: 3D racing (experimental)
