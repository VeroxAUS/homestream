import { readdirSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProbeResult } from '../../src/playback/probe.js';
import { clearSecrets } from '../../src/redact.js';
import { makeTempDir, removeDir } from '../helpers.js';
import { bootHarness, listFfmpegCommandLines, PROFILES, startSession, type Harness } from './harness.js';

const PROBE: ProbeResult = {
  durationSec: 120,
  video: {
    index: 0,
    codec: 'h264',
    profile: 'High',
    width: 1920,
    height: 1080,
    pixFmt: 'yuv420p',
    fps: 24,
    hdr: 'sdr',
    dolbyVisionProfile: null,
  },
  audio: [{ index: 1, codec: 'ac3', channels: 6, language: 'eng', title: '', default: true }],
  subtitles: [{ index: 2, codec: 'subrip', language: 'eng', title: '', kind: 'text', forced: false, default: false }],
};

let root: string;
let harness: Harness;

beforeAll(async () => {
  root = makeTempDir('sessions');
  harness = await bootHarness({
    root,
    sources: { movie: { filename: 'Movie.1994.1080p.WEB-DL.x264.mkv', path: path.join(root, 'does-not-exist.mkv') } },
    probe: async () => PROBE,
  });
});

afterAll(async () => {
  await harness?.close();
  clearSecrets();
  removeDir(root);
});

async function post(payload: unknown) {
  const res = await harness.app.inject({ method: 'POST', url: '/api/sessions', payload: payload as object });
  return { status: res.statusCode, body: res.json() };
}

const valid = () => ({
  mediaType: 'movie',
  tmdbId: 278,
  streamId: harness.streamIds.movie,
  device: PROFILES.chromecast4k,
});

async function expectNoEncoder(run: () => Promise<void>): Promise<void> {
  const before = (await listFfmpegCommandLines()).filter((l) => l.includes(harness.transcodeDir)).length;
  await run();
  expect((await listFfmpegCommandLines()).filter((l) => l.includes(harness.transcodeDir)).length).toBe(before);
  expect(readdirSync(harness.transcodeDir)).toEqual([]);
}

describe('invalid session requests', () => {
  it('rejects an unknown streamId with 404 and spawns nothing', async () => {
    await expectNoEncoder(async () => {
      const { status, body } = await post({ ...valid(), streamId: '0000000000000000' });
      expect(status).toBe(404);
      expect(body.error).toMatchObject({ code: 'stream_not_found', hint: expect.any(String) });
    });
    expect(harness.probeCalls).toEqual([]);
  });

  it.each([
    ['missing device', () => ({ ...valid(), device: undefined })],
    ['bad device kind', () => ({ ...valid(), device: { ...PROFILES.chromecast4k, kind: 'toaster' } })],
    ['missing streamId', () => ({ ...valid(), streamId: undefined })],
    ['tv without season/episode', () => ({ ...valid(), mediaType: 'tv' })],
    ['non-numeric tmdbId', () => ({ ...valid(), tmdbId: 'abc' })],
    ['negative startPositionSec', () => ({ ...valid(), startPositionSec: -5 })],
    ['unknown media type', () => ({ ...valid(), mediaType: 'music' })],
  ])('rejects %s with 400', async (_name, payload) => {
    await expectNoEncoder(async () => {
      const { status, body } = await post(payload());
      expect(status).toBe(400);
      expect(body.error).toMatchObject({
        code: 'invalid_request',
        message: expect.any(String),
        hint: expect.any(String),
      });
    });
  });

  it('rejects a non-JSON body with 4xx', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { 'content-type': 'application/json' },
      payload: '{nope',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBeTruthy();
  });

  it('rejects an unknown tmdbId with 404 before touching the gateway or ffmpeg', async () => {
    const gatewayCalls = harness.stub.paths.length;
    await expectNoEncoder(async () => {
      const { status } = await post({ ...valid(), tmdbId: 999_999_999 });
      expect(status).toBe(404);
    });
    expect(harness.stub.paths.length).toBe(gatewayCalls);
  });

  it('rejects an audio or subtitle track that is not in the file with 400 and spawns nothing', async () => {
    await expectNoEncoder(async () => {
      const audio = await post({ ...valid(), audioIndex: 9 });
      expect(audio.status).toBe(400);
      expect(audio.body.error.code).toBe('invalid_audio_index');
      const subtitle = await post({ ...valid(), subtitle: { index: 9, mode: 'sidecar' } });
      expect(subtitle.status).toBe(400);
      expect(subtitle.body.error.code).toBe('invalid_subtitle_index');
    });
  });

  it('answers 404 in the standard shape for unknown sessions and HLS files', async () => {
    for (const [method, url] of [
      ['GET', '/api/sessions/nonexistent'],
      ['DELETE', '/api/sessions/nonexistent'],
      ['PATCH', '/api/sessions/nonexistent'],
      ['GET', '/hls/nonexistent/index.m3u8'],
      ['GET', '/hls/nonexistent/seg-0.ts'],
      ['GET', '/hls/nonexistent/init.mp4'],
      ['GET', '/hls/nonexistent/enc.m3u8'],
    ] as const) {
      const res = await harness.app.inject({ method, url });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
      expect(res.json().error).toMatchObject({ code: 'not_found' });
    }
  });
});

