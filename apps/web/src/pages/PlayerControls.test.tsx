import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetToasts } from '../notices/toastStore';
import { getPlayerSnapshot } from '../player/snapshot';
import { resetPrefetchMemory } from '../player/sessionApi';
import { FakeHls } from '../test/fakeHls';
import { session } from '../test/fixtures';
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
});

const GET_SESSION = { 'GET /api/sessions/s1': () => Response.json(session()) };

async function playing(routes: Parameters<typeof openPlayer>[0] = {}, positionSec = 100) {
  const api = openPlayer({ ...GET_SESSION, ...routes });
  const video = (await screen.findByTestId('player-video')) as HTMLVideoElement;
  startVideo(video, positionSec);
  act(() => FakeHls.last.emit('hlsSubtitleTracksUpdated'));
  return { ...api, video };
}

const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document.body, { key, ...init });
const stage = () => screen.getByTestId('player-stage');
const deletes = (calls: Array<{ method: string }>) => calls.filter((call) => call.method === 'DELETE').length;

describe('controls', () => {
  it('has play/pause, skip -10 s and +30 s, volume, mute, seek bar and fullscreen', async () => {
    const { video } = await playing();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(video.paused).toBe(true);
    fireEvent.click(screen.getAllByRole('button', { name: 'Play' }).at(-1)!);
    expect(video.paused).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '-10 s' }));
    expect(video.currentTime).toBe(90);
    fireEvent.click(screen.getByRole('button', { name: '+30 s' }));
    expect(video.currentTime).toBe(120);
    fireEvent.change(screen.getByRole('slider', { name: 'Volume' }), { target: { value: '0.3' } });
    expect(video.volume).toBeCloseTo(0.3);
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    expect(video.muted).toBe(true);
    act(() => {
      video.dispatchEvent(new Event('volumechange'));
    });
    expect(screen.getByRole('button', { name: 'Unmute' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Seek' })).toHaveAttribute('aria-valuemax', '8520');
    expect(screen.getByRole('button', { name: 'Fullscreen' })).toBeInTheDocument();
  });

  it('shows a big play button only while paused', async () => {
    await playing();
    expect(screen.queryByRole('button', { name: 'Play' })).not.toBeInTheDocument();
    press('k');
    expect(screen.getAllByRole('button', { name: 'Play' })).toHaveLength(2);
  });

  it('clamps seeks to the title', async () => {
    const { video } = await playing({}, 8510);
    fireEvent.click(screen.getByRole('button', { name: '+30 s' }));
    expect(video.currentTime).toBe(8520);
    video.currentTime = 4;
    fireEvent.click(screen.getByRole('button', { name: '-10 s' }));
    expect(video.currentTime).toBe(0);
  });
});

describe('keyboard shortcuts', () => {
  it('Space and K toggle play, arrows seek -10/+30 s and change volume by 0.05, M mutes', async () => {
    const { video } = await playing();
    press(' ');
    expect(video.paused).toBe(true);
    press('k');
    expect(video.paused).toBe(false);
    press('ArrowRight');
    expect(video.currentTime).toBe(130);
    press('ArrowLeft');
    expect(video.currentTime).toBe(120);
    video.volume = 0.5;
    press('ArrowUp');
    expect(video.volume).toBeCloseTo(0.55);
    press('ArrowDown');
    press('ArrowDown');
    expect(video.volume).toBeCloseTo(0.45);
    video.volume = 0.98;
    press('ArrowUp');
    expect(video.volume).toBe(1);
    press('m');
    expect(video.muted).toBe(true);
    press('m');
    expect(video.muted).toBe(false);
  });

  it('F asks for fullscreen on the stage', async () => {
    await playing();
    const request = vi.fn(() => Promise.resolve());
    stage().requestFullscreen = request;
    press('f');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('C turns the text subtitles off and brings back the same track', async () => {
    await playing();
    const hls = FakeHls.last;
    expect(hls.subtitleTrack).toBe(1);
    press('c');
    expect(hls.subtitleTrack).toBe(-1);
    press('c');
    expect(hls.subtitleTrack).toBe(1);
  });

  it('I opens and closes the info panel', async () => {
    await playing();
    press('i');
    expect(screen.getByTestId('player-info')).toBeInTheDocument();
    press('i');
    expect(screen.queryByTestId('player-info')).not.toBeInTheDocument();
  });

  it('Esc closes the menu, then the info panel, then leaves like Back', async () => {
    const { calls } = await playing();
    fireEvent.click(screen.getByRole('button', { name: 'Subtitles' }));
    press('i');
    expect(screen.getByRole('menu', { name: 'Subtitles' })).toBeInTheDocument();
    press('Escape');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByTestId('player-info')).toBeInTheDocument();
    press('Escape');
    expect(screen.queryByTestId('player-info')).not.toBeInTheDocument();
    expect(screen.getByTestId('player-stage')).toBeInTheDocument();
    press('Escape');
    await waitFor(() => expect(deletes(calls)).toBe(1));
    await waitFor(() => expect(screen.queryByTestId('player-stage')).not.toBeInTheDocument());
  });

  it('Esc leaves fullscreen before it leaves the player', async () => {
    const { calls } = await playing();
    const exit = vi.fn(() => Promise.resolve());
    document.exitFullscreen = exit;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => stage() });
    press('Escape');
    expect(exit).toHaveBeenCalledTimes(1);
    expect(deletes(calls)).toBe(0);
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null });
  });

  it('ignores keys typed into a text field and modified keys', async () => {
    const { video } = await playing();
    const field = document.createElement('input');
    document.body.append(field);
    fireEvent.keyDown(field, { key: ' ' });
    press(' ', { ctrlKey: true });
    expect(video.paused).toBe(false);
    field.remove();
  });
});

