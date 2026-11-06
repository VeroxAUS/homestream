import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePageView } from './usePageView';

const track = vi.hoisted(() => vi.fn());
vi.mock('./index', () => ({ trackPageView: track }));

describe('usePageView', () => {
  beforeEach(() => track.mockClear());

  it('reports the path on mount and again when it changes, not on re-render', () => {
    const { rerender } = renderHook(({ path }) => usePageView(path), { initialProps: { path: '/search' } });
    rerender({ path: '/search' });
    rerender({ path: '/movie/603' });
    expect(track.mock.calls).toEqual([['/search'], ['/movie/603']]);
  });
});
