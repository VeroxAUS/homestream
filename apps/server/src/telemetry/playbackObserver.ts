import type { Decision } from '@homestream/shared';
import type { ServerMetrics } from '../metrics/serverMetrics.js';
import type { PlaybackObserver } from '../playback/observer.js';
import type { Telemetry } from './types.js';

type Resolution = '480p' | '720p' | '1080p' | '1440p' | '2160p';

export function resolutionClass(height: number): Resolution {
  if (height >= 2160) return '2160p';
  if (height >= 1440) return '1440p';
  if (height >= 1080) return '1080p';
  if (height >= 720) return '720p';
  return '480p';
}

function episodeFields(season: number | null, episode: number | null): { season?: number; episode?: number } {
  return { ...(season === null ? {} : { season }), ...(episode === null ? {} : { episode }) };
}

function describeDecision(decision: Decision): string {
  return `${decision.videoCodec} ${resolutionClass(decision.height)}${decision.dynamicRange === 'hdr10' ? ' hdr' : ''}`;
}

/** Feeds the metrics registry and the telemetry front from the session lifecycle; none of it runs per segment. */
export function createPlaybackObserver(metrics: ServerMetrics, telemetry: Telemetry): PlaybackObserver {
  return {
    started(subject, { startupMs, decision }) {
      metrics.sessionStarted();
      telemetry.breadcrumb('playback', `Session started (${describeDecision(decision)})`, { startupMs });
      telemetry.capture('playback_started', {
        mediaType: subject.mediaType,
        tmdbId: subject.tmdbId,
        title: subject.title,
        ...episodeFields(subject.season, subject.episode),
        deviceKind: subject.deviceKind,
        videoCodec: decision.videoCodec,
        hdr: decision.dynamicRange === 'hdr10',
        toneMapped: decision.toneMapped,
        resolution: resolutionClass(decision.height),
        startupMs: Math.min(Math.round(startupMs), 3_600_000),
      });
    },
    ended(subject, { reason, watchedSec, avgSpeed }) {
      telemetry.breadcrumb('playback', `Session ended (${reason})`, { watchedSec: Math.round(watchedSec) });
      telemetry.capture('playback_ended', {
        mediaType: subject.mediaType,
        tmdbId: subject.tmdbId,
        title: subject.title,
        deviceKind: subject.deviceKind,
        reason,
        watchedSec: Math.min(Math.max(Math.round(watchedSec), 0), 86_400),
        ...(avgSpeed === null ? {} : { avgSpeed: Math.round(avgSpeed * 100) / 100 }),
      });
    },
    failed(subject, { stage, code }) {
      metrics.sessionFailed(stage, code);
      telemetry.breadcrumb('playback', `Session failed (${stage}: ${code})`);
      telemetry.capture('playback_failed', {
        mediaType: subject.mediaType,
        tmdbId: subject.tmdbId,
        ...(subject.title === null ? {} : { title: subject.title }),
        deviceKind: subject.deviceKind,
        stage,
        errorCode: code,
      });
      if (stage === 'running') {
        telemetry.captureError(new Error(`Playback failed while running: ${code}`), {
          deviceKind: subject.deviceKind,
          mediaType: subject.mediaType,
          tags: { error_code: code },
        });
      }
    },
    restarted(reason) {
      metrics.encoderRestarted(reason);
      telemetry.breadcrumb('playback', `Encoder restarted (${reason})`);
    },
  };
}
