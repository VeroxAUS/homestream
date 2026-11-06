import type { MediaType } from '@homestream/shared';
import { useSyncExternalStore } from 'react';

const progressByKey = new Map<string, number>();
const listeners = new Set<() => void>();

/** One key for a movie or for one episode, shared by the details response and the `download.*` events. */
export function downloadKey(mediaType: MediaType, tmdbId: number, season?: number, episode?: number): string {
  return mediaType === 'movie' ? `movie:${tmdbId}` : `tv:${tmdbId}:${season ?? 0}:${episode ?? 0}`;
}

function emit(): void {
  for (const listener of listeners) listener();
}

export function setDownloadProgress(key: string, progress: number): void {
  if (progressByKey.get(key) === progress) return;
  progressByKey.set(key, progress);
  emit();
}

export function clearDownloadProgress(key: string): void {
  if (progressByKey.delete(key)) emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The latest progress (0..1) an event reported for this download, or `undefined` when none arrived yet. */
export function useDownloadProgress(key: string): number | undefined {
  return useSyncExternalStore(subscribe, () => progressByKey.get(key));
}
