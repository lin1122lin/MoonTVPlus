package com.moontvplus.mobile;

import android.content.Context;
import android.net.Uri;
import android.provider.OpenableColumns;
import org.json.JSONArray;
import org.json.JSONObject;

final class LocalVideoFiles {
    static JSONArray all(Context context) {
        try { return new JSONArray(context.getSharedPreferences("local-video-files", 0).getString("files", "[]")); }
        catch (Exception error) { return new JSONArray(); }
    }
    static void remember(Context context, Uri uri, String title, boolean folder) throws Exception {
        JSONArray next = new JSONArray();
        next.put(new JSONObject().put("uri", uri.toString()).put("title", title).put("folder", folder));
        JSONArray old = all(context);
        for (int i = 0; i < old.length() && next.length() < 20; i++) {
            JSONObject row = old.getJSONObject(i);
            if (!uri.toString().equals(row.optString("uri"))) next.put(row);
        }
        context.getSharedPreferences("local-video-files", 0).edit().putString("files", next.toString()).apply();
    }
    static void forget(Context context, String uri) {
        JSONArray old = all(context), next = new JSONArray();
        for (int i = 0; i < old.length(); i++) { JSONObject row = old.optJSONObject(i); if (row != null && !uri.equals(row.optString("uri"))) next.put(row); }
        context.getSharedPreferences("local-video-files", 0).edit().putString("files", next.toString()).apply();
    }
    static String title(Context context, Uri uri) {
        if (android.provider.DocumentsContract.isTreeUri(uri)) {
            try {
                androidx.documentfile.provider.DocumentFile directory = androidx.documentfile.provider.DocumentFile.fromTreeUri(context, uri);
                String name = directory == null ? null : directory.getName();
                if (name != null && !name.trim().isEmpty()) return name;
            } catch (Exception ignored) { }
        }
        try (android.database.Cursor cursor = context.getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                String name = cursor.getString(0);
                if (name != null && !name.trim().isEmpty()) return name;
            }
        } catch (Exception ignored) { }
        return "本机视频";
    }
}
