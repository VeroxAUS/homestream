import { execFile } from 'node:child_process';
import path from 'node:path';
import type { SessionResponse } from '@homestream/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lowerPriority } from '../../src/playback/priority.js';
import { clearSecrets } from '../../src/redact.js';
import { makeTempDir, removeDir } from '../helpers.js';
import {
  bootHarness,
  fetchHls,
  listFfmpegCommandLines,
  listFfmpegPids,
  probeSegment,
  run,
  startSession,
  withThreadCap,
  type Harness,
  type HarnessOptions,
} from '../playback/harness.js';
import { generateHdrBitmapSource, generateSubtitleSources } from '../playback/subtitleSources.js';

const TIMEOUT = 180_000;

// Stream indices in the generated source: audio 1 por (default-flagged), 2 eng 5.1, 3 fra; subtitles 4 eng text, 5 por text, 6 eng bitmap.
const POR = 1;
const ENG = 2;
const FRA = 3;
const TEXT_ENG = 4;
const TEXT_POR = 5;
const BITMAP = 6;

let root: string;
let work: string;
let source: string;
let hdrSource: string;
const harnesses: Harness[] = [];

beforeAll(async () => {
  root = makeTempDir('tracks');
  work = path.join(root, 'work');
  source = (await generateSubtitleSources(path.join(root, 'sources'))).multi;
  hdrSource = await generateHdrBitmapSource(path.join(root, 'sources'));
}, TIMEOUT);

afterAll(async () => {
  for (const harness of harnesses) await harness.close();
  clearSecrets();
  removeDir(root);
});

async function boot(options: Partial<HarnessOptions> = {}): Promise<Harness> {
  const harness = await bootHarness({
    root: makeTempDir('inst'),
    sources: { movie: { filename: 'Movie.1994.1080p.WEB-DL.x264.mkv', path: source } },
    ...options,
  });
  harnesses.push(harness);
  return harness;
}

async function getSession(harness: Harness, sessionId: string): Promise<SessionResponse> {
  return (await harness.app.inject(`/api/sessions/${sessionId}`)).json();
}

async function patch(harness: Harness, sessionId: string, payload: unknown) {
  const res = await harness.app.inject({
    method: 'PATCH',
    url: `/api/sessions/${sessionId}`,
    payload: payload as object,
  });
  return { status: res.statusCode, body: res.json() as SessionResponse & { error?: { code: string; hint?: string } } };
}

async function audioMd5(harness: Harness, sessionId: string, segment: string): Promise<string> {
  const { file } = await probeSegment(harness, sessionId, segment, work);
  const out = await run('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a', '-f', 'md5', '-']);
  return out.trim();
}

function execBuffer(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'ffmpeg',
      withThreadCap('ffmpeg', args),
      { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) reject(new Error(`ffmpeg failed: ${stderr.toString()}`));
        else resolve(stdout);
      },
    );
    lowerPriority(child.pid);
  });
}

/** Grayscale pixels of the lower third of frame `frame` of a segment file. */
function lowerThird(file: string, frame: number): Promise<Buffer> {
  return execBuffer([
    '-v',
    'error',
    '-i',
    file,
    '-vf',
    `select='eq(n,${frame})',crop=iw:ih/3:0:ih*2/3,format=gray`,
    '-fps_mode',
    'passthrough',
    '-frames:v',
    '1',
    '-f',
    'rawvideo',
    '-',
  ]);
}

function meanAbsDiff(a: Buffer, b: Buffer): number {
  expect(a.length).toBe(b.length);
  expect(a.length).toBeGreaterThan(0);
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs((a[i] as number) - (b[i] as number));
  return sum / a.length;
}

async function lowerThirdOf(harness: Harness, sessionId: string, segment: string, frame: number): Promise<Buffer> {
  const { file } = await probeSegment(harness, sessionId, segment, work);
  return lowerThird(file, frame);
}

