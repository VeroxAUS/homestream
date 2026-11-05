import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { lowerPriority } from './priority.js';
import { ProgressParser, type RawProgress } from './progress.js';

export interface EncoderExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** Last lines ffmpeg wrote to stderr, unredacted. */
  stderrTail: string;
}

export interface EncoderProcessOptions {
  ffmpegPath: string;
  args: string[];
  cwd: string;
  onProgress: (progress: RawProgress) => void;
}

const STDERR_LIMIT = 4000;

function killTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already gone
      }
      resolve();
      return;
    }
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
  });
}

/** One ffmpeg child. Stopping it asks politely with `q`, then kills the whole process tree. */
export class EncoderProcess {
  readonly pid: number | undefined;
  readonly exited: Promise<EncoderExit>;
  private readonly child: ChildProcess;
  private done = false;

  constructor(options: EncoderProcessOptions) {
    const parser = new ProgressParser();
    let stderr = '';

    this.child = spawn(options.ffmpegPath, options.args, {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.pid = this.child.pid;
    lowerPriority(this.pid);

    this.child.stdin?.on('error', () => undefined);
    this.child.stdout?.setEncoding('utf8');
    this.child.stdout?.on('data', (chunk: string) => {
      for (const snapshot of parser.push(chunk)) options.onProgress(snapshot);
    });
    this.child.stderr?.setEncoding('utf8');
    this.child.stderr?.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_LIMIT);
    });

    this.exited = new Promise<EncoderExit>((resolve) => {
      this.child.once('error', (error) => {
        this.done = true;
        resolve({ code: -1, signal: null, stderrTail: error.message });
      });
      this.child.once('close', (code, signal) => {
        this.done = true;
        resolve({ code, signal, stderrTail: stderr.trim() });
      });
    });
  }

  get running(): boolean {
    return !this.done;
  }

  async stop(graceMs = 3000): Promise<void> {
    if (this.done) return;
    try {
      this.child.stdin?.write('q\n');
      this.child.stdin?.end();
    } catch {
      // stdin already closed; fall through to the kill
    }
    const timer = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), graceMs).unref());
    if ((await Promise.race([this.exited, timer])) !== 'timeout') return;
    if (this.pid !== undefined) await killTree(this.pid);
    await Promise.race([this.exited, new Promise((resolve) => setTimeout(resolve, 5000).unref())]);
  }
}
