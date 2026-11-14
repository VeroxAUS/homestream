export type ReadAheadState = 'filling' | 'waiting';

/**
 * ffmpeg keeps a few seconds of input in its demuxer and encoder after its last finished segment, so the window is closed
 * this much early: the finished-segment lead then stays within the configured window.
 */
export const ENCODER_PIPELINE_SEC = 4;

/**
 * Bytes the encoder still holds when its reads stop: the loopback socket buffers, ffmpeg's input buffer and its demuxer
 * queue. Bytes do not shrink with the bitrate, so a low-bitrate source has more seconds of video in them. Measured
 * overshoot on a 7 Mbps source was about 13 s with the reads stopping at the window.
 */
export const ENCODER_INFLIGHT_BYTES = 8 * 1024 * 1024;

/** ffmpeg reports progress once per second and the report takes a moment to reach the server. */
export const PROGRESS_LATENCY_SEC = 1.5;

/** Lead at which the encoder's reads wait; subtitle extractors hold at the same distance so a full window stops all reads. */
export function encoderWindowSec(readAheadSec: number): number {
  return Math.max(1, readAheadSec - ENCODER_PIPELINE_SEC);
}

/** Seconds of video the encoder still finishes after its reads stop. */
export function pipelineAllowanceSec(sourceBytesPerSec: number): number {
  if (!(sourceBytesPerSec > 0)) return ENCODER_PIPELINE_SEC;
  return Math.max(ENCODER_PIPELINE_SEC, ENCODER_INFLIGHT_BYTES / sourceBytesPerSec);
}

/**
 * The lead the window closes on: the measured lead plus what the encoder will have finished by the next progress report
 * (`encodeSpeed` seconds of video per second, 8x or more on a low-bitrate source) and the in-flight seconds beyond the
 * fixed allowance already taken off the window.
 */
export function holdLeadSec(leadSec: number, encodeSpeed: number, sourceBytesPerSec: number): number {
  const growth = Math.max(0, encodeSpeed) * PROGRESS_LATENCY_SEC;
  return leadSec + growth + (pipelineAllowanceSec(sourceBytesPerSec) - ENCODER_PIPELINE_SEC);
}

/**
 * Hysteresis for the read-ahead window: reading stops once the lead reaches `holdAtSec` and resumes only when it is back
 * below `resumeSec`, so a player advancing second by second does not start and stop the download on every segment.
 */
export class ReadAheadWindow {
  private current: ReadAheadState = 'filling';

  constructor(
    readonly holdAtSec: number,
    readonly resumeSec: number,
  ) {}

  get state(): ReadAheadState {
    return this.current;
  }

  get waiting(): boolean {
    return this.current === 'waiting';
  }

  /**
   * Feeds the current lead (seconds ahead of the player); returns true when the state changed. The window closes on
   * `closeLeadSec` (the lead anticipated at the moment the reads stop, default the lead itself) and resumes on `leadSec`.
   */
  update(leadSec: number, closeLeadSec = leadSec): boolean {
    const before = this.current;
    if (this.current === 'filling' && closeLeadSec >= this.holdAtSec) this.current = 'waiting';
    else if (this.current === 'waiting' && leadSec < this.resumeSec) this.current = 'filling';
    return this.current !== before;
  }

  /** A start, seek or encoder restart opens a fresh window. Returns true when it was waiting. */
  reset(): boolean {
    const was = this.waiting;
    this.current = 'filling';
    return was;
  }
}

/** End of the last finished segment minus the player's position. */
export function leadSeconds(headSegment: number, segmentSec: number, playheadSec: number): number {
  return (headSegment + 1) * segmentSec - playheadSec;
}
