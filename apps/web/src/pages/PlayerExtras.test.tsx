import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetToasts } from '../notices/toastStore';
import { resetPrefetchMemory } from '../player/sessionApi';
import { FakeHls } from '../test/fakeHls';
import { progress, season, session, showDetails } from '../test/fixtures';
import { openPlayer, startVideo, stubMedia } from '../test/player';
import { apiError } from '../test/render';

vi.mock('hls.js', async () => (await import('../test/fakeHls')).hlsModule);

beforeEach(() => {
  FakeHls.instances = [];
  FakeHls.isSupported = () => true;
  stubMedia();
  resetToasts();
  resetPrefetchMemory();
});
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 5));
  vi.unstubAllGlobals();
});

const videoOf = async () => (await screen.findByTestId('player-video')) as HTMLVideoElement;
const press = (key: string) => fireEvent.keyDown(document.body, { key });

describe('titles', () => {
  it('shows show title, episode code and episode name for an episode', async () => {
    openPlayer(
      {
        'GET /api/tv/1396': () => showDetails(),
        'GET /api/tv/1396/season/1': () => season(1, 3),
        'POST /api/sessions': () => Response.json(session(), { status: 201 }),
      },
      '/play/tv/1396/1/2',
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'Breaking Bad' })).toBeInTheDocument();
    expect(await screen.findByText(/S1E2 \u00b7 Episode title 2 \u00b7 2160p H\.264/)).toBeInTheDocument();
  });

  it('falls back to a plain title when the details cannot be loaded', async () => {
    openPlayer({ 'GET /api/movie/278': () => apiError(500, 'internal_error', 'Broken') });
    expect(await screen.findByRole('heading', { level: 1, name: 'HomeStream' })).toBeInTheDocument();
  });

  it('falls back for a show that cannot be loaded', async () => {
    openPlayer({ 'GET /api/tv/1396': () => apiError(500, 'internal_error', 'Broken') }, '/play/tv/1396/1/1');
    expect(await screen.findByRole('heading', { level: 1, name: 'HomeStream' })).toBeInTheDocument();
  });
});

describe('leaving the page', () => {
  it('sends a last ping with sendBeacon and ends the session when the page closes', async () => {
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon });
    const { calls } = openPlayer();
    startVideo(await videoOf(), 42);
    act(() => void window.dispatchEvent(new Event('pagehide')));
    expect(sendBeacon).toHaveBeenCalledWith('/api/sessions/s1/progress', expect.any(Blob));
    await waitFor(() => expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1));
    cleanup();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
  });

  it('sends no beacon position when the page closes before the video has metadata', async () => {
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon });
    const { calls } = openPlayer({}, '/play/movie/278?start=600');
    await videoOf();
    act(() => void window.dispatchEvent(new Event('pagehide')));
    expect(sendBeacon).not.toHaveBeenCalled();
    await waitFor(() => expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1));
  });

  it('keeps the session when the page is only frozen into the back/forward cache', async () => {
    const { calls } = openPlayer();
    await videoOf();
    const event = new Event('pagehide');
    Object.defineProperty(event, 'persisted', { value: true });
    act(() => void window.dispatchEvent(event));
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);
  });
});

describe('streams', () => {
  it('plays an HLS playlist natively when hls.js is not supported', async () => {
    FakeHls.isSupported = () => false;
    HTMLMediaElement.prototype.canPlayType = vi.fn((): CanPlayTypeResult => 'maybe');
    openPlayer({ 'POST /api/sessions': () => Response.json(session({ startPositionSec: 90 }), { status: 201 }) });
    const video = await videoOf();
    await waitFor(() => expect(video.getAttribute('src')).toBe('/hls/s1/index.m3u8'));
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(video.currentTime).toBe(90);
    expect(FakeHls.instances).toHaveLength(0);
  });

  it('says so when the browser cannot play HLS at all', async () => {
    FakeHls.isSupported = () => false;
    HTMLMediaElement.prototype.canPlayType = vi.fn((): CanPlayTypeResult => '');
    openPlayer();
    expect(await screen.findByTestId('player-error')).toHaveTextContent('This browser cannot play HLS video.');
  });

  it('shows Buffering while a reload brings the stream back, and not once it plays', async () => {
    openPlayer();
    const video = await videoOf();
    startVideo(video, 10);
    expect(screen.queryByTestId('player-busy')).not.toBeInTheDocument();
    act(() => void video.dispatchEvent(new Event('waiting')));
    expect(screen.getByTestId('player-busy')).toHaveTextContent('Buffering...');
    act(() => void video.dispatchEvent(new Event('playing')));
    expect(screen.queryByTestId('player-busy')).not.toBeInTheDocument();
  });
});

