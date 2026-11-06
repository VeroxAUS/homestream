import { describe, expect, it } from 'vitest';
import { routeTemplate } from './routes';

describe('routeTemplate', () => {
  it.each([
    ['/', '/'],
    ['/search', '/search'],
    ['/search/', '/search'],
    ['/movie/603', '/movie/:id'],
    ['/tv/1399', '/tv/:id'],
    ['/play/movie/603', '/play/movie/:id'],
    ['/play/tv/1399/2/5', '/play/tv/:id/:season/:episode'],
    ['/settings', '/settings'],
    ['/dashboard/health', '/dashboard/health'],
    ['/dashboard/stats', '/dashboard/stats'],
  ])('maps %s to %s', (path, template) => {
    expect(routeTemplate(path)).toBe(template);
  });

  it('never reports an id or an unknown path', () => {
    expect(routeTemplate('/movie/603/extra')).toBe('other');
    expect(routeTemplate('/dashboard/unknown')).toBe('other');
    expect(routeTemplate('/somewhere/else')).toBe('other');
  });
});
