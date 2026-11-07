import type { Handover } from '@homestream/shared';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetToasts } from '../notices/toastStore';
import { resetPrefetchMemory } from '../player/sessionApi';
import { FakeHls } from '../test/fakeHls';
import { session } from '../test/fixtures';
import { installBridge } from '../test/desktopBridge';
import { openPlayer, startVideo, stubMedia } from '../test/player';
import { apiError } from '../test/render';

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
  vi.useRealTimers();
  delete window.homestream;
});

const videoOf = async () => (await screen.findByTestId('player-video')) as HTMLVideoElement;
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));
const deletes = (calls: Array<{ method: string }>) => calls.filter((call) => call.method === 'DELETE');
const posts = (calls: Array<{ method: string; path: string }>) =>
  calls.filter((call) => call.method === 'POST' && call.path === '/api/sessions');

const HANDOVER: Handover = {
  sessionId: 's1',
  playlistUrl: '/hls/s1/index.m3u8',
  positionSec: 1234,
  paused: false,
  volume: 0.4,
  muted: true,
  audioIndex: 0,
  subtitle: null,
  title: 'The Shawshank Redemption',
  mediaKey: 'movie:278',
};

const ATTACH_ROUTES = { 'GET /api/sessions/s1': () => session({ startPositionSec: 0 }) };

describe('pop-out from the main player', () => {
  it('hands the same session to the mini player and leaves without ending it', async () => {
    const bridge = installBridge();
    const { calls } = openPlayer();
    const video = await videoOf();
    startVideo(video, 120);
    await userEvent.click(await screen.findByRole('button', { name: 'Mini player, stays on top (P)' }));
    expect(bridge.openMiniPlayer).toHaveBeenCalledTimes(1);
    const handover = bridge.openMiniPlayer.mock.calls[0]?.[0];
    expect(handover).toMatchObject({
      sessionId: 's1',
      playlistUrl: '/hls/s1/index.m3u8',
      positionSec: 120,
      paused: false,
      mediaKey: 'movie:278',
      title: 'The Shawshank Redemption',
    });
    expect(handover).not.toHaveProperty('mediaPlaylistUrl');
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    await settle();
    expect(deletes(calls)).toHaveLength(0);
    expect(posts(calls)).toHaveLength(1);
  });

  it('the P key does the same', async () => {
    const bridge = installBridge();
    openPlayer();
    startVideo(await videoOf(), 30);
    fireEvent.keyDown(document, { key: 'p' });
    await waitFor(() => expect(bridge.openMiniPlayer).toHaveBeenCalledTimes(1));
  });

  it('stays in the player and keeps playing when the shell refuses', async () => {
    const bridge = installBridge({ openMiniPlayer: () => Promise.resolve(false) });
    const { calls } = openPlayer();
    const video = await videoOf();
    startVideo(video, 50);
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new Error('blocked'));
    fireEvent.keyDown(document, { key: 'P' });
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('player-video')).toBeInTheDocument();
    expect(bridge.closeMiniPlayer).not.toHaveBeenCalled();
    cleanup();
    await settle();
    expect(deletes(calls)).toHaveLength(1);
  });

  it('has no pop-out button and no P key in a plain browser', async () => {
    const { calls } = openPlayer();
    startVideo(await videoOf(), 10);
    expect(screen.queryByRole('button', { name: /Mini player/ })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'p' });
    await settle();
    expect(screen.getByTestId('player-video')).toBeInTheDocument();
    expect(calls.some((call) => call.path.includes('mini'))).toBe(false);
  });

  it('tells the shell when video plays and stops, and when the page goes away', async () => {
    const bridge = installBridge();
    openPlayer();
    const video = await videoOf();
    startVideo(video, 5);
    expect(bridge.reportPlaying).toHaveBeenLastCalledWith(true);
    act(() => video.pause());
    expect(bridge.reportPlaying).toHaveBeenLastCalledWith(false);
    act(() => void video.play());
    expect(bridge.reportPlaying).toHaveBeenLastCalledWith(true);
    cleanup();
    expect(bridge.reportPlaying).toHaveBeenLastCalledWith(false);
  });

  it('keeps playing when the shell cannot be told', async () => {
    const reportPlaying = vi.fn(() => Promise.reject(new Error('shell gone')));
    installBridge({ reportPlaying });
    openPlayer();
    const video = await videoOf();
    startVideo(video, 5);
    act(() => video.pause());
    expect(reportPlaying).toHaveBeenCalledWith(false);
    expect(screen.getByTestId('player-video')).toBeInTheDocument();
  });
});

function openAttached(
  route: string,
  overrides: Partial<Handover> = {},
  bridge: Parameters<typeof installBridge>[0] = {},
) {
  const handover = { ...HANDOVER, ...overrides };
  const mocks = installBridge({
    onHandover: (callback) => {
      queueMicrotask(() => callback(handover));
      return () => undefined;
    },
    ...bridge,
  });
  return { mocks, ...openPlayer(ATTACH_ROUTES, route) };
}

