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
- `index.html` + `js/boot/loader.js`: picks the hosted copy (pc.geekspro.us; packages before 1.6.1 ask imad-os.github.io/g, which redirects there) or the bundled
  one, then loads `app.html` and the JS/CSS listed in `app-manifest.json`. TVs get updates from
  the hosted copy at the next start: **bump `build` in `app-manifest.json`** (and a game's
  `game-manifest.json` `build` when it changes). Don't change `shell` unless `config.xml`/loader
  changes need a new package.
- **Updates:** `js/boot/loader.js` lives in the **package** (a change there reaches TVs only with a
  new .wgt; bump `config.xml` version, **never** bump `shell`: old packages would stop accepting
  online builds). It waits 4 s for the hosted manifest; if the server is slow it runs the last
  hosted build that worked (`boot_good`, saved at ready / by Settings > Update) before falling back
  to the built-in copy. **Package 1.6.1 (2026-11-08, imad: "the TV opens the local files")**: the loader asks
  `https://pc.geekspro.us/` directly (`imad-os.github.io/g` only redirects there: an extra round trip inside the 4 s; a
  `boot_good` saved under the old address still counts), waits 5 s, and a hosted build that failed at start is only set
  aside for 30 min (`boot_bad_build` = `{ b, n, at }`; skipped for good after 3 failures in a row; before 1.6.1 ONE failure,
  even a network hiccup on one of ~90 files, kept that build away until a newer one was published). Why it failed:
  `boot_last_fail`, shown in Control Panel > My PC Update ("What went wrong"). The built-in copy that ran because the
  server did not answer downloads the update in the background (`Updater.background()`, Notify card). Settings > Update's
  Restart clears the bad mark. Tests: `MYPC_ONLY=boot node tests/run-tests.mjs`. `js/launcher/updater.js` + Settings > Update (check, download with progress,
  restart) are hosted code and reach TVs as a normal online update.
- **Two pages:** opening a game or installed app loads `index.html?play=<id>` (no desktop is built
  there); quitting loads `index.html?from=<id>` (fresh desktop). Same packaged index.html/loader.
  **Kept on purpose (owner asked 2026-11-09 "is the reload really best?")**: one page with the game framed over the desktop would
  switch faster but keep the desktop and the session's memory under every game on small TVs, and a same-origin built-in game
  still referenced by the desktop keeps its whole window alive; a page change frees everything for sure. What made switches slow
  is cut instead: the loader reuses the copy picked at start for `?play=` / `?from=` (sessionStorage `boot_pick`, **package 1.6.2**),
  the game list is kept for the session (`arc_games_<source>_<build>`), and back from a game the store list / AI services /
  settings of every My PC are read again only after 30 min (`syncDue` in main.js). The game menu's last item is **Quit** (key `quit`,
  never "Quit to menu": this is a PC). **While My PC's menu (or any screen that `hold()`s) is over an app, the app gets no input**
  (owner rule 2026-11-09): the frame is `inert` and loses the focus, and the SDK (API 15, `freeze`) stops keys before the app's
  listeners, makes `navigator.getGamepads()` empty, pauses its media; an app with no `onPause` also has its rAF held and its
  AudioContexts suspended. Tests: `MYPC_ONLY=flow node tests/run-tests.mjs`.
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
  `players/<uid>` (only that account) as `data.<game id>.<key>` + `settings.<key>` (uploads write only the parts changed on this device, `arc_dev_acct_parts`, with an updateMask `data.\`<id>\`` / `settings.\`<key>\``, never the whole map; the whole doc only when missing or still old; a newer cloud copy at start keeps the parts changed here after it; an old single `blob` string is merged in and removed; a newer cloud copy never deletes local keys it lacks; upload falls back to the old shape on 403 with rules older than build 71), secrets in `arc_dev_acct` (never in the TV backup), newest copy wins (pulled at start, pushed
  after changes). Old local profiles keep working; Settings > Accounts > "Create an account for this profile" turns one into an account.
- **Game controllers first** (owner decision): apps must use every controller button. `Input.onPadRaw` reports every button / axis
  change; `game-host.js` forwards it to installed apps (`gp` messages, only while running) as `MyPC.gamepad` (API 9; standalone the
  SDK polls the pads itself and maps them to actions like `Input`).
