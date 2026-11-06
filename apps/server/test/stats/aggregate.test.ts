import type { Decision } from '@homestream/shared';
import { describe, expect, it } from 'vitest';
import { decisionKeys, graphs, summarize, windowStart, type StatsPlay } from '../../src/stats/aggregate.js';

const NOW = new Date(2026, 10, 6, 15, 0, 0).getTime();
const at = (daysAgo: number, hour: number, minute = 0) => new Date(2026, 10, 6 - daysAgo, hour, minute).getTime();

function decision(overrides: Partial<Decision> = {}): Decision {
  return {
    videoCodec: 'hevc',
    width: 3840,
    height: 2160,
    dynamicRange: 'hdr10',
    toneMapped: false,
    audioCodec: 'aac',
    audioChannels: 6,
    subtitleBurnIn: false,
    sourceVideo: { codec: 'hevc', width: 3840, height: 2160, hdr: 'hdr10' },
    sourceAudio: { codec: 'eac3', channels: 6 },
    ...overrides,
  };
}

function play(overrides: Partial<StatsPlay>): StatsPlay {
  return {
    type: 'movie',
    tmdbId: 278,
    title: 'The Shawshank Redemption',
    showTitle: null,
    deviceId: 'val-cc4k',
    deviceName: 'Chromecast 4K',
    deviceKind: 'tv',
    startedAt: at(0, 9, 15),
    watchedSec: 600,
    bytesServed: 1_000_000,
    decision: decision(),
    ...overrides,
  };
}

/** The fixture of VAL-PROG-011/012: three plays today and one 40 days ago. */
const FIXTURE: StatsPlay[] = [
  play({}),
  play({ deviceId: 'val-emu', deviceName: 'Emulator', startedAt: at(0, 14, 30), watchedSec: 300, bytesServed: 400_000, decision: decision({ width: 1920, height: 1080, dynamicRange: 'sdr' }) }),
  play({
    type: 'tv',
    tmdbId: 1396,
    title: 'Pilot',
    showTitle: 'Breaking Bad',
    deviceId: 'val-desk',
    deviceName: 'Desktop',
    deviceKind: 'desktop',
    startedAt: at(0, 11),
    watchedSec: 900,
    bytesServed: 2_500_000,
    decision: decision({ videoCodec: 'h264', height: 2160, toneMapped: true, dynamicRange: 'sdr' }),
  }),
  play({ startedAt: at(40, 20), watchedSec: 400, bytesServed: 7 }),
];

describe('windowStart', () => {
  it('is local midnight of the first of the last N days', () => {
    expect(windowStart(NOW, 1)).toBe(new Date(2026, 10, 6).getTime());
    expect(windowStart(NOW, 7)).toBe(new Date(2026, 10, 0).getTime());
    expect(new Date(windowStart(NOW, 30)).getDate()).toBe(8);
  });
});

describe('summarize', () => {
  it('matches the seeded plays for 7 days', () => {
    const summary = summarize(FIXTURE, 7, NOW);
    expect(summary).toMatchObject({ days: 7, totalPlays: 3, totalWatchSec: 1800, bytesServed: 3_900_000 });
    expect(summary.mostWatchedMovies).toEqual([{ tmdbId: 278, title: 'The Shawshank Redemption', plays: 2, watchSec: 900 }]);
    expect(summary.mostWatchedShows).toEqual([{ tmdbId: 1396, title: 'Breaking Bad', plays: 1, watchSec: 900 }]);
    expect(summary.topDevices.map((device) => [device.deviceId, device.watchSec])).toEqual([
      ['val-desk', 900],
      ['val-cc4k', 600],
      ['val-emu', 300],
    ]);
  });

  it('keeps the old play out for 30 days and includes it for 90', () => {
    expect(summarize(FIXTURE, 30, NOW).totalPlays).toBe(3);
    const ninety = summarize(FIXTURE, 90, NOW);
    expect(ninety.totalPlays).toBe(4);
    expect(ninety.totalWatchSec).toBe(2200);
    expect(ninety.mostWatchedMovies[0]).toMatchObject({ plays: 3 });
  });

  it('returns zeros and empty lists without plays', () => {
    expect(summarize([], 7, NOW)).toEqual({
      days: 7,
      totalPlays: 0,
      totalWatchSec: 0,
      bytesServed: 0,
      mostWatchedMovies: [],
      mostWatchedShows: [],
      topDevices: [],
    });
  });

  it('ranks most watched by plays, then by watch time, and caps the list at 10', () => {
    const plays = [
      play({ tmdbId: 1, title: 'A', watchedSec: 100 }),
      play({ tmdbId: 2, title: 'B', watchedSec: 500 }),
      play({ tmdbId: 3, title: 'C', watchedSec: 100 }),
      play({ tmdbId: 3, title: 'C', watchedSec: 100 }),
      ...Array.from({ length: 12 }, (_, i) => play({ tmdbId: 100 + i, title: `X${i}`, watchedSec: 1 })),
    ];
    const movies = summarize(plays, 7, NOW).mostWatchedMovies;
    expect(movies.slice(0, 3).map((movie) => movie.tmdbId)).toEqual([3, 2, 1]);
    expect(movies).toHaveLength(10);
  });

  it('groups episodes under their show and names the show', () => {
    const plays = [1, 2, 3].map((episode) => play({ type: 'tv', tmdbId: 1396, title: `Ep ${episode}`, showTitle: 'Breaking Bad' }));
    expect(summarize(plays, 7, NOW).mostWatchedShows).toEqual([{ tmdbId: 1396, title: 'Breaking Bad', plays: 3, watchSec: 1800 }]);
  });

  it('files plays without a device under "unknown"', () => {
    const plays = [play({ deviceId: null, deviceName: null, deviceKind: null })];
    expect(summarize(plays, 7, NOW).topDevices).toEqual([{ deviceId: 'unknown', deviceName: 'Unknown device', deviceKind: null, plays: 1, watchSec: 600 }]);
  });
});

