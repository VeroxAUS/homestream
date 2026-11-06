import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { killChildProcesses } from './gpuCleanup.js';
import { GPU_TEST_GLOBS } from './gpuGroups.js';

const serverRoot = fileURLToPath(new URL('..', import.meta.url));

function listTests(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? listTests(full) : full.endsWith('.test.ts') ? [full] : [];
  });
}

function matchesGlob(glob: string, relative: string): boolean {
  return glob.endsWith('/**/*.test.ts')
    ? relative.startsWith(glob.slice(0, -'**/*.test.ts'.length))
    : relative === glob;
}

const inGpuGroup = (relative: string): boolean => GPU_TEST_GLOBS.some((glob) => matchesGlob(glob, relative));

// Anything that creates local media or boots the app with a real ffmpeg must live in the sequential gpu project.
// A file that boots the harness with a fake encoder and a stubbed probe says so with this marker and stays in the parallel unit project.
const NO_FFMPEG_MARKER = '@no-ffmpeg';
const STARTS_FFMPEG =
  /\b(bootHarness|generateSources|generateLongSource|generateSubtitleSources|generateHdrBitmapSource)\b|\b(?:run|execFile)\(\s*'(?:ffmpeg|ffprobe)'/;

describe('GPU test grouping', () => {
  it('keeps every test that starts ffmpeg in the sequential gpu project', () => {
    const offenders = listTests(path.join(serverRoot, 'test'))
      .map((file) => path.relative(serverRoot, file).replaceAll('\\', '/'))
      .filter((relative) => relative !== 'test/gpuGroups.test.ts' && !inGpuGroup(relative))
      .filter((relative) => {
        const source = readFileSync(path.join(serverRoot, relative), 'utf8');
        return STARTS_FFMPEG.test(source) && !source.includes(NO_FFMPEG_MARKER);
      });
    expect(offenders).toEqual([]);
  });

  it('lists only gpu globs that match existing test files', () => {
    const tests = listTests(path.join(serverRoot, 'test')).map((file) =>
      path.relative(serverRoot, file).replaceAll('\\', '/'),
    );
    for (const glob of GPU_TEST_GLOBS)
      expect(
        tests.some((t) => matchesGlob(glob, t)),
        glob,
      ).toBe(true);
  });
});

describe.skipIf(process.platform !== 'win32')('killChildProcesses', () => {
  it('kills matching children of this process and leaves the rest alone', async () => {
    const sleeper = () =>
      spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore', windowsHide: true });
    const victim = sleeper();
    const bystander = spawn('cmd.exe', ['/c', 'ping -n 60 127.0.0.1 > nul'], { stdio: 'ignore', windowsHide: true });
    try {
      const killed = killChildProcesses(['node.exe']);
      expect(killed).toContain(victim.pid);
      expect(killed).not.toContain(bystander.pid);
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(victim.exitCode !== null || victim.signalCode !== null).toBe(true);
      expect(bystander.exitCode).toBeNull();
    } finally {
      victim.kill();
      bystander.kill();
    }
  }, 30_000);
});
