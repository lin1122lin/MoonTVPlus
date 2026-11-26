package com.moontvplus.mobile;

import org.junit.Test;
import static org.junit.Assert.*;

public class LocalPlaylistTest {
    private byte[] clear() {
        byte[] value = new byte[188 * 5];
        for (int index = 0; index < 5; index++) value[index * 188] = 0x47;
        return value;
    }
    @Test public void preservesEncryptedButRemovesStaleKeysForPlaintextTs() throws Exception {
        String key = "#EXT-X-KEY:METHOD=AES-128,URI=\"key.key\"";
        String playlist = "#EXTM3U\n" + key + "\n#EXTINF:10,\nsegment_0.ts\n#EXT-X-ENDLIST";
        assertFalse(LocalPlaylist.forPlayback(playlist, name -> true).contains("#EXT-X-KEY"));
        assertTrue(LocalPlaylist.forPlayback(playlist, name -> false).contains(key));
        assertTrue(LocalPlaylist.forPlayback(playlist.replace("AES-128", "SAMPLE-AES"), name -> true).contains("SAMPLE-AES"));
    }
    @Test public void supportsMixedOldPlaintextAndEncryptedSegments() throws Exception {
        String key = "#EXT-X-KEY:URI=\"key.key\",METHOD=AES-128";
        String result = LocalPlaylist.forPlayback("#EXTM3U\n" + key + "\n#EXTINF:10,\nsegment_0.ts\n#EXTINF:10,\nsegment_1.ts", name -> name.equals("segment_1.ts"));
        assertTrue(result.contains(key));
        assertTrue(result.contains("#EXT-X-KEY:METHOD=NONE\nsegment_1.ts"));
    }
    @Test public void neverAssumesShortOrRandomFilesAreClear() {
        assertFalse(LocalPlaylist.isClearTs(null));
        assertFalse(LocalPlaylist.isClearTs(new byte[188]));
        assertFalse(LocalPlaylist.isClearTs(new byte[188 * 5]));
    }
    private byte[] boxes(String first, int size, String second) {
        byte[] data = new byte[size + 16];
        data[3] = (byte) size;
        System.arraycopy(first.getBytes(java.nio.charset.StandardCharsets.US_ASCII), 0, data, 4, 4);
        System.arraycopy("isom".getBytes(java.nio.charset.StandardCharsets.US_ASCII), 0, data, 8, 4);
        data[size + 3] = 32;
        System.arraycopy(second.getBytes(java.nio.charset.StandardCharsets.US_ASCII), 0, data, size + 4, 4);
        return data;
    }
    @Test public void recognizesBoundedInitAndMediaMp4Boxes() throws Exception {
        assertTrue(LocalPlaylist.isClearMp4(boxes("ftyp", 24, "moov")));
        assertTrue(LocalPlaylist.isClearMp4(boxes("styp", 24, "moof")));
        assertTrue(LocalPlaylist.isClearMp4(boxes("moof", 32, "mdat")));
        assertFalse(LocalPlaylist.isClearMp4(boxes("ftyp", 24, "xxxx")));
        byte[] invalid = boxes("ftyp", 24, "moov"); invalid[0] = 127;
        assertFalse(LocalPlaylist.isClearMp4(invalid));
        assertFalse(LocalPlaylist.isClearMp4(new byte[4096]));
        String result = LocalPlaylist.forPlayback("#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key.key\"\n#EXTINF:10,\nsegment_0.ts", name -> LocalPlaylist.isClearMp4(boxes("ftyp", 24, "moov")));
        assertFalse(result.contains("#EXT-X-KEY"));
    }
    @Test public void recognizesLargeMoofWithoutLoadingWholeBox() {
        byte[] header = boxes("moof", 32, "mdat"); header[2] = 32; header[3] = 0;
        byte[] next = new byte[]{0, 0, 16, 0, 'm', 'd', 'a', 't'};
        assertEquals(8192, LocalPlaylist.firstBoxSize(header));
        assertFalse(LocalPlaylist.isClearMp4(header));
        assertTrue(LocalPlaylist.isClearMp4(header, next));
        assertFalse(LocalPlaylist.isClearMp4(header, new byte[7]));
    }
}
