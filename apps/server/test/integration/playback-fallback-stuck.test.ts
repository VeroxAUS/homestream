// @no-ffmpeg: fake encoders and a stubbed probe; nothing here starts ffmpeg or touches the GPU.
// An abandoned fallback candidate whose process survives the kill still holds a place: no further candidate may launch.
import path from 'node:path';
import type { SessionResponse } from '@homestream/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ProbeResult } from '../../src/playback/probe.js';
import { clearSecrets } from '../../src/redact.js';
import { makeTempDir, removeDir } from '../helpers.js';
import { FakeEncoders, type FakeEncoder } from '../playback/fakeEncoder.js';
import { bootHarness, PROFILES, type Harness } from '../playback/harness.js';
import { probeOf, until } from '../playback/managerRig.js';

const PROBE: ProbeResult = probeOf();
const NAMES = ['1080p.WEB-DL.x264-A', '1080p.WEB-DL.x264-B', '1080p.WEB-DL.x264-C', '1080p.WEB-DL.x264-D'];

let root: string;
let harness: Harness;
let encoders: FakeEncoders;
/** How many encoders were running each time a new one was launched. */
let runningAtLaunch: number[];

beforeAll(() => {
  root = makeTempDir('fallback-stuck');
});

afterEach(async () => {
  for (const encoder of encoders.handles) encoder.exitNow();
  await harness.close();
});

afterAll(() => {
  clearSecrets();
  removeDir(root);
});

async function boot(mode: (index: number) => 'run' | 'hang'): Promise<void> {
  encoders = new FakeEncoders(mode);
  runningAtLaunch = [];
  const sources = Object.fromEntries(
    NAMES.map((name, i) => [`s${i}`, { filename: `Movie.1994.${name}.mkv`, path: path.join(root, `s${i}.mkv`) }]),
  );
  harness = await bootHarness({
    root: makeTempDir('inst'),
    sources,
    probe: async () => PROBE,
    playback: {
      firstSegmentWaitMs: 300,
      resolveUrl: async (raw) => path.join(root, `s${Number(/token(\d+)\//.exec(raw)?.[1])}.mkv`),
      createEncoder: (options) => {
        runningAtLaunch.push(encoders.handles.filter((handle) => handle.running).length);
        return encoders.create(options);
      },
    },
  });
}

const post = (streamId: string, profile: 'desktop' | 'emulator' = 'emulator') =>
  harness.app.inject({
    method: 'POST',
    url: '/api/sessions',
    payload: { mediaType: 'movie', tmdbId: 278, streamId, device: PROFILES[profile], subtitle: null },
  });

describe('automatic start whose abandoned candidate survives the kill', () => {
  it('starts no further candidate while two encoders would run, and proceeds after the exit', async () => {
    // Encoder 0 is the live session, encoder 1 the first candidate (it never writes a segment), the rest play.
    await boot((index) => (index === 1 ? 'hang' : 'run'));
    const live = await post(harness.streamIds.s3 as string, 'desktop');
    expect(live.statusCode).toBe(201);

    const starting = post('auto');
    await until(() => encoders.handles.length === 2);
    (encoders.handles[1] as FakeEncoder).surviveKill();
    const res = await starting;

    expect(res.statusCode).toBe(503);
    expect((res.json() as { error: { code: string; hint?: string } }).error).toMatchObject({
      code: 'encoder_not_stopped',
      hint: expect.any(String),
    });
    expect(encoders.started).toBe(2);
    expect(Math.max(...runningAtLaunch)).toBeLessThanOrEqual(1);
    expect(encoders.handles.filter((handle) => handle.running)).toHaveLength(2);
    expect((await post('auto')).statusCode).toBe(429);
    expect(encoders.started).toBe(2);

    (encoders.handles[1] as FakeEncoder).exitNow();
    await encoders.handles[1]?.exited;
    await until(() => encoders.handles.filter((handle) => handle.running).length === 1);
    const again = await post('auto');

    expect(again.statusCode).toBe(201);
    expect((again.json() as SessionResponse).attempts).toEqual([]);
    expect(Math.max(...runningAtLaunch)).toBeLessThanOrEqual(1);
    expect(encoders.handles.filter((handle) => handle.running)).toHaveLength(2);
  });

  it('keeps falling back when the abandoned candidate exited', async () => {
    await boot((index) => (index === 1 ? 'hang' : 'run'));
    expect((await post(harness.streamIds.s3 as string, 'desktop')).statusCode).toBe(201);

    const res = await post('auto');

    expect(res.statusCode).toBe(201);
    expect((res.json() as SessionResponse).attempts).toEqual([
      { streamId: harness.streamIds.s0, code: 'encoder_timeout' },
    ]);
    expect(Math.max(...runningAtLaunch)).toBeLessThanOrEqual(1);
  });
});
