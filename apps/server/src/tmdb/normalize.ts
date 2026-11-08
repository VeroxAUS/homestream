import {
  MAX_CAST,
  MAX_SIMILAR,
  type CastMember,
  type Episode,
  type MediaSummary,
  type MediaType,
  type MovieDetails,
  type Season,
  type SeasonSummary,
  type ShowDetails,
} from '@homestream/shared';

const IMAGE_SIZES = { poster: 'w342', backdrop: 'w1280', still: 'w300', profile: 'w185' } as const;

export interface ImageConfig {
  /** Absolute base such as `https://image.tmdb.org/t/p/`, always ending in `/`. */
  baseUrl: string;
}

const DEFAULT_IMAGE_BASE = 'https://image.tmdb.org/t/p/';

type Json = Record<string, unknown>;

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function record(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
}

function list(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter((item): item is Json => !!item && typeof item === 'object') : [];
}

export function normalizeImageBase(raw: unknown): string {
  const base = str(record(record(raw).images).secure_base_url) || DEFAULT_IMAGE_BASE;
  return base.endsWith('/') ? base : `${base}/`;
}

export function imageUrl(config: ImageConfig, size: string, path: unknown): string | null {
  const file = str(path);
  if (!file) return null;
  return `${config.baseUrl}${size}${file.startsWith('/') ? '' : '/'}${file}`;
}

export function yearFrom(date: unknown): number | null {
  const match = /^(\d{4})/.exec(str(date));
  return match ? Number(match[1]) : null;
}

function roundRating(value: unknown): number {
  const rating = num(value) ?? 0;
  return Math.round(rating * 10) / 10;
}

export function normalizeSummary(raw: unknown, type: MediaType, config: ImageConfig): MediaSummary | null {
  const item = record(raw);
  const tmdbId = num(item.id);
  if (tmdbId === null) return null;
  const title = type === 'movie' ? str(item.title) : str(item.name);
  return {
    type,
    tmdbId,
    title: title || (type === 'movie' ? str(item.original_title) : str(item.original_name)),
    year: yearFrom(type === 'movie' ? item.release_date : item.first_air_date),
    overview: str(item.overview),
    posterUrl: imageUrl(config, IMAGE_SIZES.poster, item.poster_path),
    backdropUrl: imageUrl(config, IMAGE_SIZES.backdrop, item.backdrop_path),
    rating: roundRating(item.vote_average),
  };
}

export function normalizeList(raw: unknown, type: MediaType, config: ImageConfig): MediaSummary[] {
  return list(record(raw).results).flatMap((item) => normalizeSummary(item, type, config) ?? []);
}

/** `/search/multi` mixes in people (and anything else TMDB adds); only movies and shows survive. */
export function normalizeSearch(raw: unknown, config: ImageConfig): MediaSummary[] {
  return list(record(raw).results).flatMap((item) => {
    const mediaType = item.media_type;
    if (mediaType !== 'movie' && mediaType !== 'tv') return [];
    return normalizeSummary(item, mediaType, config) ?? [];
  });
}

function genreNames(raw: Json): string[] {
  return list(raw.genres).flatMap((genre) => (str(genre.name) ? [str(genre.name)] : []));
}

function imdbIdOf(raw: Json): string | null {
  const id = str(record(raw.external_ids).imdb_id) || str(raw.imdb_id);
  return /^tt\d+$/.test(id) ? id : null;
}

function originalLanguageOf(raw: Json): string | null {
  const language = str(raw.original_language).toLowerCase();
  return language && language !== 'xx' ? language : null;
}

/** TV `aggregate_credits` lists the roles in `roles[]`; plain `credits` has one `character`. */
function characterOf(member: Json): string {
  return str(list(member.roles)[0]?.character) || str(member.character);
}

/** Billing order, not array order: TMDB's `order` is the credit order (lowest first). Entries without one go last. */
function byBilling(a: Json, b: Json): number {
  return (num(a.order) ?? Infinity) - (num(b.order) ?? Infinity) || 0;
}

