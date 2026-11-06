import { mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { migrate, openDatabase, type Db } from '../../src/db/index.js';
import { getSetting, installId, setSetting } from '../../src/db/settings.js';
import { createLogger } from '../../src/logger.js';
import { ServerMetrics, isInstrumentedPath, type MetricSources } from '../../src/metrics/serverMetrics.js';
import { currentRequestId, generateRequestId, resolveRequestId, runWithRequestId } from '../../src/requestContext.js';
import { FlagService } from '../../src/telemetry/flags.js';
import { AnalyticsClient } from '../../src/telemetry/posthog.js';
import { createErrorScrubber } from '../../src/telemetry/scrub.js';
import { initSentry, tracesSampler } from '../../src/telemetry/sentry.js';
import { makeTempDir, removeDir } from '../helpers.js';

const dirs: string[] = [];
function temp(name: string): string {
  const dir = makeTempDir(name);
  dirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of dirs) removeDir(dir);
});
afterEach(() => vi.restoreAllMocks());

describe('request context', () => {
  it('keeps a plain supplied id, replaces hostile ones and reads the id anywhere in the call chain', async () => {
    expect(resolveRequestId('abc.DEF_123-x')).toBe('abc.DEF_123-x');
    expect(resolveRequestId(['first', 'second'])).toBe('first');
    for (const hostile of ['a b', 'x'.repeat(65), 'line\nbreak', '', undefined, '<script>']) {
      expect(resolveRequestId(hostile)).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(generateRequestId({ headers: { 'x-request-id': 'from-header' } } as never)).toBe('from-header');
    expect(currentRequestId()).toBeUndefined();
    const seen = await runWithRequestId('req-1', async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return currentRequestId();
    });
    expect(seen).toBe('req-1');
  });

  it('adds reqId to lines of the base logger inside a request, once, and nothing outside one', async () => {
    const dir = temp('logger-mixin');
    const appLogger = createLogger({ dataDir: dir, stdout: false });
    appLogger.logger.info('outside');
    runWithRequestId('req-mixin', () => {
      appLogger.logger.info('inside');
      appLogger.logger.child({ reqId: 'bound-id' }).info('child');
    });
    await appLogger.close();
    const lines = readFileSync(path.join(dir, 'server.log'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { msg: string; reqId?: string });
    expect(lines.find((line) => line.msg === 'outside')?.reqId).toBeUndefined();
    expect(lines.find((line) => line.msg === 'inside')?.reqId).toBe('req-mixin');
    expect(lines.find((line) => line.msg === 'child')?.reqId).toBe('bound-id');
  });

  it('redacts authorization and token fields as well as secrets in the message', async () => {
    const dir = temp('logger-redact');
    const appLogger = createLogger({ dataDir: dir, stdout: false });
    appLogger.logger.info({ req: { headers: { authorization: 'Bearer abc', cookie: 'sid=1' } }, token: 'tok-1' }, 'x');
    await appLogger.close();
    const text = readFileSync(path.join(dir, 'server.log'), 'utf8');
    expect(text).not.toMatch(/Bearer abc|sid=1|tok-1/);
  });
});

describe('settings table and install id', () => {
  let db: Db;
  beforeAll(() => {
    const dir = temp('settings');
    mkdirSync(dir, { recursive: true });
    db = openDatabase(dir);
  });
  afterAll(() => db.close());

  it('stores, overwrites and reads settings', () => {
    expect(getSetting(db, 'missing')).toBeNull();
    setSetting(db, 'k', 'one');
    setSetting(db, 'k', 'two');
    expect(getSetting(db, 'k')).toBe('two');
  });

  it('creates one random install id and keeps it, not derived from the host', () => {
    const first = installId(db);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(installId(db)).toBe(first);
    expect(first).not.toContain(os.hostname().toLowerCase());
  });

  it('migrates an empty in-memory database to the latest version without error', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const memory = new DatabaseSync(':memory:');
    migrate(memory);
    migrate(memory);
    expect(memory.prepare("SELECT name FROM sqlite_master WHERE name = 'settings'").get()).toBeTruthy();
    memory.close();
  });
});

