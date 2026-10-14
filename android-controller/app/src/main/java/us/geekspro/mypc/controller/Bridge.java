package us.geekspro.mypc.controller;

import android.webkit.JavascriptInterface;

/**
 * window.MyPCNative: what the Game controller page (js/launcher/apps/gamepad.js, assets/bridge.js) may ask of the app.
 * Called on a WebView thread; everything that touches the UI is handed to the activity's main thread.
 */
final class Bridge {
    private final MainActivity app;

    Bridge(MainActivity app) { this.app = app; }

    /** 1: native motion samples, native QR scanner, link kept with the screen off */
    @JavascriptInterface public int version() { return 1; }

    /** {"motion":true,"linear":true,"gyro":true}: which sensors this phone has */
    @JavascriptInterface public String caps() { return app.sensorCaps(); }

    /** the page has (true) or no longer has (false) a devicemotion listener: start or stop the native sensors */
    @JavascriptInterface public void motion(boolean on) { app.runOnUiThread(() -> app.setMotion(on)); }

    /** open the camera to read the TV's pairing QR code; the text goes back to GamepadApp.scanCode() */
    @JavascriptInterface public void scanQr() { app.runOnUiThread(app::scanQr); }

    /** the controller is connecting / connected (true) or stopped (false): screen on, link kept alive */
    @JavascriptInterface public void active(boolean on) { app.runOnUiThread(() -> app.setActive(on)); }
}
