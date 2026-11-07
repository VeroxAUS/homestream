import { describe, expect, it } from 'vitest';
import { DEFAULT_DESKTOP_SETTINGS } from '@homestream/shared';
import { loginItemArgs, parseCliFlags } from '../src/cli.js';
import type { FileIo } from '../src/jsonFile.js';
import { readJson, writeJson } from '../src/jsonFile.js';
import { SettingsStore, parseSettings, readSettingsSync } from '../src/settings.js';

function memoryIo(initial: Record<string, string> = {}): FileIo & { files: Record<string, string>; writes: number } {
  const state = { files: { ...initial }, writes: 0 };
  return {
    files: state.files,
    get writes() {
      return state.writes;
    },
    read: (file) => state.files[file] ?? null,
    writeAtomic(file, text) {
      state.files[file] = text;
      state.writes += 1;
    },
  };
}

describe('parseCliFlags / loginItemArgs', () => {
  it('reads --hidden and --quit and ignores the rest', () => {
    expect(parseCliFlags(['electron.exe', 'app', '--remote-debugging-port=8622'])).toEqual({
      hidden: false,
      quit: false,
    });
    expect(parseCliFlags(['x', '--hidden'])).toEqual({ hidden: true, quit: false });
    expect(parseCliFlags(['x', '--quit', '--hidden'])).toEqual({ hidden: true, quit: true });
  });

  it('puts --hidden in the Run entry only while Start minimised is on', () => {
    expect(loginItemArgs(true)).toEqual(['--hidden']);
    expect(loginItemArgs(false)).toEqual([]);
  });
});

describe('json files', () => {
  it('reads null for a missing or damaged file and round-trips valid JSON', () => {
    const io = memoryIo({ 'broken.json': '{nope' });
    expect(readJson('missing.json', io)).toBeNull();
    expect(readJson('broken.json', io)).toBeNull();
    writeJson('ok.json', { a: 1 }, io);
    expect(readJson('ok.json', io)).toEqual({ a: 1 });
  });
});

describe('parseSettings', () => {
  it('uses the defaults for a missing, damaged or wrongly typed file', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_DESKTOP_SETTINGS);
    expect(parseSettings('x')).toEqual(DEFAULT_DESKTOP_SETTINGS);
    expect(parseSettings({ startMinimized: 'yes', closeBehaviour: 'explode', notifyReady: 1 })).toEqual(
      DEFAULT_DESKTOP_SETTINGS,
    );
  });

  it('keeps valid values and fills the rest with defaults', () => {
    expect(parseSettings({ closeBehaviour: 'quit', notifyReady: false, hardwareAcceleration: false })).toEqual({
      ...DEFAULT_DESKTOP_SETTINGS,
      closeBehaviour: 'quit',
      notifyReady: false,
      hardwareAcceleration: false,
    });
  });

  it('is read synchronously from the file', () => {
    const io = memoryIo({ 's.json': JSON.stringify({ startMinimized: false }) });
    expect(readSettingsSync('s.json', io).startMinimized).toBe(false);
  });
});

describe('SettingsStore', () => {
  it('writes a change atomically, tells listeners and survives a restart', () => {
    const io = memoryIo();
    const store = new SettingsStore('s.json', io);
    const seen: string[] = [];
    store.onChange((_settings, key) => seen.push(key));
    expect(store.update('notifyFailures', false).notifyFailures).toBe(false);
    expect(store.update('closeBehaviour', 'quit').closeBehaviour).toBe('quit');
    expect(seen).toEqual(['notifyFailures', 'closeBehaviour']);
    const reopened = new SettingsStore('s.json', io);
    expect(reopened.get()).toMatchObject({ notifyFailures: false, closeBehaviour: 'quit' });
  });

  it('does not write when nothing changes', () => {
    const io = memoryIo();
    const store = new SettingsStore('s.json', io);
    store.update('notifyReady', true);
    expect(io.writes).toBe(0);
  });

  it.each([
    ['unknown key', 'closeNoticeShown', true],
    ['not a key', 'nope', true],
    ['wrong type', 'notifyReady', 'yes'],
    ['bad enum', 'closeBehaviour', 'dialog'],
  ])('rejects %s and changes nothing', (_name, key, value) => {
    const io = memoryIo();
    const store = new SettingsStore('s.json', io);
    expect(() => store.update(key, value)).toThrow();
    expect(store.get()).toEqual(DEFAULT_DESKTOP_SETTINGS);
    expect(io.writes).toBe(0);
  });

  it('remembers the one-time close notice, which the page cannot set', () => {
    const io = memoryIo();
    const store = new SettingsStore('s.json', io);
    store.markCloseNoticeShown();
    expect(new SettingsStore('s.json', io).get().closeNoticeShown).toBe(true);
  });

  it('hands out copies', () => {
    const store = new SettingsStore('s.json', memoryIo());
    store.get().notifyReady = false;
    expect(store.get().notifyReady).toBe(true);
  });
});
