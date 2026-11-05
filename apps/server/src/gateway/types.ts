import { createHash } from 'node:crypto';

/** A stream as kept server-side; `url` must never reach a client. */
export interface GatewayStream {
  id: string;
  name: string;
  url: string;
  filename: string;
  videoSize: number;
}

export type StreamQuery =
  | { type: 'movie'; imdbId: string }
  | { type: 'tv'; imdbId: string; season: number; episode: number };

export function streamId(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 16);
}

export function queryKey(query: StreamQuery): string {
  return query.type === 'movie'
    ? `movie:${query.imdbId}`
    : `tv:${query.imdbId}:${query.season}:${query.episode}`;
}

export function queryFromKey(key: string): StreamQuery | null {
  const parts = key.split(':');
  if (parts[0] === 'movie' && parts.length === 2 && parts[1]) return { type: 'movie', imdbId: parts[1] };
  if (parts[0] === 'tv' && parts.length === 4 && parts[1]) {
    const season = Number(parts[2]);
    const episode = Number(parts[3]);
    if (Number.isInteger(season) && Number.isInteger(episode)) return { type: 'tv', imdbId: parts[1], season, episode };
  }
  return null;
}

export function gatewayPath(query: StreamQuery): string {
  return query.type === 'movie'
    ? `stream/movie/${encodeURIComponent(query.imdbId)}.json`
    : `stream/series/${encodeURIComponent(query.imdbId)}:${query.season}:${query.episode}.json`;
}
