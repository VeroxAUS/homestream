import { describe, expect, it } from 'vitest';
import { DEFAULT_POSTHOG_HOST, resolveTelemetryConfig } from '../src/telemetry/config.js';

const DSN = 'https://abc123@o1.ingest.example.test/42';

describe('resolveTelemetryConfig', () => {
  it('is off without any key', () => {
    const config = resolveTelemetryConfig({}, false);
    expect(config).toMatchObject({
      disabled: false,
      sentryDsn: null,
      posthogKey: null,
      posthogHost: DEFAULT_POSTHOG_HOST,
    });
  });

  it('reads the web DSN and the PostHog key', () => {
    const config = resolveTelemetryConfig(
      { SENTRY_DSN_WEB: DSN, POSTHOG_API_KEY: 'phc_fake', POSTHOG_HOST: 'https://eu.posthog.example.test/path' },
      true,
    );
    expect(config).toEqual({
      disabled: false,
      sentryDsn: DSN,
      posthogKey: 'phc_fake',
      posthogHost: 'https://eu.posthog.example.test',
      environment: 'production',
    });
  });

  it('ignores the server DSN: the main process reports to the web project', () => {
    expect(resolveTelemetryConfig({ SENTRY_DSN_SERVER: DSN }, false).sentryDsn).toBeNull();
  });

  it.each(['off', 'OFF', '0', 'false', 'no', 'disabled'])('HOMESTREAM_TELEMETRY=%s silences everything', (value) => {
    const config = resolveTelemetryConfig(
      { HOMESTREAM_TELEMETRY: value, SENTRY_DSN_WEB: DSN, POSTHOG_API_KEY: 'phc_fake' },
      false,
    );
    expect(config).toMatchObject({ disabled: true, sentryDsn: null, posthogKey: null });
  });

  it('drops an invalid DSN and falls back from an invalid or non-http PostHog host', () => {
    expect(resolveTelemetryConfig({ SENTRY_DSN_WEB: 'not a dsn' }, false).sentryDsn).toBeNull();
    expect(resolveTelemetryConfig({ POSTHOG_HOST: 'ftp://host.example.test' }, false).posthogHost).toBe(
      DEFAULT_POSTHOG_HOST,
    );
    expect(resolveTelemetryConfig({ POSTHOG_HOST: 'nonsense' }, false).posthogHost).toBe(DEFAULT_POSTHOG_HOST);
  });

  it('names the environment from the setting or from the packaging', () => {
    expect(resolveTelemetryConfig({}, false).environment).toBe('development');
    expect(resolveTelemetryConfig({ SENTRY_ENVIRONMENT: 'staging' }, true).environment).toBe('staging');
  });
});
