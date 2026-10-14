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
| **Buttons** (`pad`) | The virtual pad My PC already draws over games (`js/core/virtual-pad.js`): stick, A, B, pause, and the gear to add C / ☰, resize and move everything (saved on the phone as `vpad:controller`). | The same actions as the TV remote: player 1 = device `keys`, player 2 = `keys2`. |
| **Motion moves** (`sensor-actions`) | The player faces the TV, phone in the right hand. The phone detects moves and sends **only the moves the game asked for**, plus metrics if asked. | `MyPC.sensors` events in the game. With no game listening, moves drive the TV: LEFT / RIGHT = left / right, JUMP = OK, DUCK … DUCK_END = down held. |
| **Motion data** (`sensor-raw`) | Sends the sensor samples themselves at the rate the game asks for. | `raw` events; the game does its own detection. |

**Android app** (`android-controller/`, `My-PC-Controller.apk`): the same Game controller page in a native shell that
feeds it native motion samples (200 Hz fused sensors, 100 Hz samples with their own timestamps) instead of
`devicemotion`, scans the QR code natively, and keeps the link and sensors running with the screen off. Opened with
`?ctrl=1`; the page talks to it through `window.MyPCNative` (`native()` in `gamepad.js`). See `android-controller/README.md`.

Files: phone side `js/launcher/apps/gamepad.js`; TV side `js/launcher/controllers.js`; protocol checks
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
MyPC.sensors.on('players', function (modes) {});     // { 1: 'sensor-actions', 2: null } when phones come and go
MyPC.sensors.on('config', function (cfg) {});        // what the phones were actually sent (unknown moves removed)
MyPC.sensors.stop();
```

- `profile` is optional. Without it each phone uses its own settings (Live screen > Settings).
- `phone_position` accepts `waist`, `left arm`, `right arm`, `left hand`, `right hand`. Only **right hand** is computed
  today; the others are accepted and use the right-hand calculation until they are implemented.
- Moves the phone cannot detect (not built in, not in `define`) are dropped from the config; check `config`.
- Actions arrive in order and only once (the TV drops duplicates and anything older than 3 seconds).
- Built-in games (same-origin iframe) use `host.sensors.setup(cfg, function (type, player, msg) {})` and `host.sensors.stop()`.

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
  "metrics": { "enabled": true, "hz": 1 }, "raw": { "hz": 30 } }
```

`now` lets the TV turn phone timestamps into its own clock (`offset = tv_now - now`), so stale actions can be found even
when the two clocks differ. Older phones without `proto` / `mode` are treated as `pad`.

### Events

```js
// phone -> TV: a move, only if it is in config.moves
{ "type": "action", "action": "LEFT", "timestamp": 1791830000000, "sequence": 42, "confidence": 0.82 }
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
// pad mode (unchanged)
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

While running every threshold is 30 % higher. **Sensitivity** (Settings, 0.5 to 2) lowers or raises all of them.

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

**Live** (sensor modes): gait (with confidence), pace, speed, cadence, steps, distance, last move (flashes), connection
state with latency, sensor indicators (motion permission, data flowing, gyroscope, linear acceleration),
**Start / Stop controller**, **Recalibrate** (stand still for a second facing the TV: re-reads gravity in your grip and
clears the drift), **Settings** (age, height, weight, phone position, sensitivity, stride length, swap left and right).
In Motion data mode the tiles show the rate, samples sent and the live readings.

**Debug**: live acceleration (with and without gravity) and rotation, the computed signals and a plot of vertical /
sideways acceleration; recent step events; every move's state (idle, defer, active, cooldown), level and last
confidence; diagnostics (moves sent, acknowledged, latency, duplicates held back by cooldowns, rebounds held back by
groups, wrong gait, cancelled false starts, duplicates / stale dropped by the TV, actions with no answer, DUCKs ended by
timeout); an event log with timestamps; **Record / Replay / Clear**. A recording (up to 2 minutes) is kept on the phone
(`arc_dev_ctrlrec`); Replay runs it through a separate engine with the current settings and lists the moves it finds,
without sending anything, so thresholds can be tuned on the same movement again and again.

iPhone: motion sensors need permission; it is asked on the **Connect** tap (or **Start controller**). The page must be
served over https (the hosted copy is).
