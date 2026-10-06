# Certification walk-through

**Automated** means it is checked by `tests/run-tests.mjs` (headless Chromium, mocked Tizen APIs).
**On TV** means it can only be confirmed on real hardware. Fill those rows in before each Seller
Office submission.

## Back key and exit

| Check | How it works | Status |
|---|---|---|
| Back on the main menu opens the exit confirmation | `js/launcher/main.js` route(): `confirm(exitTitle…)` | Automated ✅ |
| Yes exits with `tizen.application.getCurrentApplication().exit()` | `exitApp()` | On TV |
| Back in a game opens the pause menu | `GameHost.onAction` | Automated ✅ |
| Pause menu → Quit to menu returns to the launcher and refocuses the game tile | `GameHost.exit` → `onGameExit` | Automated ✅ |
| Back on the settings, help, privacy and about screens closes them and restores focus | router | Browser ✅ / On TV |
| Back while a game loads cancels the load (a late response is ignored) | `GameHost.onAction` | Browser ✅ / On TV |
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
| The UI is laid out at 1920×1080 and scaled to the window (tested at 1280×720 and 960×540) | ✅ |
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

## Input

| Check | Status |
|---|---|
| OK activates a button exactly once (`preventDefault` on keydown; no native click) | ✅ |
| Remote-only play: hold OK to jump higher; Red key or the pause menu turns on auto-run; Up fires | ✅ |
| Gamepad (standard mapping): connect and disconnect toasts; unplugging the active pad pauses the game | Code review ✅ / On TV per model year |
| Only the keys that are used are registered: MediaPlayPause, MediaPlay, MediaPause, ColorF0Red | ✅ |

## Performance and memory

| Check | Result |
|---|---|
| 20 launch/exit cycles: no iframe left, every AudioContext closed, every loop stopped, JS heap within +10% | Automated ✅ |
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
