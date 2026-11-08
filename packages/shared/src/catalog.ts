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

/** One cast entry of the details response. `profileUrl` is a TMDB `w185` image, `character` may be empty. */
export const CastMemberSchema = z.object({
  name: z.string().min(1),
  character: z.string(),
  profileUrl: z.string().nullable(),
});
export type CastMember = z.infer<typeof CastMemberSchema>;

export const MAX_CAST = 15;
export const MAX_SIMILAR = 20;

/**
 * `cast` and `similar` are always sent by the server; the defaults let clients parse an older server
 * that predates them.
 */
const DetailsExtras = {
  cast: z.array(CastMemberSchema).max(MAX_CAST).default([]),
  similar: z.array(MediaSummarySchema).max(MAX_SIMILAR).default([]),
};

export const MovieDetailsSchema = MediaSummarySchema.extend({
  type: z.literal('movie'),
  runtime: z.number().int().nullable(),
  genres: z.array(z.string()),
  imdbId: z.string().nullable(),
  /** TMDB `original_language` (ISO 639-1); decides the default subtitle when the audio language is undetermined. */
  originalLanguage: z.string().nullable(),
  ...DetailsExtras,
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
  ...DetailsExtras,
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

/**
 * Shape mirrors architecture §4.5. For episodes `title` is the show's name (like `showTitle`) and `episodeTitle` the episode's;
 * `backdropUrl` is the episode still (w300) when TMDB has one, else the show backdrop. `upNext` items have `positionSec` 0.
 */
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

export const FEATURED_REASONS = ['trending', 'because_you_watched', 'trending_show', 'popular'] as const;
export const FeaturedReasonSchema = z.enum(FEATURED_REASONS);
export type FeaturedReason = z.infer<typeof FeaturedReasonSchema>;

/** Banner item of `GET /api/home` (architecture §4.9). `logoUrl` is omitted by the server in v1; clients must tolerate its absence. */
export const FeaturedItemSchema = z.object({
  mediaType: MediaTypeSchema,
  tmdbId: z.number().int(),
  title: z.string().min(1),
  overview: z.string().min(1),
  backdropUrl: z.string().min(1),
  logoUrl: z.string().optional(),
  reason: FeaturedReasonSchema,
  reasonLabel: z.string().min(1),
  /** Only with `reason: "because_you_watched"`: the title the recommendation is based on. */
  basedOn: z.object({ mediaType: MediaTypeSchema, tmdbId: z.number().int(), title: z.string() }).optional(),
});
export type FeaturedItem = z.infer<typeof FeaturedItemSchema>;

export const HomeResponseSchema = z.object({
  continueWatching: z.array(ContinueWatchingItemSchema),
  featured: z.array(FeaturedItemSchema),
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
