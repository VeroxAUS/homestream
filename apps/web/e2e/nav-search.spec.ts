import { expect, test, type Page } from '@playwright/test';
import ports from './ports.json' with { type: 'json' };

const HUB = `http://127.0.0.1:${ports.tmdb}`;

interface KeyLog {
  __keys: Array<{ key: string; t: number }>;
}

const field = (page: Page) => page.getByRole('textbox', { name: 'Search movies and shows' });
const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const bar = (page: Page) => mainNav(page).locator('xpath=ancestor::header');
const sleep = (page: Page, ms: number) => page.waitForTimeout(ms);

/** The `q` of every `/api/search` request the page sends from now on. */
function watchSearch(page: Page): string[] {
  const queries: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/search') queries.push(url.searchParams.get('q') ?? '');
  });
  return queries;
}

/** Remembers when each key went down, to compare with the `startTime` of the requests. */
async function recordKeys(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const log: KeyLog['__keys'] = [];
    (window as unknown as KeyLog).__keys = log;
    window.addEventListener('keydown', (event) => log.push({ key: event.key, t: performance.now() }), true);
  });
}

async function searchRequests(page: Page): Promise<Array<{ q: string; start: number }>> {
  return page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .filter((entry) => new URL(entry.name).pathname === '/api/search')
      .map((entry) => ({ q: new URL(entry.name).searchParams.get('q') ?? '', start: entry.startTime })),
  );
}

async function keys(page: Page): Promise<KeyLog['__keys']> {
  return page.evaluate(() => (window as unknown as KeyLog).__keys);
}

async function hubSearches(page: Page): Promise<string[]> {
  const body = (await (await page.request.get(`${HUB}/__requests`)).json()) as {
    requests: Array<{ upstream: string; path: string }>;
  };
  return body.requests
    .filter((entry) => entry.upstream === 'tmdb' && entry.path.startsWith('/search/multi'))
    .map((entry) => new URL(entry.path, HUB).searchParams.get('query') ?? '');
}

