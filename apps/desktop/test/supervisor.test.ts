import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../src/logger.js';
import type { ExitInfo, ServerChild } from '../src/serverProcess.js';
import {
  EXTERNAL_SERVER_MESSAGE,
  Supervisor,
  statusText,
  type SupervisorStatus,
  type SupervisorTiming,
} from '../src/supervisor.js';

class FakeChild implements ServerChild {
  readonly exits: Array<(info: ExitInfo) => void> = [];
  readonly outputs: Array<(line: string, stream: 'stdout' | 'stderr') => void> = [];
  shutdownRequests = 0;
  kills = 0;
  exited = false;
  /** When true the child leaves as soon as it is asked to. */
  politeness = true;

  constructor(readonly pid: number) {}

  onExit(callback: (info: ExitInfo) => void): void {
    this.exits.push(callback);
  }

  onOutput(callback: (line: string, stream: 'stdout' | 'stderr') => void): void {
    this.outputs.push(callback);
  }

  requestShutdown(): void {
    this.shutdownRequests += 1;
    if (this.politeness) this.exit({ code: 0, signal: null });
  }

  forceKill(): void {
    this.kills += 1;
    this.exit({ code: null, signal: 'SIGKILL' });
  }

  say(line: string, stream: 'stdout' | 'stderr' = 'stderr'): void {
    for (const callback of this.outputs) callback(line, stream);
  }

