package us.geekspro.mypc.controller;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.provider.OpenableColumns;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import com.google.zxing.client.android.Intents;
import com.journeyapps.barcodescanner.CaptureActivity;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * My PC for Android: the hosted My PC (the same desktop, games, apps and Game controller as on the TV, updated online) in a
 * full-screen WebView, so pairing, the WebRTC link, the pad and the motion engine stay exactly the ones the TV side was built
 * and tested with. The app adds what a browser tab does badly (assets/bridge.js + Bridge):
 *   native motion sensors (SensorHub: 200 Hz fused sensors, real timestamps) instead of devicemotion,
 *   a native QR scanner for the TV's pairing code,
 *   the microphone for the page (getUserMedia: the Game controller's Microphone mode makes this phone the TV's microphone;
 *   Android's RECORD_AUDIO is asked the first time, only for My PC's own pages),
 *   screen kept on (while a controller is connected or a game is open), and a foreground service + wake lock so the link
 *   survives with the screen off; the phone's Back is the TV remote's Back (Input.systemBack), exit closes the app.
 * The Game controller's phone settings (Bridge.settings, kept in SharedPreferences "opts", applied from the start):
 *   orient  the screen rotation chosen in My PC (js/core/rotation.js): "any" follows the phone (portrait and landscape),
 *           "landscape" / "portrait" hold that side with no sensor (the side it is on now when it already is that way)
 *   rotate  (pages before orient) on: both landscape sides follow the phone; off: held on the side it is on
 *   awake   off: the screen may turn off by itself while a controller is connected
 *   bg      off: no foreground service; with the screen off the page pauses and the link drops
 * Share to the TV (owner request 2026-11-13): the app is in Android's share menu (images, videos, music, files, links, text).
 * A share is kept by LanServer (port 47800 on the home network, no internet server) and the page opens its Send to TV screen
 * (js/launcher/apps/receiver.js); the TV's Receiver app finds this phone on the network and takes the shares from it.
 */
public final class MainActivity extends Activity {
    // the hosted My PC (GitHub Pages; imad-os.github.io/g redirects to the custom domain)
    private static final String HOME = "https://pc.geekspro.us/index.html";
    private static final Set<String> HOSTS = new HashSet<>(Arrays.asList("pc.geekspro.us", "imad-os.github.io"));
    private static final Set<String> ORIGINS = new HashSet<>(Arrays.asList("https://pc.geekspro.us", "https://imad-os.github.io"));

    private WebView web;
    private SensorHub hub;
    private String bridgeJs;
    private boolean active, motion, playing;
    private boolean optRotate = true, optAwake = true, optBg = true;
    private String optOrient = "";
    private LanServer lan;
    private boolean pageReady, sharePending;

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        bridgeJs = asset("bridge.js");
        SharedPreferences o = getSharedPreferences("opts", MODE_PRIVATE);
        optRotate = o.getBoolean("rotate", true); optAwake = o.getBoolean("awake", true); optBg = o.getBoolean("bg", true);
        optOrient = o.getString("orient", "");
        rotation();
        hub = new SensorHub(this, json -> {
            final String js = "window.__mypcMotion&&__mypcMotion(" + json + ")";
            web.post(() -> { if (web != null) web.evaluateJavascript(js, null); });
        });

        startLan();

