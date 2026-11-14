import type { Download, SessionStartRequest } from '@homestream/shared';
import type { StreamQuery } from '../gateway/types.js';
import type { DownloadRow } from './store.js';

export function startQuery(
  body: Pick<SessionStartRequest, 'mediaType' | 'season' | 'episode'>,
  imdbId: string,
): StreamQuery {
  return body.mediaType === 'movie'
    ? { type: 'movie', imdbId }
    : { type: 'tv', imdbId, season: body.season as number, episode: body.episode as number };
}

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
