import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

// No playback session is ever started: POST /api/sessions and the HLS requests are answered or held by the browser, so
// the isolated server never sees them. Only the layout is under test, because jsdom cannot hit-test CSS.

const SESSION = {
  sessionId: 'e2e-held',
  playlistUrl: '/hls/e2e-held/index.m3u8',
  mediaPlaylistUrl: '/hls/e2e-held/video.m3u8',
  durationSec: 8160,
  startPositionSec: 0,
  state: 'ready',
  decision: {
    videoCodec: 'h264',
    width: 2560,
    height: 1440,
    dynamicRange: 'sdr',
    toneMapped: false,
    audioCodec: 'aac',
    audioChannels: 2,
    subtitleBurnIn: false,
    sourceVideo: { codec: 'hevc', width: 2560, height: 1440, hdr: 'sdr' },
    sourceAudio: { codec: 'eac3', channels: 6 },
  },
  audioTracks: [{ index: 0, codec: 'eac3', channels: 6, language: 'eng', title: '', default: true }],
  subtitleTracks: [],
  selectedAudioIndex: 0,
  selectedSubtitle: null,
  subtitleDefault: 'english',
  streamId: 'stream-1',
  attempts: [],
  encoder: { fps: 60, speed: 2, bitrateKbps: 8000, outTimeSec: 0, headSegment: 0 },
  error: null,
};

/** True when a pointer press at the centre of the element lands on it (or inside it) and not on a layer above. */
function receivesPointer(target: Locator): Promise<boolean> {
  return target.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return hit !== null && element.contains(hit);
  });
}

async function answer(page: Page, sessionReply: (route: Route) => Promise<void> | void) {
  const posts: string[] = [];
  await page.route('**/api/sessions', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    posts.push(route.request().url());
    return sessionReply(route);
  });
  // The end of a held session must not reach the real server either.
  await page.route('**/api/sessions/e2e-held**', (route) => route.fulfill({ status: 204 }));
  return posts;
}

test.describe('player controls under the busy overlay (real Chromium hit-testing)', () => {
  test('Back works while the session is starting', async ({ page }) => {
    await answer(page, () => new Promise<void>(() => undefined));
    await page.goto('/play/movie/603');
    await expect(page.getByTestId('player-busy')).toContainText('Starting playback');
    const back = page.getByRole('button', { name: 'Back', exact: true });
    expect(await receivesPointer(back)).toBe(true);
    await back.click();
    await expect(page).toHaveURL(/\/movie\/603$/);
  });

  test('Play or Pause, the seek bar and Back work while the stream is buffering', async ({ page }) => {
    await answer(page, (route) => route.fulfill({ status: 201, json: SESSION }));
    await page.route('**/hls/**', () => new Promise<void>(() => undefined));
    await page.goto('/play/movie/603');
    await expect(page.getByTestId('player-busy')).toContainText('Buffering');
    const toggle = page.getByRole('button', { name: /^(Play|Pause)$/ });
    const seek = page.getByRole('slider', { name: 'Seek' });
    expect(await receivesPointer(toggle)).toBe(true);
    expect(await receivesPointer(seek)).toBe(true);
    expect(await receivesPointer(page.getByRole('button', { name: 'Back', exact: true }))).toBe(true);
    const before = await toggle.getAttribute('aria-label');
    await toggle.click();
    await expect(toggle).not.toHaveAttribute('aria-label', before ?? '');
  });

  test('the failure card keeps its actions clickable', async ({ page }) => {
    const posts = await answer(page, (route) =>
      route.fulfill({
        status: 429,
        json: { error: { code: 'too_many_sessions', message: 'Two streams are already playing.', hint: 'Stop one.' } },
      }),
    );
    await page.goto('/play/movie/603');
    const card = page.getByTestId('player-error');
    await expect(card).toContainText('Two streams are already playing.');
    const retry = card.getByRole('button', { name: 'Retry' });
    expect(await receivesPointer(retry)).toBe(true);
    expect(await receivesPointer(card.getByRole('button', { name: 'Back to details' }))).toBe(true);
    expect(await receivesPointer(card.getByRole('link', { name: 'Open Health dashboard' }))).toBe(true);
    await retry.click();
    await expect.poll(() => posts.length).toBe(2);
  });
});
