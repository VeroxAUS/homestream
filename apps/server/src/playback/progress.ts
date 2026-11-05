import type { EncoderStats } from '@homestream/shared';

export type RawProgress = Omit<EncoderStats, 'headSegment'>;

export const EMPTY_PROGRESS: RawProgress = { fps: 0, speed: 0, bitrateKbps: 0, outTimeSec: 0 };

/**
 * Parses `-progress pipe:1` output. ffmpeg prints `key=value` lines and ends each block with `progress=continue|end`;
 * values reported as N/A keep the previous reading.
 */
export class ProgressParser {
  private current: RawProgress = { ...EMPTY_PROGRESS };
  private pending = '';

  /** Feed raw output; returns one snapshot per completed block. */
  push(chunk: string): RawProgress[] {
    const snapshots: RawProgress[] = [];
    this.pending += chunk;
    const lines = this.pending.split(/\r?\n/);
    this.pending = lines.pop() ?? '';
    for (const line of lines) {
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      if (key === 'progress') snapshots.push({ ...this.current });
      else this.apply(key, value);
    }
    return snapshots;
  }

  private apply(key: string, value: string): void {
    if (value === 'N/A' || value === '') return;
    switch (key) {
      case 'fps':
        this.current.fps = finite(Number(value));
        break;
      case 'speed':
        this.current.speed = finite(Number.parseFloat(value));
        break;
      case 'bitrate':
        this.current.bitrateKbps = finite(Number.parseFloat(value));
        break;
      case 'out_time_us':
      case 'out_time_ms':
        // ffmpeg reports microseconds under both names.
        this.current.outTimeSec = Math.max(0, finite(Number(value)) / 1_000_000);
        break;
      default:
        break;
    }
  }
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
