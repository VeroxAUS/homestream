import type { RawTelemetryConfig } from './config.ts';

const OFF_VALUES = /^(off|0|false|no|disabled)$/i;

export type BuildEnv = Record<string, string | undefined>;

export function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * What the bundle knows about telemetry, from the build environment (vite.config.ts). Tests get nothing, so a developer's
 * `.env` keys never reach a unit test, and a build without `SENTRY_DSN_WEB` / `POSTHOG_API_KEY` holds no key at all.
 */
export function telemetryFromEnv(env: BuildEnv, mode: string, version: string): RawTelemetryConfig {
  const empty = mode === 'test';
  return {
    sentryDsn: empty ? null : nonEmpty(env.SENTRY_DSN_WEB),
    posthogKey: empty ? null : nonEmpty(env.POSTHOG_API_KEY),
    posthogHost: empty ? null : nonEmpty(env.POSTHOG_HOST),
    off: OFF_VALUES.test(env.HOMESTREAM_TELEMETRY?.trim() ?? ''),
    stub: env.HOMESTREAM_TELEMETRY_STUB === '1',
    release: nonEmpty(env.SENTRY_RELEASE) ?? `homestream@${version}`,
    environment: nonEmpty(env.SENTRY_ENVIRONMENT) ?? 'production',
  };
}
