// @no-ffmpeg: fake encoders and a stubbed probe; FFMPEG_PATH points nowhere, so no ffmpeg process can start.
// Characterizes how PlaybackManager reacts to encoder failures, the memory watchdog, the disk cap and subtitle requests.
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackContext } from '../../src/playback/context.js';
import { clearSecrets } from '../../src/redact.js';
import {
  bootRig,
  probeOf,
  progressAt,
  startNumberOf,
  TEXT_TRACK,
  until,
  writeSegments,
  type Rig,
} from '../playback/managerRig.js';

let rig: Rig;

afterEach(async () => {
  vi.useRealTimers();
  await rig.close();
  clearSecrets();
});

const events = () =>
  rig.harness.db.prepare('SELECT level, message FROM events').all() as Array<{ level: string; message: string }>;
const plays = () => rig.harness.db.prepare('SELECT status, error_message AS message FROM plays').all();
const get = (id: string, file: string) => rig.harness.app.inject(`/hls/${id}/${file}`);
const HIT = { pid: 4242, rssBytes: 3 * 1024 ** 3, limitBytes: 2 * 1024 ** 3 };

/** Makes the next re-resolution of a session's stream link wait until `resolve()`; a plain-file source otherwise refreshes at once. */
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

describe('encoder crash after the start', () => {
  it('retries once from just past the finished segments, then ends the session with an error', async () => {
    rig = await bootRig();
    const session = await rig.start();

    rig.encoders.handles[0]?.crash();
    await until(() => rig.spawned.length === 2);
    expect(startNumberOf(rig.spawned[1])).toBe(1);
    expect(rig.playback.get(session.sessionId).state).not.toBe('error');
    expect(events().some((e) => e.message.includes('retrying once with a fresh stream link'))).toBe(true);

    rig.encoders.handles[1]?.crash();
    await until(() => rig.playback.get(session.sessionId).state === 'error');

    expect(rig.spawned).toHaveLength(2);
    expect(rig.playback.activity()).toEqual([]);
    expect(plays()).toEqual([{ status: 'error', message: expect.stringContaining('stopped unexpectedly') }]);
    expect(events().filter((e) => e.level === 'error')).toHaveLength(1);
    const res = await get(session.sessionId, 'seg-80.m4s');
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: { code: 'encoder_failed' } });
  });

  it('keeps one encoder when a segment is requested while the retry waits for the fresh stream link', async () => {
    rig = await bootRig();
    const session = await rig.start();
    const refresh = deferRefresh(session.sessionId);

    rig.encoders.handles[0]?.crash();
    await until(() => refresh.called);
    const request = get(session.sessionId, 'seg-60.m4s');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(rig.spawned).toHaveLength(1);

    refresh.resolve();
    const res = await request;

    expect(res.statusCode).toBe(200);
    expect(rig.encoders.handles.filter((handle) => handle.running)).toHaveLength(1);
    expect(rig.spawned.map(startNumberOf)).toEqual([0, 1, 60]);
    await rig.playback.stop(session.sessionId);
    expect(rig.encoders.handles.filter((handle) => handle.running)).toEqual([]);
  });

  it('does not start the retry when the session is stopped while it waits for the fresh stream link', async () => {
    rig = await bootRig();
    const session = await rig.start();
    const refresh = deferRefresh(session.sessionId);
    rig.encoders.handles[0]?.crash();
    await until(() => refresh.called);

    const stopping = rig.playback.stop(session.sessionId);
    refresh.resolve();
    await stopping;
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(rig.spawned).toHaveLength(1);
    expect(rig.playback.has(session.sessionId)).toBe(false);
  });

  it('runs a track switch after the retry instead of next to it', async () => {
    rig = await bootRig();
    const session = await rig.start();
    const refresh = deferRefresh(session.sessionId);
    rig.encoders.handles[0]?.crash();
    await until(() => refresh.called);

    const patching = rig.playback.patch(session.sessionId, { audioIndex: 2 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(rig.spawned).toHaveLength(1);
    refresh.resolve();
    await patching;

    expect(rig.encoders.handles.filter((handle) => handle.running)).toHaveLength(1);
    expect(rig.spawned).toHaveLength(3);
  });

  it('falls back from libplacebo to tonemap_opencl when the first run never produced a segment, for later sessions too', async () => {
    rig = await bootRig({ probe: probeOf({}, 'hdr10') });
    const session = await rig.start('desktop');
    expect(rig.spawned[0]?.args.join(' ')).toContain('libplacebo');
    rmSync(path.join(rig.dir(session.sessionId), 'seg-0.ts'), { force: true });

    rig.encoders.handles[0]?.crash();
    await until(() => rig.spawned.length === 2);
    expect(rig.spawned[1]?.args.join(' ')).toContain('tonemap_opencl');

    await rig.playback.stop(session.sessionId);
    await rig.start('desktop');
    expect(rig.spawned[2]?.args.join(' ')).toContain('tonemap_opencl');
  });
});

