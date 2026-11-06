import { describe, expect, it } from 'vitest';
import { createWordScrubber, identityWordsFrom } from '../src/identity.js';
import { SCRUBBED } from '../src/sanitize.js';

describe('identityWordsFrom', () => {
  it('returns the host and user names, once, and drops names shorter than three characters', () => {
    expect(identityWordsFrom({ hostname: () => 'MEDIA-PC', userInfo: () => ({ username: 'media-pc' }) })).toEqual([
      'MEDIA-PC',
      'media-pc',
    ]);
    expect(identityWordsFrom({ hostname: () => 'ab', userInfo: () => ({ username: '' }) })).toEqual([]);
  });

  it('keeps the host name when the system has no user record', () => {
    const source = {
      hostname: () => 'MEDIA-PC',
      userInfo: () => {
        throw new Error('ENOENT');
      },
    };
    expect(identityWordsFrom(source)).toEqual(['MEDIA-PC']);
  });
});

describe('createWordScrubber', () => {
  it('replaces whole words in any case and leaves longer words alone', () => {
    const scrub = createWordScrubber(['Media.PC', 'bob']);
    expect(scrub('error on media.pc for BOB')).toBe(`error on ${SCRUBBED} for ${SCRUBBED}`);
    expect(scrub('mediaXpc bobby')).toBe('mediaXpc bobby');
  });

  it('does nothing without words', () => {
    expect(createWordScrubber([])('anything')).toBe('anything');
  });
});
