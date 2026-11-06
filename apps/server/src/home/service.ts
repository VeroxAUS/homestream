import type { HomeResponse } from '@homestream/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/index.js';
import { watchedTitles, type WatchedBase } from '../db/history.js';
import type { ContinueWatchingService } from '../progress/service.js';
import { RESUME_MIN_SEC } from '../progress/rules.js';
import type { TmdbService } from '../tmdb/service.js';
import { buildFeatured, type FeaturedInput } from './featured.js';

/** Recommendations may take this long on a cold cache; after that the banner goes without its "Because you watched" slot. */
export const RECOMMENDATIONS_BUDGET_MS = 1500;

export interface HomeServiceOptions {
  db: Db;
  tmdb: TmdbService;
  continueWatching: ContinueWatchingService;
  logger: FastifyBaseLogger;
  recommendationsBudgetMs?: number;
}

export class HomeService {
  constructor(private readonly options: HomeServiceOptions) {}

  async home(): Promise<HomeResponse> {
    const { db, tmdb, continueWatching } = this.options;
    const watched = watchedTitles(db, RESUME_MIN_SEC);
    // Started first so the recommendations request runs alongside the list and continue-watching reads.
    const because = watched.latest ? this.recommendationsFor(watched.latest) : Promise.resolve(null);
    const [rows, items] = await Promise.all([tmdb.home(), continueWatching.list()]);
    const featured = buildFeatured({
      ...rows,
      continueWatching: items,
      because: await because,
      played: watched.played,
    });
    return { continueWatching: items, featured, ...rows };
  }

  private async recommendationsFor(base: WatchedBase): Promise<FeaturedInput['because']> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), this.options.recommendationsBudgetMs ?? RECOMMENDATIONS_BUDGET_MS);
    });
    try {
      const recommendations = await Promise.race([
        this.options.tmdb.recommendations(base.mediaType, base.tmdbId),
        timeout,
      ]);
      return recommendations ? { base, recommendations } : null;
    } catch (error) {
      this.options.logger.debug(
        { err: error, tmdbId: base.tmdbId },
        'Recommendations unavailable; the banner goes without them',
      );
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
