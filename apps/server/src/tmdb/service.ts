import type { HomeResponse, MediaSummary, MediaType, MovieDetails, Season, ShowDetails } from '@homestream/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import type { Db } from '../db/index.js';
import { AppError } from '../errors.js';
import { TmdbCache, TTL_MS } from './cache.js';
import {
  normalizeImageBase,
  normalizeList,
  normalizeMovie,
  normalizeSearch,
  normalizeSeason,
  normalizeShow,
  type ImageConfig,
} from './normalize.js';

const API_BASE = 'https://api.themoviedb.org/3';
const REQUEST_TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 300;
/** Bump when the details request or its normalized fields change, so rows cached in the old shape are not served. */
const DETAILS_CACHE_VERSION = 'v2';

/** The show page opens season 1 first, so the show details request carries it instead of a second call. */
const FIRST_SEASON_SECTION = 'season/1';

function seasonKey(tmdbId: number, seasonNumber: number): string {
  return `tv:${tmdbId}:season:${seasonNumber}`;
}

export type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<Response>;

export interface TmdbServiceOptions {
  config: Pick<Config, 'tmdbReadToken' | 'configFile'>;
  db: Db;
  logger: FastifyBaseLogger;
  fetch?: FetchLike;
  now?: () => number;
}

class TmdbNotFound extends AppError {
  constructor() {
    super(404, 'not_found', 'TMDB has no data for this request.', 'Check the id, or search for the title.');
  }
}

function isNotFoundStatus(status: number): boolean {
  return status === 404 || status === 400 || status === 422;
}

export class TmdbService {
  /** Running totals for the metrics endpoint. */
  readonly stats = { requests: 0, errors: 0, cacheHits: 0, cacheMisses: 0 };
  private readonly cache: TmdbCache;
  private readonly fetchImpl: FetchLike;
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(private readonly options: TmdbServiceOptions) {
    this.cache = new TmdbCache(options.db, options.now);
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
  }

  get configured(): boolean {
    return !!this.options.config.tmdbReadToken;
  }

  async home(): Promise<Omit<HomeResponse, 'continueWatching' | 'featured'>> {
    const images = await this.images();
    const [trendingMovies, trendingShows, popularMovies, popularShows] = await Promise.all([
      this.cached('list:trending:movie', TTL_MS.list, '/trending/movie/week'),
      this.cached('list:trending:tv', TTL_MS.list, '/trending/tv/week'),
      this.cached('list:popular:movie', TTL_MS.list, '/movie/popular'),
      this.cached('list:popular:tv', TTL_MS.list, '/tv/popular'),
    ]);
    return {
      trendingMovies: normalizeList(trendingMovies, 'movie', images),
      trendingShows: normalizeList(trendingShows, 'tv', images),
      popularMovies: normalizeList(popularMovies, 'movie', images),
      popularShows: normalizeList(popularShows, 'tv', images),
    };
  }

  async search(query: string): Promise<MediaSummary[]> {
    const normalized = query.trim().replace(/\s+/g, ' ');
    const images = await this.images();
    const raw = await this.cached(`search:${normalized.toLowerCase()}`, TTL_MS.search, '/search/multi', {
      query: normalized,
      include_adult: 'false',
      page: '1',
    });
    return normalizeSearch(raw, images);
  }

  /** First page of TMDB's recommendations for a title; empty when TMDB has none. */
  async recommendations(type: MediaType, tmdbId: number): Promise<MediaSummary[]> {
    const images = await this.images();
    try {
      const raw = await this.cached(
        `recommendations:${type}:${tmdbId}`,
        TTL_MS.recommendations,
        `/${type}/${tmdbId}/recommendations`,
        {
          page: '1',
        },
      );
      return normalizeList(raw, type, images);
    } catch (error) {
      if (error instanceof TmdbNotFound) return [];
      throw error;
    }
  }

  async movie(tmdbId: number): Promise<MovieDetails> {
    const images = await this.images();
    const raw = await this.cachedOrNotFound(
      `movie:${DETAILS_CACHE_VERSION}:${tmdbId}`,
      `Movie ${tmdbId}`,
      `/movie/${tmdbId}`,
      { append_to_response: 'external_ids,credits,recommendations,similar' },
    );
    const movie = normalizeMovie(raw, images);
    if (!movie) throw this.notFound(`Movie ${tmdbId}`);
    return movie;
  }

  async show(tmdbId: number): Promise<ShowDetails> {
    const images = await this.images();
    const raw = await this.cachedOrNotFound(
      `tv:${DETAILS_CACHE_VERSION}:${tmdbId}`,
      `Show ${tmdbId}`,
      `/tv/${tmdbId}`,
      { append_to_response: `external_ids,aggregate_credits,recommendations,similar,${FIRST_SEASON_SECTION}` },
      (value) => this.moveFirstSeason(tmdbId, value),
    );
    const show = normalizeShow(raw, images);
    if (!show) throw this.notFound(`Show ${tmdbId}`);
    return show;
  }

