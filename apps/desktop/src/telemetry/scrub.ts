import os from 'node:os';
import {
  createWordScrubber,
  identityWordsFrom,
  sanitizeBreadcrumb,
  sanitizeSentryEvent,
  sanitizeText,
  type TextScrubber,
} from '@homestream/shared';

/** Removes the machine and user names; the shared sanitizer handles URLs, keys, addresses and home folders. */
export function createIdentityScrubber(words: readonly string[] = identityWordsFrom(os)): TextScrubber {
  return createWordScrubber(words);
}

export interface MainScrubber {
  text(input: string): string;
  event<T extends object>(event: T): T;
  breadcrumb<T extends object>(breadcrumb: T): T;
}

/** The scrubber every desktop main-process sink uses: log lines, Sentry events and breadcrumbs, analytics properties. */
export function createMainScrubber(
  roots: readonly string[],
  identity: TextScrubber = createIdentityScrubber(),
): MainScrubber {
  return {
    text: (input) => sanitizeText(input, identity),
    event: (event) => sanitizeSentryEvent(event, { extra: identity, roots }),
    breadcrumb: (breadcrumb) => sanitizeBreadcrumb(breadcrumb, identity),
  };
}
