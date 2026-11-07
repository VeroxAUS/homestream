import { BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';

const ZOOM_STEP = 0.5;
const ZOOM_LIMIT = 5;

function withFocused(action: (window: BrowserWindow) => void): () => void {
  return () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window && !window.isDestroyed()) action(window);
  };
}

function zoom(delta: number): () => void {
  return withFocused(({ webContents }) => {
    const level = Math.max(-ZOOM_LIMIT, Math.min(ZOOM_LIMIT, webContents.getZoomLevel() + delta));
    webContents.setZoomLevel(level);
  });
}

/**
 * The application menu that carries the keyboard shortcuts of the shortcut sheet. It is never shown (the windows are
 * frameless and hide the menu bar); Electron still routes the accelerators to it. No global shortcuts are registered.
 */
export function installAppMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'View',
      submenu: [
        { label: 'Zoom in', accelerator: 'CommandOrControl+=', click: zoom(ZOOM_STEP) },
        { label: 'Zoom in (numpad)', accelerator: 'CommandOrControl+numadd', click: zoom(ZOOM_STEP), visible: false },
        { label: 'Zoom out', accelerator: 'CommandOrControl+-', click: zoom(-ZOOM_STEP) },
        { label: 'Zoom out (numpad)', accelerator: 'CommandOrControl+numsub', click: zoom(-ZOOM_STEP), visible: false },
        {
          label: 'Actual size',
          accelerator: 'CommandOrControl+0',
          click: withFocused(({ webContents }) => webContents.setZoomLevel(0)),
        },
        {
          label: 'Fullscreen window',
          accelerator: 'F11',
          click: withFocused((window) => window.setFullScreen(!window.isFullScreen())),
        },
      ],
    },
    {
      label: 'History',
      submenu: [
        {
          label: 'Back',
          accelerator: 'Alt+Left',
          click: withFocused(({ webContents }) => webContents.navigationHistory.goBack()),
        },
        {
          label: 'Forward',
          accelerator: 'Alt+Right',
          click: withFocused(({ webContents }) => webContents.navigationHistory.goForward()),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
