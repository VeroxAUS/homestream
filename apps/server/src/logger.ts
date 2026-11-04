import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import path from 'node:path';
import { pino, type Logger } from 'pino';
import { REDACTED, redact } from './redact.js';

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
  'req.headers.authorization',
  'headers.authorization',
  '*.token',
  '*.apiKey',
  '*.password',
  '*.authorization',
];

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