function normalizeCast(raw: Json, config: ImageConfig): CastMember[] {
  const aggregate = list(record(raw.aggregate_credits).cast);
  return (aggregate.length > 0 ? aggregate : list(record(raw.credits).cast))
    .filter((member) => str(member.name) !== '')
    .sort(byBilling)
    .slice(0, MAX_CAST)
    .map((member) => ({
      name: str(member.name),
      character: characterOf(member),
      profileUrl: imageUrl(config, IMAGE_SIZES.profile, member.profile_path),
    }));
}

function similarTitles(raw: Json, type: MediaType, config: ImageConfig): MediaSummary[] {
  const own = num(raw.id);
  const titles = (key: string): MediaSummary[] => {
    const seen = new Set<number>();
    return normalizeList(raw[key], type, config).filter((item) => {
      if (item.tmdbId === own || seen.has(item.tmdbId)) return false;
      seen.add(item.tmdbId);
      return true;
    });
  };
  const recommended = titles('recommendations');
  return (recommended.length > 0 ? recommended : titles('similar')).slice(0, MAX_SIMILAR);
}

export function normalizeMovie(raw: unknown, config: ImageConfig): MovieDetails | null {
  const item = record(raw);
  const summary = normalizeSummary(item, 'movie', config);
  if (!summary) return null;
  const runtime = num(item.runtime);
  return {
    ...summary,
    type: 'movie',
    runtime: runtime && runtime > 0 ? Math.round(runtime) : null,
    genres: genreNames(item),
    imdbId: imdbIdOf(item),
    originalLanguage: originalLanguageOf(item),
    cast: normalizeCast(item, config),
    similar: similarTitles(item, 'movie', config),
  };
}

function normalizeSeasonSummary(raw: Json, config: ImageConfig): SeasonSummary | null {
  const seasonNumber = num(raw.season_number);
  if (seasonNumber === null) return null;
  return {
    seasonNumber,
    name: str(raw.name) || `Season ${seasonNumber}`,
    episodeCount: num(raw.episode_count) ?? 0,
    posterUrl: imageUrl(config, IMAGE_SIZES.poster, raw.poster_path),
  };
}

export function normalizeShow(raw: unknown, config: ImageConfig): ShowDetails | null {
  const item = record(raw);
  const summary = normalizeSummary(item, 'tv', config);
  if (!summary) return null;
  // Season 0 is TMDB's "Specials"; it is not part of the watch order.
  const seasons = list(item.seasons)
    .flatMap((season) => normalizeSeasonSummary(season, config) ?? [])
    .filter((season) => season.seasonNumber > 0)
    .sort((a, b) => a.seasonNumber - b.seasonNumber);
  return {
    ...summary,
    type: 'tv',
    genres: genreNames(item),
    imdbId: imdbIdOf(item),
    originalLanguage: originalLanguageOf(item),
    seasons,
    cast: normalizeCast(item, config),
    similar: similarTitles(item, 'tv', config),
  };
}

function normalizeEpisode(raw: Json, config: ImageConfig): Episode | null {
  const episodeNumber = num(raw.episode_number);
  if (episodeNumber === null) return null;
  const runtime = num(raw.runtime);
  return {
    episodeNumber,
    name: str(raw.name) || `Episode ${episodeNumber}`,
    overview: str(raw.overview),
    stillUrl: imageUrl(config, IMAGE_SIZES.still, raw.still_path),
    runtime: runtime && runtime > 0 ? Math.round(runtime) : null,
    airDate: str(raw.air_date) || null,
  };
}

export function normalizeSeason(raw: unknown, config: ImageConfig): Season | null {
  const item = record(raw);
  const seasonNumber = num(item.season_number);
  if (seasonNumber === null) return null;
  const episodes = list(item.episodes)
    .flatMap((episode) => normalizeEpisode(episode, config) ?? [])
    .sort((a, b) => a.episodeNumber - b.episodeNumber);
  return { seasonNumber, name: str(item.name) || `Season ${seasonNumber}`, episodes };
}
