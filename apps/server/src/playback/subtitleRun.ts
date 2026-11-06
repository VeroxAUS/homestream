import { mkdirSync } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { EncoderProcess, type EncoderExit } from './encoderProcess.js';
import type { Interval } from './intervals.js';
import type { MemoryLimitHit, MemoryWatchdog } from './memoryWatchdog.js';
import { PROBE_LIMIT_ARGS } from './probe.js';
import type { PidRegistry } from './pidRegistry.js';
import { takeCueBlocks, type Cue } from './vtt.js';

export const SUBTITLE_DIR = 'subs';
/** Marks extractor processes in the pid registry; it is part of every extractor command line (`-f webvtt`). */
export const EXTRACTOR_MARKER = 'webvtt';
/** A cue can start this long before a seek point and still be dropped by the seek; segments are trusted from `ss + MAX_CUE_SEC`. */
export const MAX_CUE_SEC = 10;
/** Cues sit in the cluster holding their start, and progress reports the last video packet read: the newest seconds may still be unread. */
export const LAG_SEC = 6;
const COVER_FILE = 'cover.txt';
const COVER_TAIL_BYTES = 1024;
const TAIL_INTERVAL_MS = 250;
const READ_CHUNK = 1024 * 1024;

export type RunKind = 'main' | 'head' | 'seek';

export interface ExtractJob {
  inputUrl: string;
  /** Absolute source time to start at; 0 reads from the beginning. */
  ss: number;
  videoIndex: number;
  tracks: readonly number[];
  /** Directory the run writes its `<track>.vtt` files into, relative to the session directory (the process cwd) so the session id stays off the command line. */
  outputDir: string;
}

/**
 * One ffmpeg reading the source once and writing every text track as a growing WebVTT file. The extra copy-only video
 * output costs no bandwidth and is the coverage clock: the cue timeline itself is too sparse to say how far the file was read.
 * It is a per-packet `framecrc` listing rather than `-progress`, because out_time follows the slowest output and a sparse
 * (forced or signs) track would hold it back for minutes. `-copyts` keeps all times absolute.
 */
export function buildExtractArgs(job: ExtractJob): string[] {
  const args = ['-hide_banner', '-loglevel', 'error', '-nostats', '-y', '-threads', '2', ...PROBE_LIMIT_ARGS, '-copyts'];
  if (job.ss > 0) args.push('-ss', String(job.ss));
  args.push('-i', job.inputUrl);
  args.push('-map', `0:${job.videoIndex}`, '-c', 'copy', '-flush_packets', '1', '-f', 'framecrc', path.join(job.outputDir, COVER_FILE));
  for (const track of job.tracks) {
    args.push('-map', `0:${track}`, '-c:s', 'webvtt', '-flush_packets', '1', '-f', EXTRACTOR_MARKER, path.join(job.outputDir, `${track}.vtt`));
  }
  return args;
}

export interface SubtitleRunOptions extends ExtractJob {
  id: number;
  kind: RunKind;
  ffmpegPath: string;
  sessionId: string;
  sessionDir: string;
  registry: PidRegistry;
  watchdog?: MemoryWatchdog;
  onMemoryLimit?: (hit: MemoryLimitHit) => void;
  /** Set when this run replaces one that failed. */
  retried: boolean;
  onCues: (track: number, cues: Cue[]) => void;
  onUpdate: (run: SubtitleRun) => void;
  onExit: (run: SubtitleRun, exit: EncoderExit) => void;
}

/** Seconds per tick of the coverage listing, from its `#tb 0: 1/1000` header line. */
export function parseCoverTimebase(text: string): number | null {
  const match = /^#tb 0: (\d+)\/(\d+)/m.exec(text);
  if (!match) return null;
  const [num, den] = [Number(match[1]), Number(match[2])];
  return num > 0 && den > 0 ? num / den : null;
}

