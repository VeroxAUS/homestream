import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadShellEnv, resolveEnvFile } from '../src/envFile.js';
import { loadingPageUrl } from '../src/loadingPage.js';
import type { Logger } from '../src/logger.js';
import { MiniPlayerState } from '../src/miniPlayer.js';
import { ServerMonitor, type MonitorEvents } from '../src/monitor.js';
import { createServerClient } from '../src/serverHttp.js';
import { createSseParser, type SseMessage } from '../src/sse.js';
import { Supervisor, type SupervisorTiming } from '../src/supervisor.js';
import type { ServerChild } from '../src/serverProcess.js';

const temp = mkdtempSync(path.join(os.tmpdir(), 'hs-desktop-edge-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));
const quiet: Logger = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };

describe('the real file system paths of the env file', () => {
  it('prefers the repo .env when it exists and reads files from disk', () => {
    const repo = path.join(temp, 'repo');
    mkdirSync(repo);
    writeFileSync(path.join(repo, '.env'), 'PORT=8644\n');
    const file = resolveEnvFile({ env: {}, packaged: false, repoRoot: repo, appData: path.join(temp, 'AppData') });
    expect(file).toBe(path.join(repo, '.env'));
    const env: NodeJS.ProcessEnv = {};
    expect(loadShellEnv(file, env)).toEqual(['PORT']);
    expect(env.PORT).toBe('8644');
    expect(loadShellEnv(path.join(temp, 'nothing.env'), {})).toEqual([]);
  });
});

describe('small edges', () => {
  it('builds a Failed page URL without a code or time', () => {
    const url = new URL(loadingPageUrl('file:///x.html', { state: 'failed', version: '1.0.0', port: 8600 }));
    expect([...url.searchParams.keys()].sort()).toEqual(['port', 'state', 'v']);
  });

  it('has no session id while closed', () => {
    expect(new MiniPlayerState().sessionId).toBeNull();
  });

  it('parses field-only lines and a lone carriage return', () => {
    const seen: SseMessage[] = [];
    const feed = createSseParser((message) => seen.push(message));
    feed('data\rdata: x\revent\r\r');
    expect(seen).toEqual([{ event: '', data: '\nx' }]);
  });

  it('creates a client with the real fetch by default', async () => {
    const client = createServerClient(1);
    expect(await client.probe(200)).toBe('none');
  });
});

const encoder = new TextEncoder();

function monitorWorld(
  options: { status?: number; failFetch?: boolean; slowActivity?: boolean; failHealth?: boolean } = {},
) {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const fetches: string[] = [];
  let releaseActivity: () => void = () => undefined;
  const client = {
    origin: 'http://127.0.0.1:8600',
    fetch(path: string) {
      fetches.push(path);
      if (options.failFetch) return Promise.reject(new Error('refused'));
      if (options.status) return Promise.resolve(new Response('no', { status: options.status }));
      return Promise.resolve(new Response(new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) })));
    },
    probe: () => Promise.resolve('homestream' as const),
    getJson(path: string) {
      if (path === '/api/health') {
        return options.failHealth ? Promise.reject(new Error('503')) : Promise.resolve({ overall: 'ok', checks: [] });
      }
      if (options.slowActivity) {
        return new Promise((resolve) => {
          releaseActivity = () => resolve({ sessions: [{ sessionId: 'a', state: 'playing', title: 't' }] });
        });
      }
      return Promise.resolve({ sessions: [] });
    },
  };
  const events: MonitorEvents = {
    onHealth: vi.fn(),
    onSessions: vi.fn(),
    onSessionError: vi.fn(),
    onDownloadReady: vi.fn(),
    onDownloadFailed: vi.fn(),
  };
  const monitor = new ServerMonitor(client, events, quiet, { healthMs: 60_000, reconnectMs: 1000 });
  return {
    monitor,
    events,
    fetches,
    release: () => releaseActivity(),
    push: async (text: string) => {
      controller?.enqueue(encoder.encode(text));
      await vi.advanceTimersByTimeAsync(5);
    },
  };
}

describe('ServerMonitor edges', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('opens one stream however often it is started', async () => {
    const world = monitorWorld();
    world.monitor.start();
    world.monitor.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(world.fetches.filter((path) => path === '/api/events')).toHaveLength(1);
    expect(world.monitor.running).toBe(true);
    world.monitor.stop();
  });

  it.each([{ status: 500 }, { failFetch: true }])('retries after a failed connection (%j)', async (options) => {
    const world = monitorWorld(options);
    world.monitor.start();
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(2100);
    expect(world.fetches.filter((path) => path === '/api/events').length).toBeGreaterThanOrEqual(2);
    world.monitor.stop();
    const before = world.fetches.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(world.fetches).toHaveLength(before);
  });

  it('does not count sessions that arrive after it was stopped', async () => {
    const world = monitorWorld({ slowActivity: true });
    world.monitor.start();
    await vi.advanceTimersByTimeAsync(10);
    world.monitor.stop();
    world.release();
    await vi.advanceTimersByTimeAsync(10);
    expect(world.events.onSessions).not.toHaveBeenCalledWith(1);
  });

  it('skips the minute poll right after an event stream health update', async () => {
    const world = monitorWorld();
    world.monitor.start();
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(50_000);
    await world.push('event: health\ndata: {"overall":"warn","checks":[]}\n\n');
    expect(world.events.onHealth).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(world.events.onHealth).toHaveBeenCalledTimes(2);
    world.monitor.stop();
  });

  it('keeps going when the health read fails and ignores an end event without an id', async () => {
    const world = monitorWorld({ failHealth: true });
    world.monitor.start();
    await vi.advanceTimersByTimeAsync(10);
    await world.push('event: session.end\ndata: {"reason":"user"}\n\n');
    expect(world.events.onHealth).not.toHaveBeenCalled();
    world.monitor.stop();
  });
});

