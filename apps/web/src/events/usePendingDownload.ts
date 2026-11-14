import type { Download } from '@homestream/shared';
import { useDownloadProgress } from './downloadProgress';

export interface PendingDownload {
  /** 0..1, or `undefined` while TorBox has not reported the item yet. */
  progress: number | undefined;
  /** False while the add was sent but TorBox has not reported the item (state `pending`). */
  confirmed: boolean;
}

/**
 * Whether a title is still being cached, and how far along it is: the details response first, then live events.
 * A live progress event only exists once TorBox lists the item, so it confirms a start the response still called pending.
 */
export function usePendingDownload(key: string, download: Download | undefined): PendingDownload | null {
  const live = useDownloadProgress(key);
  if (download?.status !== 'pending') return null;
  const confirmed = live !== undefined || download.state !== 'pending';
  return { progress: live ?? (confirmed ? download.progress : undefined), confirmed };
}
