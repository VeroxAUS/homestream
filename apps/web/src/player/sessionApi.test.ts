import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { download, session } from '../test/fixtures';
import { apiError, mockApi } from '../test/render';
import {
  beaconProgress,
  patchSession,
  prefetchTitle,
  resetPrefetchMemory,
  sendProgress,
  startSession,
  stopSession,
} from './sessionApi';

const MOVIE = { mediaType: 'movie', tmdbId: 278 } as const;

afterEach(() => vi.unstubAllGlobals());

describe('startSession', () => {
  it('sends streamId auto, the device profile and no subtitle field', async () => {
    const { calls } = mockApi({ 'POST /api/sessions': Response.json(session(), { status: 201 }) });
    const result = await startSession(MOVIE, undefined);
    expect(result.kind).toBe('session');
    const body = calls[0]?.body as Record<string, unknown>;
    expect(body).toMatchObject({ mediaType: 'movie', tmdbId: 278, streamId: 'auto' });
    expect(body).not.toHaveProperty('subtitle');
    expect(body).not.toHaveProperty('startPositionSec');
    expect(body).toHaveProperty('device');
  });

  it('passes the resume position and the episode', async () => {
    const { calls } = mockApi({ 'POST /api/sessions': Response.json(session(), { status: 201 }) });
    await startSession({ mediaType: 'tv', tmdbId: 1396, season: 1, episode: 2 }, 3722);
    expect(calls[0]?.body).toMatchObject({ season: 1, episode: 2, startPositionSec: 3722 });
  });

  it('turns HTTP 202 into a downloading result', async () => {
    mockApi({ 'POST /api/sessions': Response.json({ status: 'downloading', download: download() }, { status: 202 }) });
    const result = await startSession(MOVIE, undefined);
    expect(result).toMatchObject({ kind: 'downloading', download: { id: 'd1' } });
  });

  it('throws the server error with its code, message and hint', async () => {
    mockApi({ 'POST /api/sessions': apiError(502, 'all_streams_failed', 'No stream worked.', 'Open Health.') });
    await expect(startSession(MOVIE, undefined)).rejects.toMatchObject({
      code: 'all_streams_failed',
      message: 'No stream worked.',
      hint: 'Open Health.',
    });
  });
});

describe('session calls', () => {
  it('patches audio and subtitle choices', async () => {
    const { calls } = mockApi({ 'PATCH /api/sessions/s1': session({ selectedAudioIndex: 1 }) });
    const next = await patchSession('s1', { audioIndex: 1 });
    expect(next.selectedAudioIndex).toBe(1);
    expect(calls[0]?.body).toEqual({ audioIndex: 1 });
  });

  it('stops a session with DELETE and neither body nor content type', async () => {
    const { fetchMock } = mockApi({ 'DELETE /api/sessions/s1': new Response(null, { status: 204 }) });
    await stopSession('s1');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
    expect(new Headers(init.headers).has('Content-Type')).toBe(false);
  });

  it('never throws when stopping or pinging fails', async () => {
    mockApi({
      'DELETE /api/sessions/s1': new Error('offline'),
      'POST /api/sessions/s1/progress': new Error('offline'),
    });
    await expect(stopSession('s1')).resolves.toBeUndefined();
    await expect(sendProgress('s1', 5, 'playing')).resolves.toBeUndefined();
  });

  it('posts progress with position and state', async () => {
    const { calls } = mockApi({ 'POST /api/sessions/s1/progress': new Response(null, { status: 204 }) });
    await sendProgress('s1', 42.5, 'paused');
    expect(calls[0]?.body).toEqual({ positionSec: 42.5, state: 'paused' });
  });

  it('sends the last ping with sendBeacon when the page unloads', () => {
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon });
    expect(beaconProgress('s1', 10, 'paused')).toBe(true);
    expect(sendBeacon).toHaveBeenCalledWith('/api/sessions/s1/progress', expect.any(Blob));
  });
});

describe('prefetchTitle', () => {
  beforeEach(() => {
    resetPrefetchMemory();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('posts the title and a device profile', () => {
    const { calls } = mockApi({ 'POST /api/prefetch': Response.json({}, { status: 202 }) });
    prefetchTitle({ mediaType: 'tv', tmdbId: 1396, season: 1, episode: 2 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toMatchObject({ mediaType: 'tv', tmdbId: 1396, season: 1, episode: 2 });
    expect(calls[0]?.body).toHaveProperty('device');
  });

  it('sends the same title once within a second, again after that, and each other title at once', () => {
    const { calls } = mockApi({ 'POST /api/prefetch': Response.json({}, { status: 202 }) });
    prefetchTitle(MOVIE);
    prefetchTitle(MOVIE);
    expect(calls).toHaveLength(1);
    prefetchTitle({ mediaType: 'movie', tmdbId: 1 });
    expect(calls).toHaveLength(2);
    prefetchTitle(MOVIE);
    vi.advanceTimersByTime(1001);
    prefetchTitle(MOVIE);
    expect(calls).toHaveLength(4);
  });

  it('ignores failures', async () => {
    mockApi({ 'POST /api/prefetch': new Error('offline') });
    expect(() => prefetchTitle(MOVIE)).not.toThrow();
    await vi.advanceTimersByTimeAsync(10);
  });
});
