// @no-ffmpeg: fake encoders and a stubbed probe; FFMPEG_PATH points nowhere, so no ffmpeg process can start.
// An encoder the kill could not remove keeps its place and blocks every replacement until its exit arrives.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSilentLogger } from '../../src/logger.js';
import { clearSecrets } from '../../src/redact.js';
import type { FakeEncoder } from '../playback/fakeEncoder.js';
import { PROFILES } from '../playback/harness.js';
import { bootRig, startNumberOf, until, type Rig } from '../playback/managerRig.js';

let rig: Rig;

afterEach(async () => {
  for (const encoder of rig.encoders.handles) encoder.exitNow();
  await rig.close();
  clearSecrets();
});

const handle = (index: number): FakeEncoder => rig.encoders.handles[index] as FakeEncoder;
const settle = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));
const get = (id: string, file: string) => rig.harness.app.inject(`/hls/${id}/${file}`);

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

/** Lets the stuck process exit and the exit handlers run. */
async function exitLate(index: number): Promise<void> {
  handle(index).exitNow();
  await handle(index).exited;
  await settle(20);
}

describe('an encoder that survives the kill', () => {
  it('keeps the slot of a deleted session until it exits, and logs the session only', async () => {
    const logger = createSilentLogger();
    const error = vi.spyOn(logger, 'error');
    rig = await bootRig({ logger });
    const first = await rig.start();
    await rig.start('desktop');
    handle(0).surviveKill();

    await rig.playback.stop(first.sessionId);

    expect(rig.playback.has(first.sessionId)).toBe(false);
    expect(handle(0).running).toBe(true);
    const blocked = await post();
    expect(blocked.statusCode).toBe(429);
    expect(rig.spawned).toHaveLength(2);
    expect(error).toHaveBeenCalledTimes(1);
    const [fields, message] = error.mock.calls[0] as [Record<string, unknown>, string];
    expect(fields).toEqual({ sessionId: first.sessionId, reason: 'stopped' });
    expect(`${JSON.stringify(fields)} ${message}`).not.toMatch(/https?:|[\\/]|pid/i);

    await exitLate(0);
    expect((await post()).statusCode).toBe(201);
    expect(rig.spawned).toHaveLength(3);
  });

  it('keeps the slot of an abandoned start until the encoder exits', async () => {
    rig = await bootRig({ playback: { firstSegmentWaitMs: 300 } });
    await rig.start();
    rig.encoders.mode = 'hang';
    const failing = rig.start('desktop').catch((reason: unknown) => reason);
    await until(() => rig.encoders.handles.length === 2);
    handle(1).surviveKill();

    await failing;

    expect(handle(1).running).toBe(true);
    expect((await post()).statusCode).toBe(429);
    expect(rig.spawned).toHaveLength(2);

    await exitLate(1);
    rig.encoders.mode = 'run';
    expect((await post()).statusCode).toBe(201);
  });

  it('does not start the encoder of a seek and answers with a hint; the next request proceeds after the exit', async () => {
    const logger = createSilentLogger();
    const error = vi.spyOn(logger, 'error');
    rig = await bootRig({ logger });
    const session = await rig.start();
    await rig.start('desktop');
    handle(0).surviveKill();

    const res = await get(session.sessionId, 'seg-60.m4s');

    expect(res.statusCode).toBe(503);
    const body = res.json() as { error: { code: string; hint?: string } };
    expect(body.error.code).toBe('encoder_not_stopped');
    expect(body.error.hint).toBeTruthy();
    expect(rig.spawned).toHaveLength(2);
    expect(rig.playback.has(session.sessionId)).toBe(true);
    expect((await post()).statusCode).toBe(429);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: session.sessionId, reason: 'seek' }),
      expect.any(String),
    );

    await exitLate(0);
    expect((await get(session.sessionId, 'seg-60.m4s')).statusCode).toBe(200);
    expect(rig.spawned.map(startNumberOf)).toEqual([0, 0, 60]);
  });

  it('refuses a track switch without applying it, and applies it once the encoder exited', async () => {
    rig = await bootRig();
    const session = await rig.start();
    handle(0).surviveKill();

    await expect(rig.playback.patch(session.sessionId, { audioIndex: 2 })).rejects.toMatchObject({
      statusCode: 503,
      code: 'encoder_not_stopped',
    });
    expect(rig.spawned).toHaveLength(1);

    await exitLate(0);
    await rig.playback.patch(session.sessionId, { audioIndex: 2 });
    expect(rig.spawned).toHaveLength(2);
  });

  it('lets DELETE end a session whose seek was refused, and still holds the place', async () => {
    rig = await bootRig();
    const session = await rig.start();
    await rig.start('desktop');
    handle(0).surviveKill();
    expect((await get(session.sessionId, 'seg-60.m4s')).statusCode).toBe(503);

    await rig.playback.stop(session.sessionId);

    expect(rig.playback.has(session.sessionId)).toBe(false);
    expect((await post()).statusCode).toBe(429);
    await exitLate(0);
    expect((await post()).statusCode).toBe(201);
  });
});
