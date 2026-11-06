import { SEGMENT_SECONDS } from './playlist.js';

const MIB = 1024 * 1024;

/** Sources this tall or taller (and remux-class bitrates) share a source link that the encoder alone can nearly saturate. */
const HEAVY_HEIGHT = 2160;
export const HEAVY_BITRATE_BPS = 45_000_000;
/** Extractor read rate while the encoder is short of lead over the player or slower than `STARVED_SPEED`. */
export const STARVED_BYTES_PER_SEC = 2 * MIB;
/** Extractor read rate while a heavy source's encoder warms up; fast enough for cues soon, slow enough to leave the encoder the link. */
export const WARMUP_BYTES_PER_SEC = 6 * MIB;
/** The encoder is warm once its head is this many segments past the segment it started at. */
const WARMUP_LEAD_SEGMENTS = 10;
const WARMUP_SPEED = 2;
/** A fast speed reading counts only once at least this many segments exist; the first reading is noisy. */
const WARMUP_MIN_SEGMENTS = 3;
const STARVED_LEAD_SEC = 30;
/** Above the 1.2x floor the encoder must keep, so the throttle bites before the floor is reached. */
const STARVED_SPEED = 1.6;
export const BURST_FLOOR_SPEED = 1.35;

export interface SourceShape {
  height: number;
  /** Size of the source file; 0 or null when unknown. */
  sizeBytes: number | null;
  durationSec: number;
}

/** 2160p sources and sources with a very high average bitrate: their extractors must not compete with the encoder for the link. */
export function isHeavySource(source: SourceShape): boolean {
  if (source.height >= HEAVY_HEIGHT) return true;
  if (!source.sizeBytes || source.durationSec <= 0) return false;
  return (source.sizeBytes * 8) / source.durationSec >= HEAVY_BITRATE_BPS;
}

/** At most one extractor at a time for heavy sources; light ones keep the main run plus one fill/seek run. */
export function maxExtractorRuns(heavy: boolean): number {
  return heavy ? 1 : 2;
}

export interface EncoderView {
  done: boolean;
  startSegment: number;
  headSegment: number;
  playerSegment: number;
  /** ffmpeg's average speed over the whole run; 0 while unknown. */
  speed: number;
  /** Speed over the last few seconds; 0 while unknown. */
  recentSpeed: number;
}

/** True once the encoder has built up lead or is clearly fast, so an extractor can share the link with it. */
export function encoderWarm(view: EncoderView): boolean {
  if (view.done) return true;
  const produced = view.headSegment - view.startSegment;
  if (produced >= WARMUP_LEAD_SEGMENTS) return true;
  return produced >= WARMUP_MIN_SEGMENTS && (view.recentSpeed || view.speed) >= WARMUP_SPEED;
}

/** How long a fresh run may read unthrottled while the encoder keeps at least `BURST_FLOOR_SPEED`. */
export const BURST_MAX_MS = 25_000;

export interface BurstInput {
  nowMs: number;
  startedAtMs: number;
  /** When the encoder of a heavy source finished warming up; null while it has not, and always null for light sources. */
  warmAtMs: number | null;
  headSec: number;
  needSec: number;
}

/**
 * True while a run is still reading its first stretch. On a heavy source the warm-up phase is throttled to `WARMUP_BYTES_PER_SEC`,
 * so the burst clock starts when the warm-up ends; counted from the run start, the burst would be over before it began.
 */
export function burstActive({ nowMs, startedAtMs, warmAtMs, headSec, needSec }: BurstInput): boolean {
  return nowMs - Math.max(startedAtMs, warmAtMs ?? 0) < BURST_MAX_MS && headSec < needSec;
}

export interface LimitInput {
  heavy: boolean;
  /** An extractor run is still reading its first stretch, which the viewer waits for. */
  bursting: boolean;
  encoder: EncoderView;
}

/**
 * Bytes per second the subtitle extractors may read from upstream; null means unlimited. Cues near the playhead are what the
 * viewer waits for, so a fresh run reads freely, except on heavy sources while the encoder warms up (its first segments
 * would otherwise stall behind the extractor). After that an extractor backs off whenever the encoder is short of lead or speed.
 */
export function extractorLimit({ heavy, bursting, encoder }: LimitInput): number | null {
  if (encoder.done) return null;
  if (heavy && !encoderWarm(encoder)) return WARMUP_BYTES_PER_SEC;
  if (bursting) {
    return encoder.speed > 0 && encoder.speed < BURST_FLOOR_SPEED ? STARVED_BYTES_PER_SEC : null;
  }
  const lead = (encoder.headSegment - encoder.playerSegment) * SEGMENT_SECONDS;
  const speed = encoder.recentSpeed || encoder.speed;
  return lead < STARVED_LEAD_SEC || (speed > 0 && speed < STARVED_SPEED) ? STARVED_BYTES_PER_SEC : null;
}

export type LimitLabel = 'unlimited' | 'warmup' | 'starved';

/** For logs: names the limit returned by `extractorLimit`. */
export function limitLabel(limit: number | null): LimitLabel {
  if (limit === null) return 'unlimited';
  return limit === WARMUP_BYTES_PER_SEC ? 'warmup' : 'starved';
}