describe('tracks', () => {
  it('shows an error toast, and keeps playing, when an audio change is refused', async () => {
    const { calls } = openPlayer({
      'PATCH /api/sessions/s1': () =>
        apiError(409, 'audio_unavailable', 'That audio track is not available.', 'Pick another.'),
    });
    startVideo(await videoOf());
    const before = FakeHls.instances.length;
    fireEvent.click(screen.getByRole('button', { name: 'Audio' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /French/ }));
    expect(await screen.findByText('That audio track is not available.')).toBeInTheDocument();
    expect(screen.getByText('Pick another.')).toBeInTheDocument();
    expect(FakeHls.instances).toHaveLength(before);
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(1);
    expect(screen.queryByTestId('player-error')).not.toBeInTheDocument();
  });

  it('turns on the first text track with C when the session starts with subtitles off', async () => {
    openPlayer({
      'POST /api/sessions': () =>
        Response.json(session({ selectedSubtitle: null, subtitleDefault: null }), { status: 201 }),
    });
    startVideo(await videoOf());
    await act(async () => FakeHls.last.emit('hlsSubtitleTracksUpdated'));
    expect(FakeHls.last.subtitleTrack).toBe(-1);
    press('c');
    expect(FakeHls.last.subtitleTrack).toBe(1);
  });

  it('does nothing when the chosen track is already selected, and omits Audio for a title without audio info', async () => {
    const { calls } = openPlayer({
      'POST /api/sessions': () =>
        Response.json(session({ audioTracks: [], selectedAudioIndex: null }), { status: 201 }),
    });
    startVideo(await videoOf());
    expect(screen.queryByRole('button', { name: 'Audio' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Subtitles' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'English' }));
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(0);
  });

  it('closes an open menu on a press outside it', async () => {
    openPlayer();
    startVideo(await videoOf());
    fireEvent.click(screen.getByRole('button', { name: 'Subtitles' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByTestId('player-video'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('mouse and keys on the video', () => {
  it('clicking toggles play and a double click goes fullscreen', async () => {
    openPlayer();
    const video = await videoOf();
    startVideo(video);
    fireEvent.click(video);
    expect(video.paused).toBe(true);
    const request = vi.fn(() => Promise.resolve());
    screen.getByTestId('player-stage').requestFullscreen = request;
    fireEvent.doubleClick(video);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not repeat toggles when a key is held, and swallows the Space key up', async () => {
    openPlayer();
    const video = await videoOf();
    startVideo(video);
    fireEvent.keyDown(document.body, { key: ' ', repeat: true });
    expect(video.paused).toBe(false);
    const up = new KeyboardEvent('keyup', { key: ' ', cancelable: true, bubbles: true });
    document.body.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(true);
  });

  it('the big play button starts a paused video', async () => {
    openPlayer();
    const video = await videoOf();
    startVideo(video);
    press('k');
    fireEvent.click(screen.getAllByRole('button', { name: 'Play' })[0]!);
    expect(video.paused).toBe(false);
  });
});

describe('player route progress', () => {
  it('does not ask for the saved progress itself', async () => {
    const { calls } = openPlayer({ 'GET /api/progress/movie:278': () => progress() });
    await videoOf();
    expect(calls.filter((call) => call.path.includes('/progress/') && call.method === 'GET')).toHaveLength(0);
  });
});
