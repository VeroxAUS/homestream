import type { ContinueWatchingItem } from '@homestream/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/index.js';
import {
  getProgress,
  insertHiddenMarker,
  listEligibleProgress,
  setProgressHidden,
  type ProgressRow,
} from '../db/progress.js';
import { mediaKeyFor } from '../db/plays.js';
import { selectEntries } from './entries.js';
import { findNextEpisode, localDay, type NextEpisode, type SeasonSource } from './upNext.js';

export const CONTINUE_WATCHING_LIMIT = 20;
const NEXT_EPISODE_TTL_MS = 60 * 60 * 1000;

const EPISODE_KEY = /^tv:(\d+):(\d+):(\d+)$/;

export interface ContinueWatchingOptions {
  db: Db;
  tmdb: SeasonSource;
  logger: FastifyBaseLogger;
  now?: () => number;
}

export class ContinueWatchingService {
  private readonly nextEpisodes = new Map<string, { until: number; next: NextEpisode | null }>();

  constructor(private readonly options: ContinueWatchingOptions) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  async list(): Promise<ContinueWatchingItem[]> {
    const items: ContinueWatchingItem[] = [];
    for (const { row, kind } of selectEntries(listEligibleProgress(this.options.db))) {
      if (items.length >= CONTINUE_WATCHING_LIMIT) break;
      const item = kind === 'resume' ? resumeItem(row) : await this.upNextItem(row);
      if (item) items.push(item);
    }
    return items;
  }

  /** Hides a title from the row; history stays. Null when the key is neither known nor a current "Up next" entry. */
  async remove(mediaKey: string): Promise<{ removed: boolean } | null> {
    const { db } = this.options;
    const row = getProgress(db, mediaKey);
    if (row) return { removed: setProgressHidden(db, mediaKey, true, this.now()) };

    const match = EPISODE_KEY.exec(mediaKey);
    if (!match) return null;
    const upNext = (await this.list()).find((item) => item.upNext && item.mediaKey === mediaKey);
    if (!upNext) return null;
    insertHiddenMarker(db, {
      mediaKey,
      tmdbId: Number(match[1]),
      season: Number(match[2]),
      episode: Number(match[3]),
      now: this.now(),
    });
    return { removed: true };
  }

  private async upNextItem(row: ProgressRow): Promise<ContinueWatchingItem | null> {
    const next = await this.nextEpisode(row.tmdbId, row.season as number, row.episode as number);
    if (!next) return null;
    const show = row.meta.showTitle || row.meta.title || `Show ${row.tmdbId}`;
    return {
      mediaKey: mediaKeyFor('tv', row.tmdbId, next.season, next.episode),
      type: 'tv',
      tmdbId: row.tmdbId,
      season: next.season,
      episode: next.episode,
      title: show,
      showTitle: show,
      episodeTitle: next.episodeTitle,
      posterUrl: row.meta.posterUrl ?? null,
      backdropUrl: next.stillUrl ?? row.meta.backdropUrl ?? null,
      positionSec: 0,
      durationSec: 0,
      upNext: true,
      updatedAt: row.updatedAt,
    };
  }

  private async nextEpisode(tmdbId: number, season: number, episode: number): Promise<NextEpisode | null> {
    const key = `${tmdbId}:${season}:${episode}`;
    const now = this.now();
    const hit = this.nextEpisodes.get(key);
    if (hit && hit.until > now) return hit.next;
    try {
      const next = await findNextEpisode(this.options.tmdb, tmdbId, season, episode, localDay(now));
      this.nextEpisodes.set(key, { until: now + NEXT_EPISODE_TTL_MS, next });
      return next;
    } catch (error) {
      this.options.logger.debug({ err: error, tmdbId, season, episode }, 'Could not look up the next episode');
      return null;
    }
  }
}

function resumeItem(row: ProgressRow): ContinueWatchingItem {
  const base = {
    mediaKey: row.mediaKey,
    type: row.type,
    tmdbId: row.tmdbId,
    posterUrl: row.meta.posterUrl ?? null,
    backdropUrl: row.meta.backdropUrl ?? null,
    positionSec: row.positionSec,
    durationSec: row.durationSec,
    upNext: false,
    updatedAt: row.updatedAt,
  };
  if (row.type === 'movie') return { ...base, title: row.meta.title || `Movie ${row.tmdbId}` };
  const show = row.meta.showTitle || row.meta.title || `Show ${row.tmdbId}`;
  const code = `S${String(row.season ?? 0).padStart(2, '0')}E${String(row.episode ?? 0).padStart(2, '0')}`;
  return {
    ...base,
    season: row.season ?? undefined,
    episode: row.episode ?? undefined,
    title: show,
    showTitle: show,
    episodeTitle: row.meta.episodeTitle || code,
  };
}
