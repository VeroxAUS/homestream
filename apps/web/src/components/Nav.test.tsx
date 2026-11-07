import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { health } from '../test/fixtures';
import { installBridge } from '../test/desktopBridge';
import { apiError, mockApi, renderWithProviders } from '../test/render';
import { App } from '../App';
import { describeHealth } from './HealthPill';

const navCss = readFileSync(resolve(process.cwd(), 'src/components/Nav.module.css'), 'utf8');
const healthPillCss = readFileSync(resolve(process.cwd(), 'src/components/HealthPill.module.css'), 'utf8');

function nav() {
  return screen.getByRole('navigation', { name: 'Main' });
}

describe('describeHealth', () => {
  it('says all is well for ok', () => {
    expect(describeHealth(health('ok', ['ok']))).toEqual({ tone: 'ok', text: 'All systems healthy' });
  });

  it('counts the warn checks for a warning and the error checks for a problem', () => {
    expect(describeHealth(health('warn', ['ok', 'warn']))).toEqual({ tone: 'warn', text: '1 warning' });
    expect(describeHealth(health('warn', ['warn', 'warn', 'ok']))).toEqual({ tone: 'warn', text: '2 warnings' });
    expect(describeHealth(health('error', ['error', 'warn']))).toEqual({ tone: 'err', text: '1 problem' });
    expect(describeHealth(health('error', ['error', 'error']))).toEqual({ tone: 'err', text: '2 problems' });
  });

  it('still reports one when the answer lists no matching check', () => {
    expect(describeHealth(health('error'))).toEqual({ tone: 'err', text: '1 problem' });
    expect(describeHealth(health('warn', ['ok', 'error']))).toEqual({ tone: 'warn', text: '1 warning' });
  });
});

