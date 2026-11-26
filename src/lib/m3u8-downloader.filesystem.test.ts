import { M3U8Downloader, M3U8DownloadTask } from './m3u8-downloader';

jest.mock('mux.js', () => ({}));

const segmentUrl = 'https://example.com/segment.ts';
const header = '#EXTM3U\n#EXT-X-TARGETDURATION:6\n';
const segment = `#EXTINF:6,\n${segmentUrl}\n#EXT-X-ENDLIST\n`;

function filesystemFixture(method: string, keyLine: string) {
  const files = new Map([
    ['playlist.m3u8', 'old playlist'],
    ['segment_00000.ts', 'decrypted segment'],
    ['key.key', 'old key'],
  ]);
  let pending = '';
  // File System Access writes become visible only after close succeeds.
  const write = jest.fn(async (content: string) => {
    pending = content;
  });
  const close = jest.fn(async () => {
    files.set('playlist.m3u8', pending);
  });
  const createWritable = jest.fn(async () => ({ write, close }));
  const getFileHandle = jest.fn(async (name: string) => {
    if (name !== 'playlist.m3u8') throw new Error(`Unexpected write: ${name}`);
    return { createWritable };
  });
  const getDirectoryHandle = jest.fn();
  const directory = { getFileHandle, getDirectoryHandle };
  getDirectoryHandle.mockResolvedValue(directory);
  const task = {
    source: 'source',
    videoId: 'video',
    episodeIndex: 0,
    filesystemDirHandle: directory as unknown as FileSystemDirectoryHandle,
    m3u8Content: header + keyLine + segment,
    rangeDownload: { startSegment: 0, endSegment: 1, targetSegment: 1 },
    aesConf: { method, key: method === 'AES-128' ? new ArrayBuffer(16) : null },
  } as M3U8DownloadTask;
  return { task, files, write, close, getFileHandle, getDirectoryHandle };
}

afterEach(() => jest.restoreAllMocks());

it('exports decrypted filesystem segments without KEY or a new key file', async () => {
  const fixture = filesystemFixture(
    'AES-128',
    '#EXT-X-KEY:METHOD=AES-128,URI="https://example.com/key"\n'
  );

  await (new M3U8Downloader() as any).generateLocalPlaylist(fixture.task);

  expect(fixture.files.get('playlist.m3u8')).toBe(
    header + segment.replace(segmentUrl, 'segment_00000.ts')
  );
  expect(fixture.files.get('playlist.m3u8')).not.toContain('#EXT-X-KEY:');
  expect(fixture.getFileHandle).toHaveBeenCalledTimes(1);
  expect(fixture.getFileHandle).toHaveBeenCalledWith('playlist.m3u8', {
    create: true,
  });
  expect(fixture.getDirectoryHandle.mock.calls).toEqual([
    ['source', { create: false }],
    ['video', { create: false }],
    ['ep1', { create: false }],
  ]);
  expect(fixture.files.get('segment_00000.ts')).toBe('decrypted segment');
  expect(fixture.files.get('key.key')).toBe('old key');
});

it.each(['', 'NONE'])(
  'preserves unencrypted playlist behavior for method %s',
  async (method) => {
    const keyLine = method === 'NONE' ? '#EXT-X-KEY:METHOD=NONE\n' : '';
    const fixture = filesystemFixture(method, keyLine);

    await (new M3U8Downloader() as any).generateLocalPlaylist(fixture.task);

    expect(fixture.files.get('playlist.m3u8')).toBe(
      header + keyLine + segment.replace(segmentUrl, 'segment_00000.ts')
    );
    expect(fixture.getFileHandle).toHaveBeenCalledTimes(1);
  }
);

it('leaves existing files unchanged when writing the playlist fails', async () => {
  const fixture = filesystemFixture(
    'AES-128',
    '#EXT-X-KEY:METHOD=AES-128,URI="key"\n'
  );
  const previous = new Map(fixture.files);
  const error = new Error('Disk full');
  fixture.write.mockRejectedValueOnce(error);
  const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);

  await expect((new M3U8Downloader() as any).generateLocalPlaylist(fixture.task)).rejects.toThrow('Disk full');

  expect(fixture.close).not.toHaveBeenCalled();
  expect(fixture.files).toEqual(previous);
  expect(fixture.getFileHandle).toHaveBeenCalledTimes(1);
  expect(log).toHaveBeenCalledWith('生成播放列表失败:', error);
});
