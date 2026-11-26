package com.moontvplus.mobile;

import android.content.Context;
import android.net.Uri;
import androidx.documentfile.provider.DocumentFile;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.ResolvingDataSource;
import androidx.media3.datasource.DataSource;
import java.io.IOException;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import android.util.Base64;
import java.util.HashMap;
import java.util.Map;

final class LocalFolderSource {
    private static final Uri PLAYLIST_URI = Uri.parse("lintvplus-local:///playlist.m3u8");
    static DataSource.Factory factory(Context context, Uri tree) {
        DocumentFile directory = DocumentFile.fromTreeUri(context, tree);
        return new ResolvingDataSource.Factory(new DefaultDataSource.Factory(context), new ResolvingDataSource.Resolver() {
            private Map<String, Uri> children;
            private Uri playbackPlaylist;
            @Override public synchronized DataSpec resolveDataSpec(DataSpec spec) throws IOException {
                if (!"lintvplus-local".equals(spec.uri.getScheme()) || (spec.uri.getAuthority() != null
                        && !spec.uri.getAuthority().isEmpty()) || directory == null) throw new IOException("只允许读取已授权的本地目录");
                if (children == null) {
                    children = new HashMap<>();
                    for (DocumentFile file : directory.listFiles()) if (file.isFile() && DownloadSafety.isLocalMediaName(file.getName())) children.put(file.getName(), file.getUri());
                }
                String name = spec.uri.getLastPathSegment();
                if (!DownloadSafety.isLocalMediaName(name) || !("/" + name).equals(spec.uri.getPath())
                        || spec.uri.getQuery() != null || !children.containsKey(name)) throw new IOException("未找到本地视频分片或请求了目录外文件");
                if ("playlist.m3u8".equals(name)) {
                    if (playbackPlaylist == null) {
                        String original = new String(read(context, children.get(name), 2 * 1024 * 1024, true), StandardCharsets.UTF_8);
                        String normalized = LocalPlaylist.forPlayback(original, segment -> {
                            Uri file = children.get(segment);
                            if (file == null) throw new IOException("缺少本地分片：" + segment);
                            return isClear(context, file);
                        });
                        playbackPlaylist = Uri.parse("data:application/vnd.apple.mpegurl;base64,"
                                + Base64.encodeToString(normalized.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP));
                    }
                    return spec.withUri(playbackPlaylist);
                }
                return spec.withUri(children.get(name));
            }
            @Override public synchronized Uri resolveReportedUri(Uri uri) {
                // SAF 文档 URI 不能直接解析相对分片名，播放器始终使用本地虚拟路径。
                if (uri.equals(playbackPlaylist)) return PLAYLIST_URI;
                if (children != null) for (Map.Entry<String, Uri> child : children.entrySet()) {
                    if (child.getValue().equals(uri)) return Uri.parse("lintvplus-local:///" + child.getKey());
                }
                return uri;
            }
        });
    }
    private static boolean isClear(Context context, Uri file) throws IOException {
        byte[] prefix = read(context, file, 4096, false);
        if (LocalPlaylist.isClearTs(prefix) || LocalPlaylist.isClearMp4(prefix)) return true;
        long offset = LocalPlaylist.firstBoxSize(prefix);
        if (offset < prefix.length - 8 || prefix.length < 8) return false;
        String type = new String(prefix, 4, 4, StandardCharsets.US_ASCII);
        if (!type.equals("moof") && !type.equals("ftyp") && !type.equals("styp")) return false;
        try (InputStream stream = context.getContentResolver().openInputStream(file)) {
            if (stream == null) return false;
            long remaining = offset;
            while (remaining > 0) {
                long skipped = stream.skip(remaining);
                if (skipped > 0) remaining -= skipped;
                else if (stream.read() < 0) return false;
                else remaining--;
            }
            byte[] following = new byte[8];
            int count = 0;
            while (count < following.length) {
                int read = stream.read(following, count, following.length - count);
                if (read < 0) return false;
                count += read;
            }
            return LocalPlaylist.isClearMp4(prefix, following);
        }
    }
    private static byte[] read(Context context, Uri uri, int limit, boolean entire) throws IOException {
        try (InputStream stream = context.getContentResolver().openInputStream(uri)) {
            if (stream == null) throw new IOException("无法读取本地文件");
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            while (output.size() < limit) {
                int count = stream.read(buffer, 0, Math.min(buffer.length, limit - output.size()));
                if (count < 0) break;
                output.write(buffer, 0, count);
            }
            if (entire && stream.read() != -1) throw new IOException("本地播放列表过大");
            return output.toByteArray();
        }
    }
    static Uri playlist(Context context, Uri tree) throws IOException {
        DocumentFile directory = DocumentFile.fromTreeUri(context, tree);
        DocumentFile playlist = directory == null ? null : directory.findFile("playlist.m3u8");
        if (playlist == null || !playlist.isFile()) throw new IOException("请选择包含 playlist.m3u8 的单集下载文件夹");
        return PLAYLIST_URI;
    }
}
