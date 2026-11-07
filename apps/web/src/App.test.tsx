import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { HOME_CONTENT_MARK } from './telemetry';
import { health, home, movieDetails } from './test/fixtures';
import { mockApi, renderWithProviders } from './test/render';

const track = vi.hoisted(() => vi.fn());
vi.mock('./telemetry/usePageView', () => ({ usePageView: track }));

const API = {
  'GET /api/home': home(),
  'GET /api/health': health('ok', ['ok']),
  'GET /api/info': { app: 'homestream', name: 'Test PC', version: '1.2.3', port: 8600, lanAddresses: [] },
  'GET /api/movie/278': movieDetails(),
  'GET /api/progress/movie:278': Response.json(
    { error: { code: 'not_found', message: 'No progress.' } },
    { status: 404 },
  ),
};

describe('App routes', () => {
  beforeEach(() => {
    performance.clearMarks();
    track.mockClear();
    mockApi(API);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('opens Home at / with the navigation, and marks the content as shown', async () => {
    renderWithProviders(<App />, '/');
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Trending Movies' })).toBeInTheDocument();
    await vi.waitFor(() => expect(performance.getEntriesByName(HOME_CONTENT_MARK)).toHaveLength(1));
    expect(track).toHaveBeenCalledWith('/');
  });

  it('opens Search', async () => {
    renderWithProviders(<App />, '/search');
    expect(await screen.findByRole('textbox', { name: 'Search movies and shows' })).toBeInTheDocument();
  });

  it('opens Settings', async () => {
    renderWithProviders(<App />, '/settings');
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
  });

  it('opens a movie by deep link', async () => {
    renderWithProviders(<App />, '/movie/278');
    expect(await screen.findByRole('heading', { level: 1, name: movieDetails().title })).toBeInTheDocument();
  });

  it('sends /dashboard to the Health dashboard', async () => {
    renderWithProviders(<App />, '/dashboard');
    expect(await screen.findByRole('heading', { level: 2, name: 'Health' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboards' })).toBeInTheDocument();
    expect(track).toHaveBeenLastCalledWith('/dashboard/health');
  });

  it.each(['health', 'activity', 'history', 'graphs', 'stats'])('has a page for /dashboard/%s', async (tab) => {
    renderWithProviders(<App />, `/dashboard/${tab}`);
    expect(await screen.findByText('This dashboard is not available yet.')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Dashboard sections' })).toBeInTheDocument();
  });

  it('opens the player on its own full-window route, without the main navigation', async () => {
    renderWithProviders(<App />, '/play/movie/278');
    expect(await screen.findByTestId('player-stage')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Back' })).toBeInTheDocument();
  });

  it('shows a not-found page for a player address that is not a title', async () => {
    renderWithProviders(<App />, '/play/movie/abc');
    expect(await screen.findByText('Nothing to play here')).toBeInTheDocument();
  });

  it('shows a not-found page with a way home for any other path', async () => {
    renderWithProviders(<App />, '/no/such/page');
    expect(await screen.findByRole('link', { name: 'Back to Home' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/not found/i);
  });
});
