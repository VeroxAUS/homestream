import type { Season, ShowDetails } from '@homestream/shared';
import { describe, expect, it } from 'vitest';
import { findNextEpisode, localDay, type SeasonSource } from '../../src/progress/upNext.js';

const TODAY = '2026-11-06';

function episodes(count: number, airDate = '2010-01-01'): Season['episodes'] {
  return Array.from({ length: count }, (_, i) => ({
    episodeNumber: i + 1,
    name: `Episode ${i + 1}`,
    overview: '',
    stillUrl: `https://img.test/still${i + 1}.jpg`,
    runtime: 45,
    airDate,
  }));
}

function source(seasons: Record<number, Season['episodes']>): SeasonSource & { seasonCalls: number[] } {
  const calls: number[] = [];
  return {
    seasonCalls: calls,
    async show() {
      return {
        seasons: Object.entries(seasons).map(([n, list]) => ({ seasonNumber: Number(n), name: `Season ${n}`, episodeCount: list.length, posterUrl: null })),
      } as ShowDetails;
    },
    async season(_id, number) {
      calls.push(number);
      const list = seasons[number];
      if (!list) throw new Error('no such season');
      return { seasonNumber: number, name: `Season ${number}`, episodes: list };
    },
  };
}

describe('findNextEpisode', () => {
  it('moves to the next episode of the season', async () => {
    const next = await findNextEpisode(source({ 1: episodes(7), 2: episodes(13) }), 1396, 1, 2, TODAY);
    expect(next).toEqual({ season: 1, episode: 3, episodeTitle: 'Episode 3', stillUrl: 'https://img.test/still3.jpg' });
  });

  it('rolls over to episode 1 of the next season after the last episode of a season', async () => {
    const next = await findNextEpisode(source({ 1: episodes(7), 2: episodes(13) }), 1396, 1, 7, TODAY);
    expect(next).toMatchObject({ season: 2, episode: 1 });
  });

  it('skips a following season that lists no episodes', async () => {
    const seasons = { 1: episodes(2), 2: [], 3: episodes(4) };
    const next = await findNextEpisode(source(seasons), 1, 1, 2, TODAY);
    expect(next).toMatchObject({ season: 3, episode: 1 });
  });

  it('returns null after the series finale', async () => {
    expect(await findNextEpisode(source({ 1: episodes(7), 2: episodes(16) }), 1396, 2, 16, TODAY)).toBeNull();
  });

  it('returns null when the next episode has not aired yet', async () => {
    const seasons = { 1: [...episodes(2), { ...episodes(3)[2]!, airDate: '2027-01-01' }] };
    expect(await findNextEpisode(source(seasons), 1, 1, 2, TODAY)).toBeNull();
    expect(await findNextEpisode(source({ 1: episodes(1), 2: episodes(3, '2027-03-03') }), 1, 1, 1, TODAY)).toBeNull();
  });

  it('treats an episode without an air date as aired', async () => {
    const seasons = { 1: [...episodes(1), { ...episodes(2)[1]!, airDate: null }] };
    expect(await findNextEpisode(source(seasons), 1, 1, 1, TODAY)).toMatchObject({ season: 1, episode: 2 });
  });

  it('only reads the current season when the next episode is in it', async () => {
    const tmdb = source({ 1: episodes(7), 2: episodes(13) });
    await findNextEpisode(tmdb, 1396, 1, 3, TODAY);
    expect(tmdb.seasonCalls).toEqual([1]);
  });

  it('passes a TMDB failure on to the caller', async () => {
    await expect(findNextEpisode(source({ 1: episodes(2) }), 1, 4, 1, TODAY)).rejects.toThrow('no such season');
  });
});

describe('localDay', () => {
  it('formats the local calendar day', () => {
    expect(localDay(new Date(2026, 10, 6, 23, 59).getTime())).toBe('2026-11-06');
    expect(localDay(new Date(2026, 0, 2, 0, 1).getTime())).toBe('2026-01-02');
  });
});
