import { mkdirSync, existsSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { EncoderProcess, type EncoderExit } from './encoderProcess.js';
import { PROBE_LIMIT_ARGS } from './probe.js';
import type { PidRegistry } from './pidRegistry.js';

export const MAX_TEXT_SUBTITLES = 10;
export const SUBTITLE_DIR = 'subs';
/** Marks extractor processes in the pid registry; their command line deliberately has no session id (see `buildExtractArgs`). */
export const EXTRACTOR_MARKER = 'webvtt';

const SUBTITLE_FILE = /^(\d{1,5})\.vtt$/;

export function parseSubtitleFileName(name: string): number | null {
  const match = SUBTITLE_FILE.exec(name);
  return match ? Number(match[1]) : null;
}

export function subtitlePath(sessionDir: string, index: number): string {
  return path.join(sessionDir, SUBTITLE_DIR, `${index}.vtt`);
}

/**
 * One ffmpeg pass that converts the given text tracks to WebVTT from time 0, so cue times are absolute and
 * independent of where the encoder starts. Output names are relative to the session dir (the process cwd): that keeps the
 * session id off the command line, so a session's encoder stays the only process that matches it.
 */
export function buildExtractArgs(inputUrl: string, indices: number[]): string[] {
  const args = ['-hide_banner', '-loglevel', 'error', '-y'];
  if (/^https?:\/\//i.test(inputUrl)) {
    args.push('-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_on_network_error', '1', '-reconnect_delay_max', '10');
  }
  args.push(...PROBE_LIMIT_ARGS, '-i', inputUrl);
  for (const index of indices) {
    args.push('-map', `0:${index}`, '-c:s', 'webvtt', '-f', EXTRACTOR_MARKER, `${SUBTITLE_DIR}/${index}.part`);
  }
  return args;
}

export interface SubtitleExtractorOptions {
  ffmpegPath: string;
  sessionId: string;
  sessionDir: string;
  /** Read at start, so a re-resolved CDN link is picked up. */
  inputUrl: () => string;
  indices: number[];
  registry: PidRegistry;
  onReady: (index: number) => void;
  onFailure: (indices: number[], exit: EncoderExit) => void;
}

/** Converts a session's text subtitle tracks to WebVTT in the background, one file per track, published when complete. */
export class SubtitleExtractor {
  private current: EncoderProcess | null = null;
  private stopped = false;
  private finished: Promise<void> | null = null;

  constructor(private readonly options: SubtitleExtractorOptions) {}

  start(): void {
    if (this.finished || this.options.indices.length === 0) return;
    mkdirSync(path.join(this.options.sessionDir, SUBTITLE_DIR), { recursive: true });
    this.finished = this.run().catch(() => undefined);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.current?.stop();
    await this.finished;
  }

  private async run(): Promise<void> {
    const { indices } = this.options;
    let result = await this.pass(indices);
    // One broken track must not take the others down: retry each on its own.
    if (result.failed.length > 0 && indices.length > 1 && !this.stopped) {
      const failed: number[] = [];
      for (const index of indices) {
        if (this.stopped) return;
        result = await this.pass([index]);
        failed.push(...result.failed);
      }
      result = { failed, exit: result.exit };
    }
    if (result.failed.length > 0 && !this.stopped) this.options.onFailure(result.failed, result.exit);
  }

  /** Runs one ffmpeg over `indices`; reports the indices that produced no file. */
  private async pass(indices: number[]): Promise<{ failed: number[]; exit: EncoderExit }> {
    const { options } = this;
    const proc = new EncoderProcess({
      ffmpegPath: options.ffmpegPath,
      args: buildExtractArgs(options.inputUrl(), indices),
      cwd: options.sessionDir,
      onProgress: () => undefined,
    });
    this.current = proc;
    const pid = proc.pid;
    if (pid !== undefined) options.registry.add({ pid, sessionId: options.sessionId, startedAt: Date.now(), match: EXTRACTOR_MARKER });
    const exit = await proc.exited;
    if (pid !== undefined) options.registry.remove(pid);
    this.current = null;

    const failed: number[] = [];
    for (const index of indices) {
      const part = path.join(options.sessionDir, SUBTITLE_DIR, `${index}.part`);
      if (!this.stopped && exit.code === 0 && existsSync(part)) {
        await rename(part, subtitlePath(options.sessionDir, index)).then(
          () => options.onReady(index),
          () => failed.push(index),
        );
      } else {
        failed.push(index);
        await rm(part, { force: true }).catch(() => undefined);
      }
    }
    return { failed, exit };
  }
}
