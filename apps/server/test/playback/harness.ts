import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CapabilityProfile, SessionResponse } from '@homestream/shared';
import type { FastifyInstance } from 'fastify';
import { buildApp, type BuildAppOptions } from '../../src/app.js';
import type { Config } from '../../src/config.js';
import { EventBus } from '../../src/events/bus.js';
import { openDatabase, type Db } from '../../src/db/index.js';
import { GatewayClient } from '../../src/gateway/client.js';
import { RateLimiter } from '../../src/gateway/rateLimiter.js';
import { createSilentLogger, type Logger } from '../../src/logger.js';
import { lowerPriority } from '../../src/playback/priority.js';
import { createFfprobeRunner, type ProbeRunner } from '../../src/playback/probe.js';
import { TmdbService, type FetchLike } from '../../src/tmdb/service.js';
import { startStubGateway, stubStream, type StubGateway } from '../gateway/stubGateway.js';
import { makeFakeTmdb } from '../tmdb/fixtures.js';
import { testConfig } from '../helpers.js';

export const PROFILES = {
  chromecast4k: {
    deviceId: 'val-cc4k', deviceName: 'Val Chromecast', kind: 'tv', maxWidth: 3840, maxHeight: 2160,
    h264: true, hevc: true, hevcMain10: true, hdr10: true, maxAudioChannels: 6,
  },
  emulator: {
    deviceId: 'val-emu', deviceName: 'Val Emulator', kind: 'tv', maxWidth: 1920, maxHeight: 1080,
    h264: true, hevc: true, hevcMain10: false, hdr10: false, maxAudioChannels: 6,
  },
  desktop: {
    deviceId: 'val-desktop', deviceName: 'Val Desktop', kind: 'desktop', maxWidth: 3840, maxHeight: 2160,
    h264: true, hevc: false, hevcMain10: false, hdr10: false, maxAudioChannels: 2,
  },
  p720: {
    deviceId: 'val-720', deviceName: 'Val 720p', kind: 'web', maxWidth: 1280, maxHeight: 720,
    h264: true, hevc: false, hevcMain10: false, hdr10: false, maxAudioChannels: 2,
  },
} satisfies Record<string, CapabilityProfile>;

export type ProfileName = keyof typeof PROFILES;

/** Every ffmpeg the tests start gets a thread cap on its output (the last argument) and below-normal priority. */
export function withThreadCap(command: string, args: string[]): string[] {
  if (command !== 'ffmpeg' || args.includes('-threads')) return args;
  return [...args.slice(0, -1), '-threads', '4', ...args.slice(-1)];
}

export function run(command: string, args: string[], timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      command,
      withThreadCap(command, args),
      { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) reject(new Error(`${command} failed: ${stderr || error.message}`));
        else resolve(stdout);
      },
    );
    lowerPriority(child.pid);
  });
}

export interface LocalSources {
  /** 1080p H.264 SDR, 5.1 AC3 default track + stereo track, 60 s. */
  sdr: string;
  /** 4K HEVC Main10 tagged HDR10 (PQ/BT.2020), 5.1 AC3, 10 s. */
  hdr: string;
}

export async function generateSources(dir: string): Promise<LocalSources> {
  mkdirSync(dir, { recursive: true });
  const sdr = path.join(dir, 'source-sdr.mkv');
  const hdr = path.join(dir, 'source-hdr.mkv');
  const common = ['-hide_banner', '-loglevel', 'error', '-y'];
  await run('ffmpeg', [
    ...common, '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=24',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000',
    '-t', '60', '-map', '0:v', '-map', '1:a', '-map', '2:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a:0', 'ac3', '-ac:a:0', '6', '-c:a:1', 'aac', '-ac:a:1', '2',
    '-metadata:s:a:0', 'language=eng', '-metadata:s:a:1', 'language=fra', '-disposition:a:0', 'default', sdr,
  ]);
  await run('ffmpeg', [
    ...common, '-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=24,format=p010le',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=10', '-t', '10',
    '-c:v', 'hevc_nvenc', '-profile:v', 'main10', '-pix_fmt', 'p010le', '-tag:v', 'hvc1',
    '-bsf:v', 'hevc_metadata=colour_primaries=9:transfer_characteristics=16:matrix_coefficients=9',
    '-c:a', 'ac3', '-ac', '6', hdr,
  ]);
  return { sdr, hdr };
}

