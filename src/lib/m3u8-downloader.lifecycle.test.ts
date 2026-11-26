import { M3U8Downloader } from './m3u8-downloader';
import { AESDecryptor } from './aes-decryptor';
import { deleteIndexedDBVideoCache, getIndexedDBVideoCacheSize, saveIndexedDBVideoManifest, saveIndexedDBVideoSegment } from './indexeddb-video-cache';

let mockMuxMode = 'single';
const originalCreateUrl = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
const originalRevokeUrl = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
beforeAll(() => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: () => 'blob:test' });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: () => undefined });
});
afterAll(() => {
  if (originalCreateUrl) Object.defineProperty(URL, 'createObjectURL', originalCreateUrl);
  else Reflect.deleteProperty(URL, 'createObjectURL');
  if (originalRevokeUrl) Object.defineProperty(URL, 'revokeObjectURL', originalRevokeUrl);
  else Reflect.deleteProperty(URL, 'revokeObjectURL');
});
jest.mock('mux.js', () => ({
  mp4: { Transmuxer: class {
    handlers: Record<string, (...args: any[]) => void> = {};
    on(name: string, handler: (...args: any[]) => void) { this.handlers[name] = handler; }
    push() { if (mockMuxMode === 'throw') throw new Error('mux failed'); }
    flush() {
      const segment = { initSegment: new Uint8Array([1]), data: new Uint8Array([2]) };
      if (mockMuxMode !== 'zero') this.handlers.data(segment);
      if (mockMuxMode === 'multi') this.handlers.data(segment);
      if (mockMuxMode === 'no-done') return;
      this.handlers.done();
      this.handlers.done();
      if (mockMuxMode === 'after-done-throw') throw new Error('flush failed after done');
    }
    dispose() {}
  } },
}));
jest.mock('./indexeddb-video-cache', () => ({
  buildIndexedDBVideoCacheKey: () => 'source::video::0',
  saveIndexedDBVideoSegment: jest.fn(async () => 1),
  saveIndexedDBVideoManifest: jest.fn(async () => ({})),
  getIndexedDBVideoCacheSize: jest.fn(async () => 1),
  deleteIndexedDBVideoCache: jest.fn(async () => undefined),
}));

class Request {
  static all: Request[] = [];
  readyState = 0;
  status = 200;
  response = new Uint8Array([7]).buffer;
  responseText = '';
  responseType = '';
  timeout = 0;
  onload?: () => void;
  onreadystatechange?: () => void;
  onerror?: () => void;
  ontimeout?: () => void;
  onabort?: () => void;
  constructor() { Request.all.push(this); }
  open() { this.readyState = 1; }
  send() {}
  abort = jest.fn(() => { this.readyState = 0; this.onabort?.(); });
  respond() { this.readyState = 4; this.onreadystatechange?.(); this.onload?.(); }
}

async function drain() { for (let i = 0; i < 30; i++) await Promise.resolve(); }

