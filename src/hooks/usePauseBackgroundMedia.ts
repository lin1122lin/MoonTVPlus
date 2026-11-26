import { useEffect } from 'react';

export function usePauseBackgroundMedia(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const pause = (media: HTMLMediaElement) => {
      if (!media.closest('[data-download-player]')) media.pause();
    };
    // 下载弹层不会卸载底下的播放器，加载完成或连播仍可能重新触发 play。
    const onPlay = (event: Event) => {
      if (event.target instanceof HTMLMediaElement) pause(event.target);
    };
    document.addEventListener('play', onPlay, true);
    document.querySelectorAll<HTMLMediaElement>('video, audio').forEach(pause);
    return () => document.removeEventListener('play', onPlay, true);
  }, [active]);
}
