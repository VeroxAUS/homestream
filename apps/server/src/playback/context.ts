import path from 'node:path';
import { rm } from 'node:fs/promises';
import { logEvent, type LogEventInput } from '../events/record.js';
import { FallingBehindWatch } from './fallingBehind.js';
import { MemoryWatchdog, createWorkingSetSampler, imageNameOf } from './memoryWatchdog.js';
import { PID_FILE_NAME, PidRegistry } from './pidRegistry.js';
import { MAX_SESSIONS, SessionSlots } from './sessionSlots.js';
import type { PlaybackManagerOptions } from './support.js';

const SEGMENT_WAIT_MS = 30_000;
const FIRST_SEGMENT_WAIT_MS = 30_000;
/** A subtitle segment that no extractor has reached yet is waited for this long before the client is told to retry. */
const SUBTITLE_HOLD_MS = 6_000;

/** What every playback module shares: the options, the process bookkeeping, the session slots and the event log. */
export class PlaybackContext {
  readonly registry: PidRegistry;
  readonly watchdog: MemoryWatchdog;
  readonly fallingBehind = new FallingBehindWatch();
  readonly slots: SessionSlots;
  readonly segmentWaitMs: number;
  readonly subtitleHoldMs: number;
  readonly firstSegmentWaitMs: number;
  /** Set when libplacebo failed to start once; later sessions then tone map with OpenCL right away. */
  libplaceboBroken = false;

  constructor(readonly options: PlaybackManagerOptions) {
    this.segmentWaitMs = options.segmentWaitMs ?? SEGMENT_WAIT_MS;
    this.subtitleHoldMs = options.subtitleHoldMs ?? SUBTITLE_HOLD_MS;
    this.firstSegmentWaitMs = options.firstSegmentWaitMs ?? FIRST_SEGMENT_WAIT_MS;
    this.registry = new PidRegistry(path.join(options.config.dataDir, PID_FILE_NAME));
    this.watchdog = new MemoryWatchdog({
      limitMb: options.config.ffmpegMaxRssMb,
      sample: createWorkingSetSampler(imageNameOf(options.config.ffmpegPath)),
    });
    this.slots = new SessionSlots(this, options.maxSessions ?? MAX_SESSIONS);
  }

  event(input: LogEventInput): void {
    try {
      logEvent({ db: this.options.db, bus: this.options.bus }, input);
    } catch (error) {
      this.options.logger.warn({ err: error }, 'Could not record an event');
    }
  }

  async removeDir(dir: string): Promise<void> {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch((error: unknown) => {
      this.options.logger.warn({ dir, err: error }, 'Could not delete the session directory');
    });
  }
}
