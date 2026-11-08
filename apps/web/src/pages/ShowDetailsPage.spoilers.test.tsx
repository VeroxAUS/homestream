import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { setHideSpoilers } from '../lib/spoilers';
import { episode, health, season, showDetails } from '../test/fixtures';
import { mockApi, renderWithProviders } from '../test/render';

const PLACEHOLDER = "Hidden to avoid spoilers. It appears once you've watched this episode.";

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

function open(routes: Parameters<typeof mockApi>[0] = {}, path = '/tv/1396') {
  mockApi({
    'GET /api/health': health('ok'),
    'GET /api/tv/1396': showDetails(),
    'GET /api/tv/1396/season/1': season(1, 3),
    'GET /api/tv/1396/progress': PROGRESS,
    ...routes,
  });
  return renderWithProviders(<App />, path);
}

const row = (name: RegExp) => screen.getByRole('button', { name });
const panel = () => screen.getByRole('complementary', { name: 'Selected episode' });
const stillOf = (element: HTMLElement) => element.querySelector('img')?.getAttribute('src');

describe('ShowDetailsPage spoiler protection', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('hides the overview and uses the w92 still of every episode that is not finished, in progress included', async () => {
    open();
    await within(await screen.findByRole('button', { name: /Episode title 1/ })).findByText('Watched');

    const finished = row(/Episode title 1/);
    expect(finished).toHaveTextContent('What happens in episode 1.');
    expect(stillOf(finished)).toBe('https://image.tmdb.org/t/p/w300/still1.jpg');

    for (const number of [2, 3]) {
      const hidden = row(new RegExp(`Episode title ${number}`));
      expect(hidden).toHaveTextContent(PLACEHOLDER);
      expect(hidden).not.toHaveTextContent(`What happens in episode ${number}.`);
      expect(stillOf(hidden)).toBe(`https://image.tmdb.org/t/p/w92/still${number}.jpg`);
      expect(hidden).toHaveTextContent('47 min');
      expect(hidden).toHaveTextContent(String(number));
    }
    expect(within(row(/Episode title 2/)).getByRole('progressbar', { name: 'Episode 2 progress' })).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain('What happens in episode 2.');
    expect(document.body.innerHTML).not.toContain('What happens in episode 3.');
  });

  it('hides an episode while its progress is still loading', async () => {
    open({ 'GET /api/tv/1396/progress': () => new Promise(() => undefined) });
    const first = await screen.findByRole('button', { name: /Episode title 1/ });
    expect(first).toHaveTextContent(PLACEHOLDER);
    expect(panel()).toHaveTextContent(PLACEHOLDER);
  });

  it('applies the same rule to the episode panel', async () => {
    open();
    await within(await screen.findByRole('button', { name: /Episode title 1/ })).findByText('Watched');
    expect(panel()).toHaveTextContent('What happens in episode 1.');
    expect(stillOf(panel())).toBe('https://image.tmdb.org/t/p/w300/still1.jpg');

    fireEvent.click(row(/Episode title 2/));
    expect(within(panel()).getByText(PLACEHOLDER)).toBeInTheDocument();
    expect(panel()).not.toHaveTextContent('What happens in episode 2.');
    expect(stillOf(panel())).toBe('https://image.tmdb.org/t/p/w92/still2.jpg');
    expect(within(panel()).getByRole('heading', { name: 'Episode title 2' })).toBeInTheDocument();
    expect(within(panel()).getByText('Season 1 · Episode 2')).toBeInTheDocument();
    expect(within(panel()).getByText(/47 min/)).toBeInTheDocument();

    fireEvent.click(row(/Episode title 3/));
    expect(within(panel()).getByText(PLACEHOLDER)).toBeInTheDocument();
    expect(stillOf(panel())).toBe('https://image.tmdb.org/t/p/w92/still3.jpg');
  });

  it('keeps the dimmed show backdrop for an episode without a still, hiding only the overview', async () => {
    open({
      'GET /api/tv/1396/season/1': { ...season(1, 1), episodes: [episode(1, { stillUrl: null })] },
      'GET /api/tv/1396/progress': { items: [] },
    });
    const only = await screen.findByRole('button', { name: /Episode title 1/ });
    expect(stillOf(only)).toBe('https://image.tmdb.org/t/p/w300/backdrop.jpg');
    expect(only.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
    expect(only).toHaveTextContent(PLACEHOLDER);
  });

  it('never puts a CSS filter on a still or on its ancestors', async () => {
    open();
    await screen.findByRole('button', { name: /Episode title 2/ });
    for (const image of document.querySelectorAll('li[data-episode] img, aside img')) {
      for (let node: Element | null = image; node && node !== document.body; node = node.parentElement) {
        const style = node.getAttribute('style') ?? '';
        expect(style).not.toMatch(/filter|blur/i);
      }
    }
  });

  it('shows every still at w300 and every overview at once when the setting is turned off, without a new request', async () => {
    open();
    await screen.findByRole('button', { name: /Episode title 3/ });
    const requests = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    act(() => setHideSpoilers(false));

    for (const number of [1, 2, 3]) {
      const shown = row(new RegExp(`Episode title ${number}`));
      expect(shown).toHaveTextContent(`What happens in episode ${number}.`);
      expect(stillOf(shown)).toBe(`https://image.tmdb.org/t/p/w300/still${number}.jpg`);
    }
    expect(panel()).toHaveTextContent('What happens in episode 1.');
    expect(screen.queryByText(PLACEHOLDER)).not.toBeInTheDocument();
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(requests);

    act(() => setHideSpoilers(true));
    expect(row(/Episode title 3/)).toHaveTextContent(PLACEHOLDER);
    expect(stillOf(row(/Episode title 3/))).toBe('https://image.tmdb.org/t/p/w92/still3.jpg');
  });

  it('starts with real overviews when the stored setting is off', async () => {
    localStorage.setItem('homestream.hideSpoilers', 'off');
    open();
    expect(await screen.findByRole('button', { name: /Episode title 3/ })).toHaveTextContent(
      'What happens in episode 3.',
    );
    expect(screen.queryByText(PLACEHOLDER)).not.toBeInTheDocument();
  });

  it('shows an episode in full once its progress says it is finished', async () => {
    const first = open({ 'GET /api/tv/1396/progress': { items: [] } });
    expect(await screen.findByRole('button', { name: /Episode title 2/ })).toHaveTextContent(PLACEHOLDER);
    first.unmount();
    open();
    await within(await screen.findByRole('button', { name: /Episode title 1/ })).findByText('Watched');
    expect(row(/Episode title 1/)).toHaveTextContent('What happens in episode 1.');
  });
});
