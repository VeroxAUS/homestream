import { describe, expect, it } from 'vitest';
import {
  HOME_PLACEHOLDER,
  SCRUBBED,
  relativizePath,
  sanitizeBreadcrumb,
  sanitizeSentryEvent,
  sanitizeText,
  sanitizeValue,
} from '../src/sanitize.js';

// Sanitized payloads are inspected structurally; typing every field would only add noise.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseJson = Record<string, any>;

describe('sanitizeText', () => {
  it.each([
    [
      'gateway url',
      'GET https://gw.example.test/stremio/aaaa1111/bbbb2222cccc/manifest.json failed',
      'gw.example.test',
    ],
    ['addon path without a host', 'path /stremio/aaaa1111/bbbb2222cccc/stream/movie/tt1.json', 'aaaa1111'],
    ['cdn url', 'link https://store-12.eu.tb-cdn.io/dl/abc?token=zzz', 'tb-cdn.io'], // gitleaks:allow
    ['bare cdn host', 'resolving store-12.eu.tb-cdn.io', 'tb-cdn'], // gitleaks:allow
    ['file url', 'open file:///C:/Users/Alice/x.mkv', 'Alice'],
    ['bearer header', 'Authorization: Bearer abcdef0123456789', 'abcdef0123456789'],
    ['jwt', 'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig', 'eyJhbGci'], // gitleaks:allow
    ['sentry key', 'key sntrys_abcdefghijklmnop', 'sntrys_abcdefghijklmnop'],
    ['posthog key', 'key phc_abcdefghijklmnop', 'phc_abcdefghijklmnop'],
    ['field assignment', 'password=hunter2-hunter2', 'hunter2'],
    ['json field', '{"apiKey": "abcdef123456"}', 'abcdef123456'], // gitleaks:allow
    ['query string', 'GET /api/x?foo=bar&baz=1 failed', 'foo=bar'],
    ['ipv4', 'connect ECONNREFUSED 192.168.1.50:8600', '192.168.1.50'],
    ['ipv6', 'from 2001:db8::1 refused', '2001:db8'],
    ['long token', 'id Zm9vYmFyMTIzNDU2Nzg5MGFiY2RlZmdoaWprbG1ub3BxcnN0', 'Zm9vYmFy'],
  ])('removes a %s', (_label, input, needle) => {
    const out = sanitizeText(input);
    expect(out).not.toContain(needle);
    expect(out).toContain(SCRUBBED);
  });

  it('turns Windows and POSIX home paths into <home> and keeps the rest of the path', () => {
    expect(sanitizeText('ENOENT C:\\Users\\Alice\\Videos\\a.mkv')).toBe(`ENOENT ${HOME_PLACEHOLDER}\\Videos\\a.mkv`);
    expect(sanitizeText('ENOENT d:/users/bob/x/y.txt')).toBe(`ENOENT ${HOME_PLACEHOLDER}/x/y.txt`);
    expect(sanitizeText('ENOENT /home/carol/app/x.js')).toBe(`ENOENT ${HOME_PLACEHOLDER}/app/x.js`);
    expect(sanitizeText('at /Users/dave/app/x.js')).toBe(`at ${HOME_PLACEHOLDER}/app/x.js`);
  });

  it('keeps ordinary prose, versions, UUIDs and clock times', () => {
    for (const text of [
      'Playback started: The Matrix on Living Room TV.',
      'ffmpeg 7.1.1 exited with code 1',
      'session 1b4e28ba-2fa1-11d2-883f-0016d3cca427 stopped',
      'finished at 12:30:45 today',
      'segment 12 of 400',
    ]) {
      expect(sanitizeText(text)).toBe(text);
    }
  });

  it('runs the extra scrubber first, so a registered secret is removed before any pattern splits it', () => {
    const out = sanitizeText('value my-registered-secret here', (text) => text.replace('my-registered-secret', 'X'));
    expect(out).toBe('value X here');
  });

  it('does not treat an address-like number sequence with too few groups as IPv6', () => {
    expect(sanitizeText('ratio 1:2:3')).toBe('ratio 1:2:3');
  });
});

