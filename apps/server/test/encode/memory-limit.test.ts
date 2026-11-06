import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clearSecrets } from '../../src/redact.js';
import { makeTempDir, removeDir } from '../helpers.js';
import { bootHarness, generateLongSource, listFfmpegCommandLines, startSession, type Harness } from '../playback/harness.js';

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
  it('fails the start with encoder_memory_limit, records an error event and leaves no ffmpeg, session or play record behind', async () => {
    const before = new Set((await listFfmpegCommandLines()).filter((line) => line.includes(harness.transcodeDir)));
    const { status, body } = await startSession(harness, 'movie', 'chromecast4k');
    if (status === 502) {
      expect(body).toMatchObject({ error: { code: 'encoder_memory_limit', message: expect.stringMatching(/memory/i), hint: expect.any(String) } });
    } else {
      // The first segment can win the race against the watchdog's first one-second sample; the session then fails while playing.
      expect(status).toBe(201);
      const sessionId = body.sessionId;
      let session: { state: string; error: { message: string } | null } = { state: 'starting', error: null };
      const deadline = Date.now() + 30_000;
      while (session.state !== 'error' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        session = (await harness.app.inject(`/api/sessions/${sessionId}`)).json();
      }
      expect(session.state).toBe('error');
      expect(session.error?.message).toMatch(/memory/i);
      await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${sessionId}` });
    }

    const events = harness.db
      .prepare("SELECT level, source, details_json FROM events WHERE level = 'error'")
      .all() as Array<{ level: string; source: string; details_json: string }>;
    expect(events).toHaveLength(1);
    expect(events[0]?.source).toBe('ffmpeg');
    expect(JSON.parse(events[0]?.details_json as string)).toMatchObject({ code: 'encoder_memory_limit', limitMb: 1 });

    expect(harness.app.ctx.playback.list()).toEqual([]);
    expect(harness.db.prepare('SELECT COUNT(*) AS n FROM plays').get()).toEqual({ n: status === 502 ? 0 : 1 });
    const left = (await listFfmpegCommandLines()).filter((line) => line.includes(harness.transcodeDir) && !before.has(line));
    expect(left).toEqual([]);
  }, TIMEOUT);
});
