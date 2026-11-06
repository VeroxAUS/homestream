import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIMITS,
  backoffMs,
  judgeItem,
  matchesHash,
  pollIntervalMs,
  shouldEmitProgress,
  type TorboxItem,
} from '../../src/downloads/rules.js';

const MIN = 60_000;
const HOUR = 60 * MIN;

const item = (overrides: Partial<TorboxItem> = {}): TorboxItem => ({
  hash: 'a'.repeat(40),
  alternativeHashes: [],
  name: 'x',
  downloadState: 'downloading',
  progress: 0.2,
  etaSec: 600,
  downloadFinished: false,
  downloadPresent: false,
  ...overrides,
});

describe('pollIntervalMs', () => {
  it('polls every minute for the first hour and every 5 minutes after', () => {
    expect(pollIntervalMs(0)).toBe(MIN);
    expect(pollIntervalMs(HOUR - 1)).toBe(MIN);
    expect(pollIntervalMs(HOUR)).toBe(5 * MIN);
    expect(pollIntervalMs(20 * HOUR)).toBe(5 * MIN);
  });
});

describe('backoffMs', () => {
  it('keeps the interval without failures and doubles it per failure up to the cap', () => {
    expect(backoffMs(MIN, 0)).toBe(MIN);
    expect(backoffMs(MIN, 1)).toBe(2 * MIN);
    expect(backoffMs(MIN, 2)).toBe(4 * MIN);
    expect(backoffMs(MIN, 20)).toBe(DEFAULT_LIMITS.maxBackoffMs);
  });

  it('never goes below the normal interval even when that is above the cap', () => {
    expect(backoffMs(30 * MIN, 3)).toBe(30 * MIN);
  });
});

describe('judgeItem', () => {
  const row = { progress: 0.1, progressChangedAt: 0 };

  it('is ready only when TorBox says finished AND present', () => {
    expect(judgeItem(item({ downloadFinished: true, downloadPresent: true }), row, 0)).toEqual({ kind: 'ready' });
    expect(judgeItem(item({ downloadFinished: true, downloadPresent: false }), row, 0).kind).toBe('active');
    expect(judgeItem(item({ downloadFinished: false, downloadPresent: true }), row, 0).kind).toBe('active');
  });

  it('reports progress clamped to 0..1 with the eta', () => {
    expect(judgeItem(item({ progress: 1.4 }), row, 0)).toMatchObject({ kind: 'active', progress: 1, etaSec: 600 });
    expect(judgeItem(item({ progress: -1 }), row, 0)).toMatchObject({ kind: 'active', progress: 0 });
  });

  it('fails an item TorBox marks as failed or errored', () => {
    expect(judgeItem(item({ downloadState: 'failed' }), row, 0)).toEqual({ kind: 'failed', reason: 'torbox_error' });
    expect(judgeItem(item({ downloadState: 'error' }), row, 0)).toEqual({ kind: 'failed', reason: 'torbox_error' });
  });

  it('gives up on a stalled item only after 6 hours without progress', () => {
    const stalled = item({ downloadState: 'stalled (no seeds)', progress: 0.1 });
    expect(judgeItem(stalled, row, 6 * HOUR - 1)).toMatchObject({ kind: 'active' });
    expect(judgeItem(stalled, row, 6 * HOUR)).toEqual({ kind: 'failed', reason: 'stalled' });
  });

  it('does not give up on a stalled item that moved since the last look', () => {
    const moved = item({ downloadState: 'stalled', progress: 0.5 });
    expect(judgeItem(moved, row, 7 * HOUR)).toMatchObject({ kind: 'active' });
  });
});

describe('matchesHash', () => {
  it('matches the hash and the alternative hashes case-insensitively', () => {
    const candidate = item({ hash: 'abc', alternativeHashes: ['def'] });
    expect(matchesHash(candidate, 'ABC')).toBe(true);
    expect(matchesHash(candidate, 'DEF')).toBe(true);
    expect(matchesHash(candidate, 'xyz')).toBe(false);
  });
});

describe('shouldEmitProgress', () => {
  it('emits the first move, then at most once a minute, and never without a move', () => {
    expect(shouldEmitProgress({ progress: 0, lastEventAt: null }, 0.1, 0)).toBe(true);
    expect(shouldEmitProgress({ progress: 0.1, lastEventAt: 0 }, 0.2, 30_000)).toBe(false);
    expect(shouldEmitProgress({ progress: 0.1, lastEventAt: 0 }, 0.2, MIN)).toBe(true);
    expect(shouldEmitProgress({ progress: 0.2, lastEventAt: 0 }, 0.2, 5 * MIN)).toBe(false);
    expect(shouldEmitProgress({ progress: 0.3, lastEventAt: 0 }, 0.2, 5 * MIN)).toBe(false);
  });
});
