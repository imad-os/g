# Phone controller (Game controller app)

A phone becomes player 1 or 2 of a TV running My PC. The phone shows no game.

**Pairing by QR code.** On the TV open Settings > Devices > **Phone controller** (its own page). It shows a QR code with
the pairing link `<My PC address>/index.html?pair=<code>` (`Controllers.pairUrl()`, drawn by `js/core/qr.js`) and the code
under it; new phones are accepted while the page is open (5 minutes). Scan it with the phone's camera app: My PC opens
on the **Game controller** and connects by itself, as player 1, or player 2 if 1 is taken. Inside the app, **Scan QR
code** uses the phone's own QR reader (`BarcodeDetector`, Chrome on Android); where there is none it says to use the
camera app. Typing the code, picking **P1** / **P2** and a mode, then **Connect** still works. The phone reconnects by itself every time the TV changes page (a game opens, a game quits).

| Mode | What the phone does | What the TV / game gets |
|---|---|---|
| **Buttons** (`pad`) | The virtual pad My PC already draws over games (`js/core/virtual-pad.js`): stick, **A B X Y where a Nintendo controller has them** (A right, B bottom, X top, Y left), pause, a round **Home** button below and left of A B X Y (like a Nintendo Switch's), and the gear to hide buttons, resize and move everything (saved on the phone as `vpad:controller`). With **GamePad** on (phone Settings) a D-pad replaces the stick. | The same actions as the TV remote: player 1 = device `keys`, player 2 = `keys2`. A = OK / jump, B = run + back (`cancel`, like a gamepad's B), X = `menu`, Y = run. **Home** is the shell's own (`{ t: 'k', a: 'home' }`, never sent to apps): in a game the pause menu opens on Quit to menu (Home again resumes); on the desktop the open app closes. |
| **Motion moves** (`sensor-actions`) | The player faces the TV, phone in the right hand. The phone detects moves and sends **only the moves the game asked for**, plus metrics if asked. | `MyPC.sensors` events in the game. With no game listening, moves drive the TV: LEFT / RIGHT = left / right, JUMP = OK, DUCK … DUCK_END = down held. |
| **Motion data** (`sensor-raw`) | Sends the sensor samples themselves at the rate the game asks for. | `raw` events; the game does its own detection. |
| **Pointer** (`pointer`) | A TV pointer like a magic remote, on the My PC screens: see below. | The pointer moves; A = OK on what it points at, B = back. Nothing on a game's page. |

**Pointer mode.** Point the phone at the TV and turn it: a pointer moves on the TV and whatever item it is on gets the
focus (white ring); **A** opens it, **B** is back. The phone screen has no stick: big **A** and **B** (Nintendo places),
**Center** (pointer back to the middle), **Calibrate**, and the tuning settings, kept on the phone (`arc_dev_ctrlphone`
`.ptr`): **Smoothness** 1 to 10 (default 5), **Speed** 30 to 300 % (100 %), **Steady zone** 0 to 6 deg/s (1.5: how much
small shaking is ignored), **Swap left and right**, **Swap up and down**, **Default settings**.

How `js/core/aim.js` keeps it steady and accurate, for every sensor sample:
1. **Gyroscope offset**: learnt while the phone is held still (under 2.5 deg/s for half a second, no shake) and removed,
   so the pointer does not drift.
2. **"Up"** comes from the accelerometer (gravity), kept by the gyroscope between samples (complementary filter). While
   the phone shakes (accelerometer more than 2.2 m/s² away from 1 g) gravity is not used, so a shake does not tilt the axes.
3. **Axes from the grip**: held like a remote (screen up) the phone points with the top of the screen's picture (it
   follows the landscape / portrait orientation); held like a camera (screen to the player) it points with its back.
   Turning around "up" = left / right, turning around the horizontal axis across the pointing direction = up / down.
   A twist of the wrist around the pointing direction does not move the pointer, and moving the phone without turning it
   (a shake, a step) does not either: only rotation counts.
4. **Steady zone**: speeds are scaled by v² / (v² + steady²): tremor (about 1 deg/s) almost disappears, slow intended
   moves (4 deg/s and more) go through.
5. **Smoothing** (a "1 euro" filter on the position): strong while slow (precise), light while fast (little lag),
   stronger for a moment after a shake. The pointer always ends exactly where the phone points.
