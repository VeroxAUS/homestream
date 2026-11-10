import type { ElectronMainOptions } from '@sentry/electron/main';
import type { LogLevel } from '../logger.js';
import type { DesktopTelemetryConfig } from './config.js';
import type { MainScrubber } from './scrub.js';

/** Error reporting only. Performance traces are off in the main process: nothing there is on a user-visible hot path. */
const KEPT_INTEGRATIONS = new Set([
  'EventFilters',
  'FunctionToString',
  'LinkedErrors',
  'Dedupe',
  'OnUncaughtException',
  'OnUnhandledRejection',
  'ElectronBreadcrumbs',
  'MainContext',
  'ChildProcess',
  'Net',
]);

/** A logger entry as a Sentry breadcrumb. Category `main` matches the tag `process=main` on every event. */
export function mainBreadcrumb(
  level: LogLevel,
  message: string,
): { category: 'main'; level: 'debug' | 'info' | 'warning' | 'error'; message: string } {
  return { category: 'main', level: level === 'warn' ? 'warning' : level, message };
}

export interface MainSentrySetup {
  config: DesktopTelemetryConfig;
  version: string;
  scrubber: MainScrubber;
}

/**
 * Options for `Sentry.init` from `@sentry/electron/main`, or null when error reporting must stay off (no DSN or
 * `HOMESTREAM_TELEMETRY=off`). The main process reports to the same project as the web UI (`homestream-web`) and every
 * event carries the tag `process=main`, so the renderer's own reports (`process=renderer`) can be told apart.
 * The caller does `Sentry.init(options)` before `app.ready`, which is what @sentry/electron requires.
 */
export function buildMainSentryOptions(setup: MainSentrySetup): ElectronMainOptions | null {
  const { config, version, scrubber } = setup;
  if (config.disabled || !config.sentryDsn) return null;
  return {
    dsn: config.sentryDsn,
    release: `homestream@${version}`,
    environment: config.environment,
    sendClientReports: false,
    maxBreadcrumbs: 50,
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    tracesSampleRate: 0,
    beforeSend: (event) => scrubber.event(event),
    beforeBreadcrumb: (breadcrumb) => scrubber.breadcrumb(breadcrumb),
    integrations: (defaults) => defaults.filter((item) => KEPT_INTEGRATIONS.has(item.name)),
    initialScope: { tags: { process: 'main', app: 'desktop', 'device.kind': 'desktop' } },
  };
}
