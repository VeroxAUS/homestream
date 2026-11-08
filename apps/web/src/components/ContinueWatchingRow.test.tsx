import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setHideSpoilers } from '../lib/spoilers';
import { continueWatching, home } from '../test/fixtures';
import { mockApi, renderWithProviders, testQueryClient } from '../test/render';
import { ContinueWatchingRow } from './ContinueWatchingRow';

const MOVIE = continueWatching();
const EPISODE = continueWatching({
  mediaKey: 'tv:1396:1:3',
  type: 'tv',
  tmdbId: 1396,
  season: 1,
  episode: 3,
  title: 'Breaking Bad',
  showTitle: 'Breaking Bad',
  episodeTitle: 'And the Bag',
  backdropUrl: 'https://image.tmdb.org/t/p/w300/still.jpg',
  positionSec: 600,
  durationSec: 2400,
});
const UP_NEXT = continueWatching({
  mediaKey: 'tv:1396:1:4',
  type: 'tv',
  tmdbId: 1396,
  season: 1,
  episode: 4,
  title: 'Breaking Bad',
  episodeTitle: 'Cancer Man',
  positionSec: 0,
  upNext: true,
});

function card(title: string | RegExp) {
  return screen.getByRole('link', { name: title });
}

describe('ContinueWatchingRow', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('shows a wide card per item with its title, sub-line, link and image size', () => {
    renderWithProviders(<ContinueWatchingRow items={[MOVIE, EPISODE, UP_NEXT]} />);
    expect(screen.getByRole('heading', { name: 'Continue Watching' })).toBeInTheDocument();
    expect(screen.getByText('3 titles')).toBeInTheDocument();

    const movie = card(/The Shawshank Redemption/);
    expect(movie).toHaveAttribute('href', '/movie/278');
    expect(within(movie).getByText('Movie')).toBeInTheDocument();
    expect(movie.querySelector('img')).toHaveAttribute('src', 'https://image.tmdb.org/t/p/w780/backdrop.jpg');

    const episode = card(/And the Bag/);
    expect(episode).toHaveAttribute('href', '/tv/1396?season=1&episode=3');
    expect(within(episode).getByText('S1E3 · And the Bag')).toBeInTheDocument();
    expect(episode.querySelector('img')).toHaveAttribute('src', 'https://image.tmdb.org/t/p/w92/still.jpg');

    const next = card(/Cancer Man/);
    expect(within(next).getAllByText('Up next').length).toBeGreaterThan(0);
    expect(within(next).queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('asks for the w92 still of an Up next episode, and keeps a movie backdrop or a show backdrop as it is', () => {
    const showBackdrop = continueWatching({
      mediaKey: 'tv:1396:1:5',
      type: 'tv',
      tmdbId: 1396,
      season: 1,
      episode: 5,
      title: 'Breaking Bad',
      episodeTitle: 'Gray Matter',
      backdropUrl: 'https://image.tmdb.org/t/p/w1280/show-backdrop.jpg',
    });
    const upNextStill = continueWatching({ ...UP_NEXT, backdropUrl: 'https://image.tmdb.org/t/p/w300/next.jpg' });
    renderWithProviders(<ContinueWatchingRow items={[MOVIE, upNextStill, showBackdrop]} />);
    expect(card(/Cancer Man/).querySelector('img')).toHaveAttribute('src', 'https://image.tmdb.org/t/p/w92/next.jpg');
    expect(card(/Gray Matter/).querySelector('img')).toHaveAttribute(
      'src',
      'https://image.tmdb.org/t/p/w780/show-backdrop.jpg',
    );
    expect(card(/The Shawshank Redemption/).querySelector('img')).toHaveAttribute(
      'src',
      'https://image.tmdb.org/t/p/w780/backdrop.jpg',
    );
  });

  it('shows the w300 episode still again as soon as the spoiler setting is turned off, and w92 when it is back on', () => {
    renderWithProviders(<ContinueWatchingRow items={[EPISODE]} />);
    const image = () => card(/And the Bag/).querySelector('img');
    expect(image()).toHaveAttribute('src', 'https://image.tmdb.org/t/p/w92/still.jpg');
    act(() => setHideSpoilers(false));
    expect(image()).toHaveAttribute('src', 'https://image.tmdb.org/t/p/w300/still.jpg');
    act(() => setHideSpoilers(true));
    expect(image()).toHaveAttribute('src', 'https://image.tmdb.org/t/p/w92/still.jpg');
  });

  it('draws the progress bar and the remaining time from the saved position', () => {
    renderWithProviders(<ContinueWatchingRow items={[EPISODE]} />);
    const bar = screen.getByRole('progressbar', { name: 'Breaking Bad progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '25');
    expect(screen.getByText('25% watched')).toBeInTheDocument();
    expect(screen.getByText('30 min left')).toBeInTheDocument();
    expect(bar.firstElementChild).toHaveStyle({ width: '25%' });
  });

  it('counts a single title in the singular', () => {
    renderWithProviders(<ContinueWatchingRow items={[MOVIE]} />);
    expect(screen.getByText('1 title')).toBeInTheDocument();
  });

  it('drops the card at once and tells the server when the remove button is pressed', async () => {
    const { calls } = mockApi({
      'DELETE /api/continue-watching/movie%3A278': { mediaKey: 'movie:278', removed: true },
    });
    const queryClient = testQueryClient();
    queryClient.setQueryData(['home'], home({ continueWatching: [MOVIE, EPISODE] }));
    renderWithProviders(<ContinueWatchingRow items={[MOVIE, EPISODE]} />, '/', queryClient);

    const [remove] = screen.getAllByRole('button', { name: 'Remove from Continue Watching' });
    fireEvent.click(remove as HTMLElement);

    await waitFor(() =>
      expect(calls).toEqual([{ method: 'DELETE', path: '/api/continue-watching/movie%3A278', body: undefined }]),
    );
    const cached = queryClient.getQueryData<ReturnType<typeof home>>(['home']);
    expect(cached?.continueWatching.map((item) => item.mediaKey)).toEqual(['tv:1396:1:3']);
    expect(queryClient.getQueryState(['home'])?.isInvalidated).toBe(false);
  });

  it('asks for the list again when the server could not remove the title', async () => {
    mockApi({ 'DELETE /api/continue-watching/movie%3A278': new TypeError('offline') });
    const queryClient = testQueryClient();
    queryClient.setQueryData(['home'], home({ continueWatching: [MOVIE] }));
    renderWithProviders(<ContinueWatchingRow items={[MOVIE]} />, '/', queryClient);
    fireEvent.click(screen.getByRole('button', { name: 'Remove from Continue Watching' }));
    await waitFor(() => expect(queryClient.getQueryState(['home'])?.isInvalidated).toBe(true));
  });

  it('shows no image when the card has none or the image fails', () => {
    const bare = continueWatching({ mediaKey: 'movie:603', tmdbId: 603, title: 'The Matrix', backdropUrl: null });
    const { container } = renderWithProviders(<ContinueWatchingRow items={[bare, MOVIE]} />);
    expect(container.querySelectorAll('img')).toHaveLength(1);
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(container.querySelectorAll('img')).toHaveLength(0);
  });
});
