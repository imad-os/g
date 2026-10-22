# Notes for Claude (project memory)

## Owner decisions
- **Supported TVs: Samsung 2024 and newer only (Tizen 8.0+, Chromium 108+).** Don't spend effort
  on 2018–2023 TVs (Tizen 4–7). New code may use anything Chrome 108 supports (ES2022, grid, `gap`,
  `:has()`, container queries); **not** CSS nesting (Chrome 112+). Existing code is ES5 and plain
  CSS; that's fine, no need to rewrite it. This is a working rule for us: don't advertise it in
  the app UI and don't change `config.xml` `required_version` unless the owner asks.
- The app is called **My PC** (formerly "Arcade"): a dark, Windows 11 style desktop for the TV.
- Apps and games are **published** from a computer with the **App Store Manager** (`installer/`,
  Firebase sign-in, admins only) into the store catalog (Firestore `apps`). Each TV installs what its
  users pick in the **App Store** app. The TV itself never signs in (only player accounts do, below).
- **Cloud backup:** each TV is identified by a hash of its DUID (`Device.id()`); profiles, settings,
  saves, installed apps and records go to Firestore `tvs/<id>` and come back after a reinstall or a
  reset. World records in `records/<game>`. Users can turn both off (Settings > Privacy & security);
  keep the privacy text in i18n true whenever this changes.
- Original names and art only (no Nintendo/Tetris look-alikes).

## Where things are
- `index.html` + `js/boot/loader.js`: picks the hosted copy (imad-os.github.io/g) or the bundled
  one, then loads `app.html` and the JS/CSS listed in `app-manifest.json`. TVs get updates from
  the hosted copy at the next start: **bump `build` in `app-manifest.json`** (and a game's
  `game-manifest.json` `build` when it changes). Don't change `shell` unless `config.xml`/loader
  changes need a new package.
- **Updates:** `js/boot/loader.js` lives in the **package** (a change there reaches TVs only with a
  new .wgt; bump `config.xml` version, **never** bump `shell`: old packages would stop accepting
  online builds). It waits 4 s for the hosted manifest; if the server is slow it runs the last
  hosted build that worked (`boot_good`, saved at ready / by Settings > Update) before falling back
  to the built-in copy. `js/launcher/updater.js` + Settings > Update (check, download with progress,
  restart) are hosted code and reach TVs as a normal online update.
- **Two pages:** opening a game or installed app loads `index.html?play=<id>` (no desktop is built
  there); quitting loads `index.html?from=<id>` (fresh desktop). Same packaged index.html/loader.
- `js/launcher/`: desktop shell (`desktop.js`), full-screen app window (`window.js`), apps
  (`apps/*.js`: settings, explorer, browser, calculator, calendar, scores), on-screen keyboard,
  profiles, `game-host.js` (bundled games in a same-origin iframe; installed apps in a sandboxed
  cross-origin iframe through the SDK protocol), `main.js` (router: the only place handling Back).
- **Profiles are users:** every profile has its own settings (language, clock, background, volumes, graphics, saves: `arc_<profile>_*`); only hardware facts and the top-10 records are TV-wide (`arc_dev_*`). Switching profile goes through `js/launcher/welcome.js` (sign-in screen, then the app restarts as that profile). Records are saved automatically under the profile name (no initials screen). A profile's picture (`av` drawn avatar from `js/launcher/avatars.js`, or `photo`) lives in `arc_profiles` and is backed up with it. `Welcome.afterBoot()` also shows "My PC is up to date" once per new build.
- **Roles** (owner decision): each profile is `role: 'admin'` or `'user'` in `arc_profiles` (per TV, in the TV backup, never in
  the account). Only an admin installs / uninstalls apps, adds / removes users, changes roles and the TV-wide rows of the
  Control Panel (`admin()` in settings.js shows them as "Administrator only" to a user). Always at least one admin; profiles from
  before roles: the first is admin. A new profile is a user once the TV has a named or signed-in admin. Switching from a user to an
  admin that has an account asks its password. API: `Profiles.isAdmin(id?)`, `setRole`, `canRemove`; Control Panel > Accounts > Other users.
- **Themes** (per profile, `Store` key `theme`): `js/launcher/themes.js` puts `th-<id>` on `<html>`; looks are CSS only in
  `css/themes.css` (win11 = launcher.css itself, win7, xp, mac, android, ios; no images, no blur). Picking one also sets its wallpaper.
- **Control Panel** (was Settings; the app id stays `settings`): opens on a grid of categories (`Win.open('settings')`), a page
  with `Win.open('settings', '<page>')`; Back: row > page list > grid > close. Its strings, roles and themes are in `js/core/i18n-users.js` (`I18n.add`).
