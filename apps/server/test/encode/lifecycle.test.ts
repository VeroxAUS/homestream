import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { ActivityResponse } from '@homestream/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BusEvent } from '../../src/events/bus.js';
import { clearSecrets } from '../../src/redact.js';
import { makeTempDir, removeDir } from '../helpers.js';
import {
  bootHarness,
  generateLongSource,
  generateSources,
  listFfmpegCommandLines,
  probeSegment,
  run,
  startSession,
  type Harness,
  type HarnessOptions,
} from '../playback/harness.js';

const TIMEOUT = 180_000;

let root: string;
let work: string;
let sources: { sdr: string; long: string };
const harnesses: Harness[] = [];

beforeAll(async () => {
  root = makeTempDir('lifecycle');
  work = path.join(root, 'work');
  const generated = await generateSources(path.join(root, 'sources'));
  sources = { sdr: generated.sdr, long: await generateLongSource(path.join(root, 'sources')) };
}, TIMEOUT);

afterAll(async () => {
  for (const harness of harnesses) await harness.close();
  clearSecrets();
  removeDir(root);
});

async function boot(options: Partial<HarnessOptions> & { source?: 'long' | 'sdr' } = {}): Promise<Harness> {
  const { source = 'long', ...rest } = options;
  const harness = await bootHarness({
    root: makeTempDir('inst'),
    sources: { movie: { filename: 'Movie.1994.1080p.WEB-DL.x264.mkv', path: sources[source] } },
    ...rest,
  });
  harnesses.push(harness);
  return harness;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function sessionFfmpegCount(sessionId: string): Promise<number> {
  return (await listFfmpegCommandLines()).filter((line) => line.includes(sessionId)).length;
}

async function timedProbe(harness: Harness, sessionId: string, segment: string) {
  const started = Date.now();
  const probed = await probeSegment(harness, sessionId, segment, work);
  const seconds = (Date.now() - started) / 1000;
  const video = probed.streams.find((stream) => stream.codec_type === 'video');
  return { seconds, start: Number(video?.start_time), duration: probed.formatDuration - Number(video?.start_time) };
}

async function getSession(harness: Harness, sessionId: string) {
  return (await harness.app.inject(`/api/sessions/${sessionId}`)).json();
}

async function waitForEncoder(harness: Harness, sessionId: string, done: (encoder: { outTimeSec: number; headSegment: number }) => boolean) {
  const deadline = Date.now() + 5000;
  for (;;) {
    const encoder = (await getSession(harness, sessionId)).encoder;
    if (done(encoder) || Date.now() > deadline) return encoder;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function dirSize(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    try {
      total += entry.isDirectory() ? dirSize(full) : statSync(full).size;
    } catch (error) {
      // The server deletes segments and ffmpeg renames playlist temp files while this walks the directory.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return total;
}

describe('seeking', () => {
  it('restarts at a segment 20 minutes ahead within a few seconds, keeps one ffmpeg, then seeks backward', async () => {
    const harness = await boot();
    const { body } = await startSession(harness, 'movie', 'chromecast4k');
    expect(body.durationSec).toBeGreaterThan(1400);
    await probeSegment(harness, body.sessionId, 'seg-0.m4s', work);

    for (const target of [300, 150, 340]) {
      const far = await timedProbe(harness, body.sessionId, `seg-${target}.m4s`);
      expect(far.seconds, `seg-${target}`).toBeLessThan(7);
      expect(far.start).toBeCloseTo(target * 4, 1);
      expect(far.duration).toBeCloseTo(4, 1);
      expect(await sessionFfmpegCount(body.sessionId)).toBe(1);
      for (const next of [target + 1, target + 2]) {
        const follow = await timedProbe(harness, body.sessionId, `seg-${next}.m4s`);
        expect(follow.seconds).toBeLessThan(3);
      }
      const stats = await waitForEncoder(harness, body.sessionId, (encoder) => encoder.outTimeSec >= target * 4);
      expect(stats.outTimeSec).toBeGreaterThanOrEqual(target * 4);
      expect(stats.headSegment).toBeGreaterThanOrEqual(target);
    }

    const back = await timedProbe(harness, body.sessionId, 'seg-5.m4s');
    expect(back.seconds).toBeLessThan(7);
    expect(back.start).toBeCloseTo(20, 1);
    expect((await timedProbe(harness, body.sessionId, 'seg-6.m4s')).seconds).toBeLessThan(3);
    expect(await sessionFfmpegCount(body.sessionId)).toBe(1);

    await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${body.sessionId}` });
    expect(await sessionFfmpegCount(body.sessionId)).toBe(0);
  }, TIMEOUT);

  it('starts encoding at startPositionSec and still lists every segment', async () => {
    const harness = await boot();
    const { body } = await startSession(harness, 'movie', 'chromecast4k', { startPositionSec: 600 });
    expect(body.startPositionSec).toBe(600);
    const first = await timedProbe(harness, body.sessionId, 'seg-150.m4s');
    expect(first.start).toBeCloseTo(600, 1);
    expect(first.seconds).toBeLessThan(10);
    const playlist = (await harness.app.inject(`/hls/${body.sessionId}/video.m3u8`)).body;
    expect(playlist.match(/seg-\d+\.m4s/g)).toHaveLength(Math.ceil(body.durationSec / 4));
    expect(playlist).toContain('seg-0.m4s');
    expect(existsSync(path.join(harness.transcodeDir, body.sessionId, 'seg-0.m4s'))).toBe(false);
    await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${body.sessionId}` });
  }, TIMEOUT);
});

describe('encoder stats, activity and events', () => {
  it('reports fps, speed, bitrate, outTime and head on the session, in activity and in session.update events', async () => {
    const harness = await boot({ playback: { monitorTickMs: 300 } });
    const events: BusEvent[] = [];
    harness.bus.subscribe((event) => events.push(event));
    const empty = (await harness.app.inject('/api/activity')).json() as ActivityResponse;
    expect(empty).toEqual({ sessions: [] });

    const { body } = await startSession(harness, 'movie', 'chromecast4k');
    await probeSegment(harness, body.sessionId, 'seg-6.m4s', work);
    await sleep(1500);
    const first = (await getSession(harness, body.sessionId)).encoder;
    await sleep(3000);
    const second = await getSession(harness, body.sessionId);

    expect(second.state).toMatch(/ready|playing/);
    for (const key of ['fps', 'speed', 'bitrateKbps', 'outTimeSec', 'headSegment']) expect(typeof second.encoder[key]).toBe('number');
    expect(second.encoder.fps).toBeGreaterThan(0);
    expect(second.encoder.speed).toBeGreaterThan(0);
    expect(second.encoder.bitrateKbps).toBeGreaterThan(0);
    expect(second.encoder.outTimeSec).toBeGreaterThan(first.outTimeSec);
    expect(second.encoder.headSegment).toBeGreaterThan(first.headSegment);

    const activity = (await harness.app.inject('/api/activity')).json() as ActivityResponse;
    expect(activity.sessions).toHaveLength(1);
    expect(activity.sessions[0]).toMatchObject({
      sessionId: body.sessionId,
      mediaKey: 'movie:278',
      deviceName: 'Val Chromecast',
      deviceKind: 'tv',
      durationSec: body.durationSec,
      decision: { videoCodec: 'hevc' },
    });
    expect(Object.keys(activity.sessions[0]?.encoder ?? {}).sort()).toEqual(['bitrateKbps', 'fps', 'headSegment', 'outTimeSec', 'speed']);

    const types = events.map((event) => event.type);
    expect(types).toContain('session.start');
    const updates = events.filter((event) => event.type === 'session.update' && event.data.sessionId === body.sessionId);
    expect(updates.length).toBeGreaterThanOrEqual(3);
    expect(updates.at(-1)?.data).toMatchObject({ state: expect.stringMatching(/ready|playing/), encoder: { headSegment: expect.any(Number) } });

    await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${body.sessionId}` });
    expect(events.find((event) => event.type === 'session.end')?.data).toMatchObject({ sessionId: body.sessionId, reason: 'stopped' });
    expect(((await harness.app.inject('/api/activity')).json() as ActivityResponse).sessions).toEqual([]);
  }, TIMEOUT);
});

describe('idle timeout', () => {
  it('stops a session without requests but not one that keeps pinging', async () => {
    const harness = await boot({ playback: { idleTimeoutMs: 3000, monitorTickMs: 300 } });
    const events: BusEvent[] = [];
    harness.bus.subscribe((event) => events.push(event));
    const idle = (await startSession(harness, 'movie', 'chromecast4k')).body;
    const pinged = (await startSession(harness, 'movie', 'desktop')).body;
    await probeSegment(harness, idle.sessionId, 'seg-0.m4s', work);
    await probeSegment(harness, pinged.sessionId, 'seg-0.ts', work);

    for (let i = 0; i < 20; i += 1) {
      await sleep(400);
      // Polling the session does not count as activity; progress pings do.
      await getSession(harness, idle.sessionId).catch(() => undefined);
      harness.app.ctx.playback.ping(pinged.sessionId, { positionSec: 4, state: 'playing' });
    }

    expect((await harness.app.inject(`/api/sessions/${idle.sessionId}`)).statusCode).toBe(404);
    expect((await harness.app.inject(`/api/sessions/${pinged.sessionId}`)).statusCode).toBe(200);
    expect(existsSync(path.join(harness.transcodeDir, idle.sessionId))).toBe(false);
    expect(await sessionFfmpegCount(idle.sessionId)).toBe(0);
    expect(events.find((event) => event.type === 'session.end' && event.data.sessionId === idle.sessionId)?.data).toMatchObject({ reason: 'idle' });
    const row = harness.db.prepare("SELECT level, message FROM events WHERE source = 'session' AND session_id = ? AND message LIKE '%without activity%'").get(idle.sessionId);
    expect(row).toMatchObject({ level: 'info' });
    const play = harness.db.prepare('SELECT status, ended_at FROM plays WHERE session_id = ?').get(idle.sessionId) as { status: string; ended_at: number | null };
    expect(play).toMatchObject({ status: 'ok', ended_at: expect.any(Number) });

    await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${pinged.sessionId}` });
  }, TIMEOUT);
});

