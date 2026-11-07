import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const spawned = vi.hoisted(() => ({ children: [] as unknown[], calls: [] as unknown[][] }));

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => {
    spawned.calls.push(args);
    const child = Object.assign(new EventEmitter(), {
      pid: 4242,
      stdin: Object.assign(new EventEmitter(), { write: vi.fn() }),
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(),
    });
    spawned.children.push(child);
    return child;
  },
}));

const { spawnServerChild } = await import('../src/serverProcess.js');

const launch = { command: 'node', args: ['server.js'], env: {}, logFile: 'unused' } as unknown as Parameters<
  typeof spawnServerChild
>[0];

interface FakeChild extends EventEmitter {
  stdin: { write: ReturnType<typeof vi.fn> };
  kill: ReturnType<typeof vi.fn>;
}

describe('spawnServerChild with a scripted process', () => {
  beforeEach(() => {
    spawned.children.length = 0;
    spawned.calls.length = 0;
  });

  it('reports one exit even when both exit and error arrive', () => {
    const child = spawnServerChild(launch);
    const onExit = vi.fn();
    child.onExit(onExit);
    const fake = spawned.children[0] as FakeChild;
    fake.emit('exit', 1, null);
    fake.emit('error', new Error('late'));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledWith({ code: 1, signal: null });
  });

  it('writes the shutdown line and swallows a write that throws', () => {
    const child = spawnServerChild(launch);
    const fake = spawned.children[0] as FakeChild;
    child.requestShutdown();
    expect(fake.stdin.write).toHaveBeenCalledWith('shutdown\n');
    fake.stdin.write.mockImplementation(() => {
      throw new Error('EPIPE');
    });
    expect(() => child.requestShutdown()).not.toThrow();
  });

  it('kills the process tree with taskkill on Windows and with a signal elsewhere, and not after exit', () => {
    spawnServerChild(launch, 'win32').forceKill();
    expect(spawned.calls[1]?.[0]).toBe('taskkill');
    expect(spawned.calls[1]?.[1]).toEqual(['/PID', '4242', '/T', '/F']);
    const other = spawnServerChild(launch, 'linux');
    other.forceKill();
    expect((spawned.children[2] as FakeChild).kill).toHaveBeenCalledWith('SIGKILL');
    (spawned.children[2] as FakeChild).emit('exit', 0, null);
    other.forceKill();
    expect((spawned.children[2] as FakeChild).kill).toHaveBeenCalledTimes(1);
  });
});
