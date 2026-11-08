import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HIDE_SPOILERS_KEY, SPOILER_TEXT, isEpisodeHidden, setHideSpoilers, useHideSpoilers } from './spoilers';

describe('hide episode spoilers setting', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('is on by default and for any stored value except off', () => {
    const { result } = renderHook(() => useHideSpoilers());
    expect(result.current).toBe(true);
    localStorage.setItem(HIDE_SPOILERS_KEY, 'on');
    expect(renderHook(() => useHideSpoilers()).result.current).toBe(true);
    localStorage.setItem(HIDE_SPOILERS_KEY, 'off');
    expect(renderHook(() => useHideSpoilers()).result.current).toBe(false);
  });

  it('stores off under homestream.hideSpoilers and clears the key when turned on again', () => {
    expect(HIDE_SPOILERS_KEY).toBe('homestream.hideSpoilers');
    setHideSpoilers(false);
    expect(localStorage.getItem('homestream.hideSpoilers')).toBe('off');
    setHideSpoilers(true);
    expect(localStorage.getItem('homestream.hideSpoilers')).toBeNull();
  });

  it('re-renders every consumer at once when the setting changes', () => {
    const first = renderHook(() => useHideSpoilers());
    const second = renderHook(() => useHideSpoilers());
    act(() => setHideSpoilers(false));
    expect(first.result.current).toBe(false);
    expect(second.result.current).toBe(false);
    act(() => setHideSpoilers(true));
    expect(first.result.current).toBe(true);
  });

  it('follows a change made in another tab', () => {
    const { result } = renderHook(() => useHideSpoilers());
    act(() => {
      localStorage.setItem(HIDE_SPOILERS_KEY, 'off');
      window.dispatchEvent(new StorageEvent('storage', { key: HIDE_SPOILERS_KEY }));
    });
    expect(result.current).toBe(false);
  });

  it('ignores storage events about other keys', () => {
    const { result } = renderHook(() => useHideSpoilers());
    const before = result.current;
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'homestream.deviceName' }));
    });
    expect(result.current).toBe(before);
  });

  it('keeps the choice for the page when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = renderHook(() => useHideSpoilers());
    expect(result.current).toBe(true);
    act(() => setHideSpoilers(false));
    expect(result.current).toBe(false);
    act(() => setHideSpoilers(true));
    expect(result.current).toBe(true);
  });

  it('hides an episode unless its progress says it is finished', () => {
    expect(isEpisodeHidden(true, undefined)).toBe(true);
    expect(isEpisodeHidden(true, null)).toBe(true);
    expect(isEpisodeHidden(true, { completed: false })).toBe(true);
    expect(isEpisodeHidden(true, { completed: true })).toBe(false);
    expect(isEpisodeHidden(false, { completed: false })).toBe(false);
    expect(isEpisodeHidden(false, undefined)).toBe(false);
  });

  it('uses the agreed placeholder wording', () => {
    expect(SPOILER_TEXT).toBe("Hidden to avoid spoilers. It appears once you've watched this episode.");
  });
});
