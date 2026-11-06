import { z } from 'zod';

/** `waiting`: the encoder is a full read-ahead window ahead of the player and the server downloads nothing for it. */
export const READ_AHEAD_STATES = ['filling', 'waiting'] as const;
export const ReadAheadStateSchema = z.enum(READ_AHEAD_STATES);
export type ReadAheadState = z.infer<typeof ReadAheadStateSchema>;

export const NetworkSessionSchema = z.object({
  sessionId: z.string(),
  /** This session's own upstream download rate, Mbps, 5 s average. */
  rateMbps: z.number().min(0),
  readAhead: ReadAheadStateSchema,
  /** Seconds of encoded video ahead of the player. */
  leadSec: z.number(),
});
export type NetworkSession = z.infer<typeof NetworkSessionSchema>;

/** Live download figures; the dashboard line "Downloading X of Y Mbps" is `rateMbps` of `capMbps`. */
export const NetworkDetailsSchema = z.object({
  /** All upstream downloads together (sessions, prefetch, subtitle extraction), Mbps, 5 s average. */
  rateMbps: z.number().min(0),
  /** MAX_DOWNLOAD_MBPS. */
  capMbps: z.number().positive(),
  /** READ_AHEAD_SEC. */
  readAheadSec: z.number().positive(),
  /** READ_AHEAD_RESUME_SEC. */
  resumeSec: z.number().positive(),
  /** Seconds downloads have been held back by the cap without a break; 0 when the cap is not binding. */
  limitedForSec: z.number().min(0),
  sessions: z.array(NetworkSessionSchema),
});
export type NetworkDetails = z.infer<typeof NetworkDetailsSchema>;

export const NetworkCheckSchema = z.object({
  id: z.literal('network'),
  name: z.string(),
  status: z.enum(['ok', 'warn', 'error']),
  message: z.string(),
  hint: z.string().optional(),
  latencyMs: z.number().min(0),
  /** ISO time. */
  checkedAt: z.string(),
  details: NetworkDetailsSchema,
});
export type NetworkCheck = z.infer<typeof NetworkCheckSchema>;
