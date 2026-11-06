// @no-ffmpeg: fake encoders and a stubbed probe; FFMPEG_PATH points nowhere, so the subtitle extractors cannot start either.
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { ActivityResponse, SessionResponse } from '@homestream/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProbeResult, SubtitleTrackInfo } from '../../src/playback/probe.js';
import { clearSecrets } from '../../src/redact.js';
import { makeTempDir, removeDir } from '../helpers.js';
import { FakeEncoders } from './fakeEncoder.js';
import { bootHarness, fetchHls, startSession, type Harness } from './harness.js';

interface TrackOptions {
  kind?: 'text' | 'bitmap';
  title?: string;
  forced?: boolean;
  default?: boolean;
}

const sub = (index: number, language: string, options: TrackOptions = {}): SubtitleTrackInfo => ({
  index,
  codec: options.kind === 'bitmap' ? 'hdmv_pgs_subtitle' : 'subrip',
  language,
  title: options.title ?? '',
  kind: options.kind ?? 'text',
  forced: options.forced ?? false,
  default: options.default ?? false,
});

const audioTrack = (index: number, language: string) => ({ index, codec: 'eac3', channels: 6, language, title: '', default: index === 1 });

const probeOf = (audio: ProbeResult['audio'], subtitles: SubtitleTrackInfo[]): ProbeResult => ({
  durationSec: 120,
  video: { index: 0, codec: 'h264', profile: 'High', width: 1920, height: 1080, pixFmt: 'yuv420p', fps: 24, hdr: 'sdr', dolbyVisionProfile: null },
  audio,
  subtitles,
});

let root: string;
const harnesses: Harness[] = [];

beforeAll(() => {
  root = makeTempDir('default-subs');
});

afterAll(async () => {
  for (const harness of harnesses) await harness.close();
  clearSecrets();
  removeDir(root);
});

async function boot(probe: ProbeResult): Promise<{ harness: Harness; encoders: FakeEncoders }> {
  const encoders = new FakeEncoders();
  const harness = await bootHarness({
    root: makeTempDir('inst'),
    sources: { movie: { filename: 'Movie.1994.1080p.WEB-DL.x264.mkv', path: path.join(root, 'does-not-exist.mkv') } },
    probe: async () => probe,
    env: { FFMPEG_PATH: path.join(root, 'no-such-ffmpeg.exe') },
    playback: { createEncoder: encoders.create },
  });
  harnesses.push(harness);
  return { harness, encoders };
}

const SESSION_FIELDS = (body: SessionResponse) => ({ selected: body.selectedSubtitle, default: body.subtitleDefault, burn: body.decision.subtitleBurnIn });

async function master(harness: Harness, id: string): Promise<string> {
  const res = await fetchHls(harness, id, 'index.m3u8');
  expect(res.status).toBe(200);
  return res.body.toString('utf8');
}

const mediaLines = (text: string) => text.split('\n').filter((line) => line.startsWith('#EXT-X-MEDIA:'));
const defaultLines = (text: string) => mediaLines(text).filter((line) => /DEFAULT=YES|AUTOSELECT=YES/.test(line));
const md5 = (text: string) => createHash('md5').update(text).digest('hex');

async function patch(harness: Harness, id: string, payload: object) {
  const res = await harness.app.inject({ method: 'PATCH', url: `/api/sessions/${id}`, payload });
  return { status: res.statusCode, body: res.json() as SessionResponse };
}

const ENGLISH_WITH_FORCED = probeOf([audioTrack(1, 'eng')], [sub(3, 'eng', { default: true }), sub(4, 'eng', { forced: true, title: 'English Forced' }), sub(5, 'fra')]);

