import { useEffect, type RefObject } from 'react';
import { desktopBridge } from './bridge';

/**
 * Tells the shell whether this window is playing video, so it keeps the display awake meanwhile. A page that goes away
 * reports false, otherwise the screen would stay on after Back.
 */
export function useReportPlaying(videoRef: RefObject<HTMLVideoElement | null>): void {
  useEffect(() => {
    const bridge = desktopBridge();
    const video = videoRef.current;
    if (!bridge || !video) return;
    const report = (playing: boolean) => () => void bridge.reportPlaying(playing).catch(() => undefined);
    const playing = report(true);
    const stopped = report(false);
    video.addEventListener('playing', playing);
    video.addEventListener('pause', stopped);
    video.addEventListener('ended', stopped);
    return () => {
      video.removeEventListener('playing', playing);
      video.removeEventListener('pause', stopped);
      video.removeEventListener('ended', stopped);
      stopped();
    };
  }, [videoRef]);
}
