/** What the build bakes in. Everything is null/false when the matching environment variable was not set at build time. */
export interface RawTelemetryConfig {
  sentryDsn: string | null;
  posthogKey: string | null;
  posthogHost: string | null;
  /** `HOMESTREAM_TELEMETRY=off` at build time. */
  off: boolean;
  /** `HOMESTREAM_TELEMETRY_STUB=1`: the build points at stub receivers and enables the dev-only test trigger. */
  stub: boolean;
  release: string;
  environment: string;
}

export interface TelemetryConfig {
  sentryDsn: string | null;
  posthogKey: string | null;
  posthogHost: string;
  release: string;
  environment: string;
  /** The test trigger (`?__telemetry_test=<run id>`) is honored. Only builds made with the stub environment have it. */
  testTrigger: boolean;
}

export const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';
/** Set to `off` in localStorage to switch telemetry off in this browser, whatever the build contains. */
export const OPT_OUT_KEY = 'homestream.telemetry';

function readOptOut(storage: Pick<Storage, 'getItem'> | undefined): boolean {
  try {
    return storage?.getItem(OPT_OUT_KEY) === 'off';
  } catch {
    return false;
  }
}

/** Null when nothing may be sent: no key was baked in, the build said off, or this browser opted out. */
export function resolveTelemetryConfig(
  raw: RawTelemetryConfig,
  storage: Pick<Storage, 'getItem'> | undefined,
): TelemetryConfig | null {
  if (raw.off || readOptOut(storage)) return null;
  if (!raw.sentryDsn && !raw.posthogKey) return null;
  return {
    sentryDsn: raw.sentryDsn,
    posthogKey: raw.posthogKey,
    posthogHost: raw.posthogHost ?? DEFAULT_POSTHOG_HOST,
    release: raw.release,
    environment: raw.environment,
    testTrigger: raw.stub,
  };
}
