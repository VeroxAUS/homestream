export { DEFAULT_POSTHOG_HOST, resolveTelemetryConfig, type DesktopTelemetryConfig } from './telemetry/config.js';
export { createMainScrubber, createIdentityScrubber, type MainScrubber } from './telemetry/scrub.js';
export { buildMainSentryOptions, type MainSentrySetup } from './telemetry/sentry.js';
export { createDesktopAnalytics, DesktopAnalytics, type DesktopAnalyticsSetup } from './telemetry/analytics.js';
export { createLogger, type LogLevel, type Logger, type LoggerOptions, type LoggerSink } from './logger.js';
export { REQUEST_ID_HEADER, newRequestId, withRequestId } from './requestId.js';
