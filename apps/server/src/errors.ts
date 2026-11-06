import type { ErrorResponse, StartAttempt } from '@homestream/shared';
import type { ZodError } from 'zod';
import { redact } from './redact.js';

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly hint?: string,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** Every candidate of an automatic start failed. */
export class AllStreamsFailedError extends AppError {
  constructor(readonly attempts: StartAttempt[]) {
    super(
      502,
      'all_streams_failed',
      `None of the ${attempts.length === 1 ? 'one available stream' : `${attempts.length} best streams`} could be started.`,
      'Try again in a moment. If it keeps failing, check the TorBox account, ffmpeg and GPU tiles on the health dashboard.',
    );
    this.name = 'AllStreamsFailedError';
  }
}

export function errorBody(code: string, message: string, hint?: string, attempts?: StartAttempt[]): ErrorResponse {
  const error: ErrorResponse['error'] = { code, message: redact(message) };
  if (hint) error.hint = redact(hint);
  if (!attempts) return { error };
  error.attempts = attempts;
  return { error, attempts };
}

export function invalidRequest(error: ZodError): AppError {
  const issue = error.issues[0];
  const field = issue?.path.join('.') ?? '';
  const message = issue ? `${field ? `${field}: ` : ''}${issue.message}` : 'Invalid request.';
  return new AppError(400, 'invalid_request', message, 'Check the request body against the API documentation.');
}

const STATUS_CODES: Record<number, string> = {
  400: 'bad_request',
  404: 'not_found',
  405: 'method_not_allowed',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  429: 'too_many_requests',
};

export function codeForStatus(status: number): string {
  return STATUS_CODES[status] ?? (status >= 500 ? 'internal_error' : 'bad_request');
}
