const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
let cachePromise;
const cache = () => cachePromise ||= (async () => {
  const ts = require('typescript');
  const result = ts.transpileModule(fs.readFileSync(path.resolve(root, '../../../src/lib/partial-cache-playlist.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 }, reportDiagnostics: true,
  });
  assert.equal(result.diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error), false);
  const asModule = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
  const source = fs.readFileSync(path.join(root, 'src/video-cache.js'), 'utf8')
    .replace("'./partial-cache-playlist.js'", JSON.stringify(asModule(result.outputText)));
  return import(asModule(source));
})();
const playlist = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nsegment_00000.ts\n#EXT-X-ENDLIST';

test('CSP restricts playback to blobs and all page assets are local', () => {
  const html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
  const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  const directives = new Map(policy.split(';').filter(value => value.trim()).map(value => {
    const [name, ...sources] = value.trim().split(/\s+/); return [name, sources];
  }));
  for (const name of ['default-src', 'worker-src', 'base-uri', 'form-action']) assert.deepEqual(directives.get(name), ["'none'"]);
  for (const name of ['connect-src', 'media-src']) assert.deepEqual(directives.get(name), ['blob:']);
  for (const name of ['script-src', 'style-src', 'img-src']) assert.deepEqual(directives.get(name), ["'self'"]);
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) assert.match(match[1], /^\.\/[\w.-]+$/);
  const app = fs.readFileSync(path.join(root, 'src/offline-app.js'), 'utf8');
  const reader = fs.readFileSync(path.join(root, 'src/video-cache.js'), 'utf8');
  assert.doesNotMatch(app + reader, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(|serviceWorker|https?:\/\//);
  assert.doesNotMatch(reader, /createObjectStore|['"]readwrite['"]|\.requestPermission\(/);
  assert.match(reader, /indexedDB\.open\(database\)/);
  assert.match(reader, /request\.transaction\.abort\(\)/);
});

test('background cancels pending loads but preserves attached playback for manual resume', () => {
  const app = fs.readFileSync(path.join(root, 'src/offline-app.js'), 'utf8');
  assert.match(app, /async function play\(task\)\s*\{\s*if \(document\.hidden\) return;/);
  assert.match(app, /cleanup\(\); const current = generation;\s*autoplayAllowed = !document\.hidden;/);
  assert.match(app, /const isCurrent = \(\) => current === generation;/);
  assert.match(app, /if \(!isCurrent\(\)\) \{ local\.objectUrls\?\.forEach\(url => URL\.revokeObjectURL\(url\)\); return; \}/);
  const manifestCallback = app.match(/hls\.on\(Hls\.Events\.MANIFEST_PARSED, \(\) => \{([\s\S]*?)\n    \}\);/)[1];
  assert.match(manifestCallback, /^\s*if \(!isCurrent\(\)\) return;\s*if \(!autoplayAllowed \|\| document\.hidden\) \{[^}]*return;\s*\}[\s\S]*video\.play\(\)/);
  const visibility = app.match(/document\.addEventListener\('visibilitychange', \(\) => \{([\s\S]*?)\n\}\);/);
  assert.ok(visibility);
  assert.match(visibility[1], /^\s*if \(document\.hidden\) \{\s*autoplayAllowed = false; video\.pause\(\);\s*if \(!hls\) cleanup\(\);/);
  assert.doesNotMatch(visibility[1], /\belse\b|\.play\(|\bplay\(/);
  assert.doesNotMatch(visibility[1], /removeAttribute|revokeObjectURL|\.destroy\(/);
  assert.match(app, /video\.addEventListener\('play', \(\) => \{\s*if \(document\.hidden\) \{ autoplayAllowed = false; video\.pause\(\); \}/);
  const cleanup = app.match(/function cleanup\(\) \{([\s\S]*?)\n\}/)[1];
  assert.match(cleanup, /generation\+\+/);
  assert.match(cleanup, /autoplayAllowed = false/);
  assert.match(cleanup, /hls\?\.destroy\(\)/);
  assert.match(cleanup, /video\.pause\(\)/);
  assert.match(cleanup, /URL\.revokeObjectURL\(url\)/);
});

test('rewrites local HLS segments and AES keys without remote fallbacks', async () => {
  const { rewriteLocalPlaylist } = await cache();
  const encrypted = playlist.replace('#EXTINF', '#EXT-X-KEY:METHOD=AES-128,URI="key.key",IV=0x00000000000000000000000000000001\n#EXTINF');
  const seen = [];
  const result = rewriteLocalPlaylist(encrypted.replaceAll('\n', '\r\n'), name => { seen.push(name); return 'blob:local-' + name; });
  assert.deepEqual(seen, ['key.key', 'segment_00000.ts']);
  assert.match(result, /URI="blob:local-key.key"/);
  assert.match(result, /\nblob:local-segment_00000.ts\n/);
  for (const attributes of ['IV=0x1,URI="key.key",METHOD=AES-128',
    'KEYFORMATVERSIONS="1",KEYFORMAT="identity",URI="key.key",IV=0xabc,METHOD=AES-128',
    'URI="key.key",METHOD=AES-128,IV=0x1234567890abcdef1234567890abcdef']) {
    const legacy = playlist.replace('#EXTINF', '#EXT-X-KEY:' + attributes + '\n#EXTINF');
    const converted = rewriteLocalPlaylist(legacy, () => 'blob:local');
    assert.match(converted, /URI="blob:local"/);
    assert.match(converted, /IV=0x[\da-f]{32}(?:,|\n)/);
  }
  assert.doesNotMatch(rewriteLocalPlaylist(playlist.replace('#EXTINF', '#EXT-X-KEY:METHOD=NONE\n#EXTINF'), () => 'blob:local'), /#EXT-X-KEY:/);
  for (const resource of ['https://example.com/a.ts', '//example.com/a.ts', '../segment_0.ts', 'segment_0.ts?x', 'blob:foreign', 'data:video/mp2t,x', 'key.key']) {
    assert.throws(() => rewriteLocalPlaylist(playlist.replace('segment_00000.ts', resource), () => 'blob:local'));
  }
  for (const tag of ['#EXT-X-MAP:URI="https://example.com/init"', '#EXT-X-PART:URI="segment_0.ts"',
    '#EXT-X-STREAM-INF:BANDWIDTH=1', '#EXT-X-DEFINE:NAME="x",VALUE="remote"',
    '#EXT-X-KEY:METHOD=AES-128,URI="https://example.com/key"', '#EXT-X-KEY:METHOD=AES-128,URI="key.key",URI="evil"',
    '#EXT-X-KEY:METHOD=AES-128,URI="key.key",URI="key.key"',
    '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key.key"', '#EXT-X-KEY:METHOD=AES-128,URI="key.key",KEYFORMAT="com.apple"',
    '#EXT-X-KEY:METHOD=AES-128,URI="key.key",IV=0x', '#EXT-X-KEY:METHOD=AES-128,URI="key.key",IV=0x1234567890abcdef1234567890abcdef1',
    '#EXT-X-KEY:URI="key.key"', '#EXT-X-KEY:METHOD=AES-128']) {
    assert.throws(() => rewriteLocalPlaylist(playlist.replace('#EXTINF', tag + '\n#EXTINF'), () => 'blob:local'));
  }
  assert.throws(() => rewriteLocalPlaylist(playlist, () => 'https://example.com/a.ts'));
  assert.throws(() => rewriteLocalPlaylist('#EXTM3U\n#EXT-X-ENDLIST', () => 'blob:local'));
  assert.throws(() => rewriteLocalPlaylist(null, () => 'blob:local'));
});

test('legacy ALLOW-CACHE metadata remains compatible without permitting resource attributes', async () => {
  const { rewriteLocalPlaylist } = await cache();
  for (const value of ['YES', 'NO']) {
    const legacy = playlist.replace('#EXTINF', `#EXT-X-ALLOW-CACHE:${value}\n#EXTINF`);
    const seen = [];
    const converted = rewriteLocalPlaylist(legacy, name => { seen.push(name); return 'blob:local'; });
    assert.ok(converted.includes(`#EXT-X-ALLOW-CACHE:${value}\n`));
    assert.deepEqual(seen, ['segment_00000.ts']);
    assert.match(converted, /\nblob:local\n/);
  }
  for (const value of ['MAYBE', 'YES,URI="https://example.com/a.ts"']) {
    assert.throws(() => rewriteLocalPlaylist(playlist.replace('#EXTINF', `#EXT-X-ALLOW-CACHE:${value}\n#EXTINF`), () => 'blob:local'));
  }
});

test('clear media signature requires five TS sync bytes or bounded adjacent MP4 boxes', async () => {
  const { isClearMedia } = await cache();
  const ts = new Uint8Array(188 * 5);
  for (let index = 0; index < 5; index++) ts[index * 188] = 0x47;
  assert.equal(isClearMedia(ts), true);
  assert.equal(isClearMedia(ts.subarray(0, ts.length - 1)), false);
  ts[752] = 0;
  assert.equal(isClearMedia(ts), false);
  assert.equal(isClearMedia(null), false);
  const box = (type, size = 16, brand = 'isom') => {
    const bytes = Buffer.alloc(size);
    bytes.writeUInt32BE(size); bytes.write(type, 4, 4, 'ascii');
    if (['ftyp', 'styp'].includes(type) && size >= 16) bytes.write(brand, 8, 4, 'ascii');
    return bytes;
  };
  for (const [first, next] of [['ftyp', 'moov'], ['styp', 'moof'], ['moof', 'mdat']]) {
    const sample = Buffer.concat([box(first), box(next)]);
    assert.equal(isClearMedia(sample), true);
    assert.equal(isClearMedia(sample.subarray(0, 23)), false);
    const offsetBuffer = Buffer.concat([Buffer.alloc(3), sample]);
    assert.equal(isClearMedia(offsetBuffer.subarray(3)), true);
  }
  for (const brand of ['isom', 'iso2', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'dash', 'cmfc', 'cmfs', 'MSNV']) {
    assert.equal(isClearMedia(Buffer.concat([box('ftyp', 16, brand), box('moov')])), true);
  }
  for (const sample of [Buffer.concat([box('free'), box('mdat')]), Buffer.concat([box('ftyp'), box('free')]),
    Buffer.concat([box('ftyp', 8), box('moov')]), Buffer.concat([box('ftyp', 18), box('moov')]),
    Buffer.concat([box('ftyp', 16, 'xxxx'), box('moov')]), Buffer.concat([box('ftyp'), box('mdat')]),
    Buffer.concat([box('styp'), box('mdat')]), Buffer.concat([box('moof'), box('moof')])]) assert.equal(isClearMedia(sample), false);
  const invalid = Buffer.concat([box('moof'), box('mdat')]);
  for (const size of [0, 1, 7, 100000]) {
    invalid.writeUInt32BE(size, 0);
    assert.equal(isClearMedia(invalid), false);
  }
  invalid.writeUInt32BE(16, 0); invalid.writeUInt32BE(100000, 16);
  assert.equal(isClearMedia(invalid), false);
  assert.equal(isClearMedia(invalid, 100016), true);
});

test('per-segment clear detection removes only identity AES and restores keys across mixed segments', async () => {
  const { rewriteLocalPlaylist } = await cache();
  const key1 = '#EXT-X-KEY:METHOD=AES-128,URI="key.key",IV=0x1';
  const key2 = '#EXT-X-KEY:URI="key.key",METHOD=AES-128,IV=0x2,KEYFORMAT="identity"';
  const source = ['#EXTM3U', key1, 'segment_0.ts', 'segment_1.ts', 'segment_2.ts', key2,
    'segment_3.ts', 'segment_4.ts', '#EXT-X-KEY:METHOD=NONE', 'segment_5.ts', '#EXT-X-ENDLIST'].join('\n');
  const converted = rewriteLocalPlaylist(source, name => 'blob:' + name, new Set(['segment_1.ts', 'segment_3.ts']));
  const keys = converted.split('\n').filter(line => line.startsWith('#EXT-X-KEY:'));
  assert.equal(keys.length, 6);
  assert.match(keys[0], /URI="blob:key.key".*IV=0x0{31}1/);
  assert.equal(keys[1], '#EXT-X-KEY:METHOD=NONE');
  assert.equal(keys[2], keys[0]);
  assert.equal(keys[3], '#EXT-X-KEY:METHOD=NONE');
  assert.match(keys[4], /IV=0x0{31}2,KEYFORMAT="identity"/);
  assert.equal(keys[5], '#EXT-X-KEY:METHOD=NONE');
  const allClear = new Set(Array.from({ length: 6 }, (_, index) => `segment_${index}.ts`));
  const reads = [];
  assert.doesNotMatch(rewriteLocalPlaylist(source, name => { reads.push(name); return 'blob:' + name; }, allClear), /#EXT-X-KEY:/);
  assert.equal(reads.includes('key.key'), false);
  for (const key of ['#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key.key"', '#EXT-X-KEY:METHOD=AES-128,URI="key.key",KEYFORMAT="drm"']) {
    assert.throws(() => rewriteLocalPlaylist(source.replace(key1, key), name => 'blob:' + name, allClear));
  }
});

test('offline rows validate partial metadata and deduplicate episodes with completed cache priority', async () => {
  const { buildOfflineRows } = await cache();
  const task = { source: 's', videoId: 'v', episodeIndex: 0, downloadMode: 'indexeddb',
    rangeDownload: { startSegment: 0, endSegment: 2 }, m3u8Content: playlist, status: 'pause' };
  const incomplete = { ...task, cacheKey: 's::v::0', completed: false };
  let rows = buildOfflineRows([incomplete], [{ ...task, title: 'old record' }], [task, { ...task }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].completed, false);
  assert.equal(rows[0].activeTask.m3u8Content, playlist);
  rows = buildOfflineRows([{ ...incomplete, completed: true }], [task], [task]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].completed, true);
  assert.equal(rows[0].activeTask, undefined);
  for (const invalid of [{ ...task, source: '' }, { ...task, videoId: null }, { ...task, episodeIndex: -1 },
    { ...task, episodeIndex: 0.5 }, { ...task, m3u8Content: '' }, { ...task, rangeDownload: null },
    { ...task, rangeDownload: { startSegment: 2, endSegment: 1 } }, { ...task, downloadMode: 'browser' }]) {
    assert.deepEqual(buildOfflineRows([], [], [invalid]), []);
  }
  assert.deepEqual(buildOfflineRows([{ ...incomplete, cacheKey: 'wrong' }], [], []), []);
});

test('old browser and filesystem records never suppress same-episode IDB partial and stay visible', async () => {
  const { buildOfflineRows } = await cache();
  const active = { source: 's', videoId: 'v', episodeIndex: 0, downloadMode: 'indexeddb',
    rangeDownload: { startSegment: 0, endSegment: 1 }, m3u8Content: playlist };
  const records = ['browser', 'filesystem'].map(downloadMode => ({ ...active, downloadMode, id: downloadMode,
    title: 'old export', completed: true, completedAt: 1 }));
  for (const external of [[records[0]], [records[1]], records]) {
    const rows = buildOfflineRows([], external, [active, { ...active }]);
    const partial = rows.filter(row => row.downloadMode === 'indexeddb');
    assert.equal(partial.length, 1);
    assert.deepEqual(partial[0].activeTask, active);
    assert.equal(partial[0].completed, false);
    assert.equal(rows.length, external.length + 1);
    assert.deepEqual(rows.filter(row => row.downloadMode !== 'indexeddb').map(row => row.id), external.map(row => row.id));
    assert.ok(rows.every(row => row.completed === false));
  }
  const manifest = { ...active, cacheKey: 's::v::0', completed: true };
  const rows = buildOfflineRows([manifest], records, [active]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].completed, true);
  assert.equal(rows[0].activeTask, undefined);
  assert.deepEqual(rows.slice(1).map(row => row.downloadMode), ['browser', 'filesystem']);
});

test('partial playback checks real blobs and delegates continuous-prefix selection to shared helper', async () => {
  const { getPartialIndexedDBPlaybackUrl } = await cache();
  const originalIDB = globalThis.indexedDB, originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  const records = new Map(), reads = [], created = [], revoked = [];
  globalThis.indexedDB = { open(database) {
    assert.equal(database, 'MoonTVPlusVideoCache');
    const request = { result: {
      close() {}, objectStoreNames: { contains: store => store === 'segments' },
      transaction(store, mode) {
        assert.equal(store, 'segments'); assert.equal(mode, 'readonly');
        const transaction = { objectStore: () => ({ get(key) {
          reads.push(key);
          const query = { result: records.get(key) };
          queueMicrotask(() => { query.onsuccess(); transaction.oncomplete(); });
          return query;
        } }) };
        return transaction;
      },
    } };
    queueMicrotask(() => request.onsuccess()); return request;
  } };
  URL.createObjectURL = file => { const url = 'blob:partial-' + created.length; created.push({ url, file }); return url; };
  URL.revokeObjectURL = url => revoked.push(url);
  const task = { source: 's', videoId: 'v', episodeIndex: 0, downloadMode: 'indexeddb',
    rangeDownload: { startSegment: 0, endSegment: 4 }, finishNum: 4,
    m3u8Content: '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:7\n' + Array.from({ length: 4 }, (_, index) => `#EXTINF:6,\nhttps://example.com/${index}.ts`).join('\n') };
  const snapshot = JSON.stringify(task);
  try {
    for (const data of [undefined, new Blob([]), 'not a blob']) {
      records.set('s::v::0:segment:0', { data }); reads.length = 0;
      await assert.rejects(getPartialIndexedDBPlaybackUrl(task), /首片缺失/);
      assert.deepEqual(reads, ['s::v::0:segment:0']);
    }
    records.set('s::v::0:segment:0', { data: new Blob(['zero']) });
    records.set('s::v::0:segment:2', { data: new Blob(['two']) });
    reads.length = 0;
    const partial = await getPartialIndexedDBPlaybackUrl(task);
    assert.equal(partial.partial, true); assert.equal(partial.segmentCount, 1); assert.equal(partial.duration, 6);
    assert.deepEqual(reads, ['s::v::0:segment:0', 's::v::0:segment:1']);
    const output = await created.at(-1).file.text();
    assert.match(output, /#EXT-X-MEDIA-SEQUENCE:7/); assert.match(output, /#EXT-X-ENDLIST/);
    assert.doesNotMatch(output, /https?:|segment_2|key.key/);
    records.set('s::v::0:segment:1', { data: new Blob(['one']) }); reads.length = 0;
    const ranged = await getPartialIndexedDBPlaybackUrl({ ...task, rangeDownload: { startSegment: 1, endSegment: 4 } });
    assert.equal(ranged.segmentCount, 2);
    assert.match(await created.at(-1).file.text(), /#EXT-X-MEDIA-SEQUENCE:8/);
    assert.deepEqual(reads, ['s::v::0:segment:1', 's::v::0:segment:2', 's::v::0:segment:3']);
    reads.length = 0;
    await assert.rejects(getPartialIndexedDBPlaybackUrl({ ...task, rangeDownload: { startSegment: 0, endSegment: 5 } }));
    assert.deepEqual(reads, []);
    await assert.rejects(getPartialIndexedDBPlaybackUrl(task, () => false), /取消/);
    assert.deepEqual(reads, []);
    assert.equal(JSON.stringify(task), snapshot);
    assert.deepEqual(revoked, []);
  } finally {
    if (originalIDB === undefined) delete globalThis.indexedDB; else globalThis.indexedDB = originalIDB;
    URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke;
  }
});

test('playback probes only blob prefixes and loads a key only for remaining ciphertext', async () => {
  const { createLocalPlayback } = await cache();
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  const created = [], revoked = [], probes = [], reads = [];
  URL.createObjectURL = file => { const url = 'blob:probe-' + created.length; created.push({ url, file }); return url; };
  URL.revokeObjectURL = url => revoked.push(url);
  class PrefixOnlyBlob extends Blob {
    arrayBuffer() { throw new Error('must not read entire segment'); }
    slice(start, end) { probes.push([start, end]); return super.slice(start, end); }
  }
  const ts = new Uint8Array(10000);
  for (let index = 0; index < 5; index++) ts[index * 188] = 0x47;
  const clear = new PrefixOnlyBlob([ts]), cipher = new PrefixOnlyBlob([new Uint8Array(1024)]);
  const source = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.key"\nsegment_0.ts\nsegment_1.ts\nsegment_2.ts\n#EXT-X-ENDLIST';
  try {
    await createLocalPlayback(source, async name => {
      reads.push(name); if (name === 'key.key') throw new Error('unnecessary key read'); return clear;
    });
    assert.equal(reads.includes('key.key'), false);
    assert.doesNotMatch(await created.at(-1).file.text(), /#EXT-X-KEY:/);
    reads.length = 0; created.length = 0;
    await createLocalPlayback(source, async name => {
      reads.push(name); return name === 'key.key' ? new Blob([new Uint8Array(16)]) : name === 'segment_1.ts' ? clear : cipher;
    });
    assert.equal(reads.filter(name => name === 'key.key').length, 1);
    const keys = (await created.at(-1).file.text()).split('\n').filter(line => line.startsWith('#EXT-X-KEY:'));
    assert.equal(keys.length, 3);
    assert.match(keys[0], /METHOD=AES-128/);
    assert.equal(keys[1], '#EXT-X-KEY:METHOD=NONE');
    assert.equal(keys[2], keys[0]);
    assert.ok(probes.length >= 6);
    for (const probe of probes) assert.deepEqual(probe, [0, 4096]);
    probes.length = 0; reads.length = 0;
    const mp4 = Buffer.alloc(8208);
    mp4.writeUInt32BE(8192, 0); mp4.write('moof', 4, 4, 'ascii');
    mp4.writeUInt32BE(16, 8192); mp4.write('mdat', 8196, 4, 'ascii');
    await createLocalPlayback(source, async name => {
      reads.push(name); if (name === 'key.key') throw new Error('large clear moof must not need a key');
      return new PrefixOnlyBlob([mp4]);
    });
    assert.equal(reads.includes('key.key'), false);
    assert.deepEqual(probes, Array.from({ length: 3 }, () => [[0, 4096], [8192, 8200]]).flat());
    assert.doesNotMatch(await created.at(-1).file.text(), /#EXT-X-KEY:/);
    created.length = 0;
    await assert.rejects(createLocalPlayback(source, async name => name === 'key.key' ? undefined : cipher));
    assert.deepEqual(revoked, created.map(item => item.url));
    created.length = 0;
    let current = true;
    class CancelledProbeBlob extends Blob {
      slice() { return { arrayBuffer: async () => { current = false; return ts.buffer; } }; }
    }
    await assert.rejects(createLocalPlayback(source, async () => new CancelledProbeBlob(['segment']), () => current));
    assert.equal(created.length, 0);
  } finally { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; }
});

test('deduplicates local blobs and releases partial playback on failure or cancellation', async () => {
  const { createLocalPlayback } = await cache();
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  const created = [], revoked = [];
  URL.createObjectURL = file => { const url = 'blob:test-' + created.length; created.push({ url, file }); return url; };
  URL.revokeObjectURL = url => revoked.push(url);
  try {
    const result = await createLocalPlayback(playlist.replace('#EXT-X-ENDLIST', '#EXTINF:6,\nsegment_00000.ts\n#EXT-X-ENDLIST'), async () => new Blob(['segment']));
    assert.equal(created.length, 2);
    assert.equal(result.url, created[1].url);
    assert.match(await created[1].file.text(), /blob:test-0/);
    assert.deepEqual(result.objectUrls, created.map(item => item.url));
    created.length = 0;
    const twoSegments = playlist.replace('#EXT-X-ENDLIST', '#EXTINF:6,\nsegment_00001.ts\n#EXT-X-ENDLIST');
    await assert.rejects(createLocalPlayback(twoSegments, async name => name.endsWith('00000.ts') ? new Blob(['ok']) : undefined));
    assert.deepEqual(revoked, ['blob:test-0']);
    created.length = 0; revoked.length = 0;
    let current = true;
    await assert.rejects(createLocalPlayback(twoSegments, async () => { current = false; return new Blob(['ok']); }, () => current));
    assert.equal(created.length, 0);
    await assert.rejects(createLocalPlayback(twoSegments, async () => { throw new Error('read failed'); }));
    assert.equal(created.length, 0);
  } finally { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; }
});

test('legacy databases are only opened without upgrades and read through readonly transactions', async () => {
  const { readStore } = await cache();
  const original = globalThis.indexedDB;
  const opens = [], reads = [];
  let closed = 0, missing = false, aborted = false;
  globalThis.indexedDB = {
    open(...args) {
      opens.push(args);
      const request = {};
      request.transaction = { abort() { aborted = true; queueMicrotask(() => request.onerror()); } };
      request.result = {
        objectStoreNames: { contains: () => true },
        close() { closed++; },
        transaction(store, mode) {
          reads.push([store, mode]);
          const transaction = { objectStore: () => ({
            getAll: () => query(['legacy']), get: key => query({ key }),
          }) };
          const query = result => {
            const item = { result };
            queueMicrotask(() => { item.onsuccess(); transaction.oncomplete(); });
            return item;
          };
          return transaction;
        },
      };
      queueMicrotask(() => missing ? request.onupgradeneeded() : request.onsuccess());
      return request;
    },
  };
  try {
    assert.deepEqual(await readStore('MoonTVPlusVideoCache', 'manifests'), ['legacy']);
    assert.deepEqual(await readStore('MoonTVPlus', 'dirHandles', 'downloadDir'), { key: 'downloadDir' });
    assert.deepEqual(opens, [['MoonTVPlusVideoCache'], ['MoonTVPlus']]);
    assert.deepEqual(reads, [['manifests', 'readonly'], ['dirHandles', 'readonly']]);
    assert.ok(closed >= 2);
    missing = true;
    assert.deepEqual(await readStore('MoonTVPlusVideoCache', 'manifests'), []);
    assert.equal(aborted, true);
    globalThis.indexedDB.open = () => { throw new Error('denied'); };
    await assert.rejects(readStore('MoonTVPlus', 'completedTasks'), /denied/);
  } finally {
    if (original === undefined) delete globalThis.indexedDB; else globalThis.indexedDB = original;
  }
});

test('build emits the native allowlist contract with local HLS and no shared writable cache module', () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'lintvplus-offline-'));
  try {
    require('../build.cjs')(output);
    assert.deepEqual(fs.readdirSync(output).sort(), ['HLS-LICENSE.txt', 'hls.mjs', 'index.html', 'logo.png', 'offline-app.js', 'offline.css', 'video-cache.js', 'partial-cache-playlist.js'].sort());
    for (const name of ['index.html', 'offline-app.js', 'offline.css', 'video-cache.js']) {
      assert.deepEqual(fs.readFileSync(path.join(output, name)), fs.readFileSync(path.join(root, 'src', name)));
    }
    assert.deepEqual(fs.readFileSync(path.join(output, 'hls.mjs')), fs.readFileSync(require.resolve('hls.js/dist/hls.mjs')));
    assert.ok(fs.statSync(path.join(output, 'logo.png')).size > 0);
    assert.ok(fs.statSync(path.join(output, 'HLS-LICENSE.txt')).size > 0);
    const ts = require('typescript');
    const shared = ts.transpileModule(fs.readFileSync(path.resolve(root, '../../../src/lib/partial-cache-playlist.ts'), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 }, reportDiagnostics: true,
    });
    assert.equal(fs.readFileSync(path.join(output, 'partial-cache-playlist.js'), 'utf8'), shared.outputText);
    for (const name of ['offline-app.js', 'video-cache.js']) {
      const source = fs.readFileSync(path.join(output, name), 'utf8');
      for (const match of source.matchAll(/from ['"]\.\/([^'"]+)['"]/g)) assert.ok(fs.existsSync(path.join(output, match[1])));
    }
  } finally { fs.rmSync(output, { recursive: true, force: true }); }
});