describe('telemetry configuration', () => {
  const base = { DATA_DIR: 'x', TRANSCODE_DIR: 'y' };
  const load = (env: Record<string, string>) => loadConfig({ env: { ...base, ...env }, repoRoot: null });

  it('is off without keys, and the master switch hides keys that are set', () => {
    expect(load({}).telemetry).toMatchObject({ disabled: false, sentryDsn: null, posthogKey: null });
    const off = load({
      HOMESTREAM_TELEMETRY: 'off',
      SENTRY_DSN_SERVER: 'https://k@example.test/1',
      POSTHOG_API_KEY: 'phc_x',
    }).telemetry;
    expect(off).toMatchObject({ disabled: true, sentryDsn: null, posthogKey: null });
  });

  it('defaults the environment from the packaging and the host from PostHog US', () => {
    expect(load({}).telemetry).toMatchObject({
      environment: 'development',
      posthogHost: 'https://us.i.posthog.com',
    });
    expect(load({ HOMESTREAM_PACKAGED: '1' }).telemetry.environment).toBe('production');
    expect(load({ SENTRY_ENVIRONMENT: 'staging' }).telemetry.environment).toBe('staging');
  });

  it('warns about a DSN or host that is not valid and falls back', () => {
    const config = load({ SENTRY_DSN_SERVER: 'not a dsn', POSTHOG_HOST: 'ftp://nope' });
    expect(config.telemetry.sentryDsn).toBeNull();
    expect(config.telemetry.posthogHost).toBe('https://us.i.posthog.com');
    expect(config.warnings.join('\n')).toMatch(/SENTRY_DSN_SERVER is not a valid DSN/);
    expect(config.warnings.join('\n')).toMatch(/POSTHOG_HOST is not an http\(s\) URL/);
  });
});

describe('server metrics', () => {
  function sources(overrides: Partial<MetricSources> = {}): MetricSources {
    return {
      activeSessions: () => 2,
      encoderSpeeds: () => [1.5, 0.5],
      gateway: () => ({ requests: 5, errors: 1, cacheHits: 3, cacheMisses: 2 }),
      tmdb: () => ({ requests: 7, errors: 0, cacheHits: 1, cacheMisses: 6 }),
      proxyCache: () => ({ hits: 9, misses: 4, bytes: 1024 }),
      ...overrides,
    };
  }
  const value = (text: string, name: string): number =>
    Number(new RegExp(`^${name}(?:\\{[^}]*\\})? (\\S+)$`, 'm').exec(text)?.[1] ?? Number.NaN);

  it('knows which paths are counted per request', () => {
    for (const skipped of ['/hls/s1/seg-1.m4s', '/metrics', '/healthz', '/readyz', '/api/events']) {
      expect(isInstrumentedPath(skipped), skipped).toBe(false);
    }
    for (const counted of ['/api/info', '/api/events/recent', '/hls', '/']) {
      expect(isInstrumentedPath(counted), counted).toBe(true);
    }
  });

  it('reads service counters on scrape and adds only the growth', async () => {
    const metrics = new ServerMetrics();
    let gateway = { requests: 5, errors: 1, cacheHits: 3, cacheMisses: 2 };
    metrics.attach(sources({ gateway: () => gateway }));
    let text = await metrics.render();
    expect(value(text, 'homestream_gateway_requests_total')).toBe(5);
    expect(value(text, 'homestream_sessions_active')).toBe(2);
    expect(value(text, 'homestream_encoder_speed_avg')).toBe(1);
    expect(value(text, 'homestream_encoder_speed_min')).toBe(0.5);
    expect(value(text, 'homestream_sourceproxy_cache_bytes')).toBe(1024);
    gateway = { ...gateway, requests: 8 };
    text = await metrics.render();
    expect(value(text, 'homestream_gateway_requests_total')).toBe(8);
    gateway = { requests: 2, errors: 0, cacheHits: 0, cacheMisses: 0 };
    text = await metrics.render();
    expect(value(text, 'homestream_gateway_requests_total')).toBe(8);
  });

  it('reports zeros before the services are attached and when idle', async () => {
    const detached = await new ServerMetrics().render();
    expect(value(detached, 'homestream_sessions_active')).toBe(0);
    expect(value(detached, 'homestream_gateway_requests_total')).toBe(0);
    const idle = new ServerMetrics();
    idle.attach(sources({ encoderSpeeds: () => [], activeSessions: () => 0 }));
    const text = await idle.render();
    expect(value(text, 'homestream_encoder_speed_avg')).toBe(0);
    expect(value(text, 'homestream_encoder_speed_min')).toBe(0);
  });

  it('counts sessions, restarts and failures with fixed labels only', async () => {
    const metrics = new ServerMetrics();
    metrics.sessionStarted();
    metrics.encoderRestarted('seek');
    metrics.sessionFailed('start', 'stream_unavailable');
    metrics.sessionFailed('running', 'https://cdn.example.test/secret?token=1');
    metrics.observeRequest('GET', '/api/info', 200, 0.01);
    const text = await metrics.render();
    expect(text).toContain('homestream_sessions_started_total 1');
    expect(text).toContain('homestream_encoder_restarts_total{reason="seek"} 1');
    expect(text).toContain('homestream_sessions_failed_total{stage="start",code="stream_unavailable"} 1');
    expect(text).toContain('homestream_sessions_failed_total{stage="running",code="other"} 1');
    expect(text).not.toContain('cdn.example.test');
    expect(metrics.contentType).toMatch(/^text\/plain/);
  });
});

