import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetToasts } from '../notices/toastStore';
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
  vi.unstubAllGlobals();
});

const listRenditions = (hls: FakeHls = FakeHls.last) =>
  act(async () => {
    hls.emit('hlsSubtitleTracksUpdated');
  });
const patches = (calls: Array<{ method: string; body: unknown }>) => calls.filter((call) => call.method === 'PATCH');

async function playing() {
  const api = openPlayer({ 'GET /api/sessions/s1': () => Response.json(session()) });
  startVideo((await screen.findByTestId('player-video')) as HTMLVideoElement, 100);
  await listRenditions();
  return api;
}

function chooseSubtitle(name: string | RegExp) {
  fireEvent.click(screen.getByRole('button', { name: 'Subtitles' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name }));
}

async function switchAudioToFrench() {
  const before = FakeHls.instances.length;
  fireEvent.click(screen.getByRole('button', { name: 'Audio' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: /French/ }));
  await waitFor(() => expect(FakeHls.instances.length).toBe(before + 1));
}

describe('the subtitle choice after the stream reloads', () => {
  it('keeps Off after an audio switch although hls.js selects its default track itself', async () => {
    const { calls } = await playing();
    chooseSubtitle('Off');
    expect(FakeHls.last.subtitleTrack).toBe(-1);

    await switchAudioToFrench();
    await listRenditions();

    expect(FakeHls.last.subtitleTrack).toBe(-1);
    expect(patches(calls)).toHaveLength(1);
    expect(patches(calls)[0]?.body).toEqual({ audioIndex: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Subtitles' }));
    expect(screen.getByRole('menuitemradio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true');
  });

  it('keeps a non-default track after an audio switch', async () => {
    await playing();
    chooseSubtitle('Spanish');
    expect(FakeHls.last.subtitleTrack).toBe(0);

    await switchAudioToFrench();
    await listRenditions();

    expect(FakeHls.last.subtitleTrack).toBe(0);
    expect(FakeHls.last.subtitleDisplay).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Subtitles' }));
    expect(screen.getByRole('menuitemradio', { name: 'Spanish' })).toHaveAttribute('aria-checked', 'true');
  });

  it('keeps Off after leaving a burned-in track, which sends subtitle null once', async () => {
    const { calls } = await playing();
    chooseSubtitle(/English - PGS/);
    await waitFor(() => expect(FakeHls.instances).toHaveLength(2));
    await listRenditions();
    expect(FakeHls.last.subtitleTrack).toBe(-1);

    chooseSubtitle('Off');
    await waitFor(() => expect(FakeHls.instances).toHaveLength(3));
    await listRenditions();

    expect(patches(calls).map((call) => call.body)).toEqual([
      { subtitle: { index: 2, mode: 'burn' } },
      { subtitle: null },
    ]);
    expect(FakeHls.last.subtitleTrack).toBe(-1);
  });

  it('ignores the listing of a stream that was already replaced', async () => {
    await playing();
    const old = FakeHls.last;
    chooseSubtitle('Off');
    await switchAudioToFrench();
    await listRenditions(old);
    expect(old.subtitleTrack).toBe(old.defaultSubtitleTrack);
  });
});
