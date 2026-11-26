import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { downloadDB } from '@/lib/download-db';
import type { M3U8DownloadTask } from '@/lib/m3u8-downloader';

import { DownloadManagementPanel } from './DownloadManagementPanel';

const mockTasks: M3U8DownloadTask[] = [];
const mockStartTask = jest.fn();
jest.mock('@/contexts/DownloadContext', () => ({
  useDownload: () => ({ tasks: Array.from(mockTasks), startTask: mockStartTask }),
}));

jest.mock('@/lib/download-db', () => ({
  downloadDB: { getCompletedTasks: jest.fn(), getActiveTasks: jest.fn() },
}));
jest.mock('./LocalDownloadPlayer', () => ({
  LocalDownloadPlayer: ({ task, partialTask }: { task?: { id: string }; partialTask?: { id: string } }) => (
    <div role='dialog'>{(task || partialTask)?.id}</div>
  ),
}));

beforeEach(() => {
  mockTasks.length = 0; mockStartTask.mockClear();
  (downloadDB.getActiveTasks as jest.Mock).mockResolvedValue([]);
});

it('shows old cached episodes with a play action, export records without a fake play action, and refreshes on completion', async () => {
  const cached = {
    id: 'old-cache',
    title: '影片',
    videoTitle: '测试影片',
    source: 'test',
    videoId: '42',
    episodeIndex: 0,
    completedAt: 1,
    downloadMode: 'indexeddb',
  };
  (downloadDB.getCompletedTasks as jest.Mock).mockResolvedValue([
    cached,
    { ...cached, id: 'export', episodeIndex: 1, downloadMode: 'browser' },
  ]);
  render(<DownloadManagementPanel isOpen onClose={jest.fn()} />);
  fireEvent.click(await screen.findByText('测试影片'));
  expect(
    screen.getByText('已发起文件导出', { exact: true })
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: '播放已下载的第 2 集' })
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '播放已下载的第 1 集' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('old-cache');
  const calls = (downloadDB.getCompletedTasks as jest.Mock).mock.calls.length;
  fireEvent(window, new Event('downloads:completed'));
  await waitFor(() =>
    expect(downloadDB.getCompletedTasks).toHaveBeenCalledTimes(calls + 1)
  );
});

it('shows partial playback and retry completion for active IndexedDB tasks without completed records', async () => {
  (downloadDB.getCompletedTasks as jest.Mock).mockResolvedValue([]);
  mockTasks.push({
    id: 'active-cache', title: '未完成影片', status: 'error', downloadMode: 'indexeddb',
    finishNum: 1, errorNum: 0, errorMessage: '写入清单失败',
    finishList: [{ title: '', status: 'is-success' }],
    rangeDownload: { startSegment: 0, endSegment: 1, targetSegment: 1 },
  } as M3U8DownloadTask);
  const { rerender } = render(<DownloadManagementPanel isOpen onClose={jest.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('写入清单失败');
  expect(screen.queryByText('暂无下载记录')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '播放已缓存：未完成影片' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('active-cache');
  fireEvent.click(screen.getByRole('button', { name: '重试完成' }));
  expect(mockStartTask).toHaveBeenCalledWith('active-cache');
  mockTasks[0] = { ...mockTasks[0], status: 'downloading', errorMessage: undefined };
  rerender(<DownloadManagementPanel isOpen onClose={jest.fn()} />);
  expect(screen.getByText(/正在整理缓存/)).toBeInTheDocument();
});

it('reads saved active tasks without live restoration and hides the same episode when completed', async () => {
  const saved = {
    id: 'saved-only', title: '持久化缓存', source: 'test', videoId: '42', episodeIndex: 0,
    status: 'pause', downloadMode: 'indexeddb', createdAt: 1, finishNum: 1, errorNum: 0,
    finishList: [{ title: '', status: 'is-success' }],
    rangeDownload: { startSegment: 0, endSegment: 2, targetSegment: 2 },
  };
  (downloadDB.getActiveTasks as jest.Mock).mockResolvedValue([saved]);
  (downloadDB.getCompletedTasks as jest.Mock).mockResolvedValue([]);
  render(<DownloadManagementPanel isOpen onClose={jest.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: '播放已缓存：持久化缓存' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('saved-only');
  (downloadDB.getCompletedTasks as jest.Mock).mockResolvedValue([{ ...saved, id: 'completed', completedAt: 2 }]);
  fireEvent(window, new Event('downloads:completed'));
  await waitFor(() => expect(screen.queryByRole('button', { name: '播放已缓存：持久化缓存' })).not.toBeInTheDocument());
});

it.each(['browser', 'filesystem'])('keeps partial IndexedDB playback alongside an old %s record for the same episode', async (downloadMode) => {
  const episode = { source: 'test', videoId: '42', episodeIndex: 0 };
  (downloadDB.getCompletedTasks as jest.Mock).mockResolvedValue([{
    ...episode, id: 'old-record', title: '旧完成记录', videoTitle: '旧完成记录', completedAt: 1, downloadMode,
  }]);
  (downloadDB.getActiveTasks as jest.Mock).mockResolvedValue([{
    ...episode, id: 'new-cache', title: '新缓存', status: 'error', downloadMode: 'indexeddb',
    createdAt: 2, finishNum: 99, errorNum: 1,
    finishList: Array.from({ length: 100 }, (_, index) => ({ title: '', status: index < 99 ? 'is-success' : 'is-error' })),
    rangeDownload: { startSegment: 0, endSegment: 100, targetSegment: 100 },
  }]);
  render(<DownloadManagementPanel isOpen onClose={jest.fn()} />);
  const play = await screen.findByRole('button', { name: '播放已缓存：新缓存' });
  expect(screen.getByText('旧完成记录')).toBeInTheDocument();
  fireEvent.click(play);
  expect(screen.getByRole('dialog')).toHaveTextContent('new-cache');
});
