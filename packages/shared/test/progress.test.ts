import { describe, expect, it } from 'vitest';
import {
  ActivitySessionSchema,
  COMPLETION_RATIO,
  FeaturedItemSchema,
  HistoryQuerySchema,
  ProgressPingRequestSchema,
  RESUME_MIN_SEC,
  StatsQuerySchema,
} from '../src/index.js';

describe('progress constants', () => {
  it('has one completion rule and one resume threshold', () => {
    expect(COMPLETION_RATIO).toBe(0.92);
    expect(RESUME_MIN_SEC).toBe(60);
  });
});

describe('ProgressPingRequestSchema', () => {
  it('accepts a position with or without a state', () => {
    expect(ProgressPingRequestSchema.parse({ positionSec: 12.5 })).toEqual({ positionSec: 12.5 });
    for (const state of ['playing', 'paused', 'buffering']) {
      expect(ProgressPingRequestSchema.safeParse({ positionSec: 0, state }).success).toBe(true);
    }
  });

  it.each([
    {},
    { positionSec: -1 },
    { positionSec: '5' },
    { positionSec: 5, state: 'seeking' },
    { positionSec: Number.NaN },
  ])('rejects %j', (body) => {
    expect(ProgressPingRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe('HistoryQuerySchema', () => {
  it('defaults paging and treats blank filters as absent', () => {
    expect(HistoryQuerySchema.parse({ type: '', q: '  ', deviceId: '' })).toEqual({ page: 1, pageSize: 20 });
  });

  it('coerces paging and keeps filters', () => {
    expect(
      HistoryQuerySchema.parse({ type: 'tv', deviceId: 'd1', q: 'bad', page: '2', pageSize: '50', from: '2026-11-01' }),
    ).toEqual({
      type: 'tv',
      deviceId: 'd1',
      q: 'bad',
      page: 2,
      pageSize: 50,
      from: '2026-11-01',
    });
  });

  it.each([{ type: 'anime' }, { page: '0' }, { pageSize: '0' }, { pageSize: '101' }, { page: '1.5' }])(
    'rejects %j',
    (query) => {
      expect(HistoryQuerySchema.safeParse(query).success).toBe(false);
    },
  );
});

describe('StatsQuerySchema', () => {
  it('defaults to 30 days', () => {
    expect(StatsQuerySchema.parse({})).toEqual({ days: 30 });
    expect(StatsQuerySchema.parse({ days: '7' })).toEqual({ days: 7 });
  });

  it.each([{ days: '0' }, { days: '-3' }, { days: 'x' }, { days: '4000' }])('rejects %j', (query) => {
    expect(StatsQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe('FeaturedItemSchema', () => {
  const item = {
    mediaType: 'movie',
    tmdbId: 1,
    title: 'T',
    overview: 'O',
    backdropUrl: 'https://img.test/b.jpg',
    reason: 'trending',
    reasonLabel: 'Trending this week',
  };

  it('has an optional logoUrl and basedOn', () => {
    expect(FeaturedItemSchema.safeParse(item).success).toBe(true);
    expect(FeaturedItemSchema.safeParse({ ...item, logoUrl: 'https://img.test/l.png' }).success).toBe(true);
    expect(
      FeaturedItemSchema.safeParse({
        ...item,
        reason: 'because_you_watched',
        basedOn: { mediaType: 'tv', tmdbId: 2, title: 'Show' },
      }).success,
    ).toBe(true);
  });

  it('needs a backdrop', () => {
    expect(FeaturedItemSchema.safeParse({ ...item, backdropUrl: null }).success).toBe(false);
  });
});

describe('ActivitySessionSchema', () => {
  it('lists buffering as a session state', () => {
    const state = ActivitySessionSchema.shape.state;
    expect(state.safeParse('buffering').success).toBe(true);
    expect(state.safeParse('seeking').success).toBe(false);
  });
});
