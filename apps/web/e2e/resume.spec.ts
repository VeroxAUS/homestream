import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import ports from './ports.json' with { type: 'json' };

const dbFile = path.join(
  fileURLToPath(new URL('..', import.meta.url)),
  'reports',
  'e2e-run',
  'plain',
  'data',
  'homestream.db',
);
const ART = `http://127.0.0.1:${ports.tmdb}/img/t/p/w1280/backdrop.png`;
const DURATION_SEC = 8160;
const POSITION_SEC = 3722;

/** The server owns this database; the test writes the rows a played session would have left behind. */
function seed(rows: (db: DatabaseSync) => void): void {
  mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = new DatabaseSync(dbFile);
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('DELETE FROM progress; DELETE FROM plays;');
    rows(db);
  } finally {
    db.close();
  }
}

function saveMovie(db: DatabaseSync, positionSec: number, completed = false): void {
  const meta = JSON.stringify({ title: 'The Stub Matrix', posterUrl: ART, backdropUrl: ART });
  db.prepare(
    `INSERT INTO progress (media_key, tmdb_id, type, position_sec, duration_sec, updated_at, completed, hidden, meta_json)
     VALUES ('movie:603', 603, 'movie', ?, ?, ?, ?, 0, ?)`,
  ).run(positionSec, DURATION_SEC, Date.now(), completed ? 1 : 0, meta);
  db.prepare(
    `INSERT INTO plays (session_id, media_key, type, tmdb_id, title, started_at, ended_at, watched_sec, last_position_sec, duration_sec, completed)
     VALUES ('e2e-session', 'movie:603', 'movie', 603, 'The Stub Matrix', ?, ?, ?, ?, ?, ?)`,
  ).run(Date.now() - 60_000, Date.now(), positionSec, positionSec, DURATION_SEC, completed ? 1 : 0);
}

test.describe('continue watching and resume against the isolated server', () => {
  test.afterAll(() => seed(() => undefined));

  test('lists a partly watched movie first, as a wide card above the banner, with a progress bar', async ({ page }) => {
    seed((db) => saveMovie(db, POSITION_SEC));
    await page.goto('/');
    const row = page.getByRole('region', { name: 'Continue Watching' });
    await expect(row.getByText('The Stub Matrix')).toBeVisible();
    await expect(row.getByRole('progressbar', { name: 'The Stub Matrix progress' })).toHaveAttribute(
      'aria-valuenow',
      String(Math.round((POSITION_SEC / DURATION_SEC) * 100)),
    );
    const rowBox = await row.boundingBox();
    const banner = await page.getByLabel('Featured', { exact: true }).boundingBox();
    expect(rowBox).not.toBeNull();
    if (banner) expect(rowBox?.y).toBeLessThan(banner.y);
    const card = await row.getByRole('link', { name: /The Stub Matrix/ }).boundingBox();
    expect(card?.width).toBeGreaterThan(card?.height ?? 0);
  });

  test('details offers Resume and Start over; each starts the session at its own position', async ({ page }) => {
    seed((db) => saveMovie(db, POSITION_SEC));
    const bodies: Array<Record<string, unknown>> = [];
    await page.route('**/api/sessions', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      bodies.push(route.request().postDataJSON() as Record<string, unknown>);
      return route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'all_streams_failed', message: 'No streams in the stub.' } }),
      });
    });

    await page.goto('/movie/603');
    await expect(page.getByRole('link', { name: 'Resume from 1:02:02' })).toBeVisible();
    await page.getByRole('link', { name: 'Resume from 1:02:02' }).click();
    await expect(page.getByTestId('player-error')).toBeVisible();
    expect(bodies.at(-1)).toMatchObject({ startPositionSec: POSITION_SEC });

    await page.goto('/movie/603');
    await page.getByRole('link', { name: 'Start over' }).click();
    await expect(page.getByTestId('player-error')).toBeVisible();
    expect(bodies.at(-1)).toMatchObject({ startPositionSec: 0 });
  });

  test('a finished movie is not in the row and shows Play with a Watched mark', async ({ page, request }) => {
    seed((db) => saveMovie(db, DURATION_SEC * 0.95, true));
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Trending Movies' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Continue Watching' })).toHaveCount(0);
    expect(((await (await request.get('/api/continue-watching')).json()) as { items: unknown[] }).items).toEqual([]);

    await page.goto('/movie/603');
    await expect(page.getByRole('link', { name: 'Play' })).toBeVisible();
    await expect(page.getByText('Watched')).toBeVisible();
    await expect(page.getByText(/Resume from/)).toHaveCount(0);
  });

  test('removing a card calls DELETE, stays gone after a reload and keeps the history', async ({ page, request }) => {
    seed((db) => saveMovie(db, POSITION_SEC));
    await page.goto('/');
    const removal = page.waitForResponse(
      (response) => response.request().method() === 'DELETE' && response.url().includes('/api/continue-watching/'),
    );
    await page.getByRole('button', { name: 'Remove from Continue Watching' }).click();
    const response = await removal;
    expect(response.ok()).toBe(true);
    expect(new URL(response.url()).pathname).toBe('/api/continue-watching/movie%3A603');
    await expect(page.getByRole('region', { name: 'Continue Watching' })).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Trending Movies' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Continue Watching' })).toHaveCount(0);

    const history = (await (await request.get('/api/history')).json()) as { items: Array<{ mediaKey: string }> };
    expect(history.items.map((item) => item.mediaKey)).toContain('movie:603');
  });
});
