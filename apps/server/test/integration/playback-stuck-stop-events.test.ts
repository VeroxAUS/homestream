// @no-ffmpeg: fake encoders and a stubbed probe; FFMPEG_PATH points nowhere, so no ffmpeg process can start.
// /api/logs reads the events table: every stop whose process survives the kill must show up there, once, and so must its late exit.
import { rmSync } from 'node:fs';
import path from 'node:path';
import type { LogEvent, LogsResponse } from '@homestream/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSecrets } from '../../src/redact.js';
import type { FakeEncoder } from '../playback/fakeEncoder.js';
import { bootRig, progressAt, until, writeSegments, type Rig } from '../playback/managerRig.js';

let rig: Rig;

afterEach(async () => {
  for (const encoder of rig.encoders.handles) encoder.exitNow();
  await rig.close();
  clearSecrets();
});

const handle = (index: number): FakeEncoder => rig.encoders.handles[index] as FakeEncoder;

async function stopEvents(level: 'error' | 'info'): Promise<LogEvent[]> {
  const res = await rig.harness.app.inject(`/api/logs?level=${level}`);
  expect(res.statusCode).toBe(200);
  return (res.json() as LogsResponse).events.filter((item) => item.source === 'ffmpeg' && item.details?.reason);
}

async function expectStuckOnce(sessionId: string, reason: string): Promise<void> {
  const stuck = (await stopEvents('error')).filter((item) => item.details?.reason === reason);
  expect(stuck).toHaveLength(1);
  const [item] = stuck as [LogEvent];
  expect(item.sessionId).toBe(sessionId);
  expect(Object.keys(item.details ?? {}).sort()).toEqual(['elapsedMs', 'reason']);
  expect(`${JSON.stringify(item)}`.replace(sessionId, '')).not.toMatch(/https?:|[\\/]|pid/i);
  expect((await stopEvents('info')).filter((late) => late.details?.reason === reason)).toHaveLength(0);
}

async function exitLate(index: number, sessionId: string, reason: string): Promise<void> {
  handle(index).exitNow();
  await handle(index).exited;
  await until(
    () =>
      rig.harness.db
        .prepare("SELECT 1 FROM events WHERE level = 'info' AND session_id = ? AND details_json LIKE ?")
        .all(sessionId, `%${reason}%`).length > 0,
  );
  const late = (await stopEvents('info')).filter((item) => item.details?.reason === reason);
  expect(late).toHaveLength(1);
  expect(late[0]).toMatchObject({ sessionId, details: { reason } });
  expect((await stopEvents('error')).filter((item) => item.details?.reason === reason)).toHaveLength(1);
}

describe('a stop whose encoder survives the kill is visible in /api/logs', () => {
  it('records DELETE once and its late exit', async () => {
    rig = await bootRig();
    const session = await rig.start();
    handle(0).surviveKill();

    await rig.playback.stop(session.sessionId);

    await expectStuckOnce(session.sessionId, 'stopped');
    await exitLate(0, session.sessionId, 'stopped');
  });

  it('records a refused seek once however often it is repeated, and its late exit', async () => {
    rig = await bootRig();
    const session = await rig.start();
    handle(0).surviveKill();

    for (let round = 0; round < 2; round += 1) {
      expect((await rig.harness.app.inject(`/hls/${session.sessionId}/seg-60.m4s`)).statusCode).toBe(503);
    }

    await expectStuckOnce(session.sessionId, 'seek');
    await exitLate(0, session.sessionId, 'seek');
  });

  it('records an abandoned start once and its late exit', async () => {
    rig = await bootRig({ playback: { firstSegmentWaitMs: 300 } });
    rig.encoders.mode = 'hang';
    const failing = rig.start().catch((reason: unknown) => reason);
    await until(() => rig.encoders.handles.length === 1);
    handle(0).surviveKill();
    await failing;

    const [item] = (await stopEvents('error')).filter((entry) => entry.details?.reason === 'abandon') as [LogEvent];
    expect(item).toBeDefined();
    await expectStuckOnce(item.sessionId as string, 'abandon');
    await exitLate(0, item.sessionId as string, 'abandon');
  });

  it('records a memory-limit stop once and its late exit', async () => {
    rig = await bootRig();
    const session = await rig.start();
    handle(0).surviveKill();

    rig.spawned[0]?.onMemoryLimit?.({ pid: 4242, rssBytes: 3 * 1024 ** 3, limitBytes: 2 * 1024 ** 3 });
    await vi.waitFor(async () => expect(await stopEvents('error')).toHaveLength(1), { timeout: 8_000 });

    await expectStuckOnce(session.sessionId, 'memory');
    await exitLate(0, session.sessionId, 'memory');
  });

  it('records a disk-cap park once even when the park repeats, and its late exit', async () => {
    rig = await bootRig({ env: { TRANSCODE_MAX_GB: '0.00001' }, playback: { monitorTickMs: 0 } });
    const session = await rig.start();
    const dir = rig.dir(session.sessionId);
    rig.spawned[0]?.onProgress(progressAt(48));
    writeSegments(dir, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 1_000);
    handle(0).surviveKill();

    await rig.playback.monitorTick();
    for (const index of [1, 2, 3, 4, 5, 6, 7, 8]) rmSync(path.join(dir, `seg-${index}.m4s`));
    await rig.playback.monitorTick();

    await expectStuckOnce(session.sessionId, 'park');
    await exitLate(0, session.sessionId, 'park');
  });
});
