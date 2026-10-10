# Virtual pad: a customizable touch gamepad for web games

> **In My PC you rarely need this file.** My PC draws the pad for you (see "Touch controls" in `sdk/GUIDE.md`) and the SDK bundles it as
> `MyPC.pad`. This folder keeps the library and its documentation, written by the same author (source:
> `github.com/imad-os/g_rpg`, folder `pad/`, version 1.0.0). The My PC copy adds one option, `onSettings(open)`: it is called when the
> settings panel opens (`true`) or closes (`false`).


One file, no dependencies: `virtual-pad.js`. A joystick and buttons for phones and tablets that the **player can
customize** (add or hide buttons, resize, drag them anywhere, reset). Built for [My PC](https://imad-os.github.io/g/)
games, but it works in any web game.

- Multi-touch: stick and buttons work at the same time, buttons can be held.
- Customizable by the player with a gear button; the layout is saved on the device.
- 4 languages for its own texts (English, French, Spanish, Arabic, right-to-left aware).
- No page zoom, scroll or text selection while it is shown (like a native app).
- Two ways to deliver input: keyboard keys, or calls to your own input system (`onAction`), or a `send` function
  (for example to forward a phone's buttons over the network).
- Fits 2024+ Samsung TV browsers too (Chromium 108: no modern-only syntax), though a TV has no touch.

Files: `virtual-pad.js` (the library), `demo.html` (a small playable demo: open it on a phone or add `?pad=1` on a computer).

## Quick start

```html
<script src="virtual-pad.js"></script>
<script>
  VirtualPad.init();   // stick + A (Enter) + B (X) + pause (Esc); shown on touch devices
</script>
```

By default it presses keyboard keys (arrows, Enter, X, Esc) on `document`, so a game that listens to the keyboard works
without any change. With the My PC SDK in standalone mode those keys already mean `left right up down confirm/jump run pause`.

## Calling your own input system (`onAction`)

```js
VirtualPad.init({
    id: 'my-game',                                   // the saved layout is kept per id
    onAction: function (action, down) { game.input(action, down); },
    buttons: [ { label: 'A', key: 13, action: 'jump' }, { label: 'B', key: 88, action: 'run' } ],
    catalog: [ { label: 'A', key: 13, action: 'jump' }, { label: 'B', key: 88, action: 'run' },
               { label: 'C', key: 8,  action: 'cancel' }, { label: '☰', key: 77, action: 'menu' } ]
});
```

- The **stick** sends the actions `left`, `right`, `up`, `down` (a diagonal sends two). The **pause** button sends `pause`.
- A **button** with an `action` calls `onAction(action, down)`; `down` is `true` on press and `false` on release.
- Without `onAction`, or for a button without `action`, the button's `key` (a key code) is pressed instead.

## Options of `VirtualPad.init(opt)`

| Option | Default | What |
|---|---|---|
| `buttons` | A (13) and B (88) | the buttons shown at first: `{ label, key, action? }` |
| `catalog` | `buttons` | every button the player may add in the settings panel |
| `id` | `'default'` | name under which the player's layout is saved (`localStorage`, key `vpad:<id>`) |
| `scale` | `{}` | starting size multipliers `{ stick, btn }`, e.g. `{ stick: 1.35, btn: 1.25 }` for a pure controller |
| `onAction` | none | `function (action, down)`: call your own input system (see above) |
| `send` | none | `function (keyCode, down)`: route key codes somewhere else (e.g. over the network) instead of pressing keys |
| `pause` | `true` | `false` hides the pause button |
| `customize` | `true` | `false` hides the gear (settings) button |
| `onSettings` | none | `function (open)`: the settings panel opened (`true`) or closed (`false`) *(My PC addition)* |
| `force` | `false` | show the pad anywhere; by default only on touch devices when running standalone (not inside My PC) |

`?pad=1` in the page address forces the pad on and `?pad=0` hides it (handy for testing on a computer).

## API

| Call | What |
|---|---|
| `VirtualPad.init(opt)` | build and show the pad (does nothing if it is already shown, or not wanted on this device) |
| `VirtualPad.hide()` | remove the pad and release every held control |
| `VirtualPad.openSettings()` | open the settings panel from your own menu (the gear button does the same) |
| `VirtualPad.active()` | `true` while the pad is shown |
| `VirtualPad.version` | the library version |

To switch layouts (for example a pure controller screen), `hide()` then `init()` again with other options.

## What the player can customize (gear button)

- **Buttons**: tap a button's chip to show or hide it (any entry of `catalog`).
- **Stick size / Button size**: − and + (60% to 220%).
- **Move**: drag any control with a finger; **Done** to finish. Positions are saved as fractions of the screen, so they stay in
  place when the phone is rotated.
- **Reset**: back to the defaults.

The layout lives in `localStorage` under `vpad:<id>` (per device and per browser). When the storage is blocked the pad
still works, it just forgets the layout.

## Good to know

- The pad never takes focus and uses pointer events; each finger controls one thing (stick or button).
- Held controls are released automatically when the page goes to the background or the settings panel opens, so nothing
  stays stuck.
- The pad uses `z-index: 99999`; put your own overlays above it if you need to cover it.
- `document` gets non-passive `touchmove`, `gesturestart`, `gesturechange` and `contextmenu` listeners that call
  `preventDefault()` so the page cannot be zoomed or scrolled while playing. Do not use the pad on a page that must scroll.
- Own texts only appear in the settings panel, in the language of `<html lang>` (`en`, `fr`, `es`, `ar`; English otherwise).

## For My PC

The recommended integration inside My PC (touch controls for every game, from the manifest, with a "Pad settings" entry in the
pause menu) is described in `MYPC_INTEGRATION_PROMPT.md`.

## Testing

Open `demo.html` on a phone, or on a computer with `?pad=1` (the mouse acts as a finger). The stick moves the square, **A**
turns it red, **B** doubles its speed, and the gear button customizes the pad.