- **Player accounts** (owner decision): a profile is created with a **unique username** (plain, like `imad12`, not tied to a TV) and a
  **required password**; Profiles > **Sign in** adds an existing account to a TV or phone with its progress. Per profile switch "Ask for the
  password" (Settings > Accounts). `js/core/accounts.js` = Firebase Auth REST (`<username>@players.mypc.app`), cloud copy Firestore
  `players/<uid>` (only that account) as `data.<game id>.<key>` + `settings.<key>` (old builds' single `blob` string is still read; `blob` is now only a mark they can't parse; upload falls back to the old shape on 403 until the rules are republished), secrets in `arc_dev_acct` (never in the TV backup), newest copy wins (pulled at start, pushed
  after changes). Old local profiles keep working; Settings > Accounts > "Create an account for this profile" turns one into an account.
- **Game controllers first** (owner decision): apps must use every controller button. `Input.onPadRaw` reports every button / axis
  change; `game-host.js` forwards it to installed apps (`gp` messages, only while running) as `MyPC.gamepad` (API 9; standalone the
  SDK polls the pads itself and maps them to actions like `Input`).
- `js/core/`: storage (per-profile keys `arc_<profile>_*`, TV-wide `arc_dev_*`), i18n (en, fr,
  es, ar + RTL), input, focus, perf, scores, `cloud.js` (Firestore REST: store catalog, installed list
  `arc_dev_installed`, counters), `backup.js` (Device id, backup/restore), `world.js` (world records).
- `games/`: built-in games on `games/shared/gamekit.js`. Super Jumper stages come from
  `tools/gen-levels.mjs`; after any change to chunks, the generator or the hero's physics
  (`Actors.TUNE` in `games/jumper/js/actors.js`) run `node tools/play-levels.mjs`: it plays every stage
  with a handicapped hero and must finish all of them with no traps.
- **Home screen shortcuts**: hold OK (600 ms), long-press or right-click a desktop icon or Start tile -> menu Open / Remove from
  (or Add to) home screen / Uninstall (installed apps, admins only: `Profiles.isAdmin()`). Short OK on a shortcut opens it on release
  (`main.js` passes the OK release to `Desktop.action`). Removed ids per profile in `home_hidden` (`Desktop.onHome` / `setOnHome`);
  too many icons scroll sideways in `#desk-icons`.
- `apps/store.js`: the App Store app (Home / Games / Apps / Library / Search, Install / Open / Uninstall).
- **Settings of every My PC** (owner decision): App Store Manager > Settings writes Firestore `settings/mypc` (admins only, read by
  every TV): backgrounds (`wallpapers: [{ url, title, thumb }]`, an empty title is taken from the address) and the background of new
  profiles (`wallpaper`). `js/core/global-settings.js` copies it at start into `arc_dev_global` (not in the backup); `Desktop.wallpapers()`
  = the built-in CSS ones + these pictures (a picture shows once loaded, Bloom if it fails). New global settings go in the same document
  (update `validMyPc` in the rules). Manager pages: a nav link `data-page` + a `<section data-view>` of the same name; it works on phones.
- **Background pause** (owner decision): My PC losing the focus (TV other app/source, PC window blurred or minimized, phone app
  switched; `main.js` visibilitychange + window blur checked with `document.hasFocus()`) calls `GameHost.background()`: the game
  pauses under My PC's menu. Config `"allow_background_running": true` (store app config or game-manifest.json): menu only, no
  pause / resume. The menu plays `AudioPrefs.chime()` (tiny WAV in one `<audio>`, no AudioContext) every time it opens.
- **App config:** each store app has a `config` object (Firestore `apps/<id>`, edited with the
  App Store Manager's Config button). The TV re-reads the app's document before it opens
  (`Cloud.fetchApp`, 2.5 s, falls back to the saved list) and the app gets it as `MyPC.app_config`.
- **Multiplayer (`MyPC.multiplayer`)**: `host()` / `join()` in the SDK; **the shell owns the flow**: its own screens (open a room, join
  list, waiting, accept dialog) in `js/launcher/multiplayer.js` (markup `#mp` in `app.html`), signalling in `js/core/rooms.js`
  (Firestore `rooms/{room}` + `reqs`, rules / index / TTL in `firebase/SETUP.md` section 4), the WebRTC data channel in
  `js/core/netlink.js` (its code is also inside `sdk/mypc-sdk.js` for standalone mode; a test keeps both identical). Apps only get
  peers; never room ids, offers or Firebase. `game-host.js` relays peers over postMessage (`mp`).
- **Touch controls**: on phones / tablets the shell draws the virtual pad (`js/launcher/touchpad.js`, library `js/core/virtual-pad.js`)
  above every app, feeding `Input.touch` (device `'touch'`). Per-app config: `touch` in `mypc-app.json` / the Firestore `apps` doc,
  `MyPC.init({ pad })`, `MyPC.pad` in the SDK. The library's one source is `sdk/pad/virtual-pad.js` (from github.com/imad-os/g_rpg `pad/`,
  one My PC change: `onSettings`); run `node tools/sync-pad.mjs` after editing it (copies in `js/core/` and inside `sdk/mypc-sdk.js`).
