import { useEffect, useMemo, useState, type RefObject } from 'react';

export const SKIP_BACK_SEC = 10;
export const SKIP_FORWARD_SEC = 30;
export const VOLUME_STEP = 0.05;

export interface PlayerActions {
  togglePlay: () => void;
  skip: (deltaSec: number) => void;
  seekTo: (sec: number) => void;
  setVolume: (volume: number) => void;
  changeVolume: (delta: number) => void;
  toggleMute: () => void;
  toggleFullscreen: () => void;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Every way to drive the video (buttons, keys, media keys) goes through these, so they all behave the same. */
export function usePlayerActions(
  videoRef: RefObject<HTMLVideoElement | null>,
  stageRef: RefObject<HTMLElement | null>,
  durationSec: number,
): PlayerActions {
  return useMemo<PlayerActions>(() => {
    const seekTo = (sec: number) => {
      const video = videoRef.current;
      if (video) video.currentTime = clamp(sec, 0, durationSec);
    };
    return {
      seekTo,
      togglePlay: () => {
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) void video.play().catch(() => undefined);
        else video.pause();
      },
      skip: (deltaSec) => {
        const video = videoRef.current;
        if (video) seekTo(video.currentTime + deltaSec);
      },
      setVolume: (volume) => {
        const video = videoRef.current;
        if (!video) return;
        video.volume = clamp(volume, 0, 1);
        if (volume > 0) video.muted = false;
      },
      changeVolume: (delta) => {
        const video = videoRef.current;
        if (!video) return;
        video.volume = clamp(Math.round((video.volume + delta) * 100) / 100, 0, 1);
        if (delta > 0) video.muted = false;
      },
      toggleMute: () => {
        const video = videoRef.current;
        if (video) video.muted = !video.muted;
      },
      toggleFullscreen: () => {
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
        else void stageRef.current?.requestFullscreen().catch(() => undefined);
      },
    };
  }, [videoRef, stageRef, durationSec]);
}

type KeyboardWithLock = Navigator & {
  keyboard?: { lock?: (keys: string[]) => Promise<void>; unlock?: () => void };
};

/**
 * Whether the stage is fullscreen. While it is, Escape is locked to the page so the key walks through "close menu,
 * close info, leave fullscreen, leave the player" instead of the browser leaving fullscreen first.
 */
export function useFullscreen(stageRef: RefObject<HTMLElement | null>): boolean {
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => {
      const active = document.fullscreenElement !== null && document.fullscreenElement === stageRef.current;
      setFullscreen(active);
      const keyboard = (navigator as KeyboardWithLock).keyboard;
      if (active) void keyboard?.lock?.(['Escape'])?.catch(() => undefined);
      else keyboard?.unlock?.();
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      (navigator as KeyboardWithLock).keyboard?.unlock?.();
      if (document.fullscreenElement && document.fullscreenElement === stageRef.current) {
        void document.exitFullscreen().catch(() => undefined);
      }
    };
  }, [stageRef]);
  return fullscreen;
}
