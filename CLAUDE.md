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
  users pick in the **App Store** app. The TV never signs in.
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
- `js/core/`: storage (per-profile keys `arc_<profile>_*`, TV-wide `arc_dev_*`), i18n (en, fr,
  es, ar + RTL), input, focus, perf, scores, `cloud.js` (Firestore REST: store catalog, installed list
  `arc_dev_installed`, counters), `backup.js` (Device id, backup/restore), `world.js` (world records).
- `games/`: built-in games on `games/shared/gamekit.js`. Super Jumper stages come from
  `tools/gen-levels.mjs`; after any change to chunks, the generator or the hero's physics
  (`Actors.TUNE` in `games/jumper/js/actors.js`) run `node tools/play-levels.mjs`: it plays every stage
  with a handicapped hero and must finish all of them with no traps.
- `apps/store.js`: the App Store app (Home / Games / Apps / Library / Search, Install / Open / Uninstall).
- **App config:** each store app has a `config` object (Firestore `apps/<id>`, edited with the
  App Store Manager's Config button). The TV re-reads the app's document before it opens
  (`Cloud.fetchApp`, 2.5 s, falls back to the saved list) and the app gets it as `MyPC.app_config`.
- **Multiplayer (`MyPC.multiplayer`)**: `host()` / `join()` in the SDK; **the shell owns the flow**: its own screens (open a room, join
  list, waiting, accept dialog) in `js/launcher/multiplayer.js` (markup `#mp` in `app.html`), signalling in `js/core/rooms.js`
  (Firestore `rooms/{room}` + `reqs`, rules / index / TTL in `firebase/SETUP.md` section 4), the WebRTC data channel in
  `js/core/netlink.js` (its code is also inside `sdk/mypc-sdk.js` for standalone mode; a test keeps both identical). Apps only get
  peers; never room ids, offers or Firebase. `game-host.js` relays peers over postMessage (`mp`).
- `sdk/`: `mypc-sdk.js` (protocol `{ mypc: 1, type, data }`), `GUIDE.md` (for building new apps
  in other repos), `example/`.
- `installer/`: the App Store Manager, a desktop-browser page (Firebase JS SDK from gstatic is OK
  there, never in the TV app). Also shows TV statistics and world records.
- `firebase/`: rules and owner setup steps (`SETUP.md`). After a rules change the owner must publish
  them again in the Firebase console. Tests use an in-memory Firestore (`fakeFirestore` in
  `tests/run-tests.mjs`); never let tests or scripts reach the real database.

## Rules that always apply
- One app or game at a time, full screen; free everything on close (iframes, timers, AudioContext).
  No allocation per frame in games.
- Every screen must work with the TV remote alone (arrows, OK, Back) and Voice Guide.
- Strings in all 4 languages.
- Run `npm test` (Playwright; in the cloud container use `CHROMIUM_PATH=/opt/pw-browsers/chromium`)
  and add tests for new behaviour.
