import os from 'node:os';
import { SCRUBBED, type TextScrubber } from '@homestream/shared';
import { redact } from '../redact.js';

const MIN_IDENTITY_LENGTH = 3;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The machine name and the Windows user name, as whole words; they must not appear in an error report. */
function identityWords(): string[] {
  const words = new Set<string>();
  const add = (value: string | undefined): void => {
    if (value && value.length >= MIN_IDENTITY_LENGTH) words.add(value);
  };
  add(os.hostname());
  try {
    add(os.userInfo().username);
  } catch {
    // no user record on this system: nothing to hide
  }
  return [...words];
}

/** Registered secrets only (API keys, gateway URL parts); used for product events, where free text is a title. */
export const scrubSecrets: TextScrubber = redact;

/** Registered secrets plus the machine and user names; used for error reports. */
export function createErrorScrubber(): TextScrubber {
  const words = identityWords();
  const identity =
    words.length === 0
      ? null
      : new RegExp(`(?<![A-Za-z0-9])(?:${words.map(escapeRegExp).join('|')})(?![A-Za-z0-9])`, 'gi');
  return (text) => {
    const clean = redact(text);
    return identity ? clean.replace(identity, SCRUBBED) : clean;
  };
}
