import { contextBridge, ipcRenderer } from 'electron';
import type { Handover, HomestreamBridge } from '@homestream/shared';

// A sandboxed preload can only load Electron's own modules, so the channel names are written out here. A test keeps
// this table equal to CHANNELS in ipc.ts.
const CHANNEL = {
  getStartWithWindows: 'hs:getStartWithWindows',
  setStartWithWindows: 'hs:setStartWithWindows',
  restartServer: 'hs:restartServer',
  quit: 'hs:quit',
  getServerStatus: 'hs:getServerStatus',
  retry: 'hs:retry',
  openLogs: 'hs:openLogs',
  openConfig: 'hs:openConfig',
  getDesktopSettings: 'hs:getDesktopSettings',
  setDesktopSetting: 'hs:setDesktopSetting',
  reportPlaying: 'hs:reportPlaying',
  openMiniPlayer: 'hs:openMiniPlayer',
  returnToMain: 'hs:returnToMain',
  closeMiniPlayer: 'hs:closeMiniPlayer',
  setMiniAlwaysOnTop: 'hs:setMiniAlwaysOnTop',
  claimHandover: 'hs:claimHandover',
  getShellState: 'hs:getShellState',
} as const;

function argument(name: string): string | undefined {
  return process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const bridge: HomestreamBridge = {
  isDesktop: true,
  isMiniPlayer: process.argv.includes('--hs-mini'),
  version: argument('hs-version') ?? '0.0.0',
  getStartWithWindows: () => ipcRenderer.invoke(CHANNEL.getStartWithWindows),
  setStartWithWindows: (enabled) => ipcRenderer.invoke(CHANNEL.setStartWithWindows, enabled),
  restartServer: () => ipcRenderer.invoke(CHANNEL.restartServer),
  quit: () => ipcRenderer.invoke(CHANNEL.quit),
  getServerStatus: () => ipcRenderer.invoke(CHANNEL.getServerStatus),
  retry: () => ipcRenderer.invoke(CHANNEL.retry),
  openLogs: () => ipcRenderer.invoke(CHANNEL.openLogs),
  openConfig: () => ipcRenderer.invoke(CHANNEL.openConfig),
  getDesktopSettings: () => ipcRenderer.invoke(CHANNEL.getDesktopSettings),
  setDesktopSetting: (key, value) => ipcRenderer.invoke(CHANNEL.setDesktopSetting, key, value),
  reportPlaying: (playing) => ipcRenderer.invoke(CHANNEL.reportPlaying, playing),
  openMiniPlayer: (handover) => ipcRenderer.invoke(CHANNEL.openMiniPlayer, handover),
  returnToMain: (handover) => ipcRenderer.invoke(CHANNEL.returnToMain, handover),
  closeMiniPlayer: () => ipcRenderer.invoke(CHANNEL.closeMiniPlayer),
  setMiniAlwaysOnTop: (onTop) => ipcRenderer.invoke(CHANNEL.setMiniAlwaysOnTop, onTop),
  // The hand-over waits in the main process until the page that takes it over asks for it, so a page that loads late
  // still receives it.
  onHandover(callback) {
    let active = true;
    void ipcRenderer.invoke(CHANNEL.claimHandover).then((handover: Handover | null) => {
      if (active && handover) callback(handover);
    });
    return () => {
      active = false;
    };
  },
  getShellState: () => ipcRenderer.invoke(CHANNEL.getShellState),
};

contextBridge.exposeInMainWorld('homestream', bridge);
