import {
  CLOSE_BEHAVIOURS,
  DEFAULT_DESKTOP_SETTINGS,
  DesktopSettingUpdateSchema,
  type DesktopSettings,
} from '@homestream/shared';
import { nodeFileIo, readJson, writeJson, type FileIo } from './jsonFile.js';

const BOOLEAN_KEYS = [
  'startMinimized',
  'notifyReady',
  'notifyFailures',
  'hardwareAcceleration',
  'closeNoticeShown',
] as const;

/** Reads settings field by field: a missing or invalid field falls back to its default, the rest is kept. */
export function parseSettings(raw: unknown): DesktopSettings {
  const settings: DesktopSettings = { ...DEFAULT_DESKTOP_SETTINGS };
  if (typeof raw !== 'object' || raw === null) return settings;
  const record = raw as Record<string, unknown>;
  for (const key of BOOLEAN_KEYS) {
    const value = record[key];
    if (typeof value === 'boolean') settings[key] = value;
  }
  const close = record.closeBehaviour;
  if (CLOSE_BEHAVIOURS.some((candidate) => candidate === close)) {
    settings.closeBehaviour = close as DesktopSettings['closeBehaviour'];
  }
  return settings;
}

/** Synchronous read for start-up, before the `ready` event (hardware acceleration must be decided by then). */
export function readSettingsSync(file: string, io: FileIo = nodeFileIo): DesktopSettings {
  return parseSettings(readJson(file, io));
}

export type SettingsChange = (settings: DesktopSettings, key: keyof DesktopSettings) => void;

export class SettingsStore {
  private current: DesktopSettings;
  private readonly listeners = new Set<SettingsChange>();

  constructor(
    private readonly file: string,
    private readonly io: FileIo = nodeFileIo,
  ) {
    this.current = readSettingsSync(file, io);
  }

  get(): DesktopSettings {
    return { ...this.current };
  }

  onChange(listener: SettingsChange): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Applies one `setDesktopSetting` call. Unknown keys and wrong value types throw and change nothing. */
  update(key: unknown, value: unknown): DesktopSettings {
    const parsed = DesktopSettingUpdateSchema.safeParse({ key, value });
    if (!parsed.success) throw new Error('That setting does not exist or the value is not allowed.');
    return this.apply(parsed.data.key, parsed.data.value);
  }

  /** The one-time "HomeStream is still running" toast is remembered here; the web UI cannot set it. */
  markCloseNoticeShown(): void {
    this.apply('closeNoticeShown', true);
  }

  private apply<K extends keyof DesktopSettings>(key: K, value: DesktopSettings[K]): DesktopSettings {
    if (this.current[key] === value) return this.get();
    const next = { ...this.current, [key]: value };
    writeJson(this.file, next, this.io);
    this.current = next;
    for (const listener of this.listeners) listener(this.get(), key);
    return this.get();
  }
}
