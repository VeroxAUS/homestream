export interface StepRecord {
  name: string;
  conclusion: string;
  seconds: number;
}
export interface JobRecord {
  name: string;
  conclusion: string;
  seconds: number;
  steps: StepRecord[];
}
export interface TimingRecord {
  schema: number;
  run: {
    id: number;
    attempt: number;
    url: string;
    sha: string;
    branch: string;
    event: string;
    startedAt: string;
    completedAt: string;
    conclusion: 'success' | 'failure';
  };
  totalSeconds: number;
  jobs: JobRecord[];
  tests: Record<string, number>;
}
export interface Regression {
  name: string;
  current: number;
  median: number;
  percent: number;
}
export interface Comparison {
  runs: number;
  runIds: number[];
  total: { current: number; median: number; percent: number } | null;
  jobs: Regression[];
  steps: Regression[];
  tests: Regression[];
}
export const STICKY_MARKER: string;
export function median(values: number[]): number | null;
export interface ApiStep {
  name: string;
  conclusion: string | null;
  started_at?: string | null;
  completed_at?: string | null;
}
export interface ApiJob {
  name: string;
  status: string;
  conclusion: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  steps?: ApiStep[];
}
export interface ApiRun {
  id: number;
  run_attempt?: number;
  html_url: string;
  head_sha: string;
  head_branch: string;
  event: string;
  run_started_at?: string;
  created_at: string;
  updated_at: string;
}
export function buildRecord(input: { run: ApiRun; jobs: ApiJob[]; tests?: Record<string, number> }): TimingRecord;
export function testsFromVitest(report: unknown): Record<string, number>;
export function testsFromJunit(xml: string): Record<string, number>;
export function recordFileName(record: { run: Pick<TimingRecord['run'], 'id' | 'attempt' | 'completedAt'> }): string;
export function pickHistory(
  records: TimingRecord[],
  options?: { excludeRunId?: number; limit?: number },
): TimingRecord[];
export function compareRecords(current: TimingRecord, history: TimingRecord[]): Comparison;
export function formatSeconds(value: number): string;
export function safeName(name: unknown): string;
export function renderComparison(comparison: Comparison, options: { record: TimingRecord; against?: string }): string;
