import { expect, test, type Page } from '@playwright/test';

interface Details {
  cast: Array<{ name: string; character: string; profileUrl: string | null }>;
  similar: Array<{ tmdbId: number; title: string }>;
}

const castSection = (page: Page) => page.getByRole('region', { name: 'Cast' });
const similarSection = (page: Page) => page.getByRole('region', { name: 'More like this' });

async function details(page: Page, path: string): Promise<Details> {
  return (await (await page.request.get(path)).json()) as Details;
}

test.use({ viewport: { width: 1280, height: 800 } });

test.describe('Cast and More like this on the details pages (stub TMDB)', () => {
  test('movie page: both rows sit below the hero, in API order, with the specified look', async ({ page }) => {
    const api = await details(page, '/api/movie/603');
    await page.goto('/movie/603');
    await expect(page.getByRole('heading', { level: 1, name: 'The Stub Matrix' })).toBeVisible();
    await expect(castSection(page)).toBeVisible();

    const layout = await page.evaluate(() => {
      const box = (element: Element | null) => element?.getBoundingClientRect();
      const hero = document.querySelector('main > header');
      const headings = [...document.querySelectorAll('main h2')].map((heading) => ({
        text: heading.textContent,
        top: box(heading)?.top ?? 0,
      }));
      return { heroBottom: box(hero)?.bottom ?? 0, headings };
    });
    expect(layout.headings.map((heading) => heading.text)).toEqual(['Cast', 'More like this']);
    expect(layout.headings[0]?.top).toBeGreaterThanOrEqual(layout.heroBottom);

    const entries = castSection(page).getByRole('listitem');
    await expect(entries).toHaveCount(api.cast.length);
    await expect(entries.first()).toContainText(api.cast[0]?.name ?? '');
    await expect(entries.first()).toContainText(api.cast[0]?.character ?? '');

    await castSection(page).scrollIntoViewIfNeeded();
    const look = await page.evaluate(() => {
      const first = document.querySelector('[data-testid="cast-photo"]');
      const photo = first?.querySelector('img');
      const entry = first?.parentElement;
      const name = entry?.children[1];
      const character = entry?.children[2];
      const style = (element: Element | null | undefined) => (element ? getComputedStyle(element) : null);
      return {
        radius: style(first)?.borderRadius,
        circle: [first?.getBoundingClientRect().width, first?.getBoundingClientRect().height],
        imageSize: [photo?.getAttribute('width'), photo?.getAttribute('height')],
        src: photo?.getAttribute('src'),
        name: [style(name)?.fontSize, style(name)?.fontWeight],
        character: [style(character)?.fontSize, style(character)?.color],
        placeholder: style(first)?.backgroundColor,
      };
    });
    expect(look.radius).toBe('50%');
    expect(look.circle).toEqual([96, 96]);
    expect(look.imageSize).toEqual(['96', '96']);
    expect(look.src).toMatch(/\/w185\/profile\.png$/);
    expect(look.name).toEqual(['13px', '600']);
    expect(look.character).toEqual(['12px', 'rgb(155, 155, 168)']);
    expect(look.placeholder).toBe('rgb(29, 29, 38)');

    const posters = similarSection(page).getByRole('link');
    await expect(posters).toHaveCount(api.similar.length);
    for (const [index, item] of api.similar.entries()) await expect(posters.nth(index)).toContainText(item.title);
    await similarSection(page).scrollIntoViewIfNeeded();
    await expect(similarSection(page).locator('img').first()).toHaveAttribute('src', /\/w342\//);
  });

  test('a member without a photo shows initials on the placeholder circle, never a broken image', async ({ page }) => {
    await page.goto('/movie/603');
    const second = castSection(page).getByRole('listitem').nth(1);
    await expect(second).toContainText('Stub Actor Two');
    await expect(second.locator('img')).toHaveCount(0);
    await expect(second.getByTestId('cast-photo')).toHaveText('ST');

    await castSection(page).scrollIntoViewIfNeeded();
    const photo = castSection(page).locator('img').first();
    await expect.poll(() => photo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    const broken = await page.evaluate(
      () =>
        [...document.querySelectorAll('main img')].filter(
          (image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth === 0,
        ).length,
    );
    expect(broken).toBe(0);
  });

  test('a title without credits shows neither heading nor an empty container', async ({ page }) => {
    await page.goto('/movie/604');
    await expect(page.getByRole('heading', { level: 1, name: 'Stub Reloaded' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Cast' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'More like this' })).toHaveCount(0);
    expect(await page.locator('main > *').count()).toBe(1);
  });

  test('an older server without cast and similar fields still renders the hero, quietly', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/movie/603', async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as Record<string, unknown>;
      delete body.cast;
      delete body.similar;
      await route.fulfill({ response, json: body });
    });
    await page.goto('/movie/603');
    await expect(page.getByRole('heading', { level: 1, name: 'The Stub Matrix' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Cast' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'More like this' })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('clicking a similar movie opens its details at the top, and Back returns', async ({ page }) => {
    const api = await details(page, '/api/movie/603');
    const first = api.similar[0];
    if (!first) throw new Error('the stub movie has no similar titles');
    await page.goto('/movie/603');
    await similarSection(page).getByRole('link').first().click();
    await expect(page).toHaveURL(new RegExp(`/movie/${first.tmdbId}$`));
    await expect(page.getByRole('heading', { level: 1, name: first.title })).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    await page.goBack();
    await expect(page).toHaveURL(/\/movie\/603$/);
    await expect(page.getByRole('heading', { level: 1, name: 'The Stub Matrix' })).toBeVisible();
  });

  test('clicking a cast entry stays on the details page', async ({ page }) => {
    await page.goto('/movie/603');
    await castSection(page).getByRole('listitem').first().click();
    await expect(page).toHaveURL(/\/movie\/603$/);
    await expect(page.getByRole('heading', { level: 1, name: 'The Stub Matrix' })).toBeVisible();
  });

  test('show page: both rows come after the episodes, and a similar show opens its own page', async ({ page }) => {
    const api = await details(page, '/api/tv/1399');
    await page.goto('/tv/1399');
    await expect(page.getByRole('list', { name: 'Season 1 episodes' })).toBeVisible();
    await expect(castSection(page)).toBeAttached();

    const positions = await page.evaluate(() => {
      const bottom = (selector: string) => document.querySelector(selector)?.getBoundingClientRect().bottom ?? 0;
      const top = (name: string) =>
        [...document.querySelectorAll('main h2')].find((h) => h.textContent === name)?.getBoundingClientRect().top ?? 0;
      return {
        list: bottom('ul[aria-label$="episodes"]'),
        panel: bottom('[aria-label="Selected episode"]'),
        cast: top('Cast'),
        similar: top('More like this'),
      };
    });
    expect(positions.cast).toBeGreaterThanOrEqual(Math.max(positions.list, positions.panel));
    expect(positions.similar).toBeGreaterThan(positions.cast);
    await expect(castSection(page).getByRole('listitem').first()).toContainText(api.cast[0]?.name ?? '');

    const first = api.similar[0];
    if (!first) throw new Error('the stub show has no similar titles');
    await similarSection(page).scrollIntoViewIfNeeded();
    await similarSection(page).getByRole('link').first().click();
    await expect(page).toHaveURL(new RegExp(`/tv/${first.tmdbId}$`));
    await expect(page.getByRole('heading', { level: 1, name: first.title })).toBeVisible();
  });

  for (const path of ['/movie/603', '/tv/1399']) {
    test(`${path} stays within the image budget at load and marks every row image lazy`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.waitForTimeout(1500);

      const images = await page.evaluate(() =>
        performance
          .getEntriesByType('resource')
          .filter((entry) => (entry as PerformanceResourceTiming).initiatorType === 'img')
          .map((entry) => {
            const timing = entry as PerformanceResourceTiming;
            return { name: entry.name, bytes: timing.transferSize || timing.encodedBodySize };
          }),
      );
      expect(images.length).toBeLessThanOrEqual(40);
      expect(images.reduce((sum, image) => sum + image.bytes, 0)).toBeLessThanOrEqual(2 * 1024 * 1024);
      for (const image of images) expect(image.name).not.toContain('/original/');

      const rowImages = await page.evaluate(() =>
        [...document.querySelectorAll('main section[aria-labelledby] img')].map((image) => ({
          loading: image.getAttribute('loading'),
          decoding: image.getAttribute('decoding'),
          width: image.getAttribute('width'),
          height: image.getAttribute('height'),
        })),
      );
      for (const image of rowImages) {
        expect(image.loading).toBe('lazy');
        expect(image.decoding).toBe('async');
        expect(Number(image.width)).toBeGreaterThan(0);
        expect(Number(image.height)).toBeGreaterThan(0);
      }
    });
  }
});
