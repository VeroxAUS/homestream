import { z } from 'zod';
import { ContinueWatchingItemSchema, MediaTypeSchema } from './catalog.js';
import { DecisionSchema } from './playback.js';
import { DeviceKindSchema } from './schemas.js';

/** A title is complete at this share of its duration (the only completion rule). */
export const COMPLETION_RATIO = 0.92;
/** Progress below this many seconds is not worth resuming. */
export const RESUME_MIN_SEC = 60;

export const PING_STATES = ['playing', 'paused', 'buffering'] as const;
export const PingStateSchema = z.enum(PING_STATES);
export type PingState = z.infer<typeof PingStateSchema>;

/** `POST /api/sessions/:id/progress`; a missing `state` means playing. */
export const ProgressPingRequestSchema = z.object({
  positionSec: z.number().min(0).max(1_000_000),
  state: PingStateSchema.optional(),
});
export type ProgressPingRequest = z.infer<typeof ProgressPingRequestSchema>;

/** `GET /api/progress/:mediaKey`, and the answer to a progress ping. */
export const ProgressResponseSchema = z.object({
  mediaKey: z.string(),
  positionSec: z.number(),
  durationSec: z.number(),
  completed: z.boolean(),
  /** `positionSec >= 60 && !completed`. */
  resumable: z.boolean(),
});
export type ProgressResponse = z.infer<typeof ProgressResponseSchema>;

export const ContinueWatchingResponseSchema = z.object({ items: z.array(ContinueWatchingItemSchema) });
export type ContinueWatchingResponse = z.infer<typeof ContinueWatchingResponseSchema>;

/** `DELETE /api/continue-watching/:mediaKey`: removing an already removed entry answers `removed: false`. */
export const ContinueWatchingRemoveResponseSchema = z.object({ mediaKey: z.string(), removed: z.boolean() });
export type ContinueWatchingRemoveResponse = z.infer<typeof ContinueWatchingRemoveResponseSchema>;

/** One playback session as a `plays` row, camelCase. `decision` is the stored session decision. */
export const HistoryItemSchema = z.object({
  id: z.number().int(),
  sessionId: z.string(),
  mediaKey: z.string(),
  type: MediaTypeSchema,
  tmdbId: z.number().int(),
  title: z.string(),
  showTitle: z.string().nullable(),
  season: z.number().int().nullable(),
  episode: z.number().int().nullable(),
  deviceId: z.string().nullable(),
  deviceName: z.string().nullable(),
  deviceKind: DeviceKindSchema.nullable(),
  clientIp: z.string().nullable(),
  /** Epoch ms. */
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  /** Summed playing time (paused and buffering excluded), seconds. */
  watchedSec: z.number(),
  lastPositionSec: z.number(),
  durationSec: z.number(),
  completed: z.boolean(),
  streamFilename: z.string().nullable(),
  sourceResolution: z.string().nullable(),
  sourceCodec: z.string().nullable(),
  sourceHdr: z.string().nullable(),
  sourceAudio: z.string().nullable(),
  decision: DecisionSchema.nullable(),
  avgBitrateKbps: z.number().nullable(),
  avgSpeed: z.number().nullable(),
  bytesServed: z.number(),
  status: z.enum(['ok', 'error']),
  errorMessage: z.string().nullable(),
});
export type HistoryItem = z.infer<typeof HistoryItemSchema>;

const blankToUndefined = (value: unknown): unknown => (typeof value === 'string' && value.trim() === '' ? undefined : value);

/** `from`/`to`: epoch ms, an ISO timestamp, or a `YYYY-MM-DD` day (local time; `to` then includes that whole day). */
const TimeBoundSchema = z.preprocess(blankToUndefined, z.string().trim().max(40).optional());

export const HistoryQuerySchema = z.object({
  type: z.preprocess(blankToUndefined, MediaTypeSchema.optional()),
  deviceId: z.preprocess(blankToUndefined, z.string().trim().max(128).optional()),
  q: z.preprocess(blankToUndefined, z.string().trim().max(200).optional()),
  from: TimeBoundSchema,
  to: TimeBoundSchema,
  page: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(1_000_000).default(1)),
  pageSize: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(100).default(20)),
});
export type HistoryQuery = z.infer<typeof HistoryQuerySchema>;

export const HistoryResponseSchema = z.object({
  items: z.array(HistoryItemSchema),
  /** Rows matching the filters, over all pages. */
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type HistoryResponse = z.infer<typeof HistoryResponseSchema>;

export const StatsQuerySchema = z.object({
  days: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(3650).default(30)),
});
export type StatsQuery = z.infer<typeof StatsQuerySchema>;

export const MostWatchedSchema = z.object({
  tmdbId: z.number().int(),
  /** The show's name for episodes. */
  title: z.string(),
  plays: z.number().int(),
  watchSec: z.number(),
});
export type MostWatched = z.infer<typeof MostWatchedSchema>;

export const DeviceStatSchema = z.object({
  deviceId: z.string(),
  deviceName: z.string(),
  deviceKind: DeviceKindSchema.nullable(),
  plays: z.number().int(),
  watchSec: z.number(),
});
export type DeviceStat = z.infer<typeof DeviceStatSchema>;

/** The last `days` local calendar days including today. */
export const StatsSummaryResponseSchema = z.object({
  days: z.number().int(),
  totalPlays: z.number().int(),
  totalWatchSec: z.number(),
  /** Bytes of HLS media served to clients. */
  bytesServed: z.number(),
  mostWatchedMovies: z.array(MostWatchedSchema),
  mostWatchedShows: z.array(MostWatchedSchema),
  /** By watch time, highest first. */
  topDevices: z.array(DeviceStatSchema),
});
export type StatsSummaryResponse = z.infer<typeof StatsSummaryResponseSchema>;

export const DAY_OF_WEEK_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export const PlaysBucketSchema = z.object({ plays: z.number().int(), watchSec: z.number() });
export const KeyedBucketSchema = PlaysBucketSchema.extend({ key: z.string() });
export type KeyedBucket = z.infer<typeof KeyedBucketSchema>;

/** Dynamic range of the encoded output. */
export const DECISION_RANGES = ['sdr', 'hdr10', 'tone-mapped'] as const;

/** All bucketing uses the server PC's local time zone. */
export const StatsGraphsResponseSchema = z.object({
  days: z.number().int(),
  /** One entry per local day, oldest first, zero-filled; `date` is `YYYY-MM-DD`. */
  byDay: z.array(PlaysBucketSchema.extend({ date: z.string() })),
  /** 24 entries, hour 0-23. */
  byHour: z.array(PlaysBucketSchema.extend({ hour: z.number().int() })),
  /** 7 entries, `dayOfWeek` 0 = Sunday ... 6 = Saturday. */
  byDayOfWeek: z.array(PlaysBucketSchema.extend({ dayOfWeek: z.number().int() })),
  byDevice: z.array(DeviceStatSchema),
  byDecision: z.object({
    /** Keys `sdr`, `hdr10`, `tone-mapped`. */
    dynamicRange: z.array(KeyedBucketSchema),
    /** Keys `hevc`, `h264`. */
    codec: z.array(KeyedBucketSchema),
    /** Keys like `2160p`, `1080p`. */
    resolution: z.array(KeyedBucketSchema),
  }),
});
export type StatsGraphsResponse = z.infer<typeof StatsGraphsResponseSchema>;
