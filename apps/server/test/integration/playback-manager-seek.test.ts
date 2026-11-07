// @no-ffmpeg: fake encoders and a stubbed probe; FFMPEG_PATH points nowhere, so no ffmpeg process can start.
// Characterizes how PlaybackManager restarts the encoder (track switch, seek) and serves HLS files.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { SessionResponse } from '@homestream/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { clearSecrets } from '../../src/redact.js';
import { bootRig, probeOf, progressAt, startNumberOf, TEXT_TRACK, until, type Rig } from '../playback/managerRig.js';

let rig: Rig;

afterEach(async () => {
  await rig.close();
  clearSecrets();
});

const get = (id: string, file: string) => rig.harness.app.inject(`/hls/${id}/${file}`);
const eventMessages = (): string[] =>
  (rig.harness.db.prepare('SELECT message FROM events').all() as Array<{ message: string }>).map((e) => e.message);

describe('track switch (PATCH)', () => {
  it('restarts the encoder at the player position and throws away the old output', async () => {
    rig = await bootRig();
    const session = await rig.start();
    await until(() => rig.segments(session.sessionId).includes('seg-0.m4s'));
    rig.playback.ping(session.sessionId, { positionSec: 100 });

    const patched = await rig.playback.patch(session.sessionId, { audioIndex: 2 });

    expect(patched.selectedAudioIndex).toBe(2);
    expect(rig.encoders.handles[0]?.running).toBe(false);
    expect(rig.spawned).toHaveLength(2);
    expect(startNumberOf(rig.spawned[1])).toBe(25);
    await until(() => rig.segments(session.sessionId).includes('seg-25.m4s'));
    expect(rig.segments(session.sessionId)).toEqual(['seg-25.m4s']);
    expect(eventMessages().some((m) => m.includes('restarting the encoder at segment 25'))).toBe(true);
  });

  it('records a text subtitle choice without touching the encoder', async () => {
    rig = await bootRig({ probe: probeOf({ subtitles: [TEXT_TRACK] }) });
    const session = await rig.start();

    const patched = await rig.playback.patch(session.sessionId, { subtitle: { index: 3, mode: 'sidecar' } });

    expect(patched.selectedSubtitle).toEqual({ index: 3, mode: 'sidecar' });
    expect(patched.subtitleDefault).toBeNull();
    expect(rig.spawned).toHaveLength(1);
    expect(rig.encoders.handles[0]?.running).toBe(true);
  });

  it('rejects an audio track the file does not have', async () => {
    rig = await bootRig();
    const session = await rig.start();
    await expect(rig.playback.patch(session.sessionId, { audioIndex: 9 })).rejects.toMatchObject({
      statusCode: 400,
      code: 'invalid_audio_index',
    });
    expect(rig.spawned).toHaveLength(1);
  });
});

describe('seeking', () => {
  it('restarts the encoder at a segment far ahead and serves it', async () => {
    rig = await bootRig();
    const session = await rig.start();

    const res = await get(session.sessionId, 'seg-60.m4s');

    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.toString()).toBe('segment');
    expect(rig.encoders.handles[0]?.running).toBe(false);
    expect(startNumberOf(rig.spawned[1])).toBe(60);
  });

  it('restarts the encoder for a segment before the start of the current run', async () => {
    rig = await bootRig();
    const session = await rig.start();
    expect((await get(session.sessionId, 'seg-60.m4s')).statusCode).toBe(200);

    expect((await get(session.sessionId, 'seg-10.m4s')).statusCode).toBe(200);

    expect(rig.spawned.map(startNumberOf)).toEqual([0, 60, 10]);
  });

  it('leaves the encoder alone for a segment it is about to produce, and times out when it never comes', async () => {
    rig = await bootRig({ playback: { segmentWaitMs: 300 } });
    const session = await rig.start();
    rig.spawned[0]?.onProgress(progressAt(20));

    const res = await get(session.sessionId, 'seg-7.m4s');

    expect(res.statusCode).toBe(504);
    expect(res.json()).toMatchObject({ error: { code: 'segment_timeout' } });
    expect(rig.spawned).toHaveLength(1);
    expect(rig.encoders.handles[0]?.running).toBe(true);
  });

  it('counts the media bytes it served in the play record', async () => {
    rig = await bootRig();
    const session = await rig.start();
    await get(session.sessionId, 'seg-0.m4s');
    await get(session.sessionId, 'seg-0.m4s');

    await rig.playback.stop(session.sessionId);

    expect(rig.harness.db.prepare('SELECT bytes_served AS n FROM plays').get()).toEqual({ n: 14 });
  });
});

