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
  freeGb: number;
  totalGb: number;
}

export interface SystemInfo {
  pagefile: Array<{ name: string; usedMiB: number | null; sizeMiB: number | null }>;
  diskQueueD: number | null;
}

export const MAX_TEMP_C: number;
export const DEFAULT_MIN_FREE_GB: number;
export const SYSTEM_INFO_SCRIPT: string;
export function parseArgs(argv: string[]): { since: string; sinceMs: number; minFreeGb: number };
export function parseEvents(stdout: string): GpuEvent[];
export function filterNewer(events: GpuEvent[], sinceMs: number): GpuEvent[];
export function parseNvidiaSmi(stdout: string): GpuReading;
export function readMemory(freeBytes?: number): MemoryReading;
export function parseSystemInfo(stdout: string): SystemInfo;
export function evaluate(input: {
  events: GpuEvent[];
  gpu: Pick<GpuReading, 'tempC'> | null;
  memory?: Pick<MemoryReading, 'freeGb'> | null;
  minFreeGb?: number;
  errors: string[];
}): {
  ok: boolean;
  reasons: string[];
};
export function buildQueryScript(sinceMs: number): string;
export function main(argv: string[]): Promise<number>;