describe('audio tracks', () => {
  it(
    'lists every track, selects English although Portuguese is default-flagged, and honours audioIndex at start',
    async () => {
      const harness = await boot();
      const defaultSession = (await startSession(harness, 'movie', 'desktop')).body;
      expect(defaultSession.audioTracks).toEqual([
        { index: POR, codec: 'aac', channels: 2, language: 'por', title: '', default: true },
        { index: ENG, codec: 'ac3', channels: 6, language: 'eng', title: 'English 5.1', default: false },
        { index: FRA, codec: 'aac', channels: 2, language: 'fra', title: '', default: false },
      ]);
      expect(defaultSession.selectedAudioIndex).toBe(ENG);
      expect(
        defaultSession.subtitleTracks.map(({ index, kind, language, title }) => ({ index, kind, language, title })),
      ).toEqual([
        { index: TEXT_ENG, kind: 'text', language: 'eng', title: 'English' },
        { index: TEXT_POR, kind: 'text', language: 'por', title: 'Portuguese' },
        { index: BITMAP, kind: 'bitmap', language: 'eng', title: 'English (bitmap)' },
      ]);
      expect(defaultSession.subtitleTracks.find((track) => track.index === BITMAP)?.url).toBeNull();
      expect(defaultSession.selectedSubtitle).toBeNull();

      const chosen = (await startSession(harness, 'movie', 'desktop', { audioIndex: POR })).body;
      expect(chosen.selectedAudioIndex).toBe(POR);

      const defaultMd5 = await audioMd5(harness, defaultSession.sessionId, 'seg-1.ts');
      const chosenMd5 = await audioMd5(harness, chosen.sessionId, 'seg-1.ts');
      expect(defaultMd5).toMatch(/^MD5=[0-9a-f]{32}$/);
      expect(chosenMd5).not.toBe(defaultMd5);

      for (const session of [defaultSession, chosen])
        await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${session.sessionId}` });
    },
    TIMEOUT,
  );

  it(
    'PATCH switches the track by restarting the one ffmpeg at the current position and keeps the playlist URL',
    async () => {
      const harness = await boot();
      const started = (await startSession(harness, 'movie', 'chromecast4k')).body;
      const { sessionId } = started;
      expect(started.selectedAudioIndex).toBe(ENG);

      const before = await probeSegment(harness, sessionId, 'seg-1.m4s', work);
      expect(before.streams.find((s) => s.codec_type === 'audio')?.channels).toBe(6);
      const md5Before = await audioMd5(harness, sessionId, 'seg-1.m4s');
      const initBefore = (await fetchHls(harness, sessionId, 'init.mp4')).body;
      const pidsBefore = await listFfmpegPids(sessionId);
      expect(pidsBefore).toHaveLength(1);

      const requestedAt = Date.now();
      const patched = await patch(harness, sessionId, { audioIndex: POR });
      expect(patched.status).toBe(200);
      expect(patched.body.playlistUrl).toBe(started.playlistUrl);
      expect(patched.body.selectedAudioIndex).toBe(POR);
      expect(patched.body.decision.audioChannels).toBe(2);
      expect(patched.body.decision.sourceAudio).toEqual({ codec: 'aac', channels: 2 });
      expect((await getSession(harness, sessionId)).selectedAudioIndex).toBe(POR);

      const after = await probeSegment(harness, sessionId, 'seg-1.m4s', work);
      expect((Date.now() - requestedAt) / 1000).toBeLessThan(5);
      expect(after.streams.find((s) => s.codec_type === 'audio')?.channels).toBe(2);
      expect(Number(after.streams.find((s) => s.codec_type === 'video')?.start_time)).toBeCloseTo(4, 1);
      expect(await audioMd5(harness, sessionId, 'seg-1.m4s')).not.toBe(md5Before);
      expect((await fetchHls(harness, sessionId, 'init.mp4')).body.equals(initBefore)).toBe(false);

      const pidsAfter = await listFfmpegPids(sessionId);
      expect(pidsAfter).toHaveLength(1);
      expect(pidsAfter[0]).not.toBe(pidsBefore[0]);

      // Segments the old run had already written must not survive the switch.
      for (const next of ['seg-2.m4s', 'seg-6.m4s']) {
        const probed = await probeSegment(harness, sessionId, next, work);
        expect(probed.streams.find((s) => s.codec_type === 'audio')?.channels, next).toBe(2);
      }
      expect((await patch(harness, sessionId, { audioIndex: POR })).body.selectedAudioIndex).toBe(POR);
      expect(await listFfmpegPids(sessionId)).toEqual(pidsAfter);

      const play = harness.db.prepare('SELECT decision_json FROM plays WHERE session_id = ?').get(sessionId) as {
        decision_json: string;
      };
      expect(JSON.parse(play.decision_json).audioChannels).toBe(2);

      await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${sessionId}` });
      expect(await listFfmpegPids(sessionId)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'restarts at the position the player reported',
    async () => {
      const harness = await boot();
      const { sessionId } = (await startSession(harness, 'movie', 'desktop')).body;
      harness.app.ctx.playback.ping(sessionId, { positionSec: 25, state: 'playing' });
      await patch(harness, sessionId, { audioIndex: FRA });
      const cmd = (await listFfmpegCommandLines()).find((line) => line.includes(sessionId)) ?? '';
      expect(cmd).toMatch(/-ss 24 /);
      expect(cmd).toMatch(/-output_ts_offset 24 /);
      const probed = await probeSegment(harness, sessionId, 'seg-6.ts', work);
      expect(Number(probed.streams.find((s) => s.codec_type === 'video')?.start_time)).toBeCloseTo(24, 1);
      await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${sessionId}` });
    },
    TIMEOUT,
  );

  it.each([
    ['unknown audio track', { audioIndex: 9 }, 'invalid_audio_index'],
    ['a subtitle track that does not exist', { subtitle: { index: 9, mode: 'sidecar' } }, 'invalid_subtitle_index'],
    ['burning a text track', { subtitle: { index: TEXT_ENG, mode: 'burn' } }, 'subtitle_mode_unsupported'],
    ['side-loading a bitmap track', { subtitle: { index: BITMAP, mode: 'sidecar' } }, 'subtitle_mode_unsupported'],
    ['an empty body', {}, 'invalid_request'],
    ['a negative index', { audioIndex: -1 }, 'invalid_request'],
  ])(
    'rejects %s with 400 and leaves the encoder alone',
    async (_name, payload, code) => {
      const harness = await boot();
      const { sessionId } = (await startSession(harness, 'movie', 'desktop')).body;
      const pids = await listFfmpegPids(sessionId);
      const res = await patch(harness, sessionId, payload);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatchObject({ code, hint: expect.any(String) });
      expect(await listFfmpegPids(sessionId)).toEqual(pids);
      expect((await getSession(harness, sessionId)).selectedAudioIndex).toBe(ENG);
      await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${sessionId}` });
    },
    TIMEOUT,
  );
});

