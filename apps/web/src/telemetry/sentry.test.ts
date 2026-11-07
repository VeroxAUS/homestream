import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../logger';
import type { TelemetryConfig } from './config';

const sentry = vi.hoisted(() => {
  const scope = { setTag: vi.fn() };
  return {
    init: vi.fn(),
    addBreadcrumb: vi.fn(),
    setTag: vi.fn(),
    captureException: vi.fn(),
    flush: vi.fn(() => Promise.resolve(true)),
    getClient: vi.fn(() => ({})),
    withScope: vi.fn((callback: (scope: unknown) => void) => callback(scope)),
    breadcrumbsIntegration: vi.fn((options: unknown) => ({ name: 'Breadcrumbs', options })),
    scope,
  };
});
vi.mock('@sentry/react', () => sentry);

const { captureTestError, deviceKind, flushSentry, setSentryRoute, startSentry } = await import('./sentry');

const CONFIG: TelemetryConfig = {
  sentryDsn: 'https://public@sentry.example.test/1',
  posthogKey: null,
  posthogHost: 'http://127.0.0.1:9',
  release: 'homestream@1.2.3',
  environment: 'production',
  testTrigger: false,
};

type InitOptions = {
  release: string;
  environment: string;
  tracesSampleRate: number;
  dataCollection: Record<string, unknown>;
  initialScope: { tags: Record<string, string> };
  integrations: (defaults: Array<{ name: string }>) => Array<{ name: string }>;
  beforeSend: (event: object) => object;
  beforeBreadcrumb: (breadcrumb: { message: string }) => { message: string };
};

function initOptions(): InitOptions {
  return (sentry.init.mock.calls[0] as unknown as [InitOptions])[0];
}

describe('startSentry', () => {
  beforeEach(() => {
    sentry.init.mockReset();
    sentry.addBreadcrumb.mockReset();
    sentry.getClient.mockReturnValue({});
  });

  it('does nothing without a DSN', () => {
    expect(startSentry({ ...CONFIG, sentryDsn: null })).toBe(false);
    expect(sentry.init).not.toHaveBeenCalled();
  });

  it('initializes error reporting only, with release, environment and tags', () => {
    expect(startSentry(CONFIG)).toBe(true);
    const options = initOptions();
    expect(options).toMatchObject({ release: 'homestream@1.2.3', environment: 'production', tracesSampleRate: 0 });
    expect(options.initialScope.tags).toEqual({ app: 'web', process: 'renderer', 'device.kind': 'web' });
    expect(options.dataCollection).toMatchObject({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      urlQueryParams: false,
    });
    const kept = options.integrations([{ name: 'GlobalHandlers' }, { name: 'BrowserTracing' }, { name: 'Replay' }]);
    expect(kept.map((integration) => integration.name)).toEqual(['GlobalHandlers', 'Breadcrumbs']);
  });

  it('scrubs events and breadcrumbs before they leave', () => {
    startSentry(CONFIG);
    const options = initOptions();
    const event = options.beforeSend({ user: { id: 'u1' }, message: 'GET http://192.168.1.50:8600/x?token=abc' });
    expect(JSON.stringify(event)).not.toContain('192.168.1.50');
    expect(JSON.stringify(event)).not.toContain('u1');
    expect(options.beforeBreadcrumb({ message: 'GET http://192.168.1.50:8600/x?token=abc' }).message).toBe(
      'GET app:///x',
    );
  });

  it('routes the logger to breadcrumbs', () => {
    startSentry(CONFIG);
    logger.warn('api', 'GET /api/x -> 500', { requestId: 'r1' });
    expect(sentry.addBreadcrumb).toHaveBeenCalledWith({
      category: 'api',
      message: 'GET /api/x -> 500',
      level: 'warning',
      data: { requestId: 'r1' },
    });
  });

  it('reports false when the SDK throws or ends up without a client', () => {
    sentry.init.mockImplementationOnce(() => {
      throw new Error('blocked');
    });
    expect(startSentry(CONFIG)).toBe(false);
    sentry.getClient.mockReturnValue(undefined as never);
    expect(startSentry(CONFIG)).toBe(false);
  });

  it('tags the device kind desktop inside the Electron window', () => {
    window.homestream = { isDesktop: true };
    expect(deviceKind()).toBe('desktop');
    startSentry(CONFIG);
    expect(initOptions().initialScope.tags).toEqual({ app: 'desktop', process: 'renderer', 'device.kind': 'desktop' });
    delete window.homestream;
    expect(deviceKind()).toBe('web');
  });
});

describe('helpers', () => {
  it('tags the route and the test run', () => {
    setSentryRoute('/search');
    expect(sentry.setTag).toHaveBeenCalledWith('route', '/search');
    captureTestError('run-1');
    expect(sentry.scope.setTag).toHaveBeenCalledWith('telemetry_test_run', 'run-1');
    expect(sentry.captureException).toHaveBeenCalledWith(expect.any(Error));
  });

  it('flushes, and swallows a failing flush', async () => {
    await flushSentry(10);
    sentry.flush.mockRejectedValueOnce(new Error('network'));
    await expect(flushSentry(10)).resolves.toBeUndefined();
  });
});
