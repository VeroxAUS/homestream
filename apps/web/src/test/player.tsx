import { act } from '@testing-library/react';
import { vi } from 'vitest';
import { App } from '../App';
import { health, movieDetails, session } from './fixtures';
import { mockApi, renderWithProviders } from './render';

/** jsdom does not play media; these stand-ins keep `paused` and the `play` and `pause` events honest. */
export function stubMedia(): void {
  const paused = new WeakMap<HTMLMediaElement, boolean>();
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
    configurable: true,
    get(this: HTMLMediaElement) {
      return paused.get(this) ?? true;
    },
  });
  HTMLMediaElement.prototype.play = vi.fn(function (this: HTMLMediaElement) {
    paused.set(this, false);
    this.dispatchEvent(new Event('play'));
    this.dispatchEvent(new Event('playing'));
    return Promise.resolve();
  });
  HTMLMediaElement.prototype.pause = vi.fn(function (this: HTMLMediaElement) {
    paused.set(this, true);
    this.dispatchEvent(new Event('pause'));
  });
}

const SESSION_ROUTES = {
  'GET /api/health': health('ok'),
  'GET /api/movie/278': () => movieDetails(),
  'GET /api/progress/movie:278': () =>
    Response.json({ error: { code: 'not_found', message: 'None.' } }, { status: 404 }),
  'POST /api/sessions': () => Response.json(session(), { status: 201 }),
  'PATCH /api/sessions/s1': () => Response.json(session({ selectedAudioIndex: 1 })),
  'DELETE /api/sessions/s1': () => new Response(null, { status: 204 }),
  'POST /api/sessions/s1/progress': () => new Response(null, { status: 204 }),
  'POST /api/prefetch': () => Response.json({}, { status: 202 }),
};

export function openPlayer(routes: Parameters<typeof mockApi>[0] = {}, path = '/play/movie/278') {
  const api = mockApi({ ...SESSION_ROUTES, ...routes });
  return { ...api, ...renderWithProviders(<App />, path) };
}

/** Lets the video report that it has data and plays, the way a started stream does. */
export function startVideo(video: HTMLVideoElement, positionSec = 0): void {
  Object.defineProperty(video, 'readyState', { configurable: true, value: 4 });
  video.currentTime = positionSec;
  act(() => {
    void video.play();
    video.dispatchEvent(new Event('timeupdate'));
  });
}
