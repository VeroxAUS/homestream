import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachLogSink, logger, type LogEntry } from './logger';

describe('logger', () => {
  let detach: (() => void) | undefined;
  afterEach(() => {
    detach?.();
    vi.restoreAllMocks();
  });

  it('buffers entries until a sink is attached, then replays them in order', () => {
    // flush anything earlier tests left behind
    attachLogSink(() => undefined)();
    logger.info('boot', 'first');
    logger.warn('boot', 'second', { code: 7 });
    const seen: LogEntry[] = [];
    detach = attachLogSink((entry) => seen.push(entry));
    expect(seen).toEqual([
      { level: 'info', category: 'boot', message: 'first' },
      { level: 'warn', category: 'boot', message: 'second', data: { code: 7 } },
    ]);
    logger.error('boot', 'third');
    expect(seen.at(-1)).toEqual({ level: 'error', category: 'boot', message: 'third' });
  });

  it('also writes to the console in development', () => {
    vi.stubEnv('DEV', true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    logger.warn('api', 'slow', { ms: 900 });
    logger.debug('api', 'detail');
    expect(warn).toHaveBeenCalledWith('[api] slow', { ms: 900 });
    expect(log).toHaveBeenCalledWith('[api] detail', '');
  });

  it('keeps debug entries out of the sink', () => {
    attachLogSink(() => undefined)();
    const seen: LogEntry[] = [];
    detach = attachLogSink((entry) => seen.push(entry));
    logger.debug('x', 'noise');
    expect(seen).toEqual([]);
  });

  it('survives a throwing sink', () => {
    detach = attachLogSink(() => {
      throw new Error('sink broke');
    });
    expect(() => logger.error('x', 'still fine')).not.toThrow();
  });

  it('bounds the buffer', () => {
    attachLogSink(() => undefined)();
    for (let i = 0; i < 80; i++) logger.info('flood', `n${i}`);
    const seen: LogEntry[] = [];
    detach = attachLogSink((entry) => seen.push(entry));
    expect(seen).toHaveLength(50);
    expect(seen[0]?.message).toBe('n30');
  });

  it('detaching only removes its own sink', () => {
    const first = attachLogSink(() => undefined);
    const seen: LogEntry[] = [];
    detach = attachLogSink((entry) => seen.push(entry));
    first();
    logger.info('x', 'kept');
    expect(seen).toHaveLength(1);
  });
});
