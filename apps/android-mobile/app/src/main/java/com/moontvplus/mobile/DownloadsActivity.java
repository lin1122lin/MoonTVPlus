package com.moontvplus.mobile;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.graphics.Color;
import androidx.media3.exoplayer.offline.Download;
import androidx.media3.exoplayer.offline.DownloadCursor;
import androidx.media3.exoplayer.offline.DownloadService;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public final class DownloadsActivity extends Activity {
    private LinearLayout rows;
    private String lastRender = "";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable refresh = new Runnable() { public void run() { render(); handler.postDelayed(this, 1000); } };

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setPadding(24, 56, 24, 32);
        root.setBackgroundColor(Color.rgb(20, 20, 20));
        TextView title = text("我的下载 · 安卓后台下载", 20); root.addView(title);
        LinearLayout navigation = new LinearLayout(this);
        button(navigation, "在线站点", () -> { startActivity(new Intent(this, MainActivity.class)); finish(); });
        button(navigation, "网页缓存", () -> { startActivity(new Intent(this, MainActivity.class).putExtra("showLegacyDownloads", true)); finish(); });
        root.addView(navigation);
        ScrollView scroll = new ScrollView(this); rows = new LinearLayout(this); rows.setOrientation(LinearLayout.VERTICAL);
        scroll.addView(rows); root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1)); setContentView(root);
        OfflineDownloads.manager(this);
    }
    @Override public void onResume() { super.onResume(); handler.post(refresh); }
    @Override public void onPause() { handler.removeCallbacks(refresh); super.onPause(); }

    private void render() {
        List<Download> tasks = new ArrayList<>(); StringBuilder signature = new StringBuilder();
        try (DownloadCursor cursor = OfflineDownloads.manager(this).getDownloadIndex().getDownloads()) {
            while (cursor.moveToNext()) { Download task = cursor.getDownload(); tasks.add(task); signature.append(task.request.id).append(':').append(task.state).append(':').append(task.getBytesDownloaded()).append(';'); }
        } catch (Exception error) { signature.append("error"); }
        if (signature.toString().equals(lastRender) && rows.getChildCount() > 0) return;
        lastRender = signature.toString(); rows.removeAllViews();
        if (tasks.isEmpty()) rows.addView(text("暂无安卓下载任务", 16));
        for (Download task : tasks) {
            LinearLayout row = new LinearLayout(this); row.setOrientation(LinearLayout.VERTICAL); row.setPadding(8, 24, 8, 24);
            row.addView(text(OfflineDownloads.title(task.request), 17));
            float percent = task.getPercentDownloaded();
            String state = task.state == Download.STATE_COMPLETED ? "已完成" : task.state == Download.STATE_FAILED ? "失败，可重试"
                    : task.state == Download.STATE_STOPPED ? "已暂停" : task.state == Download.STATE_DOWNLOADING ? "下载中" : "等待网络或排队中";
            row.addView(text(state + " · " + String.format(Locale.ROOT, "%.1f MB", task.getBytesDownloaded() / 1048576.0)
                    + (percent >= 0 ? String.format(Locale.ROOT, " · %.0f%%", percent) : ""), 14));
            LinearLayout actions = new LinearLayout(this);
            if (task.state == Download.STATE_COMPLETED) button(actions, "播放", () -> startActivity(new Intent(this, OfflinePlayerActivity.class).putExtra("downloadId", task.request.id)));
            else if (task.state == Download.STATE_DOWNLOADING || task.state == Download.STATE_QUEUED) button(actions, "暂停", () -> DownloadService.sendSetStopReason(this, OfflineDownloadService.class, task.request.id, 1, false));
            else button(actions, "继续 / 重试", () -> {
                OfflineDownloads.manager(this).resumeDownloads();
                DownloadService.sendAddDownload(this, OfflineDownloadService.class, task.request, true);
                DownloadService.sendSetStopReason(this, OfflineDownloadService.class, task.request.id, 0, true);
            });
            button(actions, "删除", () -> new AlertDialog.Builder(this).setMessage("删除此安卓下载及文件？")
                    .setNegativeButton("取消", null).setPositiveButton("删除", (dialog, which) -> DownloadService.sendRemoveDownload(this, OfflineDownloadService.class, task.request.id, true)).show());
            row.addView(actions); rows.addView(row);
        }
    }
    private TextView text(String value, int size) { TextView view = new TextView(this); view.setText(value); view.setTextColor(Color.WHITE); view.setTextSize(size); view.setPadding(0, 8, 0, 8); return view; }
    private void button(LinearLayout parent, String label, Runnable action) { Button button = new Button(this); button.setText(label); button.setOnClickListener(view -> action.run()); parent.addView(button, new LinearLayout.LayoutParams(0, -2, 1)); }
}
