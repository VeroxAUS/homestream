import { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { download, movieDetails, showDetails } from '../test/fixtures';
import { markDownloading } from './downloading';
import { SeekBar, TimeLabel } from './SeekBar';
import { useIdleChrome } from './useIdleChrome';
import { useFullscreen } from './usePlayerActions';
import { bufferedEnd, useVideoState } from './useVideoState';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'fullscreenElement');
});

describe('useIdleChrome', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));

  function Harness({ blocked = false }: { blocked?: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    useIdleChrome(ref, blocked);
    return (
      <div ref={ref} data-testid="stage">
        <div data-chrome-bar="" data-testid="bar">
          <button type="button">Go</button>
        </div>
        <div data-testid="free" />
      </div>
    );
  }
  const chrome = () => screen.getByTestId('stage').dataset.chrome;
  const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

  it('hides after 3 s, returns on a real mouse move and ignores a tiny one', () => {
    render(<Harness />);
    expect(chrome()).toBe('visible');
    wait(3000);
    expect(chrome()).toBe('hidden');
    fireEvent.mouseMove(screen.getByTestId('stage'), { clientX: 1, clientY: 1 });
    expect(chrome()).toBe('hidden');
    fireEvent.mouseMove(screen.getByTestId('stage'), { clientX: 40, clientY: 40 });
    expect(chrome()).toBe('visible');
    wait(3000);
    expect(chrome()).toBe('hidden');
  });

  it('returns on a key press, a click and a touch', () => {
    render(<Harness />);
    for (const show of [
      () => fireEvent.keyDown(document.body, { key: 'a' }),
      () => fireEvent.mouseDown(screen.getByTestId('free')),
      () => fireEvent.touchStart(screen.getByTestId('free')),
    ]) {
      wait(3000);
      expect(chrome()).toBe('hidden');
      act(show);
      expect(chrome()).toBe('visible');
    }
  });

  it('never hides while the pointer is over a bar, and counts down again after it leaves', () => {
    render(<Harness />);
    fireEvent.mouseOver(screen.getByTestId('bar'));
    wait(20_000);
    expect(chrome()).toBe('visible');
    fireEvent.mouseOver(screen.getByTestId('free'));
    wait(3000);
    expect(chrome()).toBe('hidden');
    fireEvent.mouseOver(screen.getByTestId('bar'));
    expect(chrome()).toBe('visible');
    fireEvent.mouseLeave(screen.getByTestId('stage'));
    wait(3000);
    expect(chrome()).toBe('hidden');
  });

  it('keeps a bar control that has keyboard focus visible', () => {
    render(<Harness />);
    const button = screen.getByRole('button', { name: 'Go' });
    const spy = vi.spyOn(button, 'matches').mockReturnValue(true);
    fireEvent.focusIn(button);
    wait(20_000);
    expect(chrome()).toBe('visible');
    fireEvent.focusOut(button);
    spy.mockReturnValue(false);
    wait(3000);
    expect(chrome()).toBe('hidden');
    fireEvent.focusIn(button);
    wait(3000);
    expect(chrome()).toBe('hidden');
  });

  it('stays up while blocked and hides again once unblocked', () => {
    const { rerender } = render(<Harness blocked />);
    wait(20_000);
    expect(chrome()).toBe('visible');
    rerender(<Harness blocked={false} />);
    wait(3000);
    expect(chrome()).toBe('hidden');
  });
});