describe('sanitizeValue', () => {
  it('scrubs nested strings and arrays, and drops auth fields, cookies, user and ip data', () => {
    const input = {
      message: 'failed for https://gw.example.test/x',
      headers: { Authorization: 'Bearer abcdef0123456789', cookie: 'sid=1', 'X-Api-Key': 'k', accept: 'text/plain' },
      user: { id: '1', ip_address: '192.168.1.50', username: 'alice' },
      server_name: 'DESKTOP-ABC',
      list: ['ok', 'GET /a?token=abcdef123456'], // gitleaks:allow
      count: 3,
      flag: true,
      nothing: null,
    };
    const out = sanitizeValue(input) as LooseJson;
    expect(out.message).toBe(`failed for ${SCRUBBED}`);
    expect(out.headers).toEqual({ accept: 'text/plain' });
    expect(out).not.toHaveProperty('user');
    expect(out).not.toHaveProperty('server_name');
    expect(out.list).toEqual(['ok', `GET /a?${SCRUBBED}`]);
    expect(out).toMatchObject({ count: 3, flag: true, nothing: null });
    expect(JSON.stringify(out)).not.toMatch(/192\.168|alice|DESKTOP|abcdef/);
  });

  it('does not change its input', () => {
    const input = { url: 'https://gw.example.test/x', nested: { token: 'abc123def456' } }; // gitleaks:allow
    sanitizeValue(input);
    expect(input).toEqual({ url: 'https://gw.example.test/x', nested: { token: 'abc123def456' } }); // gitleaks:allow
  });

  it('survives circular references and very deep objects', () => {
    const loop: Record<string, unknown> = { name: 'loop' };
    loop.self = loop;
    expect(sanitizeValue(loop)).toEqual({ name: 'loop', self: SCRUBBED });
    let deep: Record<string, unknown> = { leaf: 'x' };
    for (let i = 0; i < 30; i += 1) deep = { child: deep };
    expect(JSON.stringify(sanitizeValue(deep))).toContain(SCRUBBED);
  });
});

describe('relativizePath', () => {
  const roots = ['E:\\Projects\\homestream', '/srv/homestream/'];

  it('cuts a known root, case-insensitively and across slash styles', () => {
    expect(relativizePath('E:\\Projects\\homestream\\apps\\server\\src\\a.ts', roots)).toBe('apps/server/src/a.ts');
    expect(relativizePath('e:/projects/homestream/apps/b.ts', roots)).toBe('apps/b.ts');
    expect(relativizePath('/srv/homestream/dist/c.js', roots)).toBe('dist/c.js');
  });

  it('leaves other paths and prefix look-alikes alone', () => {
    expect(relativizePath('node:internal/process', roots)).toBe('node:internal/process');
    expect(relativizePath('E:\\Projects\\homestream-other\\x.ts', roots)).toBe('E:\\Projects\\homestream-other\\x.ts');
    expect(relativizePath('/srv/homestream/dist/c.js', [''])).toBe('/srv/homestream/dist/c.js');
  });

  it('ignores any number of trailing slashes on a root', () => {
    expect(relativizePath('/srv/homestream/dist/c.js', ['/srv/homestream///'])).toBe('dist/c.js');
    expect(relativizePath('/srv/homestream/dist/c.js', ['///'])).toBe('/srv/homestream/dist/c.js');
  });

  it('handles an adversarial root of 50,000 slashes in under 50 ms', () => {
    const roots = [`/srv${'/'.repeat(50_000)}x`, '/'.repeat(50_000)];
    const started = performance.now();
    const result = relativizePath('/srv/homestream/dist/c.js', roots);
    expect(performance.now() - started).toBeLessThan(50);
    expect(result).toBe('/srv/homestream/dist/c.js');
  });
});

describe('sanitizeText on adversarial input', () => {
  it.each([
    ['slashes', '/'.repeat(50_000)],
    ['backslashes', '\\'.repeat(50_000)],
    ['dots', '.'.repeat(50_000)],
    ['digits', '1'.repeat(50_000)],
    ['colons', ':'.repeat(50_000)],
    ['letters', 'a'.repeat(50_000)],
    ['letters joined by hyphens', 'a-'.repeat(25_000)],
    ['digits joined by hyphens', '1-'.repeat(25_000)],
  ])('scrubs 50,000 repeated %s in under 50 ms', (_label, input) => {
    const started = performance.now();
    sanitizeText(input);
    expect(performance.now() - started).toBeLessThan(50);
  });

  it('scrubs the CDN host with all its sub-domains and nothing around it', () => {
    expect(sanitizeText('resolving store-12.eu.tb-cdn.io now')).toBe(`resolving ${SCRUBBED} now`); // gitleaks:allow
    expect(sanitizeText('a tb-cdn.io, b.tb-cdn.io.')).toBe(`a ${SCRUBBED}, ${SCRUBBED}.`); // gitleaks:allow
  });

  it('scrubs a CDN host behind 50,000 characters of look-alike labels in under 50 ms', () => {
    const started = performance.now();
    const out = sanitizeText(`${'a-'.repeat(25_000)}x.tb-cdn.io`); // gitleaks:allow
    expect(performance.now() - started).toBeLessThan(50);
    expect(out).not.toContain('tb-cdn');
  });

  it('leaves normal paths and text unchanged', () => {
    for (const text of ['at src/a/b.ts:12:3', 'cut /srv/homestream/dist/c.js here', 'plain text']) {
      expect(sanitizeText(text)).toBe(text);
    }
  });
});

