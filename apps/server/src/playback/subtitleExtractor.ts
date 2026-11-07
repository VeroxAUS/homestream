import path from 'node:path';
import type { EncoderExit, EncoderHandle, EncoderProcessOptions } from './encoderProcess.js';
import { burstActive } from './extractorSchedule.js';
import { ExtractorWindows } from './extractorWindow.js';
import type { MemoryLimitHit, MemoryWatchdog } from './memoryWatchdog.js';
import type { PidRegistry } from './pidRegistry.js';
import { SEGMENT_SECONDS } from './playlist.js';
import type { ProbeResult } from './probe.js';
import { SUBTITLE_DIR, SubtitleRun, type RunKind } from './subtitleRun.js';
import { SubtitleStore } from './subtitleStore.js';

export const MAX_TEXT_SUBTITLES = 10;
/**
 * An extractor starts this far before the start of the segment it is needed for, so cues already on screen there are not
 * missed. A run's cues are trusted from 10 s after its start, so this must stay above 10 s for the segment to be covered;
 * every second more is read over the capped link before the first useful cue.
 */
export const PREROLL_SEC = 12;
/**
 * A failed run's retry starts further back than a fresh run: its predecessor's coverage ends 6 s before the head it had
 * committed, and the retry's own trusted coverage starts 10 s after its start, so anything under 16 s leaves a gap.
 */
const RETRY_PREROLL_SEC = 20;
/** A request this close ahead of a running extractor's head is simply waited for: 25x realtime gets there in seconds. */
const NEAR_AHEAD_SEC = 120;
/** A new run is unthrottled until it has read this far past the position it was started for (60 s of cues plus the coverage lag), but never for longer than `BURST_MAX_MS`. */
const BURST_AHEAD_SEC = 72;
/** A run is stopped once it has read this far into the territory of a later run. */
const HANDOVER_SEC = 10;
const DEFAULT_MAX_RUNS = 2;
const ENGLISH = /^en(g|glish)?$/i;

/** Where a run needed for `sec` starts: `PREROLL_SEC` before the segment holding `sec`, which the player asks for first. */
export function prerollStart(sec: number): number {
  return Math.max(0, Math.floor(sec / SEGMENT_SECONDS) * SEGMENT_SECONDS - PREROLL_SEC);
}

/** True when `run` started at or before `sec` and is close enough to it to get there within seconds. */
function reaches(run: SubtitleRun, sec: number): boolean {
  return run.ss <= sec && sec <= run.headSec + NEAR_AHEAD_SEC;
}

export interface TextTrack {
  index: number;
  language: string;
  title: string;
  forced: boolean;
}

/**
 * The text tracks that get a rendition: English first when there are more than the maximum, original order kept.
 * The `keep` track (the session's selected text subtitle) always gets one, at the expense of the last pick.
 */
export function selectTextTracks(probe: Pick<ProbeResult, 'subtitles'>, keep?: number | null): TextTrack[] {
  const text = probe.subtitles.filter((track) => track.kind === 'text');
  if (text.length <= MAX_TEXT_SUBTITLES) return text;
  const english = text.filter((track) => ENGLISH.test(track.language));
  const others = text.filter((track) => !ENGLISH.test(track.language));
  const picked = [...english, ...others].slice(0, MAX_TEXT_SUBTITLES);
  const kept = keep === undefined || keep === null ? undefined : text.find((track) => track.index === keep);
  if (kept && !picked.includes(kept)) picked[MAX_TEXT_SUBTITLES - 1] = kept;
  const chosen = new Set(picked.map((track) => track.index));
  return text.filter((track) => chosen.has(track.index));
}

interface RunEvent {
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
  /** Test seam: replaces the ffmpeg child of every run. */
  createProcess?: (options: EncoderProcessOptions) => EncoderHandle;
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
  private readonly windows: ExtractorWindows | null;
  private readonly warmAt = new WeakMap<SubtitleRun, number>();

  private readonly maxRuns: number;

  constructor(private readonly options: SubtitleExtractorOptions) {
    this.store = new SubtitleStore(options.durationSec, options.tracks);
    this.maxRuns = Math.max(1, options.maxRuns ?? DEFAULT_MAX_RUNS);
    this.windows = options.readAhead
      ? new ExtractorWindows({
          holdSec: options.readAhead.holdSec,
          resumeSec: options.readAhead.resumeSec,
          behindSec: NEAR_AHEAD_SEC,
          setHold: options.readAhead.setHold,
        })
      : null;
  }

  /** Starts the main run; call together with the encoder. */
  start(startSec: number): void {
    if (this.runs.length > 0 || this.options.tracks.length === 0) return;
    this.launch('main', prerollStart(startSec), false).needSec = startSec + BURST_AHEAD_SEC;
  }

