import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TelemetryConfig } from '../../src/config.js';
import {
  HomestreamReadinessSmokeError,
  SMOKE_NEEDLES,
  newRunId,
  parseSmokeArgs,
  runSmoke,
  smokeMain,
} from '../../src/telemetry/smoke.js';
import { parseEnvelope, startTelemetryStub, type LooseJson, type TelemetryStub } from './stubServer.js';

let stub: TelemetryStub;
beforeAll(async () => {
  stub = await startTelemetryStub();
});
afterAll(async () => {
  await stub.close();
});

function config(overrides: Partial<TelemetryConfig> = {}): TelemetryConfig {
  return {
    disabled: false,
    sentryDsn: stub.dsn,
    posthogKey: 'phc_stubkey0000',
    posthogHost: stub.origin,
    environment: 'smoke-test',
    ...overrides,
  };
}

async function smoke(options: Parameters<typeof runSmoke>[0], overrides: Partial<TelemetryConfig> = {}) {
  stub.requests.length = 0;
  const lines: string[] = [];
  const code = await runSmoke(options, {
    config: config(overrides),
    version: '1.2.3',
    out: (line) => lines.push(line),
    runId: 'deadbeef',
  });
  return { code, output: lines.join('\n') };
}

describe('telemetry:smoke', () => {
  it('parses --sentry and --posthog, defaults to both and refuses anything else', () => {
    expect(parseSmokeArgs([])).toEqual({ sentry: true, posthog: true });
    expect(parseSmokeArgs(['--', '--sentry'])).toEqual({ sentry: true, posthog: false });
    expect(parseSmokeArgs(['--posthog'])).toEqual({ sentry: false, posthog: true });
    expect(parseSmokeArgs(['--nope'])).toBeNull();
    expect(newRunId()).toMatch(/^[0-9a-f]{8}$/);
    expect(newRunId()).not.toBe(newRunId());
  });

  it('throws a recognisable error type', () => {
    const error = new HomestreamReadinessSmokeError('boom');
    expect(error.name).toBe('HomestreamReadinessSmokeError');
    expect(error).toBeInstanceOf(Error);
  });

  it('sends one scrubbed Sentry error carrying the run id and no needle, then exits 0', async () => {
    const { code, output } = await smoke({ sentry: true, posthog: false });
    expect(code).toBe(0);
    expect(output).toContain('Telemetry smoke run deadbeef');
    expect(output).toContain('Sentry: queued HomestreamReadinessSmokeError for run deadbeef');
    expect(stub.requests.some((request) => request.path.includes('/envelope/'))).toBe(true);
    expect(stub.requests.some((request) => request.path.includes('/batch/'))).toBe(false);

    const event = stub.requests
      .filter((request) => request.path.includes('/envelope/'))
      .flatMap((request) => parseEnvelope(request.body))
      .find((item) => item.header.type === 'event')?.payload as LooseJson;
    expect(event.release).toBe('homestream@1.2.3');
    expect(event.environment).toBe('smoke-test');
    expect(event.exception.values[0].type).toBe('HomestreamReadinessSmokeError');
    expect(event.tags).toMatchObject({
      request_id: 'smoke-deadbeef',
      smoke_run: 'deadbeef',
      'device.kind': 'web',
      'media.type': 'movie',
    });
    expect(event.breadcrumbs.some((crumb: { category?: string }) => crumb.category === 'smoke')).toBe(true);
    const everything = stub.requests.map((request) => request.body).join('\n');
    expect(everything).toContain('deadbeef');
    for (const needle of ['smoke-needle-token', 'cdn.example.test', SMOKE_NEEDLES.lanAddress, 'SmokeUser']) {
      expect(everything).not.toContain(needle);
    }
    expect(event).not.toHaveProperty('server_name');
  });

  it('sends one PostHog event with the run id in its version and reports the request', async () => {
    const { code, output } = await smoke({ sentry: false, posthog: true });
    expect(code).toBe(0);
    expect(output).toMatch(/PostHog: POST \/batch\/ -> 200/);
    expect(output).toContain('prefetch-on-details = true');
    const batch = stub.requests.find((request) => request.path.includes('/batch/'));
    expect(batch?.body).toContain('"event":"server_started"');
    expect(batch?.body).toContain('0.0.0-smoke.deadbeef');
    expect(stub.requests.some((request) => request.path.includes('/envelope/'))).toBe(false);
  });

  it('reads the keys from the environment like the server and prints usage for a bad option', async () => {
    const lines: string[] = [];
    const out = (line: string) => lines.push(line);
    expect(await smokeMain(['--bogus'], { repoRoot: null, version: '1.0.0' }, out)).toBe(2);
    expect(lines.join('\n')).toContain('Usage: pnpm telemetry:smoke');
    stub.requests.length = 0;
    const env = {
      DATA_DIR: 'x',
      SENTRY_DSN_SERVER: stub.dsn,
      POSTHOG_API_KEY: 'phc_stubkey0000',
      POSTHOG_HOST: stub.origin,
    } as NodeJS.ProcessEnv;
    expect(await smokeMain([], { env, repoRoot: null, version: '1.0.0' }, out)).toBe(0);
    expect(stub.requests.some((request) => request.path.includes('/envelope/'))).toBe(true);
    expect(stub.requests.some((request) => request.path.includes('/batch/'))).toBe(true);
  });

  it('sends nothing and still exits 0 when the keys are missing or telemetry is off', async () => {
    const missing = await smoke({ sentry: true, posthog: true }, { sentryDsn: null, posthogKey: null });
    expect(missing.code).toBe(0);
    expect(missing.output).toContain('Sentry: skipped');
    expect(missing.output).toContain('PostHog: skipped');
    expect(stub.requests).toHaveLength(0);

    const off = await smoke({ sentry: true, posthog: true }, { disabled: true, sentryDsn: null, posthogKey: null });
    expect(off.code).toBe(0);
    expect(off.output).toContain('HOMESTREAM_TELEMETRY=off');
    expect(stub.requests).toHaveLength(0);
  });
});
