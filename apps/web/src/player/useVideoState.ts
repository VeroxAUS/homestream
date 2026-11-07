import { useEffect, useState, type RefObject } from 'react';

export interface VideoState {
  paused: boolean;
  /** Waiting for data: at the start, after a seek, or while a reload brings the stream back. */
  buffering: boolean;
  volume: number;
  muted: boolean;
}

/**
 * The few video facts the UI renders in React state. They change on user actions and buffering only; the clock
 * (position, buffered range) is written straight into the DOM by `useVideoClock` instead.
 */
export function useVideoState(videoRef: RefObject<HTMLVideoElement | null>): VideoState {
  const [state, setState] = useState<VideoState>({ paused: true, buffering: true, volume: 1, muted: false });

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const patch = (next: Partial<VideoState>) => setState((old) => ({ ...old, ...next }));
    const readSettled = () => video.readyState >= 3 && !video.seeking;
    const listeners: Array<[string, () => void]> = [
      ['play', () => patch({ paused: false })],
      ['pause', () => patch({ paused: true })],
      ['waiting', () => patch({ buffering: true })],
      ['seeking', () => patch({ buffering: true })],
      ['emptied', () => patch({ buffering: true })],
      ['playing', () => patch({ buffering: false })],
      ['canplay', () => patch({ buffering: !readSettled() })],
      ['seeked', () => patch({ buffering: !readSettled() })],
      ['volumechange', () => patch({ volume: video.volume, muted: video.muted })],
    ];
    for (const [name, listener] of listeners) video.addEventListener(name, listener);
    patch({ paused: video.paused, volume: video.volume, muted: video.muted });
    return () => {
      for (const [name, listener] of listeners) video.removeEventListener(name, listener);
    };
  }, [videoRef]);

  return state;
}

const CLOCK_EVENTS = ['timeupdate', 'progress', 'seeking', 'seeked', 'durationchange', 'loadedmetadata'] as const;

/** Runs `update` now and on every clock event of the video (about 4 Hz while playing). It writes to the DOM only. */
export function useVideoClock(
  videoRef: RefObject<HTMLVideoElement | null>,
  update: (video: HTMLVideoElement) => void,
): void {
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const run = () => update(video);
    for (const name of CLOCK_EVENTS) video.addEventListener(name, run, { passive: true });
    run();
    return () => {
      for (const name of CLOCK_EVENTS) video.removeEventListener(name, run);
    };
  }, [videoRef, update]);
}

/** The end of the buffered range that holds `time`, or `time` itself when nothing around it is buffered. */
export function bufferedEnd(buffered: TimeRanges, time: number): number {
  for (let index = 0; index < buffered.length; index += 1) {
    if (buffered.start(index) <= time + 0.5 && buffered.end(index) >= time) return buffered.end(index);
  }
  return time;
}
