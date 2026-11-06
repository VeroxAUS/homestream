import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TelemetryConfig } from './config';

const sentry = vi.hoisted(() => ({
  startSentry: vi.fn(() => true),
  setSentryRoute: vi.fn(),
  captureTestError: vi.fn(),
  flushSentry: vi.fn(() => Promise.resolve()),
  deviceKind: vi.fn(() => 'web'),
}));
const posthog = vi.hoisted(() => ({ startPostHog: vi.fn(() => true), captureEvent: vi.fn(), watchFlag: vi.fn() }));
vi.mock('./sentry', () => sentry);
vi.mock('./posthog', () => posthog);
const banner = vi.hoisted(() => ({ setBannerIntervalMs: vi.fn() }));
vi.mock('../lib/bannerInterval', () => banner);

const CONFIG: TelemetryConfig = {
  sentryDsn: 'https://public@sentry.example.test/1',
  posthogKey: 'phc_example',
  posthogHost: 'http://127.0.0.1:9',
  release: 'homestream@1.2.3',
  environment: 'production',
  testTrigger: false,
};

async function freshRuntime() {
  vi.resetModules();
  return import('./runtime');
}

describe('runtime', () => {
  beforeEach(() => {
    for (const mock of [...Object.values(sentry), ...Object.values(posthog), ...Object.values(banner)])
      mock.mockClear();
    posthog.startPostHog.mockReturnValue(true);
  });

  it('records nothing before it was started', async () => {
    const runtime = await freshRuntime();
    runtime.recordPageView('/');
    runtime.runTestTrigger('?__telemetry_test=run-1');
    expect(sentry.setSentryRoute).not.toHaveBeenCalled();
    expect(posthog.captureEvent).not.toHaveBeenCalled();
    expect(sentry.captureTestError).not.toHaveBeenCalled();
  });

  it('records a page view as a catalog event with the route template and tags the route in Sentry', async () => {
    const runtime = await freshRuntime();
    runtime.startTelemetry(CONFIG);
    runtime.recordPageView('/movie/:id');
    expect(sentry.setSentryRoute).toHaveBeenCalledWith('/movie/:id');
    expect(posthog.captureEvent).toHaveBeenCalledWith('page_viewed', { route: '/movie/:id', deviceKind: 'web' });
  });

  it('skips analytics when PostHog did not start', async () => {
    posthog.startPostHog.mockReturnValue(false);
    const runtime = await freshRuntime();
    runtime.startTelemetry(CONFIG);
    runtime.recordPageView('/');
    expect(posthog.captureEvent).not.toHaveBeenCalled();
    expect(sentry.setSentryRoute).toHaveBeenCalledWith('/');
  });

  it('ignores the test trigger in a build without the stub environment', async () => {
    const runtime = await freshRuntime();
    runtime.startTelemetry(CONFIG);
    runtime.runTestTrigger('?__telemetry_test=run-1');
    expect(sentry.captureTestError).not.toHaveBeenCalled();
  });

  it('fires the test trigger once per request in a stub build and checks the run id', async () => {
    const runtime = await freshRuntime();
    runtime.startTelemetry({ ...CONFIG, testTrigger: true });
    runtime.runTestTrigger('?other=1');
    runtime.runTestTrigger('?__telemetry_test=UPPER%20case');
    expect(sentry.captureTestError).not.toHaveBeenCalled();
    runtime.runTestTrigger('?__telemetry_test=run-1');
    expect(sentry.captureTestError).toHaveBeenCalledWith('run-1');
    expect(sentry.flushSentry).toHaveBeenCalledTimes(1);
  });

  it('sets the banner interval from the experiment variant', async () => {
    const runtime = await freshRuntime();
    runtime.startTelemetry(CONFIG);
    expect(posthog.watchFlag).toHaveBeenCalledWith('banner-rotation-interval', expect.any(Function));
    const apply = posthog.watchFlag.mock.calls[0]?.[1] as unknown as (variant: string) => void;
    apply('12s');
    apply('9s');
    expect(banner.setBannerIntervalMs.mock.calls).toEqual([[12000], [9000]]);
  });
  it('does not read flags when PostHog did not start', async () => {
    posthog.startPostHog.mockReturnValue(false);
    const runtime = await freshRuntime();
    runtime.startTelemetry(CONFIG);
    expect(posthog.watchFlag).not.toHaveBeenCalled();
  });
});