describe('subtitles and audio', () => {
  it('shows the server default subtitle as selected, and text tracks are chosen without a PATCH', async () => {
    const { calls } = await playing();
    fireEvent.click(screen.getByRole('button', { name: 'Subtitles' }));
    const menu = screen.getByRole('menu', { name: 'Subtitles' });
    expect(within(menu).getByRole('menuitemradio', { name: 'English' })).toHaveAttribute('aria-checked', 'true');
    expect(within(menu).getByRole('menuitemradio', { name: 'Off' })).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Spanish' }));
    expect(FakeHls.last.subtitleTrack).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Subtitles' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Off' }));
    expect(FakeHls.last.subtitleTrack).toBe(-1);
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(0);
  });

  it('keeps Off selected after the renditions are listed again', async () => {
    await playing({ 'POST /api/sessions': () => Response.json(session({ selectedSubtitle: null }), { status: 201 }) });
    expect(FakeHls.last.subtitleTrack).toBe(-1);
  });

  it('burns a bitmap track in with a PATCH and reloads at the same position, then leaving it sends subtitle null', async () => {
    const { calls } = await playing({}, 77);
    const before = FakeHls.instances.length;
    fireEvent.click(screen.getByRole('button', { name: 'Subtitles' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /English - PGS/ }));
    await waitFor(() => expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(1));
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ subtitle: { index: 2, mode: 'burn' } });
    await waitFor(() => expect(FakeHls.instances.length).toBe(before + 1));
    expect(FakeHls.last.config).toMatchObject({ startPosition: 77 });
    expect(FakeHls.last.source).toBe('/hls/s1/index.m3u8');
    act(() => FakeHls.last.emit('hlsSubtitleTracksUpdated'));
    expect(FakeHls.last.subtitleTrack).toBe(-1);

    fireEvent.click(screen.getByRole('button', { name: 'Subtitles' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'English' }));
    await waitFor(() => expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(2));
    expect(calls.filter((call) => call.method === 'PATCH')[1]?.body).toEqual({ subtitle: null });
    await waitFor(() => expect(FakeHls.instances.length).toBe(before + 2));
    act(() => FakeHls.last.emit('hlsSubtitleTracksUpdated'));
    expect(FakeHls.last.subtitleTrack).toBe(1);
  });

  it('switches audio with a PATCH and reloads the stream at the same position', async () => {
    const { calls } = await playing({}, 321);
    const before = FakeHls.instances.length;
    fireEvent.click(screen.getByRole('button', { name: 'Audio' }));
    const menu = screen.getByRole('menu', { name: 'Audio' });
    expect(within(menu).getByRole('menuitemradio', { name: /English/ })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: /French/ }));
    await waitFor(() => expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ audioIndex: 1 }));
    await waitFor(() => expect(FakeHls.instances.length).toBe(before + 1));
    expect(FakeHls.last.config).toMatchObject({ startPosition: 321 });
    expect(FakeHls.instances[before - 1]?.destroyed).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Audio' }));
    expect(screen.getByRole('menuitemradio', { name: /French/ })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('info panel', () => {
  it('shows the server decision: source, tone-mapped output, audio and encoder speed', async () => {
    await playing();
    fireEvent.click(screen.getByRole('button', { name: 'Info' }));
    expect(screen.getByTestId('info-source')).toHaveTextContent('2160p HEVC Dolby Vision');
    expect(screen.getByTestId('info-output')).toHaveTextContent('2160p H.264 SDR');
    expect(screen.getByTestId('info-output')).toHaveTextContent('tone-mapped');
    const panel = screen.getByTestId('player-info');
    expect(panel).toHaveTextContent('TrueHD 7.1');
    expect(panel).toHaveTextContent('AAC 2.0');
    expect(panel).toHaveTextContent('5.2x');
    expect(panel).toHaveTextContent('Subtitles');
    expect(panel).toHaveTextContent('text track');
  });

  it('reports no tone mapping for an SDR source', async () => {
    const sdr = session({
      decision: {
        ...session().decision,
        toneMapped: false,
        sourceVideo: { codec: 'h264', width: 1920, height: 1080, hdr: 'sdr' },
      },
    });
    await playing({ 'POST /api/sessions': () => Response.json(sdr, { status: 201 }) });
    press('i');
    expect(screen.getByTestId('info-output')).not.toHaveTextContent('tone-mapped');
    expect(screen.getByTestId('info-source')).toHaveTextContent('1080p H.264 SDR');
  });

  it('reads the encoder speed from the session only while it is open', async () => {
    const { calls } = await playing();
    const gets = () => calls.filter((call) => call.method === 'GET' && call.path === '/api/sessions/s1').length;
    expect(gets()).toBe(0);
    press('i');
    await waitFor(() => expect(gets()).toBe(1));
  });
});

describe('auto-hiding controls', () => {
  it('hide after 3 s, return on input, stay while paused, and shortcuts still work while hidden', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const { video } = await (async () => {
        openPlayer(GET_SESSION);
        const element = (await vi.waitUntil(() => screen.queryByTestId('player-video'))) as HTMLVideoElement;
        startVideo(element);
        return { video: element };
      })();
      expect(stage().dataset.chrome).toBe('visible');
      act(() => {
        vi.advanceTimersByTime(2900);
      });
      expect(stage().dataset.chrome).toBe('visible');
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(stage().dataset.chrome).toBe('hidden');

      press('ArrowRight');
      expect(video.currentTime).toBe(30);
      expect(stage().dataset.chrome).toBe('visible');
      act(() => {
        vi.advanceTimersByTime(3100);
      });
      expect(stage().dataset.chrome).toBe('hidden');
      press(' ');
      expect(video.paused).toBe(true);
      expect(stage().dataset.chrome).toBe('visible');
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(stage().dataset.chrome).toBe('visible');

      press(' ');
      fireEvent.click(screen.getByRole('button', { name: 'Info' }));
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(stage().dataset.chrome).toBe('visible');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Media Session', () => {
  function installMediaSession() {
    const handlers = new Map<string, (() => void) | null>();
    let assigned = 0;
    let metadata: unknown = null;
    const fake = {
      playbackState: 'none',
      setActionHandler: (action: string, handler: (() => void) | null) => handlers.set(action, handler),
      get metadata() {
        return metadata;
      },
      set metadata(value: unknown) {
        assigned += 1;
        metadata = value;
      },
    };
    Object.defineProperty(navigator, 'mediaSession', { configurable: true, value: fake });
    vi.stubGlobal(
      'MediaMetadata',
      class {
        constructor(init: object) {
          Object.assign(this, init);
        }
      },
    );
    return { fake, handlers, assignments: () => assigned };
  }
  afterEach(() => Reflect.deleteProperty(navigator, 'mediaSession'));

  it('publishes the title and the w342 poster once, mirrors playback state and reacts to media keys', async () => {
    const media = installMediaSession();
    const { video, calls } = await playing();
    await waitFor(() => expect(media.fake.metadata).not.toBeNull());
    expect(media.fake.metadata).toMatchObject({
      title: 'The Shawshank Redemption',
      artist: '1994 \u00b7 2160p H.264',
      artwork: [{ src: 'https://image.tmdb.org/t/p/w342/poster.jpg' }],
    });
    expect(media.assignments()).toBe(1);
    expect(media.fake.playbackState).toBe('playing');

    act(() => media.handlers.get('pause')?.());
    expect(video.paused).toBe(true);
    expect(media.fake.playbackState).toBe('paused');
    act(() => media.handlers.get('play')?.());
    expect(video.paused).toBe(false);
    act(() => media.handlers.get('nexttrack')?.());
    expect(video.currentTime).toBe(130);
    act(() => media.handlers.get('previoustrack')?.());
    expect(video.currentTime).toBe(120);
    expect(media.assignments()).toBe(1);

    act(() => media.handlers.get('stop')?.());
    await waitFor(() => expect(deletes(calls)).toBe(1));
    await waitFor(() => expect(media.fake.metadata).toBeNull());
    expect(media.handlers.get('stop')).toBeNull();
  });
});

describe('player snapshot', () => {
  it('describes the running playback for a hand-over and is gone once the player closes', async () => {
    const { video } = await playing({}, 250);
    video.volume = 0.4;
    expect(getPlayerSnapshot()).toEqual({
      sessionId: 's1',
      playlistUrl: '/hls/s1/index.m3u8',
      mediaPlaylistUrl: '/hls/s1/video.m3u8',
      positionSec: 250,
      paused: false,
      volume: 0.4,
      muted: false,
      audioIndex: 0,
      subtitle: { index: 0, mode: 'sidecar' },
      title: 'The Shawshank Redemption',
      mediaKey: 'movie:278',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(getPlayerSnapshot()).toBeNull());
  });
});
