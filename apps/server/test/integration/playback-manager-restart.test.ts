// @no-ffmpeg: fake encoders and a stubbed probe; FFMPEG_PATH points nowhere, so no ffmpeg process can start.
// How long each path waits for the previous encoder, and that every restart still waits for its exit.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSilentLogger } from '../../src/logger.js';
import type { PlaybackContext } from '../../src/playback/context.js';
import { DEFAULT_STOP_GRACE_MS, DISCARD_GRACE_MS, type StopOptions } from '../../src/playback/encoderProcess.js';
import { clearSecrets } from '../../src/redact.js';
import type { FakeEncoder } from '../playback/fakeEncoder.js';
import { PROFILES } from '../playback/harness.js';
import { bootRig, probeOf, startNumberOf, TEXT_TRACK, until, type Rig } from '../playback/managerRig.js';

let rig: Rig;

afterEach(async () => {
  await rig.close();
  clearSecrets();
});

const BITMAP_TRACK = { ...TEXT_TRACK, index: 4, codec: 'hdmv_pgs_subtitle', kind: 'bitmap' as const };
const get = (id: string, file: string) => rig.harness.app.inject(`/hls/${id}/${file}`);
const handle = (index: number): FakeEncoder => rig.encoders.handles[index] as FakeEncoder;
const settle = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

/** The grace a stop() call allows, as the encoder would apply it. */
const graceOf = (call: StopOptions | undefined): number => call?.graceMs ?? DEFAULT_STOP_GRACE_MS;

/** Makes the next re-resolution of a session's stream link wait until `resolve()`. */
function deferRefresh(sessionId: string): { readonly called: boolean; resolve(): void } {
  const { ctx } = rig.playback as unknown as { ctx: PlaybackContext };
  const { source } = ctx.slots.require(sessionId);
  const state = { called: false, resolve: (): void => undefined };
  source.refresh = () =>
    new Promise<void>((resolve) => {
      state.called = true;
      state.resolve = resolve;
    });
  return state;
}

/** Counts the calls that cut a session's encoder input at the source proxy. */
function spyOnCut(sessionId: string): ReturnType<typeof vi.fn> {
  const { ctx } = rig.playback as unknown as { ctx: PlaybackContext };
  const { source } = ctx.slots.require(sessionId);
  const original = source.cutEncoderInput.bind(source);
  const spy = vi.fn(original);
  source.cutEncoderInput = spy;
  return spy;
}

