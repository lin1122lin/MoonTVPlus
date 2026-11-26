package com.moontvplus.mobile;

import android.app.Activity;
import android.os.Bundle;
import android.view.WindowManager;
import android.widget.Toast;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.common.PlaybackException;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.offline.Download;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.PlayerView;

public final class OfflinePlayerActivity extends Activity {
    private ExoPlayer player;
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        try {
            Download download = OfflineDownloads.manager(this).getDownloadIndex().getDownload(getIntent().getStringExtra("downloadId"));
            if (download == null || download.state != Download.STATE_COMPLETED) throw new IllegalStateException("下载未完成");
            PlayerView view = new PlayerView(this); setContentView(view);
            view.setOnApplyWindowInsetsListener((target, insets) -> {
                target.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
                return insets;
            });
            view.setFullscreenButtonClickListener(fullscreen -> setRequestedOrientation(fullscreen
                    ? android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                    : android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED));
            player = new ExoPlayer.Builder(this).setMediaSourceFactory(new DefaultMediaSourceFactory(OfflineDownloads.offlineFactory(this))).build();
            view.setPlayer(player);
            player.addListener(new Player.Listener() {
                @Override public void onPlayerError(PlaybackException error) { Toast.makeText(OfflinePlayerActivity.this, "本地视频播放失败：" + error.getErrorCodeName(), Toast.LENGTH_LONG).show(); }
            });
            player.setMediaItem(MediaItem.fromUri(download.request.uri).buildUpon().setMimeType(download.request.mimeType).build());
            player.seekTo(getPreferences(MODE_PRIVATE).getLong(download.request.id, 0));
            currentDownloadId = download.request.id;
            player.prepare(); player.play(); getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        } catch (Exception error) { Toast.makeText(this, "无法读取已下载视频", Toast.LENGTH_LONG).show(); finish(); }
    }
    private String currentDownloadId;
    @Override public void onPause() {
        if (player != null) {
            if (currentDownloadId != null) getPreferences(MODE_PRIVATE).edit().putLong(currentDownloadId, player.getCurrentPosition()).apply();
            player.pause();
        }
        super.onPause();
    }
    @Override public void onDestroy() { if (player != null) player.release(); super.onDestroy(); }
}
