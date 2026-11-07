import type { AudioTrack, SubtitleSelection, SubtitleTrack } from '@homestream/shared';

const NAME_SUFFIX = /\s\[(\d{1,4})\]$/;

/** The server track index carried in a rendition NAME such as `English SDH [3]`; `null` when it has none. */
export function serverIndexOf(name: string): number | null {
  const match = NAME_SUFFIX.exec(name);
  return match?.[1] === undefined ? null : Number(match[1]);
}

/** Maps server track indexes to hls.js subtitle track ids using the NAME suffix of each rendition. */
export function mapSubtitleTracks(tracks: ReadonlyArray<{ id: number; name: string }>): Map<number, number> {
  const mapped = new Map<number, number>();
  for (const track of tracks) {
    const index = serverIndexOf(track.name);
    if (index !== null) mapped.set(index, track.id);
  }
  return mapped;
}

let names: Intl.DisplayNames | null | undefined;

function languageName(code: string): string | null {
  if (!code || code === 'und') return null;
  if (names === undefined) {
    try {
      names = new Intl.DisplayNames(['en'], { type: 'language' });
    } catch {
      names = null;
    }
  }
  try {
    const name = names?.of(code);
    return name && name !== code ? name : null;
  } catch {
    return null;
  }
}

function labelOf(language: string, title: string, fallback: string): string {
  const name = languageName(language);
  const clean = title.trim();
  if (!name) return clean || fallback;
  if (!clean || clean.toLowerCase() === name.toLowerCase()) return name;
  return clean.toLowerCase().includes(name.toLowerCase()) ? clean : `${name} - ${clean}`;
}

const CHANNEL_LAYOUTS: Record<number, string> = { 1: '1.0', 2: '2.0', 6: '5.1', 8: '7.1' };

function layoutOf(channels: number): string {
  return CHANNEL_LAYOUTS[channels] ?? `${channels} ch`;
}

export interface AudioEntry {
  index: number;
  label: string;
  detail: string;
}

export function audioEntries(tracks: ReadonlyArray<AudioTrack>): AudioEntry[] {
  return tracks.map((track) => ({
    index: track.index,
    label: labelOf(track.language, track.title, `Track ${track.index + 1}`),
    detail: `${track.codec.toUpperCase()} ${layoutOf(track.channels)} \u2192 AAC`,
  }));
}

export interface SubtitleEntry {
  index: number;
  label: string;
  detail: string | null;
  kind: SubtitleTrack['kind'];
}

/** Menu rows for the session tracks: text tracks first (the server orders them), bitmap tracks marked as burn-in. */
export function subtitleEntries(tracks: ReadonlyArray<SubtitleTrack>): SubtitleEntry[] {
  const entry = (track: SubtitleTrack): SubtitleEntry => {
    const base = labelOf(track.language, track.title, `Subtitle ${track.index + 1}`);
    const label = track.forced && !/forced/i.test(base) ? `${base} (forced)` : base;
    return {
      index: track.index,
      label,
      detail: track.kind === 'bitmap' ? 'Bitmap - burned in, re-encodes video' : null,
      kind: track.kind,
    };
  };
  const usable = tracks.filter((track) => track.kind === 'bitmap' || track.url !== null);
  return [...usable.filter((t) => t.kind === 'text'), ...usable.filter((t) => t.kind === 'bitmap')].map(entry);
}

/** The selection a menu row stands for: text tracks stay client-side (`sidecar`), bitmap tracks are burned in. */
export function selectionFor(entry: SubtitleEntry): SubtitleSelection {
  return { index: entry.index, mode: entry.kind === 'bitmap' ? 'burn' : 'sidecar' };
}

export function sameSelection(a: SubtitleSelection | null, b: SubtitleSelection | null): boolean {
  return a === b || (a !== null && b !== null && a.index === b.index && a.mode === b.mode);
}