- **Installable web app**: `manifest.webmanifest` (fullscreen, landscape), `sw.js` (network first), `js/core/pwa.js` registers it and keeps phones in landscape
  (orientation lock after the first touch where Chrome allows it, else a "turn your phone" cover). Web only, never on the TV.
- **Phone controller** (a phone as player 1 / 2, shows no game): the phone side is the system app **Game controller** (`js/launcher/apps/gamepad.js`, phones only, hidden on the TV); the TV side is `js/launcher/controllers.js`
  (Settings > Devices > Phone controller). Signalling = a `rooms` doc with app `controller` and a fixed code kept in `arc_dev_ctrl`, link = NetLink;
  P1 = Input device `keys`, P2 = `keys2` (`Input.remote`). The phone reconnects by itself when the TV changes page. Separate from the in-game touch pad.
  Pairing is a QR code (own page Settings > Devices > Phone controller, `js/core/qr.js`, link `?pair=<code>` opens the Game controller and connects).
  **Owner decision: its Buttons mode reuses the existing virtual pad (`VirtualPad`, id `controller`), never a separately drawn pad;**
  **A B X Y in the Nintendo places** (pad button option `place`) ****the phone IS a virtual standard gamepad on the TV (`Input.virtualPad`, message `gp`: raw button bits + stick axes, device `pad10<player>`), never high-level actions** (owner rule, games must see exactly a real pad; Input.PAD_BUTTONS reads by position): A right = `b` (run + cancel), B bottom = `ok` (jump + confirm), X top and Y left = run, the + button = `menu` (Start), Home (pad option `home`) = `guide`**; same mapping in the shell's touch pad and the SDK's `MyPC.pad`.
  **Phone settings** (Game controller > Settings, `arc_dev_ctrlphone.opt`): Auto rotate, Stay awake, Background (native in the APK 2.1.0+ via
  `MyPCNative.settings`; always shown, no conditions) and GamePad (pad option `dpad`: a D-pad in place of the stick); Disconnect / Forget TV; a paired TV is reconnected by itself
  when the Game controller opens (`paired`); it opens on Connect, never auto-focusing the code box.
  Motion modes `sensor-actions` / `sensor-raw`: protocol `js/core/sensor-proto.js`, detection `js/core/motion.js` (moves are data rules,
  right hand only for now), games get them through `MyPC.sensors` (API 8) / `host.sensors`; full spec in `docs/phone-controller.md`.
  **Pointer mode** (`pointer`, owner decision: separate from Motion data, which stays raw): magic-remote style pointer on the My PC screens
  (config `pointer: true`, never on a game's page). `js/core/aim.js` on the phone (gyro bias learning, gravity by complementary filter,
  grip from the screen orientation, steady zone, 1 euro smoothing, click hold) -> `{ t: 'pm', x, y }`; `js/launcher/pointer.js` on the TV.
  Phone screen: no stick, big A / B, Center, Calibrate (finds reversed directions), smoothness / speed / steady zone / swaps (`.ptr`).
  **Motion moves tuning on the TV** (Settings > Devices > Phone controller > Motion moves, `arc_dev_ctrltune`): per-move limits, harder
  while running, repeat guard; sent to phones as config `tune`, live test via `Controllers.monitor`. Phone settings use − / + buttons;
  the Game controller root stops `touchmove` so VirtualPad's document-wide blocking does not stop scrolling.
  **Owner rule: the APK is ALWAYS the whole My PC app (opens the desktop), never controller-only; every APK rebuild (build.ps1)
  bumps `build` so the desktop's Get the app link serves the new APK. Write this into any new project or session brief.**
  **Android app** `android-controller/` (APK "My PC": Java WebView shell of the hosted My PC, opens the desktop like any app; old 1.x APKs open `?ctrl=1`): phone Back = TV Back (`Input.systemBack`), exit = `MyPCNative.exit`; native sensors / QR / screen-off link
  through `window.MyPCNative` + `assets/bridge.js`; build with `android-controller/build.ps1` (JDK + SDK in `%USERPROFILE%\.tooling`), commit
  the rebuilt `My-PC.apk` (+ the same file as old name `My-PC-Controller.apk`; build.ps1 also bumps `build`, which the Get the app link carries, so commit app-manifest.json with it); the signing key lives outside the repo (`.tooling\keys`), never commit it.
