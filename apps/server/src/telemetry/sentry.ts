import * as Sentry from '@sentry/node';
import { sanitizeBreadcrumb, sanitizeSentryEvent, type TextScrubber } from '@homestream/shared';
import type { ErrorContext } from './types.js';

/** At most 5 % of requests are traced, and the endpoints that watch the server or move media never are. */
const TRACES_SAMPLE_RATE = 0.05;
// Error reporting only: no HTTP, framework or database auto-instrumentation (nothing runs per request), no console capture, no sessions.
const KEPT_INTEGRATIONS = new Set([
  'EventFilters',
  'FunctionToString',
  'LinkedErrors',
  'Dedupe',
  'NodeSystemError',
  'OnUncaughtException',
  'OnUnhandledRejection',
  'ContextLines',
  'Context',
  'Modules',
]);
const UNTRACED_PATH = /^\/(?:hls\/|metrics$|healthz$|readyz$|api\/events$)/;

interface SamplingContext {
  name?: string;
  attributes?: Record<string, unknown>;
}

function pathOf(context: SamplingContext): string {
  const attributes = context.attributes ?? {};
  for (const key of ['url.path', 'http.target', 'http.route', 'url.full']) {
    const value = attributes[key];
    if (typeof value === 'string' && value) return value.replace(/^https?:\/\/[^/]+/i, '').split('?')[0] ?? '';
  }
  return (context.name ?? '').replace(/^[A-Z]+\s+/, '').split('?')[0] ?? '';
}

export function tracesSampler(context: SamplingContext): number {
  return UNTRACED_PATH.test(pathOf(context)) ? 0 : TRACES_SAMPLE_RATE;
}

export interface SentrySetup {
  dsn: string;
  release: string;
  environment: string;
  scrub: TextScrubber;
  /** Directories cut from stack-frame paths so reports never show where the repository or install lives. */
  roots: readonly string[];
  /** Replaces SDK options; used by tests only. */
  overrides?: Partial<Sentry.NodeOptions>;
}

/** Starts the Sentry client. Returns false (and leaves Sentry uninitialised) when starting it throws. */
export function initSentry(setup: SentrySetup): boolean {
  try {
    const eventOptions = { extra: setup.scrub, roots: setup.roots };
    Sentry.init({
      dsn: setup.dsn,
      release: setup.release,
      environment: setup.environment,
      sendClientReports: false,
      maxBreadcrumbs: 50,
      // v11 replaced sendDefaultPii with dataCollection: nothing about the user or the HTTP exchange is collected.
      dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
      traceLifecycle: 'static',
      tracesSampleRate: TRACES_SAMPLE_RATE,
      tracesSampler,
      beforeSend: (event) => sanitizeSentryEvent(event, eventOptions),
      beforeSendTransaction: (event) => sanitizeSentryEvent(event, eventOptions),
      beforeBreadcrumb: (breadcrumb) => sanitizeBreadcrumb(breadcrumb, setup.scrub),
      integrations: (defaults) => defaults.filter((integration) => KEPT_INTEGRATIONS.has(integration.name)),
      initialScope: { tags: { app: 'server' } },
      ...setup.overrides,
    });
    return Sentry.getClient() !== undefined;
  } catch {
    return false;
  }
}

export function captureSentryError(error: unknown, context: ErrorContext = {}): void {
  try {
    Sentry.withScope((scope) => {
      const tags: Record<string, string> = { ...context.tags };
      if (context.requestId) tags.request_id = context.requestId;
      if (context.deviceKind) tags['device.kind'] = context.deviceKind;
      if (context.mediaType) tags['media.type'] = context.mediaType;
      scope.setTags(tags);
      Sentry.captureException(error);
    });
  } catch {
    // reporting must never disturb the caller
  }
}

export function addSentryBreadcrumb(
  category: string,
  message: string,
  data?: Record<string, string | number | boolean>,
): void {
  try {
    Sentry.addBreadcrumb({ category, message, data, level: 'info' });
  } catch {
    // reporting must never disturb the caller
  }
}

export async function closeSentry(timeoutMs: number): Promise<void> {
  try {
    await Sentry.close(timeoutMs);
  } catch {
    // shutting down anyway
  }
}
