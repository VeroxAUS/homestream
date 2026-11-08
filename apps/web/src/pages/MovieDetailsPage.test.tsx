import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { clearDownloadProgress, setDownloadProgress } from '../events/downloadProgress';
import { resetPrefetchMemory } from '../player/sessionApi';
import { castMember, download, health, home, media, movieDetails, progress } from '../test/fixtures';
import { apiError, mockApi, renderWithProviders } from '../test/render';

const NO_PROGRESS = apiError(404, 'not_found', 'Nothing saved.');

function open(routes: Parameters<typeof mockApi>[0], path = '/movie/278') {
  const api = mockApi({ 'GET /api/health': health('ok'), ...routes });
  return { ...api, ...renderWithProviders(<App />, path) };
}

describe('MovieDetailsPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearDownloadProgress('movie:278');
  });

  it('shows the full metadata, the poster at w500, the backdrop at w1280 and a Play link', async () => {
    const { container } = open({ 'GET /api/movie/278': movieDetails(), 'GET /api/progress/movie:278': NO_PROGRESS });
    expect(await screen.findByRole('heading', { level: 1, name: 'The Shawshank Redemption' })).toBeInTheDocument();
    expect(screen.getByText('1994')).toBeInTheDocument();
    expect(screen.getByText('2h 22m')).toBeInTheDocument();
    expect(screen.getByText('8.7')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Genres' })).toHaveTextContent('DramaCrime');
    expect(screen.getByText('Two imprisoned men bond over a number of years.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'The Shawshank Redemption poster' })).toHaveAttribute(
      'src',
      'https://image.tmdb.org/t/p/w500/poster.jpg',
    );
    expect(container.querySelector('img[fetchpriority="high"]')).toHaveAttribute(
      'src',
      'https://image.tmdb.org/t/p/w1280/backdrop.jpg',
    );
    expect(await screen.findByRole('link', { name: 'Play' })).toHaveAttribute('href', '/play/movie/278');
    expect(screen.queryByText(/Choose stream/i)).not.toBeInTheDocument();
  });

  it('offers plain Play, with no Resume or Start over, when nothing is saved', async () => {
    open({ 'GET /api/movie/278': movieDetails(), 'GET /api/progress/movie:278': NO_PROGRESS });
    const play = await screen.findByRole('link', { name: 'Play' });
    expect(play).not.toHaveAttribute('href', expect.stringContaining('start'));
    expect(screen.queryByText(/Resume/)).not.toBeInTheDocument();
    expect(screen.queryByText('Start over')).not.toBeInTheDocument();
  });

  it('offers Resume from the saved time and Start over when the saved progress is resumable', async () => {
    open({ 'GET /api/movie/278': movieDetails(), 'GET /api/progress/movie:278': progress() });
    const resume = await screen.findByRole('link', { name: 'Resume from 1:02:02' });
    expect(resume).toHaveAttribute('href', '/play/movie/278?start=3722');
    expect(screen.getByRole('link', { name: 'Start over' })).toHaveAttribute('href', '/play/movie/278?start=0');
    expect(screen.queryByRole('link', { name: 'Play' })).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'The Shawshank Redemption progress' })).toHaveAttribute(
      'aria-valuenow',
      '44',
    );
    expect(screen.getByText('1:02:02 of 2h 22m · 1 h 20 min left')).toBeInTheDocument();
  });

  it('goes back to Play with a Watched mark once the title is completed', async () => {
    open({
      'GET /api/movie/278': movieDetails(),
      'GET /api/progress/movie:278': progress({ completed: true, resumable: false, positionSec: 8400 }),
    });
    expect(await screen.findByRole('link', { name: 'Play' })).toBeInTheDocument();
    expect(screen.getByText('Watched')).toBeInTheDocument();
    expect(screen.queryByText(/Resume/)).not.toBeInTheDocument();
  });

  it('offers Play when the saved progress is too short to resume', async () => {
    open({
      'GET /api/movie/278': movieDetails(),
      'GET /api/progress/movie:278': progress({ resumable: false, positionSec: 20 }),
    });
    expect(await screen.findByRole('link', { name: 'Play' })).toBeInTheDocument();
    expect(screen.queryByText('Watched')).not.toBeInTheDocument();
  });

  it('still offers Play when the progress request fails', async () => {
    open({
      'GET /api/movie/278': movieDetails(),
      'GET /api/progress/movie:278': apiError(500, 'internal_error', 'Broken'),
    });
    expect(await screen.findByRole('link', { name: 'Play' })).toBeInTheDocument();
  });

  it('shows a loading placeholder, and no Play button until the saved progress is known', async () => {
    let release: (value: unknown) => void = () => undefined;
    const slow = new Promise((resolve) => (release = resolve));
    open({ 'GET /api/movie/278': () => slow, 'GET /api/progress/movie:278': NO_PROGRESS });
    expect(screen.getByRole('status', { name: 'Loading details' })).toBeInTheDocument();
    release(movieDetails());
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('replaces Play with a Downloading badge while a download is pending, and follows its progress', async () => {
    open({
      'GET /api/movie/278': movieDetails({ download: download() }),
      'GET /api/progress/movie:278': NO_PROGRESS,
    });
    const badge = (await screen.findByText('Downloading 42%')).closest('[role="status"]');
    expect(badge).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByRole('link', { name: 'Play' })).not.toBeInTheDocument();

    act(() => setDownloadProgress('movie:278', 0.6));
    expect(screen.getByText('Downloading 60%')).toBeInTheDocument();
  });

  it('shows just "Downloading" while TorBox has not reported progress yet', async () => {
    open({
      'GET /api/movie/278': movieDetails({ download: download({ state: 'pending', progress: 0 }) }),
      'GET /api/progress/movie:278': NO_PROGRESS,
    });
    expect(await screen.findByText('Downloading')).toBeInTheDocument();
  });

  it('shows Play for a download that already finished or failed', async () => {
    open({
      'GET /api/movie/278': movieDetails({ download: download({ status: 'failed', state: 'failed' }) }),
      'GET /api/progress/movie:278': NO_PROGRESS,
    });
    expect(await screen.findByRole('link', { name: 'Play' })).toBeInTheDocument();
  });

  it('says the movie is not found, with a link back to Home, for an unknown id', async () => {
    open(
      { 'GET /api/movie/999999999': apiError(404, 'not_found', 'Movie 999999999 was not found.') },
      '/movie/999999999',
    );
    expect(await screen.findByRole('heading', { name: 'Movie not found' })).toBeInTheDocument();
    expect(screen.getByText(/Movie 999999999 was not found\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Home' })).toHaveAttribute('href', '/');
  });

  it('treats an address that is not a number as not found without asking the server', async () => {
    const { calls } = open({}, '/movie/abc');
    expect(await screen.findByRole('heading', { name: 'Movie not found' })).toBeInTheDocument();
    expect(calls.filter((call) => call.path.startsWith('/api/movie'))).toEqual([]);
  });

  it('shows the server message and Retry for any other failure, and Retry loads the movie', async () => {
    const answers: unknown[] = [
      apiError(502, 'tmdb_unavailable', 'TMDB did not answer.', 'Check the internet connection.'),
      movieDetails(),
    ];
    open({ 'GET /api/movie/278': () => answers.shift(), 'GET /api/progress/movie:278': NO_PROGRESS });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('TMDB did not answer.');
    expect(alert).toHaveTextContent('Check the internet connection.');
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'The Shawshank Redemption' })).toBeInTheDocument();
  });

  it('shows a placeholder when TMDB has no poster, and no star rating for an unrated title', async () => {
    open({
      'GET /api/movie/278': movieDetails({
        posterUrl: null,
        backdropUrl: null,
        rating: 0,
        runtime: null,
        genres: [],
        overview: '',
      }),
      'GET /api/progress/movie:278': NO_PROGRESS,
    });
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('img', { name: /poster/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Genres' })).not.toBeInTheDocument();
    expect(screen.queryByText('8.7')).not.toBeInTheDocument();
  });

  it('goes back to Home from a page that was opened directly', async () => {
    open({ 'GET /api/movie/278': movieDetails(), 'GET /api/progress/movie:278': NO_PROGRESS, 'GET /api/home': home() });
    fireEvent.click(await screen.findByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { name: 'Trending Movies' })).toBeInTheDocument();
  });
});

