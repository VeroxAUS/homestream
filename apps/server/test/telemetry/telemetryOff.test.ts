import * as Sentry from '@sentry/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../../src/db/index.js';
import { getSetting } from '../../src/db/settings.js';
import { createTelemetry, describeTelemetry } from '../../src/telemetry/index.js';
import { makeTempDir, removeDir, testConfig } from '../helpers.js';
import { startTelemetryStub, type TelemetryStub } from './stubServer.js';

const logger = { info: () => undefined, warn: () => undefined, debug: () => undefined };

let root: string;
let db: Db;
let stub: TelemetryStub;

beforeAll(async () => {
  root = makeTempDir('telemetry-off');
  db = openDatabase(root);
  stub = await startTelemetryStub();
});
afterAll(async () => {
  db.close();
  await stub.close();
  removeDir(root);
});
afterEach(() => {
  stub.requests.length = 0;
});

function exercise(telemetry: ReturnType<typeof createTelemetry>): void {
  telemetry.captureError(new Error('deliberate'), { requestId: 'r1' });
  telemetry.breadcrumb('test', 'a breadcrumb');
  telemetry.capture('server_started', { version: '1.2.3', os: 'windows', packaged: false, nodeMajor: 24 });
}

describe('telemetry that is off', () => {
  it('does nothing without keys: no client, no request, no install id', async () => {
    const config = testConfig(root).telemetry;
    expect(config).toMatchObject({ sentryDsn: null, posthogKey: null, disabled: false });
    const telemetry = createTelemetry({ config, db, logger, version: '1.2.3' });
    exercise(telemetry);
    await telemetry.shutdown();
    expect(telemetry).toMatchObject({ errorsEnabled: false, analyticsEnabled: false });
    expect(Sentry.getClient()).toBeUndefined();
    expect(stub.requests).toEqual([]);
    expect(getSetting(db, 'install_id')).toBeNull();
    expect(describeTelemetry(config)).toMatch(/off \(no Sentry or PostHog key/);
  });

  it('does nothing with HOMESTREAM_TELEMETRY=off even when every key is set', async () => {
    const config = testConfig(root, {
      HOMESTREAM_TELEMETRY: 'off',
      SENTRY_DSN_SERVER: stub.dsn,
      POSTHOG_API_KEY: 'phc_stubkey0000',
      POSTHOG_HOST: stub.origin,
    }).telemetry;
    expect(config).toMatchObject({ disabled: true, sentryDsn: null, posthogKey: null });
    const telemetry = createTelemetry({ config, db, logger, version: '1.2.3' });
    exercise(telemetry);
    await telemetry.shutdown();
    expect(Sentry.getClient()).toBeUndefined();
    expect(stub.requests).toEqual([]);
    expect(getSetting(db, 'install_id')).toBeNull();
    expect(describeTelemetry(config)).toMatch(/HOMESTREAM_TELEMETRY=off/);
  });

  it.each(['off', 'OFF', '0', 'false', 'no', 'disabled'])('treats HOMESTREAM_TELEMETRY=%s as off', (value) => {
    const config = testConfig(root, { HOMESTREAM_TELEMETRY: value, SENTRY_DSN_SERVER: stub.dsn }).telemetry;
    expect(config.disabled).toBe(true);
    expect(config.sentryDsn).toBeNull();
  });

  it('answers every flag with its local default', async () => {
    const telemetry = createTelemetry({ config: testConfig(root).telemetry, db, logger, version: '1.2.3' });
    await expect(telemetry.flag('prefetch-on-details')).resolves.toBe(true);
    await expect(telemetry.flag('banner-rotation-interval')).resolves.toBe('9s');
    expect(stub.requests).toEqual([]);
  });

  it('logs the default evaluation source at debug level without starting a client or making a request', async () => {
    const debug: Array<{ fields: object; message: string }> = [];
    const telemetry = createTelemetry({
      config: testConfig(root).telemetry,
      db,
      logger: { ...logger, debug: (fields, message) => debug.push({ fields, message }) },
      version: '1.2.3',
    });
    await telemetry.flag('prefetch-on-details');
    expect(debug).toEqual([
      {
        fields: expect.objectContaining({ flag: 'prefetch-on-details', source: 'default' }),
        message: 'Feature flag evaluated',
      },
    ]);
    expect(telemetry).toMatchObject({ errorsEnabled: false, analyticsEnabled: false });
    expect(Sentry.getClient()).toBeUndefined();
    expect(stub.requests).toEqual([]);
  });

  it('ignores an invalid DSN and stays off', () => {
    const config = testConfig(root, { SENTRY_DSN_SERVER: 'not a dsn' });
    expect(config.telemetry.sentryDsn).toBeNull();
    expect(config.warnings.join(' ')).toMatch(/SENTRY_DSN_SERVER is not a valid DSN/);
  });
});