  async season(tmdbId: number, seasonNumber: number): Promise<Season> {
    const images = await this.images();
    const label = `Season ${seasonNumber} of show ${tmdbId}`;
    const raw = await this.cachedOrNotFound(
      seasonKey(tmdbId, seasonNumber),
      label,
      `/tv/${tmdbId}/season/${seasonNumber}`,
    );
    const season = normalizeSeason(raw, images);
    if (!season) throw this.notFound(label);
    return season;
  }

  /** Health probe: fetches /configuration straight from TMDB, bypassing the cache, so token and network problems show up. */
  async ping(): Promise<void> {
    this.requireToken();
    await this.request('/configuration', {});
  }

  private async images(): Promise<ImageConfig> {
    const raw = await this.cached('configuration', TTL_MS.config, '/configuration');
    return { baseUrl: normalizeImageBase(raw) };
  }

  private notFound(label: string): AppError {
    return new AppError(404, 'not_found', `${label} was not found on TMDB.`, 'Check the id, or search for the title.');
  }

  private async cachedOrNotFound(
    key: string,
    label: string,
    path: string,
    params: Record<string, string> = {},
    prepare?: (value: unknown) => unknown,
  ): Promise<unknown> {
    try {
      return await this.cached(key, TTL_MS.details, path, params, prepare);
    } catch (error) {
      if (error instanceof TmdbNotFound) throw this.notFound(label);
      throw error;
    }
  }

  /**
   * Stores the `season/1` section that rides along with the show details as its own season row, and returns the show
   * without it. A show without a season 1 has no such section; its season request is then made (and 404s) on demand.
   */
  private moveFirstSeason(tmdbId: number, value: unknown): unknown {
    if (typeof value !== 'object' || value === null || !(FIRST_SEASON_SECTION in value)) return value;
    const { [FIRST_SEASON_SECTION]: season, ...show } = value as Record<string, unknown>;
    if (typeof season === 'object' && season !== null) this.cache.set(seasonKey(tmdbId, 1), season, TTL_MS.details);
    return show;
  }

  private async cached(
    key: string,
    ttlMs: number,
    path: string,
    params: Record<string, string> = {},
    prepare: (value: unknown) => unknown = (value) => value,
  ): Promise<unknown> {
    this.requireToken();
    const hit = this.cache.get(key);
    if (hit !== undefined) {
      this.stats.cacheHits += 1;
      return hit;
    }
    this.stats.cacheMisses += 1;

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const request = this.request(path, params)
      .then((value) => {
        const stored = prepare(value);
        this.cache.set(key, stored, ttlMs);
        return stored;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, request);
    return request;
  }

  private requireToken(): string {
    const token = this.options.config.tmdbReadToken;
    if (!token) {
      throw new AppError(
        503,
        'config_missing',
        'TMDB is not configured: TMDB_READ_TOKEN is missing.',
        `Add TMDB_READ_TOKEN=<your TMDB API Read Access Token> to ${this.options.config.configFile.path} and restart HomeStream.`,
      );
    }
    return token;
  }

  private async request(path: string, params: Record<string, string>): Promise<unknown> {
    this.stats.requests += 1;
    try {
      return await this.fetchJson(path, params);
    } catch (error) {
      if (!(error instanceof TmdbNotFound)) this.stats.errors += 1;
      throw error;
    }
  }

  private async fetchJson(path: string, params: Record<string, string>): Promise<unknown> {
    const token = this.requireToken();
    const url = `${API_BASE}${path}?${new URLSearchParams({ language: 'en-US', ...params }).toString()}`;
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

    let lastProblem = 'no response';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      let response: Response;
      try {
        response = await this.fetchImpl(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      } catch (error) {
        lastProblem = error instanceof Error ? error.message : 'network error';
        continue;
      }
      if (response.ok) {
        try {
          return (await response.json()) as unknown;
        } catch {
          lastProblem = 'invalid JSON in response';
          continue;
        }
      }
      if (isNotFoundStatus(response.status)) throw new TmdbNotFound();
      if (response.status === 401) {
        throw new AppError(
          502,
          'tmdb_auth_failed',
          'TMDB rejected the configured token.',
          'Check TMDB_READ_TOKEN: it must be the "API Read Access Token" from themoviedb.org > Settings > API.',
        );
      }
      lastProblem = `HTTP ${response.status}`;
      if (response.status !== 429 && response.status < 500) break;
    }

    this.options.logger.warn(`TMDB request ${path} failed: ${lastProblem}`);
    throw new AppError(
      502,
      'tmdb_unavailable',
      `Could not get data from TMDB (${lastProblem}).`,
      'Check the internet connection of this PC; TMDB may also be temporarily down. Try again shortly.',
    );
  }
}
