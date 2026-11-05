/** A WebVTT cue in integer milliseconds of absolute source time. */
export interface Cue {
  startMs: number;
  endMs: number;
  text: string;
  /** Cue settings that followed the timing line (position, line, ...); empty when none. */
  settings: string;
}

const TIME = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})\.(\d{3})$/;

/** Accepts `MM:SS.mmm` (ffmpeg's form for cues under one hour) and `HH:MM:SS.mmm`. */
export function parseVttTime(stamp: string): number | null {
  const match = TIME.exec(stamp.trim());
  if (!match) return null;
  const hours = match[1] === undefined ? 0 : Number(match[1]);
  return ((hours * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000 + Number(match[4]);
}

/** Always `HH:MM:SS.mmm`: Media3 and hls.js both accept it, and the short form is only optional in the spec. */
export function formatVttTime(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const pad = (value: number, size: number): string => String(value).padStart(size, '0');
  return `${pad(Math.floor(total / 3_600_000), 2)}:${pad(Math.floor(total / 60_000) % 60, 2)}:${pad(Math.floor(total / 1000) % 60, 2)}.${pad(total % 1000, 3)}`;
}

/** Parses one blank-line-free block; returns null for the header, NOTE/STYLE blocks and anything without a timing line. */
export function parseCueBlock(block: string): Cue | null {
  const lines = block.split('\n');
  const timing = lines.findIndex((line) => line.includes('-->'));
  if (timing < 0 || timing > 1) return null;
  const match = /^\s*(\S+)\s+-->\s+(\S+)(?:\s+(.*))?$/.exec(lines[timing] as string);
  if (!match) return null;
  const startMs = parseVttTime(match[1] as string);
  const endMs = parseVttTime(match[2] as string);
  if (startMs === null || endMs === null) return null;
  const text = lines.slice(timing + 1).join('\n').trim();
  if (text === '') return null;
  return { startMs, endMs, text, settings: (match[3] ?? '').trim() };
}

/**
 * Splits growing WebVTT output into complete cue blocks; the unfinished tail is returned so the caller can prepend it to
 * the next chunk. ffmpeg's muxer writes each cue as one flushed unit that starts with the blank separator line and ends
 * with a single newline, so the newest cue is never followed by a blank line until the next one (or never, at the end of
 * the file). A tail that ends in a newline and parses as a cue is therefore complete.
 */
export function takeCueBlocks(pending: string): { cues: Cue[]; rest: string } {
  const text = pending.replace(/\r\n?/g, '\n');
  const cut = text.lastIndexOf('\n\n');
  const cues: Cue[] = [];
  if (cut >= 0) {
    for (const block of text.slice(0, cut).split(/\n{2,}/)) {
      const cue = parseCueBlock(block.replace(/^\n+/, ''));
      if (cue) cues.push(cue);
    }
  }
  const tail = text.slice(cut >= 0 ? cut + 2 : 0);
  if (tail.endsWith('\n')) {
    const cue = parseCueBlock(tail.replace(/^\n+/, '').replace(/\n+$/, ''));
    if (cue) {
      cues.push(cue);
      return { cues, rest: '' };
    }
  }
  return { cues, rest: tail };
}

function cueBlock(cue: Cue, startMs: number, endMs: number): string {
  const settings = cue.settings ? ` ${cue.settings}` : '';
  return `${formatVttTime(startMs)} --> ${formatVttTime(endMs)}${settings}\n${cue.text}\n`;
}

export const TIMESTAMP_MAP = 'X-TIMESTAMP-MAP=MPEGTS:0,LOCAL:00:00:00.000';

/**
 * One HLS segment: every cue overlapping [fromMs, toMs) clipped to it, so a cue crossing a boundary is split and appears
 * whole in no two segments. `cues` must be sorted by start.
 */
export function renderSegment(cues: readonly Cue[], fromMs: number, toMs: number, firstIndex = 0): string {
  const blocks: string[] = [];
  for (let index = firstIndex; index < cues.length; index += 1) {
    const cue = cues[index] as Cue;
    if (cue.startMs >= toMs) break;
    const start = Math.max(cue.startMs, fromMs);
    const end = Math.min(cue.endMs, toMs);
    if (end > start) blocks.push(cueBlock(cue, start, end));
  }
  return `WEBVTT\n${TIMESTAMP_MAP}\n\n${blocks.map((block) => `${block}\n`).join('')}`;
}

/** The whole track as one file; cues keep their own times. */
export function renderFull(cues: readonly Cue[]): string {
  return `WEBVTT\n\n${cues.map((cue) => `${cueBlock(cue, cue.startMs, cue.endMs)}\n`).join('')}`;
}
