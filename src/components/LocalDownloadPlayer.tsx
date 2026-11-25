'use client';

import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { CompletedTask } from '@/lib/download-db';
import { getIndexedDBVideoPlaybackUrl } from '@/lib/indexeddb-video-cache';

export function LocalDownloadPlayer({
  task,
  onClose,
}: {
  task: CompletedTask;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('keydown', escape);
      previousFocus?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    document
      .querySelectorAll<HTMLMediaElement>('video, audio')
      .forEach((media) => {
        if (media !== video) media.pause();
      });
    let cancelled = false;
    let objectUrls: string[] = [];
    let hls: import('hls.js').default | undefined;
    setLoading(true);
    setError('');
    const start = async () => {
      try {
        const local = await getIndexedDBVideoPlaybackUrl(
          task.source,
          task.videoId,
          task.episodeIndex
        );
        if (cancelled) {
          local.objectUrls?.forEach((url) => URL.revokeObjectURL(url));
          return;
        }
        objectUrls = local.objectUrls || [];
        if (!local.hasLocal || !local.url)
          throw new Error('本地缓存不存在或未完成，请重新下载此集。');
        const { default: Hls } = await import('hls.js');
        if (cancelled) return;
        if (Hls.isSupported()) {
          hls = new Hls();
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) {
              setError('无法播放本地缓存，文件可能不完整或格式不受支持。');
              setLoading(false);
              hls?.destroy();
            }
          });
          hls.loadSource(local.url);
          hls.attachMedia(video);
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = local.url;
        } else throw new Error('当前设备不支持此视频格式。');
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error ? cause.message : '读取本地缓存失败。'
          );
          setLoading(false);
        }
      }
    };
    void start();
    return () => {
      cancelled = true;
      hls?.destroy();
      video.pause();
      video.removeAttribute('src');
      video.load();
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [task]);

  return (
    <div
      role='dialog'
      aria-modal='true'
      aria-labelledby='local-download-title'
      className='fixed inset-0 z-[10000] flex flex-col bg-black text-white'
      onKeyDown={(event) => {
        if (event.key === 'Tab') {
          // 原生视频控件在不同 WebView 中的焦点顺序不同，边界保持在播放器内。
          const target = event.target as HTMLElement;
          if (
            (!event.shiftKey && target === videoRef.current) ||
            (event.shiftKey && target === closeRef.current)
          ) {
            event.preventDefault();
            (event.shiftKey ? videoRef.current : closeRef.current)?.focus();
          }
        }
      }}
    >
      <header className='flex items-center gap-3 border-b border-white/20 px-4 py-3'>
        <div className='min-w-0 flex-1'>
          <h2
            id='local-download-title'
            className='break-words text-base font-medium'
          >
            {task.videoTitle || task.title} ·{' '}
            {task.episodeTitle || `第 ${task.episodeIndex + 1} 集`}
          </h2>
          <p className='text-sm text-green-400'>本地播放</p>
        </div>
        <button
          ref={closeRef}
          type='button'
          onClick={onClose}
          aria-label='关闭本地播放'
          title='关闭本地播放'
          className='flex h-11 w-11 shrink-0 items-center justify-center rounded hover:bg-white/20'
        >
          <X className='h-5 w-5' />
        </button>
      </header>
      <div className='relative flex min-h-0 flex-1 items-center justify-center'>
        <video
          ref={videoRef}
          controls
          playsInline
          autoPlay
          tabIndex={0}
          className='h-full w-full object-contain'
          aria-label='已下载视频'
          onLoadedMetadata={() => setLoading(false)}
          onError={() => {
            setError('本地视频播放失败，请检查缓存是否完整。');
            setLoading(false);
          }}
        />
        {loading && (
          <p role='status' className='pointer-events-none absolute'>
            正在读取本地缓存…
          </p>
        )}
        {error && (
          <p
            role='alert'
            className='absolute inset-x-4 top-4 rounded bg-red-950 p-3 text-center'
          >
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
