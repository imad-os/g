# Certification walk-through

**Automated** means it is checked by `tests/run-tests.mjs` (headless Chromium, mocked Tizen APIs).
**On TV** means it can only be confirmed on real hardware. Fill those rows in before each Seller
Office submission.

## Back key and exit

| Check | How it works | Status |
|---|---|---|
| Back on the main menu opens the exit confirmation | `js/launcher/main.js` route(): `confirm(exitTitle…)` | Automated ✅ |
| Yes exits with `tizen.application.getCurrentApplication().exit()` | `exitApp()` | On TV |
| Back in a game opens the pause menu | `GameShell.onAction` (game.html) | Automated ✅ |
| Pause menu → Quit to menu returns to the launcher and refocuses the game tile | `GameShell.exit` → `index.html?from=<id>` | Automated ✅ |
| Back on the settings, help, privacy and about screens closes them and restores focus | router | Browser ✅ / On TV |
| Back while a game loads cancels the load (a late response is ignored) | `GameShell.onAction` | Browser ✅ / On TV |
| Back is handled in exactly one place, with no `tizenhwkey` listener | `Input.onKey` → router | Code review ✅ |
| Home key, then relaunch from recent apps: the game is paused and stays paused until Resume | `visibilitychange` → `openPause()`, `AudioContext.suspend()` | On TV |

## Voice Guide (TTS)

| Check | Status |
|---|---|
| `<html lang>` follows the UI language (en, fr, es, ar; Arabic sets `dir="rtl"`) | ✅ |
| Every tile is a `<button>` with an `aria-label`: title, description, New/Updated, Last played | ✅ |
| Settings rows read "name: value. Use left and right to change"; a changed value is announced | ✅ |
| Dialogs and the pause menu use `role="dialog"` and real DOM focus | ✅ |
| Loading, paused, game over, stage name, checkpoint, hurry, gamepad changes and map nodes are announced through `#a11y-live` | ✅ |
| The canvas, HUD and iframe are `aria-hidden`; `<body>` is never hidden | ✅ |
| Voice Guide reads every item on the TV, in every language | On TV |

## Screen fit and engines

| Check | Status |
|---|---|
| The UI is laid out at 1920×1080 and scaled to the window (tested at 1280×720, 1920×1080, 3840×2160, 1920×1080@2x, 21:9 and 32:9; game canvases = CSS size × dpr, capped per tier; 5% safe area) | ✅ |
| No CSS that needs Chromium > 56 (no nesting, `@layer`, range media queries, `oklch()`, `:has()` or flex `gap`) | Code review ✅ |
| ES5 JavaScript only (runs on Tizen 4.0 and newer) | Code review ✅ |
| All 4 languages fit (the longest strings are FR and ES; text that might be long has ellipsis) | Browser ✅ / On TV |

## Network

| Check | Status |
|---|---|
| No network at launch: the bundled copy runs, and the menu appears about 0.2 s after the loader | Automated ✅ |
| A slow network is capped at 2.5 s for the manifest, then the bundled copy runs | Code review ✅ |
| A broken hosted build is blacklisted and the bundled copy runs | Automated ✅ |
| No CDN or third-party library is loaded | ✅ |

## Store-specific checks

| Check | Status |
|---|---|
| Network disconnected → notification popup (and "connected" on return), in menus and during games | Automated ✅ / On TV (unplug the cable) |
| Screensaver disabled during play, restored when paused or in the menu | On TV (play with a gamepad for 10+ minutes) |
| App icon 512×423 24-bit PNG < 300 KB, declared in `config.xml` | Automated ✅ |
| Language change updates every text on screen | Browser ✅ |

## Input

| Check | Status |
|---|---|
| OK activates a button exactly once (`preventDefault` on keydown; no native click) | ✅ |
| Remote-only play: hold OK to jump higher; Red key or the pause menu turns on auto-run; Up fires | ✅ |
| Gamepad (standard mapping): connect and disconnect toasts; unplugging a pad pauses the game | Automated with mocked pads ✅ / On TV per model year |
| The gamepad can operate the pause menu (the launcher polls pads while the game loop is stopped) | Automated ✅ |
| A button or key still held when the pause menu opens never counts as a new press (no open/close flicker) | Automated ✅ |
| 2-player co-op: each hero reads only its own device (remote/arrows, WASD, pad 1, pad 2) | Automated ✅ / On TV with 2 pads |
| Top-10 initials entry works with the remote only (Up/Down letter, Left/Right move, OK save, Back saves) | Automated ✅ |
| Only the keys that are used are registered: MediaPlayPause, MediaPlay, MediaPause, ColorF0Red | ✅ |

## Performance and memory

| Check | Result |
|---|---|
| 20 launch/exit cycles: no iframe left, every AudioContext closed, every loop stopped, JS heap within +10% (first-party and remote games) | Automated ✅ |
| Super Jumper stage load (including the 1.2 s title card) | 1.1 s at 1×, 1.4 s at 6× and 2.3 s at 12× CPU throttle ✅ |
| Fallback when frames drop: fewer effects → 30 fps rendering → half resolution | Verified under 6× and 12× throttle ✅ |
| Steady 60 fps on a 2022 TV in the busiest stage (w3-4) | On TV |
| Total memory under 250 MB on the lowest supported model | On TV (use the Tizen Studio memory profiler) |

## Content and IP

- All names, characters, art, levels, music and sound effects are original. No third-party assets
  are used.
- The game titles avoid trademarks: "Block Drop", not Tetris, and "Tile Merge", not 2048-branded.
- No personal data is collected. The privacy text is in Settings → Privacy policy. Age rating:
  everyone (cartoon action, no violence beyond stomping).

## Game platform (remote games, profiles)

| Check | How it works | Status |
|---|---|---|
| Back on `game.html` never exits the app (pause → Quit to menu → home) | `GameShell.onAction`, loading/error states also go home | Automated ✅ |
| Back handling, network popup, Voice Guide, multitasking pause live in the packaged pages, not in games | `js/game/shell.js`, `js/core/net.js` | Automated ✅ |
| Remote games run in one sandboxed iframe (`allow-scripts allow-same-origin`, another origin); the top-level page stays packaged (no `tizen:allow-navigation`) | `js/game/remote.js` | Automated ✅ |
| Remote games are listed only if they use the same SDK version and need no new privileges (`sdk`, `minShell` in the registry) | `Registry.usable()` | Automated ✅ |
| Launch: loading screen on the first frame, byte-weighted bar, Voice Guide "Loading", every 25%, "Ready"; failures show Retry / Back | `game.html`, `js/game/loading.js` | Automated ✅ / On TV (launch < 10 s) |
| Home → game and back stay within the 10 s launch rule and < 1 s return | page switches reuse the cached boot decision (`sessionStorage`) | On TV |
| Profile picker: Voice Guide labels, Back closes it and restores focus, Default checkbox, 4 languages | `js/core/picker.js` | Automated ✅ / On TV |
| Deleting a profile deletes its data; a deleted registry game loses its saves and scores | `Profiles.remove`, `Store.dropGame` | Automated ✅ |
| The admin page is not in the `.wgt` (`tools/build-wgt.sh` copies only runtime files) | build script | Code review ✅ |
