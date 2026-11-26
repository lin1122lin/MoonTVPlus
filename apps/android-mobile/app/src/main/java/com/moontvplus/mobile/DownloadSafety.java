package com.moontvplus.mobile;

import java.net.URI;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

final class DownloadSafety {
    static boolean isLocalMediaName(String name) {
        return name != null && ("playlist.m3u8".equals(name) || "key.key".equals(name) || name.matches("segment_\\d+\\.ts"));
    }
    static URI validateUrl(String value) {
        if (value == null || value.length() > 8192) throw new IllegalArgumentException("视频地址无效");
        URI uri = URI.create(value);
        String scheme = uri.getScheme();
        if (!("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme))
                || uri.getHost() == null || uri.getUserInfo() != null) {
            throw new IllegalArgumentException("仅支持 HTTP(S) 视频地址");
        }
        return uri;
    }

    static boolean isPrivateAddress(InetAddress address) {
        byte[] bytes = address.getAddress();
        return address.isAnyLocalAddress() || address.isLoopbackAddress()
                || address.isLinkLocalAddress() || address.isSiteLocalAddress()
                || address.isMulticastAddress()
                || (bytes.length == 16 && (bytes[0] & 0xfe) == 0xfc)
                || (bytes.length == 4 && (bytes[0] & 0xff) == 100 && (bytes[1] & 0xc0) == 64);
    }

    static String taskId(String source, String videoId, int episode, String url) {
        if (episode < 0) throw new IllegalArgumentException("集数无效");
        try {
            String key = source.isEmpty() || videoId.isEmpty() ? url : source + "\n" + videoId + "\n" + episode;
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(key.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder();
            for (byte item : hash) result.append(String.format("%02x", item & 0xff));
            return result.toString();
        } catch (java.security.NoSuchAlgorithmException error) { throw new IllegalStateException(error); }
    }
}
