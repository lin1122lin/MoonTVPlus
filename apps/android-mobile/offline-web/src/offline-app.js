import Hls from './hls.mjs';
import { readStore, createLocalPlayback, getIndexedDBVideoPlaybackUrl, getPartialIndexedDBPlaybackUrl, buildOfflineRows } from './video-cache.js';

const $ = id => document.getElementById(id);
const video = $('video');
let hls, objectUrls = [], generation = 0, refreshGeneration = 0, autoplayAllowed = false;
const bridge = () => window.LinTVPlusAndroid;
$('native-tab').onclick = () => bridge()?.openDownloads();
$('files-tab').onclick = $('empty-files').onclick = openLocalVideo;

function openLocalVideo() {
  try {
    if (!bridge()?.openLocalVideo) throw new Error('本机文件入口尚不可用');
    bridge().openLocalVideo();
  } catch (error) { $('error').textContent = error.message || '无法打开本机文件'; $('error').hidden = false; }
}

async function load() {
  const current = ++refreshGeneration;
  $('error').hidden = true;
  try {
    const results = await Promise.allSettled([
      readStore('MoonTVPlusVideoCache', 'manifests'), readStore('MoonTVPlus', 'completedTasks'),
      readStore('MoonTVPlus', 'activeTasks'),
    ]);
    if (current !== refreshGeneration) return;
    const values = results.map(result => result.status === 'fulfilled' ? result.value : []);
    const rows = buildOfflineRows(...values);
    render(rows);
    $('summary').textContent = `${rows.filter(item => item.completed).length} 集完整缓存 · ${rows.filter(item => item.activeTask).length} 集部分缓存 · ${rows.filter(item => item.downloadMode !== 'indexeddb').length} 条其他下载记录`;
    $('empty').hidden = rows.length > 0;
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
  } catch (error) {
    if (current !== refreshGeneration) return;
    $('error').textContent = error?.message || '读取缓存失败'; $('error').hidden = false;
  }
}

function render(rows) {
  $('groups').replaceChildren();
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.source}::${row.videoId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.episodeIndex - b.episodeIndex);
    const section = document.createElement('section'); section.className = 'group';
    const heading = document.createElement('h3');
    heading.textContent = group[0].videoTitle || (typeof group[0].title === 'string' ? group[0].title.replace(/[_\s-]*第\s*\d+\s*集.*$/u, '') : '') || '已下载视频';
    section.append(heading);
    for (const task of group) {
      const row = document.createElement('div'); row.className = 'episode';
      const info = document.createElement('div'); info.className = 'episode-info';
      const title = document.createElement('strong'); title.textContent = task.episodeTitle || `第 ${task.episodeIndex + 1} 集`;
      const status = document.createElement('p');
      status.textContent = task.downloadMode === 'indexeddb' ? (task.completed ? '网页缓存 · 本机可播放' : task.activeTask ? '部分缓存 · 未完成' : '缓存记录存在，但视频不完整')
        : task.downloadMode === 'filesystem' ? '文件夹下载 · 需要原目录授权' : '文件导出记录 · 需选择实际文件';
      if (task.fileSize) status.textContent += ` · ${(task.fileSize / 1048576).toFixed(1)} MB`;
      info.append(title, status); row.append(info);
      const action = document.createElement('button');
      action.textContent = !['indexeddb', 'filesystem'].includes(task.downloadMode) ? '选择文件' : '播放';
      action.disabled = task.downloadMode === 'indexeddb' && !task.completed && !task.activeTask;
      action.onclick = () => !['indexeddb', 'filesystem'].includes(task.downloadMode) ? openLocalVideo() : play(task);
      row.append(action); section.append(row);
    }
    $('groups').append(section);
  }
}