describe('stopping the previous encoder when its output is thrown away', () => {
  it('cuts its input, asks it to quit and allows the discard grace on an audio switch', async () => {
    rig = await bootRig();
    const session = await rig.start();
    const cut = spyOnCut(session.sessionId);

    await rig.playback.patch(session.sessionId, { audioIndex: 2 });

    expect(handle(0).stopCalls.map(graceOf)).toEqual([DISCARD_GRACE_MS]);
    expect(handle(0).order).toEqual(['cut', 'q']);
    expect(cut).toHaveBeenCalledTimes(1);
  });

  it('does the same when burn-in is switched on and off', async () => {
    rig = await bootRig({ probe: probeOf({ subtitles: [BITMAP_TRACK] }) });
    const session = await rig.start();

    await rig.playback.patch(session.sessionId, { subtitle: { index: 4, mode: 'burn' } });
    await rig.playback.patch(session.sessionId, { subtitle: null });

    expect(handle(0).stopCalls.map(graceOf)).toEqual([DISCARD_GRACE_MS]);
    expect(handle(1).stopCalls.map(graceOf)).toEqual([DISCARD_GRACE_MS]);
    expect([handle(0).order, handle(1).order]).toEqual([
      ['cut', 'q'],
      ['cut', 'q'],
    ]);
    expect(rig.spawned).toHaveLength(3);
  });

  it('does the same on a seek restart, forward and backward', async () => {
    rig = await bootRig();
    const session = await rig.start();

    expect((await get(session.sessionId, 'seg-60.m4s')).statusCode).toBe(200);
    expect((await get(session.sessionId, 'seg-10.m4s')).statusCode).toBe(200);

    expect(rig.spawned.map(startNumberOf)).toEqual([0, 60, 10]);
    expect(handle(0).stopCalls.map(graceOf)).toEqual([DISCARD_GRACE_MS]);
    expect(handle(1).stopCalls.map(graceOf)).toEqual([DISCARD_GRACE_MS]);
    expect([handle(0).order, handle(1).order]).toEqual([
      ['cut', 'q'],
      ['cut', 'q'],
    ]);
  });

  it('kills an encoder that ignores q only after the discard grace, and starts the next one after that', async () => {
    rig = await bootRig();
    const session = await rig.start();
    handle(0).ignoreQ();
    const startedAt = Date.now();

    const request = get(session.sessionId, 'seg-60.m4s');
    await until(() => handle(0).stopCalls.length === 1);
    await settle(DISCARD_GRACE_MS / 2);
    expect(handle(0).running).toBe(true);
    expect(rig.spawned).toHaveLength(1);

    expect((await request).statusCode).toBe(200);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(DISCARD_GRACE_MS - 50);
    expect(handle(0).order).toEqual(['cut', 'q', 'kill']);
    expect(handle(0).killedAfterMs).toEqual([DISCARD_GRACE_MS]);
    expect(rig.spawned.map(startNumberOf)).toEqual([0, 60]);
    expect(rig.encoders.handles.filter((encoder) => encoder.running)).toHaveLength(1);
  });

  it('logs at info level how each discard stop ended, with the elapsed time', async () => {
    const logger = createSilentLogger();
    const info = vi.spyOn(logger, 'info');
    rig = await bootRig({ logger });
    const session = await rig.start();
    handle(0).ignoreQ();

    expect((await get(session.sessionId, 'seg-60.m4s')).statusCode).toBe(200);
    await rig.playback.patch(session.sessionId, { audioIndex: 2 });

    const discards = info.mock.calls
      .map(([fields]) => fields as { reason?: string; outcome?: string; elapsedMs?: number })
      .filter((fields) => fields.reason !== undefined);
    expect(discards).toEqual([
      expect.objectContaining({ sessionId: session.sessionId, reason: 'seek', outcome: 'killed' }),
      expect.objectContaining({ sessionId: session.sessionId, reason: 'tracks', outcome: 'clean' }),
    ]);
    expect(discards[0]?.elapsedMs).toBeGreaterThanOrEqual(DISCARD_GRACE_MS - 50);
    expect(discards[1]?.elapsedMs).toBeLessThan(DISCARD_GRACE_MS);
  });

  it('cuts the input of an abandoned start, asks it to quit and holds the slot until it exited', async () => {
    rig = await bootRig({ playback: { firstSegmentWaitMs: 300 } });
    await rig.start();
    rig.encoders.mode = 'hang';
    const failing = rig.start('desktop').catch((error: unknown) => error);
    await until(() => rig.encoders.handles.length === 2);
    const release = handle(1).holdStop();

    await until(() => handle(1).stopCalls.length === 1);
    await settle();

    expect(handle(1).stopCalls.map(graceOf)).toEqual([DISCARD_GRACE_MS]);
    expect(handle(1).order).toEqual(['cut', 'q']);
    expect(handle(1).running).toBe(true);
    const third = await rig.harness.app.inject({
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
    expect(third.statusCode).toBe(429);
    expect(rig.spawned).toHaveLength(2);
    release();
    await failing;
    expect(handle(1).running).toBe(false);
  });

  it('cuts the input of an abandoned start and kills a stuck encoder only after the discard grace', async () => {
    rig = await bootRig({ playback: { firstSegmentWaitMs: 300 } });
    rig.encoders.mode = 'hang';
    const failing = rig.start().catch((error: unknown) => error);
    await until(() => rig.encoders.handles.length === 1);
    handle(0).ignoreQ();

    await failing;

    expect(handle(0).order).toEqual(['cut', 'q', 'kill']);
    expect(handle(0).killedAfterMs).toEqual([DISCARD_GRACE_MS]);
  });

  it('keeps the graceful stop for DELETE', async () => {
    rig = await bootRig();
    const session = await rig.start();

    await rig.playback.stop(session.sessionId);

    expect(handle(0).stopCalls.map(graceOf)).toEqual([DEFAULT_STOP_GRACE_MS]);
  });

  it('keeps the graceful stop for shutdown', async () => {
    rig = await bootRig();
    await rig.start();
    await rig.start('desktop');

    await rig.playback.stopAll();

    expect([handle(0), handle(1)].map((encoder) => encoder.stopCalls.map(graceOf))).toEqual([
      [DEFAULT_STOP_GRACE_MS],
      [DEFAULT_STOP_GRACE_MS],
    ]);
  });

  it('keeps the graceful stop when the encoder is parked with its files kept', async () => {
    rig = await bootRig();
    const session = await rig.start();
    const { ctx } = rig.playback as unknown as { ctx: PlaybackContext };

    const { encoder } = rig.playback as unknown as { encoder: { park(rec: unknown): Promise<void> } };
    await encoder.park(ctx.slots.require(session.sessionId));

    expect(handle(0).stopCalls.map(graceOf)).toEqual([DEFAULT_STOP_GRACE_MS]);
  });
});

describe('a restart still waits for the previous encoder to exit', () => {
  it('launches the replacement of an audio switch only after the old encoder exited', async () => {
    rig = await bootRig();
    const session = await rig.start();
    const release = handle(0).holdStop();

    const patching = rig.playback.patch(session.sessionId, { audioIndex: 2 });
    await until(() => handle(0).stopCalls.length === 1);
    await settle();

    expect(handle(0).running).toBe(true);
    expect(rig.spawned).toHaveLength(1);
    release();
    await patching;
    expect(handle(0).running).toBe(false);
    expect(rig.spawned).toHaveLength(2);
  });

  it('launches the replacement of a seek only after the old encoder exited', async () => {
    rig = await bootRig();
    const session = await rig.start();
    const release = handle(0).holdStop();

    const request = get(session.sessionId, 'seg-60.m4s');
    await until(() => handle(0).stopCalls.length === 1);
    await settle();

    expect(handle(0).running).toBe(true);
    expect(rig.spawned).toHaveLength(1);
    release();
    expect((await request).statusCode).toBe(200);
    expect(rig.spawned.map(startNumberOf)).toEqual([0, 60]);
  });

  it('keeps the slot of a session taken while a restart waits for the old encoder', async () => {
    rig = await bootRig();
    const session = await rig.start();
    await rig.start('desktop');
    const release = handle(0).holdStop();

    const patching = rig.playback.patch(session.sessionId, { audioIndex: 2 });
    await until(() => handle(0).stopCalls.length === 1);

    expect(rig.playback.has(session.sessionId)).toBe(true);
    const third = await rig.harness.app.inject({
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
    expect(third.statusCode).toBe(429);
    expect(rig.spawned).toHaveLength(2);
    release();
    await patching;
  });

  it('lets DELETE wait for an old encoder that is still exiting from a restart', async () => {
    rig = await bootRig();
    const session = await rig.start();
    const release = handle(0).holdStop();
    const patching = rig.playback.patch(session.sessionId, { audioIndex: 2 }).catch(() => undefined);
    await until(() => handle(0).stopCalls.length === 1);

    let deleted = false;
    const deleting = rig.playback.stop(session.sessionId).then(() => {
      deleted = true;
    });
    await settle(100);
    expect(deleted).toBe(false);

    release();
    await Promise.all([patching, deleting]);
    expect(rig.encoders.handles.filter((encoder) => encoder.running)).toEqual([]);
  });
});

describe('stopping a session whose encoder retry waits for a fresh stream link', () => {
  async function crashIntoRetry(): Promise<{ id: string; refresh: ReturnType<typeof deferRefresh> }> {
    const session = await rig.start();
    const refresh = deferRefresh(session.sessionId);
    handle(0).crash();
    await until(() => refresh.called);
    return { id: session.sessionId, refresh };
  }

  it('lets DELETE finish without waiting for the refresh, and starts no encoder afterwards', async () => {
    rig = await bootRig();
    const { id, refresh } = await crashIntoRetry();

    const outcome = await Promise.race([
      rig.playback.stop(id).then(() => 'stopped' as const),
      new Promise<'waiting'>((resolve) => setTimeout(() => resolve('waiting'), 500)),
    ]);

    expect(outcome).toBe('stopped');
    expect(rig.playback.has(id)).toBe(false);
    refresh.resolve();
    await settle(100);
    expect(rig.spawned).toHaveLength(1);
  });

  it('lets shutdown finish without waiting for the refresh', async () => {
    rig = await bootRig();
    await crashIntoRetry();

    const outcome = await Promise.race([
      rig.playback.stopAll().then(() => 'stopped' as const),
      new Promise<'waiting'>((resolve) => setTimeout(() => resolve('waiting'), 500)),
    ]);

    expect(outcome).toBe('stopped');
    expect(rig.spawned).toHaveLength(1);
  });

  it('releases a request that waited for the retry once the session is stopped', async () => {
    rig = await bootRig();
    const { id } = await crashIntoRetry();
    const request = get(id, 'seg-60.m4s');
    await settle();

    await rig.playback.stop(id);
    const res = await request;

    expect(res.statusCode).toBe(404);
    expect(rig.spawned).toHaveLength(1);
  });
});
