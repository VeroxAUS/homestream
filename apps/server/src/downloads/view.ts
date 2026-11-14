import type { Download } from '@homestream/shared';
import type { DownloadRow } from './store.js';

export function toDownload(row: DownloadRow): Download {
  const download: Download = {
    id: row.id,
    mediaType: row.mediaType,
    tmdbId: row.tmdbId,
    title: row.title,
    state: row.state,
    status: row.status,
    progress: row.progress,
    startedAt: row.createdAt,
  };
  if (row.season !== null) download.season = row.season;
  if (row.episode !== null) download.episode = row.episode;
  if (row.etaSec !== null && row.status === 'pending') download.etaSec = row.etaSec;
  if (row.reason) download.reason = row.reason;
  return download;
}

/** The fields every `download.*` event carries. */
export function eventBase(row: DownloadRow) {
  return {
    downloadId: row.id,
    title: row.title,
    mediaType: row.mediaType,
    tmdbId: row.tmdbId,
    ...(row.season !== null ? { season: row.season } : {}),
    ...(row.episode !== null ? { episode: row.episode } : {}),
  };
}
