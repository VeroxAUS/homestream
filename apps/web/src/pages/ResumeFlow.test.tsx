import type { ContinueWatchingItem, HomeResponse } from '@homestream/shared';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { resetToasts } from '../notices/toastStore';
import { resetPrefetchMemory } from '../player/sessionApi';
import { FakeHls } from '../test/fakeHls';
import {
  continueWatching,
  episode,
  health,
  home,
  movieDetails,
  progress,
  season,
  session,
  showDetails,
} from '../test/fixtures';
import { startVideo, stubMedia } from '../test/player';
import { apiError, mockApi, renderWithProviders } from '../test/render';

vi.mock('hls.js', async () => (await import('../test/fakeHls')).hlsModule);

const DURATION_SEC = 8520;
const COMPLETED_AT = 0.92;

interface Saved {
  positionSec: number;
  completed: boolean;
}

/** A server that keeps the saved position the way the real one does: pings write it, Home and details read it. */
function fakeServer(saved: { current: Saved | null }, extra: Record<string, unknown> = {}) {
  const rows = (): ContinueWatchingItem[] => {
    const entry = saved.current;
    return entry && entry.positionSec >= 60 && !entry.completed
      ? [continueWatching({ positionSec: entry.positionSec, durationSec: DURATION_SEC })]
      : [];
  };
  return mockApi({
    'GET /api/health': health('ok'),
    'GET /api/home': (): HomeResponse => home({ continueWatching: rows() }),
    'GET /api/movie/278': movieDetails(),
    'GET /api/progress/movie:278': () =>
      saved.current
        ? progress({
            positionSec: saved.current.positionSec,
            completed: saved.current.completed,
            resumable: saved.current.positionSec >= 60 && !saved.current.completed,
          })
        : apiError(404, 'not_found', 'Nothing saved.'),
    'POST /api/sessions': () => Response.json(session({ durationSec: DURATION_SEC }), { status: 201 }),
    'DELETE /api/sessions/s1': new Response(null, { status: 204 }),
    'POST /api/prefetch': Response.json({}, { status: 202 }),
    'POST /api/sessions/s1/progress': ({ init }: { init: RequestInit | undefined }) => {
      const { positionSec } = JSON.parse(String(init?.body)) as { positionSec: number };
      saved.current = { positionSec, completed: positionSec >= DURATION_SEC * COMPLETED_AT };
      return new Response(null, { status: 204 });
    },
    ...extra,
  });
}

/** Never refetches by itself, so a Home that shows fresh data proves the player marked it stale. */
function patientClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
}

beforeEach(() => {
  FakeHls.instances = [];
  stubMedia();
  resetToasts();
  resetPrefetchMemory();
});
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 5));
  vi.unstubAllGlobals();
});

async function watchAndLeave(startAt: number): Promise<void> {
  fireEvent.click(await screen.findByRole('link', { name: /^(Play|Resume from .*)$/ }));
  startVideo((await screen.findByTestId('player-video')) as HTMLVideoElement, startAt);
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  await waitFor(() => expect(screen.queryByTestId('player-stage')).not.toBeInTheDocument());
}

