import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { covers, firstGap, mergeIntervals } from '../../src/playback/intervals.js';
import {
  generateMasterPlaylist,
  generateSubtitlePlaylist,
  parseHlsFileName,
  parseSubtitleFullName,
  parseSubtitleSegmentName,
  renditionName,
} from '../../src/playback/playlist.js';
import type { SubtitleTrackInfo } from '../../src/playback/probe.js';
import { MAX_TEXT_SUBTITLES, selectTextTracks } from '../../src/playback/subtitleExtractor.js';
import { EXTRACTOR_MARKER, buildExtractArgs, parseCoverHead, parseCoverTimebase } from '../../src/playback/subtitleRun.js';
import { SubtitleStore } from '../../src/playback/subtitleStore.js';
import {
  formatVttTime,
  parseCueBlock,
  parseVttTime,
  renderFull,
  renderSegment,
  takeCueBlocks,
  type Cue,
} from '../../src/playback/vtt.js';

const cue = (startMs: number, endMs: number, text = 'Hello', settings = ''): Cue => ({ startMs, endMs, text, settings });

describe('WebVTT time', () => {
  it('parses both the short and the long form', () => {
    expect(parseVttTime('00:02.500')).toBe(2500);
    expect(parseVttTime('59:59.999')).toBe(3_599_999);
    expect(parseVttTime('01:00:00.000')).toBe(3_600_000);
    expect(parseVttTime('02:03:04.005')).toBe(7_384_005);
    expect(parseVttTime('nonsense')).toBeNull();
    expect(parseVttTime('1.5')).toBeNull();
  });

  it('always writes HH:MM:SS.mmm', () => {
    expect(formatVttTime(0)).toBe('00:00:00.000');
    expect(formatVttTime(2500)).toBe('00:00:02.500');
    expect(formatVttTime(3_723_004)).toBe('01:02:03.004');
    expect(formatVttTime(-5)).toBe('00:00:00.000');
  });
});

describe('cue parsing', () => {
  it('reads cues in ffmpeg short form with an identifier, settings and multiple lines', () => {
    const parsed = parseCueBlock('7\n00:10.000 --> 00:12.500 line:90%\nfirst\nsecond');
    expect(parsed).toEqual({ startMs: 10_000, endMs: 12_500, text: 'first\nsecond', settings: 'line:90%' });
  });

  it('skips the header, notes and empty cues', () => {
    expect(parseCueBlock('WEBVTT')).toBeNull();
    expect(parseCueBlock('NOTE hi')).toBeNull();
    expect(parseCueBlock('00:01.000 --> 00:02.000\n')).toBeNull();
  });

  it('only takes blocks that are closed by a blank line and hands back the tail', () => {
    const first = takeCueBlocks('WEBVTT\n\n00:01.000 --> 00:02.000\none\n\n00:03.000 --> 00:04.0');
    expect(first.cues).toEqual([cue(1000, 2000, 'one')]);
    expect(first.rest).toBe('00:03.000 --> 00:04.0');
    const second = takeCueBlocks(`${first.rest}00\ntwo\n\n`);
    expect(second.cues).toEqual([cue(3000, 4000, 'two')]);
  });

  it('takes the newest cue as soon as its line ends, because ffmpeg adds the blank line only with the next cue', () => {
    const taken = takeCueBlocks('WEBVTT\n\n00:01.000 --> 00:02.000\none\n\n00:30.000 --> 00:34.000\nlast\nline\n');
    expect(taken.cues).toEqual([cue(1000, 2000, 'one'), cue(30_000, 34_000, 'last\nline')]);
    expect(taken.rest).toBe('');
    expect(takeCueBlocks('\n00:03.000 --> 00:04.000\ntwo\n').cues).toEqual([cue(3000, 4000, 'two')]);
    expect(takeCueBlocks('00:03.000 --> 00:04.000\n')).toEqual({ cues: [], rest: '00:03.000 --> 00:04.000\n' });
  });

  it('handles CRLF output', () => {
    expect(takeCueBlocks('00:01.000 --> 00:02.000\r\nx\r\n\r\n').cues).toEqual([cue(1000, 2000, 'x')]);
  });
});

