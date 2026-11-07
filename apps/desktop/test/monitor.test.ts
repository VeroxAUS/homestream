import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../src/logger.js';
import { ServerMonitor, type MonitorEvents } from '../src/monitor.js';
import type { ServerClient } from '../src/serverHttp.js';

const quiet: Logger = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };

const session = (sessionId: string, state: string, title = 'Dune') => ({
  sessionId,
  state,
  title,
  deviceId: 'd',
  deviceName: 'TV',
  deviceKind: 'tv',
  mediaKey: 'movie:1',
  positionSec: 0,
  startedAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
});

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function setup(activity: unknown[] = []) {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let streams = 0;
  const requests: string[] = [];
  const client: ServerClient = {
    origin: 'http://127.0.0.1:8600',
    fetch(path) {
      requests.push(path);
      streams += 1;
      return Promise.resolve(
        new Response(new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) }), { status: 200 }),
      );
    },
    probe: () => Promise.resolve('homestream'),
    getJson(path) {
      requests.push(path);
      if (path === '/api/activity') return Promise.resolve({ sessions: activity });
      return Promise.resolve({ overall: 'ok', checks: [], checkedAt: '2026-01-01T00:00:00.000Z' });
    },
  };
  const events = {
    onHealth: vi.fn(),
    onSessions: vi.fn(),
    onSessionError: vi.fn(),
    onDownloadReady: vi.fn(),
    onDownloadFailed: vi.fn(),
  } satisfies MonitorEvents;
  const monitor = new ServerMonitor(client, events, quiet, { healthMs: 60_000, reconnectMs: 3000 });
  const push = async (text: string): Promise<void> => {
    controller?.enqueue(encoder.encode(text));
    await vi.advanceTimersByTimeAsync(5);
  };
  return { monitor, events, push, requests, streamCount: () => streams, end: () => controller?.close() };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('ServerMonitor', () => {
  it('reads the sessions once per connection and the health once, then only follows the stream', async () => {
    const { monitor, events, requests } = setup([session('a', 'playing'), session('b', 'paused')]);
    monitor.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(events.onSessions).toHaveBeenLastCalledWith(2);
    expect(events.onHealth).toHaveBeenCalledTimes(1);
    expect(requests.filter((path) => path === '/api/activity')).toHaveLength(1);
    expect(requests.filter((path) => path === '/api/events')).toHaveLength(1);
    monitor.stop();
  });

  it('refreshes the health at most once a minute', async () => {
    const { monitor, events } = setup();
    monitor.start();
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(events.onHealth).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(events.onHealth).toHaveBeenCalledTimes(2);
    monitor.stop();
  });

  it('counts sessions from start, update and end events', async () => {
    const { monitor, events, push } = setup();
    monitor.start();
    await vi.advanceTimersByTimeAsync(10);
    await push(sse('session.start', session('a', 'playing')));
    await push(sse('session.start', session('b', 'playing')));
    await push(sse('session.start', session('b', 'playing')));
    expect(events.onSessions).toHaveBeenLastCalledWith(2);
    await push(sse('session.end', { sessionId: 'a', reason: 'user', state: 'stopped' }));
    expect(events.onSessions).toHaveBeenLastCalledWith(1);
    await push(sse('session.update', session('b', 'stopped')));
    expect(events.onSessions).toHaveBeenLastCalledWith(0);
    monitor.stop();
  });

  it('reports a session error once, however often it is updated', async () => {
    const { monitor, events, push } = setup();
    monitor.start();
    await vi.advanceTimersByTimeAsync(10);
    await push(sse('session.update', session('a', 'error')));
    await push(sse('session.update', session('a', 'error')));
    expect(events.onSessionError).toHaveBeenCalledTimes(1);
    monitor.stop();
  });

  it('passes download and health events on and ignores noise', async () => {
    const { monitor, events, push } = setup();
    monitor.start();
    await vi.advanceTimersByTimeAsync(10);
    const download = { downloadId: 'd3', title: 'Heat', mediaType: 'movie', tmdbId: 949 };
    await push(sse('download.ready', download));
    await push(sse('download.failed', { ...download, reason: 'timeout', message: 'slow' }));
    await push(sse('health', { overall: 'warn', checks: [], checkedAt: '2026-01-01T00:00:00.000Z' }));
    await push(sse('heartbeat', {}));
    await push('event: download.ready\ndata: {not json}\n\n');
    await push(sse('download.ready', { nope: true }));
    expect(events.onDownloadReady).toHaveBeenCalledTimes(1);
    expect(events.onDownloadFailed).toHaveBeenCalledTimes(1);
    expect(events.onHealth).toHaveBeenLastCalledWith(expect.objectContaining({ overall: 'warn' }));
    monitor.stop();
  });

  it('reconnects after the stream drops and reads the sessions again', async () => {
    const { monitor, requests, end, streamCount } = setup();
    monitor.start();
    await vi.advanceTimersByTimeAsync(10);
    end();
    await vi.advanceTimersByTimeAsync(3100);
    expect(streamCount()).toBe(2);
    expect(requests.filter((path) => path === '/api/activity')).toHaveLength(2);
    monitor.stop();
  });

  it('retries after a failure that is not an Error and stays quiet when it fails after stop', async () => {
    let calls = 0;
    const client: ServerClient = {
      origin: 'http://127.0.0.1:8600',
      fetch() {
        calls += 1;
        return calls === 1 ? Promise.reject('refused') : Promise.reject(new Error('late'));
      },
      probe: () => Promise.resolve('homestream'),
      getJson: () => Promise.resolve({ overall: 'ok', checks: [], checkedAt: '2026-01-01T00:00:00.000Z' }),
    };
    const warn = vi.fn();
    const events = {
      onHealth: vi.fn(),
      onSessions: vi.fn(),
      onSessionError: vi.fn(),
      onDownloadReady: vi.fn(),
      onDownloadFailed: vi.fn(),
    };
    const monitor = new ServerMonitor(client, events, { ...quiet, warn }, { healthMs: 60_000, reconnectMs: 3000 });
    monitor.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(warn).toHaveBeenCalledWith('the event stream stopped', { error: 'refused' });
    await vi.advanceTimersByTimeAsync(3000);
    monitor.stop();
    warn.mockClear();
    await vi.advanceTimersByTimeAsync(10);
    expect(calls).toBe(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not reconnect when the stream ends after stop', async () => {
    const { monitor, end, streamCount } = setup();
    monitor.start();
    await vi.advanceTimersByTimeAsync(10);
    monitor.stop();
    end();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(streamCount()).toBe(1);
  });

  it('stop clears the session count and ends the polling', async () => {
    const { monitor, events, streamCount } = setup([session('a', 'playing')]);
    monitor.start();
    await vi.advanceTimersByTimeAsync(10);
    monitor.stop();
    expect(events.onSessions).toHaveBeenLastCalledWith(0);
    expect(monitor.running).toBe(false);
    await vi.advanceTimersByTimeAsync(200_000);
    expect(streamCount()).toBe(1);
  });
});

afterEach(() => vi.clearAllTimers());
