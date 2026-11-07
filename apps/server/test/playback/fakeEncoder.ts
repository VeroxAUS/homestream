import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  EncoderExit,
  EncoderHandle,
  EncoderProcessOptions,
  StopOptions,
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

  stop(options?: StopOptions): Promise<void> {
    this.stopCalls.push(options);
    if (!this.gate) {
      this.end(0);
      return Promise.resolve();
    }
    return this.gate.then(() => this.end(0));
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
  crash(): void {
    this.end(1);
  }

  private end(code: number): void {
    if (!this.running) return;
    this.running = false;
    this.finish({ code, signal: null, stderrTail: 'fake encoder' });
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
