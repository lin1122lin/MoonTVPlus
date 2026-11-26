package com.moontvplus.mobile;

import org.junit.Test;
import static org.junit.Assert.*;
import java.net.InetAddress;

public class DownloadSafetyTest {
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
