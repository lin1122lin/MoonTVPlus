import type { SavedTask } from './download-db';
import { getIndexedDBPartialVideoPlaybackUrl } from './indexeddb-video-cache';

const cacheKey = 'source::video::0';
const manifests = new Map<string, unknown>();
const segments = new Map<string, unknown>();
const reads: string[] = [];
const transaction = jest.fn((_stores: string[], mode: string) => {
  if (mode !== 'readonly') throw new Error('Playback must not write');
  return { objectStore: (name: string) => ({ get: (key: string) => {
    const request = {} as IDBRequest;
    reads.push(key);
    Promise.resolve().then(() => {
      Object.assign(request, { result: (name === 'manifests' ? manifests : segments).get(key) });
      request.onsuccess?.({} as Event);
    });
    return request;
  } }) };
});
const blobs: Blob[] = [];
const task: SavedTask = {
  id: 'active', url: 'https://origin/list.m3u8', title: '部分缓存', type: 'TS', status: 'error',
  source: 'source', videoId: 'video', episodeIndex: 0, downloadMode: 'indexeddb',
  finishList: Array.from({ length: 4 }, () => ({ title: '', status: 'is-success' })),
  finishNum: 4, errorNum: 0, downloadIndex: 4, createdAt: 1,
  rangeDownload: { isShowRange: false, startSegment: 0, endSegment: 4, targetSegment: 4 },
  m3u8Content: '#EXTM3U\n#EXT-X-TARGETDURATION:6\n' + Array.from({ length: 4 }, (_, i) => `#EXTINF:6,\nhttps://origin/${i}.ts`).join('\n'),
};

function putSegment(index: number, data: unknown = new Blob(['video'])) {
  segments.set(`${cacheKey}:segment:${index}`, { data });
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {
    open: jest.fn(() => {
      const request = {} as IDBOpenDBRequest;
      Promise.resolve().then(() => {
        Object.assign(request, { result: { transaction } });
        request.onsuccess?.({} as Event);
      });
      return request;
    }),
  } });
});

beforeEach(() => {
  manifests.clear(); segments.clear(); reads.length = 0; blobs.length = 0;
  transaction.mockClear();
  URL.createObjectURL = jest.fn((blob: Blob) => { blobs.push(blob); return `blob:${blobs.length}`; });
  URL.revokeObjectURL = jest.fn();
});

it('plays real segments without any manifest and stops at the first missing Blob despite success hints', async () => {
  putSegment(0); putSegment(1); putSegment(3);
  const result = await getIndexedDBPartialVideoPlaybackUrl(task);
  expect(result).toMatchObject({ hasLocal: true, partial: true, segmentCount: 2, duration: 12, firstMissingIndex: 2, mode: 'blob' });
  expect(reads).not.toContain(`${cacheKey}:segment:3`);
  expect(await readBlob(blobs[2])).toContain('#EXTINF:6,\nblob:1\n#EXTINF:6,\nblob:2\n#EXT-X-ENDLIST');
  expect(await readBlob(blobs[2])).not.toContain('https://');
  expect(manifests.size).toBe(0);
  expect(task.status).toBe('error');
  expect(transaction.mock.calls.every((call) => call[1] === 'readonly')).toBe(true);
});

it('uses the real range indices, not the first playlist URL assigned to the range start', async () => {
  putSegment(2); putSegment(3);
  const result = await getIndexedDBPartialVideoPlaybackUrl({ ...task, finishNum: 0,
    rangeDownload: { isShowRange: true, startSegment: 2, endSegment: 4, targetSegment: 2 } });
  expect(result).toMatchObject({ hasLocal: true, segmentCount: 2 });
  expect(reads).not.toContain(`${cacheKey}:segment:0`);
  expect(await readBlob(blobs[2])).toContain('#EXT-X-MEDIA-SEQUENCE:2');
});

it.each([undefined, new Blob([]), 'not a Blob'])('does not treat a missing, empty, or invalid first segment as playable', async (data) => {
  if (data !== undefined) putSegment(0, data);
  putSegment(1);
  expect(await getIndexedDBPartialVideoPlaybackUrl(task)).toMatchObject({ hasLocal: false });
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

it('prefers an existing completed manifest without requiring active playlist metadata', async () => {
  manifests.set(cacheKey, { cacheKey, completed: true, playlistContent: '#EXTM3U\n#EXTINF:6,\nsegment_00000.ts\n#EXT-X-ENDLIST' });
  putSegment(0);
  const result = await getIndexedDBPartialVideoPlaybackUrl({ ...task, m3u8Content: undefined });
  expect(result.hasLocal).toBe(true);
  expect(result.partial).toBeUndefined();
  expect(result.manifest).toEqual(manifests.get(cacheKey));
});

it('releases allocated URLs if storage fails after a readable prefix', async () => {
  putSegment(0);
  transaction.mockImplementationOnce(() => ({ objectStore: () => ({ get: () => {
    const request = {} as IDBRequest;
    Promise.resolve().then(() => request.onsuccess?.({} as Event));
    return request;
  } }) }));
  const create = URL.createObjectURL as jest.Mock;
  create.mockImplementationOnce((blob: Blob) => {
    blobs.push(blob);
    transaction.mockImplementationOnce(() => { throw new Error('storage unavailable'); });
    return 'blob:allocated';
  });
  expect(await getIndexedDBPartialVideoPlaybackUrl(task)).toMatchObject({ hasLocal: false, reason: 'storage unavailable' });
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:allocated');
});

it('stops reading more Blobs and releases the prefix when the dialog is closed', async () => {
  putSegment(0); putSegment(1); putSegment(2);
  let current = true;
  (URL.createObjectURL as jest.Mock).mockImplementationOnce(() => { current = false; return 'blob:cancelled'; });
  expect(await getIndexedDBPartialVideoPlaybackUrl(task, () => current)).toMatchObject({ hasLocal: false, reason: '播放已取消' });
  expect(reads).not.toContain(`${cacheKey}:segment:1`);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:cancelled');
});