/** 25-minute 640x360 H.264 source, long enough to seek 20+ minutes ahead; encodes in a few seconds with x264 ultrafast. */
export async function generateLongSource(dir: string): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'source-long.mkv');
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '1500', '-c:v', 'libx264', '-preset', 'ultrafast',
    '-crf', '32', '-g', '48', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', file,
  ], 300_000);
  return file;
}

export interface Harness {
  app: FastifyInstance;
  db: Db;
  stub: StubGateway;
  config: Config;
  bus: EventBus;
  transcodeDir: string;
  probeCalls: string[];
  resolveCalls: string[];
  /** stream id by source key. */
  streamIds: Record<string, string>;
  close(): Promise<void>;
}

export interface HarnessOptions {
  root: string;
  sources: Record<string, { filename: string; path: string }>;
  probe?: ProbeRunner;
  /** Extra config values (TRANSCODE_MAX_GB, FFMPEG_PATH, ...). */
  env?: Record<string, string>;
  playback?: BuildAppOptions['playback'];
  prefetch?: BuildAppOptions['prefetch'];
  /** Replaces the fake TMDB (default: makeFakeTmdb). */
  tmdbFetch?: FetchLike;
  /** Receives the app's log lines (default: silent). */
  logger?: Logger;
}

/** App wired to a stub gateway whose stream URLs resolve to local files, so ffprobe/ffmpeg run for real. */
export async function bootHarness(options: HarnessOptions): Promise<Harness> {
  const keys = Object.keys(options.sources);
  const stub = await startStubGateway(() => ({
    body: { streams: keys.map((key, i) => stubStream(i, (options.sources[key] as { filename: string }).filename, { cached: true })) },
  }));
  const config = testConfig(options.root, { GATEWAY_MANIFEST_URL: stub.manifestUrl, ...options.env });
  mkdirSync(config.transcodeDir, { recursive: true });
  const db = openDatabase(config.dataDir);
  const logger = options.logger ?? createSilentLogger();
  const tmdb = new TmdbService({ config, db, logger, fetch: options.tmdbFetch ?? makeFakeTmdb().fetch });
  const gateway = new GatewayClient({
    config, db, logger, limiter: new RateLimiter({ maxRequests: 5, windowMs: 100, marginMs: 5 }), timeoutMs: 5_000,
  });

  const probeCalls: string[] = [];
  const resolveCalls: string[] = [];
  const realProbe = createFfprobeRunner('ffprobe');
  const bus = new EventBus();
  const app = await buildApp(config, {
    logger, db, tmdb, gateway, bus,
    prefetch: options.prefetch,
    playback: {
      resolveUrl: async (raw) => {
        resolveCalls.push(raw);
        const match = /token(\d+)\//.exec(raw);
        const key = keys[Number(match?.[1])];
        return (options.sources[key as string] as { path: string }).path;
      },
      probe: async (url) => {
        probeCalls.push(url);
        return (options.probe ?? realProbe)(url);
      },
      segmentWaitMs: 20_000,
      ...options.playback,
    },
  });
  await app.ready();

  const listing = (await app.inject('/api/streams/movie/278')).json() as { streams: Array<{ id: string; filename: string }> };
  const streamIds: Record<string, string> = {};
  for (const key of keys) {
    const filename = (options.sources[key] as { filename: string }).filename;
    streamIds[key] = (listing.streams.find((s) => s.filename === filename) as { id: string }).id;
  }

  return {
    app, db, stub, config, bus, transcodeDir: config.transcodeDir, probeCalls, resolveCalls, streamIds,
    close: async () => {
      await app.close();
      db.close();
      await stub.close();
    },
  };
}

