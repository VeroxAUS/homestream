import { useSyncExternalStore } from 'react';

const DEFAULT_BANNER_INTERVAL_MS = 9000;
const listeners = new Set<() => void>();
let intervalMs = DEFAULT_BANNER_INTERVAL_MS;

/** Called by the telemetry chunk when the `banner-rotation-interval` experiment assigns this install a variant. */
export function setBannerIntervalMs(next: number): void {
  if (next === intervalMs) return;
  intervalMs = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Milliseconds between banner slides: 9 s unless an experiment says otherwise. */
export function useBannerIntervalMs(): number {
  return useSyncExternalStore(subscribe, () => intervalMs);
}
