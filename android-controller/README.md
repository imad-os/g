# My PC for Android (android-controller/)

> **Owner rule (never change it):** the APK is **always the whole My PC app** (it opens the My PC desktop, like on the TV;
> the Game controller is one app on that desktop). It is **never** a controller-only app, whatever its package name
> (`...mypc.controller`, kept so updates install over old phones) or the old file name `My-PC-Controller.apk` suggest.
> **Every APK rebuild** goes through `build.ps1`, which also bumps `build` in `app-manifest.json`: the desktop's
> **Get the app / Update the app** link carries that build, so it always downloads the APK just built. Commit
> `My-PC.apk`, `My-PC-Controller.apk` and `app-manifest.json` together.

My PC as an installable Android app (`My PC`, package `us.geekspro.mypc.controller`, kept so updates install over the old
controller app): the whole hosted My PC (desktop, games, apps, App Store) opens like any app. On phones the desktop has a
**Game controller** shortcut (buttons, motion moves, motion data, pointer), paired with the QR code the TV shows in Settings >
Devices > Phone controller. The taskbar and desktop icons are drawn bigger on phones (`html.compact`, `js/launcher/main.js` fit()).
Protocol and modes: [docs/phone-controller.md](../docs/phone-controller.md).

**Install:** download [`My-PC.apk`](My-PC.apk) on the phone (it is also served by the hosted
copy at `https://pc.geekspro.us/android-controller/My-PC.apk`; `My-PC-Controller.apk` is the same file under its old name), open it, and allow "Install unknown apps" for
the browser or file manager when Android asks. Android 8.0 or newer. My PC (every device, browser or app) has a
**Get the app** desktop icon that downloads this file (`apkButton()` in `js/launcher/desktop.js`). Inside the app the same icon is **Update the app**: it opens the
phone's browser on an http:// link, which downloads the latest APK.

## How it is built

A small native shell (Java, no Kotlin, ~260 KB) around the hosted My PC (`https://pc.geekspro.us/index.html`), so pairing, the WebRTC link, the virtual pad and the motion engine are the
same code the TV side is tested with, and they update with a normal online build (no new APK). The app adds what a
browser tab does badly:

| | Browser tab | App |
|---|---|---|
| Motion samples | `devicemotion`, about 60 Hz, stamped when JavaScript gets them, paused when the page is busy | `SensorHub`: accelerometer, fused linear acceleration and gyroscope at 200 Hz on their own thread, one combined sample every 10 ms with the sensor's own timestamp, mapped onto the page clock (`assets/bridge.js`) |
| QR pairing | `BarcodeDetector` where Chrome has it | native scanner (zxing) on every phone |
| Screen off | link and sensors stop | foreground service + partial wake lock keep both running while connected (Background on) |
| Screen | wake lock when the browser allows it | kept on while connected or in a game, full screen, landscape |
| Phone settings | Auto rotate and Stay awake where the browser allows | Auto rotate, Stay awake, Background (the Game controller's Settings, `MyPCNative.settings`, kept in the app's preferences) |
| Back / exit | browser history | the phone's Back is the TV remote's Back (`Input.systemBack`); exit closes the app (`MyPCNative.exit`) |

Files: `MainActivity.java` (WebView, navigation limited to My PC, Back, QR), `Bridge.java` (`window.MyPCNative`),
`SensorHub.java`, `LinkService.java`, `assets/bridge.js` (runs before the page: `devicemotion` listeners get the native
samples, native sensors run only while someone listens). Page side: `native()` in `js/launcher/apps/gamepad.js`,
`?ctrl=1` in `js/launcher/main.js`. Tests: section 4 of `tests/unit-tests.mjs` (bridge), section 35 of
`tests/run-tests.mjs` (the page with a fake `MyPCNative`); the motion engine tests run at 60 and 100 Hz.

## Build

```
powershell -ExecutionPolicy Bypass -File android-controller\build.ps1
```

Needs JDK 17 and the Android SDK (platform 35, build-tools 35), looked for in `%USERPROFILE%\.tooling\jdk17` and
`%USERPROFILE%\.tooling\android-sdk` unless `JAVA_HOME` / `ANDROID_HOME` are set. Writes `My-PC.apk` (and the old name `My-PC-Controller.apk`) here and bumps `build` in `app-manifest.json`, so the desktop's Get the app link changes address with every new APK.
Bump `versionCode` / `versionName` in `app/build.gradle` for a new release.

**Signing key:** the first build creates `%USERPROFILE%\.tooling\keys\mypc-controller.jks` and its password file
(`keystore.properties`, copied next to it). Neither is committed. Keep a copy: a phone installs an update over the old
app only when it is signed with the same key.
