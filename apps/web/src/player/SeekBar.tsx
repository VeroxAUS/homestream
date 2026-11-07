import { useCallback, useRef, type PointerEvent, type RefObject } from 'react';
import { formatClock } from '../lib/format';
import { bufferedEnd, useVideoClock } from './useVideoState';
import styles from './SeekBar.module.css';

interface SeekBarProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  durationSec: number;
  onSeek: (sec: number) => void;
}

const fractionOf = (value: number, total: number): number => (total > 0 ? Math.min(1, Math.max(0, value / total)) : 0);

/** Elapsed time and total, written into the DOM from the video clock (no React renders while playing). */
export function TimeLabel({ videoRef, durationSec }: Pick<SeekBarProps, 'videoRef' | 'durationSec'>) {
  const label = useRef<HTMLSpanElement>(null);
  const update = useCallback(
    (video: HTMLVideoElement) => {
      if (label.current) label.current.textContent = `${formatClock(video.currentTime)} / ${formatClock(durationSec)}`;
    },
    [durationSec],
  );
  useVideoClock(videoRef, update);
  return (
    <span ref={label} className={`${styles.time} tabular`}>
      {`0:00 / ${formatClock(durationSec)}`}
    </span>
  );
}

/** Seek bar with the buffered range; dragging previews the position and the seek happens on release. */
export function SeekBar({ videoRef, durationSec, onSeek }: SeekBarProps) {
  const root = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const buffered = useRef<HTMLDivElement>(null);
  const elapsed = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const paint = useCallback(
    (position: number, bufferedTo?: number) => {
      const played = fractionOf(position, durationSec);
      if (elapsed.current) elapsed.current.style.transform = `scaleX(${played})`;
      if (buffered.current && bufferedTo !== undefined) {
        buffered.current.style.transform = `scaleX(${fractionOf(bufferedTo, durationSec)})`;
      }
      if (knob.current) knob.current.style.transform = `translateX(${played * 100}%)`;
      root.current?.setAttribute('aria-valuenow', String(Math.floor(position)));
      root.current?.setAttribute('aria-valuetext', formatClock(position));
    },
    [durationSec],
  );

  const update = useCallback(
    (video: HTMLVideoElement) => {
      if (!dragging.current) paint(video.currentTime, bufferedEnd(video.buffered, video.currentTime));
    },
    [paint],
  );
  useVideoClock(videoRef, update);

  const positionAt = (event: PointerEvent): number => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return fractionOf(event.clientX - rect.left, rect.width) * durationSec;
  };
  const preview = (event: PointerEvent) => paint(positionAt(event));

  return (
    <div
      ref={root}
      className={styles.seek}
      role="slider"
      tabIndex={0}
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.floor(durationSec)}
      aria-valuenow={0}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        dragging.current = true;
        preview(event);
      }}
      onPointerMove={(event) => {
        if (dragging.current) preview(event);
      }}
      onPointerUp={(event) => {
        if (!dragging.current) return;
        dragging.current = false;
        onSeek(positionAt(event));
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
    >
      <div ref={track} className={styles.track}>
        <div ref={buffered} className={styles.buffered} />
        <div ref={elapsed} className={styles.elapsed} />
        <div className={styles.knobRail}>
          <div ref={knob} className={styles.knobSlot}>
            <span className={styles.knob} />
          </div>
        </div>
      </div>
    </div>
  );
}