        web = new WebView(this);
        web.setBackgroundColor(getColor(R.color.bg));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
 // the Receiver of a TV and the local rooms are plain http on the home network (http://192.168.x.x): the WebView only ever
        // loads My PC's own pages (Client below hands every other link to the phone's browser)
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setTextZoom(100);                                      // the page sizes its own text for phones
        s.setUserAgentString(s.getUserAgentString() + " MyPCApp/2");
        web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);   // stays important with the screen off
        web.addJavascriptInterface(new Bridge(this), "MyPCNative");
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT))
            WebViewCompat.addDocumentStartJavaScript(web, bridgeJs, ORIGINS);
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        setContentView(web);
        immersive();
        boolean shared = takeShare(getIntent());
        web.loadUrl(shared ? HOME + "?share=1" : startUrl(getIntent()));
    }

    /* ---------- Share to the TV (LanServer) ---------- */

    private void startLan() {
        SharedPreferences p = getSharedPreferences("share", MODE_PRIVATE);
        String id = p.getString("id", "");
        if (id.isEmpty()) { id = Long.toHexString(new java.security.SecureRandom().nextLong()); p.edit().putString("id", id).apply(); }
        String name = Build.MODEL == null ? "Android" : Build.MODEL;
        if (Build.MANUFACTURER != null && !name.toLowerCase(Locale.ROOT).startsWith(Build.MANUFACTURER.toLowerCase(Locale.ROOT)))
            name = Build.MANUFACTURER.substring(0, 1).toUpperCase(Locale.ROOT) + Build.MANUFACTURER.substring(1) + " " + name;
        lan = new LanServer(name, id, p.getString("tv", ""), uri -> getContentResolver().openInputStream(Uri.parse(uri)), () -> {
            String tv = lan.rememberedTv();
            SharedPreferences sp = getSharedPreferences("share", MODE_PRIVATE);
            if (!tv.equals(sp.getString("tv", ""))) sp.edit().putString("tv", tv).apply();
            runOnUiThread(() -> { if (web != null && pageReady) web.evaluateJavascript("window.ShareOut&&ShareOut.changed()", null); });
        });
        lan.start();
    }

    LanServer lan() { return lan; }

    /** true once after a share arrived (the page opens its Send to TV screen) */
    boolean takePending() { boolean p = sharePending; sharePending = false; return p; }

    // Android's share menu: ACTION_SEND (one text, link or file) / ACTION_SEND_MULTIPLE (several files)
    @SuppressWarnings("deprecation")
    private boolean takeShare(Intent i) {
        if (i == null) return false;
        String act = i.getAction();
        if (!Intent.ACTION_SEND.equals(act) && !Intent.ACTION_SEND_MULTIPLE.equals(act)) return false;
        ArrayList<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND_MULTIPLE.equals(act)) {
            ArrayList<Uri> l = i.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (l != null) uris.addAll(l);
        } else {
            Uri u = i.getParcelableExtra(Intent.EXTRA_STREAM);
            if (u != null) uris.add(u);
        }
        if (uris.isEmpty() && i.getClipData() != null)
            for (int k = 0; k < i.getClipData().getItemCount(); k++) { Uri u = i.getClipData().getItemAt(k).getUri(); if (u != null) uris.add(u); }
        int n = 0;
        for (Uri u : uris) {
            if (!"content".equals(u.getScheme()) && !"file".equals(u.getScheme())) continue;
            String name = null, mime = getContentResolver().getType(u);
            long size = -1;
            try (Cursor c = getContentResolver().query(u, new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE }, null, null, null)) {
                if (c != null && c.moveToFirst()) {
                    int a = c.getColumnIndex(OpenableColumns.DISPLAY_NAME), b = c.getColumnIndex(OpenableColumns.SIZE);
                    if (a >= 0) name = c.getString(a);
                    if (b >= 0 && !c.isNull(b)) size = c.getLong(b);
                }
            } catch (RuntimeException e) { /* a provider without those columns */ }
            if (name == null) name = u.getLastPathSegment();
            if (mime == null || "application/octet-stream".equals(mime)) mime = i.getType();
            lan.addFile(u.toString(), mime, name, size);
            n++;
        }
        CharSequence text = i.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (n == 0 && text != null && text.length() > 0) {
            String sub = i.getStringExtra(Intent.EXTRA_SUBJECT);
            lan.addText(text.length() > 20000 ? text.subSequence(0, 20000).toString() : text.toString(), sub);
            n++;
        }
        if (n == 0) return false;
        sharePending = true;
        if (!lan.listening()) lan.start();
        return true;
    }

    /* ---------- what the page asks for (Bridge) ---------- */

    String sensorCaps() {
        return "{\"motion\":" + hub.hasMotion() + ",\"linear\":" + hub.hasLinear() + ",\"gyro\":" + hub.hasGyro() + "}";
    }

    void setMotion(boolean on) {
        motion = on;
        if (on) hub.start(); else hub.stop();
    }

    void setSettings(String json) {
        try {
            JSONObject j = new JSONObject(json);
            optRotate = j.optBoolean("rotate", optRotate); optAwake = j.optBoolean("awake", optAwake); optBg = j.optBoolean("bg", optBg);
            optOrient = j.optString("orient", optOrient);
        } catch (Exception e) { return; }
        getSharedPreferences("opts", MODE_PRIVATE).edit()
                .putBoolean("rotate", optRotate).putBoolean("awake", optAwake).putBoolean("bg", optBg).putString("orient", optOrient).apply();
        rotation();
        screenOn();
        if (active) LinkService.set(this, optBg);
    }

    // Screen rotation: "any" follows the phone (both ways), "landscape" / "portrait" are held with no sensor, on the side it
    // is on now when it already is that way; without orient (older pages) the old Auto rotate between the landscape sides
    private void rotation() {
        boolean land = getResources().getConfiguration().orientation != Configuration.ORIENTATION_PORTRAIT;
        int o;
        if ("any".equals(optOrient)) o = ActivityInfo.SCREEN_ORIENTATION_SENSOR;
        else if ("portrait".equals(optOrient)) o = land ? ActivityInfo.SCREEN_ORIENTATION_PORTRAIT : ActivityInfo.SCREEN_ORIENTATION_LOCKED;
        else if ("landscape".equals(optOrient)) o = land ? ActivityInfo.SCREEN_ORIENTATION_LOCKED : ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE;
        else o = optRotate ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE : land ? ActivityInfo.SCREEN_ORIENTATION_LOCKED : ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE;
        if (o != getRequestedOrientation()) setRequestedOrientation(o);
    }

    void setActive(boolean on) {
        if (on == active) return;
        active = on;
        screenOn();
        LinkService.set(this, on && optBg);
        web.removeCallbacks(pump);
        if (on) web.postDelayed(pump, PUMP_MS);
    }

    // the screen stays on while a controller is connected (Stay awake) or a game / app is open (index.html?play=<id>)
    private void screenOn() {
        if ((active && optAwake) || playing) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    void exitApp() { finishAndRemoveTask(); }

    // With the screen off the WebView counts as hidden and its timers slow down, so the link's once-a-second ping could
    // come too late and the TV would drop the phone (5 s of silence). While connected the app runs the ping itself.
    private static final long PUMP_MS = 400;
    private final Runnable pump = new Runnable() {
        @Override public void run() {
            if (web == null || !active) return;
            web.evaluateJavascript("window.NetLink&&NetLink.pump&&NetLink.pump()", null);
            web.postDelayed(this, PUMP_MS);
        }
    };

    // the scanner screen of zxing-android-embedded, opened directly (its IntentIntegrator helper needs androidx.fragment)
    private static final int SCAN = 7, CAMERA = 8, MIC = 9;
    private PermissionRequest micAsk;                        // the page's microphone request, while Android asks the user

    void scanQr() {
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] { Manifest.permission.CAMERA }, CAMERA);
            return;
        }
        try {
            startActivityForResult(new Intent(this, CaptureActivity.class)
                    .setAction(Intents.Scan.ACTION)
                    .putExtra(Intents.Scan.FORMATS, "QR_CODE")
                    .putExtra(Intents.Scan.PROMPT_MESSAGE, getString(R.string.scan_prompt))
                    .putExtra(Intents.Scan.BEEP_ENABLED, false)
                    .putExtra(Intents.Scan.ORIENTATION_LOCKED, true), SCAN);
        } catch (RuntimeException e) {
            Toast.makeText(this, getString(R.string.scan_error) + " (" + e.getClass().getSimpleName() + ")", Toast.LENGTH_LONG).show();
        }
    }

    @Override public void onRequestPermissionsResult(int request, String[] perms, int[] res) {
        if (request == MIC) {
            PermissionRequest r = micAsk;
            micAsk = null;
            if (r == null) return;
            if (res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED) r.grant(new String[] { PermissionRequest.RESOURCE_AUDIO_CAPTURE });
            else r.deny();
            return;
        }
        if (request != CAMERA) return;
        if (res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED) scanQr();
        else Toast.makeText(this, R.string.scan_no_camera, Toast.LENGTH_LONG).show();
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        if (request != SCAN) { super.onActivityResult(request, result, data); return; }
        String text = result == RESULT_OK && data != null ? data.getStringExtra(Intents.Scan.RESULT) : null;
        if (text != null) pair(text);                            // null: cancelled
    }

    /** a scanned code or a pairing link: the page connects with it (GamepadApp.scanCode answers '' when it is not one) */
    private void pair(String text) {
        web.evaluateJavascript("window.GamepadApp?GamepadApp.scanCode(" + JSONObject.quote(text) + "):null", v -> {
            if ("null".equals(v)) web.loadUrl(pairUrl(text));    // the controller is not open (page still loading): open it with the code
            else if ("\"\"".equals(v)) Toast.makeText(this, R.string.scan_bad, Toast.LENGTH_SHORT).show();
        });
    }

    /* ---------- page ---------- */

    // OWNER RULE: the app always opens the whole My PC (HOME, the desktop), never a controller-only page
    private String startUrl(Intent i) {
        Uri u = i != null ? i.getData() : null;
        if (u != null && u.getQueryParameter("pair") != null) return pairUrl(u.toString());
        return HOME;                                             // My PC itself, opened like any app
    }

    private static String pairUrl(String text) {
        Matcher m = Pattern.compile("[?&]pair=([A-Za-z0-9]{6,16})").matcher(text);
        String c = m.find() ? m.group(1) : text.trim().matches("[A-Za-z0-9]{6,16}") ? text.trim() : null;
        return c == null ? HOME + "?ctrl=1" : HOME + "?pair=" + c.toLowerCase(Locale.ROOT);
    }

    @Override protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        if (takeShare(i)) {
            if (pageReady) web.evaluateJavascript("window.ShareOut?(ShareOut.arrived(),1):0", v -> { if (!"1".equals(v)) web.loadUrl(HOME + "?share=1"); });
            return;
        }
        Uri u = i.getData();
        if (u != null && u.getQueryParameter("pair") != null) pair(u.toString());
    }

    private final class Client extends WebViewClient {
        @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
            Uri u = req.getUrl();
            if ("https".equals(u.getScheme()) && HOSTS.contains(u.getHost())) return false;
            if ("file".equals(u.getScheme())) return false;
            try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (RuntimeException e) { /* nothing can open it */ }
            return true;                                         // only My PC runs inside the app (it can reach MyPCNative)
        }

        @Override public void onPageStarted(WebView v, String url, android.graphics.Bitmap icon) {
            setMotion(false);                                    // a new page starts with no listeners
            setActive(false);
            pageReady = false;
            playing = isOurs(url) && Uri.parse(url).getQueryParameter("play") != null;
            screenOn();
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT) && isOurs(url)) v.evaluateJavascript(bridgeJs, null);
        }

        @Override public void onPageFinished(WebView v, String url) {
            pageReady = isOurs(url);
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT) && isOurs(url)) v.evaluateJavascript(bridgeJs, null);
        }

        @Override public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
            if (!req.isForMainFrame() || !isOurs(req.getUrl().toString())) return;
            v.loadDataWithBaseURL("file:///android_asset/", asset("offline.html")
                    .replace("{TEXT}", getString(R.string.offline)).replace("{RETRY}", getString(R.string.retry))
                    .replace("{URL}", req.getUrl().toString().replace("\"", "%22")), "text/html", "utf-8", null);
        }

        @Override public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail d) {
            setMotion(false); setActive(false);
            recreate();                                          // the page's renderer died: start again cleanly
            return true;
        }
    }

    // getUserMedia in the page: only the microphone, only for My PC's own pages; Android asks once (RECORD_AUDIO)
    private final class Chrome extends WebChromeClient {
        @Override public void onPermissionRequest(PermissionRequest req) {
            runOnUiThread(() -> {
                boolean audio = Arrays.asList(req.getResources()).contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE);
                if (!audio || !isOurs(req.getOrigin().toString())) { req.deny(); return; }
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    req.grant(new String[] { PermissionRequest.RESOURCE_AUDIO_CAPTURE });
                    return;
                }
                if (micAsk != null) micAsk.deny();
                micAsk = req;
                requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO }, MIC);
            });
        }

        @Override public void onPermissionRequestCanceled(PermissionRequest req) {
            if (req == micAsk) micAsk = null;
        }
    }

    private static boolean isOurs(String url) {
        Uri u = Uri.parse(url);
        return "https".equals(u.getScheme()) && HOSTS.contains(u.getHost());
    }

    /* ---------- Back: the TV remote's Back (My PC asks before it exits); the app leaves only when My PC is not there ---------- */

    @Override public boolean onKeyDown(int code, KeyEvent e) {
        if (code != KeyEvent.KEYCODE_BACK) return super.onKeyDown(code, e);
        if (e.getRepeatCount() > 0) return true;
        web.evaluateJavascript("window.Input&&Input.systemBack?(Input.systemBack(),1):0", v -> {
            if (!"1".equals(v)) moveTaskToBack(true);         // still loading, or the offline page
        });
        return true;
    }

    /* ---------- lifecycle ---------- */

    @Override protected void onResume() {
        super.onResume();
        web.onResume();
        immersive();
    }

    @Override protected void onPause() {
        // while connected the page keeps running (screen off, phone in a pocket) unless Background is off
        if (!active || !optBg) web.onPause();
        super.onPause();
    }

    @Override public void onWindowFocusChanged(boolean focus) {
        super.onWindowFocusChanged(focus);
        if (focus) immersive();
    }

    @Override protected void onDestroy() {
        hub.stop();
        LinkService.set(this, false);
        if (lan != null) lan.stop();
        if (web != null) { web.destroy(); web = null; }
        super.onDestroy();
    }

    @SuppressWarnings("deprecation")
    private void immersive() {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
    }

    private String asset(String name) {
        try (InputStream in = getAssets().open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] b = new byte[8192];
            for (int n; (n = in.read(b)) > 0; ) out.write(b, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        } catch (IOException e) {
            return "";
        }
    }
}
