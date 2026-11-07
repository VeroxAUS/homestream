import { BrowserWindow, screen, shell, type WebPreferences } from 'electron';
import type { WindowSnapshot } from '@homestream/shared';
import { MINI_HEIGHT, MINI_MIN_HEIGHT, MINI_MIN_WIDTH, MINI_WIDTH, miniBounds } from '../miniPlayer.js';
import type { Logger } from '../logger.js';
import {
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  debounce,
  loadWindowState,
  resolveWindowState,
  saveWindowState,
  type DisplayInfo,
  type Rect,
} from '../windowState.js';

const BACKGROUND = '#0a0a0e';
const SAVE_DELAY_MS = 500;

export interface WindowCommon {
  preload: string;
  icon: string;
  version: string;
  logger: Logger;
  /** The pages a window may show: the server's origin and the bundled startup page. */
  isAllowedUrl(url: string): boolean;
}

function webPreferences(common: WindowCommon, mini: boolean): WebPreferences {
  return {
    preload: common.preload,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    backgroundThrottling: false,
    autoplayPolicy: 'no-user-gesture-required',
    additionalArguments: [`--hs-version=${common.version}`, ...(mini ? ['--hs-mini'] : [])],
  };
}

/** A window can only show HomeStream's own pages; anything else opens in the browser or not at all. */
function guardNavigation(window: BrowserWindow, common: WindowCommon): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (common.isAllowedUrl(url)) return;
    event.preventDefault();
    common.logger.warn('blocked a navigation to another page');
  });
  window.setMenuBarVisibility(false);
}

function displays(): { all: DisplayInfo[]; primary: DisplayInfo } {
  const toInfo = (display: Electron.Display): DisplayInfo => ({ id: display.id, workArea: display.workArea });
  return { all: screen.getAllDisplays().map(toInfo), primary: toInfo(screen.getPrimaryDisplay()) };
}

export interface MainWindowOptions extends WindowCommon {
  stateFile: string;
  /** True while the app is quitting: the window then really closes. */
  isQuitting(): boolean;
  closeBehaviour(): 'tray' | 'quit';
  /** The X button hid the window to the tray. */
  onHiddenToTray(): void;
  onQuitRequested(): void;
}

export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const { all, primary } = displays();
  const resolved = resolveWindowState(loadWindowState(options.stateFile), all, primary);
  const window = new BrowserWindow({
    ...resolved.bounds,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,
    title: 'HomeStream',
    icon: options.icon,
    backgroundColor: BACKGROUND,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: BACKGROUND, symbolColor: '#f5f5f7', height: 40 },
    webPreferences: webPreferences(options, false),
  });
  if (resolved.maximized) window.maximize();
  guardNavigation(window, options);

  const save = debounce(() => {
    if (window.isDestroyed() || window.isMinimized() || window.isFullScreen()) return;
    const bounds = window.getNormalBounds();
    saveWindowState(options.stateFile, {
      ...bounds,
      maximized: window.isMaximized(),
      displayId: screen.getDisplayMatching(bounds).id,
    });
  }, SAVE_DELAY_MS);
  window.on('resize', () => save.trigger());
  window.on('move', () => save.trigger());
  window.on('maximize', () => save.trigger());
  window.on('unmaximize', () => save.trigger());
  window.on('close', (event) => {
    save.flush();
    if (options.isQuitting()) return;
    event.preventDefault();
    if (options.closeBehaviour() === 'quit') {
      options.onQuitRequested();
      return;
    }
    if (window.isFullScreen()) window.setFullScreen(false);
    window.hide();
    options.onHiddenToTray();
  });
  return window;
}

export interface MiniWindowOptions extends WindowCommon {
  /** The display the main window is on, so the mini player appears next to it. */
  anchor: Rect | null;
  alwaysOnTop: boolean;
  onClosed(): void;
}

export function createMiniWindow(options: MiniWindowOptions): BrowserWindow {
  const display = options.anchor ? screen.getDisplayMatching(options.anchor) : screen.getPrimaryDisplay();
  const window = new BrowserWindow({
    ...miniBounds(display.workArea),
    minWidth: MINI_MIN_WIDTH,
    minHeight: MINI_MIN_HEIGHT,
    useContentSize: true,
    frame: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: options.alwaysOnTop,
    title: 'HomeStream mini player',
    icon: options.icon,
    backgroundColor: '#000000',
    show: false,
    webPreferences: webPreferences(options, true),
  });
  window.setAspectRatio(MINI_WIDTH / MINI_HEIGHT);
  // The aspect lock rounds against the invisible resize border; this puts the content back at exactly 480x270.
  window.setContentSize(MINI_WIDTH, MINI_HEIGHT);
  guardNavigation(window, options);
  window.once('ready-to-show', () => window.show());
  window.once('closed', options.onClosed);
  return window;
}

export function snapshotOf(window: BrowserWindow | null): WindowSnapshot {
  if (!window || window.isDestroyed()) {
    return {
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      maximized: false,
      fullscreen: false,
      visible: false,
      focused: false,
    };
  }
  return {
    bounds: window.getBounds(),
    maximized: window.isMaximized(),
    fullscreen: window.isFullScreen(),
    visible: window.isVisible(),
    focused: window.isFocused(),
  };
}