  exit(info: ExitInfo): void {
    if (this.exited) return;
    this.exited = true;
    for (const callback of this.exits) callback(info);
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

const quiet: Logger = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };

function setup(initial: 'homestream' | 'other' | 'none' = 'none') {
  const world = { answer: initial, children: [] as FakeChild[], spawnError: null as Error | null, nextPid: 100 };
  const statuses: SupervisorStatus[] = [];
  const supervisor = new Supervisor(
    {
      spawn() {
        if (world.spawnError) throw world.spawnError;
        const child = new FakeChild(world.nextPid++);
        world.children.push(child);
        return child;
      },
      probe: () => Promise.resolve(world.answer),
      logger: quiet,
    },
    TIMING,
  );
  supervisor.onChange((status) => statuses.push(status));
  /** The server answers on its port once it has been started. */
  const bringUp = async (): Promise<void> => {
    world.answer = 'homestream';
    await vi.advanceTimersByTimeAsync(20);
  };
  return { world, supervisor, statuses, bringUp };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('attach mode', () => {
  it('attaches to a HomeStream server that answers and spawns nothing', async () => {
    const { world, supervisor } = setup('homestream');
    await supervisor.start();
    expect(supervisor.status).toEqual({ kind: 'attached' });
    expect(supervisor.text).toBe('Server: attached to external server');
    expect(world.children).toHaveLength(0);
    expect(supervisor.reachable).toBe(true);
    expect(supervisor.spawnedPid).toBeNull();
  });

  it('refuses to restart a server it did not start', async () => {
    const { world, supervisor } = setup('homestream');
    await supervisor.start();
    expect(await supervisor.restart()).toEqual({ ok: false, message: EXTERNAL_SERVER_MESSAGE });
    expect(EXTERNAL_SERVER_MESSAGE).toBe('Server is managed outside the app');
    expect(world.children).toHaveLength(0);
  });

  it('leaves the external server running on stop', async () => {
    const { world, supervisor } = setup('homestream');
    await supervisor.start();
    await supervisor.stop();
    expect(supervisor.status).toEqual({ kind: 'stopped' });
    expect(world.children).toHaveLength(0);
  });

  it('reports the server as lost after repeated misses, spawns only on Start server, and notices its return', async () => {
    const { world, supervisor } = setup('homestream');
    await supervisor.start();
    world.answer = 'none';
    await vi.advanceTimersByTimeAsync(100);
    expect(supervisor.status.kind).toBe('attached');
    await vi.advanceTimersByTimeAsync(100);
    expect(supervisor.status.kind).toBe('lost');
    expect(world.children).toHaveLength(0);
    expect(await supervisor.restart()).toMatchObject({ ok: false });

    world.answer = 'homestream';
    await vi.advanceTimersByTimeAsync(100);
    expect(supervisor.status.kind).toBe('attached');

    world.answer = 'none';
    await vi.advanceTimersByTimeAsync(300);
    expect(supervisor.status.kind).toBe('lost');
    await supervisor.startServer();
    expect(world.children).toHaveLength(1);
    expect(supervisor.status.kind).toBe('starting');
  });

  it('startServer does nothing unless the external server is lost', async () => {
    const { world, supervisor } = setup('homestream');
    await supervisor.start();
    await supervisor.startServer();
    expect(world.children).toHaveLength(0);
  });
});

describe('spawn mode', () => {
  it('spawns when nothing answers and reports running once the server answers', async () => {
    const { world, supervisor, bringUp } = setup();
    await supervisor.start();
    expect(world.children).toHaveLength(1);
    expect(supervisor.status.kind).toBe('starting');
    await bringUp();
    expect(supervisor.status).toEqual({ kind: 'running', pid: 100 });
    expect(supervisor.text).toBe('Server: running (spawned, pid 100)');
    expect(supervisor.spawnedPid).toBe(100);
  });

  it('spawns when another program holds the port too (and fails with its error code)', async () => {
    const { world, supervisor } = setup('other');
    await supervisor.start();
    expect(world.children).toHaveLength(1);
  });

  it('restarts after a crash with waits of 1, 2 and 5 seconds', async () => {
    const { world, supervisor, bringUp, statuses } = setup();
    await supervisor.start();
    await bringUp();
    world.answer = 'none';

    const waits: number[] = [];
    for (let crash = 1; crash <= 4; crash += 1) {
      world.children.at(-1)?.exit({ code: 1, signal: null });
      const status = supervisor.status;
      expect(status).toMatchObject({ kind: 'crashed', attempt: crash });
      if (status.kind === 'crashed') waits.push(status.retryAt - Date.now());
      expect(supervisor.text).toBe(`Server: crashed \u2014 restarting (${crash}/5)`);
      await vi.advanceTimersByTimeAsync(waits.at(-1) ?? 0);
      expect(world.children).toHaveLength(crash + 1);
    }
    expect(waits).toEqual([1000, 2000, 5000, 5000]);
    expect(statuses.some((status) => status.kind === 'failed')).toBe(false);
  });

  it('gives up after more than five restarts in a minute and names the cause', async () => {
    const { world, supervisor } = setup();
    await supervisor.start();
    for (let crash = 1; crash <= 5; crash += 1) {
      world.children.at(-1)?.say('Error: listen EADDRINUSE: address already in use :::8600');
      world.children.at(-1)?.exit({ code: 1, signal: null });
      await vi.advanceTimersByTimeAsync(5000);
    }
    expect(supervisor.status.kind).toBe('starting');
    world.children.at(-1)?.say('Error: listen EADDRINUSE: address already in use :::8600');
    world.children.at(-1)?.exit({ code: 1, signal: null });
    expect(supervisor.status).toMatchObject({ kind: 'failed', code: 'EADDRINUSE' });
    expect(supervisor.text).toBe('Server: failed \u2014 see logs');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(world.children).toHaveLength(6);
  });

  it('forgets crashes older than a minute', async () => {
    const { world, supervisor } = setup();
    await supervisor.start();
    for (let crash = 1; crash <= 8; crash += 1) {
      world.children.at(-1)?.exit({ code: 1, signal: null });
      expect(supervisor.status.kind).toBe('crashed');
      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(30_000);
    }
    expect(world.children).toHaveLength(9);
  });

  it('Retry starts again after the supervisor gave up', async () => {
    const { world, supervisor, bringUp } = setup();
    await supervisor.start();
    for (let crash = 1; crash <= 6; crash += 1) {
      world.children.at(-1)?.exit({ code: 1, signal: null });
      await vi.advanceTimersByTimeAsync(5000);
    }
    expect(supervisor.status.kind).toBe('failed');
    const before = world.children.length;
    await supervisor.retry();
    expect(world.children).toHaveLength(before + 1);
    await bringUp();
    expect(supervisor.status.kind).toBe('running');
  });

  it('counts a spawn that throws as a crash', async () => {
    const { world, supervisor } = setup();
    world.spawnError = new Error('spawn node ENOENT');
    await supervisor.start();
    expect(supervisor.status).toMatchObject({ kind: 'crashed', attempt: 1 });
  });

  it('ends a server that never answers', async () => {
    const { world, supervisor } = setup();
    await supervisor.start();
    await vi.advanceTimersByTimeAsync(100_100);
    expect(world.children[0]?.kills).toBe(1);
    expect(supervisor.status.kind).toBe('crashed');
  });

  it('restarts a running server gracefully', async () => {
    const { world, supervisor, bringUp } = setup();
    await supervisor.start();
    await bringUp();
    world.answer = 'none';
    const result = await supervisor.restart();
    expect(result).toEqual({ ok: true });
    expect(world.children[0]?.shutdownRequests).toBe(1);
    expect(world.children[0]?.kills).toBe(0);
    expect(world.children).toHaveLength(2);
  });
});

describe('overlapping requests', () => {
  const alive = (children: FakeChild[]) => children.filter((child) => !child.exited);

  async function runningSlowToStop() {
    const harness = setup();
    await harness.supervisor.start();
    await harness.bringUp();
    harness.world.answer = 'none';
    const first = harness.world.children[0];
    if (!first) throw new Error('no child');
    first.politeness = false;
    return { ...harness, first };
  }

  it('two restarts at once spawn one new server', async () => {
    const { world, supervisor, first } = await runningSlowToStop();
    const results = Promise.all([supervisor.restart(), supervisor.restart()]);
    await vi.advanceTimersByTimeAsync(10);
    first.exit({ code: 0, signal: null });
    expect(await results).toEqual([{ ok: true }, { ok: true }]);
    expect(world.children).toHaveLength(2);
    expect(alive(world.children)).toHaveLength(1);
    expect(first.kills).toBe(0);
  });

  it('a restart and a Retry at once leave one server running', async () => {
    const { world, supervisor, first } = await runningSlowToStop();
    const both = Promise.all([supervisor.restart(), supervisor.retry()]);
    await vi.advanceTimersByTimeAsync(10);
    first.exit({ code: 0, signal: null });
    await vi.advanceTimersByTimeAsync(10);
    await both;
    expect(alive(world.children)).toHaveLength(1);
  });

  it('a restart that was waiting for the old server does not start a new one after quit', async () => {
    const { world, supervisor, first } = await runningSlowToStop();
    const restarting = supervisor.restart();
    await vi.advanceTimersByTimeAsync(10);
    const stopping = supervisor.stop();
    first.exit({ code: 0, signal: null });
    await Promise.all([restarting, stopping]);
    expect(supervisor.status).toEqual({ kind: 'stopped' });
    expect(world.children).toHaveLength(1);
    expect(alive(world.children)).toHaveLength(0);
  });
});

describe('quit while a request is waiting', () => {
  it('a Retry that was waiting for the old server does not start a new one', async () => {
    const { world, supervisor } = setup();
    await supervisor.start();
    const first = world.children[0];
    if (!first) throw new Error('no child');
    first.politeness = false;
    const retrying = supervisor.retry();
    await vi.advanceTimersByTimeAsync(10);
    const stopping = supervisor.stop();
    first.exit({ code: 0, signal: null });
    await Promise.all([retrying, stopping]);
    expect(supervisor.status).toEqual({ kind: 'stopped' });
    expect(world.children).toHaveLength(1);
  });

  it('Start server asked just before quit starts nothing', async () => {
    const { world, supervisor } = setup('homestream');
    await supervisor.start();
    world.answer = 'none';
    await vi.advanceTimersByTimeAsync(300);
    expect(supervisor.status.kind).toBe('lost');
    const starting = supervisor.startServer();
    const stopping = supervisor.stop();
    await Promise.all([starting, stopping]);
    expect(world.children).toHaveLength(0);
    expect(supervisor.status).toEqual({ kind: 'stopped' });
  });

  it('a start whose probe was running when quit came neither attaches nor spawns', async () => {
    for (const answer of ['homestream', 'none'] as const) {
      let release: (value: 'homestream' | 'none') => void = () => undefined;
      const probe = vi.fn(() => new Promise<'homestream' | 'none'>((resolve) => void (release = resolve)));
      const spawn = vi.fn(() => new FakeChild(1));
      const slow = new Supervisor({ spawn, probe, logger: quiet }, TIMING);
      const starting = slow.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(probe).toHaveBeenCalledTimes(1);
      await slow.stop();
      release(answer);
      await starting;
      expect(slow.status).toEqual({ kind: 'stopped' });
      await vi.advanceTimersByTimeAsync(1000);
      expect(probe).toHaveBeenCalledTimes(1);
      expect(spawn).not.toHaveBeenCalled();
    }
  });
});

describe('stop', () => {
  it('asks the server to shut down on its stdin line and waits for it', async () => {
    const { world, supervisor, bringUp } = setup();
    await supervisor.start();
    await bringUp();
    await supervisor.stop();
    const child = world.children[0];
    expect(child?.shutdownRequests).toBe(1);
    expect(child?.kills).toBe(0);
    expect(supervisor.status).toEqual({ kind: 'stopped' });
    expect(supervisor.text).toBe('Server: stopped');
  });

  it('ends the process tree when the server has not stopped after five seconds', async () => {
    const { world, supervisor, bringUp } = setup();
    await supervisor.start();
    await bringUp();
    const child = world.children[0];
    if (!child) throw new Error('no child');
    child.politeness = false;
    const stopping = supervisor.stop();
    await vi.advanceTimersByTimeAsync(4999);
    expect(child.kills).toBe(0);
    await vi.advanceTimersByTimeAsync(2);
    await stopping;
    expect(child.kills).toBe(1);
    expect(supervisor.status.kind).toBe('stopped');
  });

  it('does not restart a server it stopped itself', async () => {
    const { world, supervisor, bringUp } = setup();
    await supervisor.start();
    await bringUp();
    await supervisor.stop();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(world.children).toHaveLength(1);
  });
});

describe('statusText', () => {
  it('covers every state', () => {
    expect(statusText({ kind: 'starting' })).toBe('Server: starting');
    expect(statusText({ kind: 'lost' })).toBe('Server: not running \u2014 reconnecting');
  });
});
