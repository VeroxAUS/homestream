import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { Handover } from '@homestream/shared';
import { CHANNELS, createHandlers, isTrustedUrl, registerIpc, type ChannelName, type ShellApi } from '../src/ipc.js';

const ORIGIN = 'http://127.0.0.1:8600';
const LOADING = 'file:///app/dist/assets/loading.html';

const handover: Handover = {
  sessionId: 's',
  playlistUrl: '/hls/s/index.m3u8',
  positionSec: 1,
  paused: false,
  volume: 1,
  muted: false,
  audioIndex: null,
  subtitle: null,
  title: 't',
  mediaKey: 'movie:1',
};

function fakeApi(): { [K in keyof ShellApi]: ReturnType<typeof vi.fn> } {
  const entries = [
    'getStartWithWindows',
    'setStartWithWindows',
    'restartServer',
    'quit',
    'getServerStatus',
    'retry',
    'openLogs',
    'openConfig',
    'getDesktopSettings',
    'setDesktopSetting',
    'reportPlaying',
    'openMiniPlayer',
    'returnToMain',
    'closeMiniPlayer',
    'setMiniAlwaysOnTop',
    'claimHandover',
    'getShellState',
  ] as const;
  return Object.fromEntries(entries.map((name) => [name, vi.fn(() => name)])) as never;
}