class StubChild implements ServerChild {
  readonly exits: Array<(info: { code: number | null; signal: string | null }) => void> = [];
  readonly outputs: Array<(line: string, stream: 'stdout' | 'stderr') => void> = [];
  constructor(readonly pid: number | undefined) {}
  onExit(callback: (info: { code: number | null; signal: string | null }) => void): void {
    this.exits.push(callback);
  }
  onOutput(callback: (line: string, stream: 'stdout' | 'stderr') => void): void {
    this.outputs.push(callback);
  }
  requestShutdown(): void {
    for (const callback of this.exits) callback({ code: 0, signal: null });
  }
  forceKill(): void {
    this.requestShutdown();
  }
}

const TIMING: SupervisorTiming = {
  readyPollMs: 10,
  readyTimeoutMs: 100_000,
  attachPollMs: 100,
  attachMisses: 2,
  crashWindowMs: 60_000,
  stopGraceMs: 5000,
};

describe('Supervisor edges', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('treats a spawn that throws a plain value as a crash', async () => {
    const supervisor = new Supervisor(
      {
        spawn: () => {
          throw 'no node';
        },
        probe: () => Promise.resolve('none'),
        logger: quiet,
      },
      TIMING,
    );
    await supervisor.start();
    expect(supervisor.status).toMatchObject({ kind: 'crashed', attempt: 1 });
  });

  it('keeps only the last lines of server output and ignores a child without a process id', async () => {
    const child = new StubChild(undefined);
    const supervisor = new Supervisor(
      { spawn: () => child, probe: () => Promise.resolve('none'), logger: quiet },
      TIMING,
    );
    await supervisor.start();
    for (let line = 0; line < 40; line += 1) child.outputs[0]?.(`line ${line}`, line % 2 === 0 ? 'stdout' : 'stderr');
    child.exits[0]?.({ code: 1, signal: null });
    expect(supervisor.status.kind).toBe('crashed');
    await supervisor.stop();
  });

  it('stops polling an attached server once it was stopped mid-probe', async () => {
    let answer: (value: 'homestream' | 'none') => void = () => undefined;
    let calls = 0;
    const supervisor = new Supervisor(
      {
        spawn: () => new StubChild(1),
        probe: () => {
          calls += 1;
          if (calls === 1) return Promise.resolve('homestream');
          return new Promise((resolve) => void (answer = resolve));
        },
        logger: quiet,
      },
      TIMING,
    );
    await supervisor.start();
    await vi.advanceTimersByTimeAsync(100);
    await supervisor.stop();
    answer('none');
    await vi.advanceTimersByTimeAsync(1000);
    expect(supervisor.status.kind).toBe('stopped');
    expect(calls).toBe(2);
  });

  it('does not attach or spawn when it was stopped while the first probe was running', async () => {
    for (const answer of ['homestream', 'none'] as const) {
      let release: (value: 'homestream' | 'none') => void = () => undefined;
      const spawn = vi.fn(() => new StubChild(1));
      const supervisor = new Supervisor(
        { spawn, probe: () => new Promise((resolve) => void (release = resolve)), logger: quiet },
        TIMING,
      );
      const starting = supervisor.start();
      await supervisor.stop();
      release(answer);
      await starting;
      expect(supervisor.status.kind).toBe('stopped');
      expect(spawn).not.toHaveBeenCalled();
    }
  });

  it('does not report a server as ready when it was stopped while the readiness probe was running', async () => {
    let release: (value: 'homestream' | 'none') => void = () => undefined;
    let calls = 0;
    const child = new StubChild(7);
    const supervisor = new Supervisor(
      {
        spawn: () => child,
        probe: () => {
          calls += 1;
          return calls === 1 ? Promise.resolve('none') : new Promise((resolve) => void (release = resolve));
        },
        logger: quiet,
      },
      TIMING,
    );
    await supervisor.start();
    await vi.advanceTimersByTimeAsync(20);
    await supervisor.stop();
    release('homestream');
    await vi.advanceTimersByTimeAsync(20);
    expect(supervisor.status.kind).toBe('stopped');
  });
});
