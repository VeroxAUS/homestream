import { resolveTelemetryConfig, type TelemetryConfig } from './config';
import type * as RuntimeModule from './runtime';
import { afterHomeContent, whenIdle } from '../lib/startup';
import { routeTemplate } from './routes';

// This file is part of the initial bundle and must stay free of Sentry and PostHog imports: both live in ./runtime,
// which is fetched only when the build has a key, after the home content is shown, and the browser is idle.

export { HOME_CONTENT_MARK } from '../lib/startup';

type Runtime = typeof RuntimeModule;

let started: Promise<Runtime | null> | null = null;
let lastPath: string | null = null;

async function load(config: TelemetryConfig): Promise<Runtime | null> {
  await afterHomeContent();
  await whenIdle();
  try {
    const runtime = await import('./runtime');
    runtime.startTelemetry(config);
    // After the pending page view, so the deliberate error carries the route tag like a real one.
    setTimeout(() => runtime.runTestTrigger(window.location.search), 0);
    return runtime;
  } catch {
    return null;
  }
}

/**
 * Starts telemetry once the page has shown its content. Does nothing at all (no request, no chunk) when the build holds
 * no key, `HOMESTREAM_TELEMETRY=off` was set at build time, or this browser opted out.
 */
export function startTelemetryWhenIdle(raw: typeof HS_TELEMETRY = HS_TELEMETRY): void {
  if (started) return;
  const config = resolveTelemetryConfig(raw, safeStorage());
  if (!config) return;
  started = load(config);
}

/** Reports that a page was shown. Call it on every location change with `location.pathname`. */
export function trackPageView(pathname: string): void {
  if (!started || pathname === lastPath) return;
  lastPath = pathname;
  const route = routeTemplate(pathname);
  void started.then((runtime) => runtime?.recordPageView(route));
}

function safeStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
