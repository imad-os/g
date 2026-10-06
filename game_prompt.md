# Prompt: Samsung TV Games App ("Arcade" launcher + first game "Super Jumper")

> Copy everything below this line into a new session as the task description.

---

## 1. Goal

Build a **Samsung Smart TV (Tizen) web application** that is a small **game launcher**:
a main menu showing a curated list of games. Choosing a game loads it safely, and exiting the
game always returns to the launcher main menu. Games are playable with the **TV remote** and with
**game controllers** (USB / Bluetooth gamepads).

The first game is an **original 2D platformer in the style of the Nintendo 3DS "New Super Mario
Bros." games**: side-scrolling, stages grouped into worlds, power-ups, coins, enemies, secrets,
smooth 60 fps, with music and sound effects.

The app must pass **Samsung Seller Office certification** the first time. The rules in
section 3 come from real rejection reports on another app of ours (Speedy IPTV) and are mandatory.

## 2. Mandatory: hosted-files update method (bundled app + hosted copy)

The app **must** use the same update method as Speedy IPTV (see `js/boot/loader.js`,
`app-manifest.json` and `app.html` in the Speedy repo):

1. The `.wgt` submitted to Samsung contains a **complete, working copy** of the launcher
   **and** of every game shipped at that time. The app must work 100% with no server.
2. `index.html` is only a **shell**: the `$WEBAPIS/webapis/webapis.js` script tag (must stay
   static in the packaged page), a splash and `js/boot/loader.js`.
3. At launch the loader fetches the hosted `app-manifest.json` (GitHub Pages, HTTPS) with a
   **2.5 s timeout** and runs the hosted copy only when:
   - `shell` equals the `SHELL` constant compiled into the package,
   - `build` is greater than the bundled build,
   - that build was not previously blacklisted on this TV.

   Otherwise it runs the bundled copy. There must never be a black screen when offline.
4. Hosted files are loaded into the **packaged document** (markup from `app.html`, CSS/JS
   from the manifest, `<base href>` set to the hosted URL), so Tizen/Samsung APIs keep working.
   Do **not** use `<tizen:content src="https://…">` (fully hosted start page): device APIs
   and offline behaviour are not guaranteed there.
5. A hosted build that fails to load a file, throws during start-up, or does not call
   `AppBoot.ready()` within 20 s is **blacklisted** and the bundled copy restarts.
6. **Per-game manifests:** each game has its own `games/<id>/game-manifest.json`
   (`id`, `build`, `minShell`, `entry`, `assets`, `sizeMB`). The launcher lists the games from
   the active app manifest. A game can be updated or added online by bumping its `build` and
   the app `build`. Game assets resolve against the same base (hosted or bundled) as the
   app. If a hosted game fails to load, fall back to the bundled version of that game, if any.
7. **Publishing an update:** edit, bump `build`, push to the GitHub Pages branch.
   Bump `shell` **and** submit a new `.wgt` whenever `config.xml`, privileges, the shell
   `index.html` or the loader change; a hosted build can never add privileges.
8. Hosted updates are for fixes, content and new levels or games built on the same features.
   New behaviour that Samsung would need to test (new input types, payments, accounts, ads)
   must go through a normal Seller Office update.
9. Add `.nojekyll` so GitHub Pages serves every file. Note that GitHub Pages content is public
   even when the repository is private.

## 3. Samsung certification rules (must pass)

- **Back key (10009 / `XF86Back`):**
  - in a game → open the pause menu;
  - from the pause menu → "Quit to menu" returns to the launcher;
  - on the launcher main menu → an **exit confirmation** dialog
    (`tizen.application.getCurrentApplication().exit()` on Yes).

  Back must never do nothing and must never close the app without confirmation.
- **Handle Back in exactly one place.** Avoid the "double back" bug: listen to `keydown`
  keyCode 10009, or `tizenhwkey`, not both.
- **Register keys** with `tizen.tvinputdevice.registerKey()` only for what is used, for example
  `MediaPlayPause`, `ColorF0Red`…`ColorF3Blue`. Map remote keys by **keyCode**: `e.key` is
  often `"Unidentified"` on TVs. Arrows, Enter and Back need no registration.
