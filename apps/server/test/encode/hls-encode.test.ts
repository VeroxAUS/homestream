import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clearSecrets } from '../../src/redact.js';
import { makeTempDir, removeDir } from '../helpers.js';
import {
  bootHarness,
  fetchHls,
  generateSources,
  listFfmpegCommandLines,
  PROFILES,
  probeSegment,
  startSession,
  type Harness,
  type ProfileName,
} from '../playback/harness.js';

const TIMEOUT = 120_000;

let root: string;
let work: string;
let harness: Harness;

beforeAll(async () => {
  root = makeTempDir('encode');
  work = path.join(root, 'work');
  const sources = await generateSources(path.join(root, 'sources'));
  harness = await bootHarness({
    root,
    sources: {
      sdr: { filename: 'Movie.1994.1080p.WEB-DL.x264.mkv', path: sources.sdr },
      hdr: { filename: 'Movie.1994.2160p.WEB-DL.HDR10.HEVC.mkv', path: sources.hdr },
    },
  });
}, TIMEOUT);

afterAll(async () => {
  await harness?.close();
  clearSecrets();
  removeDir(root);
});

async function encodeAndProbe(stream: 'sdr' | 'hdr', profile: ProfileName, segment: string) {
  const { status, body } = await startSession(harness, stream, profile);
  expect(status).toBe(201);
  const probed = await probeSegment(harness, body.sessionId, segment, work);
  const video = probed.streams.find((s) => s.codec_type === 'video');
  const audio = probed.streams.find((s) => s.codec_type === 'audio');
  await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${body.sessionId}` });
  return { session: body, probed, video, audio };
}

describe('HLS encode with local sources', () => {
  it('keeps 4K HDR10 for a device that supports it (hevc Main10, PQ/BT.2020 tags, hvc1)', async () => {
    const { session, video, audio } = await encodeAndProbe('hdr', 'chromecast4k', 'seg-0.m4s');
    expect(session.decision).toMatchObject({
      videoCodec: 'hevc', width: 3840, height: 2160, dynamicRange: 'hdr10', toneMapped: false, audioCodec: 'aac', audioChannels: 6,
      sourceVideo: { codec: 'hevc', width: 3840, height: 2160, hdr: 'hdr10' },
    });
    expect(video).toMatchObject({
      codec_name: 'hevc', profile: 'Main 10', width: 3840, height: 2160, pix_fmt: 'yuv420p10le',
      color_transfer: 'smpte2084', color_primaries: 'bt2020', color_space: 'bt2020nc', codec_tag_string: 'hvc1',
    });
    expect(audio).toMatchObject({ codec_name: 'aac', channels: 6 });
  }, TIMEOUT);

  it('tone-maps 4K HDR to 1080p 8-bit SDR HEVC for the emulator profile', async () => {
    const { session, video } = await encodeAndProbe('hdr', 'emulator', 'seg-0.m4s');
    expect(session.decision).toMatchObject({ videoCodec: 'hevc', width: 1920, height: 1080, dynamicRange: 'sdr', toneMapped: true });
    expect(video).toMatchObject({ codec_name: 'hevc', profile: 'Main', width: 1920, height: 1080, pix_fmt: 'yuv420p' });
    expect(video?.color_transfer).not.toBe('smpte2084');
    expect(video?.color_primaries).not.toBe('bt2020');
  }, TIMEOUT);

  it('tone-maps 4K HDR to source-size H.264 TS with stereo AAC for the desktop profile', async () => {
    const { session, video, audio } = await encodeAndProbe('hdr', 'desktop', 'seg-0.ts');
    expect(session.decision).toMatchObject({ videoCodec: 'h264', width: 3840, height: 2160, dynamicRange: 'sdr', toneMapped: true, audioChannels: 2 });
    expect(video).toMatchObject({ codec_name: 'h264', width: 3840, height: 2160, pix_fmt: 'yuv420p' });
    expect(video?.color_transfer).not.toBe('smpte2084');
    expect(audio).toMatchObject({ codec_name: 'aac', channels: 2 });
  }, TIMEOUT);

  it('encodes 1080p SDR as 8-bit HEVC for chromecast4k without tone mapping', async () => {
    const { session, video, audio } = await encodeAndProbe('sdr', 'chromecast4k', 'seg-0.m4s');
    expect(session.decision).toMatchObject({ videoCodec: 'hevc', width: 1920, height: 1080, dynamicRange: 'sdr', toneMapped: false, audioChannels: 6 });
    expect(video).toMatchObject({ codec_name: 'hevc', profile: 'Main', pix_fmt: 'yuv420p', width: 1920, height: 1080 });
    expect(audio).toMatchObject({ codec_name: 'aac', channels: 6 });
  }, TIMEOUT);

  it('never upscales and honours the 720p cap with H.264 and stereo audio', async () => {
    const { session, video, audio } = await encodeAndProbe('sdr', 'p720', 'seg-0.ts');
    expect(session.decision).toMatchObject({ videoCodec: 'h264', width: 1280, height: 720, toneMapped: false, audioChannels: 2 });
    expect(video).toMatchObject({ codec_name: 'h264', width: 1280, height: 720 });
    expect(audio).toMatchObject({ codec_name: 'aac', channels: 2 });
  }, TIMEOUT);

  it('does not upscale a 1080p source for a 4K device', async () => {
    const { session } = await encodeAndProbe('sdr', 'desktop', 'seg-0.ts');
    expect(session.decision).toMatchObject({ width: 1920, height: 1080 });
  }, TIMEOUT);
});

describe('segments and playlist', () => {
  it('produces 4 s keyframe-aligned fMP4 segments whose start_time matches the playlist', async () => {
    const { body } = await startSession(harness, 'sdr', 'chromecast4k');
    const playlist = await fetchHls(harness, body.sessionId, 'video.m3u8');
    expect(playlist.status).toBe(200);
    expect(playlist.headers['content-type']).toContain('application/vnd.apple.mpegurl');
    expect(playlist.headers['cache-control']).toBe('no-cache');
    const text = playlist.body.toString();
    expect(text).toContain('#EXT-X-MAP:URI="init.mp4"');
    expect(text.match(/seg-\d+\.m4s/g)).toHaveLength(Math.ceil(body.durationSec / 4));
    expect(text.trimEnd().endsWith('#EXT-X-ENDLIST')).toBe(true);

    const master = await fetchHls(harness, body.sessionId, 'index.m3u8');
    expect(master.status).toBe(200);
    expect(master.headers['content-type']).toContain('application/vnd.apple.mpegurl');
    expect(master.body.toString()).toMatch(/#EXT-X-STREAM-INF:BANDWIDTH=\d+,RESOLUTION=1920x1080[^\n]*\nvideo\.m3u8\n/);
    expect(master.body.toString()).not.toContain('EXT-X-MEDIA');

    for (const n of [0, 1, 5]) {
      const probed = await probeSegment(harness, body.sessionId, `seg-${n}.m4s`, work);
      const video = probed.streams.find((s) => s.codec_type === 'video');
      expect(Number(video?.start_time)).toBeCloseTo(n * 4, 1);
      expect(probed.formatDuration - Number(video?.start_time)).toBeCloseTo(4, 1);
      expect(probed.firstVideoFlags).toContain('K');
    }
    await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${body.sessionId}` });
  }, TIMEOUT);

  it('produces MPEG-TS segments that start exactly on the segment grid', async () => {
    const { body } = await startSession(harness, 'sdr', 'desktop');
    for (const n of [0, 2]) {
      const probed = await probeSegment(harness, body.sessionId, `seg-${n}.ts`, work);
      const video = probed.streams.find((s) => s.codec_type === 'video');
      expect(Number(video?.start_time)).toBeCloseTo(n * 4, 1);
      expect(probed.formatDuration).toBeCloseTo(4, 1);
    }
    const res = await fetchHls(harness, body.sessionId, 'seg-0.ts');
    expect(res.headers['content-type']).toBe('video/mp2t');
    await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${body.sessionId}` });
  }, TIMEOUT);

  it('restarts ffmpeg for a far seek and keeps exactly one process for the session', async () => {
    const { body } = await startSession(harness, 'sdr', 'chromecast4k');
    const started = Date.now();
    const probed = await probeSegment(harness, body.sessionId, 'seg-14.m4s', work);
    expect(Date.now() - started).toBeLessThan(20_000);
    const video = probed.streams.find((s) => s.codec_type === 'video');
    expect(Number(video?.start_time)).toBeCloseTo(56, 1);
    const mine = (await listFfmpegCommandLines()).filter((line) => line.includes(body.sessionId));
    // The tail of the source is short, so the restarted run may already have finished.
    expect(mine.length).toBeLessThanOrEqual(1);
    await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${body.sessionId}` });
  }, TIMEOUT);

  it('honours startPositionSec by encoding from that segment', async () => {
    const { body } = await startSession(harness, 'sdr', 'chromecast4k', { startPositionSec: 20 });
    expect(body.startPositionSec).toBe(20);
    const probed = await probeSegment(harness, body.sessionId, 'seg-5.m4s', work);
    const video = probed.streams.find((s) => s.codec_type === 'video');
    expect(Number(video?.start_time)).toBeCloseTo(20, 1);
    await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${body.sessionId}` });
  }, TIMEOUT);
});

describe('session lifecycle', () => {
  it('reports encoder stats while encoding', async () => {
    const { body } = await startSession(harness, 'hdr', 'chromecast4k');
    await fetchHls(harness, body.sessionId, 'seg-1.m4s');
    const session = (await harness.app.inject(`/api/sessions/${body.sessionId}`)).json();
    expect(session.state).toMatch(/ready|playing/);
    expect(session.encoder.headSegment).toBeGreaterThanOrEqual(1);
    expect(session.encoder.outTimeSec).toBeGreaterThan(0);
    await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${body.sessionId}` });
  }, TIMEOUT);

  it('DELETE kills ffmpeg, removes the session directory and the playlist', async () => {
    const { body } = await startSession(harness, 'hdr', 'chromecast4k');
    await fetchHls(harness, body.sessionId, 'seg-0.m4s');
    const dir = path.join(harness.transcodeDir, body.sessionId);
    expect(existsSync(dir)).toBe(true);
    expect((await listFfmpegCommandLines()).some((line) => line.includes(body.sessionId))).toBe(true);

    const res = await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${body.sessionId}` });
    expect(res.statusCode).toBe(200);
    expect((await listFfmpegCommandLines()).some((line) => line.includes(body.sessionId))).toBe(false);
    expect(existsSync(dir)).toBe(false);
    expect((await fetchHls(harness, body.sessionId, 'index.m3u8')).status).toBe(404);
    expect((await harness.app.inject(`/api/sessions/${body.sessionId}`)).statusCode).toBe(404);
  }, TIMEOUT);

  it('writes a play record at start and finalizes it at the end', async () => {
    const { body } = await startSession(harness, 'sdr', 'desktop');
    const row = harness.db.prepare('SELECT * FROM plays WHERE session_id = ?').get(body.sessionId) as Record<string, unknown>;
    expect(row).toMatchObject({
      media_key: 'movie:278', device_id: 'val-desktop', device_kind: 'desktop', stream_filename: 'Movie.1994.1080p.WEB-DL.x264.mkv', status: 'ok',
    });
    expect(row.ended_at).toBeNull();
    expect(JSON.parse(row.decision_json as string)).toMatchObject({ videoCodec: 'h264', width: 1920 });

    await fetchHls(harness, body.sessionId, 'seg-0.ts');
    await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${body.sessionId}` });
    const ended = harness.db.prepare('SELECT * FROM plays WHERE session_id = ?').get(body.sessionId) as Record<string, unknown>;
    expect(ended.ended_at).toEqual(expect.any(Number));
    expect(ended.status).toBe('ok');
  }, TIMEOUT);

  it('uses the recommended stream for streamId "auto"', async () => {
    await harness.app.inject({ method: 'POST', url: '/api/devices', payload: PROFILES.chromecast4k });
    const listing = (await harness.app.inject('/api/streams/movie/278?deviceId=val-cc4k')).json();
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { mediaType: 'movie', tmdbId: 278, streamId: 'auto', device: PROFILES.chromecast4k },
    });
    expect(res.statusCode).toBe(201);
    const row = harness.db.prepare('SELECT stream_filename FROM plays WHERE session_id = ?').get(res.json().sessionId) as { stream_filename: string };
    const recommended = listing.streams.find((s: { id: string }) => s.id === listing.recommendedId);
    expect(row.stream_filename).toBe(recommended.filename);
    await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${res.json().sessionId}` });
  }, TIMEOUT);

  it('leaves no session directories or ffmpeg processes behind', async () => {
    expect(readdirSync(harness.transcodeDir)).toEqual([]);
    const leftovers = (await listFfmpegCommandLines()).filter((line) => line.includes(harness.transcodeDir));
    expect(leftovers).toEqual([]);
  }, TIMEOUT);
});
