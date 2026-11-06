import { z } from 'zod';
import { EVENT_LEVELS, EVENT_SOURCES } from './schemas.js';

export const HEALTH_STATUSES = ['ok', 'warn', 'error'] as const;
export const HealthStatusSchema = z.enum(HEALTH_STATUSES);
export type HealthStatus = z.infer<typeof HealthStatusSchema>;

export const HEALTH_CHECK_IDS = [
  'config',
  'gateway',
  'torbox',
  'tmdb',
  'ffmpeg',
  'gpu',
  'disk',
  'sessions',
  'network',
] as const;
export const HealthCheckIdSchema = z.enum(HEALTH_CHECK_IDS);
export type HealthCheckId = z.infer<typeof HealthCheckIdSchema>;

/** `hint` is present whenever `status` is not `ok`: plain-English "what to do". `details` never holds secrets, hosts or personal data. */
export const HealthCheckSchema = z.object({
  id: HealthCheckIdSchema,
  name: z.string(),
  status: HealthStatusSchema,
  message: z.string(),
  hint: z.string().optional(),
  latencyMs: z.number().min(0),
  /** ISO time. Cached checks (torbox 5 min, ffmpeg 10 min) keep the time they were really measured. */
  checkedAt: z.string(),
  details: z.record(z.string(), z.unknown()),
});
export type HealthCheck = z.infer<typeof HealthCheckSchema>;

export const HealthResponseSchema = z.object({
  overall: HealthStatusSchema,
  checks: z.array(HealthCheckSchema),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const LogsQuerySchema = z.object({
  level: z.enum(EVENT_LEVELS).optional(),
  source: z.enum(EVENT_SOURCES).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});
export type LogsQuery = z.infer<typeof LogsQuerySchema>;

/** Same shape as the SSE `log` event. `ts` is epoch milliseconds. */
export const LogEventSchema = z.object({
  id: z.number().int(),
  ts: z.number(),
  level: z.enum(EVENT_LEVELS),
  source: z.enum(EVENT_SOURCES),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
  sessionId: z.string().optional(),
});
export type LogEvent = z.infer<typeof LogEventSchema>;

export const LogsResponseSchema = z.object({ events: z.array(LogEventSchema) });
export type LogsResponse = z.infer<typeof LogsResponseSchema>;
