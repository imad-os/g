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

1. **Game SDK (standard entry and exit points).** Create `sdk/arcade-sdk.js`: one small ES5 file
   that every game includes. It talks to the hub with `postMessage`, so games can live on any
   origin. Versioned protocol: `{ v: 1, type, id, data }`.
   - **Hub → game:** `init {lang, quality, volume, profile, device}`, `start`, `pause`, `resume`,
     `destroy`, `input {action, pressed, repeat, dev}`, `menu {id}`.
   - **Game → hub:** `ready`, `progress {0..1}`, `loaded`, `failed {reason}`,
     `menuItems [...]`, `submitScore {score, player}`, `save {key, value}`, `load {key}` → reply,
     `announce {text}`, `exit`, `requestPause`.
   - The game must answer `destroy` by stopping rAF and timers, closing its AudioContext and
     replying `destroyed`. The hub then removes the iframe.
   - Write `docs/game-sdk.md`, a guide to building a game for the hub, with a minimal example
     game in `sdk/example/`.
   - Keep `gamekit.js` as an optional helper on top of the SDK.
2. **Hub stays in control.** Back, pause menu, network popup, initials entry and profiles stay in
   the hub, so a game cannot break certification rules.
   - Input is captured by the hub and forwarded. A key pressed while the game iframe has focus is
     also forwarded by the SDK.
   - The game page cannot touch hub DOM or storage. Use a sandboxed cross-origin iframe:
     `sandbox="allow-scripts allow-same-origin"` on its own origin.
3. **Storage and scores for any game.**
   - `save`/`load` go through the hub, namespaced as `game_<id>_<profile>_<key>`.
   - `submitScore` uses `js/core/scores.js`, with tables per game, and stores the profile name.
   - Per-game quota (e.g. 64 KB) so one game cannot fill the TV storage.
   - **Reset progress** and deleting a game clear its data.
4. **Game registry in Firebase (Firestore).** Collection `games`, document per game:
   `{ id, title{en,fr,es,ar}, description{...}, url, cover, minShell, sdk, enabled, order,
   updatedAt, tags:[experimental?] }`.
   - **TV reads:** use the **Firestore REST API** (plain XHR, no SDK: lighter on the TV, nothing
     loaded from a CDN). 3 s timeout.
   - **Caching:** cache the last good list in localStorage. Offline or on error, use the cache,
     then the bundled `app-manifest.json` games. Never show an empty or black hub.
   - **Admin:** an admin page `admin/index.html` on GitHub Pages, using Firebase Auth (Google
     sign-in, owner e-mail only) plus Firestore security rules (public read; write only for the
     owner UID).
     - Add a game (URL + metadata, validated by fetching its `game-manifest.json`).
     - Enable/disable, delete, reorder (drag or up/down), and preview a game.
   - Ship `firestore.rules` and document the Firebase project setup in the README.
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
- **Ask the owner:** is a separate Firebase project needed? This task needs the Firebase config
  (apiKey, projectId) from the owner.

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
- **Delivery:** a standalone game using the SDK from TODO 1. If TODO 1 is not done yet, use the
  current GameKit contract.
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