6. **Click**: pressing A stops the pointer where it is shown and ignores the movement for 250 ms, so the press does not
   move it.

**Calibrate**: "Point at the middle of the TV and hold still" (learns the offset, centres the pointer), "turn the phone
slowly to the right", "tilt it slowly up". A direction that came out reversed is swapped (the two Swap settings). Too
little movement: it says so and changes nothing.

On the TV, `js/launcher/pointer.js`: one small layer moved with a transform at most once per frame; the item under it
looked up 10 times a second (it gets the focus without scrolling); a little acceleration (quick turns go further); it
stops at the screen edges (turning back re-aligns it), hides after 5 s without movement or when an arrow is pressed and
comes back in the centre. Nothing runs while it is hidden. The phone sends 50 small messages a second at most, only while
moving. On a game's page the config says `pointer: false` and the phone sends nothing.

**Android app** (`android-controller/`, `My-PC.apk`: the whole My PC app): the same Game controller page in a native shell that
feeds it native motion samples (200 Hz fused sensors, 100 Hz samples with their own timestamps) instead of
`devicemotion`, scans the QR code natively, and keeps the link and sensors running with the screen off. Opened with
`?ctrl=1`; the page talks to it through `window.MyPCNative` (`native()` in `gamepad.js`). See `android-controller/README.md`.

Files: phone side `js/launcher/apps/gamepad.js` (pointer math `js/core/aim.js`); TV side `js/launcher/controllers.js` (pointer `js/launcher/pointer.js`); protocol checks
`js/core/sensor-proto.js`; motion detection `js/core/motion.js`; relay to games `js/launcher/game-host.js`;
game API `MyPC.sensors` in `sdk/mypc-sdk.js` (API level 8). Tests: `node tests/unit-tests.mjs` (protocol, motion engine
on synthetic recordings) and sections 34 and 35 of `node tests/run-tests.mjs` (real pages, real WebRTC).

## For game makers: `MyPC.sensors`

Call `setup` once the app is initialised (in `onInit` or later). My PC sends it to every phone in a sensor mode at once,
and again to any phone that connects later. When the app closes, phones go back to the default moves.

```js
MyPC.sensors.setup({
    moves: ['LEFT', 'RIGHT', 'JUMP', 'DUCK', 'DUCK_END'],        // only these are sent
    profile: { age: 30, height: 175, weight: 70, phone_position: 'right hand' },   // metric: cm, kg (optional)
    metrics: { hz: 1 },                                          // optional: telemetry once a second (0.2 to 5 Hz)
    raw: { hz: 30 },                                             // for phones in "Motion data" mode (5 to 100 Hz)
    define: { SPIN: { signal: 'rot', above: 300, cooldown_ms: 800 } }   // optional: new moves, see "Defining a move"
});
MyPC.sensors.on('action', function (ev, player) {   // { type: 'action', action: 'JUMP', timestamp, sequence, confidence }
    if (ev.action === 'JUMP') hero(player).jump();
});
MyPC.sensors.on('metrics', function (m, player) {}); // { gait: 'RUN', cadence: 162, speed_kmh: 8.4, pace_sec_per_km: 428, distance_m: 325.6, steps }
MyPC.sensors.on('raw', function (r, player) {});     // { hz, s: [[dt, ax, ay, az, gx, gy, gz, ra, rb, rg], ...] }
MyPC.sensors.on('players', function (modes) {});     // { 1: 'sensor-actions', 2: null } when phones come and go ('pad', 'sensor-actions', 'sensor-raw', 'pointer')
MyPC.sensors.on('config', function (cfg) {});        // what the phones were actually sent (unknown moves removed)
MyPC.sensors.stop();
```

- `profile` is optional. Without it each phone uses its own settings (Live screen > Settings).
- `phone_position` accepts `waist`, `left arm`, `right arm`, `left hand`, `right hand`. Only **right hand** is computed
  today; the others are accepted and use the right-hand calculation until they are implemented.
- Moves the phone cannot detect (not built in, not in `define`) are dropped from the config; check `config`.
- Actions arrive in order and only once (the TV drops duplicates and anything older than 3 seconds).
- Built-in games (same-origin iframe) use `host.sensors.setup(cfg, function (type, player, msg) {})` and `host.sensors.stop()`.
- A phone in Pointer mode is only for the My PC screens: your app never receives pointer messages (its A / B arrive as the
  usual actions).

