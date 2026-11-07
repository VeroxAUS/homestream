// @no-ffmpeg: fake encoders and a stubbed probe; FFMPEG_PATH points nowhere, so no ffmpeg process can start.
// A seek moves the player: the subtitle extractor must hear about it and the read-ahead windows must measure from there.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackContext } from '../../src/playback/context.js';
import { clearSecrets } from '../../src/redact.js';
import { bootRig, probeOf, TEXT_TRACK, writeSegments, type Rig } from '../playback/managerRig.js';

let rig: Rig;

afterEach(async () => {
  await rig.close();
  clearSecrets();
});

const get = (id: string, file: string) => rig.harness.app.inject(`/hls/${id}/${file}`);
const record = (id: string) => (rig.playback as unknown as { ctx: PlaybackContext }).ctx.slots.require(id);

describe('seek and the subtitle extractor', () => {
  it('tells the extractor about a far forward seek and moves the player position to the requested segment', async () => {
    rig = await bootRig({ probe: probeOf({ subtitles: [TEXT_TRACK] }) });
    const session = await rig.start();
    const rec = record(session.sessionId);
    const noteSeek = vi.spyOn(rec.subtitles as NonNullable<typeof rec.subtitles>, 'noteSeek');

    expect((await get(session.sessionId, 'seg-60.m4s')).statusCode).toBe(200);

    expect(noteSeek).toHaveBeenCalledTimes(1);
    expect(noteSeek).toHaveBeenCalledWith(240);
    expect(rec.positionSec).toBe(240);
  });

  it('tells the extractor about a seek back and replaces a stale ping position', async () => {
    rig = await bootRig({ probe: probeOf({ subtitles: [TEXT_TRACK] }) });
    const session = await rig.start();
    expect((await get(session.sessionId, 'seg-100.m4s')).statusCode).toBe(200);
    rig.playback.ping(session.sessionId, { positionSec: 400 });
    const rec = record(session.sessionId);
    const noteSeek = vi.spyOn(rec.subtitles as NonNullable<typeof rec.subtitles>, 'noteSeek');

    expect((await get(session.sessionId, 'seg-10.m4s')).statusCode).toBe(200);

    expect(noteSeek).toHaveBeenCalledWith(40);
    expect(rec.positionSec).toBe(40);
  });

  it('does not tell the extractor about a segment the running encoder is about to produce', async () => {
    rig = await bootRig({ probe: probeOf({ subtitles: [TEXT_TRACK] }) });
    const session = await rig.start();
    const rec = record(session.sessionId);
    const noteSeek = vi.spyOn(rec.subtitles as NonNullable<typeof rec.subtitles>, 'noteSeek');

    expect((await get(session.sessionId, 'seg-0.m4s')).statusCode).toBe(200);

    expect(noteSeek).not.toHaveBeenCalled();
  });
});

describe('player position after a jump back inside the encoded range', () => {
  it('follows a segment request well before the previous one even when a ping was recent', async () => {
    rig = await bootRig();
    const session = await rig.start();
    const dir = rig.dir(session.sessionId);
    writeSegments(dir, [30, 100], 8);
    rig.playback.ping(session.sessionId, { positionSec: 400 });
    const rec = record(session.sessionId);
    rec.playerSegment = 100;

    // Segment 30 exists, so no restart happens; only the player position tells the windows where the player is.
    expect((await get(session.sessionId, 'seg-30.m4s')).statusCode).toBe(200);

    expect(rec.playerSegment).toBe(30);
    expect(rec.positionSec).toBe(120);
  });

  it('keeps the pinged position for a request a segment or two earlier', async () => {
    rig = await bootRig();
    const session = await rig.start();
    writeSegments(rig.dir(session.sessionId), [98, 100], 8);
    rig.playback.ping(session.sessionId, { positionSec: 400 });
    const rec = record(session.sessionId);

    expect((await get(session.sessionId, 'seg-98.m4s')).statusCode).toBe(200);

    expect(rec.positionSec).toBe(400);
  });
});