describe('graphs', () => {
  const result = graphs(FIXTURE, 7, NOW);

  it('lists every local day of the window, zero-filled, today last', () => {
    expect(result.byDay).toHaveLength(7);
    expect(result.byDay.map((day) => day.date)).toEqual(['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']);
    expect(result.byDay.at(-1)).toEqual({ date: '2026-11-06', plays: 3, watchSec: 1800 });
    expect(result.byDay.slice(0, 6).every((day) => day.plays === 0 && day.watchSec === 0)).toBe(true);
  });

  it('buckets by local hour of the start time', () => {
    expect(result.byHour).toHaveLength(24);
    expect(result.byHour.filter((hour) => hour.plays > 0).map((hour) => [hour.hour, hour.plays])).toEqual([[9, 1], [11, 1], [14, 1]]);
    expect(result.byHour.reduce((sum, hour) => sum + hour.plays, 0)).toBe(3);
  });

  it('buckets by local day of the week (0 = Sunday)', () => {
    const today = new Date(NOW).getDay();
    expect(result.byDayOfWeek).toHaveLength(7);
    expect(result.byDayOfWeek[today]).toEqual({ dayOfWeek: today, plays: 3, watchSec: 1800 });
    expect(result.byDayOfWeek.reduce((sum, day) => sum + day.plays, 0)).toBe(3);
  });

  it('counts plays by device', () => {
    expect(result.byDevice.map((device) => [device.deviceId, device.plays]).sort()).toEqual([['val-cc4k', 1], ['val-desk', 1], ['val-emu', 1]]);
  });

  it('counts plays by decision: dynamic range, codec and resolution', () => {
    const { dynamicRange, codec, resolution } = result.byDecision;
    expect(dynamicRange).toEqual([
      { key: 'sdr', plays: 1, watchSec: 300 },
      { key: 'hdr10', plays: 1, watchSec: 600 },
      { key: 'tone-mapped', plays: 1, watchSec: 900 },
    ]);
    expect(codec).toEqual([
      { key: 'hevc', plays: 2, watchSec: 900 },
      { key: 'h264', plays: 1, watchSec: 900 },
    ]);
    expect(resolution).toEqual([
      { key: '2160p', plays: 2, watchSec: 1500 },
      { key: '1080p', plays: 1, watchSec: 300 },
    ]);
    for (const buckets of [dynamicRange, codec, resolution]) expect(buckets.reduce((sum, bucket) => sum + bucket.plays, 0)).toBe(3);
  });

  it('is all zeros without plays', () => {
    const empty = graphs([], 3, NOW);
    expect(empty.byDay.map((day) => day.plays)).toEqual([0, 0, 0]);
    expect(empty.byHour.every((hour) => hour.plays === 0)).toBe(true);
    expect(empty.byDevice).toEqual([]);
    expect(empty.byDecision).toEqual({ dynamicRange: [], codec: [], resolution: [] });
  });

  it('keeps day-of-week and hour totals equal to the plays in the window even for a play dated in the future', () => {
    const future = graphs([play({ startedAt: NOW + 3 * 24 * 3600 * 1000 })], 7, NOW);
    expect(future.byHour.reduce((sum, hour) => sum + hour.plays, 0)).toBe(1);
    expect(future.byDay.reduce((sum, day) => sum + day.plays, 0)).toBe(0);
  });
});

describe('decisionKeys', () => {
  it('names tone-mapped output apart from plain SDR', () => {
    expect(decisionKeys(decision({ toneMapped: true, dynamicRange: 'sdr' })).dynamicRange).toBe('tone-mapped');
    expect(decisionKeys(decision({ toneMapped: false, dynamicRange: 'sdr' })).dynamicRange).toBe('sdr');
  });

  it('falls back to "unknown" for a missing or partial decision', () => {
    expect(decisionKeys(null)).toEqual({ dynamicRange: 'unknown', codec: 'unknown', resolution: 'unknown' });
    expect(decisionKeys({ videoCodec: 'hevc' } as Decision)).toEqual({ dynamicRange: 'unknown', codec: 'hevc', resolution: 'unknown' });
  });
});
