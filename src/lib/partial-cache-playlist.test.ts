import { parsePartialCachePlaylist, selectPartialCachePrefix } from './partial-cache-playlist';

const content = '#EXTM3U\r\n#EXT-X-TARGETDURATION:7\r\n#EXT-X-MEDIA-SEQUENCE:10\r\n' +
  '#EXT-X-DISCONTINUITY-SEQUENCE:2\r\n#EXT-X-KEY:URI="https://origin/key,a", METHOD = AES-128\r\n' +
  '#EXT-X-DISCONTINUITY\r\n#EXTINF:6.5,title\r\na.ts\r\n' +
  '#EXTINF:4.25,\r\nb.ts\r\n#EXT-X-DISCONTINUITY\r\n#EXTINF:5,\r\nc.ts\r\n#EXTINF:6,\r\nd.ts';

it('selects the continuous prefix from the range start, preserving timing and sequences without remote references', () => {
  const lookup = jest.fn((index: number) => new Map([[1, 'blob:one'], [2, 'blob:two']]).get(index));
  const result = selectPartialCachePrefix(parsePartialCachePlaylist(content), { startSegment: 1, endSegment: 4 }, lookup);
  expect(result).toMatchObject({ segmentCount: 2, duration: 9.25, firstMissingIndex: 3 });
  expect(result.playlistContent).toContain('#EXT-X-MEDIA-SEQUENCE:11');
  expect(result.playlistContent).toContain('#EXT-X-DISCONTINUITY-SEQUENCE:3');
  expect(result.playlistContent).toContain('#EXTINF:4.25,\nblob:one\n#EXT-X-DISCONTINUITY\n#EXTINF:5,\nblob:two');
  expect(result.playlistContent).toMatch(/#EXT-X-ENDLIST$/);
  expect(result.playlistContent).not.toMatch(/https:|KEY|\.ts/);
});

it('does not skip a missing first segment or consult later cached pieces', () => {
  const lookup = jest.fn((index: number) => index === 0 ? undefined : 'blob:later');
  expect(selectPartialCachePrefix(parsePartialCachePlaylist(content), { startSegment: 0, endSegment: 4 }, lookup))
    .toMatchObject({ segmentCount: 0, duration: 0, firstMissingIndex: 0 });
  expect(lookup.mock.calls).toEqual([[0]]);
});

it.each(['METHOD=AES-128,URI="key"', 'URI="key", METHOD = AES-128', 'METHOD = NONE'])(
  'removes the decrypted key with attributes %s', (attributes) => {
    const playlist = parsePartialCachePlaylist(`#EXTM3U\n#EXT-X-KEY:${attributes}\n#EXTINF:2,\n0.ts`);
    expect(selectPartialCachePrefix(playlist, { startSegment: 0, endSegment: 1 }, () => 'blob:0').playlistContent).not.toContain('KEY');
  }
);

it.each(['#EXT-X-MAP:URI="init.mp4"', '#EXT-X-BYTERANGE:10@0', '#EXT-X-KEY:URI="key",METHOD=SAMPLE-AES', '#EXT-X-KEY:URI="key,METHOD=AES-128"'])(
  'rejects unsupported resources or encryption: %s', (tag) => {
    expect(() => parsePartialCachePlaylist(`#EXTM3U\n${tag}\n#EXTINF:2,\n0.ts`)).toThrow();
  }
);

it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid sequence %s', (sequence) => {
  expect(() => parsePartialCachePlaylist(content.replace('MEDIA-SEQUENCE:10', `MEDIA-SEQUENCE:${sequence}`))).toThrow();
});

it.each(['MEDIA-SEQUENCE:10', 'DISCONTINUITY-SEQUENCE:2'])('rejects unsafe shifted %s', (tag) => {
  const playlist = parsePartialCachePlaylist(content.replace(tag, `${tag.split(':')[0]}:${Number.MAX_SAFE_INTEGER}`));
  expect(() => selectPartialCachePrefix(playlist, { startSegment: 1, endSegment: 4 }, () => 'blob:x')).toThrow('安全整数');
});

it('accepts the last safe shifted media sequence and rejects out-of-bounds ranges', () => {
  const playlist = parsePartialCachePlaylist(content.replace('MEDIA-SEQUENCE:10', `MEDIA-SEQUENCE:${Number.MAX_SAFE_INTEGER - 1}`));
  expect(selectPartialCachePrefix(playlist, { startSegment: 1, endSegment: 2 }, () => 'blob:x').playlistContent)
    .toContain(`#EXT-X-MEDIA-SEQUENCE:${Number.MAX_SAFE_INTEGER}`);
  expect(() => selectPartialCachePrefix(playlist, { startSegment: 0, endSegment: 5 }, () => 'blob:x')).toThrow('范围');
});
