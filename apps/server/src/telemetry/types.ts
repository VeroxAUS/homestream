import type { AnalyticsEventName, AnalyticsProperties, FlagKey, FlagValue } from '@homestream/shared';

export interface ErrorContext {
  requestId?: string;
  deviceKind?: string;
  mediaType?: string;
  /** Extra short tags, for example an error code. Values are scrubbed before they leave. */
  tags?: Record<string, string>;
}

/**
 * The only way the server reports anything outward. Every method is safe to call anywhere: it never throws, never blocks
 * and does nothing when the matching key is missing or `HOMESTREAM_TELEMETRY=off`.
 */
export interface Telemetry {
  readonly errorsEnabled: boolean;
  readonly analyticsEnabled: boolean;
  capture<E extends AnalyticsEventName>(event: E, properties: AnalyticsProperties<E>): void;
  captureError(error: unknown, context?: ErrorContext): void;
  breadcrumb(category: string, message: string, data?: Record<string, string | number | boolean>): void;
  /** The flag's value: PostHog's answer when known, the local default otherwise. */
  flag<K extends FlagKey>(key: K): Promise<FlagValue<K>>;
  /** Sends what is queued and stops the clients; bounded by a short timeout. */
  shutdown(): Promise<void>;
}
