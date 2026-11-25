import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { CompletedTask } from '@/lib/download-db';
import { getIndexedDBVideoPlaybackUrl } from '@/lib/indexeddb-video-cache';

import { LocalDownloadPlayer } from './LocalDownloadPlayer';

jest.mock('@/lib/indexeddb-video-cache', () => ({
  getIndexedDBVideoPlaybackUrl: jest.fn(),
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
