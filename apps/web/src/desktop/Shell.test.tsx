import type { HealthResponse } from '@homestream/shared';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { stopServerEvents } from '../events/serverEvents';
import { health, INFO, movieDetails } from '../test/fixtures';
import { installBridge } from '../test/desktopBridge';
import { apiError, mockApi, renderWithProviders } from '../test/render';

afterEach(() => {
  delete window.homestream;
  stopServerEvents();
  vi.useRealTimers();
});

const keys = (present: Record<string, boolean>) => {
  const base = health('error', ['error']);
  return {
    ...base,
    checks: [
      {
        ...base.checks[0]!,
        id: 'config' as const,
        details: {
          keys: [
            { name: 'GATEWAY_MANIFEST_URL', required: true, present: present.GATEWAY_MANIFEST_URL ?? false },
            { name: 'TMDB_READ_TOKEN', required: true, present: present.TMDB_READ_TOKEN ?? false },
            { name: 'TORBOX_API_KEY', required: false, present: false },
          ],
        },
      },
    ],
  };
};

describe('First run', () => {
  it('replaces Home with the setup screen and lists missing keys by name only', async () => {
    installBridge();
    mockApi({ 'GET /api/health': keys({ GATEWAY_MANIFEST_URL: true }), 'GET /api/home': apiError(502, 'x', 'no') });
    renderWithProviders(<App />, '/');
    expect(await screen.findByRole('heading', { name: 'Finish setting up' })).toBeInTheDocument();
    expect(screen.getByText(/needs one more key before it can show titles/)).toBeInTheDocument();
    const names = screen.getAllByText(/^[A-Z_]+$/).map((node) => node.textContent);
    expect(names).toEqual(['TMDB_READ_TOKEN', 'GATEWAY_MANIFEST_URL', 'TORBOX_API_KEY']);
    expect(screen.getAllByText('Missing')).toHaveLength(2);
    expect(screen.getAllByText('Set')).toHaveLength(1);
    expect(screen.getByText(/Titles, posters and artwork/)).toBeInTheDocument();
  });

  it('opens config.env and the Health dashboard from its buttons', async () => {
    const bridge = installBridge();
    mockApi({ 'GET /api/health': keys({}) });
    renderWithProviders(<App />, '/');
    await userEvent.click(await screen.findByRole('button', { name: 'Open config.env' }));
    expect(bridge.openConfig).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Open Health dashboard' }));
    expect(await screen.findByRole('link', { name: 'Health' })).toBeInTheDocument();
  });

  it('Check again restarts the server and continues to Home once the keys are set', async () => {
    const bridge = installBridge();
    let answer: HealthResponse = keys({});
    mockApi({
      'GET /api/health': () => answer,
      'GET /api/home': {
        continueWatching: [],
        featured: [],
        trendingMovies: [],
        trendingShows: [],
        popularMovies: [],
        popularShows: [],
      },
    });
    renderWithProviders(<App />, '/');
    await userEvent.click(await screen.findByRole('button', { name: 'Check again' }));
    expect(bridge.restartServer).toHaveBeenCalledTimes(1);
    answer = health('ok');
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Finish setting up' })).not.toBeInTheDocument(), {
      timeout: 4000,
    });
  });

  it('in attach mode Check again says the server is managed outside the app', async () => {
    installBridge({
      restartServer: () => Promise.resolve({ ok: false, message: 'Server is managed outside the app' }),
    });
    mockApi({ 'GET /api/health': keys({}) });
    renderWithProviders(<App />, '/');
    await userEvent.click(await screen.findByRole('button', { name: 'Check again' }));
    expect(await screen.findByText('Server is managed outside the app')).toBeInTheDocument();
  });

  it('is never shown in a plain browser', async () => {
    mockApi({ 'GET /api/health': keys({}), 'GET /api/home': apiError(502, 'x', 'no') });
    renderWithProviders(<App />, '/');
    await screen.findByRole('heading', { name: 'Home' });
    expect(screen.queryByRole('heading', { name: 'Finish setting up' })).not.toBeInTheDocument();
  });
});

