import { AppError } from '../errors.js';
import { encoderWindowSec } from '../network/readAhead.js';
import type { PlaybackContext } from './context.js';
import { maxExtractorRuns } from './extractorSchedule.js';
import type { MemoryLimitHit } from './memoryWatchdog.js';
import { generateSubtitlePlaylist, SEGMENT_SECONDS } from './playlist.js';
import type { ReadAheadPacing } from './readAheadPacing.js';
import type { SessionRecord } from './session.js';
import { SubtitleExtractor } from './subtitleExtractor.js';
import { notFound, POLL_MS, scrub, sleep, type ServedFile } from './support.js';
import { renderSegment } from './vtt.js';

const SUBTITLE_PLAYLIST_TYPE = 'application/vnd.apple.mpegurl';
const SUBTITLE_SEGMENT_TYPE = 'text/vtt; charset=utf-8';

/** Wires the progressive WebVTT extractor to a session and answers the subtitle requests from its cue store. */
export class SubtitleHandoff {
  constructor(
    private readonly ctx: PlaybackContext,
    private readonly pacing: ReadAheadPacing,
    private readonly onMemoryLimit: (rec: SessionRecord, who: string, hit: MemoryLimitHit) => void,
  ) {}

  /** The main extractor starts together with the encoder: cues for the start position must not wait for the first segment. */
  start(rec: SessionRecord): void {
    const tracks = rec.textTracks.map((track) => track.index);
    if (tracks.length === 0) return;
    const { options, registry, watchdog } = this.ctx;
    rec.subtitles = new SubtitleExtractor({
      ffmpegPath: options.config.ffmpegPath,
      sessionId: rec.id,
      sessionDir: rec.dir,
      inputUrl: (runId) => rec.source.extractorRunUrl(runId),
      readAhead: {
        holdSec: encoderWindowSec(options.config.readAheadSec),
        resumeSec: options.config.readAheadResumeSec,
        playheadSec: () => this.pacing.reachSec(rec),
        setHold: (runId, held) => rec.source.setExtractorHold(runId, held),
      },
      videoIndex: rec.probe.video.index,
      durationSec: rec.probe.durationSec,
      tracks,
      maxRuns: maxExtractorRuns(this.pacing.isHeavy(rec)),
      onRunEvent: (run) => {
        if (run.event === 'start' && rec.opening) rec.startTimeline?.mark('extractor started', rec.id);
        options.logger.info(
          { sessionId: rec.id, sinceStartMs: Date.now() - rec.startedAt, ...run },
          `Subtitle extractor run ${run.event === 'start' ? 'started' : 'stopped'}`,
        );
      },
      registry,
      watchdog,
      onMemoryLimit: (hit) => this.onMemoryLimit(rec, 'The subtitle extractor', hit),
      onFailure: (exit) => {
        this.ctx.event({
          level: 'warn',
          source: 'ffmpeg',
          message: `Could not extract subtitle tracks ${tracks.join(', ')} to WebVTT; the unread parts stay unavailable for this session.`,
          details: { tracks, detail: scrub(exit.stderrTail.split(/\r?\n/).filter(Boolean).at(-1) ?? '') },
          sessionId: rec.id,
        });
      },
    });
    rec.subtitles.start(rec.requestedStartSec);
    this.pacing.updateStarved(rec);
  }

  playlist(id: string, index: number): ServedFile {
    const { rec } = this.track(id, index);
    return { kind: 'text', body: generateSubtitlePlaylist(rec.probe.durationSec), contentType: SUBTITLE_PLAYLIST_TYPE };
  }

  /**
   * A segment whose time range no extractor has read yet is waited for (and an extractor is steered to it); only then does the
   * client get a 503 to retry. A covered segment always has its full cues, so an empty 200 never stands in for missing data.
   */
  async segment(id: string, index: number, segment: number, signal?: AbortSignal): Promise<ServedFile> {
    const { rec, extractor } = this.track(id, index);
    const { store } = extractor;
    if (segment >= store.segmentTotal) {
      throw notFound(
        `Subtitle segment ${segment} does not exist in this session.`,
        'Use the segment names listed in the rendition playlist.',
      );
    }
    const deadline = Date.now() + this.ctx.subtitleHoldMs;
    for (;;) {
      rec.lastActivity = Date.now();
      if (store.segmentCovered(segment)) {
        return { kind: 'text', body: store.segment(index, segment), contentType: SUBTITLE_SEGMENT_TYPE };
      }
      if (store.status() === 'error') {
        return {
          kind: 'text',
          body: renderSegment([], 0, 0),
          contentType: SUBTITLE_SEGMENT_TYPE,
          headers: { 'X-Subtitle-Status': 'failed' },
        };
      }
      if (rec.stopping) throw notFound('This session has ended.');
      // Cues beyond the read-ahead window are not read yet: the request keeps getting 503 until the player is closer.
      if (
        segment * SEGMENT_SECONDS <
        this.pacing.reachSec(rec) + encoderWindowSec(this.ctx.options.config.readAheadSec)
      ) {
        extractor.ensureExtractorFor(segment * SEGMENT_SECONDS);
      }
      if (Date.now() >= deadline || signal?.aborted) break;
      await sleep(POLL_MS);
    }
    throw new AppError(
      503,
      'subtitle_not_ready',
      `Subtitle segment ${segment} is not extracted yet.`,
      'Retry the request in a second.',
      { 'Retry-After': '1', 'Cache-Control': 'no-store' },
    );
  }

  full(id: string, index: number): ServedFile {
    const { extractor } = this.track(id, index);
    if (!extractor.store.complete) {
      throw new AppError(
        404,
        'subtitle_not_ready',
        `Subtitle track ${index} is still being extracted.`,
        'Wait until fullUrl is set in the session, then fetch it.',
      );
    }
    return { kind: 'text', body: extractor.store.full(index), contentType: SUBTITLE_SEGMENT_TYPE };
  }

  /** The extractor of a session whose text track `index` has a rendition; touches the session. */
  private track(id: string, index: number): { rec: SessionRecord; extractor: SubtitleExtractor } {
    const rec = this.ctx.slots.require(id);
    rec.lastActivity = Date.now();
    const extractor = rec.subtitles;
    if (!extractor?.store.has(index)) {
      throw notFound(
        `Subtitle track ${index} is not a text track of this session.`,
        'Use the subtitle urls listed in the session or in index.m3u8.',
      );
    }
    return { rec, extractor };
  }
}
