---
name: mypc
description: Make this repository a My PC app or game for the Samsung TV desktop "My PC", or change one. Use when the user says My PC, MyPC, mypc, "for the TV", "App Store Manager", "publish to My PC", "make it compatible", or asks to build, fix or update a game/app that runs inside My PC.
when_to_use: Any task in a repo that has mypc-app.json, or when the user wants a new TV game/app for My PC.
---

# My PC app / game

This repository is (or must become) an app or game that runs inside **My PC**
(https://github.com/imad-os/g), a Samsung TV desktop used with the TV remote only.

## Always, before any work

1. Fetch the latest guide fresh (never work from memory or a saved copy) and follow every MUST in it:
   https://raw.githubusercontent.com/imad-os/g/main/sdk/GUIDE.md
   (fallback: https://imad-os.github.io/g/sdk/GUIDE.md)
2. Load the SDK with a `<script>` tag from https://imad-os.github.io/g/sdk/mypc-sdk.js. Never copy it into this repo.
3. Working example: https://github.com/imad-os/g/tree/main/sdk/example
4. If this repo has no `CLAUDE.md` pointing to the guide, create one from
   https://raw.githubusercontent.com/imad-os/g/main/sdk/template/CLAUDE.md
   (so the rules also apply where this skill is not installed).

If anything here disagrees with the guide, the guide wins.

## Essentials (the guide has the details)

- `mypc-app.json`, the lifecycle (start / pause / resume / quit), TV remote input only (arrows, OK, Back).
- 1920x1080 TV screen; must run smoothly on a 1 GB RAM TV (no allocation per frame, free everything on quit).
- Strings in English, French, Spanish and Arabic (right-to-left).
- Own menu in the game: `ownMenu: true` so the gamepad Start button opens it.
- Phones: My PC draws a customizable touch pad for every app (manifest `"touch"`, `MyPC.pad`); never build your own pad, or set `"touch": false`.
- Multiplayer: `MyPC.multiplayer.host()` / `join()` (My PC draws the lobby and the accept dialog), never your own lobby, backend or Firebase keys.
- Every release: bump `version` in `mypc-app.json` and the same `?v=<version>` on every own file `index.html` loads.
- Finish with the guide's checklist.

## When done

Commit and push. Make sure GitHub Pages is on (Settings > Pages > Deploy from a branch > main / root). Tell the owner:
- the address to paste into the My PC App Store Manager (https://imad-os.github.io/g/installer/): `https://<owner>.github.io/<repo>/`
- for updates: press **Update** next to the app in the App Store Manager once Pages has published.
