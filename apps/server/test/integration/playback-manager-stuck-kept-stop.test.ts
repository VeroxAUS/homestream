// @no-ffmpeg: fake encoders and a stubbed probe; FFMPEG_PATH points nowhere, so no ffmpeg process can start.
// A memory-watchdog stop or a disk-cap park whose process survives the kill is logged and keeps its place until it exits.
import { rmSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSilentLogger } from '../../src/logger.js';
import { clearSecrets } from '../../src/redact.js';
import type { FakeEncoder } from '../playback/fakeEncoder.js';
import { PROFILES } from '../playback/harness.js';
import { bootRig, progressAt, writeSegments, type Rig } from '../playback/managerRig.js';

let rig: Rig;

afterEach(async () => {
  for (const encoder of rig.encoders.handles) encoder.exitNow();
  await rig.close();
  clearSecrets();
});

const HIT = { pid: 4242, rssBytes: 3 * 1024 ** 3, limitBytes: 2 * 1024 ** 3 };
const STOP_MS = 3_000;
const handle = (index: number): FakeEncoder => rig.encoders.handles[index] as FakeEncoder;

function post() {
  return rig.harness.app.inject({
    method: 'POST',
    url: '/api/sessions',
    payload: {
      mediaType: 'movie',
      tmdbId: 278,
      streamId: rig.harness.streamIds.movie,
      device: PROFILES.emulator,
      subtitle: null,
    },
  });
}

function spyLogger() {
  const logger = createSilentLogger();
  return { logger, error: vi.spyOn(logger, 'error'), info: vi.spyOn(logger, 'info') };
}

type Call = [Record<string, unknown>, string];
const callsFor = (calls: unknown[][], reason: string): Call[] =>
  (calls as Call[]).filter(([fields]) => fields.reason === reason);

describe('a memory-limit stop whose encoder survives the kill', () => {
  it('logs one error with the session and reason only, holds the place, and frees it at the late exit', async () => {
    const { logger, error, info } = spyLogger();
    rig = await bootRig({ logger });
    const session = await rig.start();
    await rig.start('desktop');
    handle(0).surviveKill();

    rig.spawned[0]?.onMemoryLimit?.(HIT);
    await vi.waitFor(() => expect(callsFor(error.mock.calls, 'memory')).toHaveLength(1), { timeout: STOP_MS * 2 });

    expect(handle(0).running).toBe(true);
    const stuck = callsFor(error.mock.calls, 'memory');
    expect(stuck).toHaveLength(1);
    const [fields, message] = stuck[0] as Call;
    expect(Object.keys(fields).sort()).toEqual(['elapsedMs', 'reason', 'sessionId']);
    expect(fields.sessionId).toBe(session.sessionId);
    expect(`${JSON.stringify(fields)} ${message}`).not.toMatch(/https?:|[\\/]|pid/i);
    expect(callsFor(info.mock.calls, 'memory')).toHaveLength(0);
    expect((await post()).statusCode).toBe(429);
    expect(rig.spawned).toHaveLength(2);

    handle(0).exitNow();
    await handle(0).exited;
    await new Promise((resolve) => setImmediate(resolve));

    expect(callsFor(info.mock.calls, 'memory')).toHaveLength(1);
    expect(callsFor(error.mock.calls, 'memory')).toHaveLength(1);
    expect((await post()).statusCode).toBe(201);
    expect(rig.spawned).toHaveLength(3);
  });

  it('logs nothing about a stuck process when the encoder exits in the stop', async () => {
    const { logger, error } = spyLogger();
    rig = await bootRig({ logger });
    await rig.start();

    rig.spawned[0]?.onMemoryLimit?.(HIT);
    await vi.waitFor(() => expect(handle(0).running).toBe(false));

    expect(callsFor(error.mock.calls, 'memory')).toHaveLength(0);
  });
});

describe('a disk-cap park whose encoder survives the kill', () => {
  // 1e-5 GB is about 10.7 kB: ten 1 kB segments are above the 80 % park level.
  const CAP = { TRANSCODE_MAX_GB: '0.00001' };

  it('logs one error with the session and reason only, starts no encoder, and resumes normally after the exit', async () => {
    const { logger, error, info } = spyLogger();
    rig = await bootRig({ logger, env: CAP, playback: { monitorTickMs: 0 } });
    const session = await rig.start();
    const dir = rig.dir(session.sessionId);
    rig.spawned[0]?.onProgress(progressAt(48));
    writeSegments(dir, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 1_000);
    handle(0).surviveKill();

    const tick = rig.playback.monitorTick();
    await tick;

    expect(handle(0).running).toBe(true);
    const stuck = callsFor(error.mock.calls, 'park');
    expect(stuck).toHaveLength(1);
    const [fields, message] = stuck[0] as Call;
    expect(Object.keys(fields).sort()).toEqual(['elapsedMs', 'reason', 'sessionId']);
    expect(fields.sessionId).toBe(session.sessionId);
    expect(`${JSON.stringify(fields)} ${message}`).not.toMatch(/https?:|[\\/]|pid/i);
    expect(callsFor(info.mock.calls, 'park')).toHaveLength(0);

    for (const index of [1, 2, 3, 4, 5, 6, 7, 8]) rmSync(path.join(dir, `seg-${index}.m4s`));
    const again = rig.playback.monitorTick();
    await again;

    expect(rig.spawned).toHaveLength(1);
    expect(callsFor(error.mock.calls, 'park')).toHaveLength(1);

    handle(0).exitNow();
    await handle(0).exited;
    await new Promise((resolve) => setImmediate(resolve));
    expect(callsFor(info.mock.calls, 'park')).toHaveLength(1);

    await rig.playback.monitorTick();
    await vi.waitFor(() => expect(rig.spawned).toHaveLength(2));
  });
});