- **Multitasking:** on `document.visibilitychange` (hidden), pause the game loop, suspend the
  `AudioContext` and show the pause menu. On return, stay paused until the user resumes.
- **Voice Guide (TTS) is tested.** Never put `aria-hidden` on `<body>`.
  - Every focusable menu item has a spoken name (`aria-label` or text), in every UI language.
  - Decorative SVGs and images get `aria-hidden="true"` or `alt=""`.
  - Dialogs use `role="dialog"`.
  - Status messages go through an `aria-live` region.
  - Set `<html lang>` to the UI language.
  - Use real DOM focus (`element.focus()`), not only CSS classes. In-game HUD/canvas may be
    `aria-hidden`; announce pause/game over through the live region. Declare TTS support in
    Seller Office.
- **Screen fit on all model years:** design for 1920×1080 and test on older engines.
  - Do not ship CSS that needs Chromium > 85: no CSS nesting, no `@layer`, no media range
    syntax, no `oklch()`/`color-mix()`, no `:has()`.
  - If you use Tailwind v4, down-level it like Speedy's `tools/compat-css.mjs`, or prefer
    plain CSS.
- **No crash or freeze with no network**, a slow network, or the server down.
- **Do not load libraries from CDNs at start-up.** Bundle them.
- **OK/Enter must activate a button exactly once.** If you call `.click()` yourself,
  `preventDefault()` the keydown.
- **Intellectual property:** do not use Nintendo names, characters, sprites, music, sounds or
  level layouts. No "Mario", "Luigi", "Goomba", "Koopa", "Mushroom Kingdom", etc.
  The game is an *original* game "in the style of" classic platformers. Samsung rejects IP
  infringement.
- Privacy policy and age rating fields as required by Seller Office; no personal data collected.

## 4. App structure (Tizen web app)

```
/config.xml
/index.html                 shell: webapis.js + splash + js/boot/loader.js
/app.html                   launcher markup (injected by loader)
/app-manifest.json          { build, version, shell, css[], js[], games[] }
/.nojekyll
/icon.png                   512x423 or per current Seller Office spec (check docs)
/css/launcher.css
/js/boot/loader.js          hosted/bundled selection (section 2)
/js/core/                   input.js, focus.js, a11y.js, i18n.js, storage.js, audio.js
/js/launcher/               menu.js, game-host.js
/games/<id>/game-manifest.json
/games/<id>/index.html      game page (loaded in the game host iframe)
/games/<id>/js/…  /games/<id>/assets/{img,audio,levels}/…
/tools/                     build scripts (excluded from the .wgt)
```

### config.xml (starting point; verify every value against current Samsung docs)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<widget xmlns="http://www.w3.org/ns/widgets" xmlns:tizen="http://tizen.org/ns/widgets"
        id="https://yourdomain.example/arcade" version="1.0.0" viewmodes="maximized">
  <tizen:application id="XXXXXXXXXX.arcade" package="XXXXXXXXXX" required_version="6.5"/>
  <name>Arcade</name>
  <icon src="icon.png"/>
  <content src="index.html"/>
  <feature name="http://tizen.org/feature/screen.size.all"/>
  <tizen:profile name="tv"/>
  <access origin="*" subdomains="true"/>   <!-- WARP mode; do NOT add tizen:allow-navigation (switches to strict CSP) -->
  <tizen:privilege name="http://tizen.org/privilege/internet"/>
  <tizen:privilege name="http://tizen.org/privilege/tv.inputdevice"/>
  <tizen:privilege name="http://tizen.org/privilege/application.launch"/>
  <tizen:setting screen-orientation="landscape" context-menu="disable" background-support="disable"
                 encryption="disable" install-location="auto" hwkey-event="enable"/>
  <tizen:metadata key="http://samsung.com/tv/metadata/multitasking.support" value="true"/>
