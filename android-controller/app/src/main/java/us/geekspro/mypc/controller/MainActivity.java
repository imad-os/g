package us.geekspro.mypc.controller;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
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
 * My PC Controller: the Game controller of My PC (js/launcher/apps/gamepad.js, the hosted copy) in a full-screen WebView,
 * so pairing, the WebRTC link, the pad and the motion engine stay exactly the ones the TV side was built and tested with.
 * The app adds what a browser tab does badly (assets/bridge.js + Bridge):
 *   native motion sensors (SensorHub: 200 Hz fused sensors, real timestamps) instead of devicemotion,
 *   a native QR scanner for the TV's pairing code,
 *   screen kept on, and a foreground service + wake lock so the link survives with the screen off.
 */
public final class MainActivity extends Activity {
    // the hosted My PC (GitHub Pages; imad-os.github.io/g redirects to the custom domain)
    private static final String HOME = "https://pc.geekspro.us/index.html";
    private static final Set<String> HOSTS = new HashSet<>(Arrays.asList("pc.geekspro.us", "imad-os.github.io"));
    private static final Set<String> ORIGINS = new HashSet<>(Arrays.asList("https://pc.geekspro.us", "https://imad-os.github.io"));

    private WebView web;
    private SensorHub hub;
    private String bridgeJs;
    private boolean active, motion;

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        bridgeJs = asset("bridge.js");
        hub = new SensorHub(this, json -> {
            final String js = "window.__mypcMotion&&__mypcMotion(" + json + ")";
            web.post(() -> { if (web != null) web.evaluateJavascript(js, null); });
        });

        web = new WebView(this);
        web.setBackgroundColor(getColor(R.color.bg));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);                                      // the page sizes its own text for phones
        s.setUserAgentString(s.getUserAgentString() + " MyPCController/1");
        web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);   // stays important with the screen off
        web.addJavascriptInterface(new Bridge(this), "MyPCNative");
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT))
            WebViewCompat.addDocumentStartJavaScript(web, bridgeJs, ORIGINS);
        web.setWebViewClient(new Client());
        setContentView(web);
        immersive();
        web.loadUrl(startUrl(getIntent()));
    }

    /* ---------- what the page asks for (Bridge) ---------- */

    String sensorCaps() {
        return "{\"motion\":" + hub.hasMotion() + ",\"linear\":" + hub.hasLinear() + ",\"gyro\":" + hub.hasGyro() + "}";
    }

    void setMotion(boolean on) {
        motion = on;
        if (on) hub.start(); else hub.stop();
    }

    void setActive(boolean on) {
        if (on == active) return;
        active = on;
        if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        LinkService.set(this, on);
        web.removeCallbacks(pump);
        if (on) web.postDelayed(pump, PUMP_MS);
    }

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
    private static final int SCAN = 7, CAMERA = 8;

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

    private String startUrl(Intent i) {
        Uri u = i != null ? i.getData() : null;
        if (u != null && u.getQueryParameter("pair") != null) return pairUrl(u.toString());
        return HOME + "?ctrl=1";
    }

    private static String pairUrl(String text) {
        Matcher m = Pattern.compile("[?&]pair=([A-Za-z0-9]{6,16})").matcher(text);
        String c = m.find() ? m.group(1) : text.trim().matches("[A-Za-z0-9]{6,16}") ? text.trim() : null;
        return c == null ? HOME + "?ctrl=1" : HOME + "?pair=" + c.toLowerCase(Locale.ROOT);
    }

    @Override protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
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
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT) && isOurs(url)) v.evaluateJavascript(bridgeJs, null);
        }

        @Override public void onPageFinished(WebView v, String url) {
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

    private static boolean isOurs(String url) {
        Uri u = Uri.parse(url);
        return "https".equals(u.getScheme()) && HOSTS.contains(u.getHost());
    }

    /* ---------- Back: inside the controller it acts like the TV remote's Back; on the join screen it leaves ---------- */

    @Override public boolean onKeyDown(int code, KeyEvent e) {
        if (code != KeyEvent.KEYCODE_BACK) return super.onKeyDown(code, e);
        web.evaluateJavascript("!!(window.GamepadApp&&GamepadApp.running())", v -> {
            if ("true".equals(v)) web.evaluateJavascript("(function(){var o={key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true};"
                    + "document.dispatchEvent(new KeyboardEvent('keydown',o));document.dispatchEvent(new KeyboardEvent('keyup',o));})()", null);
            else moveTaskToBack(true);
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
        // while connected the page keeps running (screen off, phone in a pocket): only pause it when idle
        if (!active) web.onPause();
        super.onPause();
    }

    @Override public void onWindowFocusChanged(boolean focus) {
        super.onWindowFocusChanged(focus);
        if (focus) immersive();
    }

    @Override protected void onDestroy() {
        hub.stop();
        LinkService.set(this, false);
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
