import { act, render, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';

import { downloadDB, SavedTask } from '@/lib/download-db';
import type { M3U8DownloadTask, M3U8DownloaderOptions } from '@/lib/m3u8-downloader';

import { DownloadProvider } from './DownloadContext';

let mockOptions: M3U8DownloaderOptions;
const mockTasks = new Map<string, M3U8DownloadTask>();
const mockCreateTask = jest.fn();
jest.mock('@/lib/m3u8-downloader', () => ({
  M3U8Downloader: class {
    constructor(options: M3U8DownloaderOptions) { mockOptions = options; }
    createTask(...args: unknown[]) { return mockCreateTask(...args); }
    getTask(id: string) { return mockTasks.get(id); }
    getAllTasks() { return Array.from(mockTasks.values()); }
  },
}));
jest.mock('@/lib/download-db', () => ({
  downloadDB: {
    getActiveTasks: jest.fn(),
    saveActiveTasks: jest.fn(async () => undefined),
    deleteActiveTasks: jest.fn(async () => undefined),
  },
}));
jest.mock('@/lib/indexeddb-video-cache', () => ({
  buildIndexedDBVideoCacheKey: (source: string, videoId: string, episode: number) => `${source}::${videoId}::${episode}`,
}));

function saved(id: string): SavedTask {
  return {
    id, url: 'https://example.com/offline.m3u8', title: 'offline', type: 'TS', status: 'downloading',
    finishList: [{ title: 'a.ts', status: 'is-success' }, { title: 'b.ts', status: 'is-downloading' }],
    finishNum: 8, errorNum: 0, downloadIndex: 2, downloadMode: 'indexeddb', createdAt: 123,
    rangeDownload: { isShowRange: false, startSegment: 0, endSegment: 2, targetSegment: 2 },
    m3u8Content: '#EXTM3U\n#EXTINF:6,\na.ts\n#EXTINF:6,\nb.ts\n#EXT-X-ENDLIST',
    errorMessage: 'previous failure',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTasks.clear();
  mockCreateTask.mockReset();
  mockCreateTask.mockImplementation(async (_url, title, type, _metadata, cached) => {
    const task = { id: cached.id, title, type, createdAt: cached.createdAt, m3u8Content: cached.m3u8Content } as M3U8DownloadTask;
    mockTasks.set(task.id, task);
    return task.id;
  });
});

it('restores from saved content with the original identity and normalizes in-flight metadata', async () => {
  const original = saved('original');
  jest.mocked(downloadDB.getActiveTasks).mockResolvedValueOnce([original]);
  render(<DownloadProvider><span>ready</span></DownloadProvider>);
  await waitFor(() => expect(downloadDB.saveActiveTasks).toHaveBeenCalled());
  expect(mockCreateTask).toHaveBeenCalledWith(original.url, original.title, 'TS', expect.any(Object), {
    id: 'original', createdAt: 123, m3u8Content: original.m3u8Content,
  });
  expect(mockTasks.get('original')).toMatchObject({
    id: 'original', createdAt: 123, status: 'pause', finishNum: 1,
    errorMessage: 'previous failure',
    finishList: [{ status: 'is-success' }, { status: '' }],
  });
  expect(downloadDB.deleteActiveTasks).not.toHaveBeenCalled();
});

it('gates bulk saves during restoration and retains failed records on later progress saves', async () => {
  let load!: (tasks: SavedTask[]) => void;
  jest.mocked(downloadDB.getActiveTasks).mockImplementationOnce(() => new Promise(resolve => { load = resolve; }));
  mockCreateTask.mockRejectedValueOnce(new Error('offline legacy playlist'));
  render(<DownloadProvider><span>ready</span></DownloadProvider>);
  await act(async () => { mockOptions.onProgress?.({} as M3U8DownloadTask); });
  expect(downloadDB.saveActiveTasks).not.toHaveBeenCalled();
  const failed = { ...saved('failed'), m3u8Content: undefined };
  await act(async () => { load([failed, saved('restored')]); });
  await waitFor(() => expect(downloadDB.saveActiveTasks).toHaveBeenCalled());
  await act(async () => { mockOptions.onProgress?.(mockTasks.get('restored')!); });
  const calls = jest.mocked(downloadDB.saveActiveTasks).mock.calls;
  expect(calls[calls.length - 1][0]).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'failed', createdAt: 123 }),
    expect.objectContaining({ id: 'restored', createdAt: 123 }),
  ]));
  expect(downloadDB.deleteActiveTasks).not.toHaveBeenCalled();
});

it('does not bulk-clear unknown persisted records after the initial read fails', async () => {
  jest.mocked(downloadDB.getActiveTasks).mockRejectedValueOnce(new Error('database unavailable'));
  render(<DownloadProvider><span>ready</span></DownloadProvider>);
  await waitFor(() => expect(downloadDB.getActiveTasks).toHaveBeenCalled());
  await act(async () => { mockOptions.onProgress?.({} as M3U8DownloadTask); });
  expect(downloadDB.saveActiveTasks).not.toHaveBeenCalled();
});

it('does not launch a second restoration when StrictMode repeats effects', async () => {
  jest.mocked(downloadDB.getActiveTasks).mockResolvedValueOnce([saved('original')]);
  render(<StrictMode><DownloadProvider><span>ready</span></DownloadProvider></StrictMode>);
  await waitFor(() => expect(downloadDB.saveActiveTasks).toHaveBeenCalled());
  expect(downloadDB.getActiveTasks).toHaveBeenCalledTimes(1);
  expect(mockCreateTask).toHaveBeenCalledTimes(1);
});
