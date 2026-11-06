import { randomUUID } from 'node:crypto';

/** Header every API call of the shell carries; the server echoes it and logs it as `reqId`. */
export const REQUEST_ID_HEADER = 'X-Request-ID';

export function newRequestId(): string {
  return randomUUID();
}

/** Headers for a call to the HomeStream server (`/api/info`, `/api/events`, shutdown): the caller's plus a request id. */
export function withRequestId(
  headers: Record<string, string> = {},
  id: string = newRequestId(),
): Record<string, string> {
  return { ...headers, [REQUEST_ID_HEADER]: id };
}
