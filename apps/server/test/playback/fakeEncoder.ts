import { writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_STOP_GRACE_MS,
  type EncoderExit,
  type EncoderHandle,
  type EncoderProcessOptions,
  type StopOptions,
} from '../../src/playback/encoderProcess.js';

/** `run`: writes the first segment and keeps running. `fail`: exits with code 1 at once. `hang`: neither. */
export type EncoderMode = 'run' | 'fail' | 'hang';

/** Stands in for the ffmpeg child: no process, just the files and the exit the session manager reacts to. */
export class FakeEncoder implements EncoderHandle {
  readonly pid = undefined;
  readonly exited: Promise<EncoderExit>;
  running = true;
  private finish!: (exit: EncoderExit) => void;
  private gate: Promise<void> | null = null;

  constructor(mode: EncoderMode, options: EncoderProcessOptions) {
    this.exited = new Promise((resolve) => {
      this.finish = resolve;
    });
    if (mode === 'fail') setImmediate(() => this.end(1));
    if (mode === 'run') setImmediate(() => writeFirstSegment(options));
  }

  /** The options of every `stop()` call, in order, so tests can see how long each path was willing to wait. */
  readonly stopCalls: Array<StopOptions | undefined> = [];

  /** What a stop did, in order: `cut` (input cut), `q` (asked to quit), `kill` (tree kill after the grace). */
  readonly order: Array<'cut' | 'q' | 'kill'> = [];
  /** Real time the encoder was allowed before a kill, per stop that ended in one. */
  readonly killedAfterMs: number[] = [];
  private ignoresQ = false;

  /** Like an ffmpeg that is stuck: it only dies to the kill that follows the grace. */
  ignoreQ(): void {
    this.ignoresQ = true;
  }

  async stop(options?: StopOptions): Promise<void> {
    this.stopCalls.push(options);
    if (!this.running) return;
    if (options?.cutInput) {
      this.order.push('cut');
      options.cutInput();
    }
    const grace = options?.graceMs ?? DEFAULT_STOP_GRACE_MS;
    if (grace > 0) this.order.push('q');
    if (this.gate) await this.gate;
    if (this.ignoresQ) {
      await new Promise((resolve) => setTimeout(resolve, grace));
      this.order.push('kill');
      this.killedAfterMs.push(grace);
      this.end(1, true);
      return;
    }
    this.end(0);
  }

  /** The next `stop()` does not finish until the returned function is called, like an ffmpeg that is slow to quit. */
  holdStop(): () => void {
    let release!: () => void;
    this.gate = new Promise((resolve) => {
      release = resolve;
    });
    return release;
  }

  /** Dies on its own with a failure exit code, as an ffmpeg that hit an error would. */
  crash(stderrTail = 'fake encoder'): void {
    this.stderrTail = stderrTail;
    this.end(1);
  }

  private stderrTail = 'fake encoder';

  private end(code: number, killed = false): void {
    if (!this.running) return;
    this.running = false;
    this.finish({ code, signal: null, stderrTail: this.stderrTail, killed });
  }
}

function writeFirstSegment(options: EncoderProcessOptions): void {
  const arg = (name: string): string | undefined => options.args[options.args.indexOf(name) + 1];
  const start = arg('-start_number') ?? '0';
  const extension = path.extname(arg('-hls_segment_filename') ?? 'seg-%d.ts');
  try {
    writeFileSync(path.join(options.cwd, `seg-${start}${extension}`), 'segment');
  } catch {
    // The session directory is already gone: the start was abandoned.
  }
}

/** Test seam for `createEncoder`: the mode can be a fixed value or chosen per started encoder (0-based). */
export class FakeEncoders {
  started = 0;
  readonly cwds: string[] = [];
  readonly handles: FakeEncoder[] = [];

  constructor(public mode: EncoderMode | ((index: number) => EncoderMode) = 'run') {}

  readonly create = (options: EncoderProcessOptions): EncoderHandle => {
    const mode = typeof this.mode === 'function' ? this.mode(this.started) : this.mode;
    this.started += 1;
    this.cwds.push(options.cwd);
    const encoder = new FakeEncoder(mode, options);
    this.handles.push(encoder);
    return encoder;
  };
}