export async function startSession(
  harness: Harness,
  streamKey: string,
  profile: ProfileName,
  extra: Record<string, unknown> = {},
): Promise<{ status: number; body: SessionResponse & Record<string, unknown> }> {
  const res = await harness.app.inject({
    method: 'POST',
    url: '/api/sessions',
    payload: { mediaType: 'movie', tmdbId: 278, streamId: harness.streamIds[streamKey], device: PROFILES[profile], ...extra },
  });
  return { status: res.statusCode, body: res.json() };
}

export async function fetchHls(harness: Harness, sessionId: string, file: string): Promise<{ status: number; headers: Record<string, unknown>; body: Buffer }> {
  const res = await harness.app.inject(`/hls/${sessionId}/${file}`);
  return { status: res.statusCode, headers: res.headers, body: res.rawPayload };
}

export interface ProbedStream {
  codec_type: string;
  codec_name: string;
  profile?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  color_transfer?: string;
  color_primaries?: string;
  color_space?: string;
  codec_tag_string?: string;
  channels?: number;
  start_time?: string;
  duration?: string;
}

/** ffprobes (init +) segment from the HLS route by writing them into one file. */
export async function probeSegment(
  harness: Harness,
  sessionId: string,
  segment: string,
  workDir: string,
): Promise<{ streams: ProbedStream[]; formatStart: number; formatDuration: number; firstVideoFlags: string; file: string }> {
  mkdirSync(workDir, { recursive: true });
  const seg = await fetchHls(harness, sessionId, segment);
  if (seg.status !== 200) throw new Error(`${segment} returned ${seg.status}: ${seg.body.toString()}`);
  const parts: Buffer[] = [];
  if (segment.endsWith('.m4s')) {
    const init = await fetchHls(harness, sessionId, 'init.mp4');
    if (init.status !== 200) throw new Error(`init.mp4 returned ${init.status}: ${init.body.toString()}`);
    parts.push(init.body);
  }
  parts.push(seg.body);
  const file = path.join(workDir, `${sessionId.slice(0, 8)}-${segment.replace('.m4s', '.mp4')}`);
  writeFileSync(file, Buffer.concat(parts));

  const info = JSON.parse(
    await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]),
  ) as { streams: ProbedStream[]; format: { start_time: string; duration: string } };
  const packets = await run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-read_intervals', '%+#1', '-show_entries', 'packet=flags', '-of', 'csv=p=0', file,
  ]);
  return {
    streams: info.streams,
    formatStart: Number(info.format.start_time),
    formatDuration: Number(info.format.duration),
    firstVideoFlags: packets.trim().split(/\r?\n/)[0] ?? '',
    file,
  };
}

/** Running ffmpeg processes whose command line contains `needle` (a session id), with their pids. */
export async function listFfmpegPids(needle: string): Promise<number[]> {
  const out = await run('powershell.exe', [
    '-NoProfile', '-Command',
    "Get-CimInstance Win32_Process -Filter \"Name='ffmpeg.exe'\" | ForEach-Object { \"$($_.ProcessId)|$($_.CommandLine)\" }",
  ]);
  return out
    .split(/\r?\n/)
    .filter((line) => line.includes(needle))
    .map((line) => Number(line.slice(0, line.indexOf('|'))));
}

export async function listFfmpegCommandLines(): Promise<string[]> {
  const out = await run('powershell.exe', [
    '-NoProfile', '-Command',
    "Get-CimInstance Win32_Process -Filter \"Name='ffmpeg.exe'\" | ForEach-Object { $_.CommandLine }",
  ]);
  return out.split(/\r?\n/).filter(Boolean);
}
