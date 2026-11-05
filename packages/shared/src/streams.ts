import { z } from 'zod';

export const STREAM_RESOLUTIONS = ['2160p', '1080p', '720p', '480p', 'unknown'] as const;
export const StreamResolutionSchema = z.enum(STREAM_RESOLUTIONS);
export type StreamResolution = z.infer<typeof StreamResolutionSchema>;

export const StreamVideoCodecSchema = z.enum(['hevc', 'h264', 'av1', 'other']);
export type StreamVideoCodec = z.infer<typeof StreamVideoCodecSchema>;

export const StreamHdrSchema = z.enum(['dv', 'hdr10+', 'hdr10', 'hlg', 'sdr', 'unknown']);
export type StreamHdr = z.infer<typeof StreamHdrSchema>;

export const StreamOptionSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{16}$/),
  resolution: StreamResolutionSchema,
  videoCodec: StreamVideoCodecSchema,
  hdr: StreamHdrSchema,
  audio: z.string(),
  source: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  cached: z.boolean(),
  filename: z.string(),
  languages: z.array(z.string()),
  label: z.string(),
});
export type StreamOption = z.infer<typeof StreamOptionSchema>;

export const StreamsReasonSchema = z.enum(['no_streams', 'gateway_error']);
export type StreamsReason = z.infer<typeof StreamsReasonSchema>;

export const StreamsResponseSchema = z.object({
  streams: z.array(StreamOptionSchema),
  recommendedId: z.string().nullable(),
  reason: StreamsReasonSchema.optional(),
});
export type StreamsResponse = z.infer<typeof StreamsResponseSchema>;

export const StreamsQuerySchema = z.object({
  deviceId: z.string().trim().min(1).max(128).optional(),
});
export type StreamsQuery = z.infer<typeof StreamsQuerySchema>;