describe('session limit', () => {
  it('answers 429 with a hint for a session over the limit and accepts one again after a stop', async () => {
    const harness = await boot({ playback: { maxSessions: 2 } });
    const first = await startSession(harness, 'movie', 'chromecast4k');
    const second = await startSession(harness, 'movie', 'desktop');
    expect([first.status, second.status]).toEqual([201, 201]);

    const third = await startSession(harness, 'movie', 'emulator');
    expect(third.status).toBe(429);
    expect(third.body).toMatchObject({ error: { code: 'too_many_sessions', message: expect.stringContaining('2'), hint: expect.any(String) } });

    await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${first.body.sessionId}` });
    const again = await startSession(harness, 'movie', 'emulator');
    expect(again.status).toBe(201);
    await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${again.body.sessionId}` });
    await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${second.body.sessionId}` });
  }, TIMEOUT);

  it('counts concurrent session starts that are still preparing', async () => {
    const harness = await boot({ playback: { maxSessions: 2 } });
    const results = await Promise.all(['chromecast4k', 'desktop', 'emulator'].map((profile) => startSession(harness, 'movie', profile as 'desktop')));
    expect(results.map((result) => result.status).sort()).toEqual([201, 201, 429]);
    for (const result of results) {
      if (result.status === 201) await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${result.body.sessionId}` });
    }
  }, TIMEOUT);
});