describe('memory watchdog', () => {
  it('ends the session with encoder_memory_limit and refuses track switches', async () => {
    rig = await bootRig();
    const session = await rig.start();

    rig.spawned[0]?.onMemoryLimit?.(HIT);

    expect(rig.playback.get(session.sessionId)).toMatchObject({
      state: 'error',
      error: { message: expect.any(String) },
    });
    await until(() => !rig.encoders.handles[0]?.running);
    expect(plays()).toEqual([{ status: 'error', message: expect.stringContaining('The video encoder') }]);
    expect(events().find((e) => e.level === 'error')?.message).toContain('The video encoder');
    expect((await get(session.sessionId, 'seg-50.m4s')).json()).toMatchObject({
      error: { code: 'encoder_memory_limit' },
    });
    await expect(rig.playback.patch(session.sessionId, { audioIndex: 2 })).rejects.toMatchObject({
      statusCode: 409,
      code: 'session_failed',
    });

    await rig.playback.stop(session.sessionId);
    expect(rig.playback.has(session.sessionId)).toBe(false);
    expect(plays()).toHaveLength(1);
  });
});

describe('transcode disk cap', () => {
  // 1e-5 GB is about 10.7 kB: ten 1 kB segments are above the 80 % park level.
  const CAP = { TRANSCODE_MAX_GB: '0.00001' };

  it('parks an encoder that is far ahead and resumes it once space is free', async () => {
    rig = await bootRig({ env: CAP, playback: { monitorTickMs: 0 } });
    const session = await rig.start();
    const dir = rig.dir(session.sessionId);
    rig.spawned[0]?.onProgress(progressAt(48));
    writeSegments(dir, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 1_000);

    await rig.playback.monitorTick();
    expect(rig.encoders.handles[0]?.running).toBe(false);
    expect(rig.spawned).toHaveLength(1);

    for (const index of [1, 2, 3, 4, 5, 6, 7, 8]) rmSync(path.join(dir, `seg-${index}.m4s`));
    await rig.playback.monitorTick();

    await until(() => rig.spawned.length === 2);
    expect(startNumberOf(rig.spawned[1])).toBeGreaterThan(0);
  });

  it('stops a session that has been idle when the cap is exceeded and another one plays', async () => {
    rig = await bootRig({ env: CAP, playback: { monitorTickMs: 0, idleTimeoutMs: 3_600_000 } });
    const idle = await rig.start();
    const active = await rig.start();
    writeSegments(rig.dir(idle.sessionId), [1, 2, 3, 4, 5, 6], 1_000);
    writeSegments(rig.dir(active.sessionId), [1, 2, 3, 4, 5, 6], 1_000);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 60_000);
    rig.playback.ping(active.sessionId, { positionSec: 0 });

    await rig.playback.monitorTick();

    expect(rig.playback.has(idle.sessionId)).toBe(false);
    expect(rig.playback.has(active.sessionId)).toBe(true);
    expect(events().some((e) => e.message.includes('stopped to stay within the transcode disk limit'))).toBe(true);
  });
});

describe('idle sessions and orphans', () => {
  it('stops a session without activity and reports the idle time', async () => {
    rig = await bootRig({ playback: { monitorTickMs: 0, idleTimeoutMs: 50 } });
    const session = await rig.start();
    await new Promise((resolve) => setTimeout(resolve, 80));

    await rig.playback.monitorTick();

    expect(rig.playback.has(session.sessionId)).toBe(false);
    expect(events().some((e) => e.message.startsWith('Playback stopped after'))).toBe(true);
  });

  it('wipes stale session folders left by a crashed run', async () => {
    rig = await bootRig();
    const stale = path.join(rig.harness.transcodeDir, 'stale-session');
    mkdirSync(stale, { recursive: true });

    await rig.playback.recoverOrphans();

    expect(events().some((e) => e.message.includes('removed 1 stale session folder'))).toBe(true);
    expect(existsSync(stale)).toBe(false);
  });
});

describe('subtitle requests', () => {
  const withText = () => bootRig({ probe: probeOf({ subtitles: [TEXT_TRACK] }) });

  it('serves the rendition playlist and reports a failed extraction as an empty segment with a status header', async () => {
    rig = await withText();
    const session = await rig.start();
    const base = `subs/${TEXT_TRACK.index}`;

    const playlist = await get(session.sessionId, `${base}/index.m3u8`);
    expect(playlist.statusCode).toBe(200);
    expect(playlist.headers['content-type']).toContain('mpegurl');

    await until(() => rig.playback.get(session.sessionId).subtitleTracks[0]?.status === 'error');
    const segment = await get(session.sessionId, `${base}/seg-0.vtt`);
    expect(segment.statusCode).toBe(200);
    expect(segment.headers['x-subtitle-status']).toBe('failed');
    expect(segment.body).toContain('WEBVTT');
  });

  it('answers 404 for tracks and segments the session does not have, and while the full file is not complete', async () => {
    rig = await withText();
    const session = await rig.start();

    expect((await get(session.sessionId, 'subs/9/index.m3u8')).statusCode).toBe(404);
    expect((await get(session.sessionId, `subs/${TEXT_TRACK.index}/seg-9999.vtt`)).statusCode).toBe(404);
    const full = await get(session.sessionId, `subs/${TEXT_TRACK.index}.vtt`);
    expect(full.statusCode).toBe(404);
    expect(full.json()).toMatchObject({ error: { code: 'subtitle_not_ready' } });
  });
});
