import { describe, expect, it } from 'vitest';
import { EVENT_SOURCES, DownloadSchema, DownloadStartedResponseSchema, DownloadsResponseSchema } from '../src/index.js';

const download = {
  id: 'd1',
  mediaType: 'movie',
  tmdbId: 278,
  title: 'The Shawshank Redemption',
  state: 'pending',
  status: 'pending',
  progress: 0,
  startedAt: 1_700_000_000_000,
};

describe('download schemas', () => {
  it('accepts a pending movie download and an episode with season and episode', () => {
    expect(DownloadSchema.parse(download)).toEqual(download);
    expect(DownloadSchema.parse({ ...download, mediaType: 'tv', season: 1, episode: 2 })).toMatchObject({ season: 1, episode: 2 });
  });

  it('rejects out-of-range progress and unknown states', () => {
    expect(DownloadSchema.safeParse({ ...download, progress: 1.1 }).success).toBe(false);
    expect(DownloadSchema.safeParse({ ...download, state: 'paused' }).success).toBe(false);
  });

  it('wraps the 202 answer and the list', () => {
    expect(DownloadStartedResponseSchema.parse({ status: 'downloading', download }).status).toBe('downloading');
    expect(DownloadStartedResponseSchema.safeParse({ status: 'ready', download }).success).toBe(false);
    expect(DownloadsResponseSchema.parse({ downloads: [download] }).downloads).toHaveLength(1);
  });

  it('knows the downloads log source', () => {
    expect(EVENT_SOURCES).toContain('downloads');
  });
});
