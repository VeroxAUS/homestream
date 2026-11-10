import { randomUUID } from 'node:crypto';
import { createWriteStream, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as Sentry from '@sentry/electron/main';
import { createLogger, type Logger, type LogLevel } from '../logger.js';
import { createDesktopAnalytics, type DesktopAnalytics } from '../telemetry/analytics.js';
import { resolveTelemetryConfig, testRunId } from '../telemetry/config.js';
import { createMainScrubber, type MainScrubber } from '../telemetry/scrub.js';
import { buildMainSentryOptions, mainBreadcrumb } from '../telemetry/sentry.js';

const MAX_LOG_BYTES = 2 * 1024 * 1024;

export interface TelemetryInput {
  env: NodeJS.ProcessEnv;
  packaged: boolean;
  version: string;
  /** Folders the scrubber turns into relative paths: the app folder and, when packaged, the resources folder. */
  roots: readonly string[];
  /** `DATA_DIR`, where `desktop.log` goes next to the server's `server.log`. */
  dataDir: string;
  userDataDir: string;
}

export interface MainTelemetry {
  logger: Logger;
  scrubber: MainScrubber;
  analytics: DesktopAnalytics | null;
  sentryActive: boolean;
  logFile: string;
  /** Reports one deliberate error when HOMESTREAM_TELEMETRY_TEST holds a run id; does nothing otherwise. */
  reportTestError(): Promise<void>;
  flush(): Promise<void>;
}

function installId(userDataDir: string): string {
  const file = path.join(userDataDir, 'install-id');
  try {
    const existing = readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f-]{36}$/.test(existing)) return existing;
  } catch {
    // first run
  }
  const id = randomUUID();
  try {
    mkdirSync(userDataDir, { recursive: true });
    writeFileSync(file, id);
  } catch {
    // an id that is not saved is still a random id
  }
  return id;
}

function openLogStream(file: string): { write(line: string): void } {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    if ((statSync(file, { throwIfNoEntry: false })?.size ?? 0) > MAX_LOG_BYTES) renameSync(file, `${file}.1`);
    const stream = createWriteStream(file, { flags: 'a' });
    stream.on('error', () => undefined);
    return stream;
  } catch {
    return { write: () => undefined };
  }
}

/**
 * Sentry (errors, off without a DSN or with HOMESTREAM_TELEMETRY=off), PostHog (catalog events, off without a key) and
 * the logger that feeds a log file and Sentry breadcrumbs. Every sink shares one scrubber. Call before the app is ready:
 * @sentry/electron has to be initialised first.
 */
export function startTelemetry(input: TelemetryInput): MainTelemetry {
  const config = resolveTelemetryConfig(input.env, input.packaged);
  const scrubber = createMainScrubber(input.roots);
  const options = buildMainSentryOptions({ config, version: input.version, scrubber });
  let sentryActive = false;
  if (options) {
    try {
      Sentry.init(options);
      sentryActive = true;
    } catch {
      // a broken reporter must not stop the app
    }
  }
  const logFile = path.join(input.dataDir, 'desktop.log');
  const logger = createLogger({
    scrub: scrubber.text,
    sink: openLogStream(logFile),
    breadcrumb: sentryActive
      ? (level: LogLevel, message: string) => Sentry.addBreadcrumb(mainBreadcrumb(level, message))
      : undefined,
  });
  const analytics = createDesktopAnalytics({
    config,
    version: input.version,
    distinctId: installId(input.userDataDir),
    scrub: scrubber.text,
  });
  return {
    logger,
    scrubber,
    analytics,
    sentryActive,
    logFile,
    async reportTestError() {
      const runId = testRunId(input.env);
      if (!sentryActive || !runId) return;
      Sentry.withScope((scope) => {
        scope.setTag('telemetry_test_run', runId);
        Sentry.captureException(new Error('HomeStream desktop telemetry test error'));
      });
      await Sentry.flush(2000).catch(() => false);
    },
    async flush() {
      await Promise.allSettled([analytics?.shutdown(2000), sentryActive ? Sentry.flush(2000) : undefined]);
    },
  };
}
