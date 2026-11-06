import type { CapabilityProfile } from '@homestream/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { TmdbService } from '../../src/tmdb/service.js';
import { clearSecrets } from '../../src/redact.js';
import { makeTempDir, removeDir, startTestApp } from '../helpers.js';
import { parseEnvelope, startTelemetryStub, type LooseJson, type TelemetryStub } from '../telemetry/stubServer.js';

const POSTHOG_KEY = 'phc_stubkey0000';
const DEVICE: CapabilityProfile = {
  deviceId: 'telemetry-test',
  deviceName: 'Telemetry Test',
  kind: 'tv',
  maxWidth: 1920,
  maxHeight: 1080,
  h264: true,
  hevc: true,
  hevcMain10: true,
  hdr10: false,
  maxAudioChannels: 6,
};

let root: string;
let stub: TelemetryStub;

beforeAll(async () => {
  root = makeTempDir('telemetry-app');
  stub = await startTelemetryStub();
});
afterAll(async () => {
  await stub.close();
  clearSecrets();
  removeDir(root);
});

function telemetryEnv(): Record<string, string> {
  return { SENTRY_DSN_SERVER: stub.dsn, POSTHOG_API_KEY: POSTHOG_KEY, POSTHOG_HOST: stub.origin };
}

function fakeTmdb(): { tmdb: TmdbService; movie: ReturnType<typeof vi.fn> } {
  const movie = vi.fn().mockResolvedValue({ imdbId: null, title: 'Stub Movie' });
  return {
    tmdb: { movie, stats: { requests: 0, errors: 0, cacheHits: 0, cacheMisses: 0 } } as unknown as TmdbService,
    movie,
  };
}

const prefetchBody = { mediaType: 'movie', tmdbId: 603, device: DEVICE };

describe('server with stub telemetry keys', () => {
  it('reports a 5xx to Sentry with the request id as a tag and answers in the usual shape', async () => {
    stub.requests.length = 0;
    const app = await startTestApp(makeTempDir('tele-500'), telemetryEnv());
    app.get('/__boom', () => {
      throw new Error('boom from https://example-cdn.tb-cdn.io/dl/1?token=hunter2-secret');
    });
    await app.ready();
    const res = await app.inject({ url: '/__boom', headers: { 'x-request-id': 'req-sentry-1' } });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe('internal_error');
    await app.close();

    const items = stub.requests
      .filter((request) => request.path.includes('/envelope/'))
      .flatMap((request) => parseEnvelope(request.body));
    const event = items.find((item) => item.header.type === 'event')?.payload as LooseJson;
    expect(event.tags).toMatchObject({ request_id: 'req-sentry-1' });
    expect(event.release).toMatch(/^homestream@\d+\.\d+\.\d+/);
    expect(JSON.stringify(event)).not.toMatch(/example-cdn\.tb-cdn|hunter2/);
  });

  it('does not report client errors', async () => {
    stub.requests.length = 0;
    const app = await startTestApp(makeTempDir('tele-404'), telemetryEnv());
    await app.ready();
    expect((await app.inject('/api/nope')).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/prefetch', payload: {} })).statusCode).toBe(400);
    await app.close();
    expect(stub.requests.filter((request) => request.path.includes('/envelope/'))).toEqual([]);
  });

  it('honors the prefetch-on-details flag from PostHog and reports the request event', async () => {
    stub.requests.length = 0;
    stub.setFlags({ 'prefetch-on-details': false });
    const { tmdb, movie } = fakeTmdb();
    const app = await startTestApp(makeTempDir('tele-flag-off'), telemetryEnv(), { tmdb });
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/api/prefetch', payload: prefetchBody });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ streamId: null });
    expect(movie).not.toHaveBeenCalled();
    const logs = (await app.inject('/api/logs')).json().events as Array<{ message: string }>;
    expect(logs.some((entry) => /prefetch-on-details flag is off/.test(entry.message))).toBe(true);
    await app.close();

    const events = stub.requests
      .filter((request) => request.path.endsWith('/batch/'))
      .flatMap((request) => JSON.parse(request.body).batch as Array<LooseJson>);
    const requested = events.find((event) => event.event === 'prefetch_requested');
    expect(requested?.properties).toMatchObject({
      mediaType: 'movie',
      tmdbId: 603,
      deviceKind: 'tv',
      flagEnabled: false,
    });
    stub.setFlags({});
  });

  it.each([
    ['PostHog answers nothing for the flag', {}],
    ['PostHog is failing', null],
  ])('keeps prefetching on when %s', async (_label, flags) => {
    stub.setFlags(flags);
    const { tmdb, movie } = fakeTmdb();
    const app = await startTestApp(makeTempDir('tele-flag-default'), telemetryEnv(), { tmdb });
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/api/prefetch', payload: prefetchBody });
    expect(res.statusCode).toBe(202);
    await app.close();
    expect(movie).toHaveBeenCalledTimes(1);
    stub.setFlags({});
  });

  it('prefetches without any telemetry configured', async () => {
    const { tmdb, movie } = fakeTmdb();
    const app = await startTestApp(makeTempDir('tele-none'), {}, { tmdb });
    await app.ready();
    expect((await app.inject({ method: 'POST', url: '/api/prefetch', payload: prefetchBody })).statusCode).toBe(202);
    await app.close();
    expect(movie).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when telemetry is switched off, whatever keys are set', async () => {
    stub.requests.length = 0;
    const app = await startTestApp(makeTempDir('tele-off'), { ...telemetryEnv(), HOMESTREAM_TELEMETRY: 'off' });
    app.get('/__boom', () => {
      throw new Error('boom');
    });
    await app.ready();
    await app.inject('/__boom');
    await app.inject({ method: 'POST', url: '/api/prefetch', payload: prefetchBody });
    await app.close();
    expect(stub.requests).toEqual([]);
  });
});
