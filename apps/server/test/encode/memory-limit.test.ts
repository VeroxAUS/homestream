import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clearSecrets } from '../../src/redact.js';
import { makeTempDir, removeDir } from '../helpers.js';
import { bootHarness, fetchHls, generateLongSource, listFfmpegCommandLines, startSession, type Harness } from '../playback/harness.js';

const TIMEOUT = 120_000;

let root: string;
let source: string;
let harness: Harness;

beforeAll(async () => {
  root = makeTempDir('memory-limit');
  source = await generateLongSource(path.join(root, 'sources'));
  harness = await bootHarness({
    root: makeTempDir('inst'),
    sources: { movie: { filename: 'Movie.1994.1080p.WEB-DL.x264.mkv', path: source } },
    // Every ffmpeg is above 1 MiB of working set, so the watchdog fires on its first sample.
    env: { FFMPEG_MAX_RSS_MB: '1' },
  });
}, TIMEOUT);

afterAll(async () => {
  await harness.close();
  clearSecrets();
  removeDir(root);
});

describe('memory watchdog in a session', () => {
  it('ends the session with encoder_memory_limit, records an error event and leaves no ffmpeg behind', async () => {
    const { status, body } = await startSession(harness, 'movie', 'chromecast4k');
    expect(status).toBe(201);

    let session: { state: string; error: { message: string; hint?: string } | null } = { state: 'starting', error: null };
    const deadline = Date.now() + 30_000;
    while (session.state !== 'error' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      session = (await harness.app.inject(`/api/sessions/${body.sessionId}`)).json();
    }
    expect(session.state).toBe('error');
    expect(session.error?.message).toMatch(/memory/i);
    expect(session.error?.hint).toBeTruthy();

    const segment = await fetchHls(harness, body.sessionId, 'seg-40.m4s');
    expect(segment.status).toBe(502);
    expect((JSON.parse(segment.body.toString()) as { error: { code: string } }).error.code).toBe('encoder_memory_limit');

    const events = harness.db
      .prepare("SELECT level, source, details_json FROM events WHERE session_id = ? AND level = 'error'")
      .all(body.sessionId) as Array<{ level: string; source: string; details_json: string }>;
    expect(events).toHaveLength(1);
    expect(events[0]?.source).toBe('ffmpeg');
    expect(JSON.parse(events[0]?.details_json as string)).toMatchObject({ code: 'encoder_memory_limit', limitMb: 1 });

    await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${body.sessionId}` });
    const left = (await listFfmpegCommandLines()).filter((line) => line.includes(body.sessionId));
    expect(left).toEqual([]);
  }, TIMEOUT);
});
