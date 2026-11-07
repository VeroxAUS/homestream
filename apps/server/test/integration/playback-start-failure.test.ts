// @no-ffmpeg: fake encoders and a stubbed probe; nothing here starts ffmpeg or touches the GPU.
import path from 'node:path';
import type { LogEvent } from '@homestream/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { checkSessions } from '../../src/health/checks/sessions.js';
import { countSessionErrors, recentSessionErrors } from '../../src/events/query.js';
import type { BusEvent } from '../../src/events/bus.js';
import type { ProbeResult } from '../../src/playback/probe.js';
import { clearSecrets } from '../../src/redact.js';
import { makeTempDir, removeDir } from '../helpers.js';
import { FakeEncoders, type EncoderMode } from '../playback/fakeEncoder.js';
import { bootHarness, PROFILES, type Harness, type HarnessOptions } from '../playback/harness.js';

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
  subtitles: [],
};

let root: string;
const harnesses: Harness[] = [];

beforeAll(() => {
  root = makeTempDir('start-failure');
});

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.close();
});

afterAll(() => {
  clearSecrets();
  removeDir(root);
});

async function boot(
  names: string[],
  mode: EncoderMode | ((index: number) => EncoderMode),
  playback: HarnessOptions['playback'] = {},
): Promise<{ harness: Harness; encoders: FakeEncoders; events: BusEvent[] }> {
  const encoders = new FakeEncoders(mode);
  const sources = Object.fromEntries(
    names.map((name, i) => [`s${i}`, { filename: `Movie.1994.${name}.mkv`, path: path.join(root, `s${i}.mkv`) }]),
  );
  const harness = await bootHarness({
    root: makeTempDir('inst'),
    sources,
    probe: async () => PROBE,
    playback: { createEncoder: encoders.create, ...playback },
  });
  harnesses.push(harness);
  const events: BusEvent[] = [];
  harness.bus.subscribe((event) => events.push(event));
  return { harness, encoders, events };
}

const post = (harness: Harness, streamId: string) =>
  harness.app.inject({
    method: 'POST',
    url: '/api/sessions',
    payload: { mediaType: 'movie', tmdbId: 278, streamId, device: PROFILES.chromecast4k, subtitle: null },
  });

const plays = (harness: Harness) =>
  harness.db.prepare('SELECT session_id AS sessionId, status, error_message AS message FROM plays').all();

function sessionsCheck(harness: Harness) {
  return checkSessions({
    active: () => 0,
    fallingBehind: () => [],
    recentErrors: () => ({
      count: countSessionErrors(harness.db, 0),
      latest: recentSessionErrors(harness.db, 0),
    }),
  });
}

async function expectRecordedFailure(harness: Harness, events: BusEvent[], code: string): Promise<void> {
  const rows = plays(harness) as Array<{ sessionId: string; status: string; message: string }>;
  expect(rows).toHaveLength(1);
  const [row] = rows;
  expect(row).toMatchObject({ status: 'error', message: expect.any(String) });
  expect(row?.message).not.toMatch(/https?:|\.mkv/);

  const logs = (await harness.app.inject('/api/logs?level=error&source=ffmpeg')).json() as { events: LogEvent[] };
  expect(logs.events).toHaveLength(1);
  expect(logs.events[0]).toMatchObject({ level: 'error', source: 'ffmpeg', sessionId: row?.sessionId });
  expect(JSON.stringify(logs.events[0]?.details)).toContain(code);

  expect(events.filter((event) => event.type === 'session.update' && event.data.state === 'error')).toMatchObject([
    { data: { sessionId: row?.sessionId, state: 'error', error: { message: row?.message } } },
  ]);
  expect(events.some((event) => event.type === 'session.start')).toBe(false);

  const health = sessionsCheck(harness);
  expect(health.status).toBe('warn');
  expect(health.hint).toEqual(expect.any(String));
  expect(harness.app.ctx.playback.list()).toEqual([]);
}