describe('continue watching after a play', () => {
  it('lists a title left after more than a minute, with its progress, even when Home was cached before', async () => {
    const saved = { current: null as Saved | null };
    const { calls } = fakeServer(saved);
    const queryClient = patientClient();
    queryClient.setQueryData(['home'], home());
    renderWithProviders(<App />, '/movie/278', queryClient);

    await watchAndLeave(600);
    await waitFor(() => expect(calls.some((call) => call.path === '/api/sessions/s1')).toBe(true));
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Home' }));

    const row = await screen.findByRole('region', { name: 'Continue Watching' });
    expect(within(row).getByText('The Shawshank Redemption')).toBeInTheDocument();
    expect(within(row).getByRole('progressbar', { name: 'The Shawshank Redemption progress' })).toHaveAttribute(
      'aria-valuenow',
      '7',
    );
  });

  it('does not list a title left before a minute', async () => {
    const saved = { current: null as Saved | null };
    fakeServer(saved);
    const queryClient = patientClient();
    queryClient.setQueryData(['home'], home());
    renderWithProviders(<App />, '/movie/278', queryClient);

    await watchAndLeave(20);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Home' }));

    await screen.findByRole('heading', { name: 'Trending Movies' });
    expect(screen.queryByRole('region', { name: 'Continue Watching' })).not.toBeInTheDocument();
  });

  it('offers Resume and Start over on reopening, and each starts the session at its own position', async () => {
    const saved = { current: { positionSec: 600, completed: false } as Saved | null };
    const { calls } = fakeServer(saved);
    renderWithProviders(<App />, '/movie/278', patientClient());

    const resume = await screen.findByRole('link', { name: 'Resume from 10:00' });
    expect(resume).toHaveAttribute('href', '/play/movie/278?start=600');
    const startOver = screen.getByRole('link', { name: 'Start over' });
    expect(startOver).toHaveAttribute('href', '/play/movie/278?start=0');

    fireEvent.click(startOver);
    await screen.findByTestId('player-video');
    expect(calls.filter((call) => call.path === '/api/sessions')[0]?.body).toMatchObject({ startPositionSec: 0 });
  });

  it('removes a title that was played to the end and shows Play with a Watched mark', async () => {
    const saved = { current: { positionSec: 600, completed: false } as Saved | null };
    fakeServer(saved);
    const queryClient = patientClient();
    queryClient.setQueryData(['home'], home({ continueWatching: [continueWatching({ positionSec: 600 })] }));
    renderWithProviders(<App />, '/movie/278', queryClient);

    await watchAndLeave(DURATION_SEC * 0.95);
    expect(await screen.findByRole('link', { name: 'Play' })).toHaveAttribute('href', '/play/movie/278');
    expect(screen.getByText('Watched')).toBeInTheDocument();
    expect(screen.queryByText(/Resume/)).not.toBeInTheDocument();

    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Home' }));
    await screen.findByRole('heading', { name: 'Trending Movies' });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Continue Watching' })).not.toBeInTheDocument());
  });
});

describe('up next', () => {
  it('opens the next episode from its Continue Watching card, ready to play', async () => {
    const upNext = continueWatching({
      mediaKey: 'tv:1396:1:2',
      type: 'tv',
      tmdbId: 1396,
      title: 'Breaking Bad',
      season: 1,
      episode: 2,
      episodeTitle: 'Episode title 2',
      positionSec: 0,
      durationSec: 2820,
      upNext: true,
    });
    mockApi({
      'GET /api/health': health('ok'),
      'GET /api/home': home({ continueWatching: [upNext] }),
      'GET /api/tv/1396': showDetails(),
      'GET /api/tv/1396/season/1': { ...season(1, 3), episodes: [episode(1), episode(2), episode(3)] },
      'GET /api/tv/1396/progress': {
        items: [
          {
            mediaKey: 'tv:1396:1:1',
            season: 1,
            episode: 1,
            positionSec: 2700,
            durationSec: 2820,
            completed: true,
            resumable: false,
          },
        ],
      },
      'POST /api/prefetch': Response.json({}, { status: 202 }),
    });
    renderWithProviders(<App />, '/', patientClient());

    const row = await screen.findByRole('region', { name: 'Continue Watching' });
    expect(within(row).getAllByText('Up next').length).toBeGreaterThan(0);
    fireEvent.click(within(row).getByRole('link', { name: /Breaking Bad/ }));

    const panel = await screen.findByRole('complementary', { name: 'Selected episode' });
    expect(within(panel).getByRole('heading', { name: 'Episode title 2' })).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'Play' })).toHaveAttribute('href', '/play/tv/1396/1/2');
  });
});
