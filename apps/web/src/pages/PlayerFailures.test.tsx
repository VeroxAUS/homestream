import { act, cleanup, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetToasts } from '../notices/toastStore';
import { useFullscreen } from '../player/usePlayerActions';
import { resetPrefetchMemory } from '../player/sessionApi';
import { FakeHls } from '../test/fakeHls';
import { openPlayer, startVideo, stubMedia } from '../test/player';
import { apiError } from '../test/render';

vi.mock('hls.js', async () => (await import('../test/fakeHls')).hlsModule);

beforeEach(() => {
  FakeHls.instances = [];
  FakeHls.isSupported = () => true;
  stubMedia();
  resetToasts();
  resetPrefetchMemory();
});
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 5));
  Reflect.deleteProperty(document, 'fullscreenElement');
  Reflect.deleteProperty(navigator, 'mediaSession');
  vi.unstubAllGlobals();
});

const press = (key: string) => fireEvent.keyDown(document.body, { key });
const flush = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
const blockPlay = () => {
  const play = vi.fn(() => Promise.reject(new Error('blocked')));
  HTMLMediaElement.prototype.play = play;
  return play;
};

async function playing(routes: Parameters<typeof openPlayer>[0] = {}) {
  const api = openPlayer(routes);
  const video = (await screen.findByTestId('player-video')) as HTMLVideoElement;
  startVideo(video, 100);
  act(() => FakeHls.last.emit('hlsSubtitleTracksUpdated'));
  return { ...api, video };
}

describe('a browser that refuses to start playback', () => {
  it('stays quiet when Play, the manifest start and the media key are refused', async () => {
    const handlers = new Map<string, (() => void) | null>();
    Object.defineProperty(navigator, 'mediaSession', {
      configurable: true,
      value: {
        playbackState: 'none',
        metadata: null,
        setActionHandler: (a: string, h: () => void) => handlers.set(a, h),
      },
    });
    const { video } = await playing();
    const play = blockPlay();
    press(' ');
    expect(video.paused).toBe(true);
    press(' ');
    act(() => FakeHls.last.emit('hlsManifestParsed'));
    act(() => handlers.get('play')?.());
    await flush();
    expect(play).toHaveBeenCalledTimes(3);
    expect(screen.queryByTestId('player-error')).not.toBeInTheDocument();
  });

  it('stays quiet when a natively played stream is refused', async () => {
    FakeHls.isSupported = () => false;
    HTMLMediaElement.prototype.canPlayType = vi.fn((): CanPlayTypeResult => 'maybe');
    openPlayer();
    const video = (await screen.findByTestId('player-video')) as HTMLVideoElement;
    await waitFor(() => expect(video.getAttribute('src')).toBe('/hls/s1/index.m3u8'));
    const play = blockPlay();
    video.dispatchEvent(new Event('loadedmetadata'));
    await flush();
    expect(play).toHaveBeenCalledTimes(1);
  });
});

describe('a browser that refuses fullscreen changes', () => {
  it('stays quiet when entering or leaving fullscreen is refused', async () => {
    await playing();
    const stage = screen.getByTestId('player-stage');
    const request = vi.fn(() => Promise.reject(new Error('denied')));
    stage.requestFullscreen = request;
    press('f');
    const exit = vi.fn(() => Promise.reject(new Error('denied')));
    document.exitFullscreen = exit;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => stage });
    press('f');
    press('Escape');
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(2);
  });

  it('stays quiet when locking Escape and leaving fullscreen on close are refused', async () => {
    const lock = vi.fn(() => Promise.reject(new Error('denied')));
    vi.stubGlobal('navigator', { ...navigator, keyboard: { lock, unlock: vi.fn() } });
    const stage = document.createElement('div');
    const exit = vi.fn(() => Promise.reject(new Error('denied')));
    document.exitFullscreen = exit;
    const ref = { current: stage };
    const { result, unmount } = renderHook(() => useFullscreen(ref));
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => stage });
    act(() => void document.dispatchEvent(new Event('fullscreenchange')));
    expect(result.current).toBe(true);
    unmount();
    await flush();
    expect(lock).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });
});

describe('other failures', () => {
  it('keeps the info panel open when the encoder speed cannot be refreshed', async () => {
    await playing({ 'GET /api/sessions/s1': () => apiError(500, 'internal_error', 'Broken') });
    press('i');
    await flush();
    expect(screen.getByTestId('player-info')).toBeInTheDocument();
  });

  it('leaves the error screen with Esc', async () => {
    openPlayer({ 'POST /api/sessions': () => apiError(500, 'internal_error', 'Broken') });
    expect(await screen.findByTestId('player-error')).toBeInTheDocument();
    press('Escape');
    await waitFor(() => expect(screen.queryByTestId('player-error')).not.toBeInTheDocument());
  });
});
