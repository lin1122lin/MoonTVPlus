package com.moontvplus.mobile;

import android.Manifest;
import android.annotation.SuppressLint;
import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ServiceWorkerController;
import android.webkit.ServiceWorkerWebSettings;
import android.webkit.SslErrorHandler;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceError;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class MainActivity extends ComponentActivity {
    private static final int FILE_CHOOSER_REQUEST_CODE = 1001;
    private static final int WEB_PERMISSION_REQUEST_CODE = 1002;
    private static final int STORAGE_PERMISSION_REQUEST_CODE = 1003;

    private FrameLayout root;
    private WebView webView;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private ValueCallback<Uri[]> fileChooserCallback;
    private PermissionRequest pendingPermissionRequest;
    private PendingDownload pendingDownload;
    private UpdateManager updateManager;
    private int orientationBeforeFullscreen =
            ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
    private boolean fullscreenOrientationLocked;
    private ConnectionPanel connectionPanel;
    private boolean pageFailed;
    private volatile boolean localOfflinePage;
    private final Handler loadingHandler = new Handler(Looper.getMainLooper());
    private final Runnable loadingTimeout = () -> showConnectionPanel("站点暂未加载完成，可先查看本机下载。");

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setStatusBarColor(Color.BLACK);
        getWindow().setNavigationBarColor(Color.BLACK);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        setContentView(root);
        installSystemBarInsets();
        setupWebView();
        setupConnectionPanel();
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (customView != null) hideCustomView();
                else if (webView != null && webView.canGoBack()) webView.goBack();
                else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                    setEnabled(true);
                }
            }
        });
        updateManager = new UpdateManager(this);
        updateManager.start();

        if (getIntent().getBooleanExtra("showLegacyDownloads", false)) {
            openLegacyDownloads();
        } else if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl(normalizeBaseUrl(BuildConfig.BASE_URL));
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        webView = new WebView(this);
        webView.setBackgroundColor(Color.BLACK);
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadWithOverviewMode(false);
        settings.setUseWideViewPort(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setSupportMultipleWindows(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setUserAgentString(
                settings.getUserAgentString() + " MoonTVPlusAndroidMobile"
        );
        webView.addJavascriptInterface(new AndroidAppBridge(), "LinTVPlusAndroid");

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            ServiceWorkerWebSettings serviceWorkerSettings = ServiceWorkerController
                    .getInstance()
                    .getServiceWorkerWebSettings();
            serviceWorkerSettings.setAllowContentAccess(true);
            serviceWorkerSettings.setAllowFileAccess(false);
            serviceWorkerSettings.setBlockNetworkLoads(false);
        }

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG || BuildConfig.ENABLE_USB_DEBUGGING);
        webView.setWebViewClient(new MobileWebViewClient());
        webView.setWebChromeClient(new MobileWebChromeClient());
        webView.setDownloadListener(new MobileDownloadListener());
        OfflineWebContent.install(this);
    }

    private final class AndroidAppBridge {
        @JavascriptInterface
        public void openDownloads() {
            runOnUiThread(() -> { if (trustedPage()) startActivity(new Intent(MainActivity.this, DownloadsActivity.class)); });
        }

        @JavascriptInterface
        public void openLocalVideo() {
            runOnUiThread(() -> {
                if (trustedPage()) startActivity(new Intent(MainActivity.this, DownloadsActivity.class).putExtra("showLocalFiles", true));
            });
        }

        @JavascriptInterface
        public void enqueueDownloads(String value) {
            if (value == null || value.length() > 500000) return;
            runOnUiThread(() -> {
                if (!trustedPage()) return;
                try {
                    JSONArray tasks = new JSONArray(value);
                    if (tasks.length() < 1 || tasks.length() > 50) throw new IllegalArgumentException("每次最多下载 50 集");
                    for (int i = 0; i < tasks.length(); i++) {
                        JSONObject task = tasks.getJSONObject(i);
                        DownloadSafety.validateUrl(task.getString("url"));
                        if (task.optString("title").length() > 300) throw new IllegalArgumentException("标题过长");
                    }
                    // 桥接对象对 iframe 也可见，因此开始下载必须经原生确认，且不返回私人任务数据。
                    new AlertDialog.Builder(MainActivity.this).setTitle("安卓后台下载")
                            .setMessage("添加 " + tasks.length() + " 个下载任务？\n" + tasks.getJSONObject(0).optString("title"))
                            .setNegativeButton("取消", null).setPositiveButton("下载", (dialog, which) -> {
                                try {
                                    if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
                                        requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1004);
                                    for (int i = 0; i < tasks.length(); i++) OfflineDownloads.enqueue(MainActivity.this, tasks.getJSONObject(i));
                                    startActivity(new Intent(MainActivity.this, DownloadsActivity.class));
                                } catch (Exception error) { Toast.makeText(MainActivity.this, "创建下载失败，请重试", Toast.LENGTH_LONG).show(); }
                            }).show();
                } catch (Exception error) { Toast.makeText(MainActivity.this, "下载请求无效", Toast.LENGTH_LONG).show(); }
            });
        }

        @JavascriptInterface
        public void openCastSettings() {
            runOnUiThread(() -> {
                String currentUrl = webView == null ? null : webView.getUrl();
                if (currentUrl == null || !isTrustedOrigin(Uri.parse(currentUrl))) {
                    return;
                }

                if (!openSettings(Settings.ACTION_CAST_SETTINGS)
                        && !openSettings(Settings.ACTION_WIRELESS_SETTINGS)) {
                    Toast.makeText(
                            MainActivity.this,
                            "未找到系统投屏功能",
                            Toast.LENGTH_SHORT
                    ).show();
                }
            });
        }
    }

    private boolean trustedPage() { return webView != null && webView.getUrl() != null && isTrustedOrigin(Uri.parse(webView.getUrl())); }

    private void setupConnectionPanel() {
        connectionPanel = new ConnectionPanel(this,
                () -> startActivity(new Intent(this, DownloadsActivity.class)),
                this::openLegacyDownloads,
                () -> webView.loadUrl(normalizeBaseUrl(BuildConfig.BASE_URL)));
        root.addView(connectionPanel, new FrameLayout.LayoutParams(-1, -1));
        showConnectionPanel("正在连接 LinTVPlus…");
    }

    private void showConnectionPanel(String message) {
        if (connectionPanel == null) return;
        connectionPanel.setMessage(message); connectionPanel.setVisibility(View.VISIBLE); connectionPanel.bringToFront();
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent); setIntent(intent);
        if (intent.getBooleanExtra("showLegacyDownloads", false)) {
            openLegacyDownloads();
        } else {
            webView.loadUrl(normalizeBaseUrl(BuildConfig.BASE_URL));
        }
    }

    private void openLegacyDownloads() {
        getIntent().removeExtra("showLegacyDownloads");
        localOfflinePage = true;
        webView.loadUrl(OfflineWebContent.url());
    }

    private boolean openSettings(String action) {
        try {
            startActivity(new Intent(action));
            return true;
        } catch (Exception error) {
            return false;
        }
    }

    private final class MobileWebViewClient extends WebViewClient {
        @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            WebResourceResponse local = OfflineWebContent.response(MainActivity.this, request.getUrl());
            if (local != null) return local;
            return localOfflinePage && !request.isForMainFrame() ? OfflineWebContent.blocked() : null;
        }
        @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
            localOfflinePage = OfflineWebContent.isOfflineUrl(Uri.parse(url));
            pageFailed = false;
            showConnectionPanel(localOfflinePage ? "正在读取本机缓存…" : "正在连接 LinTVPlus…");
            loadingHandler.removeCallbacks(loadingTimeout); loadingHandler.postDelayed(loadingTimeout, 20000);
        }
        @Override public void onPageFinished(WebView view, String url) {
            loadingHandler.removeCallbacks(loadingTimeout);
            if (!pageFailed) {
                connectionPanel.setVisibility(View.GONE);
            }
        }
        @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) { pageFailed = true; showConnectionPanel("暂时无法连接站点，仍可查看本机下载。"); }
        }
        @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
            if (request.isForMainFrame() && response.getStatusCode() >= 400) { pageFailed = true; showConnectionPanel("站点暂不可用，仍可查看本机下载。"); }
        }
        @Override
        public boolean shouldOverrideUrlLoading(
                WebView view,
                WebResourceRequest request
        ) {
            return handleExternalUri(request.getUrl());
        }

        @SuppressWarnings("deprecation")
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return handleExternalUri(Uri.parse(url));
        }

        @Override
        public void onReceivedSslError(
                WebView view,
                SslErrorHandler handler,
                SslError error
        ) {
            handler.cancel();
            pageFailed = true;
            showConnectionPanel("站点证书验证失败，请检查网络和系统时间。");
        }
    }

    private final class MobileWebChromeClient extends WebChromeClient {
        @Override
        public void onShowCustomView(
                View view,
                CustomViewCallback callback
        ) {
            if (customView != null) {
                callback.onCustomViewHidden();
                return;
            }

            customView = view;
            customViewCallback = callback;
            webView.setVisibility(View.GONE);
            root.setPadding(0, 0, 0, 0);
            root.addView(customView, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
            ));
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            lockLandscapeForFullscreen();
            setImmersiveMode(true);
        }

        @Override
        public void onHideCustomView() {
            hideCustomView();
        }

        @Override
        public boolean onShowFileChooser(
                WebView view,
                ValueCallback<Uri[]> callback,
                FileChooserParams params
        ) {
            if (fileChooserCallback != null) {
                fileChooserCallback.onReceiveValue(null);
            }
            fileChooserCallback = callback;

            try {
                startActivityForResult(
                        params.createIntent(),
                        FILE_CHOOSER_REQUEST_CODE
                );
                return true;
            } catch (ActivityNotFoundException error) {
                fileChooserCallback = null;
                Toast.makeText(
                        MainActivity.this,
                        "No file picker is available",
                        Toast.LENGTH_SHORT
                ).show();
                return false;
            }
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            runOnUiThread(() -> handleWebPermissionRequest(request));
        }

        @Override
        public void onPermissionRequestCanceled(PermissionRequest request) {
            if (pendingPermissionRequest == request) {
                pendingPermissionRequest = null;
            }
        }
    }

    private final class MobileDownloadListener implements DownloadListener {
        @Override
        public void onDownloadStart(
                String url,
                String userAgent,
                String contentDisposition,
                String mimeType,
                long contentLength
        ) {
            if (url == null
                    || (!url.startsWith("http://") && !url.startsWith("https://"))) {
                Toast.makeText(
                        MainActivity.this,
                        "This download type is not supported",
                        Toast.LENGTH_SHORT
                ).show();
                return;
            }

            pendingDownload = new PendingDownload(
                    url,
                    userAgent,
                    contentDisposition,
                    mimeType
            );

            if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P
                    && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                    != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(
                        new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE},
                        STORAGE_PERMISSION_REQUEST_CODE
                );
                return;
            }
            enqueuePendingDownload();
        }
    }

    private void handleWebPermissionRequest(PermissionRequest request) {
        if (!isTrustedOrigin(request.getOrigin())) {
            request.deny();
            return;
        }

        List<String> androidPermissions = new ArrayList<>();
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
                    && checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                    != PackageManager.PERMISSION_GRANTED) {
                androidPermissions.add(Manifest.permission.RECORD_AUDIO);
            } else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)
                    && checkSelfPermission(Manifest.permission.CAMERA)
                    != PackageManager.PERMISSION_GRANTED) {
                androidPermissions.add(Manifest.permission.CAMERA);
            }
        }

        if (androidPermissions.isEmpty()) {
            grantApprovedWebResources(request);
            return;
        }

        if (pendingPermissionRequest != null) {
            pendingPermissionRequest.deny();
        }
        pendingPermissionRequest = request;
        requestPermissions(
                androidPermissions.toArray(new String[0]),
                WEB_PERMISSION_REQUEST_CODE
        );
    }

    private void grantApprovedWebResources(PermissionRequest request) {
        List<String> approved = new ArrayList<>();
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
                    && checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                    == PackageManager.PERMISSION_GRANTED) {
                approved.add(resource);
            } else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)
                    && checkSelfPermission(Manifest.permission.CAMERA)
                    == PackageManager.PERMISSION_GRANTED) {
                approved.add(resource);
            }
        }

        if (approved.isEmpty()) {
            request.deny();
        } else {
            request.grant(approved.toArray(new String[0]));
        }
    }

    private boolean isTrustedOrigin(Uri origin) {
        Uri base = Uri.parse(normalizeBaseUrl(BuildConfig.BASE_URL));
        return origin != null
                && equalsIgnoreCase(origin.getScheme(), base.getScheme())
                && equalsIgnoreCase(origin.getHost(), base.getHost())
                && origin.getPort() == base.getPort();
    }

    private static boolean equalsIgnoreCase(String left, String right) {
        return left != null && right != null && left.equalsIgnoreCase(right);
    }

    private boolean handleExternalUri(Uri uri) {
        String scheme = uri == null ? null : uri.getScheme();
        if (scheme == null
                || "http".equalsIgnoreCase(scheme)
                || "https".equalsIgnoreCase(scheme)) {
            return false;
        }

        String normalizedScheme = scheme.toLowerCase(Locale.ROOT);
        if ("javascript".equals(normalizedScheme)
                || "data".equals(normalizedScheme)
                || "file".equals(normalizedScheme)
                || "content".equals(normalizedScheme)) {
            return true;
        }

        try {
            Intent intent;
            if ("intent".equals(normalizedScheme)) {
                intent = Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME);
                intent.setComponent(null);
                intent.setSelector(null);
                try {
                    startActivity(intent);
                    return true;
                } catch (ActivityNotFoundException error) {
                    String fallbackUrl = intent.getStringExtra("browser_fallback_url");
                    if (fallbackUrl != null
                            && (fallbackUrl.startsWith("http://")
                            || fallbackUrl.startsWith("https://"))) {
                        webView.loadUrl(fallbackUrl);
                        return true;
                    }
                    String packageName = intent.getPackage();
                    if (packageName != null) {
                        startActivity(new Intent(
                                Intent.ACTION_VIEW,
                                Uri.parse("market://details?id=" + packageName)
                        ));
                        return true;
                    }
                    throw error;
                }
            }

            intent = new Intent(Intent.ACTION_VIEW, uri);
            startActivity(intent);
            return true;
        } catch (Exception error) {
            Toast.makeText(
                    this,
                    "No app can open this link",
                    Toast.LENGTH_SHORT
            ).show();
            return true;
        }
    }

    private void enqueuePendingDownload() {
        PendingDownload download = pendingDownload;
        pendingDownload = null;
        if (download == null) {
            return;
        }

        String fileName = URLUtil.guessFileName(
                download.url,
                download.contentDisposition,
                download.mimeType
        );
        DownloadManager.Request request = new DownloadManager.Request(
                Uri.parse(download.url)
        );
        request.setTitle(fileName);
        request.setMimeType(download.mimeType);
        request.setNotificationVisibility(
                DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED
        );
        request.setDestinationInExternalPublicDir(
                Environment.DIRECTORY_DOWNLOADS,
                fileName
        );

        if (download.userAgent != null) {
            request.addRequestHeader("User-Agent", download.userAgent);
        }
        String cookie = CookieManager.getInstance().getCookie(download.url);
        if (cookie != null) {
            request.addRequestHeader("Cookie", cookie);
        }

        try {
            DownloadManager manager = (DownloadManager) getSystemService(
                    Context.DOWNLOAD_SERVICE
            );
            manager.enqueue(request);
            Toast.makeText(
                    this,
                    "Download started",
                    Toast.LENGTH_SHORT
            ).show();
        } catch (Exception error) {
            handleExternalUri(Uri.parse(download.url));
        }
    }

    private void installSystemBarInsets() {
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (customView != null) {
                return insets;
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                android.graphics.Insets bars = insets.getInsets(
                        WindowInsets.Type.systemBars()
                );
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else {
                view.setPadding(
                        insets.getSystemWindowInsetLeft(),
                        insets.getSystemWindowInsetTop(),
                        insets.getSystemWindowInsetRight(),
                        insets.getSystemWindowInsetBottom()
                );
            }
            return insets;
        });
    }

    private void setImmersiveMode(boolean enabled) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller == null) {
                return;
            }
            if (enabled) {
                controller.hide(WindowInsets.Type.systemBars());
                controller.setSystemBarsBehavior(
                        WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                );
            } else {
                controller.show(WindowInsets.Type.systemBars());
            }
            return;
        }

        if (enabled) {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            );
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            );
        }
    }

    private void lockLandscapeForFullscreen() {
        orientationBeforeFullscreen = getRequestedOrientation();
        fullscreenOrientationLocked = true;
        setRequestedOrientation(
                ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        );
    }

    private void restoreOrientationAfterFullscreen() {
        if (!fullscreenOrientationLocked) {
            return;
        }
        fullscreenOrientationLocked = false;
        setRequestedOrientation(orientationBeforeFullscreen);
    }

    private void hideCustomView() {
        if (customView == null) {
            return;
        }

        root.removeView(customView);
        customView = null;
        webView.setVisibility(View.VISIBLE);
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setImmersiveMode(false);
        restoreOrientationAfterFullscreen();
        root.requestApplyInsets();

        if (customViewCallback != null) {
            customViewCallback.onCustomViewHidden();
            customViewCallback = null;
        }
    }

    private static String normalizeBaseUrl(String baseUrl) {
        String url = baseUrl == null ? "" : baseUrl.trim();
        if (url.isEmpty()) {
            url = "https://tv.987951.xyz";
        }
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            url = "https://" + url;
        }
        while (url.endsWith("/")) {
            url = url.substring(0, url.length() - 1);
        }
        return url;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_CHOOSER_REQUEST_CODE || fileChooserCallback == null) {
            return;
        }

        Uri[] result = WebChromeClient.FileChooserParams.parseResult(
                resultCode,
                data
        );
        fileChooserCallback.onReceiveValue(result);
        fileChooserCallback = null;
    }

    @Override
    public void onRequestPermissionsResult(
            int requestCode,
            String[] permissions,
            int[] grantResults
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode == WEB_PERMISSION_REQUEST_CODE
                && pendingPermissionRequest != null) {
            PermissionRequest request = pendingPermissionRequest;
            pendingPermissionRequest = null;
            grantApprovedWebResources(request);
        } else if (requestCode == STORAGE_PERMISSION_REQUEST_CODE) {
            if (grantResults.length > 0
                    && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                enqueuePendingDownload();
            } else {
                pendingDownload = null;
                Toast.makeText(
                        this,
                        "Storage permission is required to download files",
                        Toast.LENGTH_SHORT
                ).show();
            }
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
        }
        if (updateManager != null) {
            updateManager.onResume();
        }
    }

    @Override
    protected void onPause() {
        if (updateManager != null) {
            updateManager.onPause();
        }
        if (webView != null) {
            webView.evaluateJavascript("document.querySelectorAll('video,audio').forEach(media=>media.pause())", null);
            webView.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        loadingHandler.removeCallbacksAndMessages(null);
        if (updateManager != null) {
            updateManager.stop();
            updateManager = null;
        }
        if (fileChooserCallback != null) {
            fileChooserCallback.onReceiveValue(null);
            fileChooserCallback = null;
        }
        if (pendingPermissionRequest != null) {
            pendingPermissionRequest.deny();
            pendingPermissionRequest = null;
        }
        if (webView != null) {
            root.removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private static final class PendingDownload {
        private final String url;
        private final String userAgent;
        private final String contentDisposition;
        private final String mimeType;

        private PendingDownload(
                String url,
                String userAgent,
                String contentDisposition,
                String mimeType
        ) {
            this.url = url;
            this.userAgent = userAgent;
            this.contentDisposition = contentDisposition;
            this.mimeType = mimeType;
        }
    }
}
