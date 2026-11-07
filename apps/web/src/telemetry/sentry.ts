import * as Sentry from '@sentry/react';
import { attachLogSink, type LogEntry } from '../logger';
import type { TelemetryConfig } from './config';
import { scrubBreadcrumb, scrubEvent } from './scrub';

// Error reporting only: no tracing, sessions, replay, feedback or console and click breadcrumbs.
const KEPT_INTEGRATIONS = new Set([
  'InboundFilters',
  'FunctionToString',
  'BrowserApiErrors',
  'GlobalHandlers',
  'LinkedErrors',
  'Dedupe',
]);

const LEVELS: Record<LogEntry['level'], Sentry.SeverityLevel> = {
  debug: 'debug',
  info: 'info',
  warn: 'warning',
  error: 'error',
};

export function deviceKind(): 'web' | 'desktop' {
  return window.homestream?.isDesktop ? 'desktop' : 'web';
}

/** Starts Sentry for the web UI. Returns false when there is no DSN or starting fails. */
export function startSentry(config: TelemetryConfig): boolean {
  if (!config.sentryDsn) return false;
  try {
    Sentry.init({
      dsn: config.sentryDsn,
      release: config.release,
      environment: config.environment,
      sendClientReports: false,
      maxBreadcrumbs: 50,
      tracesSampleRate: 0,
      dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
      beforeSend: (event) => scrubEvent(event),
      beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
      integrations: (defaults) => [
        ...defaults.filter((integration) => KEPT_INTEGRATIONS.has(integration.name)),
        Sentry.breadcrumbsIntegration({ dom: false, fetch: true, history: true, xhr: true }),
      ],
      initialScope: {
        tags: { app: deviceKind() === 'desktop' ? 'desktop' : 'web', process: 'renderer', 'device.kind': deviceKind() },
      },
    });
  } catch {
    return false;
  }
  attachLogSink((entry) =>
    Sentry.addBreadcrumb({
      category: entry.category,
      message: entry.message,
      level: LEVELS[entry.level],
      ...(entry.data ? { data: entry.data } : {}),
    }),
  );
  return Sentry.getClient() !== undefined;
}

/** Tags later reports with the route template the user is on. */
export function setSentryRoute(route: string): void {
  Sentry.setTag('route', route);
}

export function captureTestError(runId: string): void {
  Sentry.withScope((scope) => {
    scope.setTag('telemetry_test_run', runId);
    Sentry.captureException(new Error('HomeStream web telemetry test error'));
  });
}

/** Reports an error an error boundary caught; `boundary` says which one. */
export function captureRenderError(error: unknown, boundary: string): void {
  Sentry.withScope((scope) => {
    scope.setTag('boundary', boundary);
    Sentry.captureException(error);
  });
}

export async function flushSentry(timeoutMs: number): Promise<void> {
  try {
    await Sentry.flush(timeoutMs);
  } catch {
    // reporting must never disturb the page
  }
}
