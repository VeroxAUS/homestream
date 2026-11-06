import * as Sentry from '@sentry/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../../src/db/index.js';
import { getSetting } from '../../src/db/settings.js';
import { registerConfigSecrets } from '../../src/config.js';
import { clearSecrets } from '../../src/redact.js';
import { createTelemetry, type Telemetry } from '../../src/telemetry/index.js';
import { makeTempDir, removeDir, testConfig } from '../helpers.js';
import { parseEnvelope, startTelemetryStub, type LooseJson, type TelemetryStub } from './stubServer.js';

const POSTHOG_KEY = 'phc_stubkey0000';
const logs: string[] = [];
const logger = {
  info: (message: string) => logs.push(message),
  warn: (message: string) => logs.push(message),
  debug: (fields: object, message: string) => logs.push(`${message} ${JSON.stringify(fields)}`),
};

let root: string;
let db: Db;
let stub: TelemetryStub;
let telemetry: Telemetry;

function build(overrides: Record<string, string> = {}): Telemetry {
  const config = testConfig(root, {
    SENTRY_DSN_SERVER: stub.dsn,
    SENTRY_ENVIRONMENT: 'test-suite',
    POSTHOG_API_KEY: POSTHOG_KEY,
    POSTHOG_HOST: stub.origin,
    ...overrides,
  });
  registerConfigSecrets(config);
  return createTelemetry({ config: config.telemetry, db, logger, version: '9.8.7', posthog: { flushAt: 1 } });
}

beforeAll(async () => {
  root = makeTempDir('telemetry-on');
  db = openDatabase(root);
  stub = await startTelemetryStub();
});
afterAll(async () => {
  await telemetry?.shutdown();
  db.close();
  await stub.close();
  clearSecrets();
  removeDir(root);
});
afterEach(() => {
  stub.requests.length = 0;
});

async function waitFor(check: () => boolean, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
}

const NEEDLES = [
  'gw.example.test',
  'aaaa1111',
  'bbbb2222cccc',
  'tmdb-test-token-123456',
  'example-cdn.tb-cdn.io',
  '192.168.1.50',
  'Alice',
  'hunter2-secret',
  'sess-cookie-value',
];

