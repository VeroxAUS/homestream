import { afterEach, describe, expect, it } from 'vitest';
import {
  clearSecrets,
  displayGatewayUrl,
  redact,
  redactDeep,
  registerSecret,
  registerSecretUrl,
} from '../src/redact.js';

const GATEWAY = 'https://gw.example.test/stremio/aaaa1111-uuid/ZZsecretBlob987654/manifest.json';

afterEach(() => clearSecrets());

describe('redact', () => {
  it('hides the gateway path segments of a registered URL', () => {
    registerSecretUrl(GATEWAY);
    const out = redact(`fetching ${GATEWAY} and https://gw.example.test/stremio/aaaa1111-uuid/ZZsecretBlob987654/stream/movie/tt1.json`);
    expect(out).not.toContain('aaaa1111-uuid');
    expect(out).not.toContain('ZZsecretBlob987654');
    expect(out).toContain('<redacted>');
  });

  it('hides addon-style paths even when the URL was never registered', () => {
    const out = redact('GET https://other.test/stremio/abc123/defg456/manifest.json failed');
    expect(out).toBe('GET https://other.test/stremio/<redacted>/manifest.json failed');
  });

  it('hides registered secrets, including URL-encoded forms', () => {
    registerSecret('my secret/value 123');
    expect(redact('a my secret/value 123 b')).toBe('a <redacted> b');
    expect(redact('q=my%20secret%2Fvalue%20123')).toBe('q=<redacted>');
  });

  it('ignores too-short secrets so ordinary words survive', () => {
    registerSecret('abc');
    expect(redact('abc def')).toBe('abc def');
  });

  it.each([
    ['https://x.test/a?token=abc123&b=1', 'https://x.test/a?token=<redacted>&b=1'],
    ['https://x.test/a?b=1&apikey=abc123', 'https://x.test/a?b=1&apikey=<redacted>'],
    ['https://x.test/a?api_key=abc123', 'https://x.test/a?api_key=<redacted>'],
    ['https://x.test/a?X=1&Token=ZZZ', 'https://x.test/a?X=1&Token=<redacted>'],
    ['{"url":"https://x.test/a?token=abc123"}', '{"url":"https://x.test/a?token=<redacted>"}'],
  ])('hides secret query params: %s', (input, expected) => {
    expect(redact(input)).toBe(expected);
  });

  it('hides bearer tokens and JWTs', () => {
    expect(redact('Authorization: Bearer abcdef123456')).toBe('Authorization: Bearer <redacted>');
    expect(redact('tok eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.sig_part-1 end')).toBe('tok <redacted> end');
  });

  it('hides TorBox CDN URLs', () => {
    const out = redact('resolved https://store-012.wnam.tb-cdn.io/dl/abc/def.mkv?x=1 ok');
    expect(out).toBe('resolved https://store-012.wnam.tb-cdn.io/<redacted> ok');
  });

  it('leaves ordinary text alone', () => {
    expect(redact('GET /api/info 200 in 3ms')).toBe('GET /api/info 200 in 3ms');
  });
});

describe('redactDeep', () => {
  it('redacts nested strings, arrays and errors', () => {
    registerSecret('supersecretvalue');
    const input = {
      a: 'x supersecretvalue y',
      list: ['supersecretvalue', 3],
      nested: { err: new Error('boom supersecretvalue') },
    };
    const out = redactDeep(input);
    expect(JSON.stringify(out)).not.toContain('supersecretvalue');
    expect(out.list[1]).toBe(3);
  });

  it('survives circular references', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    expect(() => redactDeep(a)).not.toThrow();
  });
});

describe('displayGatewayUrl', () => {
  it('shows only the host', () => {
    expect(displayGatewayUrl(GATEWAY)).toBe('https://gw.example.test/stremio/<redacted>/manifest.json');
    expect(displayGatewayUrl(null)).toBeNull();
  });
});
