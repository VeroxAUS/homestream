export interface DesktopTelemetryConfig {
  /** `HOMESTREAM_TELEMETRY=off` was set: nothing is sent, whatever keys exist. */
  disabled: boolean;
  /** The web project's DSN. The main process reports to the same Sentry project as the renderer (homestream-web). */
  sentryDsn: string | null;
  posthogKey: string | null;
  posthogHost: string;
  environment: string;
}

export const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

const OFF_VALUES = /^(off|0|false|no|disabled)$/i;

function validDsn(value: string | undefined): string | null {
  return value && URL.canParse(value) ? value : null;
}

function httpOrigin(value: string | undefined): string {
  if (!value || !URL.canParse(value)) return DEFAULT_POSTHOG_HOST;
  const url = new URL(value);
  return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : DEFAULT_POSTHOG_HOST;
}

/**
 * Reads the telemetry switches from the environment (the packaged app loads `%APPDATA%\HomeStream\config.env` into it).
 * Without a key the matching client never starts, and `HOMESTREAM_TELEMETRY=off` silences both.
 */
export function resolveTelemetryConfig(env: NodeJS.ProcessEnv, packaged: boolean): DesktopTelemetryConfig {
  const disabled = OFF_VALUES.test(env.HOMESTREAM_TELEMETRY?.trim() ?? '');
  return {
    disabled,
    sentryDsn: disabled ? null : validDsn(env.SENTRY_DSN_WEB?.trim()),
    posthogKey: disabled ? null : env.POSTHOG_API_KEY?.trim() || null,
    posthogHost: httpOrigin(env.POSTHOG_HOST?.trim()),
    environment: env.SENTRY_ENVIRONMENT?.trim() || (packaged ? 'production' : 'development'),
  };
}
