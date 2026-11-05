import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupOrphans, PID_FILE_NAME, PidRegistry } from '../../src/playback/pidRegistry.js';
import { makeTempDir, removeDir } from '../helpers.js';

let root: string;
const children: ChildProcess[] = [];

beforeAll(() => {
  root = makeTempDir('pids');
});

afterAll(() => {
  for (const child of children) child.kill();
  removeDir(root);
});

function sleeper(marker: string): ChildProcess {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)', marker], { stdio: 'ignore', windowsHide: true });
  children.push(child);
  return child;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitGone(pid: number): Promise<void> {
  for (let i = 0; i < 50 && alive(pid); i += 1) await new Promise((resolve) => setTimeout(resolve, 100));
}

describe('PidRegistry', () => {
  it('persists entries to disk and reloads them', () => {
    const file = path.join(root, 'reg', PID_FILE_NAME);
    const registry = new PidRegistry(file);
    registry.add({ pid: 111, sessionId: 'a', startedAt: 1 });
    registry.add({ pid: 222, sessionId: 'b', startedAt: 2 });
    registry.remove(111);
    expect(JSON.parse(readFileSync(file, 'utf8')).pids).toEqual([{ pid: 222, sessionId: 'b', startedAt: 2 }]);
    expect(new PidRegistry(file).list()).toEqual([{ pid: 222, sessionId: 'b', startedAt: 2 }]);
  });

  it('starts empty for a missing or corrupt file', () => {
    const corrupt = path.join(root, 'corrupt.json');
    writeFileSync(corrupt, '{nope');
    expect(new PidRegistry(corrupt).list()).toEqual([]);
    expect(new PidRegistry(path.join(root, 'missing.json')).list()).toEqual([]);
  });
});

describe('cleanupOrphans', () => {
  it('kills recorded processes whose command line carries the session id and wipes session directories', async () => {
    const transcodeDir = path.join(root, 'transcode');
    mkdirSync(path.join(transcodeDir, 'stale-session'), { recursive: true });
    writeFileSync(path.join(transcodeDir, 'stale-session', 'seg-0.ts'), 'x');
    const child = sleeper('orphan-session-id-1');
    const registry = new PidRegistry(path.join(root, 'orphans', PID_FILE_NAME));
    registry.add({ pid: child.pid as number, sessionId: 'orphan-session-id-1', startedAt: Date.now() });

    const result = await cleanupOrphans(registry, transcodeDir);
    await waitGone(child.pid as number);

    expect(result.killed).toEqual([child.pid]);
    expect(alive(child.pid as number)).toBe(false);
    expect(existsSync(path.join(transcodeDir, 'stale-session'))).toBe(false);
    expect(registry.list()).toEqual([]);
  }, 30_000);

  it('matches an entry on its own marker instead of the session id when it has one', async () => {
    const child = sleeper('marker-webvtt-job');
    const registry = new PidRegistry(path.join(root, 'marker', PID_FILE_NAME));
    registry.add({ pid: child.pid as number, sessionId: 'id-not-on-command-line', startedAt: Date.now(), match: 'marker-webvtt-job' });

    const result = await cleanupOrphans(registry, path.join(root, 'no-such-dir'));
    await waitGone(child.pid as number);

    expect(result.killed).toEqual([child.pid]);
    expect(alive(child.pid as number)).toBe(false);
  }, 30_000);

  it('leaves a process alone when its pid was recycled by something else', async () => {
    const child = sleeper('some-other-program');
    const registry = new PidRegistry(path.join(root, 'recycled', PID_FILE_NAME));
    registry.add({ pid: child.pid as number, sessionId: 'orphan-session-id-2', startedAt: Date.now() });

    const result = await cleanupOrphans(registry, path.join(root, 'no-such-dir'));

    expect(result.killed).toEqual([]);
    expect(alive(child.pid as number)).toBe(true);
    expect(registry.list()).toEqual([]);
  }, 30_000);

  it('ignores recorded pids that no longer exist', async () => {
    const registry = new PidRegistry(path.join(root, 'gone', PID_FILE_NAME));
    registry.add({ pid: 2_000_000_000, sessionId: 'x', startedAt: 1 });
    const result = await cleanupOrphans(registry, path.join(root, 'none'));
    expect(result).toEqual({ killed: [], wipedDirs: [] });
    expect(registry.list()).toEqual([]);
  }, 30_000);
});