describe('bitmap subtitles', () => {
  it(
    'burns the track into the frames on PATCH and removes it again with null',
    async () => {
      const harness = await boot();
      const started = (await startSession(harness, 'movie', 'desktop')).body;
      const { sessionId } = started;
      expect(started.subtitleTracks.find((track) => track.index === BITMAP)).toMatchObject({
        kind: 'bitmap',
        url: null,
      });
      expect(started.decision.subtitleBurnIn).toBe(false);

      // The cue shows from 4 s to 9 s; frame 24 of segment 1 (4-8 s) is at 5 s.
      const clean = await lowerThirdOf(harness, sessionId, 'seg-1.ts', 24);
      const pidsBefore = await listFfmpegPids(sessionId);

      const burned = await patch(harness, sessionId, { subtitle: { index: BITMAP, mode: 'burn' } });
      expect(burned.status).toBe(200);
      expect(burned.body.playlistUrl).toBe(started.playlistUrl);
      expect(burned.body.decision.subtitleBurnIn).toBe(true);
      expect(burned.body.selectedSubtitle).toEqual({ index: BITMAP, mode: 'burn' });
      const burnedFrame = await lowerThirdOf(harness, sessionId, 'seg-1.ts', 24);
      const pidsBurn = await listFfmpegPids(sessionId);
      expect(pidsBurn).toHaveLength(1);
      expect(pidsBurn[0]).not.toBe(pidsBefore[0]);

      const cleared = await patch(harness, sessionId, { subtitle: null });
      expect(cleared.status).toBe(200);
      expect(cleared.body.decision.subtitleBurnIn).toBe(false);
      expect(cleared.body.selectedSubtitle).toBeNull();
      const cleanAgain = await lowerThirdOf(harness, sessionId, 'seg-1.ts', 24);

      const offVsOff = meanAbsDiff(clean, cleanAgain);
      const offVsOn = meanAbsDiff(clean, burnedFrame);
      expect(offVsOff).toBeLessThan(1);
      expect(offVsOn).toBeGreaterThan(offVsOff * 5 + 1);

      await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${sessionId}` });
    },
    TIMEOUT,
  );

  it(
    'keeps a subtitle that started before the restart point on screen',
    async () => {
      const harness = await boot();
      const { sessionId } = (await startSession(harness, 'movie', 'desktop')).body;
      // The second cue shows from 20 s to 26 s; segment 6 starts at 24 s, in the middle of it.
      const plain = await lowerThirdOf(harness, sessionId, 'seg-6.ts', 12);
      harness.app.ctx.playback.ping(sessionId, { positionSec: 24, state: 'playing' });
      expect((await patch(harness, sessionId, { subtitle: { index: BITMAP, mode: 'burn' } })).status).toBe(200);
      const probed = await probeSegment(harness, sessionId, 'seg-6.ts', work);
      expect(Number(probed.streams.find((s) => s.codec_type === 'video')?.start_time)).toBeCloseTo(24, 1);
      expect(meanAbsDiff(plain, await lowerThird(probed.file, 12))).toBeGreaterThan(2);
      await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${sessionId}` });
    },
    TIMEOUT,
  );

  it.each([
    ['chromecast4k', 'HDR10 output keeps its tags and the subtitle is dimmed to reference white', true],
    ['emulator', 'tone-mapped output carries the subtitle at full brightness', false],
  ] as const)(
    'burns into a 4K HDR source for %s: %s',
    async (profile, _what, keepsHdr) => {
      const harness = await boot({
        sources: { movie: { filename: 'Movie.2024.2160p.HDR.WEB-DL.x265.mkv', path: hdrSource } },
      });
      const plain = (await startSession(harness, 'movie', profile)).body;
      const burned = (await startSession(harness, 'movie', profile, { subtitle: { index: 2, mode: 'burn' } })).body;
      expect(burned.decision).toMatchObject({
        subtitleBurnIn: true,
        dynamicRange: keepsHdr ? 'hdr10' : 'sdr',
        toneMapped: !keepsHdr,
      });

      const plainSeg = await probeSegment(harness, plain.sessionId, 'seg-1.m4s', work);
      const burnedSeg = await probeSegment(harness, burned.sessionId, 'seg-1.m4s', work);
      const video = burnedSeg.streams.find((s) => s.codec_type === 'video');
      expect(video).toMatchObject(
        keepsHdr
          ? { codec_name: 'hevc', profile: 'Main 10', color_transfer: 'smpte2084', color_primaries: 'bt2020' }
          : { codec_name: 'hevc', profile: 'Main' },
      );
      expect(Number(video?.start_time)).toBeCloseTo(4, 1);

      const off = await lowerThird(plainSeg.file, 24);
      const on = await lowerThird(burnedSeg.file, 24);
      expect(meanAbsDiff(off, on)).toBeGreaterThan(0.5);
      let brightest = 0;
      for (let i = 0; i < on.length; i += 1) {
        if (Math.abs((on[i] as number) - (off[i] as number)) > 30) brightest = Math.max(brightest, on[i] as number);
      }
      // Full-scale white reaches 235 in 8-bit luma; dimmed to 203 nits in PQ it stays well below (about 143 plus edge blending).
      if (keepsHdr) expect(brightest).toBeLessThan(200);
      else expect(brightest).toBeGreaterThan(200);

      for (const session of [plain, burned])
        await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${session.sessionId}` });
    },
    TIMEOUT,
  );

  it(
    'starts a session with burn-in when the request asks for it',
    async () => {
      const harness = await boot();
      const started = (await startSession(harness, 'movie', 'desktop', { subtitle: { index: BITMAP, mode: 'burn' } }))
        .body;
      expect(started.decision.subtitleBurnIn).toBe(true);
      expect(started.selectedSubtitle).toEqual({ index: BITMAP, mode: 'burn' });
      const off = (await startSession(harness, 'movie', 'desktop')).body;
      const on = await lowerThirdOf(harness, started.sessionId, 'seg-1.ts', 24);
      const plain = await lowerThirdOf(harness, off.sessionId, 'seg-1.ts', 24);
      expect(meanAbsDiff(on, plain)).toBeGreaterThan(2);
      for (const session of [started, off])
        await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${session.sessionId}` });
    },
    TIMEOUT,
  );
});
