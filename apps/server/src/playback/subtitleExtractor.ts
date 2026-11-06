import path from 'node:path';
import { ReadAheadWindow } from '../network/readAhead.js';
import type { EncoderExit } from './encoderProcess.js';
import type { MemoryLimitHit, MemoryWatchdog } from './memoryWatchdog.js';
import type { PidRegistry } from './pidRegistry.js';
import type { ProbeResult } from './probe.js';
import { SUBTITLE_DIR, SubtitleRun, type RunKind } from './subtitleRun.js';
import { SubtitleStore } from './subtitleStore.js';

export const MAX_TEXT_SUBTITLES = 10;
/** An extractor starts this far before the position it is needed at, so cues already on screen there are not missed. */
export const PREROLL_SEC = 40;
/** A request this close ahead of a running extractor's head is simply waited for: 25x realtime gets there in seconds. */
export const NEAR_AHEAD_SEC = 120;
/** A new run is unthrottled until it has read this far past the position it was started for (60 s of cues plus the coverage lag), but never for longer than `BURST_MAX_MS`. */
const BURST_AHEAD_SEC = 72;
const BURST_MAX_MS = 25_000;
/** A run is stopped once it has read this far into the territory of a later run. */
const HANDOVER_SEC = 10;
export const DEFAULT_MAX_RUNS = 2;
const ENGLISH = /^en(g|glish)?$/i;

export interface TextTrack {
  index: number;
  language: string;
  title: string;
  forced: boolean;
}

/** The text tracks that get a rendition: English first when there are more than the maximum, original order kept. */
export function selectTextTracks(probe: Pick<ProbeResult, 'subtitles'>): TextTrack[] {
  const text = probe.subtitles.filter((track) => track.kind === 'text');
  if (text.length <= MAX_TEXT_SUBTITLES) return text;
  const english = text.filter((track) => ENGLISH.test(track.language));
  const others = text.filter((track) => !ENGLISH.test(track.language));
  const chosen = new Set([...english, ...others].slice(0, MAX_TEXT_SUBTITLES).map((track) => track.index));
  return text.filter((track) => chosen.has(track.index));
}

export interface RunEvent {
  event: 'start' | 'stop';
  runId: number;
  kind: RunKind;
  /** Source second the run reads from. */
  ss: number;
  /** Source second the run had read up to (equals `ss` at start). */
  headSec: number;
  exitCode?: number | null;
}

export interface SubtitleExtractorOptions {
  ffmpegPath: string;
  sessionId: string;
  sessionDir: string;
  /** Read at each launch; the run id lets the source proxy tell the runs apart. */
  inputUrl: (runId: number) => string;
  videoIndex: number;
  durationSec: number;
  tracks: readonly number[];
  /** Extractor processes allowed at once; defaults to 2 (see `maxExtractorRuns`). */
  maxRuns?: number;
  /** Debug trail: every extractor process start and stop. */
  onRunEvent?: (event: RunEvent) => void;
  registry: PidRegistry;
  watchdog?: MemoryWatchdog;
  /** A run was stopped for exceeding the memory limit; the owner ends the session. */
  onMemoryLimit?: (hit: MemoryLimitHit) => void;
  /** Called once when extraction gave up for good. */
  onFailure: (exit: EncoderExit) => void;
  /** Keeps runs from reading further than `holdSec` of media past the player; they continue below `resumeSec`. */
  readAhead?: {
    holdSec: number;
    resumeSec: number;
    playheadSec: () => number;
    /** Holds (true) or releases the source reads of a run. */
    setHold: (runId: number, held: boolean) => void;
  };
}

/**
 * Keeps a session's subtitle cue store filled. At most two ffmpeg processes run at once: `main` from just before the start
 * position towards the end of the file (never further than the read-ahead window past the player), and `seek` runs that
 * `ensureExtractorFor` starts when a request lands where nothing is heading, including the part before the start position,
 * which is only read when somebody asks for it. Independent of encoder restarts.
 */
export class SubtitleExtractor {
  readonly store: SubtitleStore;
  private readonly runs: SubtitleRun[] = [];
  private nextRunId = 1;
  private stopped = false;
  private gaveUp = false;
  private launching: Promise<void> | null = null;
  private readonly windows = new Map<number, ReadAheadWindow>();

  private readonly maxRuns: number;

  constructor(private readonly options: SubtitleExtractorOptions) {
    this.store = new SubtitleStore(options.durationSec, options.tracks);
    this.maxRuns = Math.max(1, options.maxRuns ?? DEFAULT_MAX_RUNS);
  }

  /** Starts the main run; call together with the encoder. */
  start(startSec: number): void {
    if (this.runs.length > 0 || this.options.tracks.length === 0) return;
    this.launch('main', Math.max(0, Math.floor(startSec - PREROLL_SEC)), false).needSec = startSec + BURST_AHEAD_SEC;
  }

  /**
   * True while a main or seek run is still reading its first stretch after it started. Cues near the playhead are what the
   * viewer waits for, so these reads are exempt from the throttle that otherwise yields source bandwidth to the encoder.
   */
  get bursting(): boolean {
    const now = Date.now();
    return this.runs.some(
      (run) =>
        run.running &&
        !run.stopRequested &&
        now - run.startedAt < BURST_MAX_MS &&
        run.headSec < run.needSec,
    );
  }

  /** Processes currently alive, including ones that are being stopped. */
  get processCount(): number {
    return this.runs.filter((run) => run.running).length;
  }

  get pids(): number[] {
    return this.runs.filter((run) => run.running && run.pid !== undefined).map((run) => run.pid as number);
  }