## Protocol (version 1)

Transport: the WebRTC data channel the phone controller already uses (`js/core/netlink.js`): JSON, ordered and reliable,
4 KB per message and 100 messages a second at most each way, on the local Wi-Fi only. Signalling is the `rooms` document
of app `controller` in Firestore; no sensor data ever goes through Firebase. Every message is validated on arrival
(`SensorProto`); anything malformed is counted and dropped.

### Connection setup

```js
// phone -> TV, once per connection
{ "t": "hi", "p": 1, "cid": "k3j…", "name": "Android",
  "proto": 1, "mode": "sensor-actions", "session": "9f3a1c2e4b5d6e7f",
  "caps": { "motion": true, "orientation": true }, "now": 1791830000000 }
// TV -> phone
{ "t": "ok", "p": 1, "proto": 1, "session": "9f3a1c2e4b5d6e7f" }
// TV -> phone, right after "ok" (sensor modes) and whenever the running game changes its setup
{ "type": "config", "v": 1, "session": "9f3a1c2e4b5d6e7f", "sequence": 3, "timestamp": 1791830000020,
  "moves": ["LEFT", "RIGHT", "JUMP"], "define": { },
  "profile": { "age": 30, "height": 175, "weight": 70, "phone_position": "right hand" },   // or null
  "metrics": { "enabled": true, "hz": 1 }, "raw": { "hz": 30 }, "pointer": false,
  "tune": { "sensitivity": 1, "scales": { "LEFT": 1, "RIGHT": 1, "JUMP": 1.4, "DUCK": 1 }, "run_scale": 1.3, "guard_ms": 500 } }
```

