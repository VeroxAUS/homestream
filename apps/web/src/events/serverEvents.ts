import {
  DownloadEventSchema,
  DownloadProgressEventSchema,
  HealthResponseSchema,
  type DownloadEvent,
} from '@homestream/shared';
import type { QueryClient } from '@tanstack/react-query';
import { afterHomeContent, whenIdle } from '../lib/startup';
import { logger } from '../logger';
import { clearDownloadProgress, downloadKey, setDownloadProgress } from './downloadProgress';

let source: EventSource | null = null;

function parse<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, raw: Event) {
  try {
    const result = schema.safeParse(JSON.parse((raw as MessageEvent<string>).data));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function finishDownload(queryClient: QueryClient, event: DownloadEvent): void {
  clearDownloadProgress(downloadKey(event.mediaType, event.tmdbId, event.season, event.episode));
  void queryClient.invalidateQueries({ queryKey: [event.mediaType === 'movie' ? 'movie' : 'show', event.tmdbId] });
}

/**
 * Opens the one shared `/api/events` stream. It only updates the cache: health snapshots while a dashboard is open, and
 * the progress of pending downloads. Nothing here polls, and a handler does no work beyond the affected entry.
 */
export function startServerEvents(queryClient: QueryClient): void {
  if (source || typeof EventSource === 'undefined') return;
  const stream = new EventSource('/api/events');
  source = stream;
  let failed = false;

  stream.addEventListener('health', (raw) => {
    if (!window.location.pathname.startsWith('/dashboard')) return;
    const health = parse(HealthResponseSchema, raw);
    if (health) queryClient.setQueryData(['health'], health);
  });
  stream.addEventListener('download.progress', (raw) => {
    const event = parse(DownloadProgressEventSchema, raw);
    if (event)
      setDownloadProgress(downloadKey(event.mediaType, event.tmdbId, event.season, event.episode), event.progress);
  });
  for (const type of ['download.ready', 'download.failed']) {
    stream.addEventListener(type, (raw) => {
      const event = parse(DownloadEventSchema, raw);
      if (event) finishDownload(queryClient, event);
    });
  }
  stream.onerror = () => {
    failed = true;
  };
  // After a dropped connection (a server restart) the cached snapshots may be out of date.
  stream.onopen = () => {
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
}
