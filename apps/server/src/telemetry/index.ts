import path from 'node:path';
import {
  flagDefault,
  type AnalyticsEventName,
  type AnalyticsProperties,
  type FlagKey,
  type FlagValue,
  FLAG_KEYS,
} from '@homestream/shared';
import type * as Sentry from '@sentry/node';
import type { TelemetryConfig } from '../config.js';
import type { Db } from '../db/index.js';
import { installId } from '../db/settings.js';
import { serverRoot } from '../version.js';
import { FlagService } from './flags.js';
import { AnalyticsClient } from './posthog.js';
import { createErrorScrubber, scrubSecrets } from './scrub.js';
import { addSentryBreadcrumb, captureSentryError, closeSentry, initSentry } from './sentry.js';
import type { ErrorContext, Telemetry } from './types.js';

export type { Telemetry } from './types.js';

const SHUTDOWN_TIMEOUT_MS = 2000;

export interface TelemetryLogger {
  info(message: string): void;
  warn(message: string): void;
  debug(fields: object, message: string): void;
}

export interface TelemetrySetup {
  config: TelemetryConfig;
  db: Db;
  logger: TelemetryLogger;
  version: string;
  /** Test and smoke-command seams. */
  sentryOverrides?: Partial<Sentry.NodeOptions>;
  posthog?: { flushAt?: number; onRequest?: (description: string) => void };
}

/** Does nothing, answers every flag with its default. Used whenever telemetry is off. */
function createNoopTelemetry(): Telemetry {
  return {
    errorsEnabled: false,
    analyticsEnabled: false,
    capture: () => undefined,
    captureError: () => undefined,
    breadcrumb: () => undefined,
    flag: <K extends FlagKey>(key: K): Promise<FlagValue<K>> => Promise.resolve(flagDefault(key)),
    shutdown: () => Promise.resolve(),
  };
}

export function describeTelemetry(config: TelemetryConfig): string {
  if (config.disabled) return 'Telemetry is off (HOMESTREAM_TELEMETRY=off).';
  const parts = [
    config.sentryDsn ? 'error reports (Sentry)' : null,
    config.posthogKey ? 'product events (PostHog)' : null,
  ];
  const active = parts.filter(Boolean);
  if (active.length === 0) return 'Telemetry is off (no Sentry or PostHog key is set).';
  return `Telemetry is on: ${active.join(' and ')}. Set HOMESTREAM_TELEMETRY=off to disable it; see docs/PRIVACY.md.`;
}

/** Builds the telemetry front. Clients start only for keys that are present; a client that fails to start stays off. */
export function createTelemetry(setup: TelemetrySetup): Telemetry {
  const { config, logger } = setup;
  logger.info(describeTelemetry(config));
  if (config.disabled || (!config.sentryDsn && !config.posthogKey)) return createNoopTelemetry();

  const errorScrub = createErrorScrubber();
  const roots = [path.resolve(serverRoot, '..', '..'), serverRoot];
  const errorsEnabled =
    !!config.sentryDsn &&
    initSentry({
      dsn: config.sentryDsn,
      release: `homestream@${setup.version}`,
      environment: config.environment,
      scrub: errorScrub,
      roots,
      overrides: setup.sentryOverrides,
    });

  let analytics: AnalyticsClient | null = null;
  if (config.posthogKey) {
    try {
      analytics = new AnalyticsClient({
        apiKey: config.posthogKey,
        host: config.posthogHost,
        distinctId: installId(setup.db),
        appVersion: setup.version,
        scrub: scrubSecrets,
        ...setup.posthog,
      });
    } catch (error) {
      logger.warn(`Product analytics could not start: ${error instanceof Error ? error.name : 'unknown error'}.`);
    }
  }

  const flags = new FlagService(analytics, logger);
  // Warm the flag cache so the first request that reads a flag does not wait for PostHog.
  if (analytics) for (const key of FLAG_KEYS) void flags.get(key);

  let closed = false;
  return {
    errorsEnabled,
    analyticsEnabled: analytics !== null,
    capture<E extends AnalyticsEventName>(event: E, properties: AnalyticsProperties<E>): void {
      if (closed) return;
      try {
        analytics?.capture(event, properties);
      } catch {
        // analytics must never disturb the caller
      }
    },
    captureError(error: unknown, context?: ErrorContext): void {
      if (errorsEnabled && !closed) captureSentryError(error, context);
    },
    breadcrumb(category, message, data) {
      if (errorsEnabled && !closed) addSentryBreadcrumb(category, message, data);
    },
    flag: (key) => flags.get(key),
    async shutdown(): Promise<void> {
      if (closed) return;
      closed = true;
      await Promise.all([
        analytics?.shutdown(SHUTDOWN_TIMEOUT_MS),
        errorsEnabled ? closeSentry(SHUTDOWN_TIMEOUT_MS) : undefined,
      ]);
    },
  };
}