`pointer` is true only for a phone in Pointer mode while the TV shows the My PC screens (never on a game's page).
`tune` is the TV's **Motion moves** settings (below), in every config, defaults when never set.

`now` lets the TV turn phone timestamps into its own clock (`offset = tv_now - now`), so stale actions can be found even
when the two clocks differ. Older phones without `proto` / `mode` are treated as `pad`.

### Events

```js
// phone -> TV: a move, only if it is in config.moves
{ "type": "action", "action": "LEFT", "timestamp": 1791830000000, "sequence": 42, "confidence": 0.82, "gait": "WALK" }   // gait: optional
// TV -> phone: every action is acknowledged (latency, duplicates)
{ "type": "ack", "sequence": 42 }                       // or "duplicate": true / "stale": true
// phone -> TV: telemetry, only when config.metrics.enabled, at config.metrics.hz
{ "type": "metrics", "gait": "RUN", "cadence": 162, "speed_kmh": 8.4, "pace_sec_per_km": 428,
  "distance_m": 325.6, "steps": 214, "timestamp": 1791830001000, "sequence": 43 }
// phone -> TV: sensor-raw mode, batches of 12 samples at most, 20 messages a second at most
{ "type": "raw", "timestamp": 1791830001000, "sequence": 44, "hz": 30,
  "s": [[33, 0.12, -0.40, 0.03, 9.93, -0.40, 0.31, 1.5, -0.4, 0.2]] }
//       dt ms, acceleration x y z (m/s², no gravity; null if the phone has none),
//       with gravity x y z, rotation rate alpha beta gamma (deg/s)
// phone -> TV: pointer mode while config.pointer: 50 messages a second at most, only while moving
{ "t": "pm", "x": -125, "y": 30 }    // turned by x, y hundredths of a degree since the last one (right / down positive, 90 at most)
{ "t": "pc" }                        // Center: the pointer back in the middle
// pad mode (also the pointer's A / B); a: left right up down ok b run cancel menu pause (b = run + cancel)
{ "t": "k", "a": "ok", "d": 1 }
```

Rules:

- **Moves have priority**: an action is sent the moment it is found; metrics go at a low fixed rate and never per sensor
  sample; raw samples are batched.
- **Sequence numbers** count up per connection across actions, metrics and raw batches. The TV keeps the last 64 per
  phone: a repeated number is a duplicate (dropped, acknowledged with `duplicate`), a number far behind is stale.
- **Timestamps** are the phone's `Date.now()`; an action more than 3 s old on the TV clock is stale (dropped).
- Accelerations in m/s², rotation in deg/s, distances in m, speed in km/h, pace in s/km, height in cm, weight in kg.

## How moves are found (sensor-actions)

The player faces the TV with the phone in the right hand, screen towards them (as when playing). From the phone's
sensor fusion: **up** is the gravity vector; **right** is the screen's right edge flattened onto the floor. Signals
(computed for every sample, about 60 a second):

| Signal | Meaning |
|---|---|
| `vertical`, `lateral`, `forward` | acceleration without gravity along up, right, forward (m/s², lightly smoothed) |
| `magnitude` | total acceleration with gravity (m/s²; about 9.8 when still) |
| `freefall` | ms spent with almost no weight (total < 3.5 m/s²): the player is in the air |
| `v_vel`, `l_vel` | vertical and sideways speed (m/s, drift-limited) |
| `v_disp` | vertical displacement (m, drift-limited) |
| `pitch`, `roll` | phone tilt (deg); `rot` rotation speed (deg/s) |

### Built-in moves

| Move | Rule |
|---|---|
| `LEFT` / `RIGHT` | `lateral` below −4 / above +4 m/s² for 30 ms with sideways speed past 0.3 m/s; group `side` (the opposite rebound of the same step is held back); cooldown 450 ms |
| `JUMP` | in free fall for 160 ms (a jump is airborne 250 ms or more; a running stride about 100 ms); fires while still in the air; group `vert`; cooldown 700 ms |
| `DUCK` | body drops 16 cm or more (`v_disp`), confirmed 220 ms later unless the body shoots up (the crouch before a jump is not a duck); group `vert` |
| `DUCK_END` | after `DUCK`, when the player rises again (`v_vel` > 0.45 m/s, at least 350 ms after `DUCK`), or after 2.5 s at the latest |

A hop to the side is airborne too: JUMP is not fired within 600 ms of LEFT / RIGHT, and LEFT / RIGHT are not fired within 450 ms of JUMP nor 250 ms after landing (rule option `unless: { moves, within_ms, landed_ms }`).

While running every threshold is higher (**Harder while running**, 1.3 times by default). **Sensitivity** lowers or raises
all of them: the TV's times the phone's own (Settings on the phone, 0.5 to 2).

**Repeat guard** (500 ms by default): after a move, any other move is held back this long, so a step to the right and the
body swinging back to the left, or a jump and its landing, give one move, not two (`DUCK_END` is never held back). The
phone's Debug screen counts what it held back.

### Motion moves on the TV (Settings > Devices > Phone controller > Motion moves)

Set once on the TV (`arc_dev_ctrltune`, `Controllers.setTune`), sent in every config (`tune`), used by every phone at
once, in My PC and in games. Rows (‹ › on the remote change a value, OK raises it):

| Setting | Range (default) | What |
|---|---|---|
| Sensitivity | 0.5 to 2 (1) | all moves |
| Step left / right limit, Jump limit, Duck limit | 0.5 to 2.5 times (1) | how strong that move must be; higher = harder (`scales`) |
| Harder while running | 1 to 2.5 times (1.3) | every limit while the player runs (`run_scale`) |
| Repeat guard | 0 to 1500 ms (500) | see above (`guard_ms`) |

**Live test**: while the page is open the moves of every Motion moves phone are listed there (player, confidence, the
gait it came in, time) instead of pressing buttons, with a hint when something looks wrong: a JUMP while running (raise
the Jump limit or Harder while running), LEFT and RIGHT close together (raise the Repeat guard or the Step limit).
**Default move settings** resets them. Each player's own training (the phone's Train tab) still applies on top.

### Defining a move

A move is a rule, so new moves need no new code: add a built-in to `MotionEngine.MOVES` in `js/core/motion.js`, or send
one from the game in `define`.