- **Clock** (fix 2026-11-07, imad's TV showed 19:15 at 18:15): Chromium's own time zone data is old (TV and PC alike): it still puts
  Africa/Casablanca at GMT+1, but Morocco is plain UTC since 2026-09-20. `js/core/clock.js` (FIRST in app-manifest.json js) moves Date's local
  getters / setters / local constructor / toLocale*String (never getTime / Date.now) to the right offset: Control Panel > Time & language > Time zone
  set by hand (`arc_dev_clock_adj`, UTC offset minutes) > the TV's own clock (`tizen.time.getCurrentDateTime()`) > known changes (`RULES`, per date).
  Nothing patched when the engine is right. Tests: `MYPC_ONLY=clock node tests/run-tests.mjs`. Tests that pin a Moroccan local time after
  2026-09-20 use `Z`, not `+01:00`. Intl.DateTimeFormat objects are not corrected.
- `js/core/`: storage (per-profile keys `arc_<profile>_*`, TV-wide `arc_dev_*`), i18n (en, fr,
  es, ar + RTL), input, focus, perf, scores, `cloud.js` (Firestore REST: store catalog, installed list
  `arc_dev_installed`, counters), `backup.js` (Device id, backup/restore), `world.js` (world records).
- `games/`: built-in games on `games/shared/gamekit.js`. Super Jumper stages come from
  `tools/gen-levels.mjs`; after any change to chunks, the generator or the hero's physics
  (`Actors.TUNE` in `games/jumper/js/actors.js`) run `node tools/play-levels.mjs`: it plays every stage
  with a handicapped hero and must finish all of them with no traps.
- **Focus memory**: `Desktop.hide()` saves the focused desktop item (profile key `last_focus`; a launcher button's own click wins); `Desktop.show()` focuses it again when an app closes or the game page reloads the desktop. A Start tile falls back to the item's desktop icon, then its taskbar button, then Start; a game started inside an app falls back to the game's icon, then that app's taskbar button.
- **Home screen shortcuts**: hold OK (600 ms), long-press or right-click a desktop icon or Start tile -> menu Open / Remove from
  (or Add to) home screen / Uninstall (installed apps, admins only: `Profiles.isAdmin()`). Short OK on a shortcut opens it on release
  (`main.js` passes the OK release to `Desktop.action`). Removed ids per profile in `home_hidden` (`Desktop.onHome` / `setOnHome`);
  too many icons scroll sideways in `#desk-icons`.
- **Memo** (`apps/memo.js`, voice memos): list screen, then a memo screen; each recording is up to 15 s (`Mic`, Opus WebM or 16 kHz WAV;
  owner decision 2026-10-31: Samsung keeps the remote's mic for Bixby, so the TV's microphone is a phone in the Game controller's
  **Buttons mode** (owner request 2026-11-04: the separate Microphone mode was removed; old `mic` = `pad`): the VirtualPad + a mic button (VirtualPad option `mic`, also offered in the shell's
  touch pad: the same pad, never a separate design) = the Record key; while one is connected `Mic` records from it (`Mic.source`,
  set by `controllers.js`; messages `mic` / `ms` / `au` / `me`, 16 kHz PCM). The APK needs 2.3.0+ (RECORD_AUDIO + WebView permission))
  and the record key on a memo's screen adds a part to it. Record key = Input action `record` (remote Record key, or a voice / mic
  key when `getSupportedKeys()` lists one; Samsung keeps the Smart Remote's mic button for Bixby) + red button / R (`runToggle`) + X / Y.
  Memos are per profile in IndexedDB through `js/core/memo-store.js` (`MemoStore.use(adapter)` swaps in a cloud store later; not in
  the TV backup yet). Mic needs the `mediacapture` privilege (package 1.5.0+, already in `config.xml`).
- **Notifications** (owner request 2026-11-04): ONE look for every notice, `js/launcher/notify.js` (`Notify.show({ text, title, kind:
  'ok' | 'err' | 'warn' | 'info', image, id, timeout, onClick })`, `hide(id)`, `clear()`; `App.toast(text, opts)` wraps it). Windows style
  cards in `#toast` (bottom right, newest at the bottom, max 3): rise in, slide down on timeout; green = connected, red = disconnected /
  failed (role alert). Same `id` updates a card in place (`net`, `pad`, `ctrl1` / `ctrl2`). Reuse it for push notifications; never add another popup.
  Sound: `AudioPrefs.notify()` on each new card (not `silent: true`, once per 400 ms), the profile's choice in Control Panel > Sound (`notif_sound`:
  crystal (default) / glass / bubble / marimba / off; `sounds/notify-*.wav`, synthesized for My PC, one `<audio>`, no AudioContext).
- **Push notifications** (owner request 2026-11-04, plan doc https://claude.ai/artifact/SQK1PHrBMrFvkzJkHJcwT3): apps list `services`
  in `mypc-app.json` (`[{ id, file, every: 1|5|10|30, title }]`, parsed by `installer/services-lib.js`, max 3); App Store Manager >
  **Services** (`installer/services.js`) runs them ONLY while a Manager tab is open (lease `services/_runner`), each file in a `data:`
  Worker (opaque origin: never a blob: or same-origin worker, it could read the admin's sign-in), 20 s max; the admin approves the
  file's SHA-256 (a changed file pauses until approved again); rows `{ username | '*', title, message, image, link }` -> checked
  (opted-in users only, 100 per run, 20 per user per hour) -> Firestore `inbox/<username>/items/<id>` (TTL `exp` 30 d). Opt-in
  `subs/<app>/users/<username>` written with the player's token (rules match `request.auth.token.email`). Built in: "App updates" on a
  new `version`. TV: `js/launcher/push.js` (player accounts only; reads its inbox every 30 min, or every 2 min for the usernames in
  App Store Manager > Settings > Fast push notifications (`settings/mypc.notifyFast`, owner decision 2026-11-04: Firestore free quota); its "Send a test notification" form writes one item to any username, app `mypc`),
  at start / resume only once due (`notif_last`), toasts via `Notify`, history of the last 7 days (owner request 2026-11-04; on the device only, max 300) in
  `notifs`, Control Panel > Notifications, permission once per app, `MyPC.notify` / `MyPC.launch`, API 12). Deep links (owner request 2026-11-04): `link` = `<app id>:<path>` opens
  that app with `MyPC.launch.path` (`Push.parseLink`; already open: `GameHost.deepLink` -> SDK `onLaunch`), `https://` = Browser, old `app?...` = own app). Docs: GUIDE.md section 16.
- **Desktop widgets** (owner request 2026-11-04): `js/launcher/widgets.js` draws cards in `#desk-widgets` (right of the icons; a
  row above the taskbar on a tall phone): built in Weather (Open-Meteo + GeoJS, no key; keep the `wgPrivacy` line true), Playtime
  (`js/core/playtime.js`, counted on the game page once a minute; OK opens the **Playtime app** `apps/playtime.js`: today / week / daily average /
  streak cards, 7 or 30 day CSS bars, games with sessions + longest + last played (OK plays), Clear; per profile key `playtime`, 120 days kept), System Monitor (Tizen systeminfo CPU / memory, else JS heap), Music
  Player (the real Music app, below). Per profile
  (`widgets` key; owner decision 2026-11-05: only Weather is shown by default, every other widget incl. app ones is off until turned on): show, refresh rate, "Run in the background", own settings, order; Control Panel > Widgets (list, then a page per
  widget). **Owner rule: every refresh stops while an app or game is open (Desktop.hide, the game page, document.hidden) except widgets
  with background on (Music by default).** App widgets: `"widgets"` in `mypc-app.json` (`js/core/widget-lib.js`, max 3), approved in App
  Store Manager > Widgets (`installer/widgets.js`; code copied to Firestore `widgets/<app>__<widget>`, SHA-256 in `apps/<id>.widgets[i].sha`);
  the TV runs only that copy in a `data:` Worker, one at a time, 10 s max, and draws the returned VIEW itself (no app HTML). Docs: GUIDE.md section 18.
- **Weather app** (owner request 2026-11-05, `apps/weather.js` + `css/weather.css` + `js/core/i18n-weather.js`): now, next 24 h (every 3 h),
  7 days (wind + gusts + direction, precipitation + chance, humidity, pressure, UV, sunrise / sunset). Data in `js/core/weather.js`, shared with
  the Weather widget: ONE Open-Meteo request for both, kept 10 min in `arc_dev_wxfc`; same place / units setting (`Widgets.setSetting('weather', ...)`).
  The widget's OK opens the app. Light: DOM built once, one 15 min timer while open, no animation; looks follow the theme (cards in css/weather.css).
  Owner request 2026-11-05 (2): the widget shows the temperature big on the left and a big sky picture beside it (sizes in its settings
  `tsize` / `isize`); warnings (`Weather.alerts`): rain / snow within the chosen hours (`warn`: off / 1 / 2 / 4 / 6 / 8 / 24, default 6) and a
  thunderstorm within 24 h (danger, red), on the widget, beside the app's temperature, and once each as a notification (profile key `wx_told`).
  Animated sky pictures (`Weather.art`, CSS `.wa-*` in css/weather.css: transform / opacity only, stop with the hidden desktop; widget setting `anim`).
- **Live backgrounds** (owner request 2026-11-05; merged 2026-11-09, `js/launcher/dynwall.js` + art `js/launcher/dynwall-art.js` + strings `js/core/i18n-dynwall.js`):
  two ids. **`dyn_horizon` "Horizon"** (owner request 2026-11-09: Live weather + Holidays and events merged into one; old ids `dyn_weather` /
  `dyn_events` map to it, `DynWall.OLD`): a holiday / big football night today (or a holiday tomorrow after 18:00) shows that day, else the sky
  from `Weather` data (shared cache: day / dawn / dusk / night, season, temperature), else (profile `dynwall.weather` off) the season (summer =
  beach). Its options in Control Panel > Personalization: Show the weather, Weather place and units (opens Widgets > Weather), Moving rain and
  snow (`dynwall.motion`, one 512 px tile slid by CSS transform, off by default), Raindrops on the glass (`dynwall.glass` off / low / medium (default) / high,
  owner request 2026-11-09: lens drops showing the scene flipped, mist, trails, soft scene behind; drawn once with the picture, `DynArt` `glass`), Holidays of, Football nights, the football rules written out
  (`dwFootballRules`), Show the event's name (`dynwall.caption`). `dyn_astro` = Earth globe with the real day / night line, city lights, Moon
  phase (NASA public-domain photos `wallpapers/*.jpg`, read only while drawing). Drawn ONCE on a canvas (stage size x 1 / 0.75 / 0.5 by Perf tier)
  when what it shows changes (checked every 10 min, 30 on an event day); no timer while an app / game is open (Desktop.hide), on the game page or
  in the background. While it asks for data the taskbar shows a turning icon next to the clock (`#tray-wp`, at least 1 s). The last picture
  is kept on the device (`arc_dev_dwlast`: id, profile, state key, caption, JPEG; not in the backup; owner request 2026-11-09: it opened on a default
  sunny sky) and shown at once at the next start under the empty canvas; its state key is taken over, so nothing is drawn again until the state changes. **Football rules
  (owner rule 2026-11-09)**: UEFA Champions League semi-finals and final only (`uclsemi` / `uclfinal`), World Cup / AFCON / qualifiers /
  friendlies only Morocco's matches (`morocco`), CAF Champions League only Moroccan clubs (`cafcl`, `MA_CLUBS` in events.js); big events from
  the site / Manager count only with those ids (admin events always). Change both `fromEspn` and `dwFootballRules` together, bump `FB_V`.
  **Events** (`js/core/events.js`, shared with the Calendar below): Google's public holiday calendar `en.<cc>#holiday@group.v.calendar.google.com`
  (Calendar API with `Cloud.key` if the owner turned it on, else its .ics, else built-in Moroccan days + Islamic days via Intl `islamic-umalqura`),
  football from ESPN's public scoreboard; cache `arc_dev_events` (holidays 2 days, football 6 h); per profile `events` { country, football }.
  Tests: `MYPC_ONLY=wall node tests/run-tests.mjs` (`MYPC_SHOTS=<folder>` for screenshots). Keep `evPrivacy` true.
- **Calendar** (owner request 2026-11-05: Moroccan calendar, widget + app, reliable free source): one data module with the live backgrounds,
  `js/core/events.js` (`Events.day(ymd, withMine)` / `range` / `list(ymd)` for the app / `next`; own events only with `withMine`, so the wallpaper
  never shows them). Morocco's holidays: `data/events-ma.json` on the site FIRST (works on the web / phone, Google's .ics has no CORS), refreshed
  weekly by the GitHub Action `.github/workflows/events.yml` (`tools/fetch-events.mjs`, Google's public "Holidays in Morocco" .ics, no key); when
  it has no Google data the TV asks Google itself (API, then .ics), then built-in rules (`est` = expected date). Big events (`kind: 'event'`):
  the same file's `events` from `data/big-events.json` (Champions League nights, AFCON 2027...) + App Store Manager > Settings > Events
  (`settings/mypc.events`, one line each `2027-06-19..2027-07-17 21:00 AFCON #afcon`; rules changed: republish); a big event ESPN already has that
  day is skipped. Hijri "as in Morocco" (`Events.hijri` / `hijriText`) = Umm al-Qura (Intl) moved per Hijri month by the lag of the nearest
  official Moroccan Eid / new year / Mawlid (Google's dates + `KNOWN`; 2025 = +1 day, 2026 = 0) minus the profile's `cal_hijri_adj`; the built-in
  Islamic holidays use it too. Own events per profile `cal_events` (`Events.add / update / remove / mine / onChange`; old `cal_notes` migrated),
  reminders `js/launcher/cal-remind.js` (one timer, Notify, also on the game page, `cal_fired`). Widget `calendar` (off by default) tells
  tomorrow's holiday once (`cal_told`). Strings `js/core/i18n-calendar.js` (+ `calPrivacy`, keep it and `evPrivacy` true).
  Tests: `node tests/unit-tests.mjs` (section 9), `MYPC_ONLY=calendar node tests/run-tests.mjs` (fixture `tests/calendar-fixtures.mjs`).
- **Online radio in MyMusic** (owner request 2026-11-06; the Music app is now called **MyMusic**, app id still `music`): `js/core/radio.js`
  (`Radio`) = Radio Browser's public JSON API (de1 / fi1 / de2 mirrors, no key; `stations/search?countrycode=..&hidebroken=true`, Morocco
  default, max 1000 by clicks; `countries`; `url/<uuid>` click on play), list cached on the device `arc_dev_radio_<cc>` (shown at once, asked again
  after 24 h; 3 countries kept), stream tests `arc_dev_radio_tests` (no-cors fetch, 7 s, kept 3 days; 'no' = this device cannot: HLS without
  a player for it, WMA in a browser; on an https page http streams are tried as https), stations that fail to play are marked bad.
  Per profile (backed up): `radio_favs`, `radio_recent` (12), `radio_custom` (own URLs, .pls / .m3u resolved), `radio_prefs` { cc, lang, tag, showBad }.
  A station is a Music track `s: 'radio'` (MusicSrc source 'radio', `u` stream, `i` logo...) played by the normal player (AVPlay first on
  the TV: MP3 / AAC / OGG / HLS); `Music` treats it as live (`state().live`, no length / seek, a dropped stream reopens 3 times a minute,
  a failing station is not skipped). UI in `apps/music.js` (nav Radio, view `radio` / `countries`; filters = buttons: OK shows the next choice, hold OK / + lists them all, the arrows only move the focus (owner request 2026-11-07);
  search via Keyboard; hold OK / + menu: favorite, test, edit / delete own). Strings `js/core/i18n-radio.js` (keep `raPrivacy` true).
  The visualizer stays flat on radio (no file to read; cross-origin live sound cannot be captured): never fake it.
  Proof: `node tests/radio-proof.mjs <dir with groove.mp3> live|file` (Radio Browser answered locally, fake live stations, screenshots).
- **Music app** (owner request 2026-11-05, Win app `music`): `js/core/music-src.js` (sources: `usb` = Tizen filesystem drives under
  `/opt/media`, needs package **1.6.0** privileges filesystem.read / write + externalstorage; `gd` = Google Drive through My PC's own sign-in
  (`GDrive`, see "Google Drive" below; scope drive.file); Google refuses a token in the address, so a Drive song plays: on the web / phone app through `sw.js` (`__music/gd/<id>?t=`, adds the header, passes Range: every format, seeking); else MP3 / AAC / WebM read in Range pieces into a Media Source (`msStream`); else a download that plays from its first 512 KB, moves to a bigger copy whenever the one playing has 4 s left (`refresh`, `growDl` `stop.snap`) and to the whole file when done (`HTML.swap`, same place; before build 120 it stopped ~4 s in and waited for the whole file); an M4A with its index at the end gets it read first and put at the front, `faststart`). Proof in a real browser with real songs on a slow line + screenshots: `tests/drive-stream-proof.mjs` (needs ffmpeg-made songs and a local cert, see its header); `gdStatus` codes noconfig / nouser / reauth each have their own message (nouser / reauth: a Sign in with Google button right in Music); `loc` = PC folders via
  showDirectoryPicker), `js/core/music-tags.js` (ID3 / FLAC / Ogg / MP4 / WAV tags + covers), `js/core/music.js` (queue, engines: Samsung
  **AVPlay** first, then HTML audio, then a blob download; per profile `music`, `music_lists`, `music_recent`, `music_prefs`; position in
  `arc_dev_music_pos`, not backed up; with `prefs.resume` it plays on across page changes; in a browser (not the TV) `prefs.bg` = Settings > Play in the background keeps a hidden tab playing (owner request 2026-11-06): the game page runs `Music.init({ resume, lite })`, player only, so music goes on under a game and its menu can pause it), UI `js/launcher/apps/music.js` (hold OK / + = item menu
  via `Win.release`), **audio visualizer** (was "screensaver", owner request 2026-11-06; strings `muSaver*`) `js/launcher/music-saver.js` (styles in CH order: Bars, Waveform `scope` (the real waveform, `MusicViz.wave`), Waves, Particles (max 140, pre-drawn glow sprites), Pulsating rings `pulse`, Ring (640x360 around a round cover), Cover (CSS); **every style at 60 fps** (owner rule: proof `THROTTLE=6 node tests/viz-fps-proof.mjs <dir> file|live`: fps / worst gap / gaps over 20 ms per style + screenshots); never shadowBlur, a gradient per frame or copying a canvas into another (glows = sprites or a 1/4-size canvas UNDER the picture, stretched by the GPU); motion scaled by the frame time; CH + / CH − (`pageUp` / `pageDown`, passed by the router) change the style in place and keep it (`saver`, or `vizStyle` when the automatic one is Off); song top left, time top right; owner rule 2026-11-05: it moves with the song's REAL sound, never a made-up beat, and must never make the music stutter; the sound comes from `js/core/music-viz.js` (`MusicViz.read(db)` / start / stop; the saver only draws): in a browser a live `captureStream` copy (follows track changes; silent 1.5 s while playing = drop to the file); **on a Samsung TV never live** (its chip decodes the sound, the copy is silent: imad's TV, build 120) but small pieces of the song FILE just ahead of the position (2 s first, then 6 s, 10 s ahead; MP3 frames + Xing TOC, WAV raw, FLAC header + frame (exact sample from the frame header), M4A AAC frames from the moov index wrapped as ADTS; Ogg / others: USB read in 1 MB pieces + decoded once, Drive waits for the player's whole copy, never a second download), FFT 1024 Blackman at 30 frames/s in 5 ms slices; proofs `tests/saver-proof.mjs <dir> file|live <song>` (THROTTLE=6, every format, timings, long tasks, KB read) and `TVLIKE=1 SAVER=0 tests/drive-stream-proof.mjs` (Drive on the TV); `MusicSaver.input` in the router),
  strings `js/core/i18n-music.js`, look `css/music.css` (per theme). Remote media keys = Input actions `mediaNext` / `mediaPrev` / `mediaFf` /
  `mediaRew` / `mediaStop` (+ `pause`), handled in `main.js mediaKey`, never sent to games. Keyboard mode `title` keeps capitals and spaces.
  Tests: `MYPC_ONLY=music node tests/run-tests.mjs` (fixtures `tests/music-fixtures.mjs`), `MYPC_SHOTS=<folder>` saves screenshots.
- **Remote shortcuts** (owner request 2026-11-05, `js/launcher/shortcuts.js` + `js/core/i18n-shortcuts.js`): per profile (`shortcuts` key,
  `[{ key, act, arg, name }]`, one per button) a remote button runs an action: music play/pause / next / previous, switch user
  (`ProfilesUI.open`), open an app or game, open a Control Panel page, Start, desktop, My PC's menu. **Defaults are only Play / Pause = music
  and Guide = switch user.** `Input.setKeyHook` runs it before the key map (the button loses its built-in use for that profile; F6 stays the
  keyboard's Guide); only the buttons in use are registered on the TV. Memo / Music keep their own Play / Pause and Record. In a game: music
  and My PC's menu at once; "open" actions ask, then quit the game and the desktop runs it (`sc_next`). Control Panel > **Shortcuts**: list, Add,
  then Button (owner request: OK listens 5 s for the next button of ANY device: remote / keyboard key = `k<code>` (every TV key registered meanwhile), controller button = `p<index>` via `Input.setPadHook` (taken buttons give no action / raw report); only arrows / D-pad, OK / Enter / Space / B, Back / Esc / Backspace / A, Tab and modifiers are kept; Back cancels; "Choose the button from a list" stays for keyboards) / Action / App or page lists, Save, Remove, Back to defaults. The game menu (`game-host.js renderPause`)
  has **Play music / Pause music** (`Music.toggle`, stays open).
- `apps/store.js`: the App Store app (Home / Games / Apps / Library / Search, Install / Open / Uninstall).
- **Settings of every My PC** (owner decision): App Store Manager > Settings writes Firestore `settings/mypc` (admins only, read by
  every TV): backgrounds (`wallpapers: [{ url, title, thumb }]`, an empty title is taken from the address) and the background of new
  profiles (`wallpaper`). `js/core/global-settings.js` copies it at start into `arc_dev_global` (not in the backup); `Desktop.wallpapers()`
  = the built-in CSS ones + these pictures (a picture shows once loaded, Bloom if it fails). New global settings go in the same document
  (update `validMyPc` in the rules). Manager pages: a nav link `data-page` + a `<section data-view>` of the same name; it works on phones.
- **Background pause** (owner decision): My PC losing the focus (TV other app/source, PC window blurred or minimized, phone app
  switched; `main.js` visibilitychange + window blur checked with `document.hasFocus()`) calls `GameHost.background()`: the game
  pauses under My PC's menu. Config `"allow_background_running": true` (store app config or game-manifest.json): nothing happens
  (no menu, owner decision); the menu's tag shows Background on (green) / off (grey). The menu plays `AudioPrefs.chime()` (`sounds/menu.wav`, Kenney CC0, see `sounds/LICENSE.txt`; one `<audio>` at a quarter of the effects volume, no AudioContext) every time it opens.
- **App config:** each store app has a `config` object (Firestore `apps/<id>`, edited with the
  App Store Manager's Config button). The TV re-reads the app's document before it opens
  (`Cloud.fetchApp`, 2.5 s, falls back to the saved list) and the app gets it as `MyPC.app_config`.
- **Multiplayer (`MyPC.multiplayer`)**: `host()` / `join()` in the SDK; **the shell owns the flow**: its own screens (open a room, join
  list, waiting, accept dialog) in `js/launcher/multiplayer.js` (markup `#mp` in `app.html`), signalling in `js/core/rooms.js`
  (Firestore `rooms/{room}` + `reqs`, rules / index / TTL in `firebase/SETUP.md` section 4), the WebRTC data channel in
  `js/core/netlink.js` (its code is also inside `sdk/mypc-sdk.js` for standalone mode; a test keeps both identical). Apps only get
  peers; never room ids, offers or Firebase. **Firestore cost** (owner complaint 2026-11-04): a host polls its requests every 2 s only for a minute after open /
  a request / a player leaving / `wake` (pairing screen), then backs off to `idle` (5 s multiplayer, 10 s phone controller room), and not at all
  while full or `document.hidden`; never add a fixed fast `setInterval` on Firestore. The taskbar light next to the clock (`#tray-poll`, `Rooms.status()` / `onStatus`) shows it: green = every 2 s, orange = slowed, grey = stopped / no room; its title (hover, OK = toast) says the room and why. `game-host.js` relays peers over postMessage (`mp`).
- **Touch controls**: on phones / tablets the shell draws the virtual pad (`js/launcher/touchpad.js`, library `js/core/virtual-pad.js`)
  above every app, feeding `Input.touch` (device `'touch'`). Per-app config: `touch` in `mypc-app.json` / the Firestore `apps` doc,
  `MyPC.init({ pad })`, `MyPC.pad` in the SDK. The library's one source is `sdk/pad/virtual-pad.js` (from github.com/imad-os/g_rpg `pad/`,
  one My PC change: `onSettings`); run `node tools/sync-pad.mjs` after editing it (copies in `js/core/` and inside `sdk/mypc-sdk.js`).
- **Screen rotation / portrait** (owner request 2026-11-01): phones choose in Control Panel > Display (page only on phones; same setting in
  the Game controller's Settings): Landscape (default, held, no sensor), Portrait (held), Auto (sensor, both ways) or Manual (Rotate button in
  the tray, the game menu and Display). `js/core/rotation.js` (`arc_dev_ctrlphone.opt.orient` / `side`; replaced Auto rotate); native in the APK
  2.4.0+ (`MyPCNative` 5, `settings({ orient })`). Upright, `main.js fit()` lays the stage out 1080 wide x as tall as the phone (`html.tall`,
  CSS `--sw` / `--sh`, `App.screenSize()`): use those vars, never a fixed 1920 / 1080 for a full-screen box; `.tall` rules at the end of
  launcher.css fix what does not fit 1080 wide. Built-in games and apps with config `"orientation": "landscape"` stay 1920x1080 scaled across
  the width (`.game-frame-box.wide`); other installed apps get the tall screen. The Game controller holds landscape while open.
- **Installable web app**: `manifest.webmanifest` (fullscreen, landscape), `sw.js` (network first), `js/core/pwa.js` registers it and keeps phones in landscape
  (orientation lock after the first touch where Chrome allows it, else a "turn your phone" cover). Web only, never on the TV.
- **Phone controller** (a phone as player 1 / 2, shows no game): the phone side is the system app **Game controller** (`js/launcher/apps/gamepad.js`, phones only, hidden on the TV); the TV side is `js/launcher/controllers.js`
  (Settings > Devices > Phone controller). Signalling = a `rooms` doc with app `controller` and a fixed code kept in `arc_dev_ctrl`, link = NetLink;
  P1 = Input device `keys`, P2 = `keys2` (`Input.remote`). The phone reconnects by itself when the TV changes page.
  **Owner rule: the Buttons pad and the shell's touch pad over games are ONE pad** (`js/core/pad-spec.js`: same buttons, sizes, Home / +, Stick / D-pad, one saved layout
  `vpad:controller2`; the GamePad setting = the pad panel's D-pad choice). Any pad change applies to both; only an app's own `touch.buttons` gets a different pad.
  Pairing is a QR code (own page Settings > Devices > Phone controller, `js/core/qr.js`, link `?pair=<code>` opens the Game controller and connects).
  **Owner decision: its Buttons mode reuses the existing virtual pad (`VirtualPad`, id `controller`), never a separately drawn pad;**
  **A B X Y in the Nintendo places** (pad button option `place`) ****the phone IS a virtual standard gamepad on the TV (`Input.virtualPad`, message `gp`: raw button bits + stick axes, device `pad10<player>`), never high-level actions** (owner rule, games must see exactly a real pad; Input.PAD_BUTTONS reads by position): A right = `b` (run + cancel), B bottom = `ok` (jump + confirm), X top and Y left = run, the + button = `menu` (Start), Home (pad option `home`) = `guide`**; same mapping in the shell's touch pad and the SDK's `MyPC.pad`.
  **Keyboard mode** (`keyboard`): a keyboard plugged into the phone is a whole Switch Pro style controller; keys mapped per control on the phone
  (`arc_dev_ctrlphone.keys`, ZQSD = D-pad by default), sends the same `gp` message (18 buttons, Capture = 17, `rx` / `ry` right stick), never keys;
  the screen draws the controller and lights the pressed control. The Buttons pad shows L and R by default (shoulder pills, VirtualPad `place: 'l' | 'r' | 'zl' | 'zr'`); its gear adds ZL ZR − Capture L3 R3.
  **Text mode** (`text`, owner request 2026-11-04): the phone's own keyboard types into the field the TV uses now (`js/launcher/textin.js`:
  on-screen `Keyboard` first, then a focused My PC field, then the running app's focused field via the SDK `field` / `text` messages, `MyPC.text`, API 13);
  Live (default) or Send; no key mapping while typing (Backspace never = Back). Web pages in the Browser are cross-origin: only its address bar.
  **Buttons mode layout** (owner request 2026-11-04): nothing over the pad but the status (bottom centre, green / red dot); Mode,
  **Advanced settings** (the phone settings) and Leave are at the top of the pad's gear panel (top-left round button; VirtualPad option `actions`).
  **Phone settings** (Game controller > Settings, `arc_dev_ctrlphone.opt`): Auto rotate (owner decision: off by default, the screen never turns
  even when the phone is flipped; whole app, also in Control Panel > Devices on a phone), Vibration 0-3 (`vib`, buzz per press, also the shell's touch pad;
  both in `js/core/haptics.js`, which re-applies Auto rotate at every start, so no APK rebuild was needed), Stay awake, Background (native in the APK 2.1.0+ via
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
- **Google Drive (API 14, owner request 2026-11-05)**: ONE sign-in per profile in Control Panel > Google Drive, used by Music and by
  every app through `MyPC.drive` (apps and games MUST NOT ship Drive / OAuth code of their own; they never get a token). `js/core/gdrive.js`
  (`GDrive`: device flow, tokens in memory, accounts per profile in key `gdrive` = backed up + synced with the player account like every
  profile key; accounts linked in MyDrive (`game_app-mydrive_data`) are taken over once; Drive v3 list / get / mkdir / rename / move / copy /
  star / trash / remove / read (Range) / download / resumable upload (4 MB) / export / thumb / about / appFolder "My PC/<app>"), Google
  client = Firestore `settings/google` (App Store Manager > **Google Drive**, rules `validGoogle`; copied into `arc_dev_google`, re-read
  at most every 12 h or when none is known) else MyDrive's `apps/mydrive.config.google`. **Whole Drive** (owner request 2026-11-05): Google's device flow only allows
  `drive.file`, so when the Manager has the web client's secret (`webClientSecret`, client = `pickerClientId`) sign-in is a QR for
  `drive-signin.html` (phone, Google's page, full `drive` scope, PKCE) -> one-time code in Firestore `gauth/<32 char id>` -> the TV trades
  and deletes it (polls every 3 s only while the screen is open, 10 min max); accounts remember their client (`cid`); a drive.file account
  shows "My PC only sees some of your files" (`limited`); Music adds "Shared with me". Screens `js/launcher/drive-ui.js` (`DriveUI.signIn`
  QR + code over anything, the app paused; `DriveUI.addFiles` QR for `drive-picker.html` = Google Picker on the phone, needs the Picker key
  referrer `https://pc.geekspro.us/*`); router hook in `main.js`. Bridge `drive` in `bridges.js` (asks "<app> wants to use your Google
  Drive" once per app per profile, key `drive_apps`; `signIn()` from the app counts as yes). SDK `MyPC.drive` (+ `sdk/drive-sw.js`: the
  app's own `sw.js` imports it so `<audio>/<video>` stream by Range; else a blob download); standalone the SDK runs `gdrive.js` in the
  page. Strings `js/core/i18n-drive.js`. Docs: GUIDE.md section 19. Tests: `MYPC_ONLY=drive node tests/run-tests.mjs` (fake Google `fakeGoogle`).
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
