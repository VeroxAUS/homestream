import { execFile } from 'node:child_process';
import path from 'node:path';

export const DEFAULT_MAX_RSS_MB = 4096;
const WATCHDOG_INTERVAL_MS = 1000;
/** After the limit is hit the process gets this long to quit on `q` before it is killed. */
export const WATCHDOG_STOP_GRACE_MS = 2000;

const MIB = 1024 * 1024;

export interface MemoryLimitHit {
  pid: number;
  rssBytes: number;
  limitBytes: number;
}

/** Pure decision: a process is over the limit once its working set is strictly above it. */
export function exceedsMemoryLimit(rssBytes: number, limitMb: number): boolean {
  return rssBytes > limitMb * MIB;
}

/** `tasklist /FO CSV /NH` rows: "ffmpeg.exe","1234","Console","1","1,234,567 K". The memory column is the working set in KiB. */
export function parseTasklistCsv(output: string): Map<number, number> {
  const result = new Map<number, number>();
  for (const line of output.split(/\r?\n/)) {
    const fields = line.match(/"([^"]*)"/g)?.map((field) => field.slice(1, -1));
    if (!fields || fields.length < 5) continue;
    const pid = Number(fields[1]);
    const memory = fields[4] as string;
    // Separators are locale dependent (1,234 K / 1.234 K / 1 234 K), so only the digits count.
    if (Number.isInteger(pid) && pid > 0 && /\d/.test(memory))
      result.set(pid, Number(memory.replace(/\D/g, '')) * 1024);
  }
  return result;
}

/** `ps -o pid=,rss=` rows: pid and resident set in KiB. */
export function parsePsRss(output: string): Map<number, number> {
  const result = new Map<number, number>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (match) result.set(Number(match[1]), Number(match[2]) * 1024);
  }
  return result;
}

function execText(command: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true, timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (_error, stdout) =>
      resolve(stdout ?? ''),
    );
  });
}

/** Image name tasklist should list for an ffmpeg path, e.g. `C:\tools\ffmpeg` and `ffmpeg.exe` both give `ffmpeg.exe`. */
export function imageNameOf(executable: string): string {
  const base = path.basename(executable);
  return /\.exe$/i.test(base) ? base : `${base}.exe`;
}

export type WorkingSetSampler = (pids: number[]) => Promise<Map<number, number>>;

/** Working set in bytes per live pid; pids that are gone are absent. */
export function createWorkingSetSampler(imageName = 'ffmpeg.exe'): WorkingSetSampler {
  return async (pids) => {
    if (pids.length === 0) return new Map();
    if (process.platform === 'win32') {
      const out = await execText('tasklist', ['/FO', 'CSV', '/NH', '/FI', `IMAGENAME eq ${imageName}`]);
      const all = parseTasklistCsv(out);
      return new Map(pids.flatMap((pid) => (all.has(pid) ? [[pid, all.get(pid) as number] as const] : [])));
    }
    return parsePsRss(await execText('ps', ['-o', 'pid=,rss=', '-p', pids.join(',')]));
  };
}

interface Watched {
  pid: number;
  onExceed: (hit: MemoryLimitHit) => void;
}

export interface MemoryWatchdogOptions {
  limitMb: number;
  intervalMs?: number;
  sample?: WorkingSetSampler;
}

/**
 * One timer for every ffmpeg the server spawns: samples their working sets together and reports each one that is above the
 * limit exactly once. The timer only runs while something is watched.
 */
export class MemoryWatchdog {
  readonly limitMb: number;
  private readonly intervalMs: number;
  private readonly sample: WorkingSetSampler;
  private readonly watched = new Map<number, Watched>();
  private timer: NodeJS.Timeout | null = null;
  private sampling = false;
  /** Highest working set seen per currently watched pid. */
  private readonly peaks = new Map<number, number>();

  constructor(options: MemoryWatchdogOptions) {
    this.limitMb = options.limitMb;
    this.intervalMs = options.intervalMs ?? WATCHDOG_INTERVAL_MS;
    this.sample = options.sample ?? createWorkingSetSampler();
  }

  /** Returns the function that stops watching the pid. */
  watch(pid: number, onExceed: (hit: MemoryLimitHit) => void): () => void {
    this.watched.set(pid, { pid, onExceed });
    if (!this.timer) {
      this.timer = setInterval(() => void this.tick(), this.intervalMs);
      this.timer.unref();
    }
    return () => this.unwatch(pid);
  }

  unwatch(pid: number): void {
    this.watched.delete(pid);
    this.peaks.delete(pid);
    if (this.watched.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  peak(pid: number): number {
    return this.peaks.get(pid) ?? 0;
  }

  get size(): number {
    return this.watched.size;
  }

  /** One sampling round; exposed so tests do not wait for the timer. */
  async tick(): Promise<void> {
    if (this.sampling || this.watched.size === 0) return;
    this.sampling = true;
    try {
      const rss = await this.sample([...this.watched.keys()]);
      for (const [pid, bytes] of rss) {
        const entry = this.watched.get(pid);
        if (!entry) continue;
        this.peaks.set(pid, Math.max(this.peaks.get(pid) ?? 0, bytes));
        if (exceedsMemoryLimit(bytes, this.limitMb)) {
          this.unwatch(pid);
          entry.onExceed({ pid, rssBytes: bytes, limitBytes: this.limitMb * MIB });
        }
      }
    } catch {
      // A failed sample only skips one round.
    } finally {
      this.sampling = false;
    }
  }

  close(): void {
    this.watched.clear();
    this.peaks.clear();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