describe('ffmpeg failure', () => {
  it('retries once, then ends in state error with a hint, an error event and a failed play record', async () => {
    const wrapperDir = path.join(root, 'wrapper');
    const exe = path.join(wrapperDir, 'failing-ffmpeg.exe');
    const counter = path.join(wrapperDir, 'count.txt');
    await buildFailingFfmpeg(exe, counter);

    const harness = await boot({ source: 'sdr', env: { FFMPEG_PATH: exe } });
    const events: BusEvent[] = [];
    harness.bus.subscribe((event) => events.push(event));
    const { body } = await startSession(harness, 'movie', 'chromecast4k');
    expect(body.state).toBe('starting');

    let session = await getSession(harness, body.sessionId);
    for (let i = 0; i < 100 && session.state !== 'error'; i += 1) {
      await sleep(200);
      session = await getSession(harness, body.sessionId);
    }
    expect(session.state).toBe('error');
    expect(session.error).toMatchObject({ message: expect.any(String), hint: expect.any(String) });
    expect(session.error.message).not.toMatch(/https?:|\.mkv|\\/);
    await sleep(500);
    expect(readCounter(counter)).toBe(2);

    const play = harness.db.prepare('SELECT status, error_message, ended_at FROM plays WHERE session_id = ?').get(body.sessionId) as Record<string, unknown>;
    expect(play).toMatchObject({ status: 'error', error_message: session.error.message, ended_at: expect.any(Number) });
    const logged = harness.db.prepare("SELECT level, source, message FROM events WHERE session_id = ? AND level = 'error'").all(body.sessionId);
    expect(logged).toEqual([{ level: 'error', source: 'ffmpeg', message: session.error.message }]);
    expect(events.some((event) => event.type === 'log' && event.data.level === 'error' && event.data.sessionId === body.sessionId)).toBe(true);
    expect(events.some((event) => event.type === 'session.update' && event.data.state === 'error' && event.data.sessionId === body.sessionId)).toBe(true);

    expect(((await harness.app.inject('/api/activity')).json() as ActivityResponse).sessions).toEqual([]);
    const segment = await harness.app.inject(`/hls/${body.sessionId}/seg-3.m4s`);
    expect(segment.statusCode).toBe(502);
    expect(segment.json().error).toMatchObject({ code: 'encoder_failed', hint: expect.any(String) });

    await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${body.sessionId}` });
    expect(harness.db.prepare('SELECT status FROM plays WHERE session_id = ?').get(body.sessionId)).toMatchObject({ status: 'error' });
    expect(existsSync(path.join(harness.transcodeDir, body.sessionId))).toBe(false);
  }, TIMEOUT);
});

async function buildFailingFfmpeg(exe: string, counter: string): Promise<void> {
  const source = `
using System;
using System.IO;
class W {
  static int Main(string[] args) {
    File.AppendAllText(@"${counter}", "x\\n");
    Console.Error.WriteLine("simulated encoder failure while reading https://cdn.example.test/file?token=abc123456789");
    return 1;
  }
}`;
  const script = `Add-Type -TypeDefinition @'\n${source}\n'@ -OutputAssembly '${exe}' -OutputType ConsoleApplication`;
  await run('powershell.exe', ['-NoProfile', '-Command', `New-Item -ItemType Directory -Force '${path.dirname(exe)}' | Out-Null; ${script}`], 120_000);
}

function readCounter(file: string): number {
  return existsSync(file) ? readFileSync(file, 'utf8').split('x').length - 1 : 0;
}

describe('transcode disk cap', () => {
  it('parks the encoder before the cap, keeps the head servable, and resumes when the player catches up', async () => {
    const capGb = 0.05;
    const capBytes = capGb * 1024 ** 3;
    const harness = await boot({ env: { TRANSCODE_MAX_GB: String(capGb) }, playback: { monitorTickMs: 300 } });
    const { body } = await startSession(harness, 'movie', 'chromecast4k');
    await probeSegment(harness, body.sessionId, 'seg-0.m4s', work);
    const dir = path.join(harness.transcodeDir, body.sessionId);

    let maxSize = 0;
    let parked = false;
    // The cap is reached after tens of seconds of encoding when the machine is busy with other test files.
    for (let i = 0; i < 400 && !parked; i += 1) {
      await sleep(300);
      maxSize = Math.max(maxSize, dirSize(dir));
      parked = (await sessionFfmpegCount(body.sessionId)) === 0;
    }
    expect(parked).toBe(true);
    await sleep(1500);
    maxSize = Math.max(maxSize, dirSize(dir));
    expect(maxSize).toBeLessThan(capBytes);

    const head = (await getSession(harness, body.sessionId)).encoder.headSegment;
    const last = (await harness.app.inject(`/hls/${body.sessionId}/seg-${head - 2}.m4s`)).statusCode;
    expect(last).toBe(200);
    expect(await sessionFfmpegCount(body.sessionId)).toBe(0);

    const next = await timedProbe(harness, body.sessionId, `seg-${head + 60}.m4s`);
    expect(next.start).toBeCloseTo((head + 60) * 4, 1);
    expect(await sessionFfmpegCount(body.sessionId)).toBe(1);

    await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${body.sessionId}` });
    expect(readdirSync(harness.transcodeDir)).toEqual([]);
  }, TIMEOUT);
});

describe('no residue', () => {
  it('leaves no ffmpeg processes or session directories after all sessions ended', async () => {
    // Deleting a session directory and reaping its ffmpeg finish a moment after the DELETE answer on a busy machine.
    const deadline = Date.now() + 15_000;
    const residue = async (): Promise<string[]> => {
      const commands = await listFfmpegCommandLines();
      return harnesses.flatMap((harness) => [
        ...readdirSync(harness.transcodeDir),
        ...commands.filter((line) => line.includes(harness.transcodeDir)),
      ]);
    };
    while ((await residue()).length > 0 && Date.now() < deadline) await sleep(300);
    expect(await residue()).toEqual([]);
  }, TIMEOUT);
});
