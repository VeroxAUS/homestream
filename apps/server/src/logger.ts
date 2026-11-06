import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import path from 'node:path';
import { pino, type Logger } from 'pino';
import { REDACTED, redact } from './redact.js';
import { currentRequestId } from './requestContext.js';

export type { Logger } from 'pino';

export interface LoggerOptions {
  dataDir: string;
  level?: string;
  stdout?: boolean;
}

export interface AppLogger {
  logger: Logger;
  close(): Promise<void>;
}

const REDACT_PATHS = [
  'token',
  'apiKey',
  'password',
  'authorization',
  'cookie',
  'url',
  'query',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.url',
  'req.query',
  'headers.authorization',
  'headers.cookie',
  'headers["x-api-key"]',
  '*.token',
  '*.apiKey',
  '*.password',
  '*.authorization',
  '*.cookie',
  '*.url',
  '*.query',
];

// Fastify's per-request child logger already binds reqId; the mixin covers the base logger used by services deep in a request.
const bindsRequestId = new WeakMap<object, boolean>();

function requestIdMixin(_merge: object, _level: number, self: Logger): { reqId?: string } {
  const reqId = currentRequestId();
  if (!reqId) return {};
  let bound = bindsRequestId.get(self);
  if (bound === undefined) {
    bound = 'reqId' in self.bindings();
    bindsRequestId.set(self, bound);
  }
  return bound ? {} : { reqId };
}

/** Every serialized line is redacted again as a whole, so free-text messages are covered too. */
export function createLogger(options: LoggerOptions): AppLogger {
  mkdirSync(options.dataDir, { recursive: true });
  const file: WriteStream = createWriteStream(path.join(options.dataDir, 'server.log'), { flags: 'a' });
  file.on('error', () => undefined);
  const toStdout = options.stdout ?? true;

  const destination = {
    write(line: string): void {
      const clean = redact(line);
      if (toStdout) process.stdout.write(clean);
      file.write(clean);
    },
  };

  const logger = pino(
    {
      level: options.level ?? 'info',
      redact: { paths: REDACT_PATHS, censor: REDACTED },
      mixin: requestIdMixin,
    },
    destination,
  );

  return {
    logger,
    close: () =>
      new Promise<void>((resolve) => {
        file.end(() => resolve());
      }),
  };
}

export function createSilentLogger(): Logger {
  return pino({ level: 'silent' });
}