describe('session start with a stubbed probe', () => {
  it('returns the documented response shape and upserts the device', async () => {
    const { status, body } = await startSession(harness, 'movie', 'emulator', {
      audioIndex: 1,
      subtitle: { index: 2, mode: 'sidecar' },
    });
    expect(status).toBe(201);
    expect(body).toMatchObject({
      playlistUrl: `/hls/${body.sessionId}/index.m3u8`,
      mediaPlaylistUrl: `/hls/${body.sessionId}/video.m3u8`,
      durationSec: 120,
      startPositionSec: 0,
      selectedAudioIndex: 1,
      selectedSubtitle: { index: 2, mode: 'sidecar' },
      audioTracks: [{ index: 1, codec: 'ac3', channels: 6, language: 'eng', title: '', default: true }],
      subtitleTracks: [
        {
          index: 2,
          language: 'eng',
          title: '',
          kind: 'text',
          forced: false,
          default: false,
          url: `/hls/${body.sessionId}/subs/2/index.m3u8`,
          fullUrl: null,
          status: 'extracting',
        },
      ],
      decision: {
        videoCodec: 'hevc',
        width: 1920,
        height: 1080,
        dynamicRange: 'sdr',
        toneMapped: false,
        audioCodec: 'aac',
        audioChannels: 6,
        subtitleBurnIn: false,
      },
      encoder: { fps: 0, speed: 0, bitrateKbps: 0, outTimeSec: 0, headSegment: 0 },
    });
    expect(JSON.stringify(body)).not.toMatch(/https?:\/\//);

    const devices = (await harness.app.inject('/api/devices')).json().devices as Array<{ deviceId: string }>;
    expect(devices.map((d) => d.deviceId)).toContain('val-emu');
    await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${body.sessionId}` });
  });

  it('serves the master playlist and the full video playlist immediately, before the encoder produces anything', async () => {
    const { body } = await startSession(harness, 'movie', 'desktop');
    const master = await harness.app.inject(`/hls/${body.sessionId}/index.m3u8`);
    expect(master.statusCode).toBe(200);
    expect(master.body).toContain('#EXT-X-STREAM-INF');
    expect(master.body).toContain('NAME="eng [2]"');
    expect(master.body).not.toContain('seg-29.ts');
    const res = await harness.app.inject(`/hls/${body.sessionId}/video.m3u8`);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('seg-29.ts');
    expect(res.body).not.toContain('#EXT-X-MAP');
    await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${body.sessionId}` });
  });
});
