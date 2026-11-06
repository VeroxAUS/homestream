import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOME_CONTENT_MARK } from '../lib/startup';
import { mockApi } from '../test/render';
import {
  deviceKind,
  describePlaybackProfile,
  getCapabilityProfile,
  getDeviceId,
  getDeviceName,
  registerDevice,
  registerDeviceWhenIdle,
  setDeviceName,
} from './identity';

describe('device identity', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete window.homestream;
  });

  it('keeps one random id in this browser', () => {
    const id = getDeviceId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(getDeviceId()).toBe(id);
    expect(localStorage.getItem('homestream.deviceId')).toBe(id);
  });

  it('keeps an id in memory when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const id = getDeviceId();
    expect(getDeviceId()).toBe(id);
    expect(getDeviceName()).toBe('Web browser');
    expect(setDeviceName('Kitchen')).toBe('Kitchen');
  });

  it('is a web device in a browser and a desktop device in the Electron shell', () => {
    expect(deviceKind()).toBe('web');
    expect(getDeviceName()).toBe('Web browser');
    window.homestream = { isDesktop: true };
    expect(deviceKind()).toBe('desktop');
    expect(getDeviceName()).toBe('HomeStream Desktop');
    window.homestream = { isDesktop: false };
    expect(deviceKind()).toBe('web');
  });

  it('stores a trimmed, limited name, and falls back to the default when emptied', () => {
    expect(setDeviceName('  Den  ')).toBe('Den');
    expect(getDeviceName()).toBe('Den');
    expect(setDeviceName('x'.repeat(300))).toHaveLength(128);
    expect(setDeviceName('   ')).toBe('Web browser');
    expect(localStorage.getItem('homestream.deviceName')).toBeNull();
  });

  it('describes H.264 only, SDR, 3840x2160, stereo', () => {
    setDeviceName('Den');
    expect(getCapabilityProfile()).toEqual({
      deviceId: getDeviceId(),
      deviceName: 'Den',
      kind: 'web',
      maxWidth: 3840,
      maxHeight: 2160,
      h264: true,
      hevc: false,
      hevcMain10: false,
      hdr10: false,
      maxAudioChannels: 2,
    });
    expect(describePlaybackProfile()).toBe('H.264 · SDR · up to 2160p · stereo');
    expect(describePlaybackProfile({ ...getCapabilityProfile(), h264: false, hdr10: true, maxAudioChannels: 6 })).toBe(
      'no H.264 · HDR10 · up to 2160p · 6 channel audio',
    );
  });

  it('registers the device with the server', async () => {
    const { calls } = mockApi({ 'POST /api/devices': { ok: true } });
    expect(await registerDevice()).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toMatchObject({ deviceId: getDeviceId(), kind: 'web', h264: true, hevc: false });
  });

  it('does not throw when the server cannot be reached', async () => {
    mockApi({ 'POST /api/devices': new TypeError('offline') });
    expect(await registerDevice()).toBe(false);
  });

  it('registers after the content mark and idle time', async () => {
    performance.clearMarks();
    const { calls } = mockApi({ 'POST /api/devices': { ok: true } });
    registerDeviceWhenIdle();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toHaveLength(0);
    performance.mark(HOME_CONTENT_MARK);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
  });
});
