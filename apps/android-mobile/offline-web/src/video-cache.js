import { parsePartialCachePlaylist, selectPartialCachePrefix } from './partial-cache-playlist.js';

export const buildIndexedDBVideoCacheKey = (source, videoId, episodeIndex) => `${source}::${videoId}::${episodeIndex}`;

const validEpisode = row => row && typeof row.source === 'string' && row.source.trim()
  && typeof row.videoId === 'string' && row.videoId.trim() && Number.isSafeInteger(row.episodeIndex) && row.episodeIndex >= 0;
const validPartialTask = task => validEpisode(task) && task.downloadMode === 'indexeddb'
  && typeof task.m3u8Content === 'string' && task.m3u8Content.trim()
  && Number.isSafeInteger(task.rangeDownload?.startSegment) && Number.isSafeInteger(task.rangeDownload?.endSegment)
  && task.rangeDownload.startSegment >= 0 && task.rangeDownload.endSegment > task.rangeDownload.startSegment;

export function buildOfflineRows(manifests, records, activeTasks) {
  const rows = new Map(), externalRecords = [];
  const keyOf = row => buildIndexedDBVideoCacheKey(row.source, row.videoId, row.episodeIndex);
  for (const task of records.filter(validEpisode)) {
    const row = { ...task, completed: false };
    if (task.downloadMode === 'indexeddb') rows.set(keyOf(task), row);
    else externalRecords.push(row);
  }
  for (const manifest of manifests.filter(validEpisode)) {
    const key = keyOf(manifest);
    if (manifest.cacheKey !== key) continue;
    rows.set(key, { ...rows.get(key), ...manifest, downloadMode: 'indexeddb', fileSize: manifest.totalSize });
  }
  for (const task of activeTasks.filter(validPartialTask)) {
    const key = keyOf(task);
    if (rows.get(key)?.completed === true) continue;
    rows.set(key, { ...rows.get(key), ...task, cacheKey: key, completed: false, activeTask: task });
  }
  return [...rows.values(), ...externalRecords];
}

// Opening without a version reads the existing schema; abort creation, never migrate it.
export function readStore(database, store, key) {
  return new Promise((resolve, reject) => {
    const empty = key === undefined ? [] : undefined;
    let settled = false, missing = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('读取本机缓存超时，请稍后重试')), 15000);
    let request;
    try { request = indexedDB.open(database); }
    catch (error) { finish(error); return; }
    request.onupgradeneeded = () => { missing = true; request.transaction.abort(); };
    request.onerror = () => finish(missing ? null : request.error || new Error('读取缓存数据库失败'), empty);
    request.onblocked = () => finish(new Error('缓存数据库正被占用，请稍后重试'));
    request.onsuccess = () => {
      const db = request.result;
      if (settled) { db.close(); return; }
      db.onversionchange = () => db.close();
      try {
        if (!db.objectStoreNames.contains(store)) { db.close(); finish(null, empty); return; }
        const transaction = db.transaction(store, 'readonly');
        const source = transaction.objectStore(store);
        const query = key === undefined ? source.getAll() : source.get(key);
        let result;
        query.onsuccess = () => { result = query.result; };
        transaction.oncomplete = () => { db.close(); finish(null, result); };
        transaction.onabort = transaction.onerror = () => {
          db.close(); finish(transaction.error || new Error('读取本机缓存失败'));
        };
        // Closing waits for this read transaction but avoids holding a connection on timeout.
        db.close();
      } catch (error) { db.close(); finish(error); }
    };
  });
}

export function isClearMedia(bytes, totalSize = bytes?.length, nextHeader) {
  if (!(bytes instanceof Uint8Array)) return false;
  if (bytes.length >= 188 * 5 && [0, 188, 376, 564, 752].every(index => bytes[index] === 0x47)) return true;
  if (bytes.length < 16 || !Number.isSafeInteger(totalSize) || totalSize < bytes.length) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fourCC = offset => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  const firstSize = view.getUint32(0);
  // shortcut: recognize adjacent 32-bit boxes only; unknown layouts keep AES.
  if (firstSize < 8 || firstSize > totalSize - 8) return false;
  const header = firstSize <= bytes.length - 8 ? bytes.subarray(firstSize, firstSize + 8) : nextHeader;
  if (!(header instanceof Uint8Array) || header.length !== 8) return false;
  const nextSize = new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(0);
  if (nextSize < 8 || nextSize > totalSize - firstSize) return false;
  const type = fourCC(4), next = String.fromCharCode(...header.subarray(4, 8));
  if (type === 'moof') return next === 'mdat';
  return ['ftyp', 'styp'].includes(type) && firstSize >= 16 && firstSize % 4 === 0
    && ['isom', 'iso2', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'dash', 'cmfc', 'cmfs', 'MSNV'].includes(fourCC(8))
    && ['moov', 'moof'].includes(next);
}

