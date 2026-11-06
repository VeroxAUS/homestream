import { describe, expect, it } from 'vitest';
import { scrubBreadcrumb, scrubEvent, scrubUrl } from './scrub';

describe('scrubUrl', () => {
  it('keeps the path only: no origin, query string or fragment', () => {
    expect(scrubUrl('http://192.0.2.10:8600/api/titles?token=abc&q=secret#frag')).toBe('app:///api/titles');
    expect(scrubUrl('/search?q=secret#top')).toBe('/search');
  });

  it('scrubs every URL inside a sentence', () => {
    expect(scrubUrl('GET http://example.test/a?x=1 then http://example.test/b?y=2 failed')).toBe(
      'GET app:///a then app:///b failed',
    );
  });
});

describe('scrubBreadcrumb', () => {
  it('strips query strings from url, from and to', () => {
    const clean = scrubBreadcrumb({
      message: 'navigation to http://example.test/search?q=private',
      data: { url: 'http://example.test/a?x=1', from: '/search?q=1', to: '/movie/1#top', status: 200 },
    });
    expect(clean.message).toBe('navigation to app:///search');
    expect(clean.data).toMatchObject({ url: 'app:///a', from: '/search', to: '/movie/1', status: 200 });
    expect(JSON.stringify(clean)).not.toContain('private');
    expect(JSON.stringify(clean)).not.toContain('x=1');
  });

  it('passes a breadcrumb without data', () => {
    expect(scrubBreadcrumb({ message: 'plain' })).toEqual({ message: 'plain' });
  });
});

describe('scrubEvent', () => {
  it('drops the user and request, keeps the file name and hides the origin', () => {
    const event = scrubEvent({
      user: { ip_address: '203.0.113.9', id: 'u1' },
      request: { url: 'http://192.168.1.50:8600/?token=abc', headers: { cookie: 'a=b' } },
      server_name: 'DESKTOP-ABC',
      exception: {
        values: [
          {
            value: 'boom at http://192.168.1.50:8600/assets/index-1.js?x=1',
            stacktrace: {
              frames: [
                { filename: 'http://192.168.1.50:8600/assets/index-1.js?x=1', abs_path: 'relative.js', function: 'f' },
              ],
            },
          },
        ],
      },
    });
    const text = JSON.stringify(event);
    expect(text).not.toContain('203.0.113.9');
    expect(text).not.toContain('192.168.1.50');
    expect(text).not.toContain('DESKTOP-ABC');
    expect(text).not.toContain('cookie');
    const frame = event.exception.values[0]?.stacktrace.frames[0];
    expect(frame?.filename).toBe('app:///assets/index-1.js');
    expect(frame?.abs_path).toBe('relative.js');
  });

  it('leaves an unparsable location alone', () => {
    const event = scrubEvent({ exception: { values: [{ stacktrace: { frames: [{ filename: 'https://[bad' }] } }] } });
    expect(event.exception.values[0]?.stacktrace.frames[0]?.filename).toBeTypeOf('string');
  });
});
