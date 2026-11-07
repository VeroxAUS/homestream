import type { PidRegistryEntry } from './gpu-health-ffmpeg.mjs';

export interface GpuEvent {
  time: string;
  log: string;
  provider: string;
  id: number;
  level: string;
  message: string;
}

export interface GpuReading {
  tempC: number | null;
  utilGpuPct: number | null;
  utilEncoderPct: number | null;
  utilDecoderPct: number | null;
  memUsedMiB: number | null;
  powerW: number | null;
}

export interface MemoryReading {
  /** Rounded for display; evaluate compares freeGbExact. */
  freeGb: number;
  freeGbExact: number;
  totalGb: number;
}

export interface SystemInfo {
  pagefile: Array<{ name: string; usedMiB: number | null; sizeMiB: number | null }>;
  diskQueueD: number | null;
}

export const MAX_TEMP_C: number;
export const DEFAULT_MIN_FREE_GB: number;
export const MAX_IDLE_UTIL_PCT: number;
export const IDLE_SAMPLES: number;
export const IDLE_SAMPLE_GAP_MS: number;
export const IDLE_SPIKE_PCT: number;
export const IDLE_SPIKE_COUNT: number;

export interface IdleReading {
  /** A HomeStream-owned ffmpeg is running; null when the process list could not be read. */
  ffmpegRunning: boolean | null;
  foreignFfmpeg?: number | null;
  /** Median of the samples. */
  utilPct: number | null;
  spikes?: number | null;
  processes: string[];
}
export const SYSTEM_INFO_SCRIPT: string;
export function parseArgs(argv: string[]): { since: string; sinceMs: number; minFreeGb: number; requireIdle: boolean };
export function parseGpuProcessNames(stdout: string): string[];
export function summarizeIdle(samples: Array<number | null>): {
  samples: Array<number | null>;
  utilPct: number | null;
  spikes: number | null;
};
export function parseEvents(stdout: string): GpuEvent[];
export function filterNewer(events: GpuEvent[], sinceMs: number): GpuEvent[];
export function parseNvidiaSmi(stdout: string): GpuReading;
export function readMemory(freeBytes?: number): MemoryReading;
export function parseSystemInfo(stdout: string): SystemInfo;
export function evaluate(input: {
  events: GpuEvent[];
  gpu: Pick<GpuReading, 'tempC'> | null;
  memory?: (Pick<MemoryReading, 'freeGb'> & Partial<Pick<MemoryReading, 'freeGbExact'>>) | null;
  minFreeGb?: number;
  idle?: IdleReading;
  errors: string[];
}): {
  ok: boolean;
  reasons: string[];
};
export function buildQueryScript(sinceMs: number): string;
export function readIdle(deps?: {
  run?: (command: string, args: string[], timeout?: number) => Promise<string>;
  wait?: (ms: number) => Promise<void>;
  registry?: PidRegistryEntry[];
  roots?: string[];
}): Promise<IdleReading & { samples: Array<number | null> }>;
export function main(argv: string[]): Promise<number>;
