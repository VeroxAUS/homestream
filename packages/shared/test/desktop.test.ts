import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DESKTOP_SETTINGS,
  DesktopSettingUpdateSchema,
  HandoverSchema,
  parseServerStatus,
  restartDelaySec,
} from '../src/desktop.js';

const HANDOVER = {
  sessionId: 'abc',
  playlistUrl: '/hls/abc/master.m3u8',
  positionSec: 61.5,
  paused: false,
  volume: 0.8,
  muted: false,
  audioIndex: 1,
  subtitle: { index: 2, mode: 'sidecar' },
  title: 'The Stub Matrix',
  mediaKey: 'movie:603',
};

describe('desktop settings', () => {
  it('defaults match the architecture', () => {
    expect(DEFAULT_DESKTOP_SETTINGS).toEqual({
      startMinimized: true,
      closeBehaviour: 'tray',
      notifyReady: true,
      notifyFailures: true,
      hardwareAcceleration: true,
      closeNoticeShown: false,
    });
  });

  it('accepts the five settable keys with the right value type', () => {
    expect(DesktopSettingUpdateSchema.safeParse({ key: 'closeBehaviour', value: 'quit' }).success).toBe(true);
    expect(DesktopSettingUpdateSchema.safeParse({ key: 'notifyReady', value: false }).success).toBe(true);
  });

  it('rejects unknown keys, the shell-owned key and wrong value types', () => {
    expect(DesktopSettingUpdateSchema.safeParse({ key: 'notAKey', value: 1 }).success).toBe(false);
    expect(DesktopSettingUpdateSchema.safeParse({ key: 'closeNoticeShown', value: true }).success).toBe(false);
    expect(DesktopSettingUpdateSchema.safeParse({ key: 'closeBehaviour', value: 'maybe' }).success).toBe(false);
    expect(DesktopSettingUpdateSchema.safeParse({ key: 'startMinimized', value: 'yes' }).success).toBe(false);
  });
});

describe('handover', () => {
  it('accepts a complete hand-over for a movie and an episode', () => {
    expect(HandoverSchema.safeParse(HANDOVER).success).toBe(true);
    expect(HandoverSchema.safeParse({ ...HANDOVER, mediaKey: 'tv:1396:1:2', subtitle: null }).success).toBe(true);
  });

  it('rejects a media key that is not a title and out-of-range numbers', () => {
    expect(HandoverSchema.safeParse({ ...HANDOVER, mediaKey: 'file:///etc' }).success).toBe(false);
    expect(HandoverSchema.safeParse({ ...HANDOVER, positionSec: -1 }).success).toBe(false);
    expect(HandoverSchema.safeParse({ ...HANDOVER, volume: 2 }).success).toBe(false);
  });
});

describe('server status', () => {
  it('reads the crashed line with its attempt', () => {
    expect(parseServerStatus('Server: crashed \u2014 restarting (2/5)')).toEqual({
      kind: 'crashed',
      attempt: 2,
      limit: 5,
    });
  });

  it('tells running, failed and everything else apart', () => {
    expect(parseServerStatus('Server: running (spawned, pid 12)')).toEqual({ kind: 'running' });
    expect(parseServerStatus('Server: attached to external server')).toEqual({ kind: 'running' });
    expect(parseServerStatus('Server: failed \u2014 see logs')).toEqual({ kind: 'failed' });
    expect(parseServerStatus('Server: starting')).toEqual({ kind: 'other' });
  });

  it('follows the 1 s, 2 s, 5 s restart schedule and stays at 5 s', () => {
    expect([1, 2, 3, 4, 5].map(restartDelaySec)).toEqual([1, 2, 5, 5, 5]);
    expect(restartDelaySec(0)).toBe(1);
  });
});
