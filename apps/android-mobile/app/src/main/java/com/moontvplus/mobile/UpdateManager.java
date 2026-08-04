package com.moontvplus.mobile;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.util.Log;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

final class UpdateManager {
    private static final String TAG = "MoonTVPlusUpdater";
    private static final String PREFS_NAME = "android_mobile_updater";
    private static final String PREF_LAST_CHECK_AT = "last_check_at";
    private static final String PREF_DOWNLOAD_ID = "download_id";
    private static final String PREF_APK_PATH = "apk_path";
    private static final String PREF_VERSION_CODE = "version_code";
    private static final String PREF_VERSION_NAME = "version_name";
    private static final String PREF_SHA256 = "sha256";
    private static final String PREF_WAITING_INSTALL_PERMISSION =
            "waiting_install_permission";

    private static final long CHECK_INTERVAL_MS = 15L * 60L * 1000L;
    private static final int CONNECT_TIMEOUT_MS = 10_000;
    private static final int READ_TIMEOUT_MS = 15_000;
    private static final int MAX_MANIFEST_BYTES = 64 * 1024;
    private static final String APK_MIME_TYPE =
            "application/vnd.android.package-archive";

    private final Activity activity;
    private final DownloadManager downloadManager;
    private final SharedPreferences preferences;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean checkInFlight = new AtomicBoolean(false);
    private final AtomicBoolean verificationInFlight = new AtomicBoolean(false);
    private final BroadcastReceiver downloadReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (!DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(intent.getAction())) {
                return;
            }
            long completedId = intent.getLongExtra(
                    DownloadManager.EXTRA_DOWNLOAD_ID,
                    -1L
            );
            if (completedId == getPendingDownloadId() && activityVisible) {
                inspectPendingDownload();
            }
        }
    };

    private boolean receiverRegistered;
    private boolean activityVisible;
    private UpdateInfo availableUpdate;
    private AlertDialog updateDialog;
    private AlertDialog installPermissionDialog;

    UpdateManager(Activity activity) {
        this.activity = activity;
        downloadManager = (DownloadManager) activity.getSystemService(
                Context.DOWNLOAD_SERVICE
        );
        preferences = activity.getSharedPreferences(
                PREFS_NAME,
                Context.MODE_PRIVATE
        );
    }

    void start() {
        if (receiverRegistered) {
            return;
        }
        IntentFilter filter = new IntentFilter(
                DownloadManager.ACTION_DOWNLOAD_COMPLETE
        );
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            activity.registerReceiver(
                    downloadReceiver,
                    filter,
                    Context.RECEIVER_EXPORTED
            );
        } else {
            activity.registerReceiver(downloadReceiver, filter);
        }
        receiverRegistered = true;
    }

    void onResume() {
        activityVisible = true;

        if (preferences.getBoolean(PREF_WAITING_INSTALL_PERMISSION, false)) {
            preferences.edit()
                    .putBoolean(PREF_WAITING_INSTALL_PERMISSION, false)
                    .apply();
            if (canRequestPackageInstalls()) {
                inspectPendingDownload();
            } else {
                clearPendingDownload(true);
                showToast("未获得安装权限，更新已取消");
            }
            return;
        }

        if (getPendingDownloadId() >= 0L) {
            inspectPendingDownload();
        }
        if (availableUpdate != null) {
            showUpdateDialog(availableUpdate);
        }
        checkForUpdates();
    }

    void onPause() {
        activityVisible = false;
    }

    void stop() {
        activityVisible = false;
        if (updateDialog != null) {
            updateDialog.dismiss();
            updateDialog = null;
        }
        if (installPermissionDialog != null) {
            installPermissionDialog.dismiss();
            installPermissionDialog = null;
        }
        if (receiverRegistered) {
            activity.unregisterReceiver(downloadReceiver);
            receiverRegistered = false;
        }
        executor.shutdownNow();
    }

    private void checkForUpdates() {
        if (getPendingDownloadId() >= 0L
                || !checkInFlight.compareAndSet(false, true)) {
            return;
        }

        long now = System.currentTimeMillis();
        long lastCheckAt = preferences.getLong(PREF_LAST_CHECK_AT, 0L);
        if (now - lastCheckAt < CHECK_INTERVAL_MS) {
            checkInFlight.set(false);
            return;
        }

        String manifestUrl = BuildConfig.UPDATE_MANIFEST_URL.trim();
        if (!isTrustedManifestUrl(Uri.parse(manifestUrl))) {
            Log.e(TAG, "Update manifest URL is not trusted");
            checkInFlight.set(false);
            return;
        }

        preferences.edit().putLong(PREF_LAST_CHECK_AT, now).apply();
        executor.execute(() -> {
            try {
                UpdateInfo update = parseUpdateInfo(fetchManifest(manifestUrl));
                if (update.versionCode <= BuildConfig.VERSION_CODE) {
                    return;
                }
                availableUpdate = update;
                runOnUiThread(() -> {
                    if (activityVisible) {
                        showUpdateDialog(update);
                    } else {
                        preferences.edit().putLong(PREF_LAST_CHECK_AT, 0L).apply();
                    }
                });
            } catch (Exception error) {
                Log.w(TAG, "Unable to check for updates", error);
            } finally {
                checkInFlight.set(false);
            }
        });
    }

    private String fetchManifest(String manifestUrl) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(
                manifestUrl
        ).openConnection();
        try {
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestMethod("GET");
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty(
                    "User-Agent",
                    "MoonTVPlusAndroidMobile/" + BuildConfig.VERSION_NAME
            );

            int statusCode = connection.getResponseCode();
            if (statusCode != HttpURLConnection.HTTP_OK) {
                throw new IOException("Unexpected HTTP status " + statusCode);
            }
            if (!isTrustedManifestUrl(Uri.parse(connection.getURL().toString()))) {
                throw new IOException("Manifest redirected to an untrusted host");
            }

            try (InputStream input = connection.getInputStream();
                 ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[4096];
                int total = 0;
                int count;
                while ((count = input.read(buffer)) != -1) {
                    total += count;
                    if (total > MAX_MANIFEST_BYTES) {
                        throw new IOException("Update manifest is too large");
                    }
                    output.write(buffer, 0, count);
                }
                return output.toString(StandardCharsets.UTF_8.name());
            }
        } finally {
            connection.disconnect();
        }
    }

    private UpdateInfo parseUpdateInfo(String json) throws Exception {
        JSONObject object = new JSONObject(json);
        long versionCode = object.getLong("versionCode");
        String versionName = object.getString("versionName").trim();
        String apkUrl = object.getString("apkUrl").trim();
        String sha256 = object.getString("sha256")
                .trim()
                .toLowerCase(Locale.ROOT);
        String notes = object.optString("notes", "").trim();
        boolean mandatory = object.optBoolean("mandatory", false);

        if (versionCode <= 0L || versionName.isEmpty()) {
            throw new IllegalArgumentException("Invalid update version");
        }
        if (!isTrustedApkUrl(Uri.parse(apkUrl))) {
            throw new IllegalArgumentException("Untrusted APK URL");
        }
        if (!sha256.matches("[0-9a-f]{64}")) {
            throw new IllegalArgumentException("Invalid APK SHA-256");
        }
        return new UpdateInfo(
                versionCode,
                versionName,
                apkUrl,
                sha256,
                notes,
                mandatory
        );
    }

    private void showUpdateDialog(UpdateInfo update) {
        if (!activityVisible
                || activity.isFinishing()
                || activity.isDestroyed()
                || (updateDialog != null && updateDialog.isShowing())) {
            return;
        }

        availableUpdate = null;
        StringBuilder message = new StringBuilder()
                .append("当前版本：")
                .append(BuildConfig.VERSION_NAME)
                .append("\n新版本：")
                .append(update.versionName);
        if (!update.notes.isEmpty()) {
            message.append("\n\n").append(update.notes);
        }

        AlertDialog.Builder builder = new AlertDialog.Builder(activity)
                .setTitle("发现新版本")
                .setMessage(message.toString())
                .setPositiveButton(
                        "下载并安装",
                        (dialog, which) -> enqueueUpdate(update)
                )
                .setCancelable(!update.mandatory);
        if (!update.mandatory) {
            builder.setNegativeButton("稍后", null);
        }

        updateDialog = builder.create();
        updateDialog.setOnDismissListener(dialog -> updateDialog = null);
        updateDialog.show();
    }

    private void enqueueUpdate(UpdateInfo update) {
        if (getPendingDownloadId() >= 0L) {
            showToast("更新包正在下载");
            return;
        }

        File directory = activity.getExternalFilesDir(
                Environment.DIRECTORY_DOWNLOADS
        );
        if (directory == null || (!directory.exists() && !directory.mkdirs())) {
            showToast("无法创建更新下载目录");
            return;
        }
        deleteOldUpdateFiles(directory);

        String safeVersion = update.versionName.replaceAll(
                "[^0-9A-Za-z._-]",
                "_"
        );
        File apkFile = new File(
                directory,
                "moontvplus-update-" + safeVersion + "-"
                        + System.currentTimeMillis() + ".apk"
        );

        DownloadManager.Request request = new DownloadManager.Request(
                Uri.parse(update.apkUrl)
        );
        request.setTitle("LinTVPlus " + update.versionName);
        request.setDescription("正在下载应用更新");
        request.setMimeType(APK_MIME_TYPE);
        request.setAllowedOverMetered(true);
        request.setAllowedOverRoaming(false);
        request.setNotificationVisibility(
                DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED
        );
        request.setDestinationUri(Uri.fromFile(apkFile));

        try {
            long downloadId = downloadManager.enqueue(request);
            preferences.edit()
                    .putLong(PREF_DOWNLOAD_ID, downloadId)
                    .putString(PREF_APK_PATH, apkFile.getAbsolutePath())
                    .putLong(PREF_VERSION_CODE, update.versionCode)
                    .putString(PREF_VERSION_NAME, update.versionName)
                    .putString(PREF_SHA256, update.sha256)
                    .apply();
            showToast("更新包已开始下载");
        } catch (Exception error) {
            Log.e(TAG, "Unable to enqueue update download", error);
            showToast("无法下载更新包");
        }
    }

    private void inspectPendingDownload() {
        long downloadId = getPendingDownloadId();
        if (downloadId < 0L || verificationInFlight.get()) {
            return;
        }

        DownloadManager.Query query = new DownloadManager.Query()
                .setFilterById(downloadId);
        try (Cursor cursor = downloadManager.query(query)) {
            if (cursor == null || !cursor.moveToFirst()) {
                clearPendingDownload(true);
                return;
            }
            int status = cursor.getInt(
                    cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)
            );
            if (status == DownloadManager.STATUS_SUCCESSFUL) {
                verifyPendingDownload(downloadId);
            } else if (status == DownloadManager.STATUS_FAILED) {
                clearPendingDownload(true);
                showToast("更新包下载失败");
            }
        } catch (Exception error) {
            Log.w(TAG, "Unable to inspect update download", error);
        }
    }

    private void verifyPendingDownload(long downloadId) {
        if (!verificationInFlight.compareAndSet(false, true)) {
            return;
        }

        String apkPath = preferences.getString(PREF_APK_PATH, "");
        String expectedSha256 = preferences.getString(PREF_SHA256, "");
        long expectedVersionCode = preferences.getLong(PREF_VERSION_CODE, -1L);
        File apkFile = new File(apkPath == null ? "" : apkPath);

        executor.execute(() -> {
            VerificationResult result = verifyApk(
                    apkFile,
                    expectedSha256 == null ? "" : expectedSha256,
                    expectedVersionCode
            );
            verificationInFlight.set(false);
            runOnUiThread(() -> {
                if (downloadId != getPendingDownloadId()) {
                    return;
                }
                if (!result.valid) {
                    Log.e(TAG, "Downloaded APK rejected: " + result.reason);
                    clearPendingDownload(true);
                    showToast("更新包校验失败，已取消安装");
                    return;
                }
                if (activityVisible) {
                    requestPackageInstall(downloadId);
                }
            });
        });
    }

    private VerificationResult verifyApk(
            File apkFile,
            String expectedSha256,
            long expectedVersionCode
    ) {
        try {
            if (!apkFile.isFile() || apkFile.length() <= 0L) {
                return VerificationResult.failure("APK file is missing");
            }
            String actualSha256 = sha256(apkFile);
            if (!MessageDigest.isEqual(
                    actualSha256.getBytes(StandardCharsets.US_ASCII),
                    expectedSha256.getBytes(StandardCharsets.US_ASCII)
            )) {
                return VerificationResult.failure("SHA-256 mismatch");
            }

            PackageManager packageManager = activity.getPackageManager();
            int signatureFlag = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                    ? PackageManager.GET_SIGNING_CERTIFICATES
                    : PackageManager.GET_SIGNATURES;
            PackageInfo archiveInfo = packageManager.getPackageArchiveInfo(
                    apkFile.getAbsolutePath(),
                    signatureFlag
            );
            if (archiveInfo == null) {
                return VerificationResult.failure("APK package cannot be read");
            }
            if (!activity.getPackageName().equals(archiveInfo.packageName)) {
                return VerificationResult.failure("Package name mismatch");
            }

            long archiveVersionCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                    ? archiveInfo.getLongVersionCode()
                    : archiveInfo.versionCode;
            if (archiveVersionCode != expectedVersionCode
                    || archiveVersionCode <= BuildConfig.VERSION_CODE) {
                return VerificationResult.failure("Version code mismatch");
            }

            PackageInfo installedInfo = packageManager.getPackageInfo(
                    activity.getPackageName(),
                    signatureFlag
            );
            if (!hasMatchingSigner(installedInfo, archiveInfo)) {
                return VerificationResult.failure("Signing certificate mismatch");
            }
            return VerificationResult.success();
        } catch (Exception error) {
            return VerificationResult.failure(error.getMessage());
        }
    }

    private void requestPackageInstall(long downloadId) {
        if (!canRequestPackageInstalls()) {
            showInstallPermissionDialog();
            return;
        }

        Uri apkUri = downloadManager.getUriForDownloadedFile(downloadId);
        if (apkUri == null) {
            clearPendingDownload(true);
            showToast("无法打开更新包");
            return;
        }

        Intent installIntent = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(apkUri, APK_MIME_TYPE);
        installIntent.setClipData(
                ClipData.newRawUri("LinTVPlus update", apkUri)
        );
        installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            activity.startActivity(installIntent);
            clearPendingMetadata();
        } catch (Exception error) {
            Log.e(TAG, "Unable to launch package installer", error);
            showToast("无法打开系统安装器");
        }
    }

    private boolean canRequestPackageInstalls() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O
                || activity.getPackageManager().canRequestPackageInstalls();
    }

    private void showInstallPermissionDialog() {
        if (!activityVisible
                || (installPermissionDialog != null
                && installPermissionDialog.isShowing())) {
            return;
        }

        installPermissionDialog = new AlertDialog.Builder(activity)
                .setTitle("需要安装权限")
                .setMessage("请在系统设置中允许 LinTVPlus 安装未知应用，返回后会继续安装。")
                .setPositiveButton("打开设置", (dialog, which) -> {
                    preferences.edit()
                            .putBoolean(PREF_WAITING_INSTALL_PERMISSION, true)
                            .apply();
                    Intent settingsIntent = new Intent(
                            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                            Uri.parse("package:" + activity.getPackageName())
                    );
                    try {
                        activity.startActivity(settingsIntent);
                    } catch (Exception error) {
                        preferences.edit()
                                .putBoolean(PREF_WAITING_INSTALL_PERMISSION, false)
                                .apply();
                        clearPendingDownload(true);
                        showToast("无法打开安装权限设置");
                    }
                })
                .setNegativeButton("取消", (dialog, which) ->
                        clearPendingDownload(true))
                .create();
        installPermissionDialog.setOnDismissListener(
                dialog -> installPermissionDialog = null
        );
        installPermissionDialog.show();
    }

    private long getPendingDownloadId() {
        return preferences.getLong(PREF_DOWNLOAD_ID, -1L);
    }

    private void clearPendingDownload(boolean deleteFile) {
        long downloadId = getPendingDownloadId();
        String apkPath = preferences.getString(PREF_APK_PATH, "");
        clearPendingMetadata();

        if (!deleteFile) {
            return;
        }
        if (downloadId >= 0L) {
            try {
                downloadManager.remove(downloadId);
            } catch (Exception error) {
                Log.w(TAG, "Unable to remove update download", error);
            }
        }
        if (apkPath != null && !apkPath.isEmpty()) {
            File apkFile = new File(apkPath);
            if (apkFile.exists() && !apkFile.delete()) {
                Log.w(TAG, "Unable to delete rejected update APK");
            }
        }
    }

    private void clearPendingMetadata() {
        preferences.edit()
                .remove(PREF_DOWNLOAD_ID)
                .remove(PREF_APK_PATH)
                .remove(PREF_VERSION_CODE)
                .remove(PREF_VERSION_NAME)
                .remove(PREF_SHA256)
                .remove(PREF_WAITING_INSTALL_PERMISSION)
                .apply();
    }

    private void deleteOldUpdateFiles(File directory) {
        File[] files = directory.listFiles((dir, name) ->
                name.startsWith("moontvplus-update-") && name.endsWith(".apk"));
        if (files == null) {
            return;
        }
        for (File file : files) {
            if (!file.delete()) {
                Log.w(TAG, "Unable to delete old update APK: " + file.getName());
            }
        }
    }

    private boolean isTrustedManifestUrl(Uri uri) {
        if (uri == null || !"https".equalsIgnoreCase(uri.getScheme())) {
            return false;
        }
        String host = uri.getHost();
        if (host == null) {
            return false;
        }
        host = host.toLowerCase(Locale.ROOT);
        if ("github.com".equals(host)) {
            String path = uri.getPath();
            return path != null && path.startsWith(repositoryPathPrefix());
        }
        return "githubusercontent.com".equals(host)
                || host.endsWith(".githubusercontent.com");
    }

    private boolean isTrustedApkUrl(Uri uri) {
        if (uri == null
                || !"https".equalsIgnoreCase(uri.getScheme())
                || !"github.com".equalsIgnoreCase(uri.getHost())) {
            return false;
        }
        String path = uri.getPath();
        return path != null
                && path.startsWith(
                repositoryPathPrefix() + "releases/download/android-mobile-v"
        )
                && path.endsWith(".apk");
    }

    private String repositoryPathPrefix() {
        String repository = BuildConfig.UPDATE_REPOSITORY.trim();
        if (!repository.matches("[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+")) {
            return "/invalid-update-repository/";
        }
        return "/" + repository + "/";
    }

    private static String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) {
                digest.update(buffer, 0, count);
            }
        }
        StringBuilder result = new StringBuilder(64);
        for (byte value : digest.digest()) {
            result.append(String.format(Locale.ROOT, "%02x", value & 0xff));
        }
        return result.toString();
    }

    private static boolean hasMatchingSigner(
            PackageInfo installedInfo,
            PackageInfo archiveInfo
    ) {
        Signature[] installedSignatures = getSignatures(installedInfo, true);
        Signature[] archiveSignatures = getSignatures(archiveInfo, false);
        for (Signature installed : installedSignatures) {
            for (Signature archive : archiveSignatures) {
                if (MessageDigest.isEqual(
                        installed.toByteArray(),
                        archive.toByteArray()
                )) {
                    return true;
                }
            }
        }
        return false;
    }

    @SuppressWarnings("deprecation")
    private static Signature[] getSignatures(
            PackageInfo packageInfo,
            boolean includeSigningHistory
    ) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            if (packageInfo.signingInfo == null) {
                return new Signature[0];
            }
            if (includeSigningHistory && !packageInfo.signingInfo.hasMultipleSigners()) {
                return packageInfo.signingInfo.getSigningCertificateHistory();
            }
            return packageInfo.signingInfo.getApkContentsSigners();
        }
        return packageInfo.signatures == null
                ? new Signature[0]
                : packageInfo.signatures;
    }

    private void runOnUiThread(Runnable action) {
        activity.runOnUiThread(() -> {
            if (!activity.isFinishing() && !activity.isDestroyed()) {
                action.run();
            }
        });
    }

    private void showToast(String message) {
        if (!activityVisible || activity.isFinishing() || activity.isDestroyed()) {
            return;
        }
        Toast.makeText(activity, message, Toast.LENGTH_SHORT).show();
    }

    private static final class UpdateInfo {
        private final long versionCode;
        private final String versionName;
        private final String apkUrl;
        private final String sha256;
        private final String notes;
        private final boolean mandatory;

        private UpdateInfo(
                long versionCode,
                String versionName,
                String apkUrl,
                String sha256,
                String notes,
                boolean mandatory
        ) {
            this.versionCode = versionCode;
            this.versionName = versionName;
            this.apkUrl = apkUrl;
            this.sha256 = sha256;
            this.notes = notes;
            this.mandatory = mandatory;
        }
    }

    private static final class VerificationResult {
        private final boolean valid;
        private final String reason;

        private VerificationResult(boolean valid, String reason) {
            this.valid = valid;
            this.reason = reason;
        }

        private static VerificationResult success() {
            return new VerificationResult(true, "");
        }

        private static VerificationResult failure(String reason) {
            return new VerificationResult(
                    false,
                    reason == null ? "Unknown verification error" : reason
            );
        }
    }
}
