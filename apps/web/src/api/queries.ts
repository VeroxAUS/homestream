import {
  HealthResponseSchema,
  HomeResponseSchema,
  MovieDetailsWithDownloadSchema,
  ProgressResponseSchema,
  SearchResponseSchema,
  SeasonSchema,
  ServerInfoSchema,
  ShowDetailsWithDownloadsSchema,
  ShowProgressResponseSchema,
  type ProgressResponse,
} from '@homestream/shared';
import { QueryClient, queryOptions } from '@tanstack/react-query';
import { ApiError, apiGet } from './client';

/** A request that hangs must end in an error the user can act on, not in an endless spinner. */
const REQUEST_TIMEOUT_MS = 15_000;
const MINUTE_MS = 60_000;
const HEALTH_REFRESH_MS = MINUTE_MS;

type Schema<T> = { parse(value: unknown): T };

function fetcher<T>(path: string, schema: Schema<T>) {
  return ({ signal }: { signal: AbortSignal }): Promise<T> =>
    apiGet(path, schema, AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]));
}

/** Errors the server explained (4xx/5xx) are final, and so is a timeout; a dropped connection gets one more try. */
function shouldRetry(failureCount: number, error: Error): boolean {
  const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
  return !(error instanceof ApiError) && !timedOut && failureCount < 1;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        retryDelay: 800,
        refetchOnWindowFocus: false,
        gcTime: 10 * MINUTE_MS,
        staleTime: 5 * MINUTE_MS,
      },
    },
  });
}

export const homeQuery = () =>
  queryOptions({ queryKey: ['home'], queryFn: fetcher('/api/home', HomeResponseSchema), staleTime: 30_000 });

/** `polling` is false while the event stream delivers health changes by itself. */
export const healthQuery = (polling = true) =>
  queryOptions({
    queryKey: ['health'],
    queryFn: fetcher('/api/health', HealthResponseSchema),
    staleTime: 30_000,
    refetchInterval: polling ? HEALTH_REFRESH_MS : false,
    refetchIntervalInBackground: false,
  });

export const infoQuery = () => queryOptions({ queryKey: ['info'], queryFn: fetcher('/api/info', ServerInfoSchema) });

export const searchQuery = (text: string) =>
  queryOptions({
    queryKey: ['search', text],
    queryFn: fetcher(`/api/search?q=${encodeURIComponent(text)}`, SearchResponseSchema),
  });

export const movieQuery = (tmdbId: number) =>
  queryOptions({
    queryKey: ['movie', tmdbId],
    queryFn: fetcher(`/api/movie/${tmdbId}`, MovieDetailsWithDownloadSchema),
  });

export const showQuery = (tmdbId: number) =>
  queryOptions({
    queryKey: ['show', tmdbId],
    queryFn: fetcher(`/api/tv/${tmdbId}`, ShowDetailsWithDownloadsSchema),
  });

export const seasonQuery = (tmdbId: number, seasonNumber: number) =>
  queryOptions({
    queryKey: ['season', tmdbId, seasonNumber],
    queryFn: fetcher(`/api/tv/${tmdbId}/season/${seasonNumber}`, SeasonSchema),
  });

/** Saved progress is read fresh on every visit: the player changes it. `null` means nothing is saved. */
export const movieProgressQuery = (tmdbId: number) =>
  queryOptions({
    queryKey: ['progress', 'movie', tmdbId],
    queryFn: async ({ signal }): Promise<ProgressResponse | null> => {
      try {
        return await fetcher(`/api/progress/movie:${tmdbId}`, ProgressResponseSchema)({ signal });
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    staleTime: 0,
    refetchOnMount: 'always',
  });

export const showProgressQuery = (tmdbId: number) =>
  queryOptions({
    queryKey: ['progress', 'tv', tmdbId],
    queryFn: fetcher(`/api/tv/${tmdbId}/progress`, ShowProgressResponseSchema),
    staleTime: 0,
    refetchOnMount: 'always',
  });
