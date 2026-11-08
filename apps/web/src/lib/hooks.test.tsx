import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setBannerIntervalMs, useBannerIntervalMs } from './bannerInterval';
import { HOME_CONTENT_MARK, afterHomeContent, markContentShown, whenIdle } from './startup';
import { useContentShown } from './useContentShown';
import { useDebouncedValue } from './useDebouncedValue';
import { useMediaQuery } from './useMediaQuery';
import { useReducedMotion } from './useReducedMotion';
import { useTmdbId } from './useTmdbId';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useDebouncedValue', () => {
  beforeEach(() => vi.useFakeTimers());

  it('follows the value only after it stopped changing', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: 'a' },
    });
    rerender({ value: 'ab' });
    act(() => void vi.advanceTimersByTime(299));
    expect(result.current).toBe('a');
    rerender({ value: 'abc' });
    act(() => void vi.advanceTimersByTime(299));
    expect(result.current).toBe('a');
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toBe('abc');
  });

  it('starts from the given initial value and settles on the first value after the delay', () => {
    const { result } = renderHook(() => useDebouncedValue('abc', 300, ''));
    expect(result.current).toBe('');
    act(() => void vi.advanceTimersByTime(299));
    expect(result.current).toBe('');
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toBe('abc');
  });
});

describe('useMediaQuery', () => {
  function stubMedia(matches: boolean) {
    const listeners = new Set<() => void>();
    const media = {
      matches,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    };
    const matchMedia = vi.fn(() => media);
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia;
    return { media, listeners, matchMedia };
  }

  it('reports whether the query matches and follows changes', () => {
    const { media, listeners, matchMedia } = stubMedia(false);
    const { result, unmount } = renderHook(() => useMediaQuery('(max-width: 699px)'));
    expect(result.current).toBe(false);
    expect(matchMedia).toHaveBeenCalledWith('(max-width: 699px)');
    media.matches = true;
    act(() => listeners.forEach((listener) => listener()));
    expect(result.current).toBe(true);
    unmount();
    expect(listeners.size).toBe(0);
  });

  it('is false where matchMedia does not exist', () => {
    Reflect.deleteProperty(window, 'matchMedia');
    expect(renderHook(() => useMediaQuery('(max-width: 699px)')).result.current).toBe(false);
  });
});

describe('useTmdbId', () => {
  function idAt(path: string): number | null {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/movie/:id" element={children} />
        </Routes>
      </MemoryRouter>
    );
    return renderHook(() => useTmdbId(), { wrapper }).result.current;
  }

  it('reads a positive whole number', () => {
    expect(idAt('/movie/278')).toBe(278);
  });

  it.each(['abc', '0', '-3', '1.5', '12345678901', '1e3'])('rejects %s', (id) => {
    expect(idAt(`/movie/${id}`)).toBeNull();
  });
});

describe('useReducedMotion', () => {
  function stubMedia(matches: boolean) {
    const listeners = new Set<() => void>();
    const media = {
      matches,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    };
    vi.stubGlobal('matchMedia', () => media);
    window.matchMedia = (() => media) as unknown as typeof window.matchMedia;
    return { media, listeners };
  }

  it('reports the system setting and follows changes', () => {
    const { media, listeners } = stubMedia(false);
    const { result, unmount } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
    media.matches = true;
    act(() => listeners.forEach((listener) => listener()));
    expect(result.current).toBe(true);
    unmount();
    expect(listeners.size).toBe(0);
  });

  it('is false where matchMedia does not exist', () => {
    const original = window.matchMedia;
    // @ts-expect-error jsdom has no matchMedia; this restores that state
    window.matchMedia = undefined;
    expect(renderHook(() => useReducedMotion()).result.current).toBe(false);
    window.matchMedia = original;
  });
});

describe('useBannerIntervalMs', () => {
  afterEach(() => act(() => setBannerIntervalMs(9000)));

  it('is 9 seconds until an experiment changes it', () => {
    const { result } = renderHook(() => useBannerIntervalMs());
    expect(result.current).toBe(9000);
    act(() => setBannerIntervalMs(12000));
    expect(result.current).toBe(12000);
    act(() => setBannerIntervalMs(12000));
    expect(result.current).toBe(12000);
  });
});

describe('startup marks', () => {
  beforeEach(() => performance.clearMarks());

  it('marks once, after a frame', async () => {
    markContentShown();
    markContentShown();
    await vi.waitFor(() => expect(performance.getEntriesByName(HOME_CONTENT_MARK)).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(performance.getEntriesByName(HOME_CONTENT_MARK)).toHaveLength(1);
  });

  it('useContentShown marks only when ready', async () => {
    const { rerender } = renderHook(({ ready }) => useContentShown(ready), { initialProps: { ready: false } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(performance.getEntriesByName(HOME_CONTENT_MARK)).toHaveLength(0);
    rerender({ ready: true });
    await vi.waitFor(() => expect(performance.getEntriesByName(HOME_CONTENT_MARK)).toHaveLength(1));
  });

  it('afterHomeContent resolves at once when the mark exists', async () => {
    performance.mark(HOME_CONTENT_MARK);
    await expect(afterHomeContent()).resolves.toBeUndefined();
  });

  it('afterHomeContent resolves when the mark appears', async () => {
    let done = false;
    const waiting = afterHomeContent().then(() => (done = true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(done).toBe(false);
    performance.mark(HOME_CONTENT_MARK);
    await waiting;
    expect(done).toBe(true);
  });

  it('afterHomeContent gives up waiting after a limit', async () => {
    vi.useFakeTimers();
    const waiting = afterHomeContent();
    await vi.advanceTimersByTimeAsync(8000);
    await expect(waiting).resolves.toBeUndefined();
  });

  it('whenIdle uses requestIdleCallback, or a timer without it', async () => {
    const idle = vi.fn((callback: () => void) => callback());
    vi.stubGlobal('requestIdleCallback', idle);
    await whenIdle();
    expect(idle).toHaveBeenCalledOnce();
    vi.stubGlobal('requestIdleCallback', undefined);
    await expect(whenIdle()).resolves.toBeUndefined();
  });
});
