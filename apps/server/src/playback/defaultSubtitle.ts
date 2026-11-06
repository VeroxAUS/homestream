import type { AudioTrack, SubtitleDefault, SubtitleSelection } from '@homestream/shared';
import type { SubtitleTrackInfo } from './probe.js';
import { isSdhTitle } from './playlist.js';

export interface DefaultSubtitle {
  selection: SubtitleSelection;
  kind: SubtitleDefault;
  /** The chosen track is a forced one (disposition or title), so its rendition is marked FORCED=YES. */
  forced: boolean;
}

const ENGLISH = /^(en|eng|english)([-_].*)?$/i;
const FORCED_TITLE = /forced/i;
const UNDETERMINED = new Set(['', 'und', 'zxx', 'mis', 'mul']);

const isEnglishLanguage = (language: string): boolean => ENGLISH.test(language.trim());

function isForcedSubtitle(track: Pick<SubtitleTrackInfo, 'forced' | 'title'>): boolean {
  return track.forced || FORCED_TITLE.test(track.title);
}

/** True/false for a known language, null when the file does not say. */
function audioIsEnglish(audio: AudioTrack | null, originalLanguage: string | null): boolean | null {
  const language = (audio?.language ?? '').trim().toLowerCase();
  if (!UNDETERMINED.has(language)) return isEnglishLanguage(language);
  return originalLanguage ? isEnglishLanguage(originalLanguage) : null;
}

/** Default-flagged first, then a non-SDH track, then the first in file order. */
function bestOf(tracks: SubtitleTrackInfo[]): SubtitleTrackInfo | undefined {
  return (
    tracks.find((track) => track.default && !isSdhTitle(track.title)) ??
    tracks.find((track) => track.default) ??
    tracks.find((track) => !isSdhTitle(track.title)) ??
    tracks[0]
  );
}

function pick(tracks: SubtitleTrackInfo[]): SubtitleTrackInfo | undefined {
  return (
    bestOf(tracks.filter((track) => track.kind === 'text')) ?? bestOf(tracks.filter((track) => track.kind === 'bitmap'))
  );
}

function result(track: SubtitleTrackInfo, kind: SubtitleDefault): DefaultSubtitle {
  return {
    selection: { index: track.index, mode: track.kind === 'bitmap' ? 'burn' : 'sidecar' },
    kind,
    forced: isForcedSubtitle(track),
  };
}

/**
 * The subtitle a session starts with when the client sent no `subtitle` field. English audio gets a forced English track
 * (foreign dialogue only), anything else a full English track; otherwise Off. A text track always beats a bitmap one, which
 * has to be burned into the video.
 */
export function chooseDefaultSubtitle(
  subtitles: readonly SubtitleTrackInfo[],
  audio: AudioTrack | null,
  originalLanguage: string | null,
): DefaultSubtitle | null {
  const english = audioIsEnglish(audio, originalLanguage);
  if (english === null) return null;
  const tracks = subtitles.filter((track) => isEnglishLanguage(track.language));
  const forced = tracks.filter(isForcedSubtitle);
  if (english) {
    const track = pick(forced);
    return track ? result(track, 'forced-english') : null;
  }
  const full = tracks.filter((track) => !isForcedSubtitle(track));
  const track = pick(full) ?? pick(forced);
  return track ? result(track, 'english') : null;
}