describe('renderSegment', () => {
  it('writes the timestamp map and absolute long-form times', () => {
    const text = renderSegment([cue(61_000, 62_000, 'A')], 60_000, 64_000);
    expect(text.startsWith('WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:0,LOCAL:00:00:00.000\n\n')).toBe(true);
    expect(text).toContain('00:01:01.000 --> 00:01:02.000\nA\n');
  });

  it('is valid and header-only without cues', () => {
    expect(renderSegment([], 0, 4000)).toBe('WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:0,LOCAL:00:00:00.000\n\n');
  });

  it('splits a cue at segment boundaries and never writes a zero-length piece', () => {
    const cues = [cue(3000, 9000, 'long'), cue(8000, 8000, 'zero')];
    const first = renderSegment(cues, 0, 4000);
    const second = renderSegment(cues, 4000, 8000);
    const third = renderSegment(cues, 8000, 12_000);
    expect(first).toContain('00:00:03.000 --> 00:00:04.000\nlong');
    expect(second).toContain('00:00:04.000 --> 00:00:08.000\nlong');
    expect(third).toContain('00:00:08.000 --> 00:00:09.000\nlong');
    expect(`${first}${second}${third}`).not.toContain('zero');
  });

  it('keeps cue settings', () => {
    expect(renderSegment([cue(0, 1000, 'x', 'line:10%')], 0, 4000)).toContain('00:00:00.000 --> 00:00:01.000 line:10%\nx');
  });

  it('full file keeps original times and is HH:MM:SS.mmm', () => {
    expect(renderFull([cue(5000, 6000, 'x')])).toBe('WEBVTT\n\n00:00:05.000 --> 00:00:06.000\nx\n\n');
  });
});

describe('intervals', () => {
  it('merges touching and overlapping ranges', () => {
    expect(mergeIntervals([{ start: 10, end: 20 }, { start: 0, end: 10 }, { start: 30, end: 40 }, { start: 35, end: 50 }])).toEqual([
      { start: 0, end: 20 },
      { start: 30, end: 50 },
    ]);
  });

  it('covers and finds the first gap', () => {
    const merged = [{ start: 5, end: 20 }, { start: 30, end: 100 }];
    expect(covers(merged, 8, 12)).toBe(true);
    expect(covers(merged, 18, 24)).toBe(false);
    expect(firstGap(merged, 100)).toEqual({ start: 0, end: 5 });
    expect(firstGap([{ start: 0, end: 20 }, { start: 30, end: 100 }], 100)).toEqual({ start: 20, end: 30 });
    expect(firstGap([{ start: 0, end: 100 }], 100)).toBeNull();
    expect(firstGap([{ start: 0, end: 90 }], 100)).toEqual({ start: 90, end: 100 });
  });
});

describe('SubtitleStore', () => {
  it('covers segments from the union of run coverage and reports status', () => {
    const store = new SubtitleStore(20, [3]);
    expect(store.status()).toBe('extracting');
    expect(store.segmentCovered(0)).toBe(false);
    store.setCoverage(1, { start: 10, end: Number.POSITIVE_INFINITY });
    expect(store.segmentCovered(2)).toBe(false);
    expect(store.segmentCovered(3)).toBe(true);
    expect(store.firstGap()).toEqual({ start: 0, end: 10 });
    store.setCoverage(2, { start: 0, end: 12 });
    expect(store.complete).toBe(true);
    expect(store.status()).toBe('complete');
  });

  it('markFailed turns an unfinished store to error but leaves covered segments servable', () => {
    const store = new SubtitleStore(20, [3]);
    store.setCoverage(1, { start: 0, end: 8 });
    store.markFailed();
    expect(store.status()).toBe('error');
    expect(store.segmentCovered(1)).toBe(true);
  });

  it('serves the same cues regardless of the order runs delivered them, without duplicates', () => {
    const a = new SubtitleStore(60, [3]);
    const b = new SubtitleStore(60, [3]);
    const cues = [cue(2000, 5000, 'one'), cue(10_000, 14_000, 'two'), cue(30_000, 34_000, 'three')];
    a.addCues(3, cues);
    a.addCues(3, [cues[1] as Cue]);
    b.addCues(3, [cues[2] as Cue, cues[0] as Cue]);
    b.addCues(3, [cues[1] as Cue, cues[0] as Cue]);
    expect(a.full(3)).toBe(b.full(3));
    for (let k = 0; k < 15; k += 1) expect(a.segment(3, k)).toBe(b.segment(3, k));
  });

  it('finds long cues that started in an earlier segment', () => {
    const store = new SubtitleStore(60, [3]);
    store.addCues(3, [cue(1000, 20_000, 'long'), cue(5000, 6000, 'short'), cue(18_000, 19_000, 'late')]);
    expect(store.segment(3, 3)).toContain('long');
    expect(store.segment(3, 3)).not.toContain('short');
    expect(store.segment(3, 4)).toContain('00:00:18.000 --> 00:00:19.000\nlate');
  });

  it('ignores cues of tracks it does not hold', () => {
    const store = new SubtitleStore(60, [3]);
    store.addCues(9, [cue(0, 1000)]);
    expect(store.has(9)).toBe(false);
    expect(store.full(9)).toBe('WEBVTT\n\n');
  });
});

