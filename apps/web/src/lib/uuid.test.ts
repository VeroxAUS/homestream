import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUuid } from './uuid';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** What a page on a plain-HTTP LAN address sees: getRandomValues works, randomUUID is missing. */
const realGetRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);

function stubInsecureCrypto(fill?: (bytes: Uint8Array) => void) {
  const getRandomValues = vi.fn((array: Uint8Array<ArrayBuffer>) => {
    if (fill) fill(array);
    else realGetRandomValues(array);
    return array;
  });
  vi.stubGlobal('crypto', { getRandomValues });
  return getRandomValues;
}

describe('randomUuid', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses crypto.randomUUID when the page has it', () => {
    const randomUUID = vi.fn(() => '11111111-2222-4333-8444-555555555555');
    vi.stubGlobal('crypto', { randomUUID });
    expect(randomUuid()).toBe('11111111-2222-4333-8444-555555555555');
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it('builds an RFC 4122 version 4 id from getRandomValues when randomUUID is missing', () => {
    stubInsecureCrypto();
    const ids = Array.from({ length: 200 }, () => randomUuid());
    for (const id of ids) expect(id).toMatch(V4);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('sets the version and variant bits and keeps the other random bits', () => {
    stubInsecureCrypto((bytes) => bytes.fill(0xff));
    expect(randomUuid()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    stubInsecureCrypto((bytes) => bytes.fill(0));
    expect(randomUuid()).toBe('00000000-0000-4000-8000-000000000000');
    stubInsecureCrypto((bytes) => bytes.set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]));
    expect(randomUuid()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
  });
});