test.describe('nav search field', () => {
  test('typing opens /search?q= with one history entry, keeps focus and every character, and shows results', async ({
    page,
  }) => {
    await page.goto('/movie/603');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const before = await page.evaluate(() => history.length);

    await field(page).click();
    await page.keyboard.press('s');
    await expect.poll(() => new URL(page.url()).pathname).toBe('/search');
    await page.keyboard.type('tub th', { delay: 80 });

    await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('stub th');
    expect(await page.evaluate(() => history.length)).toBe(before + 1);
    await expect(field(page)).toHaveValue('stub th');
    await expect(field(page)).toBeFocused();
    await expect(page.getByRole('link', { name: /Stub Thrones/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Stub Thrones/ })).toContainText('Show');

    await page.goBack();
    await expect(page).toHaveURL(/\/movie\/603$/);
    await expect(field(page)).toHaveValue('');
  });

  test('asks once per pause, at least 250 ms after the last key, and never for a prefix', async ({ page }) => {
    await recordKeys(page);
    await page.goto('/');
    await field(page).click();
    await page.keyboard.type('stub', { delay: 60 });
    await sleep(page, 1000);
    await page.keyboard.type(' th', { delay: 60 });
    await sleep(page, 1000);

    const requests = await searchRequests(page);
    expect(requests.map((request) => request.q)).toEqual(['stub', 'stub th']);
    const pressed = await keys(page);
    for (const request of requests) {
      const last = Math.max(...pressed.filter((key) => key.t <= request.start).map((key) => key.t));
      expect(request.start - last).toBeGreaterThanOrEqual(250);
    }
    await expect(page.getByRole('link', { name: /Stub Thrones/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /The Stub Matrix/ })).toHaveCount(0);
  });

  test('sends no request for fewer than 2 characters, and shows the prompt again when the text gets short', async ({
    page,
  }) => {
    const queries = watchSearch(page);
    await page.goto('/');
    await field(page).click();
    await page.keyboard.type('s');
    await sleep(page, 800);
    expect(queries).toEqual([]);
    await expect(page.getByText('Search for movies and shows')).toBeVisible();
    await expect(page.getByText(/No results/)).toHaveCount(0);

    await page.keyboard.type('t');
    await expect(page.getByRole('link', { name: /The Stub Matrix/ })).toBeVisible();
    expect(queries).toEqual(['st']);

    await page.keyboard.press('Backspace');
    await expect(page.getByText('Search for movies and shows')).toBeVisible({ timeout: 500 });
    await expect(page.getByRole('link', { name: /The Stub Matrix/ })).toHaveCount(0);
    await sleep(page, 600);
    expect(queries).toEqual(['st']);
  });

  test.describe('with a slow answer for the first query', () => {
    // The server caches answers, so every try of this test (a retry is one) uses its own pair of queries.
    const SLOW = ['stub m', 'stub ma', 'stub mat'];
    const FAST = ['stub re', 'stub rel', 'stub relo'];

    test.afterEach(async ({ request }) => {
      await request.delete(`${HUB}/__search-delays`);
    });

    test('aborts the superseded request and only shows the newest answer', async ({ page, request }, testInfo) => {
      const slow = SLOW[testInfo.retry] ?? SLOW[0]!;
      const fast = FAST[testInfo.retry] ?? FAST[0]!;
      await request.post(`${HUB}/__search-delays`, { data: { [slow]: 3000 } });
      const aborted: string[] = [];
      page.on('requestfailed', (failed) => {
        const url = new URL(failed.url());
        if (url.pathname === '/api/search') aborted.push(`${url.searchParams.get('q')}|${failed.failure()?.errorText}`);
      });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));

      await page.goto('/');
      await field(page).click();
      await page.keyboard.type(slow);
      await sleep(page, 600);
      await field(page).fill(fast);

      await expect(page.getByRole('link', { name: /Stub Reloaded/ })).toBeVisible();
      await expect.poll(() => aborted.some((entry) => entry.startsWith(`${slow}|net::ERR_ABORTED`))).toBe(true);

      for (let sample = 0; sample < 35; sample++) {
        await sleep(page, 100);
        await expect(page.getByRole('link', { name: /The Stub Matrix/ })).toHaveCount(0);
      }
      await expect(page.getByRole('alert')).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  });

  test('Enter searches at once and only once, Escape clears the field, Enter in an empty field does nothing', async ({
    page,
  }) => {
    await recordKeys(page);
    const queries = watchSearch(page);
    await page.goto('/');
    await field(page).click();
    await page.keyboard.press('Enter');
    await sleep(page, 600);
    expect(queries).toEqual([]);

    await page.keyboard.type('stub');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('link', { name: /The Stub Matrix/ })).toBeVisible();
    await sleep(page, 1000);
    expect(queries).toEqual(['stub']);
    const pressed = await keys(page);
    const enter = pressed.filter((key) => key.key === 'Enter').at(-1)!;
    const [request] = await searchRequests(page);
    expect(request!.start - enter.t).toBeLessThan(250);

    await page.keyboard.press('Escape');
    await expect(field(page)).toHaveValue('');
    await expect(field(page)).toBeFocused();
    expect(new URL(page.url()).searchParams.get('q') ?? '').toBe('');
    await expect(page.getByText('Search for movies and shows')).toBeVisible();
    await expect(page.getByRole('link', { name: /The Stub Matrix/ })).toHaveCount(0);
    await sleep(page, 600);
    expect(queries).toEqual(['stub']);
  });

  test('shows q on /search and is empty everywhere else, also after Back and Forward', async ({ page }) => {
    await page.goto('/search?q=stub');
    await expect(field(page)).toHaveValue('stub');
    await page.getByRole('link', { name: /The Stub Matrix/ }).click();
    await expect(page).toHaveURL(/\/movie\/603$/);
    await expect(field(page)).toHaveValue('');
    await page.goBack();
    await expect(page).toHaveURL(/\/search\?q=stub$/);
    await expect(field(page)).toHaveValue('stub');
    await expect(page.getByRole('link', { name: /The Stub Matrix/ })).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(/\/movie\/603$/);
    await expect(field(page)).toHaveValue('');
    await mainNav(page).getByRole('link', { name: 'Home' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(field(page)).toHaveValue('');
  });

  test('makes no search request before typing, on any page, and none goes to the gateway', async ({
    page,
    request,
  }) => {
    await request.delete(`${HUB}/__requests`);
    const queries = watchSearch(page);
    for (const path of ['/', '/movie/603', '/tv/1399', '/settings']) {
      await page.goto(path);
      await expect(mainNav(page)).toBeVisible();
      await field(page).click();
      await sleep(page, 500);
      expect(queries, path).toEqual([]);
    }
    expect(await hubSearches(page)).toEqual([]);

    await page.goto('/');
    await field(page).click();
    await page.keyboard.type('stub');
    await expect(page.getByRole('link', { name: /The Stub Matrix/ })).toBeVisible();
    expect((await hubSearches(page)).every((query) => query === 'stub')).toBe(true);
    const log = (await (await request.get(`${HUB}/__requests`)).json()) as { requests: Array<{ path: string }> };
    expect(log.requests.filter((entry) => /\/stream\//.test(entry.path))).toEqual([]);
  });

  test('is in the DOM when Home content is marked, and loads only the Search chunk on first use', async ({ page }) => {
    const scripts: string[] = [];
    page.on('request', (request) => {
      if (request.resourceType() === 'script') scripts.push(new URL(request.url()).pathname);
    });
    await page.goto('/');
    await page.waitForFunction(() => performance.getEntriesByName('hs:home-content').length > 0);
    await expect(field(page)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Trending Movies' })).toBeVisible();
    const loaded = scripts.length;

    await field(page).click();
    await page.keyboard.type('stub');
    await expect(page.getByRole('link', { name: /The Stub Matrix/ })).toBeVisible();
    const added = scripts.slice(loaded);
    expect(added.some((script) => /SearchPage/.test(script))).toBe(true);
    for (const script of added)
      expect(script).not.toMatch(/Home|Movie|Show|Player|Settings|Dashboard|NotFound|telemetry/);
  });
});

test.describe('Dashboard link', () => {
  test('opens Health and stays active on every dashboard route, and only there', async ({ page }) => {
    const links = async () =>
      mainNav(page)
        .getByRole('link')
        .evaluateAll((all) => all.filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.textContent));
    await page.goto('/');
    await expect(mainNav(page).getByRole('link')).toHaveText(['Home', 'Dashboard', 'Settings']);
    expect(await links()).toEqual(['Home']);
    const homeColor = await mainNav(page)
      .getByRole('link', { name: 'Home' })
      .evaluate((a) => getComputedStyle(a).color);

    await mainNav(page).getByRole('link', { name: 'Dashboard' }).click();
    await expect(page).toHaveURL(/\/dashboard\/health$/);
    const tabs = page.getByRole('navigation', { name: 'Dashboard sections' });
    await expect(tabs.getByRole('link')).toHaveText(['Health', 'Activity', 'History', 'Graphs', 'Stats']);
    for (const tab of ['Activity', 'History', 'Graphs', 'Stats', 'Health']) {
      await tabs.getByRole('link', { name: tab }).click();
      await expect(page).toHaveURL(new RegExp(`/dashboard/${tab.toLowerCase()}$`));
      expect(await links(), tab).toEqual(['Dashboard']);
    }
    expect(
      await mainNav(page)
        .getByRole('link', { name: 'Dashboard' })
        .evaluate((a) => getComputedStyle(a).color),
    ).toBe(homeColor);

    await page.goto('/dashboard/graphs');
    expect(await links()).toEqual(['Dashboard']);
    for (const path of ['/settings', '/search']) {
      await page.goto(path);
      expect(await links(), path).not.toContain('Dashboard');
    }
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('shows an icon button that opens the field over the nav without moving anything', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Trending Movies' })).toBeVisible();
    await expect(page.getByRole('textbox')).toHaveCount(0);
    const icon = page.getByRole('button', { name: 'Search', exact: true });
    const box = (await icon.boundingBox())!;
    expect(Math.round(box.width)).toBe(38);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const nav = bar(page);
    const below = page.locator('main').first();
    const barBefore = (await nav.boundingBox())!;
    const belowBefore = (await below.boundingBox())!;

    await icon.click();
    await expect(field(page)).toBeFocused();
    const barAfter = (await nav.boundingBox())!;
    const belowAfter = (await below.boundingBox())!;
    expect(Math.abs(barAfter.height - barBefore.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(belowAfter.y - belowBefore.y)).toBeLessThanOrEqual(1);
    const input = (await field(page).boundingBox())!;
    expect(input.x).toBeGreaterThanOrEqual(barAfter.x);
    expect(input.y).toBeGreaterThanOrEqual(barAfter.y);
    expect(input.y + input.height).toBeLessThanOrEqual(barAfter.y + barAfter.height);

    await page.keyboard.type('stub th');
    await expect(page).toHaveURL(/\/search\?q=stub%20th$/);
    await expect(page.getByRole('link', { name: /Stub Thrones/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expect(icon).toBeVisible();
  });

  test('collapses again when the empty field loses focus', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(field(page)).toBeFocused();
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    await expect(page.getByRole('textbox')).toHaveCount(0);
  });
});

test.describe('at 700 px', () => {
  test.use({ viewport: { width: 700, height: 800 } });

  test('shows the full field and no icon button', async ({ page }) => {
    await page.goto('/');
    await expect(field(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Search', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

test.describe('in a browser and in the desktop window', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  const style = (locator: ReturnType<Page['locator']>) =>
    locator.evaluate((element) => {
      const css = getComputedStyle(element);
      return { region: css.getPropertyValue('-webkit-app-region').trim(), paddingRight: css.paddingRight };
    });

  test('a plain browser has no drag region and the normal padding', async ({ page }) => {
    await page.goto('/');
    const barStyle = await style(bar(page));
    expect(barStyle.region).not.toBe('drag');
    expect(barStyle.paddingRight).toBe('48px');
    const rect = (await field(page).boundingBox())!;
    expect(rect.width).toBeGreaterThanOrEqual(240);
    expect(rect.width).toBeLessThanOrEqual(520);
  });

  test.describe('with the desktop bridge (as the Electron preload sets it)', () => {
    test.use({ viewport: { width: 1024, height: 640 } });
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        (window as unknown as { homestream: unknown }).homestream = {
          isDesktop: true,
          isMiniPlayer: false,
          version: '0.0.0-e2e',
        };
      });
    });

    test('the nav drags the window, the controls do not, and 1024 x 640 still fits', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Trending Movies' })).toBeVisible();
      await field(page).click();
      await page.keyboard.type('a');
      await expect(page.getByRole('button', { name: 'Clear search' })).toBeVisible();

      const barStyle = await style(bar(page));
      expect(barStyle.region).toBe('drag');
      expect(barStyle.paddingRight).toBe('186px');
      const controls = [
        page.getByRole('link', { name: 'HomeStream home' }),
        mainNav(page).getByRole('link', { name: 'Home' }),
        mainNav(page).getByRole('link', { name: 'Dashboard' }),
        mainNav(page).getByRole('link', { name: 'Settings' }),
        field(page),
        field(page).locator('xpath=..'),
        page.getByRole('button', { name: 'Clear search' }),
        bar(page).getByRole('link', { name: /healthy|warning|problem|Checking|unreachable/ }),
      ];
      for (const control of controls) expect((await style(control)).region).toBe('no-drag');
      await expect(page.getByRole('button', { name: /^Search$|Search titles/ })).toHaveCount(0);

      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const settings = (await mainNav(page).getByRole('link', { name: 'Settings' }).boundingBox())!;
      const input = (await field(page).boundingBox())!;
      const pill = (await bar(page)
        .getByRole('link', { name: /healthy|warning|problem|Checking|unreachable/ })
        .boundingBox())!;
      expect(input.width).toBeGreaterThanOrEqual(240);
      expect(input.x).toBeGreaterThanOrEqual(settings.x + settings.width);
      expect(input.x + input.width).toBeLessThanOrEqual(pill.x);
      expect(pill.x + pill.width).toBeLessThanOrEqual(1024 - 138);
    });

    test('Ctrl+F and / focus the field on any page, and ? typed into it is text', async ({ page }) => {
      await page.goto('/settings');
      await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
      await page.keyboard.press('/');
      await expect(field(page)).toBeFocused();
      expect(new URL(page.url()).pathname).toBe('/settings');

      await page.locator('body').click({ position: { x: 5, y: 300 } });
      await expect(field(page)).not.toBeFocused();
      await page.keyboard.press('Control+f');
      await expect(field(page)).toBeFocused();
      expect(new URL(page.url()).pathname).toBe('/settings');

      await page.keyboard.type('a?');
      await expect(field(page)).toHaveValue('a?');
      await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveCount(0);
    });
  });
});
