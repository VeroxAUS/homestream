import { z } from 'zod';
import { MediaTypeSchema, MovieDetailsSchema, ShowDetailsSchema } from './catalog.js';

/**
 * `pending`: the add was sent (the gateway may not have confirmed it), TorBox has not reported the item yet.
 * `downloading`: TorBox reports it. `ready`: a cached stream exists. `failed`: TorBox failed, the item vanished or
 * stayed in metadata lookup, it stalled, or the 24 h limit passed.
 */
export const DOWNLOAD_STATES = ['pending', 'downloading', 'ready', 'failed'] as const;
export const DownloadStateSchema = z.enum(DOWNLOAD_STATES);
export type DownloadState = z.infer<typeof DownloadStateSchema>;

/** Stored status of the tracking row; `pending` covers both the `pending` and `downloading` states. */
export const DOWNLOAD_STATUSES = ['pending', 'ready', 'failed'] as const;
export const DownloadStatusSchema = z.enum(DOWNLOAD_STATUSES);
export type DownloadStatus = z.infer<typeof DownloadStatusSchema>;

/**
 * `vanished`: TorBox stopped listing the item for 10 minutes. `metadata_stuck`: it stayed in metaDL (TorBox still
 * looking up the torrent's file list) for 30 minutes.
 */
export const DOWNLOAD_FAILURE_REASONS = ['torbox_error', 'stalled', 'timeout', 'vanished', 'metadata_stuck'] as const;
export const DownloadFailureReasonSchema = z.enum(DOWNLOAD_FAILURE_REASONS);
export type DownloadFailureReason = z.infer<typeof DownloadFailureReasonSchema>;

/** `progress` is a fraction from 0 to 1. `season`/`episode` are present for tv only. `startedAt` is epoch milliseconds. */
export const DownloadSchema = z.object({
  id: z.string(),
  mediaType: MediaTypeSchema,
  tmdbId: z.number().int(),
  season: z.number().int().optional(),
  episode: z.number().int().optional(),
  title: z.string(),
  state: DownloadStateSchema,
  status: DownloadStatusSchema,
  progress: z.number().min(0).max(1),
  startedAt: z.number(),
  etaSec: z.number().int().nonnegative().optional(),
  /** Failed downloads only. */
  reason: DownloadFailureReasonSchema.optional(),
});
export type Download = z.infer<typeof DownloadSchema>;

export const DownloadsResponseSchema = z.object({ downloads: z.array(DownloadSchema) });
export type DownloadsResponse = z.infer<typeof DownloadsResponseSchema>;

/** `POST /api/sessions` answer (HTTP 202) when the title has no cached stream and TorBox is now caching it. */
export const DownloadStartedResponseSchema = z.object({
  status: z.literal('downloading'),
  download: DownloadSchema,
});
export type DownloadStartedResponse = z.infer<typeof DownloadStartedResponseSchema>;

/** `GET /api/movie/:id`: `download` is present only while the title has a pending download. */
export const MovieDetailsWithDownloadSchema = MovieDetailsSchema.extend({ download: DownloadSchema.optional() });
export type MovieDetailsWithDownload = z.infer<typeof MovieDetailsWithDownloadSchema>;

/** `GET /api/tv/:id`: `downloads` lists the show's pending episode downloads and is omitted when there are none. */
export const ShowDetailsWithDownloadsSchema = ShowDetailsSchema.extend({
  downloads: z.array(DownloadSchema).optional(),
});
export type ShowDetailsWithDownloads = z.infer<typeof ShowDetailsWithDownloadsSchema>;

const EventTitleFields = {
  downloadId: z.string(),
  title: z.string(),
  mediaType: MediaTypeSchema,
  tmdbId: z.number().int(),
  season: z.number().int().optional(),
  episode: z.number().int().optional(),
};

/** SSE `download.started` and `download.ready` payloads. */
export const DownloadEventSchema = z.object(EventTitleFields);
export type DownloadEvent = z.infer<typeof DownloadEventSchema>;

/** SSE `download.progress`: at most one per download per 60 s, only when the progress changed. */
export const DownloadProgressEventSchema = z.object({
  ...EventTitleFields,
  progress: z.number().min(0).max(1),
  state: DownloadStateSchema,
  etaSec: z.number().int().nonnegative().optional(),
});
export type DownloadProgressEvent = z.infer<typeof DownloadProgressEventSchema>;

/** SSE `download.failed`. */
export const DownloadFailedEventSchema = z.object({
  ...EventTitleFields,
  reason: DownloadFailureReasonSchema,
  message: z.string(),
});
export type DownloadFailedEvent = z.infer<typeof DownloadFailedEventSchema>;
