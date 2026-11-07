import { DEFAULT_DESKTOP_SETTINGS, type HomestreamBridge, type ShellState } from '@homestream/shared';
import { vi, type Mock } from 'vitest';

type BridgeMocks = {
  [K in keyof HomestreamBridge]: HomestreamBridge[K] extends (...args: never[]) => unknown
    ? Mock<HomestreamBridge[K]>
    : HomestreamBridge[K];
};

const SHELL_STATE: ShellState = {
  tray: { state: 'ok', tooltip: 'HomeStream', menu: [] },
  activeSessions: 0,
  powerSaveBlocker: 'none',
  hardwareAcceleration: true,
  window: {
    bounds: { x: 0, y: 0, width: 1280, height: 800 },
    maximized: false,
    fullscreen: false,
    visible: true,
    focused: true,
  },
  miniPlayer: null,
};

/** A complete `window.homestream` with every call mocked; `overrides` replace single members. */
export function installBridge(overrides: Partial<HomestreamBridge> = {}): BridgeMocks {
  let settings = { ...DEFAULT_DESKTOP_SETTINGS };
  const bridge = {
    isDesktop: true,
    isMiniPlayer: false,
    version: '0.1.0',
    getStartWithWindows: vi.fn(() => Promise.resolve(false)),
    setStartWithWindows: vi.fn((enabled: boolean) => Promise.resolve(enabled)),
    restartServer: vi.fn(() => Promise.resolve({ ok: true })),
    quit: vi.fn(() => Promise.resolve()),
    getServerStatus: vi.fn(() => Promise.resolve('Server: running (spawned, pid 1234)')),
    retry: vi.fn(() => Promise.resolve()),
    openLogs: vi.fn(() => Promise.resolve()),
    openConfig: vi.fn(() => Promise.resolve()),
    getDesktopSettings: vi.fn(() => Promise.resolve(settings)),
    setDesktopSetting: vi.fn((key: string, value: unknown) => {
      settings = { ...settings, [key]: value };
      return Promise.resolve(settings);
    }),
    reportPlaying: vi.fn(() => Promise.resolve()),
    openMiniPlayer: vi.fn(() => Promise.resolve(true)),
    returnToMain: vi.fn(() => Promise.resolve()),
    closeMiniPlayer: vi.fn(() => Promise.resolve()),
    setMiniAlwaysOnTop: vi.fn((onTop: boolean) => Promise.resolve(onTop)),
    onHandover: vi.fn(() => () => undefined),
    getShellState: vi.fn(() => Promise.resolve(SHELL_STATE)),
    ...overrides,
  };
  window.homestream = bridge;
  return bridge as unknown as BridgeMocks;
}
