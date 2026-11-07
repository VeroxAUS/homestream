import type Hls from 'hls.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { session } from '../test/fixtures';
import { describeDecision, describeEncoder, outputSummary, resolutionLabel } from './decisionText';
import { ACTIVITY_THROTTLE_MS, createIdleHider, IDLE_HIDE_MS } from './idleHider';
import { audioMenuItems, subtitleMenuItems } from './menuItems';
import { getPlayerSnapshot, registerPlayerSnapshot, type PlayerSnapshot } from './snapshot';
import { detailsPath, mediaKeyOf, parsePlayTarget, parseStartParam, playPath } from './target';
import { audioEntries, mapSubtitleTracks, sameSelection, selectionFor, serverIndexOf, subtitleEntries } from './tracks';
import { applySubtitleSelection, describeFatal, hlsConfig } from './useHls';
import { shortcutFor } from './useShortcuts';

describe('play targets', () => {
  it('reads movie and episode addresses and rejects everything else', () => {
    expect(parsePlayTarget('movie/278')).toEqual({ mediaType: 'movie', tmdbId: 278 });
    expect(parsePlayTarget('tv/1396/1/2')).toEqual({ mediaType: 'tv', tmdbId: 1396, season: 1, episode: 2 });
    expect(parsePlayTarget('tv/1396/0/1')).toMatchObject({ season: 0 });
    for (const bad of [
      undefined,
      '',
      'movie',
      'movie/abc',
      'movie/0',
      'movie/1/2',
      'tv/1',
      'tv/1/1',
      'tv/1/1/0',
      'x/1',
    ]) {
      expect(parsePlayTarget(bad)).toBeNull();
    }
  });

  it('builds the paths and the media key', () => {
    const episode = { mediaType: 'tv', tmdbId: 1396, season: 1, episode: 2 } as const;
    expect(playPath({ mediaType: 'movie', tmdbId: 278 }, 3722.9)).toBe('/play/movie/278?start=3722');
    expect(playPath(episode)).toBe('/play/tv/1396/1/2');
    expect(detailsPath(episode)).toBe('/tv/1396?season=1&episode=2');
    expect(detailsPath({ mediaType: 'movie', tmdbId: 278 })).toBe('/movie/278');
    expect(mediaKeyOf(episode)).toBe('tv:1396:1:2');
    expect(mediaKeyOf({ mediaType: 'movie', tmdbId: 278 })).toBe('movie:278');
  });

  it('accepts a whole number of seconds as start', () => {
    expect(parseStartParam('3722')).toBe(3722);
    expect(parseStartParam('0')).toBe(0);
    expect(parseStartParam(null)).toBeUndefined();
    expect(parseStartParam('-5')).toBeUndefined();
    expect(parseStartParam('1.5')).toBeUndefined();
  });
});

