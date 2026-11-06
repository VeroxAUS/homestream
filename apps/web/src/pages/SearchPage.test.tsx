import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { media, show } from '../test/fixtures';
import { apiError, mockApi, renderWithProviders } from '../test/render';
import SearchPage from './SearchPage';

const DUNE = media({ tmdbId: 693134, title: 'Dune: Part Two', year: 2024 });
const DUNE_SHOW = show({ tmdbId: 90, title: 'Dune: Prophecy', year: 2024 });

function box() {
  return screen.getByRole('textbox', { name: 'Search movies and shows' });
}

describe('SearchPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('starts with a prompt and sends no request', () => {
    const { calls } = mockApi({});
    renderWithProviders(<SearchPage />, '/search');
    expect(screen.getByText('Search for movies and shows')).toBeInTheDocument();
    expect(box()).toHaveFocus();
    expect(calls).toEqual([]);
  });

  it('shows movies and shows with a type label, year and a link to the details page', async () => {
    const { calls } = mockApi({ 'GET /api/search?q=dune': { results: [DUNE, DUNE_SHOW] } });
    renderWithProviders(<SearchPage />, '/search');
    await userEvent.type(box(), 'dune');
    expect(screen.getByRole('status')).toHaveTextContent('Searching...');

    const results = await screen.findByRole('region', { name: 'Search results' });
    expect(within(results).getByRole('heading', { name: '2 results for “dune”' })).toBeInTheDocument();
    const movie = within(results).getByRole('link', { name: /Dune: Part Two/ });
    expect(movie).toHaveAttribute('href', '/movie/693134');
    expect(movie).toHaveTextContent('Movie');
    expect(movie).toHaveTextContent('2024');
    const series = within(results).getByRole('link', { name: /Dune: Prophecy/ });
    expect(series).toHaveAttribute('href', '/tv/90');
    expect(series).toHaveTextContent('Show');
    expect(calls.filter((call) => call.path.startsWith('/api/search'))).toHaveLength(1);
  });

  it('waits for the typing to stop before it asks the server', async () => {
    const { calls } = mockApi({ 'GET /api/search?q=dune': { results: [DUNE] } });
    renderWithProviders(<SearchPage />, '/search');
    await userEvent.type(box(), 'dune');
    await screen.findByRole('region', { name: 'Search results' });
    expect(calls.map((call) => call.path)).toEqual(['/api/search?q=dune']);
  });

  it('filters the results by type', async () => {
    mockApi({ 'GET /api/search?q=dune': { results: [DUNE, DUNE_SHOW] } });
    renderWithProviders(<SearchPage />, '/search');
    await userEvent.type(box(), 'dune');
    const results = await screen.findByRole('region', { name: 'Search results' });

    await userEvent.click(screen.getByRole('button', { name: 'Shows' }));
    expect(screen.getByRole('button', { name: 'Shows' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(results).queryByRole('link', { name: /Dune: Part Two/ })).not.toBeInTheDocument();
    expect(within(results).getByRole('link', { name: /Dune: Prophecy/ })).toBeInTheDocument();
    expect(within(results).getByRole('heading', { name: '1 result for “dune”' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Movies' }));
    expect(within(results).getByRole('link', { name: /Dune: Part Two/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(within(results).getAllByRole('link')).toHaveLength(2);
  });

  it('says so when the filter leaves nothing', async () => {
    mockApi({ 'GET /api/search?q=dune': { results: [DUNE] } });
    renderWithProviders(<SearchPage />, '/search');
    await userEvent.type(box(), 'dune');
    await screen.findByRole('region', { name: 'Search results' });
    await userEvent.click(screen.getByRole('button', { name: 'Shows' }));
    expect(screen.getByText('No shows for “dune”')).toBeInTheDocument();
  });

  it('names the query when nothing matches', async () => {
    mockApi({ 'GET /api/search?q=zzqxjvkw1234': { results: [] } });
    renderWithProviders(<SearchPage />, '/search');
    await userEvent.type(box(), 'zzqxjvkw1234');
    expect(await screen.findByText('No results for “zzqxjvkw1234”')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('treats a blank query as empty and sends nothing', async () => {
    const { calls } = mockApi({});
    renderWithProviders(<SearchPage />, '/search');
    await userEvent.type(box(), '   ');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(screen.getByText('Search for movies and shows')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it('returns to the prompt when the box is cleared or Escape is pressed', async () => {
    mockApi({ 'GET /api/search?q=dune': { results: [DUNE] } });
    renderWithProviders(<SearchPage />, '/search');
    await userEvent.type(box(), 'dune');
    await screen.findByRole('region', { name: 'Search results' });
    expect(screen.getByText('Esc to clear')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(box()).toHaveValue('');
    expect(screen.getByText('Search for movies and shows')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Search results' })).not.toBeInTheDocument();

    await userEvent.type(box(), 'dune');
    await screen.findByRole('region', { name: 'Search results' });
    await userEvent.clear(box());
    expect(screen.getByText('Search for movies and shows')).toBeInTheDocument();
  });

  it('shows an error that differs from "No results" and recovers with the next search', async () => {
    mockApi({
      'GET /api/search?q=dune': apiError(500, 'internal_error', 'Search is broken.', 'Try again in a moment.'),
      'GET /api/search?q=matrix': { results: [media({ tmdbId: 603, title: 'The Matrix' })] },
    });
    renderWithProviders(<SearchPage />, '/search');
    await userEvent.type(box(), 'dune');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Search failed');
    expect(alert).toHaveTextContent('Search is broken.');
    expect(alert).toHaveTextContent('Try again in a moment.');
    expect(screen.queryByText(/No results/)).not.toBeInTheDocument();

    await userEvent.clear(box());
    await userEvent.type(box(), 'matrix');
    expect(await screen.findByRole('link', { name: /The Matrix/ })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('retries a failed search from the Retry button', async () => {
    const answers: unknown[] = [apiError(500, 'internal_error', 'Search is broken.'), { results: [DUNE] }];
    mockApi({ 'GET /api/search?q=dune': () => answers.shift() });
    renderWithProviders(<SearchPage />, '/search');
    await userEvent.type(box(), 'dune');
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('link', { name: /Dune: Part Two/ })).toBeInTheDocument();
  });

  it('runs the search of a deep link such as /search?q=dune', async () => {
    mockApi({ 'GET /api/search?q=dune': { results: [DUNE] } });
    renderWithProviders(<SearchPage />, '/search?q=dune');
    expect(box()).toHaveValue('dune');
    expect(await screen.findByRole('link', { name: /Dune: Part Two/ })).toBeInTheDocument();
  });
});
