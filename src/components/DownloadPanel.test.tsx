import { fireEvent, render, screen } from '@testing-library/react';

import type { M3U8DownloadTask } from '@/lib/m3u8-downloader';

import { DownloadPanel } from './DownloadPanel';

const mockTasks: M3U8DownloadTask[] = [];
const mockStartTask = jest.fn();
jest.mock('./LocalDownloadPlayer', () => ({
  LocalDownloadPlayer: ({ partialTask }: { partialTask: { id: string } }) => <div role='dialog'>{partialTask.id}</div>,
}));

jest.mock('@/contexts/DownloadContext', () => ({
  useDownload: () => ({
    tasks: mockTasks,
    showDownloadPanel: true,
    setShowDownloadPanel: jest.fn(),
    startTask: mockStartTask,
    getProgress: () => 100,
  }),
}));

beforeEach(() => { mockTasks.length = 0; mockStartTask.mockClear(); });

it('pauses the covered player and prevents its delayed autoplay while downloads are open', () => {
  const background = document.createElement('video');
  document.body.appendChild(background);
  const pause = jest.spyOn(background, 'pause').mockImplementation(() => {});
  const { unmount } = render(<DownloadPanel />);
  expect(pause).toHaveBeenCalledTimes(1);
  fireEvent.play(background);
  expect(pause).toHaveBeenCalledTimes(2);
  const local = document.createElement('video');
  local.setAttribute('data-download-player', '');
  document.body.appendChild(local);
  const localPause = jest.spyOn(local, 'pause').mockImplementation(() => {});
  fireEvent.play(local);
  expect(localPause).not.toHaveBeenCalled();
  unmount();
  fireEvent.play(background);
  expect(pause).toHaveBeenCalledTimes(2);
  background.remove();
  local.remove();
});

it('plays active cached tasks, distinguishes finalization, and retries completion errors', () => {
  const task: M3U8DownloadTask = {
    id: 'partial', title: '部分缓存', url: 'https://origin/list', type: 'TS', downloadMode: 'indexeddb',
    status: 'downloading', finishNum: 1, errorNum: 0, segmentLogs: [],
    finishList: [{ title: '', status: 'is-success' }],
    rangeDownload: { isShowRange: false, startSegment: 0, endSegment: 1, targetSegment: 1 },
    tsUrlList: ['https://origin/segment.ts'], requests: [], mediaFileList: [], downloadIndex: 1,
    downloading: true, durationSecond: 6, beginTime: new Date(1), retryNum: 3, retryCountdown: 0,
    aesConf: { method: '', uri: '', iv: null, key: null, decryption: null },
  };
  mockTasks.push(task);
  const { rerender } = render(<DownloadPanel />);
  expect(screen.getByText('正在整理缓存')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '播放已缓存' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('partial');
  mockTasks[0] = { ...task, status: 'error', errorMessage: '缓存清单保存失败' };
  rerender(<DownloadPanel />);
  expect(screen.getByRole('alert')).toHaveTextContent('缓存清单保存失败');
  fireEvent.click(screen.getByRole('button', { name: '重试完成' }));
  expect(mockStartTask).toHaveBeenCalledWith('partial');
});