describe('a start that fails for good', () => {
  it('records an explicit stream whose encoder failed twice as an error play, error log, session.update and health warning', async () => {
    const { harness, encoders, events } = await boot(['1080p.WEB-DL.x264-A'], 'fail');

    const res = await post(harness, harness.streamIds.s0 as string);

    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: { code: 'encoder_failed', hint: expect.any(String) } });
    expect(encoders.started).toBe(2);
    await expectRecordedFailure(harness, events, 'encoder_failed');
  });

  it('records an explicit stream whose encoder never produced a segment', async () => {
    const { harness, events } = await boot(['1080p.WEB-DL.x264-A'], 'hang', { firstSegmentWaitMs: 300 });

    const res = await post(harness, harness.streamIds.s0 as string);

    expect(res.statusCode).toBe(504);
    await expectRecordedFailure(harness, events, 'encoder_timeout');
  });

  it('keeps the failed candidates of an automatic start quiet: no play row, no error log, no health warning', async () => {
    const { harness, encoders, events } = await boot(
      ['1080p.WEB-DL.x264-A', '1080p.WEB-DL.x264-B', '1080p.WEB-DL.x264-C'],
      (index) => (index < 4 ? 'fail' : 'run'),
    );

    const res = await post(harness, 'auto');

    expect(res.statusCode).toBe(201);
    expect(encoders.started).toBe(5);
    expect(plays(harness)).toEqual([{ sessionId: res.json().sessionId, status: 'ok', message: null }]);
    expect(countSessionErrors(harness.db, 0)).toBe(0);
    expect(sessionsCheck(harness).status).toBe('ok');
    expect(events.filter((event) => event.type === 'session.update' && event.data.state === 'error')).toEqual([]);
  });
});

describe('a candidate stopped by the memory watchdog before its first segment', () => {
  const NAMES = ['1080p.WEB-DL.x264-A', '1080p.WEB-DL.x264-B', '1080p.WEB-DL.x264-C'];

  it('stays quiet when the next candidate plays: no error log, event, state error update or health warning', async () => {
    const { harness, encoders, events } = await boot(NAMES, (index) => (index === 0 ? 'memory' : 'run'));

    const res = await post(harness, 'auto');

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      streamId: harness.streamIds.s1,
      attempts: [{ streamId: harness.streamIds.s0, code: 'encoder_memory_limit' }],
    });
    expect(encoders.started).toBe(2);
    expect(encoders.handles[0]?.running).toBe(false);
    expect(encoders.handles[0]?.stopCalls.length).toBeGreaterThan(0);
    expect(plays(harness)).toEqual([{ sessionId: res.json().sessionId, status: 'ok', message: null }]);
    expect(harness.db.prepare("SELECT COUNT(*) AS n FROM events WHERE level = 'error'").get()).toEqual({ n: 0 });
    expect(((await harness.app.inject('/api/logs?level=error')).json() as { events: LogEvent[] }).events).toEqual([]);
    expect(countSessionErrors(harness.db, 0)).toBe(0);
    expect(sessionsCheck(harness).status).toBe('ok');
    expect(events.filter((event) => event.type === 'session.update' && event.data.state === 'error')).toEqual([]);
  });

  it('is still recorded as encoder_memory_limit for an explicit stream', async () => {
    const { harness, encoders, events } = await boot(NAMES, 'memory');

    const res = await post(harness, harness.streamIds.s0 as string);

    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: { code: 'encoder_memory_limit', hint: expect.any(String) } });
    expect(encoders.handles[0]?.running).toBe(false);
    await expectRecordedFailure(harness, events, 'encoder_memory_limit');
  });

  it('is reported once when every automatic candidate hit the limit', async () => {
    const { harness, encoders, events } = await boot(NAMES, 'memory');

    const res = await post(harness, 'auto');

    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: { code: 'all_streams_failed' } });
    expect(encoders.started).toBe(3);
    expect(encoders.handles.every((handle) => !handle.running)).toBe(true);
    await expectRecordedFailure(harness, events, 'encoder_memory_limit');
  });
});
