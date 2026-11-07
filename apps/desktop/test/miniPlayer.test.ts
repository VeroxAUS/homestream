import { describe, expect, it } from 'vitest';
import type { Handover } from '@homestream/shared';
import { KeepAwake, desiredBlocker, type PowerBlockerPort } from '../src/keepAwake.js';
import { MiniPlayerState, attachRoute, miniBounds } from '../src/miniPlayer.js';

const handover: Handover = {
  sessionId: 'sess-1',
  playlistUrl: '/hls/sess-1/index.m3u8',
  positionSec: 125.5,
  paused: false,
  volume: 0.8,
  muted: false,
  audioIndex: 1,
  subtitle: null,
  title: 'The Matrix',
  mediaKey: 'movie:603',
};

describe('miniBounds', () => {
  it('sits at the bottom right of the work area with a 16 px margin', () => {
    expect(miniBounds({ x: 0, y: 0, width: 1920, height: 1040 })).toEqual({ x: 1424, y: 754, width: 480, height: 270 });
    expect(miniBounds({ x: -1920, y: 0, width: 1920, height: 1040 }).x).toBe(-496);
  });
});

describe('attachRoute', () => {
  it('points at the player route in attach mode', () => {
    expect(attachRoute('movie:603', true)).toBe('/play/movie/603?attach=1&mini=1');
    expect(attachRoute('tv:1396:2:3', false)).toBe('/play/tv/1396/2/3?attach=1');
    expect(attachRoute('nonsense', true)).toBeNull();
  });
});

describe('MiniPlayerState', () => {
  it('hands the session to the mini player once and keeps its id', () => {
    const state = new MiniPlayerState();
    expect(state.phase).toBe('closed');
    expect(state.open(handover)).toEqual({ route: '/play/movie/603?attach=1&mini=1' });
    expect(state.phase).toBe('open');
    expect(state.sessionId).toBe('sess-1');
    expect(state.claim()).toEqual(handover);
    expect(state.claim()).toBeNull();
  });

  it('allows one mini player at a time and rejects an unknown title', () => {
    const state = new MiniPlayerState();
    expect(state.open({ ...handover, mediaKey: 'bad' })).toBeNull();
    expect(state.phase).toBe('closed');
    state.open(handover);
    expect(state.open({ ...handover, sessionId: 'other' })).toBeNull();
    expect(state.sessionId).toBe('sess-1');
  });

  it('hands the same session back at the position the mini player reached', () => {
    const state = new MiniPlayerState();
    state.open(handover);
    state.claim();
    const back = { ...handover, positionSec: 300, paused: true };
    expect(state.giveBack(back)).toEqual({ route: '/play/movie/603?attach=1' });
    expect(state.phase).toBe('closed');
    expect(state.claim()).toEqual(back);
  });

  it('refuses to hand back a session it does not hold', () => {
    const state = new MiniPlayerState();
    expect(state.giveBack(handover)).toBeNull();
    state.open(handover);
    expect(state.giveBack({ ...handover, sessionId: 'someone-else' })).toBeNull();
    expect(state.phase).toBe('open');
  });

  it('close forgets the session and reports the title for the details page', () => {
    const state = new MiniPlayerState();
    state.open(handover);
    expect(state.close()).toBe('movie:603');
    expect(state.phase).toBe('closed');
    expect(state.claim()).toBeNull();
    expect(state.close()).toBeNull();
  });

  it('keeps the pin choice and resets it to on top for the next mini player', () => {
    const state = new MiniPlayerState();
    expect(state.alwaysOnTop).toBe(true);
    expect(state.setAlwaysOnTop(false)).toBe(false);
    state.open(handover);
    expect(state.alwaysOnTop).toBe(true);
  });
});

function recorder() {
  const log: string[] = [];
  let next = 1;
  const port: PowerBlockerPort = {
    start: (type) => {
      log.push(`start:${type}`);
      return next++;
    },
    stop: (id) => void log.push(`stop:${id}`),
  };
  return { log, port };
}

describe('keep awake', () => {
  it('maps sessions and local playback to a blocker', () => {
    expect(desiredBlocker(0, false)).toBe('none');
    expect(desiredBlocker(2, false)).toBe('prevent-app-suspension');
    expect(desiredBlocker(0, true)).toBe('prevent-display-sleep');
    expect(desiredBlocker(3, true)).toBe('prevent-display-sleep');
  });

  it('holds one blocker, swaps it when the mode changes and releases it', () => {
    const { log, port } = recorder();
    const awake = new KeepAwake(port);
    awake.setSessions(1);
    awake.setSessions(2);
    awake.setLocalPlaying(true);
    awake.setLocalPlaying(false);
    awake.setSessions(0);
    expect(log).toEqual([
      'start:prevent-app-suspension',
      'stop:1',
      'start:prevent-display-sleep',
      'stop:2',
      'start:prevent-app-suspension',
      'stop:3',
    ]);
    expect(awake.mode).toBe('none');
    expect(awake.activeSessions).toBe(0);
  });

  it('release drops everything', () => {
    const { log, port } = recorder();
    const awake = new KeepAwake(port);
    awake.setSessions(1);
    awake.setLocalPlaying(true);
    awake.release();
    expect(awake.mode).toBe('none');
    expect(log.at(-1)).toBe('stop:2');
  });
});
