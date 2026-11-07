import type { SubtitleSelection } from '@homestream/shared';
import Hls, { type ErrorData, type HlsConfig } from 'hls.js';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { logger } from '../logger';
import { mapSubtitleTracks } from './tracks';

export interface PlaybackFailure {
  message: string;
  hint: string;
}

/**
 * Subtitle segments that are not extracted yet answer 503 with `Retry-After: 1`. The default hls.js policy gives up
 * after a few seconds and loses those cues for good, so fragments are retried about 90 times, one second apart.
 */
export function hlsConfig(startPosition: number): Partial<HlsConfig> {
  return {
    startPosition,
    backBufferLength: 60,
    fragLoadPolicy: {
      default: {
        maxTimeToFirstByteMs: 20_000,
        maxLoadTimeMs: 120_000,
        timeoutRetry: { maxNumRetry: 4, retryDelayMs: 0, maxRetryDelayMs: 0 },
        errorRetry: { maxNumRetry: 90, retryDelayMs: 1000, maxRetryDelayMs: 2000 },
      },
    },
  };
}

/** Selects the rendition of a server track index, or turns subtitles off (`-1`) for Off and for burned-in tracks. */
export function applySubtitleSelection(hls: Hls, selection: SubtitleSelection | null): void {
  const id = selection?.mode === 'sidecar' ? mapSubtitleTracks(hls.subtitleTracks).get(selection.index) : undefined;
  if (id === undefined) {
    hls.subtitleTrack = -1;
    return;
  }
  hls.subtitleTrack = id;
  hls.subtitleDisplay = true;
}

const MAX_MEDIA_RECOVERIES = 2;

export function describeFatal(data: Pick<ErrorData, 'type' | 'details'>): PlaybackFailure {
  if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
    return {
      message: 'The video could not be decoded.',
      hint: 'Try again. If it keeps failing, the health dashboard shows whether the encoder is working.',
    };
  }
  if (data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR || data.details === Hls.ErrorDetails.LEVEL_LOAD_ERROR) {
    return {
      message: 'The playlist for this title could not be loaded.',
      hint: 'The session may have ended. Try again, and check the health dashboard if it keeps failing.',
    };
  }
  return {
    message: 'The server stopped sending video.',
    hint: 'Check that the HomeStream server is running and that its encoder is healthy, then try again.',
  };
}

interface UseHlsArgs {
  videoRef: RefObject<HTMLVideoElement | null>;
  playlistUrl: string;
  startSec: number;
  /** Read when the renditions are listed and again after every reload, so the choice always survives. */
  selectionRef: RefObject<SubtitleSelection | null>;
  onFatal: (failure: PlaybackFailure) => void;
}

export interface HlsPlayback {
  hlsRef: RefObject<Hls | null>;
  /** True from a reload until the new stream plays again. */
  reloading: boolean;
  /** Loads the same playlist again from this position (after an audio or burn-in change). */
  reload: (positionSec: number) => void;
}

function startNative(video: HTMLVideoElement, url: string, startSec: number): void {
  video.src = url;
  video.addEventListener(
    'loadedmetadata',
    () => {
      if (startSec > 0) video.currentTime = startSec;
      void video.play().catch(() => undefined);
    },
    { once: true },
  );
}

/** Owns the hls.js instance: loads the master playlist, selects subtitle renditions and recovers from errors. */
export function useHls({ videoRef, playlistUrl, startSec, selectionRef, onFatal }: UseHlsArgs): HlsPlayback {
  const hlsRef = useRef<Hls | null>(null);
  const startRef = useRef(startSec);
  const fatalRef = useRef(onFatal);
  fatalRef.current = onFatal;
  const [generation, setGeneration] = useState(0);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!Hls.isSupported()) {
      if (video.canPlayType('application/vnd.apple.mpegurl')) startNative(video, playlistUrl, startRef.current);
      else fatalRef.current({ message: 'This browser cannot play HLS video.', hint: 'Use the HomeStream app.' });
      return;
    }
    const hls = new Hls(hlsConfig(startRef.current));
    hlsRef.current = hls;
    let recoveries = 0;
    const onPlaying = () => setReloading(false);
    video.addEventListener('playing', onPlaying, { once: true });

    hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => applySubtitleSelection(hls, selectionRef.current));
    hls.on(Hls.Events.MANIFEST_PARSED, () => void video.play().catch(() => undefined));
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      logger.warn('player', `hls fatal error ${data.details}`);
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && recoveries < MAX_MEDIA_RECOVERIES) {
        recoveries += 1;
        hls.recoverMediaError();
        return;
      }
      fatalRef.current(describeFatal(data));
    });
    hls.attachMedia(video);
    hls.loadSource(playlistUrl);
    return () => {
      video.removeEventListener('playing', onPlaying);
      hls.destroy();
      if (hlsRef.current === hls) hlsRef.current = null;
    };
  }, [playlistUrl, generation, videoRef, selectionRef]);

  const reload = useCallback((positionSec: number) => {
    startRef.current = Math.max(0, positionSec);
    setReloading(true);
    setGeneration((value) => value + 1);
  }, []);

  return { hlsRef, reloading, reload };
}
