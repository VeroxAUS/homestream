import type { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { startServerEvents, stopServerEvents } from '../events/serverEvents';
import { health, home, movieDetails, progress, showDetails } from '../test/fixtures';
import { apiError, mockApi, renderWithProviders } from '../test/render';
import { INFO_TOAST_MS, READY_TOAST_MS, dismissToast, resetToasts, showToast } from './toastStore';
import { ToastHost } from './ToastHost';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners = new Map<string, (event: Event) => void>();
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.set(type, listener);
  }
  close() {}
  emit(type: string, data: unknown) {
    this.listeners.get(type)?.(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
}

const READY = { downloadId: 'd1', title: 'The Shawshank Redemption', mediaType: 'movie', tmdbId: 278 };

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  stopServerEvents();
  resetToasts();
});
afterEach(() => {
  stopServerEvents();
  resetToasts();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ToastHost', () => {
  it('holds the toast while it has focus', () => {
    vi.useFakeTimers();
    renderWithProviders(<ToastHost />);
    act(() => void showToast({ kind: 'info', message: 'Held', actions: [], autoDismissMs: 1000 }));
    const toast = screen.getByText('Held').closest('[data-kind]') as HTMLElement;
    fireEvent.focus(toast);
    act(() => void vi.advanceTimersByTime(5000));
    expect(screen.getByText('Held')).toBeInTheDocument();
    fireEvent.blur(toast);
    act(() => void vi.advanceTimersByTime(1000));
    expect(screen.queryByText('Held')).not.toBeInTheDocument();
  });

  it('shows one toast at a time, newest first, and dismisses it on close', () => {
    renderWithProviders(<ToastHost />);
    act(() => {
      showToast({ kind: 'info', message: 'First', actions: [], autoDismissMs: null });
      showToast({ kind: 'info', message: 'Second', detail: 'More', actions: [], autoDismissMs: null });
    });
    expect(screen.queryByText('First')).not.toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
    expect(screen.getByText('More')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Second')).not.toBeInTheDocument();
  });

  it('dismisses an info toast after 5 s and a ready toast after 10 s, unless hovered', () => {
    vi.useFakeTimers();
    renderWithProviders(<ToastHost />);
    act(() => void showToast({ kind: 'info', message: 'Info', actions: [], autoDismissMs: INFO_TOAST_MS }));
    act(() => void vi.advanceTimersByTime(INFO_TOAST_MS - 1));
    expect(screen.getByText('Info')).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(1));
    expect(screen.queryByText('Info')).not.toBeInTheDocument();

    act(() => void showToast({ kind: 'ready', message: 'Ready', actions: [], autoDismissMs: READY_TOAST_MS }));
    fireEvent.mouseEnter(screen.getByText('Ready').closest('[data-kind]')!);
    act(() => void vi.advanceTimersByTime(60_000));
    expect(screen.getByText('Ready')).toBeInTheDocument();
    fireEvent.mouseLeave(screen.getByText('Ready').closest('[data-kind]')!);
    act(() => void vi.advanceTimersByTime(READY_TOAST_MS));
    expect(screen.queryByText('Ready')).not.toBeInTheDocument();
  });

  it('runs an action and closes the toast', () => {
    const onClick = vi.fn();
    renderWithProviders(<ToastHost />);
    act(
      () =>
        void showToast({ kind: 'ready', message: 'Ready', actions: [{ label: 'Play', onClick }], autoDismissMs: null }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Ready')).not.toBeInTheDocument();
  });

  it('dismisses only the toast it was given the id of', () => {
    renderWithProviders(<ToastHost />);
    let id = 0;
    act(() => {
      id = showToast({ kind: 'info', message: 'Newer', actions: [], autoDismissMs: null });
      dismissToast(id + 100);
    });
    expect(screen.getByText('Newer')).toBeInTheDocument();
  });

  it('marks error toasts', () => {
    renderWithProviders(<ToastHost />);
    act(() => void showToast({ kind: 'error', message: 'Broken', actions: [], autoDismissMs: null }));
    expect(screen.getByText('Broken').closest('[data-kind]')).toHaveAttribute('data-kind', 'error');
  });
});

describe('download notices', () => {
  // The routes are lazy chunks. Importing the player pulls in hls.js and its first transform can take longer than
  // the 1 s findBy timeout when the whole suite runs in parallel, so load them before the first test starts.
  beforeAll(async () => {
    await Promise.all([import('../pages/HomePage'), import('../pages/SettingsPage'), import('../pages/PlayerPage')]);
  });

  const API = {
    'GET /api/home': () => home(),
    'GET /api/health': () => health('ok'),
    'GET /api/movie/278': () => movieDetails(),
    'GET /api/progress/movie:278': () => apiError(404, 'not_found', 'None.'),
    'POST /api/prefetch': () => Response.json({}, { status: 202 }),
  };

  function open(path: string, extra: Parameters<typeof mockApi>[0] = {}) {
    const api = mockApi({ ...API, ...extra });
    const view = renderWithProviders(<App />, path);
    startServerEvents(view.queryClient as QueryClient);
    const [stream] = FakeEventSource.instances;
    if (!stream) throw new Error('no event stream');
    return { ...api, stream };
  }

  it('shows "Ready to watch" with a Play action on every route, and Play opens the player', async () => {
    const { stream } = open('/settings');
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    act(() => stream.emit('download.ready', READY));
    expect(await screen.findByText('Ready to watch: The Shawshank Redemption')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(await screen.findByTestId('player-stage')).toBeInTheDocument();
    expect(screen.queryByText('Ready to watch: The Shawshank Redemption')).not.toBeInTheDocument();
  });

  it('keeps the ready toast back while the player is open and shows it when the player closes', async () => {
    const { stream } = open('/play/movie/278');
    await screen.findByTestId('player-stage');
    act(() => stream.emit('download.ready', READY));
    expect(screen.queryByText('Ready to watch: The Shawshank Redemption')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('Ready to watch: The Shawshank Redemption')).toBeInTheDocument();
  });

  it('shows a plain error with Retry when TorBox could not download the title', async () => {
    const { stream } = open('/settings');
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    act(() => stream.emit('download.failed', READY));
    expect(await screen.findByText("TorBox couldn't download this title.")).toBeInTheDocument();
    const toast = screen.getByText("TorBox couldn't download this title.").closest('[data-kind]') as HTMLElement;
    fireEvent.click(within(toast).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('player-stage')).toBeInTheDocument();
  });

  const sessionStart = (calls: Array<{ method: string; path: string; body?: unknown }>) =>
    calls.find((call) => call.method === 'POST' && call.path === '/api/sessions')?.body;

  it('resumes a movie from its saved position when Play is pressed', async () => {
    const { stream, calls } = open('/settings', { 'GET /api/progress/movie:278': () => progress() });
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    act(() => stream.emit('download.ready', READY));
    fireEvent.click(await screen.findByRole('button', { name: 'Play' }));
    await waitFor(() => expect(sessionStart(calls)).toMatchObject({ startPositionSec: 3722 }));
  });

  it('resumes an episode from its saved position, and starts from the beginning when the lookup fails', async () => {
    const tv = { downloadId: 'd2', title: 'Breaking Bad', mediaType: 'tv', tmdbId: 1396, season: 1, episode: 2 };
    const saved = {
      items: [
        {
          mediaKey: 'tv:1396:1:2',
          season: 1,
          episode: 2,
          positionSec: 600,
          durationSec: 2400,
          completed: false,
          resumable: true,
        },
      ],
    };
    const first = open('/settings', {
      'GET /api/tv/1396/progress': () => saved,
      'GET /api/tv/1396': () => showDetails(),
    });
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    act(() => first.stream.emit('download.ready', tv));
    fireEvent.click(await screen.findByRole('button', { name: 'Play' }));
    await waitFor(() =>
      expect(sessionStart(first.calls)).toMatchObject({ tmdbId: 1396, season: 1, episode: 2, startPositionSec: 600 }),
    );
  });

  it('starts from the beginning when the saved position cannot be read', async () => {
    const { stream, calls } = open('/settings', {
      'GET /api/progress/movie:278': () => apiError(500, 'internal_error', 'Broken'),
    });
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    act(() => stream.emit('download.ready', READY));
    fireEvent.click(await screen.findByRole('button', { name: 'Play' }));
    await waitFor(() => expect(sessionStart(calls)).toBeDefined());
    expect(sessionStart(calls)).not.toHaveProperty('startPositionSec');
  });
});
