import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import SettingsPage from '../pages/SettingsPage';
import { INFO } from '../test/fixtures';
import { installBridge } from '../test/desktopBridge';
import { mockApi, renderWithProviders } from '../test/render';

afterEach(() => {
  delete window.homestream;
});

function open(overrides: Parameters<typeof installBridge>[0] = {}) {
  const bridge = installBridge(overrides);
  mockApi({ 'GET /api/info': INFO });
  renderWithProviders(<SettingsPage />);
  return bridge;
}

describe('Settings > Desktop', () => {
  it('lists the nine rows in order with the designed words', async () => {
    open();
    const section = await screen.findByRole('region', { name: 'Desktop' });
    const labels = within(section)
      .getAllByText(/./, { selector: 'div[class*="label"] > span:first-child' })
      .map((node) => node.textContent);
    expect(labels).toEqual([
      'Start with Windows',
      'Start minimised to tray',
      'Close button',
      'Notify me when a title is ready to watch',
      'Notify me when playback or a download fails',
      'Hardware acceleration',
      'Server status',
      'Logs',
      'Quit HomeStream',
    ]);
    expect(within(section).getByText(/Takes effect after a restart/)).toBeInTheDocument();
    expect(within(section).getByText('Stops the server this app started')).toBeInTheDocument();
    expect(within(section).getByRole('radio', { name: 'Keep running in tray' })).toBeChecked();
  });

  it('shows the live server status line', async () => {
    open();
    expect(await screen.findByText('Server: running (spawned, pid 1234)')).toBeInTheDocument();
  });

  it('saves a switch at once, without a Save button', async () => {
    const bridge = open();
    const toggle = await screen.findByRole('switch', { name: 'Notify me when a title is ready to watch' });
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    expect(bridge.setDesktopSetting).toHaveBeenCalledWith('notifyReady', false);
    await waitFor(() => expect(toggle).not.toBeChecked());
    await userEvent.click(screen.getByRole('switch', { name: 'Hardware acceleration' }));
    expect(bridge.setDesktopSetting).toHaveBeenCalledWith('hardwareAcceleration', false);
  });

  it('saves the start-minimised and failure-notification switches', async () => {
    const bridge = open();
    await userEvent.click(await screen.findByRole('switch', { name: 'Start minimised to tray' }));
    expect(bridge.setDesktopSetting).toHaveBeenCalledWith('startMinimized', false);
    await userEvent.click(screen.getByRole('switch', { name: 'Notify me when playback or a download fails' }));
    expect(bridge.setDesktopSetting).toHaveBeenCalledWith('notifyFailures', false);
  });

  it('keeps the old values when the shell refuses a change', async () => {
    open({
      setDesktopSetting: () => Promise.reject(new Error('refused')),
      setStartWithWindows: () => Promise.reject(new Error('refused')),
    });
    const toggle = await screen.findByRole('switch', { name: 'Notify me when a title is ready to watch' });
    await userEvent.click(toggle);
    await userEvent.click(screen.getByRole('switch', { name: 'Start with Windows' }));
    expect(toggle).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Start with Windows' })).not.toBeChecked();
  });

  it('switches the close button to Quit', async () => {
    const bridge = open();
    await userEvent.click(await screen.findByRole('radio', { name: 'Quit' }));
    expect(bridge.setDesktopSetting).toHaveBeenCalledWith('closeBehaviour', 'quit');
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Quit' })).toBeChecked());
  });

  it('turns Start with Windows on through the shell and shows the answer', async () => {
    const bridge = open();
    const toggle = await screen.findByRole('switch', { name: 'Start with Windows' });
    await userEvent.click(toggle);
    expect(bridge.setStartWithWindows).toHaveBeenCalledWith(true);
    await waitFor(() => expect(toggle).toBeChecked());
  });

  it('restarts the server and says so when the server is managed outside the app', async () => {
    open({ restartServer: () => Promise.resolve({ ok: false, message: 'Server is managed outside the app' }) });
    await userEvent.click(await screen.findByRole('button', { name: 'Restart server' }));
    expect(await screen.findByText('Server is managed outside the app')).toBeInTheDocument();
  });

  it('opens the logs folder and quits through the bridge', async () => {
    const bridge = open();
    await userEvent.click(await screen.findByRole('button', { name: 'Open logs folder' }));
    await userEvent.click(screen.getByRole('button', { name: 'Quit' }));
    expect(bridge.openLogs).toHaveBeenCalledTimes(1);
    expect(bridge.quit).toHaveBeenCalledTimes(1);
  });

  it('adds the desktop version and a disabled update check to About', async () => {
    open();
    expect(await screen.findByText('Desktop app v0.1.0 \u00b7 Electron 45')).toBeInTheDocument();
    expect(screen.getByText('Updates are not set up yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeDisabled();
  });

  it('is absent in a plain browser', async () => {
    mockApi({ 'GET /api/info': INFO });
    renderWithProviders(<SettingsPage />);
    await screen.findByText('Test PC');
    expect(screen.queryByRole('region', { name: 'Desktop' })).not.toBeInTheDocument();
    expect(screen.queryByText('Updates are not set up yet')).not.toBeInTheDocument();
  });
});
