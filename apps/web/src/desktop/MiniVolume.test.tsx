import type { Handover } from '@homestream/shared';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetToasts } from '../notices/toastStore';
import { resetPrefetchMemory } from '../player/sessionApi';
import { FakeHls } from '../test/fakeHls';
import { session } from '../test/fixtures';
import { installBridge } from '../test/desktopBridge';
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
  delete window.homestream;
});

const videoOf = async () => (await screen.findByTestId('player-video')) as HTMLVideoElement;
const volumeRange = () => screen.getByRole('slider', { name: 'Volume' });

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

function openAttached(route: string, overrides: Partial<Handover> = {}, mini = false) {
  const handover = { ...HANDOVER, ...overrides };
  const mocks = installBridge({
    isMiniPlayer: mini,
    onHandover: (callback) => {
      queueMicrotask(() => callback(handover));
      return () => undefined;
    },
  });
  openPlayer(ATTACH_ROUTES, route);
  return mocks;
}

const openMini = (overrides: Partial<Handover> = {}) =>
  openAttached('/play/movie/278?attach=1&mini=1', overrides, true);

describe('volume in the mini player', () => {
  it('starts at the handed-over volume and mute and shows them on its own controls', async () => {
    openMini();
    const video = await videoOf();
    expect(video.volume).toBe(0.4);
    expect(video.muted).toBe(true);
    expect(await screen.findByRole('button', { name: 'Unmute' })).toBeInTheDocument();
    expect(volumeRange()).toHaveValue('0');
  });

  it('shows the volume while not muted and has no audio, subtitle or info button', async () => {
    openMini({ volume: 0.35, muted: false });
    const video = await videoOf();
    expect(video.volume).toBe(0.35);
    expect(video.muted).toBe(false);
    expect(await screen.findByRole('button', { name: 'Mute' })).toBeInTheDocument();
    expect(volumeRange()).toHaveValue('0.35');
    for (const name of ['Audio', 'Subtitles', 'Info']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('the range sets the video volume and unmutes it', async () => {
    openMini();
    const video = await videoOf();
    fireEvent.change(await screen.findByRole('slider', { name: 'Volume' }), { target: { value: '0.8' } });
    expect(video.volume).toBe(0.8);
    expect(video.muted).toBe(false);
  });

  it('the mute button toggles mute and keeps the volume', async () => {
    openMini({ volume: 0.8, muted: false });
    const video = await videoOf();
    await userEvent.click(await screen.findByRole('button', { name: 'Mute' }));
    expect(video.muted).toBe(true);
    expect(video.volume).toBe(0.8);
    await userEvent.click(screen.getByRole('button', { name: 'Unmute' }));
    expect(video.muted).toBe(false);
  });

  it('hands its own volume and mute back to the main window', async () => {
    const mocks = openMini();
    startVideo(await videoOf(), 1300);
    fireEvent.change(await screen.findByRole('slider', { name: 'Volume' }), { target: { value: '0.8' } });
    await userEvent.click(await screen.findByRole('button', { name: 'Mute' }));
    await userEvent.click(screen.getByRole('button', { name: 'Back to the full window' }));
    expect(mocks.returnToMain).toHaveBeenCalledWith(expect.objectContaining({ volume: 0.8, muted: true }));
  });
});

describe('volume across the hand-over', () => {
  it('the main window takes the mini player volume and mute over, controls included', async () => {
    openAttached('/play/movie/278?attach=1', { volume: 0.8, muted: true });
    const video = await videoOf();
    expect(video.volume).toBe(0.8);
    expect(video.muted).toBe(true);
    expect(await screen.findByRole('button', { name: 'Unmute' })).toBeInTheDocument();
    expect(volumeRange()).toHaveValue('0');
  });

  it('the main window hands its volume to the mini player', async () => {
    const bridge = installBridge();
    openPlayer();
    startVideo(await videoOf(), 120);
    fireEvent.change(await screen.findByRole('slider', { name: 'Volume' }), { target: { value: '0.35' } });
    await userEvent.click(screen.getByRole('button', { name: 'Mini player, stays on top (P)' }));
    expect(bridge.openMiniPlayer).toHaveBeenCalledWith(expect.objectContaining({ volume: 0.35, muted: false }));
  });

  it('a muted main window hands the mute and its volume to the mini player', async () => {
    const bridge = installBridge();
    openPlayer();
    startVideo(await videoOf(), 120);
    fireEvent.change(await screen.findByRole('slider', { name: 'Volume' }), { target: { value: '0.5' } });
    await userEvent.click(await screen.findByRole('button', { name: 'Mute' }));
    await userEvent.click(screen.getByRole('button', { name: 'Mini player, stays on top (P)' }));
    expect(bridge.openMiniPlayer).toHaveBeenCalledWith(expect.objectContaining({ volume: 0.5, muted: true }));
  });
});
