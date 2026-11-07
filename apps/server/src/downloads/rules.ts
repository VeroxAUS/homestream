import type { DownloadFailureReason } from '@homestream/shared';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export interface DownloadLimits {
  /** Poll interval during the first hour. */
  fastPollMs: number;
  /** Poll interval after the first hour, and between gateway-only checks. */
  slowPollMs: number;
  slowAfterMs: number;
  /** No result after this long since the add: the download is given up. */
  giveUpMs: number;
  /** TorBox reports "stalled (no seeds)" with no progress for this long: the download is given up. */
  stallGiveUpMs: number;
  /** Largest wait after consecutive TorBox errors. */
  maxBackoffMs: number;
  /** Gap between "is a cached stream listed yet?" checks after TorBox finished the item. */
  confirmRetryMs: number;
  /** After this long without a cached stream the gateway is checked less often; the download is never marked ready without one. */
  confirmWindowMs: number;
  /** Least time between two `download.progress` events of one download. */
  progressEventMs: number;
}

export const DEFAULT_LIMITS: DownloadLimits = {
  fastPollMs: MINUTE,
  slowPollMs: 5 * MINUTE,
  slowAfterMs: HOUR,
  giveUpMs: 24 * HOUR,
  stallGiveUpMs: 6 * HOUR,
  maxBackoffMs: 10 * MINUTE,
  confirmRetryMs: 2 * MINUTE,
  confirmWindowMs: 10 * MINUTE,
  progressEventMs: MINUTE,
};

/** Every minute for the first hour, every 5 minutes after that. */
export function pollIntervalMs(ageMs: number, limits: DownloadLimits = DEFAULT_LIMITS): number {
  return ageMs >= limits.slowAfterMs ? limits.slowPollMs : limits.fastPollMs;
}

/** Doubles the interval for each consecutive TorBox error, up to the cap. */
export function backoffMs(intervalMs: number, failures: number, limits: DownloadLimits = DEFAULT_LIMITS): number {
  if (failures <= 0) return intervalMs;
  return Math.min(intervalMs * 2 ** Math.min(failures, 10), Math.max(limits.maxBackoffMs, intervalMs));
}

/** The fields of a TorBox `mylist` item that the poller reads. */
export interface TorboxItem {
  hash: string;
  alternativeHashes: string[];
  name: string;
  downloadState: string;
  /** Fraction from 0 to 1. */
  progress: number;
  etaSec: number | null;
  downloadFinished: boolean;
  downloadPresent: boolean;
}

export type ItemVerdict =
  | { kind: 'ready' }
  | { kind: 'failed'; reason: DownloadFailureReason }
  | { kind: 'active'; progress: number; etaSec: number | null; state: string };

const FAILED_STATE = /fail|invalid|error/i;
const STALLED_STATE = /^stalled/i;

export interface RowProgress {
  progress: number;
  progressChangedAt: number;
}

/** TorBox says ready only when the item is finished and its files are present (the test AIOStreams uses too). */
export function judgeItem(
  item: TorboxItem,
  row: RowProgress,
  now: number,
  limits: DownloadLimits = DEFAULT_LIMITS,
): ItemVerdict {
  if (item.downloadFinished && item.downloadPresent) return { kind: 'ready' };
  if (FAILED_STATE.test(item.downloadState)) return { kind: 'failed', reason: 'torbox_error' };
  const advanced = item.progress > row.progress + 1e-6;
  const stalledFor = now - (advanced ? now : row.progressChangedAt);
  if (STALLED_STATE.test(item.downloadState) && stalledFor >= limits.stallGiveUpMs) {
    return { kind: 'failed', reason: 'stalled' };
  }
  return {
    kind: 'active',
    progress: Math.min(1, Math.max(0, item.progress)),
    etaSec: item.etaSec,
    state: item.downloadState,
  };
}

export function matchesHash(item: TorboxItem, infoHash: string): boolean {
  const wanted = infoHash.toLowerCase();
  return item.hash === wanted || item.alternativeHashes.includes(wanted);
}

/** At most one progress event per `progressEventMs`, and only when the progress moved. */
export function shouldEmitProgress(
  last: { progress: number; lastEventAt: number | null },
  progress: number,
  now: number,
  limits: DownloadLimits = DEFAULT_LIMITS,
): boolean {
  if (progress <= last.progress + 1e-6) return false;
  return last.lastEventAt === null || now - last.lastEventAt >= limits.progressEventMs;
}
