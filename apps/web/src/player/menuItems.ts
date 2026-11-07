import type { SessionResponse, SubtitleSelection } from '@homestream/shared';
import type { MenuItem } from './TrackMenu';
import { audioEntries, sameSelection, selectionFor, subtitleEntries } from './tracks';

interface MenuSource {
  session: SessionResponse;
  selectedAudioIndex: number | null;
  subtitle: SubtitleSelection | null;
  selectAudio: (index: number) => Promise<void>;
  selectSubtitle: (next: SubtitleSelection | null) => Promise<void>;
}

/** One row per audio track, the playing one checked. */
export function audioMenuItems({ session, selectedAudioIndex, selectAudio }: MenuSource): MenuItem[] {
  return audioEntries(session.audioTracks).map((entry) => ({
    key: `audio-${entry.index}`,
    label: entry.label,
    detail: entry.detail,
    selected: entry.index === selectedAudioIndex,
    onSelect: () => void selectAudio(entry.index),
  }));
}

/** Off first, then the text tracks, then the bitmap tracks (burned in). The checked row follows the live selection. */
export function subtitleMenuItems({ session, subtitle, selectSubtitle }: MenuSource): MenuItem[] {
  const rows = subtitleEntries(session.subtitleTracks).map((entry) => {
    const selection = selectionFor(entry);
    return {
      key: `subtitle-${entry.index}`,
      label: entry.label,
      detail: entry.detail,
      selected: sameSelection(selection, subtitle),
      onSelect: () => void selectSubtitle(selection),
    };
  });
  return [
    { key: 'subtitle-off', label: 'Off', selected: subtitle === null, onSelect: () => void selectSubtitle(null) },
    ...rows,
  ];
}
