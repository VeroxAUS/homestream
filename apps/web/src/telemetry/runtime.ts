import type { PageRoute } from '@homestream/shared';
import type { TelemetryConfig } from './config';
import { setBannerIntervalMs } from '../lib/bannerInterval';
import { captureEvent, startPostHog, watchFlag } from './posthog';
import { captureTestError, deviceKind, flushSentry, setSentryRoute, startSentry } from './sentry';

const TEST_RUN_PARAM = '__telemetry_test';
const TEST_RUN_ID = /^[a-z0-9-]{1,40}$/;
const FLUSH_TIMEOUT_MS = 2000;

let config: TelemetryConfig | null = null;
let posthogOn = false;

/** Starts the clients. Called once, from the lazily loaded telemetry chunk. */
export function startTelemetry(next: TelemetryConfig): void {
  config = next;
  startSentry(next);
  posthogOn = startPostHog(next);
  if (posthogOn)
    watchFlag('banner-rotation-interval', (variant) => setBannerIntervalMs(Number.parseInt(variant, 10) * 1000));
}

export function recordPageView(route: PageRoute): void {
  if (!config) return;
  setSentryRoute(route);
  if (posthogOn) captureEvent('page_viewed', { route, deviceKind: deviceKind() });
}

/**
 * Development aid for checking the pipeline end to end: `?__telemetry_test=<run id>` reports one deliberate error tagged
 * with the run id. It only exists in builds made with the stub environment (`HOMESTREAM_TELEMETRY_STUB=1`).
 */
export function runTestTrigger(search: string): void {
  if (!config?.testTrigger) return;
  const runId = new URLSearchParams(search).get(TEST_RUN_PARAM);
  if (!runId || !TEST_RUN_ID.test(runId)) return;
  captureTestError(runId);
  void flushSentry(FLUSH_TIMEOUT_MS);
}
