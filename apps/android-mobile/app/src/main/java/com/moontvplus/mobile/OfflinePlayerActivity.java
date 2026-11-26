package com.moontvplus.mobile;

import android.app.Activity;
import android.os.Bundle;
import android.net.Uri;
import android.view.WindowManager;
import android.widget.Toast;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.MimeTypes;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.ResolvingDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.offline.Download;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.PlayerView;
import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class OfflinePlayerActivity extends Activity {
    private ExoPlayer player;
    private final ExecutorService loader = Executors.newSingleThreadExecutor();
    private String currentDownloadId;
    private long savedPosition = -1;
    private boolean destroyed;
    private boolean resumed;
    private boolean initialPlayback = true;
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        if (saved != null) savedPosition = saved.getLong("position", -1);
        if (getIntent().getStringExtra("localUri") == null && getIntent().getStringExtra("localTree") == null) OfflineDownloads.manager(this);
        loader.execute(() -> {
            try {
                String localUri = getIntent().getStringExtra("localUri");
                String localTree = getIntent().getStringExtra("localTree");
                final MediaItem item;
                final DataSource.Factory factory;
                final String identity;
                if (localTree != null) {
                    Uri tree = requireContentUri(localTree);
                    item = new MediaItem.Builder().setUri(LocalFolderSource.playlist(this, tree)).setMimeType(MimeTypes.APPLICATION_M3U8).build();
                    factory = LocalFolderSource.factory(this, tree);
                    identity = "folder:" + tree;
                } else if (localUri != null) {
                    Uri uri = requireContentUri(localUri);
                    String title = LocalVideoFiles.title(this, uri);
                    String mime = getContentResolver().getType(uri);
                    if (title.toLowerCase(java.util.Locale.ROOT).endsWith(".m3u8")
                            || mime != null && (mime.contains("mpegurl") || mime.contains("m3u8")))
                        throw new IOException("分片视频请从本机文件选择完整的单集文件夹");
                    item = MediaItem.fromUri(uri);
                    factory = new ResolvingDataSource.Factory(new DefaultDataSource.Factory(this), spec -> {
                        if (!uri.equals(spec.uri)) throw new IOException("不允许读取所选文件之外的资源");
                        return spec;
                    });
                    identity = "file:" + uri;
                } else {
                    Download download = OfflineDownloads.manager(this).getDownloadIndex().getDownload(getIntent().getStringExtra("downloadId"));
                    if (download == null || download.state != Download.STATE_COMPLETED) throw new IOException("下载未完成");
                    item = new MediaItem.Builder().setUri(download.request.uri).setMimeType(download.request.mimeType).build();
                    factory = OfflineDownloads.offlineFactory(this);
                    identity = download.request.id;
                }
                runOnUiThread(() -> { if (!destroyed && !isFinishing()) startPlayer(item, factory, identity); });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    if (!destroyed && !isFinishing()) {
                        Toast.makeText(this, error instanceof SecurityException ? "文件授权已失效，请重新选择文件或目录" : "无法读取本地视频：" + error.getMessage(), Toast.LENGTH_LONG).show();
                        finish();
                    }
                });
            }
        });
    }

    private static Uri requireContentUri(String value) throws IOException {
        Uri uri = Uri.parse(value);
        if (!"content".equals(uri.getScheme())) throw new IOException("请选择已授权的本机文件");
        return uri;
    }

    private void startPlayer(MediaItem item, DataSource.Factory factory, String identity) {
        try {
            PlayerView view = new PlayerView(this); setContentView(view);
            view.setOnApplyWindowInsetsListener((target, insets) -> {
                target.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
                return insets;
            });
            view.setFullscreenButtonClickListener(fullscreen -> setRequestedOrientation(fullscreen
                    ? android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                    : android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED));
            player = new ExoPlayer.Builder(this).setMediaSourceFactory(new DefaultMediaSourceFactory(factory)).build();
            view.setPlayer(player);
            player.addListener(new Player.Listener() {
                @Override public void onPlayerError(PlaybackException error) { Toast.makeText(OfflinePlayerActivity.this, "本地视频播放失败：" + error.getErrorCodeName(), Toast.LENGTH_LONG).show(); }
            });
            player.setMediaItem(item);
            player.seekTo(savedPosition >= 0 ? savedPosition : getPreferences(MODE_PRIVATE).getLong(identity, 0));
            currentDownloadId = identity;
            player.prepare();
            if (resumed && initialPlayback) { player.play(); initialPlayback = false; }
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        } catch (Exception error) { Toast.makeText(this, "无法读取已下载视频", Toast.LENGTH_LONG).show(); finish(); }
    }
    @Override protected void onSaveInstanceState(Bundle out) {
        if (player != null) out.putLong("position", player.getCurrentPosition());
        super.onSaveInstanceState(out);
    }
    @Override public void onPause() {
        resumed = false; initialPlayback = false;
        if (player != null) {
            if (currentDownloadId != null) getPreferences(MODE_PRIVATE).edit().putLong(currentDownloadId, player.getCurrentPosition()).apply();
            player.pause();
        }
        super.onPause();
    }
    @Override public void onResume() {
        super.onResume(); resumed = true;
        if (player != null && initialPlayback) { player.play(); initialPlayback = false; }
    }
    @Override public void onDestroy() { destroyed = true; loader.shutdownNow(); if (player != null) player.release(); super.onDestroy(); }
}
