import type { SubtitleSelection } from '@homestream/shared';

/**
 * Everything needed to continue the running playback somewhere else (the desktop mini player attaches to the same
 * session at this position instead of starting a new one).
 */
export interface PlayerSnapshot {
  sessionId: string;
  playlistUrl: string;
  mediaPlaylistUrl: string;
  positionSec: number;
  paused: boolean;
  volume: number;
  muted: boolean;
  audioIndex: number | null;
  subtitle: SubtitleSelection | null;
  title: string;
  mediaKey: string;
}

let provider: (() => PlayerSnapshot) | null = null;

/** The open player registers how to read its state; the returned function unregisters it. */
export function registerPlayerSnapshot(read: () => PlayerSnapshot): () => void {
  provider = read;
  return () => {
    if (provider === read) provider = null;
  };
}

/** The state of the playing title, or `null` when no player is open. */
export function getPlayerSnapshot(): PlayerSnapshot | null {
  return provider ? provider() : null;
}