describe('English audio with a forced English text track', () => {
  it('starts with it selected, reports forced-english and marks only that rendition DEFAULT/AUTOSELECT/FORCED', async () => {
    const { harness, encoders } = await boot(ENGLISH_WITH_FORCED);
    const { status, body } = await startSession(harness, 'movie', 'desktop');
    expect(status).toBe(201);
    expect(SESSION_FIELDS(body)).toEqual({ selected: { index: 4, mode: 'sidecar' }, default: 'forced-english', burn: false });
    expect(encoders.started).toBe(1);

    const lines = mediaLines(await master(harness, body.sessionId));
    expect(lines).toHaveLength(3);
    const byIndex = (index: number) => lines.find((line) => line.includes(`URI="subs/${index}/index.m3u8"`)) as string;
    expect(byIndex(4)).toContain('DEFAULT=YES,AUTOSELECT=YES,FORCED=YES');
    expect(byIndex(3)).toContain('DEFAULT=NO,AUTOSELECT=NO,FORCED=NO');
    expect(byIndex(5)).toContain('DEFAULT=NO,AUTOSELECT=NO,FORCED=NO');
    expect(body.subtitleTracks.find((track) => track.index === 4)?.url).toBe(`/hls/${body.sessionId}/subs/4/index.m3u8`);
  });

  it('subtitle:null is an explicit Off and an explicit text track is not a default', async () => {
    const { harness } = await boot(ENGLISH_WITH_FORCED);
    const off = await startSession(harness, 'movie', 'desktop', { subtitle: null });
    expect(SESSION_FIELDS(off.body)).toEqual({ selected: null, default: null, burn: false });
    expect(defaultLines(await master(harness, off.body.sessionId))).toEqual([]);
    await harness.app.inject({ method: 'DELETE', url: `/api/sessions/${off.body.sessionId}` });

    const chosen = await startSession(harness, 'movie', 'p720', { subtitle: { index: 3, mode: 'sidecar' } });
    expect(SESSION_FIELDS(chosen.body)).toEqual({ selected: { index: 3, mode: 'sidecar' }, default: null, burn: false });
    expect(defaultLines(await master(harness, chosen.body.sessionId))).toEqual([]);
  });

  it('the default is also listed by GET /api/sessions/:id and /api/activity until a client chooses a subtitle', async () => {
    const { harness } = await boot(ENGLISH_WITH_FORCED);
    const { body } = await startSession(harness, 'movie', 'desktop');
    const activity = async () => ((await harness.app.inject('/api/activity')).json() as ActivityResponse).sessions[0]?.subtitleDefault;
    expect(await activity()).toBe('forced-english');

    const switched = await patch(harness, body.sessionId, { subtitle: { index: 3, mode: 'sidecar' } });
    expect(switched.status).toBe(200);
    expect(SESSION_FIELDS(switched.body)).toEqual({ selected: { index: 3, mode: 'sidecar' }, default: null, burn: false });
    expect(((await harness.app.inject(`/api/sessions/${body.sessionId}`)).json() as SessionResponse).subtitleDefault).toBeNull();
    expect(await activity()).toBeNull();
    expect(defaultLines(await master(harness, body.sessionId))).toEqual([]);
  });

  it('PATCH subtitle:null turns it off for good: a later audio PATCH does not re-apply the default', async () => {
    const { harness } = await boot(probeOf([audioTrack(1, 'eng'), audioTrack(2, 'fra')], ENGLISH_WITH_FORCED.subtitles));
    const { body } = await startSession(harness, 'movie', 'desktop');
    const off = await patch(harness, body.sessionId, { subtitle: null });
    expect(SESSION_FIELDS(off.body)).toEqual({ selected: null, default: null, burn: false });
    const audio = await patch(harness, body.sessionId, { audioIndex: 2 });
    expect(audio.status).toBe(200);
    expect(SESSION_FIELDS(audio.body)).toEqual({ selected: null, default: null, burn: false });
  });
});

describe('English audio without a forced English track', () => {
  it('starts with subtitles Off and no DEFAULT/AUTOSELECT rendition, tracks still listed', async () => {
    const { harness } = await boot(probeOf([audioTrack(1, 'eng')], [sub(3, 'eng', { default: true }), sub(4, 'eng', { title: 'SDH' }), sub(5, 'fra', { forced: true })]));
    const { status, body } = await startSession(harness, 'movie', 'desktop');
    expect(status).toBe(201);
    expect(SESSION_FIELDS(body)).toEqual({ selected: null, default: null, burn: false });
    expect(body.subtitleTracks.filter((track) => track.url)).toHaveLength(3);
    const text = await master(harness, body.sessionId);
    expect(mediaLines(text)).toHaveLength(3);
    expect(defaultLines(text)).toEqual([]);
  });
});