describe('master and rendition playlists', () => {
  const decision = { videoCodec: 'h264' as const, height: 1080, width: 1920, audioChannels: 2 };
  const track = (index: number, title = '', language = 'eng', forced = false) => ({ index, language, title, forced });

  it('lists one SUBTITLES rendition per text track with the track index in the name', () => {
    const text = generateMasterPlaylist({ decision, fps: 23.976, tracks: [track(3, 'English'), track(5, '', 'por')] });
    const media = text.split('\n').filter((line) => line.startsWith('#EXT-X-MEDIA:'));
    expect(media).toHaveLength(2);
    expect(media[0]).toContain('TYPE=SUBTITLES');
    expect(media[0]).toContain('NAME="English [3]"');
    expect(media[0]).toContain('DEFAULT=NO,AUTOSELECT=NO');
    expect(media[0]).toContain('URI="subs/3/index.m3u8"');
    expect(media[1]).toContain('NAME="por [5]"');
    expect(text).toMatch(/#EXT-X-STREAM-INF:[^\n]*SUBTITLES="subs"[^\n]*\nvideo\.m3u8\n/);
  });

  it('has the variant only, without a subtitles group, when there are no text tracks', () => {
    const text = generateMasterPlaylist({ decision, fps: 24, tracks: [] });
    expect(text).not.toContain('EXT-X-MEDIA');
    expect(text).not.toContain('SUBTITLES=');
    expect(text).toContain('#EXT-X-STREAM-INF:');
    expect(text.trimEnd().endsWith('video.m3u8')).toBe(true);
  });

  it('keeps quotes and newlines out of the attribute list', () => {
    expect(renditionName(track(4, 'He said "hi"\nagain'))).toBe("He said 'hi' again [4]");
  });

  it('subtitle playlist is a VOD list of 4 s segments with a shorter last one', () => {
    const lines = generateSubtitlePlaylist(10).split('\n');
    expect(lines).toContain('#EXT-X-PLAYLIST-TYPE:VOD');
    expect(lines).toContain('#EXT-X-TARGETDURATION:4');
    expect(lines.filter((line) => line.endsWith('.vtt'))).toEqual(['seg-0.vtt', 'seg-1.vtt', 'seg-2.vtt']);
    expect(lines).toContain('#EXTINF:4.000,');
    expect(lines).toContain('#EXTINF:2.000,');
    expect(lines).toContain('#EXT-X-ENDLIST');
    expect(generateSubtitlePlaylist(10)).toBe(generateSubtitlePlaylist(10));
  });

  it('parses file names strictly', () => {
    expect(parseSubtitleSegmentName('seg-12.vtt')).toBe(12);
    for (const name of ['seg-1.ts', 'seg-.vtt', '../seg-1.vtt', 'seg-1.vtt.part']) expect(parseSubtitleSegmentName(name)).toBeNull();
    expect(parseSubtitleFullName('4.vtt')).toBe(4);
    for (const name of ['4.srt', '../4.vtt', '4.vtt.part', 'x.vtt']) expect(parseSubtitleFullName(name)).toBeNull();
    expect(parseHlsFileName('index.m3u8')).toEqual({ kind: 'master' });
    expect(parseHlsFileName('video.m3u8')).toEqual({ kind: 'playlist' });
  });
});

describe('selectTextTracks', () => {
  const info = (index: number, language: string, kind: 'text' | 'bitmap' = 'text'): SubtitleTrackInfo => ({
    index, codec: 'subrip', language, title: '', kind, forced: false, default: false,
  });

  it('keeps text tracks only', () => {
    expect(selectTextTracks({ subtitles: [info(1, 'eng'), info(2, 'eng', 'bitmap')] }).map((track) => track.index)).toEqual([1]);
  });

  it('prefers English past the maximum and keeps the source order', () => {
    const tracks = [
      ...Array.from({ length: 8 }, (_, i) => info(i, 'fra')),
      info(20, 'eng'),
      info(21, 'eng'),
      info(22, 'eng'),
      info(23, 'eng'),
    ];
    const chosen = selectTextTracks({ subtitles: tracks }).map((track) => track.index);
    expect(chosen).toHaveLength(MAX_TEXT_SUBTITLES);
    expect(chosen).toEqual([0, 1, 2, 3, 4, 5, 20, 21, 22, 23]);
  });
});

describe('extractor command line', () => {
  const job = { inputUrl: 'http://127.0.0.1:1/x', ss: 0, videoIndex: 0, tracks: [3, 7], outputDir: path.join('subs', 'run1') };

  it('copies the video into a packet listing as the coverage clock and writes one flushed WebVTT file per track', () => {
    const joined = buildExtractArgs(job).join(' ');
    expect(joined).toContain('-copyts');
    expect(joined).not.toContain('-progress');
    expect(joined).toContain(`-map 0:0 -c copy -flush_packets 1 -f framecrc ${path.join('subs', 'run1', 'cover.txt')}`);
    expect(joined).toContain(`-map 0:3 -c:s webvtt -flush_packets 1 -f ${EXTRACTOR_MARKER} ${path.join('subs', 'run1', '3.vtt')}`);
    expect(joined).toContain(`-map 0:7 -c:s webvtt -flush_packets 1 -f ${EXTRACTOR_MARKER} ${path.join('subs', 'run1', '7.vtt')}`);
  });

  it('reads the coverage head from the last complete line of the packet listing', () => {
    const header = '#format: frame checksums\n#tb 0: 1/1000\n#media_type 0: video\n';
    expect(parseCoverTimebase(header)).toBe(0.001);
    expect(parseCoverTimebase('#tb 0: 1/90000\n')).toBeCloseTo(1 / 90000, 12);
    expect(parseCoverTimebase('#format: frame checksums\n')).toBeNull();
    const lines = '0,      10000,      10000,       41,    25896, 0x510cd466\n0,      10041,      10041,       41,    25896, 0x510c';
    expect(parseCoverHead(lines, 0.001)).toBe(10);
    expect(parseCoverHead('0,   -83,   0,  41,  100, 0x1\n0,    5500,    5500,       41,    25896, 0x510cd466\n', 0.001)).toBe(5.5);
    expect(parseCoverHead('#tb 0: 1/1000\n0,  ', 0.001)).toBeNull();
  });

  it('seeks on the input side only when a start is given', () => {
    const plain = buildExtractArgs(job);
    expect(plain).not.toContain('-ss');
    const seek = buildExtractArgs({ ...job, ss: 3560 });
    expect(seek.indexOf('-ss')).toBeGreaterThan(seek.indexOf('-copyts'));
    expect(seek.indexOf('-ss')).toBeLessThan(seek.indexOf('-i'));
    expect(seek[seek.indexOf('-ss') + 1]).toBe('3560');
  });

  it('keeps output paths relative so the session id stays off the command line', () => {
    expect(buildExtractArgs(job).join(' ')).not.toMatch(/transcode|[A-F0-9]{8}-/i);
  });
});
