# Methods the page calls through window.MyPCNative
-keepclassmembers class us.geekspro.mypc.controller.Bridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface

# zxing-android-embedded is used through its plain Activity API (IntentIntegrator); its ActivityResult helpers are unused
-dontwarn androidx.activity.**
-dontwarn androidx.fragment.**
