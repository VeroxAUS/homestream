import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetToasts } from '../notices/toastStore';
import { resetPrefetchMemory } from '../player/sessionApi';
import { download, movieDetails, session } from '../test/fixtures';
import { FakeHls } from '../test/fakeHls';
import { installBridge } from '../test/desktopBridge';
import { apiError } from '../test/render';
import { openPlayer, startVideo, stubMedia } from '../test/player';

vi.mock('hls.js', async () => (await import('../test/fakeHls')).hlsModule);

beforeEach(() => {
  FakeHls.instances = [];
  stubMedia();
  resetToasts();
  resetPrefetchMemory();
});
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 5));
  Reflect.deleteProperty(document, 'fullscreenElement');
  vi.unstubAllGlobals();
  delete window.homestream;
});

const videoOf = async () => (await screen.findByTestId('player-video')) as HTMLVideoElement;

describe('starting playback', () => {
  it('shows a starting state, then loads the master playlist from a session started with auto and no subtitle', async () => {
    const { calls } = openPlayer();
    expect(await screen.findByText('Starting playback...')).toBeInTheDocument();
    await videoOf();
    const posts = calls.filter((call) => call.method === 'POST' && call.path === '/api/sessions');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toMatchObject({ mediaType: 'movie', tmdbId: 278, streamId: 'auto' });
    expect(posts[0]?.body).not.toHaveProperty('subtitle');
    expect(FakeHls.last.source).toBe('/hls/s1/index.m3u8');
    expect(calls.some((call) => call.path.startsWith('/api/streams'))).toBe(false);
  });

  it('shows the title, the year and the output summary in the top bar, and no stream picker', async () => {
    openPlayer();
    await videoOf();
    expect(await screen.findByRole('heading', { level: 1, name: 'The Shawshank Redemption' })).toBeInTheDocument();
    expect(await screen.findByText('1994 \u00b7 2160p H.264')).toBeInTheDocument();
    expect(screen.queryByText(/Choose stream|Pick another stream|Recommended/i)).not.toBeInTheDocument();
  });

  it('resumes from ?start= by asking the server for that position', async () => {
    const { calls } = openPlayer({}, '/play/movie/278?start=3722');
    await videoOf();
    expect(calls.find((call) => call.path === '/api/sessions')?.body).toMatchObject({ startPositionSec: 3722 });
    expect(FakeHls.last.config).toMatchObject({ startPosition: 0 });
  });

  it('starts the stream at the position the server reports', async () => {
    openPlayer({ 'POST /api/sessions': Response.json(session({ startPositionSec: 3722 }), { status: 201 }) });
    await videoOf();
    expect(FakeHls.last.config).toMatchObject({ startPosition: 3722 });
  });

  it('starts an episode with season and episode', async () => {
    const { calls } = openPlayer({}, '/play/tv/1396/1/2');
    await videoOf();
    expect(calls.find((call) => call.path === '/api/sessions')?.body).toMatchObject({
      mediaType: 'tv',
      tmdbId: 1396,
      season: 1,
      episode: 2,
    });
  });
});

describe('start failures', () => {
  it.each([
    [502, 'all_streams_failed', 'Every stream failed.', 'Open the health dashboard.'],
    [409, 'torbox_slots_full', 'TorBox has no free download slots.', 'Wait or free a slot.'],
    [502, 'download_failed', "TorBox couldn't download this title.", 'Try another title.'],
    [502, 'gateway_unreachable', 'The gateway is unreachable.', 'Check the network.'],
  ])('shows message, hint, Retry, Back and a health link for %i %s', async (status, code, message, hint) => {
    const failure = () => apiError(status, code, message, hint);
    const { calls } = openPlayer({ 'POST /api/sessions': failure });
    const card = await screen.findByTestId('player-error');
    expect(card).toHaveTextContent(message);
    expect(card).toHaveTextContent(hint);
    expect(card).not.toHaveTextContent(/stream-\d|attempts/i);
    expect(screen.getByRole('link', { name: 'Open Health dashboard' })).toHaveAttribute('href', '/dashboard/health');
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
    expect(screen.queryByTestId('player-busy')).not.toBeInTheDocument();

    const before = calls.filter((call) => call.path === '/api/sessions').length;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(calls.filter((call) => call.path === '/api/sessions')).toHaveLength(before + 1));
  });

  it('starts playback when Retry succeeds', async () => {
    let attempts = 0;
    openPlayer({
      'POST /api/sessions': () =>
        ++attempts === 1
          ? apiError(502, 'all_streams_failed', 'Every stream failed.')
          : Response.json(session(), { status: 201 }),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('player-video')).toBeInTheDocument();
  });

  it('says the server is unreachable when the request fails', async () => {
    openPlayer({ 'POST /api/sessions': new TypeError('network') });
    expect(await screen.findByTestId('player-error')).toHaveTextContent('Cannot reach the HomeStream server.');
  });

  it('leaves with Back to details from the error card', async () => {
    openPlayer({ 'POST /api/sessions': apiError(502, 'all_streams_failed', 'Every stream failed.') });
    fireEvent.click(await screen.findByRole('button', { name: 'Back to details' }));
    await waitFor(() => expect(screen.queryByTestId('player-stage')).not.toBeInTheDocument());
    expect(await screen.findByRole('heading', { level: 1, name: 'The Shawshank Redemption' })).toBeInTheDocument();
  });
});