async function filesystemPlayback(task, isCurrent) {
  const directory = await readStore('MoonTVPlus', 'dirHandles', 'downloadDir');
  if (!directory?.queryPermission) throw new Error('此设备没有原目录授权，请从“本机文件”打开视频或分片文件夹。');
  if (!isCurrent()) throw new Error('播放已取消');
  if (await directory.queryPermission({ mode: 'read' }) !== 'granted') throw new Error('原目录未授权，请从“本机文件”选择实际文件或目录。');
  if (![task.source, task.videoId].every(name => typeof name === 'string' && name && name !== '.' && name !== '..' && !/[\\/\x00]/.test(name))) throw new Error('缓存目录记录无效');
  const source = await directory.getDirectoryHandle(task.source);
  const show = await source.getDirectoryHandle(task.videoId);
  const episode = await show.getDirectoryHandle(`ep${task.episodeIndex + 1}`);
  const playlist = await (await episode.getFileHandle('playlist.m3u8')).getFile();
  return createLocalPlayback(await playlist.text(), async name => (await episode.getFileHandle(name)).getFile(), isCurrent);
}

function cleanup() {
  autoplayAllowed = false;
  generation++; hls?.destroy(); hls = undefined;
  video.pause(); video.removeAttribute('src'); video.load();
  objectUrls.forEach(url => URL.revokeObjectURL(url)); objectUrls = [];
}

async function play(task) {
  if (document.hidden) return;
  cleanup(); const current = generation;
  autoplayAllowed = !document.hidden;
  $('player-title').textContent = `${task.title || '已下载视频'} · 第 ${task.episodeIndex + 1} 集`;
  $('player-error').hidden = true; $('player-status').textContent = '正在读取本机缓存…';
  if (!$('player').open) $('player').showModal();
  try {
    const isCurrent = () => current === generation;
    const local = task.downloadMode === 'filesystem' ? await filesystemPlayback(task, isCurrent)
      : task.activeTask ? await getPartialIndexedDBPlaybackUrl(task.activeTask, isCurrent)
        : await getIndexedDBVideoPlaybackUrl(task.source, task.videoId, task.episodeIndex, isCurrent);
    if (!isCurrent()) { local.objectUrls?.forEach(url => URL.revokeObjectURL(url)); return; }
    if (!local.hasLocal || !local.url) throw new Error(local.reason || '本机视频缓存不完整');
    objectUrls = local.objectUrls || [];
    if (!local.url.startsWith('blob:')) throw new Error('仅支持本地视频资源');
    if (!Hls.isSupported()) throw new Error('当前 WebView 不支持此视频格式');
    hls = new Hls({ enableWorker: false, xhrSetup: (_xhr, url) => { if (!url.startsWith('blob:')) throw new Error('播放列表引用了未缓存资源'); } });
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      if (!isCurrent()) return;
      if (!autoplayAllowed || document.hidden) {
        $('player-status').textContent = '点击视频播放按钮继续'; return;
      }
      $('player-status').textContent = local.partial ? `部分缓存 · 首连续 ${local.segmentCount} 片 · ${Math.floor(local.duration)} 秒` : '本地播放';
      video.play().catch(() => { if (isCurrent()) $('player-status').textContent = '点击视频播放按钮继续'; });
    });
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal && isCurrent()) {
        cleanup(); $('player-error').textContent = '本地视频播放失败，缓存可能不完整或格式不受支持。';
        $('player-error').hidden = false; $('player-status').textContent = '';
      }
    });
    hls.loadSource(local.url); hls.attachMedia(video);
  } catch (error) {
    if (current === generation) { cleanup(); $('player-error').textContent = error?.message || '读取失败'; $('player-error').hidden = false; $('player-status').textContent = ''; }
  }
}
$('close-player').onclick = () => $('player').close();
$('player').addEventListener('close', cleanup);
video.addEventListener('play', () => {
  if (document.hidden) { autoplayAllowed = false; video.pause(); }
});
video.addEventListener('error', () => {
  if ($('player').open && hls) {
    cleanup(); $('player-error').textContent = '当前设备无法解码此本地视频。';
    $('player-error').hidden = false; $('player-status').textContent = '';
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    autoplayAllowed = false; video.pause();
    if (!hls) cleanup();
    $('player-status').textContent = '已暂停';
  }
});
window.addEventListener('pagehide', () => { refreshGeneration++; cleanup(); });
$('refresh').onclick = load;
load();
