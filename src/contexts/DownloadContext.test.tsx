import { act, render, waitFor } from '@testing-library/react';

import { downloadDB } from '@/lib/download-db';
import type { M3U8DownloaderOptions } from '@/lib/m3u8-downloader';

import { DownloadProvider } from './DownloadContext';

let mockOptions: M3U8DownloaderOptions;
jest.mock('@/lib/m3u8-downloader', () => ({
  M3U8Downloader: class {
    constructor(options: M3U8DownloaderOptions) {
      mockOptions = options;
    }
    getAllTasks() {
      return [];
    }
  },
}));
jest.mock('@/lib/download-db', () => ({
  downloadDB: {
    getActiveTasks: jest.fn(async () => []),
    saveCompletedTask: jest.fn(async () => undefined),
    saveActiveTasks: jest.fn(async () => undefined),
  },
}));
jest.mock('@/lib/indexeddb-video-cache', () => ({
  buildIndexedDBVideoCacheKey: jest.fn(() => 'test::42::0'),
  getIndexedDBVideoCacheSize: jest.fn(async () => 1024),
}));

it.each(['browser', 'filesystem', 'indexeddb'] as const)(
  'retains a completed %s task record',
  async (downloadMode) => {
    jest.clearAllMocks();
    render(
      <DownloadProvider>
        <span>ready</span>
      </DownloadProvider>
    );
    await waitFor(() => expect(downloadDB.getActiveTasks).toHaveBeenCalled());
    await act(async () => {
      await mockOptions.onComplete?.({
        id: 'completed',
        title: '影片 第1集',
        source: 'test',
        videoId: '42',
        episodeIndex: 0,
        downloadMode,
        indexedDBCacheKey: undefined,
      } as Parameters<NonNullable<M3U8DownloaderOptions['onComplete']>>[0]);
    });
    expect(downloadDB.saveCompletedTask).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'completed',
        downloadMode,
        source: 'test',
        videoId: '42',
        episodeIndex: 0,
      })
    );
  }
);
