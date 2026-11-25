import { getPreferredDownloadMode } from './download-preferences';

describe('download mode compatibility', () => {
  it('defaults phones to in-app storage without changing existing preferences', () => {
    expect(getPreferredDownloadMode(null, 'Android; wv')).toBe('indexeddb');
    expect(getPreferredDownloadMode(null, 'iPhone')).toBe('indexeddb');
    expect(getPreferredDownloadMode(null, 'Windows NT')).toBe('browser');
    for (const mode of ['browser', 'filesystem', 'indexeddb'] as const) {
      expect(getPreferredDownloadMode(mode, 'Android; wv')).toBe(mode);
    }
    expect(getPreferredDownloadMode('invalid', 'Android')).toBe('indexeddb');
  });

  it('uses in-app storage for unsupported WebView Blob exports without changing browser downloads', () => {
    const webView =
      'Mozilla/5.0 (Linux; Android 14; Pixel; wv) AppleWebKit/537.36';
    expect(getPreferredDownloadMode('browser', webView)).toBe('indexeddb');
    expect(getPreferredDownloadMode('browser', 'Android Chrome/130')).toBe(
      'browser'
    );
    expect(getPreferredDownloadMode('filesystem', webView)).toBe('filesystem');
  });
});
