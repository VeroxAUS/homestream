import type { HealthStatus } from '@homestream/shared';

/** What a check function returns; the service adds id, name, latency and time. */
export interface CheckOutcome {
  status: HealthStatus;
  message: string;
  /** Required whenever the status is not `ok`. */
  hint?: string;
  details: Record<string, unknown>;
}

export const GIB = 1024 ** 3;

export function failure(message: string, hint: string, details: Record<string, unknown> = {}): CheckOutcome {
  return { status: 'error', message, hint, details };
}
