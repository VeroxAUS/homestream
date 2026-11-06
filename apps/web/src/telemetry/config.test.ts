import { describe, expect, it } from 'vitest';
import { DEFAULT_POSTHOG_HOST, OPT_OUT_KEY, resolveTelemetryConfig, type RawTelemetryConfig } from './config';

const RAW: RawTelemetryConfig = {
  sentryDsn: 'https://public@sentry.example.test/1',
  posthogKey: 'phc_example',
  posthogHost: null,
  off: false,
  stub: false,
  release: 'homestream@1.2.3',
  environment: 'production',
};

const storageWith = (value: string | null) => ({ getItem: (key: string) => (key === OPT_OUT_KEY ? value : null) });

describe('resolveTelemetryConfig', () => {
  it('is null when no key was baked into the build', () => {
    expect(resolveTelemetryConfig({ ...RAW, sentryDsn: null, posthogKey: null }, undefined)).toBeNull();
  });

  it('keeps working with only one of the two keys', () => {
    expect(resolveTelemetryConfig({ ...RAW, posthogKey: null }, undefined)).toMatchObject({ posthogKey: null });
    expect(resolveTelemetryConfig({ ...RAW, sentryDsn: null }, undefined)).toMatchObject({ sentryDsn: null });
  });

  it('is null when the build said off, even with keys', () => {
    expect(resolveTelemetryConfig({ ...RAW, off: true }, undefined)).toBeNull();
  });

  it('is null when this browser opted out', () => {
    expect(resolveTelemetryConfig(RAW, storageWith('off'))).toBeNull();
    expect(resolveTelemetryConfig(RAW, storageWith('on'))).not.toBeNull();
  });

  it('ignores a storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
    };
    expect(resolveTelemetryConfig(RAW, broken)).not.toBeNull();
  });

  it('defaults the PostHog host and enables the test trigger only for stub builds', () => {
    expect(resolveTelemetryConfig(RAW, undefined)).toMatchObject({
      posthogHost: DEFAULT_POSTHOG_HOST,
      testTrigger: false,
      release: 'homestream@1.2.3',
    });
    expect(resolveTelemetryConfig({ ...RAW, stub: true, posthogHost: 'http://127.0.0.1:9' }, undefined)).toMatchObject({
      posthogHost: 'http://127.0.0.1:9',
      testTrigger: true,
    });
  });
});