describe('sanitizeSentryEvent', () => {
  const roots = ['E:\\Projects\\homestream'];

  function event() {
    return {
      message: 'boom at https://gw.example.test/stremio/aaaa1111/bbbb2222cccc/manifest.json',
      server_name: 'DESKTOP-ABC',
      user: { ip_address: '192.168.1.50', username: 'alice' },
      request: { url: 'http://192.168.1.50:8600/api/info?token=abcdef123456', headers: { cookie: 'x' } }, // gitleaks:allow
      tags: { request_id: 'req-1', 'device.kind': 'tv' },
      contexts: {
        device: {
          name: 'DESKTOP-ABC',
          arch: 'x64',
          processor_count: 32,
          memory_size: 1,
          boot_time: 'x',
          cpu_description: 'cpu',
        },
        culture: { locale: 'en-AU', timezone: 'Australia/Sydney' },
        os: { name: 'Windows' },
      },
      exception: {
        values: [
          {
            type: 'Error',
            value: 'ENOENT C:\\Users\\Alice\\a.mkv',
            stacktrace: {
              frames: [
                {
                  filename: 'E:\\Projects\\homestream\\apps\\server\\src\\a.ts',
                  abs_path: 'E:\\Projects\\homestream\\apps\\server\\src\\a.ts',
                },
                { filename: 'node:internal/timers' },
                {},
              ],
            },
          },
        ],
      },
    };
  }

  it('drops server name, user, request data and identifying context, keeps tags and OS facts', () => {
    const out = sanitizeSentryEvent(event(), { roots }) as LooseJson;
    expect(out).not.toHaveProperty('server_name');
    expect(out).not.toHaveProperty('user');
    expect(out).not.toHaveProperty('request');
    expect(out.tags).toEqual({ request_id: 'req-1', 'device.kind': 'tv' });
    expect(out.contexts).toEqual({
      device: { arch: 'x64', processor_count: 32, memory_size: 1 },
      os: { name: 'Windows' },
    });
    expect(out.message).toBe(`boom at ${SCRUBBED}`);
  });

  it('makes stack frames relative and hides user names in messages', () => {
    const out = sanitizeSentryEvent(event(), { roots }) as LooseJson;
    const frames = out.exception.values[0].stacktrace.frames;
    expect(frames[0]).toEqual({ filename: 'apps/server/src/a.ts', abs_path: 'apps/server/src/a.ts' });
    expect(frames[1].filename).toBe('node:internal/timers');
    expect(out.exception.values[0].value).toBe(`ENOENT ${HOME_PLACEHOLDER}\\a.mkv`);
  });

  it('keeps contexts that have no device or culture entry', () => {
    expect(sanitizeSentryEvent({ contexts: { os: { name: 'Linux' } } })).toEqual({
      contexts: { os: { name: 'Linux' } },
    });
  });

  it('works for events without exceptions or contexts and without roots', () => {
    expect(sanitizeSentryEvent({ message: 'plain' })).toEqual({ message: 'plain' });
    expect(sanitizeSentryEvent({ exception: { values: [{ type: 'E' }] } })).toEqual({
      exception: { values: [{ type: 'E' }] },
    });
  });

  it('applies the extra scrubber to every string', () => {
    const out = sanitizeSentryEvent(
      { message: 'my-secret-key inside' },
      { extra: (text) => text.replace('my-secret-key', 'X') },
    );
    expect(out).toEqual({ message: 'X inside' });
  });
});

describe('sanitizeBreadcrumb', () => {
  it('keeps category, level and message but scrubs the text and data', () => {
    const out = sanitizeBreadcrumb({
      category: 'http',
      level: 'info',
      message: 'GET https://gw.example.test/x',
      data: { url: 'https://abcd.tb-cdn.io/dl/1?token=zzzzzzzz', host: '192.168.1.50', status: 200 }, // gitleaks:allow
    }) as LooseJson;
    expect(out).toEqual({
      category: 'http',
      level: 'info',
      message: `GET ${SCRUBBED}`,
      data: { url: SCRUBBED, host: SCRUBBED, status: 200 },
    });
  });
});