- **Heart-rate sensors (TV)**: `js/core/hr-ble.js` (any BLE Heart Rate Service device: Garmin watches broadcasting, Polar, Garmin HRM, Decathlon),
  created per app by `game-host.js` for `hr-monitor` or apps with `"heartRate": true` in their config; SDK `MyPC.bluetooth`.
  Needs the `bluetooth` privileges in `config.xml` (package 1.4.0+), so a new .wgt on the TV. Unit tests: `node tests/unit-tests.mjs` (part of `npm test`).
- **App bridges (API 10)**: installed apps call `MyPC.net` (web requests from My PC: no CORS on the TV, local network refused unless
  config `"lan": true`), `MyPC.ai` (one request format for Gemini / OpenAI / Claude / NVIDIA and any OpenAI-compatible URL; text,
  images, audio, video in and out; services + keys set for every My PC in the App Store Manager > AI services (Firestore `settings/ai`, copied at start by `Bridges.syncAi` into `arc_dev_ai`; Settings > AI only shows them; never in the backup, never sent to apps; owner decision: no key typing on the TV) and
  `MyPC.mic` (getUserMedia in the shell, privilege `mediacapture`, package 1.5.0). Shell side `js/core/web-proxy.js`, `ai.js`,
  `mic.js`, glue + permission prompts (`arc_dev_perm`, AI and mic once per app) in `js/launcher/bridges.js`. Standalone the SDK
  loads the same three core files from the hosted site. Docs: `sdk/GUIDE.md` section 14.
- **Error reports (API 11)**: `js/core/reports.js` saves to Firestore `errors` (TTL `exp` 30 days, rules + index in `firebase/`): app load /
  start failures and timeouts from `game-host.js` (with why: no SDK answer, no `ready()`, given up), uncaught errors of built-in games, the
  SDK's reports (uncaught, rejections, failed files, handler throws, `MyPC.fail`, `MyPC.report`; sent even before `MyPC.init`), and My PC's
  own errors (`mypc`). Deduped (one report + count), 8 per app per page, 60 per TV per day, batched, offline queue. Switch: Settings >
  Privacy & security > Send error reports. Dashboard: App Store Manager > Errors (`#errors/<app id>`, store apps are `app-<id>`).
- `sdk/`: `mypc-sdk.js` (protocol `{ mypc: 1, type, data }`), `GUIDE.md` (for building new apps
  in other repos), `example/`.
  **`sdk/GUIDE.md` is the one source of truth for app makers**: every change to the SDK, the protocol, the controller,
  multiplayer, sensors, the manifest or the rules for apps MUST update it in the same commit (and `docs/phone-controller.md`
  for sensors). `docs/ai-build-prompt.md` is the short prompt the owner gives an AI by URL; it only links to the guide, so
  keep facts out of it (change it only when its links or the steps change).
- `installer/`: the App Store Manager, a desktop-browser page (Firebase JS SDK from gstatic is OK
  there, never in the TV app). Also shows TV statistics and world records.
- `firebase/`: rules and owner setup steps (`SETUP.md`). After a rules change the owner must publish
  them again in the Firebase console. Tests use an in-memory Firestore (`fakeFirestore` in
  `tests/run-tests.mjs`); never let tests or scripts reach the real database.

## Rules that always apply
- **Buttons are A B X Y + the +, always (owner rule, repeated many times).** Every pad or hint with face buttons (phone controller, the shell's
  touch pad over apps, the SDK's `MyPC.pad`, the VirtualPad library, games, on-screen hints, docs, examples) uses A B X Y in the Nintendo
  places, each sending what the same button of a real Nintendo pad sends (A right = run + back, B bottom = OK / jump, X top and Y left = run, + = menu). Never A B C, never a ☰ / "Menu" button: pause / menu is the Nintendo-style **+** button (top centre of the pad). Check this before
  you ship any control or hint.
- One app or game at a time, full screen; free everything on close (iframes, timers, AudioContext).
  No allocation per frame in games.
- Every screen must work with the TV remote alone (arrows, OK, Back) and Voice Guide.
- Strings in all 4 languages.
- Run `npm test` (Playwright; in the cloud container use `CHROMIUM_PATH=/opt/pw-browsers/chromium`)
  and add tests for new behaviour.
