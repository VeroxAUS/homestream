import type { DownloadEvent } from '@homestream/shared';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { movieProgressQuery, showProgressQuery } from '../api/queries';
import { onDownloadOutcome } from '../events/serverEvents';
import { playPath, type PlayTarget } from '../player/target';
import { READY_TOAST_MS, showToast } from './toastStore';

function targetOf(event: DownloadEvent): PlayTarget {
  return {
    mediaType: event.mediaType,
    tmdbId: event.tmdbId,
    ...(event.season !== undefined ? { season: event.season } : {}),
    ...(event.episode !== undefined ? { episode: event.episode } : {}),
  };
}

/** The saved position to resume from when the title was already started; any lookup problem means "from the start". */
async function resumeStart(queryClient: QueryClient, target: PlayTarget): Promise<number | undefined> {
  try {
    if (target.mediaType === 'movie') {
      const saved = await queryClient.fetchQuery(movieProgressQuery(target.tmdbId));
      return saved?.resumable ? Math.floor(saved.positionSec) : undefined;
    }
    const saved = await queryClient.fetchQuery(showProgressQuery(target.tmdbId));
    const item = saved.items.find((entry) => entry.season === target.season && entry.episode === target.episode);
    return item?.resumable ? Math.floor(item.positionSec) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Turns the app-wide download events into toasts: "Ready to watch" with a Play action, and a plain error with Retry
 * when TorBox could not download the title. Renders nothing.
 */
export function DownloadNotices() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useEffect(
    () =>
      onDownloadOutcome(({ type, event }) => {
        const target = targetOf(event);
        const play = () => void resumeStart(queryClient, target).then((start) => navigate(playPath(target, start)));
        if (type === 'ready') {
          showToast({
            kind: 'ready',
            message: `Ready to watch: ${event.title}`,
            actions: [{ label: 'Play', onClick: play }],
            autoDismissMs: READY_TOAST_MS,
            deferWhilePlaying: true,
          });
          return;
        }
        showToast({
          kind: 'error',
          message: "TorBox couldn't download this title.",
          detail: event.title,
          actions: [{ label: 'Retry', onClick: () => navigate(playPath(target)) }],
          autoDismissMs: null,
        });
      }),
    [queryClient, navigate],
  );
  return null;
}
