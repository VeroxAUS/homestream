export const DEFAULT_MAX_DOWNLOAD_MBPS = 150;
const MIN_MAX_DOWNLOAD_MBPS = 5;
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
 * names the key and the default now in use. An invalid window or resume value, or a resume point at or above the window, puts the
 * pair back to the defaults together: the two keys only make sense as a pair.
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
  let readAheadResumeSec = DEFAULT_READ_AHEAD_RESUME_SEC;
  const pairNote = `using the defaults ${DEFAULT_READ_AHEAD_SEC} and ${DEFAULT_READ_AHEAD_RESUME_SEC} for READ_AHEAD_SEC and READ_AHEAD_RESUME_SEC`;
  const window = parse(raw.READ_AHEAD_SEC);
  const resume = parse(raw.READ_AHEAD_RESUME_SEC);
  const badWindow = window !== null && (Number.isNaN(window) || window <= 0);
  const badResume = resume !== null && (Number.isNaN(resume) || resume <= 0);
  if (badWindow) {
    warnings.push(
      `READ_AHEAD_SEC="${raw.READ_AHEAD_SEC}" is invalid (a number of seconds above 0 is needed); ${pairNote}.`,
    );
  }
  if (badResume) {
    warnings.push(
      `READ_AHEAD_RESUME_SEC="${raw.READ_AHEAD_RESUME_SEC}" is invalid (a number of seconds above 0 is needed); ${pairNote}.`,
    );
  }
  if (!badWindow && !badResume) {
    const wantedWindow = window ?? DEFAULT_READ_AHEAD_SEC;
    const wantedResume = resume ?? DEFAULT_READ_AHEAD_RESUME_SEC;
    if (wantedResume >= wantedWindow) {
      warnings.push(
        `READ_AHEAD_RESUME_SEC=${wantedResume} is invalid (it must be below READ_AHEAD_SEC=${wantedWindow}); ${pairNote}.`,
      );
    } else {
      readAheadSec = wantedWindow;
      readAheadResumeSec = wantedResume;
    }
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