describe('non-English starting audio', () => {
  const FOREIGN = probeOf(
    [audioTrack(1, 'fra'), audioTrack(2, 'eng')],
    [sub(3, 'fra'), sub(4, 'eng', { title: 'English SDH' }), sub(5, 'eng', { default: true, title: 'English' }), sub(6, 'eng', { forced: true })],
  );

  it('selects the default-flagged full English track and keeps it across an audio PATCH', async () => {
    const { harness, encoders } = await boot(FOREIGN);
    const { body } = await startSession(harness, 'movie', 'desktop', { audioIndex: 1 });
    expect(SESSION_FIELDS(body)).toEqual({ selected: { index: 5, mode: 'sidecar' }, default: 'english', burn: false });
    const before = await master(harness, body.sessionId);
    expect(defaultLines(before)).toHaveLength(1);
    expect(defaultLines(before)[0]).toContain('URI="subs/5/index.m3u8"');
    expect(defaultLines(before)[0]).toContain('FORCED=NO');

    const audio = await patch(harness, body.sessionId, { audioIndex: 2 });
    expect(audio.status).toBe(200);
    expect(audio.body.selectedAudioIndex).toBe(2);
    expect(SESSION_FIELDS(audio.body)).toEqual({ selected: { index: 5, mode: 'sidecar' }, default: 'english', burn: false });
    expect(audio.body.playlistUrl).toBe(body.playlistUrl);
    expect(md5(await master(harness, body.sessionId))).toBe(md5(before));
    expect(encoders.started).toBe(2);
  });

  it('starting with the English audio track (the file default pick) follows the English rule instead: the forced English track', async () => {
    const { harness } = await boot(FOREIGN);
    const { body } = await startSession(harness, 'movie', 'desktop');
    expect(body.selectedAudioIndex).toBe(2);
    expect(SESSION_FIELDS(body)).toEqual({ selected: { index: 6, mode: 'sidecar' }, default: 'forced-english', burn: false });
  });

  it('subtitle:null stays Off for the same source and audio', async () => {
    const { harness } = await boot(FOREIGN);
    const { body } = await startSession(harness, 'movie', 'desktop', { audioIndex: 1, subtitle: null });
    expect(SESSION_FIELDS(body)).toEqual({ selected: null, default: null, burn: false });
  });

  it('forced-only English is used when nothing else matches, and its rendition is FORCED=YES', async () => {
    const { harness } = await boot(probeOf([audioTrack(1, 'jpn')], [sub(3, 'eng', { forced: true })]));
    const { body } = await startSession(harness, 'movie', 'desktop');
    expect(SESSION_FIELDS(body)).toEqual({ selected: { index: 3, mode: 'sidecar' }, default: 'english', burn: false });
    expect(defaultLines(await master(harness, body.sessionId))[0]).toContain('DEFAULT=YES,AUTOSELECT=YES,FORCED=YES');
  });

  it('undetermined audio follows the TMDB original language (English here, so the English rule applies)', async () => {
    const { harness } = await boot(probeOf([audioTrack(1, 'und')], [sub(3, 'eng'), sub(4, 'eng', { forced: true })]));
    const { body } = await startSession(harness, 'movie', 'desktop');
    expect(SESSION_FIELDS(body)).toEqual({ selected: { index: 4, mode: 'sidecar' }, default: 'forced-english', burn: false });
  });
});

describe('bitmap-only English default', () => {
  const PGS = probeOf([audioTrack(1, 'kor')], [sub(3, 'kor'), sub(4, 'eng', { kind: 'bitmap', default: true })]);

  it('is burned in at start and never appears in the master', async () => {
    const { harness, encoders } = await boot(PGS);
    const { status, body } = await startSession(harness, 'movie', 'desktop');
    expect(status).toBe(201);
    expect(SESSION_FIELDS(body)).toEqual({ selected: { index: 4, mode: 'burn' }, default: 'english', burn: true });
    expect(encoders.started).toBe(1);
    const text = await master(harness, body.sessionId);
    expect(defaultLines(text)).toEqual([]);
    expect(text).not.toContain('subs/4/');
  });

  it('PATCH subtitle:null clears the burn-in and the default', async () => {
    const { harness, encoders } = await boot(PGS);
    const { body } = await startSession(harness, 'movie', 'desktop');
    const off = await patch(harness, body.sessionId, { subtitle: null });
    expect(off.status).toBe(200);
    expect(SESSION_FIELDS(off.body)).toEqual({ selected: null, default: null, burn: false });
    expect(encoders.started).toBe(2);
  });

  it('a full English text track wins over a bitmap one: no burn-in', async () => {
    const { harness } = await boot(probeOf([audioTrack(1, 'kor')], [sub(4, 'eng', { kind: 'bitmap', default: true }), sub(5, 'eng')]));
    const { body } = await startSession(harness, 'movie', 'desktop');
    expect(SESSION_FIELDS(body)).toEqual({ selected: { index: 5, mode: 'sidecar' }, default: 'english', burn: false });
  });
});

describe('more than ten text tracks', () => {
  it('keeps the default track among the ten renditions', async () => {
    const tracks = [
      ...Array.from({ length: 11 }, (_, i) => sub(i + 1, 'eng', { title: `English ${i + 1}` })),
      sub(12, 'eng', { forced: true, title: 'English Forced' }),
    ];
    const { harness } = await boot(probeOf([audioTrack(1, 'eng')], tracks));
    const { body } = await startSession(harness, 'movie', 'desktop');
    expect(SESSION_FIELDS(body)).toEqual({ selected: { index: 12, mode: 'sidecar' }, default: 'forced-english', burn: false });
    expect(body.subtitleTracks.filter((track) => track.url)).toHaveLength(10);
    expect(body.subtitleTracks.find((track) => track.index === 12)?.url).toBe(`/hls/${body.sessionId}/subs/12/index.m3u8`);

    const lines = mediaLines(await master(harness, body.sessionId));
    expect(lines).toHaveLength(10);
    expect(defaultLines(lines.join('\n'))).toHaveLength(1);
    expect(defaultLines(lines.join('\n'))[0]).toContain('DEFAULT=YES,AUTOSELECT=YES,FORCED=YES');
    expect(defaultLines(lines.join('\n'))[0]).toContain('URI="subs/12/index.m3u8"');
  });
});