describe('subtitle and audio tracks', () => {
  it('reads the server index from the rendition name suffix', () => {
    expect(serverIndexOf('English [3]')).toBe(3);
    expect(serverIndexOf('English SDH [12]')).toBe(12);
    expect(serverIndexOf('English')).toBeNull();
    expect(serverIndexOf('Sub [x]')).toBeNull();
  });

  it('maps server indexes to hls.js track ids, whatever their order', () => {
    const map = mapSubtitleTracks([
      { id: 0, name: 'Spanish [1]' },
      { id: 1, name: 'English [0]' },
      { id: 2, name: 'Unnamed' },
    ]);
    expect(map.get(0)).toBe(1);
    expect(map.get(1)).toBe(0);
    expect(map.size).toBe(2);
  });

  it('lists text tracks before bitmap tracks and marks bitmap tracks as burn-in', () => {
    const entries = subtitleEntries(session().subtitleTracks);
    expect(entries.map((entry) => [entry.index, entry.kind])).toEqual([
      [0, 'text'],
      [1, 'text'],
      [2, 'bitmap'],
    ]);
    expect(entries[2]?.detail).toContain('burned in');
    expect(entries[0]?.label).toBe('English');
    expect(selectionFor(entries[0]!)).toEqual({ index: 0, mode: 'sidecar' });
    expect(selectionFor(entries[2]!)).toEqual({ index: 2, mode: 'burn' });
  });

  it('labels audio tracks with language and codec', () => {
    const [first, second] = audioEntries(session().audioTracks);
    expect(first).toMatchObject({ index: 0, label: 'English', detail: 'TRUEHD 7.1 \u2192 AAC' });
    expect(second).toMatchObject({ label: 'French', detail: 'EAC3 5.1 \u2192 AAC' });
  });

  it('compares selections', () => {
    expect(sameSelection(null, null)).toBe(true);
    expect(sameSelection({ index: 1, mode: 'sidecar' }, { index: 1, mode: 'sidecar' })).toBe(true);
    expect(sameSelection({ index: 1, mode: 'sidecar' }, { index: 1, mode: 'burn' })).toBe(false);
    expect(sameSelection(null, { index: 1, mode: 'burn' })).toBe(false);
  });

  it('checks the server-chosen subtitle and the playing audio track in the menus', () => {
    const current = session();
    const source = {
      session: current,
      selectedAudioIndex: current.selectedAudioIndex,
      subtitle: current.selectedSubtitle,
      selectAudio: vi.fn().mockResolvedValue(undefined),
      selectSubtitle: vi.fn().mockResolvedValue(undefined),
    };
    const subs = subtitleMenuItems(source);
    expect(subs.map((item) => [item.label, item.selected])).toEqual([
      ['Off', false],
      ['English', true],
      ['Spanish', false],
      ['English - PGS', false],
    ]);
    subs[0]?.onSelect();
    expect(source.selectSubtitle).toHaveBeenCalledWith(null);
    subs[3]?.onSelect();
    expect(source.selectSubtitle).toHaveBeenCalledWith({ index: 2, mode: 'burn' });
    const audio = audioMenuItems(source);
    expect(audio.map((item) => item.selected)).toEqual([true, false]);
    audio[1]?.onSelect();
    expect(source.selectAudio).toHaveBeenCalledWith(1);
    expect(subtitleMenuItems({ ...source, subtitle: null })[0]?.selected).toBe(true);
  });
});

describe('hls configuration', () => {
  it('retries fragments about 90 times, one second apart, so 503 subtitle segments are never lost', () => {
    const config = hlsConfig(120);
    expect(config.startPosition).toBe(120);
    expect(config.fragLoadPolicy?.default.errorRetry).toMatchObject({ maxNumRetry: 90, retryDelayMs: 1000 });
  });

  it('selects the rendition by NAME suffix and turns subtitles off for Off and for burn-in', () => {
    const hls = {
      subtitleTracks: [
        { id: 0, name: 'Spanish [1]' },
        { id: 1, name: 'English [0]' },
      ],
      subtitleTrack: -2,
      subtitleDisplay: false,
    };
    applySubtitleSelection(hls as unknown as Hls, { index: 0, mode: 'sidecar' });
    expect(hls.subtitleTrack).toBe(1);
    expect(hls.subtitleDisplay).toBe(true);
    applySubtitleSelection(hls as unknown as Hls, null);
    expect(hls.subtitleTrack).toBe(-1);
    applySubtitleSelection(hls as unknown as Hls, { index: 0, mode: 'sidecar' });
    applySubtitleSelection(hls as unknown as Hls, { index: 0, mode: 'burn' });
    expect(hls.subtitleTrack).toBe(-1);
    applySubtitleSelection(hls as unknown as Hls, { index: 9, mode: 'sidecar' });
    expect(hls.subtitleTrack).toBe(-1);
  });

  it('explains fatal errors in plain words', () => {
    expect(describeFatal({ type: 'mediaError', details: 'x' } as never).message).toContain('decoded');
    expect(describeFatal({ type: 'networkError', details: 'manifestLoadError' } as never).message).toContain(
      'playlist',
    );
    expect(describeFatal({ type: 'networkError', details: 'fragLoadError' } as never).message).toContain('stopped');
  });
});

describe('decision text', () => {
  it('describes source and output of a tone-mapped HDR title', () => {
    const text = describeDecision(session().decision);
    expect(text.sourceVideo).toBe('2160p HEVC Dolby Vision');
    expect(text.sourceAudio).toBe('TrueHD 7.1');
    expect(text.outputVideo).toBe('2160p H.264 SDR');
    expect(text.outputAudio).toBe('AAC 2.0');
    expect(text.toneMapped).toBe(true);
    expect(outputSummary(session().decision)).toBe('2160p H.264');
  });

  it('names resolutions by width and formats encoder numbers', () => {
    expect(resolutionLabel(1920, 800)).toBe('1080p');
    expect(resolutionLabel(1280, 720)).toBe('720p');
    expect(resolutionLabel(640, 480)).toBe('480p');
    expect(describeEncoder(session().encoder)).toEqual({ speed: '5.2x', fps: '125 fps', bitrate: '14.6 Mbps' });
  });
});

