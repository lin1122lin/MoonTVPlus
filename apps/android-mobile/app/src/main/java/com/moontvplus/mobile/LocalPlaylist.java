package com.moontvplus.mobile;

import java.io.IOException;
import java.util.Objects;

final class LocalPlaylist {
    interface SegmentKind { boolean isClear(String name) throws IOException; }

    static boolean isClearTs(byte[] bytes) {
        if (bytes == null || bytes.length < 188 * 5) return false;
        for (int index = 0; index < 5; index++) if (bytes[index * 188] != 0x47) return false;
        return true;
    }

    static boolean isClearMp4(byte[] bytes) {
        long size = firstBoxSize(bytes);
        if (size < 8 || size > bytes.length - 8) return false;
        return isClearMp4(bytes, java.util.Arrays.copyOfRange(bytes, (int) size, (int) size + 8));
    }

    static long firstBoxSize(byte[] bytes) {
        if (bytes == null || bytes.length < 8) return -1;
        return ((bytes[0] & 255L) << 24) | ((bytes[1] & 255L) << 16) | ((bytes[2] & 255L) << 8) | (bytes[3] & 255L);
    }

    static boolean isClearMp4(byte[] first, byte[] following) {
        long size = firstBoxSize(first), nextSize = firstBoxSize(following);
        if (size < 8 || nextSize < 8) return false;
        String type = new String(first, 4, 4, java.nio.charset.StandardCharsets.US_ASCII);
        String next = new String(following, 4, 4, java.nio.charset.StandardCharsets.US_ASCII);
        if (type.equals("moof")) return next.equals("mdat");
        if ((!type.equals("ftyp") && !type.equals("styp")) || size < 16 || size % 4 != 0 || first.length < 16) return false;
        String brand = new String(first, 8, 4, java.nio.charset.StandardCharsets.US_ASCII);
        return java.util.Arrays.asList("isom", "iso2", "iso5", "iso6", "mp41", "mp42", "avc1", "dash", "cmfc", "cmfs", "MSNV").contains(brand)
                && (next.equals("moov") || next.equals("moof"));
    }

    static String forPlayback(String playlist, SegmentKind reader) throws IOException {
        String key = null, emittedKey = null;
        StringBuilder output = new StringBuilder();
        for (String line : playlist.split("\\r?\\n")) {
            String value = line.trim();
            if (value.startsWith("#EXT-X-KEY:")) {
                key = value.equals("#EXT-X-KEY:METHOD=NONE") ? null : value;
                continue;
            }
            if (value.matches("segment_\\d+\\.ts")) {
                String required = key;
                // 旧网页下载器保存过已解密 TS 却保留 AES 标签，只在确定明文时兼容。
                if (key != null && key.matches(".*(?:KEY:|,)METHOD=AES-128(?:,.*)?")
                        && (!key.contains("KEYFORMAT=") || key.contains("KEYFORMAT=\"identity\""))
                        && reader.isClear(value)) required = null;
                if (!Objects.equals(required, emittedKey)) {
                    output.append(required == null ? "#EXT-X-KEY:METHOD=NONE" : required).append('\n');
                    emittedKey = required;
                }
            }
            output.append(line).append('\n');
        }
        return output.toString();
    }

}
