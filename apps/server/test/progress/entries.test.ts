import { describe, expect, it } from 'vitest';
import type { ProgressRow } from '../../src/db/progress.js';
import { selectEntries } from '../../src/progress/entries.js';

let seq = 0;
function row(overrides: Partial<ProgressRow> & Pick<ProgressRow, 'mediaKey' | 'tmdbId' | 'type'>): ProgressRow {
  seq += 1;
  return {
    season: null,
    episode: null,
    positionSec: 300,
    durationSec: 3600,
    updatedAt: seq * 1000,
    completed: false,
    hidden: false,
    meta: {},
    ...overrides,
  };
}

const movie = (id: number, overrides: Partial<ProgressRow> = {}) =>
  row({ mediaKey: `movie:${id}`, tmdbId: id, type: 'movie', ...overrides });
const episode = (show: number, season: number, ep: number, overrides: Partial<ProgressRow> = {}) =>
  row({ mediaKey: `tv:${show}:${season}:${ep}`, tmdbId: show, type: 'tv', season, episode: ep, ...overrides });

describe('selectEntries', () => {
  it('lists resumable titles newest first', () => {
    const entries = selectEntries([
      movie(1, { updatedAt: 10 }),
      movie(2, { updatedAt: 30 }),
      movie(3, { updatedAt: 20 }),
    ]);
    expect(entries.map((entry) => entry.row.tmdbId)).toEqual([2, 3, 1]);
    expect(entries.every((entry) => entry.kind === 'resume')).toBe(true);
  });

  it('skips rows under 60 s, finished movies and removed rows', () => {
    const entries = selectEntries([
      movie(1, { positionSec: 59 }),
      movie(2, { positionSec: 3500, completed: true }),
      movie(3, { hidden: true }),
      movie(4),
    ]);
    expect(entries.map((entry) => entry.row.tmdbId)).toEqual([4]);
  });

  it('keeps one entry per show: the most recent episode', () => {
    const entries = selectEntries([episode(9, 1, 1, { updatedAt: 100 }), episode(9, 1, 2, { updatedAt: 200 })]);
    expect(entries.map((entry) => entry.row.mediaKey)).toEqual(['tv:9:1:2']);
  });

  it('turns a completed latest episode into a "completed" entry for the up-next lookup', () => {
    const entries = selectEntries([
      episode(9, 1, 1, { updatedAt: 100 }),
      episode(9, 1, 2, { updatedAt: 200, completed: true }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'completed', row: { mediaKey: 'tv:9:1:2' } });
  });

  it('prefers an eligible older episode over a newer one that has barely started', () => {
    const entries = selectEntries([
      episode(9, 1, 2, { updatedAt: 100, completed: true }),
      episode(9, 1, 3, { updatedAt: 200, positionSec: 20 }),
    ]);
    expect(entries[0]).toMatchObject({ kind: 'completed', row: { mediaKey: 'tv:9:1:2' } });
  });

  it('lets a removed row hide the whole show, not just itself', () => {
    const entries = selectEntries([
      episode(9, 1, 1, { updatedAt: 100 }),
      episode(9, 1, 2, { updatedAt: 200, hidden: true }),
    ]);
    expect(entries).toEqual([]);
  });

  it('brings a show back when an episode is watched after the removal', () => {
    const entries = selectEntries([
      episode(9, 1, 2, { updatedAt: 200, hidden: true }),
      episode(9, 1, 3, { updatedAt: 300 }),
    ]);
    expect(entries.map((entry) => entry.row.mediaKey)).toEqual(['tv:9:1:3']);
  });

  it('never makes an up-next entry for a movie', () => {
    expect(selectEntries([movie(1, { completed: true })])).toEqual([]);
  });

  it('orders shows and movies together by updatedAt', () => {
    const entries = selectEntries([
      movie(1, { updatedAt: 50 }),
      episode(9, 2, 1, { updatedAt: 70 }),
      movie(2, { updatedAt: 60 }),
    ]);
    expect(entries.map((entry) => entry.row.mediaKey)).toEqual(['tv:9:2:1', 'movie:2', 'movie:1']);
  });
});
