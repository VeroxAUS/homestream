// Runs `node` children in place of ffmpeg: no ffmpeg process starts and the GPU is not touched.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_STOP_GRACE_MS, DISCARD_GRACE_MS, EncoderProcess } from '../../src/playback/encoderProcess.js';

const started: EncoderProcess[] = [];

afterEach(async () => {
  await Promise.all(started.splice(0).map((proc) => proc.stop({ graceMs: 0 })));
});

function spawnNode(script: string): EncoderProcess {
  const proc = new EncoderProcess({
    ffmpegPath: process.execPath,
    args: ['-e', script],
    cwd: process.cwd(),
    onProgress: () => undefined,
  });
  started.push(proc);
  return proc;
}

/** Quits with code 0 when it reads `q`, like ffmpeg does. */
const QUITS_ON_Q = `process.stdin.on('data', (d) => { if (String(d).includes('q')) process.exit(0); }); setInterval(() => {}, 1000); console.log('ready');`;
/** Ignores stdin completely, like an ffmpeg that is stuck. */
const IGNORES_Q = `process.stdin.resume(); setInterval(() => {}, 1000); console.log('ready');`;

/** The class exposes no readiness signal, so give node time to install its stdin handler. */
const whenReady = (_proc: EncoderProcess): Promise<void> => new Promise((resolve) => setTimeout(resolve, 800));

describe('EncoderProcess.stop', () => {
  it('asks politely with q by default and waits for the clean exit', async () => {
    const proc = spawnNode(QUITS_ON_Q);
    await whenReady(proc);

    await proc.stop();

    expect((await proc.exited).code).toBe(0);
    expect(DEFAULT_STOP_GRACE_MS).toBe(3000);
  });

  it('kills at once with no grace and does not send q', async () => {
    const proc = spawnNode(QUITS_ON_Q);
    await whenReady(proc);

    await proc.stop({ graceMs: 0 });

    const exit = await proc.exited;
    expect(proc.running).toBe(false);
    expect(exit.code).not.toBe(0);
  });

  it('kills a process that ignores q well before the default grace would end', async () => {
    const proc = spawnNode(IGNORES_Q);
    await whenReady(proc);
    const startedAt = Date.now();

    await proc.stop({ graceMs: 0 });

    expect(proc.running).toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(DEFAULT_STOP_GRACE_MS - 500);
  });

  it('uses the grace it is given before it kills', async () => {
    const proc = spawnNode(IGNORES_Q);
    await whenReady(proc);
    const startedAt = Date.now();

    await proc.stop({ graceMs: 600 });

    expect(proc.running).toBe(false);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(550);
  });

  it('returns at once when the process already exited', async () => {
    const proc = spawnNode('process.exit(0)');
    await proc.exited;

    await expect(proc.stop({ graceMs: 0 })).resolves.toBeUndefined();
  });
});

describe('EncoderProcess discard stop', () => {
  it('uses a one second grace', () => {
    expect(DISCARD_GRACE_MS).toBe(1000);
  });

  it('cuts the input, then lets a process that honours q exit without a kill', async () => {
    const proc = spawnNode(QUITS_ON_Q);
    await whenReady(proc);
    const cutInput = vi.fn();
    const startedAt = Date.now();

    await proc.stop({ graceMs: DISCARD_GRACE_MS, cutInput });

    const exit = await proc.exited;
    expect(cutInput).toHaveBeenCalledTimes(1);
    expect(exit.code).toBe(0);
    expect(exit.killed).toBeFalsy();
    expect(Date.now() - startedAt).toBeLessThan(DISCARD_GRACE_MS);
  });

  it('kills a process that ignores q once the one second grace has passed, not earlier', async () => {
    const proc = spawnNode(IGNORES_Q);
    await whenReady(proc);
    const cutInput = vi.fn();
    const startedAt = Date.now();

    await proc.stop({ graceMs: DISCARD_GRACE_MS, cutInput });

    const elapsed = Date.now() - startedAt;
    const exit = await proc.exited;
    expect(cutInput).toHaveBeenCalledTimes(1);
    expect(exit.killed).toBe(true);
    expect(proc.running).toBe(false);
    expect(elapsed).toBeGreaterThanOrEqual(DISCARD_GRACE_MS - 50);
    expect(elapsed).toBeLessThan(DEFAULT_STOP_GRACE_MS);
  });

  it('still stops when cutting the input throws', async () => {
    const proc = spawnNode(QUITS_ON_Q);
    await whenReady(proc);

    await proc.stop({
      graceMs: DISCARD_GRACE_MS,
      cutInput: () => {
        throw new Error('proxy gone');
      },
    });

    expect((await proc.exited).code).toBe(0);
  });

  it('does not cut the input of a process that already exited', async () => {
    const proc = spawnNode('process.exit(0)');
    await proc.exited;
    const cutInput = vi.fn();

    await proc.stop({ graceMs: DISCARD_GRACE_MS, cutInput });

    expect(cutInput).not.toHaveBeenCalled();
  });
});