describe('useVideoState', () => {
  function Harness() {
    const ref = useRef<HTMLVideoElement>(null);
    const state = useVideoState(ref);
    return (
      <>
        <video ref={ref} data-testid="video" />
        <output data-testid="state">{JSON.stringify(state)}</output>
      </>
    );
  }
  const read = () => JSON.parse(screen.getByTestId('state').textContent ?? '{}') as Record<string, unknown>;
  const fire = (name: string) => act(() => void screen.getByTestId('video').dispatchEvent(new Event(name)));

  it('follows play, pause, buffering and volume', () => {
    render(<Harness />);
    expect(read()).toMatchObject({ paused: true, buffering: true });
    fire('play');
    fire('playing');
    expect(read()).toMatchObject({ paused: false, buffering: false });
    fire('waiting');
    expect(read().buffering).toBe(true);
    fire('playing');
    fire('seeking');
    expect(read().buffering).toBe(true);
    fire('emptied');
    fire('pause');
    expect(read()).toMatchObject({ paused: true, buffering: true });
    const video = screen.getByTestId('video') as HTMLVideoElement;
    Object.defineProperty(video, 'readyState', { configurable: true, value: 4 });
    fire('canplay');
    expect(read().buffering).toBe(false);
    fire('seeking');
    fire('seeked');
    expect(read().buffering).toBe(false);
    Object.defineProperty(video, 'readyState', { configurable: true, value: 1 });
    fire('seeked');
    expect(read().buffering).toBe(true);
    video.volume = 0.25;
    video.muted = true;
    fire('volumechange');
    expect(read()).toMatchObject({ volume: 0.25, muted: true });
  });

  it('finds the end of the buffered range around a time', () => {
    const ranges = (list: Array<[number, number]>) =>
      ({ length: list.length, start: (i: number) => list[i]![0], end: (i: number) => list[i]![1] }) as TimeRanges;
    expect(bufferedEnd(ranges([[0, 30]]), 10)).toBe(30);
    expect(
      bufferedEnd(
        ranges([
          [0, 5],
          [20, 60],
        ]),
        20.2,
      ),
    ).toBe(60);
    expect(bufferedEnd(ranges([[0, 5]]), 40)).toBe(40);
    expect(bufferedEnd(ranges([]), 7)).toBe(7);
  });
});

describe('SeekBar', () => {
  function Harness({ onSeek }: { onSeek: (sec: number) => void }) {
    const ref = useRef<HTMLVideoElement>(null);
    return (
      <>
        <video ref={ref} data-testid="video" />
        <SeekBar videoRef={ref} durationSec={100} onSeek={onSeek} />
        <TimeLabel videoRef={ref} durationSec={100} />
      </>
    );
  }
  const pointer = (type: string, clientX: number) => {
    const slider = screen.getByRole('slider', { name: 'Seek' });
    act(() => void slider.dispatchEvent(new MouseEvent(type, { clientX, bubbles: true })));
  };

  beforeEach(() => {
    Element.prototype.setPointerCapture = vi.fn();
  });

  it('draws the played and buffered part and the time from the video clock', () => {
    const { container } = render(<Harness onSeek={vi.fn()} />);
    const video = screen.getByTestId('video') as HTMLVideoElement;
    Object.defineProperty(video, 'buffered', {
      configurable: true,
      value: { length: 1, start: () => 0, end: () => 40 },
    });
    video.currentTime = 20;
    act(() => void video.dispatchEvent(new Event('timeupdate')));
    const slider = screen.getByRole('slider', { name: 'Seek' });
    expect(slider).toHaveAttribute('aria-valuenow', '20');
    expect(slider).toHaveAttribute('aria-valuetext', '0:20');
    const bars = container.querySelectorAll<HTMLElement>('[class*="buffered"], [class*="elapsed"]');
    expect([...bars].map((bar) => bar.style.transform)).toEqual(['scaleX(0.4)', 'scaleX(0.2)']);
    expect(screen.getByText('0:20 / 1:40')).toBeInTheDocument();
  });

  it('previews while dragging and seeks on release', () => {
    const onSeek = vi.fn();
    const { container } = render(<Harness onSeek={onSeek} />);
    const track = container.querySelector('[class*="track"]') as HTMLElement;
    track.getBoundingClientRect = () => ({ left: 0, width: 200 }) as DOMRect;
    pointer('pointermove', 50);
    expect(onSeek).not.toHaveBeenCalled();
    pointer('pointerdown', 100);
    expect(screen.getByRole('slider', { name: 'Seek' })).toHaveAttribute('aria-valuenow', '50');
    pointer('pointermove', 150);
    expect(screen.getByRole('slider', { name: 'Seek' })).toHaveAttribute('aria-valuenow', '75');
    pointer('pointerup', 150);
    expect(onSeek).toHaveBeenCalledWith(75);
    pointer('pointerup', 10);
    expect(onSeek).toHaveBeenCalledTimes(1);
    pointer('pointerdown', 20);
    pointer('pointercancel', 20);
    pointer('pointerup', 20);
    expect(onSeek).toHaveBeenCalledTimes(1);
  });

  it('treats a track without width as the start', () => {
    const onSeek = vi.fn();
    render(<Harness onSeek={onSeek} />);
    pointer('pointerdown', 100);
    pointer('pointerup', 100);
    expect(onSeek).toHaveBeenCalledWith(0);
  });
});