describe('keyboard shortcuts', () => {
  const key = (value: string, extra: Partial<KeyboardEvent> = {}) =>
    shortcutFor({ key: value, ctrlKey: false, altKey: false, metaKey: false, ...extra });

  it('maps the documented keys', () => {
    expect(key(' ')).toBe('togglePlay');
    expect(key('k')).toBe('togglePlay');
    expect(key('K')).toBe('togglePlay');
    expect(key('ArrowLeft')).toBe('skipBack');
    expect(key('ArrowRight')).toBe('skipForward');
    expect(key('ArrowUp')).toBe('volumeUp');
    expect(key('ArrowDown')).toBe('volumeDown');
    expect(key('m')).toBe('mute');
    expect(key('f')).toBe('fullscreen');
    expect(key('c')).toBe('subtitles');
    expect(key('i')).toBe('info');
    expect(key('Escape')).toBe('escape');
    expect(key('x')).toBeNull();
  });

  it('leaves modified presses to the app and the OS', () => {
    expect(key('f', { ctrlKey: true })).toBeNull();
    expect(key('ArrowLeft', { altKey: true })).toBeNull();
    expect(key('m', { metaKey: true })).toBeNull();
  });
});

describe('idle hider', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function make() {
    const changes: boolean[] = [];
    const hider = createIdleHider({ onChange: (visible) => changes.push(visible), now: () => Date.now() });
    return { hider, changes };
  }

  it('hides after 3 s without input and shows again at once on input', () => {
    const { hider, changes } = make();
    hider.activity();
    vi.advanceTimersByTime(IDLE_HIDE_MS - 1);
    expect(changes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(changes).toEqual([false]);
    hider.activity();
    expect(changes).toEqual([false, true]);
    vi.advanceTimersByTime(IDLE_HIDE_MS);
    expect(changes).toEqual([false, true, false]);
  });

  it('restarts the countdown on activity, throttled to one reset per 250 ms', () => {
    const { hider, changes } = make();
    hider.activity();
    vi.advanceTimersByTime(2000);
    hider.activity();
    vi.advanceTimersByTime(2000);
    expect(changes).toEqual([]);
    hider.activity();
    hider.activity();
    vi.advanceTimersByTime(ACTIVITY_THROTTLE_MS - 1);
    hider.activity();
    vi.advanceTimersByTime(IDLE_HIDE_MS);
    expect(changes).toEqual([false]);
  });

  it('never hides while blocked and counts down again once unblocked', () => {
    const { hider, changes } = make();
    hider.setBlocked(true);
    hider.activity();
    vi.advanceTimersByTime(60_000);
    expect(changes).toEqual([]);
    hider.setBlocked(false);
    vi.advanceTimersByTime(IDLE_HIDE_MS);
    expect(changes).toEqual([false]);
    hider.setBlocked(true);
    expect(changes).toEqual([false, true]);
  });

  it('does nothing after dispose', () => {
    const { hider, changes } = make();
    hider.activity();
    hider.dispose();
    vi.advanceTimersByTime(IDLE_HIDE_MS * 2);
    expect(changes).toEqual([]);
  });
});

describe('player snapshot', () => {
  it('is null without a player and reads the registered player until it unregisters', () => {
    expect(getPlayerSnapshot()).toBeNull();
    const state: PlayerSnapshot = {
      sessionId: 's1',
      playlistUrl: '/hls/s1/index.m3u8',
      mediaPlaylistUrl: '/hls/s1/video.m3u8',
      positionSec: 12,
      paused: false,
      volume: 0.5,
      muted: false,
      audioIndex: 0,
      subtitle: null,
      title: 'Test',
      mediaKey: 'movie:278',
    };
    const unregister = registerPlayerSnapshot(() => state);
    expect(getPlayerSnapshot()).toEqual(state);
    unregister();
    expect(getPlayerSnapshot()).toBeNull();
  });
});
