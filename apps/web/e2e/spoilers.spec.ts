import type { DatabaseSync } from 'node:sqlite';
import { expect, test, type Locator, type Page } from '@playwright/test';
import ports from './ports.json' with { type: 'json' };
import { seed } from './support/seed';

const IMG = `http://127.0.0.1:${ports.tmdb}/img/t/p`;
const STILL = `${IMG}/w300/still.png`;
const BACKDROP = `${IMG}/w1280/backdrop.png`;
const PLACEHOLDER = "Hidden to avoid spoilers. It appears once you've watched this episode.";
const OVERVIEWS = [
  'The stub family gathers at the stub castle.',
  'A stub journey begins along the stub road.',
  'Lord Stub makes a surprising stub decision.',
  'An episode that has no still image.',
];

interface Saved {
  episode: number;
  positionSec: number;
  durationSec: number;
  completed: boolean;
}

function saveEpisode(db: DatabaseSync, saved: Saved): void {
  const meta = JSON.stringify({
    title: 'Stub Thrones',
    showTitle: 'Stub Thrones',
    episodeTitle: `Episode ${saved.episode}`,
    posterUrl: `${IMG}/w500/poster.png`,
    backdropUrl: STILL,
  });
  db.prepare(
    `INSERT INTO progress (media_key, tmdb_id, type, season, episode, position_sec, duration_sec, updated_at, completed, hidden, meta_json)
     VALUES (?, 1399, 'tv', 1, ?, ?, ?, ?, ?, 0, ?)`,
  ).run(
    `tv:1399:1:${saved.episode}`,
    saved.episode,
    saved.positionSec,
    saved.durationSec,
    Date.now() - 10_000 + saved.episode * 1000,
    saved.completed ? 1 : 0,
    meta,
  );
}

const finished = (episode: number): Saved => ({ episode, positionSec: 2900, durationSec: 3000, completed: true });
const started = (episode: number): Saved => ({ episode, positionSec: 600, durationSec: 3000, completed: false });
const seedEpisodes = (...rows: Saved[]) => seed((db) => rows.forEach((row) => saveEpisode(db, row)));

const rowOf = (page: Page, episode: number) => page.locator(`li[data-episode="${episode}"]`);
const panelOf = (page: Page) => page.getByRole('complementary', { name: 'Selected episode' });
const navLink = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true });
const stillSrc = (scope: Locator) => scope.locator('img').first().getAttribute('src');

async function openShow(page: Page): Promise<void> {
  await page.goto('/tv/1399');
  await expect(rowOf(page, 4)).toBeVisible();
}

async function filtersUpTo(scope: Locator): Promise<string[]> {
  return scope.evaluate((element) => {
    const found: string[] = [];
    for (let node: Element | null = element; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      found.push(`${style.filter}|${style.backdropFilter}`);
    }
    return found;
  });
}

