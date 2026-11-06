import { SCRUBBED, type TextScrubber } from './sanitize.js';

const MIN_IDENTITY_LENGTH = 3;

/** The part of Node's `os` module that tells who and where we are. Passed in, so this package needs no Node import. */
export interface HostIdentitySource {
  hostname(): string;
  userInfo(): { username: string };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The machine name and the user name, when the system has them. They must not appear in an error report. */
export function identityWordsFrom(source: HostIdentitySource): string[] {
  const words = new Set<string>();
  const add = (value: string | undefined): void => {
    if (value && value.length >= MIN_IDENTITY_LENGTH) words.add(value);
  };
  add(source.hostname());
  try {
    add(source.userInfo().username);
  } catch {
    // no user record on this system: nothing to hide
  }
  return [...words];
}

/** Replaces each word, as a whole word and ignoring case, with the scrub marker. A scrubber that changes nothing for no words. */
export function createWordScrubber(words: readonly string[]): TextScrubber {
  if (words.length === 0) return (text) => text;
  const pattern = new RegExp(`(?<![A-Za-z0-9])(?:${words.map(escapeRegExp).join('|')})(?![A-Za-z0-9])`, 'gi');
  return (text) => text.replace(pattern, SCRUBBED);
}
