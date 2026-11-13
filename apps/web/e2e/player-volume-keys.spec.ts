import { expect, test, type Page } from '@playwright/test';

// No playback session is started: POST /api/sessions is answered by the browser and the HLS requests are held, as in
// player-input.spec.ts. Real Chromium is needed because only a real range input steps itself on the arrow keys.

const SESSION = {
  sessionId: 'e2e-volume',
  playlistUrl: '/hls/e2e-volume/index.m3u8',
  mediaPlaylistUrl: '/hls/e2e-volume/video.m3u8',
  durationSec: 8160,
  startPositionSec: 0,
  state: 'ready',
  decision: {
    videoCodec: 'h264',
    width: 1920,
    height: 1080,
    dynamicRange: 'sdr',
    toneMapped: false,
    audioCodec: 'aac',
    audioChannels: 2,
    subtitleBurnIn: false,
    sourceVideo: { codec: 'h264', width: 1920, height: 1080, hdr: 'sdr' },
    sourceAudio: { codec: 'aac', channels: 2 },
  },
  audioTracks: [{ index: 0, codec: 'aac', channels: 2, language: 'eng', title: '', default: true }],
  subtitleTracks: [],
  selectedAudioIndex: 0,
  selectedSubtitle: null,
  subtitleDefault: 'english',
  streamId: 'stream-1',
  attempts: [],
  encoder: { fps: 60, speed: 2, bitrateKbps: 8000, outTimeSec: 0, headSegment: 0 },
  error: null,
};

async function openHeldPlayer(page: Page) {
  // jsdom and a media-less <video> cannot seek, so the seek shortcuts are counted at the setter instead.
  await page.addInitScript(() => {
    const seeks: number[] = [];
    Object.assign(window, { __seeks: seeks });
    const original = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
    if (!original?.set) throw new Error('currentTime has no setter');
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
      configurable: true,
      get: original.get,
      set(value: number) {
        seeks.push(value);
        original.set?.call(this, value);
      },
    });
  });
  await page.route('**/api/sessions', (route) =>
    route.request().method() === 'POST' ? route.fulfill({ status: 201, json: SESSION }) : route.fallback(),
  );
  await page.route('**/api/sessions/e2e-volume**', (route) => route.fulfill({ status: 204 }));
  await page.route('**/hls/**', () => new Promise<void>(() => undefined));
  await page.goto('/play/movie/603');
  await expect(page.getByTestId('player-busy')).toContainText('Buffering');
}

const setVolume = (page: Page, volume: number) =>
  page.getByTestId('player-video').evaluate((video, value) => ((video as HTMLVideoElement).volume = value), volume);
const seeksOf = (page: Page) => page.evaluate(() => (window as unknown as { __seeks: number[] }).__seeks.length);

// The slider is controlled by the video's volumechange event. Each press waits for the re-rendered slider value, so
// the next press never starts from a value React has not painted yet.
test.describe('arrow keys in the player (real Chromium)', () => {
  test('the focused volume slider takes the arrows and nothing seeks', async ({ page }) => {
    await openHeldPlayer(page);
    const slider = page.getByRole('slider', { name: 'Volume' });
    await setVolume(page, 0.5);
    await expect(slider).toHaveValue('0.5');
    await slider.focus();

    for (const [key, value] of [
      ['ArrowRight', '0.51'],
      ['ArrowUp', '0.52'],
      ['ArrowLeft', '0.51'],
      ['ArrowDown', '0.5'],
    ] as const) {
      await page.keyboard.press(key);
      await expect(slider).toHaveValue(value);
    }
    expect(await seeksOf(page)).toBe(0);
  });

  test('with focus elsewhere the arrows still seek and step the volume by 0.05', async ({ page }) => {
    await openHeldPlayer(page);
    const slider = page.getByRole('slider', { name: 'Volume' });
    await setVolume(page, 0.5);
    await expect(slider).toHaveValue('0.5');
    await slider.blur();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => seeksOf(page)).toBe(2);
    await page.keyboard.press('ArrowUp');
    await expect(slider).toHaveValue('0.55');
  });
});