</widget>
```

- `required_version`: pick the oldest Tizen version you will test on, for example 6.5 for
  2022 TVs. The code must run on that engine (Chromium 85: ES2019; avoid newer JS without
  transpiling).
- Request only the privileges you use. Unused or partner-level privileges fail upload.
- Do not set `prelaunch.support` unless start-up is fully idle when hidden.

## 5. Loading and unloading games safely (RAM/CPU limits)

TV browsers have much less memory and CPU than a PC. Budget **≤ 250 MB total** for the app
(launcher + one game) and test on the lowest model you support.

- **One game at a time, isolated in an `<iframe>` (same origin)** created by
  `js/launcher/game-host.js`. While a game runs:
  - the launcher hides its DOM;
  - it stops its own timers and animations;
  - it releases its images (`src=""`).
- **Game contract** (each game exposes this via `window.GameAPI` inside the iframe):
  `init(host)`, `start()`, `pause()`, `resume()`, `destroy()`. The `host` object provides
  input events, the audio master volume, `exitToMenu()`, `announce(text)` and `save/load(key)`.
- **On exit:**
  1. Call `destroy()`, which must cancel `requestAnimationFrame`, clear timers, `close()` its
     `AudioContext` and drop references.
  2. Remove the iframe and set `iframe.src = 'about:blank'` before removal.
  3. Show the launcher and restore focus to the game tile.

  Removing the iframe lets the engine free all of its memory.
- **Loading screen** with a progress bar while the game's assets load. Load assets per world
  or stage, not the whole game. A load failure shows an error with Retry and Back to menu;
  never a frozen screen.
- **Rendering performance:**
  - Render at **1280×720 or 960×540 internal resolution** and scale the canvas to 1920×1080
    with CSS (`image-rendering: pixelated` for pixel art).
  - Use one canvas: Canvas 2D with pre-rendered tile chunks, or a minimal WebGL sprite
    batcher. Benchmark both on a real TV.
  - Use texture **atlases** (≤ 2048×2048 each) and pre-allocated **object pools**; no
    allocations inside the game loop, to avoid GC stutter.
  - Use a fixed-timestep update (60 Hz) with interpolated rendering. If frames drop, keep
    gameplay speed correct and allow a 30 fps rendering mode.
- **Audio:** Web Audio API, one `AudioContext` per game, created on game start and closed on
  exit. Load SFX as small decoded buffers and music as compressed loops (**AAC/MP3**: check
  Ogg support on target models). Keep a separate master volume for music and SFX. Mute or
  suspend on pause and on visibility hidden.

## 6. Input

- **Remote:**
  - Arrows: move / navigate.
  - OK: jump / confirm.
  - Back: pause / back.
  - Color keys optional (e.g. Red = run toggle for remote-only players).
  - Long-press OK: higher jump (variable jump height).
  - Remote-only play must be fully possible, with an optional "auto-run" setting.
- **Gamepad:**
  - Use the W3C Gamepad API (`navigator.getGamepads()`, poll each frame, standard mapping):
    D-pad / left stick to move, A to jump, B/X to run or fire, Start to pause, Select/Back
    to pause menu.
  - Handle `gamepadconnected` / `gamepaddisconnected`.
  - Show which input is active and auto-pause when the active gamepad disconnects.
  - Verify Gamepad API support on each target model year and document results.
- **Keyboard** (development): arrows, Space, Shift, Esc.
- A single input module turns all of these into actions (`left`, `right`, `up`, `down`,
  `jump`, `run`, `pause`, `back`, `confirm`) for both the launcher menus and the games.

## 7. Launcher main menu

- Grid of game tiles: cover art, title, short description, "New" or "Updated" badge.
- Focus with remote arrows or gamepad, OK to play, Back for exit confirmation.
- Settings:
  - language (en, fr, es, ar);
  - music and SFX volume;
  - controller help screen;
  - reset progress;
  - privacy policy;
  - About (version + build + "online update" flag from `AppBoot`).
- Remembers the last played game and focuses it on return.

## 8. First game: "Super Jumper" (working title, original IP)

A 2D side-scrolling platformer with the feel of the 3DS "New Super Mario Bros." games: tight,
responsive controls, bright and readable art, short fun stages. Everything is original: hero,
enemies, world names, art, music and sounds.

**Structure**
- A world map with **3 worlds × (4 stages + 1 boss fortress)** for the first release.
  Stages unlock in order and the map shows completed stages and collected star coins.
- World themes: Grassland, Desert/Beach, Ice Caves.
- Each stage takes about 2–4 minutes and has:
  - a start;
  - a mid-stage **checkpoint flag**;
  - a goal pole/flag with a height-based score bonus;
  - **3 hidden "star coins"**;
  - an optional secret exit in some stages.
- Timer (e.g. 300), score, coins (100 coins = 1 life), lives. Game over returns to the world map.
- Progress saved per profile in `localStorage` through `host.save()`: unlocked stages,
  star coins, lives, score, settings.

**Hero and moves**
- Run (hold run), walk, variable-height jump, running jump, skid/turn-around.
- Crouch, ground-pound, wall-jump (unlocked or from the start), swim in water stages.
- Small form → **Big** form (takes one hit) → **Fire** form (shoots bouncing fireballs).
- Invincibility star-like power-up for 10 s with music change.
- Original names for every power-up.

**World objects**
- Ground and platform tiles, one-way platforms, moving platforms, falling blocks.
- Question-style blocks (coin / power-up / multi-coin), breakable bricks (only when Big),
  hidden blocks.
- Pipes or warp doors to bonus rooms, springs, spikes/hazards, bottomless pits, water,
  lava (fortress).

**Enemies (original designs)**
- A walker (stomp to defeat).
- A shelled walker (stomp → shell that can be kicked).
- A flying hopper.
- A plant-like pipe ambusher.
- A spiky enemy (cannot be stomped).
- A projectile thrower.
- A falling-block crusher.
- A boss per fortress with a 3-hit pattern.

**Feel targets**
- Fixed 60 Hz physics with acceleration/deceleration curves.
- Coyote time (~6 frames) and jump buffering (~6 frames).
- Camera with look-ahead and smooth vertical follow; no jitter.
- Screen shake and hit-stop on stomp.
- Input latency ≤ 3 frames.

**Levels**
- Levels are JSON tilemaps (Tiled-compatible export) with:
  - layers: background parallax, tiles, objects/entities;
  - per-stage music, time limit and theme.
- Include a small level loader and validator script in `tools/`.
- Load each stage's data and atlas on demand; free the previous stage.

**Audio**
- Original chiptune-style music loops per world, fortress, invincibility, stage clear,
  game over.
- SFX: jump, coin, stomp, power-up, fireball, break block, pipe, 1-up, damage, death,
  checkpoint, goal.
- Music ducking on pause, mute on visibility hidden.

**UI**
- HUD: lives, coins, score, star coins, timer; large and readable from 3 m (≥ 28 px at 1080p).
- Pause menu:
  - Resume, Restart stage, World map, Quit to menu;
  - Voice Guide labels on every item.

**Accessibility and options**
- Remote-friendly "assist mode": auto-run, extra checkpoint, slower timer.
- High-contrast HUD option.

## 9. Deliverables and acceptance criteria

1. **Packaging:** source repo with the structure above, plus the `.wgt` build steps (Tizen CLI)
   and a README covering signing, packaging, publishing hosted updates and bumping
   `build`/`shell`.
2. **Hosted updates:**
   - GitHub Pages deployment of the hosted copy.
   - An automated test (Playwright, mocked `tizen`/`webapis`) proving these cases, with a
     game playable after each:
     - hosted newer build runs;
     - offline falls back to bundled;
     - broken hosted build is blacklisted and bundled runs.
3. **Memory:**
   - Launch the game, exit, and repeat 20 times with no memory growth: JS heap returns to
     baseline ±10%.
   - Verify that each `destroy()` closes the `AudioContext`, cancels rAF and clears timers.
4. **Performance:** a steady 60 fps on a 2022 TV in the busiest stage (or a documented
   30 fps fallback), and stage load time under 3 s.
5. **Certification walk-through**, each with written results:
   - Back on every screen, exit confirmation, Home and return;
   - Voice Guide reads every menu item;
   - no network at launch;
   - gamepad unplugged mid-game;
   - all UI languages fit on screen.
6. **First release content:** "Super Jumper" with 3 worlds × 5 stages, all original art and
   audio (or properly licensed assets with the license files included).
