import type { ErrorBody } from '@homestream/shared';
import { logger } from '../logger';

/** Header the server echoes and writes as `reqId` in its log, so one failing call can be followed across both sides. */
export const REQUEST_ID_HEADER = 'X-Request-ID';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly hint?: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function newRequestId(): string {
  return crypto.randomUUID();
}

async function toApiError(response: Response, requestId: string): Promise<ApiError> {
  let body: Partial<ErrorBody> | undefined;
  try {
    body = ((await response.json()) as { error?: Partial<ErrorBody> }).error;
  } catch {
    // not JSON: fall back to the status line
  }
  return new ApiError(
    response.status,
    body?.code ?? 'http_error',
    body?.message ?? `The server answered ${response.status}.`,
    body?.hint,
    requestId,
  );
}

/** `fetch` for the HomeStream API: adds an `X-Request-ID`, leaves a breadcrumb and throws `ApiError` for non-2xx. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const requestId = newRequestId();
  const headers = new Headers(init.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  const method = (init.method ?? 'GET').toUpperCase();
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch (error) {
    logger.warn('api', `${method} ${path} failed`, { requestId });
    throw error;
  }
  if (!response.ok) {
    logger.warn('api', `${method} ${path} -> ${response.status}`, { requestId });
    throw await toApiError(response, requestId);
  }
  logger.info('api', `${method} ${path} -> ${response.status}`, { requestId });
  return response;
}

/** GET a JSON document and validate it with a schema from `@homestream/shared`. */
export async function apiGet<T>(path: string, schema: { parse(value: unknown): T }, signal?: AbortSignal): Promise<T> {
  const response = await apiFetch(path, signal ? { signal } : {});
  return schema.parse(await response.json());
}
