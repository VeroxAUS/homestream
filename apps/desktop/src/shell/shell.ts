import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  app,
  ipcMain,
  powerSaveBlocker,
  session,
  shell,
  type BrowserWindow,
  type LoginItemSettingsOptions,
} from 'electron';
import type { DesktopSettings, Handover, RestartResult, ShellState } from '@homestream/shared';
import { loginItemArgs, type CliFlags } from '../cli.js';
import { prepareConfigFile } from '../envFile.js';
import { createHandlers, isTrustedUrl, registerIpc, type ShellApi } from '../ipc.js';
import { KeepAwake } from '../keepAwake.js';
import { loadingPageUrl, loadingViewFor, nextPage, type PageKind } from '../loadingPage.js';
import { MiniPlayerState } from '../miniPlayer.js';
import {
  planCloseNotice,
  planDownloadFailureToast,
  planReadyToast,
  planSessionFailureToast,
  routeForMediaKey,
  type NotifyContext,
  type ToastSpec,
} from '../notifications.js';
import type { ServerClient } from '../serverHttp.js';
import { ServerMonitor, type MonitorEvents } from '../monitor.js';
import type { SettingsStore } from '../settings.js';
import type { Supervisor, SupervisorStatus } from '../supervisor.js';
import {
  menuForState,
  summarizeHealth,
  trayView,
  type HealthSummary,
  type TrayAction,
  type TrayView,
} from '../trayModel.js';
import { installAppMenu } from './appMenu.js';
import type { MainTelemetry } from './telemetry.js';
import { ToastCenter } from './toasts.js';
import { TrayAdapter } from './trayAdapter.js';
import { createMainWindow, createMiniWindow, snapshotOf, type WindowCommon } from './windows.js';

/** The Windows AppUserModelId: also the name of the Run entry and the id that toasts are shown under. */
const APP_USER_MODEL_ID = 'HomeStream';
const HEALTH_ROUTE = '/dashboard/health';

interface ShellPaths {
  assets: string;
  preload: string;
  loadingHtml: string;
  dataDir: string;
  envFile: string;
  windowStateFile: string;
}

export interface ShellDeps {
  version: string;
  port: number;
  flags: CliFlags;
  paths: ShellPaths;
  settings: SettingsStore;
  supervisor: Supervisor;
  client: ServerClient;
  telemetry: MainTelemetry;
}

export class Shell {
  private main: BrowserWindow | null = null;
  private mini: BrowserWindow | null = null;
  private page: PageKind = 'none';
  private pendingRoute: string | null = null;
  private health: HealthSummary | null = null;
  private sessions = 0;
  private quitting: Promise<void> | null = null;
  private tray: TrayAdapter | null = null;
  private view: TrayView | null = null;
  private readonly miniState = new MiniPlayerState();
  private readonly playingSenders = new Set<number>();
  private readonly toasts = new ToastCenter();
  private readonly loadingPage: string;
  private readonly common: WindowCommon;
  private readonly keepAwake = new KeepAwake({
    start: (type) => powerSaveBlocker.start(type),
    stop: (id) => powerSaveBlocker.stop(id),
  });
  private readonly monitor: ServerMonitor;

  constructor(private readonly deps: ShellDeps) {
    this.loadingPage = pathToFileURL(deps.paths.loadingHtml).href;
    this.common = {
      preload: deps.paths.preload,
      icon: path.join(deps.paths.assets, 'app.png'),
      version: deps.version,
      logger: deps.telemetry.logger,
      isAllowedUrl: (url) => this.isAllowedUrl(url),
    };
    const events: MonitorEvents = {
      onHealth: (health) => {
        this.health = summarizeHealth(health);
        this.refreshTray();
      },
      onSessions: (count) => {
        this.sessions = count;
        this.keepAwake.setSessions(count);
        this.refreshTray();
      },
      onSessionError: (failed) => this.notify(planSessionFailureToast(failed, this.notifyContext())),
      onDownloadReady: (event) => this.notify(planReadyToast(event, this.notifyContext())),
      onDownloadFailed: (event) => this.notify(planDownloadFailureToast(event, this.notifyContext())),
    };
    this.monitor = new ServerMonitor(deps.client, events, deps.telemetry.logger);
  }

