export const DEFAULT_MAX_DOWNLOAD_MBPS = 150;
export const MIN_MAX_DOWNLOAD_MBPS = 5;
export const DEFAULT_READ_AHEAD_SEC = 180;
export const DEFAULT_READ_AHEAD_RESUME_SEC = 120;

export interface DownloadLimits {
  maxDownloadMbps: number;
  readAheadSec: number;
  readAheadResumeSec: number;
}

export interface RawDownloadLimits {
  MAX_DOWNLOAD_MBPS?: string;
  READ_AHEAD_SEC?: string;
  READ_AHEAD_RESUME_SEC?: string;
}

function parse(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : Number.NaN;
}

/**
 * Reads the download-limit settings. An invalid value never stops the server and is never clamped: it adds a warning that
 * names the key and the default now in use. A resume point at or above the window is a contradiction between two keys, so
 * both go back to their defaults.
 */
export function resolveDownloadLimits(raw: RawDownloadLimits, warnings: string[]): DownloadLimits {
  let maxDownloadMbps = DEFAULT_MAX_DOWNLOAD_MBPS;
  const cap = parse(raw.MAX_DOWNLOAD_MBPS);
  if (cap !== null) {
    if (Number.isNaN(cap) || cap < MIN_MAX_DOWNLOAD_MBPS) {
      warnings.push(
        `MAX_DOWNLOAD_MBPS="${raw.MAX_DOWNLOAD_MBPS}" is invalid (a number of at least ${MIN_MAX_DOWNLOAD_MBPS} is needed); using the default ${DEFAULT_MAX_DOWNLOAD_MBPS}.`,
      );
    } else {
      maxDownloadMbps = cap;
    }
  }

  let readAheadSec = DEFAULT_READ_AHEAD_SEC;
  const window = parse(raw.READ_AHEAD_SEC);
  if (window !== null) {
    if (Number.isNaN(window) || window <= 0) {
      warnings.push(`READ_AHEAD_SEC="${raw.READ_AHEAD_SEC}" is invalid (a number of seconds above 0 is needed); using the default ${DEFAULT_READ_AHEAD_SEC}.`);
    } else {
      readAheadSec = window;
    }
  }

  let readAheadResumeSec = DEFAULT_READ_AHEAD_RESUME_SEC;
  const resume = parse(raw.READ_AHEAD_RESUME_SEC);
  if (resume !== null) {
    if (Number.isNaN(resume) || resume <= 0) {
      warnings.push(
        `READ_AHEAD_RESUME_SEC="${raw.READ_AHEAD_RESUME_SEC}" is invalid (a number of seconds above 0 is needed); using the default ${DEFAULT_READ_AHEAD_RESUME_SEC}.`,
      );
    } else {
      readAheadResumeSec = resume;
    }
  }

  if (readAheadResumeSec >= readAheadSec) {
    warnings.push(
      `READ_AHEAD_RESUME_SEC=${readAheadResumeSec} is invalid (it must be below READ_AHEAD_SEC=${readAheadSec}); using the defaults ${DEFAULT_READ_AHEAD_SEC} and ${DEFAULT_READ_AHEAD_RESUME_SEC}.`,
    );
    readAheadSec = DEFAULT_READ_AHEAD_SEC;
    readAheadResumeSec = DEFAULT_READ_AHEAD_RESUME_SEC;
  }

  return { maxDownloadMbps, readAheadSec, readAheadResumeSec };
}

/** Bytes per second for a cap in megabits per second (1 Mbps = 1,000,000 bit/s). */
export function mbpsToBytesPerSec(mbps: number): number {
  return (mbps * 1_000_000) / 8;
}

export function bytesPerSecToMbps(bytesPerSec: number): number {
  return (bytesPerSec * 8) / 1_000_000;
}
