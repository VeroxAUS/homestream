import type { TimingRecord } from './ci-timing.mjs';

export function openMetrics(options: { remote: string; dir: string; token?: string }): { created: boolean };
export function readRecords(dir: string): TimingRecord[];
export function publishRecord(options: {
  dir: string;
  record: TimingRecord;
  token?: string;
  sleepImpl?: (ms: number) => Promise<void>;
}): Promise<{ file: string; pushed: boolean }>;
