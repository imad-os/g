# This repository is a My PC app or game

**Main instruction: before every task, fetch the latest My PC guide from GitHub and follow it.**

1. Guide (always fetch it fresh, never work from memory or a saved copy):
   https://raw.githubusercontent.com/imad-os/g/main/sdk/GUIDE.md
   (if that fails: https://imad-os.github.io/g/sdk/GUIDE.md)
2. SDK (load it with a `<script>` tag from this address; never copy it into this repo):
   https://imad-os.github.io/g/sdk/mypc-sdk.js
3. Working example: https://github.com/imad-os/g/tree/main/sdk/example

The guide says how the app must be built (files, `mypc-app.json`, lifecycle, TV remote input,
screen, performance, languages, publishing). Follow every MUST, finish each task with its
checklist, and when the guide has changed, update this app to match it. If anything in this file
disagrees with the guide, the guide wins.

For multiplayer use `MyPC.multiplayer` (section "Multiplayer" of the guide): no own lobby, no backend, no Firebase keys.

For every release: bump `version` in `mypc-app.json` and the same `?v=<version>` on every own file
`index.html` loads (section 10 of the guide), so TVs never open old cached files.

When a task is done: commit, push, and tell the owner the address to paste into the My PC
App Store Manager (https://imad-os.github.io/g/installer/): `https://<owner>.github.io/<repo>/`
(GitHub Pages: Settings → Pages → Deploy from a branch → main / root), and to press **Update** next to
the app in the App Store Manager once GitHub Pages has published it.
