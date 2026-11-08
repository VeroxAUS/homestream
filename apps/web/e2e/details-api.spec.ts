import { expect, test, type APIRequestContext } from '@playwright/test';
import ports from './ports.json' with { type: 'json' };

const HUB = `http://127.0.0.1:${ports.tmdb}`;

interface Logged {
  upstream: string;
  path: string;
}
interface Details {
  cast: Array<{ name: string; character: string; profileUrl: string | null }>;
  similar: Array<{ type: string; tmdbId: number; title: string }>;
}

async function hubRequests(request: APIRequestContext): Promise<Logged[]> {
  const response = await request.get(`${HUB}/__requests`);
  return ((await response.json()) as { requests: Logged[] }).requests.filter((entry) => entry.upstream === 'tmdb');
}

test.describe('details API with cast and similar titles (stub TMDB)', () => {
  test('movie 603 carries cast with w185 photos and similar movies', async ({ request }) => {
    const body = (await (await request.get('/api/movie/603')).json()) as Details;
    expect(body.cast.map((member) => member.name)).toEqual(['Stub Actor One', 'Stub Actor Two', 'Stub Actor Three']);
    expect(body.cast[0]?.character).toBe('Neo Stub');
    expect(body.cast[0]?.profileUrl).toMatch(/\/w185\/profile\.png$/);
    expect(body.cast[1]?.profileUrl).toBeNull();
    expect(body.similar.length).toBeGreaterThan(0);
    expect(body.similar.every((item) => item.type === 'movie' && item.tmdbId !== 603)).toBe(true);
  });

  test('show 1399 carries aggregate-credit characters and similar shows', async ({ request }) => {
    const body = (await (await request.get('/api/tv/1399')).json()) as Details;
    expect(body.cast[0]).toMatchObject({ name: 'Stub Lead', character: 'Jon Stub' });
    expect(body.cast[1]?.profileUrl).toBeNull();
    expect(body.similar.length).toBeGreaterThan(0);
    expect(body.similar.every((item) => item.type === 'tv' && item.tmdbId !== 1399)).toBe(true);
  });

  test('a title with no credits answers with empty arrays, not missing fields', async ({ request }) => {
    const body = (await (await request.get('/api/movie/604')).json()) as Details;
    expect(body.cast).toEqual([]);
    expect(body.similar).toEqual([]);
  });

  test('cast and similar come from the one details request, and a repeat adds no TMDB request', async ({ request }) => {
    await request.delete(`${HUB}/__requests`);
    const first = await Promise.all(['/api/movie/603', '/api/tv/1399'].map((url) => request.get(url)));
    expect(first.every((response) => response.ok())).toBe(true);

    const log = await hubRequests(request);
    expect(
      log.filter((entry) => /\/(credits|aggregate_credits|recommendations|similar)(\?|$)/.test(entry.path)),
    ).toEqual([]);
    const movieCalls = log.filter((entry) => entry.path.startsWith('/movie/603'));
    const showCalls = log.filter((entry) => entry.path.startsWith('/tv/1399'));
    // 0 when an earlier test (or a retry) already cached the title, otherwise exactly 1.
    expect(movieCalls.length).toBeLessThanOrEqual(1);
    expect(showCalls.length).toBeLessThanOrEqual(1);
    for (const call of movieCalls)
      expect(call.path).toMatch(/append_to_response=[^&]*credits[^&]*recommendations[^&]*similar/);
    for (const call of showCalls) {
      expect(call.path).toMatch(/append_to_response=[^&]*aggregate_credits[^&]*recommendations[^&]*similar/);
    }

    await request.delete(`${HUB}/__requests`);
    const bodies = await Promise.all(first.map((response) => response.json()));
    const again = await Promise.all(['/api/movie/603', '/api/tv/1399'].map((url) => request.get(url)));
    expect(await Promise.all(again.map((response) => response.json()))).toEqual(bodies);
    expect(await hubRequests(request)).toEqual([]);
  });
});
