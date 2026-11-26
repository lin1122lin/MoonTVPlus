export interface PartialCachePlaylist {
  headers: string[];
  mediaSequence: number;
  discontinuitySequence: number;
  segments: Array<{ index: number; duration: number; lines: string[] }>;
}

export interface PartialCacheRange {
  startSegment: number;
  endSegment: number;
}

// Only keep tags that cannot reference remote resources. Cached segments are decrypted.
export function parsePartialCachePlaylist(content: string): PartialCachePlaylist {
  const lines = content.trim().split(/\r?\n/).map((line) => line.trim());
  if (lines[0] !== '#EXTM3U') throw new Error('无效的 M3U8 播放列表');
  const playlist: PartialCachePlaylist = {
    headers: ['#EXTM3U'], mediaSequence: 0, discontinuitySequence: 0, segments: [],
  };
  let pending: string[] = [];
  let duration: number | undefined;
  for (const line of lines.slice(1)) {
    if (/^#EXT-X-(STREAM-INF|MAP|BYTERANGE|PART|SKIP|GAP)(:|$)/.test(line)) {
      throw new Error('此播放列表暂不支持部分缓存播放');
    }
    if (line.startsWith('#EXT-X-KEY:')) {
      const attributes = Array.from(line.slice(11).matchAll(/(?:^|,)\s*([A-Z0-9-]+)\s*=\s*("[^"]*"|[^,]*)/g));
      const method = attributes.find((attribute) => attribute[1] === 'METHOD')?.[2].trim();
      if (method !== 'AES-128' && method !== 'NONE') {
        throw new Error('不支持此缓存的加密方式');
      }
    } else if (/^#EXT-X-(MEDIA|DISCONTINUITY)-SEQUENCE:/.test(line)) {
      const value = Number(line.slice(line.indexOf(':') + 1));
      if (!Number.isSafeInteger(value) || value < 0) throw new Error('无效的媒体序列');
      if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) playlist.mediaSequence = value;
      else playlist.discontinuitySequence = value;
    } else if (/^#EXT-X-(VERSION|TARGETDURATION):\d+$/.test(line) || line === '#EXT-X-INDEPENDENT-SEGMENTS') {
      playlist.headers.push(line);
    } else if (line.startsWith('#EXTINF:')) {
      if (duration !== undefined) throw new Error('分片缺少地址');
      duration = Number(line.slice(8).split(',')[0]);
      if (!Number.isFinite(duration) || duration <= 0) throw new Error('无效的分片时长');
      pending.push(line);
    } else if (line === '#EXT-X-DISCONTINUITY' || line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
      pending.push(line);
    } else if (line && !line.startsWith('#')) {
      if (duration === undefined) throw new Error('分片缺少 EXTINF');
      playlist.segments.push({ index: playlist.segments.length, duration, lines: pending });
      pending = [];
      duration = undefined;
    }
  }
  if (duration !== undefined || !playlist.segments.length) throw new Error('播放列表没有有效分片');
  return playlist;
}

export function selectPartialCachePrefix(
  playlist: PartialCachePlaylist,
  range: PartialCacheRange,
  getCachedUri: (index: number) => string | undefined
): { playlistContent: string; segmentCount: number; duration: number; firstMissingIndex?: number } {
  const { startSegment: start, endSegment: end } = range;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > playlist.segments.length) {
    throw new Error('无效的下载分片范围');
  }
  const skippedDiscontinuities = playlist.segments.slice(0, start).reduce(
    (count, segment) => count + segment.lines.filter((line) => line === '#EXT-X-DISCONTINUITY').length, 0
  );
  const mediaSequence = playlist.mediaSequence + start;
  const discontinuitySequence = playlist.discontinuitySequence + skippedDiscontinuities;
  if (!Number.isSafeInteger(mediaSequence) || !Number.isSafeInteger(discontinuitySequence)) {
    throw new Error('媒体序列位移超出安全整数范围');
  }
  const lines = [
    ...playlist.headers,
    '#EXT-X-PLAYLIST-TYPE:VOD',
    `#EXT-X-MEDIA-SEQUENCE:${mediaSequence}`,
    `#EXT-X-DISCONTINUITY-SEQUENCE:${discontinuitySequence}`,
  ];
  let segmentCount = 0;
  let duration = 0;
  let firstMissingIndex: number | undefined;
  for (let index = start; index < end; index++) {
    const uri = getCachedUri(index);
    if (!uri) { firstMissingIndex = index; break; }
    const segment = playlist.segments[index];
    lines.push(...segment.lines, uri);
    segmentCount++;
    duration += segment.duration;
  }
  lines.push('#EXT-X-ENDLIST');
  return { playlistContent: lines.join('\n'), segmentCount, duration, firstMissingIndex };
}
