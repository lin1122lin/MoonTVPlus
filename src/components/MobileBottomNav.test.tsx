import { fireEvent, render, screen } from '@testing-library/react';

import MobileBottomNav from './MobileBottomNav';

jest.mock('next/navigation', () => ({
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock('./WatchRoomProvider', () => ({
  useWatchRoomContextSafe: () => null,
}));
jest.mock('./DownloadManagementPanel', () => ({
  DownloadManagementPanel: ({
    isOpen,
    onClose,
  }: {
    isOpen: boolean;
    onClose: () => void;
  }) =>
    isOpen ? (
      <div role='dialog' aria-label='我的下载'>
        <button onClick={onClose}>关闭</button>
      </div>
    ) : null,
}));

it('keeps downloads second in the visible bottom navigation and opens the existing panel', () => {
  render(<MobileBottomNav />);
  const items = screen.getAllByRole('listitem');
  expect(items[0]).toHaveTextContent('首页');
  expect(items[1]).toHaveTextContent('我的下载');
  fireEvent.click(screen.getByRole('button', { name: '我的下载' }));
  expect(screen.getByRole('dialog', { name: '我的下载' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
