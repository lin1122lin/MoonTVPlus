package com.moontvplus.mobile;

import android.app.Notification;
import android.app.PendingIntent;
import android.content.Intent;
import androidx.media3.exoplayer.offline.Download;
import androidx.media3.exoplayer.offline.DownloadManager;
import androidx.media3.exoplayer.offline.DownloadService;
import androidx.media3.exoplayer.scheduler.Scheduler;
import androidx.media3.exoplayer.scheduler.Requirements;
import androidx.media3.ui.DownloadNotificationHelper;
import java.util.List;

public final class OfflineDownloadService extends DownloadService {
    public OfflineDownloadService() { super(1002, 1000, "offline-downloads", R.string.offline_downloads, 0); }
    @Override protected DownloadManager getDownloadManager() { return OfflineDownloads.manager(this); }
    @Override protected Scheduler getScheduler() { return null; }
    @Override protected Notification getForegroundNotification(List<Download> downloads, @Requirements.RequirementFlags int unmet) {
        PendingIntent intent = PendingIntent.getActivity(this, 0, new Intent(this, DownloadsActivity.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new DownloadNotificationHelper(this, "offline-downloads").buildProgressNotification(
                this, android.R.drawable.stat_sys_download, intent, "LinTVPlus 安卓后台下载", downloads, unmet);
    }
    @Override public void onTimeout(int startId, int type) {
        OfflineDownloads.manager(this).pauseDownloads();
        stopSelf();
    }
}
