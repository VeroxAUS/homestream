import { expect, test } from '@playwright/test';
import ports from './ports.json' with { type: 'json' };

const HUB = `http://127.0.0.1:${ports.sentry}`;

test.describe('web UI served by an isolated server (build without telemetry keys)', () => {
  test('loads and shows the server it talks to', async ({ page }) => {
    const infoRequest = page.waitForRequest((request) => new URL(request.url()).pathname === '/api/info');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'HomeStream' })).toBeVisible();
    await expect(page.getByRole('status')).toContainText(/^Server: .+ \d+\.\d+\.\d+/);

    const sent = (await infoRequest).headers()['x-request-id'];
    expect(sent).toMatch(/^[0-9a-f-]{36}$/);
    const response = await (await infoRequest).response();
    expect(response?.headers()['x-request-id']).toBeTruthy();
  });

  test('the server answers Home and Search from the stub TMDB', async ({ request }) => {
    const home = await request.get('/api/home');
    expect(home.ok()).toBe(true);
    const body = (await home.json()) as { trendingMovies: Array<{ title: string; posterUrl: string | null }> };
    expect(body.trendingMovies.map((movie) => movie.title)).toContain('The Stub Matrix');
    expect(body.trendingMovies[0]?.posterUrl).toContain(`127.0.0.1:${ports.tmdb}`);

    const search = await request.get('/api/search', { params: { q: 'stub thrones' } });
    expect(search.ok()).toBe(true);
    const found = (await search.json()) as { results: Array<{ title: string; type: string }> };
    expect(found.results).toEqual([expect.objectContaining({ title: 'Stub Thrones', type: 'tv' })]);
  });

  test('sends no telemetry and loads no telemetry code', async ({ page, request }) => {
    await request.delete(`${HUB}/__captured`);
    const origins = new Set<string>();
    const scripts: string[] = [];
    page.on('request', (req) => {
      origins.add(new URL(req.url()).origin);
      if (req.resourceType() === 'script') scripts.push(new URL(req.url()).pathname);
    });
    await page.goto('/');
    await expect(page.getByRole('status')).toContainText('Server:');
    await page.waitForTimeout(2500);

    expect([...origins]).toEqual([`http://127.0.0.1:${ports.serverPlain}`]);
    expect(scripts.filter((script) => script.includes('telemetry'))).toEqual([]);
    const captured = (await (await request.get(`${HUB}/__captured`)).json()) as {
      sentry: unknown[];
      posthog: unknown[];
    };
    expect(captured.sentry).toEqual([]);
    expect(captured.posthog).toEqual([]);
  });
});
