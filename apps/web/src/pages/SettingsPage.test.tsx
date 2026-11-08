import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, mockApi, renderWithProviders } from '../test/render';
import { installBridge } from '../test/desktopBridge';
import { INFO } from '../test/fixtures';
import SettingsPage from './SettingsPage';

// A hidden panel has no accessible name, so panels are found through the tab that controls them.
const panelOf = (name: string): HTMLElement => {
  const panel = document.getElementById(screen.getByRole('tab', { name }).getAttribute('aria-controls') ?? '');
  if (!panel) throw new Error(`No panel for the ${name} tab`);
  return panel;
};
const settingsPanel = () => panelOf('Settings');
const aboutPanel = () => panelOf('About');
const tab = (name: string) => screen.getByRole('tab', { name });

function openWithHash(hash: string) {
  window.history.replaceState(null, '', `/settings${hash}`);
  mockApi({ 'GET /api/info': INFO });
  renderWithProviders(<SettingsPage />, '/settings');
}

describe('SettingsPage tabs', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete window.homestream;
  });

  it('has exactly two tabs, Settings and About, and opens on Settings', () => {
    openWithHash('');
    expect(screen.getAllByRole('tablist')).toHaveLength(1);
    expect(screen.getAllByRole('tab').map((node) => node.textContent)).toEqual(['Settings', 'About']);
    expect(tab('Settings')).toHaveAttribute('aria-selected', 'true');
    expect(tab('About')).toHaveAttribute('aria-selected', 'false');
    expect(tab('Settings')).toHaveAttribute('aria-controls', settingsPanel().id);
    expect(tab('About')).toHaveAttribute('aria-controls', aboutPanel().id);
    expect(settingsPanel()).toBeVisible();
    expect(aboutPanel()).not.toBeVisible();
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
  });

  it.each(['#settings', '#nothing', '#'])('shows the Settings tab for the hash "%s"', (hash) => {
    openWithHash(hash);
    expect(tab('Settings')).toHaveAttribute('aria-selected', 'true');
    expect(settingsPanel()).toBeVisible();
  });

  it('opens About directly for #about, with the Settings panel never visible', () => {
    openWithHash('#about');
    expect(tab('About')).toHaveAttribute('aria-selected', 'true');
    expect(aboutPanel()).toBeVisible();
    expect(settingsPanel()).not.toBeVisible();
  });

  it('switches the panel and replaces the hash without adding history entries', async () => {
    openWithHash('');
    const push = vi.spyOn(window.history, 'pushState');
    const replace = vi.spyOn(window.history, 'replaceState');
    const length = window.history.length;

    await userEvent.click(tab('About'));
    expect(window.location.hash).toBe('#about');
    expect(aboutPanel()).toBeVisible();
    expect(settingsPanel()).not.toBeVisible();

    await userEvent.click(tab('Settings'));
    expect(window.location.hash).toBe('#settings');
    expect(settingsPanel()).toBeVisible();

    expect(window.location.pathname).toBe('/settings');
    expect(push).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledTimes(2);
    expect(window.history.length).toBe(length);
  });

  it('follows the address bar when the hash changes', () => {
    openWithHash('');
    act(() => {
      window.history.replaceState(null, '', '/settings#about');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(tab('About')).toHaveAttribute('aria-selected', 'true');
    act(() => {
      window.history.replaceState(null, '', '/settings#nothing');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(tab('Settings')).toHaveAttribute('aria-selected', 'true');
  });

  it('moves between tabs with the arrow keys, wrapping, and with Home and End', async () => {
    openWithHash('');
    expect(tab('Settings')).toHaveAttribute('tabindex', '0');
    expect(tab('About')).toHaveAttribute('tabindex', '-1');

    tab('Settings').focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(tab('About')).toHaveFocus();
    expect(tab('About')).toHaveAttribute('aria-selected', 'true');
    expect(tab('About')).toHaveAttribute('tabindex', '0');
    expect(tab('Settings')).toHaveAttribute('tabindex', '-1');
    expect(window.location.hash).toBe('#about');

    await userEvent.keyboard('{ArrowRight}');
    expect(tab('Settings')).toHaveFocus();
    expect(tab('Settings')).toHaveAttribute('aria-selected', 'true');

    await userEvent.keyboard('{ArrowLeft}');
    expect(tab('About')).toHaveFocus();
    expect(tab('About')).toHaveAttribute('aria-selected', 'true');

    await userEvent.keyboard('{Home}');
    expect(tab('Settings')).toHaveFocus();
    expect(tab('Settings')).toHaveAttribute('aria-selected', 'true');

    await userEvent.keyboard('{End}');
    expect(tab('About')).toHaveFocus();
    expect(tab('About')).toHaveAttribute('aria-selected', 'true');
  });

  it('selects a focused tab with Enter and with Space', async () => {
    openWithHash('');
    tab('About').focus();
    expect(tab('Settings')).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Enter}');
    expect(tab('About')).toHaveAttribute('aria-selected', 'true');

    tab('Settings').focus();
    await userEvent.keyboard(' ');
    expect(tab('Settings')).toHaveAttribute('aria-selected', 'true');
  });

  it('tabs from the selected tab into the panel, not to the other tab', async () => {
    openWithHash('');
    tab('Settings').focus();
    await userEvent.tab();
    expect(screen.getByRole('textbox', { name: 'Device name' })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(tab('Settings')).toHaveFocus();
  });
});

describe('Settings tab', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete window.homestream;
  });

  it('shows only the This device card in a plain browser', () => {
    openWithHash('');
    const panel = settingsPanel();
    expect(
      within(panel)
        .getAllByRole('heading')
        .map((node) => node.textContent),
    ).toEqual(['This device']);
    const device = within(panel).getByRole('region', { name: 'This device' });
    expect(within(device).getByText('Device name')).toBeInTheDocument();
    expect(within(device).getByText('Shown in the Activity and History dashboards')).toBeInTheDocument();
    expect(within(device).getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(within(device).getByText('Hide episode spoilers')).toBeInTheDocument();
    expect(
      within(device).getByText("Blurs stills and hides descriptions of episodes you haven't finished"),
    ).toBeInTheDocument();
    expect(within(device).getByRole('switch', { name: 'Hide episode spoilers' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(
      within(device)
        .getAllByText(/./, { selector: 'div[class*="label"] > span:first-child' })
        .map((node) => node.textContent),
    ).toEqual(['Device name', 'Hide episode spoilers']);
  });

  it('holds no read-only information', async () => {
    mockApi({ 'GET /api/info': { ...INFO, lanAddresses: ['192.0.2.10'] } });
    window.history.replaceState(null, '', '/settings');
    renderWithProviders(<SettingsPage />, '/settings');
    await within(aboutPanel()).findByText(INFO.name);
    const text = settingsPanel().textContent ?? '';
    for (const forbidden of [
      'Device type',
      'Web browser',
      'Desktop app',
      'Server name',
      'Version',
      'Server address',
      'Port',
      'LAN addresses',
      'Stream source',
      'aiostreams',
      'Playback profile',
      'H.264',
      INFO.name,
      '192.0.2.10',
    ]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });

  it('saves the device name locally and registers it with the server', async () => {
    window.history.replaceState(null, '', '/settings');
    const { calls } = mockApi({ 'GET /api/info': INFO, 'POST /api/devices': { ok: true } });
    renderWithProviders(<SettingsPage />, '/settings');

    const input = screen.getByRole('textbox', { name: 'Device name' });
    expect(input).toHaveValue('Web browser');
    await userEvent.clear(input);
    await userEvent.type(input, '  Living room PC  ');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Device name saved.')).toBeInTheDocument();
    expect(localStorage.getItem('homestream.deviceName')).toBe('Living room PC');
    expect(input).toHaveValue('Living room PC');
    const post = calls.find((call) => call.method === 'POST' && call.path === '/api/devices');
    expect(post?.body).toMatchObject({
      deviceName: 'Living room PC',
      kind: 'web',
      h264: true,
      hevc: false,
      maxWidth: 3840,
      maxHeight: 2160,
      maxAudioChannels: 2,
    });
  });

  it('shows the saved name again on a later visit', () => {
    localStorage.setItem('homestream.deviceName', 'Study laptop');
    openWithHash('');
    expect(screen.getByRole('textbox', { name: 'Device name' })).toHaveValue('Study laptop');
  });

  it('keeps the name on this device when the server cannot be reached', async () => {
    window.history.replaceState(null, '', '/settings');
    mockApi({ 'GET /api/info': INFO, 'POST /api/devices': new TypeError('offline') });
    renderWithProviders(<SettingsPage />, '/settings');
    const input = screen.getByRole('textbox', { name: 'Device name' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Den');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Saved on this device/)).toBeInTheDocument();
    expect(localStorage.getItem('homestream.deviceName')).toBe('Den');
  });

  it('goes back to the default name when the field is emptied', async () => {
    localStorage.setItem('homestream.deviceName', 'Old');
    window.history.replaceState(null, '', '/settings');
    mockApi({ 'GET /api/info': INFO, 'POST /api/devices': { ok: true } });
    renderWithProviders(<SettingsPage />, '/settings');
    const input = screen.getByRole('textbox', { name: 'Device name' });
    await userEvent.clear(input);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Device name saved.');
    expect(localStorage.getItem('homestream.deviceName')).toBeNull();
    expect(input).toHaveValue('Web browser');
  });

  it('turns spoiler hiding off and on on this device only, without a server call', async () => {
    window.history.replaceState(null, '', '/settings');
    const { calls } = mockApi({ 'GET /api/info': INFO });
    renderWithProviders(<SettingsPage />, '/settings');
    const toggle = screen.getByRole('switch', { name: 'Hide episode spoilers' });

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(localStorage.getItem('homestream.hideSpoilers')).toBe('off');

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem('homestream.hideSpoilers')).toBeNull();
    expect(calls.filter((call) => call.method !== 'GET')).toEqual([]);
  });

  it('shows the switch off when the device stored off', () => {
    localStorage.setItem('homestream.hideSpoilers', 'off');
    openWithHash('');
    expect(screen.getByRole('switch', { name: 'Hide episode spoilers' })).toHaveAttribute('aria-checked', 'false');
  });

  it('adds the Desktop card after This device inside the desktop shell', () => {
    installBridge();
    openWithHash('');
    expect(
      within(settingsPanel())
        .getAllByRole('heading')
        .map((node) => node.textContent),
    ).toEqual(['This device', 'Desktop']);
    expect(screen.getByRole('textbox', { name: 'Device name' })).toHaveValue('HomeStream Desktop');
  });
});

describe('About tab', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete window.homestream;
  });

  const rowValue = (group: HTMLElement, label: string) => {
    const term = within(group).getByText(label, { selector: 'dt > span:first-child' });
    return term.closest('div')?.querySelector('dd')?.textContent;
  };

  it('shows the header and the summary from the server information, without any secret', async () => {
    window.history.replaceState(null, '', '/settings#about');
    mockApi({ 'GET /api/info': { ...INFO, lanAddresses: ['192.0.2.10', '198.51.100.4'] } });
    renderWithProviders(<SettingsPage />, '/settings');

    const about = aboutPanel();
    expect(within(about).getByRole('heading', { level: 2, name: 'HomeStream' })).toBeInTheDocument();
    expect(within(about).getByText('Web app')).toBeInTheDocument();
    expect(within(about).queryByText('Updates are not set up yet')).not.toBeInTheDocument();
    expect(within(about).queryByRole('button')).not.toBeInTheDocument();

    const server = await within(about).findByRole('group', { name: 'Server' });
    expect(rowValue(server, 'Server name')).toBe(INFO.name);
    expect(rowValue(server, 'Version')).toBe(INFO.version);
    expect(rowValue(server, 'Server address')).toBe(window.location.origin);
    expect(rowValue(server, 'Port')).toBe(String(INFO.port));

    const network = within(about).getByRole('group', { name: 'Network' });
    expect(within(network).getByText('Use one of these on a TV or phone')).toBeInTheDocument();
    expect(
      within(network)
        .getAllByRole('listitem')
        .map((node) => node.textContent),
    ).toEqual(['192.0.2.10', '198.51.100.4']);

    const playback = within(about).getByRole('group', { name: 'Playback' });
    expect(rowValue(playback, 'Stream source')).toBe('aiostreams (redacted)');
    expect(within(playback).getByText('What this browser asks the server to produce')).toBeInTheDocument();
    expect(rowValue(playback, 'Playback profile')).toBe('H.264 · SDR · up to 2160p · stereo');

    const device = within(about).getByRole('group', { name: 'This device' });
    expect(rowValue(device, 'Device type')).toBe('Web browser');

    expect(about.textContent).not.toMatch(/https?:\/\/(?!localhost)/);
    expect(about.querySelector('input, [role="switch"], select, [role="radiogroup"]')).toBeNull();
  });

  it('lists the groups in the two columns of the summary', async () => {
    window.history.replaceState(null, '', '/settings#about');
    mockApi({ 'GET /api/info': INFO });
    renderWithProviders(<SettingsPage />, '/settings');
    await within(aboutPanel()).findByText(INFO.name);
    expect(within(aboutPanel()).getAllByRole('group')).toHaveLength(4);

    const columns = aboutPanel().querySelectorAll('[data-column]');
    expect(columns).toHaveLength(2);
    expect(within(columns[0] as HTMLElement).getAllByRole('group')).toHaveLength(1);
    expect(within(columns[1] as HTMLElement).getAllByRole('group')).toHaveLength(3);
  });

  it('says so when the server has no LAN address', async () => {
    window.history.replaceState(null, '', '/settings#about');
    mockApi({ 'GET /api/info': { ...INFO, lanAddresses: [] } });
    renderWithProviders(<SettingsPage />, '/settings');
    expect(await within(aboutPanel()).findByText('None found')).toBeInTheDocument();
  });

  it('explains a failed info request and retries on request', async () => {
    let attempts = 0;
    window.history.replaceState(null, '', '/settings#about');
    mockApi({
      'GET /api/info': () => (++attempts === 1 ? apiError(500, 'boom', 'Info failed.', 'Check the server log.') : INFO),
    });
    renderWithProviders(<SettingsPage />, '/settings');
    expect(await screen.findByText('Info failed.')).toBeInTheDocument();
    expect(screen.getByText('Check the server log.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /try again|retry/i }));
    expect(await screen.findByText(INFO.name)).toBeInTheDocument();
  });

  it('shows a loading state until the information arrives', () => {
    window.history.replaceState(null, '', '/settings#about');
    mockApi({ 'GET /api/info': () => new Promise(() => undefined) });
    renderWithProviders(<SettingsPage />, '/settings');
    expect(screen.getByRole('status', { name: 'Loading server information' })).toBeInTheDocument();
  });

  it('shows the desktop version, the update status and Device type Desktop app inside the shell', async () => {
    installBridge();
    window.history.replaceState(null, '', '/settings#about');
    mockApi({ 'GET /api/info': INFO });
    renderWithProviders(<SettingsPage />, '/settings');

    const about = aboutPanel();
    expect(within(about).getByText('Desktop app v0.1.0 \u00b7 Electron 45')).toBeInTheDocument();
    expect(within(about).queryByText('Web app')).not.toBeInTheDocument();
    expect(within(about).getByText('Updates are not set up yet')).toBeInTheDocument();
    const check = within(about).getByRole('button', { name: 'Check for updates' });
    expect(check).toBeDisabled();
    await userEvent.click(check);
    expect(window.location.hash).toBe('#about');

    const device = await within(about).findByRole('group', { name: 'This device' });
    expect(rowValue(device, 'Device type')).toBe('Desktop app');
    for (const label of ['Start with Windows', 'Close button', 'Hardware acceleration', 'Quit HomeStream']) {
      expect(about.textContent).not.toContain(label);
    }
  });
});
