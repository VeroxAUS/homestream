import { describe, expect, it } from 'vitest';
import { nonEmpty, telemetryFromEnv } from './buildEnv';

describe('telemetryFromEnv', () => {
  it('holds no key when none is set', () => {
    expect(telemetryFromEnv({}, 'production', '0.1.0')).toEqual({
      sentryDsn: null,
      posthogKey: null,
      posthogHost: null,
      off: false,
      stub: false,
      release: 'homestream@0.1.0',
      environment: 'production',
    });
  });

  it('reads the keys, the release and the environment', () => {
    const raw = telemetryFromEnv(
      {
        SENTRY_DSN_WEB: ' https://public@sentry.example.test/1 ',
        POSTHOG_API_KEY: 'phc_example',
        POSTHOG_HOST: 'http://127.0.0.1:9',
        SENTRY_RELEASE: 'homestream@9.9.9',
        SENTRY_ENVIRONMENT: 'staging',
        HOMESTREAM_TELEMETRY_STUB: '1',
      },
      'production',
      '0.1.0',
    );
    expect(raw).toMatchObject({
      sentryDsn: 'https://public@sentry.example.test/1',
      posthogKey: 'phc_example',
      posthogHost: 'http://127.0.0.1:9',
      release: 'homestream@9.9.9',
      environment: 'staging',
      stub: true,
    });
  });

  it.each(['off', 'OFF', '0', 'false', 'no', 'disabled'])('treats HOMESTREAM_TELEMETRY=%s as off', (value) => {
    expect(telemetryFromEnv({ HOMESTREAM_TELEMETRY: value }, 'production', '0.1.0').off).toBe(true);
  });

  it('bakes no key into an off build', () => {
    const raw = telemetryFromEnv(
      {
        HOMESTREAM_TELEMETRY: 'off',
        SENTRY_DSN_WEB: 'https://x@y.example.test/1',
        POSTHOG_API_KEY: 'phc_x',
        POSTHOG_HOST: 'http://127.0.0.1:9',
      },
      'production',
      '0.1.0',
    );
    expect(raw).toMatchObject({ off: true, sentryDsn: null, posthogKey: null, posthogHost: null });
  });

  it('does not treat other values as off', () => {
    expect(telemetryFromEnv({ HOMESTREAM_TELEMETRY: 'on' }, 'production', '0.1.0').off).toBe(false);
  });

  it('never lets a developer .env reach the test mode', () => {
    const raw = telemetryFromEnv(
      { SENTRY_DSN_WEB: 'https://x@y.example.test/1', POSTHOG_API_KEY: 'phc_x' },
      'test',
      '1.0.0',
    );
    expect(raw.sentryDsn).toBeNull();
    expect(raw.posthogKey).toBeNull();
  });
});

describe('nonEmpty', () => {
  it('trims and maps blank values to null', () => {
    expect(nonEmpty('  a ')).toBe('a');
    expect(nonEmpty('   ')).toBeNull();
    expect(nonEmpty(undefined)).toBeNull();
  });
});
