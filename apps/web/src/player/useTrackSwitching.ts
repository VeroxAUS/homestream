import type { SessionPatchRequest, SessionResponse, SubtitleSelection } from '@homestream/shared';
import type Hls from 'hls.js';
import { useCallback, useRef, useState, type RefObject } from 'react';
import { describeError } from '../lib/errors';
import { showToast } from '../notices/toastStore';
import { patchSession } from './sessionApi';
import { sameSelection, selectionFor, subtitleEntries } from './tracks';
import { applySubtitleSelection } from './useHls';

interface TrackSwitchingArgs {
  session: SessionResponse;
  videoRef: RefObject<HTMLVideoElement | null>;
  hlsRef: RefObject<Hls | null>;
  /** Shared with the hls hook, which applies it whenever the renditions are listed. */
  selectionRef: RefObject<SubtitleSelection | null>;
  reload: (positionSec: number) => void;
}

export interface TrackSwitching {
  /** The session as the server last described it (decision, audio, burn-in). */
  current: SessionResponse;
  subtitle: SubtitleSelection | null;
  /** An audio or burn-in change is waiting for the server. */
  busy: boolean;
  selectAudio: (index: number) => Promise<void>;
  selectSubtitle: (next: SubtitleSelection | null) => Promise<void>;
  /** Off when a subtitle is showing, otherwise the last one that was chosen (or the first text track). */
  toggleSubtitles: () => Promise<void>;
}

/**
 * Audio and burn-in changes are `PATCH`es that restart only the server's encoder, so the player reloads the same
 * playlist at the position it had. Text subtitles are hls.js renditions and never touch the server, except that
 * leaving a burned-in track has to say `subtitle: null` explicitly.
 */
export function useTrackSwitching({
  session,
  videoRef,
  hlsRef,
  selectionRef,
  reload,
}: TrackSwitchingArgs): TrackSwitching {
  const [current, setCurrent] = useState(session);
  const [subtitle, setSubtitleState] = useState(session.selectedSubtitle);
  const [busy, setBusy] = useState(false);
  const lastChoice = useRef<SubtitleSelection | null>(session.selectedSubtitle);
  const busyRef = useRef(false);

  const setSubtitle = useCallback(
    (next: SubtitleSelection | null) => {
      selectionRef.current = next;
      if (next) lastChoice.current = next;
      setSubtitleState(next);
      if (hlsRef.current) applySubtitleSelection(hlsRef.current, next);
    },
    [selectionRef, hlsRef],
  );

  const patch = useCallback(
    async (body: SessionPatchRequest, onApplied?: () => void): Promise<boolean> => {
      busyRef.current = true;
      setBusy(true);
      try {
        const next = await patchSession(session.sessionId, body);
        setCurrent(next);
        onApplied?.();
        reload(videoRef.current?.currentTime ?? 0);
        return true;
      } catch (error) {
        const { message, hint } = describeError(error);
        showToast({ kind: 'error', message, ...(hint ? { detail: hint } : {}), actions: [], autoDismissMs: null });
        return false;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [session.sessionId, reload, videoRef],
  );

  const selectAudio = useCallback(
    async (index: number) => {
      if (busyRef.current || index === current.selectedAudioIndex) return;
      await patch({ audioIndex: index });
    },
    [patch, current.selectedAudioIndex],
  );

  const selectSubtitle = useCallback(
    async (next: SubtitleSelection | null) => {
      if (busyRef.current || sameSelection(next, subtitle)) return;
      if (next?.mode === 'burn') {
        await patch({ subtitle: next }, () => setSubtitle(next));
      } else if (subtitle?.mode === 'burn') {
        await patch({ subtitle: null }, () => setSubtitle(next));
      } else {
        setSubtitle(next);
      }
    },
    [patch, setSubtitle, subtitle],
  );

  const toggleSubtitles = useCallback(async () => {
    if (subtitle) return selectSubtitle(null);
    const first = subtitleEntries(session.subtitleTracks)[0];
    const fallback = first ? selectionFor(first) : null;
    return selectSubtitle(lastChoice.current ?? fallback);
  }, [subtitle, selectSubtitle, session.subtitleTracks]);

  return { current, subtitle, busy, selectAudio, selectSubtitle, toggleSubtitles };
}
