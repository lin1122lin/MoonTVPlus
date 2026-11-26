import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { CompletedTask, SavedTask } from '@/lib/download-db';
import { getIndexedDBPartialVideoPlaybackUrl, getIndexedDBVideoPlaybackUrl } from '@/lib/indexeddb-video-cache';

import { LocalDownloadPlayer } from './LocalDownloadPlayer';

jest.mock('@/lib/indexeddb-video-cache', () => ({
  getIndexedDBVideoPlaybackUrl: jest.fn(),
  getIndexedDBPartialVideoPlaybackUrl: jest.fn(),
}));
const mockDestroy = jest.fn();
const mockLoadSource = jest.fn();
jest.mock('hls.js', () => ({
  __esModule: true,
  default: class {
    static isSupported(): boolean {
      return true;
    }
    static Events: { ERROR: string } = { ERROR: 'error' };
    on = jest.fn();
    attachMedia = jest.fn();
    loadSource = mockLoadSource;
    destroy = mockDestroy;
  },
}));

const task: CompletedTask = {
  id: 'old-task',
  title: '旧下载',
  source: 'test',
  videoId: '42',
  episodeIndex: 2,
  completedAt: 1,
  downloadMode: 'indexeddb',
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  jest.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  URL.revokeObjectURL = jest.fn();
});

it('plays an existing completed task without fetching online details and frees resources', async () => {
  (getIndexedDBVideoPlaybackUrl as jest.Mock).mockResolvedValue({
    hasLocal: true,
    url: 'blob:playlist',
    objectUrls: ['blob:segment', 'blob:playlist'],
  });
  const { unmount } = render(
    <LocalDownloadPlayer task={task} onClose={jest.fn()} />
  );
  await waitFor(() =>
    expect(mockLoadSource).toHaveBeenCalledWith('blob:playlist')
  );
  expect(getIndexedDBVideoPlaybackUrl).toHaveBeenCalledWith('test', '42', 2);
  unmount();
  expect(mockDestroy).toHaveBeenCalled();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:segment');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:playlist');
});

it('reports a missing file without deleting its record or falling back online', async () => {
  (getIndexedDBVideoPlaybackUrl as jest.Mock).mockResolvedValue({
    hasLocal: false,
  });
  const close = jest.fn();
  render(<LocalDownloadPlayer task={task} onClose={close} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('本地缓存不存在');
  expect(mockLoadSource).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '关闭本地播放' }));
  expect(close).toHaveBeenCalledTimes(1);
});

it('revokes URLs if the player closes while storage is being read', async () => {
  let resolve!: (value: unknown) => void;
  (getIndexedDBVideoPlaybackUrl as jest.Mock).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  const { unmount } = render(
    <LocalDownloadPlayer task={task} onClose={jest.fn()} />
  );
  unmount();
  resolve({ hasLocal: true, url: 'blob:late', objectUrls: ['blob:late'] });
  await waitFor(() =>
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:late')
  );
  expect(mockLoadSource).not.toHaveBeenCalled();
});

const partialTask: SavedTask = {
  ...task, url: 'https://origin/list.m3u8', type: 'TS', status: 'error', finishList: [],
  finishNum: 2, errorNum: 1, downloadIndex: 3, createdAt: 1,
  rangeDownload: { isShowRange: false, startSegment: 0, endSegment: 3, targetSegment: 3 },
};

it('labels partial playback, stops at the cached end and frees its URLs', async () => {
  (getIndexedDBPartialVideoPlaybackUrl as jest.Mock).mockResolvedValue({
    hasLocal: true, partial: true, mode: 'blob', url: 'blob:partial', objectUrls: ['blob:piece', 'blob:partial'],
  });
  const { unmount } = render(<LocalDownloadPlayer partialTask={partialTask} onClose={jest.fn()} />);
  await waitFor(() => expect(mockLoadSource).toHaveBeenCalledWith('blob:partial'));
  expect(getIndexedDBPartialVideoPlaybackUrl).toHaveBeenCalledWith(partialTask, expect.any(Function));
  expect(getIndexedDBVideoPlaybackUrl).not.toHaveBeenCalled();
  expect(screen.getByText(/部分缓存/)).toHaveTextContent('遇缺片停止');
  fireEvent.ended(screen.getByLabelText('已下载视频'));
  expect(screen.getByText(/已播放到缓存末尾/)).toBeInTheDocument();
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:piece');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:partial');
});

it('shows the partial reader error without falling back to completed or online playback', async () => {
  (getIndexedDBPartialVideoPlaybackUrl as jest.Mock).mockResolvedValue({ hasLocal: false, reason: '下载范围开头尚无连续可播放缓存' });
  render(<LocalDownloadPlayer partialTask={partialTask} onClose={jest.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('下载范围开头尚无连续可播放缓存');
  expect(getIndexedDBVideoPlaybackUrl).not.toHaveBeenCalled();
  expect(mockLoadSource).not.toHaveBeenCalled();
});

it('rejects non-blob partial results without loading or falling back', async () => {
  (getIndexedDBPartialVideoPlaybackUrl as jest.Mock).mockResolvedValue({ hasLocal: true, mode: 'service-worker', url: '/local/playlist.m3u8' });
  render(<LocalDownloadPlayer partialTask={partialTask} onClose={jest.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('已阻止非本地地址');
  expect(mockLoadSource).not.toHaveBeenCalled();
  expect(getIndexedDBVideoPlaybackUrl).not.toHaveBeenCalled();
});

it('keeps a delayed local source ready but disables autoplay after going into the background', async () => {
  let resolve!: (value: unknown) => void;
  (getIndexedDBPartialVideoPlaybackUrl as jest.Mock).mockReturnValue(new Promise((done) => { resolve = done; }));
  const visibility = jest.spyOn(document, 'visibilityState', 'get');
  visibility.mockReturnValue('visible');
  const { unmount } = render(<LocalDownloadPlayer partialTask={partialTask} onClose={jest.fn()} />);
  const video = screen.getByLabelText('已下载视频') as HTMLVideoElement;
  visibility.mockReturnValue('hidden');
  fireEvent(document, new Event('visibilitychange'));
  expect(video.autoplay).toBe(false);
  expect(video.pause).toHaveBeenCalled();
  resolve({ hasLocal: true, partial: true, mode: 'blob', url: 'blob:ready', objectUrls: ['blob:ready'] });
  await waitFor(() => expect(mockLoadSource).toHaveBeenCalledWith('blob:ready'));
  visibility.mockReturnValue('visible');
  fireEvent(document, new Event('visibilitychange'));
  expect(video.autoplay).toBe(false);
  expect(mockDestroy).not.toHaveBeenCalled();
  unmount();
  visibility.mockRestore();
});
