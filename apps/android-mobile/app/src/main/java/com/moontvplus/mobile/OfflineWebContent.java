package com.moontvplus.mobile;

import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.util.Collections;

final class OfflineWebContent {
    static String url() { return Uri.parse(BuildConfig.BASE_URL).buildUpon().path("/__lintvplus_offline__/index.html").clearQuery().fragment(null).build().toString(); }

    static boolean isOfflineUrl(Uri uri) {
        return OfflineDownloads.sameOrigin(Uri.parse(BuildConfig.BASE_URL), uri)
                && uri.getPath() != null && uri.getPath().startsWith("/__lintvplus_offline__/");
    }

    static WebResourceResponse response(Context context, Uri uri) {
        if (!isOfflineUrl(uri)) return null;
        String name = uri.getLastPathSegment();
        if (!java.util.Arrays.asList("index.html", "offline.css", "offline-app.js", "video-cache.js", "partial-cache-playlist.js", "hls.mjs", "logo.png").contains(name)
                || !uri.getPath().equals("/__lintvplus_offline__/" + name)) return blocked();
        try {
            String mime = name.endsWith(".html") ? "text/html" : name.endsWith(".css") ? "text/css" : name.endsWith(".png") ? "image/png" : "application/javascript";
            return new WebResourceResponse(mime, name.endsWith(".png") ? null : "UTF-8", 200, "OK",
                    Collections.singletonMap("Cache-Control", "no-store"), context.getAssets().open("offline/" + name));
        } catch (Exception error) { return blocked(); }
    }

    static WebResourceResponse blocked() {
        return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }

    static void install(Context context) {
        if (Build.VERSION.SDK_INT >= 24) {
            Context app = context.getApplicationContext();
            ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient() {
                @Override public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) { return response(app, request.getUrl()); }
            });
        }
    }
}
