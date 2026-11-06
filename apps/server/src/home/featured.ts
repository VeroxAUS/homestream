import type { ContinueWatchingItem, FeaturedItem, MediaSummary } from '@homestream/shared';

export const MIN_FEATURED = 3;
export const MAX_FEATURED = 5;

export interface FeaturedInput {
  trendingMovies: MediaSummary[];
  trendingShows: MediaSummary[];
  popularMovies: MediaSummary[];
  popularShows: MediaSummary[];
  continueWatching: ContinueWatchingItem[];
  /** The most recent title with enough watched time and the TMDB recommendations for it; null when there is none or TMDB failed. */
  because: {
    base: { mediaType: 'movie' | 'tv'; tmdbId: number; title: string };
    recommendations: MediaSummary[];
  } | null;
  /** `movie:<id>` / `tv:<id>` of every title with enough watched time. */
  played: ReadonlySet<string>;
}

const keyOf = (type: string, tmdbId: number) => `${type}:${tmdbId}`;

function toFeatured(
  item: MediaSummary,
  reason: FeaturedItem['reason'],
  reasonLabel: string,
  basedOn?: FeaturedItem['basedOn'],
): FeaturedItem {
  const featured: FeaturedItem = {
    mediaType: item.type,
    tmdbId: item.tmdbId,
    title: item.title,
    overview: item.overview,
    backdropUrl: item.backdropUrl as string,
    reason,
    reasonLabel,
  };
  if (basedOn) featured.basedOn = basedOn;
  return featured;
}

/**
 * Banner items of `GET /api/home` (architecture §4.9): the first usable title of each slot, in slot order, 3 to 5 items,
 * no duplicates and nothing the viewer is already continuing.
 */
export function buildFeatured(input: FeaturedInput): FeaturedItem[] {
  const continuing = new Set(input.continueWatching.map((item) => keyOf(item.type, item.tmdbId)));
  const chosen = new Map<string, FeaturedItem>();

  const usable = (item: MediaSummary, allowContinuing = false): boolean =>
    !!item.backdropUrl &&
    item.overview.trim() !== '' &&
    !chosen.has(keyOf(item.type, item.tmdbId)) &&
    (allowContinuing || !continuing.has(keyOf(item.type, item.tmdbId)));

  const take = (
    list: MediaSummary[],
    reason: FeaturedItem['reason'],
    label: string,
    allowContinuing = false,
  ): boolean => {
    const item = list.find((candidate) => usable(candidate, allowContinuing));
    if (!item) return false;
    chosen.set(keyOf(item.type, item.tmdbId), toFeatured(item, reason, label));
    return true;
  };

  take(input.trendingMovies, 'trending', 'Trending this week');

  if (input.because) {
    const { base, recommendations } = input.because;
    const pick = recommendations.find(
      (candidate) =>
        usable(candidate) &&
        keyOf(candidate.type, candidate.tmdbId) !== keyOf(base.mediaType, base.tmdbId) &&
        !input.played.has(keyOf(candidate.type, candidate.tmdbId)),
    );
    if (pick) {
      chosen.set(
        keyOf(pick.type, pick.tmdbId),
        toFeatured(pick, 'because_you_watched', `Because you watched ${base.title}`, {
          mediaType: base.mediaType,
          tmdbId: base.tmdbId,
          title: base.title,
        }),
      );
    }
  }

  take(input.trendingShows, 'trending_show', 'Trending show this week');
  take(input.popularMovies, 'popular', 'Popular right now');
  take(input.popularShows, 'popular', 'Popular show');

  const fill = [
    [input.trendingMovies, 'trending', 'Trending this week'],
    [input.trendingShows, 'trending_show', 'Trending show this week'],
    [input.popularMovies, 'popular', 'Popular right now'],
    [input.popularShows, 'popular', 'Popular show'],
  ] as const;
  for (const allowContinuing of [false, true]) {
    for (const [list, reason, label] of fill) {
      while (chosen.size < MIN_FEATURED && take(list, reason, label, allowContinuing)) {
        // take() adds one item per call; the loop only repeats while the list still has usable titles.
      }
    }
  }

  return [...chosen.values()].slice(0, MAX_FEATURED);
}