export function rewriteLocalPlaylist(content, resolve, clearNames = new Set()) {
  if (typeof content !== 'string' || !content.trimStart().startsWith('#EXTM3U')) throw new Error('本地播放列表无效');
  let segments = 0, key = null, emittedKey = null;
  const localUrl = name => {
    const url = resolve(name);
    if (typeof url !== 'string' || !url.startsWith('blob:')) throw new Error('缺少本地资源：' + name);
    return url;
  };
  const lines = content.split(/\r?\n/).map(line => {
    const value = line.trim();
    if (!value || value === '#EXTM3U') return value;
    if (/^segment_\d+\.ts$/i.test(value)) {
      segments++;
      const required = clearNames.has(value) ? null : key;
      let prefix = '';
      if (required !== emittedKey) {
        prefix = (required === null ? '#EXT-X-KEY:METHOD=NONE' : required.replace('"key.key"', `"${localUrl('key.key')}"`)) + '\n';
        emittedKey = required;
      }
      return prefix + localUrl(value);
    }
    if (value === '#EXT-X-KEY:METHOD=NONE') { key = null; return ''; }
    if (value.startsWith('#EXT-X-KEY:')) {
      const attributes = new Map();
      // Supported attribute values cannot contain commas; reject unknown or duplicate attributes.
      for (const part of value.slice('#EXT-X-KEY:'.length).split(',')) {
        const attribute = part.trim();
        if (!/^(?:METHOD=AES-128|URI="key\.key"|IV=0[xX][\da-fA-F]{1,32}|KEYFORMAT="identity"|KEYFORMATVERSIONS="1")$/.test(attribute)) throw new Error('本地密钥属性不受支持');
        const separator = attribute.indexOf('=');
        const name = attribute.slice(0, separator);
        if (attributes.has(name)) throw new Error('本地密钥属性重复');
        attributes.set(name, attribute.slice(separator + 1));
      }
      if (attributes.get('METHOD') !== 'AES-128' || attributes.get('URI') !== '"key.key"') throw new Error('本地密钥引用无效');
      // Pad short IVs to the same 128-bit value for consistent HLS decoder handling.
      if (attributes.has('IV')) attributes.set('IV', '0x' + attributes.get('IV').slice(2).padStart(32, '0'));
      key = '#EXT-X-KEY:' + [...attributes].map(([name, attribute]) => `${name}=${attribute}`).join(',');
      return '';
    }
    if (/^#EXTINF:\d+(?:\.\d+)?,[^\r\n]*$/.test(value)
        || /^#EXT-X-(?:VERSION|TARGETDURATION|MEDIA-SEQUENCE|DISCONTINUITY-SEQUENCE):\d+$/.test(value)
        || /^#EXT-X-PLAYLIST-TYPE:(?:VOD|EVENT)$/.test(value)
        || /^#EXT-X-ALLOW-CACHE:(?:YES|NO)$/.test(value)
        || /^#EXT-X-(?:ENDLIST|DISCONTINUITY|INDEPENDENT-SEGMENTS|I-FRAMES-ONLY)$/.test(value)
        || /^#EXT-X-BYTERANGE:\d+(?:@\d+)?$/.test(value)
        || /^#EXT-X-PROGRAM-DATE-TIME:[\dT:.+Z-]+$/.test(value)) return value;
    // Unknown HLS extensions may initiate requests (MAP, PART, master playlists, variables).
    if (value.startsWith('#') && !value.startsWith('#EXT')) return '';
    throw new Error('播放列表包含未缓存或不支持的资源');
  });
  if (!segments) throw new Error('本地播放列表没有视频分片');
  return lines.join('\n');
}

export async function createLocalPlayback(content, readFile, isCurrent = () => true) {
  const names = new Set(), urls = new Map(), objectUrls = [], clearNames = new Set();
  rewriteLocalPlaylist(content, name => { names.add(name); return 'blob:pending'; });
  try {
    const addFile = async name => {
      if (!isCurrent()) throw new Error('播放已取消');
      const file = await readFile(name);
      if (!isCurrent()) throw new Error('播放已取消');
      if (!(file instanceof Blob) || !file.size) throw new Error('缺少本地资源：' + name);
      if (name !== 'key.key' && content.includes('#EXT-X-KEY:')) {
        const prefix = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
        if (!isCurrent()) throw new Error('播放已取消');
        let nextHeader;
        if (prefix.length >= 16) {
          const firstSize = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength).getUint32(0);
          const type = String.fromCharCode(...prefix.subarray(4, 8));
          if (['ftyp', 'styp', 'moof'].includes(type) && firstSize > prefix.length - 8 && firstSize <= file.size - 8) {
            nextHeader = new Uint8Array(await file.slice(firstSize, firstSize + 8).arrayBuffer());
            if (!isCurrent()) throw new Error('播放已取消');
          }
        }
        if (isClearMedia(prefix, file.size, nextHeader)) clearNames.add(name);
      }
      const url = URL.createObjectURL(file);
      urls.set(name, url); objectUrls.push(url);
    };
    for (const name of names) if (name !== 'key.key') await addFile(name);
    const required = new Set();
    rewriteLocalPlaylist(content, name => { required.add(name); return 'blob:pending'; }, clearNames);
    for (const name of required) if (!urls.has(name)) await addFile(name);
    const playlist = rewriteLocalPlaylist(content, name => urls.get(name), clearNames);
    const url = URL.createObjectURL(new Blob([playlist], { type: 'application/vnd.apple.mpegurl' }));
    objectUrls.push(url);
    return { hasLocal: true, url, objectUrls };
  } catch (error) { objectUrls.forEach(url => URL.revokeObjectURL(url)); throw error; }
}