  /**
   * True while a main or seek run is still reading its first stretch after it started. Cues near the playhead are what the
   * viewer waits for, so these reads are exempt from the throttle that otherwise yields source bandwidth to the encoder.
   */
  get bursting(): boolean {
    const nowMs = Date.now();
    return this.runs.some(
      (run) =>
        run.running &&
        !run.stopRequested &&
        burstActive({
          nowMs,
          startedAtMs: run.startedAt,
          warmAtMs: this.warmAt.get(run) ?? null,
          headSec: run.headSec,
          needSec: run.needSec,
        }),
    );
  }

  /** The encoder of a heavy source has warmed up: the running runs' burst clocks start now (see `burstActive`). */
  noteEncoderWarm(): void {
    const now = Date.now();
    for (const run of this.runs) if (run.running && !this.warmAt.has(run)) this.warmAt.set(run, now);
  }

  /** Processes currently alive, including ones that are being stopped. */
  get processCount(): number {
    return this.runs.filter((run) => run.running).length;
  }

  get pids(): number[] {
    return this.runs.filter((run) => run.running && run.pid !== undefined).map((run) => run.pid as number);
  }

  /** The read position of every run that is still reading, and whether the run waits at the end of its window. */
  get readPositions(): Array<{ runId: number; kind: RunKind; ss: number; headSec: number; held: boolean }> {
    return this.active().map((run) => ({
      runId: run.id,
      kind: run.kind,
      ss: run.ss,
      headSec: run.headSec,
      held: this.isHeld(run),
    }));
  }

  /**
   * The encoder was restarted at `sec` because the player jumped there. A run that cannot get to `sec` soon is of no use
   * any more, and left running it would keep reading the interleaved file far from the player; `ensureExtractorFor` starts
   * a new one when a subtitle request lands there.
   */
  noteSeek(sec: number): void {
    if (this.stopped) return;
    for (const run of this.active()) if (!reaches(run, sec)) void run.stop();
    this.syncHolds();
  }

  /** Makes sure something is reading toward `sec`; a no-op when it is covered or an extractor is about to get there. */
  ensureExtractorFor(sec: number): void {
    if (this.stopped || this.gaveUp || this.options.tracks.length === 0) return;
    if (this.store.complete || this.store.segmentCovered(Math.floor(sec / 4))) return;
    // A run started this far behind the player would be stopped again at once.
    const playhead = this.options.readAhead?.playheadSec();
    if (playhead !== undefined && sec + NEAR_AHEAD_SEC < playhead) return;
    // A run that started before `sec` covers it as soon as its head is a few seconds past; a second run there would only split the bandwidth.
    if (this.active().some((run) => !this.isHeld(run) && reaches(run, sec))) return;
    if (this.launching) return;
    const ss = prerollStart(sec);
    this.launching = this.launchSeek(sec, ss).finally(() => {
      this.launching = null;
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.launching?.catch(() => undefined);
    await Promise.all(this.runs.map((run) => run.stop()));
  }

  /** Runs that count against `maxRuns`: the live ones and those whose exit is still being reported (a retry may follow). */
  private slotsTaken(): number {
    return this.runs.filter((run) => run.holdsSlot).length;
  }

  private active(): SubtitleRun[] {
    return this.runs.filter((run) => run.running && !run.stopRequested);
  }

  private async launchSeek(sec: number, ss: number): Promise<void> {
    let victim: SubtitleRun | undefined;
    if (this.slotsTaken() >= this.maxRuns) {
      victim = this.active()
        .filter((run) => run.kind !== 'main')
        .sort((a, b) => sec - b.headSec - (sec - a.headSec))[0];
      // Main is only given up when it is the sole candidate left.
      victim ??= this.active().sort((a, b) => a.headSec - b.headSec)[0];
      // Runs already told to stop (a seek left them behind) still hold their slot until they have exited.
      const leaving = this.runs.filter((run) => run.stopRequested && run.holdsSlot);
      await Promise.all([victim?.stop(), ...leaving.map((run) => run.waitForExit())]);
    }
    if (this.stopped || this.gaveUp || this.slotsTaken() >= this.maxRuns) return;
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
      createProcess: this.options.createProcess,
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
    this.options.onRunEvent?.({
      event: 'stop',
      runId: run.id,
      kind: run.kind,
      ss: run.ss,
      headSec: run.headSec,
      exitCode: exit.code,
    });
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
      this.launch(run.kind, Math.max(0, Math.floor(run.committedHeadSec - RETRY_PREROLL_SEC)), true);
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
   * Holds the reads of every run whose read position is a full window past the player and releases them once the player
   * has caught up to within the resume lead. The distance is the run's head minus the player, whatever second the run
   * started at, so a run left ahead of the player by a backward seek waits as well. A run far behind the player is stopped.
   */
  syncHolds(): void {
    if (!this.windows || !this.options.readAhead) return;
    const active = this.active();
    const behind = this.windows.sync(active, this.options.readAhead.playheadSec());
    for (const run of active) if (behind.includes(run.id)) void run.stop();
  }

  /** True when the run is waiting at the end of the window. */
  private isHeld(run: SubtitleRun): boolean {
    return this.windows?.isHeld(run.id) ?? false;
  }

  private release(run: SubtitleRun): void {
    this.windows?.release(run.id);
  }
}