describe('trace sampling', () => {
  it('never samples segment serving or the endpoints that watch the server, and samples the rest at a low rate', () => {
    for (const quiet of ['/hls/s/seg-1.m4s', '/metrics', '/healthz', '/readyz', '/api/events']) {
      expect(tracesSampler({ attributes: { 'url.path': quiet } }), quiet).toBe(0);
    }
    expect(tracesSampler({ name: 'GET /hls/s/index.m3u8' })).toBe(0);
    expect(tracesSampler({ attributes: { 'url.full': 'http://127.0.0.1:8600/metrics?x=1' } })).toBe(0);
    expect(tracesSampler({ attributes: { 'http.route': '/api/events' } })).toBe(0);
    const normal = tracesSampler({ attributes: { 'url.path': '/api/info' } });
    expect(normal).toBeGreaterThan(0);
    expect(normal).toBeLessThanOrEqual(0.1);
    expect(tracesSampler({})).toBe(normal);
  });

  it('stays off when the SDK cannot start', () => {
    const started = initSentry({
      dsn: 'http://k@127.0.0.1:1/1',
      release: 'homestream@0.0.0',
      environment: 'test',
      scrub: (text) => text,
      roots: [],
      overrides: {
        integrations: () => {
          throw new Error('boom');
        },
      },
    });
    expect(started).toBe(false);
  });
});

describe('flag service', () => {
  const log = { debug: () => undefined };

  it('answers the default without a source and never calls anything', async () => {
    expect(await new FlagService(null, log).get('prefetch-on-details')).toBe(true);
  });

  it('serves the cached value, refreshes a stale one in the background and shares a running lookup', async () => {
    let now = 0;
    let answer: boolean | undefined = false;
    const flagValue = vi.fn(() => Promise.resolve(answer));
    const service = new FlagService({ flagValue }, log, () => now);
    expect(await service.get('prefetch-on-details')).toBe(false);
    expect(await service.get('prefetch-on-details')).toBe(false);
    expect(flagValue).toHaveBeenCalledTimes(1);
    answer = true;
    now = 6 * 60_000;
    expect(await service.get('prefetch-on-details')).toBe(false);
    await vi.waitFor(() => expect(flagValue).toHaveBeenCalledTimes(2));
    await vi.waitFor(async () => expect(await service.get('prefetch-on-details')).toBe(true));
  });

  it('falls back to the default when PostHog does not know the flag or the lookup throws', async () => {
    const unknown = new FlagService({ flagValue: () => Promise.resolve(undefined) }, log);
    expect(await unknown.get('banner-rotation-interval')).toBe('9s');
    const failing = new FlagService({ flagValue: () => Promise.reject(new Error('down')) }, log);
    expect(await failing.get('prefetch-on-details')).toBe(true);
  });

  it('does not wait longer than the first-read budget for a slow PostHog', async () => {
    const slow = new FlagService({ flagValue: () => new Promise(() => undefined) }, log);
    const started = Date.now();
    expect(await slow.get('prefetch-on-details')).toBe(true);
    expect(Date.now() - started).toBeLessThan(1500);
  });
});

describe('error scrubber and analytics client', () => {
  it('works without a user record and removes the machine name as a whole word', () => {
    vi.spyOn(os, 'userInfo').mockImplementation(() => {
      throw new Error('no user');
    });
    vi.spyOn(os, 'hostname').mockReturnValue('PC-Living-Room');
    const scrub = createErrorScrubber();
    expect(scrub('failed on pc-living-room today')).not.toMatch(/living-room/i);
    expect(scrub('plain text')).toBe('plain text');
  });

  it('has nothing to hide when the names are too short to be meaningful', () => {
    vi.spyOn(os, 'userInfo').mockReturnValue({ username: 'ab' } as os.UserInfo<string>);
    vi.spyOn(os, 'hostname').mockReturnValue('x');
    expect(createErrorScrubber()('ab and x stay')).toBe('ab and x stay');
  });

  it('describes a failed PostHog request without printing the key', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const lines: string[] = [];
    const client = new AnalyticsClient({
      apiKey: 'phc_unreachable',
      host: 'http://127.0.0.1:9',
      distinctId: 'install',
      appVersion: '1.0.0',
      scrub: (text) => text,
      onRequest: (line) => lines.push(line),
      flushAt: 1,
    });
    client.capture('prefetch_requested', { mediaType: 'movie', tmdbId: 1, deviceKind: 'web', flagEnabled: true });
    await client.shutdown(1500);
    expect(lines.some((line) => /failed/.test(line))).toBe(true);
    expect(lines.join('\n')).not.toContain('phc_');
  });
});