describe('the channel allow-list', () => {
  it('has one handler per bridge call and nothing generic', () => {
    expect(Object.keys(CHANNELS).sort()).toEqual(
      [
        'claimHandover',
        'closeMiniPlayer',
        'getDesktopSettings',
        'getServerStatus',
        'getShellState',
        'getStartWithWindows',
        'openConfig',
        'openLogs',
        'openMiniPlayer',
        'quit',
        'reportPlaying',
        'restartServer',
        'retry',
        'returnToMain',
        'setDesktopSetting',
        'setMiniAlwaysOnTop',
        'setStartWithWindows',
      ].sort(),
    );
    for (const channel of Object.values(CHANNELS)) expect(channel).toMatch(/^hs:[A-Za-z]+$/);
  });

  it('matches the table written out in the sandboxed preload', () => {
    const source = readFileSync(new URL('../src/preload.cts', import.meta.url), 'utf8');
    const table = [...source.matchAll(/^\s+(\w+): '(hs:\w+)',$/gm)].map(([, name, channel]) => [name, channel]);
    expect(Object.fromEntries(table)).toEqual(CHANNELS);
  });

  it('exposes exactly the twenty bridge keys', () => {
    const source = readFileSync(new URL('../src/preload.cts', import.meta.url), 'utf8');
    const body = source.slice(source.indexOf('const bridge'), source.indexOf('contextBridge.exposeInMainWorld'));
    const keys = [...body.matchAll(/^ {2}(\w+)(?::|\()/gm)].map(([, key]) => key);
    expect(keys).toEqual([
      'isDesktop',
      'isMiniPlayer',
      'version',
      'getStartWithWindows',
      'setStartWithWindows',
      'restartServer',
      'quit',
      'getServerStatus',
      'retry',
      'openLogs',
      'openConfig',
      'getDesktopSettings',
      'setDesktopSetting',
      'reportPlaying',
      'openMiniPlayer',
      'returnToMain',
      'closeMiniPlayer',
      'setMiniAlwaysOnTop',
      'onHandover',
      'getShellState',
    ]);
    expect(source).toContain("contextBridge.exposeInMainWorld('homestream', bridge)");
    expect(source).not.toMatch(/ipcRenderer\.(send|on|invoke)\([a-z]/);
  });
});

describe('handlers', () => {
  it('pass valid arguments to the shell', async () => {
    const api = fakeApi();
    const handlers = createHandlers(api as unknown as ShellApi);
    const sender = { id: 5, url: ORIGIN };
    await handlers.setStartWithWindows(sender, true);
    expect(api.setStartWithWindows).toHaveBeenCalledWith(true);
    await handlers.reportPlaying(sender, false);
    expect(api.reportPlaying).toHaveBeenCalledWith(5, false);
    await handlers.setDesktopSetting(sender, 'notifyReady', false);
    expect(api.setDesktopSetting).toHaveBeenCalledWith('notifyReady', false);
    await handlers.openMiniPlayer(sender, handover);
    expect(api.openMiniPlayer).toHaveBeenCalledWith(handover);
    await handlers.setMiniAlwaysOnTop(sender, true);
    expect(api.setMiniAlwaysOnTop).toHaveBeenCalledWith(true);
    await handlers.claimHandover(sender);
    expect(api.claimHandover).toHaveBeenCalledWith(5);
  });

  it('reject arguments of the wrong shape before the shell sees them', () => {
    const api = fakeApi();
    const handlers = createHandlers(api as unknown as ShellApi);
    const sender = { id: 1, url: ORIGIN };
    expect(() => handlers.setStartWithWindows(sender, 'yes')).toThrow();
    expect(() => handlers.reportPlaying(sender, 1)).toThrow();
    expect(() => handlers.setMiniAlwaysOnTop(sender, null)).toThrow();
    expect(() => handlers.openMiniPlayer(sender, { ...handover, mediaKey: '../../etc' })).toThrow();
    expect(() => handlers.openMiniPlayer(sender, { ...handover, positionSec: -4 })).toThrow();
    expect(() => handlers.returnToMain(sender, 'x')).toThrow();
    expect(api.setStartWithWindows).not.toHaveBeenCalled();
    expect(api.openMiniPlayer).not.toHaveBeenCalled();
    expect(api.returnToMain).not.toHaveBeenCalled();
  });

  it('leave key and value checks of settings to the settings store', () => {
    const api = fakeApi();
    const handlers = createHandlers(api as unknown as ShellApi);
    void handlers.setDesktopSetting({ id: 1, url: ORIGIN }, 'anything', { nested: true });
    expect(api.setDesktopSetting).toHaveBeenCalledWith('anything', { nested: true });
  });
});

describe('registerIpc', () => {
  function register(trusted: boolean) {
    const api = fakeApi();
    const registered = new Map<string, (event: never, ...args: unknown[]) => unknown>();
    registerIpc(
      { handle: (channel, listener) => registered.set(channel, listener as never) },
      createHandlers(api as unknown as ShellApi),
      () => trusted,
    );
    return { api, registered };
  }

  it('registers every channel and nothing else', () => {
    const { registered } = register(true);
    expect([...registered.keys()].sort()).toEqual(Object.values(CHANNELS).sort());
  });

  it('answers pages the shell loaded', () => {
    const { api, registered } = register(true);
    const call = registered.get(CHANNELS.getServerStatus as string);
    expect(call?.({ sender: { id: 1 }, senderFrame: { url: ORIGIN } } as never)).toBe('getServerStatus');
    expect(api.getServerStatus).toHaveBeenCalled();
  });

  it.each([null, { url: 'https://example.test/' }])('refuses any other page (%j)', (frame) => {
    const { api, registered } = register(false);
    for (const name of Object.keys(CHANNELS) as ChannelName[]) {
      const call = registered.get(CHANNELS[name]);
      expect(() => call?.({ sender: { id: 1 }, senderFrame: frame } as never)).toThrow('not allowed');
    }
    expect(api.quit).not.toHaveBeenCalled();
  });
});

describe('isTrustedUrl', () => {
  it('trusts the server origin and the bundled startup page only', () => {
    expect(isTrustedUrl(`${ORIGIN}/`, ORIGIN, LOADING)).toBe(true);
    expect(isTrustedUrl(`${ORIGIN}/settings?x=1`, ORIGIN, LOADING)).toBe(true);
    expect(isTrustedUrl(`${LOADING}?state=failed`, ORIGIN, LOADING)).toBe(true);
    expect(isTrustedUrl(LOADING, ORIGIN, LOADING)).toBe(true);
    expect(isTrustedUrl(`${LOADING}#x`, ORIGIN, LOADING)).toBe(true);
    expect(isTrustedUrl('http://127.0.0.1:86001/', ORIGIN, LOADING)).toBe(false);
    expect(isTrustedUrl(`${ORIGIN}.evil.test/`, ORIGIN, LOADING)).toBe(false);
    expect(isTrustedUrl('file:///other.html', ORIGIN, LOADING)).toBe(false);
    expect(isTrustedUrl('', ORIGIN, LOADING)).toBe(false);
  });
});
