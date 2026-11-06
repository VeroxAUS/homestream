// @no-ffmpeg: fake encoders that read the source proxy over HTTP and a stubbed probe; nothing here starts ffmpeg or touches the GPU.
import { writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { EncoderExit, EncoderHandle, EncoderProcessOptions } from '../../src/playback/encoderProcess.js';
import type { ProbeResult } from '../../src/playback/probe.js';
import { clearSecrets } from '../../src/redact.js';
import { makeTempDir, removeDir } from '../helpers.js';
import { startStubCdn, type StubCdn } from '../sourceproxy/stubCdn.js';
import { bootHarness, PROFILES, type Harness } from '../playback/harness.js';

const MB = 1024 * 1024;
const SHUTDOWN_LIMIT_MS = 10_000;
const PROBE: ProbeResult = {
  durationSec: 3600,
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
  subtitles: [],
};

/** Reads the source through the loopback proxy like ffmpeg does (one open range request), and writes the first segment. */
class ReadingEncoder implements EncoderHandle {
  readonly pid = undefined;
  running = true;
  readonly exited: Promise<EncoderExit>;
  private finish!: (exit: EncoderExit) => void;
  private readonly request: http.ClientRequest;

  constructor(options: EncoderProcessOptions) {
    this.exited = new Promise((resolve) => {
      this.finish = resolve;
    });
    const arg = (name: string): string | undefined => options.args[options.args.indexOf(name) + 1];
    const extension = path.extname(arg('-hls_segment_filename') ?? 'seg-%d.ts');
    this.request = http.get(
      arg('-i') as string,
      { headers: { Range: 'bytes=0-' }, agent: new http.Agent({ keepAlive: true }) },
      (res) => {
        res.on('data', () => undefined);
        res.on('error', () => undefined);
        writeFileSync(path.join(options.cwd, `seg-${arg('-start_number') ?? '0'}${extension}`), 'segment');
      },
    );
    this.request.on('error', () => undefined);
  }

  stop(): Promise<void> {
    if (this.running) {
      this.running = false;
      this.request.destroy();
      this.finish({ code: 0, signal: null, stderrTail: '' });
    }
    return Promise.resolve();
  }
}

interface Rig {
  harness: Harness;
  cdn: StubCdn;
  port: number;
  agent: http.Agent;
  call(method: string, url: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }>;
  openEventStream(): http.ClientRequest;
}

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  clearSecrets();
});

async function boot(): Promise<Rig> {
  const root = makeTempDir('shutdown');
  const cdn = await startStubCdn({ size: 400 * MB });
  const harness = await bootHarness({
    root,
    sources: { movie: { filename: 'Movie.1994.1080p.WEB-DL.x264.mkv', path: 'unused' } },
    probe: async () => PROBE,
    env: { MAX_DOWNLOAD_MBPS: '20' },
    playback: { resolveUrl: async () => cdn.url, createEncoder: (options) => new ReadingEncoder(options) },
  });
  cleanups.push(async () => {
    await harness.app.close().catch(() => undefined);
    await harness.close().catch(() => undefined);
    await cdn.close();
    removeDir(root);
  });
  await harness.app.listen({ port: 0, host: '127.0.0.1' });
  const port = (harness.app.server.address() as { port: number }).port;
  const agent = new http.Agent({ keepAlive: true });
  cleanups.push(() => agent.destroy());

  const call: Rig['call'] = (method, url, body) =>
    new Promise((resolve, reject) => {
      const request = http.request(
        {
          host: '127.0.0.1',
          port,
          path: url,
          method,
          agent,
          headers: body ? { 'content-type': 'application/json' } : {},
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString();
            resolve({
              status: res.statusCode ?? 0,
              body: text.startsWith('{') ? (JSON.parse(text) as Record<string, unknown>) : {},
            });
          });
        },
      );
      request.on('error', reject);
      request.end(body ? JSON.stringify(body) : undefined);
    });

  const openEventStream = (): http.ClientRequest => {
    const request = http.get({ host: '127.0.0.1', port, path: '/api/events', agent: false }, (res) => {
      res.on('data', () => undefined);
      res.on('error', () => undefined);
    });
    request.on('error', () => undefined);
    cleanups.push(() => {
      request.destroy();
    });
    return request;
  };

  return { harness, cdn, port, agent, call, openEventStream };
}

async function startCappedSession(rig: Rig): Promise<string> {
  const started = await rig.call('POST', '/api/sessions', {
    mediaType: 'movie',
    tmdbId: 278,
    streamId: rig.harness.streamIds.movie,
    device: PROFILES.desktop,
  });
  expect(started.status).toBe(201);
  // Let the encoder read until the 20 Mbps cap is what limits it.
  const deadline = Date.now() + 8000;
  while (rig.harness.app.ctx.sourceProxy.network().limitedForSec <= 0) {
    if (Date.now() > deadline) throw new Error('the download cap never became the limit');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return started.body.sessionId as string;
}

async function timedClose(rig: Rig): Promise<number> {
  const startedAt = Date.now();
  await rig.harness.app.close();
  return Date.now() - startedAt;
}

describe('server shutdown', () => {
  it('completes within 10 s after a capped session ended, with an event stream client still connected', async () => {
    const rig = await boot();
    rig.openEventStream();
    const id = await startCappedSession(rig);
    expect((await rig.call('DELETE', `/api/sessions/${id}`)).status).toBe(200);
    expect(rig.harness.app.ctx.playback.list()).toHaveLength(0);

    expect(await timedClose(rig)).toBeLessThan(SHUTDOWN_LIMIT_MS);
  }, 40_000);

  it('completes within 10 s with a capped session still playing and keep-alive clients connected', async () => {
    const rig = await boot();
    rig.openEventStream();
    rig.openEventStream();
    await startCappedSession(rig);
    expect((await rig.call('GET', '/api/activity')).status).toBe(200);

    expect(await timedClose(rig)).toBeLessThan(SHUTDOWN_LIMIT_MS);
    expect(rig.harness.app.ctx.playback.list()).toHaveLength(0);
  }, 40_000);
});
