import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDesktopAnalytics } from '../../src/telemetry/analytics.js';
import { resolveTelemetryConfig } from '../../src/telemetry/config.js';
import { createIdentityScrubber, createMainScrubber } from '../../src/telemetry/scrub.js';
import { buildMainSentryOptions } from '../../src/telemetry/sentry.js';

const posthog = vi.hoisted(() => ({
  instances: [] as unknown[],
  captured: [] as Array<Record<string, unknown>>,
  failNextCapture: false,
}));

vi.mock('posthog-node', () => ({
  PostHog: class {
    constructor() {
      posthog.instances.push(this);
    }
    on() {}
    capture(message: Record<string, unknown>) {
      if (posthog.failNextCapture) throw new Error('queue failure');
      posthog.captured.push(message);
    }
    shutdown() {
      return Promise.reject(new Error('already closed'));
    }
  },
}));

beforeEach(() => {
  posthog.instances.length = 0;
  posthog.captured.length = 0;
  posthog.failNextCapture = false;
});

const DSN = 'https://abc123@o1.ingest.example.test/42';
const NEEDLES = ['machine-x', 'https://cdn-1.example.tb-cdn.io/dl/9?token=zzzz1234', 'Bearer abcdef123456']; // gitleaks:allow

function startAnalytics(env: NodeJS.ProcessEnv) {
  return createDesktopAnalytics({
    config: resolveTelemetryConfig(env, false),
    version: '1.2.3',
    distinctId: 'install-id',
    scrub: (text) => text,
  });
}

function build(env: NodeJS.ProcessEnv) {
  const config = resolveTelemetryConfig(env, false);
  const scrubber = createMainScrubber(['C:/app/homestream'], createIdentityScrubber(['machine-x']));
  return { config, scrubber, options: buildMainSentryOptions({ config, version: '1.2.3', scrubber }) };
}

describe('main-process telemetry wiring', () => {
  it('builds no Sentry options without a DSN or with the master switch off', () => {
    expect(build({}).options).toBeNull();
    expect(build({ SENTRY_DSN_WEB: DSN, HOMESTREAM_TELEMETRY: 'off' }).options).toBeNull();
  });

  it('tags every report with process=main and the release', () => {
    const { options } = build({ SENTRY_DSN_WEB: DSN });
    expect(options).toMatchObject({
      dsn: DSN,
      release: 'homestream@1.2.3',
      environment: 'development',
      tracesSampleRate: 0,
      initialScope: { tags: { process: 'main', app: 'desktop', 'device.kind': 'desktop' } },
    });
  });

  it('keeps a hostile event free of needles and removes user, request and server name', () => {
    const { options } = build({ SENTRY_DSN_WEB: DSN });
    const event = {
      message: `failed on machine-x calling ${NEEDLES[1]} with ${NEEDLES[2]}`,
      user: { id: '7', ip_address: '203.0.113.9' },
      server_name: 'machine-x',
      request: { url: 'https://example.test/?a=b', cookies: { s: '1' } },
      exception: {
        values: [
          { type: 'Error', value: 'x', stacktrace: { frames: [{ filename: 'C:/app/homestream/dist/main.js' }] } },
        ],
      },
    };
    const sent = options?.beforeSend?.(event as never, {}) as unknown as typeof event & { user: object };
    const text = JSON.stringify(sent);
    for (const needle of NEEDLES) expect(text).not.toContain(needle);
    expect(sent.user).toEqual({ geo: {} });
    expect(sent).not.toHaveProperty('server_name');
    expect(sent).not.toHaveProperty('request');
    expect(sent.exception.values[0]?.stacktrace.frames[0]?.filename).toBe('dist/main.js');
  });

  it('scrubs breadcrumbs', () => {
    const { options } = build({ SENTRY_DSN_WEB: DSN });
    const crumb = options?.beforeBreadcrumb?.({ category: 'log', message: `GET ${NEEDLES[1]}` }, undefined);
    expect(JSON.stringify(crumb)).not.toContain('tb-cdn');
  });

  it('starts no analytics client without a key or with telemetry off', () => {
    expect(startAnalytics({})).toBeNull();
    expect(startAnalytics({ POSTHOG_API_KEY: 'phc_fake', HOMESTREAM_TELEMETRY: 'off' })).toBeNull();
    expect(posthog.instances).toHaveLength(0);
  });

  it('captures catalog events only, without person profiles, and never throws', async () => {
    const analytics = startAnalytics({ POSTHOG_API_KEY: 'phc_fake' });
    analytics?.capture('desktop_started', { version: '1.2.3', os: 'windows', packaged: false, hidden: true });
    (analytics as unknown as { capture(event: string, properties: object): void }).capture('not_in_catalog', {});
    expect(posthog.captured).toEqual([
      expect.objectContaining({
        distinctId: 'install-id',
        event: 'desktop_started',
        disableGeoip: true,
        properties: {
          version: '1.2.3',
          os: 'windows',
          packaged: false,
          hidden: true,
          app: 'desktop',
          appVersion: '1.2.3',
          $process_person_profile: false,
        },
      }),
    ]);
    posthog.failNextCapture = true;
    expect(() =>
      analytics?.capture('desktop_started', { version: '1.2.3', os: 'windows', packaged: false, hidden: false }),
    ).not.toThrow();
    await expect(analytics?.shutdown(10)).resolves.toBeUndefined();
  });
});
