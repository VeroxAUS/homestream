import { z } from 'zod';

/** `GET /healthz`: the process is up and answering. Never calls anything else. */
export const HealthzResponseSchema = z.object({ status: z.literal('ok') });
export type HealthzResponse = z.infer<typeof HealthzResponseSchema>;

/** `GET /readyz`: the database is open and the data directory is writable. */
export const ReadyzResponseSchema = z.object({ status: z.literal('ready') });
export type ReadyzResponse = z.infer<typeof ReadyzResponseSchema>;
