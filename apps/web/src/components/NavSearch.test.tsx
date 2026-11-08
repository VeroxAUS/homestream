import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useLocation, useNavigate, type NavigateFunction } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { health, home, media, movieDetails, show } from '../test/fixtures';
import { apiError, mockApi, renderWithProviders } from '../test/render';

const searchCss = readFileSync(resolve(process.cwd(), 'src/components/NavSearch.module.css'), 'utf8');

const DUNE = media({ tmdbId: 278, title: 'Dune: Part Two', year: 2024 });
const THRONES = show({ tmdbId: 1399, title: 'Stub Thrones' });

const API = {
  'GET /api/health': health('ok', ['ok']),
  'GET /api/home': home(),
  'GET /api/movie/278': movieDetails(),
  'GET /api/progress/movie:278': apiError(404, 'not_found', 'No progress.'),
};

let navigateTo: NavigateFunction;
function Where() {
  const { pathname, search } = useLocation();
  navigateTo = useNavigate();
  return <output data-testid="where">{`${pathname}${search}`}</output>;
}

function renderApp(path: string) {
  return renderWithProviders(
    <>
      <App />
      <Where />
    </>,
    path,
  );
}

const where = () => screen.getByTestId('where').textContent;
const field = () => screen.getByRole('textbox', { name: 'Search movies and shows' });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const searchPaths = (calls: Array<{ path: string }>) =>
  calls.map((call) => call.path).filter((path) => path.startsWith('/api/search'));

