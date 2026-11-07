import type { QueryClient } from '@tanstack/react-query';
import { act, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HealthPill } from '../components/HealthPill';
import { HOME_CONTENT_MARK } from '../lib/startup';
import { download, health } from '../test/fixtures';
import { mockApi, renderWithProviders, testQueryClient } from '../test/render';
import { clearDownloadProgress, downloadKey, setDownloadProgress, useDownloadProgress } from './downloadProgress';
import { startServerEvents, startServerEventsWhenIdle, stopServerEvents, useEventStreamLive } from './serverEvents';
import { usePendingDownload } from './usePendingDownload';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners = new Map<string, (event: Event) => void>();
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.set(type, listener);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    this.listeners.get(type)?.(
      new MessageEvent(type, { data: typeof data === 'string' ? data : JSON.stringify(data) }),
    );
  }
}

const READY = { downloadId: 'd1', title: 'The Shawshank Redemption', mediaType: 'movie', tmdbId: 278 };

describe('downloadProgress', () => {
  afterEach(() => clearDownloadProgress('movie:1'));

  it('builds one key per movie or episode', () => {
    expect(downloadKey('movie', 5)).toBe('movie:5');
    expect(downloadKey('tv', 5, 2, 3)).toBe('tv:5:2:3');
    expect(downloadKey('tv', 5)).toBe('tv:5:0:0');
  });

  it('tells subscribers about changes only', () => {
    const { result } = renderHook(() => useDownloadProgress('movie:1'));
    expect(result.current).toBeUndefined();
    act(() => setDownloadProgress('movie:1', 0.4));
    expect(result.current).toBe(0.4);
    act(() => setDownloadProgress('movie:1', 0.4));
    expect(result.current).toBe(0.4);
    act(() => clearDownloadProgress('movie:1'));
    expect(result.current).toBeUndefined();
    act(() => clearDownloadProgress('movie:1'));
  });
});

describe('usePendingDownload', () => {
  afterEach(() => clearDownloadProgress('movie:2'));

  it('is null when nothing is pending', () => {
    expect(renderHook(() => usePendingDownload('movie:2', undefined)).result.current).toBeNull();
    expect(renderHook(() => usePendingDownload('movie:2', download({ status: 'ready' }))).result.current).toBeNull();
  });

  it('uses the details response, then live events', () => {
    const pending = download({ status: 'pending', state: 'downloading', progress: 0.25 });
    const { result } = renderHook(() => usePendingDownload('movie:2', pending));
    expect(result.current).toEqual({ progress: 0.25 });
    act(() => setDownloadProgress('movie:2', 0.5));
    expect(result.current).toEqual({ progress: 0.5 });
  });

  it('has no progress while TorBox has not reported the item', () => {
    const queued = download({ status: 'pending', state: 'pending', progress: 0 });
    expect(renderHook(() => usePendingDownload('movie:2', queued)).result.current).toEqual({ progress: undefined });
  });
});

