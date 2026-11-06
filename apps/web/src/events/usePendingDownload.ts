import type { Download } from '@homestream/shared';
import { useDownloadProgress } from './downloadProgress';

export interface PendingDownload {
  /** 0..1, or `undefined` while TorBox has not reported the item yet. */
  progress: number | undefined;
}

/** Whether a title is still being cached, and how far along it is: the details response first, then live events. */
export function usePendingDownload(key: string, download: Download | undefined): PendingDownload | null {
  const live = useDownloadProgress(key);
  if (download?.status !== 'pending') return null;
  return { progress: live ?? (download.state === 'pending' ? undefined : download.progress) };
}
