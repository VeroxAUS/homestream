import type { DownloadFailureReason } from '@homestream/shared';
import { AppError } from '../errors.js';

/** The `message` of `download.failed` and the tail of its log line. Plain English, no URL, no hash. */
export const FAILURE_MESSAGES: Record<DownloadFailureReason, string> = {
  torbox_error: 'TorBox reported an error for this download.',
  stalled: 'The download has had no seeds and no progress for 6 hours.',
  timeout: 'The download did not finish, or did not show up as cached, within 24 hours.',
  vanished:
    'TorBox has not listed this download for 10 minutes, so it may never have started or was removed. Try Play again, or try the title later.',
  metadata_stuck:
    'TorBox could not find the files for this download within 30 minutes. Try Play again, or try the title later.',
};

/** Start-of-download log line. A probe timeout confirms nothing, so it must not claim that TorBox took the item. */
export function startedMessage(title: string, outcome: 'accepted' | 'timeout'): string {
  return outcome === 'timeout'
    ? `Sent "${title}" to TorBox, but it did not confirm in time; HomeStream will keep checking.`
    : `TorBox accepted "${title}" and started downloading it.`;
}

export function placeholderError(name: string): AppError {
  switch (name) {
    case 'store_limit_exceeded':
      return new AppError(
        409,
        'torbox_slots_full',
        'TorBox has no free download slots right now.',
        'Wait for a running TorBox download to finish or remove one in the TorBox dashboard, then try again.',
      );
    case '429':
      return new AppError(
        429,
        'gateway_rate_limited',
        'The stream gateway is rate limited right now.',
        'Wait a few minutes and try again.',
      );
    default:
      return new AppError(
        502,
        'download_failed',
        "TorBox couldn't start downloading this title.",
        'The release may be broken or gone. Try again later, or try another title.',
      );
  }
}
