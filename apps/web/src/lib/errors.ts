import { ApiError } from '../api/client';

export interface ErrorDescription {
  message: string;
  hint?: string;
  /** The request never got an answer, so the server itself may be down. */
  unreachable: boolean;
}

/** Turns anything a request can throw into plain English for the user. */
export function describeError(error: unknown): ErrorDescription {
  if (error instanceof ApiError) {
    return { message: error.message, ...(error.hint ? { hint: error.hint } : {}), unreachable: false };
  }
  if (error instanceof TypeError || (error instanceof DOMException && error.name === 'TimeoutError')) {
    return {
      message: 'Cannot reach the HomeStream server.',
      hint: 'Check that the HomeStream server is running on the PC, then try again.',
      unreachable: true,
    };
  }
  return {
    message: 'The server answered with something this page cannot read.',
    hint: 'Update the HomeStream app and the server to the same version, then try again.',
    unreachable: false,
  };
}
