import {
  DownloadEventSchema,
  DownloadProgressEventSchema,
  HealthResponseSchema,
  type DownloadEvent,
} from '@homestream/shared';
import type { QueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { afterHomeContent, whenIdle } from '../lib/startup';
import { logger } from '../logger';
import { clearDownloadProgress, downloadKey, setDownloadProgress } from './downloadProgress';

let source: EventSource | null = null;
let live = false;
const liveListeners = new Set<() => void>();

function setLive(value: boolean): void {
  if (live === value) return;
  live = value;
  for (const listener of liveListeners) listener();
}

function subscribeLive(listener: () => void): () => void {
  liveListeners.add(listener);
  return () => liveListeners.delete(listener);
}

/** While the stream is open the server pushes every health change, so the health query does not need to poll. */
export function useEventStreamLive(): boolean {
  return useSyncExternalStore(subscribeLive, () => live);
}

function parse<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, raw: Event) {
  try {
    const result = schema.safeParse(JSON.parse((raw as MessageEvent<string>).data));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export type DownloadOutcome = { type: 'ready'; event: DownloadEvent } | { type: 'failed'; event: DownloadEvent };

const outcomeListeners = new Set<(outcome: DownloadOutcome) => void>();

/** Called when a download turns ready or fails; the notices use it. Returns the unsubscribe function. */
export function onDownloadOutcome(listener: (outcome: DownloadOutcome) => void): () => void {
  outcomeListeners.add(listener);
  return () => outcomeListeners.delete(listener);
}

function finishDownload(queryClient: QueryClient, outcome: DownloadOutcome): void {
  const { event } = outcome;
  clearDownloadProgress(downloadKey(event.mediaType, event.tmdbId, event.season, event.episode));
  void queryClient.invalidateQueries({ queryKey: [event.mediaType === 'movie' ? 'movie' : 'show', event.tmdbId] });
  for (const listener of outcomeListeners) listener(outcome);
}

/**
 * Opens the one shared `/api/events` stream. It only updates the cache: health snapshots and the progress of pending
 * downloads. Nothing here polls, and a handler does no work beyond the affected entry.
 */
export function startServerEvents(queryClient: QueryClient): void {
  if (source || typeof EventSource === 'undefined') return;
  const stream = new EventSource('/api/events');
  source = stream;
  let failed = false;

  stream.addEventListener('health', (raw) => {
    const health = parse(HealthResponseSchema, raw);
    if (health) queryClient.setQueryData(['health'], health);
  });
  stream.addEventListener('download.progress', (raw) => {
    const event = parse(DownloadProgressEventSchema, raw);
    if (event)
      setDownloadProgress(downloadKey(event.mediaType, event.tmdbId, event.season, event.episode), event.progress);
  });
  stream.addEventListener('download.ready', (raw) => {
    const event = parse(DownloadEventSchema, raw);
    if (event) finishDownload(queryClient, { type: 'ready', event });
  });
  stream.addEventListener('download.failed', (raw) => {
    const event = parse(DownloadEventSchema, raw);
    if (event) finishDownload(queryClient, { type: 'failed', event });
  });
  stream.onerror = () => {
    failed = true;
    if (!live) return;
    setLive(false);
    // The pill polls again from now on; this refetch makes it notice a server that is gone.
    void queryClient.invalidateQueries({ queryKey: ['health'] });
  };
  // After a dropped connection (a server restart) the cached snapshots may be out of date.
  stream.onopen = () => {
    setLive(true);
    if (!failed) return;
    failed = false;
    logger.info('events', 'event stream reconnected');
    void queryClient.invalidateQueries();
  };
}

/** Off the critical path: the stream opens once content is shown and the browser is idle. */
export function startServerEventsWhenIdle(queryClient: QueryClient): void {
  void afterHomeContent()
    .then(whenIdle)
    .then(() => startServerEvents(queryClient));
}

/** Closes the stream; tests use it to start from a clean state. */
export function stopServerEvents(): void {
  source?.close();
  source = null;
  setLive(false);
}
