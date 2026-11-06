export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LoggerSink {
  write(line: string): void;
}

export interface LoggerOptions {
  /** Removes URLs, keys, addresses and machine names from every message and field. */
  scrub: (text: string) => string;
  sink: LoggerSink;
  /** Called for every line at info and above (the shell routes it to a Sentry breadcrumb). */
  breadcrumb?: (level: LogLevel, message: string) => void;
  now?: () => Date;
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

function scrubFields(fields: Record<string, unknown>, scrub: (text: string) => string): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    clean[key] = typeof value === 'string' ? scrub(value) : value instanceof Error ? scrub(value.message) : value;
  }
  return clean;
}

/** JSON-lines logger for the main process: one object per line, `level`, `time`, `msg`, plus scrubbed fields. */
export function createLogger(options: LoggerOptions): Logger {
  const now = options.now ?? (() => new Date());
  const log = (level: LogLevel, message: string, fields: Record<string, unknown> = {}): void => {
    const msg = options.scrub(message);
    try {
      options.sink.write(
        `${JSON.stringify({ level, time: now().toISOString(), msg, ...scrubFields(fields, options.scrub) })}\n`,
      );
      if (level !== 'debug') options.breadcrumb?.(level, msg);
    } catch {
      // logging must never disturb the caller
    }
  };
  return {
    debug: (message, fields) => log('debug', message, fields),
    info: (message, fields) => log('info', message, fields),
    warn: (message, fields) => log('warn', message, fields),
    error: (message, fields) => log('error', message, fields),
  };
}
