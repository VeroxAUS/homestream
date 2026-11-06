import os from 'node:os';
import { createWordScrubber, identityWordsFrom, type TextScrubber } from '@homestream/shared';
import { redact } from '../redact.js';

/** Registered secrets only (API keys, gateway URL parts); used for product events, where free text is a title. */
export const scrubSecrets: TextScrubber = redact;

/** Registered secrets plus the machine and user names; used for error reports. */
export function createErrorScrubber(): TextScrubber {
  const identity = createWordScrubber(identityWordsFrom(os));
  return (text) => identity(redact(text));
}
