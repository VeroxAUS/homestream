import { describe, expect, it } from 'vitest';
import { createLogger, type LogLevel } from '../src/logger.js';
import { REQUEST_ID_HEADER, newRequestId, withRequestId } from '../src/requestId.js';

function setup() {
  const lines: string[] = [];
  const crumbs: Array<[LogLevel, string]> = [];
  const logger = createLogger({
    scrub: (text) => text.replaceAll('hunter2', '[redacted]'),
    sink: { write: (line) => lines.push(line) },
    breadcrumb: (level, message) => crumbs.push([level, message]),
    now: () => new Date('2026-01-02T03:04:05.000Z'),
  });
  return { lines, crumbs, logger };
}

describe('createLogger', () => {
  it('writes one scrubbed JSON object per line', () => {
    const { lines, logger } = setup();
    logger.info('server hunter2 attached', { port: 8600, detail: 'token hunter2', failure: new Error('boom hunter2') });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.endsWith('\n')).toBe(true);
    expect(JSON.parse(lines[0] ?? '')).toEqual({
      level: 'info',
      time: '2026-01-02T03:04:05.000Z',
      msg: 'server [redacted] attached',
      port: 8600,
      detail: 'token [redacted]',
      failure: 'boom [redacted]',
    });
  });

  it('routes info, warn and error to breadcrumbs but not debug', () => {
    const { crumbs, logger } = setup();
    logger.debug('quiet');
    logger.info('a');
    logger.warn('b');
    logger.error('c');
    expect(crumbs).toEqual([
      ['info', 'a'],
      ['warn', 'b'],
      ['error', 'c'],
    ]);
  });

  it('never throws when the sink fails', () => {
    const logger = createLogger({
      scrub: (text) => text,
      sink: {
        write: () => {
          throw new Error('disk full');
        },
      },
    });
    expect(() => logger.error('x')).not.toThrow();
  });
});

describe('request ids', () => {
  it('adds an X-Request-ID header to the caller headers', () => {
    expect(REQUEST_ID_HEADER).toBe('X-Request-ID');
    const headers = withRequestId({ Accept: 'text/event-stream' }, 'fixed-id');
    expect(headers).toEqual({ Accept: 'text/event-stream', 'X-Request-ID': 'fixed-id' });
  });

  it('generates a fresh UUID per call', () => {
    expect(newRequestId()).toMatch(/^[0-9a-f-]{36}$/);
    expect(withRequestId()['X-Request-ID']).not.toBe(withRequestId()['X-Request-ID']);
  });
});
