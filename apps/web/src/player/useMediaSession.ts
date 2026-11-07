import { useEffect, useRef, type RefObject } from 'react';
import { SKIP_BACK_SEC, SKIP_FORWARD_SEC, type PlayerActions } from './usePlayerActions';

interface MediaSessionArgs {
  /** `null` until the title is known, so the metadata is written once with its final text. */
  title: string | null;
  artist: string;
  artworkUrl: string | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  actions: PlayerActions;
  onStop: () => void;
}

/**
 * Media keys and the Windows media flyout: title and poster are set once per title, `playbackState` follows the
 * video, and play, pause, stop (= Back), next (+30 s) and previous (-10 s) are handled. Everything is cleared again
 * when the player closes.
 */
export function useMediaSession({ title, artist, artworkUrl, videoRef, actions, onStop }: MediaSessionArgs): void {
  const latest = useRef({ actions, onStop });
  latest.current = { actions, onStop };

  useEffect(() => {
    if (!('mediaSession' in navigator) || title === null || typeof MediaMetadata === 'undefined') return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      ...(artworkUrl ? { artwork: [{ src: artworkUrl, sizes: '342x513', type: 'image/jpeg' }] } : {}),
    });
    return () => {
      navigator.mediaSession.metadata = null;
    };
  }, [title, artist, artworkUrl]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    const video = videoRef.current;
    const sync = () => {
      session.playbackState = video && !video.paused ? 'playing' : 'paused';
    };
    const handlers: Array<[MediaSessionAction, () => void]> = [
      ['play', () => void video?.play().catch(() => undefined)],
      ['pause', () => video?.pause()],
      ['stop', () => latest.current.onStop()],
      ['nexttrack', () => latest.current.actions.skip(SKIP_FORWARD_SEC)],
      ['previoustrack', () => latest.current.actions.skip(-SKIP_BACK_SEC)],
    ];
    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // an action this browser does not know
      }
    }
    video?.addEventListener('play', sync);
    video?.addEventListener('pause', sync);
    sync();
    return () => {
      video?.removeEventListener('play', sync);
      video?.removeEventListener('pause', sync);
      for (const [action] of handlers) {
        try {
          session.setActionHandler(action, null);
        } catch {
          // see above
        }
      }
      session.playbackState = 'none';
    };
  }, [videoRef]);
}
