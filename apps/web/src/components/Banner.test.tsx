import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setBannerIntervalMs } from '../lib/bannerInterval';
import { featured } from '../test/fixtures';
import { renderWithProviders } from '../test/render';
import { Banner } from './Banner';

const ITEMS = [
  featured({ tmdbId: 1, title: 'One', reasonLabel: 'Trending this week' }),
  featured({ tmdbId: 2, title: 'Two', mediaType: 'tv', reasonLabel: 'Popular right now' }),
  featured({ tmdbId: 3, title: 'Three', reasonLabel: 'Because you watched Dune' }),
];

function visibleTitle(): string {
  return screen.getByRole('heading', { level: 2 }).textContent ?? '';
}

async function pass(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

function mockReducedMotion(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  });
}

describe('Banner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setBannerIntervalMs(9000);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('shows the first featured item with its reason, title, overview and a dot per item', () => {
    renderWithProviders(<Banner items={ITEMS} />);
    expect(screen.getByRole('region', { name: 'Featured' })).toHaveAttribute('aria-roledescription', 'carousel');
    expect(visibleTitle()).toBe('One');
    expect(screen.getByText('Trending this week')).toBeInTheDocument();
    const dots = screen.getAllByRole('button', { name: /Show featured/ });
    expect(dots.map((dot) => dot.getAttribute('aria-label'))).toEqual([
      'Show featured 1 of 3: One',
      'Show featured 2 of 3: Two',
      'Show featured 3 of 3: Three',
    ]);
    expect(dots[0]).toHaveAttribute('aria-current', 'true');
    expect(dots[1]).not.toHaveAttribute('aria-current');
  });

  it('opens movies with Play and shows with View show, and both with More info', () => {
    renderWithProviders(<Banner items={ITEMS} />);
    expect(screen.getByRole('link', { name: 'Play' })).toHaveAttribute('href', '/play/movie/1');
    expect(screen.getByRole('link', { name: 'More info' })).toHaveAttribute('href', '/movie/1');
  });

  it('sends a show to its page from the primary action', () => {
    renderWithProviders(<Banner items={ITEMS} />);
    fireEvent.click(screen.getByRole('button', { name: /Show featured 2/ }));
    expect(screen.getByRole('link', { name: 'View show' })).toHaveAttribute('href', '/tv/2');
    expect(screen.getByRole('link', { name: 'More info' })).toHaveAttribute('href', '/tv/2');
  });

  it('requests only the first backdrop at w1280, then the next one once the first has loaded', () => {
    const { container } = renderWithProviders(<Banner items={ITEMS} />);
    const urls = () => Array.from(container.querySelectorAll('img')).map((image) => image.getAttribute('src'));
    expect(urls()).toEqual(['https://image.tmdb.org/t/p/w1280/backdrop.jpg']);
    fireEvent.load(container.querySelector('img') as HTMLImageElement);
    expect(urls()).toEqual([
      'https://image.tmdb.org/t/p/w1280/backdrop.jpg',
      'https://image.tmdb.org/t/p/w1280/backdrop.jpg',
    ]);
    expect(container.querySelector('img')).toHaveAttribute('fetchpriority', 'high');
  });

  it('advances every 9 seconds, wraps from the last item to the first, and keeps the other slides inert', async () => {
    const { container } = renderWithProviders(<Banner items={ITEMS} />);
    await pass(8900);
    expect(visibleTitle()).toBe('One');
    await pass(100);
    expect(visibleTitle()).toBe('Two');
    await pass(9000);
    expect(visibleTitle()).toBe('Three');
    await pass(9000);
    expect(visibleTitle()).toBe('One');
    const slides = container.querySelectorAll('article');
    expect(slides[0]).not.toHaveAttribute('inert');
    expect(slides[1]).toHaveAttribute('inert');
    expect(slides[1]).toHaveAttribute('aria-hidden', 'true');
  });

  it('follows the interval the experiment assigned', async () => {
    setBannerIntervalMs(12000);
    renderWithProviders(<Banner items={ITEMS} />);
    await pass(9000);
    expect(visibleTitle()).toBe('One');
    await pass(3000);
    expect(visibleTitle()).toBe('Two');
  });

  it('pauses while the pointer is over it and restarts the full interval when it leaves', async () => {
    renderWithProviders(<Banner items={ITEMS} />);
    const banner = screen.getByRole('region', { name: 'Featured' });
    await pass(5000);
    fireEvent.mouseEnter(banner);
    await pass(30_000);
    expect(visibleTitle()).toBe('One');
    fireEvent.mouseLeave(banner);
    await pass(8900);
    expect(visibleTitle()).toBe('One');
    await pass(200);
    expect(visibleTitle()).toBe('Two');
  });

  it('pauses while a control inside has keyboard focus', async () => {
    renderWithProviders(<Banner items={ITEMS} />);
    const play = screen.getByRole('link', { name: 'Play' });
    act(() => play.focus());
    await pass(30_000);
    expect(visibleTitle()).toBe('One');
    fireEvent.blur(play, { relatedTarget: document.body });
    await pass(9000);
    expect(visibleTitle()).toBe('Two');
  });

  it('keeps pausing while focus moves between controls inside the banner', async () => {
    renderWithProviders(<Banner items={ITEMS} />);
    const play = screen.getByRole('link', { name: 'Play' });
    const more = screen.getByRole('link', { name: 'More info' });
    act(() => play.focus());
    fireEvent.blur(play, { relatedTarget: more });
    await pass(30_000);
    expect(visibleTitle()).toBe('One');
  });

  it('changes at once with the arrows and the dots, and wraps both ways', () => {
    renderWithProviders(<Banner items={ITEMS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Previous featured title' }));
    expect(visibleTitle()).toBe('Three');
    fireEvent.click(screen.getByRole('button', { name: 'Next featured title' }));
    expect(visibleTitle()).toBe('One');
    fireEvent.click(screen.getByRole('button', { name: /Show featured 2 of 3/ }));
    expect(visibleTitle()).toBe('Two');
    expect(screen.getByRole('button', { name: /Show featured 2 of 3/ })).toHaveAttribute('aria-current', 'true');
  });

  it('moves between dots with the Left and Right keys and focuses the new dot', () => {
    renderWithProviders(<Banner items={ITEMS} />);
    const first = screen.getByRole('button', { name: /Show featured 1 of 3/ });
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(visibleTitle()).toBe('Two');
    expect(screen.getByRole('button', { name: /Show featured 2 of 3/ })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('button', { name: /Show featured 2 of 3/ }), { key: 'ArrowLeft' });
    fireEvent.keyDown(screen.getByRole('button', { name: /Show featured 1 of 3/ }), { key: 'ArrowLeft' });
    expect(visibleTitle()).toBe('Three');
    fireEvent.keyDown(screen.getByRole('button', { name: /Show featured 3 of 3/ }), { key: 'Home' });
    expect(visibleTitle()).toBe('Three');
  });

  it('never rotates by itself when the system asks for reduced motion, but still obeys the controls', async () => {
    mockReducedMotion(true);
    renderWithProviders(<Banner items={ITEMS} />);
    await pass(60_000);
    expect(visibleTitle()).toBe('One');
    fireEvent.click(screen.getByRole('button', { name: 'Next featured title' }));
    expect(visibleTitle()).toBe('Two');
  });
  it('does not rotate while it is scrolled out of view', async () => {
    let notify: (entries: Array<{ isIntersecting: boolean }>) => void = () => undefined;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: typeof notify) {
          notify = callback;
        }
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );
    renderWithProviders(<Banner items={ITEMS} />);
    act(() => notify([{ isIntersecting: false }]));
    await pass(30_000);
    expect(visibleTitle()).toBe('One');
    act(() => notify([{ isIntersecting: true }]));
    await pass(9000);
    expect(visibleTitle()).toBe('Two');
  });

  it('shows one item without arrows or dots and never rotates', async () => {
    renderWithProviders(<Banner items={ITEMS.slice(0, 1)} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    await pass(60_000);
    expect(visibleTitle()).toBe('One');
  });

  it('renders nothing for an empty list', () => {
    const { container } = renderWithProviders(<Banner items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
