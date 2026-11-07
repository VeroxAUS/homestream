import type { CapabilityProfile, DeviceKind } from '@homestream/shared';
import { apiFetch } from '../api/client';
import { afterHomeContent, whenIdle } from '../lib/startup';
import { randomUuid } from '../lib/uuid';
import { logger } from '../logger';

const ID_KEY = 'homestream.deviceId';
const NAME_KEY = 'homestream.deviceName';
const MAX_NAME_LENGTH = 128;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // blocked storage: the value lasts until the page closes
  }
}

/** `desktop` inside the Electron shell (its preload sets `window.homestream`), `web` in any browser. */
export function deviceKind(): DeviceKind {
  return window.homestream?.isDesktop ? 'desktop' : 'web';
}

function defaultDeviceName(): string {
  return deviceKind() === 'desktop' ? 'HomeStream Desktop' : 'Web browser';
}

/** A random id kept in this browser; storage that is blocked gives an id that lasts for the page only. */
let memoryId: string | undefined;
export function getDeviceId(): string {
  const saved = read(ID_KEY);
  if (saved) return saved;
  const id = memoryId ?? randomUuid();
  memoryId = id;
  write(ID_KEY, id);
  return id;
}

export function getDeviceName(): string {
  return read(NAME_KEY)?.trim() || defaultDeviceName();
}

/** Saves the name locally; returns what was stored (trimmed, limited, or the default for an empty name). */
export function setDeviceName(name: string): string {
  const clean = name.trim().slice(0, MAX_NAME_LENGTH);
  write(NAME_KEY, clean || null);
  return clean || defaultDeviceName();
}

/** What the browser can play: H.264 only, SDR, up to 4K, stereo. The server encodes everything else down to this. */
export function getCapabilityProfile(): CapabilityProfile {
  return {
    deviceId: getDeviceId(),
    deviceName: getDeviceName(),
    kind: deviceKind(),
    maxWidth: 3840,
    maxHeight: 2160,
    h264: true,
    hevc: false,
    hevcMain10: false,
    hdr10: false,
    maxAudioChannels: 2,
  };
}

/** Tells the server who is connected. Never throws: the UI works without it. Returns whether the server took it. */
export async function registerDevice(): Promise<boolean> {
  try {
    await apiFetch('/api/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(getCapabilityProfile()),
    });
    return true;
  } catch {
    logger.warn('device', 'could not register this device');
    return false;
  }
}

/** Registers once the first screen is up and the browser is idle, so it never competes with the first paint. */
export function registerDeviceWhenIdle(): void {
  void afterHomeContent().then(whenIdle).then(registerDevice);
}

/** "H.264 · SDR · up to 2160p · stereo": the profile above in words. */
export function describePlaybackProfile(profile: CapabilityProfile = getCapabilityProfile()): string {
  return [
    profile.h264 ? 'H.264' : 'no H.264',
    profile.hdr10 ? 'HDR10' : 'SDR',
    `up to ${profile.maxHeight}p`,
    profile.maxAudioChannels > 2 ? `${profile.maxAudioChannels} channel audio` : 'stereo',
  ].join(' · ');
}
