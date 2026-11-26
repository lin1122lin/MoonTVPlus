package com.moontvplus.mobile;

import android.content.Context;
import android.net.Uri;
import android.webkit.CookieManager;
import androidx.media3.database.StandaloneDatabaseProvider;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.cache.CacheDataSource;
import androidx.media3.datasource.cache.NoOpCacheEvictor;
import androidx.media3.datasource.cache.SimpleCache;
import androidx.media3.datasource.okhttp.OkHttpDataSource;
import androidx.media3.exoplayer.offline.DownloadManager;
import androidx.media3.exoplayer.offline.DownloadRequest;
import androidx.media3.exoplayer.offline.DownloadService;
import androidx.media3.common.MimeTypes;
import java.io.File;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.Executors;
import okhttp3.Dns;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import org.json.JSONObject;

final class OfflineDownloads {
    private static DownloadManager manager;
    private static SimpleCache cache;

    static synchronized DownloadManager manager(Context context) {
        if (manager != null) return manager;
        Context app = context.getApplicationContext();
        StandaloneDatabaseProvider database = new StandaloneDatabaseProvider(app);
        // 下载文件不放在 cacheDir，只有用户删除任务时才清理。
        cache = new SimpleCache(new File(app.getFilesDir(), "offline-video"), new NoOpCacheEvictor(), database);
        CookieManager cookies = CookieManager.getInstance();
        Uri site = Uri.parse(BuildConfig.BASE_URL);
        OkHttpClient client = new OkHttpClient.Builder()
                .dns(host -> {
                    List<InetAddress> addresses = Dns.SYSTEM.lookup(host);
                    for (InetAddress address : addresses) {
                        if (DownloadSafety.isPrivateAddress(address)) throw new UnknownHostException("不允许下载内网地址");
                    }
                    return addresses;
                })
                .addNetworkInterceptor(chain -> {
                    Request original = chain.request();
                    Request.Builder request = original.newBuilder().removeHeader("Cookie");
                    Uri target = Uri.parse(original.url().toString());
                    // 每次重定向都重新检查，站点 Cookie 不发送给外部视频 CDN。
                    if (sameOrigin(site, target)) {
                        String cookie = cookies.getCookie(target.toString());
                        if (cookie != null) request.header("Cookie", cookie);
                    }
                    return chain.proceed(request.build());
                }).build();
        DataSource.Factory network = new OkHttpDataSource.Factory(client).setUserAgent("LinTVPlusAndroidMobile");
        manager = new DownloadManager(app, database, cache, network, Executors.newFixedThreadPool(4));
        manager.setMaxParallelDownloads(2);
        return manager;
    }

    static boolean sameOrigin(Uri left, Uri right) {
        return left.getScheme() != null && left.getScheme().equalsIgnoreCase(right.getScheme())
                && left.getHost() != null && left.getHost().equalsIgnoreCase(right.getHost())
                && effectivePort(left) == effectivePort(right);
    }

    private static int effectivePort(Uri uri) {
        return uri.getPort() >= 0 ? uri.getPort() : ("https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80);
    }

    static void enqueue(Context context, JSONObject task) throws Exception {
        String url = task.getString("url");
        DownloadSafety.validateUrl(url);
        String title = task.optString("title", "视频");
        if (title.length() > 300) throw new IllegalArgumentException("标题过长");
        String id = DownloadSafety.taskId(task.optString("source"), task.optString("videoId"), task.optInt("episodeIndex", 0), url);
        DownloadRequest request = new DownloadRequest.Builder(id, Uri.parse(url))
                .setMimeType(task.optString("mediaType", "hls").equals("file") ? MimeTypes.VIDEO_MP4 : MimeTypes.APPLICATION_M3U8)
                .setData(task.toString().getBytes(StandardCharsets.UTF_8)).build();
        manager(context).resumeDownloads();
        DownloadService.sendAddDownload(context, OfflineDownloadService.class, request, true);
    }

    static CacheDataSource.Factory offlineFactory(Context context) {
        manager(context);
        // 缺失的分片直接报错，不偷偷重新请求网络。
        return new CacheDataSource.Factory().setCache(cache).setUpstreamDataSourceFactory(null)
                .setFlags(CacheDataSource.FLAG_BLOCK_ON_CACHE);
    }

    static String title(DownloadRequest request) {
        try { return new JSONObject(new String(request.data, StandardCharsets.UTF_8)).optString("title", "视频"); }
        catch (Exception error) { return "视频"; }
    }
}