async function fixture(count = 1, type: 'TS' | 'MP4' = 'TS') {
  const onError = jest.fn();
  const onComplete = jest.fn();
  const downloader = new M3U8Downloader({ onError, onComplete });
  const pending = downloader.createTask('https://example.com/a.m3u8', 'episode', type,
    { source: 'source', videoId: 'video', episodeIndex: 0 });
  Request.all[0].responseText = '#EXTM3U\n' + Array.from({ length: count }, (_, i) =>
    `#EXTINF:6,\n${i}.ts\n`).join('') + '#EXT-X-ENDLIST';
  Request.all[0].respond();
  const id = await pending;
  const task = downloader.getTask(id)!;
  task.downloadMode = 'indexeddb';
  return { downloader, id, task, onError, onComplete };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  Request.all = [];
  mockMuxMode = 'single';
  localStorage.clear();
  jest.spyOn(window, 'XMLHttpRequest').mockImplementation(() => new Request() as unknown as XMLHttpRequest);
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

it('terminates when a failed segment settles before the last success', async () => {
  const f = await fixture(2);
  await f.downloader.startTask(f.id);
  for (let attempt = 0; attempt < 4; attempt++) {
    Request.all[attempt === 0 ? 1 : Request.all.length - 1].ontimeout?.();
    if (attempt < 3) jest.advanceTimersByTime((attempt + 1) * 1000);
  }
  expect(f.onError).not.toHaveBeenCalled();
  expect(f.task.status).toBe('downloading');
  Request.all[2].respond();
  await drain();
  expect(f.task.status).toBe('error');
  expect(f.task.finishNum).toBe(1);
  expect(f.task.errorNum).toBe(1);
  expect(f.onComplete).not.toHaveBeenCalled();
  f.downloader.retryFailedSegments(f.id);
  Request.all[Request.all.length - 1].respond();
  await drain();
  expect(f.task.status).toBe('done');
  expect(f.task.finishNum).toBe(2);
});

it('retains successful segments and retries only failed finalization', async () => {
  const f = await fixture();
  jest.mocked(saveIndexedDBVideoManifest).mockRejectedValueOnce(new Error('metadata failed'));
  await f.downloader.startTask(f.id);
  Request.all[1].respond();
  await drain();
  expect(f.task).toMatchObject({ status: 'error', finishNum: 1, errorNum: 0 });
  expect(f.task.errorMessage).toContain('metadata failed');
  expect(f.task.finishList[0].status).toBe('is-success');
  await f.downloader.startTask(f.id);
  expect(Request.all).toHaveLength(2);
  expect(saveIndexedDBVideoSegment).toHaveBeenCalledTimes(1);
  expect(f.task).toMatchObject({ status: 'done', finishNum: 1, errorMessage: undefined });
  expect(f.onComplete).toHaveBeenCalledTimes(1);
});

it('does not finalize twice while manifest persistence is pending', async () => {
  const f = await fixture(2);
  let finish!: () => void;
  jest.mocked(saveIndexedDBVideoManifest).mockImplementationOnce(() => new Promise(resolve => {
    finish = () => resolve({} as any);
  }));
  await f.downloader.startTask(f.id);
  Request.all.slice(1).forEach(request => request.respond());
  await drain();
  expect(f.task).toMatchObject({ status: 'downloading', finishNum: 2, errorNum: 0 });
  await f.downloader.startTask(f.id);
  expect(saveIndexedDBVideoManifest).toHaveBeenCalledTimes(1);
  finish();
  await drain();
  expect(f.onComplete).toHaveBeenCalledTimes(1);
});

it('normalizes stale in-flight states and counters before resuming', async () => {
  const f = await fixture(2);
  f.task.status = 'pause';
  f.task.finishList[0].status = 'is-success';
  f.task.finishList[1].status = 'is-downloading';
  f.task.finishNum = 10;
  await f.downloader.startTask(f.id);
  expect(Request.all).toHaveLength(2);
  Request.all[1].respond();
  await drain();
  expect(f.task).toMatchObject({ status: 'done', finishNum: 2, errorNum: 0 });
});

it('terminates when the last pending segment exhausts HTTP retries', async () => {
  const f = await fixture(2);
  await f.downloader.startTask(f.id);
  Request.all[1].respond();
  await drain();
  for (let attempt = 0; attempt < 4; attempt++) {
    const request = Request.all[Request.all.length - 1];
    request.status = 404;
    request.respond();
    if (attempt < 3) jest.advanceTimersByTime((attempt + 1) * 1000);
  }
  expect(f.task).toMatchObject({ status: 'error', finishNum: 1, errorNum: 1 });
  expect(f.onError).toHaveBeenCalledTimes(1);
  expect(f.task.errorMessage).toContain('404');
});

it('settles synchronous request setup errors through the retry budget', async () => {
  const f = await fixture();
  jest.spyOn(Request.prototype, 'send').mockImplementation(() => { throw new Error('send failed'); });
  await f.downloader.startTask(f.id);
  for (let attempt = 1; attempt <= 3; attempt++) jest.advanceTimersByTime(attempt * 1000);
  expect(f.task).toMatchObject({ status: 'error', finishNum: 0, errorNum: 1 });
  expect(f.task.requests).toHaveLength(0);
  expect(f.onError).toHaveBeenCalledTimes(1);
});

it('does not resurrect cancelled requests or their delayed retries', async () => {
  const f = await fixture();
  f.task.downloadMode = 'browser';
  await f.downloader.startTask(f.id);
  Request.all[1].onerror?.();
  await f.downloader.cancelTask(f.id);
  jest.advanceTimersByTime(6000);
  Request.all[1].respond();
  await drain();
  expect(Request.all).toHaveLength(2);
  expect(f.downloader.getTask(f.id)).toBeUndefined();
  expect(f.onComplete).not.toHaveBeenCalled();
});

it('keeps browser buffers when export fails, then retries export without downloading', async () => {
  const f = await fixture();
  f.task.downloadMode = 'browser';
  const create = jest.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
  jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementationOnce(() => { throw new Error('export failed'); });
  await f.downloader.startTask(f.id);
  Request.all[1].respond();
  await drain();
  expect(f.task).toMatchObject({ status: 'error', finishNum: 1, errorNum: 0 });
  expect(f.task.mediaFileList[0]).toBe(Request.all[1].response);
  click.mockImplementation(() => undefined);
  await f.downloader.startTask(f.id);
  expect(f.task.status).toBe('done');
  expect(Request.all).toHaveLength(2);
  expect(create).toHaveBeenCalledTimes(2);
});

it('ignores duplicate load events and never counts a segment twice', async () => {
  const f = await fixture();
  await f.downloader.startTask(f.id);
  Request.all[1].respond();
  Request.all[1].respond();
  await drain();
  expect(f.task.finishNum).toBe(1);
  expect(saveIndexedDBVideoSegment).toHaveBeenCalledTimes(1);
  expect(f.onComplete).toHaveBeenCalledTimes(1);
});

it('aborts every request, resets in-flight states, and resumes them', async () => {
  const f = await fixture(3);
  await f.downloader.startTask(f.id);
  const requests = Request.all.slice(1);
  f.downloader.pauseTask(f.id);
  requests.forEach(request => expect(request.abort).toHaveBeenCalledTimes(1));
  expect(f.task.finishList.map(item => item.status)).toEqual(['', '', '']);
  await f.downloader.startTask(f.id);
  Request.all.slice(4).forEach(request => request.respond());
  await drain();
  expect(f.task).toMatchObject({ status: 'done', finishNum: 3, errorNum: 0 });
});

it('invalidates delayed retries when paused and resumed', async () => {
  const f = await fixture();
  await f.downloader.startTask(f.id);
  Request.all[1].onerror?.();
  f.downloader.pauseTask(f.id);
  await f.downloader.startTask(f.id);
  jest.advanceTimersByTime(1000);
  expect(Request.all).toHaveLength(3);
  Request.all[2].respond();
  await drain();
  expect(f.task.finishNum).toBe(1);
});

it.each(['zero', 'throw', 'no-done', 'after-done-throw'])('reports MP4 %s output as failure, never saves TS fallback', async mode => {
  mockMuxMode = mode;
  const f = await fixture(1, 'MP4');
  await f.downloader.startTask(f.id);
  for (let attempt = 0; attempt < 4; attempt++) {
    Request.all[Request.all.length - 1].respond();
    await drain();
    if (attempt < 3) jest.advanceTimersByTime((attempt + 1) * 1000);
  }
  expect(f.task).toMatchObject({ status: 'error', finishNum: 0, errorNum: 1 });
  expect(saveIndexedDBVideoSegment).not.toHaveBeenCalled();
});

it('aggregates multiple mux data events and settles once at done', async () => {
  mockMuxMode = 'multi';
  const f = await fixture(1, 'MP4');
  await f.downloader.startTask(f.id);
  Request.all[1].respond();
  await drain();
  expect(saveIndexedDBVideoSegment).toHaveBeenCalledTimes(1);
  const saved = jest.mocked(saveIndexedDBVideoSegment).mock.calls[0][0].data as ArrayBuffer;
  expect(Array.from(new Uint8Array(saved))).toEqual([1, 2, 2]);
  expect(f.task).toMatchObject({ status: 'done', finishNum: 1 });
});

it('does not persist ciphertext after a synchronous AES exception', async () => {
  const f = await fixture();
  f.task.aesConf.key = new ArrayBuffer(16);
  f.task.aesConf.decryption = { decrypt: () => { throw new Error('bad AES'); } } as any;
  await f.downloader.startTask(f.id);
  for (let attempt = 0; attempt < 4; attempt++) {
    Request.all[Request.all.length - 1].respond();
    await drain();
    if (attempt < 3) jest.advanceTimersByTime((attempt + 1) * 1000);
  }
  expect(saveIndexedDBVideoSegment).not.toHaveBeenCalled();
  expect(f.task).toMatchObject({ status: 'error', finishNum: 0, errorNum: 1 });
  expect(f.task.errorMessage).toContain('bad AES');
});

it('settles exhausted persistence failures instead of hanging', async () => {
  const f = await fixture();
  jest.mocked(saveIndexedDBVideoSegment).mockRejectedValue(new Error('write failed'));
  await f.downloader.startTask(f.id);
  for (let attempt = 0; attempt < 4; attempt++) {
    Request.all[Request.all.length - 1].respond();
    await drain();
    if (attempt < 3) jest.advanceTimersByTime((attempt + 1) * 1000);
  }
  expect(f.task).toMatchObject({ status: 'error', finishNum: 0, errorNum: 1 });
  expect(saveIndexedDBVideoManifest).not.toHaveBeenCalled();
  jest.mocked(saveIndexedDBVideoSegment).mockResolvedValue(1);
});

it.each([200, 204])('rejects HTTP %s empty segment bodies without saving or counting success', async status => {
  const f = await fixture();
  await f.downloader.startTask(f.id);
  for (let attempt = 0; attempt < 4; attempt++) {
    const request = Request.all[Request.all.length - 1];
    request.status = status;
    request.response = new ArrayBuffer(0);
    request.respond();
    await drain();
    if (attempt < 3) jest.advanceTimersByTime((attempt + 1) * 1000);
  }
  expect(saveIndexedDBVideoSegment).not.toHaveBeenCalled();
  expect(saveIndexedDBVideoManifest).not.toHaveBeenCalled();
  expect(f.task).toMatchObject({ status: 'error', finishNum: 0, errorNum: 1 });
  expect(f.task.errorMessage).toContain('分片响应为空');
  expect(f.onError).toHaveBeenCalledTimes(1);
});

it.each([
  ['NaN', 6], ['Infinity', 6], ['0', 6], ['-1', 6], ['1.5', 6], ['33', 6],
  ['1', 1], ['6', 6], ['32', 32],
])('normalizes stored thread count %s to %s requests', async (stored, expected) => {
  localStorage.setItem('downloadThreadsPerTask', String(stored));
  const f = await fixture(40);
  await f.downloader.startTask(f.id);
  expect(f.task.status).toBe('downloading');
  expect(f.task.requests).toHaveLength(Number(expected));
});

function requireKey(task: Awaited<ReturnType<typeof fixture>>['task']) {
  task.aesConf.method = 'AES-128';
  task.aesConf.uri = 'https://example.com/key';
}

it.each(['pause', 'cancel'])('does not resurrect a %sd startup when the AES key arrives late', async action => {
  const f = await fixture();
  requireKey(f.task);
  const starting = f.downloader.startTask(f.id);
  await f.downloader.startTask(f.id);
  expect(Request.all).toHaveLength(2);
  if (action === 'pause') f.downloader.pauseTask(f.id);
  else await f.downloader.cancelTask(f.id);
  Request.all[1].response = new ArrayBuffer(16);
  Request.all[1].respond();
  await starting;
  expect(Request.all).toHaveLength(2);
  expect(f.task.status).toBe('pause');
  expect(f.task.requests).toHaveLength(0);
  expect(f.onError).not.toHaveBeenCalled();
});

it('shares a pending key across pause/resume without reviving the old run', async () => {
  const f = await fixture();
  requireKey(f.task);
  const first = f.downloader.startTask(f.id);
  f.downloader.pauseTask(f.id);
  const second = f.downloader.startTask(f.id);
  expect(Request.all).toHaveLength(2);
  Request.all[1].response = new ArrayBuffer(16);
  Request.all[1].respond();
  await Promise.all([first, second]);
  expect(Request.all).toHaveLength(3);
  expect(f.task.requests).toHaveLength(1);
});

it.each(['length', 'expand', 'timeout', 'error', 'abort', 'http'])('settles AES key %s failures as task errors', async mode => {
  const f = await fixture();
  requireKey(f.task);
  if (mode === 'expand') jest.spyOn(AESDecryptor.prototype, 'expandKey').mockImplementation(() => { throw new Error('expand failed'); });
  const starting = f.downloader.startTask(f.id);
  const key = Request.all[1];
  if (mode === 'timeout') key.ontimeout?.();
  else if (mode === 'error') key.onerror?.();
  else if (mode === 'abort') key.onabort?.();
  else {
    if (mode === 'http') key.status = 403;
    key.response = new ArrayBuffer(mode === 'length' ? 8 : 16);
    expect(() => key.respond()).not.toThrow();
  }
  await expect(starting).resolves.toBeUndefined();
  expect(f.task.status).toBe('error');
  expect(f.task.errorMessage).toBeTruthy();
  expect(f.onError).toHaveBeenCalledTimes(1);
  expect(f.task.aesConf.key).toBeNull();
  expect(Request.all).toHaveLength(2);
});

it('rejects declared AES segments without a decryptor instead of persisting ciphertext', async () => {
  const f = await fixture();
  requireKey(f.task);
  f.task.aesConf.key = new ArrayBuffer(16);
  await f.downloader.startTask(f.id);
  for (let attempt = 0; attempt < 4; attempt++) {
    Request.all[Request.all.length - 1].respond();
    await drain();
    if (attempt < 3) jest.advanceTimersByTime((attempt + 1) * 1000);
  }
  expect(f.task).toMatchObject({ status: 'error', finishNum: 0 });
  expect(saveIndexedDBVideoSegment).not.toHaveBeenCalled();
});

it.each(['resolve', 'reject'])('waits for an entered segment write to %s before deleting cache and blocks restart during cancel', async outcome => {
  const f = await fixture();
  const events: string[] = [];
  let finish!: () => void;
  jest.mocked(saveIndexedDBVideoSegment).mockImplementationOnce(() => new Promise((resolve, reject) => {
    finish = () => {
      events.push('write');
      if (outcome === 'reject') reject(new Error('write failed during cancel'));
      else resolve(1);
    };
  }));
  jest.mocked(deleteIndexedDBVideoCache).mockImplementationOnce(async () => { events.push('delete'); });
  await f.downloader.startTask(f.id);
  Request.all[1].respond();
  await drain();
  const cancelling = f.downloader.cancelTask(f.id);
  const cancellingAgain = f.downloader.cancelTask(f.id);
  await f.downloader.startTask(f.id);
  expect(Request.all).toHaveLength(2);
  expect(deleteIndexedDBVideoCache).not.toHaveBeenCalled();
  finish();
  await Promise.all([cancelling, cancellingAgain]);
  await drain();
  expect(events).toEqual(['write', 'delete']);
  expect(saveIndexedDBVideoManifest).not.toHaveBeenCalled();
  expect(f.onComplete).not.toHaveBeenCalled();
});

it('waits for an entered completed-manifest write, then deletes it without completing the task', async () => {
  const f = await fixture();
  const events: string[] = [];
  let finish!: () => void;
  jest.mocked(saveIndexedDBVideoManifest).mockImplementationOnce(() => new Promise(resolve => {
    finish = () => { events.push('manifest'); resolve({} as any); };
  }));
  jest.mocked(deleteIndexedDBVideoCache).mockImplementationOnce(async () => { events.push('delete'); });
  await f.downloader.startTask(f.id);
  Request.all[1].respond();
  await drain();
  const cancelling = f.downloader.cancelTask(f.id);
  expect(deleteIndexedDBVideoCache).not.toHaveBeenCalled();
  finish();
  await cancelling;
  await drain();
  expect(events).toEqual(['manifest', 'delete']);
  expect(f.onComplete).not.toHaveBeenCalled();
});

it('does not start a new manifest write after cancellation during size lookup', async () => {
  const f = await fixture();
  let finish!: () => void;
  jest.mocked(getIndexedDBVideoCacheSize).mockImplementationOnce(() => new Promise(resolve => {
    finish = () => resolve(1);
  }));
  await f.downloader.startTask(f.id);
  Request.all[1].respond();
  await drain();
  const cancelling = f.downloader.cancelTask(f.id);
  finish();
  await cancelling;
  expect(saveIndexedDBVideoManifest).not.toHaveBeenCalled();
  expect(deleteIndexedDBVideoCache).toHaveBeenCalledTimes(1);
});

it('restores cached content with the original identity without any XHR', async () => {
  const downloader = new M3U8Downloader();
  const id = await downloader.createTask('https://example.com/offline.m3u8', 'offline', 'TS', undefined,
    { id: 'original-id', createdAt: 123, m3u8Content: '#EXTM3U\n#EXTINF:6,\na.ts\n#EXT-X-ENDLIST' });
  expect(Request.all).toHaveLength(0);
  expect(id).toBe('original-id');
  expect(downloader.getTask(id)).toMatchObject({ id: 'original-id', createdAt: 123 });
  const task = downloader.getTask(id)!;
  task.downloadMode = 'indexeddb';
  await downloader.startTask(id);
  Request.all[0].respond();
  await drain();
  expect(jest.mocked(saveIndexedDBVideoSegment).mock.calls[0][0].cacheKey).toBe('task::original-id');
});

it('keeps restore local-only when the saved playlist is missing', async () => {
  const downloader = new M3U8Downloader();
  await expect(downloader.createTask('https://example.com/offline.m3u8', 'offline', 'TS', undefined,
    { id: 'legacy', createdAt: 123 })).rejects.toThrow('缺少保存的媒体播放列表');
  expect(Request.all).toHaveLength(0);
});

it.each(['segment_00000.ts', 'playlist.m3u8'])('waits for filesystem %s writes before removing the episode directory', async blocked => {
  const f = await fixture();
  const events: string[] = [];
  let finish!: () => void;
  let entered = false;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const removeEntry = jest.fn(async () => { events.push('delete'); });
  const directory: any = {
    getDirectoryHandle: jest.fn(async () => directory),
    removeEntry,
    getFileHandle: jest.fn(async (name: string) => ({
      createWritable: async () => ({
        write: async () => {
          if (name === blocked) { entered = true; await gate; }
          events.push(`write:${name}`);
        },
        close: async () => { events.push(`close:${name}`); },
      }),
    })),
  };
  f.task.downloadMode = 'filesystem';
  f.task.filesystemDirHandle = directory;
  await f.downloader.startTask(f.id);
  Request.all[1].respond();
  await drain();
  await drain();
  expect(entered).toBe(true);
  const cancelling = f.downloader.cancelTask(f.id);
  expect(removeEntry).not.toHaveBeenCalled();
  finish();
  await cancelling;
  await drain();
  expect(events[events.length - 1]).toBe('delete');
  expect(removeEntry).toHaveBeenCalledWith('ep1', { recursive: true });
  expect(f.onComplete).not.toHaveBeenCalled();
});
