import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig, type TelemetryConfig } from '../config.js';
import { migrate } from '../db/index.js';
import { createTelemetry, type TelemetryLogger } from './index.js';

/** Thrown on purpose by `pnpm telemetry:smoke` so the report is easy to find and to tell apart from a real failure. */
export class HomestreamReadinessSmokeError extends Error {
  override readonly name = 'HomestreamReadinessSmokeError';
}

export interface SmokeOptions {
  sentry: boolean;
  posthog: boolean;
}

export interface SmokeDeps {
  config: TelemetryConfig;
  version: string;
  out: (line: string) => void;
  /** Fixed run id for tests; a random one is made otherwise. */
  runId?: string;
}

/** Invented values that look like what must never leave the machine; the report is checked for them after delivery. */
export const SMOKE_NEEDLES = {
  cdnUrl: 'https://cdn.example.test/dl/abc123/Some.Movie.2024.mkv?token=smoke-needle-token',
  lanAddress: '192.168.1.77',
  userPath: 'C:\\Users\\SmokeUser\\Videos\\movie.mkv',
} as const;

/** Invented title and id of the playback_started-shaped smoke event; the run id in the title makes it unique. */
const SMOKE_PLAYBACK = { tmdbId: 1, titlePrefix: 'Readiness smoke' } as const;

export function parseSmokeArgs(argv: readonly string[]): SmokeOptions | null {
  const flags = argv.filter((arg) => arg !== '--');
  if (flags.some((flag) => flag !== '--sentry' && flag !== '--posthog')) return null;
  if (flags.length === 0) return { sentry: true, posthog: true };
  return { sentry: flags.includes('--sentry'), posthog: flags.includes('--posthog') };
}

export function newRunId(): string {
  return randomBytes(4).toString('hex');
}

function silentLogger(out: (line: string) => void): TelemetryLogger {
  return { info: () => undefined, warn: (message) => out(message), debug: () => undefined };
}

/** Reads the settings the way the server does (process environment, then the repository `.env`) and runs the smoke test. */
export async function smokeMain(
  argv: readonly string[],
  environment: { env?: NodeJS.ProcessEnv; repoRoot: string | null; version: string },
  out: (line: string) => void,
): Promise<number> {
  const options = parseSmokeArgs(argv);
  if (!options) {
    out('Usage: pnpm telemetry:smoke [--sentry] [--posthog]');
    return 2;
  }
  const { telemetry } = loadConfig({ env: environment.env, repoRoot: environment.repoRoot });
  return runSmoke(options, { config: telemetry, version: environment.version, out });
}

/**
 * Sends one deliberate error to Sentry and two events (server_started, playback_started) to PostHog, flushes, and reports what happened. Always returns 0:
 * a missing key or an unreachable service is a message, not a failure, so the command is safe in any environment.
 */
export async function runSmoke(options: SmokeOptions, deps: SmokeDeps): Promise<number> {
  const runId = deps.runId ?? newRunId();
  const { out } = deps;
  const wantSentry = options.sentry && !!deps.config.sentryDsn;
  const wantPosthog = options.posthog && !!deps.config.posthogKey;
  out(`Telemetry smoke run ${runId}`);
  if (deps.config.disabled) out('HOMESTREAM_TELEMETRY=off: nothing will be sent.');
  if (options.sentry && !wantSentry) out('Sentry: skipped (SENTRY_DSN_SERVER is not set or telemetry is off).');
  if (options.posthog && !wantPosthog) out('PostHog: skipped (POSTHOG_API_KEY is not set or telemetry is off).');

  const db = new DatabaseSync(':memory:');
  try {
    migrate(db);
    const telemetry = createTelemetry({
      config: {
        ...deps.config,
        sentryDsn: wantSentry ? deps.config.sentryDsn : null,
        posthogKey: wantPosthog ? deps.config.posthogKey : null,
      },
      db,
      logger: silentLogger(out),
      version: deps.version,
      posthog: { onRequest: (description) => out(`PostHog: ${description}`) },
    });

    if (wantSentry) {
      telemetry.breadcrumb('smoke', `Readiness smoke ${runId} started`, { runId });
      telemetry.breadcrumb('smoke', `Fetching ${SMOKE_NEEDLES.cdnUrl} from ${SMOKE_NEEDLES.lanAddress}`);
      telemetry.captureError(
        new HomestreamReadinessSmokeError(
          `Deliberate readiness smoke error ${runId}: ${SMOKE_NEEDLES.cdnUrl} ${SMOKE_NEEDLES.lanAddress} ${SMOKE_NEEDLES.userPath}`,
        ),
        { requestId: `smoke-${runId}`, deviceKind: 'web', mediaType: 'movie', tags: { smoke_run: runId } },
      );
      out(`Sentry: queued HomestreamReadinessSmokeError for run ${runId}.`);
    }
    if (wantPosthog) {
      telemetry.capture('server_started', {
        version: `0.0.0-smoke.${runId}`,
        os: 'other',
        packaged: false,
        nodeMajor: Number(process.versions.node.split('.')[0]),
      });
      telemetry.capture('playback_started', {
        mediaType: 'movie',
        tmdbId: SMOKE_PLAYBACK.tmdbId,
        title: `${SMOKE_PLAYBACK.titlePrefix} ${runId}`,
        deviceKind: 'web',
        videoCodec: 'h264',
        hdr: false,
        toneMapped: false,
        resolution: '1080p',
        startupMs: 1234,
      });
      out(
        `PostHog: queued server_started (version 0.0.0-smoke.${runId}) and playback_started (title "${SMOKE_PLAYBACK.titlePrefix} ${runId}"); prefetch-on-details = ${String(await telemetry.flag('prefetch-on-details'))}.`,
      );
    }
    await telemetry.shutdown();
    if (wantSentry || wantPosthog)
      out('Flushed and closed. Search Sentry (homestream-server) or PostHog for the run id above.');
  } finally {
    db.close();
  }
  return 0;
}