  /** Makes sure something is reading toward `sec`; a no-op when it is covered or an extractor is about to get there. */
  ensureExtractorFor(sec: number): void {
    if (this.stopped || this.gaveUp || this.options.tracks.length === 0) return;
    if (this.store.complete || this.store.segmentCovered(Math.floor(sec / 4))) return;
    // A run that started before `sec` covers it as soon as its head is a few seconds past; a second run there would only split the bandwidth.
    if (this.active().some((run) => !this.isHeld(run) && run.ss <= sec && sec <= run.headSec + NEAR_AHEAD_SEC)) return;
    if (this.launching) return;
    const ss = Math.max(0, Math.floor(sec - PREROLL_SEC));
    this.launching = this.launchSeek(sec, ss).finally(() => {
      this.launching = null;
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.launching?.catch(() => undefined);
    await Promise.all(this.runs.map((run) => run.stop()));
  }

  private active(): SubtitleRun[] {
    return this.runs.filter((run) => run.running && !run.stopRequested);
  }

  private async launchSeek(sec: number, ss: number): Promise<void> {
    let victim: SubtitleRun | undefined;
    if (this.processCount >= this.maxRuns) {
      victim = this.active()
        .filter((run) => run.kind !== 'main')
        .sort((a, b) => sec - b.headSec - (sec - a.headSec))[0];
      // Main is only given up when it is the sole candidate left.
      victim ??= this.active().sort((a, b) => a.headSec - b.headSec)[0];
      await victim?.stop();
    }
    if (this.stopped || this.gaveUp || this.processCount >= this.maxRuns) return;
    if (this.store.segmentCovered(Math.floor(sec / 4))) return;
    this.launch('seek', ss, false).needSec = sec + BURST_AHEAD_SEC;
  }

  private launch(kind: RunKind, ss: number, retried: boolean): SubtitleRun {
    const id = this.nextRunId;
    this.nextRunId += 1;
    const run = new SubtitleRun({
      id,
      kind,
      ss,
      retried,
      ffmpegPath: this.options.ffmpegPath,
      sessionId: this.options.sessionId,
      sessionDir: this.options.sessionDir,
      registry: this.options.registry,
      watchdog: this.options.watchdog,
      onMemoryLimit: this.options.onMemoryLimit,
      inputUrl: this.options.inputUrl(id),
      videoIndex: this.options.videoIndex,
      tracks: this.options.tracks,
      outputDir: path.join(SUBTITLE_DIR, `run${id}`),
      onCues: (track, cues) => this.store.addCues(track, cues),
      onUpdate: (current) => this.onUpdate(current),
      onExit: (current, exit) => this.onExit(current, exit),
    });
    this.runs.push(run);
    this.options.onRunEvent?.({ event: 'start', runId: id, kind, ss, headSec: ss });
    return run;
  }

  private onUpdate(run: SubtitleRun): void {
    this.store.setCoverage(run.id, run.coverage());
    if (!this.stopped) {
      this.evaluate();
      this.syncHolds();
    }
  }

  private onExit(run: SubtitleRun, exit: EncoderExit): void {
    this.release(run);
    this.options.onRunEvent?.({ event: 'stop', runId: run.id, kind: run.kind, ss: run.ss, headSec: run.headSec, exitCode: exit.code });
    this.store.setCoverage(run.id, run.coverage());
    if (this.stopped || run.stopRequested) {
      if (!this.stopped) this.evaluate();
      return;
    }
    if (exit.code !== 0) {
      this.recover(run, exit);
      return;
    }
    this.evaluate();
  }

  /** A failed run is restarted once from shortly before where it stopped; the second failure ends extraction. */
  private recover(run: SubtitleRun, exit: EncoderExit): void {
    if (!run.retried) {
      this.launch(run.kind, Math.max(0, Math.floor(run.committedHeadSec - PREROLL_SEC)), true);
      return;
    }
    this.gaveUp = true;
    this.store.markFailed();
    this.options.onFailure(exit);
    void Promise.all(this.active().map((other) => other.stop()));
  }

  private evaluate(): void {
    if (this.gaveUp) return;
    if (this.store.complete) {
      for (const run of this.active()) void run.stop();
      return;
    }
    for (const run of this.active()) {
      const handedOver = this.runs.some(
        (other) =>
          other !== run &&
          other.ss > run.ss &&
          (other.done || (other.running && !other.stopRequested)) &&
          run.headSec >= other.coverStart + HANDOVER_SEC,
      );
      if (handedOver) void run.stop();
    }
  }

  /**
   * Holds the reads of every run that is a full read-ahead window past the player and releases them once the player has
   * caught up to within the resume lead. A run is measured from its own start when the player is still before it (a seek
   * run started for a position the next ping has not reported yet).
   */
  syncHolds(): void {
    const window = this.options.readAhead;
    if (!window) return;
    const playhead = window.playheadSec();
    for (const run of this.active()) {
      const state = this.windows.get(run.id) ?? new ReadAheadWindow(window.holdSec, window.resumeSec);
      this.windows.set(run.id, state);
      if (state.update(run.headSec - Math.max(playhead, run.ss))) window.setHold(run.id, state.waiting);
    }
  }

  /** True when the run is waiting at the end of the window. */
  private isHeld(run: SubtitleRun): boolean {
    return this.windows.get(run.id)?.waiting ?? false;
  }

  private release(run: SubtitleRun): void {
    if (this.windows.delete(run.id)) this.options.readAhead?.setHold(run.id, false);
  }
}
