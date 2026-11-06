import { z } from 'zod';

export const DeviceKindSchema = z.enum(['tv', 'desktop', 'web']);
export type DeviceKind = z.infer<typeof DeviceKindSchema>;

export const CapabilityProfileSchema = z.object({
  deviceId: z.string().trim().min(1).max(128),
  deviceName: z.string().trim().min(1).max(128),
  kind: DeviceKindSchema,
  maxWidth: z.number().int().positive().max(16384),
  maxHeight: z.number().int().positive().max(16384),
  h264: z.boolean(),
  hevc: z.boolean(),
  hevcMain10: z.boolean(),
  hdr10: z.boolean(),
  maxAudioChannels: z.number().int().min(1).max(8),
});
export type CapabilityProfile = z.infer<typeof CapabilityProfileSchema>;

export const DeviceSchema = z.object({
  id: z.string(),
  deviceId: z.string(),
  name: z.string(),
  kind: DeviceKindSchema,
  capabilities: CapabilityProfileSchema,
  lastIp: z.string().nullable(),
  lastSeen: z.string(),
});
export type Device = z.infer<typeof DeviceSchema>;

export const DevicesResponseSchema = z.object({ devices: z.array(DeviceSchema) });
export type DevicesResponse = z.infer<typeof DevicesResponseSchema>;

/** A stream an automatic start tried and gave up on, with the error code that made it fail. */
export const StartAttemptSchema = z.object({ streamId: z.string(), code: z.string() });
export type StartAttempt = z.infer<typeof StartAttemptSchema>;

export const ErrorBodySchema = z.object({
  code: z.string(),
  message: z.string(),
  hint: z.string().optional(),
  /** `all_streams_failed` only: the candidates that were tried. */
  attempts: z.array(StartAttemptSchema).optional(),
});
export const ErrorResponseSchema = z.object({
  error: ErrorBodySchema,
  /** Same list as `error.attempts`, for clients that read it at the top level. */
  attempts: z.array(StartAttemptSchema).optional(),
});
export type ErrorBody = z.infer<typeof ErrorBodySchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const ServerInfoSchema = z.object({
  app: z.literal('homestream'),
  name: z.string(),
  version: z.string(),
  port: z.number().int(),
  lanAddresses: z.array(z.string()),
});
export type ServerInfo = z.infer<typeof ServerInfoSchema>;

export const EVENT_LEVELS = ['info', 'warn', 'error'] as const;
export const EventLevelSchema = z.enum(EVENT_LEVELS);
export type EventLevel = z.infer<typeof EventLevelSchema>;

export const EVENT_SOURCES = [
  'gateway',
  'tmdb',
  'torbox',
  'ffmpeg',
  'session',
  'health',
  'server',
  'prefetch',
] as const;
export const EventSourceSchema = z.enum(EVENT_SOURCES);
export type EventSource = z.infer<typeof EventSourceSchema>;