describe('serving HLS files', () => {
  it('serves the playlists and refuses segments that cannot exist in this session', async () => {
    rig = await bootRig();
    const session = await rig.start();

    const media = await get(session.sessionId, 'video.m3u8');
    expect(media.statusCode).toBe(200);
    expect(media.body).toContain('#EXT-X-ENDLIST');
    expect((await get(session.sessionId, 'seg-5000.m4s')).statusCode).toBe(404);
    expect((await get(session.sessionId, 'seg-3.ts')).statusCode).toBe(404);
    expect((await get('00000000-0000-0000-0000-000000000000', 'seg-3.m4s')).statusCode).toBe(404);
  });

  it('serves init.mp4 as a copy taken after the encoder finished its first segment', async () => {
    rig = await bootRig();
    const session = await rig.start();
    writeFileSync(path.join(rig.dir(session.sessionId), 'init.mp4'), 'INIT');
    rig.spawned[0]?.onProgress(progressAt(12));

    const res = await get(session.sessionId, 'init.mp4');

    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.toString()).toBe('INIT');
  });

  it('answers init.mp4 with 504 while the encoder has produced nothing', async () => {
    rig = await bootRig({ playback: { segmentWaitMs: 300 } });
    const session = await rig.start();
    writeFileSync(path.join(rig.dir(session.sessionId), 'init.mp4'), 'INIT');

    const res = await get(session.sessionId, 'init.mp4');

    expect(res.statusCode).toBe(504);
    expect(res.json()).toMatchObject({ error: { message: 'The encoder did not start in time.' } });
  });

  it('has no init segment in an MPEG-TS session', async () => {
    rig = await bootRig();
    const session = await rig.start('desktop');
    expect((await get(session.sessionId, 'init.mp4')).statusCode).toBe(404);
    expect((await get(session.sessionId, 'seg-0.ts')).statusCode).toBe(200);
  });
});

describe('progress and activity figures', () => {
  it('reports the encoder head, the network figures and the disk usage', async () => {
    rig = await bootRig();
    const session = await rig.start();
    rig.spawned[0]?.onProgress(progressAt(40));

    const info = rig.harness.app.ctx.playback.get(session.sessionId) as SessionResponse;
    expect(info.encoder).toMatchObject({ headSegment: 10, outTimeSec: 40, speed: 2 });
    expect(rig.playback.networkSessions().map((s) => s.sessionId)).toEqual([session.sessionId]);
    expect(rig.playback.diskUsage().bytes).toBeGreaterThanOrEqual(0);
    expect(rig.playback.fallingBehindSessions()).toEqual([]);
    expect(rig.playback.has(session.sessionId)).toBe(true);
    rig.playback.touch(session.sessionId);
    expect(() => rig.playback.touch('missing')).toThrow(/not found/);
  });

  it('marks the encoder done when ffmpeg exits cleanly and keeps serving the files', async () => {
    rig = await bootRig();
    const session = await rig.start();

    await rig.encoders.handles[0]?.stop();
    await until(() => !rig.encoders.handles[0]?.running);

    expect((await get(session.sessionId, 'seg-0.m4s')).statusCode).toBe(200);
    expect(rig.playback.get(session.sessionId).state).toMatch(/ready|starting/);
  });
});
