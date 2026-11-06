import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOME_CONTENT_MARK } from '../lib/startup';
import { apiError, mockApi, renderWithProviders } from '../test/render';
import { continueWatching, featured, home } from '../test/fixtures';
import HomePage from './HomePage';

function headings(): string[] {
  return screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent ?? '');
}

describe('HomePage', () => {
  beforeEach(() => performance.clearMarks());
  afterEach(() => vi.unstubAllGlobals());

  it('shows Continue Watching, then the banner, then the four poster rows', async () => {
    mockApi({
      'GET /api/home': home({
        continueWatching: [
          continueWatching(),
          continueWatching({ mediaKey: 'movie:603', tmdbId: 603, title: 'The Matrix' }),
        ],
        featured: [featured(), featured({ tmdbId: 603, title: 'The Matrix' })],
      }),
    });
    renderWithProviders(<HomePage />);

    await screen.findByRole('region', { name: 'Featured' });
    expect(
      headings().filter((text) =>
        ['Continue Watching', 'Trending Movies', 'Trending Shows', 'Popular Movies', 'Popular Shows'].includes(text),
      ),
    ).toEqual(['Continue Watching', 'Trending Movies', 'Trending Shows', 'Popular Movies', 'Popular Shows']);
    const watching = screen.getByRole('region', { name: 'Continue Watching' });
    const banner = screen.getByRole('region', { name: 'Featured' });
    const trending = screen.getByRole('region', { name: 'Trending Movies' });
    expect(watching.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(banner.compareDocumentPosition(trending) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('asks TMDB for the w342 poster of every card', async () => {
    mockApi({ 'GET /api/home': home() });
    renderWithProviders(<HomePage />);
    const row = await screen.findByRole('region', { name: 'Trending Movies' });
    const posters = Array.from(row.querySelectorAll('img'));
    expect(posters).toHaveLength(3);
    for (const poster of posters) expect(poster).toHaveAttribute('src', 'https://image.tmdb.org/t/p/w342/poster.jpg');
    expect(within(row).getByRole('link', { name: /Movie 100/ })).toHaveAttribute('href', '/movie/100');
  });

  it('leaves out Continue Watching and the banner when there is nothing to show', async () => {
    mockApi({ 'GET /api/home': home({ continueWatching: [], featured: [] }) });
    renderWithProviders(<HomePage />);
    await screen.findByRole('region', { name: 'Trending Movies' });
    expect(screen.queryByText('Continue Watching')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Featured' })).not.toBeInTheDocument();
  });

  it('shows a loading placeholder until the data arrives, then marks the content as shown', async () => {
    let release: (value: unknown) => void = () => undefined;
    const pending = new Promise((resolve) => (release = resolve));
    mockApi({ 'GET /api/home': () => pending });
    renderWithProviders(<HomePage />);
    expect(screen.getByRole('status', { name: 'Loading Home' })).toBeInTheDocument();
    expect(performance.getEntriesByName(HOME_CONTENT_MARK)).toHaveLength(0);

    release(home());
    await screen.findByRole('region', { name: 'Trending Movies' });
    expect(screen.queryByRole('status', { name: 'Loading Home' })).not.toBeInTheDocument();
    await waitFor(() => expect(performance.getEntriesByName(HOME_CONTENT_MARK)).toHaveLength(1));
  });

  it('shows the server message, its hint and Retry when the server answers with an error, and Retry loads the rows', async () => {
    const answers = [apiError(500, 'internal_error', 'Something broke.', 'Check the server log.'), home()];
    mockApi({ 'GET /api/home': () => answers.shift() });
    renderWithProviders(<HomePage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Something broke.');
    expect(alert).toHaveTextContent('Check the server log.');
    expect(within(alert).getByRole('link', { name: 'Open Health' })).toHaveAttribute('href', '/dashboard/health');

    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('region', { name: 'Trending Movies' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says the server cannot be reached when the request fails', async () => {
    mockApi({ 'GET /api/home': new TypeError('Failed to fetch') });
    renderWithProviders(<HomePage />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Server unreachable');
    expect(alert).toHaveTextContent('Cannot reach the HomeStream server.');
    expect(alert).toHaveTextContent('Check that the HomeStream server is running');
  });
});