describe('the mini player window', () => {
  it('attaches to the same session at the handed-over position without starting another', async () => {
    const { calls, mocks } = openAttached('/play/movie/278?attach=1&mini=1', {}, { isMiniPlayer: true });
    const video = await videoOf();
    expect(calls.some((call) => call.method === 'GET' && call.path === '/api/sessions/s1')).toBe(true);
    expect(posts(calls)).toHaveLength(0);
    expect(FakeHls.last.config).toMatchObject({ startPosition: 1234 });
    expect(FakeHls.last.source).toBe('/hls/s1/index.m3u8');
    expect(video.volume).toBe(0.4);
    expect(video.muted).toBe(true);
    expect(screen.queryByTestId('player-topbar')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Always on top' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Back 10 seconds' })).toHaveTextContent('-10');
    expect(screen.getByRole('button', { name: 'Forward 30 seconds' })).toHaveTextContent('+30');
    expect(mocks.reportPlaying).not.toHaveBeenCalledWith(true);
  });

  it('Back to the full window hands the session back and does not end it', async () => {
    const { calls, mocks } = openAttached('/play/movie/278?attach=1&mini=1', {}, { isMiniPlayer: true });
    const video = await videoOf();
    startVideo(video, 1300);
    await userEvent.click(screen.getByRole('button', { name: 'Back to the full window' }));
    expect(mocks.returnToMain).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 's1', positionSec: 1300, mediaKey: 'movie:278' }),
    );
    cleanup();
    await settle();
    expect(deletes(calls)).toHaveLength(0);
  });

  it('Close ends the session like Back and then closes the window', async () => {
    const { calls, mocks } = openAttached('/play/movie/278?attach=1&mini=1', {}, { isMiniPlayer: true });
    startVideo(await videoOf(), 1300);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(mocks.closeMiniPlayer).toHaveBeenCalledTimes(1));
    const ping = calls.find((call) => call.path === '/api/sessions/s1/progress');
    expect(ping?.body).toMatchObject({ positionSec: 1300, state: 'paused' });
    expect(deletes(calls)).toHaveLength(1);
  });

  it('the pin toggles always on top', async () => {
    const { mocks } = openAttached('/play/movie/278?attach=1&mini=1', {}, { isMiniPlayer: true });
    await videoOf();
    const pin = screen.getByRole('button', { name: 'Always on top' });
    await userEvent.click(pin);
    expect(mocks.setMiniAlwaysOnTop).toHaveBeenCalledWith(false);
    await waitFor(() => expect(pin).toHaveAttribute('aria-pressed', 'false'));
  });

  it('skips back 10 and forward 30 seconds', async () => {
    openAttached('/play/movie/278?attach=1&mini=1', {}, { isMiniPlayer: true });
    const video = await videoOf();
    startVideo(video, 1300);
    await userEvent.click(screen.getByRole('button', { name: 'Back 10 seconds' }));
    expect(video.currentTime).toBe(1290);
    await userEvent.click(screen.getByRole('button', { name: 'Forward 30 seconds' }));
    expect(video.currentTime).toBe(1320);
  });

  it('closes itself when the handed-over session cannot be loaded', async () => {
    const mocks = installBridge({
      isMiniPlayer: true,
      onHandover: (callback) => {
        queueMicrotask(() => callback(HANDOVER));
        return () => undefined;
      },
    });
    openPlayer({ 'GET /api/sessions/s1': apiError(404, 'not_found', 'gone') }, '/play/movie/278?attach=1&mini=1');
    expect(await screen.findByRole('button', { name: /Back|Close|Try again/ })).toBeInTheDocument();
    expect(mocks.openMiniPlayer).not.toHaveBeenCalled();
  });

  it('keeps a paused session paused', async () => {
    openAttached('/play/movie/278?attach=1&mini=1', { paused: true }, { isMiniPlayer: true });
    const video = await videoOf();
    act(() => void video.play());
    expect(video.paused).toBe(true);
  });

  it('closes itself when no hand-over arrives', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const mocks = installBridge({ isMiniPlayer: true });
    openPlayer(ATTACH_ROUTES, '/play/movie/278?attach=1&mini=1');
    await act(() => vi.advanceTimersByTimeAsync(3100));
    expect(mocks.closeMiniPlayer).toHaveBeenCalledTimes(1);
  });
});

describe('the main window taking the session back', () => {
  it('shows the full player at the mini player position on the same session', async () => {
    const { calls } = openAttached('/play/movie/278?attach=1');
    await videoOf();
    expect(await screen.findByTestId('player-topbar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mini player, stays on top (P)' })).toBeInTheDocument();
    expect(FakeHls.last.config).toMatchObject({ startPosition: 1234 });
    expect(posts(calls)).toHaveLength(0);
  });

  it('starts a normal session when the page was reloaded and no hand-over is waiting', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installBridge();
    const { calls } = openPlayer(ATTACH_ROUTES, '/play/movie/278?attach=1');
    expect(posts(calls)).toHaveLength(0);
    await act(() => vi.advanceTimersByTimeAsync(3100));
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
  });

  it('ignores ?attach=1 in a plain browser', async () => {
    const { calls } = openPlayer({}, '/play/movie/278?attach=1');
    await videoOf();
    expect(posts(calls)).toHaveLength(1);
  });
});
