import { z } from 'zod';

export const MediaTypeSchema = z.enum(['movie', 'tv']);
export type MediaType = z.infer<typeof MediaTypeSchema>;

export const MediaSummarySchema = z.object({
  type: MediaTypeSchema,
  tmdbId: z.number().int(),
  title: z.string(),
  year: z.number().int().nullable(),
  overview: z.string(),
  posterUrl: z.string().nullable(),
  backdropUrl: z.string().nullable(),
  rating: z.number(),
});
export type MediaSummary = z.infer<typeof MediaSummarySchema>;

export const MovieDetailsSchema = MediaSummarySchema.extend({
  type: z.literal('movie'),
  runtime: z.number().int().nullable(),
  genres: z.array(z.string()),
  imdbId: z.string().nullable(),
  /** TMDB `original_language` (ISO 639-1); decides the default subtitle when the audio language is undetermined. */
  originalLanguage: z.string().nullable(),
});
export type MovieDetails = z.infer<typeof MovieDetailsSchema>;

export const SeasonSummarySchema = z.object({
  seasonNumber: z.number().int(),
  name: z.string(),
  episodeCount: z.number().int(),
  posterUrl: z.string().nullable(),
});
export type SeasonSummary = z.infer<typeof SeasonSummarySchema>;

export const ShowDetailsSchema = MediaSummarySchema.extend({
  type: z.literal('tv'),
  genres: z.array(z.string()),
  imdbId: z.string().nullable(),
  originalLanguage: z.string().nullable(),
  seasons: z.array(SeasonSummarySchema),
});
export type ShowDetails = z.infer<typeof ShowDetailsSchema>;

export const EpisodeSchema = z.object({
  episodeNumber: z.number().int(),
  name: z.string(),
  overview: z.string(),
  stillUrl: z.string().nullable(),
  runtime: z.number().int().nullable(),
  airDate: z.string().nullable(),
});
export type Episode = z.infer<typeof EpisodeSchema>;

export const SeasonSchema = z.object({
  seasonNumber: z.number().int(),
  name: z.string(),
  episodes: z.array(EpisodeSchema),
});
export type Season = z.infer<typeof SeasonSchema>;

/** Filled by the progress feature; shape mirrors architecture §4.5. */
export const ContinueWatchingItemSchema = z.object({
  mediaKey: z.string(),
  type: MediaTypeSchema,
  tmdbId: z.number().int(),
  season: z.number().int().optional(),
  episode: z.number().int().optional(),
  title: z.string(),
  showTitle: z.string().optional(),
  episodeTitle: z.string().optional(),
  posterUrl: z.string().nullable(),
  backdropUrl: z.string().nullable(),
  positionSec: z.number(),
  durationSec: z.number(),
  upNext: z.boolean(),
  updatedAt: z.number(),
});
export type ContinueWatchingItem = z.infer<typeof ContinueWatchingItemSchema>;

export const HomeResponseSchema = z.object({
  continueWatching: z.array(ContinueWatchingItemSchema),
  trendingMovies: z.array(MediaSummarySchema),
  trendingShows: z.array(MediaSummarySchema),
  popularMovies: z.array(MediaSummarySchema),
  popularShows: z.array(MediaSummarySchema),
});
export type HomeResponse = z.infer<typeof HomeResponseSchema>;

export const SearchResponseSchema = z.object({ results: z.array(MediaSummarySchema) });
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

export const SearchQuerySchema = z.object({
  q: z.string({ error: 'q is required' }).trim().min(1, 'q must not be empty').max(200, 'q is too long'),
});