```js
{ signal: 'lateral', below: -4,       // or above: n
  for_ms: 30,                          // the condition must hold this long
  cooldown_ms: 450,                    // no second fire before this
  group: 'side',                       // moves of one group block each other for the cooldown
  gait: ['WALK', 'RUN'],               // optional: only in these gaits
  also: { signal: 'l_vel', below: -0.3 },      // optional second condition at the moment it fires
  defer_ms: 220, cancel_if: { signal: 'v_vel', above: 0.9 },   // optional: wait, cancel if this happens meanwhile
  end: { name: 'DUCK_END', signal: 'v_vel', above: 0.45, for_ms: 60, min_ms: 350, max_ms: 2500 } }   // optional release event
```

Each fired move carries a `confidence` (0.3 to 1: how far past its threshold the signal went).

### Steps, gait and metrics

- A **step** is a peak of `vertical` above an adaptive threshold (45 % of the recent step peaks, at least 1 m/s²), at
  most one every 250 ms.
- **Cadence** = steps per minute from the median of the last intervals (4 s window). **Gait**: `IDLE` (no step for 2 s),
  `WALK`, `RUN` (cadence 140+ with strong steps, or 165+). Each has a confidence.
- **Step length** = height × 0.415 walking; running 0.45 to 0.85 × height, growing with cadence; × the **Stride length**
  setting. Speed = step length × cadence; distance adds one step length per step; pace = 1000 / speed.
  Running in place counts as running: distance is the distance you would have covered.

## Screens on the phone

**Settings** (button on the join screen, top right over the pad, in the top bar of the other modes; kept on the phone in
`arc_dev_ctrlphone.opt`): **Auto rotate** (off: the screen stays on the landscape side it is on when the phone is
flipped), **Stay awake** (the screen stays on while connected), **Background** (the link stays up with the screen off or
the app in the background: foreground service + wake locks) and **GamePad** (a D-pad in place of the stick), plus
**Disconnect** (while connected) and **Forget TV**. Once a phone has connected to a TV it remembers it
(`arc_dev_ctrlphone.paired`) and connects to it by itself whenever the Game controller opens, until Forget TV. The Game
controller opens with **Connect** focused, not the code box (no phone keyboard popping up). The first
three are on by default and done natively by the Android app (`MyPCNative.settings(json)`, app 2.1.0, `version()` 3,
kept by the app in its own preferences and applied from its start). In a browser, Auto rotate uses the Screen
Orientation API (only in full screen) and Stay awake the Wake Lock API; the settings a phone cannot do are not shown.

**Live** (sensor modes): gait (with confidence), pace, speed, cadence, steps, distance, last move (flashes), connection
state with latency, sensor indicators (motion permission, data flowing, gyroscope, linear acceleration),
**Start / Stop controller**, **Recalibrate** (stand still for a second facing the TV: re-reads gravity in your grip and
clears the drift), **Settings** (age, height, weight, phone position, sensitivity, stride length: each with − and +
buttons; swap left and right). The screens scroll with a finger (the virtual pad's page-wide swipe blocking stops at the
Game controller).
In Motion data mode the tiles show the rate, samples sent and the live readings.

**Train**: for LEFT, RIGHT, JUMP and DUCK, **Record 5** asks for the move five times (get ready, Go!, 1.6 s recorded each). `js/core/motion-train.js` measures each repetition and sets the move's limit between this player's weakest repetition (70 % of it at least) and the strongest of the other moves (moves of the same group, LEFT / RIGHT, are not compared: they already block each other); limits stay within 0.4 to 2.5 times the built-in ones. Each move shows its limit and whether it is clear of the others. The result is kept on the phone (`arc_dev_ctrltrain`) and used as rules for the built-in moves; a game's own rule for the same move wins.

**Debug**: live acceleration (with and without gravity) and rotation, the computed signals and a plot of vertical /
sideways acceleration; recent step events; every move's state (idle, defer, active, cooldown), level and last
confidence; diagnostics (moves sent, acknowledged, latency, duplicates held back by cooldowns, rebounds held back by
groups, wrong gait, cancelled false starts, duplicates / stale dropped by the TV, actions with no answer, DUCKs ended by
timeout); an event log with timestamps; **Record / Replay / Clear**. A recording (up to 2 minutes) is kept on the phone
(`arc_dev_ctrlrec`); Replay runs it through a separate engine with the current settings and lists the moves it finds,
without sending anything, so thresholds can be tuned on the same movement again and again.

iPhone: motion sensors need permission; it is asked on the **Connect** tap (or **Start controller**). The page must be
served over https (the hosted copy is).
