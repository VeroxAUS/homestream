import type { AudioTrack, SessionPatchRequest, SubtitleSelection } from '@homestream/shared';
import { AppError } from '../errors.js';
import { selectAudioTrack } from './decision.js';
import type { ProbeResult, SubtitleTrackInfo } from './probe.js';

export interface TrackState {
  audioIndex: number | null;
  subtitle: SubtitleSelection | null;
}

export interface TrackPlan {
  audio: AudioTrack | null;
  subtitle: SubtitleSelection | null;
  /** True when the encoder output changes: another audio track, or burn-in switched on, off or to another track. */
  restart: boolean;
}

export interface BurnTarget {
  index: number;
  canvas?: { width: number; height: number };
}

export function requireAudio(probe: ProbeResult, requestedIndex?: number): AudioTrack | null {
  const audio = selectAudioTrack(probe.audio, requestedIndex);
  if (requestedIndex !== undefined && !audio) {
    throw new AppError(
      400,
      'invalid_audio_index',
      `The file has no audio track ${requestedIndex}.`,
      'Pick one of the audioTracks of this file.',
    );
  }
  return audio;
}

/** A subtitle choice must name a real track, and the mode must suit its kind: text is side-loaded, bitmaps are burned in. */
export function requireSubtitle(
  probe: ProbeResult,
  selection: SubtitleSelection | null | undefined,
): SubtitleSelection | null {
  if (!selection) return null;
  const track: SubtitleTrackInfo | undefined = probe.subtitles.find((item) => item.index === selection.index);
  if (!track) {
    throw new AppError(
      400,
      'invalid_subtitle_index',
      `The file has no subtitle track ${selection.index}.`,
      'Pick one of the subtitleTracks of this file.',
    );
  }
  if (track.kind === 'bitmap' && selection.mode === 'sidecar') {
    throw new AppError(
      400,
      'subtitle_mode_unsupported',
      `Subtitle track ${track.index} is a picture-based subtitle and cannot be sent as text.`,
      'Use mode "burn" to draw it into the video.',
    );
  }
  if (track.kind === 'text' && selection.mode === 'burn') {
    throw new AppError(
      400,
      'subtitle_mode_unsupported',
      `Subtitle track ${track.index} is a text subtitle; the player shows it, so it is not burned into the video.`,
      'Use mode "sidecar" and show the WebVTT file in the player.',
    );
  }
  return selection;
}

export function burnTarget(probe: ProbeResult, selection: SubtitleSelection | null): BurnTarget | null {
  if (selection?.mode !== 'burn') return null;
  const track = probe.subtitles.find((item) => item.index === selection.index);
  return track ? { index: track.index, ...(track.canvas ? { canvas: track.canvas } : {}) } : null;
}

export function planPatch(probe: ProbeResult, current: TrackState, request: SessionPatchRequest): TrackPlan {
  const audio =
    request.audioIndex === undefined
      ? requireAudio(probe, current.audioIndex ?? undefined)
      : requireAudio(probe, request.audioIndex);
  const subtitle = request.subtitle === undefined ? current.subtitle : requireSubtitle(probe, request.subtitle);
  const audioChanged = (audio?.index ?? null) !== current.audioIndex;
  const burnChanged =
    (burnTarget(probe, subtitle)?.index ?? null) !== (burnTarget(probe, current.subtitle)?.index ?? null);
  return { audio, subtitle, restart: audioChanged || burnChanged };
}
