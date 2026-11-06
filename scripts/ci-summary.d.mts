export interface CoverageEntry {
  name: string;
  totals: Record<string, number>;
  thresholds: Record<string, number>;
}
export function readCoverage(root: string): CoverageEntry[];
export function coverageTable(entries: CoverageEntry[]): string;
export function flakySection(report: { flaky: Array<{ name: string; retries: number }> } | null): string;
export function buildSummary(root: string): string;