describe('Unreachable banner', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));

  it('shows the attempt and counts down while the supervisor restarts the server', async () => {
    installBridge({
      getServerStatus: () => Promise.resolve('Server: crashed \u2014 restarting (2/5)'),
    });
    mockApi({ 'GET /api/health': new Error('offline'), 'GET /api/home': new Error('offline') });
    renderWithProviders(<App />, '/search');
    expect(await screen.findByText("Can't reach the server")).toBeInTheDocument();
    expect(await screen.findByText(/The app is restarting it \(attempt 2 of 5\)/)).toBeInTheDocument();
    expect(screen.getByText('Retrying in 2 s')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(1100));
    expect(screen.getByText('Retrying in 1 s')).toBeInTheDocument();
    expect(screen.getByLabelText('Server unreachable')).toBeInTheDocument();
  });

  it('Retry now restarts the server and Open logs opens the folder', async () => {
    const bridge = installBridge({ getServerStatus: () => Promise.resolve('Server: crashed \u2014 restarting (1/5)') });
    mockApi({ 'GET /api/health': new Error('offline') });
    renderWithProviders(<App />, '/search');
    await userEvent.click(await screen.findByRole('button', { name: 'Retry now' }), { delay: null });
    expect(bridge.restartServer).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Open logs' }), { delay: null });
    expect(bridge.openLogs).toHaveBeenCalledTimes(1);
  });

  it('shows the message instead when the server is managed outside the app', async () => {
    installBridge({
      getServerStatus: () => Promise.resolve('Server: attached to external server'),
      restartServer: () => Promise.resolve({ ok: false, message: 'Server is managed outside the app' }),
    });
    mockApi({ 'GET /api/health': new Error('offline') });
    renderWithProviders(<App />, '/search');
    expect(await screen.findByText(/The app is trying to reach it again/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry now' }), { delay: null });
    expect(await screen.findByText('Server is managed outside the app')).toBeInTheDocument();
  });

  it('is not shown while the server answers, nor in a plain browser', async () => {
    installBridge();
    mockApi({ 'GET /api/health': health('ok') });
    renderWithProviders(<App />, '/search');
    await screen.findByLabelText('All systems healthy');
    expect(screen.queryByText("Can't reach the server")).not.toBeInTheDocument();
    delete window.homestream;
    mockApi({ 'GET /api/health': new Error('offline') });
    renderWithProviders(<App />, '/search');
    await screen.findAllByLabelText('Server unreachable');
    expect(screen.queryByText("Can't reach the server")).not.toBeInTheDocument();
  });
});

describe('keys', () => {
  it('? opens the shortcut sheet and Esc closes it', async () => {
    installBridge();
    mockApi({ 'GET /api/health': health('ok'), 'GET /api/info': INFO });
    renderWithProviders(<App />, '/settings');
    await userEvent.keyboard('?');
    const sheet = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(sheet).toHaveTextContent('Mini player');
    expect(sheet).toHaveTextContent('Close to tray');
    expect(sheet).toHaveTextContent(/Media keys.*They also work while HomeStream is in the background/);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument();
  });

  it('clicking the dimmed backdrop closes the sheet, clicking the sheet does not', async () => {
    installBridge();
    mockApi({ 'GET /api/health': health('ok'), 'GET /api/info': INFO });
    renderWithProviders(<App />, '/settings');
    await userEvent.keyboard('?');
    const sheet = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    await userEvent.click(sheet);
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    await userEvent.click(sheet.parentElement as HTMLElement);
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument();
  });

  it('Ctrl+F and / go to Search, but not while typing', async () => {
    installBridge();
    mockApi({
      'GET /api/health': health('ok'),
      'GET /api/movie/278': () => movieDetails(),
      'GET /api/progress/movie:278': apiError(404, 'not_found', 'none'),
    });
    renderWithProviders(<App />, '/movie/278');
    await screen.findByRole('heading', { level: 1 });
    await userEvent.keyboard('{Control>}f{/Control}');
    expect(await screen.findByRole('textbox')).toBeInTheDocument();
    await userEvent.keyboard('a/b');
    expect(screen.getByRole('textbox')).toHaveValue('a/b');
  });

  it('does nothing in a plain browser', async () => {
    mockApi({ 'GET /api/health': health('ok') });
    renderWithProviders(<App />, '/search');
    await userEvent.keyboard('?');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
