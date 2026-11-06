import { describe, expect, it } from 'vitest';
import type { ProbeResult, SubtitleTrackInfo } from '../../src/playback/probe.js';
import { burnTarget, planPatch, requireAudio, requireSubtitle } from '../../src/playback/tracks.js';

const sub = (index: number, kind: 'text' | 'bitmap', extra: Partial<SubtitleTrackInfo> = {}): SubtitleTrackInfo => ({
  index,
  codec: kind === 'text' ? 'subrip' : 'hdmv_pgs_subtitle',
  language: 'eng',
  title: '',
  kind,
  forced: false,
  default: false,
  ...extra,
});

const PROBE: ProbeResult = {
  durationSec: 100,
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
  audio: [
    { index: 1, codec: 'ac3', channels: 6, language: 'por', title: '', default: true },
    { index: 2, codec: 'eac3', channels: 6, language: 'eng', title: '', default: false },
  ],
  subtitles: [sub(3, 'text'), sub(4, 'bitmap', { canvas: { width: 1920, height: 1080 } }), sub(5, 'bitmap')],
};

const errorCode = (run: () => unknown): string | undefined => {
  try {
    run();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
};

describe('requireAudio', () => {
  it('lets English win over a default-flagged dub', () => expect(requireAudio(PROBE)?.index).toBe(2));
  it('honours an explicit index', () => expect(requireAudio(PROBE, 1)?.index).toBe(1));
  it('rejects an index the file does not have', () =>
    expect(errorCode(() => requireAudio(PROBE, 9))).toBe('invalid_audio_index'));
});

describe('requireSubtitle', () => {
  it.each([
    ['text as sidecar', { index: 3, mode: 'sidecar' as const }, undefined],
    ['bitmap as burn', { index: 4, mode: 'burn' as const }, undefined],
    ['unknown track', { index: 9, mode: 'sidecar' as const }, 'invalid_subtitle_index'],
    ['bitmap as sidecar', { index: 4, mode: 'sidecar' as const }, 'subtitle_mode_unsupported'],
    ['text as burn', { index: 3, mode: 'burn' as const }, 'subtitle_mode_unsupported'],
  ])('%s', (_name, selection, code) => {
    expect(errorCode(() => requireSubtitle(PROBE, selection))).toBe(code);
  });

  it('treats null and undefined as no subtitle', () => {
    expect(requireSubtitle(PROBE, null)).toBeNull();
    expect(requireSubtitle(PROBE, undefined)).toBeNull();
  });
});

describe('burnTarget', () => {
  it('names the bitmap track and its canvas', () => {
    expect(burnTarget(PROBE, { index: 4, mode: 'burn' })).toEqual({ index: 4, canvas: { width: 1920, height: 1080 } });
    expect(burnTarget(PROBE, { index: 5, mode: 'burn' })).toEqual({ index: 5 });
  });
  it('is null for sidecar or no selection', () => {
    expect(burnTarget(PROBE, { index: 3, mode: 'sidecar' })).toBeNull();
    expect(burnTarget(PROBE, null)).toBeNull();
  });
});

describe('planPatch: when the encoder must restart', () => {
  const current = { audioIndex: 2, subtitle: null };

  it.each([
    ['another audio track', current, { audioIndex: 1 }, true],
    ['the audio track already playing', current, { audioIndex: 2 }, false],
    ['a text subtitle', current, { subtitle: { index: 3, mode: 'sidecar' as const } }, false],
    ['burn-in on', current, { subtitle: { index: 4, mode: 'burn' as const } }, true],
    [
      'burn-in on the same track again',
      { audioIndex: 2, subtitle: { index: 4, mode: 'burn' as const } },
      { subtitle: { index: 4, mode: 'burn' as const } },
      false,
    ],
    [
      'burn-in moved to another bitmap track',
      { audioIndex: 2, subtitle: { index: 4, mode: 'burn' as const } },
      { subtitle: { index: 5, mode: 'burn' as const } },
      true,
    ],
    ['burn-in off', { audioIndex: 2, subtitle: { index: 4, mode: 'burn' as const } }, { subtitle: null }, true],
    [
      'burn-in replaced by a text subtitle',
      { audioIndex: 2, subtitle: { index: 4, mode: 'burn' as const } },
      { subtitle: { index: 3, mode: 'sidecar' as const } },
      true,
    ],
    [
      'clearing a text subtitle',
      { audioIndex: 2, subtitle: { index: 3, mode: 'sidecar' as const } },
      { subtitle: null },
      false,
    ],
    ['audio and burn-in together', current, { audioIndex: 1, subtitle: { index: 4, mode: 'burn' as const } }, true],
  ])('%s', (_name, state, request, restart) => {
    expect(planPatch(PROBE, state, request).restart).toBe(restart);
  });

  it('keeps the other setting when only one is sent', () => {
    const plan = planPatch(PROBE, { audioIndex: 1, subtitle: { index: 4, mode: 'burn' } }, { audioIndex: 2 });
    expect(plan.audio?.index).toBe(2);
    expect(plan.subtitle).toEqual({ index: 4, mode: 'burn' });
  });

  it('explicit null clears the subtitle', () => {
    expect(
      planPatch(PROBE, { audioIndex: 2, subtitle: { index: 3, mode: 'sidecar' } }, { subtitle: null }).subtitle,
    ).toBeNull();
  });

  it('rejects invalid choices before anything changes', () => {
    expect(errorCode(() => planPatch(PROBE, current, { audioIndex: 7 }))).toBe('invalid_audio_index');
    expect(errorCode(() => planPatch(PROBE, current, { subtitle: { index: 3, mode: 'burn' } }))).toBe(
      'subtitle_mode_unsupported',
    );
  });
});
