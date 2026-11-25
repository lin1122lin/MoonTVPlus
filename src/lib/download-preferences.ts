import type { CompletedTask } from './download-db';

export function getPreferredDownloadMode(
  saved: string | null,
  userAgent: string
): CompletedTask['downloadMode'] {
  // Android WebView 的原生下载监听不接受 Blob URL，改用现有应用内缓存。
  if (
    saved === 'browser' &&
    /Android/i.test(userAgent) &&
    /; wv\)|MoonTVPlusAndroidMobile/i.test(userAgent)
  ) {
    return 'indexeddb';
  }
  if (saved === 'browser' || saved === 'filesystem' || saved === 'indexeddb') {
    return saved;
  }
  return /Android|iPhone|iPad|iPod/i.test(userAgent) ? 'indexeddb' : 'browser';
}
