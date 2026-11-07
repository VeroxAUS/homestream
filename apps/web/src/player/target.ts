import type { MediaType } from '@homestream/shared';
import { formatEpisodeCode } from '../lib/format';

export interface PlayTarget {
  mediaType: MediaType;
  tmdbId: number;
  season?: number;
  episode?: number;
}

function positive(value: string | undefined, min: number): number | null {
  if (!value || !/^\d{1,9}$/.test(value)) return null;
  const parsed = Number(value);
  return parsed >= min ? parsed : null;
}

/** Reads the splat of `/play/movie/:id` and `/play/tv/:id/:season/:episode`; anything else is not a title. */
export function parsePlayTarget(splat: string | undefined): PlayTarget | null {
  const [kind, id, season, episode, ...rest] = (splat ?? '').split('/');
  const tmdbId = positive(id, 1);
  if (tmdbId === null || rest.length > 0) return null;
  if (kind === 'movie') return season === undefined ? { mediaType: 'movie', tmdbId } : null;
  const seasonNumber = positive(season, 0);
  const episodeNumber = positive(episode, 1);
  if (kind !== 'tv' || seasonNumber === null || episodeNumber === null) return null;
  return { mediaType: 'tv', tmdbId, season: seasonNumber, episode: episodeNumber };
}

/** The details page the player returns to. */
export function detailsPath(target: PlayTarget): string {
  if (target.mediaType === 'movie') return `/movie/${target.tmdbId}`;
  return `/tv/${target.tmdbId}?season=${target.season}&episode=${target.episode}`;
}

/** The player route of a title; `startSec` resumes from a saved position. */
export function playPath(target: PlayTarget, startSec?: number): string {
  const base =
    target.mediaType === 'movie'
      ? `/play/movie/${target.tmdbId}`
      : `/play/tv/${target.tmdbId}/${target.season}/${target.episode}`;
  return startSec === undefined ? base : `${base}?start=${Math.floor(startSec)}`;
}

/** The key the server stores progress under (`movie:278`, `tv:1396:1:1`). */
export function mediaKeyOf(target: PlayTarget): string {
  return target.mediaType === 'movie'
    ? `movie:${target.tmdbId}`
    : `tv:${target.tmdbId}:${target.season}:${target.episode}`;
}

export function episodeCode(target: PlayTarget): string | null {
  return target.mediaType === 'tv' && target.season !== undefined && target.episode !== undefined
    ? formatEpisodeCode(target.season, target.episode)
    : null;
}

/** `?start=` of the player route: a whole number of seconds, or `undefined` when absent or not a number. */
export function parseStartParam(value: string | null): number | undefined {
  if (value === null || !/^\d{1,6}$/.test(value)) return undefined;
  return Number(value);
}
