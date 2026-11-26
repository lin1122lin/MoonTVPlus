interface AndroidDownloadsBridge {
  enqueueDownloads: (tasks: string) => void;
  openDownloads: () => void;
}

export function getAndroidDownloadsBridge():
  | AndroidDownloadsBridge
  | undefined {
  if (typeof window === 'undefined') return;
  const bridge = (
    window as Window & { LinTVPlusAndroid?: Partial<AndroidDownloadsBridge> }
  ).LinTVPlusAndroid;
  if (
    typeof bridge?.enqueueDownloads === 'function' &&
    typeof bridge.openDownloads === 'function'
  ) {
    return bridge as AndroidDownloadsBridge;
  }
}

export function androidDownloadsSelected(): boolean {
  return (
    typeof window !== 'undefined' &&
    localStorage.getItem('androidDownloadEngine') === 'native' &&
    Boolean(getAndroidDownloadsBridge())
  );
}

export function openAndroidDownloads(): boolean {
  if (!androidDownloadsSelected()) return false;
  getAndroidDownloadsBridge()?.openDownloads();
  return true;
}

export interface AndroidDownloadTask {
  url: string;
  title: string;
  source?: string;
  videoId?: string;
  episodeIndex: number;
  mediaType: 'hls' | 'file';
}

export function enqueueAndroidDownloads(tasks: AndroidDownloadTask[]) {
  const bridge = getAndroidDownloadsBridge();
  if (!bridge) throw new Error('需要新版安卓应用才能使用后台下载');
  if (!tasks.length || tasks.length > 50)
    throw new Error('每次请选择 1 至 50 集');
  const normalized = tasks.map((task) => {
    const url = new URL(task.url, window.location.origin);
    if (
      !/^https?:$/.test(url.protocol) ||
      url.username ||
      url.password ||
      !Number.isInteger(task.episodeIndex) ||
      task.episodeIndex < 0
    ) {
      throw new Error('下载地址或集数无效');
    }
    return { ...task, url: url.href };
  });
  bridge.enqueueDownloads(JSON.stringify(normalized));
}