describe('telemetry with stub keys', () => {
  it('sends a scrubbed Sentry envelope with release, environment and tags', async () => {
    telemetry = build();
    expect(telemetry).toMatchObject({ errorsEnabled: true, analyticsEnabled: true });
    telemetry.breadcrumb('playback', 'Fetched https://gw.example.test/stremio/aaaa1111/bbbb2222cccc/manifest.json', {
      host: '192.168.1.50',
    });
    const error = new Error(
      'Failed on C:\\Users\\Alice\\Videos\\x.mkv via https://example-cdn.tb-cdn.io/dl/9?token=hunter2-secret from 192.168.1.50 with tmdb-test-token-123456',
    );
    telemetry.captureError(error, {
      requestId: 'req-abc',
      deviceKind: 'tv',
      mediaType: 'movie',
      tags: { error_code: 'x' },
    });
    await telemetry.shutdown();

    const envelopes = stub.requests.filter((request) => request.path.includes('/envelope/'));
    expect(envelopes.length).toBeGreaterThanOrEqual(1);
    const items = envelopes.flatMap((request) => parseEnvelope(request.body));
    const event = items.find((item) => item.header.type === 'event')?.payload as LooseJson | undefined;
    expect(event).toBeDefined();
    expect(event).toMatchObject({
      release: 'homestream@9.8.7',
      environment: 'test-suite',
      tags: { request_id: 'req-abc', 'device.kind': 'tv', 'media.type': 'movie', error_code: 'x', app: 'server' },
    });
    expect(event).not.toHaveProperty('server_name');
    expect(event).not.toHaveProperty('user');
    expect(event).not.toHaveProperty('request');
    expect(event?.sdk?.settings).toEqual({ infer_ip: 'never' });
    expect(JSON.stringify(event)).not.toMatch(/ip_address|"geo"/);
    expect(event?.breadcrumbs ?? event?.breadcrumbs?.values).toBeDefined();
    const everything = envelopes.map((request) => request.body).join('\n');
    for (const needle of NEEDLES) expect(everything, needle).not.toContain(needle);
    expect(everything).toContain('<home>');
    expect(JSON.stringify(event?.exception)).toContain('Failed on');
  });

  it('keeps stack paths relative to the repository', async () => {
    telemetry = build();
    telemetry.captureError(new Error('where am i'));
    await telemetry.shutdown();
    const envelopes = stub.requests.filter((request) => request.path.includes('/envelope/'));
    const event = envelopes
      .flatMap((request) => parseEnvelope(request.body))
      .find((item) => item.header.type === 'event')?.payload as LooseJson;
    const filenames = event.exception.values[0].stacktrace.frames.map((frame: { filename: string }) => frame.filename);
    expect(filenames.length).toBeGreaterThan(0);
    for (const filename of filenames) expect(filename).not.toMatch(/^(?:[A-Za-z]:|\/)|Users/);
    expect(filenames).toContain('apps/server/test/telemetry/telemetryOn.test.ts');
    expect(JSON.stringify(event.contexts)).not.toMatch(/culture|timezone|boot_time|cpu_description/);
  });

  it('sends no console breadcrumbs and no session items', async () => {
    telemetry = build();
    console.warn(['console', 'noise'].join('-'));
    telemetry.captureError(new Error('with console'));
    await telemetry.shutdown();
    const envelopes = stub.requests.filter((request) => request.path.includes('/envelope/'));
    const items = envelopes.flatMap((request) => parseEnvelope(request.body));
    const event = items.find((item) => item.header.type === 'event')?.payload as LooseJson;
    expect((event.breadcrumbs as Array<{ category: string }>).map((crumb) => crumb.category)).not.toContain('console');
    expect(items.map((item) => item.header.type)).not.toContain('session');
  });

  it('sends allowlisted analytics events only, with titles and without urls or extra properties', async () => {
    telemetry = build();
    telemetry.capture('playback_started', {
      mediaType: 'movie',
      tmdbId: 603,
      title: 'The Matrix',
      deviceKind: 'tv',
      videoCodec: 'hevc',
      hdr: true,
      resolution: '2160p',
      startupMs: 1800,
      // not in the catalog: dropped before sending
      streamUrl: 'https://example-cdn.tb-cdn.io/dl/9?token=hunter2-secret',
      clientIp: '192.168.1.50',
    } as never);
    telemetry.capture('not_in_catalog' as never, { anything: 1 } as never);
    await telemetry.shutdown();

    await waitFor(() => stub.requests.some((request) => request.path.endsWith('/batch/')));
    const batches = stub.requests.filter((request) => request.path.endsWith('/batch/'));
    expect(batches.length).toBeGreaterThanOrEqual(1);
    const events = batches.flatMap((request) => JSON.parse(request.body).batch as Array<LooseJson>);
    const names = events.map((event) => event.event);
    expect(names).toContain('playback_started');
    expect(names).not.toContain('not_in_catalog');
    const started = events.find((event) => event.event === 'playback_started') as LooseJson;
    expect(started.properties).toMatchObject({
      title: 'The Matrix',
      tmdbId: 603,
      resolution: '2160p',
      app: 'server',
      appVersion: '9.8.7',
    });
    expect(started.properties).not.toHaveProperty('streamUrl');
    expect(started.properties).not.toHaveProperty('clientIp');
    expect(started.properties.$geoip_disable).toBe(true);
    expect(started.properties.$process_person_profile).toBe(false);
    expect(started.properties).not.toHaveProperty('$ip');
    expect(Object.keys(started.properties).filter((key) => /ip$|^\$geoip_(?!disable)/i.test(key))).toEqual([]);
    const raw = batches.map((request) => request.body).join('\n');
    for (const needle of NEEDLES) expect(raw, needle).not.toContain(needle);
    expect(started.distinct_id).toBe(getSetting(db, 'install_id'));
    expect(started.distinct_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(started)).not.toMatch(/DESKTOP|hostname|username/i);
  });

  it('flushes queued events on shutdown', async () => {
    telemetry = build();
    // Bigger queue than flushAt so only shutdown sends it.
    const slow = createTelemetry({
      config: testConfig(root, { POSTHOG_API_KEY: POSTHOG_KEY, POSTHOG_HOST: stub.origin }).telemetry,
      db,
      logger,
      version: '9.8.7',
      posthog: { flushAt: 100 },
    });
    slow.capture('server_started', { version: '9.8.7', os: 'windows', packaged: false, nodeMajor: 24 });
    expect(stub.requests.filter((request) => request.path.endsWith('/batch/'))).toEqual([]);
    await slow.shutdown();
    expect(stub.requests.filter((request) => request.path.endsWith('/batch/')).length).toBe(1);
    await telemetry.shutdown();
  });

  it('keeps the install id stable across starts', () => {
    const first = getSetting(db, 'install_id');
    telemetry = build();
    expect(getSetting(db, 'install_id')).toBe(first);
  });

  it('reads flags from PostHog and falls back to the default when it fails', async () => {
    stub.setFlags({ 'prefetch-on-details': false, 'banner-rotation-interval': '12s' });
    telemetry = build();
    await expect(telemetry.flag('prefetch-on-details')).resolves.toBe(false);
    await expect(telemetry.flag('banner-rotation-interval')).resolves.toBe('12s');
    await telemetry.shutdown();

    stub.setFlags(null);
    telemetry = build();
    await expect(telemetry.flag('prefetch-on-details')).resolves.toBe(true);
    await expect(telemetry.flag('banner-rotation-interval')).resolves.toBe('9s');
    await telemetry.shutdown();

    stub.setFlags({ 'banner-rotation-interval': 'bogus-variant' });
    telemetry = build();
    await expect(telemetry.flag('banner-rotation-interval')).resolves.toBe('9s');
    await telemetry.shutdown();
    stub.setFlags({});
  });

  it('never throws into the caller after shutdown', async () => {
    telemetry = build();
    await telemetry.shutdown();
    expect(() => {
      telemetry.captureError(new Error('late'));
      telemetry.capture('server_started', { version: '1.0.0', os: 'linux', packaged: true, nodeMajor: 24 });
      telemetry.breadcrumb('x', 'late');
    }).not.toThrow();
    await expect(telemetry.shutdown()).resolves.toBeUndefined();
  });

  it('leaves the Sentry client configured for the release, with tracing sampled low', () => {
    telemetry = build();
    const options = Sentry.getClient()?.getOptions();
    expect(options?.release).toBe('homestream@9.8.7');
    expect(options?.tracesSampleRate ?? 0).toBeLessThanOrEqual(0.1);
  });
});