function stubPhone(phone: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: phone && query.includes('max-width: 699px'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

beforeAll(async () => {
  await import('../pages/SearchPage');
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'matchMedia');
});

describe('nav search field', () => {
  it('is the only text field in the nav, between the links and the health pill, with no Search link or button', async () => {
    mockApi(API);
    renderApp('/');
    const bar = screen.getByRole('navigation', { name: 'Main' }).closest('header') as HTMLElement;
    const links = within(screen.getByRole('navigation', { name: 'Main' })).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['Home', 'Dashboard', 'Settings']);
    expect(within(bar).getAllByRole('textbox')).toHaveLength(1);
    expect(field()).toHaveAttribute('placeholder', 'Search movies and shows');
    expect(within(bar).queryByRole('link', { name: /search/i })).not.toBeInTheDocument();
    expect(within(bar).queryByRole('button', { name: /^Search$|Search titles|Dashboards/ })).not.toBeInTheDocument();

    const pill = await screen.findByRole('link', { name: 'All systems healthy' });
    const before = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before(links[2]!, field())).toBe(true);
    expect(before(field(), pill)).toBe(true);
  });

  it('sends no request before the user types, not even when the field gets focus', async () => {
    const { calls } = mockApi(API);
    renderApp('/');
    await userEvent.click(field());
    await sleep(400);
    expect(field()).toHaveFocus();
    expect(searchPaths(calls)).toEqual([]);
    expect(where()).toBe('/');
  });

  it('opens /search?q= on the first key, keeps focus and every character, and adds one history entry', async () => {
    mockApi({ ...API, 'GET /api/search?q=breaking%20bad': { results: [show()] } });
    renderApp('/movie/278');
    await screen.findByRole('heading', { level: 1 });
    const user = userEvent.setup();
    await user.click(field());
    await user.keyboard('b');
    expect(where()).toBe('/search?q=b');
    await user.keyboard('reaking bad');
    expect(where()).toBe('/search?q=breaking%20bad');
    expect(field()).toHaveValue('breaking bad');
    expect(field()).toHaveFocus();
    expect(await screen.findByRole('link', { name: /Breaking Bad/ })).toBeInTheDocument();

    act(() => void navigateTo(-1));
    await screen.findByRole('heading', { level: 1 });
    expect(where()).toBe('/movie/278');
    expect(field()).toHaveValue('');
  });

  it('waits for a pause of about 300 ms and asks the server once, not for every prefix', async () => {
    const stamps: number[] = [];
    const { calls } = mockApi({
      ...API,
      'GET /api/search?q=stub': () => {
        stamps.push(Date.now());
        return { results: [THRONES] };
      },
    });
    renderApp('/');
    await userEvent.type(field(), 'stub');
    const lastKey = Date.now();
    await screen.findByRole('link', { name: /Stub Thrones/ });
    expect(searchPaths(calls)).toEqual(['/api/search?q=stub']);
    expect(stamps[0]! - lastKey).toBeGreaterThanOrEqual(250);
  });

  it('sends no request for one character, even with spaces around it, until a second one is typed', async () => {
    const { calls } = mockApi({ ...API, 'GET /api/search?q=st': { results: [THRONES] } });
    renderApp('/');
    await userEvent.type(field(), ' s ');
    await sleep(500);
    expect(searchPaths(calls)).toEqual([]);
    expect(await screen.findByText('Search for movies and shows')).toBeInTheDocument();
    expect(screen.queryByText(/No results/)).not.toBeInTheDocument();

    await userEvent.clear(field());
    await userEvent.type(field(), 'st');
    await screen.findByRole('link', { name: /Stub Thrones/ });
    expect(searchPaths(calls)).toEqual(['/api/search?q=st']);

    await userEvent.type(field(), '{Backspace}');
    expect(screen.getByText('Search for movies and shows')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Stub Thrones/ })).not.toBeInTheDocument();
    await sleep(400);
    expect(searchPaths(calls)).toEqual(['/api/search?q=st']);
  });

  it('aborts the search it replaced, and only the newest query is shown', async () => {
    let stubSignal: AbortSignal | undefined;
    let answerStub: (value: unknown) => void = () => undefined;
    mockApi({
      ...API,
      'GET /api/search?q=stub': ({ init }: { init: RequestInit | undefined }) => {
        stubSignal = init?.signal ?? undefined;
        return new Promise((resolve) => (answerStub = resolve));
      },
      'GET /api/search?q=stub%20th': { results: [THRONES] },
    });
    renderApp('/');
    const user = userEvent.setup();
    await user.type(field(), 'stub');
    await waitFor(() => expect(stubSignal).toBeDefined());
    await user.type(field(), ' th');
    await screen.findByRole('link', { name: /Stub Thrones/ });
    expect(stubSignal?.aborted).toBe(true);
    answerStub({ results: [DUNE] });
    await sleep(50);
    expect(screen.queryByRole('link', { name: /Dune: Part Two/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(field()).toHaveValue('stub th');
  });

  it('searches at once on Enter, once, and sends nothing for Enter in an empty field', async () => {
    const stamps: number[] = [];
    const { calls } = mockApi({
      ...API,
      'GET /api/search?q=stub': () => {
        stamps.push(Date.now());
        return { results: [THRONES] };
      },
    });
    renderApp('/');
    const user = userEvent.setup();
    await user.click(field());
    await user.keyboard('{Enter}');
    await sleep(400);
    expect(searchPaths(calls)).toEqual([]);

    await user.keyboard('stub');
    const entered = Date.now();
    await user.keyboard('{Enter}');
    await screen.findByRole('link', { name: /Stub Thrones/ });
    expect(stamps[0]! - entered).toBeLessThan(250);
    await sleep(600);
    expect(searchPaths(calls)).toEqual(['/api/search?q=stub']);
  });

  it('clears the field and the q on Escape, shows the prompt and sends nothing more', async () => {
    const { calls } = mockApi({ ...API, 'GET /api/search?q=stub': { results: [THRONES] } });
    renderApp('/');
    const user = userEvent.setup();
    await user.type(field(), 'stub');
    await screen.findByRole('link', { name: /Stub Thrones/ });

    await user.keyboard('{Escape}');
    expect(field()).toHaveValue('');
    expect(field()).toHaveFocus();
    expect(where()).toBe('/search');
    expect(screen.getByText('Search for movies and shows')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Stub Thrones/ })).not.toBeInTheDocument();
    await sleep(400);
    expect(searchPaths(calls)).toEqual(['/api/search?q=stub']);
  });

  it('shows q on /search after a direct load and is empty on every other page, also with Back and Forward', async () => {
    mockApi({ ...API, 'GET /api/search?q=dune': { results: [DUNE] } });
    renderApp('/search?q=dune');
    expect(field()).toHaveValue('dune');
    const result = await screen.findByRole('link', { name: /Dune: Part Two/ });

    await userEvent.click(result);
    await screen.findByRole('heading', { level: 1 });
    expect(where()).toBe('/movie/278');
    expect(field()).toHaveValue('');

    act(() => void navigateTo(-1));
    await screen.findByRole('link', { name: /Dune: Part Two/ });
    expect(where()).toBe('/search?q=dune');
    expect(field()).toHaveValue('dune');

    act(() => void navigateTo(1));
    await screen.findByRole('heading', { level: 1 });
    expect(field()).toHaveValue('');

    await userEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Home' }));
    expect(where()).toBe('/');
    expect(field()).toHaveValue('');
  });

  it('takes the new q when the address changes by itself on /search', async () => {
    mockApi({ ...API, 'GET /api/search?q=dune': { results: [DUNE] } });
    renderApp('/search?q=dune');
    act(() => void navigateTo('/search?q=matrix'));
    expect(field()).toHaveValue('matrix');
  });

  it('shows the clear button only while there is text, and it empties the field and the q', async () => {
    mockApi({ ...API, 'GET /api/search?q=stub': { results: [THRONES] } });
    renderApp('/');
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(field(), 'stub');
    await screen.findByRole('link', { name: /Stub Thrones/ });
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(field()).toHaveValue('');
    expect(field()).toHaveFocus();
    expect(where()).toBe('/search');
    expect(screen.queryByRole('link', { name: /Stub Thrones/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
  });

  it('is excluded from the drag region of the desktop window', () => {
    const noDrag = /\.field,\s*\.input,\s*\.clear,\s*\.iconButton\s*\{([^}]*)\}/.exec(searchCss)?.[1] ?? '';
    expect(noDrag).toMatch(/-webkit-app-region:\s*no-drag/);
  });

  it('is 240 to 520 px wide in the middle of the nav, and opens over the nav on a phone', () => {
    const slot = /\.slot\s*\{([^}]*)\}/.exec(searchCss)?.[1] ?? '';
    expect(slot).toMatch(/min-width:\s*240px/);
    expect(slot).toMatch(/max-width:\s*520px/);
    expect(slot).toMatch(/margin:\s*0 auto/);
    const overlay = /\.overlay\s*\{([^}]*)\}/.exec(searchCss)?.[1] ?? '';
    expect(overlay).toMatch(/position:\s*absolute/);
    expect(overlay).toMatch(/height:\s*44px/);
    expect(searchCss).not.toMatch(/blur|backdrop-filter/);
  });
});

describe('nav search field on a phone', () => {
  const iconButton = () => screen.getByRole('button', { name: 'Search' });

  it('shows only an icon button, which expands the focused field, and Escape or an empty blur collapses it', async () => {
    stubPhone(true);
    mockApi(API);
    renderApp('/');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(iconButton()).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(iconButton());
    expect(field()).toHaveFocus();
    expect(iconButton()).toHaveAttribute('aria-expanded', 'true');

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    await userEvent.click(iconButton());
    fireEvent.blur(field());
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('keeps the field open on a blur with text, searches while typing, and collapses after leaving /search', async () => {
    stubPhone(true);
    mockApi({ ...API, 'GET /api/search?q=dune': { results: [DUNE] } });
    renderApp('/');
    const user = userEvent.setup();
    await user.click(iconButton());
    await user.keyboard('dune');
    expect(where()).toBe('/search?q=dune');
    fireEvent.blur(field());
    expect(field()).toHaveValue('dune');

    await user.click(await screen.findByRole('link', { name: /Dune: Part Two/ }));
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('shows the full field again at 700 px and wider', () => {
    stubPhone(false);
    mockApi(API);
    renderApp('/');
    expect(field()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Search' })).not.toBeInTheDocument();
  });
});
