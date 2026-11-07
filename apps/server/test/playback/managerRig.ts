// @no-ffmpeg: fake encoders and a stubbed probe; FFMPEG_PATH points nowhere, so no ffmpeg process can start.
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { SessionResponse } from '@homestream/shared';
import type { PlaybackManager } from '../../src/playback/manager.js';
import type { EncoderProcessOptions } from '../../src/playback/encoderProcess.js';
import type { ProbeResult, SubtitleTrackInfo } from '../../src/playback/probe.js';
import type { RawProgress } from '../../src/playback/progress.js';
import { makeTempDir, removeDir } from '../helpers.js';
import { FakeEncoders } from './fakeEncoder.js';
import { bootHarness, PROFILES, type Harness, type HarnessOptions, type ProfileName } from './harness.js';

export const TEXT_TRACK: SubtitleTrackInfo = {
  index: 3,
  codec: 'subrip',
  language: 'eng',
  title: '',
  kind: 'text',
  forced: false,
  default: false,
};

export function probeOf(overrides: Partial<ProbeResult> = {}, hdr: 'sdr' | 'hdr10' | 'hlg' = 'sdr'): ProbeResult {
  return {
    durationSec: 1200,
    video: {
      index: 0,
      codec: hdr === 'sdr' ? 'h264' : 'hevc',
      profile: 'High',
      width: 1920,
      height: 1080,
      pixFmt: 'yuv420p',
      fps: 24,
      hdr,
      dolbyVisionProfile: null,
    },
    audio: [
      { index: 1, codec: 'ac3', channels: 6, language: 'eng', title: '', default: true },
      { index: 2, codec: 'aac', channels: 2, language: 'fra', title: '', default: false },
    ],
    subtitles: [],
    ...overrides,
  };
}

export const progressAt = (outTimeSec: number): RawProgress => ({ fps: 24, speed: 2, bitrateKbps: 8000, outTimeSec });

export interface Rig {
  harness: Harness;
  playback: PlaybackManager;
  encoders: FakeEncoders;
  /** Options the manager passed to each encoder it started, in start order. */
  spawned: EncoderProcessOptions[];
  start(profile?: ProfileName, extra?: Record<string, unknown>): Promise<SessionResponse>;
  /** Session directory of a session. */
  dir(id: string): string;
  segments(id: string): string[];
  close(): Promise<void>;
}

export interface RigOptions {
  probe?: ProbeResult;
  env?: Record<string, string>;
  playback?: HarnessOptions['playback'];
  logger?: HarnessOptions['logger'];
}

/** The `-start_number` an encoder was started with. */
export function startNumberOf(options: EncoderProcessOptions | undefined): number {
  return Number(options?.args[(options?.args.indexOf('-start_number') ?? -2) + 1]);
}

export async function bootRig(options: RigOptions = {}): Promise<Rig> {
  const root = makeTempDir('rig');
  const encoders = new FakeEncoders();
  const spawned: EncoderProcessOptions[] = [];
  const probe = options.probe ?? probeOf();
  const harness = await bootHarness({
    root: makeTempDir('inst'),
    sources: { movie: { filename: 'Movie.1994.1080p.WEB-DL.x264.mkv', path: path.join(root, 'absent.mkv') } },
    probe: async () => probe,
    logger: options.logger,
    env: { FFMPEG_PATH: path.join(root, 'no-such-ffmpeg.exe'), ...options.env },
    playback: {
      createEncoder: (encoderOptions) => {
        spawned.push(encoderOptions);
        return encoders.create(encoderOptions);
      },
      segmentWaitMs: 1_500,
      subtitleHoldMs: 300,
      ...options.playback,
    },
  });
  const dir = (id: string) => path.join(harness.transcodeDir, id);
  return {
    harness,
    playback: harness.app.ctx.playback,
    encoders,
    spawned,
    async start(profile = 'chromecast4k', extra = {}) {
      const res = await harness.app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: {
          mediaType: 'movie',
          tmdbId: 278,
          streamId: harness.streamIds.movie,
          device: PROFILES[profile],
          subtitle: null,
          ...extra,
        },
      });
      if (res.statusCode !== 201) throw new Error(`start failed: ${res.statusCode} ${res.body}`);
      return res.json() as SessionResponse;
    },
    dir,
    segments: (id) => (existsSync(dir(id)) ? readdirSync(dir(id)).filter((name) => name.startsWith('seg-')) : []),
    async close() {
      await harness.close();
      removeDir(root);
    },
  };
}

export function writeSegments(dir: string, indices: number[], bytes: number, extension = 'm4s'): void {
  for (const index of indices) writeFileSync(path.join(dir, `seg-${index}.${extension}`), Buffer.alloc(bytes));
}

export async function until(condition: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not reached in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