describe('navigation bar', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists Home, Search, Dashboards and Settings, and highlights the page that is open', async () => {
    mockApi({ 'GET /api/health': health('ok') });
    renderWithProviders(<App />, '/settings');
    await screen.findByRole('heading', { name: 'Settings' });
    expect(within(nav()).getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav()).getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
    expect(within(nav()).getByRole('link', { name: 'Search' })).toHaveAttribute('href', '/search');
    expect(within(nav()).getByRole('button', { name: /Dashboards/ })).not.toHaveAttribute('aria-current');
  });

  it('opens the Dashboards menu with the five dashboards, goes to one, and closes the menu', async () => {
    mockApi({ 'GET /api/health': health('ok') });
    renderWithProviders(<App />, '/');
    const button = within(nav()).getByRole('button', { name: /Dashboards/ });
    expect(screen.queryByRole('list', { name: 'Dashboards' })).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('list', { name: 'Dashboards' });
    expect(
      within(menu)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Health', 'Activity', 'History', 'Graphs', 'Stats']);

    fireEvent.click(within(menu).getByRole('link', { name: 'Graphs' }));
    expect(await screen.findByRole('heading', { name: 'Dashboards' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Dashboards' })).not.toBeInTheDocument();
    expect(within(nav()).getByRole('button', { name: /Dashboards/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Graphs' })).toHaveAttribute('aria-current', 'page');
  });

  it('closes the Dashboards menu on Escape and on a click elsewhere', () => {
    mockApi({ 'GET /api/health': health('ok') });
    renderWithProviders(<App />, '/');
    const button = within(nav()).getByRole('button', { name: /Dashboards/ });
    fireEvent.click(button);
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(screen.getByRole('list', { name: 'Dashboards' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('list', { name: 'Dashboards' })).not.toBeInTheDocument();

    fireEvent.click(button);
    fireEvent.pointerDown(within(nav()).getByRole('list', { name: 'Dashboards' }));
    expect(screen.getByRole('list', { name: 'Dashboards' })).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('list', { name: 'Dashboards' })).not.toBeInTheDocument();
  });

  it.each([
    ['ok', health('ok', ['ok']), 'All systems healthy', 'ok'],
    ['warn', health('warn', ['ok', 'warn']), '1 warning', 'warn'],
    ['error', health('error', ['error', 'error']), '2 problems', 'err'],
  ])(
    'shows the %s state of /api/health in the health pill and links it to the dashboard',
    async (_name, body, text, tone) => {
      mockApi({ 'GET /api/health': body });
      renderWithProviders(<App />, '/settings');
      const pill = await screen.findByRole('link', { name: text });
      expect(pill).toHaveAttribute('href', '/dashboard/health');
      expect(pill).toHaveAttribute('data-health', tone);
      expect(pill).toHaveTextContent(text);
    },
  );

  it('shows Checking... until the answer arrives', () => {
    mockApi({ 'GET /api/health': () => new Promise(() => undefined) });
    renderWithProviders(<App />, '/settings');
    expect(screen.getByRole('link', { name: 'Checking...' })).toHaveAttribute('data-health', 'unknown');
  });

  it.each([
    ['cannot be reached', new TypeError('offline')],
    ['answers with an error', apiError(500, 'internal_error', 'Broken')],
  ])('shows Server unreachable when the server %s', async (_name, reply) => {
    mockApi({ 'GET /api/health': reply });
    renderWithProviders(<App />, '/settings');
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Server unreachable' })).toHaveAttribute('data-health', 'err'),
    );
  });

  it('opens the health dashboard when the pill is clicked', async () => {
    mockApi({ 'GET /api/health': health('ok') });
    renderWithProviders(<App />, '/settings');
    fireEvent.click(await screen.findByRole('link', { name: 'All systems healthy' }));
    expect(await screen.findByRole('heading', { name: 'Health' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Health' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('navigation bar in the desktop app', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete window.homestream;
  });

  function bar() {
    return nav().closest('header') as HTMLElement;
  }

  it('is a plain bar in a browser', async () => {
    mockApi({ 'GET /api/health': health('warn', ['warn']) });
    renderWithProviders(<App />, '/settings');
    const pill = await screen.findByRole('link', { name: '1 warning' });
    expect(bar().className).not.toMatch(/desktop/);
    expect(bar()).not.toHaveAttribute('data-desktop');
    expect(pill.className).not.toMatch(/compact/);
  });

  it('becomes the drag region and keeps the full health text as label and tooltip for the dot-only pill', async () => {
    installBridge();
    mockApi({ 'GET /api/health': health('error', ['error', 'error']) });
    renderWithProviders(<App />, '/settings');
    const pill = await screen.findByRole('link', { name: '2 problems' });
    expect(bar().className).toMatch(/desktop/);
    expect(bar()).toHaveAttribute('data-desktop', 'true');
    expect(pill.className).toMatch(/compact/);
    expect(pill).toHaveAttribute('title', '2 problems');
    expect(pill).toHaveAttribute('aria-label', '2 problems');
  });

  it('styles the drag region, the 186 px padding, the no-drag controls and the 1200 px pill breakpoint', () => {
    const desktopRule = /\.desktop\s*\{([^}]*)\}/.exec(navCss)?.[1] ?? '';
    expect(desktopRule).toMatch(/padding-right:\s*186px/);
    expect(desktopRule).toMatch(/-webkit-app-region:\s*drag/);
    const noDrag = /\.desktop a,\s*\.desktop button,\s*\.desktop ul\s*\{([^}]*)\}/.exec(navCss)?.[1] ?? '';
    expect(noDrag).toMatch(/-webkit-app-region:\s*no-drag/);
    const compact = /@media \(max-width: 1199px\)\s*\{[^@]*\.compact \.text\s*\{\s*display:\s*none/.test(healthPillCss);
    expect(compact).toBe(true);
    expect(healthPillCss).toMatch(/@media \(max-width: 899px\)\s*\{\s*\.text\s*\{\s*display:\s*none/);
  });
});
