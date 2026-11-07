import type { SessionResponse, SubtitleSelection } from '@homestream/shared';
import { useEffect, useRef, type RefObject } from 'react';
import { registerPlayerSnapshot } from './snapshot';
import { mediaKeyOf, type PlayTarget } from './target';

interface SnapshotArgs {
  session: SessionResponse;
  target: PlayTarget;
  title: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  audioIndex: number | null;
  subtitle: SubtitleSelection | null;
}

/** Publishes the running playback (session, position, volume, track choices) for anything that wants to continue it. */
export function usePlayerSnapshot({ session, target, title, videoRef, audioIndex, subtitle }: SnapshotArgs): void {
  const choices = useRef({ audioIndex, subtitle, title });
  choices.current = { audioIndex, subtitle, title };

  useEffect(
    () =>
      registerPlayerSnapshot(() => {
        const video = videoRef.current;
        return {
          sessionId: session.sessionId,
          playlistUrl: session.playlistUrl,
          mediaPlaylistUrl: session.mediaPlaylistUrl,
          positionSec: video?.currentTime ?? 0,
          paused: video?.paused ?? true,
          volume: video?.volume ?? 1,
          muted: video?.muted ?? false,
          audioIndex: choices.current.audioIndex,
          subtitle: choices.current.subtitle,
          title: choices.current.title,
          mediaKey: mediaKeyOf(target),
        };
      }),
    [session.sessionId, session.playlistUrl, session.mediaPlaylistUrl, target, videoRef],
  );
}