test.describe('spoiler protection', () => {
  test.afterAll(() => seed(() => undefined));

  test('is on by default in Settings and hides every unfinished episode in the list and the panel', async ({
    page,
  }) => {
    seed(() => undefined);
    await page.goto('/settings');
    const toggle = page.getByRole('switch', { name: 'Hide episode spoilers' });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText("Blurs stills and hides descriptions of episodes you haven't finished")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('homestream.hideSpoilers'))).toBeNull();

    await openShow(page);
    for (const episode of [1, 2, 3]) {
      const row = rowOf(page, episode);
      await expect(row.getByText(PLACEHOLDER)).toBeVisible();
      expect(await stillSrc(row)).toBe(`${IMG}/w92/still.png`);
      const box = await row.locator('img').boundingBox();
      expect(Math.abs((box?.width ?? 0) - 232)).toBeLessThanOrEqual(2);
      expect(Math.abs((box?.height ?? 0) - 130)).toBeLessThanOrEqual(2);
      expect(await row.locator('img').evaluate((img) => getComputedStyle(img).objectFit)).toBe('cover');
      expect(new Set(await filtersUpTo(row.locator('img')))).toEqual(new Set(['none|none']));
    }
    await expect(rowOf(page, 1)).toContainText('Winter Stub');
    await expect(rowOf(page, 1)).toContainText('58 min');
    expect(await stillSrc(rowOf(page, 4))).toBe(`${IMG}/w300/backdrop.png`);
    await expect(rowOf(page, 4).getByText(PLACEHOLDER)).toBeVisible();

    await expect(panelOf(page).getByText(PLACEHOLDER)).toBeVisible();
    expect(await stillSrc(panelOf(page))).toBe(`${IMG}/w92/still.png`);

    const html = await page.evaluate(() => document.documentElement.outerHTML);
    for (const overview of OVERVIEWS) expect(html).not.toContain(overview);

    await page.goto('/movie/603');
    await expect(page.getByText('A stub film.').first()).toBeVisible();
  });

  test('keeps an in-progress episode hidden, shows a finished one in full, and reveals one finished later', async ({
    page,
  }) => {
    seedEpisodes(finished(1), started(2));
    await openShow(page);
    await expect(rowOf(page, 1)).toContainText(OVERVIEWS[0] ?? '');
    expect(await stillSrc(rowOf(page, 1))).toBe(STILL);
    await expect(panelOf(page)).toContainText(OVERVIEWS[0] ?? '');
    expect(await stillSrc(panelOf(page))).toBe(STILL);

    await expect(rowOf(page, 2).getByRole('progressbar', { name: 'Episode 2 progress' })).toBeVisible();
    await expect(rowOf(page, 2).getByText(PLACEHOLDER)).toBeVisible();
    expect(await stillSrc(rowOf(page, 2))).toBe(`${IMG}/w92/still.png`);
    await expect(rowOf(page, 3).getByText(PLACEHOLDER)).toBeVisible();
    await rowOf(page, 2).getByRole('button').first().click();
    await expect(panelOf(page).getByText(PLACEHOLDER)).toBeVisible();

    const origin = await page.evaluate(() => performance.timeOrigin);
    seedEpisodes(finished(1), finished(2));
    await navLink(page, 'Home').click();
    await page
      .getByRole('main')
      .getByRole('link', { name: /Stub Thrones/ })
      .first()
      .click();
    await expect(rowOf(page, 4)).toBeVisible();
    await expect(rowOf(page, 2)).toContainText(OVERVIEWS[1] ?? '');
    expect(await stillSrc(rowOf(page, 2))).toBe(STILL);
    await expect(rowOf(page, 3).getByText(PLACEHOLDER)).toBeVisible();
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);
  });

  test('turning the setting off reveals everything at once without a reload, and it stays on this device', async ({
    page,
    browser,
  }) => {
    seedEpisodes(finished(1), started(2));
    await openShow(page);
    await expect(rowOf(page, 3).getByText(PLACEHOLDER)).toBeVisible();
    const origin = await page.evaluate(() => performance.timeOrigin);
    const writes: string[] = [];
    let watching = false;
    page.on('request', (request) => {
      if (watching && request.url().includes('/api/') && request.method() !== 'GET') writes.push(request.method());
    });
    const flip = async () => {
      watching = true;
      await page.getByRole('switch', { name: 'Hide episode spoilers' }).click();
      await page.waitForTimeout(300);
      watching = false;
    };

    await navLink(page, 'Settings').click();
    await flip();
    expect(await page.evaluate(() => localStorage.getItem('homestream.hideSpoilers'))).toBe('off');
    await page.goBack();
    await expect(rowOf(page, 4)).toBeVisible();

    for (const [index, overview] of OVERVIEWS.slice(0, 3).entries()) {
      await expect(rowOf(page, index + 1)).toContainText(overview);
      expect(await stillSrc(rowOf(page, index + 1))).toBe(STILL);
    }
    await expect(page.getByText(PLACEHOLDER)).toHaveCount(0);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);

    await navLink(page, 'Home').click();
    const card = page.getByRole('region', { name: 'Continue Watching' }).getByRole('link', { name: /Stub Thrones/ });
    expect(await stillSrc(card)).toBe(STILL);

    await page.reload();
    expect(await page.evaluate(() => localStorage.getItem('homestream.hideSpoilers'))).toBe('off');

    await page.goto('/settings');
    await flip();
    await navLink(page, 'Home').click();
    expect(await stillSrc(card)).toBe(`${IMG}/w92/still.png`);
    expect(writes).toEqual([]);

    const other = await browser.newContext({ baseURL: `http://127.0.0.1:${ports.serverPlain}` });
    const second = await other.newPage();
    await second.goto('/settings');
    await expect(second.getByRole('switch', { name: 'Hide episode spoilers' })).toHaveAttribute('aria-checked', 'true');
    await other.close();
  });

  test('Continue Watching episode cards, Up next included, use the w92 still; movies keep their backdrop', async ({
    page,
  }) => {
    seed((db) => {
      saveEpisode(db, started(2));
      db.prepare(
        `INSERT INTO progress (media_key, tmdb_id, type, position_sec, duration_sec, updated_at, completed, hidden, meta_json)
         VALUES ('movie:603', 603, 'movie', 1200, 8160, ?, 0, 0, ?)`,
      ).run(Date.now(), JSON.stringify({ title: 'The Stub Matrix', posterUrl: BACKDROP, backdropUrl: BACKDROP }));
    });
    await page.goto('/');
    const row = page.getByRole('region', { name: 'Continue Watching' });
    const episode = row.getByRole('link', { name: /Stub Thrones/ });
    await expect(episode).toBeVisible();
    expect(await stillSrc(episode)).toBe(`${IMG}/w92/still.png`);
    const box = await episode.locator('img').boundingBox();
    expect(Math.abs((box?.width ?? 0) - 340)).toBeLessThanOrEqual(2);
    expect(Math.abs((box?.height ?? 0) - 191)).toBeLessThanOrEqual(2);
    expect(new Set(await filtersUpTo(episode.locator('img')))).toEqual(new Set(['none|none']));
    expect(await stillSrc(row.getByRole('link', { name: /The Stub Matrix/ }))).toBe(`${IMG}/w780/backdrop.png`);

    seedEpisodes(finished(1));
    await page.reload();
    const upNext = page.getByRole('region', { name: 'Continue Watching' }).getByRole('link', { name: /Up next/ });
    await expect(upNext).toBeVisible();
    expect(await stillSrc(upNext)).toBe(`${IMG}/w92/still.png`);
  });
});
