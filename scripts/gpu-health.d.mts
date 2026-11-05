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

export const MAX_TEMP_C: number;
export function parseArgs(argv: string[]): { since: string; sinceMs: number };
export function parseEvents(stdout: string): GpuEvent[];
export function filterNewer(events: GpuEvent[], sinceMs: number): GpuEvent[];
export function parseNvidiaSmi(stdout: string): GpuReading;
export function evaluate(input: { events: GpuEvent[]; gpu: Pick<GpuReading, 'tempC'> | null; errors: string[] }): {
  ok: boolean;
  reasons: string[];
};
export function buildQueryScript(sinceMs: number): string;
export function main(argv: string[]): Promise<number>;
