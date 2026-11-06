import type { Season, ShowDetails } from '@homestream/shared';

export interface NextEpisode {
  season: number;
  episode: number;
  episodeTitle: string;
  stillUrl: string | null;
}

/** The part of the TMDB service the next-episode lookup needs. */
export interface SeasonSource {
  show(tmdbId: number): Promise<ShowDetails>;
  season(tmdbId: number, seasonNumber: number): Promise<Season>;
}

const MAX_SEASONS_PROBED = 3;

function asNext(season: number, episode: Season['episodes'][number]): NextEpisode {
  return { season, episode: episode.episodeNumber, episodeTitle: episode.name, stillUrl: episode.stillUrl };
}

/** Local calendar day as YYYY-MM-DD, comparable with TMDB air dates. */
export function localDay(now: number): string {
  const date = new Date(now);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The episode after S`season`E`episode`: the next one of the season, else the first of the next season that has episodes.
 * Null after the series finale, and when the next episode has not aired yet (TMDB lists announced episodes with a future air date).
 */
export async function findNextEpisode(
  source: SeasonSource,
  tmdbId: number,
  season: number,
  episode: number,
  today: string,
): Promise<NextEpisode | null> {
  const current = await source.season(tmdbId, season);
  const next = current.episodes
    .filter((item) => item.episodeNumber > episode)
    .sort((a, b) => a.episodeNumber - b.episodeNumber)[0];
  if (next) return aired(asNext(season, next), next.airDate, today);

  const show = await source.show(tmdbId);
  const later = show.seasons
    .filter((item) => item.seasonNumber > season && item.episodeCount > 0)
    .sort((a, b) => a.seasonNumber - b.seasonNumber)
    .slice(0, MAX_SEASONS_PROBED);
  for (const candidate of later) {
    const upcoming = await source.season(tmdbId, candidate.seasonNumber);
    const first = [...upcoming.episodes].sort((a, b) => a.episodeNumber - b.episodeNumber)[0];
    if (first) return aired(asNext(candidate.seasonNumber, first), first.airDate, today);
  }
  return null;
}

function aired(next: NextEpisode, airDate: string | null, today: string): NextEpisode | null {
  return airDate && airDate > today ? null : next;
}
