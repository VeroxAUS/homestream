import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { Route, Routes, useNavigate, type NavigateFunction } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { media, show } from '../test/fixtures';
import { apiError, mockApi, renderWithProviders } from '../test/render';
import SearchPage from './SearchPage';

const DUNE = media({ tmdbId: 693134, title: 'Dune: Part Two', year: 2024 });
const DUNE_SHOW = show({ tmdbId: 90, title: 'Dune: Prophecy', year: 2024 });

let navigateTo: NavigateFunction;
function Page({ children }: { children?: ReactNode }) {
  navigateTo = useNavigate();
  return children ?? <SearchPage />;
}

/** Starts on `/`, so that moving to `/search?q=` is a push that mounts the page, like the first keystroke in the nav. */
function renderFrom(path: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<Page>{<p>start</p>}</Page>} />
      <Route path="search" element={<Page />} />
    </Routes>,
    path,
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('SearchPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('has no box of its own and starts with a prompt and no request', () => {
    const { calls } = mockApi({});
    renderFrom('/search');
    expect(screen.getByText('Search for movies and shows')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it('shows movies and shows with a type label, year and a link to the details page', async () => {
    const { calls } = mockApi({ 'GET /api/search?q=dune': { results: [DUNE, DUNE_SHOW] } });
    renderFrom('/search?q=dune');
    const results = await screen.findByRole('region', { name: 'Search results' });
    expect(within(results).getByRole('heading', { name: '2 results for “dune”' })).toBeInTheDocument();
    const movie = within(results).getByRole('link', { name: /Dune: Part Two/ });
    expect(movie).toHaveAttribute('href', '/movie/693134');
    expect(movie).toHaveTextContent('Movie');
    expect(movie).toHaveTextContent('2024');
    const series = within(results).getByRole('link', { name: /Dune: Prophecy/ });
    expect(series).toHaveAttribute('href', '/tv/90');
    expect(series).toHaveTextContent('Show');
    expect(calls.map((call) => call.path)).toEqual(['/api/search?q=dune']);
  });

  it('searches a deep link at once, without waiting for a pause', async () => {
    const stamps: number[] = [];
    mockApi({
      'GET /api/search?q=dune': () => {
        stamps.push(Date.now());
        return { results: [DUNE] };
      },
    });
    const opened = Date.now();
    renderFrom('/search?q=dune');
    await screen.findByRole('link', { name: /Dune: Part Two/ });
    expect(stamps[0]! - opened).toBeLessThan(250);
  });

  it('waits for a pause in the typing before it asks the server, and asks once', async () => {
    const stamps: number[] = [];
    const { calls } = mockApi({
      'GET /api/search?q=dune': () => {
        stamps.push(Date.now());
        return { results: [DUNE] };
      },
    });
    renderFrom('/');
    for (const text of ['du', 'dun', 'dune']) {
      act(() => void navigateTo(`/search?q=${text}`, { replace: text !== 'du' }));
      await sleep(40);
    }
    const lastKey = Date.now();
    expect(screen.getByRole('status')).toHaveTextContent('Searching...');
    await screen.findByRole('link', { name: /Dune: Part Two/ });
    expect(calls.map((call) => call.path)).toEqual(['/api/search?q=dune']);
    expect(stamps[0]! - lastKey).toBeGreaterThanOrEqual(250);
  });

  it('searches at once when the navigation says so (Enter), and does not repeat the search later', async () => {
    const stamps: number[] = [];
    const { calls } = mockApi({
      'GET /api/search?q=dune': () => {
        stamps.push(Date.now());
        return { results: [DUNE] };
      },
    });
    renderFrom('/');
    const entered = Date.now();
    act(() => void navigateTo('/search?q=dune', { state: { now: 'dune' } }));
    await screen.findByRole('link', { name: /Dune: Part Two/ });
    expect(stamps[0]! - entered).toBeLessThan(250);
    await sleep(500);
    expect(calls).toHaveLength(1);
  });

  it.each(['/search?q=s', '/search?q=%20s%20', '/search?q=', '/search?q=%20%20'])(
    'sends nothing for %s and stays on the prompt',
    async (path) => {
      const { calls } = mockApi({});
      renderFrom(path);
      await sleep(400);
      expect(screen.getByText('Search for movies and shows')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByText(/No results/)).not.toBeInTheDocument();
      expect(calls).toEqual([]);
    },
  );

  it('searches from two characters and returns to the prompt when the text gets shorter', async () => {
    const { calls } = mockApi({ 'GET /api/search?q=st': { results: [DUNE] } });
    renderFrom('/');
    act(() => void navigateTo('/search?q=s'));
    await sleep(400);
    expect(calls).toEqual([]);
    act(() => void navigateTo('/search?q=st', { replace: true }));
    await screen.findByRole('link', { name: /Dune: Part Two/ });
    act(() => void navigateTo('/search?q=s', { replace: true }));
    expect(screen.getByText('Search for movies and shows')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Dune: Part Two/ })).not.toBeInTheDocument();
    await sleep(400);
    expect(calls).toHaveLength(1);
  });

  it('aborts a superseded search, and the newest query wins even if the old answer arrives late', async () => {
    let oldSignal: AbortSignal | undefined;
    let answerOld: (value: unknown) => void = () => undefined;
    const THRONES = show({ tmdbId: 1399, title: 'Stub Thrones' });
    mockApi({
      'GET /api/search?q=stub': ({ init }: { init: RequestInit | undefined }) => {
        oldSignal = init?.signal ?? undefined;
        return new Promise((resolve) => (answerOld = resolve));
      },
      'GET /api/search?q=stub%20th': { results: [THRONES] },
    });
    renderFrom('/search?q=stub');
    await vi.waitFor(() => expect(oldSignal).toBeDefined());
    expect(oldSignal?.aborted).toBe(false);

    act(() => void navigateTo('/search?q=stub%20th', { replace: true }));
    await screen.findByRole('link', { name: /Stub Thrones/ });
    expect(oldSignal?.aborted).toBe(true);

    answerOld({ results: [DUNE] });
    await sleep(50);
    expect(screen.queryByRole('link', { name: /Dune: Part Two/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Stub Thrones/ })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('filters the results by type', async () => {
    mockApi({ 'GET /api/search?q=dune': { results: [DUNE, DUNE_SHOW] } });
    renderFrom('/search?q=dune');
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
    renderFrom('/search?q=dune');
    await screen.findByRole('region', { name: 'Search results' });
    await userEvent.click(screen.getByRole('button', { name: 'Shows' }));
    expect(screen.getByText('No shows for “dune”')).toBeInTheDocument();
  });

  it('names the query when nothing matches', async () => {
    mockApi({ 'GET /api/search?q=zzqxjvkw1234': { results: [] } });
    renderFrom('/search?q=zzqxjvkw1234');
    expect(await screen.findByText('No results for “zzqxjvkw1234”')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows an error that differs from "No results" and recovers with the next search', async () => {
    mockApi({
      'GET /api/search?q=dune': apiError(500, 'internal_error', 'Search is broken.', 'Try again in a moment.'),
      'GET /api/search?q=matrix': { results: [media({ tmdbId: 603, title: 'The Matrix' })] },
    });
    renderFrom('/search?q=dune');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Search failed');
    expect(alert).toHaveTextContent('Search is broken.');
    expect(alert).toHaveTextContent('Try again in a moment.');
    expect(screen.queryByText(/No results/)).not.toBeInTheDocument();

    act(() => void navigateTo('/search?q=matrix', { replace: true }));
    expect(await screen.findByRole('link', { name: /The Matrix/ })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('retries a failed search from the Retry button', async () => {
    const answers: unknown[] = [apiError(500, 'internal_error', 'Search is broken.'), { results: [DUNE] }];
    mockApi({ 'GET /api/search?q=dune': () => answers.shift() });
    renderFrom('/search?q=dune');
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('link', { name: /Dune: Part Two/ })).toBeInTheDocument();
  });
});
