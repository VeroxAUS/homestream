import type { PingState } from '@homestream/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { beaconProgress, sendProgress, stopSession } from './sessionApi';
import { invalidateWatchState } from './watchState';

const PING_INTERVAL_MS = 10_000;

export interface LastKnown {
  positionSec: number;
  state: PingState;
}

function pingState(video: HTMLVideoElement): PingState {
  if (video.paused) return 'paused';
  return video.readyState < 3 || video.seeking ? 'buffering' : 'playing';
}

/**
 * Progress pings every 10 s, playing or paused (the server stops a session after 120 s without activity, and a paused
 * player requests no segments), and one on pause and on seek. `last` holds the most recent position so the final ping
 * still has one after the video element is gone; it stays `null` until the video has metadata. Nothing is sent before
 * that, otherwise a not yet started resume would overwrite the saved position with 0.
 */
export function useProgressPings(
  sessionId: string,
  videoRef: RefObject<HTMLVideoElement | null>,
): RefObject<LastKnown | null> {
  const last = useRef<LastKnown | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const ready = () => video.readyState >= 1;
    const ping = () => {
      if (!ready()) return;
      const known = { positionSec: video.currentTime, state: pingState(video) };
      last.current = known;
      void sendProgress(sessionId, known.positionSec, known.state);
    };
    const track = () => {
      if (ready()) last.current = { positionSec: video.currentTime, state: pingState(video) };
    };
    const timer = window.setInterval(ping, PING_INTERVAL_MS);
    video.addEventListener('timeupdate', track);
    video.addEventListener('pause', ping);
    video.addEventListener('seeked', ping);
    return () => {
      window.clearInterval(timer);
      video.removeEventListener('timeupdate', track);
      video.removeEventListener('pause', ping);
      video.removeEventListener('seeked', ping);
    };
  }, [sessionId, videoRef]);

  return last;
}

/**
 * Ends a session exactly once, whichever way the player is left: Back, Esc, a media key, the browser's own back
 * button or a closing page. A last ping goes first so the saved position is the final one, then DELETE.
 * While `released` is true the session lives on elsewhere (the desktop mini player took it over): nothing is sent.
 */
export function useSessionEnd(
  sessionId: string,
  last: RefObject<LastKnown | null>,
  released?: RefObject<boolean>,
): () => Promise<void> {
  const queryClient = useQueryClient();
  const ended = useRef(false);
  const pendingUnmount = useRef<number | undefined>(undefined);

  const end = useCallback(async () => {
    if (ended.current) return;
    ended.current = true;
    if (released?.current) return;
    if (last.current) await sendProgress(sessionId, last.current.positionSec, 'paused');
    invalidateWatchState(queryClient);
    await stopSession(sessionId);
  }, [sessionId, last, queryClient, released]);

  useEffect(() => {
    window.clearTimeout(pendingUnmount.current);
    const onPageHide = (event: PageTransitionEvent) => {
      if (event.persisted || ended.current || released?.current) return;
      ended.current = true;
      if (last.current) beaconProgress(sessionId, last.current.positionSec, 'paused');
      void stopSession(sessionId, true);
    };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      // Deferred so React's development remount (cleanup, then setup again) does not end a live session.
      pendingUnmount.current = window.setTimeout(() => void end(), 0);
    };
  }, [sessionId, last, end, released]);

  return end;
}
