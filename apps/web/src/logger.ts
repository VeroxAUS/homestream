type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  category: string;
  message: string;
  data?: Record<string, string | number | boolean>;
}

type Sink = (entry: LogEntry) => void;

const BUFFER_LIMIT = 50;
const buffer: LogEntry[] = [];
let sink: Sink | null = null;

/**
 * Routes log entries to Sentry breadcrumbs once the telemetry chunk has loaded. Entries made before that (the first
 * seconds of the page) wait in a small buffer and are replayed when the sink is attached. Returns the detach function.
 */
export function attachLogSink(next: Sink): () => void {
  sink = next;
  for (const entry of buffer.splice(0)) next(entry);
  return () => {
    if (sink === next) sink = null;
  };
}

function write(level: LogLevel, category: string, message: string, data?: LogEntry['data']): void {
  const entry: LogEntry = data ? { level, category, message, data } : { level, category, message };
  if (import.meta.env.DEV) console[level === 'debug' ? 'log' : level](`[${category}] ${message}`, data ?? '');
  if (level === 'debug') return;
  if (sink) {
    try {
      sink(entry);
    } catch {
      // logging must never disturb the caller
    }
    return;
  }
  buffer.push(entry);
  if (buffer.length > BUFFER_LIMIT) buffer.shift();
}

/** Structured logger of the web UI. `debug` is console-only in development; the rest also becomes a Sentry breadcrumb. */
export const logger = {
  debug: (category: string, message: string, data?: LogEntry['data']) => write('debug', category, message, data),
  info: (category: string, message: string, data?: LogEntry['data']) => write('info', category, message, data),
  warn: (category: string, message: string, data?: LogEntry['data']) => write('warn', category, message, data),
  error: (category: string, message: string, data?: LogEntry['data']) => write('error', category, message, data),
};
