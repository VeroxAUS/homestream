import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, mockApi, renderWithProviders } from '../test/render';
import { installBridge } from '../test/desktopBridge';
import { INFO } from '../test/fixtures';
import SettingsPage from './SettingsPage';

describe('SettingsPage', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.unstubAllGlobals();
    delete window.homestream;
  });

  it('shows the server information without any secret', async () => {
    mockApi({ 'GET /api/info': { ...INFO, lanAddresses: ['192.0.2.10', '198.51.100.4'] } });
    renderWithProviders(<SettingsPage />, '/settings');

    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    await screen.findByText(INFO.name);
    const about = screen.getByRole('region', { name: 'About' });
    expect(within(about).getByText(INFO.name)).toBeInTheDocument();
    expect(within(about).getByText(INFO.version)).toBeInTheDocument();
    expect(within(about).getByText(String(INFO.port))).toBeInTheDocument();
    expect(within(about).getByText('192.0.2.10')).toBeInTheDocument();
    expect(within(about).getByText('198.51.100.4')).toBeInTheDocument();
    expect(within(about).getByText('aiostreams (redacted)')).toBeInTheDocument();
    expect(within(about).getByText('H.264 · SDR · up to 2160p · stereo')).toBeInTheDocument();
    expect(about.textContent).not.toMatch(/https?:\/\/(?!localhost)/);
  });

  it('says so when the server has no LAN address', async () => {
    mockApi({ 'GET /api/info': { ...INFO, lanAddresses: [] } });
    renderWithProviders(<SettingsPage />);
    expect(await screen.findByText('None found')).toBeInTheDocument();
  });

  it('explains a failed info request and retries on request', async () => {
    let attempts = 0;
    mockApi({
      'GET /api/info': () => (++attempts === 1 ? apiError(500, 'boom', 'Info failed.', 'Check the server log.') : INFO),
    });
    renderWithProviders(<SettingsPage />);
    expect(await screen.findByText('Info failed.')).toBeInTheDocument();
    expect(screen.getByText('Check the server log.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /try again|retry/i }));
    expect(await screen.findByText(INFO.name)).toBeInTheDocument();
  });

  it('saves the device name locally and registers it with the server', async () => {
    const { calls } = mockApi({ 'GET /api/info': INFO, 'POST /api/devices': { ok: true } });
    renderWithProviders(<SettingsPage />);

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
    mockApi({ 'GET /api/info': INFO });
    renderWithProviders(<SettingsPage />);
    expect(screen.getByRole('textbox', { name: 'Device name' })).toHaveValue('Study laptop');
  });

  it('keeps the name on this device when the server cannot be reached', async () => {
    mockApi({ 'GET /api/info': INFO, 'POST /api/devices': new TypeError('offline') });
    renderWithProviders(<SettingsPage />);
    const input = screen.getByRole('textbox', { name: 'Device name' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Den');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Saved on this device/)).toBeInTheDocument();
    expect(localStorage.getItem('homestream.deviceName')).toBe('Den');
  });

  it('goes back to the default name when the field is emptied', async () => {
    localStorage.setItem('homestream.deviceName', 'Old');
    mockApi({ 'GET /api/info': INFO, 'POST /api/devices': { ok: true } });
    renderWithProviders(<SettingsPage />);
    const input = screen.getByRole('textbox', { name: 'Device name' });
    await userEvent.clear(input);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Device name saved.');
    expect(localStorage.getItem('homestream.deviceName')).toBeNull();
    expect(input).toHaveValue('Web browser');
  });

  it('offers Hide episode spoilers under This device, on by default', () => {
    mockApi({ 'GET /api/info': INFO });
    renderWithProviders(<SettingsPage />);
    const device = screen.getByRole('region', { name: 'This device' });
    expect(
      within(device).getByText("Blurs stills and hides descriptions of episodes you haven't finished"),
    ).toBeInTheDocument();
    expect(within(device).getByRole('switch', { name: 'Hide episode spoilers' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('turns spoiler hiding off and on on this device only, without a server call', async () => {
    const { calls } = mockApi({ 'GET /api/info': INFO });
    renderWithProviders(<SettingsPage />);
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
    mockApi({ 'GET /api/info': INFO });
    renderWithProviders(<SettingsPage />);
    expect(screen.getByRole('switch', { name: 'Hide episode spoilers' })).toHaveAttribute('aria-checked', 'false');
  });

  it('labels the device type for the desktop shell', () => {
    installBridge();
    mockApi({ 'GET /api/info': INFO });
    renderWithProviders(<SettingsPage />);
    expect(screen.getByText('Desktop app')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Device name' })).toHaveValue('HomeStream Desktop');
  });
});