export async function getPartialIndexedDBPlaybackUrl(task, isCurrent = () => true) {
  if (!validPartialTask(task)) throw new Error('部分缓存任务元数据无效');
  const parsed = parsePartialCachePlaylist(task.m3u8Content);
  // Validate the saved range before touching segment records.
  selectPartialCachePrefix(parsed, task.rangeDownload, () => undefined);
  const cacheKey = buildIndexedDBVideoCacheKey(task.source, task.videoId, task.episodeIndex);
  const files = new Map();
  for (let index = task.rangeDownload.startSegment; index < task.rangeDownload.endSegment; index++) {
    if (!isCurrent()) throw new Error('播放已取消');
    const record = await readStore('MoonTVPlusVideoCache', 'segments', `${cacheKey}:segment:${index}`);
    if (!isCurrent()) throw new Error('播放已取消');
    if (!(record?.data instanceof Blob) || !record.data.size) break;
    files.set(index, record.data);
  }
  const prefix = selectPartialCachePrefix(parsed, task.rangeDownload, index => files.has(index) ? `segment_${index}.ts` : undefined);
  if (!prefix.segmentCount) throw new Error('部分缓存首片缺失，暂无可播放的连续内容');
  const local = await createLocalPlayback(prefix.playlistContent, async name => {
    const index = Number(/^segment_(\d+)\.ts$/i.exec(name)?.[1]);
    return files.get(index);
  }, isCurrent);
  return { ...local, segmentCount: prefix.segmentCount, duration: prefix.duration, partial: true };
}

export async function getIndexedDBVideoPlaybackUrl(source, videoId, episodeIndex, isCurrent) {
  const cacheKey = buildIndexedDBVideoCacheKey(source, videoId, episodeIndex);
  const manifest = await readStore('MoonTVPlusVideoCache', 'manifests', cacheKey);
  if (!manifest?.completed) throw new Error('本机视频缓存不完整');
  return createLocalPlayback(manifest.playlistContent, async name => {
    const segment = /^segment_(\d+)\.ts$/i.exec(name);
    const store = segment ? 'segments' : 'assets';
    const id = segment ? `${cacheKey}:segment:${Number(segment[1])}` : `${cacheKey}:asset:${name}`;
    return (await readStore('MoonTVPlusVideoCache', store, id))?.data;
  }, isCurrent);
}
