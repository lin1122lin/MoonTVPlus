import {
  androidDownloadsSelected,
  enqueueAndroidDownloads,
  getAndroidDownloadsBridge,
  openAndroidDownloads,
} from './android-downloads';

const bridge = { enqueueDownloads: jest.fn(), openDownloads: jest.fn() };
beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
  Object.defineProperty(window, 'LinTVPlusAndroid', {
    configurable: true,
    value: bridge,
  });
});

it('requires an explicit per-device selection and leaves web downloads as they were', () => {
  expect(androidDownloadsSelected()).toBe(false);
  expect(openAndroidDownloads()).toBe(false);
  localStorage.setItem('downloadMode', 'indexeddb');
  localStorage.setItem('androidDownloadEngine', 'native');
  expect(androidDownloadsSelected()).toBe(true);
  expect(openAndroidDownloads()).toBe(true);
  expect(bridge.openDownloads).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem('downloadMode')).toBe('indexeddb');
});

it('does not mistake the old APK cast bridge for a downloader', () => {
  Object.defineProperty(window, 'LinTVPlusAndroid', {
    configurable: true,
    value: { openCastSettings() {} },
  });
  localStorage.setItem('androidDownloadEngine', 'native');
  expect(getAndroidDownloadsBridge()).toBeUndefined();
  expect(androidDownloadsSelected()).toBe(false);
});

it('sends one validated batch and refuses unsafe addresses or invalid indices', () => {
  enqueueAndroidDownloads([
    { title: '测试', url: '/video.m3u8', episodeIndex: 0, mediaType: 'hls' },
  ]);
  const tasks = JSON.parse(bridge.enqueueDownloads.mock.calls[0][0]);
  expect(tasks[0].url).toBe(
    new URL('/video.m3u8', window.location.origin).href
  );
  expect(() =>
    enqueueAndroidDownloads([
      {
        title: '测试',
        url: 'file:///secret',
        episodeIndex: 0,
        mediaType: 'hls',
      },
    ])
  ).toThrow();
  expect(() =>
    enqueueAndroidDownloads([
      {
        title: '测试',
        url: 'https://example.com/a',
        episodeIndex: -1,
        mediaType: 'hls',
      },
    ])
  ).toThrow();
  expect(bridge.enqueueDownloads).toHaveBeenCalledTimes(1);
});
