import { z } from 'zod';
import { SessionStateSchema, SubtitleSelectionSchema } from './playback.js';

/** The switches the Settings page can change through the desktop bridge. `closeNoticeShown` belongs to the shell. */
export const DESKTOP_SETTING_KEYS = [
  'startMinimized',
  'closeBehaviour',
  'notifyReady',
  'notifyFailures',
  'hardwareAcceleration',
] as const;
export type DesktopSettingKey = (typeof DESKTOP_SETTING_KEYS)[number];

export const CLOSE_BEHAVIOURS = ['tray', 'quit'] as const;

export const DesktopSettingsSchema = z.object({
  startMinimized: z.boolean(),
  closeBehaviour: z.enum(CLOSE_BEHAVIOURS),
  notifyReady: z.boolean(),
  notifyFailures: z.boolean(),
  hardwareAcceleration: z.boolean(),
  closeNoticeShown: z.boolean(),
});
export type DesktopSettings = z.infer<typeof DesktopSettingsSchema>;

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  startMinimized: true,
  closeBehaviour: 'tray',
  notifyReady: true,
  notifyFailures: true,
  hardwareAcceleration: true,
  closeNoticeShown: false,
};

/** One `setDesktopSetting(key, value)` call; a key that is not on the list, or a value of the wrong type, is rejected. */
export const DesktopSettingUpdateSchema = z.discriminatedUnion('key', [
  z.object({ key: z.literal('startMinimized'), value: z.boolean() }),
  z.object({ key: z.literal('closeBehaviour'), value: z.enum(CLOSE_BEHAVIOURS) }),
  z.object({ key: z.literal('notifyReady'), value: z.boolean() }),
  z.object({ key: z.literal('notifyFailures'), value: z.boolean() }),
  z.object({ key: z.literal('hardwareAcceleration'), value: z.boolean() }),
]);
export type DesktopSettingUpdate = z.infer<typeof DesktopSettingUpdateSchema>;

/** What the main player hands to the mini player and back; the session itself keeps running on the server. */
export const HandoverSchema = z.object({
  sessionId: z.string().min(1).max(128),
  playlistUrl: z.string().min(1).max(2048),
  positionSec: z.number().min(0).max(1_000_000),
  paused: z.boolean(),
  volume: z.number().min(0).max(1),
  muted: z.boolean(),
  audioIndex: z.number().int().min(0).nullable(),
  subtitle: SubtitleSelectionSchema.nullable(),
  title: z.string().max(300),
  mediaKey: z.string().regex(/^(movie:\d{1,9}|tv:\d{1,9}:\d{1,4}:\d{1,4})$/),
});
export type Handover = z.infer<typeof HandoverSchema>;

/** The three fields of a session the shell reads from /api/activity and the session events. */
export const SessionLiteSchema = z.object({ sessionId: z.string(), state: SessionStateSchema, title: z.string() });
export const ActivityLiteSchema = z.object({ sessions: z.array(SessionLiteSchema) });
export type SessionLite = z.infer<typeof SessionLiteSchema>;

export const TRAY_STATES = ['ok', 'warn', 'error', 'stopped'] as const;
export type TrayState = (typeof TRAY_STATES)[number];

export const POWER_SAVE_MODES = ['none', 'prevent-app-suspension', 'prevent-display-sleep'] as const;
export type PowerSaveMode = (typeof POWER_SAVE_MODES)[number];

export interface TrayMenuEntry {
  label: string;
  enabled: boolean;
  checked?: boolean;
}

export interface WindowSnapshot {
  bounds: { x: number; y: number; width: number; height: number };
  maximized: boolean;
  fullscreen: boolean;
  visible: boolean;
  focused: boolean;
}

/** Read-only diagnostics for Settings and validators. */
export interface ShellState {
  tray: { state: TrayState; tooltip: string; menu: TrayMenuEntry[] };
  activeSessions: number;
  powerSaveBlocker: PowerSaveMode;
  hardwareAcceleration: boolean;
  window: WindowSnapshot;
  miniPlayer: null | { open: boolean; alwaysOnTop: boolean; bounds: WindowSnapshot['bounds'] };
}

export interface RestartResult {
  ok: boolean;
  /** Plain words for the user when `ok` is false, for example "Server is managed outside the app". */
  message?: string;
}

/** The restart limit and waits of the server supervisor, shared so the web banner can count down the same schedule. */
export const SERVER_RESTART_LIMIT = 5;
export const SERVER_RESTART_DELAYS_MS = [1000, 2000, 5000] as const;

export type ServerStatusView =
  { kind: 'running' } | { kind: 'crashed'; attempt: number; limit: number } | { kind: 'failed' } | { kind: 'other' };

const CRASHED = /^Server: crashed \u2014 restarting \((\d+)\/(\d+)\)$/;

/** Reads the status line `getServerStatus()` returns (the strings are fixed by the architecture). */
export function parseServerStatus(text: string): ServerStatusView {
  const crashed = CRASHED.exec(text);
  if (crashed) return { kind: 'crashed', attempt: Number(crashed[1]), limit: Number(crashed[2]) };
  if (text.startsWith('Server: failed')) return { kind: 'failed' };
  if (text.startsWith('Server: running') || text.startsWith('Server: attached')) return { kind: 'running' };
  return { kind: 'other' };
}

/** Seconds the supervisor waits before restart attempt `attempt` (1-based). */
export function restartDelaySec(attempt: number): number {
  const index = Math.min(Math.max(attempt, 1), SERVER_RESTART_DELAYS_MS.length) - 1;
  return (SERVER_RESTART_DELAYS_MS[index] ?? 1000) / 1000;
}

/** `window.homestream`, exactly as the preload exposes it. */
export interface HomestreamBridge {
  readonly isDesktop: true;
  readonly isMiniPlayer: boolean;
  readonly version: string;
  getStartWithWindows(): Promise<boolean>;
  setStartWithWindows(enabled: boolean): Promise<boolean>;
  restartServer(): Promise<RestartResult>;
  quit(): Promise<void>;
  getServerStatus(): Promise<string>;
  retry(): Promise<void>;
  openLogs(): Promise<void>;
  openConfig(): Promise<void>;
  getDesktopSettings(): Promise<DesktopSettings>;
  setDesktopSetting(key: string, value: unknown): Promise<DesktopSettings>;
  reportPlaying(playing: boolean): Promise<void>;
  openMiniPlayer(handover: Handover): Promise<boolean>;
  returnToMain(handover: Handover): Promise<void>;
  closeMiniPlayer(): Promise<void>;
  setMiniAlwaysOnTop(onTop: boolean): Promise<boolean>;
  onHandover(callback: (handover: Handover) => void): () => void;
  getShellState(): Promise<ShellState>;
}
