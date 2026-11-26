package com.moontvplus.mobile;

import org.junit.Test;
import static org.junit.Assert.*;
import java.net.InetAddress;

public class DownloadSafetyTest {
    @Test public void acceptsOnlyLocalMediaNames() {
        for (String name : new String[]{"playlist.m3u8", "key.key", "segment_0.ts", "segment_00042.ts"}) {
            assertTrue(name, DownloadSafety.isLocalMediaName(name));
        }
        for (String name : new String[]{null, "", ".", "..", "../key.key", "dir/segment_0.ts",
                "dir\\segment_0.ts", "/playlist.m3u8", "%2e%2e%2fkey.key", "https://example.com/segment_0.ts",
                "segment_-1.ts", "segment_1.ts?token=x", "segment_1.ts#x", "segment_1.ts\n", "segment_1.ts\0",
                "SEGMENT_1.TS", "video.mp4"}) {
            assertFalse(String.valueOf(name), DownloadSafety.isLocalMediaName(name));
        }
    }
    @Test public void rejectsUnsafeSchemesAndCredentials() {
        for (String url : new String[]{"file:///etc/passwd", "javascript:alert(1)", "https://user:pass@example.com/a", "bad"}) {
            try { DownloadSafety.validateUrl(url); fail(url); } catch (IllegalArgumentException expected) { }
        }
        assertEquals("cdn.example.com", DownloadSafety.validateUrl("https://cdn.example.com/a.m3u8").getHost());
    }
    @Test public void keepsEpisodeIdentityAcrossSignedUrlRefreshes() {
        assertEquals(DownloadSafety.taskId("source", "42", 0, "https://a/?old"), DownloadSafety.taskId("source", "42", 0, "https://a/?new"));
        assertNotEquals(DownloadSafety.taskId("source", "42", 0, "https://a"), DownloadSafety.taskId("source", "42", 1, "https://a"));
    }
    @Test public void blocksPrivateDnsResults() throws Exception {
        assertTrue(DownloadSafety.isPrivateAddress(InetAddress.getByName("127.0.0.1")));
        assertTrue(DownloadSafety.isPrivateAddress(InetAddress.getByName("192.168.1.1")));
        assertTrue(DownloadSafety.isPrivateAddress(InetAddress.getByName("::1")));
        assertFalse(DownloadSafety.isPrivateAddress(InetAddress.getByName("8.8.8.8")));
    }
}
