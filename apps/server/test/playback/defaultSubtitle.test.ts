import type { AudioTrack } from '@homestream/shared';
import { describe, expect, it } from 'vitest';
import { chooseDefaultSubtitle } from '../../src/playback/defaultSubtitle.js';
import type { SubtitleTrackInfo } from '../../src/playback/probe.js';

const audio = (language: string): AudioTrack => ({ index: 1, codec: 'eac3', channels: 6, language, title: '', default: true });

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

const pick = (tracks: SubtitleTrackInfo[], lang: string, original: string | null = null) => chooseDefaultSubtitle(tracks, audio(lang), original);

describe('English audio', () => {
  it('picks the forced English text track', () => {
    const tracks = [sub(2, 'eng'), sub(3, 'eng', { forced: true })];
    expect(pick(tracks, 'eng')).toEqual({ selection: { index: 3, mode: 'sidecar' }, kind: 'forced-english', forced: true });
  });

  it.each([
    ['disposition forced', sub(5, 'eng', { forced: true })],
    ['title "Forced"', sub(5, 'eng', { title: 'English (Forced)' })],
    ['language "en"', sub(5, 'en', { forced: true })],
    ['language "english"', sub(5, 'English', { forced: true })],
  ])('recognises a forced English track by %s', (_name, track) => {
    expect(pick([sub(2, 'eng'), track], 'eng')?.selection.index).toBe(5);
  });

  it('is Off without a forced English track, even when full English tracks exist', () => {
    expect(pick([sub(2, 'eng', { default: true }), sub(3, 'eng', { title: 'SDH' }), sub(4, 'fra', { forced: true })], 'eng')).toBeNull();
  });

  it('ignores a forced track in another language', () => {
    expect(pick([sub(2, 'spa', { forced: true })], 'eng')).toBeNull();
  });

  it('prefers a forced text track over a forced bitmap track, and burns the bitmap only when there is no text one', () => {
    const bitmap = sub(2, 'eng', { kind: 'bitmap', forced: true });
    expect(pick([bitmap, sub(7, 'eng', { forced: true })], 'eng')?.selection).toEqual({ index: 7, mode: 'sidecar' });
    expect(pick([bitmap], 'eng')).toEqual({ selection: { index: 2, mode: 'burn' }, kind: 'forced-english', forced: true });
  });
});

describe('non-English audio', () => {
  it('picks a default-flagged full English text track first', () => {
    const tracks = [sub(2, 'eng'), sub(3, 'eng', { default: true }), sub(4, 'eng', { forced: true })];
    expect(pick(tracks, 'fra')).toEqual({ selection: { index: 3, mode: 'sidecar' }, kind: 'english', forced: false });
  });

  it('then prefers a non-SDH track, then the first', () => {
    expect(pick([sub(2, 'eng', { title: 'English SDH' }), sub(3, 'eng', { title: 'English' })], 'jpn')?.selection.index).toBe(3);
    expect(pick([sub(2, 'eng', { title: 'English SDH' }), sub(3, 'eng', { title: 'Hearing Impaired' })], 'jpn')?.selection.index).toBe(2);
  });

  it('prefers a text track over a bitmap track, and a full bitmap over a forced text track', () => {
    expect(pick([sub(2, 'eng', { kind: 'bitmap', default: true }), sub(3, 'eng')], 'kor')?.selection).toEqual({ index: 3, mode: 'sidecar' });
    expect(pick([sub(2, 'eng', { kind: 'bitmap' }), sub(3, 'eng', { forced: true })], 'kor')?.selection).toEqual({ index: 2, mode: 'burn' });
  });

  it('accepts a forced-only English track when nothing else exists, and reports it as forced', () => {
    expect(pick([sub(2, 'fra'), sub(3, 'eng', { forced: true })], 'fra')).toEqual({
      selection: { index: 3, mode: 'sidecar' },
      kind: 'english',
      forced: true,
    });
  });

  it('is Off when the file has no English subtitle at all', () => {
    expect(pick([sub(2, 'fra'), sub(3, 'deu')], 'fra')).toBeNull();
    expect(pick([], 'fra')).toBeNull();
  });
});

describe('undetermined audio', () => {
  const tracks = [sub(2, 'eng'), sub(3, 'eng', { forced: true })];

  it.each(['und', '', 'zxx', 'mul'])('follows TMDB original_language for %j: English uses the English rule', (language) => {
    expect(pick(tracks, language, 'en')?.selection).toEqual({ index: 3, mode: 'sidecar' });
    expect(pick(tracks, language, 'en')?.kind).toBe('forced-english');
  });

  it('uses the non-English rule when TMDB says the original language is not English', () => {
    expect(pick(tracks, 'und', 'ja')).toMatchObject({ selection: { index: 2 }, kind: 'english' });
  });

  it('is Off when neither the file nor TMDB knows the language', () => {
    expect(pick(tracks, 'und', null)).toBeNull();
  });

  it('treats a file with no audio track like undetermined audio', () => {
    expect(chooseDefaultSubtitle(tracks, null, 'fr')).toMatchObject({ kind: 'english' });
    expect(chooseDefaultSubtitle(tracks, null, 'en')).toMatchObject({ kind: 'forced-english' });
  });

  it('ignores TMDB when the file names the audio language', () => {
    expect(pick(tracks, 'eng', 'ja')?.kind).toBe('forced-english');
    expect(pick(tracks, 'fra', 'en')?.kind).toBe('english');
  });
});
