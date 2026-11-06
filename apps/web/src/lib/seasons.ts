import type { SeasonSummary } from '@homestream/shared';

/** Numbered seasons first, in order; "Specials" (season 0) last. Seasons without episodes are left out. */
export function orderSeasons(seasons: readonly SeasonSummary[]): SeasonSummary[] {
  const rank = (season: SeasonSummary): number =>
    season.seasonNumber === 0 ? Number.MAX_SAFE_INTEGER : season.seasonNumber;
  return seasons.filter((season) => season.episodeCount > 0).sort((a, b) => rank(a) - rank(b));
}

export function seasonLabel(season: SeasonSummary): string {
  return season.seasonNumber === 0 ? 'Specials' : `Season ${season.seasonNumber}`;
}

/** The requested season when the show has it, otherwise the first one. `null` for a show without seasons. */
export function pickSeason(requested: string | null, seasons: readonly SeasonSummary[]): number | null {
  const wanted = requested === null ? Number.NaN : Number(requested);
  const found = seasons.find((season) => season.seasonNumber === wanted);
  return (found ?? seasons[0])?.seasonNumber ?? null;
}