describe('useFullscreen', () => {
  it('follows the stage, locks Escape while it is fullscreen and leaves fullscreen when the player closes', () => {
    const lock = vi.fn(() => Promise.resolve());
    const unlock = vi.fn();
    vi.stubGlobal('navigator', { ...navigator, keyboard: { lock, unlock } });
    const stage = document.createElement('div');
    const exit = vi.fn(() => Promise.resolve());
    document.exitFullscreen = exit;
    const ref = { current: stage };
    const { result, unmount } = renderHook(() => useFullscreen(ref));
    expect(result.current).toBe(false);
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => stage });
    act(() => void document.dispatchEvent(new Event('fullscreenchange')));
    expect(result.current).toBe(true);
    expect(lock).toHaveBeenCalledWith(['Escape']);
    unmount();
    expect(exit).toHaveBeenCalledTimes(1);
    expect(unlock).toHaveBeenCalled();
  });

  it('ignores another element going fullscreen', () => {
    const stage = document.createElement('div');
    const ref = { current: stage };
    const { result } = renderHook(() => useFullscreen(ref));
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => document.body });
    act(() => void document.dispatchEvent(new Event('fullscreenchange')));
    expect(result.current).toBe(false);
  });
});

describe('markDownloading', () => {
  it('puts the download into the cached movie details and asks for a refresh', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['movie', 278], movieDetails());
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    markDownloading(queryClient, { mediaType: 'movie', tmdbId: 278 }, download());
    expect(queryClient.getQueryData<{ download?: unknown }>(['movie', 278])?.download).toMatchObject({ id: 'd1' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['movie', 278] });
    markDownloading(queryClient, { mediaType: 'movie', tmdbId: 1 }, download());
    expect(queryClient.getQueryData(['movie', 1])).toBeUndefined();
  });

  it('replaces the download of the same episode in the cached show details', () => {
    const queryClient = new QueryClient();
    const old = download({ id: 'old', mediaType: 'tv', tmdbId: 1396, season: 1, episode: 2 });
    const other = download({ id: 'other', mediaType: 'tv', tmdbId: 1396, season: 1, episode: 3 });
    queryClient.setQueryData(['show', 1396], showDetails({ downloads: [old, other] }));
    markDownloading(
      queryClient,
      { mediaType: 'tv', tmdbId: 1396, season: 1, episode: 2 },
      download({ id: 'new', mediaType: 'tv', tmdbId: 1396, season: 1, episode: 2 }),
    );
    const ids = queryClient
      .getQueryData<{ downloads: Array<{ id: string }> }>(['show', 1396])
      ?.downloads.map((d) => d.id);
    expect(ids).toEqual(['other', 'new']);
    markDownloading(queryClient, { mediaType: 'tv', tmdbId: 5, season: 1, episode: 1 }, download());
    expect(queryClient.getQueryData(['show', 5])).toBeUndefined();
  });
});
