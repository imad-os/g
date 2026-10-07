# Notes for Claude (project memory)

## Owner decisions
- **Supported TVs: Samsung 2024 and newer only (Tizen 8.0+, Chromium 108+).** Don't spend effort
  on 2018–2023 TVs (Tizen 4–7). New code may use anything Chrome 108 supports (ES2022, grid, `gap`,
  `:has()`, container queries); **not** CSS nesting (Chrome 112+). Existing code is ES5 and plain
  CSS; that's fine, no need to rewrite it. This is a working rule for us: don't advertise it in
  the app UI and don't change `config.xml` `required_version` unless the owner asks.
- The app is called **My PC** (formerly "Arcade"): a dark, Windows 11 style desktop for the TV.
- Apps and games are **installed from a computer** with `installer/` (Firebase sign-in, admins
  only). The TV never signs in: it reads the public `apps` collection.
- Original names and art only (no Nintendo/Tetris look-alikes).

## Where things are
- `index.html` + `js/boot/loader.js`: picks the hosted copy (imad-os.github.io/g) or the bundled
  one, then loads `app.html` and the JS/CSS listed in `app-manifest.json`. TVs get updates from
  the hosted copy at the next start: **bump `build` in `app-manifest.json`** (and a game's
  `game-manifest.json` `build` when it changes). Don't change `shell` unless `config.xml`/loader
  changes need a new package.
- `js/launcher/`: desktop shell (`desktop.js`), full-screen app window (`window.js`), apps
  (`apps/*.js`: settings, explorer, browser, calculator, calendar, scores), on-screen keyboard,
  profiles, `game-host.js` (bundled games in a same-origin iframe; installed apps in a sandboxed
  cross-origin iframe through the SDK protocol), `main.js` (router: the only place handling Back).
- `js/core/`: storage (per-profile keys `arc_<profile>_*`, TV-wide `arc_dev_*`), i18n (en, fr,
  es, ar + RTL), input, focus, perf, scores, `cloud.js` (installed apps from Firestore REST).
- `games/`: built-in games on `games/shared/gamekit.js`.
- `sdk/`: `mypc-sdk.js` (protocol `{ mypc: 1, type, data }`), `GUIDE.md` (for building new apps
  in other repos), `example/`.
- `installer/`: desktop-browser page (Firebase JS SDK from gstatic is OK there, never in the TV app).
- `firebase/`: rules and owner setup steps (`SETUP.md`).

## Rules that always apply
- One app or game at a time, full screen; free everything on close (iframes, timers, AudioContext).
  No allocation per frame in games.
- Every screen must work with the TV remote alone (arrows, OK, Back) and Voice Guide.
- Strings in all 4 languages.
- Run `npm test` (Playwright; in the cloud container use `CHROMIUM_PATH=/opt/pw-browsers/chromium`)
  and add tests for new behaviour.