  /** Builds the tray, wires the pages and the server, and opens the window unless the app starts hidden. */
  async start(): Promise<void> {
    const { supervisor, flags } = this.deps;
    app.setAppUserModelId(APP_USER_MODEL_ID);
    installAppMenu();
    this.guardSession();
    registerIpc(ipcMain, createHandlers(this.api()), (url) =>
      isTrustedUrl(url, this.deps.client.origin, this.loadingPage),
    );
    this.view = this.currentView();
    this.tray = new TrayAdapter(this.deps.paths.assets, { onAction: (action) => this.onTray(action) }, this.view);
    supervisor.onChange((status) => this.onServerStatus(status));
    this.deps.settings.onChange((settings, key) => this.onSettingChanged(key, settings));
    if (!flags.hidden) this.showMain();
    await supervisor.start();
  }

  /** The main window, from the tray, a second launch, a toast or the details of a title. */
  showMain(route?: string): void {
    const window = this.ensureMain();
    if (route) this.navigate(route);
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  /** Stops the server this app started (gracefully), closes the windows and exits. */
  quit(): Promise<void> {
    this.quitting ??= this.shutDown();
    return this.quitting;
  }

  get isQuitting(): boolean {
    return this.quitting !== null;
  }

  private async shutDown(): Promise<void> {
    const { logger } = this.deps.telemetry;
    logger.info('quitting');
    this.monitor.stop();
    this.keepAwake.release();
    this.mini?.destroy();
    await this.deps.supervisor.stop();
    this.tray?.destroy();
    await this.deps.telemetry.flush();
    this.main?.destroy();
    app.exit(0);
  }

  private isAllowedUrl(url: string): boolean {
    return isTrustedUrl(url, this.deps.client.origin, this.loadingPage);
  }

  /** Only fullscreen is granted; the web UI needs nothing else from the machine. */
  private guardSession(): void {
    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) =>
      callback(permission === 'fullscreen'),
    );
    session.defaultSession.setPermissionCheckHandler((_contents, permission) => permission === 'fullscreen');
  }

  private ensureMain(): BrowserWindow {
    if (this.main && !this.main.isDestroyed()) return this.main;
    const window = createMainWindow({
      ...this.common,
      stateFile: this.deps.paths.windowStateFile,
      isQuitting: () => this.isQuitting,
      closeBehaviour: () => this.deps.settings.get().closeBehaviour,
      onHiddenToTray: () => this.onHiddenToTray(),
      onQuitRequested: () => void this.quit(),
    });
    this.main = window;
    this.page = 'none';
    window.on('closed', () => {
      if (this.main === window) this.main = null;
    });
    this.watchPlayback(window);
    this.syncPage();
    return window;
  }

  private watchPlayback(window: BrowserWindow): void {
    const id = window.webContents.id;
    window.webContents.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) this.setLocalPlaying(id, false);
    });
    window.on('closed', () => this.setLocalPlaying(id, false));
  }

  private setLocalPlaying(senderId: number, playing: boolean): void {
    if (playing) this.playingSenders.add(senderId);
    else this.playingSenders.delete(senderId);
    this.keepAwake.setLocalPlaying(this.playingSenders.size > 0);
  }

  /** Shows the Starting or Failed page, or the app, whichever the server state calls for. */
  private syncPage(): void {
    const window = this.main;
    if (!window || window.isDestroyed()) return;
    const { supervisor } = this.deps;
    const next = nextPage(this.page, supervisor.status);
    if (next === this.page) return;
    this.page = next;
    if (next === 'app') {
      const route = this.pendingRoute ?? '/';
      this.pendingRoute = null;
      void window.loadURL(`${this.deps.client.origin}${route}`);
      // The startup page must not be reachable with Alt+Left.
      window.webContents.once('did-finish-load', () => window.webContents.navigationHistory.clear());
      return;
    }
    const view = loadingViewFor(supervisor.status, this.deps.version, this.deps.port);
    void window.loadURL(loadingPageUrl(this.loadingPage, view));
  }

  private navigate(route: string): void {
    const window = this.main;
    if (!window || window.isDestroyed()) return;
    if (this.page === 'app') void window.loadURL(`${this.deps.client.origin}${route}`);
    else this.pendingRoute = route;
  }

  private onServerStatus(status: SupervisorStatus): void {
    const { logger } = this.deps.telemetry;
    logger.info('server status', { status: status.kind });
    if (status.kind === 'running' || status.kind === 'attached') this.monitor.start();
    else this.monitor.stop();
    this.syncPage();
    this.refreshTray();
  }

  private onHiddenToTray(): void {
    const spec = planCloseNotice(this.deps.settings.get());
    if (spec && this.toasts.show(spec, () => undefined)) this.deps.settings.markCloseNoticeShown();
  }

  private notifyContext(): NotifyContext {
    const focused = [this.main, this.mini].some((window) => window && !window.isDestroyed() && window.isFocused());
    return { settings: this.deps.settings.get(), windowFocused: focused };
  }

  private notify(spec: ToastSpec | null): void {
    if (!spec) return;
    this.toasts.show(spec, (shown) => {
      if (shown.route) this.showMain(shown.route);
    });
  }

  private currentView(): TrayView {
    return trayView({
      status: this.deps.supervisor.status,
      health: this.health,
      sessions: this.sessions,
      startWithWindows: this.startWithWindows(),
    });
  }

  private refreshTray(): void {
    this.view = this.currentView();
    this.tray?.update(this.view);
  }

  private onTray(action: TrayAction): void {
    switch (action) {
      case 'open':
        return this.showMain();
      case 'health':
        return this.showMain(HEALTH_ROUTE);
      case 'logs':
        return this.openLogs();
      case 'startWithWindows':
        this.setStartWithWindows(!this.startWithWindows());
        return;
      case 'restart':
        void this.restartOrStart();
        return;
      case 'quit':
        void this.quit();
    }
  }

  private async restartOrStart(): Promise<RestartResult> {
    const { supervisor } = this.deps;
    const kind = supervisor.status.kind;
    if (kind === 'lost') {
      await supervisor.startServer();
      return { ok: true };
    }
    if (kind === 'crashed' || kind === 'failed' || kind === 'stopped') {
      await supervisor.retry();
      return { ok: true };
    }
    return supervisor.restart();
  }

  private loginItem(
    startMinimized = this.deps.settings.get().startMinimized,
  ): LoginItemSettingsOptions & { name: string } {
    // From the source tree the Run entry has to name the app folder, or Windows would start a bare Electron.
    const entry = app.isPackaged ? [] : [app.getAppPath()];
    return { name: APP_USER_MODEL_ID, path: process.execPath, args: [...entry, ...loginItemArgs(startMinimized)] };
  }

  private startWithWindows(): boolean {
    return app.getLoginItemSettings(this.loginItem()).openAtLogin;
  }

  private setStartWithWindows(enabled: boolean): boolean {
    app.setLoginItemSettings({ ...this.loginItem(), openAtLogin: enabled });
    this.refreshTray();
    return this.startWithWindows();
  }

  private onSettingChanged(key: keyof DesktopSettings, settings: DesktopSettings): void {
    // The Run entry carries `--hidden` only while "Start minimised" is on, so it is rewritten when that changes.
    if (key !== 'startMinimized') return;
    const before = this.loginItem(!settings.startMinimized);
    if (!app.getLoginItemSettings(before).openAtLogin) return;
    app.setLoginItemSettings({ ...before, openAtLogin: false });
    this.setStartWithWindows(true);
  }

  private openLogs(): void {
    void shell.openPath(this.deps.paths.dataDir);
  }

  private openConfig(): void {
    const file = this.deps.paths.envFile;
    try {
      if (!prepareConfigFile(file)) return;
    } catch (error) {
      this.deps.telemetry.logger.warn('could not prepare the config file', {
        error: error instanceof Error ? error : String(error),
      });
      return;
    }
    if (process.platform === 'win32') {
      spawn('notepad.exe', [file], { detached: true, stdio: 'ignore' })
        .on('error', () => undefined)
        .unref();
    } else {
      void shell.openPath(file);
    }
  }

  private api(): ShellApi {
    const { supervisor, settings } = this.deps;
    return {
      getStartWithWindows: () => this.startWithWindows(),
      setStartWithWindows: (enabled) => this.setStartWithWindows(enabled),
      restartServer: () => this.restartOrStart(),
      quit: () => void this.quit(),
      getServerStatus: () => supervisor.text,
      retry: () => supervisor.retry(),
      openLogs: () => this.openLogs(),
      openConfig: () => this.openConfig(),
      getDesktopSettings: () => settings.get(),
      setDesktopSetting: (key, value) => settings.update(key, value),
      reportPlaying: (senderId, playing) => this.setLocalPlaying(senderId, playing),
      openMiniPlayer: (handover) => this.openMiniPlayer(handover),
      returnToMain: (handover) => this.returnToMain(handover),
      closeMiniPlayer: () => this.closeMiniPlayer(),
      setMiniAlwaysOnTop: (onTop) => this.setMiniAlwaysOnTop(onTop),
      claimHandover: () => this.miniState.claim(),
      getShellState: () => this.shellState(),
    };
  }

  private openMiniPlayer(handover: Handover): boolean {
    const opened = this.miniState.open(handover);
    if (!opened) return false;
    const anchor = this.main && !this.main.isDestroyed() ? this.main.getBounds() : null;
    const window = createMiniWindow({
      ...this.common,
      anchor,
      alwaysOnTop: this.miniState.alwaysOnTop,
      onClosed: () => this.onMiniClosed(window),
    });
    this.mini = window;
    this.watchPlayback(window);
    void window.loadURL(`${this.deps.client.origin}${opened.route}`);
    this.main?.hide();
    return true;
  }

  private returnToMain(handover: Handover): void {
    const back = this.miniState.giveBack(handover);
    if (!back) return;
    this.discardMini();
    this.showMain(back.route);
  }

  private closeMiniPlayer(): void {
    const mediaKey = this.miniState.close();
    this.discardMini();
    this.showMain((mediaKey && routeForMediaKey(mediaKey)) || undefined);
  }

  /** The mini window was closed by other means (the taskbar, Alt+F4): same as its Close button. */
  private onMiniClosed(window: BrowserWindow): void {
    if (this.mini !== window) return;
    this.mini = null;
    if (this.miniState.phase === 'open') this.closeMiniPlayer();
  }

  private discardMini(): void {
    const window = this.mini;
    this.mini = null;
    if (window && !window.isDestroyed()) window.destroy();
  }

  private setMiniAlwaysOnTop(onTop: boolean): boolean {
    const value = this.miniState.setAlwaysOnTop(onTop);
    if (this.mini && !this.mini.isDestroyed()) this.mini.setAlwaysOnTop(value);
    return value;
  }

  private shellState(): ShellState {
    const view = this.view ?? this.currentView();
    const mini = this.mini && !this.mini.isDestroyed() ? snapshotOf(this.mini) : null;
    return {
      tray: { state: view.state, tooltip: view.tooltip, menu: menuForState(view.items) },
      activeSessions: this.sessions,
      powerSaveBlocker: this.keepAwake.mode,
      hardwareAcceleration: app.isHardwareAccelerationEnabled(),
      window: snapshotOf(this.main),
      miniPlayer: mini ? { open: true, alwaysOnTop: this.miniState.alwaysOnTop, bounds: mini.bounds } : null,
    };
  }
}
