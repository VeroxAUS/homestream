import {
  DownloadStartedResponseSchema,
  SessionResponseSchema,
  type Download,
  type PingState,
  type SessionPatchRequest,
  type SessionResponse,
  type SessionStartRequest,
} from '@homestream/shared';
import { apiFetch } from '../api/client';
import { getCapabilityProfile } from '../device/identity';
import { logger } from '../logger';
import type { PlayTarget } from './target';

export type StartResult = { kind: 'session'; session: SessionResponse } | { kind: 'downloading'; download: Download };

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function titleFields(target: PlayTarget) {
  return {
    mediaType: target.mediaType,
    tmdbId: target.tmdbId,
    ...(target.season !== undefined ? { season: target.season } : {}),
    ...(target.episode !== undefined ? { episode: target.episode } : {}),
  };
}

/**
 * Starts playback. `streamId` is always "auto" and the body has no `subtitle` key, so the server picks the stream and
 * applies its default-subtitle rule. HTTP 202 means the title is being cached on TorBox instead.
 */
export async function startSession(target: PlayTarget, startPositionSec: number | undefined): Promise<StartResult> {
  const body: SessionStartRequest = {
    ...titleFields(target),
    streamId: 'auto',
    device: getCapabilityProfile(),
    ...(startPositionSec !== undefined ? { startPositionSec } : {}),
  };
  const response = await apiFetch('/api/sessions', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  const json: unknown = await response.json();
  if (response.status === 202) {
    return { kind: 'downloading', download: DownloadStartedResponseSchema.parse(json).download };
  }
  return { kind: 'session', session: SessionResponseSchema.parse(json) };
}

/** Audio or burn-in change: the server restarts only its encoder, so the playlist URL stays the same. */
export async function patchSession(sessionId: string, body: SessionPatchRequest): Promise<SessionResponse> {
  const response = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  return SessionResponseSchema.parse(await response.json());
}

export async function fetchSession(sessionId: string, signal?: AbortSignal): Promise<SessionResponse> {
  const response = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}`, signal ? { signal } : {});
  return SessionResponseSchema.parse(await response.json());
}

/** Ends the session on the server. No body and no content type; errors are logged, never thrown. */
export async function stopSession(sessionId: string, keepalive = false): Promise<void> {
  try {
    await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE', keepalive });
  } catch {
    logger.warn('player', 'could not stop the session');
  }
}

/** The server stops an encoder within 3 s; a little more covers the round trip. */
const STOP_WAIT_MS = 4000;

/**
 * Resolves when `stopping` has finished or after `STOP_WAIT_MS`, whichever comes first. A replacement session is only
 * accepted once the old one has left its slot, so callers wait here instead of racing the old DELETE.
 */
export async function waitForStop(stopping: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, STOP_WAIT_MS);
  });
  try {
    await Promise.race([stopping.catch(() => undefined), limit]);
  } finally {
    clearTimeout(timer);
  }
}

export async function sendProgress(sessionId: string, positionSec: number, state: PingState): Promise<void> {
  try {
    await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/progress`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ positionSec, state }),
    });
  } catch {
    // a missed ping is covered by the next one
  }
}

/** The last ping while the page unloads; `fetch` is not reliable there, `sendBeacon` is. */
export function beaconProgress(sessionId: string, positionSec: number, state: PingState): boolean {
  if (typeof navigator.sendBeacon !== 'function') return false;
  const body = new Blob([JSON.stringify({ positionSec, state })], { type: 'application/json' });
  return navigator.sendBeacon(`/api/sessions/${encodeURIComponent(sessionId)}/progress`, body);
}

const PREFETCH_DEDUPE_MS = 1000;
/** When each title was last sent. Per title, so A, B, A within the window still sends A once (a gateway call each). */
const recentPrefetches = new Map<string, number>();

/**
 * Warms the stream `Play` would pick, so playback reaches the first segment fast. Fire and forget: errors are ignored,
 * and the same title asked twice within a second (re-render, double click, A, B, A) is sent once.
 */
export function prefetchTitle(target: PlayTarget): void {
  const key = `${target.mediaType}:${target.tmdbId}:${target.season ?? ''}:${target.episode ?? ''}`;
  const now = Date.now();
  for (const [other, at] of recentPrefetches) {
    if (now - at >= PREFETCH_DEDUPE_MS) recentPrefetches.delete(other);
  }
  if (recentPrefetches.has(key)) return;
  recentPrefetches.set(key, now);
  void apiFetch('/api/prefetch', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ ...titleFields(target), device: getCapabilityProfile() }),
  }).catch(() => undefined);
}

/** Clears the dedupe memory; tests start from a clean state. */
export function resetPrefetchMemory(): void {
  recentPrefetches.clear();
}
