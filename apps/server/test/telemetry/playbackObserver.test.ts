import type { Decision } from '@homestream/shared';
import { describe, expect, it, vi } from 'vitest';
import { ServerMetrics } from '../../src/metrics/serverMetrics.js';
import type { SessionSubject } from '../../src/playback/observer.js';
import { createPlaybackObserver, resolutionClass } from '../../src/telemetry/playbackObserver.js';
import type { Telemetry } from '../../src/telemetry/types.js';

const subject: SessionSubject = {
  mediaType: 'tv',
  tmdbId: 1396,
  title: 'Breaking Bad',
  season: 1,
  episode: 2,
  deviceKind: 'tv',
};
const decision: Decision = {
  videoCodec: 'hevc',
  width: 3840,
  height: 2160,
  dynamicRange: 'hdr10',
  toneMapped: false,
} as Decision;

function fakeTelemetry() {
  const capture = vi.fn();
  const captureError = vi.fn();
  const breadcrumb = vi.fn();
  const telemetry = { capture, captureError, breadcrumb } as unknown as Telemetry;
  return { telemetry, capture, captureError, breadcrumb };
}

async function sample(metrics: ServerMetrics, name: string, labels: Record<string, string> = {}): Promise<number> {
  const wanted = Object.entries(labels).map(([key, value]) => `${key}="${value}"`);
  const line = (await metrics.render())
    .split('\n')
    .find((entry) => entry.startsWith(name) && wanted.every((part) => entry.includes(part)));
  return line ? Number(line.slice(line.lastIndexOf(' ') + 1)) : 0;
}

describe('resolutionClass', () => {
  it.each([
    [2160, '2160p'],
    [1600, '1440p'],
    [1080, '1080p'],
    [800, '720p'],
    [480, '480p'],
    [240, '480p'],
  ])('maps height %i to %s', (height, expected) => {
    expect(resolutionClass(height)).toBe(expected);
  });
});

describe('createPlaybackObserver', () => {
  it('counts a started session and sends playback_started with the episode, decision and startup time', async () => {
    const metrics = new ServerMetrics();
    const { telemetry, capture, breadcrumb } = fakeTelemetry();
    createPlaybackObserver(metrics, telemetry).started(subject, { startupMs: 2345.6, decision });
    expect(await sample(metrics, 'homestream_sessions_started_total')).toBe(1);
    expect(capture).toHaveBeenCalledWith('playback_started', {
      mediaType: 'tv',
      tmdbId: 1396,
      title: 'Breaking Bad',
      season: 1,
      episode: 2,
      deviceKind: 'tv',
      videoCodec: 'hevc',
      hdr: true,
      toneMapped: false,
      resolution: '2160p',
      startupMs: 2346,
    });
    expect(breadcrumb).toHaveBeenCalledWith('playback', expect.stringContaining('hevc 2160p hdr'), {
      startupMs: 2345.6,
    });
  });

  it('omits season and episode for a movie and caps the startup time', () => {
    const { telemetry, capture } = fakeTelemetry();
    createPlaybackObserver(new ServerMetrics(), telemetry).started(
      { ...subject, mediaType: 'movie', season: null, episode: null },
      { startupMs: 9_999_999, decision: { ...decision, dynamicRange: 'sdr', height: 1080 } },
    );
    const sent = capture.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(sent).not.toHaveProperty('season');
    expect(sent).not.toHaveProperty('episode');
    expect(sent).toMatchObject({ hdr: false, resolution: '1080p', startupMs: 3_600_000 });
  });

  it('sends playback_ended with the watched time and encoder speed', () => {
    const { telemetry, capture } = fakeTelemetry();
    const observer = createPlaybackObserver(new ServerMetrics(), telemetry);
    observer.ended(subject, { reason: 'idle', watchedSec: 1234.4, avgSpeed: 2.34567 });
    observer.ended(subject, { reason: 'stopped', watchedSec: -3, avgSpeed: null });
    expect(capture.mock.calls[0]).toEqual([
      'playback_ended',
      {
        mediaType: 'tv',
        tmdbId: 1396,
        title: 'Breaking Bad',
        deviceKind: 'tv',
        reason: 'idle',
        watchedSec: 1234,
        avgSpeed: 2.35,
      },
    ]);
    expect(capture.mock.calls[1]?.[1]).toMatchObject({ watchedSec: 0 });
    expect(capture.mock.calls[1]?.[1]).not.toHaveProperty('avgSpeed');
  });

  it('counts failures by stage and code; only a failure while running becomes an error report', async () => {
    const metrics = new ServerMetrics();
    const { telemetry, capture, captureError } = fakeTelemetry();
    const observer = createPlaybackObserver(metrics, telemetry);
    observer.failed({ ...subject, title: null }, { stage: 'start', code: 'no_streams' });
    expect(captureError).not.toHaveBeenCalled();
    expect(capture.mock.calls[0]?.[1]).not.toHaveProperty('title');
    observer.failed(subject, { stage: 'running', code: 'encoder_failed' });
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError.mock.calls[0]?.[1]).toMatchObject({
      deviceKind: 'tv',
      mediaType: 'tv',
      tags: { error_code: 'encoder_failed' },
    });
    expect(await sample(metrics, 'homestream_sessions_failed_total', { stage: 'start', code: 'no_streams' })).toBe(1);
    expect(
      await sample(metrics, 'homestream_sessions_failed_total', { stage: 'running', code: 'encoder_failed' }),
    ).toBe(1);
  });

  it('maps an error code that is not a plain token to "other" in the metric label', async () => {
    const metrics = new ServerMetrics();
    createPlaybackObserver(metrics, fakeTelemetry().telemetry).failed(subject, {
      stage: 'start',
      code: 'Bad Code/with spaces',
    });
    expect(await sample(metrics, 'homestream_sessions_failed_total', { code: 'other' })).toBe(1);
  });

  it('counts encoder restarts by reason', async () => {
    const metrics = new ServerMetrics();
    const observer = createPlaybackObserver(metrics, fakeTelemetry().telemetry);
    for (const reason of ['retry', 'seek', 'seek', 'tracks', 'resume'] as const) observer.restarted(reason);
    expect(await sample(metrics, 'homestream_encoder_restarts_total', { reason: 'seek' })).toBe(2);
    expect(await sample(metrics, 'homestream_encoder_restarts_total', { reason: 'retry' })).toBe(1);
  });
});