/** Decode time in seconds of the last complete packet line in the tail of a coverage listing. */
export function parseCoverHead(tail: string, timebase: number): number | null {
  const lines = tail.split('\n');
  lines.pop();
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const match = /^\s*0,\s*(-?\d+),/.exec(lines[i] as string);
    if (match) return Number(match[1]) * timebase;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SubtitleRun {
  readonly id: number;
  readonly kind: RunKind;
  readonly ss: number;
  readonly retried: boolean;
  readonly startedAt = Date.now();
  /** Newest absolute source time ffmpeg reports having read. */
  headSec: number;
  /** Head as it was before the files were last read completely: only that much is safe to call covered. */
  committedHeadSec: number;
  /** Source time the run is expected to read quickly (see `SubtitleExtractor.bursting`); defaults to a fixed distance past `ss`. */
  needSec: number;
  /** The run read to the end of the file. */
  done = false;
  stopRequested = false;
  exit: EncoderExit | null = null;
  private readonly process: EncoderProcess;
  private readonly outputPath: string;
  private timebase: number | null = null;
  private readonly offsets = new Map<number, number>();
  private readonly pending = new Map<number, string>();
  private readonly decoders = new Map<number, StringDecoder>();
  private readonly finished: Promise<void>;

  constructor(private readonly options: SubtitleRunOptions) {
    this.id = options.id;
    this.kind = options.kind;
    this.ss = options.ss;
    this.retried = options.retried;
    this.headSec = options.ss;
    this.needSec = options.ss + 110;
    this.committedHeadSec = options.ss;
    this.outputPath = path.join(options.sessionDir, options.outputDir);
    mkdirSync(this.outputPath, { recursive: true });

    this.process = new EncoderProcess({
      ffmpegPath: options.ffmpegPath,
      args: buildExtractArgs(options),
      cwd: options.sessionDir,
      onProgress: () => undefined,
      watchdog: options.watchdog,
      onMemoryLimit: options.onMemoryLimit,
    });
    const pid = this.process.pid;
    if (pid !== undefined) {
      options.registry.add({ pid, sessionId: options.sessionId, startedAt: Date.now(), match: EXTRACTOR_MARKER });
    }
    this.finished = this.watch(pid);
  }

  get pid(): number | undefined {
    return this.process.pid;
  }

  get running(): boolean {
    return this.process.running;
  }

  /** Where this run's trusted coverage starts. */
  get coverStart(): number {
    return this.ss === 0 ? 0 : this.ss + MAX_CUE_SEC;
  }

  /** Where this run's trusted coverage ends right now. */
  get coverEnd(): number {
    return this.done ? Number.POSITIVE_INFINITY : this.committedHeadSec - LAG_SEC;
  }

  /** The run's progress point for scheduling: never behind where its coverage starts. */
  get frontier(): number {
    return Math.max(this.coverStart, this.coverEnd);
  }

  coverage(): Interval | null {
    const interval = { start: this.coverStart, end: this.coverEnd };
    return interval.end > interval.start ? interval : null;
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    await this.process.stop();
    await this.finished;
  }

  waitForExit(): Promise<void> {
    return this.finished;
  }

  private async watch(pid: number | undefined): Promise<void> {
    let exited = false;
    void this.process.exited.then(() => {
      exited = true;
    });
    while (!exited) {
      await this.readCover();
      await this.readAll(this.headSec);
      this.options.onUpdate(this);
      await Promise.race([sleep(TAIL_INTERVAL_MS), this.process.exited]);
    }
    const exit = await this.process.exited;
    if (pid !== undefined) this.options.registry.remove(pid);
    await this.readCover();
    await this.readAll(this.headSec);
    this.exit = exit;
    this.done = exit.code === 0 && !this.stopRequested;
    this.options.onExit(this, exit);
  }

  /** Moves the head to the newest video packet listed in the coverage file. */
  private async readCover(): Promise<void> {
    let handle;
    try {
      handle = await open(path.join(this.outputPath, COVER_FILE), 'r');
    } catch {
      return;
    }
    try {
      const size = (await handle.stat()).size;
      if (this.timebase === null) {
        const { bytesRead, buffer } = await handle.read(Buffer.alloc(COVER_TAIL_BYTES), 0, COVER_TAIL_BYTES, 0);
        this.timebase = parseCoverTimebase(buffer.toString('utf8', 0, bytesRead));
        if (this.timebase === null) return;
      }
      const length = Math.min(size, COVER_TAIL_BYTES);
      const { bytesRead, buffer } = await handle.read(Buffer.alloc(length), 0, length, size - length);
      const sec = parseCoverHead(buffer.toString('utf8', 0, bytesRead), this.timebase);
      if (sec !== null) this.headSec = Math.max(this.headSec, sec);
    } catch {
      // The next pass reads it again.
    } finally {
      await handle.close();
    }
  }

  /** Reads what the files gained since the last pass; `head` was sampled before reading, so cues up to it are in. */
  private async readAll(head: number): Promise<void> {
    let complete = true;
    for (const track of this.options.tracks) {
      try {
        await this.readTrack(track);
      } catch {
        complete = false;
      }
    }
    if (complete) this.committedHeadSec = Math.max(this.committedHeadSec, head);
  }

  private async readTrack(track: number): Promise<void> {
    const file = path.join(this.outputPath, `${track}.vtt`);
    let handle;
    try {
      handle = await open(file, 'r');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    try {
      let offset = this.offsets.get(track) ?? 0;
      const size = (await handle.stat()).size;
      const decoder = this.decoders.get(track) ?? new StringDecoder('utf8');
      this.decoders.set(track, decoder);
      let text = this.pending.get(track) ?? '';
      while (offset < size) {
        const buffer = Buffer.allocUnsafe(Math.min(READ_CHUNK, size - offset));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
        text += decoder.write(buffer.subarray(0, bytesRead));
      }
      this.offsets.set(track, offset);
      const { cues, rest } = takeCueBlocks(text);
      this.pending.set(track, rest);
      if (cues.length > 0) this.options.onCues(track, cues);
    } finally {
      await handle.close();
    }
  }
}