describe('MovieDetailsPage cast and similar titles', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows Cast and then "More like this" after the hero', async () => {
    open({
      'GET /api/movie/278': movieDetails({
        cast: [castMember(), castMember({ name: 'Morgan Freeman', character: 'Red' })],
        similar: [media({ tmdbId: 389, title: '12 Angry Men' })],
      }),
      'GET /api/progress/movie:278': NO_PROGRESS,
    });
    const hero = (await screen.findByRole('heading', { level: 1 })).closest('header') as HTMLElement;
    const cast = screen.getByRole('heading', { level: 2, name: 'Cast' });
    const similar = screen.getByRole('heading', { level: 2, name: 'More like this' });
    expect(hero.compareDocumentPosition(cast) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(hero).not.toContainElement(cast);
    expect(cast.compareDocumentPosition(similar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('Morgan Freeman')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /12 Angry Men/ })).toHaveAttribute('href', '/movie/389');
  });

  it('shows neither row, and no gap container, when the movie has no cast and no similar titles', async () => {
    const { container } = open({
      'GET /api/movie/278': movieDetails(),
      'GET /api/progress/movie:278': NO_PROGRESS,
    });
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
    expect(container.querySelectorAll('main > *')).toHaveLength(1);
  });

  it('renders the hero without an error when an older server sends neither field', async () => {
    const older: Record<string, unknown> = { ...movieDetails() };
    delete older.cast;
    delete older.similar;
    open({ 'GET /api/movie/278': older, 'GET /api/progress/movie:278': NO_PROGRESS });
    expect(await screen.findByRole('heading', { level: 1, name: 'The Shawshank Redemption' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
  });

  it('opens the details of a similar title when its poster is clicked', async () => {
    open({
      'GET /api/movie/278': movieDetails({ similar: [media({ tmdbId: 389, title: '12 Angry Men' })] }),
      'GET /api/movie/389': movieDetails({ tmdbId: 389, title: '12 Angry Men', year: 1957 }),
      'GET /api/progress/movie:278': NO_PROGRESS,
      'GET /api/progress/movie:389': NO_PROGRESS,
    });
    fireEvent.click(await screen.findByRole('link', { name: /12 Angry Men/ }));
    expect(await screen.findByRole('heading', { level: 1, name: '12 Angry Men' })).toBeInTheDocument();
  });
});

describe('MovieDetailsPage prefetch', () => {
  beforeEach(() => resetPrefetchMemory());
  afterEach(() => vi.unstubAllGlobals());

  const prefetches = (calls: Array<{ method: string; path: string; body?: unknown }>) =>
    calls.filter((call) => call.method === 'POST' && call.path === '/api/prefetch');

  it('sends exactly one prefetch with the title and a device profile when the page opens', async () => {
    const { calls } = open({
      'GET /api/movie/278': movieDetails(),
      'GET /api/progress/movie:278': NO_PROGRESS,
      'POST /api/prefetch': () => Response.json({}, { status: 202 }),
    });
    await screen.findByRole('heading', { level: 1, name: 'The Shawshank Redemption' });
    expect(prefetches(calls)).toHaveLength(1);
    expect(prefetches(calls)[0]?.body).toMatchObject({ mediaType: 'movie', tmdbId: 278 });
    expect(prefetches(calls)[0]?.body).toHaveProperty('device');
  });

  it('shows no error and keeps Play when the prefetch fails', async () => {
    open({
      'GET /api/movie/278': movieDetails(),
      'GET /api/progress/movie:278': NO_PROGRESS,
      'POST /api/prefetch': apiError(500, 'internal_error', 'Broken'),
    });
    expect(await screen.findByRole('link', { name: 'Play' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
