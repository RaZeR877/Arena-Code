package dev.vynqode.ide;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (getBridge() != null) {
            // JavaScriptInterface objects are visible in every frame, including untrusted
            // project previews. Keep only Capacitor's origin-scoped, main-frame message
            // listener. On legacy WebViews native features fail closed instead.
            getBridge().getWebView().removeJavascriptInterface("androidBridge");
            getBridge().getWebView().removeJavascriptInterface("CapacitorCookiesAndroidInterface");
            getBridge().getWebView().removeJavascriptInterface("CapacitorHttpAndroidInterface");
        }
    }
}
