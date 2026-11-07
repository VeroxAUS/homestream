import { describe, expect, it } from 'vitest';
import { DEFAULT_DESKTOP_SETTINGS, type DownloadEvent, type DownloadFailedEvent } from '@homestream/shared';
import {
  detailsRoute,
  planCloseNotice,
  planDownloadFailureToast,
  planReadyToast,
  planSessionFailureToast,
  routeForMediaKey,
  toastTitleText,
  toastXml,
} from '../src/notifications.js';

const settings = DEFAULT_DESKTOP_SETTINGS;
const ready = { downloadId: 'd7', title: 'The Matrix', mediaType: 'movie', tmdbId: 603 } as unknown as DownloadEvent;
const failedDownload = { ...ready, reason: 'timeout', message: 'x' } as unknown as DownloadFailedEvent;
const failedSession = { sessionId: 's1', title: 'Dune', state: 'error' };

describe('ready toast', () => {
  it('shows the mocked text and buttons, also while a window is focused', () => {
    const toast = planReadyToast(ready, { settings, windowFocused: true });
    expect(toast).toMatchObject({
      kind: 'ready',
      title: 'Ready to watch: The Matrix',
      body: 'TorBox finished downloading it. Click to open it in HomeStream.',
      route: '/movie/603',
    });
    expect(toast?.actions.map((action) => action.label)).toEqual(['Play', 'Dismiss']);
  });

  it('is off with the switch', () => {
    expect(planReadyToast(ready, { settings: { ...settings, notifyReady: false }, windowFocused: false })).toBeNull();
  });
});

describe('failure toasts', () => {
  it('appear only while no HomeStream window is focused', () => {
    expect(planSessionFailureToast(failedSession, { settings, windowFocused: true })).toBeNull();
    expect(planDownloadFailureToast(failedDownload, { settings, windowFocused: true })).toBeNull();
    const session = planSessionFailureToast(failedSession, { settings, windowFocused: false });
    expect(session).toMatchObject({ title: "Couldn't play Dune", route: '/dashboard/health' });
    expect(session?.actions.map((action) => action.label)).toEqual(['Open Health', 'Dismiss']);
    expect(planDownloadFailureToast(failedDownload, { settings, windowFocused: false })?.title).toBe(
      "TorBox couldn't download The Matrix",
    );
  });

  it('follow the notifyFailures switch', () => {
    const off = { settings: { ...settings, notifyFailures: false }, windowFocused: false };
    expect(planSessionFailureToast(failedSession, off)).toBeNull();
    expect(planDownloadFailureToast(failedDownload, off)).toBeNull();
  });
});

describe('close notice', () => {
  it('is planned once', () => {
    expect(planCloseNotice(settings)).toMatchObject({
      title: 'HomeStream is still running',
      body: 'Your TV and other devices can keep watching. To quit, right-click the HomeStream icon in the tray.',
    });
    expect(planCloseNotice(settings)?.actions.map((a) => a.label)).toEqual(['Got it']);
    expect(planCloseNotice({ ...settings, closeNoticeShown: true })).toBeNull();
  });
});

describe('text and routes', () => {
  it('cleans titles', () => {
    expect(toastTitleText('  Line\none\u0000  two ')).toBe('Line one two');
    expect(toastTitleText('x'.repeat(200))).toHaveLength(80);
  });

  it('routes a title to its details page', () => {
    expect(detailsRoute({ mediaType: 'tv', tmdbId: 1396, season: 1, episode: 2 })).toBe('/tv/1396?season=1&episode=2');
    expect(detailsRoute({ mediaType: 'tv', tmdbId: 1396 })).toBe('/tv/1396');
    expect(routeForMediaKey('movie:603')).toBe('/movie/603');
    expect(routeForMediaKey('tv:1396:1:2')).toBe('/tv/1396?season=1&episode=2');
    expect(routeForMediaKey('movie:abc')).toBeNull();
  });
});

describe('toastXml', () => {
  it('has real buttons and only the title and fixed words', () => {
    const toast = planReadyToast({ ...ready, title: 'A <b>"Fish"</b> & Co' } as DownloadEvent, {
      settings,
      windowFocused: false,
    });
    const xml = toastXml(toast!);
    expect(xml).toContain('<action content="Play" arguments="hs-open" activationType="foreground"/>');
    expect(xml).toContain('<action content="Dismiss" arguments="dismiss" activationType="system"/>');
    expect(xml).toContain('launch="hs-open"');
    expect(xml).not.toMatch(/<b>|"Fish"</);
    expect(xml).not.toMatch(/https?:|\.mkv|\/movie\/|token|key/i);
  });

  it('only closes for a notice with a single dismiss button', () => {
    expect(toastXml(planCloseNotice(settings)!)).toContain('launch="hs-dismiss"');
  });
});