describe('downloading (HTTP 202)', () => {
  it('shows the notice, returns to the details page and never opens the player', async () => {
    openPlayer({
      'POST /api/sessions': () => Response.json({ status: 'downloading', download: download() }, { status: 202 }),
      'GET /api/movie/278': () => movieDetails({ download: download() }),
    });
    expect(await screen.findByText('Downloading, try again later')).toBeInTheDocument();
    expect(
      screen.getByText("TorBox is caching The Shawshank Redemption. We'll let you know when it's ready."),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('player-stage')).not.toBeInTheDocument());
    expect(await screen.findByRole('heading', { level: 1, name: 'The Shawshank Redemption' })).toBeInTheDocument();
    expect(screen.getByText('Downloading 42%')).toBeInTheDocument();
  });
});

describe('leaving', () => {
  it('Back sends a last ping, ends the session with DELETE and returns to the details page', async () => {
    const { calls } = openPlayer();
    startVideo(await videoOf(), 61);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(screen.queryByTestId('player-stage')).not.toBeInTheDocument());
    await waitFor(() =>
      expect(calls.some((call) => call.method === 'DELETE' && call.path === '/api/sessions/s1')).toBe(true),
    );
    const deletes = calls.filter((call) => call.method === 'DELETE');
    expect(deletes).toHaveLength(1);
    const lastPing = calls.filter((call) => call.path === '/api/sessions/s1/progress').at(-1);
    expect(lastPing?.body).toMatchObject({ positionSec: 61, state: 'paused' });
  });

  it('ends a session that arrives after the player was left', async () => {
    let release: (value: Response) => void = () => undefined;
    const late = new Promise<Response>((resolve) => (release = resolve));
    const { calls } = openPlayer({ 'POST /api/sessions': () => late });
    fireEvent.click(await screen.findByRole('button', { name: 'Back' }));
    await waitFor(() => expect(screen.queryByTestId('player-stage')).not.toBeInTheDocument());
    await act(async () => release(Response.json(session(), { status: 201 })));
    await waitFor(() =>
      expect(calls.some((call) => call.method === 'DELETE' && call.path === '/api/sessions/s1')).toBe(true),
    );
  });
});

describe('progress pings', () => {
  it('pings every 10 s while playing, and on pause and on seek', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
    try {
      const { calls } = openPlayer();
      const video = (await vi.waitUntil(() => screen.queryByTestId('player-video'))) as HTMLVideoElement;
      startVideo(video, 5);
      const pings = () => calls.filter((call) => call.path === '/api/sessions/s1/progress');
      await act(() => vi.advanceTimersByTimeAsync(10_000));
      expect(pings()).toHaveLength(1);
      expect(pings()[0]?.body).toMatchObject({ positionSec: 5, state: 'playing' });
      await act(() => vi.advanceTimersByTimeAsync(10_000));
      expect(pings()).toHaveLength(2);
      act(() => video.pause());
      expect(pings().at(-1)?.body).toMatchObject({ state: 'paused' });
      act(() => {
        video.currentTime = 90;
        video.dispatchEvent(new Event('seeked'));
      });
      expect(pings()).toHaveLength(4);
      await act(() => vi.advanceTimersByTimeAsync(30_000));
      expect(pings()).toHaveLength(4);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('playback failures', () => {
  it('shows the failure card for a fatal stream error and starts again from the same position with Try again', async () => {
    const { calls } = openPlayer();
    startVideo(await videoOf(), 300);
    act(() => FakeHls.last.emit('hlsError', { fatal: true, type: 'networkError', details: 'fragLoadError' }));
    const card = await screen.findByTestId('player-error');
    expect(card).toHaveTextContent('The server stopped sending video.');
    expect(screen.getByRole('link', { name: 'Open Health dashboard' })).toHaveAttribute('href', '/dashboard/health');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(calls.filter((call) => call.path === '/api/sessions' && call.method === 'POST')).toHaveLength(2),
    );
    expect(calls.filter((call) => call.path === '/api/sessions' && call.method === 'POST')[1]?.body).toMatchObject({
      startPositionSec: 300,
    });
  });

  it('recovers media errors twice before giving up', async () => {
    openPlayer();
    await videoOf();
    const media = { fatal: true, type: 'mediaError', details: 'bufferStalled' };
    act(() => FakeHls.last.emit('hlsError', media));
    act(() => FakeHls.last.emit('hlsError', media));
    expect(FakeHls.last.recoverMediaError).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('player-error')).not.toBeInTheDocument();
    act(() => FakeHls.last.emit('hlsError', media));
    expect(await screen.findByTestId('player-error')).toHaveTextContent('could not be decoded');
  });

  it('ignores non-fatal errors', async () => {
    openPlayer();
    await videoOf();
    act(() => FakeHls.last.emit('hlsError', { fatal: false, type: 'networkError', details: 'fragLoadError' }));
    expect(screen.queryByTestId('player-error')).not.toBeInTheDocument();
  });
});

describe('desktop window', () => {
  it('keeps the top bar clear of the caption buttons only in the desktop window and not in fullscreen', async () => {
    installBridge();
    openPlayer();
    await videoOf();
    expect(screen.getByTestId('player-topbar').className).toContain('topDesktop');
    const stage = screen.getByTestId('player-stage');
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => stage });
    act(() => {
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    expect(screen.getByTestId('player-topbar').className).not.toContain('topDesktop');
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null });
  });

  it('keeps 32 px padding in a plain browser', async () => {
    openPlayer();
    await videoOf();
    expect(screen.getByTestId('player-topbar').className).not.toContain('topDesktop');
  });

  it('also clears the caption buttons on the loading and error screens', async () => {
    installBridge();
    openPlayer({ 'POST /api/sessions': apiError(502, 'all_streams_failed', 'Every stream failed.') });
    await screen.findByTestId('player-error');
    expect(screen.getByTestId('player-topbar').className).toContain('topDesktop');
  });
});
