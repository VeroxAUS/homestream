import type { Page } from '@playwright/test';

export const BRIDGE_VERSION = '0.0.0-e2e';

/**
 * Sets `window.homestream` before the page scripts run, with every call Settings and the nav make answered by a fixed
 * value. Changes made through it live in the page only.
 */
export async function installDesktopBridge(page: Page): Promise<void> {
  await page.addInitScript((version) => {
    let settings = {
      startMinimized: true,
      closeBehaviour: 'tray',
      notifyReady: true,
      notifyFailures: true,
      hardwareAcceleration: true,
      closeNoticeShown: false,
    };
    let startWithWindows = false;
    const bridge = {
      isDesktop: true,
      isMiniPlayer: false,
      version,
      getStartWithWindows: () => Promise.resolve(startWithWindows),
      setStartWithWindows: (enabled: boolean) => Promise.resolve((startWithWindows = enabled)),
      restartServer: () => Promise.resolve({ ok: true }),
      quit: () => Promise.resolve(),
      getServerStatus: () => Promise.resolve('Server: running (spawned, pid 1234)'),
      retry: () => Promise.resolve(),
      openLogs: () => Promise.resolve(),
      openConfig: () => Promise.resolve(),
      getDesktopSettings: () => Promise.resolve(settings),
      setDesktopSetting: (key: string, value: unknown) => Promise.resolve((settings = { ...settings, [key]: value })),
      reportPlaying: () => Promise.resolve(),
      openMiniPlayer: () => Promise.resolve(false),
      returnToMain: () => Promise.resolve(),
      closeMiniPlayer: () => Promise.resolve(),
      setMiniAlwaysOnTop: (onTop: boolean) => Promise.resolve(onTop),
      onHandover: () => () => undefined,
      getShellState: () => Promise.resolve({}),
    };
    (window as unknown as { homestream: unknown }).homestream = bridge;
  }, BRIDGE_VERSION);
}
