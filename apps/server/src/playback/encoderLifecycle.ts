import { existsSync } from 'node:fs';
import path from 'node:path';
import { toActivitySession, type SessionRecord } from './session.js';
import type { PlaybackContext } from './context.js';
import { stopAndReport } from './discardStop.js';
import { EncoderProcess } from './encoderProcess.js';
import { STARVED_BYTES_PER_SEC } from './extractorSchedule.js';
import { buildFfmpegArgs } from './ffmpegArgs.js';
import type { MemoryLimitHit } from './memoryWatchdog.js';
import { SEGMENT_SECONDS, segmentCount, segmentFileName } from './playlist.js';
import type { RawProgress } from './progress.js';
import type { ReadAheadPacing } from './readAheadPacing.js';
import { burnTarget } from './tracks.js';

export interface EncoderHooks {
  /** The encoder of the current generation exited with a failure. */
  failed(rec: SessionRecord, code: number | null, stderrTail: string): void;
  memoryLimit(rec: SessionRecord, who: string, hit: MemoryLimitHit): void;
}

/** Starts the ffmpeg encoder of a session, follows its progress and exit, and parks and resumes it for the disk cap. */
export class EncoderLifecycle {
  constructor(
    private readonly ctx: PlaybackContext,
    private readonly pacing: ReadAheadPacing,
    private readonly hooks: EncoderHooks,
  ) {}

  launch(rec: SessionRecord, startSegment: number): void {
    if (rec.state === 'error') return;
    const { options, registry, watchdog } = this.ctx;
    rec.startSegment = startSegment;
    rec.generation += 1;
    rec.encoderDone = false;
    rec.parked = false;
    rec.store.forget(startSegment);
    this.pacing.resetSpeed(rec);
    rec.stats = { ...rec.stats, headSegment: startSegment, outTimeSec: startSegment * SEGMENT_SECONDS };
    // The read-ahead window is measured from where this run starts, so a start, seek or restart downloads at full speed again.
    rec.source.resetReadAhead();
    this.ctx.fallingBehind.forget(rec.id);
    const generation = rec.generation;

    rec.source.setExtractorLimit(STARVED_BYTES_PER_SEC);

    const args = buildFfmpegArgs({
      inputUrl: rec.source.url,
      sessionDir: rec.dir,
      decision: rec.decision,
      video: rec.probe.video,
      audioIndex: rec.selectedAudioIndex,
      startSegment,
      toneMapper: rec.toneMapper,
      burn: burnTarget(rec.probe, rec.selectedSubtitle),
      threads: { gpu: options.config.ffmpegThreads, cpu: options.config.ffmpegBurnThreads },
    });
    const proc = (options.createEncoder ?? ((encoderOptions) => new EncoderProcess(encoderOptions)))({
      ffmpegPath: options.config.ffmpegPath,
      args,
      cwd: rec.dir,
      onProgress: (progress) => {
        if (rec.generation === generation) this.onProgress(rec, progress);
      },
      watchdog,
      onMemoryLimit: (hit) => this.hooks.memoryLimit(rec, 'The video encoder', hit),
    });
    rec.process = proc;
    if (rec.opening) rec.startTimeline?.mark('encoder spawned', rec.id);
    const pid = proc.pid;
    if (pid !== undefined) registry.add({ pid, sessionId: rec.id, startedAt: Date.now() });
    void proc.exited.then((exit) => {
      if (pid !== undefined) registry.remove(pid);
      if (rec.generation !== generation || rec.stopping) return;
      if (exit.code === 0) {
        rec.encoderDone = true;
        rec.source.setExtractorLimit(null);
        this.markReady(rec);
        return;
      }
      this.hooks.failed(rec, exit.code, exit.stderrTail);
    });
  }

  markReady(rec: SessionRecord): void {
    if (rec.state === 'starting' && this.hasSegment(rec, rec.startSegment)) {
      rec.state = 'ready';
      this.ctx.options.bus.emit('session.update', toActivitySession(rec));
    }
  }

  hasSegment(rec: SessionRecord, index: number): boolean {
    return existsSync(path.join(rec.dir, segmentFileName(index, rec.format)));
  }

  /** Where a stopped run should continue: just past the segments it already finished. */
  resumePoint(rec: SessionRecord): number {
    let index = Math.max(rec.startSegment, rec.stats.headSegment - 6);
    while (this.hasSegment(rec, index)) index += 1;
    return Math.min(index, segmentCount(rec.probe.durationSec) - 1);
  }

  /** Stops the encoder but keeps its files; `resume` starts it again when the player catches up. */
  park(rec: SessionRecord): Promise<void> {
    if (rec.restart || !rec.process?.running) return Promise.resolve();
    rec.restart = (async () => {
      rec.parked = true;
      rec.generation += 1;
      await stopAndReport(rec.process, { sessionId: rec.id, reason: 'park', logger: this.ctx.options.logger });
    })().finally(() => {
      rec.restart = null;
    });
    return rec.restart;
  }

  resume(rec: SessionRecord): Promise<void> {
    if (rec.restart || rec.stopping || rec.process?.running) return Promise.resolve();
    this.ctx.options.observer?.restarted('resume');
    this.launch(rec, this.resumePoint(rec));
    return Promise.resolve();
  }

  private onProgress(rec: SessionRecord, progress: RawProgress): void {
    const last = segmentCount(rec.probe.durationSec) - 1;
    // ffmpeg reports output time relative to the run's first segment.
    const head = Math.min(last, rec.startSegment + Math.floor(progress.outTimeSec / SEGMENT_SECONDS));
    // The HLS muxer reports no bitrate, so it is derived from segment sizes by the monitor.
    const bitrateKbps = progress.bitrateKbps > 0 ? progress.bitrateKbps : rec.stats.bitrateKbps;
    rec.stats = {
      ...progress,
      bitrateKbps,
      outTimeSec: progress.outTimeSec + rec.startSegment * SEGMENT_SECONDS,
      headSegment: head,
    };
    if (progress.speed > 0) {
      rec.statSamples.speedSum += progress.speed;
      rec.statSamples.speedCount += 1;
    }
    this.pacing.trackSpeed(rec);
    this.pacing.syncReadAhead(rec);
    this.pacing.updateStarved(rec);
    this.markReady(rec);
  }
}
