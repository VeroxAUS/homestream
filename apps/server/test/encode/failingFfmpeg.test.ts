import { execFile } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTempDir, removeDir } from '../helpers.js';
import { buildFailingFfmpeg, readCounter } from '../playback/failingFfmpeg.js';

// Only checks the wrapper itself: the forwarded calls are `-version`, nothing encodes.
function call(exe: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(exe, args, { windowsHide: true, timeout: 30_000 }, (error, stdout, stderr) => {
      const exitCode = (error as { code?: unknown } | null)?.code;
      resolve({ code: error ? (typeof exitCode === 'number' ? exitCode : -1) : 0, stdout, stderr });
    });
  });
}

let root: string;

beforeAll(() => {
  root = makeTempDir('failing-ffmpeg');
});

afterAll(() => removeDir(root));

describe('failing ffmpeg wrapper', () => {
  it('fails every encoder invocation but forwards everything else', async () => {
    const exe = path.join(root, 'always.exe');
    const counter = path.join(root, 'always.txt');
    await buildFailingFfmpeg(exe, counter);
    const first = await call(exe, ['-f', 'hls', 'out.m3u8']);
    expect(first.code).toBe(1);
    expect(first.stderr).toContain('simulated encoder failure');
    expect((await call(exe, ['-f', 'hls', 'out.m3u8'])).code).toBe(1);
    const version = await call(exe, ['-version']);
    expect(version.code).toBe(0);
    expect(version.stdout).toMatch(/^ffmpeg version/);
    expect(readCounter(counter)).toBe(2);
  }, 120_000);

  it('fails only the first N encoder invocations, then forwards to the real ffmpeg', async () => {
    const exe = path.join(root, 'first-two.exe');
    const counter = path.join(root, 'first-two.txt');
    await buildFailingFfmpeg(exe, counter, { failFirst: 2 });
    expect((await call(exe, ['-f', 'hls', 'a.m3u8'])).code).toBe(1);
    expect((await call(exe, ['-f', 'hls', 'a.m3u8'])).code).toBe(1);
    // The third call reaches the real ffmpeg, which rejects the missing input with its own exit code (not the wrapper's simulated failure).
    const third = await call(exe, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      path.join(root, 'missing input.mkv'),
      '-f',
      'hls',
      path.join(root, 'a.m3u8'),
    ]);
    expect(third.stderr).not.toContain('simulated encoder failure');
    expect(third.stderr).toContain('missing input.mkv');
    expect(readCounter(counter)).toBe(3);
  }, 120_000);
});
