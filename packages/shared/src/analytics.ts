import { z } from 'zod';
import { MediaTypeSchema } from './catalog.js';
import { sanitizeText, type TextScrubber } from './sanitize.js';
import { DeviceKindSchema } from './schemas.js';

/**
 * The typed product-event catalog (PostHog). Only events declared here can be captured, and only with the properties declared
 * here: anything else is dropped before it leaves the process. docs/PRIVACY.md lists exactly this catalog.
 * Property values are small enums, booleans and bounded numbers; the only free text is a media title.
 */

const MediaType = MediaTypeSchema;
const DeviceKind = DeviceKindSchema;
const TmdbId = z.number().int().positive().max(100_000_000);
const Title = z.string().min(1).max(200);
const Milliseconds = z.number().int().min(0).max(3_600_000);
const ErrorCode = z.string().regex(/^[a-z0-9_]{1,48}$/);
const Resolution = z.enum(['480p', '720p', '1080p', '1440p', '2160p']);
const EpisodeNumber = z.number().int().min(0).max(10_000);

/** Route templates of the web UI (react-router paths); a page that matches none is reported as `other`. */
export const PAGE_ROUTES = [
  '/',
  '/search',
  '/movie/:id',
  '/tv/:id',
  '/play/movie/:id',
  '/play/tv/:id/:season/:episode',
  '/settings',
  '/dashboard/health',
  '/dashboard/activity',
  '/dashboard/history',
  '/dashboard/graphs',
  '/dashboard/stats',
  'other',
] as const;
export type PageRoute = (typeof PAGE_ROUTES)[number];

export const ANALYTICS_EVENTS = {
  server_started: {
    description: 'The server finished starting.',
    properties: z.object({
      version: z.string().regex(/^\d+\.\d+\.\d+[\w.+-]{0,24}$/),
      os: z.enum(['windows', 'macos', 'linux', 'other']),
      packaged: z.boolean(),
      nodeMajor: z.number().int().min(0).max(99),
    }),
  },
  playback_started: {
    description: 'A playback session produced its first segment.',
    properties: z.object({
      mediaType: MediaType,
      tmdbId: TmdbId,
      title: Title,
      season: EpisodeNumber.optional(),
      episode: EpisodeNumber.optional(),
      deviceKind: DeviceKind,
      videoCodec: z.enum(['hevc', 'h264']),
      hdr: z.boolean(),
      toneMapped: z.boolean().optional(),
      resolution: Resolution,
      startupMs: Milliseconds,
    }),
  },
  playback_ended: {
    description: 'A playback session ended.',
    properties: z.object({
      mediaType: MediaType,
      tmdbId: TmdbId,
      title: Title,
      deviceKind: DeviceKind,
      reason: z.enum(['stopped', 'idle', 'disk', 'shutdown']),
      watchedSec: z.number().int().min(0).max(86_400),
      avgSpeed: z.number().min(0).max(100).optional(),
    }),
  },
  playback_failed: {
    description: 'A playback session could not start, or its encoder failed while playing.',
    properties: z.object({
      mediaType: MediaType,
      tmdbId: TmdbId,
      title: Title.optional(),
      deviceKind: DeviceKind,
      stage: z.enum(['start', 'running']),
      errorCode: ErrorCode,
    }),
  },
  page_viewed: {
    description:
      'The web UI (browser or desktop window) showed a page. `route` is the route template, never the real path.',
    properties: z.object({
      route: z.enum(PAGE_ROUTES),
      deviceKind: DeviceKind,
    }),
  },
  desktop_started: {
    description: 'The desktop shell finished starting.',
    properties: z.object({
      version: z.string().regex(/^\d+\.\d+\.\d+[\w.+-]{0,24}$/),
      os: z.enum(['windows', 'macos', 'linux', 'other']),
      packaged: z.boolean(),
      hidden: z.boolean(),
    }),
  },
  prefetch_requested: {
    description: 'A client asked the server to warm up the stream for a title.',
    properties: z.object({
      mediaType: MediaType,
      tmdbId: TmdbId,
      deviceKind: DeviceKind,
      flagEnabled: z.boolean(),
    }),
  },
} as const;

export type AnalyticsEventName = keyof typeof ANALYTICS_EVENTS;
export type AnalyticsProperties<E extends AnalyticsEventName> = z.input<(typeof ANALYTICS_EVENTS)[E]['properties']>;

export const ANALYTICS_EVENT_NAMES = Object.keys(ANALYTICS_EVENTS) as AnalyticsEventName[];

export function isAnalyticsEvent(name: string): name is AnalyticsEventName {
  return Object.hasOwn(ANALYTICS_EVENTS, name);
}

/**
 * Keeps only the declared properties whose value passes the declared type. Text values are scrubbed, and a value that
 * changes while scrubbing (it held a URL, key, address or path) is dropped, except for titles, which keep the scrubbed text.
 * Returns null for an event that is not in the catalog.
 */
export function sanitizeEventProperties(
  name: string,
  properties: Record<string, unknown>,
  extra?: TextScrubber,
): Record<string, string | number | boolean> | null {
  if (!isAnalyticsEvent(name)) return null;
  const shape = ANALYTICS_EVENTS[name].properties.shape as Record<string, z.ZodType>;
  const result: Record<string, string | number | boolean> = {};
  for (const [key, schema] of Object.entries(shape)) {
    if (!Object.hasOwn(properties, key)) continue;
    const parsed = schema.safeParse(properties[key]);
    if (!parsed.success) continue;
    const value = parsed.data as string | number | boolean;
    if (typeof value !== 'string') {
      result[key] = value;
      continue;
    }
    const clean = sanitizeText(value, extra);
    if (clean === value || key === 'title') result[key] = clean;
  }
  return result;
}
