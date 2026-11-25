import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { downloadDB } from '@/lib/download-db';

import { DownloadManagementPanel } from './DownloadManagementPanel';

jest.mock('@/lib/download-db', () => ({
  downloadDB: { getCompletedTasks: jest.fn() },
}));
jest.mock('./LocalDownloadPlayer', () => ({
  LocalDownloadPlayer: ({ task }: { task: { id: string } }) => (
    <div role='dialog'>{task.id}</div>
  ),
}));

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
