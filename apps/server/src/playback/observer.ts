import type { Decision, DeviceKind, MediaType } from '@homestream/shared';

export type RestartReason = 'retry' | 'seek' | 'tracks' | 'resume';
type SessionStopReason = 'stopped' | 'idle' | 'disk' | 'shutdown';

export interface SessionSubject {
  mediaType: MediaType;
  tmdbId: number;
  title: string;
  season: number | null;
  episode: number | null;
  deviceKind: DeviceKind;
}

/**
 * What the playback manager reports about the sessions it runs, so metrics and analytics stay outside it.
 * Called only at session start, end, failure and encoder restart; never per segment.
 */
export interface PlaybackObserver {
  started(subject: SessionSubject, details: { startupMs: number; decision: Decision }): void;
  ended(
    subject: SessionSubject,
    details: { reason: SessionStopReason; watchedSec: number; avgSpeed: number | null },
  ): void;
  failed(
    subject: Omit<SessionSubject, 'title'> & { title: string | null },
    details: { stage: 'start' | 'running'; code: string },
  ): void;
  restarted(reason: RestartReason): void;
}
