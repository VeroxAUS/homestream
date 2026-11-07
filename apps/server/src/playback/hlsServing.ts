import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { copyFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../errors.js';
import type { PlaybackContext } from './context.js';
import type { EncoderLifecycle } from './encoderLifecycle.js';
import {
  SEGMENT_SECONDS,
  contentTypeFor,
  generateMasterPlaylist,
  generatePlaylist,
  segmentCount,
  segmentFileName,
  type HlsFile,
} from './playlist.js';
import type { ReadAheadPacing } from './readAheadPacing.js';
import { isLost, type Recovery } from './recovery.js';
import type { SessionRecord } from './session.js';
import { notFound, POLL_MS, sleep, type ServedFile, type WaitOutcome } from './support.js';

/** A request that keeps finding its segment evicted or skipped gives up after this many encoder restarts. */
const MAX_SERVE_ATTEMPTS = 3;

/** Answers the playlist, init and segment requests of a session, restarting the encoder for a seek. */
export class HlsServing {
  constructor(
    private readonly ctx: PlaybackContext,
    private readonly encoder: EncoderLifecycle,
    private readonly recovery: Recovery,
    private readonly pacing: ReadAheadPacing,
  ) {}

  async serve(id: string, file: HlsFile): Promise<ServedFile> {
    const rec = this.ctx.slots.require(id);
    rec.lastActivity = Date.now();
    const contentType = contentTypeFor(file);

    if (file.kind === 'master') {
      const body = generateMasterPlaylist({
        decision: rec.decision,
        fps: rec.probe.video.fps,
        tracks: rec.textTracks,
        defaultTrack:
          rec.subtitleDefault && rec.selectedSubtitle?.mode === 'sidecar'
            ? { index: rec.selectedSubtitle.index, forced: rec.defaultForced }
            : null,
      });
      return { kind: 'text', body, contentType };
    }
    if (file.kind === 'playlist') {
      return { kind: 'text', body: generatePlaylist(rec.probe.durationSec, rec.format), contentType };
    }
    if (file.kind === 'init') {
      if (rec.format !== 'fmp4')
        throw notFound('This session has no init segment.', 'MPEG-TS sessions are self-contained.');
      return this.counted(rec, await this.initResponse(rec, contentType));
    }

    const expectedExtension = rec.format === 'fmp4' ? 'm4s' : 'ts';
    if (file.extension !== expectedExtension || file.index >= segmentCount(rec.probe.durationSec)) {
      throw notFound(
        `Segment ${file.index} does not exist in this session.`,
        'Use the segment names listed in video.m3u8.',
      );
    }
    // A track switch replaces the files on disk; nothing from before it may be served.
    while (rec.restart) await rec.restart.catch(() => undefined);
    rec.playerSegment = file.index;
    if (Date.now() - rec.pingedAt > 30_000) rec.positionSec = file.index * SEGMENT_SECONDS;
    this.pacing.followPlayhead(rec);

    const target = path.join(rec.dir, segmentFileName(file.index, rec.format));
    for (let attempt = 1; ; attempt += 1) {
      if (!existsSync(target)) await this.recovery.ensureEncoder(rec, file.index);
      if ((await this.waitForFile(rec, target, file.index)) === 'ready') break;
      if (attempt >= MAX_SERVE_ATTEMPTS) {
        throw new AppError(
          504,
          'segment_timeout',
          `Segment ${file.index} was not ready in time.`,
          'The encoder is busy with another seek; try again.',
        );
      }
    }
    this.encoder.markReady(rec);
    rec.lastActivity = Date.now();
    return this.counted(rec, { kind: 'file', path: target, size: statSync(target).size, contentType });
  }

  /**
   * ffmpeg creates init.mp4 early but only finishes it together with the first segment of a run, and every run rewrites
   * it (with identical content, thanks to frag_discont). The served copy is therefore taken once, after a run finished
   * its first segment, so a half-written file is never served.
   */
  private async initResponse(rec: SessionRecord, contentType: string): Promise<ServedFile> {
    const ready = path.join(rec.dir, 'init-ready.mp4');
    while (!existsSync(ready)) {
      const generation = await this.runWithFinishedFirstSegment(rec);
      const temp = path.join(rec.dir, `init-${randomUUID()}.tmp`);
      await copyFile(path.join(rec.dir, 'init.mp4'), temp);
      if (rec.generation !== generation) {
        // A restart began while copying, so the copy may be torn.
        await rm(temp, { force: true });
        continue;
      }
      await rename(temp, ready);
    }
    return { kind: 'file', path: ready, size: statSync(ready).size, contentType };
  }

  /** Waits until the current ffmpeg run has finished its first segment, which also completes that run's init.mp4. */
  private async runWithFinishedFirstSegment(rec: SessionRecord): Promise<number> {
    const deadline = Date.now() + this.ctx.segmentWaitMs;
    for (;;) {
      const first = path.join(rec.dir, segmentFileName(rec.startSegment, rec.format));
      const produced = rec.stats.headSegment > rec.startSegment || rec.encoderDone;
      // A stopped run left its init.mp4 complete even when disk eviction already removed its first segment.
      if (!rec.restart && produced && (existsSync(first) || !rec.process?.running)) return rec.generation;
      if (rec.stopping) throw notFound('This session has ended.');
      if (rec.state === 'error') {
        throw new AppError(
          502,
          rec.errorCode ?? 'encoder_failed',
          rec.error?.message ?? 'The encoder failed.',
          rec.error?.hint,
        );
      }
      if (Date.now() >= deadline) {
        throw new AppError(
          504,
          'segment_timeout',
          'The encoder did not start in time.',
          'The encoder is behind; try again, or check the health dashboard.',
        );
      }
      await sleep(POLL_MS);
    }
  }

  private async waitForFile(rec: SessionRecord, target: string, segment: number): Promise<WaitOutcome> {
    const deadline = Date.now() + this.ctx.segmentWaitMs;
    for (;;) {
      if (existsSync(target)) return 'ready';
      if (rec.stopping) throw notFound('This session has ended.');
      if (rec.state === 'error') {
        throw new AppError(
          502,
          rec.errorCode ?? 'encoder_failed',
          rec.error?.message ?? 'The encoder failed.',
          rec.error?.hint,
        );
      }
      if (rec.encoderDone && !rec.process?.running) {
        throw notFound(`Segment ${segment} was not produced.`, 'Seek again or restart playback.');
      }
      if (!rec.restart && isLost(rec, segment)) return 'lost';
      if (Date.now() >= deadline) {
        throw new AppError(
          504,
          'segment_timeout',
          `Segment ${segment} was not ready in time.`,
          'The encoder is behind; try again, or check the health dashboard.',
        );
      }
      await sleep(POLL_MS);
    }
  }

  /** Counts the media bytes handed to the client; the figure feeds the bandwidth statistics. */
  private counted(rec: SessionRecord, served: ServedFile): ServedFile {
    if (served.kind === 'file') rec.bytesServed += served.size;
    return served;
  }
}
