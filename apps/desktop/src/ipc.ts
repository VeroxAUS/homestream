import {
  HandoverSchema,
  type DesktopSettings,
  type Handover,
  type RestartResult,
  type ShellState,
} from '@homestream/shared';

/** The complete allow-list: one named channel per bridge call. Nothing else is registered. */
export const CHANNELS = {
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

export type ChannelName = keyof typeof CHANNELS;

interface IpcSender {
  id: number;
  /** URL of the frame that sent the call. */
  url: string;
}

/** What the controller offers the pages. Arguments are already validated when these run. */
export interface ShellApi {
  getStartWithWindows(): boolean;
  setStartWithWindows(enabled: boolean): boolean;
  restartServer(): Promise<RestartResult>;
  quit(): void;
  getServerStatus(): string;
  retry(): Promise<void>;
  openLogs(): void;
  openConfig(): void;
  getDesktopSettings(): DesktopSettings;
  setDesktopSetting(key: unknown, value: unknown): DesktopSettings;
  reportPlaying(senderId: number, playing: boolean): void;
  openMiniPlayer(handover: Handover): boolean;
  returnToMain(handover: Handover): void;
  closeMiniPlayer(): void;
  setMiniAlwaysOnTop(onTop: boolean): boolean;
  claimHandover(senderId: number): Handover | null;
  getShellState(): ShellState;
}

export type IpcHandler = (sender: IpcSender, ...args: unknown[]) => unknown;

function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new TypeError('Expected true or false.');
  return value;
}

function handover(value: unknown): Handover {
  const result = HandoverSchema.safeParse(value);
  if (!result.success) throw new TypeError('That hand-over is not valid.');
  return result.data;
}

/** One validating handler per channel. A page can only reach what the shell exposes here. */
export function createHandlers(api: ShellApi): Record<ChannelName, IpcHandler> {
  return {
    getStartWithWindows: () => api.getStartWithWindows(),
    setStartWithWindows: (_s, enabled) => api.setStartWithWindows(bool(enabled)),
    restartServer: () => api.restartServer(),
    quit: () => api.quit(),
    getServerStatus: () => api.getServerStatus(),
    retry: () => api.retry(),
    openLogs: () => api.openLogs(),
    openConfig: () => api.openConfig(),
    getDesktopSettings: () => api.getDesktopSettings(),
    setDesktopSetting: (_s, key, value) => api.setDesktopSetting(key, value),
    reportPlaying: (sender, playing) => api.reportPlaying(sender.id, bool(playing)),
    openMiniPlayer: (_s, value) => api.openMiniPlayer(handover(value)),
    returnToMain: (_s, value) => api.returnToMain(handover(value)),
    closeMiniPlayer: () => api.closeMiniPlayer(),
    setMiniAlwaysOnTop: (_s, onTop) => api.setMiniAlwaysOnTop(bool(onTop)),
    claimHandover: (sender) => api.claimHandover(sender.id),
    getShellState: () => api.getShellState(),
  };
}

export interface IpcMainLike {
  handle(
    channel: string,
    listener: (event: { sender: { id: number }; senderFrame: { url: string } | null }, ...args: unknown[]) => unknown,
  ): void;
}

/** True for the pages the shell itself loads: the web UI on the server's loopback origin and its bundled startup page. */
export function isTrustedUrl(url: string, serverOrigin: string, loadingPageUrl: string): boolean {
  if (url === loadingPageUrl || url.startsWith(`${loadingPageUrl}#`) || url.startsWith(`${loadingPageUrl}?`))
    return true;
  return url === serverOrigin || url.startsWith(`${serverOrigin}/`);
}

/** Registers every channel; calls from any other page (a frame, another origin) are refused. */
export function registerIpc(
  ipc: IpcMainLike,
  handlers: Record<ChannelName, IpcHandler>,
  trusted: (url: string) => boolean,
): void {
  for (const name of Object.keys(CHANNELS) as ChannelName[]) {
    ipc.handle(CHANNELS[name], (event, ...args) => {
      const url = event.senderFrame?.url ?? '';
      if (!trusted(url)) throw new Error('This page is not allowed to control the app.');
      return handlers[name]({ id: event.sender.id, url }, ...args);
    });
  }
}
