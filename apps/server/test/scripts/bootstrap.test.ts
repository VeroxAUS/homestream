import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrap, describeFfmpeg, ensureEnvFile, nodeMajor } from '../../../../scripts/bootstrap.mjs';
import { makeTempDir, removeDir } from '../helpers.js';

const roots: string[] = [];
let root: string;

beforeEach(() => {
  root = makeTempDir('bootstrap');
  roots.push(root);
  writeFileSync(path.join(root, '.env.example'), '# KEY=\n');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  return () => vi.restoreAllMocks();
});
afterAll(() => {
  for (const dir of roots) removeDir(dir);
});

/** A read stub that finds pnpm and (optionally) ffmpeg. */
function fakeRead(options: { pnpm?: boolean; ffmpeg?: string | null } = {}) {
  const { pnpm = true, ffmpeg = ' V....D h264_nvenc NVIDIA NVENC H.264 encoder' } = options;
  return (command: string): string | null => {
    if (command.startsWith('pnpm')) return pnpm ? '12.18.0\n' : null;
    return ffmpeg;
  };
}

describe('ensureEnvFile', () => {
  it('creates .env from .env.example when it is absent', () => {
    expect(ensureEnvFile(root)).toBe('created');
    expect(readFileSync(path.join(root, '.env'), 'utf8')).toBe('# KEY=\n');
  });

  it('never overwrites an existing .env', () => {
    writeFileSync(path.join(root, '.env'), 'MARKER=keep-me\n');
    expect(ensureEnvFile(root)).toBe('kept');
    expect(ensureEnvFile(root)).toBe('kept');
    expect(readFileSync(path.join(root, '.env'), 'utf8')).toBe('MARKER=keep-me\n');
  });

  it('reports a missing template without creating anything', () => {
    const empty = makeTempDir('bootstrap-empty');
    roots.push(empty);
    expect(ensureEnvFile(empty)).toBe('missing-template');
    expect(existsSync(path.join(empty, '.env'))).toBe(false);
  });
});

describe('nodeMajor and describeFfmpeg', () => {
  it('reads the major version', () => {
    expect(nodeMajor('24.20.0')).toBe(24);
    expect(nodeMajor('22.1.0')).toBe(22);
  });

  it('warns about a missing ffmpeg or missing NVENC and accepts a full build', () => {
    expect(describeFfmpeg(null).level).toBe('warn');
    expect(describeFfmpeg(' V....D libx264').level).toBe('warn');
    expect(describeFfmpeg(' V....D hevc_nvenc').level).toBe('ok');
  });
});

describe('bootstrap', () => {
  it('runs install, hooks, shared build in order, creates .env and exits 0', () => {
    mkdirSync(path.join(root, '.git'));
    const run = vi.fn<(command: string) => boolean>(() => true);
    expect(bootstrap({ root, run, read: fakeRead(), version: '24.20.0', isCi: false })).toBe(0);
    expect(run.mock.calls.map(([command]) => command)).toEqual([
      'pnpm install --frozen-lockfile',
      'pnpm exec lefthook install',
      'pnpm --filter @homestream/shared build',
    ]);
    expect(existsSync(path.join(root, '.env'))).toBe(true);
  });

  it('succeeds with only warnings when ffmpeg is missing and skips hooks without .git', () => {
    const run = vi.fn<(command: string) => boolean>(() => true);
    expect(bootstrap({ root, run, read: fakeRead({ ffmpeg: null }), version: '24.1.0', isCi: false })).toBe(0);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('ffmpeg was not found'));
    expect(run.mock.calls.map(([command]) => command)).not.toContain('pnpm exec lefthook install');
  });

  it('keeps an existing .env on a second run', () => {
    const run = vi.fn<(command: string) => boolean>(() => true);
    bootstrap({ root, run, read: fakeRead(), version: '24.0.0', isCi: true });
    writeFileSync(path.join(root, '.env'), 'MARKER=1\n');
    bootstrap({ root, run, read: fakeRead(), version: '24.0.0', isCi: true });
    expect(readFileSync(path.join(root, '.env'), 'utf8')).toBe('MARKER=1\n');
  });

  it('fails before installing anything on the wrong Node version', () => {
    const run = vi.fn<(command: string) => boolean>(() => true);
    expect(bootstrap({ root, run, read: fakeRead(), version: '22.5.0' })).toBe(1);
    expect(run).not.toHaveBeenCalled();
  });

  it('fails with a hint when pnpm is missing', () => {
    const run = vi.fn<(command: string) => boolean>(() => true);
    expect(bootstrap({ root, run, read: fakeRead({ pnpm: false }), version: '24.0.0' })).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('pnpm was not found'));
    expect(run).not.toHaveBeenCalled();
  });

  it('stops when the install fails', () => {
    const run = vi.fn(() => false);
    expect(bootstrap({ root, run, read: fakeRead(), version: '24.0.0', isCi: true })).toBe(1);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
