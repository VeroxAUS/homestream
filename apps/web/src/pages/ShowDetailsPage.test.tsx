import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { clearDownloadProgress, setDownloadProgress } from '../events/downloadProgress';
import { download, episode, health, season, showDetails } from '../test/fixtures';
import { apiError, mockApi, renderWithProviders } from '../test/render';

const NO_PROGRESS = { items: [] };

const PROGRESS = {
  items: [
    {
      mediaKey: 'tv:1396:1:1',
      season: 1,
      episode: 1,
      positionSec: 2300,
      durationSec: 2400,
      completed: true,
      resumable: false,
    },
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

function open(routes: Parameters<typeof mockApi>[0], path = '/tv/1396') {
  const api = mockApi({
    'GET /api/health': health('ok'),
    'GET /api/tv/1396': showDetails(),
    'GET /api/tv/1396/season/1': season(1, 3),
    'GET /api/tv/1396/season/2': season(2, 2),
    'GET /api/tv/1396/season/0': season(0, 2),
    'GET /api/tv/1396/progress': NO_PROGRESS,
    ...routes,
  });
  return { ...api, ...renderWithProviders(<App />, path) };
}

function row(name: RegExp) {
  return screen.getByRole('button', { name });
}

describe('ShowDetailsPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearDownloadProgress('tv:1396:1:1');
  });

  it('shows the show with its poster, year, genres and one tab per season, Specials last', async () => {
    open({});
    expect(await screen.findByRole('heading', { level: 1, name: 'Breaking Bad' })).toBeInTheDocument();
    expect(screen.getByText('2008')).toBeInTheDocument();
    expect(screen.getByText('2 seasons')).toBeInTheDocument();
    expect(screen.getByText('A chemistry teacher turns to crime.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Breaking Bad poster' })).toHaveAttribute(
      'src',
      'https://image.tmdb.org/t/p/w500/poster.jpg',
    );
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Season 1', 'Season 2', 'Specials']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
  });

  it('lists the episodes of the first season with number, title, still, overview and runtime', async () => {
    const { calls } = open({});
    const first = await screen.findByRole('button', { name: /Episode title 1/ });
    expect(screen.getAllByRole('listitem').filter((item) => item.hasAttribute('data-episode'))).toHaveLength(3);
    expect(first).toHaveTextContent('1');
    expect(first).toHaveTextContent('What happens in episode 1.');
    expect(first).toHaveTextContent('47 min');
    expect(first.querySelector('img')).toHaveAttribute('src', 'https://image.tmdb.org/t/p/w300/still1.jpg');
    expect(first).toHaveAttribute('aria-pressed', 'true');
    expect(calls.map((call) => call.path)).toContain('/api/tv/1396/season/1');
  });

  it('switches season from the tabs and loads that season', async () => {
    const { calls } = open({});
    await screen.findByRole('button', { name: /Episode title 1/ });
    fireEvent.click(screen.getByRole('tab', { name: 'Season 2' }));
    expect(screen.getByRole('tab', { name: 'Season 2' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Season 1' })).toHaveAttribute('aria-selected', 'false');
    await screen.findByRole('tabpanel', { name: 'Season 2 episodes' });
    await screen.findByRole('list', { name: 'Season 2 episodes' });
    expect(screen.getAllByRole('listitem').filter((item) => item.hasAttribute('data-episode'))).toHaveLength(2);
    expect(calls.map((call) => call.path)).toContain('/api/tv/1396/season/2');
  });

  it('opens the season and episode of a deep link', async () => {
    open({}, '/tv/1396?season=2&episode=2');
    const second = await screen.findByRole('button', { name: /Episode title 2/ });
    expect(second).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('tab', { name: 'Season 2' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Season 2 · Episode 2')).toBeInTheDocument();
  });

  it('falls back to the first season and episode for values the show does not have', async () => {
    open({}, '/tv/1396?season=9&episode=99');
    expect(await screen.findByRole('button', { name: /Episode title 1/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('tab', { name: 'Season 1' })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows Watched, a percentage with a progress bar, and nothing for an untouched episode', async () => {
    open({ 'GET /api/tv/1396/progress': PROGRESS });
    const watched = await screen.findByRole('button', { name: /Episode title 1/ });
    expect(await within(watched).findByText('Watched')).toBeInTheDocument();
    expect(within(watched).queryByRole('progressbar')).not.toBeInTheDocument();

    const started = row(/Episode title 2/);
    expect(within(started).getByText('25%')).toBeInTheDocument();
    expect(within(started).getByRole('progressbar', { name: 'Episode 2 progress' })).toHaveAttribute(
      'aria-valuenow',
      '25',
    );

    const untouched = row(/Episode title 3/);
    expect(within(untouched).queryByText('Watched')).not.toBeInTheDocument();
    expect(within(untouched).queryByRole('progressbar')).not.toBeInTheDocument();
    expect(within(untouched).queryByText(/%/)).not.toBeInTheDocument();
  });

  it('shows the same indicators after the page is opened again', async () => {
    const routes = { 'GET /api/tv/1396/progress': PROGRESS };
    const first = open(routes);
    await within(await screen.findByRole('button', { name: /Episode title 1/ })).findByText('Watched');
    first.unmount();
    open(routes);
    await within(await screen.findByRole('button', { name: /Episode title 1/ })).findByText('Watched');
    expect(within(row(/Episode title 2/)).getByText('25%')).toBeInTheDocument();
  });

  it('selects an episode and offers Play for it in the panel, and in the row', async () => {
    open({});
    fireEvent.click(await screen.findByRole('button', { name: /Episode title 3/ }));
    const panel = screen.getByRole('complementary', { name: 'Selected episode' });
    expect(within(panel).getByText('Season 1 · Episode 3')).toBeInTheDocument();
    expect(within(panel).getByRole('heading', { name: 'Episode title 3' })).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'Play' })).toHaveAttribute('href', '/play/tv/1396/1/3');
    expect(screen.getByRole('link', { name: 'Play episode 3: Episode title 3' })).toHaveAttribute(
      'href',
      '/play/tv/1396/1/3',
    );
    expect(row(/Episode title 3/)).toHaveAttribute('aria-pressed', 'true');
    expect(row(/Episode title 1/)).toHaveAttribute('aria-pressed', 'false');
  });

  it('offers Resume and Start over in the panel for an episode in progress', async () => {
    open({ 'GET /api/tv/1396/progress': PROGRESS });
    fireEvent.click(await screen.findByRole('button', { name: /Episode title 2/ }));
    const panel = screen.getByRole('complementary', { name: 'Selected episode' });
    expect(await within(panel).findByRole('link', { name: 'Resume from 10:00' })).toHaveAttribute(
      'href',
      '/play/tv/1396/1/2?start=600',
    );
    expect(within(panel).getByRole('link', { name: 'Start over' })).toHaveAttribute(
      'href',
      '/play/tv/1396/1/2?start=0',
    );
  });

  it('replaces Play with Downloading for the episode that is being cached', async () => {
    open({
      'GET /api/tv/1396': showDetails({
        downloads: [download({ mediaType: 'tv', tmdbId: 1396, season: 1, episode: 1, progress: 0.3 })],
      }),
    });
    const panel = await screen.findByRole('complementary', { name: 'Selected episode' });
    expect(await within(panel).findByText('Downloading 30%')).toBeInTheDocument();
    expect(within(panel).queryByRole('link', { name: 'Play' })).not.toBeInTheDocument();

    act(() => setDownloadProgress('tv:1396:1:1', 0.75));
    expect(within(panel).getByText('Downloading 75%')).toBeInTheDocument();

    fireEvent.click(row(/Episode title 2/));
    expect(within(panel).getByRole('link', { name: 'Play' })).toBeInTheDocument();
  });

  it('uses the show backdrop, dimmed, for an episode without a still', async () => {
    open({
      'GET /api/tv/1396/season/1': { ...season(1, 1), episodes: [episode(1, { stillUrl: null })] },
    });
    const only = await screen.findByRole('button', { name: /Episode title 1/ });
    expect(only.querySelector('img')).toHaveAttribute('src', 'https://image.tmdb.org/t/p/w300/backdrop.jpg');
    expect(only.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });

  it('drops a still that fails to load instead of showing a broken image', async () => {
    open({});
    const first = await screen.findByRole('button', { name: /Episode title 1/ });
    fireEvent.error(first.querySelector('img') as HTMLImageElement);
    expect(first.querySelector('img')).not.toBeInTheDocument();
  });

  it('pages a season with more than 100 episodes', async () => {
    open({ 'GET /api/tv/1396/season/1': season(1, 130) });
    await screen.findByRole('button', { name: /Episode title 100/ });
    expect(screen.queryByRole('button', { name: /Episode title 101/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show more episodes' }));
    expect(screen.getByRole('button', { name: /Episode title 130/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show more episodes' })).not.toBeInTheDocument();
  });

  it('treats unreadable progress as none', async () => {
    open({ 'GET /api/tv/1396/progress': apiError(500, 'internal_error', 'Broken') });
    const panel = await screen.findByRole('complementary', { name: 'Selected episode' });
    expect(await within(panel).findByRole('link', { name: 'Play' })).toBeInTheDocument();
  });

  it('says so when a season has no episodes or the show lists no seasons', async () => {
    open({ 'GET /api/tv/1396/season/1': { seasonNumber: 1, name: 'Season 1', episodes: [] } });
    expect(await screen.findByText('This season has no episodes yet.')).toBeInTheDocument();
  });

  it('says so when the show lists no seasons', async () => {
    open({ 'GET /api/tv/1396': showDetails({ seasons: [] }) });
    expect(await screen.findByText('No episodes are listed for this show yet.')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('shows a message with Retry when a season cannot be loaded', async () => {
    const answers: unknown[] = [apiError(502, 'tmdb_unavailable', 'TMDB did not answer.'), season(1, 3)];
    open({ 'GET /api/tv/1396/season/1': () => answers.shift() });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Episodes could not be loaded');
    expect(alert).toHaveTextContent('TMDB did not answer.');
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: /Episode title 1/ })).toBeInTheDocument();
  });

  it('shows a loading note while the episodes arrive', async () => {
    open({ 'GET /api/tv/1396/season/1': () => new Promise(() => undefined) });
    expect(await screen.findByText('Loading episodes...')).toBeInTheDocument();
  });

  it('says the show is not found, with a link back to Home, for an unknown id', async () => {
    open({ 'GET /api/tv/999999999': apiError(404, 'not_found', 'Show 999999999 was not found.') }, '/tv/999999999');
    expect(await screen.findByRole('heading', { name: 'Show not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Home' })).toHaveAttribute('href', '/');
  });

  it('treats an address that is not a number as not found', async () => {
    open({}, '/tv/abc');
    expect(await screen.findByRole('heading', { name: 'Show not found' })).toBeInTheDocument();
  });

  it('shows the server message and Retry when the show cannot be loaded', async () => {
    const answers: unknown[] = [apiError(502, 'tmdb_unavailable', 'TMDB did not answer.'), showDetails()];
    open({ 'GET /api/tv/1396': () => answers.shift() });
    const alert = await screen.findByRole('alert');
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Breaking Bad' })).toBeInTheDocument();
  });
});
