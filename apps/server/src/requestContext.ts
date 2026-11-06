import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/** Header carrying the request id, in both directions. */
export const REQUEST_ID_HEADER = 'x-request-id';
const MAX_REQUEST_ID_LENGTH = 64;
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]+$/;

interface RequestScope {
  reqId: string;
}

const storage = new AsyncLocalStorage<RequestScope>();

/** The id of the request being handled, from anywhere in its async call chain (TMDB or gateway lookups, services). */
export function currentRequestId(): string | undefined {
  return storage.getStore()?.reqId;
}

export function runWithRequestId<T>(reqId: string, work: () => T): T {
  return storage.run({ reqId }, work);
}

/** A client-supplied id is kept only when it is short and made of plain characters; anything else gets a fresh UUID. */
export function resolveRequestId(supplied: string | string[] | undefined): string {
  const candidate = Array.isArray(supplied) ? supplied[0] : supplied;
  if (candidate && candidate.length <= MAX_REQUEST_ID_LENGTH && SAFE_REQUEST_ID.test(candidate)) return candidate;
  return randomUUID();
}

export function generateRequestId(request: IncomingMessage): string {
  return resolveRequestId(request.headers[REQUEST_ID_HEADER]);
}
