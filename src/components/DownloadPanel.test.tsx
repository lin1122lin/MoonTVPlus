import { fireEvent, render } from '@testing-library/react';

import { DownloadPanel } from './DownloadPanel';

jest.mock('@/contexts/DownloadContext', () => ({
  useDownload: () => ({
    tasks: [],
    showDownloadPanel: true,
    setShowDownloadPanel: jest.fn(),
  }),
}));

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