describe('serverEvents', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    queryClient = testQueryClient();
    mockApi({ 'GET /api/health': health('ok') });
    stopServerEvents();
  });
  afterEach(() => {
    stopServerEvents();
    clearDownloadProgress('movie:278');
    window.history.pushState({}, '', '/');
    vi.unstubAllGlobals();
  });

  function open() {
    startServerEvents(queryClient);
    const [stream] = FakeEventSource.instances;
    if (!stream) throw new Error('no stream');
    return stream;
  }

  it('opens one stream only', () => {
    open();
    startServerEvents(queryClient);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]?.url).toBe('/api/events');
  });

  it('does nothing without EventSource', () => {
    vi.stubGlobal('EventSource', undefined);
    startServerEvents(queryClient);
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('keeps health snapshots in the cache on every page and ignores malformed ones', () => {
    const stream = open();
    stream.emit('health', health('ok'));
    expect(queryClient.getQueryData(['health'])).toMatchObject({ overall: 'ok' });
    stream.emit('health', health('warn', ['warn']));
    expect(queryClient.getQueryData(['health'])).toMatchObject({ overall: 'warn' });
    stream.emit('health', '{not json');
    stream.emit('health', { wrong: true });
    expect(queryClient.getQueryData(['health'])).toMatchObject({ overall: 'warn' });
  });

  it('reports whether the stream is live, and asks for a fresh health answer when it drops', () => {
    const { result } = renderHook(() => useEventStreamLive());
    expect(result.current).toBe(false);
    const stream = open();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
    act(() => stream.onopen?.());
    expect(result.current).toBe(true);
    act(() => stream.onerror?.());
    expect(result.current).toBe(false);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['health'] });
    act(() => stream.onerror?.());
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('records download progress and ignores malformed events', () => {
    const stream = open();
    stream.emit('download.progress', { ...READY, progress: 0.3, state: 'downloading' });
    const { result } = renderHook(() => useDownloadProgress('movie:278'));
    expect(result.current).toBe(0.3);
    stream.emit('download.progress', { nonsense: 1 });
    expect(result.current).toBe(0.3);
  });

  it.each(['download.ready', 'download.failed'])('%s clears progress and refreshes the title', (type) => {
    const stream = open();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
    setDownloadProgress('movie:278', 0.9);
    stream.emit(type, READY);
    const { result } = renderHook(() => useDownloadProgress('movie:278'));
    expect(result.current).toBeUndefined();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['movie', 278] });
  });

  it('refreshes a show by its show id', () => {
    const stream = open();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
    stream.emit('download.ready', { ...READY, mediaType: 'tv', tmdbId: 1399, season: 1, episode: 2 });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['show', 1399] });
  });

  it('refreshes everything after the connection came back', () => {
    const stream = open();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
    stream.onopen?.();
    expect(invalidate).not.toHaveBeenCalled();
    stream.onerror?.();
    invalidate.mockClear();
    stream.onopen?.();
    expect(invalidate).toHaveBeenCalledTimes(1);
    const { predicate } = invalidate.mock.calls[0]?.[0] ?? {};
    expect(predicate?.({ queryKey: ['home'] } as never)).toBe(true);
    expect(predicate?.({ queryKey: ['movie', 278] } as never)).toBe(true);
    // The health snapshot is fetched once by the open handler itself.
    expect(predicate?.({ queryKey: ['health'] } as never)).toBe(false);
    stream.onopen?.();
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  describe('health snapshot on open', () => {
    const healthCalls = (calls: { method: string; path: string }[]) =>
      calls.filter((call) => call.method === 'GET' && call.path === '/api/health').length;

    it('repairs a failed initial request: the pill shows the fetched state once the stream opens', async () => {
      let answers = 0;
      const { calls } = mockApi({
        'GET /api/health': () => (answers++ === 0 ? new TypeError('offline') : health('warn', ['warn'])),
      });
      renderWithProviders(<HealthPill />, '/', queryClient);
      await screen.findByText('Server unreachable');
      const stream = open();
      act(() => stream.onopen?.());
      expect(await screen.findByText('1 warning')).toBeInTheDocument();
      expect(screen.getByRole('link')).toHaveAttribute('data-health', 'warn');
      expect(healthCalls(calls)).toBe(2);
    });

    it('does not poll while the stream is live', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      try {
        const { calls } = mockApi({ 'GET /api/health': health('ok') });
        renderWithProviders(<HealthPill />, '/', queryClient);
        await screen.findByText('All systems healthy');
        const stream = open();
        act(() => stream.onopen?.());
        await vi.waitFor(() => expect(healthCalls(calls)).toBe(2));
        await act(() => vi.advanceTimersByTimeAsync(5 * 60_000));
        expect(healthCalls(calls)).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('fetches one snapshot on every reopen', async () => {
      const { calls } = mockApi({ 'GET /api/health': health('ok') });
      const stream = open();
      stream.onopen?.();
      await vi.waitFor(() => expect(queryClient.getQueryData(['health'])).toMatchObject({ overall: 'ok' }));
      expect(healthCalls(calls)).toBe(1);
      queryClient.removeQueries({ queryKey: ['health'] });
      stream.onerror?.();
      stream.onopen?.();
      await vi.waitFor(() => expect(queryClient.getQueryData(['health'])).toMatchObject({ overall: 'ok' }));
      expect(healthCalls(calls)).toBe(2);
    });

    it('lets a pushed change win over an older snapshot that arrives later', async () => {
      let release: (value: unknown) => void = () => undefined;
      mockApi({ 'GET /api/health': () => new Promise((resolve) => (release = resolve)) });
      const stream = open();
      stream.onopen?.();
      stream.emit('health', health('error', ['error']));
      release(health('ok'));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(queryClient.getQueryData(['health'])).toMatchObject({ overall: 'error' });
    });

    it('asks the cache for a fresh answer when the snapshot request fails', async () => {
      mockApi({ 'GET /api/health': new TypeError('offline') });
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
      const stream = open();
      stream.onopen?.();
      await vi.waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['health'] }));
    });
  });

  it('opens after the content mark and idle time', async () => {
    performance.clearMarks();
    startServerEventsWhenIdle(queryClient);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(FakeEventSource.instances).toHaveLength(0);
    performance.mark(HOME_CONTENT_MARK);
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
  });

  it('closes the stream', () => {
    const stream = open();
    stopServerEvents();
    expect(stream.closed).toBe(true);
    stopServerEvents();
  });
});
